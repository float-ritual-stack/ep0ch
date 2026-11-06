// When the door's next frame is drawn (PIE-1606): the timer behind App.redraw, and the door's one paint scheduler. A frame
// starts at most a frame's time after the last one ended. A frame dearer than that (a board of many lanes, a loaded
// machine) rests the loop three times its length after it, so painting takes about a quarter of the loop and a storm of
// outline changes can't hold it: the requests the door is waiting on get their answers read. Not just after the person
// pressed something or an agent acted: what follows it (a program's echo, an answer) is as soon as it can be.
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

  /** A frame's on its way: the timer is set. */
  get waiting(): boolean { return this.timer !== null; }

  private gap(lastInput: number): number {
    if (Date.now() - Math.max(lastInput, this.actedAt) < ACTIVE_MS) return FRAME_MS;
    return Math.max(FRAME_MS, Math.min(MAX_GAP_MS, this.frameMs * REST));
  }

  /** A frame is wanted: `paint` runs now if one is due, else when it is (sooner, if the person's press ended a rest). */
  ask(lastInput: number, paint: () => void): void {
    const due = this.lastPaint + this.gap(lastInput);
    if (this.timer) {
      if (due >= this.due) return;
      this.cancel();
    }
    if (due <= Date.now()) return paint();
    this.due = due;
    this.timer = setTimeout(() => { this.timer = null; paint(); }, due - Date.now());
  }

  /** A frame after this one, however many ask meanwhile: asked while it's drawn. */
  next(paint: () => void): void { this.timer ??= setTimeout(() => { this.timer = null; paint(); }, FRAME_MS); }
  cancel(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  begin(): void { this.began = performance.now(); }
  /** The frame ended (`drawn` false: nobody sees it). */
  end(drawn = true): void { this.lastPaint = Date.now(); if (drawn) this.frameMs = performance.now() - this.began; }
}
