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
import { writeShape, type ShapeFacet } from "@ep0ch/outline-core/write-shape";
import { figurePatch } from "@ep0ch/outline-core/figure-patch";
import { figuresIn, type FigureFit, type FigureFitReading } from "./figure-fit";
import { jevScope, kitIn, sectionsOf, type ReviewReading, type WriteReview } from "./write-review";
import { chips, chipValue, writeRecord, type RecordCache, type RecordWho, type RecordWriter } from "./records";
import { LOOPS_SECTION } from "./work-jev";
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
export const promptRevOf = (reading?: Pick<FigureFitReading, "prompt">) => reading?.prompt.map(p => `${p.path.split("/").pop()}:${p.sha256.slice(0, 12)}`).join(" ") || "unknown";

/** Every value a record is stamped with, as a chip may hold it: actor ids and titles are the writer's own words. */
const clean = chips;

const propsOf = (text: string) => Object.fromEntries(parsePropertyRecords(text).map(p => [p.key, p.value]));

export interface SuggestionWrite {
  /** The note written and the revision the write made. */
  note: string;
  revision: number;
  actorId: string;
  source: "write" | "sweep" | "backfill";
  /** The sweep's margin thread, when it left one. */
  thread?: string;
}

const dayOf = (at: Date | number) => new Date(at).toISOString().slice(0, 10);

/** A suggestion a writer was told, as a fact, and the day's run brought up to date. Never throws. */
export async function recordSuggestion(client: SuggestionClient, fit: FigureFit, reading: FigureFitReading | undefined, at: SuggestionWrite, now = new Date()): Promise<void> {
  try {
    const day = dayOf(now);
    await writeRecord(board(client), "suggestion", clean({
      day, note: at.note, revision: String(at.revision), ...writerOf(at.actorId), component: fit.component,
      gate: String(fit.gate), confidence: String(fit.confidence), callout: fit.callouts?.join(" / ") ?? "none",
      model: reading?.model ?? "unknown", "prompt-rev": promptRevOf(reading), source: at.source, thread: at.thread ?? "none",
    }), JEV);
    await updateRun(client, day, { reading });
  } catch { /* the write has landed; a record that can't be made is not its failure */ }
}

/**
 * What a review told its writer, as facts (PIE-1388): a `suggestion` per new finding, code's and Jev's alike, with its
 * rule, Evan's rubric item, the passage, what was said and whether a ready patch came with it; the day's run counts the
 * review's tokens. A review with nothing new is a quiet ask on the run. Never throws.
 */
export async function recordReview(client: SuggestionClient, keep: Extract<SuggestionKeep, { kind: "reviewed" }>, now = new Date()): Promise<void> {
  try {
    const day = dayOf(now), told = keep.review.findings.filter(f => f.new);
    if (told.length) await suggestionsPage(client);
    // Each finding is told once (PIE-1402: a repeat patch wrote the same one four times): one the note's records hold is skipped.
    const had = told.length && keep.at.source !== "backfill" ? await toldKeys(client, keep.at.note) : new Set<string>();
    // One lookup of the Records page and the templates for every record this review leaves.
    const cache: RecordCache = {};
    for (const f of told) {
      if (had.has(chipValue(f.key))) continue;
      had.add(chipValue(f.key));
      await writeRecord(board(client), "review-finding", {
        ...clean({
          day, note: keep.at.note, revision: String(keep.at.revision), ...writerOf(keep.at.actorId), component: f.component ?? f.rule,
          source: keep.at.source, rule: f.rule, rubric: f.rubric, key: f.key, line: String(f.line ?? 0), title: keep.title || "untitled",
          passage: f.passage, said: f.say, patch: f.patch ? "ready" : "none",
        }),
        fix: fixText(f.patch),
      }, JEV, { title: `${f.advice ? "consider" : "fix"}: ${f.rubric} in ${keep.title || "untitled"}`.slice(0, 120), cache });
    }
    const asked = keep.review.jev === "asked";
    const unavailable = !asked && !/^(?:off|not asked)/.test(keep.review.jev);
    if (keep.at.source === "backfill") return;
    await updateRun(client, day, { ...(told.length ? {} : asked ? { quiet: 1 } : {}), ...(unavailable ? { unavailable: 1 } : {}), ...(keep.reading ? { reading: keep.reading } : {}) });
  } catch { /* the write has landed; a record that can't be made is not its failure */ }
}

