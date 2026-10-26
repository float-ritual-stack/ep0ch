import type { ListPicker } from "../surface/picker";
import { C, fg, pad, RESET } from "../style";

export const PREVIEW_COLS = 90;
/** Helix's rule (completion.rs): a docs panel goes beside the list when this many columns are free, else below. */
export const DOCS_BESIDE_COLS = 30;
/** A docs panel beside the list is never wider than this: it wraps to read, not to fill a wide pane. */
export const DOCS_MAX_COLS = 100;
export type PickerPreview = (w: number, h: number) => string[];

/**
 * The list `fit.list` columns wide (its rows' own width, never a share of the pane), at the anchor's column when there's
 * room, and its docs beside it when 30 columns are free, else under it, each sized to what it holds: the list to its
 * rows, the docs to their lines (at most half the rows under a list that needs them).
 */
function listWithDocs<T, H>(picker: ListPicker<T, H>, w: number, h: number, preview: PickerPreview | undefined, at: number, fit: { list: number }, anchor?: { col: number; width: number }) {
  const listWidth = Math.max(1, Math.min(w, fit.list));
  const room = w - listWidth - 3;
  const beside = !!preview && room >= DOCS_BESIDE_COLS;
  let inset = anchor ? Math.max(0, Math.min(anchor.col, w - listWidth)) : 0;
  if (beside) inset = Math.max(0, Math.min(inset, room - DOCS_BESIDE_COLS));
  const need = picker.lines(listWidth, h, at).length;
  if (beside) {
    const cols = Math.min(DOCS_MAX_COLS, w - inset - listWidth - 3);
    const docs = preview!(cols, h);
    const rowsUsed = Math.max(need, Math.min(h, docs.length));
    const list = picker.lines(listWidth, rowsUsed, at);
    const left = inset + listWidth;
    return {
      listWidth: left, listCol: inset, preview: { col: left + 3, row: 0, cols, rows: rowsUsed },
      rows: Array.from({ length: rowsUsed }, (_, i) => (i < list.length ? picker.itemAt(at + i) : null)),
      lines: Array.from({ length: rowsUsed }, (_, i) => " ".repeat(inset) + pad(list[i] ?? "", listWidth) + fg(C.blue) + " │ " + RESET + pad(docs[i] ?? "", w - left - 3)),
    };
  }
  const below = !!preview && h >= 6;
  if (below) {
    const docs = preview!(w, h - 2);
    const docRows = Math.min(docs.length, Math.max(Math.floor((h - 1) / 2), h - 1 - need));
    const listHeight = Math.min(need, h - 1 - docRows);
    const list = picker.lines(listWidth, listHeight, at);
    if (docRows > 0) {
      const rows = list.map((_, i) => picker.itemAt(at + i));
      return { listWidth: inset + listWidth, listCol: inset, preview: { col: 0, row: list.length + 1, cols: w, rows: docRows },
        lines: [...list.map(l => " ".repeat(inset) + pad(l, listWidth)), fg(C.blue) + "─".repeat(w) + RESET, ...preview!(w, docRows).slice(0, docRows)],
        rows: [...rows, null, ...Array.from({ length: docRows }, () => null)] };
    }
  }
  const list = picker.lines(listWidth, h, at);
  return { listWidth: inset + listWidth, listCol: inset, lines: list.map(l => " ".repeat(inset) + pad(l, listWidth)), rows: list.map((_, i) => picker.itemAt(at + i)) };
}

/**
 * The bar and inline completion share the list, hit rows and responsive preview placement. `fit` (the completion
 * popup's): the list is as wide as its rows and its docs placed by Helix's room rule (listWithDocs); without it, the
 * bar's: a 46% list with its preview beside at 90 columns.
 */
export function listPreview<T, H>(picker: ListPicker<T, H>, w: number, h: number, preview?: PickerPreview, at = 0, readerWidth = w, anchor?: { col: number; width: number }, fit?: { list: number }) {
  if (fit) return listWithDocs(picker, w, h, preview, at, fit, anchor);
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
