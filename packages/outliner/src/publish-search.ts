// The web client's search box and its comment completion (PIE-789): the door's power bar and its completer, as web
// pages ask them. Nothing here matches or ranks: a search is the service's `tree.search` (the one search the power bar,
// Goto and the completer ask, from the page's note, so nearer notes come first), and completion is the outliner's own
// completion rules (src/completion.ts: which `[[`, `((` or `#tag` the cursor is in, and what choosing writes) over
// the service's lookups (`pages.complete`, `tree.search`, `properties.catalog`), so a comment written on the web holds
// exactly the Blockdown the door writes.
//
// The search box is a plain GET form on every tailnet page and every share page (`<base>/search?q=…`, a page of its
// own that works with no script). The small script beside it (publish-search.js) adds the keyboard shortcut (`/` or
// ctrl+k), results as you type, and on a phone a sheet over the page. Inside a share the search is the share's: only
// notes inside it, and no crumbs above a shared note.
import { readFileSync } from "node:fs";
import { pageAddressReferences, pageAddressText } from "@ep0ch/outline-core/link-syntax";
import { searchTextTerms } from "@ep0ch/outline-core/search-match";
import { HASHTAG_VALUE_PATTERN, isHexColour } from "@ep0ch/outline-core/property-grammar";
import { tagMatches } from "@ep0ch/outline-core/query-atoms";
import { referenceTargetAtCursor, hashtagAtCursor, pageAddressCompletion, pageCompletionLookupQuery } from "@ep0ch/outline-core/completion-triggers";
import { stripFragmentAnchors } from "./fragments";
import { parsePropertyRecords, stripPropertyTokens } from "@ep0ch/outline-core/property-parse";
import { plainBody } from "./publish-marginalia";
import type { GotoSearchCollection, PageAddressMatch, PropertyCatalogItem } from "./types";
import { STEP_BOX } from "@ep0ch/outline-core/checklist-marks";
import { sameOrigin } from "./publish-page";
import type { OutlinerRequester } from "./client-target";

export async function querySearchCompletion(client: OutlinerRequester, request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST") {
    if (!sameOrigin(request)) return new Response("Use the search page's origin", { status: 403 });
    return Response.json(await client.request({ ...await request.json(), action: "query.suggest", mutation: { author: "user" } }));
  }
  return Response.json(await client.request({ action: "completion.rows", target: { kind: "query", query: url.searchParams.get("q") ?? "", where: url.searchParams.get("where") ?? "" }, semantic: url.searchParams.get("semantic") === "1", zone: url.searchParams.get("zone") ?? undefined }));
}

/** A summary line's heading, quote and list marks and its step box, left off. */
const SUMMARY_LEAD = new RegExp(`^\\s*(?:#{1,6}\\s+|>\\s?|[-*+]\\s+(?:${STEP_BOX}\\s+)?|\\d+[.)]\\s+)+`);

/** The search box's script, read once: served at `<base>/_marginalia/search.js` (publish-page.ts). */
export const SEARCH_SCRIPT = readFileSync(new URL("./publish-search.js", import.meta.url), "utf8");
const SEARCH_TAG = new Bun.CryptoHasher("sha256").update(SEARCH_SCRIPT).digest("hex").slice(0, 16);

/** The search script's URL path below a listener's (or a share's) base, versioned so a new script is fetched at once. */
export function searchScriptPath(basePath: string): string {
  return `${basePath}/_marginalia/search.js?v=${SEARCH_TAG}`;
}

/** At most this many candidates in a completion list, as in the door. */
const COMPLETION_LIMIT = 20;
/** A box sends at most about this much of its text (the lines before the cursor, for code fences): more is answered with nothing. */
export const MAX_COMPLETION_TEXT = 8_000;