/**
 * The keys a note's writers were already told: its `review-finding` records' keys, as a chip holds them. The one answer
 * to "was this said before?", for the review (write-review.ts `told`) and for the records.
 */
export async function toldKeys(client: SuggestionClient, note: string): Promise<Set<string>> {
  return new Set((await read(client, `type=review-finding note=${note} NOT source=backfill`, 500)).flatMap(b => { const k = propsOf(b.text).key; return k ? [k] : []; }));
}

/** Between the pieces of a fix that edits more than one place (a question's ask, and the line it left). */
const FIX_GAP = "⋯";

/** A ready patch's new text as a record keeps it, in its code fence: each piece that writes something, a `⋯` line between. */
export function fixText(patch?: readonly { replacement: string }[]): string {
  const pieces = patch?.map(p => p.replacement.replace(/```/g, "ˋˋˋ")).filter(r => r.trim()) ?? [];
  // Fenced, so the fix's own chips and boxes stay text: a `[needs::sysop]` in it is never the record's.
  return pieces.length ? `\`\`\`text\n${pieces.join(`\n${FIX_GAP}\n`)}\n\`\`\`` : "none";
}

/** A record's fix, back as its pieces (none when it came with no patch). */
export function fixOf(recordText: string): string[] {
  const m = /\nfix:\n```text\n([\s\S]*?)\n```/.exec(recordText);
  return m ? m[1]!.split(`\n${FIX_GAP}\n`).filter(Boolean).map(p => p.replace(/ˋˋˋ/g, "```")) : [];
}

/**
 * The page a person reads the reviews on, made with the first finding an outline keeps (PIE-1388), as the Records page
 * is: each review with its note (drawn by title, linked), what was said and the passage; what the writer did; a box per
 * finding to mark Jev right (x) or wrong (`-`, Reject: the status chooser's keys), which writes `jev::right` or
 * `jev::rejected` on the record; and the
 * backfill's stats by rubric and writer. Every number is a live figure. An outline that already has a page by this
 * address (pie's, made by hand) keeps its own.
 */
export const SUGGESTIONS_PAGE = [
  "Jev's suggestions [page::jevs-suggestions] [system-view::jev-suggestions]",
  "",
  "> [!summary] Every note an agent writes is reviewed: ship, or fix with the smallest fix.",
  "> Each row is what the writer was told, the passage it was about, and what the writer did next.",
  "> Mark a finding below: x when Jev was right, - (Reject) when it was wrong. The thresholds are tuned from your marks.",
  "",
  "::graph-stat",
  "---",
  "title: last 7 days",
  'items: [{ label: findings, query: "type=review-finding NOT source=backfill created >= -7d", machinery: show }, { label: followed, query: "type=suggestion-outcome outcome=followed created >= -7d", machinery: show, accent: true }, { label: patched, query: "type=suggestion-outcome patched=yes created >= -7d", machinery: show }, { label: ignored, query: "type=suggestion-outcome outcome=ignored created >= -7d", machinery: show }]',
  "---",
  "::",
  "",
  "## Each finding, newest first",
  "::graph-table",
  "---",
  "title: what each writer was told",
  "query: type=review-finding NOT source=backfill",
  "machinery: show",
  "columns: [note, said, passage, rubric, patch, writer]",
  "link: note",
  "sort: created",
  "direction: desc",
  "limit: 30",
  "---",
  "::",
  "",
  "## What the writer did",
  "::graph-table",
  "---",
  "title: followed, patched or ignored",
  "query: type=suggestion-outcome",
  "machinery: show",
  "columns: [note, outcome, because, said, patched, writer]",
  "link: note",
  "sort: created",
  "direction: desc",
  "limit: 30",
  "---",
  "::",
  "",
  "## Was Jev right?",
  "::graph-check",
  "---",
  "title: x when Jev was right, - (Reject) when it was wrong",
  "query: type=review-finding NOT source=backfill created >= -7d",
  "machinery: show",
  // By when it was told, so a row marked stays where it was (the default, by update, moved it under the pointer).
  "sort: created",
  "direction: desc",
  "done: jev=right",
  "note: said",
  "---",
  "::",
  "",
  "## By rubric and writer",
  "::graph-matrix",
  "---",
  "title: findings, 30 days",
  "query: type=review-finding created >= -30d",
  "machinery: show",
  "down: rubric",
  "across: writer",
  "---",
  "::",
  "",
  "## Backfill runs",
  "::graph-table",
  "---",
  "title: what agents already wrote, reviewed (items reviewed, suggested flagged, quiet passed)",
  "query: type=jev-run experiment=write-review-backfill",
  "machinery: show",
  "columns: [title, items, suggested, quiet, tokens-in, model]",
  "sort: created",
  "direction: desc",
  "---",
  "::",
  "",
  LOOPS_SECTION,
].join("\n");

/**
 * How a review's record reads when it's opened (a tap on a row lands on the note; one opened another way still reads): a
 * rule note drawing a card of what the record says, its note by title and linked. A rule, so the records written
 * before it read too, with nothing rewritten.
 */
export const REVIEW_RECORDS_RULE =
  "Review records read [rule-name::review-records] [rule-match::type=review-finding OR type=suggestion OR type=suggestion-outcome] " +
  "[rule-decorate::card] [rule-place::prepend] [rule-fields::note, rubric, component, verdict, said, passage, outcome, because, writer]";

async function suggestionsPage(client: SuggestionClient): Promise<void> {
  const has = await read(client, "system-view=jev-suggestions OR page=jevs-suggestions", 1);
  if (!has.length) await client.request({ action: "create", text: SUGGESTIONS_PAGE, parentId: null, author: JEV.author, provenance: JEV.provenance } as RequestInput);
  if (!(await read(client, "rule-name=review-records", 1)).length) await client.request({ action: "create", text: REVIEW_RECORDS_RULE, parentId: null, author: JEV.author, provenance: JEV.provenance } as RequestInput);
}

/** Jev was asked and said nothing (`quiet`, with its reading), or couldn't be asked (`unavailable`): counted on the day's run. Never throws. */
export async function tallyAsk(client: SuggestionClient, what: "quiet" | "unavailable", reading?: FigureFitReading, now = new Date()): Promise<void> {
  try { await updateRun(client, dayOf(now), { [what]: 1, reading }); } catch { /* best-effort */ }
}

/** The key the lab's runs share (`experiment::figure-fit-live` is this one: Jev as asked while agents write). */
export const LIVE_EXPERIMENT = "figure-fit-live";

const countOf = async (client: SuggestionClient, where: string, group: string) =>
  Object.fromEntries(((await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where, machinery: "show", limit: 1, group } })).groups ?? []).map(g => [g.value ?? "", g.count]));

