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
import { stampRecord, type RecordWho, type RecordWriter } from "./records";
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
export const promptRevOf = (reading?: FigureFitReading) => reading?.prompt.map(p => `${p.path.split("/").pop()}:${p.sha256.slice(0, 12)}`).join(" ") || "unknown";

/** A value written as a property chip: one line, with nothing that reads as a bracket or a `::` opener. */
const chipValue = (v: string) => v.replace(/[\[\]\r\n]+/g, " ").replace(/:{2,}/g, ":").trim().slice(0, 200) || "none";

/** Every value a record is stamped with, as a chip may hold it: actor ids and titles are the writer's own words. */
const clean = (props: Record<string, string>) => Object.fromEntries(Object.entries(props).map(([k, v]) => [k, chipValue(v)]));

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

const dayOf = (at: Date | number) => new Date(at).toISOString().slice(0, 10);

/** A suggestion a writer was told, as a fact, and the day's run brought up to date. Never throws. */
export async function recordSuggestion(client: SuggestionClient, fit: FigureFit, reading: FigureFitReading | undefined, at: SuggestionWrite, now = new Date()): Promise<void> {
  try {
    const day = dayOf(now);
    await stampRecord(board(client), "suggestion", clean({
      day, note: at.note, revision: String(at.revision), ...writerOf(at.actorId), component: fit.component,
      gate: String(fit.gate), confidence: String(fit.confidence), callout: fit.callouts?.join(" / ") ?? "none",
      model: reading?.model ?? "unknown", "prompt-rev": promptRevOf(reading), source: at.source, thread: at.thread ?? "none",
    }), JEV);
    await updateRun(client, day, { reading });
  } catch { /* the write has landed; a record that can't be made is not its failure */ }
}

/** Jev was asked and said nothing (`quiet`, with its reading), or couldn't be asked (`unavailable`): counted on the day's run. Never throws. */
export async function tallyAsk(client: SuggestionClient, what: "quiet" | "unavailable", reading?: FigureFitReading, now = new Date()): Promise<void> {
  try { await updateRun(client, dayOf(now), { [what]: 1, reading }); } catch { /* best-effort */ }
}

/** The key the lab's runs share (`experiment::figure-fit-live` is this one: Jev as asked while agents write). */
export const LIVE_EXPERIMENT = "figure-fit-live";

const countOf = async (client: SuggestionClient, where: string, group: string) =>
  Object.fromEntries(((await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where, machinery: "show", limit: 1, group } })).groups ?? []).map(g => [g.value ?? "", g.count]));

const setChip = (text: string, key: string, value: string | number) => {
  const chip = new RegExp(`\\[${key}::[^\\]]*\\]`);
  return chip.test(text) ? text.replace(chip, () => `[${key}::${value}]`) : text;
};
const chipNumber = (text: string, key: string) => Number(new RegExp(`\\[${key}::(\\d+(?:\\.\\d+)?)\\]`).exec(text)?.[1]) || 0;

/**
 * The day's run, one note per outline per day (`type::jev-run`, the run-level keys kitty's lab runs share, so one query
 * reads both): `items` (asks Jev answered), `suggested`, `agreed` (followed), `agreement`, `different`, `ignored`, the
 * quiet and unavailable asks, tokens, model and prompt revision. The counts are derived here from the suggestion and
 * outcome records of the day, never carried by hand; `quiet`, `unavailable` and tokens are the tally itself. The one
 * record that is rewritten, as a rate: a conflicting write loses a count rather than looping.
 */
