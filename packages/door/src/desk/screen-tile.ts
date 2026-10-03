// A whole screen as a tile (PIE-413): the board or the river, dragged, tabbed and split like
// any tile. It is the showcase's FramedScreen (src/showcase/frame.ts), the screen drawn inside a
// rectangle with a Ctx whose terminal is that rectangle, not a copy of the screen. What the screen selects
// (the board's card) is the tile's selection: a preview tile can follow it, and the board's own preview
// strip can become one (`tile.preview` on the board). A screen made for the current note each time it moves
// (`Follows`: the showcase's BBS message reader beside a reader) is a screen tile too.
import type { Screen } from "../app";
import type { Msg } from "../board";
import type { Placement } from "../kitty";
import { USER, type Actor, type OutlineEvent } from "../socket";
import { FramedScreen } from "../showcase/frame";
import { ch, type Key } from "../term";
import type { DeskApi, Pane, PaneView } from "./panes";

export type ScreenKind = "board" | "river";

/**
 * The screen for a kind, built when the tile is first shown (every module has loaded by then; loaded here, not at the
 * top: the brief is built on the desk, which builds these tiles). Kept in memory: the screen itself owns its save
 * (delivery.json, river.json), and the desk saves the tile.
 */
const make = (kind: string): Screen => require("./screen-specs").openScreen(kind, { persist: false });

/** A screen made for the desk's current note, again each time it moves, and the tile's title. */
export interface Follows { label: string; make(m: Msg | null): Screen | null }

export class ScreenTile implements Pane {
  private framed: FramedScreen | null = null;
  private desk: DeskApi | null = null;
  private selected: string | null = null;
  /** The board's own preview strip: false when a preview tile follows the board instead (it's collapsed). */
  private preview = true;
  constructor(readonly kind: string, spec: { preview?: boolean } = {}, private readonly follows?: Follows) { if (spec.preview === false) this.preview = false; }

  /** Collapse (false) or open the board's own preview strip; a preview tile then follows the board instead. */
  async ownPreview(on: boolean, actor: Actor = USER) {
    this.preview = on;
    const s = this.framed?.first;
    if (this.kind === "board" && s?.dispatch) await s.dispatch.act({ action: "tile.collapse", tile: "preview", args: { on: !on } }, actor).catch(() => {});
  }
  spec() { return this.preview ? {} : { preview: false }; }

  get screen(): Screen | null { return this.framed?.top ?? null; }
  title() { return this.follows?.label ?? (this.framed ? `${this.kind} · ${this.framed.top.title}` : this.kind); }
  hint() { return "its own keys · 1-9 and ^W stay the desk's"; }

  init(desk: DeskApi) {
    if (this.framed || this.follows) return;
    this.frame(make(this.kind), desk);
    if (!this.preview) { this.framed!.open(); void this.ownPreview(false); }
  }
  select(m: Msg | null, desk: DeskApi) { if (this.follows) { this.framed?.dispose(); this.frame(this.follows.make(m), desk); } }
  private frame(s: Screen | null, desk: DeskApi) {
    this.desk = desk;
    this.framed = s && new FramedScreen(s, () => desk.ctx, () => desk.ctx.flash(`the ${this.kind} is a tile · ^W x closes it, ^W z zooms it`), undefined, () => !!desk.hasFocus?.(this));
  }

  /** What the screen has selected (the board's card): the tile's selection, for a preview following it. */
  current(): Msg | null { return ((this.framed?.first as { current?: Msg | null } | undefined)?.current) ?? null; }

  render(w: number, h: number): PaneView {
    if (!this.framed) return { lines: [] };
    const f = this.framed.render(w, h, `tile-${this.kind}`);
    this.noticeSelection();
    return { lines: f.lines, placements: f.placements as Placement[] };
  }

  /** The screen moved its selection: the desk hears it once, after this frame. */
  private noticeSelection() {
    const m = this.current();
    if (!m || m.id === this.selected) return;
    this.selected = m.id;
    const desk = this.desk;
    queueMicrotask(() => desk?.setCurrent(m, { from: this }));
  }

  key(k: Key): boolean {
    if (!this.framed) return false;
    const c = ch(k);
    // In an edit, a comment or a panel, every key is the screen's; otherwise the desk keeps 1-9 and video.
    if (!this.framed.top.holdsKeys?.() && (/^[1-9]$/.test(c) || c === "V")) return false;
    this.framed.key(k);
    this.desk?.redraw();
    return true;
  }

  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number): boolean {
    this.framed?.key({ ...k, x, y });
    this.desk?.redraw();
    return true;
  }
  wheel(dir: 1 | -1) { this.framed?.key({ kind: "mouse", action: dir < 0 ? "wheel-up" : "wheel-down", button: 0, x: 0, y: 0 }); }

  tick() { return this.framed?.tick() ?? false; }
  onEvent(_desk: DeskApi, e?: OutlineEvent) { if (e) this.framed?.onEvent(e); }
  unsaved() { return this.framed?.unsaved() ?? false; }
  keepDrafts() { return this.framed?.keepDrafts() ?? []; }
  dispose() { this.framed?.dispose(); }
  holdsKeys() { return !!this.framed?.top.holdsKeys?.(); }

  describe() { return this.framed?.top.describe?.() ?? null; }
}
