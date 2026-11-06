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
import type { SoftMentionsOf } from "./backlinks";
import type { Block, PageAddressResolution } from "./types";

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
    const page = properties.find(p => p.key === "page")?.value.trim();
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

/** The most notes a soft-mention read looks through: the newest that hold the words. */
const SOFT_MENTION_CANDIDATES = 1000;
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
export function softLinkIgnored(db: Database): string[] {
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

/** The words a note must hold to mention this one by a soft link; none for a note nothing names. */
export function softNeedles(db: Database, block: Block | null): string[] {
  if (!block) return [];
  const { addresses, days } = softNames(db, block), pr = /^\s*PR#(\d+)(?![\w-])/i.exec(block.text)?.[1];
  return [...addresses, ...days, ...(pr ? [prWords(Number(pr)), `PR::${pr}`, `PR:: ${pr}`] : [])];
}

/**
 * The notes holding those words, past the ones `known` already: soft mentions aren't indexed (a value's words, a date in a
 * sentence), so the newest and a bounded number, and a hub with thousands answers as fast as one with a few.
 */
export function softCandidates(db: Database, needles: readonly string[], known: readonly { block_id: string }[]): { block_id: string }[] {
  if (!needles.length) return [];
  const had = new Set(known.map(row => row.block_id));
  const rows = db.query(`SELECT id AS block_id FROM blocks WHERE effective_deleted_root_id IS NULL AND (${needles.map(() => "text LIKE ? ESCAPE '\\'").join(" OR ")}) ORDER BY updated_at DESC LIMIT ${SOFT_MENTION_CANDIDATES}`).all(...needles.map(needle => `%${likeEscaped(needle)}%`)) as { block_id: string }[];
  return rows.filter(row => !had.has(row.block_id));
}

/** What the backlink relation asks to read this note's soft mentions; nothing when nothing names it. */
export function softMentionsOf(db: Database, target: Block, source: SoftLinkSource): { soft?: SoftMentionsOf } {
  if (!softNeedles(db, target).length) return {};
  return { soft: { ...softNames(db, target), ignore: softLinkIgnored(db), prLands: (number, blockId, line) => prLandsOn(number, { blockId, line }, target, source) } };
}
