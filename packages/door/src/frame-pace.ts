// When the door's next frame is drawn (PIE-1606): the timer behind App.redraw, and the door's one paint scheduler. A frame
// starts at most a frame's time after the last one ended. A frame an outline change asked for rests the loop as well: three
// times the last frame's length, so a storm of changes over a board of many lanes can't hold the loop in paints and the
// requests the door is waiting on get their answers read. Everything else keeps a frame's pace: a terminal tile's output, a
// transition, an answer. Just after the person pressed something or an agent acted, a change's frame doesn't rest either.
export const FRAME_MS = 16;
const ACTIVE_MS = 150;
const REST = 3;
const MAX_GAP_MS = 250;

export class FramePace {
  /** When the last frame ended. */
  lastPaint = 0;
  /** When an agent's action last ran. */
  actedAt = 0;
  private frameMs = 0;
  private began = 0;
  private timer: Timer | null = null;
  private due = 0;
  private hearingChange = false;

  /** A frame's on its way: the timer is set. */
  get waiting(): boolean { return this.timer !== null; }

  private gap(lastInput: number): number {
    if (Date.now() - Math.max(lastInput, this.actedAt) < ACTIVE_MS) return FRAME_MS;
    return Math.max(FRAME_MS, Math.min(MAX_GAP_MS, this.frameMs * REST));
  }

  /**
   * A frame is wanted: `paint` runs now if one is due, else when it is. `rest`: an outline change asked. A frame that
   * doesn't rest brings forward one that is resting.
   */
  ask(lastInput: number, paint: () => void, rest = false): void {
    const due = this.lastPaint + (rest || this.hearingChange ? this.gap(lastInput) : FRAME_MS);
    if (this.timer) {
      if (due >= this.due) return;
      this.cancel();
    }
    if (due <= Date.now()) return paint();
    this.due = due;
    this.timer = setTimeout(() => { this.timer = null; paint(); }, due - Date.now());
  }

  /** What an outline change sets off as it's heard: whatever asks for a frame meanwhile, the change asked. */
  hearing(run: () => void): void {
    const was = this.hearingChange;
    this.hearingChange = true;
    try { run(); } finally { this.hearingChange = was; }
  }

  /** A frame after this one, however many ask meanwhile: asked while it's drawn. */
  next(paint: () => void): void { this.timer ??= setTimeout(() => { this.timer = null; paint(); }, FRAME_MS); }
  cancel(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  begin(): void { this.began = performance.now(); }
  /** The frame ended (`drawn` false: nobody sees it). */
  end(drawn = true): void { this.lastPaint = Date.now(); if (drawn) this.frameMs = performance.now() - this.began; }
}
