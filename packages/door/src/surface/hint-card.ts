import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { Canvas, type Rect } from "../canvas";
import { menuHeading, menuRow } from "../desk/tile-menu";
import { RowView } from "../scroll";
import { BOLD, UNBOLD, bg, C, fg, pad, RESET } from "../style";
import { wrap } from "../text";
import type { ActRequest } from "./actions";

export interface Hint {
  id?: string;
  title: string;
  lines: readonly string[];
  keys?: readonly { keys: string; does: string }[];
  /** `current` marks the choice that is the state now (the wire being changed), drawn as a selected row. */
  choices?: readonly { label: string; act: ActRequest; key?: string; group?: string; refused?: string; current?: boolean }[];
}

export const hintStatus = (hint: Hint) => `${hint.title}: ${hint.lines[0] ?? ""}`;

/** A float's contents and pressable rows; never a mode that owns the person's keys. */
export class HintCard {
  pinned = false;
  private hits: { rect: Rect; act: ActRequest }[] = [];
  rect: Rect | null = null;
  private placed: { key: string; col: number; row: number } | null = null;
  readonly view = new RowView();
  constructor(readonly hint: Hint, readonly tile: string, readonly anchor: number, readonly by?: string) {}
  get id() { return this.hint.id ?? "hint.show"; }

  draw(canvas: Canvas, anchor: Rect, area: Rect, brief: boolean, pointer?: { x: number; y: number }, tone: number = C.cyan, values?: StyleValues): Rect {
    const cols = Math.max(4, Math.min(64, area.cols, Math.max(38, anchor.cols - 2)));
    const w = cols - 4;
    const lines = (brief ? this.hint.lines.slice(0, 1) : this.hint.lines).flatMap(l => wrap(l.replace(/^([^:]+:)/, BOLD + "$1" + UNBOLD), w));
    if (!brief) for (const k of this.hint.keys ?? []) lines.push(menuRow({ label: k.does, key: k.keys }, false, w));
    const choices = this.hint.choices ?? [];
    const content: { text: string; act?: ActRequest }[] = lines.map(text => ({ text }));
    choices.forEach((choice, i) => {
      if (choice.group && (i === 0 || choices[i - 1]!.group !== choice.group)) content.push({ text: menuHeading(choice.group, w) });
      content.push({ text: menuRow(choice, choice.current ? "current" : false, w), act: choice.act });
    });
    const rows = Math.min(area.rows, content.length + 2);
    // Placed once, clear of the control just pressed; it holds that place while the pointer moves (into it to
    // reach a choice, or anywhere else) until its tile or the room changes (Evan, Oct 20: "cat and mouse").
    const key = `${anchor.col},${anchor.row},${anchor.cols},${area.col},${area.row},${area.cols},${area.rows},${cols},${rows}`;
    if (this.placed?.key !== key) {
      let col = Math.max(area.col, Math.min(anchor.col + 1, area.col + area.cols - cols));
      let row = Math.max(area.row, Math.min(anchor.row + 1, area.row + area.rows - rows));
      if (pointer && pointer.x >= col && pointer.x < col + cols && pointer.y >= row && pointer.y < row + rows) {
        if (pointer.x + cols + 2 <= area.col + area.cols) col = pointer.x + 2;
        else if (pointer.x - cols - 1 >= area.col) col = pointer.x - cols - 1;
        else if (pointer.y + rows + 1 <= area.row + area.rows) row = pointer.y + 1;
      }
      this.placed = { key, col, row };
    }
    const { col, row } = this.placed;
    const rect = this.rect = { col, row, cols, rows };
    canvas.float(rect, this.hint.title + (this.by ? ` - ${this.by}` : ""), fg(C.dark) + (this.pinned ? "pinned  [dismiss]  [never]" : "[pin]  [dismiss]  [never]"), () => {
    this.hits = [
      { rect: { col: col + 3, row: row + rows - 1, cols: this.pinned ? 0 : 5, rows: 1 }, act: { action: "hint.pin", tile: this.tile } },
      { rect: { col: col + (this.pinned ? 11 : 10), row: row + rows - 1, cols: 9, rows: 1 }, act: { action: "hint.dismiss", tile: this.tile } },
      { rect: { col: col + (this.pinned ? 22 : 21), row: row + rows - 1, cols: 7, rows: 1 }, act: { action: "hint.never", tile: this.tile } },
    ];
    const top = this.view.place(null, content.length, Math.max(0, rows - 2));
    content.slice(top, top + rows - 2).forEach((line, i) => {
      const y = row + i + 1;
      canvas.text(col + 2, y, fg(C.grey) + pad(line.text, w) + RESET, w);
      if (line.act) this.hits.push({ rect: { col: col + 2, row: y, cols: w, rows: 1 }, act: line.act });
    });
    if (this.view.maxTop) canvas.thumb(rect, { top, total: content.length, room: rows - 2 }, fg(C.dark));
    }, false, values);
    return rect;
  }

  clearHits() { this.hits = []; this.rect = null; }
  contains(x: number, y: number) { const r = this.rect; return !!r && x >= r.col && x < r.col + r.cols && y >= r.row && y < r.row + r.rows; }
  at(x: number, y: number): ActRequest | undefined {
    return this.hits.find(h => y === h.rect.row && x >= h.rect.col && x < h.rect.col + h.rect.cols)?.act;
  }
  describe() { return { ...this.hint, id: this.id, tile: this.tile, pinned: this.pinned, ...(this.by ? { by: this.by } : {}) }; }
}

export const MOVE_HINT: Hint = { title: "Moving", lines: ["Choose the tile to move beside. A header makes tabs; an edge splits."], keys: [{ keys: "h j k l", does: "choose a neighbour" }, { keys: "esc", does: "cancel" }] };
export const RESIZE_HINT: Hint = { title: "Resizing", lines: ["Drag the border to give the tile room. Release to keep its size."], keys: [{ keys: "< > + -", does: "resize" }, { keys: "esc", does: "finish" }] };
export const GATHER_HINT: Hint = { title: "Gathering", lines: ["Pick tiles to put together in one group."], keys: [{ keys: "shift+click", does: "pick a tile" }, { keys: "esc", does: "clear the selection" }] };

export const CONFIRM_HINT: Hint = { title: "Confirm", lines: ["Open this note for editing? Any other key keeps reading."], keys: [{ keys: "enter", does: "open the edit" }, { keys: "esc", does: "cancel" }] };

export const MODE_HINTS = {
  move: { ...MOVE_HINT, id: "move", trigger: "Move, drag or tab a tile" },
  resize: { ...RESIZE_HINT, id: "resize", trigger: "Resize a tile by keys or border drag" },
  gather: { ...GATHER_HINT, id: "gather", trigger: "Select tiles to gather" },
  confirm: { ...CONFIRM_HINT, id: "confirm", trigger: "Arm an edit for confirmation" },
  link: { id: "link", trigger: "Choose a wire destination" },
  frame: { id: "frame", trigger: "Show frame controls with ? or xray" },
  "hint.show": { id: "hint.show", trigger: "Show an explicit hint with hint.show" },
} as const;
