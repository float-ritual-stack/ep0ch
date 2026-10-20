import type { ListPicker } from "../surface/picker";
import { C, fg, pad, RESET } from "../style";

export const PREVIEW_COLS = 90;
export type PickerPreview = (w: number, h: number) => string[];

/** The bar and inline completion share the list, hit rows and responsive preview placement. */
export function listPreview<T, H>(picker: ListPicker<T, H>, w: number, h: number, preview?: PickerPreview, at = 0, readerWidth = w, anchor?: { col: number; width: number }) {
  const beside = !!preview && readerWidth >= PREVIEW_COLS;
  const below = !!preview && !beside && h >= 6;
  const listWidth = beside ? Math.floor(w * 0.46) : w;
  const inset = anchor ? Math.max(0, Math.min(anchor.col, listWidth - anchor.width)) : 0;
  const listHeight = below ? Math.ceil((h - 1) / 2) : h;
  const list = picker.lines(listWidth - inset, listHeight, at).map(line => " ".repeat(inset) + line);
  const rows = Array.from({ length: list.length }, (_, i) => picker.itemAt(at + i));
  if (beside) {
    const drawn = preview!(w - listWidth - 3, h);
    return { listWidth, listCol: inset, preview: { col: listWidth + 3, row: 0, cols: w - listWidth - 3, rows: h }, rows: Array.from({ length: h }, (_, i) => rows[i] ?? null), lines: Array.from({ length: h }, (_, i) => pad(list[i] ?? "", listWidth) + fg(C.blue) + " │ " + RESET + pad(drawn[i] ?? "", w - listWidth - 3)) };
  }
  if (below) {
    const drawn = preview!(w, h - listHeight - 1);
    while (list.length < listHeight) { list.push(pad("", w)); rows.push(null); }
    return { listWidth, listCol: inset, preview: { col: 0, row: listHeight + 1, cols: w, rows: h - listHeight - 1 }, lines: [...list, fg(C.blue) + "─".repeat(w) + RESET, ...drawn], rows: [...rows, null, ...drawn.map(() => null)] };
  }
  return { listWidth, listCol: inset, lines: list, rows };
}
