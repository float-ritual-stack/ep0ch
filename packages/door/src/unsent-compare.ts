// The three-way comparison behind an unsent edit (PIE-637), and the one set of words every surface says it in.
// A draft put aside has three texts: the one it started from (its base), the draft, and the note now. Its own changes
// are base→draft; each is already in the note, still new, or changed differently since. Pure: no I/O, no put-aside
// files (src/unsent.ts reads those), so the reader, the exit message and anything that lists drafts say the same thing.
import type { DraftPatchSpan } from "@ep0ch/outline-core/draft-patch-compare";
import { DRAFT_PATCH_CONTEXT, locateSpanForced } from "@ep0ch/outline-core/draft-patch-compare";
import { diffLines } from "diff";

// ── a draft's own changes ────────────────────────────────────────────────────

/**
 * One change a draft made to the text it started from, in that text's lines: lines `[start, end)` read `removed` and
 * became `added`. `span` is the same change as one compare-and-swap of `draft.patch` (null when the text had no lines
 * to compare against).
 */
export interface DraftHunk { start: number; end: number; removed: string[]; added: string[]; span: DraftPatchSpan | null }

/**
 * The changes `put` made to the text it started from (`from`), one hunk each. The span is the lines it changed as they
 * read then (or, for lines it added, the lines either side), what they became, and a few lines of context. Applied to
 * an edit of the note now (Draft.applyPatch, forced: the person's own choice), a span whose passage changed since isn't
 * found and changes nothing, so newer text is never overwritten.
 */
export function draftHunks(from: string, put: string): DraftHunk[] {
  const a = from.split("\n"), out: DraftHunk[] = [];
  const offsetOf = (line: number) => a.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
  const ctx = (s: string, far: "start" | "end") => (far === "start" ? s.slice(-DRAFT_PATCH_CONTEXT) : s.slice(0, DRAFT_PATCH_CONTEXT));
  let line = 0;
  const parts = diffLines(`${from}\n`, `${put}\n`);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!, count = p.value.replace(/\n$/, "").split("\n").length;
    if (!p.added && !p.removed) { line += count; continue; }
    // A removed run, and the added run that replaces it (when one follows).
    const removed = p.removed ? count : 0;
    const next = p.removed ? parts[i + 1] : p;
    const added = next?.added ? next.value.replace(/\n$/, "").split("\n") : [];
    if (p.removed && next?.added) i++;
    const start = line, end = line + removed;
    line = end;
    // The window compared: the changed lines, else (lines only added) the lines either side of where they go.
    const lo = removed ? start : Math.max(0, start - 1), hi = removed ? end : Math.min(a.length, start + 1);
    const hunk = { start, end, removed: a.slice(start, end), added };
    if (lo === hi) { out.push({ ...hunk, span: null }); continue; }   // nothing to compare against (the note was empty)
    const observed = a.slice(lo, hi).join("\n");
    const replaced = [...a.slice(lo, start), ...added, ...a.slice(end, hi)];
    // A run taken out entirely takes its line break with it.
    let obs = observed, rep = replaced.join("\n"), at = offsetOf(lo);
    if (!replaced.length) {
      if (hi < a.length) { obs += "\n"; }
      else if (lo > 0) { obs = "\n" + obs; at -= 1; }
      rep = "";
    }
    out.push({ ...hunk, span: { observed: obs, replacement: rep, range: { start: at, end: at + obs.length }, before: ctx(from.slice(0, at), "start"), after: ctx(from.slice(at + obs.length), "end") } });
  }
  return out;
}

/** The hunks as `draft.patch` spans ("add them", and the old "take it back"). */
export const takeBackSpans = (from: string, put: string): DraftPatchSpan[] => draftHunks(from, put).flatMap(h => (h.span ? [h.span] : []));

// ── the three-way comparison ─────────────────────────────────────────────────

/**
 * Where a draft's change stands against the note now: `already` (the note has it), `new` (the passage it changed still
 * reads as the draft saw it, so it can be added), `conflict` (that passage was changed differently since), or `differs`
 * (a two-way comparison: no base text, so nothing can be told from what changed since).
 */
export type HunkState = "already" | "new" | "conflict" | "differs";

/** A draft's change and where it stands; `now`: for a conflict, the lines the note has there now (null: that part was rewritten). */
export interface Hunk extends DraftHunk { state: HunkState; now: string[] | null }

/**
 * What the comparison says, up front: `nothing-new` (every change is already in the note: resolve it quietly), `new`
 * (some lines aren't in the note yet), `conflict` (some were changed differently since), `differs` (two-way).
 */
export interface Verdict { basis: "three-way" | "two-way"; kind: "nothing-new" | "new" | "conflict" | "differs"; hunks: Hunk[] }

const blank = (ls: string[]) => ls.every(l => !l.trim());
/** Whether `block` is in `lines` as consecutive lines. */
const blockIn = (lines: string[], block: string[]) => {
  for (let i = 0; i + block.length <= lines.length; i++) if (block.every((l, j) => lines[i + j]!.trimEnd() === l.trimEnd())) return true;
  return false;
};