export const setChip = (text: string, key: string, value: string | number) => {
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
async function updateRun(client: SuggestionClient, day: string, change: { quiet?: number; unavailable?: number; reading?: Pick<FigureFitReading, "model" | "prompt" | "usage"> }): Promise<void> {
  const find = async () => (await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: `type=jev-run experiment=${LIVE_EXPERIMENT} run=${day}`, machinery: "show", limit: 1 } })).blocks[0];
  let run = await find();
  if (!run) {
    const zero = Object.fromEntries(["items", "agreed", "agreement", "suggested", "different", "ignored", "quiet", "unavailable", "tokens-in", "tokens-out"].map(k => [k, "0"]));
    await writeRecord(board(client), "jev-run", { experiment: LIVE_EXPERIMENT, run: day, model: "unknown", "prompt-rev": "unknown", ...zero }, JEV, { title: `figure-fit ${day}` });
    run = await find();
    if (!run) return;
  }
  const suggested = ((await countOf(client, `type=suggestion day=${day}`, "day"))[day] ?? 0) + ((await countOf(client, `type=review-finding day=${day} NOT source=backfill`, "day"))[day] ?? 0);
  const outcomes = await countOf(client, `type=suggestion-outcome day=${day}`, "outcome");
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
  /** A review's finding (PIE-1388): its rule, its key and its line; none for a figure-fit suggestion. */
  rule?: string;
  key?: string;
  line?: number;
  /** The ready patch's new text, as its record keeps it (fixOf): a later write holding it applied the patch. */
  fix?: string[];
}

