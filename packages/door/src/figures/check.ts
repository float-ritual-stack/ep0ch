// The one checklist drawing (PIE-1348): a `::graph-check` figure's rows and a component's `checklist` primitive
// (src/components.ts) both draw through it.
import { stepClosed, stepDone, type ChecklistStatus } from "@ep0ch/outline-core/checklist-marks";
import { STEP_BOXES } from "../steps";
import { fg, RESET } from "../style";
import { colourInline } from "../text";
import { ACCENT, DIM, HI, INK, inlineRows, rowLinks, type Draw, type Props } from "./palette";

/**
 * Each item a step: its box drawn by its status (PIE-864), and a control where the reader lends one. Its words and side
 * note go through the reader's inline drawing, so a code span copies and a link follows as in the note. A step is never
 * cut short (PIE-1302): a cut item loses its meaning, so its words wrap onto as many rows as they take.
 */
export const drawCheck: Draw = (p, w, link, ui) => (p.items ?? []).flatMap((it: Props) => {
  const status: ChecklistStatus = it.status ?? (it.done ? "done" : "todo");
  const mark = STEP_BOXES[status], shown = ui?.rows?.box?.(it, mark);
  const box = shown ? colourInline(shown, ACCENT) : fg(stepDone(status) ? ACCENT : DIM) + mark + RESET;
  const ink = stepDone(status) ? HI : stepClosed(status) ? DIM : INK;
  // The words hang under themselves, past the box and its two spaces; a side note sits one further in.
  const lines = inlineRows(String(it.label ?? ""), w - 5, ink, ui?.rows, typeof it.block === "string", Infinity);
  const note = it.note ? inlineRows(String(it.note), w - 6, DIM, ui?.rows, false, Infinity) : [];
  return rowLinks(link, it.block, lines).map((l, i) => (i ? "     " : box + "  ") + l)
    .concat(note.map(l => "      " + l));
});
