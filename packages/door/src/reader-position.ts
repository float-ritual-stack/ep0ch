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
  constructor(public position: ReaderPosition) {}
  get top(): number {
    const v = this.position.view;
    if (!v) return 0;
    let at = this.source.findIndex(line => line >= v.line);
    if (at < 0) at = Math.max(0, this.source.length - 1);
    return Math.max(0, at + this.origin - v.row);
  }
  set top(top: number) {
    if (!this.source.length) { this.position.view = null; return; }
    let at = Math.min(Math.max(0, top), this.source.length - 1);
    while (at < this.source.length - 1 && this.source[at]! < 0) at++;
    const line = this.source[at]!;
    while (at > 0 && this.source[at - 1] === line) at--;
    this.position.view = { line, row: this.origin + at - top };
  }
}
