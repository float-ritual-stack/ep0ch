// A note at a revision, beside how it is now (PIE-1433). The reader's `revision` mode: drawn beside the note through the
// attached surface's split (as THREAD is), its rows what-changed's one diff (`revisionDiff`) of revision R against the
// next one kept, or against the note now. This file draws it and finds where it opens; the mode, its actions and
// its keys (REVISION_KEYS) are the reader's (note.ts).
import { revisionByline } from "@ep0ch/outline-core/attribution";
import { C, fg, pad, RESET, width } from "../style";
import { rowLines } from "../text";
import { whenPut } from "../edit";
import type { RevisionDiff } from "../desk/what-changed";
import { REVISION_CONTROLS, REVISION_KEYS } from "./attached-keys";

export type RevisionAgainst = "next" | "now";

/** What the compare holds: the diff it shows, what it's against, where it's scrolled, and the passage it opened on. */
export interface RevisionView { diff: RevisionDiff; against: RevisionAgainst; top: number; passage?: string }

/** The header's first row: which two revisions, and the later one's when and who. */
export function revisionTitle(v: RevisionView): string {
  const { from, to, current } = v.diff;
  if (from.revision === to.revision) return `REVISION ${from.revision} · the note now · nothing after it`;
  const later = `${to.revision === current ? `${to.revision} (now)` : to.revision}`;
  const by = revisionByline(to);
  return `REVISION ${from.revision} → ${later} · ${whenPut(Date.parse(to.savedAt))}${by ? ` ${by}` : ""}`;
}

const CONTROL_WORDS: Record<(typeof REVISION_CONTROLS)[number], (v: RevisionView) => string> = {
  "revision.older": () => "‹ older",
  "revision.newer": () => "newer ›",
  "revision.against": v => (v.against === "now" ? "against next" : "against now"),
  "revision.close": () => "esc back",
};

/** The row a compare opens on: the passage it was opened for (its first line), else the first change. */
export function openingRow(rows: readonly string[], passage?: string): number {
  const first = passage?.split("\n").map(l => l.trim()).find(Boolean);
  const named = first ? rows.findIndex(r => r.slice(2).includes(first.slice(0, 60))) : -1;
  const at = named >= 0 ? named : rows.findIndex(r => r[0] === "+" || r[0] === "-");
  return Math.max(0, at - 2);
}

/** Its rows at `cols` × `rows`: the title, the controls (with where each is, for clicks), then the marked text from `top`. */
export function drawRevision(v: RevisionView, cols: number, rows: number): { lines: string[]; controls: { from: number; to: number; action: (typeof REVISION_CONTROLS)[number] }[]; body: number } {
  const lay = (actions: readonly (typeof REVISION_CONTROLS)[number][]) => {
    const controls: { from: number; to: number; action: (typeof REVISION_CONTROLS)[number] }[] = [];
    let bar = "";
    for (const action of actions) {
      const from = width(bar) + (bar ? 1 : 0);
      bar += `${bar ? " " : ""}[${CONTROL_WORDS[action](v)}]`;
      controls.push({ from, to: width(bar), action });
    }
    return { bar, controls };
  };
  // Narrow, [esc back] goes first (the hint row says Esc): the others stay whole and clickable.
  let { bar, controls } = lay(REVISION_CONTROLS);
  if (width(bar) > cols) ({ bar, controls } = lay(REVISION_CONTROLS.filter(a => a !== "revision.close")));
  const title = rowLines(revisionTitle(v), cols).map(l => pad(fg(C.white) + l, cols) + RESET);
  const head = [...title, pad(fg(C.lcyan) + bar, cols) + RESET];
  // Every row whole, wrapped under its mark: the passage is the point, never cut short.
  const body = v.diff.rows.flatMap(r => rowLines(r, cols, 1000, { hang: 2 }).map(l => {
    const sgr = r[0] === "+" ? fg(C.lgreen) : r[0] === "-" ? fg(C.lred) : fg(C.grey);
    return pad(sgr + l, cols) + RESET;
  }));
  const room = Math.max(0, rows - head.length);
  v.top = Math.max(0, Math.min(v.top, Math.max(0, body.length - room)));
  const shown = body.length ? body.slice(v.top, v.top + room) : [pad(fg(C.grey) + "(no text at this revision)", cols) + RESET];
  return { lines: [...head, ...shown], controls, body: title.length + 1 };
}

/** The keys the compare answers (for the hint and peek): its own table. */
export const revisionKeys = () => REVISION_KEYS;

/** The compare as peek and the actions give it: which revisions, against what, its rows and where it's scrolled. */
export function revisionFacts(v: RevisionView) {
  const { from, to, current, rows } = v.diff;
  return { revision: from.revision, to: to.revision, current, against: v.against, title: revisionTitle(v), top: v.top,
    changed: rows.filter(r => r[0] === "+" || r[0] === "-").length, rows: rows.length, diff: rows };
}
