/** Source coordinates shared by the reader and its draft; drawing only projects them into rows. */
export class ReaderPosition {
  reading = 0;
  view: { line: number; row: number } | null = null;
  cursor = { row: 0, col: 0 };
}

/** Each renderer supplies its source map and the screen row where its body starts. */
export class PositionRows {
  source: number[] = [];
  origin = 0;
  /** A reader header image shrinks by one row for each row scrolled. */
  leading = 0;
  /** A scroll set before any render gave a source map: rows can't name a source line yet, so it waits to be placed (PIE-929). */
  private waiting: number | null = null;
  constructor(public position: ReaderPosition) {}
  /** A new note: no rows are known and nothing waits. */
  reset() { this.source = []; this.waiting = null; }
  /** Called once a render has supplied the source map, origin and leading: a waiting scroll becomes a place in the source. */
  settle() {
    if (this.waiting === null || !this.source.length) return;
    const top = this.waiting;
    this.waiting = null;
    this.top = top;
  }
  get top(): number {
    const v = this.position.view;
    if (!v) return this.waiting ?? 0;
    let at = this.source.findIndex(line => line >= v.line);
    if (at < 0) at = Math.max(0, this.source.length - 1);
    const base = at + this.origin - v.row;
    return Math.max(0, base >= this.leading ? base : Math.ceil((base + this.leading) / 2));
  }
  set top(top: number) {
    if (!this.source.length) { this.position.view = null; this.waiting = Math.max(0, top); return; }
    this.waiting = null;
    let at = Math.min(Math.max(0, top), this.source.length - 1);
    while (at < this.source.length - 1 && this.source[at]! < 0) at++;
    while (at > 0 && this.source[at]! < 0) at--;
    if (this.source[at]! < 0) { this.position.view = null; return; }
    const line = this.source[at]!;
    while (at > 0 && this.source[at - 1] === line) at--;
    this.position.view = { line, row: this.origin + Math.max(0, this.leading - top) + at - top };
  }
}
