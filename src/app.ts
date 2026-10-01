// The door: a stack of screens, one status bar, one paint per change.
import type { Placement } from "./kitty";
import { KittyLayer } from "./kitty";
import { AGENT_ACTOR_ID, USER, type Actor, type SocketBoard, type OutlineEvent } from "./socket";
import { ActionRefused, agentLabel, asActor, type ActionInfo, type ActRequest } from "./surface/actions";
import { SHELL_ACTIONS, shellOpenBlock } from "./screens";
import { osc52 } from "./surface/selection";
import { bg, C, fg, pad, RESET, width } from "./style";
import { OPTION_AS_ALT_HINT, OPTION_KEYS, optionKeysOn, pasteKeys, type Key, type Term, type TermInfo } from "./term";
import { crtUnderlay } from "./crt";
import { paintingScroll } from "./scroll";
import { invalidateLive, setLiveSource } from "./live";
import { resourceChanged } from "./projection";
import { invalidatePropertyErrors } from "./props";
import { outlineChanged } from "./refs";
import { doorNest } from "./nest";
import { AgentDock, DOCK_ACTIONS, DOCK_TILE_ID, dockRunner, overlay, type DockRun } from "./dock";
import { shareAgent, sharedAgent } from "./desk/tiles";

/** Changes whose record names the one block they touched (a move or trash carries a subtree). */
const SCOPED = new Set(["edit", "create", "annotate", "reorder"]);

export interface Frame { lines: string[]; placements?: Placement[] }

export type Video = "kitty+crt" | "kitty" | "cells";

export interface Ctx {
  t: TermInfo;
  /** "What changed" includes extension writes (`changes.extensions`); off by default. */
  extensionChanges?: boolean;
  /** Extension writes since logon, counted apart from `events`. */
  extEvents?: number;
  board: SocketBoard;
  host: string;
  workspace: string;
  /** The outline's name on an outline host (PIE-466); absent on a single-outline service. */
  outline?: string;
  video: Video;
  get graphics(): boolean;
  push(s: Screen): void;
  pop(): void;
  replace(s: Screen): void;
  quit(): void;
  redraw(): void;
  flash(msg: string, ms?: number): void;
  /** Put text on the terminal's clipboard (OSC 52; Herdr and Ghostty pass it on). */
  copy?(text: string): void;
  cycleVideo(): void;
  /**
   * The door is about to quit (the menu's logoff): true when it may. With programs running in a screen (even
   * one in the background) or an unsaved edit, the first ask says so and refuses; again within 3s goes.
   */
  confirmQuit?(): boolean;
  /**
   * Hand the terminal to another program for the duration of `run`, then repaint: $EDITOR (ctrl+e) runs in
   * it synchronously; the drop shell (`screen.shell`) returns a promise, and the door waits for it with its
   * event loop running (tiles read, the control socket answering) and nothing painted. `what` is said by `peek`.
   */
  suspend(run: () => void): void;
  suspend(run: () => Promise<unknown>, what?: string): Promise<void>;
  /** What has the terminal while the door is suspended ("shell", "editor"), or null. */
  suspended?(): string | null;
  /**
   * Run an editor on `path` in a terminal tile beside the note instead of suspending the door (PIE-417):
   * true when the screen has tiles and opened one; `done` is called with its exit code when it ends.
   */
  editInTile?(path: string, cmd: string, done: (code: number | null) => void): boolean;
  lastCall: number;
  events: number;          // outline changes seen since the menu last looked
  /** The screen stack, bottom first (the shell's actions read it: `screen.list`, what `screen.back` leaves). */
  screens?(): readonly Screen[];
  /** Milliseconds since the person last pressed a key or used the mouse: an agent moves their screen only when they're idle. */
  idleFor?(): number;
  /** The person is typing in the agent drawer (PIE-498): an agent doesn't move their screen then either. */
  dockHoldsKeys?(): boolean;
}