async function updateRun(client: SuggestionClient, day: string, change: { quiet?: number; unavailable?: number; reading?: FigureFitReading }): Promise<void> {
  const find = async () => (await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: `type=jev-run experiment=${LIVE_EXPERIMENT} run=${day}`, machinery: "show", limit: 1 } })).blocks[0];
  let run = await find();
  if (!run) {
    const zero = Object.fromEntries(["items", "agreed", "agreement", "suggested", "different", "ignored", "quiet", "unavailable", "tokens-in", "tokens-out"].map(k => [k, "0"]));
    await stampRecord(board(client), "jev-run", { experiment: LIVE_EXPERIMENT, run: day, model: "unknown", "prompt-rev": "unknown", ...zero }, JEV, { title: `figure-fit ${day}` });
    run = await find();
    if (!run) return;
  }
  // One query: the suggestions have no `outcome`, so they are the group with no value; the outcomes group by theirs.
  const counted = await countOf(client, `(type=suggestion OR type=suggestion-outcome) day=${day}`, "outcome");
  const suggested = counted[""] ?? 0;
  const outcomes = counted;
  const quiet = chipNumber(run.text, "quiet") + (change.quiet ?? 0);
  let text = run.text;
  const set = (key: string, value: string | number) => { text = setChip(text, key, value); };
  set("suggested", suggested); set("agreed", outcomes.followed ?? 0); set("different", outcomes.different ?? 0); set("ignored", outcomes.ignored ?? 0);
  set("agreement", suggested ? Math.round((outcomes.followed ?? 0) / suggested * 100) / 100 : 0);
  set("quiet", quiet); set("items", suggested + quiet);
  set("unavailable", chipNumber(run.text, "unavailable") + (change.unavailable ?? 0));
  if (change.reading) {
    set("model", change.reading.model); set("prompt-rev", chipValue(promptRevOf(change.reading)));
    set("tokens-in", chipNumber(run.text, "tokens-in") + (change.reading.usage?.input ?? 0));
    set("tokens-out", chipNumber(run.text, "tokens-out") + (change.reading.usage?.output ?? 0));
  }
  if (text !== run.text) await client.request<Block>({ action: "update", blockId: run.id, text, expectedRevision: run.revision, mutation: { author: "agent", actorId: "jev/figure-fit" } });
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
 * - different: the window has closed (that many writes, or a day) and one of them drew another figure the note didn't have;
 * - ignored: it closed with neither.
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
  // The whole window is read for the figure suggested before anything else settles it, so a different figure waits for the
  // window to close: the suggested one may still follow it.
  const followed = window.find(w => figuresIn(w.text, schemas).includes(suggested) && !had.has(suggested));
  if (followed) return { outcome: "followed", because: `revision ${followed.revision} draws ${suggested}` };
  const closed = window.length >= FOLLOW_WITHIN_WRITES || now - s.at > FOLLOW_WITHIN_MS;
  if (!closed) return null;
  for (const write of window) {
    const other = figuresIn(write.text, schemas).find(name => !had.has(name));
    if (other) return { outcome: "different", because: `revision ${write.revision} draws ${other} instead` };
  }
  return { outcome: "ignored", because: `${window.length} later write${window.length === 1 ? "" : "s"} within a day drew no figure` };
}

async function read(client: SuggestionClient, where: string, limit = 1000): Promise<Block[]> {
  return (await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where, machinery: "show", limit } })).blocks;
}

/** The open suggestions among these records: the suggestions no outcome names. One query reads both kinds. */
const openOf = (records: Block[]): OpenSuggestion[] => {
  const kind = (b: Block) => propsOf(b.text).type;
  const settled = new Set(records.filter(b => kind(b) === "suggestion-outcome").map(o => propsOf(o.text).suggestion));
  return records.filter(b => kind(b) === "suggestion" && !settled.has(b.id)).map(b => {
    const p = propsOf(b.text);
    return { id: b.id, note: p.note!, revision: Number(p.revision), at: Date.parse(b.createdAt), component: p.component!, ...(p.thread && p.thread !== "none" ? { thread: p.thread } : {}), writer: p.writer, harness: p.harness, day: p.day };
  }).filter(s => s.note && Number.isFinite(s.revision) && s.component);
};

type OpenWithWho = OpenSuggestion & { writer?: string; harness?: string; day?: string };

/**
 * Settles what can be settled of one note's open suggestions against its revisions: a verdict from `judgeSuggestion`
 * becomes a `suggestion-outcome` record, once. Returns how many it wrote. Never throws.
 */
export async function settleNote(client: SuggestionClient, note: string, schemas: readonly ComponentSchema[], now = Date.now()): Promise<number> {
  try {
    const open = openOf(await read(client, `(type=suggestion OR type=suggestion-outcome) note=${note}`)) as OpenWithWho[];
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
    // Settled by another pass while this one read the revisions: one outcome per suggestion.
    if ((await read(client, `type=suggestion-outcome suggestion=${s.id}`, 1)).length) continue;
    await stampRecord(board(client), "suggestion-outcome", clean({
      day: s.day ?? dayOf(s.at), suggestion: s.id, note, outcome: verdict.outcome, component: s.component, writer: s.writer ?? "unknown", harness: s.harness ?? "unknown", because: verdict.because,
    }), JEV);
    written++;
    await updateRun(client, s.day ?? dayOf(s.at), {}).catch(() => undefined);
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
    const open = openOf(await read(client, "(type=suggestion OR type=suggestion-outcome) created >= -30d")) as OpenWithWho[];
    const byNote = new Map<string, OpenWithWho[]>();
    for (const s of open) byNote.set(s.note, [...(byNote.get(s.note) ?? []), s]);
    let written = 0;
    for (const [note, suggestions] of [...byNote].slice(0, SETTLE_NOTES_PER_PASS)) written += await settle(client, note, suggestions, schemas, now).catch(() => 0);
    return written;
  } catch { return 0; }
}
