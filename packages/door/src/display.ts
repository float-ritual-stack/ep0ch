// Where the door's frames go: a terminal's rows, its images and its video mode. App renders one frame (lines and
// Kitty placements) and hands it to a Display. The door's own terminal is one Painter; a session (src/session/) is
// a Display over every client attached to it, each client a Painter of its own: its own size, its own video mode,
// its own images uploaded (a client that attached later has none of the others').
import { toCp437Glyphs } from "./ansi";
import { crtUnderlay } from "./crt";
import { KittyLayer, type Placement } from "./kitty";
import { rowBytes, runProgram, type HandoverOpts, type TermInfo } from "./term";
import { isSized, SizedLayer } from "./text-sizing";
import { StatusReporter } from "./desk/program-status";
import type { StatusInput } from "@ep0ch/outline-core/program-status";

export type Video = "kitty+crt" | "kitty" | "cells";

/** What a Painter draws on: a terminal's rows and raw writes (Term, a session client's Rows, a test's fake). */
export interface RawTerm {
  info: TermInfo;
  /** Give the terminal up (cooked mode, the normal screen) and take it back: for a program run in it. */
  stop?(): void;
  resume?(): void;
  write(s: string): void;
  paint(lines: string[]): void;
  /** The rows its last paint wrote; absent: assume all of them. */
  readonly rewritten?: ReadonlySet<number>;
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
  /** Free the images uploaded (the door ends). */
  dispose(): void;
  /**
   * Hand the person's terminal to a program (App.suspend) until it ends: its exit code. Nothing is painted to that
   * terminal meanwhile; it's painted whole after. A session's is the terminal of the client with the person's keys.
   */
  handOver(argv: string[], o: HandoverOpts): Promise<number | null>;
  /** Nobody sees the frames (a session with no terminal attached): App renders none until someone does. */
  unseen?(): boolean;
  /** Said when the frames are seen again (a terminal attached to a session nobody saw): App draws the frame it skipped. */
  onSeen?(f: () => void): void;
  /**
   * The door's own program status (OSC 7501, `doorReport`), to each terminal that answered the protocol's query: only
   * what changed since it was last told. Null: every record the door put there goes (it quits).
   */
  programStatus?(want: ReadonlyMap<string, StatusInput> | null): void;
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
  /** A program has the terminal (handOver): nothing is painted until it gives it back. */
  private away = false;
  constructor(readonly term: RawTerm, video?: Video) {
    this.video = video ?? (term.info.kitty ? "kitty+crt" : "cells");
    this.kitty = new KittyLayer(s => term.write(s));
    this.sizedLayer = new SizedLayer(s => term.write(s));
  }
  private readonly sizedLayer: SizedLayer;

  cycleVideo(): string | null {
    if (!this.term.info.kitty) return "this terminal did not answer the Kitty graphics query; cells only";
    this.video = nextVideo(this.video);
    this.term.invalidate();
    return null;
  }

  /** A row as this terminal can draw it in its video mode. */
  glyphs(line: string): string { return this.video === "kitty+crt" ? toCp437Glyphs(line) : line; }

  show(lines: string[], placements: Placement[]): void {
    if (this.away) return;
    const wanted = this.video === "cells" ? [] : placements;
    const images = this.video === "kitty+crt" ? [crtUnderlay(this.term.info), ...wanted.filter(p => !isSized(p))] : wanted.filter(p => !isSized(p));
    // Text drawn at a size (a reader's title) only where the terminal has it; elsewhere its cells already hold the title.
    const sized = this.term.info.sized ? wanted.filter(isSized).map(p => ({ ...p, sized: { ...p.sized, text: this.glyphs(p.sized.text) } })) : [];
    // The text and the images are one frame: a terminal never shows new rows over old placements (PIE-462).
    const draw = () => {
      const mapped = lines.map(l => this.glyphs(l));
      this.term.paint(mapped);
      this.kitty.sync(images);
      const re = this.term.rewritten;
      // A sized title no longer wanted leaves its cells until they are written again.
      for (const r of this.sizedLayer.sync(sized, mapped, row => !re || re.has(row))) if (mapped[r] !== undefined && r < this.term.info.rows) this.term.write(rowBytes(r, mapped[r]!, this.term.info.cols));
    };
    if (this.term.frame) this.term.frame(draw);
    else draw();
  }

  showRow(r: number, line: string): boolean {
    if (this.away) return true;
    if (!this.term.paintRow) return false;
    this.term.paintRow(r, this.glyphs(line));
    return true;
  }

  invalidate(): void { this.term.invalidate(); }
  dispose(): void { this.kitty.dispose(); }

  private readonly reporter = new StatusReporter(s => this.term.write(s));
  /** What it was last asked to report, for after a program had the terminal. */
  private want: ReadonlyMap<string, StatusInput> | null = null;
  /** A program had the terminal (and may have reported, cleared or reset its records): everything the door says, said again. */
  retell(): void { this.reporter.forget(); if (this.want && this.term.info.pst) this.reporter.sync(this.want); }
  programStatus(want: ReadonlyMap<string, StatusInput> | null): void {
    if (!this.term.info.pst) return;
    this.want = want;
    if (this.away) return;
    if (want) this.reporter.sync(want); else this.reporter.clear();
  }

  async handOver(argv: string[], o: HandoverOpts): Promise<number | null> {
    if (this.away) throw new Error("the terminal is already handed over");
    this.kitty.dispose();                // images don't survive the screen switch; the next paint re-uploads
    this.sizedLayer.forget();
    this.away = true;
    this.term.stop?.();
    try { return await runProgram(argv, o); }
    finally { this.away = false; this.term.resume?.(); this.term.invalidate(); this.retell(); }
  }
}