export interface Screen {
  title: string;
  /** Rows available = t.rows - 1 (the last row is the status bar). */
  render(ctx: Ctx): Frame;
  key(k: Key, ctx: Ctx): void;
  enter?(ctx: Ctx): void;
  /** Called ~30×/s while it returns true (modem-speed reveals). */
  tick?(ctx: Ctx): boolean;
  onEvent?(e: OutlineEvent, ctx: Ctx): void;
  /** True while the screen holds a draft that hasn't been saved; closing it or quitting then asks twice. */
  unsaved?(): boolean;
  /** The screen is being closed with unsaved drafts: copy them to disk, return where they went. */
  keepDrafts?(): string[];
  /** The door is ending (any way): copy what an editor still has open for a draft (ctrl+e) to disk, return where. */
  keepEdits?(): string[];
  /** The screen wants every key, even those a frame around it keeps (an edit, a comment, a property panel). */
  holdsKeys?(): boolean;
  /** What this screen shows, for agents (`ep0ch-door peek`). */
  describe?(): unknown;
  /** Put a block in front of the user (`ep0ch-door open <id>`). */
  openBlock?(m: import("./board").Msg): void;
  /** The named actions this screen and its readers take (`ep0ch-door actions`), and the readers they can name. */
  actions?(): { actions: ActionInfo[]; readers: string[] };
  /** Run a named action as `actor`, through the same code as its keys (`ep0ch-door act`). */
  act?(req: ActRequest, actor: Actor): Promise<unknown>;
  /** Every key is the screen's, ctrl+c included: the person is typing in a terminal tile (PIE-417). */
  rawKeys?(): boolean;
  /** Where raw input bytes go right now (a running terminal tile the person is in), or null to decode keys. */
  rawInput?(): ((bytes: string) => void) | null;
  /** The screen takes a paste whole (`{kind:"paste"}`); otherwise App gives it the pasted text as keys. */
  acceptsPaste?(): boolean;
  /** Leaving the screen would end something (programs running in tiles): said, and asked twice. */
  leaveWarning?(): string | null;
  /**
   * The screen is left (popped or replaced). It ends what it started, or answers "keep": it has programs
   * running (the desk's terminal tiles) and stays alive in the background until it's opened again or the
   * door quits.
   */
  dispose?(): void | "keep";
  /** Why the screen can't be left now (it would end something and has no way back), or null. */
  leaveRefusal?(): string | null;
  /** See Ctx.editInTile. */
  editInTile?(path: string, cmd: string, done: (code: number | null) => void): boolean;
  /** What the person sees, for `view.subscribe`: diffed after every paint and pushed as events. */
  viewState?(): ViewState;
  /** No agent drawer and no chip here (the logon, the logoff: the person isn't in yet, or is leaving). */
  noDock?: boolean;
}

/**
 * What a screen shows, as `view.subscribe` publishes it: which tile has the keys (and what it shows), the
 * layout's shape, each tile's viewport (what's in view) and cursor or selection, and the attention marks.
 */
export interface ViewState {
  focus: { tile: string; block?: string | null; file?: string | null };
  layout: unknown;
  tiles: { tile: string; viewport: unknown; cursor?: unknown }[];
  marks?: unknown;
}
/** One event of the live feed: `focus.changed`, `layout.changed`, `viewport`, `cursor`, `marks.changed`, `screen`. */
export interface ViewEvent { type: string; at: number; [k: string]: unknown }

/** An agent's actor id: what it calls itself, or `ep0ch-door:<host>:agent`. Kept to plain, short ids. */
export function agentActor(as?: string): Actor {
  const id = (as ?? "").trim() || AGENT_ACTOR_ID;
  if (!/^[\w.:@/-]{1,80}$/.test(id)) throw new ActionRefused(`an actor id is 1-80 letters, digits and . : @ / - _, not ${JSON.stringify(id)}`);
  return { kind: "agent", id };
}

export class App implements Ctx {
  private stack: Screen[] = [];
  private kitty: KittyLayer;
  private message = "";
  private messageUntil = 0;
  private timer: Timer | null = null;
  private started: number;
  /** The status bar's clock and uptime as last painted: a minute later, the bar alone is repainted. */
  private shownTime = "";
  private quitArmed = 0;
  /** When the person last pressed a key or used the mouse (Date.now()). */
  lastInput = 0;
  host = "";
  workspace = "";
  outline: string | undefined;
  video: Video;
  events = 0;
  /** Changes extensions wrote since logon (a refreshed ticket): counted apart, shown when asked for. */
  extEvents = 0;
  /** Whether "what changed" (the +N count, newscan) includes what extensions wrote: `changes.extensions`. */
  extensionChanges = false;
  /** Where the status bar's `+N ext` sits, for a click. */
  private extAt: { from: number; to: number; row: number } | null = null;
  /** The event connection to the service is down; the door is reconnecting. */
  offline = false;
  /** The agent that stays with the person on every screen, pulled up from the status bar (PIE-498). */
  readonly dock: AgentDock;
  private dockRun: DockRun;