/** What a search and a completion ask of the page's publisher. */
export interface SearchHost {
  request<T>(request: Record<string, unknown>): Promise<T>;
  /** Which of `ids` this page may name and link: none locked, none outside a share. */
  shown(ids: readonly string[]): Promise<Set<string>>;
  /** Where a note opens from this page. */
  href(blockId: string): string;
  /** Whether a hit's crumbs may be said: inside a share of one note they'd name what's above it. */
  crumbs: boolean;
  /** The note a share of one note shares: a tag's notes are asked for under it, so the share's are never cut off by others. */
  under?: string;
  /** Each note's crumbs (its ancestors' titles, `A › B`), as `tree.search` says them: for a tag's notes (PIE-800). */
  crumbsOf(ids: readonly string[]): Promise<Map<string, string>>;
}

/** One note a search found: its title, the line that matched (as words), where it sits, and where it opens. */
export interface SearchHit {
  id: string;
  title: string;
  line: string;
  crumbs: string;
  href: string;
}

export interface SearchAnswer {
  query: string;
  hits: SearchHit[];
  /** The service cut its list: more notes match than it ranked. */
  truncated: boolean;
  /** The words the matching lines are marked by. */
  terms: string[];
  /** A search for one tag: the notes carrying it (PIE-800), not the words. */
  tag?: string;
}

/** Each page link as it reads (its label, else its address without the brackets of links it holds), by the one link grammar. */
function pageLinkWords(text: string): string {
  let out = "";
  let at = 0;
  for (const page of pageAddressReferences(text, []).filter((p) => !p.nested)) {
    out += text.slice(at, page.start) + (page.label ?? pageAddressText(page.displayAddress));
    at = page.end;
  }
  return out + text.slice(at);
}

