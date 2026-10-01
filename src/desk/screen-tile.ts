// A whole screen as a tile (PIE-413): the board, the river or the brief, dragged, tabbed and split like
// any tile. It is the showcase's FramedScreen (src/showcase/frame.ts), the screen drawn inside a
// rectangle with a Ctx whose terminal is that rectangle, not a copy of the screen. What the screen selects
// (the board's card) is the tile's selection: a preview tile can follow it, and the board's own preview
// strip can become one (`tile.preview` on the board).
import type { Screen } from "../app";
import type { Msg } from "../board";
import type { Placement } from "../kitty";
import { USER, type Actor, type OutlineEvent } from "../socket";
import { FramedScreen } from "../showcase/frame";
import type { ActRequest } from "../surface/actions";
import type { Key } from "../term";
import type { DeskApi, Pane, PaneView } from "./panes";

export type ScreenKind = "board" | "river" | "brief";
export const SCREEN_KINDS: readonly ScreenKind[] = ["board", "river", "brief"];

/** The screen for a kind, built when the tile is first shown (every module has loaded by then). */
function make(kind: ScreenKind): Screen {
  // Loaded here, not at the top: the brief is built on the desk, which builds these tiles.
  if (kind === "board") return new (require("./delivery").DeliveryBoard)();
  if (kind === "river") return new (require("../river/river").River)();
  return new (require("../brief/brief").Brief)();
}

export class ScreenTile implements Pane {
  private framed: FramedScreen | null = null;
  private desk: DeskApi | null = null;
  private selected: string | null = null;
  /** The board's own preview strip: false when a preview tile follows the board instead (it's collapsed). */
  private preview = true;
  constructor(readonly kind: ScreenKind, spec: { preview?: boolean } = {}) { if (spec.preview === false) this.preview = false; }

  /** Collapse (false) or open the board's own preview strip; a preview tile then follows the board instead. */
  async ownPreview(on: boolean, actor: Actor = USER) {
    this.preview = on;
    const s = this.framed?.first;
    if (this.kind === "board" && s?.act) await s.act({ action: "tile.collapse", reader: "preview", args: { on: !on } }, actor).catch(() => {});
  }
  spec() { return this.preview ? {} : { preview: false }; }

  get screen(): Screen | null { return this.framed?.top ?? null; }
  title() { return this.framed ? `${this.kind} · ${this.framed.top.title}` : this.kind; }
  hint() { return "its own keys · 1-9 and ^W stay the desk's"; }

  init(desk: DeskApi) {
    if (this.framed) return;
    this.desk = desk;
    this.framed = new FramedScreen(make(this.kind), () => desk.ctx, () => desk.ctx.flash(`the ${this.kind} is a tile · ^W x closes it, ^W z zooms it`));
    if (!this.preview) { this.framed.open(); void this.ownPreview(false); }
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
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
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

  /** Its screen's actions, for `act tile=<this tile>`. */
  actions() { return this.framed?.top.actions?.() ?? null; }
  act(req: ActRequest, actor: Actor): Promise<unknown> {
    const s = this.framed?.top;
    if (!s?.act) throw new Error(`the ${this.kind} tile has no actions`);
    return s.act(req, actor);
  }
  describe() { return this.framed?.top.describe?.() ?? null; }
}
