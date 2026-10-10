// Readwise (PIE-743): a Readwise and Reader client built only on what any extension has.
//
//   saved to Reader as one document. Sending publishes the note ([publish::public], unlisted), and its public permalink is
//   its URL in Reader (or config `link`), so a highlight made on it in Reader comes back knowing which note it belongs to.
//   so a highlight made on it in Reader comes back knowing which note it belongs to.
// - `pull` (on the outline, every hour): Readwise's export of every highlight changed since the last pull (Reader's
//   highlights reach it too). A highlight on a document `send` made becomes an annotation on that note, at the
//   passage (`kind=highlight`, your note on it as the body); every other one lands on the readwise board, a block per
//   book with a block per highlight under it. Each highlight is known by its Readwise id, so a pull run twice writes
//   nothing new, and a changed note on a highlight updates what's there. Its schedule says `once: "host"`, so the
//   hourly pull runs in one outline of the host, not in each.
//
// - `library` (on the outline, every hour): the Reader library itself, not just its highlights. Reader's document list
//   (`/api/v3/list/`) since the last run becomes a block per document under the "Reader" page of the readwise board,
//   matched by `reader.id` and kept in step (a document moved from later to archive is updated, not duplicated; one
//   Reader reports deleted gets `reader.deleted::true`). Highlights and notes are documents too (`parent_id`): skipped,
//   because the export path brings the highlights. A highlight of a Reader document carries `reader.doc`, and the
//   document's block links to its book's highlights, so one note shows the document with its highlights.
//
// It writes over its own connection (outline.ts), as ext:readwise. The token comes from the `with-secrets` group
// `readwise` (key READWISE_TOKEN) on stdin, and is never written anywhere.
import { outline } from "./outline";

interface Block { id: string; text: string; revision: number }
interface Config { board?: string; page?: string; link?: string; machine?: string; tags?: string[]; api?: string; minutes?: number; readerPage?: string; locations?: string[]; publish?: boolean }
interface Request {
  operation: string;
  input: { action: string; target?: { blockId: string }; context: { now: string }; scheduled?: { at: string } };
  config?: Config;
  credentials?: { token?: string };
}
interface Tag { name: string }
interface Highlight {
  id: number; text: string; note?: string | null; color?: string | null; tags?: Tag[]; highlighted_at?: string | null;
  created_at?: string | null; updated_at?: string | null; is_deleted?: boolean; readwise_url?: string | null; url?: string | null;
  location?: number | null; location_type?: string | null; end_location?: number | null; external_id?: string | null;
  is_favorite?: boolean; is_discard?: boolean; book_id?: number;
}
interface Book {
  user_book_id: number; title: string; readable_title?: string; author?: string | null; category?: string | null;
  source?: string | null; source_url?: string | null; unique_url?: string | null; readwise_url?: string | null;
  cover_image_url?: string | null; asin?: string | null; summary?: string | null; external_id?: string | null;
  document_note?: string | null; book_tags?: Tag[]; highlights: Highlight[];
}
interface ReaderDoc {
  id: string; url?: string | null; source_url?: string | null; title?: string | null; author?: string | null; category?: string | null;
  location?: string | null; tags?: Record<string, { name?: string }> | Tag[] | null; site_name?: string | null; word_count?: number | null;
  notes?: string | null; summary?: string | null; published_date?: string | null; saved_at?: string | null; created_at?: string | null;
  reading_progress?: number | null; parent_id?: string | null; deleted?: boolean; is_deleted?: boolean; deleted_at?: string | null;
}
interface Thread { block: Block; body: string; properties?: Record<string, string[]> }
/** `notes.address`'s answer (PIE-767): the outline, this machine's name, the note's ep0ch:// URI, where it's published. */
interface Address { outline?: string; machine: string; uri?: string; published?: { url?: string; publicUrl?: string; permalink?: string } }

const request = (await Bun.stdin.json()) as Request;
const config = request.config ?? {};
const answer = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));
const refuse = (code: string) => process.stdout.write(JSON.stringify({ ok: false, code }));

const API = (config.api ?? "https://readwise.io").replace(/\/+$/, "");
const HERE = process.env.EP0CH_WS ?? "";
// This machine's name in ep0ch:// links, as the service says it (`notes.address`, asked in main); config `machine` overrides it.
let MACHINE = config.machine ?? "";
/** A note's URL in Reader when it isn't published (or config `link`, always). */
const FALLBACK_LINK = "https://ep0ch.invalid/{outline}@{machine}/b/{id}";
const LINK = config.link ?? FALLBACK_LINK;
const BOARD = config.board ?? "readwise";
const PAGE = config.page ?? "readwise";
const DEFAULT_LOCATIONS = ["new", "later", "shortlist", "archive"];
const READER_PAGE = config.readerPage ?? "reader";
const STARTED = Date.now();
const UNTIL = STARTED + (config.minutes ?? 4) * 60_000;

class Stop extends Error {
  constructor(readonly code: string) { super(code); }
}

// ── Readwise ─────────────────────────────────────────────────────────────

async function readwise<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: T }> {
  const token = request.credentials?.token;
  if (!token) throw new Stop("credentials-missing");
  for (;;) {
    let response: Response;
    try {
      response = await fetch(`${API}${path}`, {
        method: init.method ?? "GET",
        headers: { Authorization: `Token ${token}`, "Content-Type": "application/json" },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Stop("network");
    }
    if (response.status === 429) {
      // Readwise says how long to wait; wait when that fits in this run, else stop and leave the rest for the next.
      const wait = Math.max(1, Number(response.headers.get("retry-after") ?? "60")) * 1000;
      if (Date.now() + wait > UNTIL) throw new Stop("rate-limited");
      await Bun.sleep(wait);
      continue;
    }
    if (response.status === 401) throw new Stop("unauthorized");
    if (response.status === 403) throw new Stop("forbidden");
    if (response.status === 404) throw new Stop("not-found");
    if (!response.ok) throw new Stop("network");
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : {}) as T };
  }
}

