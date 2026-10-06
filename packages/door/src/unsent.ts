// What the reader makes of drafts put aside as unsent (src/draft-session.ts keeps them): the `■ unsent` lines with their
// controls, the diff of one against the note as it is now (a reader beside it, read-only), and the changes "take it
// back" proposes to an edit. Pure but for the put-aside files it reads through draft-session.ts.
import type { DraftPatchSpan } from "@ep0ch/outline-core/draft-patch-compare";
import { DRAFT_PATCH_CONTEXT } from "@ep0ch/outline-core/draft-patch-compare";
import { diffLines } from "diff";
import { UNSENT_NOTE } from "./authored";
import { subject, type Msg } from "./board";
import { unsent, type Unsent } from "./draft-session";

/** What can be put aside on a note, and its place key's prefix. */
export type UnsentKind = "edit" | "comment" | "child" | "card";
/** A control on an `■ unsent` line (each an action: `unsent.<op>`). */
export type UnsentOp = "diff" | "copy" | "dismiss" | "take" | "show";
/** The words drawn for each control. */
export const UNSENT_LABEL: Record<UnsentOp, string> = { diff: "[diff]", copy: "[open copy]", dismiss: "[dismiss]", take: "[take it back]", show: "[show]" };

/** An edit put aside on an older revision more than this many days ago folds into one dim line. */
export const OLD_UNSENT_DAYS = 3;

/** One `■ unsent` line of a note: what's put aside there, whether it's on an older revision, and the controls it offers. */
export interface UnsentEntry { kind: UnsentKind; place: string; u: Unsent; stale: boolean; old: boolean; text: string; ops: UnsentOp[] }

const WHAT: Record<UnsentKind, (when: string) => string> = {
  edit: w => `■ unsent edit from ${w}`,
  comment: w => `■ unsent comment from ${w}`,
  child: w => `■ unsent note under this from ${w}`,
  card: w => `■ unsent new card from ${w}`,
};
const BACK: Record<UnsentKind, string> = { edit: "e brings it back", comment: "C and a passage bring it back", child: "N on the card brings it back", card: "n in this lane brings it back" };

/**
 * What's put aside on note `id` (an edit or a comment on it, a new note under it, a new card in its lane), newest kind
 * first as the reader lists them. An edit on another revision than the note's now (`revision`) isn't brought back by
 * `e`: its line offers the diff and taking it back instead.
 */
export function unsentEntries(id: string, revision: number | undefined, when: (at: number) => string, now = Date.now()): UnsentEntry[] {
  const out: UnsentEntry[] = [];
  for (const kind of ["edit", "comment", "child", "card"] as const) {
    const place = `${kind}:${id}`, u = unsent(place);
    if (!u) continue;
    const stale = kind === "edit" && revision !== undefined && u.base !== revision;
    const old = stale && now - u.at > OLD_UNSENT_DAYS * 86_400_000;
    const text = `${WHAT[kind](when(u.at))}${stale ? ` · on revision ${u.base}, the note is at ${revision}` : ` · ${BACK[kind]}`}`;
    out.push({ kind, place, u, stale, old, text, ops: kind === "edit" ? ["diff", "copy", "dismiss", "take"] : ["copy", "dismiss"] });
  }
  return out;
}

/** The dim line old stale edits fold into: "■ 1 old unsent edit · [show]". */
export const oldUnsentLine = (n: number) => `■ ${n} old unsent edit${n === 1 ? "" : "s"}`;

// ── the views beside a note: its diff, its copy ──────────────────────────────

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

/** The diff of what's put aside against the note as it is now, as a note a reader draws (a ```diff fence colours it). */
export function diffNote(m: Msg, u: Unsent): Msg {
  const rows = diffRows(m.text, u.text), changed = rows.filter(r => r[0] !== " ").length;
  const on = u.base === m.revision ? `on revision ${u.base}, the one the note is at` : `on revision ${u.base}; the note is at revision ${m.revision ?? "?"} now`;
  const body = rows.join("\n"), fence = fenceFor(body);
  const text = [
    `Unsent edit · ${subject(m)}`,
    "",
    `*written ${on} · ${changed ? `${changed} line${changed === 1 ? "" : "s"} differ` : "the same as the note now"} · - the note now, + the unsent edit*`,
    "",
    `${fence}diff`, body, fence,
  ].join("\n");
  return view(m, "diff", text, u.at);
}

/** The put-aside text itself, as written, as a note a reader draws. */
export function copyNote(m: Msg, u: Unsent): Msg {
  return view(m, "copy", u.text, u.at);
}

const view = (m: Msg, kind: "diff" | "copy", text: string, at: number): Msg =>
  // The note's revision rides along: the view's ■ unsent line says whether the edit is on an older one.
  ({ id: `${UNSENT_NOTE}${m.id}#${kind}`, text, parentId: null, childIds: [], createdAt: at, updatedAt: at, author: "unsent", props: {}, ...(m.revision !== undefined ? { revision: m.revision } : {}) });

// ── take it back: the unsent changes as draft.patch spans ────────────────────

/**
 * The changes an unsent edit made to the text it started from (`from`), one compare-and-swap span each: the lines it
 * changed as they read then (or, for lines it added, the lines either side), what they became, and a few lines of
 * context. Applied to an edit of the note now (Draft.applyPatch, forced: the person's own choice), a span whose passage
 * changed since isn't found and changes nothing, so newer text is never overwritten.
 */
export function takeBackSpans(from: string, put: string): DraftPatchSpan[] {
  const a = from.split("\n"), spans: DraftPatchSpan[] = [];
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
    if (lo === hi) continue;                                  // nothing to compare against (the note was empty)
    const observed = a.slice(lo, hi).join("\n");
    const replaced = [...a.slice(lo, start), ...added, ...a.slice(end, hi)];
    // A run taken out entirely takes its line break with it.
    let obs = observed, rep = replaced.join("\n"), at = offsetOf(lo);
    if (!replaced.length) {
      if (hi < a.length) { obs += "\n"; }
      else if (lo > 0) { obs = "\n" + obs; at -= 1; }
      rep = "";
    }
    spans.push({ observed: obs, replacement: rep, range: { start: at, end: at + obs.length }, before: ctx(from.slice(0, at), "start"), after: ctx(from.slice(at + obs.length), "end") });
  }
  return spans;
}