/** What a later write's review said and read (PIE-1402): the keys it said, new or carried, and what Jev judged. */
export interface Heard { said: ReadonlySet<string>; judged: ReadonlySet<string> }

/** Jev's judgments: no code rule can tell they're gone, so only Jev reading the rewrite and not saying it again can. */
const JEV_RULES: ReadonlySet<string> = new Set(["dense", "mixed", "context", "argues", "unclear", "qa-for-evan"]);

/** The values a count finding's key names (`count:work-stage=queued,…`), so its patch can be made again from the note as it was. */
const facetsOfKey = (key: string): ShapeFacet[] => key.startsWith("count:") ? key.slice(6).split(",").flatMap(q => { const m = /^([^=]+)=(.*)$/.exec(q); return m ? [{ key: m[1]!, value: m[2]!.replace(/^"|"$/g, "") }] : []; }) : [];

/**
 * A review finding's verdict (PIE-1388): followed when a later write applied its ready patch (made again from the
 * note as it was), or left the note without the problem (code's rules: the same key no longer found; a kit finding:
 * the component drawn; Jev's judgments: the passage rewritten); ignored when the window closed with neither.
 */
function judgeFinding(
  s: Pick<OpenSuggestion, "component" | "at" | "rule" | "key" | "line">, baseline: string,
  window: readonly { revision: number; savedAt: string; text: string }[], schemas: readonly ComponentSchema[], closed: boolean,
  heard?: ReadonlyMap<number, Heard>, fix?: readonly string[],
): { outcome: Outcome; because: string; patched?: boolean } | null {
  const rule = s.rule!, key = s.key ?? "";
  const facets = facetsOfKey(key);
  const was = writeShape(baseline, { facets }).find(f => f.key === key);
  const kitSection = rule === "kit" && s.line ? sectionsOf(baseline).find(x => x.line + 1 === s.line) : undefined;
  const made = kitSection ? figurePatch(kitSection.text, s.component) : null;
  // The fix as it was offered (its record keeps it); a record from before it did is made again from the note as it was.
  const pieces = fix?.length ? fix : (rule === "kit" ? (made && "patch" in made ? made.patch : undefined) : was?.patch)?.map(p => p.replacement).filter(r => r.trim());
  const scope = jevScope(key);
  let rewrittenUnread: number | undefined;
  const section = s.line ? sectionsOf(baseline).find(x => x.line + 1 === s.line) : undefined;
  const named = s.line ? baseline.split("\n")[s.line - 1] : undefined;
  for (const w of window) {
    if (pieces?.length && pieces.every(p => w.text.includes(p))) return { outcome: "followed", because: `revision ${w.revision} applied the ready patch`, patched: true };
    // Jev's own judgment: followed only when Jev read the rewrite and didn't say it again; said again, it stands.
    const review = heard?.get(w.revision);
    if (review?.said.has(key) || review?.said.has(chipValue(key))) continue;
    const rewritten = section ? !w.text.includes(section.text) : named !== undefined ? !w.text.split("\n").includes(named) : w.text !== baseline;
    if (JEV_RULES.has(rule) && !was) {
      // A qa line code found by its words is gone when the line is; Jev's judgments wait for Jev to read the rewrite.
      const byWords = rule === "qa-for-evan" && !section;
      if (rewritten && byWords) return { outcome: "followed", because: `revision ${w.revision} no longer has it` };
      if (rewritten && review?.judged.has(scope)) return { outcome: "followed", because: `revision ${w.revision} rewrote it and Jev, reading it again, didn't say it` };
      if (rewritten) rewrittenUnread ??= w.revision;
      continue;
    }
    // A wall or a stacked bullet is the same problem wherever its words moved: gone only when no finding of that rule is near
    // its line (a cosmetic edit to its first words changes its key, not the problem).
    const near = (f: { rule: string; line?: number }) => f.rule === rule && Math.abs((f.line ?? 0) - (s.line ?? was?.line ?? 0)) <= 3;
    const gone = rule === "kit" ? kitIn(w.text, schemas).has(s.component)
      : was ? !writeShape(w.text, { facets }).some(f => (rule === "wall" || rule === "stacked" ? near(f) : f.key === key))
      // Otherwise (the work rules): the passage it named was rewritten. A section by its text, a line by its words, a
      // note without a line by any change.
      : rewritten;
    if (gone) return { outcome: "followed", because: rule === "kit" ? `revision ${w.revision} draws ${s.component}` : `revision ${w.revision} no longer has it` };
  }
  if (!closed) return null;
  if (rule === "kit") {
    const had = kitIn(baseline, schemas);
    for (const w of window) {
      const other = [...kitIn(w.text, schemas)].find(id => !had.has(id) && schemas.some(x => x.id === id && x.group === "figures"));
      if (other) return { outcome: "different", because: `revision ${w.revision} draws ${other} instead` };
    }
  }
  if (rewrittenUnread !== undefined) return { outcome: "ignored", because: `revision ${rewrittenUnread} rewrote it, but Jev never read it again` };
  return { outcome: "ignored", because: `${window.length} later write${window.length === 1 ? "" : "s"} within a day left it as it was` };
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
  s: Pick<OpenSuggestion, "component" | "at"> & Partial<Pick<OpenSuggestion, "rule" | "key" | "line" | "fix">>,
  baseline: string,
  after: readonly { revision: number; savedAt: string; text: string }[],
  schemas: readonly ComponentSchema[],
  now: number,
  threadLifecycle?: string,
  /** A review finding's: what the later writes' reviews said and read, by revision (the ones in hand). */
  heard?: ReadonlyMap<number, Heard>,
): { outcome: Outcome; because: string; patched?: boolean } | null {
  if (threadLifecycle === "kept") return { outcome: "followed", because: "the margin thread was kept" };
  if (s.rule) {
    const window = after.filter(w => Date.parse(w.savedAt) - s.at <= FOLLOW_WITHIN_MS).slice(0, FOLLOW_WITHIN_WRITES);
    return judgeFinding(s, baseline, window, schemas, window.length >= FOLLOW_WITHIN_WRITES || now - s.at > FOLLOW_WITHIN_MS, heard, s.fix);
  }
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

const openOf = (suggestions: Block[], outcomes: Block[]): OpenSuggestion[] => {
  const settled = new Set(outcomes.map(o => propsOf(o.text).suggestion));
  // A backfill's findings were never told to anyone: nothing to follow.
  return suggestions.filter(b => !settled.has(b.id) && propsOf(b.text).source !== "backfill").map(b => {
    const p = propsOf(b.text);
    return {
      id: b.id, note: p.note!, revision: Number(p.revision), at: Date.parse(b.createdAt), component: p.component!, ...(p.thread && p.thread !== "none" ? { thread: p.thread } : {}), writer: p.writer, harness: p.harness, day: p.day,
      ...(p.rule ? { rule: p.rule, key: p.key, line: Number(p.line) || undefined, rubric: p.rubric, title: p.title, passage: p.passage, said: p.said, fix: fixOf(b.text) } : {}),
    };
  }).filter(s => s.note && Number.isFinite(s.revision) && s.component);
};

type OpenWithWho = OpenSuggestion & { writer?: string; harness?: string; day?: string; rubric?: string; title?: string; passage?: string; said?: string };

/**
 * Settles what can be settled of one note's open suggestions against its revisions: a verdict from `judgeSuggestion`
 * becomes a `suggestion-outcome` record, once. Returns how many it wrote. Never throws.
 */
export async function settleNote(client: SuggestionClient, note: string, schemas: readonly ComponentSchema[], now = Date.now(), heard?: ReadonlyMap<number, Heard>): Promise<number> {
  try {
    const open = openOf(await read(client, `(type=suggestion OR type=review-finding) note=${note}`, 50), await read(client, `type=suggestion-outcome note=${note}`, 100)) as OpenWithWho[];
    return await settle(client, note, open, schemas, now, heard);
  } catch { return 0; }
}

async function settle(client: SuggestionClient, note: string, open: OpenWithWho[], schemas: readonly ComponentSchema[], now: number, heard?: ReadonlyMap<number, Heard>): Promise<number> {
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
    const verdict = judgeSuggestion(s, baseline, after, schemas, now, lifecycle, heard);
    if (!verdict) continue;
    // Settled by another pass while this one read the revisions: one outcome per suggestion.
    if ((await read(client, `type=suggestion-outcome suggestion=${s.id}`, 1)).length) continue;
    await writeRecord(board(client), "suggestion-outcome", clean({
      day: s.day ?? dayOf(s.at), suggestion: s.id, note, outcome: verdict.outcome, component: s.component, writer: s.writer ?? "unknown", harness: s.harness ?? "unknown", because: verdict.because,
      rule: s.rule ?? "figure-fit", rubric: s.rubric ?? "format", title: s.title ?? "none", passage: s.passage ?? "none", said: s.said ?? "none", patched: verdict.patched ? "yes" : "no",
    }), JEV, { title: `${verdict.outcome}${verdict.patched ? " (patched)" : ""}: ${s.rubric ?? s.component} in ${s.title ?? "a note"}`.slice(0, 120) });
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
    const open = openOf(await read(client, "(type=suggestion OR type=review-finding) created >= -30d"), await read(client, "type=suggestion-outcome created >= -30d")) as OpenWithWho[];
    const byNote = new Map<string, OpenWithWho[]>();
    for (const s of open) byNote.set(s.note, [...(byNote.get(s.note) ?? []), s]);
    let written = 0;
    for (const [note, suggestions] of [...byNote].slice(0, SETTLE_NOTES_PER_PASS)) written += await settle(client, note, suggestions, schemas, now).catch(() => 0);
    return written;
  } catch { return 0; }
}