// ── Links: a note's URL in Reader, and back ──────────────────────────────

const uriOf = (name: string, id: string) => `ep0ch://${name}@${MACHINE}/b/${id}`;
const fromTemplate = (template: string, name: string, id: string) => template.replaceAll("{outline}", name).replaceAll("{machine}", MACHINE).replaceAll("{id}", id);

/** A note's URL in Reader, and what to tell the person about it when it isn't a web page. */
interface Link { url: string; note?: string }

const permalinkOf = (permalink: string, name: string) => `${permalink}?ep0ch=${encodeURIComponent(name)}@${encodeURIComponent(MACHINE)}`;

/** The note's public permalink, when a publisher with a public address serves it as public. */
async function publicPermalink(name: string, id: string): Promise<string | undefined> {
  const { published } = await outline<Address>({ action: "notes.address", blockId: id }, name);
  return published?.public && published.publicUrl ? published.permalink : undefined;
}

/**
 * A note's URL in Reader: config `link` when it's set; else, sending publishes the note (config `publish`, on unless
 * `false`): `[publish::public]` is set on it, unlisted and by link, and its public permalink (the page by its id) with
 * `?ep0ch=<outline>@<machine>` is the URL, so a pull knows the note's outline and machine. With `publish: false`, a
 * note that is already published gets its permalink as before. Without a public web address (no publisher for the
 * outline, or one with no public URL) it is the fallback template, and the answer says what would publish it. Reader
 * needs a unique web URL per document, and the pull reads the note back out of it.
 */
async function linkOf(name: string, id: string): Promise<Link> {
  if (config.link) return { url: fromTemplate(config.link, name, id) };
  const fallback = fromTemplate(FALLBACK_LINK, name, id);
  if (config.publish === false) {
    const address = await outline<Address>({ action: "notes.address", blockId: id }, name);
    const permalink = address.published?.permalink;
    return { url: permalink ? permalinkOf(permalink, name) : fallback };
  }
  const before = await publicPermalink(name, id);
  if (before) return { url: permalinkOf(before, name) };
  // Not public yet: set it the way a person would, then ask where it is. When nothing serves the outline publicly the
  // note goes back as it was, so a send never leaves a note waiting to be opened to the world by a publisher started later.
  const block = await outline<Block>({ action: "get", blockId: id }, name);
  const props = headerProps(block.text);
  const asked = props.publish?.trim() ?? "";
  const value = /^public(:|$)/i.test(asked) ? asked : /^(|true|yes|false|no|off|0)$/i.test(asked) ? "public" : `public:${asked}`;
  await update(block, withHeaderProps(block.text, { publish: value }), name);
  const after = await publicPermalink(name, id);
  if (after) return { url: permalinkOf(after, name), note: "published it (unlisted, by link)" };
  const current = await outline<Block>({ action: "get", blockId: id }, name);
  if (current.text === withHeaderProps(block.text, { publish: value })) await update(current, block.text, name);
  return { url: fallback, note: `no publisher serves "${name}" at a public address, so its Reader URL is the placeholder; start one: ep0ch publish serve --ws ${name} --port <free port> --public-port <free port> --public-url <https://where it is opened> (or set config publish to false to stop publishing on send)` };
}