  /** `now`: the clock the status bar reads (a test's fake one). */
  constructor(private readonly term: Term, readonly board: SocketBoard, public lastCall: number, private readonly done: () => void, private readonly now: () => number = Date.now) {
    this.started = now();
    this.kitty = new KittyLayer(term.write);
    this.video = term.info.kitty ? "kitty+crt" : "cells";
    this.dock = new AgentDock({ redraw: () => this.redraw(), statusChanged: () => this.statusChanged(), flash: (m, ms) => this.flash(m, ms) });
    this.dockRun = dockRunner(this.dock, this, () => this.stack.at(-1));
    // The daily layout's agent tile is the dock's (one attach to its Herdr pane per door).
    shareAgent(this.dock);
    term.onKey(k => this.key(k));
    term.onBatch?.(run => this.batched(run));
    // Raw input while the person types in the agent drawer or a terminal tile: the drawer first, then the
    // screen says where it goes (Term keeps mouse and ctrl+]).
    (term as { rawSink?: unknown }).rawSink = () => this.dock.rawInput(this.dockRun) ?? this.stack.at(-1)?.rawInput?.() ?? null;
    setLiveSource(board, () => this.redraw());
    board.onConnection = (state, detail) => { this.offline = state === "lost"; this.flash(state === "lost" ? detail : `reconnected · ${detail}`); };
    term.onResize(() => this.redraw());
    this.timer = setInterval(() => this.tick(), 33);
  }

  get t() { return this.term.info; }
  screens(): readonly Screen[] { return this.stack; }
  idleFor(): number { return Date.now() - this.lastInput; }
  dockHoldsKeys(): boolean { return this.dock.shown && this.dock.entered; }
  get graphics() { return this.video !== "cells"; }

  /** Screens left with programs still running in them (the desk's terminals): alive until reopened or the door quits. */
  background: Screen[] = [];
  push(s: Screen) { this.background = this.background.filter(x => x !== s); this.stack.push(s); s.enter?.(this); this.redraw(); }
  pop() {
    const last = this.stack.length === 1;
    if (!this.leaving(last ? [...this.stack, ...this.background] : [this.stack.at(-1)], last)) return;
    this.leave();
    if (!this.stack.length) return this.quit();
    this.redraw();
  }
  replace(s: Screen) { if (!this.leaving([this.stack.at(-1)])) return; this.leave(); this.push(s); }
  /** The top screen goes: it ends what it started, or keeps running in the background (its programs). */
  private leave() {
    const top = this.stack.pop();
    if (top?.dispose?.() === "keep") { this.background.push(top); this.flash(`${top.leaveWarning?.() ?? top.title} · still running · D on the menu comes back`, 6000); }
  }

  /**
   * Closing screens that hold unsaved edits asks twice. The second time goes ahead, but the drafts are
   * copied to disk first, so typed text is never simply dropped.
   */
  /**
   * Leaving screens (or, `quitting`, the door): an unsaved edit asks twice, and so does quitting while programs
   * run in a screen. Leaving a screen that keeps its programs alive (the desk) doesn't ask: nothing ends.
   * A screen that can't be left says why and stays.
   */
  private leaving(screens: (Screen | undefined)[], quitting = false): boolean {
    const refusal = quitting ? null : screens.map(s => s?.leaveRefusal?.()).find(Boolean);
    if (refusal) { this.flash(refusal); return false; }
    const dirty = screens.filter((s): s is Screen => !!s?.unsaved?.());
    const warn = quitting ? screens.map(s => s?.leaveWarning?.()).find(Boolean) ?? this.dock.leaveWarning() : null;
    if (!dirty.length && !warn) return true;
    if (Date.now() - this.quitArmed < 3000) { this.quitArmed = 0; dirty.forEach(s => s.keepDrafts?.()); return true; }
    this.quitArmed = Date.now();
    this.flash(dirty.length ? "an edit isn't saved · ctrl+s saves it · again within 3s leaves (the draft is copied to disk)" : warn!);
    return false;
  }
  editInTile(path: string, cmd: string, done: (code: number | null) => void): boolean { return this.stack.at(-1)?.editInTile?.(path, cmd, done) ?? false; }
  confirmQuit(): boolean { return this.leaving([...this.stack, ...this.background], true); }
  flash(msg: string, ms = 4000) { this.message = msg; this.messageUntil = Date.now() + ms; this.redraw(); }

