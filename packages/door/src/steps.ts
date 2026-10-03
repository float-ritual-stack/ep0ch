// Checklist steps in a reader (PIE-472): the status choices Detail offers (PIE-367: done, to do, waiting,
// problem, Copy step link, Make addressable), the steps of a note as the service reads them
// (`checklist.query`, kept until the note changes), and a reader's Undo. The service owns what a step is,
// its status and its identity; every change is one `checklist.update`, checked against the step as it was
// read and recorded as whoever made it. Nothing here parses a checklist.
import type { Msg } from "./board";
import type { Source } from "./props";
import { changeClock, changedSince } from "./refs";
import type { ChecklistRead, ChecklistStep, StepChange, StepStatus } from "./socket";

/** The status marks, as the service writes them (pi-herdr-outliner CHECKLIST_MARKS). */
export const STEP_MARKS: Readonly<Record<StepStatus, string>> = { todo: "[ ]", done: "[x]", waiting: "[~]", problem: "[!]" };

/** One choice in the status menu: Detail's CHECKLIST_CHOICES, in its order, with the door's key for each. */
export type StepChoice = StepStatus | "copy-link" | "address";
export const STEP_CHOICES: readonly { id: StepChoice; label: string; key: string }[] = [
  { id: "done", label: `${STEP_MARKS.done} Mark done`, key: "x" },
  { id: "todo", label: `${STEP_MARKS.todo} Mark to do`, key: "o" },
  { id: "waiting", label: `${STEP_MARKS.waiting} Mark waiting`, key: "w" },
  { id: "problem", label: `${STEP_MARKS.problem} Mark problem`, key: "!" },
  { id: "copy-link", label: "Copy step link", key: "y" },
  { id: "address", label: "Make addressable", key: "a" },
];

/** What a choice asks of the service. */
export const changeOf = (c: StepChoice): StepChange => (c === "copy-link" || c === "address" ? { kind: "ensure-id" } : { kind: "status", status: c });

/** `done`, `waiting`, `to do`: how the status reads in a flash or a reply. */
export const statusWord = (s: StepStatus) => (s === "todo" ? "to do" : s);

/** A status an agent or a person typed: done, todo (to-do, open), waiting, problem; x ~ ! and space as the marks. */
export function parseStatus(v: string): StepStatus | null {
  const s = v.trim().toLowerCase();
  if (s === "done" || s === "x" || s === "[x]") return "done";
  if (s === "todo" || s === "to-do" || s === "to do" || s === "open" || s === "[ ]") return "todo";
  if (s === "waiting" || s === "wait" || s === "~" || s === "[~]") return "waiting";
  if (s === "problem" || s === "!" || s === "[!]") return "problem";
  return null;
}

/** A step's first line without its list mark, box or anchor: how it's named in a flash, `peek` and the menu. */
export function stepTitle(step: Pick<ChecklistStep, "text">): string {
  const first = step.text.split("\n", 1)[0] ?? "";
  return first.replace(/^\s*(?:[-+*]|\d+[.)])\s+\[[ xX~!]\]\s*/, "").replace(/\s\^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\s*$/, "").trim();
}

/** A step's link, as Detail's Copy step link writes it. */
export const stepLink = (block: string, itemId: string) => `((${block}^${itemId}))`;

/**
 * A step where a reader draws it: the note it's in, the revision it was read at (a step without an id is
 * addressed by where it starts in exactly that revision), and the step as the service read it. `via`: the
 * embed it's drawn in (`!((…))`), or undefined in the note itself.
 */
export interface StepRef { block: string; revision: number; step: ChecklistStep; via?: string }

// ── the steps of a note, as the service reads them ────────────────────────────────────────────────────

interface Entry { read: ChecklistRead | null; at: number; asking: boolean; error?: string }
const readsBy = new WeakMap<object, Map<string, Entry>>();
const askingBy = new WeakMap<object, number>();
/** Steps being read again on this connection: a reader keeps the person's `[ ]` on a step meanwhile. */
export const stepsLoading = (board: object) => (askingBy.get(board) ?? 0) > 0;

