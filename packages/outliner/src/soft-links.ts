// Where a soft link lands (PIE-408), the service's one answer so the door, Detail and the publisher agree: outline-core
// recognizes the token (soft-links.ts); this says which note it means, from what the outline holds and, for a pull
// request, from the nearest `[project::…]` around it (the one scope walk, scope-walk.ts). One note opens; several are a
// chooser, never a guess; none says what could be made there, and nothing is made until someone asks (`pages.follow`).
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { pageAddressReferences } from "@ep0ch/outline-core/link-syntax";
import { propertyValueSpan, splitPropertyValue } from "@ep0ch/outline-core/property-grammar";
import { createContextResolver, type ContextKeyMatcher, type ContextKeyOccurrence } from "@ep0ch/outline-core/scope-walk";
import { prWords, type SoftLinkName } from "@ep0ch/outline-core/soft-links";
import { blockDisplayTitle } from "./references";
import type { Database } from "bun:sqlite";
import { SOFT_LINK_IGNORE_KEY } from "@ep0ch/outline-core/soft-links";
import { resourcePropertyKeys } from "./resource-references";
import { softOccurrences, type SoftMentionsOf } from "./backlinks";
import type { Block, PageAddressResolution } from "./types";
import { getProperty } from "./properties";

/** A place a soft link could land: a note that's there, or what following it would make (nothing is made until asked). */
export interface SoftLinkCandidate {
  label: string;
  /** Whose it is, where that's what tells two apart (a pull request's project). */
  context?: string;
  block?: Block;
  /** Nothing is there: the address to make, under the page `under` names (a project's PR#125), else where new pages go. */
  create?: { address: string; under?: string };
}

/** `references.soft`: one candidate opens (`resolved`) or is offered (`missing`); several are a chooser, never a guess. */
export interface SoftLinkAnswer {
  status: "resolved" | "ambiguous" | "missing";
  /** The link's words, as a chooser's title says them. */
  words: string;
  candidates: SoftLinkCandidate[];
}

/** The property that says whose a bare `PR#125` is. */
const PROJECT_KEY = "project";

/** A project's name as written in a value: the words, or the address of a `[[page]]` written there. */
const projectName = (item: string): string | null => {
  const written = item.trim();
  if (!written) return null;
  const [page] = pageAddressReferences(written, []);
  return page && page.start === 0 && page.end === written.length ? page.displayAddress : written;
};

/** `[project::x]`, `project:: x` and each item of a list, for the scope walk. */
export const PROJECT_MATCHER: ContextKeyMatcher = {
  propertyKey: PROJECT_KEY,
  keysIn(text) {
    const out: ContextKeyOccurrence[] = [];
    for (const record of parsePropertyRecords(text)) {
      if (record.key.toLowerCase() !== PROJECT_KEY || record.syntax === "hashtag") continue;
      const span = propertyValueSpan(record.raw);
      if (!span) continue;
      for (const item of splitPropertyValue(record.raw.slice(span.start, span.end))) {
        const key = projectName(item);
        if (key) out.push({ key, start: record.start, end: record.end });
      }
    }
    return out;
  },
  keyFromProperty: projectName,
};

/** What the answer reads from the outline. */
export interface SoftLinkSource {
  page(address: string): PageAddressResolution;
  /** A note by id, in the Trash or not. */
  block(id: string): Block | null;
  /** The active notes whose own `[key::value]` says this, oldest first. */
  notesWith(key: string, value: string): Block[];
  /** The active notes whose first line starts with these words. */
  notesTitled(words: string): Block[];
}

/** Where the link was written: the block and the line within it its context is walked from. */
export interface SoftLinkPlace { blockId?: string; line?: number }

const candidate = (block: Block, context?: string): SoftLinkCandidate => ({ label: blockDisplayTitle(block), ...(context ? { context } : {}), block });

function answer(words: string, candidates: SoftLinkCandidate[]): SoftLinkAnswer {
  const found = candidates.filter(c => c.block);
  // One note is the answer; so is one thing that could be made, with nothing else in reach.
  const status = candidates.length === 1 ? (found.length ? "resolved" : "missing") : candidates.length ? "ambiguous" : "missing";
  return { status, words, candidates };
}

const pageNote = (r: PageAddressResolution): Block | null => r.status === "resolved" && r.block ? r.block : null;

/** The parent chain of `id`, nearest first (never past a loop). */
export function ancestorChain(source: Pick<SoftLinkSource, "block">, id: string): Block[] {
  const chain: Block[] = [], seen = new Set([id]);
  for (let at = source.block(id)?.parentId; at && !seen.has(at); ) {
    seen.add(at);
    const block = source.block(at);
    if (!block) break;
    chain.push(block);
    at = block.parentId;
  }
  return chain;
}

