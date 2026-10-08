// What the reader makes of drafts put aside as unsent (src/draft-session.ts keeps them): the `■` lines with their
// controls, the compare view of one (its own changes only, each marked already in the note, still new or changed
// differently since: src/unsent-compare.ts), the quiet resolve of one the note already has, and the copy every way of
// letting one go keeps. Pure but for the put-aside files it reads through draft-session.ts.
import { existsSync } from "node:fs";
import { diffLines } from "diff";
import { UNSENT_NOTE } from "./authored";
import { subject, type Msg } from "./board";
import { keepCopy } from "./edit";
import { unsent, unshelve, type Unsent } from "./draft-session";
import { compareDraft, dayOf, onDay, startedWords, takeBackSpans, verdictWords, type Hunk, type Verdict } from "./unsent-compare";

export { takeBackSpans };

/** What can be put aside on a note, and its place key's prefix. */
export type UnsentKind = "edit" | "comment" | "child" | "card";
/** A control on a kept-draft line (each an action: `unsent.<op>`). */
export type UnsentOp = "diff" | "copy" | "dismiss" | "add" | "keep" | "show";
/** The words drawn for each control. `diff` reads "[show them]" when the comparison found new lines (see `unsentLabel`). */
export const UNSENT_LABEL: Record<UnsentOp, string> = { diff: "[compare]", copy: "[open copy]", dismiss: "[let it go]", add: "[add them]", keep: "[keep as a note]", show: "[show]" };
/** A control's words for what the comparison found. */
export const unsentLabel = (op: UnsentOp, v?: Verdict | null) => (op === "diff" && v?.kind === "new" ? "[show them]" : UNSENT_LABEL[op]);

/** An edit put aside on an older revision more than this many days ago folds into one dim line. */
export const OLD_UNSENT_DAYS = 3;

/**
 * One kept-draft line of a note: what's kept there, whether it's on an older revision, the comparison with the note now
 * (an edit), and the controls it offers. `pending`: its starting text is being read from the note's history.
 */
export interface UnsentEntry { kind: UnsentKind; place: string; u: Unsent; stale: boolean; old: boolean; text: string; ops: UnsentOp[]; verdict: Verdict | null; pending: boolean }

const WHAT: Record<UnsentKind, string> = { edit: "edit", comment: "comment", child: "note under this", card: "new card" };
const BACK: Record<UnsentKind, string> = { edit: "e brings it back", comment: "C and a passage bring it back", child: "N on the card brings it back", card: "n in this lane brings it back" };

/** What the lines of a note are drawn against: its text now, how to read an edit's starting text, or a verdict a view carries. */
export interface UnsentContext {
  /** The note's text now (absent in a view of what's kept: `verdict` stands in). */
  text?: string;
  /** An edit's starting text when the draft didn't keep it: from the note's history (undefined while it's being read, null when it isn't kept). */
  baseOf?: (u: Unsent) => string | null | undefined;
  /** The comparison a compare or copy view was built with, by the note it's about. */
  verdict?: Verdict | null;
}

/** The comparison a view (`unsent:<id>#diff`, `#copy`) was built with, by the note it's about: its lines say the same. */
const VIEW_VERDICTS = new Map<string, Verdict>();
export const viewVerdict = (of: string) => VIEW_VERDICTS.get(of) ?? null;

/** The controls an edit offers for what was found. */
function editOps(v: Verdict | null, pending: boolean): UnsentOp[] {
  if (pending || !v) return ["copy", "dismiss"];
  if (v.kind === "nothing-new") return ["copy", "dismiss"];
  if (v.kind === "differs") return ["diff", "copy", "keep", "dismiss"];
  return v.hunks.some(h => h.state === "new") ? ["diff", "add", "keep", "dismiss"] : ["diff", "keep", "dismiss"];
}

/**
 * What's kept on note `id` (an edit or a comment on it, a new note under it, a new card in its lane), newest kind first
 * as the reader lists them. An edit is compared with the note now through the text it started from (the comparison's
 * answer is the line's words: src/unsent-compare.ts); one on another revision than the note's now (`revision`) isn't
 * brought back by `e`, and the line says what's new in it instead.
 */
