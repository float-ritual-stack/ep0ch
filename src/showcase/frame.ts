// A whole screen drawn inside a rectangle of another: the showcase puts the real board, a desk of its own spec
// and the BBS screens side by side this way, so each is the part itself and not a copy of it. The
// screen sees a Ctx whose terminal is the rectangle; its pushes stack inside the rectangle, and popping
// its first screen hands the keys back to whoever framed it.
import type { Ctx, Frame, Screen, Video } from "../app";
import type { Msg } from "../board";
import type { Placement } from "../kitty";
import type { Key, TermInfo } from "../term";
import type { DeskApi, Pane, PaneView } from "../desk/panes";
import { NOBODY, screenKeys, within } from "../whereabouts";

export class FramedScreen {
  private stack: Screen[] = [];
  /** The rectangle's size in cells (the screen's rows are `h`, plus the status bar row it never draws). */
  w = 80;
  h = 24;
  readonly ctx: Ctx;
  private entered = false;

  /**
   * `focused`: the frame has the person's keys where it is (its tile is focused, the showcase's stage is entered);
   * the screen inside sees the person's whereabouts through it (`within`). Without it, it always has them.
   */
  constructor(first: Screen, private readonly outer: () => Ctx, private readonly leave: () => void = () => {}, private readonly opened: () => void = () => {}, readonly focused: () => boolean = () => true) {
    this.stack.push(first);
    this.ctx = frameCtx(this);
  }

  get top(): Screen { return this.stack.at(-1)!; }
  get first(): Screen { return this.stack[0]!; }
  get outerCtx(): Ctx { return this.outer(); }
  get depth() { return this.stack.length; }

  /** Enter the first screen once, when it is first shown (it reads the outline then). */
  open() { if (!this.entered) { this.entered = true; this.first.enter?.(this.ctx); this.opened(); } }

  push(s: Screen) { this.stack.push(s); s.enter?.(this.ctx); this.outer().redraw(); }
  pop() {
    const top = this.stack.at(-1);
    if (this.stack.length === 1) { this.leave(); this.outer().redraw(); return; }
    // An inner screen holding a draft stays: the person gets the outer unsaved guard's message instead.
    if (top?.unsaved?.()) { this.outer().flash("an edit isn't saved · ctrl+s saves it"); return; }
    this.stack.pop();
    top?.dispose?.();
    this.outer().redraw();
  }
  /** The frame goes away: each screen in it ends what it started (a draft's hold on the service, PIE-501). */
  dispose() { for (const s of [...this.stack].reverse()) s.dispose?.(); }
  replace(s: Screen) { const was = this.stack.at(-1); if (this.stack.length === 1) { this.stack[0] = s; s.enter?.(this.ctx); } else { this.stack.pop(); this.push(s); } if (was !== s) was?.dispose?.(); this.outer().redraw(); }

  /** The top screen, drawn `w` by `h`. Its image placements keep their keys under `tag`. */
  render(w: number, h: number, tag: string): Frame {
    this.w = Math.max(1, w); this.h = Math.max(1, h);
    this.open();
    const f = this.top.render(this.ctx);
    const lines = f.lines.slice(0, this.h);
    return { lines, placements: (f.placements ?? []).map(p => ({ ...p, key: `${tag}:${p.key}` })) };
  }

  /** A key, with mouse positions already relative to the rectangle. */
  key(k: Key) { this.open(); this.top.key(k, this.ctx); }
  tick() { return this.stack.some(s => s.tick?.(this.ctx) ?? false); }
  onEvent(e: import("../socket").OutlineEvent) { for (const s of this.stack) s.onEvent?.(e, this.ctx); }
  unsaved() { return this.stack.some(s => s.unsaved?.() ?? false); }
  keepDrafts() { return this.stack.flatMap(s => s.keepDrafts?.() ?? []); }
}

/** The Ctx a framed screen sees: the outer one, with the rectangle as its terminal and its own stack. */
function frameCtx(f: FramedScreen): Ctx {
  const o = () => f.outerCtx;
  return {
    get t(): TermInfo { return { ...o().t, cols: f.w, rows: f.h + 1 }; },
    get board() { return o().board; },
    get host() { return o().host; },
    get workspace() { return o().workspace; },
    get outline() { return o().outline; },
    get video(): Video { return o().video; },
    get graphics() { return o().graphics; },
    get lastCall() { return o().lastCall; },
    set lastCall(v: number) { o().lastCall = v; },
    get events() { return o().events; },
    set events(v: number) { o().events = v; },
    push: s => f.push(s),
    pop: () => f.pop(),
    replace: s => f.replace(s),
    quit: () => o().quit(),
    redraw: () => o().redraw(),
    flash: m => o().flash(m),
    copy: text => o().copy?.(text),
    cycleVideo: () => o().cycleVideo(),
    setTheme: name => o().setTheme?.(name),
    suspend: ((run: () => Promise<unknown>, what?: string) => o().suspend(run, what)) as Ctx["suspend"],
    suspended: () => o().suspended?.() ?? null,
    editInTile: (path, cmd, done) => o().editInTile?.(path, cmd, done) ?? false,
    idleFor: () => o().idleFor?.() ?? Infinity,
    // Where the person is, as seen from inside the frame: its screen has their focus only while the frame has it.
    person: () => within(o().person?.() ?? NOBODY, f.focused(), screenKeys(f.top)),
  };
}

/**
 * A screen as a desk pane: the BBS reader, Who's Online and Last Callers beside the shared parts that
 * replace them. `make` builds the screen for the desk's current note (`follows`), or once.
 */
export class ScreenPane implements Pane {
  readonly kind = "exhibit";
  private framed: FramedScreen | null = null;
  private desk: DeskApi | null = null;
  constructor(private readonly label: string, private readonly make: (m: Msg | null) => Screen | null, private readonly follows = false) {}
  title() { return this.label; }
  hint() { return "this screen's own keys · tab moves on"; }
  private build(m: Msg | null, desk: DeskApi) {
    const s = this.make(m);
    this.desk = desk;
    this.framed = s ? new FramedScreen(s, () => desk.ctx, undefined, undefined, () => !!desk.hasFocus?.(this)) : null;
  }
  init(desk: DeskApi) { if (!this.follows) this.build(null, desk); }
  select(m: Msg | null, desk: DeskApi) { if (this.follows) this.build(m, desk); }
  onEvent() { /* the framed screens read the outline when opened; they have no live refresh of their own */ }
  render(w: number, h: number): PaneView {
    if (!this.framed) return { lines: [] };
    const f = this.framed.render(w, h, "screen");
    return { lines: f.lines, placements: f.placements as Placement[] };
  }
  key(k: Key): boolean {
    if (!this.framed) return false;
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    // A screen in an edit, a comment or a property panel takes every key (its q, esc, digits are text or its own).
    if (this.framed.top.holdsKeys?.()) { this.framed.key(k); this.desk?.redraw(); return true; }
    // The desk keeps focus keys (1-9), video and search; esc or q on the first screen leaves the desk.
    if (/^[1-9]$/.test(c) || c === "V" || c === "/") return false;
    if (this.framed.depth === 1 && (k.kind === "esc" || c === "q" || c === "Q")) return false;
    this.framed.key(k);
    this.desk?.redraw();
    return true;
  }
}
