// A note's properties the way Detail shows them: a one-line summary of chosen keys under the title, the
// block's metadata lines kept out of the body, and every token (repeats and scope kept) for the property
// panel. The service parses; the door only presents what `properties.preview` says the text holds.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Msg } from "./board";
import type { PropertyRecord, SocketBoard } from "./socket";
import { stateDir } from "./state";

/** Detail's default (`OUTLINER_PROPERTY_SUMMARY_KEYS`). */
export const DEFAULT_SUMMARY_KEYS = ["status", "work-stage", "priority", "track"] as const;

/** `a, B ,a` → `["a", "b"]`; undefined stays undefined (not set), "" is an explicit empty list (no summary). */
export function parseSummaryKeys(value: string | undefined | null): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const keys: string[] = [];
  for (const c of value.split(",")) { const k = c.trim().toLowerCase(); if (k && !keys.includes(k)) keys.push(k); }
  return keys;
}

/** Control characters out of a value before it reaches the terminal. */
export const printable = (s: string) => s.replace(/[\x00-\x1f\x7f-\x9f]/g, "");

export interface SummarySegment { key: string; label: string; value: string; plain: string }

/**
 * Detail's property summary (pi-herdr-outliner `propertySummarySegments`): keys in order, repeated values
 * joined, `work-stage` labelled `stage`, and a roadmap item's `status` left out (its lifecycle is work-stage).
 */
export function summarySegments(properties: readonly { key: string; value: string }[], keys: readonly string[]): SummarySegment[] {
  const roadmap = properties.some(p => p.key === "type" && p.value.toLowerCase() === "roadmap-item");
  return keys.filter(k => !roadmap || k !== "status").flatMap(key => {
    const values = [...new Set(properties.filter(p => p.key.toLowerCase() === key).map(p => printable(p.value)).filter(Boolean))];
    if (!values.length) return [];
    const label = key === "work-stage" ? "stage" : key;
    const value = values.join(", ");
    return [{ key, label, value, plain: `${label} ${value}` }];
  });
}

// ── which keys: the view's, yours, the environment's, or Detail's default ─────

export type SummarySource = "view" | "yours" | "env" | "default";
const prefsFile = () => join(stateDir(), "properties.json");

/** Your choice of summary keys, kept per user on this machine (null: none made). */
export function userSummaryKeys(): string[] | null {
  try {
    const j = JSON.parse(readFileSync(prefsFile(), "utf8"));
    return Array.isArray(j.summaryKeys) ? parseSummaryKeys(j.summaryKeys.join(",")) ?? null : null;
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
  const env = parseSummaryKeys(process.env.OUTLINER_PROPERTY_SUMMARY_KEYS);
  if (env) return { keys: env, source: "env" };
  return { keys: [...DEFAULT_SUMMARY_KEYS], source: "default" };
}

/** A saved view's own summary keys (`[summary-properties::work-stage,priority]`), if it names any. */
export const viewSummaryKeys = (def: Msg | null | undefined): string[] | null =>
  parseSummaryKeys(def?.properties?.find(p => p.key === "summary-properties")?.value ?? def?.props["summary-properties"]) ?? null;

// ── the tokens of a text, from the service ─────────────────────────────────────

/** Where a reader's reads go, and what to redraw when an answer arrives: the reader's own connection. */
export interface Source { board: SocketBoard; redraw(): void }

interface Parsed { state: "loading" | "ready" | "unsupported" | "error"; tokens: PropertyRecord[]; error?: string; done?: Promise<Parsed>; asked?: number }
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
 * depends on the text alone, so it is kept until the cache fills. `unsupported`: an older service, or no
 * service, where the door falls back to the documented preamble rule and block properties only.
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
  if (!src) return { state: "unsupported", tokens: [] };
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
    (t): Parsed => (t ? { state: "ready", tokens: t } : { state: "unsupported", tokens: [] }),
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

/**
 * The line numbers (0 = subject) the body leaves out because they hold block metadata only: the
 * preamble, the run of lines right after the subject (blank lines before it skipped) whose tokens the
 * service calls block-scope metadata lines (`[key::value]` runs, hashtags among them). Only that run: the
 * service gives a hashtag block scope wherever it is, so a `#tag` line further down is body text and
 * stays, as do bare `key:: value` lines (line scope). Without the service's answer, the documented rule:
 * the first run of `[key::value]`-only lines after the subject.
 */
export function metadataLines(text: string, tokens: PropertyRecord[] | null): Set<number> {
  const out = new Set<number>();
  const meta = tokens ? new Set(tokens.filter(t => t.scope === "block" && t.placement === "metadata-line").map(t => t.line)) : null;
  const lines = text.split("\n");
  let i = 1;
  while (i < lines.length && !lines[i]!.trim()) i++;
  for (; i < lines.length && (meta ? meta.has(i) : /^\s*(\[[\w-]+::[^\]\n]*\]\s*)+$/.test(lines[i]!)); i++) out.add(i);
  return out;
}