  // ── the live feed (view.subscribe): what the person sees, pushed as it changes ──
  private viewers = new Set<(e: ViewEvent) => void>();
  private shown: { screen: string; focus: string; layout: string; tiles: Map<string, string>; cursors: Map<string, string>; marks: string } | null = null;

  /** Hear every change to what the person sees. The first event is the whole state (`hello`). */
  subscribe(f: (e: ViewEvent) => void): () => void {
    const s = this.stack.at(-1);
    const state = s?.viewState?.() ?? null;
    f({ type: "hello", at: Date.now(), screen: s?.title ?? null, state });
    this.viewers.add(f);
    // Every subscriber starts from what the hello said: what changes after it comes as events.
    if (s && state && !this.shown) this.shown = this.snapshot(s.title, state);
    return () => { this.viewers.delete(f); };
  }

  private snapshot(screen: string, v: ViewState) {
    return { screen, focus: JSON.stringify(v.focus), layout: JSON.stringify(v.layout), tiles: new Map(v.tiles.map(t => [t.tile, JSON.stringify(t.viewport)] as const)), cursors: new Map(v.tiles.map(t => [t.tile, JSON.stringify(t.cursor ?? null)] as const)), marks: JSON.stringify(v.marks ?? null) };
  }

  /** After paints: the feed is published at most every 50ms, from what's on screen then. */
  private publishTimer: Timer | null = null;
  private schedulePublish() {
    if (!this.viewers.size) { this.shown = null; return; }
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => { this.publishTimer = null; const s = this.stack.at(-1); if (s) this.publishView(s); }, 50);
  }

  /** After a paint: what changed since the last one, as events to every subscriber. */
  private publishView(s: Screen) {
    if (!this.viewers.size) { this.shown = null; return; }
    const v = s.viewState?.();
    const at = Date.now();
    const send = (e: Omit<ViewEvent, "at">) => { for (const f of this.viewers) { try { f({ ...e, at } as ViewEvent); } catch { /* a subscriber's own problem */ } } };
    if (!v) { if (this.shown?.screen !== s.title) send({ type: "screen", screen: s.title }); this.shown = { screen: s.title, focus: "", layout: "", tiles: new Map(), cursors: new Map(), marks: "" }; return; }
    const was = this.shown?.screen === s.title ? this.shown : null;
    const now = { screen: s.title, focus: JSON.stringify(v.focus), layout: JSON.stringify(v.layout), tiles: new Map<string, string>(), cursors: new Map<string, string>(), marks: JSON.stringify(v.marks ?? null) };
    if (this.shown && this.shown.screen !== s.title) send({ type: "screen", screen: s.title });
    if (was?.layout !== now.layout) send({ type: "layout.changed", layout: v.layout });
    if (was?.focus !== now.focus) send({ type: "focus.changed", ...v.focus });
    for (const t of v.tiles) {
      const vp = JSON.stringify(t.viewport), cu = JSON.stringify(t.cursor ?? null);
      now.tiles.set(t.tile, vp); now.cursors.set(t.tile, cu);
      if (was?.tiles.get(t.tile) !== vp) send({ type: "viewport", tile: t.tile, viewport: t.viewport });
      if (t.cursor !== undefined && was?.cursors.get(t.tile) !== cu) send({ type: "cursor", tile: t.tile, cursor: t.cursor });
    }
    if (was?.marks !== now.marks && v.marks !== undefined) send({ type: "marks.changed", marks: v.marks });
    this.shown = now;
  }
  copy(text: string) { this.term.write(osc52(text)); }
  cycleVideo() {
    if (!this.term.info.kitty) { this.flash("this terminal did not answer the Kitty graphics query; cells only"); return; }
    this.video = this.video === "kitty+crt" ? "kitty" : this.video === "kitty" ? "cells" : "kitty+crt";
    this.term.invalidate();
    this.flash(`video: ${this.video}`);
  }

  /** What has the terminal while the door is suspended, or null (see Ctx.suspend). */
  private away: string | null = null;
  suspended(): string | null { return this.away; }
  suspend(run: () => void): void;
  suspend(run: () => Promise<unknown>, what?: string): Promise<void>;
  suspend(run: () => void | Promise<unknown>, what = "editor"): void | Promise<void> {
    if (this.away) throw new Error(`the terminal is already handed over (${this.away})`);
    this.kitty.dispose();                  // images don't survive the screen switch; the next paint re-uploads
    this.term.stop();
    this.away = what;
    const back = () => {
      this.away = null;
      this.term.resume();
      this.redraw();
    };
    let r: void | Promise<unknown>;
    try { r = run(); } catch (e) { back(); throw e; }
    if (r instanceof Promise) return r.then(() => {}).finally(back);
    back();
  }

  event(e: OutlineEvent) {
    // A Resource registered or refreshed (PIE-445): only readers showing a projection of it redraw, and
    // those read it again. It isn't an outline change, so nothing else is asked again.
    if (e.domain === "resource-catalog") { if (resourceChanged(e.resourceId ?? null)) this.redraw(); return; }
    if (!forScreens(e)) return;
    if (e.change?.kind !== "draft") {
      invalidateLive();
      // A change record names its block: only the links, pages and embeds that show it are asked again.
      // A move or trash takes a subtree along, and an event without a record could be anything.
      const c = e.change;
      if (c) outlineChanged(c.blockId && SCOPED.has(c.kind) ? [c.blockId] : null);
      else if (e.action === "reconnected") outlineChanged([], true);   // the missed changes were replayed first
      else outlineChanged(null, e.action === "reset");
      // Resource events aren't in the change feed, so none were replayed: projections are read again.
      if (!c && (e.action === "reconnected" || e.action === "reset")) resourceChanged(null);
      invalidatePropertyErrors();
    }
    // What an extension wrote (a Jira ticket refreshed, PIE-445) isn't news unless the person asks for it.
    if (isExtensionChange(e)) { this.extEvents++; if (this.extensionChanges) this.events++; }
    else if (e.change || e.action !== "reconnected") this.events++;
    this.stack.at(-1)?.onEvent?.(e, this);
    this.redraw();
  }

  describe() {
    const s = this.stack.at(-1);
    const b = this.board;
    const service = { capabilities: b.capabilities ? [...b.capabilities] : null, offline: this.offline, sequence: b.lastSequence,
      uses: (["views.read", "blocks.read", "changes.since", "properties.preview", "query.expression", "resources.projection"] as const).map(c => `${c}:${b.supports(c) ?? "untried"}`) };
    // pid and nest: which process this door is and what it runs in (`ep0ch where` checks them against EP0CH_NEST).
    return { screen: s?.title, stack: this.stack.map(x => x.title), pid: process.pid, nest: doorNest(process.env) || null, suspended: this.away, video: this.video, host: this.host, workspace: this.workspace,
      ...(this.outline ? { outline: this.outline } : {}), service, dock: this.dock.describe(), state: s?.describe?.() ?? null };
  }

  async openBlock(id: string): Promise<string> {
    const m = await this.board.get(id);
    if (!m) throw new Error(`no block ${id}`);
    const s = this.stack.at(-1);
    // A screen with no readers of its own (the menu, a BBS list) opens it in a message reader over itself.
    if (s?.openBlock) s.openBlock(m); else shellOpenBlock(m, this, s);
    this.flash(`an agent opened: ${m.text.split("\n")[0]!.slice(0, 60)}`);
    this.redraw();
    return m.id;
  }

  /** The screen's actions, then the shell's (`screen.*`) and the dock's (`agent.*`), which work on every screen. */
  actions() {
    const s = this.stack.at(-1);
    const own = s?.actions?.() ?? { actions: [], readers: [] };
    return { screen: s?.title ?? null, ...own, actions: [...own.actions, ...SHELL_ACTIONS.list(), ...DOCK_ACTIONS.list()] };
  }

  /**
   * An agent acts (`ep0ch-door act`). Never silent: the status bar names the agent and the action before
   * it runs, and anything the action says while it lands is prefixed "an agent (<id>) · ".
   */
  async act(req: ActRequest): Promise<unknown> {
    const actor = agentActor(req.as);
    const s = this.stack.at(-1);
    const shell = SHELL_ACTIONS.has(req.action);
    const dock = DOCK_ACTIONS.has(req.action);
    // The dock's agent tells its door it lives in Herdr (`tile.herdr`, as its launcher attaches) on whatever screen is shown.
    const herdr = req.action === "tile.herdr" && req.reader === DOCK_TILE_ID;
    if (!shell && !dock && !herdr && !s?.act) throw new ActionRefused(`no action ${req.action} on the ${s?.title ?? "current"} screen; here: ${[...SHELL_ACTIONS.list(), ...DOCK_ACTIONS.list()].map(a => a.name).join(", ")}`);
    const who = agentLabel(actor);
    this.flash(`${who} · ${req.action}${req.reader ? ` in ${req.reader}` : ""}`);
    try {
      // The shell's actions (screen.open, screen.back, screen.list) come first, on every screen.
      const r = shell ? await SHELL_ACTIONS.runUntyped(req.action, req.args ?? {}, { ctx: asActor(this, actor), here: s }, actor)
        : dock ? await DOCK_ACTIONS.runUntyped(req.action, req.args ?? {}, { dock: this.dock, ctx: asActor(this, actor), here: s }, actor)
        : herdr ? this.dockHerdr(req.args ?? {})
        : await s!.act!(req, actor);
      this.redraw();
      return r;
    } catch (e) {
      this.flash(`${who} · ${req.action} refused: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }

  /** `tile.herdr` for the dock's agent: the same rule as a desk tile's (`herdrTile`). */
  private dockHerdr(args: Record<string, unknown>) {
    const p = this.dock.tile;
    if (!p) throw new ActionRefused(`${DOCK_TILE_ID} hasn't started`);
    if (args.on === false || args.on === "false") { p.herdr = null; return { tile: DOCK_TILE_ID, herdr: null }; }
    if (typeof args.pane !== "string" || !args.pane) throw new ActionRefused("tile.herdr needs pane=<the Herdr pane's label>");
    if (!p.running) throw new ActionRefused(`${DOCK_TILE_ID}'s program isn't running`);
    p.herdr = { pane: args.pane };
    return { tile: DOCK_TILE_ID, herdr: p.herdr };
  }

  /**
   * SIGTERM or SIGHUP: there is no one to ask. Every screen's unsaved edits and comments are copied to
   * disk first, then the door quits.
   */
  terminate(): string[] {
    const kept: string[] = [];
    for (const s of [...this.stack, ...this.background]) { try { kept.push(...(s.keepDrafts?.() ?? [])); } catch { /* keep going: the rest still get copied */ } }
    this.keptOnExit = kept;
    this.quit();
    return this.keptOnExit;
  }
  /** Where `terminate` (and any quit, for ctrl+e editors) copied unsaved text, for the exit message. */
  keptOnExit: string[] = [];

  quit() {
    // Whatever way the door ends, a ctrl+e editor's text is copied out and said (its tile ends with the door).
    for (const s of [...this.stack, ...this.background]) { try { this.keptOnExit.push(...(s.keepEdits?.() ?? [])); } catch { /* the rest still get copied */ } }
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.paintTimer) clearTimeout(this.paintTimer);
    if (this.publishTimer) clearTimeout(this.publishTimer);
    if (sharedAgent() === this.dock) shareAgent(null);
    this.kitty.dispose();
    this.done();
  }

  private key(typed: Key) {
    this.lastInput = Date.now();
    if (!(typed.kind === "mouse" && (typed.action === "wheel-up" || typed.action === "wheel-down"))) this.changed = true;
    // An Option character standing for an alt key is that key everywhere after this, the drawer's alt+a too.
    const k = this.optionAsAlt(typed);
    try { this.dispatch(k); }
    finally {
      // Said once, after the key did its work, so the hint isn't covered by what the key said.
      if (k !== typed && !this.saidOptionKeys) {
        this.saidOptionKeys = true;
        this.flash(`${(typed as { ch: string }).ch} read as alt+${(k as { ch: string }).ch}: this terminal types Option as characters; ${OPTION_AS_ALT_HINT}`, 10_000);
      }
    }
  }

  private dispatch(k: Key) {
    // A click on the status bar's `+N ext` shows (or hides) what extensions wrote, as `changes.extensions` does.
    const ext = this.extAt;
    if (ext && k.kind === "mouse" && k.y === ext.row && k.x >= ext.from && k.x < ext.to) {
      if (k.action === "down") void SHELL_ACTIONS.run("changes.extensions", {}, { ctx: this, here: this.stack.at(-1) }, USER);
      return;
    }
    // The agent drawer first (PIE-498): its keys while the person is in it, alt+a anywhere, its chip and its rows.
    if (this.dock.key(k, this.stack.at(-1), this.term.info.rows, this.dockRun)) return;
    // A paste goes whole to a screen that takes it (a terminal tile); anywhere else it's typed, key by key.
    if (k.kind === "paste" && !this.stack.at(-1)?.acceptsPaste?.()) {
      for (const key of pasteKeys(k.text)) this.key(key);
      return;
    }
    if (k.kind === "char" && k.ctrl && k.ch === "c" && !this.stack.at(-1)?.rawKeys?.()) { if (this.leaving([...this.stack, ...this.background], true)) this.quit(); return; }
    this.stack.at(-1)?.key(k, this);
  }

  /**
   * A Mac terminal that types Option as characters sends ¬ for alt+l. Where nobody is typing text (no edit,
   * filter, panel, terminal tile or the agent drawer holds the keys), such a character is the alt key it
   * stands for, and the first one says once which terminal setting sends alt itself. In text it stays what
   * was typed (façade, µm). Only on a US-like keyboard (optionKeysOn: by the locale, or EP0CH_OPTION_KEYS).
   */
  private optionAsAlt(k: Key): Key {
    if (!this.optionKeys || k.kind !== "char" || k.ctrl || k.pasted) return k;
    const alt = OPTION_KEYS[k.ch];
    const top = this.stack.at(-1);
    if (!alt || this.dockHoldsKeys() || top?.holdsKeys?.() || top?.rawKeys?.()) return k;
    return { kind: "alt", ch: alt };
  }
  private saidOptionKeys = false;
  /** Option characters are read as alt keys here (a test sets it). */
  optionKeys = optionKeysOn();

  private tick() {
    const s = this.stack.at(-1);
    const expired = this.message && Date.now() > this.messageUntil;
    if (expired) this.message = "";
    if (s?.tick?.(this) || expired) this.redraw();
    // An idle door still keeps time: once the clock or the uptime turns over, the status bar alone is
    // repainted (no screen render, no Kitty sync), so nothing being edited, selected or dragged moves.
    else if (s && this.timeShown() !== this.shownTime) this.paintStatus(s);
  }

  /** The status bar's time, as it would read now: the uptime and the clock; and the dock's chip, which changes on its own. */
  private timeShown(): string {
    const now = this.now();
    return `${Math.floor((now - this.started) / 60000)}|${new Date(now).toTimeString().slice(0, 5)}|${this.dock.active ? this.dock.chipText() : ""}`;
  }

  /** The dock's chip may have changed (its agent started or stopped working): the status bar alone, when it did. */
  private statusChanged() {
    const s = this.stack.at(-1);
    if (s && !this.paintTimer && this.timeShown() !== this.shownTime) this.paintStatus(s);
  }

  /** Just the status row, where the terminal can repaint a row alone; else the whole frame. */
  private paintStatus(s: Screen) {
    const { cols, rows } = this.term.info;
    if (this.term.paintRow) this.term.paintRow(rows - 1, this.statusBar(s, cols));
    else this.redraw();
  }

  /**
   * A repaint: at most one a frame. The first comes at once; calls within the frame after it are one more
   * paint at its end, so a busy terminal tile (or several) never renders the screen more than 60 times a
   * second. The frame is 16ms from the end of the last paint, not its start: a screen that takes longer
   * than that to render (a long note) still leaves the door time to read what came in meanwhile.
   *
   * While a chunk of input is being read (`batched`), a redraw is only noted, and the chunk ends with one
   * paint, at once: a trackpad sends wheel reports by the hundred, and a paint for each (then one for each
   * report that arrived during that paint) kept the screen scrolling for seconds after the fingers stopped.
   * What comes in during a paint is read as one chunk after it, so input paints as fast as the screen
   * renders and no faster.
   */
  redraw() {
    if (this.closed) return;               // the door has ended (a key in this chunk quit): nothing more is painted
    if (this.batching) { this.wanted = true; return; }
    this.changed = true;
    if (this.paintTimer) return;
    const since = Date.now() - this.lastPaint;
    if (since >= 16) return this.paint();
    this.paintTimer = setTimeout(() => { this.paintTimer = null; this.paint(); }, 16 - since);
  }
  private lastPaint = 0;
  private paintTimer: Timer | null = null;
  private batching = 0;
  private closed = false;
  private wanted = false;
  /** Something other than the wheel happened since the last paint (a key, a click, a redraw asked from outside input). */
  private changed = true;

  /** Read a chunk of input (Term's onBatch): every key in it is handled, then the screen is painted once. */
  private batched(run: () => void) {
    this.batching++;
    try { run(); }
    finally {
      if (--this.batching === 0 && this.wanted && !this.closed) {
        this.wanted = false;
        if (this.paintTimer) { clearTimeout(this.paintTimer); this.paintTimer = null; }
        this.paint();
      }
    }
  }

  private paint() {
    if (this.away) return;                 // another program has the terminal; resume repaints
    // A frame after nothing but wheel reports: views may move what they laid out last time (onlyScrolled).
    paintingScroll(!this.changed);
    this.changed = false;
    try { this.drawFrame(); } finally { paintingScroll(false); this.lastPaint = Date.now(); }
  }

  private drawFrame() {
    const s = this.stack.at(-1);
    if (!s) return;
    const { cols, rows } = this.term.info;
    // The agent drawer (PIE-498) is laid over the screen's bottom rows after it renders at its full size.
    this.dock.active = !s.noDock;
    const frame = s.render(this);
    let lines = frame.lines.slice(0, rows - 1);
    while (lines.length < rows - 1) lines.push("");
    let placements = this.graphics ? [...(frame.placements ?? [])] : [];
    if (this.dock.shown) {
      const d = this.dock.render(cols, rows, s.title);
      lines = overlay(lines, d);
      // Images under the drawer would show through it.
      placements = placements.filter(p => p.row + p.rows <= d.rect.row);
    } else this.dock.rect = null;
    lines.push(this.statusBar(s, cols));
    if (this.video === "kitty+crt") placements.unshift(crtUnderlay(this.term.info));
    // The text and the images are one frame: a terminal never shows new rows over old placements (PIE-462).
    const draw = () => { this.term.paint(lines); this.kitty.sync(placements); };
    if (this.term.frame) this.term.frame(draw);
    else draw();
    this.schedulePublish();
  }

  /** Where the door is: `host · outline` on an outline host, else `host:workspace root`. */
  get location(): string { return this.outline ? `${this.host} · ${this.outline}` : `${this.host}:${this.workspace}`; }

  private statusBar(s: Screen, cols: number): string {
    this.shownTime = this.timeShown();
    const [mins, clock] = this.shownTime.split("|");
    const left = ` ${fg(C.white)}ep0ch${fg(C.lcyan)} │ ${s.title} │ ${this.location}`;
    // The dock's chip starts the right part, so it's always whole and always in the same place from the right.
    const chip = this.dock.active ? this.dock.chip() : "";
    // Extension writes hidden from the count read `+N ext` (a click shows them); shown, `ext on`.
    const ext = this.extEvents ? (this.extensionChanges ? "ext on" : `+${this.extEvents} ext`) : "";
    const extPart = ext ? `${fg(C.dark)}${ext} ${fg(C.lcyan)}│ ` : "";
    const tail = `${this.video} │ on ${mins}m │ ${clock} `;
    const right = `${chip ? `${chip} │ ` : ""}${this.offline ? `${fg(C.lred)}offline ${fg(C.lcyan)}│ ` : ""}${this.events ? `${fg(C.yellow)}+${this.events} new ${fg(C.lcyan)}│ ` : ""}${extPart}${tail}`;
    const from = cols - width(right);
    const extFrom = cols - width(extPart + tail);
    this.extAt = ext && extFrom >= 0 ? { from: extFrom, to: extFrom + width(ext), row: this.term.info.rows - 1 } : null;
    this.dock.chipAt = chip && from >= 0 ? { from, to: from + width(this.dock.chipText()), row: this.term.info.rows - 1 } : null;
    const middle = this.message ? ` ${fg(C.yellow)}${this.message}${fg(C.lcyan)}` : "";
    return statusLine(left, middle, right, cols);
  }
}

/**
 * The status bar's three parts in `cols` cells: the right part (video, uptime, clock) always shows whole,
 * with a `│` between it and the rest, even when the rest fills its room exactly or is cut short. A
 * message outranks the location: in a narrow pane it replaces it rather than being cut off.
 */
export function statusLine(left: string, middle: string, right: string, cols: number): string {
  const sep = " │ ";
  const room = Math.max(0, cols - width(right) - sep.length);
  const body = pad(middle && width(left + middle) > room ? middle : left + middle, room);
  // pad() ends a cut with RESET, so the bar's colours are set again before the separator.
  return bg(C.blue) + fg(C.lcyan) + body + bg(C.blue) + fg(C.lcyan) + sep + right + RESET;
}

/**
 * Which service events the screens see: content changes, and change records in other domains (a
 * lane's reorder arrives with `domain: "view"`). Other view events (clients registering) aren't news.
 */
/** A change an extension wrote (`actorId` `ext:…`, a refreshed Jira ticket): not the person's news by default. */
export function isExtensionChange(e: OutlineEvent): boolean {
  return !!e.change?.actor?.actorId?.startsWith("ext:");
}

export function forScreens(e: OutlineEvent): boolean {
  return e.domain === "content" || !!e.change;
}