export function unsentEntries(id: string, revision: number | undefined, ctx: UnsentContext, day: (at: number) => string = dayOf, now = Date.now()): UnsentEntry[] {
  const out: UnsentEntry[] = [];
  for (const kind of ["edit", "comment", "child", "card"] as const) {
    const place = `${kind}:${id}`, u = unsent(place);
    if (!u) continue;
    const stale = kind === "edit" && revision !== undefined && u.base !== revision;
    const old = stale && now - u.at > OLD_UNSENT_DAYS * 86_400_000;
    if (kind !== "edit") {
      out.push({ kind, place, u, stale, old, text: `■ your ${WHAT[kind]} from ${day(u.at)} is kept here · ${BACK[kind]}`, ops: ["copy", "dismiss"], verdict: null, pending: false });
      continue;
    }
    // The text it started from: its own, else the note now (it was written on this revision), else the note's history.
    const base = u.from !== undefined ? u.from : !stale && ctx.text !== undefined ? ctx.text : ctx.baseOf?.(u);
    const pending = ctx.verdict === undefined && ctx.text !== undefined && base === undefined;
    const verdict = ctx.verdict !== undefined ? ctx.verdict : ctx.text !== undefined && base !== undefined ? compareDraft(base, u.text, ctx.text) : null;
    const text = pending ? `■ your edit ${onDay(day(u.at))} is kept here · comparing it with the note's history…` : verdict ? `■ ${verdictWords(verdict, day(u.at))}` : `■ your edit ${onDay(day(u.at))} is kept here · ${BACK[kind]}`;
    out.push({ kind, place, u, stale, old, text, ops: editOps(verdict, pending), verdict, pending });
  }
  return out;
}

/** The dim chip old edits fold into: "1 old edit". */
export const oldUnsentLine = (n: number) => `■ ${n} old edit${n === 1 ? "" : "s"}`;

// ── the starting text, and letting one go without losing it ──────────────────

/** The board calls this needs (the service client has them). */
export interface HistoryBoard { revisionText(blockId: string, revision: number): Promise<{ text: string }> }

/**
 * The text an unsent edit started from: its own (drafts keep it), else the note's text when the note is still at the
 * revision it was written on, else that revision from the note's history (#277); null when none is kept.
 */
export async function baseTextOf(u: Unsent, of: string, note: Pick<Msg, "text" | "revision">, board: HistoryBoard): Promise<string | null> {
  if (u.from !== undefined) return u.from;
  if (note.revision !== undefined && u.base === note.revision) return note.text;
  try { return (await board.revisionText(of, u.base)).text; } catch { return null; }
}

/** A copy of what's kept on disk, written if it isn't there (an entry made without one, or one pruned): letting one go never loses its text. */
export function copyOf(u: Unsent, label: string): string {
  return u.copy && existsSync(u.copy) ? u.copy : keepCopy(u.text + "\n", label);
}

/**
 * An edit kept on `note` whose every change the note already has resolves by itself: its copy is written, its entry goes,
 * and what it did is returned for one dim line. Nothing else changes; null when there is nothing to resolve (no edit,
 * no base text to compare with, or something in it the note doesn't have).
 */
export async function settleQuietly(note: Msg, board: HistoryBoard): Promise<{ copy: string; day: string } | null> {
  const key = `edit:${note.id}`, u = unsent(key);
  if (!u || note.partial) return null;
  const base = await baseTextOf(u, note.id, note, board);
  if (base === null || compareDraft(base, u.text, note.text).kind !== "nothing-new") return null;
  const now = unsent(key);
  if (!now || now.at !== u.at) return null;                                    // put aside again meanwhile: not ours to resolve
  const copy = copyOf(u, note.id.slice(0, 8));
  unshelve(key);
  return { copy, day: dayOf(u.at) };
}

