// Jev's suggestions as records (PIE-1251, the work-record capability's "facts, then reconciliation"): the figure
// suggestion a write's answer carries (figure-fit.ts) was returned and forgotten; now each leaves a fact, and whether it
// was followed is judged by a rule over the facts and the note's own revisions, never typed by hand.
//
// - `suggestion`: a fact per suggestion a writer was actually told (note, revision, writer and harness, the figure, Jev's
//   gate and confidence, the callout it named, the prompt revision). Written once.
// - `suggestion-day`: a daily tally per outline of asks where Jev stayed quiet (or couldn't answer), so the rate is
//   honest without a note each. The one record that is counted up in place; the ticket asks for a count, not a log.
// - `suggestion-outcome`: written once by `judgeSuggestion`'s verdict (the `finding-closed` pattern: records never
//   change, the join is a later record): followed, a different figure, or ignored. A live figure can't join a record to
//   a note's text, so the rule runs in code and leaves its verdict as a property the figures count.
//
// Everything here is best-effort: the write has landed and its answer must not wait on, or fail for, bookkeeping.
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { blockNameOf } from "@ep0ch/outline-core/component-warnings";
import type { ComponentSchema } from "@ep0ch/outline-core/component-schema";
import type { BlockRevisions } from "@ep0ch/outline-core/protocol";
import type { RequestInput } from "./client";
import { figuresIn, type FigureFit, type FigureFitReading } from "./figure-fit";
import { writeRecord, type RecordWho, type RecordWriter } from "./records";
import type { AnnotationThread, Block, VisibleBlockCollection } from "./types";

/** A suggestion is followed when one of the note's next writes, within a day, draws the figure; this many writes count. */
export const FOLLOW_WITHIN_WRITES = 5;
export const FOLLOW_WITHIN_MS = 24 * 60 * 60 * 1000;
/** At most this many notes' open suggestions are settled by one pass. */
const SETTLE_NOTES_PER_PASS = 20;

export interface SuggestionClient { request<T>(input: RequestInput, timeoutMs?: number): Promise<T> }

/** Jev writes the records, as itself: the writer the record is about is a field. */
const JEV: RecordWho = { author: "agent", provenance: { actorId: "jev/figure-fit" } };
const board = (client: SuggestionClient): RecordWriter => ({ request: (action, params) => client.request({ action, ...params } as RequestInput) });

/** `loki/claude-code@float-box` is the persona `loki` writing through the harness `claude-code`; an id with no `/` has no harness named. */
export function writerOf(actorId: string): { writer: string; harness: string } {
  const slash = actorId.indexOf("/");
  if (slash < 0) return { writer: actorId, harness: "unknown" };
  return { writer: actorId.slice(0, slash), harness: actorId.slice(slash + 1).replace(/@.*$/, "") || "unknown" };
}

/** The prompt revisions a reading was made with, as short names: `figure-fit.json:1a2b3c4d5e6f`. */
const promptOf = (reading?: FigureFitReading) => reading?.prompt.map(p => `${p.path.split("/").pop()}:${p.sha256.slice(0, 12)}`).join(" ") || "unknown";

/** A value written as a property chip: one line, with nothing that reads as a bracket or a `::` opener. */
const chipValue = (v: string) => v.replace(/[\[\]\r\n]+/g, " ").replace(/:{2,}/g, ":").trim().slice(0, 200) || "none";

const propsOf = (text: string) => Object.fromEntries(parsePropertyRecords(text).map(p => [p.key, p.value]));

export interface SuggestionWrite {
  /** The note written and the revision the write made. */
  note: string;
  revision: number;
  actorId: string;
  source: "write" | "sweep";
  /** The sweep's margin thread, when it left one. */
  thread?: string;
}