/** The projects a line of a block is under: nearest first, as the scope walk stops (two at one step are both named). */
export function projectsAround(source: Pick<SoftLinkSource, "block">, place: SoftLinkPlace): string[] {
  const block = place.blockId ? source.block(place.blockId) : null;
  if (!block) return [];
  const resolved = createContextResolver({ block: { id: block.id, text: block.text }, ancestors: ancestorChain(source, block.id).map(a => ({ id: a.id, text: a.text })), matcher: PROJECT_MATCHER }).resolve(place.line ?? 0);
  if (resolved.kind !== "none") return resolved.kind === "resolved" ? [resolved.key] : [...resolved.keys];
  // Under a project's own page (`[type::project] [page::floatty]`), it is that project.
  for (const note of [block, ...ancestorChain(source, block.id)]) {
    const properties = parsePropertyRecords(note.text);
    const page = getProperty(properties, "page")?.trim();
    if (page && properties.some(p => p.key === "type" && p.value.trim().toLowerCase() === "project")) return [page];
  }
  return [];
}

/** `words` starting a note's first line as a whole word (`PR#12` isn't `PR#125`). */
export const startsWithWords = (block: Pick<Block, "text">, words: string) => {
  const text = block.text.trimStart();
  return text.startsWith(words) && !/[\w#-]/.test(text[words.length] ?? "");
};

export function resolveSoftLink(name: SoftLinkName, place: SoftLinkPlace, source: SoftLinkSource): SoftLinkAnswer {
  if (name.kind === "value") {
    const page = pageNote(source.page(name.value));
    return answer(name.value, [page ? candidate(page) : { label: name.value, create: { address: name.value } }]);
  }
  if (name.kind === "date") {
    // That day's note: the page named by the date, and any note that says it is that day's (`[day::2026-11-06]`).
    const page = pageNote(source.page(name.day));
    const dayNotes = source.notesWith("day", name.day).filter(note => note.id !== page?.id);
    const found = [...(page ? [page] : []), ...dayNotes];
    return answer(name.day, found.length ? found.map(note => candidate(note)) : [{ label: name.day, create: { address: name.day } }]);
  }
  const words = prWords(name.number);
  const projects = projectsAround(source, place);
  if (!projects.length) {
    const page = pageNote(source.page(words));
    const titled = source.notesTitled(words).filter(note => note.id !== page?.id && startsWithWords(note, words));
    const found = [...(page ? [page] : []), ...titled];
    return answer(words, found.length ? found.map(note => candidate(note)) : [{ label: words, create: { address: words } }]);
  }
  const titled = source.notesTitled(words).filter(note => startsWithWords(note, words));
  return answer(words, projects.flatMap((project): SoftLinkCandidate[] => {
    const home = pageNote(source.page(project));
    const under = home ? titled.filter(note => ancestorChain(source, note.id).some(a => a.id === home.id)) : [];
    return under.length ? under.map(note => candidate(note, project)) : [{ label: words, context: project, create: { address: words, under: project } }];
  }));
}

/** Whether a mention of this pull request, written at `place`, lands on `target`: what the target's soft mentions ask. */
export function prLandsOn(number: number, place: SoftLinkPlace, target: Block, source: SoftLinkSource): boolean {
  // A note about a pull request names itself in its title: that's no mention of another with the same number.
  const own = place.blockId ? source.block(place.blockId) : null;
  if (own && place.line === 0 && startsWithWords(own, prWords(number))) return false;
  return resolveSoftLink({ kind: "pr", number }, place, source).candidates.some(c => c.block?.id === target.id);
}

// ── what the store answers from ─────────────────────────────────────────────────────────────────────────────

/** How many notes holding the words a read fetches at a time, and looks through in all before it says it stopped. */
const SOFT_MENTION_PAGE = 500, SOFT_MENTION_LOOK = 5000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const likeEscaped = (words: string) => words.replace(/[\\%_]/g, char => `\\${char}`);

export function storeSoftLinkSource(db: Database, block: (id: string) => Block | null, page: (address: string) => PageAddressResolution): SoftLinkSource {
  const blocks = (rows: unknown) => (rows as { id: string }[]).flatMap(row => block(row.id) ?? []);
  return {
    page, block,
    notesWith: (key, value) => blocks(db.query(`SELECT p.block_id AS id FROM block_properties p JOIN blocks b ON b.id = p.block_id
      WHERE p.key = ? AND p.value = ? AND p.scope = 'block' AND b.effective_deleted_root_id IS NULL ORDER BY b.created_at`).all(key, value)),
    notesTitled: words => blocks(db.query(`SELECT id FROM blocks WHERE text LIKE ? ESCAPE '\\' AND effective_deleted_root_id IS NULL ORDER BY created_at`).all(`${likeEscaped(words)}%`)),
  };
}

/** Keys whose values aren't soft links here: what `[soft-link-ignore::…]` notes list, and the Resource keys. */
function softLinkIgnored(db: Database): string[] {
  const written = db.query("SELECT value FROM block_properties p JOIN blocks b ON b.id = p.block_id WHERE p.key = ? AND b.effective_deleted_root_id IS NULL").all(SOFT_LINK_IGNORE_KEY) as { value: string }[];
  return [...new Set([...resourcePropertyKeys(), ...written.flatMap(row => splitPropertyValue(row.value).flatMap(item => item.split(",")).map(key => key.trim().toLowerCase()).filter(Boolean))])];
}

/** How soft links name this note: its page addresses and aliases (a Work ID isn't one: a ticket key is a candidate address already) and its days. */
function softNames(db: Database, block: Block): { addresses: Set<string>; days: Set<string> } {
  const rows = db.query("SELECT normalized_address AS address FROM page_addresses WHERE block_id = ? AND kind != 'work-id'").all(block.id) as { address: string }[];
  const addresses = new Set(rows.map(row => row.address)), days = new Set([...addresses].filter(address => ISO_DAY.test(address)));
  for (const { key, value } of block.properties) if (key === "day" && ISO_DAY.test(value.trim())) days.add(value.trim());
  return { addresses, days };
}

/** The pull request a note is about, by its title. */
const prOfTitle = (block: Block): number | undefined => { const pr = /^\s*PR#(\d+)(?![\w-])/i.exec(block.text)?.[1]; return pr ? Number(pr) : undefined; };

/** Each answer once per read: a hub's mentions ask for the same few notes and titles over and over. */
function sharedLookups(source: SoftLinkSource): SoftLinkSource {
  const once = <K, V>(read: (key: K) => V) => { const kept = new Map<K, V>(); return (key: K) => { if (!kept.has(key)) kept.set(key, read(key)); return kept.get(key)!; }; };
  const notesWith = new Map<string, Block[]>();
  return { page: once(source.page), block: once(source.block), notesTitled: once(source.notesTitled), notesWith: (key, value) => { const k = `${key}\0${value}`; if (!notesWith.has(k)) notesWith.set(k, source.notesWith(key, value)); return notesWith.get(k)!; } };
}

/**
 * The notes that really mention a target: soft mentions aren't indexed (a value's words, a date in a sentence), so the
 * notes holding the words are read newest first, a page at a time, and each is checked, until `limit` is passed (the
 * answer is truncated by that) or they run out. Past `look` notes it stops and says so, so a page named by a common word
 * costs a bounded read and never reports complete.
 */
export function softMentionRows(db: Database, needles: readonly string[], mentions: (row: { id: string; text: string }) => boolean, limit: number, look = SOFT_MENTION_LOOK): { rows: { block_id: string }[]; truncated: boolean } {
  const rows: { block_id: string }[] = [];
  if (!needles.length) return { rows, truncated: false };
  const query = db.query(`SELECT id, text FROM blocks WHERE effective_deleted_root_id IS NULL AND (${needles.map(() => "text LIKE ? ESCAPE '\\'").join(" OR ")}) ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`);
  const words = needles.map(needle => `%${likeEscaped(needle)}%`);
  for (let offset = 0; ; offset += SOFT_MENTION_PAGE) {
    const page = query.all(...words, Math.min(SOFT_MENTION_PAGE, look - offset + 1), offset) as { id: string; text: string }[];
    for (const [at, row] of page.entries()) {
      if (offset + at >= look) return { rows, truncated: true };
      if (!mentions(row)) continue;
      rows.push({ block_id: row.id });
      if (rows.length > limit) return { rows, truncated: false };
    }
    if (page.length < SOFT_MENTION_PAGE) return { rows, truncated: false };
  }
}

/** What a read of this note's soft mentions needs: the notes that do, and how the relation names it. Nothing when nothing names it. */
export function softMentionRead(db: Database, target: Block | null, limit: number, source: SoftLinkSource): { rows: { block_id: string }[]; soft?: SoftMentionsOf } {
  if (!target) return { rows: [] };
  const { addresses, days } = softNames(db, target), pr = prOfTitle(target);
  const needles = [...addresses, ...days, ...(pr !== undefined ? [prWords(pr), `PR::${pr}`, `PR:: ${pr}`] : [])];
  if (!needles.length) return { rows: [] };
  const shared = sharedLookups(source);
  const soft: SoftMentionsOf = { addresses, days, ignore: softLinkIgnored(db), ...(pr !== undefined ? { pr } : {}), prLands: (number, blockId, line) => prLandsOn(number, { blockId, line }, target, shared) };
  // A note that can't be read here is kept: the relation reads it again and names it as skipped (PIE-1640).
  const mentions = (row: { id: string; text: string }) => { try { return softOccurrences(row, soft).length > 0; } catch { return true; } };
  const read = softMentionRows(db, needles, row => row.id !== target.id && mentions(row), limit);
  return { rows: read.rows, soft: { ...soft, ...(read.truncated ? { truncated: true } : {}) } };
}

/** What a client draws soft links with: keys left out, and the page addresses (a value links only where its page is). */
export interface SoftLinkScope { ignore: string[]; pages: string[] }

export function softLinkScope(db: Database): SoftLinkScope {
  const rows = db.query("SELECT a.normalized_address AS address FROM page_addresses a JOIN blocks b ON b.id = a.block_id WHERE a.kind != 'work-id' AND b.effective_deleted_root_id IS NULL").all() as { address: string }[];
  return { ignore: softLinkIgnored(db), pages: rows.map(row => row.address) };
}