/**
 * The steps of `m` (`checklist.query`), asked in the background and kept until the note changes, then
 * asked again. Until the new answer lands the last one stays (it may be of an earlier revision: the reader
 * offers a step from it only on a line that still reads the same, and the service checks every write
 * against the step as read), so a change doesn't make the steps blink out. Null before the first answer.
 */
export function stepsOf(m: Msg, src: Source | null | undefined): ChecklistRead | null {
  if (!src || m.partial || typeof (src.board as { checklist?: unknown }).checklist !== "function") return null;
  let cache = readsBy.get(src.board);
  if (!cache) readsBy.set(src.board, (cache = new Map()));
  const hit = cache.get(m.id), c = cache;
  const usable = hit?.read ?? null;
  // Asked already, or answered since the note last changed (a read newer than the note shown waits for
  // the note to catch up; a refusal waits for the next change): no new question.
  const settled = hit && !changedSince(hit.at, [m.id]) && ((usable && (usable.revision === m.revision || (m.revision !== undefined && usable.revision > m.revision))) || hit.error);
  if (hit && (hit.asking || settled)) return usable;
  const at = changeClock();
  cache.set(m.id, { read: hit?.read ?? null, at, asking: true });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  const b = src.board;
  askingBy.set(b, (askingBy.get(b) ?? 0) + 1);
  const done = () => askingBy.set(b, Math.max(0, (askingBy.get(b) ?? 1) - 1));
  b.checklist(m.id, 1000).then(
    read => { done(); c.set(m.id, { read, at, asking: false }); src.redraw(); },
    (e: Error) => { done(); c.set(m.id, { read: hit?.read ?? null, at, asking: false, error: e.message }); src.redraw(); },
  );
  return usable;
}

/**
 * A step this door just changed (`checklist.update`'s receipt): the kept read of its note takes the step as
 * it is now and the note's new revision at once, so the reader keeps offering it (with its new evidence)
 * while the note is read again.
 */
export function stepChanged(board: object, blockId: string, before: ChecklistStep, after: ChecklistStep, revision: number | undefined) {
  const e = readsBy.get(board)?.get(blockId);
  if (!e?.read) return;
  const same = (x: ChecklistStep) => (before.itemId ? x.itemId === before.itemId : x.span.start === before.span.start && x.evidence === before.evidence);
  e.read = { ...e.read, ...(revision !== undefined ? { revision } : {}), items: e.read.items.map(x => (same(x) ? after : x)) };
}

/**
 * Whether a step read from an earlier revision still stands on note line `line` of `text`: the line reads
 * the same but for its box (a status change) and its anchor (a first change gives it an id).
 */
export function stepStillOn(step: ChecklistStep, text: string, line: number): boolean {
  const plain = (l: string) => l.replace(/\[[ xX~!]\]/, "[ ]").replace(/\s\^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\s*$/, "").trimEnd();
  const now = text.split("\n")[line];
  return now !== undefined && plain(now) === plain(step.text.split("\n", 1)[0] ?? "");
}

// ── Undo ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A status change Undo can reverse: the step by the id it has now, the evidence it had after the change
 * (so Undo is refused if it changed again since), the status it had before, who made the change and the
 * note the reader showed (Undo reverses changes made while reading that note, as Detail's does).
 */
export interface UndoEntry { block: string; itemId: string; evidence: string; status: StepStatus; to: StepStatus; title: string; by: string; context: string }

/** Every change a reader records for undo, in order, so ctrl+z can tell which kind came last (a step's, a callout's). */
let undoSeq = 0;
/** A reader's changes of one kind (steps' statuses, callouts' types), newest last, 50 at most. Each party undoes only its own. */
export class UndoHistory<E extends { by: string; context: string } = UndoEntry> {
  private entries: (E & { seq?: number })[] = [];
  push(e: E) { this.entries.push({ ...e, seq: ++undoSeq }); if (this.entries.length > 50) this.entries.shift(); }
  /** The newest change `by` made while reading `context`, or null. */
  last(by: string, context: string): (E & { seq?: number }) | null {
    return this.entries.findLast(e => e.by === by && e.context === context) ?? null;
  }
  drop(e: E) { const i = this.entries.lastIndexOf(e as E & { seq?: number }); if (i >= 0) this.entries.splice(i, 1); }
  get size() { return this.entries.length; }
}
