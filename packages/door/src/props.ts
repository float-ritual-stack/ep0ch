// A note's properties the way Detail shows them: a one-line summary of chosen keys under the title, the
// block's metadata lines kept out of the body, and every token (repeats and scope kept) for the property
// panel. The service parses; the door only presents what `properties.preview` says the text holds.
import { valueOf, valuesOf } from "@ep0ch/outline-core/block-record";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Msg } from "./board";
import type { PropertyRecord } from "@ep0ch/outline-core/property-parse";
import type { SocketBoard } from "./socket";
import { stateDir } from "./state";
import { DEFAULT_PROPERTY_SUMMARY_KEYS, parsePropertySummaryKeys, propertySummarySegments } from "@ep0ch/outline-core/property-summary";
import { printable } from "./text";

/** Control characters out of a value before it reaches the terminal: text.ts's one `printable`. */
export { printable };

/** Detail's summary segments (outline-core's property-summary.ts), cleaned of control characters for the terminal. */
export const summarySegments = (properties: readonly { key: string; value: string }[], keys: readonly string[]) =>
  propertySummarySegments(properties, keys, printable);

// ── which keys: the view's, yours, the environment's, or Detail's default ─────

export type SummarySource = "view" | "yours" | "env" | "default";
const prefsFile = () => join(stateDir(), "properties.json");

/** Your choice of summary keys, kept per user on this machine (null: none made). */
export function userSummaryKeys(): string[] | null {
  try {
    const j = JSON.parse(readFileSync(prefsFile(), "utf8"));
    return Array.isArray(j.summaryKeys) ? parsePropertySummaryKeys(j.summaryKeys.join(",")) ?? null : null;
  } catch { return null; }
}

/** Save (or with null, forget) your choice of summary keys. */
export function setUserSummaryKeys(keys: string[] | null) {
  const dir = stateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(prefsFile(), JSON.stringify(keys === null ? {} : { summaryKeys: keys }, null, 2) + "\n");
}

/**
 * The summary's keys and where they came from. A saved view's `[summary-properties::…]` decides for the
 * notes it lists (as in Tree and Detail); then your own choice; then `OUTLINER_PROPERTY_SUMMARY_KEYS`
 * (Detail's variable, so both show the same keys); then status, work-stage, priority, track.
 */
export function summaryKeys(view?: readonly string[] | null): { keys: string[]; source: SummarySource } {
  if (view) return { keys: [...view], source: "view" };
  const mine = userSummaryKeys();
  if (mine) return { keys: mine, source: "yours" };
  const env = parsePropertySummaryKeys(process.env.OUTLINER_PROPERTY_SUMMARY_KEYS);
  if (env) return { keys: env, source: "env" };
  return { keys: [...DEFAULT_PROPERTY_SUMMARY_KEYS], source: "default" };
}

/** A saved view's own summary keys (`[summary-properties::work-stage,priority]`), if it names any. */
export const viewSummaryKeys = (def: Msg | null | undefined): string[] | null =>
  parsePropertySummaryKeys(def?.properties?.find(p => p.key === "summary-properties")?.value ?? prop(def, "summary-properties")) ?? null;

// ── the tokens of a text, from the service ─────────────────────────────────────

/** Where a reader's reads go, and what to redraw when an answer arrives: the reader's own connection. */
/** A note's properties in the service's list form: one entry per value, a key written twice (tags) listed twice. */
export type PropertyList = readonly { key: string; value: string }[];
/** The list form of a `Msg`: its `properties` as the service sent them. */
export const propertyListOf = (m: { properties: PropertyList }): PropertyList => m.properties;
/** A note's first value for a property (block scope, outline-core's list rule), or undefined. Keys compare in lower case. */
export const prop = (m: { properties: PropertyList } | null | undefined, key: string): string | undefined => valueOf(m ?? {}, key);
/** Every value a note has for a property, in order: a repeated key adds, a `[a, b]` list is two. */
export const propValues = (m: { properties: PropertyList } | null | undefined, key: string): string[] => valuesOf(m ?? {}, key);

export interface Source { board: SocketBoard; redraw(): void }

interface Parsed { state: "loading" | "ready" | "none" | "error"; tokens: PropertyRecord[]; error?: string; done?: Promise<Parsed>; asked?: number }
const parsedBy = new WeakMap<object, Map<string, Parsed>>();
/** How many texts' answers are kept per connection. */
const MAX_PARSED = 300;
let outlineEvents = 0;
/**
 * An outline event (or a reconnect) arrived: a read that failed is asked again on the next render. Not
 * sooner: an error redraws, and asking again on every redraw would loop against a failing service.
 */
export function invalidatePropertyErrors() { outlineEvents++; }

/**
 * How the service parses `text` (synchronous for the renderer: null until it has answered). The answer
 * depends on the text alone, so it is kept until the cache fills. `none`: no service, where the door falls back to the documented preamble rule and block properties only.
 */
export function tokensOf(text: string, src: Source | null | undefined): Parsed | null {
  const r = lookup(text, src);
  return r.state === "loading" ? null : r;
}

/**
 * The cached answer for `text`, or the pending entry of the read it starts. The entry itself is returned,
 * so a caller that waits holds it even if the cache lets it go.
 */
function lookup(text: string, src: Source | null | undefined): Parsed {
  if (!src) return { state: "none", tokens: [] };
  let parsed = parsedBy.get(src.board);
  if (!parsed) parsedBy.set(src.board, (parsed = new Map()));
  const hit = parsed.get(text);
  // Least recently used goes first: a hit, or a failed read asked again, moves to the end.
  if (hit) parsed.delete(text);
  if (hit && !(hit.state === "error" && (hit.asked ?? 0) < outlineEvents)) { parsed.set(text, hit); return hit; }
  const asked = outlineEvents;
  const entry: Parsed = { state: "loading", tokens: [] };
  while (parsed.size >= MAX_PARSED) parsed.delete(parsed.keys().next().value!);   // room first, so the new read is never the one let go
  parsed.set(text, entry);
  const cache = parsed;
  entry.done = Promise.resolve().then(() => src.board.propertyRecords(text)).then(
    (t): Parsed => ({ state: "ready", tokens: t }),
    (e: Error): Parsed => ({ state: "error", tokens: [], error: e.message, asked }),
  ).then(r => { if (cache.get(text) === entry) cache.set(text, r); src.redraw(); return r; });
  return entry;
}

/** The same, waiting for the service's answer (for an action, which must act on what the service says). */
export async function tokensFor(text: string, src: Source | null | undefined): Promise<Parsed> {
  const r = lookup(text, src);
  if (r.state !== "loading") return r;
  return r.done ?? { state: "error", tokens: [], error: "the property read was dropped" };
}

/** The lines the body leaves out because they hold block metadata only (outline-core's block-tags.ts, PIE-880). */
export { metadataLines } from "@ep0ch/outline-core/block-tags";