/** A line of a note as summary words: references and embeds by `titleOf`, no Markdown marks, one line. */
export const summaryWords = (raw: string, titleOf: (blockId: string) => string | undefined = () => undefined) =>
  pageLinkWords(plainBody(stripFragmentAnchors(stripPropertyTokens(raw)), titleOf))
    .replace(SUMMARY_LEAD, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();

const titleWords = (title: string) => plainBody(title).replace(/^\s*#{1,6}\s+/, "").replace(/\s{2,}/g, " ").trim();

/** About this many characters of the matching line are shown, around the first word that matched. */
const LINE_CHARS = 180;

/**
 * The line of a hit to show under its title: the first of the service's snippet that holds a word of the query (the
 * title's own line left out: the row shows it), else its first line of text after the title. Cut around the match.
 */
export function matchingLine(title: string, snippet: string, terms: readonly string[]): string {
  const heading = summaryWords(title);
  const lines = snippet.split(/\r?\n/).map((line) => summaryWords(line)).filter((line) => line && line !== heading);
  const has = (line: string) => terms.some((term) => line.toLowerCase().includes(term));
  const line = lines.find(has) ?? lines[0] ?? "";
  if (line.length <= LINE_CHARS) return line;
  const at = Math.min(...terms.map((term) => line.toLowerCase().indexOf(term)).filter((index) => index >= 0), line.length);
  const from = at < line.length ? Math.max(0, Math.min(at - 50, line.length - LINE_CHARS)) : 0;
  return `${from > 0 ? "…" : ""}${line.slice(from, from + LINE_CHARS).trim()}${from + LINE_CHARS < line.length ? "…" : ""}`;
}

/** A search for one tag (`#garden`, `#garden/beds`): the tag, else null (words are searched as words). */
export function tagOf(query: string): string | null {
  const match = TAG_QUERY.exec(query.trim());
  return match && /\p{L}/u.test(match[1]!) ? match[1]! : null;
}
const TAG_QUERY = new RegExp(`^#(${HASHTAG_VALUE_PATTERN.source})$`, "u");

/** At most this many notes carrying a tag are listed. */
const TAG_LIMIT = 200;

/**
 * The notes carrying `tag` (PIE-800: a page's `#tag` links here), as the service's query answers `#tag` (the atom views
 * use: a nested tag counts, `#garden` finds `#garden/beds`), as a page here may show them: each with the line that
 * carries the tag, and its crumbs.
 */
async function queryNotes(host: SearchHost, query: string, tag?: string): Promise<SearchAnswer> {
  const found = await host.request<{ blocks: { id: string; title?: string; text?: string }[]; completeness: { kind: string } }>({
    action: "blocks.query", query: { where: query, limit: TAG_LIMIT, ...(host.under ? { subtreeRootId: host.under } : {}) }, fields: ["title", "text"],
  });
  const shown = await host.shown(found.blocks.map((block) => block.id));
  const blocks = found.blocks.filter((block) => shown.has(block.id));
  const crumbs = host.crumbs ? await host.crumbsOf(blocks.map((block) => block.id)) : new Map<string, string>();
  const hits = blocks.map((block) => {
    const text = block.text ?? "";
    // The first line after the title that carries it (the parser's own reading of a #tag: never one in code).
    const at = tag ? parsePropertyRecords(text).find((record) => record.syntax === "hashtag" && record.line > 0 && tagMatches([record.value], tag))?.line : undefined;
    const line = at === undefined ? "" : text.split(/\r?\n/)[at] ?? "";
    return {
      id: block.id,
      title: titleWords(block.title ?? "") || "a note without words",
      line: line ? matchingLine("", line, [query.toLowerCase()]) : "",
      crumbs: crumbs.get(block.id) ?? "",
      href: host.href(block.id),
    };
  });
  return { query, hits, truncated: found.completeness.kind === "truncated", terms: [query.toLowerCase()], tag };
}

/** The outline's notes by words, as the power bar finds them (`tree.search`, from `near`), as a page here may show them. */
export async function searchNotes(host: SearchHost, query: string, near?: string, where?: string): Promise<SearchAnswer> {
  if (where) return queryNotes(host, where);
  const tag = tagOf(query);
  if (tag) return queryNotes(host, `#${tag}`, tag);
  const wanted = query.trim().slice(0, 200);
  const terms = searchTextTerms(wanted).filter((term) => term.length >= 2);
  if (!wanted) return { query: wanted, hits: [], truncated: false, terms };
  const found = await host.request<GotoSearchCollection>({ action: "tree.search", query: wanted, ...(near ? { contextBlockId: near } : {}) });
  const shown = await host.shown(found.matches.map((match) => match.block.id));
  const hits = found.matches.filter((match) => shown.has(match.block.id)).map((match) => ({
    id: match.block.id,
    title: titleWords(match.title) || "a note without words",
    line: matchingLine(match.title, match.snippet, terms),
    crumbs: host.crumbs ? match.path : "",
    href: host.href(match.block.id),
  }));
  return { query: wanted, hits, truncated: found.completeness.kind === "truncated", terms };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** `text` as HTML with each of `terms` (already lower case) in bold. */
export function markTerms(text: string, terms: readonly string[]): string {
  const words = [...terms].filter(Boolean).sort((a, b) => b.length - a.length).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return escapeHtml(text);
  return text.split(new RegExp(`(${words.join("|")})`, "giu")).map((part, index) => index % 2 ? `<b>${escapeHtml(part)}</b>` : escapeHtml(part)).join("");
}

/** The search box: a GET form to `<base>/search`, from the page's note (`near`) when it has one. */
export function searchForm(base: string, options: { query?: string; near?: string; autofocus?: boolean } = {}): string {
  return `<form class="sx" role="search" action="${escapeHtml(`${base}/search`)}" method="get"><div class="sx-row">` +
    `<input type="search" name="q" value="${escapeHtml(options.query ?? "")}" placeholder="Search notes" aria-label="Search notes (/ or ctrl+k)" ` +
    `autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" maxlength="200"${options.autofocus ? " autofocus" : ""}>` +
    `${options.near ? `<input type="hidden" name="near" value="${escapeHtml(options.near)}">` : ""}</div></form>`;
}

/** The results as rows, the folder list's: the title and the matching line (the row's link), then the crumbs. */
export function searchRowsHtml(answer: SearchAnswer): string {
  return answer.hits.map((hit) => `<li data-block="${escapeHtml(hit.id)}"><a href="${escapeHtml(hit.href)}"><span class="t">${markTerms(hit.title, answer.terms)}</span>` +
    `${hit.line ? `<span class="s">${markTerms(hit.line, answer.terms)}</span>` : ""}</a>${hit.crumbs ? `<span class="m">${escapeHtml(hit.crumbs)}</span>` : ""}</li>`).join("\n");
}

/** The search page's article: what was asked, how many, and the rows. */
export function searchResultsHtml(answer: SearchAnswer, base: string, near?: string): string {
  const form = searchForm(base, { query: answer.query, ...(near ? { near } : {}), autofocus: !answer.query });
  if (!answer.query) return `<article>\n<h1>Search</h1>\n${form}\n<p class="dim">Words from a note's title or body; the nearest notes to where you were come first.</p>\n</article>\n`;
  const count = `${answer.hits.length}${answer.truncated ? "+" : ""} ${answer.hits.length === 1 ? "note" : "notes"}`;
  const said = answer.tag
    ? (answer.hits.length ? `${count} tagged #${escapeHtml(answer.tag)}` : `No note here is tagged #${escapeHtml(answer.tag)}.`)
    : answer.hits.length ? count : `Nothing matches “${escapeHtml(answer.query)}”. Fewer or shorter words find more.`;
  const list = answer.hits.length ? `<ul class="kids found">\n${searchRowsHtml(answer)}\n</ul>\n` : "";
  return `<article>\n<h1>${answer.tag ? `#${escapeHtml(answer.tag)}` : "Search"}</h1>\n${form}\n<p class="dim">${said}</p>\n</article>\n<section class="inside">${list}</section>\n`;
}

/** The search box and its results, dark, with targets a thumb can hit; on a phone, open, a sheet over the page. */
export const SEARCH_STYLE = `
form.sx{margin:0 0 .6rem;position:relative}
form.sx .sx-row{display:flex;gap:.4rem;align-items:center}
form.sx input[type=search]{box-sizing:border-box;flex:1;min-width:0;min-height:44px;font:16px/1.4 ui-sans-serif,system-ui,sans-serif;background:#161615;color:var(--fg);border:1px solid var(--rule);border-radius:.5rem;padding:.45rem .7rem}
form.sx input[type=search]:focus{outline:none;border-color:#5a6170}
form.sx input::placeholder{color:var(--dim)}
form.sx .sx-close{font:15px/1 ui-sans-serif,system-ui,sans-serif;min-height:44px;padding:0 .8rem;border-radius:.5rem;border:1px solid var(--rule);background:#222220;color:var(--fg);cursor:pointer}
form.sx .sx-panel{position:absolute;left:0;right:0;top:100%;z-index:20;margin-top:.25rem;max-height:70vh;overflow-y:auto;background:#161615;border:1px solid var(--rule);border-radius:.5rem}
form.sx .sx-panel ul.kids{border-top:0}
form.sx .sx-panel ul.kids li:last-child{border-bottom:0}
form.sx .sx-panel p{margin:.6rem .7rem;font:14px/1.5 ui-sans-serif,system-ui,sans-serif}
form.sx .sx-panel li.on>a{background:#1d2026}
ul.kids .t b,ul.kids .s b{color:var(--fg);font-weight:600}
@media (max-width:40rem){
  form.sx.open{position:fixed;inset:0;z-index:20;margin:0;padding:.75rem .75rem calc(.75rem + env(safe-area-inset-bottom));background:var(--bg);display:flex;flex-direction:column;gap:.5rem}
  form.sx.open .sx-panel{position:static;flex:1;max-height:none;margin:0;border:0;background:none}
}
`;

/** One candidate a comment box offers: what it says, where it's from, and exactly what choosing it writes. */
export interface CompletionChoice {
  label: string;
  detail: string;
  insertion: string;
}

/** What completes at the cursor: the span (offsets in the text sent) choosing a candidate replaces, and the candidates (none: nothing to offer). */
export interface CompletionAnswer {
  kind: "page" | "block" | "tag" | null;
  start: number;
  end: number;
  items: CompletionChoice[];
  /** Said when there's a target but nothing to choose. */
  message?: string;
}

const NOTHING: CompletionAnswer = { kind: null, start: 0, end: 0, items: [] };

/**
 * The candidates for the token at offset `at` of `text` (the box's text from a line's start to the end of the cursor's
 * line: the lines before it say whether it's in a code fence), as the door's completer finds and writes them: `[[` a named
 * address (`pages.complete`, a Work ID as `[[PIE-1|title]]`), `((` a note (`tree.search` from `near`, `((id))`), `#` a
 * tag the outline already has (`properties.catalog`, `#tag`; `tags` false inside a share, whose tags are the outline's).
 * A `[file::` and a `((note#heading` aren't offered here: the reference stays as typed.
 */
export async function completeAt(host: SearchHost, text: string, at: number, near: string | undefined, tags: boolean): Promise<CompletionAnswer> {
  if (text.length > MAX_COMPLETION_TEXT || !Number.isInteger(at) || at < 0 || at > text.length) return NOTHING;
  const lines = text.split("\n");
  let row = 0, from = 0;
  while (row < lines.length - 1 && from + lines[row]!.length < at) { from += lines[row]!.length + 1; row += 1; }
  const answer = await completeLine(host, lines, row, at - from, near, tags);
  return answer.kind ? { ...answer, start: answer.start + from, end: answer.end + from } : answer;
}

async function completeLine(host: SearchHost, lines: readonly string[], row: number, column: number, near: string | undefined, tags: boolean): Promise<CompletionAnswer> {
  const line = lines[row] ?? "";
  const target = referenceTargetAtCursor(line, column, lines, row);
  const context = near ? { contextBlockId: near } : {};
  if (target?.kind === "page") {
    const prefix = (await host.request<{ workIdPrefix?: string }>({ action: "references.resolve", text: "" })).workIdPrefix ?? null;
    const query = pageCompletionLookupQuery(target.query, prefix);
    const found = await host.request<{ addresses: PageAddressMatch[] }>({ action: "pages.complete", ...(query ? { query } : {}), limit: COMPLETION_LIMIT, ...context });
    const shown = await host.shown(found.addresses.map((address) => address.blockId));
    const items = found.addresses.filter((address) => shown.has(address.blockId)).map((address) => {
      const { label, insertion } = pageAddressCompletion(address, target.query, prefix);
      return { label, detail: address.kind, insertion };
    });
    return { kind: "page", start: target.start, end: target.end, items, ...(items.length ? {} : { message: "no matching named addresses" }) };
  }
  if (target?.kind === "block") {
    if (/[#^]/.test(target.query)) return NOTHING;
    const found = await host.request<GotoSearchCollection>({ action: "tree.search", query: target.query, ...context });
    const shown = await host.shown(found.matches.map((match) => match.block.id));
    const items = found.matches.filter((match) => shown.has(match.block.id)).slice(0, COMPLETION_LIMIT)
      .map((match) => ({ label: titleWords(match.title) || match.block.id, detail: host.crumbs ? match.path : "", insertion: `((${match.block.id}))` }));
    return { kind: "block", start: target.start, end: target.end, items, ...(items.length ? {} : { message: "no matching notes" }) };
  }
  if (target) return NOTHING;
  const tag = tags ? hashtagAtCursor(line, column, lines, row) : null;
  if (!tag) return NOTHING;
  const found = await host.request<PropertyCatalogItem[]>({ action: "properties.catalog", key: "tag", prefix: tag.query, limit: COMPLETION_LIMIT, propertyScope: "all" });
  const items = found.map((item) => ({ label: `#${item.value}`, detail: `${item.count} ${item.count === 1 ? "note" : "notes"}`, insertion: isHexColour(item.value) ? `[tag::${item.value}]` : `#${item.value}` }));
  // A new tag is fine too: nothing to choose is said, never refused.
  return { kind: "tag", start: tag.start, end: tag.end, items, ...(items.length ? {} : { message: `no tag starts #${tag.query} yet` }) };
}