// ── Kept by the service ────────────────────────────────────────────────────

/**
 * What a writer asks the service to keep of an ask to Jev (the `suggestions.keep` action). The writer is often a one-shot
 * CLI (the Claude mod's `ep0ch agent create`) that exits when its answer is printed, over a link where each request
 * costs a round trip, and the records are a dozen requests the first time (the Records page and a template per kind): it
 * was cut off part-way and the outline held nothing (pie, Oct 25). So the writer sends one request, and the service
 * makes the records in its own process, finishing whether or not anyone waits.
 */
export type SuggestionKeep =
  | { kind: "suggested"; fit: FigureFit; reading?: FigureFitReading; at: SuggestionWrite }
  | { kind: "quiet" | "unavailable"; reading?: FigureFitReading }
  /** A write's review (PIE-1388): what it told the writer, kept as a suggestion per new finding. */
  | { kind: "reviewed"; at: SuggestionWrite; title: string; review: WriteReview; reading?: ReviewReading }
  /** A note's open suggestions judged (after a write to it), or, with no note, every open one (the tidy sweep's). */
  | { kind: "settle"; note?: string };

/** A request's `keep`, checked: it arrives as JSON from any client, and says what is wrong with it. */
export function readKeep(value: unknown): SuggestionKeep {
  const keep = value as Partial<SuggestionKeep> | null | undefined;
  const text = (v: unknown, what: string) => { if (typeof v !== "string" || !v) throw new Error(`suggestions.keep: ${what} is a non-empty string`); return v; };
  if (!keep || typeof keep !== "object") throw new Error("suggestions.keep needs keep: {kind: suggested | quiet | unavailable | settle, …}");
  if (keep.kind === "reviewed") {
    const { at, review } = keep as Extract<SuggestionKeep, { kind: "reviewed" }>;
    if (!at || typeof at !== "object" || !Number.isInteger(at.revision) || !["write", "backfill"].includes(at.source)) throw new Error("suggestions.keep: a reviewed keep needs at: {note, revision, actorId, source: write | backfill}");
    text(at.note, "at.note"); text(at.actorId, "at.actorId");
    if (!review || !Array.isArray(review.findings) || (review.verdict !== "ship" && review.verdict !== "fix")) throw new Error("suggestions.keep: a reviewed keep needs review: {verdict: ship | fix, findings: […]}");
    return keep as SuggestionKeep;
  }
  if (keep.kind === "settle") return { kind: "settle", ...(keep.note === undefined ? {} : { note: text(keep.note, "note") }) };
  if (keep.kind === "quiet" || keep.kind === "unavailable") return { kind: keep.kind, ...(keep.reading ? { reading: keep.reading } : {}) };
  if (keep.kind === "suggested") {
    const { fit, at } = keep;
    if (!fit || typeof fit !== "object" || !fit.component || typeof fit.component !== "string") throw new Error("suggestions.keep: a suggested keep needs fit.component");
    if (!at || typeof at !== "object" || !Number.isInteger(at.revision) || at.source !== "write" && at.source !== "sweep") throw new Error("suggestions.keep: a suggested keep needs at: {note, revision, actorId, source}");
    text(at.note, "at.note"); text(at.actorId, "at.actorId");
    return { kind: "suggested", fit, ...(keep.reading ? { reading: keep.reading } : {}), at };
  }
  throw new Error(`suggestions.keep: kind is suggested, reviewed, quiet, unavailable or settle (got ${JSON.stringify((keep as { kind?: unknown }).kind)})`);
}

