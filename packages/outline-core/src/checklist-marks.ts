// A checklist step's box (PIE-811): the one grammar for `- [ ]` and its five other states, which the service's
// checklist (`checklistItems`, `checklist.query`, `checklist.update`), Detail, the door and the web pages all read.
//
// | status   | written | also read | what it means                                       |
// |----------|---------|-----------|-----------------------------------------------------|
// | todo     | `[ ]`   |           | open                                                |
// | done     | `[x]`   | `[X]`     | closed, done                                        |
// | waiting  | `[~]`   |           | open, waiting on something                          |
// | problem  | `[!]`   |           | open, something's wrong                             |
// | approved | `[✓]`   | `[+]`     | closed, done, and the person said yes to it         |
// | rejected | `[✗]`   | `[-]`     | closed, not done: the person said no to it          |
//
// Approved and rejected are written with the marks they're drawn with, so the source reads as it looks; `[+]` and
// `[-]` are the forms a keyboard types, read the same and written back canonical on the next status change. An
// agent reads `approved` as the person's yes (a "Needs you" item approved is a go) and `rejected` as their no.
// Pure: no I/O.

export const CHECKLIST_STATUSES = ["todo", "done", "waiting", "problem", "approved", "rejected"] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

/** The box each status is written as. Every one is three UTF-16 units: `[`, one BMP character, `]`. */
export const CHECKLIST_MARKS: Readonly<Record<ChecklistStatus, string>> = {
  todo: "[ ]", done: "[x]", waiting: "[~]", problem: "[!]", approved: "[✓]", rejected: "[✗]",
};

/** The characters a box may hold, as a regular-expression class body (inside `[…]`). */
export const STEP_BOX_CHARS = " xX~!✓✗+\\-";
/** A box, as a regular-expression source: `\[[ xX~!✓✗+-]\]`. */
export const STEP_BOX = `\\[[${STEP_BOX_CHARS}]\\]`;

const BY_CHAR: Readonly<Record<string, ChecklistStatus>> = {
  " ": "todo", x: "done", X: "done", "~": "waiting", "!": "problem", "✓": "approved", "+": "approved", "✗": "rejected", "-": "rejected",
};

/** The status a box's inner character (or the whole `[c]`) reads as, or null when it isn't a box. */
export function boxStatus(box: string): ChecklistStatus | null {
  const c = box.length === 3 && box[0] === "[" && box[2] === "]" ? box[1]! : box;
  return Object.hasOwn(BY_CHAR, c) ? BY_CHAR[c]! : null;
}

export const isChecklistStatus = (v: unknown): v is ChecklistStatus => typeof v === "string" && (CHECKLIST_STATUSES as readonly string[]).includes(v);

/** Finished with: done, approved or rejected. Open steps (to do, waiting, problem) are the rest. */
export const stepClosed = (s: ChecklistStatus) => s === "done" || s === "approved" || s === "rejected";
/** Counts as done in a tally ("3/5 done"): done or approved. A rejected step is closed but not done. */
export const stepDone = (s: ChecklistStatus) => s === "done" || s === "approved";

/** How a status reads in a flash, a menu or a reply: "to do", "done", "approved"… */
export const statusWord = (s: ChecklistStatus) => (s === "todo" ? "to do" : s);