/**
 * Compare a draft with the note now through the text it started from. Each of the draft's changes (base→draft) is
 * classified against the note (base→now): its lines are already there; or the passage it changed is still as the draft
 * saw it (new: it applies); or neither (a conflict, with the note's version of that passage). With no base the
 * comparison is the two-way one (draft against note) and says so: it never calls anything already in the note.
 */
export function compareDraft(base: string | null, draft: string, now: string): Verdict {
  if (base === null) return { basis: "two-way", kind: "differs", hunks: draftHunks(now, draft).map(h => ({ ...h, state: "differs" as const, now: null })) };
  const nowLines = now.split("\n"), baseLines = base.split("\n");
  const hunks = draftHunks(base, draft).map((h): Hunk => {
    // What the note has between the unchanged lines either side of the passage, when both are still there: where this
    // change would be. A line elsewhere in the note that reads the same is not the change being in the note.
    const before = h.start > 0 ? baseLines[h.start - 1]! : null, after = h.end < baseLines.length ? baseLines[h.end]! : null;
    const i = before === null ? -1 : nowLines.indexOf(before), j = after === null ? nowLines.length : nowLines.indexOf(after, i + 1);
    const region = (before === null || i >= 0) && j >= 0 ? nowLines.slice(i + 1, j) : null;
    if (h.added.length && !blank(h.added) && region && blockIn(region, h.added)) return { ...h, state: "already", now: null };
    // Lines it took out are gone from the note when the lines either side meet.
    if (!h.added.length && h.removed.length && !blank(h.removed) && !blockIn(nowLines, h.removed) && region?.length === 0) return { ...h, state: "already", now: null };
    // New: the lines it changed (or, for lines it added, the lines either side) are still there whole, so it applies.
    const beside = h.removed.length ? h.removed : baseLines.slice(Math.max(0, h.start - 1), Math.min(baseLines.length, h.start + 1));
    if (h.span && blockIn(nowLines, beside) && !("reason" in locateSpanForced(now, h.span))) return { ...h, state: "new", now: null };
    return { ...h, state: "conflict", now: region };
  });
  const clash = hunks.some(h => h.state === "conflict"), fresh = hunks.some(h => h.state === "new");
  return { basis: "three-way", kind: clash ? "conflict" : fresh ? "new" : "nothing-new", hunks };
}

/** The lines a hunk touches, for counting ("2 lines"). */
export const hunkLines = (h: Hunk | DraftHunk) => Math.max(1, Math.max(h.added.filter(l => l.trim()).length, h.removed.filter(l => l.trim()).length));
/** The hunks of one state. */
export const hunksOf = (v: Verdict, state: HunkState) => v.hunks.filter(h => h.state === state);
/** How many lines the hunks of one state touch. */
export const linesOf = (v: Verdict, state: HunkState) => hunksOf(v, state).reduce((n, h) => n + hunkLines(h), 0);

// ── the words ────────────────────────────────────────────────────────────────

const lines = (n: number) => `${n} line${n === 1 ? "" : "s"}`;

/** "today", "yesterday" or "Oct 1": when an edit was put aside, as prose. */
export function dayOf(at: number, now = Date.now()): string {
  const d = new Date(at), today = new Date(now), yesterday = new Date(now - 86_400_000);
  return d.toDateString() === today.toDateString() ? "today" : d.toDateString() === yesterday.toDateString() ? "yesterday" : d.toDateString().slice(4, 10).replace(/ 0/, " ");
}
/** "today", "yesterday" or "on Oct 1": for "your edit …". */
export const onDay = (day: string) => (day === "today" || day === "yesterday" ? day : `on ${day}`);

/**
 * The answer, in a sentence: what the comparison found. The reader's line, the compare view's headline and anything
 * else that lists drafts say it this way. `day`: when the edit was written ("Oct 1").
 */
export function verdictWords(v: Verdict, day: string): string {
  const fresh = linesOf(v, "new"), clash = linesOf(v, "conflict"), mine = onDay(day);
  if (v.kind === "nothing-new") return `your edit ${mine} was already in the note`;
  if (v.kind === "differs") {
    const n = v.hunks.reduce((s, h) => s + hunkLines(h), 0);
    return n ? `your edit ${mine} differs from the note in ${lines(n)} · its starting text isn't kept, so what's new can't be told from what changed since` : `your edit ${mine} reads the same as the note now`;
  }
  const newer = fresh ? `${lines(fresh)} from your edit ${mine} ${fresh === 1 ? "isn't" : "aren't"} in the note` : "";
  const differently = clash ? (fresh ? `${clash} ${clash === 1 ? "was" : "were"} changed differently since` : `${lines(clash)} from your edit ${mine} ${clash === 1 ? "was" : "were"} changed differently since`) : "";
  return [newer, differently].filter(Boolean).join(" · ");
}

/** The sentence that opens the compare view: what happened, and that nothing is lost. */
export function startedWords(day: string, behind: number | undefined): string {
  return `You started editing this ${onDay(day)} and didn't save.${behind && behind > 0 ? ` The note has changed ${behind} time${behind === 1 ? "" : "s"} since.` : ""} Your edit is kept here.`;
}

/** What leaving a draft that wasn't saved says: kept here, not `verbed` (saved, sent, created). */
export const keptNot = (what: string, verbed: string) => `${what} is kept here, not ${verbed}`;
