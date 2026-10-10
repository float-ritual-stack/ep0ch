// Readwise (PIE-743): a Readwise and Reader client built only on what any extension has.
//
// - `send` (on a block): the note, and the notes under it, rendered as its published page reads (`notes.render`) and
//   saved to Reader as one document. Its URL in Reader is the note's link (its published permalink, or config `link`),
//   so a highlight made on it in Reader comes back knowing which note it belongs to.
// - `pull` (on the outline, every hour): Readwise's export of every highlight changed since the last pull (Reader's
//   highlights reach it too). A highlight on a document `send` made becomes an annotation on that note, at the
//   passage (`kind=highlight`, your note on it as the body); every other one lands on the readwise board, a block per
//   book with a block per highlight under it. Each highlight is known by its Readwise id, so a pull run twice writes
//   nothing new, and a changed note on a highlight updates what's there. Its schedule says `once: "host"`, so the
//   hourly pull runs in one outline of the host, not in each.
//
// It writes over its own connection (outline.ts), as ext:readwise. The token comes from the `with-secrets` group
// `readwise` (key READWISE_TOKEN) on stdin, and is never written anywhere.
import { outline } from "./outline";

interface Block { id: string; text: string; revision: number }
interface Config { board?: string; page?: string; link?: string; machine?: string; tags?: string[]; api?: string; minutes?: number }
interface Request {
  operation: string;
  input: { action: string; target?: { blockId: string }; context: { now: string }; scheduled?: { at: string } };
  config?: Config;
  credentials?: { token?: string };
}
interface Tag { name: string }
interface Highlight {
  id: number; text: string; note?: string | null; color?: string | null; tags?: Tag[]; highlighted_at?: string | null;
  updated_at?: string | null; is_deleted?: boolean; readwise_url?: string | null; location?: number | null;
}
interface Book {
  user_book_id: number; title: string; readable_title?: string; author?: string | null; category?: string | null;
  source?: string | null; source_url?: string | null; unique_url?: string | null; readwise_url?: string | null;
  document_note?: string | null; book_tags?: Tag[]; highlights: Highlight[];
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

/**
 * A note's URL in Reader: config `link` when it's set; else, when the note is published, its permalink (the page by
 * its id) with `?ep0ch=<outline>` so a pull knows the outline; else the fallback template. Reader needs a unique web
 * URL per document, and the pull reads the note back out of it.
 */
async function linkOf(name: string, id: string): Promise<string> {
  if (config.link) return fromTemplate(config.link, name, id);
  const address = await outline<Address>({ action: "notes.address", blockId: id }, name);
  const permalink = address.published?.permalink;
  return permalink ? `${permalink}?ep0ch=${encodeURIComponent(name)}` : fromTemplate(FALLBACK_LINK, name, id);
}

/** The note a document's URL names: an ep0ch:// URI, a published permalink with `?ep0ch=`, or the `link` template's shape. */
function noteOf(url: string | null | undefined): { outline: string; machine: string; id: string } | null {
  if (!url) return null;
  const canonical = /^ep0ch:\/\/([^/@]+)@([^/]+)\/b\/([0-9a-f-]{36})$/i.exec(url);
  if (canonical) return { outline: canonical[1]!, machine: canonical[2]!, id: canonical[3]!.toLowerCase() };
  const permalink = /\/p\/([0-9a-f-]{36})\?ep0ch=([^&#/]+)$/i.exec(url);
  if (permalink) return { outline: decodeURIComponent(permalink[2]!), machine: MACHINE, id: permalink[1]!.toLowerCase() };
  const order: string[] = [];
  const pattern = LINK.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{(outline|machine|id)\}/g, (_, name: string) => {
    order.push(name);
    return name === "id" ? "([0-9a-fA-F-]{36})" : "([^/@?#]+)";
  });
  const match = new RegExp(`^${pattern}$`).exec(url);
  if (!match) return null;
  const found: Record<string, string> = { machine: MACHINE };
  order.forEach((name, index) => { found[name] = decodeURIComponent(match[index + 1]!); });
  return found.outline && found.id ? { outline: found.outline, machine: found.machine!, id: found.id.toLowerCase() } : null;
}

// ── Blockdown ────────────────────────────────────────────────────────────

const TONES: Record<string, string> = { yellow: "warn", orange: "warn", blue: "accent", purple: "accent", pink: "bad", green: "good" };

/**
 * Imported words stay words: a `[key::value]`, `[[page]]` or `((ref))` in a highlight is escaped, never a property or a
 * link. A `[key::value]` takes outline-core's escape (`\\[`); a link has none yet, so every `[` or `(` before another
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
function withHeaderProps(text: string, changes: Record<string, string | null>): string {
  const [first, ...rest] = text.split("\n");
  let line = first!;
  for (const [key, next] of Object.entries(changes)) {
    const pattern = new RegExp(`\\s?\\[${key.replace(/[.]/g, "\\.")}::[^\\]\\n]*\\]`, "g");
    line = line.replace(pattern, "");
    if (next !== null) line = `${line} ${token(key, next)}`;
  }
  return [line, ...rest].join("\n");
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
  const saved = await readwise<{ id?: string; url?: string }>("/api/v3/save/", { method: "POST", body: {
    url: await linkOf(HERE, rendered.blockId), html: body, title: rendered.title, tags: config.tags ?? ["ep0ch"], should_clean_html: false, saved_using: "ep0ch",
  } });
  const where = saved.body.url ? `: ${saved.body.url}` : "";
  answer({ message: saved.status === 200
    ? `already in Reader${where} (Reader keeps the first copy; delete it there to send again)`
    : `saved "${short(rendered.title)}" to Reader${where}` });
}

// ── pull ─────────────────────────────────────────────────────────────────

interface Tally { notes: number; board: number; created: number; updated: number; unanchored: number }

/** Highlights on a document `send` made: annotations on that note at their passage. False when the note is gone. */
async function ontoNote(target: { outline: string; id: string }, highlights: Highlight[], tally: Tally): Promise<boolean> {
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
      // Only the note on it is kept in step (an unanchored one keeps its quote); its colour and tags are as first pulled.
      const wanted = had.properties?.["readwise.anchored"]?.includes("no") ? unanchoredBody(highlight) : inert(note);
      if (had.body.trim() !== wanted.trim()) {
        const current = await outline<Block>({ action: "get", blockId: had.block.id }, target.outline);
        const at = had.body ? current.text.lastIndexOf(had.body) : -1;
        const text = at >= 0 ? current.text.slice(0, at) + wanted + current.text.slice(at + had.body.length) : `${current.text.trimEnd()}\n${wanted}`;
        await update(current, text, target.outline);
        tally.updated++;
      }
      continue;
    }
    const quote = highlight.text.trim();
    const properties: Record<string, string | string[]> = { kind: "highlight", "readwise.highlight": id };
    if (highlight.color && TONES[highlight.color]) properties.color = TONES[highlight.color]!;
    const tags = (highlight.tags ?? []).map((tag) => value(tag.name)).filter(Boolean);
    if (tags.length) properties.tags = tags;
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

const unanchoredBody = (highlight: Highlight) => {
  const quote = highlight.text.trim().split("\n").map((line) => `> ${inert(line)}`.trimEnd()).join("\n");
  const note = (highlight.note ?? "").trim();
  return note ? `${quote}\n\n${inert(note)}` : quote;
};

function bookText(book: Book, gone?: string): string {
  const title = value(book.readable_title || book.title || "(untitled)");
  const header = (book.author ? `${title} — ${value(book.author)}` : title).replace(/\((?=\()/g, "(\\");
  const props = tokens([
    token("readwise.book", book.user_book_id), token("readwise.category", book.category), token("readwise.source", book.source),
    token("readwise.author", book.author), token("readwise.url", book.source_url || book.unique_url),
    ...(book.book_tags ?? []).map((tag) => token("tags", tag.name)),
  ]);
  const note = (book.document_note ?? "").trim();
  return [header, props, ...(gone ? ["", gone] : []), ...(note ? ["", inert(note)] : [])].join("\n");
}

function highlightText(highlight: Highlight): string {
  const props = tokens([
    token("readwise.highlight", highlight.id), token("readwise.color", highlight.color),
    token("highlighted", highlight.highlighted_at?.slice(0, 10)), token("readwise.url", highlight.readwise_url),
    ...(highlight.tags ?? []).map((tag) => token("tags", tag.name)),
  ]);
  const quote = highlight.text.trim().split("\n").map((line) => `> ${inert(line)}`.trimEnd()).join("\n");
  const note = (highlight.note ?? "").trim();
  return [short(highlight.text.replace(/[[\]]/g, "")) || "(empty highlight)", props, "", quote, ...(note ? ["", inert(note)] : [])].join("\n");
}

/** A book and its highlights on the board: a block per book under the page, a block per highlight under it. */
async function ontoBoard(page: Block, book: Book, highlights: Highlight[], tally: Tally, gone?: string): Promise<void> {
  const found = await outline<{ blocks: Block[] }>({ action: "blocks.query", query: {
    where: `readwise.book=${book.user_book_id}`, subtreeRootId: page.id, limit: 1 } }, BOARD);
  const text = bookText(book, gone);
  let home = found.blocks[0];
  if (home) {
    const current = await outline<Block>({ action: "get", blockId: home.id }, BOARD);
    await update(current, text, BOARD);
  } else {
    home = await outline<Block>({ action: "create", parentId: page.id, text }, BOARD);
  }
  const children = await outline<Block[]>({ action: "children", parentId: home.id }, BOARD);
  const byId = new Map(children.map((child) => [headerPropsAnywhere(child.text)["readwise.highlight"], child] as const));
  for (const highlight of highlights) {
    tally.board++;
    const wanted = highlightText(highlight);
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

/** Properties on a block's first two lines (a record's are on its second). */
function headerPropsAnywhere(text: string): Record<string, string> {
  const [first = "", second = ""] = text.split("\n");
  return { ...headerProps(second), ...headerProps(first) };
}

async function boardPage(): Promise<Block> {
  let resolved: { status: string; block?: Block };
  try {
    resolved = await outline<{ status: string; block?: Block }>({ action: "pages.resolve", address: PAGE }, BOARD);
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    throw new Error(/No outline named/.test(said) ? `there's no ${BOARD} outline yet: run \`ep0ch init ${BOARD}\` (or set config.board)` : said);
  }
  if (resolved.status === "resolved" && resolved.block) return outline<Block>({ action: "get", blockId: resolved.block.id }, BOARD);
  return outline<Block>({ action: "create", text: `Readwise [page::${PAGE}]\n\nHighlights from Readwise and Reader, a block per book. The readwise extension keeps them here.` }, BOARD);
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
        if (mine && await ontoNote(target, highlights, tally)) continue;
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

// ── main ─────────────────────────────────────────────────────────────────

try {
  MACHINE ||= (await outline<Address>({ action: "notes.address" })).machine;
  if (request.operation !== "act") refuse("invalid-config");
  else if (request.input.action === "send") {
    if (!request.input.target?.blockId) answer({ message: "send acts on a note: pick one first" });
    else await send(request.input.target.blockId);
  } else if (request.input.action === "pull") await pull();
  else refuse("invalid-config");
} catch (error) {
  if (error instanceof Stop) refuse(error.code);
  else answer({ message: `readwise: ${error instanceof Error ? error.message : String(error)}` });
}