/** The note a document's URL names: an ep0ch:// URI, a published permalink with `?ep0ch=<outline>@<machine>`, or the `link` template's shape. */
function noteOf(url: string | null | undefined): { outline: string; machine: string; id: string } | null {
  if (!url) return null;
  const canonical = /^ep0ch:\/\/([^/@]+)@([^/]+)\/b\/([0-9a-f-]{36})$/i.exec(url);
  if (canonical) return { outline: canonical[1]!, machine: canonical[2]!, id: canonical[3]!.toLowerCase() };
  const permalink = /\/p\/([0-9a-f-]{36})\?ep0ch=([^&#/@]+)@([^&#/@]+)$/i.exec(url);
  if (permalink) {
    // A document's URL is outside text: one that doesn't decode is no note's, never a failed pull.
    try { return { outline: decodeURIComponent(permalink[2]!), machine: decodeURIComponent(permalink[3]!), id: permalink[1]!.toLowerCase() }; } catch { return null; }
  }
  const order: string[] = [];
  const pattern = LINK.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{(outline|machine|id)\}/g, (_, name: string) => {
    order.push(name);
    return name === "id" ? "([0-9a-fA-F-]{36})" : "([^/@?#]+)";
  });
  const match = new RegExp(`^${pattern}$`).exec(url);
  if (!match) return null;
  const found: Record<string, string> = { machine: MACHINE };
  try { order.forEach((name, index) => { found[name] = decodeURIComponent(match[index + 1]!); }); } catch { return null; }
  return found.outline && found.id ? { outline: found.outline, machine: found.machine!, id: found.id.toLowerCase() } : null;
}

// ── Blockdown ────────────────────────────────────────────────────────────

const TONES: Record<string, string> = { yellow: "warn", orange: "warn", blue: "accent", purple: "accent", pink: "bad", green: "good" };

/**
 * Imported words stay words: a `[key::value]`, `[[page]]` or `((ref))` in a highlight is escaped, never a property or a
 * link. A `[key::value]` takes outline-core's escape (`\\[`); a link is a pair, so every `[` or `(` before another
 * gets a backslash after it (`[\\[page]]`, `(\\(ref))`): no two are left side by side, however many there were.
 */
const inert = (text: string) => text.replace(/\r/g, "").replace(/\[(?=[A-Za-z][\w.-]*::)/g, "\\[").replace(/\[(?=\[)/g, "[\\").replace(/\((?=\()/g, "(\\");
/** A property value: one line, no brackets. */
const value = (text: string) => text.replace(/[\]\[\n\r]+/g, " ").replace(/\s+/g, " ").trim();
const token = (key: string, v: string | number | null | undefined) => (v === null || v === undefined || String(v).trim() === "" ? "" : `[${key}::${value(String(v))}]`);
const tokens = (parts: string[]) => parts.filter(Boolean).join(" ");
const short = (text: string) => { const one = value(text).replace(/\((?=\()/g, "(\\"); return one.length > 80 ? `${one.slice(0, 79)}…` : one; };

/** The `[key::value]` tokens on a block's first line. */
function headerProps(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of text.split("\n")[0]!.matchAll(/\[([A-Za-z][\w.-]*)::([^\]\n]*)\]/g)) out[match[1]!] = match[2]!;
  return out;
}

/** The first line with these properties set (a string) or taken out (null), the rest of the text as it was. */
function withHeaderProps(text: string, changes: Record<string, string | null>, at = 0): string {
  const lines = text.split("\n");
  let line = lines[at] ?? "";
  for (const [key, next] of Object.entries(changes)) {
    const pattern = new RegExp(`\\s?\\[${key.replace(/[.]/g, "\\.")}::[^\\]\\n]*\\]`, "g");
    line = line.replace(pattern, "");
    if (next !== null) line = `${line} ${token(key, next)}`;
  }
  lines[at] = line;
  return lines.join("\n");
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── The outline ──────────────────────────────────────────────────────────

/** The block and every block under it, depth first, at most 200. */
async function subtree(root: Block, name: string): Promise<Block[]> {
  const out: Block[] = [root];
  const walk = async (parentId: string): Promise<void> => {
    for (const child of await outline<Block[]>({ action: "children", parentId }, name)) {
      if (out.length >= 200) return;
      out.push(child);
      await walk(child.id);
    }
  };
  await walk(root.id);
  return out;
}

async function update(block: Block, text: string, name: string): Promise<void> {
  if (block.text === text) return;
  await outline({ action: "update", blockId: block.id, expectedRevision: block.revision, text }, name);
}

// ── send ─────────────────────────────────────────────────────────────────

async function send(blockId: string): Promise<void> {
  // The note as its published page reads (the publisher's renderer, published or not): property tokens out, links as
  // their labels or web URLs. A [publish::never] note is refused here, so it never leaves the outline.
  const rendered = await outline<{ blockId: string; title: string; text: string }>({ action: "notes.render", blockId, format: "html" });
  const uri = uriOf(HERE, rendered.blockId);
  const body = `<p>From ep0ch: <a href="${escapeHtml(uri)}">${escapeHtml(uri)}</a></p>\n${rendered.text}`;
  const link = await linkOf(HERE, rendered.blockId);
  const saved = await readwise<{ id?: string; url?: string }>("/api/v3/save/", { method: "POST", body: {
    url: link.url, html: body, title: rendered.title, tags: config.tags ?? ["ep0ch"], should_clean_html: false, saved_using: "ep0ch",
  } });
  const where = saved.body.url ? `: ${saved.body.url}` : "";
  const published = link.note ? ` (${link.note})` : "";
  answer({ message: saved.status === 200
    ? `already in Reader${where} (Reader keeps the first copy; delete it there to send again)${published}`
    : `saved "${short(rendered.title)}" to Reader${where}${published}` });
}

// ── Properties ───────────────────────────────────────────────────────────
//
// Every field Readwise exports that a person could filter on becomes a property, so the views' grammar (`where=`,
// `group=`, `sort=`) answers it with no code here. Plain keys where the meaning is general and another source could
// share it (`author`, `title`, `category`, `source`, `url`, `tags`, `favorite`, `highlighted`); `readwise.*` where it is
// Readwise's own (ids, locations, its URLs, its timestamps). A highlight carries its book's identity too (denormalized,
// because a query reads one block's own properties, not its parent's): `author`, `title`, `category`, `source`, `url`,
// `book-tags` and `readwise.book`. Highlight tags stay `tags`; the book's own tags are `tags` on the book block and
// `book-tags` on each highlight, so `tags=moss` means a highlight you tagged moss, never one that merely sits in a
// book someone tagged. Empty values are left out. Dates are the day (`2026-09-30`); the query grammar compares a
// property for equality only (ranges are for `created` and `updated`), so `highlighted-year` and `highlighted-month`
// are the buckets "from 2024" asks for (and `group=highlighted-year` groups by).

type Entry = [key: string, value: string | number | null | undefined];
const day = (date: string | null | undefined) => (date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null);
const names = (tags: Tag[] | undefined) => (tags ?? []).map((tag) => value(tag.name)).filter(Boolean);
/** A Readwise summary is kept as a property only when it is short; a long one is not a filter. */
const shortSummary = (text: string | null | undefined) => { const one = value(text ?? ""); return one && one.length <= 160 ? one : null; };
/** The book's title as a person reads it (`readable_title` when Readwise cleaned one up; `readwise.title` keeps the raw one). */
const titleOf = (book: Book) => value(book.readable_title || book.title || "(untitled)");

/** The book's identity, as every highlight of it carries it. */
function bookIdentity(book: Book): Entry[] {
  return [
    ["readwise.book", book.user_book_id], ["title", titleOf(book)], ["author", book.author], ["category", book.category],
    ["source", book.source], ["url", book.source_url || book.unique_url],
    ...names(book.book_tags).map((name): Entry => ["book-tags", name]),
  ];
}

/** The book block's own properties: its identity, with its tags as `tags`, and what only a book has. */
function bookEntries(book: Book): Entry[] {
  return [
    ...bookIdentity(book).filter(([key]) => key !== "book-tags"),
    ...names(book.book_tags).map((name): Entry => ["tags", name]),
    ["readwise.url", book.readwise_url], ["readwise.unique-url", book.unique_url !== book.source_url ? book.unique_url : null],
    ["readwise.cover", book.cover_image_url], ["readwise.asin", book.asin], ["readwise.external-id", book.external_id],
    ["readwise.title", book.readable_title && book.readable_title !== book.title ? book.title : null],
    ["readwise.summary", shortSummary(book.summary)],
  ];
}

/** A highlight's own properties, then its book's identity. */
function highlightEntries(highlight: Highlight, book: Book): Entry[] {
  return [
    ["readwise.highlight", highlight.id], ["readwise.color", highlight.color],
    ["highlighted", day(highlight.highlighted_at)], ["highlighted-year", day(highlight.highlighted_at)?.slice(0, 4)], ["highlighted-month", day(highlight.highlighted_at)?.slice(0, 7)],
    ["readwise.created", day(highlight.created_at)], ["readwise.updated", day(highlight.updated_at)],
    ["favorite", highlight.is_favorite ? "true" : null], ["readwise.discard", highlight.is_discard ? "true" : null],
    ["readwise.has-note", (highlight.note ?? "").trim() ? "true" : null],
    ["readwise.location", highlight.location], ["readwise.location-type", highlight.location_type], ["readwise.end-location", highlight.end_location],
    ["readwise.url", highlight.readwise_url], ["readwise.external-id", highlight.external_id], ["readwise.source-url", highlight.url],
    // A Reader document's book is known by the document's id (the export's `external_id`): the highlight says which.
    ["reader.doc", book.source === "reader" ? book.external_id : null],
    ...names(highlight.tags).map((name): Entry => ["tags", name]),
    ...bookIdentity(book),
  ];
}

/** Entries as `[key::value]` tokens (a repeated key a token each); empty values are left out. */
const tokensOf = (entries: Entry[]) => tokens(entries.map(([key, v]) => token(key, v)));

/** Entries as an annotation's properties: a key to its values, in order. */
function propertiesOf(entries: Entry[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, v] of entries) {
    const text = v === null || v === undefined ? "" : value(String(v));
    if (text) (out[key] ??= []).push(text);
  }
  return out;
}

// ── pull ─────────────────────────────────────────────────────────────────

interface Tally { notes: number; board: number; created: number; updated: number; unanchored: number }

/** Highlights on a document `send` made: annotations on that note at their passage. False when the note is gone. */
async function ontoNote(target: { outline: string; id: string }, book: Book, highlights: Highlight[], tally: Tally): Promise<boolean> {
  let root: Block;
  try {
    root = await outline<Block>({ action: "get", blockId: target.id }, target.outline);
  } catch {
    return false;
  }
  if (!root) return false;
  const blocks = await subtree(root, target.outline);
  const known = new Map<string, Thread>();
  for (const block of blocks) {
    const threads = await outline<Thread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: block.id }, includeResolved: true } }, target.outline);
    for (const thread of threads) for (const id of thread.properties?.["readwise.highlight"] ?? []) known.set(id, thread);
  }
  for (const highlight of highlights) {
    const id = String(highlight.id);
    const note = (highlight.note ?? "").trim();
    const had = known.get(id);
    tally.notes++;
    if (had) {
      // Kept in step: the note on it (an unanchored one keeps its quote) and the properties Readwise owns (its fields and
      // the book's identity). A property someone added is left alone.
      const wanted = had.properties?.["readwise.anchored"]?.includes("no") ? unanchoredBody(highlight) : inert(note);
      const desired = annotationProperties(highlight, book);
      const bodyChanged = had.body.trim() !== wanted.trim();
      const propsChanged = MANAGED.some((key) => (had.properties?.[key] ?? []).join("\n") !== (desired[key] ?? []).join("\n"));
      if (bodyChanged || propsChanged) {
        const current = await outline<Block>({ action: "get", blockId: had.block.id }, target.outline);
        let text = current.text;
        if (bodyChanged) {
          const at = had.body ? text.lastIndexOf(had.body) : -1;
          text = at >= 0 ? text.slice(0, at) + wanted + text.slice(at + had.body.length) : `${text.trimEnd()}\n${wanted}`;
        }
        if (propsChanged) text = withAnnotationProps(text, desired);
        await update(current, text, target.outline);
        tally.updated++;
      }
      continue;
    }
    const quote = highlight.text.trim();
    const properties = annotationProperties(highlight, book);
    const block = blocks.find((candidate) => candidate.text.includes(quote));
    const comment = (on: Block, body: string, passage?: { quote: string; near: number }, extra: Record<string, string> = {}) =>
      outline({ action: "annotations.batch", requestId: `readwise-${id}-${on.id}-${on.revision}${passage ? "" : "-whole"}`, operations: [{
        operationId: id, type: "block-comment",
        input: { blockId: on.id, expectedRevision: on.revision, body, source: "agent", properties: { ...properties, ...extra }, ...(passage ? { passage } : {}) },
      }] }, target.outline);
    try {
      if (!block || !quote) throw new Error("not in the note");
      await comment(block, inert(note), { quote, near: block.text.indexOf(quote) });
    } catch {
      // The words aren't in the note as written now (edited since it was sent, or across a property): the whole note,
      // with the quote in the body, so nothing is lost.
      const fresh = await outline<Block>({ action: "get", blockId: root.id }, target.outline);
      await comment(fresh, unanchoredBody(highlight), undefined, { "readwise.anchored": "no" });
      tally.unanchored++;
    }
    tally.created++;
  }
  return true;
}

/** An annotation's properties: its kind and tone, then everything a board highlight carries (the book's identity too). */
const annotationProperties = (highlight: Highlight, book: Book): Record<string, string[]> => ({
  kind: ["highlight"], ...(highlight.color && TONES[highlight.color] ? { color: [TONES[highlight.color]!] } : {}), ...propertiesOf(highlightEntries(highlight, book)),
});

/** The properties a pull keeps in step on an annotation (`kind`, `readwise.anchored` and any a person adds are left alone). */
const MANAGED = [
  "readwise.highlight", "readwise.color", "color", "highlighted", "highlighted-year", "highlighted-month", "readwise.created", "readwise.updated",
  "favorite", "readwise.discard", "readwise.has-note", "readwise.location", "readwise.location-type", "readwise.end-location", "readwise.url",
  "readwise.external-id", "readwise.source-url", "reader.doc", "tags", "readwise.book", "title", "author", "category", "source", "url", "book-tags",
];

/** An annotation block's text with its managed properties (on the line holding `[type::annotation]`) replaced. */
function withAnnotationProps(text: string, desired: Record<string, string[]>): string {
  const lines = text.split("\n");
  const at = lines.findIndex((line, index) => index > 0 && line.includes("[type::annotation]"));
  if (at < 0) return text;
  const keep = lines[at]!.replace(/\s?\[([A-Za-z][\w.-]*)::[^\]\n]*\]/g, (all, key: string) => (MANAGED.includes(key) ? "" : all));
  lines[at] = `${keep} ${tokens(MANAGED.flatMap((key) => (desired[key] ?? []).map((v) => token(key, v))))}`.trimEnd();
  return lines.join("\n");
}

const unanchoredBody = (highlight: Highlight) => {
  const quote = highlight.text.trim().split("\n").map((line) => `> ${inert(line)}`.trimEnd()).join("\n");
  const note = (highlight.note ?? "").trim();
  return note ? `${quote}\n\n${inert(note)}` : quote;
};

function bookText(book: Book, gone?: string): string {
  const title = titleOf(book);
  const header = (book.author ? `${title} — ${value(book.author)}` : title).replace(/\((?=\()/g, "(\\");
  const props = tokensOf(bookEntries(book));
  const note = (book.document_note ?? "").trim();
  return [header, props, ...(gone ? ["", gone] : []), ...(note ? ["", inert(note)] : [])].join("\n");
}

function highlightText(highlight: Highlight, book: Book): string {
  const props = tokensOf(highlightEntries(highlight, book));
  const quote = highlight.text.trim().split("\n").map((line) => `> ${inert(line)}`.trimEnd()).join("\n");
  const note = (highlight.note ?? "").trim();
  return [short(highlight.text.replace(/[[\]]/g, "")) || "(empty highlight)", props, "", quote, ...(note ? ["", inert(note)] : [])].join("\n");
}

/** A book and its highlights on the board: a block per book under the page, a block per highlight under it. */
async function ontoBoard(page: Block, book: Book, highlights: Highlight[], tally: Tally, gone?: string): Promise<void> {
  const found = await outline<{ blocks: Block[] }>({ action: "blocks.query", query: {
    where: `readwise.book=${book.user_book_id} AND NOT readwise.highlight`, subtreeRootId: page.id, limit: 1 } }, BOARD);
  const text = bookText(book, gone);
  let home = found.blocks[0];
  if (home) {
    const current = await outline<Block>({ action: "get", blockId: home.id }, BOARD);
    await update(current, text, BOARD);
  } else {
    home = await outline<Block>({ action: "create", parentId: page.id, text }, BOARD);
  }
  if (book.source === "reader" && book.external_id) await linkDocument(book.external_id, home.id);
  const children = await outline<Block[]>({ action: "children", parentId: home.id }, BOARD);
  // A thread (a tweets book of more than one highlight, now or already on the board) reads as a thread.
  const thread = book.category === "tweets" && (highlights.length > 1 || children.some((child) => headerPropsAnywhere(child.text)["readwise.highlight"]));
  if (thread) return ontoThread(home, children, book, highlights, tally);
  const byId = new Map(children.map((child) => [headerPropsAnywhere(child.text)["readwise.highlight"], child] as const));
  for (const highlight of highlights) {
    tally.board++;
    const wanted = highlightText(highlight, book);
    const had = byId.get(String(highlight.id));
    if (!had) {
      await outline({ action: "create", parentId: home.id, text: wanted }, BOARD);
      tally.created++;
    } else if (had.text !== wanted) {
      await update(had, wanted, BOARD);
      tally.updated++;
    }
  }
}

/**
 * A tweet thread. Readwise saves one as one book of category `tweets` whose highlights are the tweets (the assumption;
 * `location` with `location_type=order` is their place in it). They are put in order (by `location` when every tweet
 * has an order, else by `highlighted_at`); the first is the thread's block under the book and the rest are its
 * children, one level, in order. One level, not each under the one before: a long thread stays two deep, a tweet that
 * arrives late never re-parents the ones after it, and "Thread, compiled" gives the straight read. That block holds an
 * embed of each tweet in order (no copy of the text), found by `readwise.compiled` and left alone when it already reads so.
 */
async function ontoThread(home: Block, children: Block[], book: Book, highlights: Highlight[], tally: Tally): Promise<void> {
  interface Tweet { id: string; at: string; order: number | null; highlight?: Highlight; block?: Block }
  const tweets = new Map<string, Tweet>();
  const seen = async (block: Block) => {
    const found = headerPropsAnywhere(block.text);
    const id = found["readwise.highlight"];
    if (id) tweets.set(id, { id, at: found.highlighted ?? "", order: found["readwise.location-type"] === "order" && found["readwise.location"] ? Number(found["readwise.location"]) : null, block });
  };
  for (const child of children) {
    await seen(child);
    if (headerPropsAnywhere(child.text)["readwise.highlight"]) for (const under of await outline<Block[]>({ action: "children", parentId: child.id }, BOARD)) await seen(under);
  }
  for (const highlight of highlights) {
    const id = String(highlight.id);
    tweets.set(id, { id, at: highlight.highlighted_at ?? "", order: highlight.location_type === "order" && typeof highlight.location === "number" ? highlight.location : null,
      highlight, block: tweets.get(id)?.block });
  }
  const all = [...tweets.values()];
  const byOrder = all.every((tweet) => tweet.order !== null);
  all.sort((x, y) => (byOrder ? x.order! - y.order! : 0) || x.at.localeCompare(y.at) || Number(x.id) - Number(y.id));
  let head: Block | undefined;
  const placed: Block[] = [];
  for (const tweet of all) {
    const parentId = head ? head.id : home.id;
    const highlight = tweet.highlight;
    let block = tweet.block;
    if (highlight) {
      tally.board++;
      const wanted = highlightText(highlight, book);
      if (!block) {
        block = await outline<Block>({ action: "create", parentId, text: wanted }, BOARD);
        tally.created++;
      } else if (block.text !== wanted) {
        await update(block, wanted, BOARD);
        tally.updated++;
      }
    }
    if (block && block.parentId !== parentId) {
      // A tweet placed under the wrong one (an earlier tweet arrived late): move it when the service lets an extension.
      await outline({ action: "move", blockId: block.id, parentId }, BOARD).catch(() => {});
    }
    if (block) { placed.push(block); head ??= block; }
  }
  const text = [`Thread, compiled [readwise.compiled::${book.user_book_id}]`, ...placed.map((tweet) => `\n!((${tweet.id}))`)].join("\n");
  const compiled = children.find((child) => headerPropsAnywhere(child.text)["readwise.compiled"] === String(book.user_book_id));
  if (!compiled) await outline({ action: "create", parentId: home.id, text }, BOARD);
  else await update(compiled, text, BOARD);
}

/** Properties on a block's first two lines (a record's are on its second). */
function headerPropsAnywhere(text: string): Record<string, string> {
  const [first = "", second = ""] = text.split("\n");
  return { ...headerProps(second), ...headerProps(first) };
}

/** A page of the board by address, or null when there is none yet. */
async function findPage(address: string): Promise<Block | null> {
  let resolved: { status: string; block?: Block };
  try {
    resolved = await outline<{ status: string; block?: Block }>({ action: "pages.resolve", address }, BOARD);
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    throw new Error(/No outline named/.test(said) ? `there's no ${BOARD} outline yet: run \`ep0ch init ${BOARD}\` (or set config.board)` : said);
  }
  return resolved.status === "resolved" && resolved.block ? outline<Block>({ action: "get", blockId: resolved.block.id }, BOARD) : null;
}

async function boardPage(): Promise<Block> {
  return (await findPage(PAGE))
    ?? outline<Block>({ action: "create", text: `Readwise [page::${PAGE}]\n\nHighlights from Readwise and Reader, a block per book. The readwise extension keeps them here.` }, BOARD);
}

async function pull(): Promise<void> {
  // One pull at a time across the host: the schedule says once: "host" (it runs in one outline), and the service runs
  // a host-wide action one at a time whichever outline asks. The cursor lives on the board page, as properties.
  let page = await boardPage();
  const props = headerProps(page.text);
  const synced = props["readwise.synced"];
  const save = async (changes: Record<string, string | null>) => {
    page = await outline<Block>({ action: "get", blockId: page.id }, BOARD);
    await update(page, withHeaderProps(page.text, changes), BOARD);
  };

  const sweep = props["readwise.sweep"] ?? new Date(STARTED).toISOString();
  let cursor: string | null = props["readwise.next-page"] ?? null;
  const tally: Tally = { notes: 0, board: 0, created: 0, updated: 0, unanchored: 0 };
  let complete = false;
  try {
    for (;;) {
      const query = new URLSearchParams();
      if (synced) query.set("updatedAfter", synced);
      if (cursor) query.set("pageCursor", cursor);
      const { body } = await readwise<{ results: Book[]; nextPageCursor?: string | null }>(`/api/v2/export/?${query}`);
      let finished = true;
      for (const book of body.results ?? []) {
        // Out of time mid-page: this page again next run (what's done is unchanged then, so it goes quickly).
        if (Date.now() > UNTIL - 30_000) { finished = false; break; }
        const highlights = (book.highlights ?? []).filter((highlight) => !highlight.is_deleted && highlight.text?.trim());
        if (!highlights.length) continue;
        const target = noteOf(book.source_url) ?? noteOf(book.unique_url);
        const mine = target && target.machine === MACHINE;
        if (mine && await ontoNote(target, book, highlights, tally)) continue;
        await ontoBoard(page, book, highlights, tally, mine ? `Sent from ${uriOf(target.outline, target.id)}, a note that isn't there now.` : undefined);
      }
      if (!finished) break;
      cursor = body.nextPageCursor ?? null;
      if (!cursor) { complete = true; break; }
      if (Date.now() > UNTIL - 30_000) break;
      await save({ "readwise.sweep": sweep, "readwise.next-page": cursor });
    }
  } catch (error) {
    // Keep where it got to, and let the next run take the board.
    if (cursor) await save({ "readwise.sweep": sweep, "readwise.next-page": cursor }).catch(() => {});
    throw error;
  }
  await save(complete
    ? { "readwise.synced": sweep, "readwise.sweep": null, "readwise.next-page": null }
    : { "readwise.sweep": sweep, "readwise.next-page": cursor });
  const what = tally.created + tally.updated === 0
    ? `nothing new in ${tally.notes + tally.board} highlight${tally.notes + tally.board === 1 ? "" : "s"}`
    : `${tally.created} new, ${tally.updated} changed (${tally.notes} on notes, ${tally.board} on the ${BOARD} board${tally.unanchored ? `, ${tally.unanchored} on a whole note: their words aren't in it now` : ""})`;
  answer({ message: `pulled: ${what}${complete ? "" : "; more next time"}` });
}

// ── library ──────────────────────────────────────────────────────────────
//
// Reader's documents, a block per document under the Reader page. Properties (empty ones left out): `title`, `author`,
// `url` (the source), `category`, `location` (new, later, shortlist, archive, feed), `tags`, `reading-progress` (0-100),
// `saved` and `published` (days), `words`, `site`, and Reader's own `reader.id`, `reader.url`, `reader.deleted`. The
// body is the summary, then your note on the document. A line `Highlights: ((book))` links to the book block of its
// highlights on the board (found by the book's `readwise.external-id`, which is the document's id), so the block
// reads as the document with its highlights; the pull puts the same line there when the book arrives after the document.

const HIGHLIGHTS_LINE = /^Highlights: \(\(/;
const isDeleted = (doc: ReaderDoc) => Boolean(doc.deleted || doc.is_deleted || doc.deleted_at);
const tagNames = (tags: ReaderDoc["tags"]) =>
  (Array.isArray(tags) ? tags.map((tag) => tag.name) : Object.entries(tags ?? {}).map(([key, tag]) => tag?.name ?? key)).map((name) => value(name ?? "")).filter(Boolean);

function documentText(doc: ReaderDoc, book?: string, seen?: string | null): string {
  const progress = typeof doc.reading_progress === "number" ? Math.round(Math.min(1, Math.max(0, doc.reading_progress)) * 100) : null;
  const entries: Entry[] = [
    ["reader.id", doc.id], ["title", value(doc.title || "")], ["author", doc.author], ["url", doc.source_url], ["category", doc.category], ["location", doc.location],
    ...tagNames(doc.tags).map((name): Entry => ["tags", name]),
    ["reading-progress", progress], ["saved", day(doc.saved_at ?? doc.created_at)], ["published", day(doc.published_date)], ["words", doc.word_count],
    ["site", doc.site_name], ["reader.url", doc.url], ["reader.deleted", isDeleted(doc) ? "true" : null],
    // The full pass that last listed it: how a later full pass tells what Reader no longer has.
    ["reader.seen", seen],
  ];
  const header = value(doc.title || "(untitled)").replace(/\((?=\()/g, "(\\");
  const body = [(doc.summary ?? "").trim(), (doc.notes ?? "").trim()].filter(Boolean).map(inert).join("\n\n");
  return [header, tokensOf(entries), ...(book ? [highlightsLine(book)] : []), ...(body ? ["", body] : [])].join("\n");
}
const highlightsLine = (book: string) => `Highlights: ((${book}|its highlights))`;

/** A document block's text with its highlights line set to this book (or taken out). */
function withHighlightsLine(text: string, book: string | null): string {
  const lines = text.split("\n").filter((line, index) => index < 2 || !HIGHLIGHTS_LINE.test(line));
  if (book) lines.splice(2, 0, highlightsLine(book));
  return lines.join("\n");
}

async function readerPage(): Promise<Block> {
  return (await findPage(READER_PAGE))
    ?? outline<Block>({ action: "create", text: `Reader [page::${READER_PAGE}]\n\nThe Reader library, a block per document. The readwise extension keeps them here.` }, BOARD);
}

/** A document's block on the Reader page, by Reader's id. */
async function documentBlock(page: Block, id: string): Promise<Block | undefined> {
  const found = await outline<{ blocks: Block[] }>({ action: "blocks.query", query: { where: `reader.id="${id.replace(/"/g, "")}"`, subtreeRootId: page.id, limit: 1 } }, BOARD);
  return found.blocks[0];
}

/** The block of the book whose highlights belong to a Reader document, on the readwise board. */
async function bookOf(id: string): Promise<Block | undefined> {
  const page = await findPage(PAGE);
  if (!page) return undefined;
  const found = await outline<{ blocks: Block[] }>({ action: "blocks.query", query: {
    where: `readwise.external-id="${id.replace(/"/g, "")}" AND readwise.book AND NOT readwise.highlight`, subtreeRootId: page.id, limit: 1 } }, BOARD);
  return found.blocks[0];
}

/** The pull found a Reader document's book: the document's block, if it is there, links to it. */
async function linkDocument(id: string, bookId: string): Promise<void> {
  const page = await findPage(READER_PAGE);
  const block = page && await documentBlock(page, id);
  if (!block) return;
  const current = await outline<Block>({ action: "get", blockId: block.id }, BOARD);
  await update(current, withHighlightsLine(current.text, bookId), BOARD);
}

interface Counts { seen: number; created: number; updated: number; skipped: number; deleted: number }

/** Whether Reader still has a document: one the full pass never listed may be out of the locations mirrored (a feed item, say), not gone. */
async function stillThere(id: string): Promise<boolean> {
  const { body } = await readwise<{ results?: ReaderDoc[] }>(`/api/v3/list/?${new URLSearchParams({ id })}`);
  return (body.results ?? []).length > 0;
}

async function library(): Promise<void> {
  let page = await readerPage();
  const props = headerProps(page.text);
  const synced = props["reader.synced"];
  const save = async (changes: Record<string, string | null>) => {
    page = await outline<Block>({ action: "get", blockId: page.id }, BOARD);
    await update(page, withHeaderProps(page.text, changes), BOARD);
  };
  const sweep = props["reader.sweep"] ?? new Date(STARTED).toISOString();
  // A pass with no `reader.synced` lists everything (the backfill, or one asked for by clearing it): the only one that can say a document is gone.
  const full = !synced;
  const locations = config.locations?.length ? config.locations : DEFAULT_LOCATIONS;
  const resumed = locations.indexOf(props["reader.location"] ?? "");
  let at = Math.max(0, resumed);
  let cursor: string | null = resumed >= 0 ? props["reader.next-page"] ?? null : null;
  const counts: Counts = { seen: 0, created: 0, updated: 0, skipped: 0, deleted: 0 };
  const where = () => ({ "reader.sweep": sweep, "reader.location": locations[at]!, "reader.next-page": cursor });
  let complete = false;
  try {
    pass: for (; at < locations.length; at++) {
      for (;;) {
        const query = new URLSearchParams({ limit: "100", location: locations[at]! });
        if (synced) query.set("updatedAfter", synced);
        if (cursor) query.set("pageCursor", cursor);
        const { body } = await readwise<{ results: ReaderDoc[]; nextPageCursor?: string | null }>(`/api/v3/list/?${query}`);
        for (const doc of body.results ?? []) {
          if (Date.now() > UNTIL - 30_000) break pass;
          // A highlight or a note is a document with a parent: the export brings those.
          if (doc.parent_id || doc.category === "highlight" || doc.category === "note" || !doc.id) { counts.skipped++; continue; }
          counts.seen++;
          const have = await documentBlock(page, doc.id);
          const book = await bookOf(doc.id);
          // `reader.seen` is the full pass that last listed it; an incremental run keeps what is there.
          const text = documentText(doc, book?.id, full ? sweep : have ? headerPropsAnywhere(have.text)["reader.seen"] : null);
          if (!have) {
            await outline({ action: "create", parentId: page.id, text }, BOARD);
            counts.created++;
          } else if (have.text !== text) {
            await update(have, text, BOARD);
            counts.updated++;
          }
        }
        cursor = body.nextPageCursor ?? null;
        if (!cursor) break;
        if (Date.now() > UNTIL - 30_000) { await save(where()); break pass; }
        await save(where());
      }
      if (at + 1 < locations.length) await save({ "reader.sweep": sweep, "reader.location": locations[at + 1]!, "reader.next-page": null });
    }
    complete = at >= locations.length;
  } catch (error) {
    await save(where()).catch(() => {});
    throw error;
  }
  if (!complete) {
    await save(where());
  } else {
    // Only a finished full pass can say what is gone: a block it never listed, which Reader no longer has either.
    if (full && counts.seen > 0) {
      // In batches (a query answers at most 1000): each one handled is marked deleted, or stamped as there, so it leaves the next batch.
      for (;;) {
        const unlisted = await outline<{ blocks: Block[] }>({ action: "blocks.query", query: {
          where: `reader.id AND NOT reader.deleted AND NOT reader.seen="${sweep}"`, subtreeRootId: page.id, limit: 1000 } }, BOARD);
        if (!unlisted.blocks.length) break;
        for (const block of unlisted.blocks) {
          const id = headerPropsAnywhere(block.text)["reader.id"];
          const gone = !id || !(await stillThere(id));
          await update(block, withHeaderProps(block.text, gone ? { "reader.deleted": "true" } : { "reader.seen": sweep }, 1), BOARD);
          if (gone) counts.deleted++;
        }
      }
    }
    await save({ "reader.synced": sweep, "reader.sweep": null, "reader.location": null, "reader.next-page": null });
  }
  const what = counts.created + counts.updated + counts.deleted === 0
    ? `nothing new in ${counts.seen} document${counts.seen === 1 ? "" : "s"}`
    : `${counts.created} new, ${counts.updated} changed${counts.deleted ? `, ${counts.deleted} gone from Reader` : ""} (of ${counts.seen} documents)`;
  answer({ message: `library: ${what}${counts.skipped ? `, ${counts.skipped} highlights and notes skipped` : ""}${complete ? "" : "; more next time"}` });
}

// ── main ─────────────────────────────────────────────────────────────────

try {
  MACHINE ||= (await outline<Address>({ action: "notes.address" })).machine;
  if (request.operation !== "act") refuse("invalid-config");
  else if (request.input.action === "send") {
    if (!request.input.target?.blockId) answer({ message: "send acts on a note: pick one first" });
    else await send(request.input.target.blockId);
  } else if (request.input.action === "pull") await pull();
  else if (request.input.action === "library") await library();
  else refuse("invalid-config");
} catch (error) {
  if (error instanceof Stop) refuse(error.code);
  else answer({ message: `readwise: ${error instanceof Error ? error.message : String(error)}` });
}
