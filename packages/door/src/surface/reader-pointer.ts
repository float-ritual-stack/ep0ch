// What the mouse button held down is doing in a reader (PIE-1615): one tagged gesture with a getter per kind, the desk's
// shape (`Gesture` in src/desk/desk.ts). The desk's answers which tile a press belongs to; this one answers what the press
// is doing in that tile's cells. `Gesture` in selection.ts stays what it is, the click counter (click, double, triple; a
// drag off the cell), shared with the river's column and the lists.
//
// The machine, all of it:
//
//   idle ── press ──▶ held(kind) ── drag ──▶ held(kind)      only the kind's own drag runs
//   held ── release ─▶ idle                                  the kind's own end: a click only if nothing moved
//   held ── release, a hero or figure with a save ─▶ idle + landing ── the save lands ──▶ idle
//   held ── end ─────▶ idle                                  nothing fires. A press whose release never came (the next press, or
//                                                            the pointer moving with no button), a mode opening or going,
//                                                            the note changing, the desk taking the press
//
// A landing isn't a gesture: the button is up, and the part is only drawn where it was let go until its save lands, so a
// header or a figure never snaps back first. The next press starts clean over it.
import { resizeEnded } from "../resize";
import type { Draft } from "../edit";
import type { Msg } from "../board";
import type { FrameGrip, SplitFrame } from "./attachments";
import type { FigureDrag } from "./figure-sizing";
import type { Focus } from "../media";
import { Gesture } from "./selection";

/** The cursor and selection of a draft the keys came back to by a press (PIE-812), put back after that press and its release. */
export interface KeptCursor { d: Draft; row: number; col: number; anchor: Draft["anchor"]; follow: boolean }

/**
 * What the button is doing, one kind per press, set by the press:
 * - text: a press in the note (a link, a fold, a row, a blank: release decides), `selecting` once a drag has left its cell.
 * - draft: a press in a draft or a comment. `placed`: it put the cursor there, so a drag selects in the draft (Draft's own
 *   selection); `shift`: it extended the selection; `kept`: the cursor it must leave where it was (PIE-812); `selecting`:
 *   a double or triple click's word or line being selected (its release copies it after).
 * - hero: the header image (PIE-1361). Its bottom row sizes it (`height`), the picture moves what its crop keeps (`focus`).
 *   Drawn from `now` while the button is down; one image.size or image.look on release, so the line takes one save. A press
 *   that doesn't move is a click on the header.
 * - figure: a figure's bottom or right edge (FigureSizing has its geometry and its one save).
 * - split: a split's divider.
 * - frame: a floating attachment's top edge moves it, its ◢ corner and edges size it, from where it was.
 * - form: a form field's press (form.place), a drag on the field extending it.
 * - reply: a row of the reply list, a drag to another moving it (note.move).
 * - sources, field: the Sources inspector's rows and a property value being typed. Those parts keep their own press.
 * - control: a press on something that only clicks (the placement menu, a float's footer): a drag does nothing.
 */
export type ReaderGesture =
  | { kind: "text"; selecting: boolean }
  | { kind: "draft"; placed: boolean; shift: boolean; kept: KeptCursor | null; selecting: Promise<void> | null }
  | HeroDrag
  | ({ kind: "figure" } & FigureDrag)
  | { kind: "split"; frame: SplitFrame }
  | ({ kind: "frame"; x: number; y: number } & FrameGrip)
  | { kind: "form"; shift: boolean }
  | { kind: "reply"; from: { block: Msg; y: number } }
  | { kind: "sources"; letGo: () => void }
  | { kind: "field" }
  | { kind: "control" };

export interface HeroDrag { kind: "hero"; part: "height" | "focus"; x: number; y: number; rows: number; cols: number; focus: Focus; line: number; now?: { height?: number; focus?: Focus } }
type Landing = Extract<ReaderGesture, { kind: "hero" | "figure" }>;
type Of<K extends ReaderGesture["kind"]> = Extract<ReaderGesture, { kind: K }>;

export class ReaderPointer {
  /** What the button is doing; the getters below read it as each kind. */
  private gesture: ReaderGesture | null = null;
  /** A hero or figure let go, drawn where it was let go until its save lands. */
  private landing: Landing | null = null;
  /** The press's cell, how many clicks it makes and whether a drag left it. */
  readonly clicks = new Gesture();

  get held(): ReaderGesture | null { return this.gesture; }
  private of<K extends ReaderGesture["kind"]>(kind: K): Of<K> | null { const g = this.gesture; return g?.kind === kind ? g as Of<K> : null; }
  get text() { return this.of("text"); }
  get draft() { return this.of("draft"); }
  get frame() { return this.of("frame"); }
  get heldFigure() { return this.of("figure"); }
  /** The header image as it's drawn: held, or landing. */
  get hero(): HeroDrag | null { return this.of("hero") ?? (this.landing?.kind === "hero" ? this.landing : null); }
  /** The figure as it's drawn: held, or landing. */
  get figure(): Of<"figure"> | null { return this.of("figure") ?? (this.landing?.kind === "figure" ? this.landing : null); }

  /** A press became this. What was held before it is over. */
  hold<G extends ReaderGesture>(g: G): G { this.letGo(); this.gesture = g; return g; }

  /** Over, with nothing fired: no click, no save, no copy. What it selected stays selected. */
  end() { if (!this.gesture) return; this.letGo(); this.clicks.cancel(); }

  /** The release: it's over, and the caller does what its kind does. */
  take(): ReaderGesture | null { const g = this.gesture; this.gesture = null; return g; }

  /** Let go with a save on its way: drawn where it is until `landed`. */
  land(g: Landing) { if (this.gesture === g) this.gesture = null; this.landing = g; }
  /** Its save landed (or failed): drawn from the note again. */
  landed(g: Landing) { if (this.landing !== g) return; this.landing = null; if (g.kind === "figure") resizeEnded(); }

  /** Another note: nothing held or landing belongs to it. */
  reset() { this.end(); if (this.landing) this.landed(this.landing); }

  private letGo() {
    const g = this.gesture;
    this.gesture = null;
    if (g?.kind === "figure") resizeEnded();
    if (g?.kind === "sources") g.letGo();
  }
}
