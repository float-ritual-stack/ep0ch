// Where the door's frames go: a terminal's rows, its images and its video mode. App renders one frame (lines and
// Kitty placements) and hands it to a Display. The door's own terminal is one Painter; a session (src/session/) is
// a Display over every client attached to it, each client a Painter of its own: its own size, its own video mode,
// its own images uploaded (a client that attached later has none of the others').
import { toCp437Glyphs } from "./ansi";
import { crtUnderlay } from "./crt";
import { KittyLayer, type Placement } from "./kitty";
import type { TermInfo } from "./term";

export type Video = "kitty+crt" | "kitty" | "cells";

/** What a Painter draws on: a terminal's rows and raw writes (Term, a session client's Rows, a test's fake). */
export interface RawTerm {
  info: TermInfo;
  write(s: string): void;
  paint(lines: string[]): void;
  paintRow?(r: number, line: string): void;
  frame?(draw: () => void): void;
  invalidate(): void;
}

/** Where App's frames go. */
export interface Display {
  /** The video mode frames are drawn in (a session: the client with the person's keys). */
  video: Video;
  /** Turn to the next video mode; null, or why there is none to turn to. */
  cycleVideo(): string | null;
  /** One frame: the screen's rows (Unicode) and its images, as one synchronized update. */
  show(lines: string[], placements: Placement[]): void;
  /** Repaint one row alone (the status bar's clock); false where that can't be done (a whole frame is). */
  showRow(r: number, line: string): boolean;
  /** Forget what's on screen: the next frame is painted whole. */
  invalidate(): void;
  /** Free the images uploaded (the terminal is handed over, or the door ends). */
  dispose(): void;
}

export const isDisplay = (t: unknown): t is Display => typeof (t as Display | null)?.show === "function";

/** The next video mode after `v`, on a terminal that has Kitty graphics. */
export const nextVideo = (v: Video): Video => (v === "kitty+crt" ? "kitty" : v === "kitty" ? "cells" : "kitty+crt");

/**
 * One terminal's frames: its rows through `term`, its images through a Kitty layer of its own, in its own video mode.
 * Under kitty+crt the font is CP437 (the VGA font the CRT is drawn for): a glyph it lacks would show as ?, so it goes
 * as its nearest lookalike (ansi.ts CP437_NEAREST), and the tube is drawn under the text. `peek` keeps the Unicode.
 */
export class Painter implements Display {
  video: Video;
  private readonly kitty: KittyLayer;
  constructor(readonly term: RawTerm, video?: Video) {
    this.video = video ?? (term.info.kitty ? "kitty+crt" : "cells");
    this.kitty = new KittyLayer(s => term.write(s));
  }

  cycleVideo(): string | null {
    if (!this.term.info.kitty) return "this terminal did not answer the Kitty graphics query; cells only";
    this.video = nextVideo(this.video);
    this.term.invalidate();
    return null;
  }

  /** A row as this terminal can draw it in its video mode. */
  glyphs(line: string): string { return this.video === "kitty+crt" ? toCp437Glyphs(line) : line; }

  show(lines: string[], placements: Placement[]): void {
    const images = this.video === "cells" ? [] : this.video === "kitty+crt" ? [crtUnderlay(this.term.info), ...placements] : placements;
    // The text and the images are one frame: a terminal never shows new rows over old placements (PIE-462).
    const draw = () => { this.term.paint(lines.map(l => this.glyphs(l))); this.kitty.sync(images); };
    if (this.term.frame) this.term.frame(draw);
    else draw();
  }

  showRow(r: number, line: string): boolean {
    if (!this.term.paintRow) return false;
    this.term.paintRow(r, this.glyphs(line));
    return true;
  }

  invalidate(): void { this.term.invalidate(); }
  dispose(): void { this.kitty.dispose(); }
}
