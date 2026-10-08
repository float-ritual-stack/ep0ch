// A whole screen drawn inside a rectangle of another: the showcase puts the real board, a desk of its own spec
// and the BBS screens side by side this way, so each is the part itself and not a copy of it. The
// screen sees a Ctx whose terminal is the rectangle; its pushes stack inside the rectangle, and popping
// its first screen hands the keys back to whoever framed it.
import type { Ctx, Frame, Screen, Video } from "../app";
import type { Key, TermInfo } from "../term";
import { nothingLeft } from "../shell-keys";
import { NOBODY, screenKeys, within } from "../whereabouts";
import type { Arm } from "../arm";

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
  constructor(first: Screen, private readonly outer: () => Ctx, private readonly leave: () => void = () => {}, private readonly opened: () => void = () => {}, readonly focused: () => boolean = () => true, private readonly escaped?: () => void) {
    this.stack.push(first);
    this.ctx = frameCtx(this);
  }

  get top(): Screen { return this.stack.at(-1)!; }
  get first(): Screen { return this.stack[0]!; }
  get outerCtx(): Ctx { return this.outer(); }
  get depth() { return this.stack.length; }

  /** Enter the first screen once, when it is first shown (it reads the outline then). */
  open() { if (!this.entered) { this.entered = true; this.first.enter?.(this.ctx); this.opened(); } }

  // An edit armed in the frame is its top screen's: a screen pushed over it, popped or replaced lets it go (App.push does the same).
  push(s: Screen) { this.outer().disarm?.(); this.stack.push(s); s.enter?.(this.ctx); this.outer().redraw(); }
  pop() {
    const top = this.stack.at(-1);
    if (this.stack.length === 1) { this.leave(); this.outer().redraw(); return; }
    // An inner screen holding a draft stays: the person gets the outer unsaved guard's message instead.
    if (top?.unsaved?.()) { this.outer().flash("an edit isn't saved · ctrl+s saves it"); return; }
    this.outer().disarm?.();
    this.stack.pop();
    top?.dispose?.();
    this.outer().redraw();
  }
  /**
   * Esc with nothing left to close in the frame's first screen: `escaped` (the showcase's stage gives the keys back to its
   * index; a screen tile, to the desk's next step). A screen pushed in the frame, or a frame without one, says so here: a
   * frame around this one never hears it, so its own steps aren't skipped.
   */
  nothingToClose(leave: string) {
    if (this.escaped && this.stack.length === 1) return this.escaped();
    this.outer().flash(nothingLeft(leave));
  }
  /** The frame goes away: each screen in it ends what it started (a draft's hold on the service, PIE-501). */
  dispose() { this.outer().disarm?.(); for (const s of [...this.stack].reverse()) s.dispose?.(); }
  replace(s: Screen) { this.outer().disarm?.(); const was = this.stack.at(-1); if (this.stack.length === 1) { this.stack[0] = s; s.enter?.(this.ctx); } else { this.stack.pop(); this.push(s); } if (was !== s) was?.dispose?.(); this.outer().redraw(); }

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
    // The drawer is the door's, above every screen: a tile put in from a stage travels like any other (PIE-498).
    get hostLayer() { return o().hostLayer; },
    get video(): Video { return o().video; },
    get graphics() { return o().graphics; },
    get whatChanged() { return o().whatChanged; },
    get lastCall() { return o().lastCall; },
    set lastCall(v: number) { o().lastCall = v; },
    get events() { return o().events; },
    push: s => f.push(s),
    pop: () => f.pop(),
    replace: s => f.replace(s),
    quit: () => o().quit(),
    redraw: () => o().redraw(),
    flash: m => o().flash(m),
    nothingToClose: leave => f.nothingToClose(leave),
    copy: (text, from) => o().copy?.(text, from) ?? false,
    cycleVideo: () => o().cycleVideo(),
    setTheme: name => o().setTheme?.(name),
    suspend: ((run: () => Promise<unknown>, what?: string) => o().suspend(run, what)) as Ctx["suspend"],
    suspended: () => o().suspended?.() ?? null,
    inTile: (p, done) => o().inTile?.(p, done) ?? false,
    // The door's actions as the person (note.new's ctrl+n, a click on an empty reader's + New note): the outer door's
    // dispatcher, which reaches this frame's screen through its own (the showcase's editNew).
    press: (name: string, args?: Record<string, unknown>) => { const c = o(); return c.press ? c.press(name, args) : Promise.resolve(undefined); },
    idleFor: () => o().idleFor?.() ?? Infinity,
    // An edit armed in the frame is the door's (the shell takes the next key); a door without arming opens at once.
    get arm() { const c = o(); return c.arm ? (a: Arm) => c.arm!(a) : undefined; },
    armed: () => o().armed?.() ?? null,
    disarm: () => o().disarm?.(),
    // Where the person is, as seen from inside the frame: its screen has their focus only while the frame has it.
    person: () => within(o().person?.() ?? NOBODY, f.focused(), screenKeys(f.top)),
  };
}
