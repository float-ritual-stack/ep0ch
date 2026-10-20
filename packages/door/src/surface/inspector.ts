import { RowView } from "../scroll";
import { paintRange, rowsOf, SELECT_BG, Selection, type Pos } from "./selection";

/** The viewport and text selection shared by the tune and source inspectors. */
export class Inspector extends RowView {
  lines: readonly string[] = [];
  selection: Selection | null = null;
  pressed: Pos | null = null;

  begin(at: Pos) { this.pressed = at; this.selection = null; }
  extend(at: Pos) { if (this.pressed) this.selection = new Selection(this.pressed, at); }
  release() { this.pressed = null; }
  text() { return this.selection?.text(rowsOf(this.lines)) ?? ""; }
  paint(line: string, row: number) {
    const span = this.selection?.span(row);
    return span ? paintRange(line, span[0], span[1], SELECT_BG) : line;
  }
}