// ── the views beside a note: its comparison, its copy ────────────────────────

/** The note a view `unsent:<id>#diff` (or `#copy`) is about, and which view; null for any other note. */
export function unsentView(id: string): { of: string; view: "diff" | "copy" } | null {
  const m = /^unsent:([^#]+)#(diff|copy)$/.exec(id);
  return m ? { of: m[1]!, view: m[2] as "diff" | "copy" } : null;
}

/** The text with every line marked: ` ` the same, `-` in the note now only, `+` in the unsent text only. */
export function diffRows(now: string, put: string): string[] {
  const rows: string[] = [];
  // Both end in a line break, so a last line isn't read as changed for want of one.
  for (const part of diffLines(`${now}\n`, `${put}\n`)) {
    const lines = part.value.replace(/\n$/, "").split("\n");
    for (const l of lines) rows.push(`${part.added ? "+" : part.removed ? "-" : " "} ${l}`);
  }
  return rows;
}

/** A fence longer than any run of backticks in `text`, so nothing in it can close the fence. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(r => r.length));
  return "`".repeat(Math.max(3, longest + 1));
}

const STATE_WORDS: Record<Hunk["state"], string> = { already: "already in the note", new: "still new", conflict: "changed differently since", differs: "differs" };

/** One hunk as diff rows: its header (where, and where it stands), what the edit replaced, what it wrote, and for a conflict the note's version. */
function hunkRows(h: Hunk): string[] {
  return [
    `@@ line ${h.start + 1} · ${STATE_WORDS[h.state]} @@`,
    ...h.removed.map(l => `- ${l}`),
    ...h.added.map(l => `+ ${l}`),
    ...(h.state === "conflict" ? (h.now ? h.now.map(l => `  the note now: ${l}`) : ["  the note now: that part was rewritten"]) : []),
  ];
}

/**
 * The compare view of an edit kept on `m`, as a note a reader draws (a ```diff fence colours it): the answer first, then
 * only the edit's own changes, each marked. With no starting text (`base` null) it is the two-way comparison with the
 * note now, and says so.
 */
export function diffNote(m: Msg, u: Unsent, base: string | null): Msg {
  const verdict = compareDraft(base, u.text, m.text), day = dayOf(u.at);
  VIEW_VERDICTS.set(m.id, verdict);
  const behind = m.revision !== undefined ? m.revision - u.base : undefined;
  let rows: string[], how: string;
  if (verdict.basis === "two-way") {
    rows = diffRows(m.text, u.text);
    how = "*compared with the note as it is now (the edit's starting text isn't kept) · - the note now, + your edit*";
  } else {
    rows = verdict.hunks.flatMap(hunkRows);
    how = verdict.hunks.length ? "*only what your edit changed · - what it replaced, + what it wrote*" : "*your edit changed nothing*";
  }
  const body = rows.join("\n"), fence = fenceFor(body);
  const text = [
    `Your unsent edit · ${subject(m)}`,
    "",
    startedWords(day, behind),
    "",
    `**${verdictWords(verdict, day)}**`,
    "",
    how,
    ...(rows.length ? ["", `${fence}diff`, body, fence] : []),
  ].join("\n");
  return view(m, "diff", text, u.at);
}

/** The put-aside text itself, as written, as a note a reader draws; its lines carry the comparison of `base` too. */
export function copyNote(m: Msg, u: Unsent, base?: string | null): Msg {
  if (base !== undefined) VIEW_VERDICTS.set(m.id, compareDraft(base, u.text, m.text));
  return view(m, "copy", u.text, u.at);
}

const view = (m: Msg, kind: "diff" | "copy", text: string, at: number): Msg =>
  // The note's revision rides along: the view's kept-draft line says whether the edit is on an older one.
  ({ id: `${UNSENT_NOTE}${m.id}#${kind}`, text, parentId: null, childIds: [], createdAt: at, updatedAt: at, author: "unsent", props: {}, ...(m.revision !== undefined ? { revision: m.revision } : {}) });