/**
 * Makes the records `keep` asks for, as the service (`client` is the service's own): a suggestion's fact and the day's run,
 * then the open suggestions settled (every recorded suggestion settles the day-old ones, so a quiet outline settles itself
 * the next time Jev speaks); a quiet or unavailable ask counted on the day's run; or the settling alone. Returns the
 * outcomes it wrote. Never throws.
 */
export async function keepSuggestion(client: SuggestionClient, keep: SuggestionKeep, schemas: readonly ComponentSchema[]): Promise<number> {
  switch (keep.kind) {
    case "suggested":
      await recordSuggestion(client, keep.fit, keep.reading, keep.at);
      // A write's suggestion also settles the day-old ones; the sweep settles once, before it starts.
      return keep.at.source === "write" ? settleOpen(client, schemas) : 0;
    case "reviewed": {
      await recordReview(client, keep);
      if (keep.at.source !== "write") return 0;
      // The note's earlier findings are judged against this write; a review that told something new also settles the
      // day-old ones anywhere (as a figure suggestion did), so an ordinary clean write costs one note's settling.
      // What this write's review said (new or carried) and what Jev read: how a Jev finding is known fixed, or not.
      // Both as written and as a record's chip holds them, so a stored key with brackets in it still meets them.
      const both = (xs: readonly string[]) => new Set(xs.flatMap(x => [x, chipValue(x)]));
      const heard = new Map([[keep.at.revision, { said: both(keep.review.findings.map(f => f.key)), judged: both(keep.review.judged ?? []) }]]);
      const here = await settleNote(client, keep.at.note, schemas, Date.now(), heard);
      return here + (keep.review.findings.some(f => f.new) ? await settleOpen(client, schemas) : 0);
    }
    case "quiet":
    case "unavailable":
      await tallyAsk(client, keep.kind, keep.reading);
      return 0;
    case "settle":
      return keep.note ? settleNote(client, keep.note, schemas) : settleOpen(client, schemas);
  }
}