/** A suggestion a writer was told, as a fact. Never throws. */
export async function recordSuggestion(client: SuggestionClient, fit: FigureFit, reading: FigureFitReading | undefined, at: SuggestionWrite): Promise<void> {
  try {
    await writeRecord(board(client), "suggestion", {
      note: at.note, revision: String(at.revision), ...writerOf(at.actorId), component: fit.component,
      gate: String(fit.gate), confidence: String(fit.confidence), callout: chipValue(fit.callouts?.join(" / ") ?? "none"),
      prompt: promptOf(reading), source: at.source, thread: at.thread ?? "none",
    }, JEV);
  } catch { /* the write has landed; a record that can't be made is not its failure */ }
}

/** Jev was asked and said nothing (`quiet`), or couldn't be asked (`unavailable`): one count up on the day's tally. Never throws. */
export async function tallyAsk(client: SuggestionClient, what: "quiet" | "unavailable", now = new Date()): Promise<void> {
  try {
    const day = now.toISOString().slice(0, 10);
    const found = await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: `type=suggestion-day day=${day}`, machinery: "show", limit: 1 } });
    const tally = found.blocks[0];
    if (!tally) {
      await writeRecord(board(client), "suggestion-day", { day, quiet: what === "quiet" ? "1" : "0", unavailable: what === "unavailable" ? "1" : "0" }, JEV, { title: `Jev's asks ${day}` });
      return;
    }
    const chip = new RegExp(`\\[${what}::(\\d+)\\]`);
    const count = Number(chip.exec(tally.text)?.[1]);
    if (!Number.isFinite(count)) return;
    // A conflict (another writer counted first) loses this one count rather than looping: the tally is a rate, not a ledger.
    await client.request<Block>({ action: "update", blockId: tally.id, text: tally.text.replace(chip, `[${what}::${count + 1}]`), expectedRevision: tally.revision, mutation: { author: "agent", actorId: "jev/figure-fit" } });
  } catch { /* best-effort */ }
}

// ── The rule ───────────────────────────────────────────────────────────────

export type Outcome = "followed" | "different" | "ignored";

export interface OpenSuggestion {
  id: string;
  note: string;
  /** The revision the write made, and when the suggestion was told (ms). */
  revision: number;
  at: number;
  component: string;
  thread?: string;
}

/**
 * Whether a suggestion was followed, a different figure was drawn instead, or it was ignored; null while it is still
 * open. Pure: the note as the write left it (`baseline`), the writes after it (oldest first, with when each was saved),
 * and the suggestion's thread lifecycle when the sweep left one.
 *
 * - followed: one of the note's next `FOLLOW_WITHIN_WRITES` writes within a day draws the figure suggested, or the
 *   margin thread was marked Kept (the ticket's reading of Kept);
 * - different: such a write draws another figure the note didn't have;
 * - ignored: neither, and the window has closed (that many writes, or a day).
 */
export function judgeSuggestion(
  s: Pick<OpenSuggestion, "component" | "at">,
  baseline: string,
  after: readonly { revision: number; savedAt: string; text: string }[],
  schemas: readonly ComponentSchema[],
  now: number,
  threadLifecycle?: string,
): { outcome: Outcome; because: string } | null {
  if (threadLifecycle === "kept") return { outcome: "followed", because: "the margin thread was kept" };
  const schema = schemas.find(x => x.id === s.component);
  const suggested = (schema && blockNameOf(schema)) ?? s.component;
  const had = new Set(figuresIn(baseline, schemas));
  const window = after.filter(w => Date.parse(w.savedAt) - s.at <= FOLLOW_WITHIN_MS).slice(0, FOLLOW_WITHIN_WRITES);
  for (const write of window) {
    const drawn = figuresIn(write.text, schemas);
    if (drawn.includes(suggested) && !had.has(suggested)) return { outcome: "followed", because: `revision ${write.revision} draws ${suggested}` };
    const other = drawn.find(name => !had.has(name));
    if (other) return { outcome: "different", because: `revision ${write.revision} draws ${other} instead` };
  }
  const closed = window.length >= FOLLOW_WITHIN_WRITES || now - s.at > FOLLOW_WITHIN_MS;
  return closed ? { outcome: "ignored", because: `${window.length} later write${window.length === 1 ? "" : "s"} within a day drew no figure` } : null;
}

async function read(client: SuggestionClient, where: string, limit = 500): Promise<Block[]> {
  return (await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where, machinery: "show", limit } })).blocks;
}

const openOf = (suggestions: Block[], outcomes: Block[]): OpenSuggestion[] => {
  const settled = new Set(outcomes.map(o => propsOf(o.text).suggestion));
  return suggestions.filter(b => !settled.has(b.id)).map(b => {
    const p = propsOf(b.text);
    return { id: b.id, note: p.note!, revision: Number(p.revision), at: Date.parse(b.createdAt), component: p.component!, ...(p.thread && p.thread !== "none" ? { thread: p.thread } : {}), writer: p.writer, harness: p.harness };
  }).filter(s => s.note && Number.isFinite(s.revision) && s.component);
};

type OpenWithWho = OpenSuggestion & { writer?: string; harness?: string };

/**
 * Settles what can be settled of one note's open suggestions against its revisions: a verdict from `judgeSuggestion`
 * becomes a `suggestion-outcome` record, once. Returns how many it wrote. Never throws.
 */
export async function settleNote(client: SuggestionClient, note: string, schemas: readonly ComponentSchema[], now = Date.now()): Promise<number> {
  try {
    const open = openOf(await read(client, `type=suggestion note=${note}`, 50), await read(client, `type=suggestion-outcome note=${note}`, 100)) as OpenWithWho[];
    return await settle(client, note, open, schemas, now);
  } catch { return 0; }
}

async function settle(client: SuggestionClient, note: string, open: OpenWithWho[], schemas: readonly ComponentSchema[], now: number): Promise<number> {
  if (!open.length) return 0;
  const list = await client.request<BlockRevisions>({ action: "block.revisions", blockId: note });
  const text = async (revision: number) => (await client.request<{ text: string }>({ action: "block.revisions", blockId: note, revision })).text;
  let threads: AnnotationThread[] | undefined;
  let written = 0;
  for (const s of open) {
    let lifecycle: string | undefined;
    if (s.thread) {
      threads ??= await client.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: note }, includeResolved: true } });
      lifecycle = threads.find(t => t.block.id === s.thread)?.lifecycle;
    }
    // Only the revisions the verdict can read: the baseline, and the next few writes.
    const later = list.revisions.filter(r => r.revision > s.revision).sort((a, b) => a.revision - b.revision).slice(0, FOLLOW_WITHIN_WRITES);
    const baseline = list.revisions.some(r => r.revision === s.revision) ? await text(s.revision) : "";
    const after = await Promise.all(later.map(async r => ({ revision: r.revision, savedAt: r.savedAt, text: await text(r.revision) })));
    const verdict = judgeSuggestion(s, baseline, after, schemas, now, lifecycle);
    if (!verdict) continue;
    await writeRecord(board(client), "suggestion-outcome", {
      suggestion: s.id, note, outcome: verdict.outcome, component: s.component, writer: s.writer ?? "unknown", harness: s.harness ?? "unknown", because: chipValue(verdict.because),
    }, JEV);
    written++;
  }
  return written;
}

/**
 * Every open suggestion of the last 30 days, settled (a day-old one with no figure becomes `ignored` here: nothing else
 * runs at that moment). `figure-fit` calls it, and so does every recorded suggestion, so a quiet outline settles
 * itself the next time Jev speaks. Never throws.
 */
export async function settleOpen(client: SuggestionClient, schemas: readonly ComponentSchema[], now = Date.now()): Promise<number> {
  try {
    const open = openOf(await read(client, "type=suggestion created >= -30d"), await read(client, "type=suggestion-outcome created >= -30d")) as OpenWithWho[];
    const byNote = new Map<string, OpenWithWho[]>();
    for (const s of open) byNote.set(s.note, [...(byNote.get(s.note) ?? []), s]);
    let written = 0;
    for (const [note, suggestions] of [...byNote].slice(0, SETTLE_NOTES_PER_PASS)) written += await settle(client, note, suggestions, schemas, now).catch(() => 0);
    return written;
  } catch { return 0; }
}
