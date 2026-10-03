// The door: a stack of screens, one status bar, one paint per change.
import type { Placement } from "./kitty";
import { isDisplay, Painter, type Display, type RawTerm, type Video } from "./display";
import { AGENT_ACTOR_ID, type Actor, type SocketBoard, type OutlineEvent } from "./socket";
import { ActionRefused, agentLabel, traceActions, type ActRequest } from "./surface/actions";
import { Dispatcher } from "./surface/dispatch";
import { screenKeys, whereabouts, type ScreenKeys, type Whereabouts } from "./whereabouts";
import { SHELL_ACTIONS } from "./screens";
import { isCopyKey, osc52 } from "./surface/selection";
import { bg, C, chip, fg, headOf, pad, RESET, tailFrom, width } from "./style";
import { printable } from "./text";
import { OPTION_AS_ALT_HINT, OPTION_KEYS, optionKeysOn, pasteKeys, type Handover, type Key, type Term, type TermInfo } from "./term";
import { paintingScroll } from "./scroll";
import { invalidateLive, setLiveSource } from "./live";
import { resourceChanged } from "./projection";
import { EXT_ACTIONS, loadExtensions } from "./extensions";
import { invalidatePropertyErrors } from "./props";
import { outlineChanged } from "./refs";
import { doorNest } from "./nest";
import { groundSeq, setTheme as useTheme, theme, type ThemeName } from "./theme";
import { writeState } from "./state";
import { AgentDock, DOCK_ACTIONS, DOCK_TILE_ID, HOST_AGENT_TILE, HOST_TILE_ACTIONS, overlay, type DockRun } from "./dock";
import type { HostMode } from "./desk/screen-layout";

/** Changes whose record names the one block they touched (a move or trash carries a subtree). */
const SCOPED = new Set(["edit", "create", "annotate", "reorder"]);

export interface Frame { lines: string[]; placements?: Placement[] }

/**
 * The terminal App reads keys from and draws on: the door's own (Term, drawn through a Painter), a test's fake, or a
 * session's (src/session/session-term.ts: every attached client, a Display itself, handing over the terminal of the
 * client with the person's keys).
 */
export type AppTerm = Pick<Term, "info" | "write" | "onKey" | "onResize" | "invalidate" | "stop" | "resume">
  & Partial<Pick<Term, "onBatch" | "setGround" | "paint" | "paintRow" | "frame" | "rawSink">>
  & {
    /** Let go of the terminal the person is typing on (a session's), or the one `from` names: true when one was attached. */
    detachActive?(from?: unknown): boolean;
    /** The terminal the person is typing on now (a session's client), as `detachActive` takes it. */
    typingOn?(): unknown;
    /** The session's terminals, for `peek` (a session's). */
    session?(): unknown;
  };

export type { Video };

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
  /** Put text on the terminal's clipboard (OSC 52; Herdr and Ghostty pass it on), and say "copied to clipboard" over the screen. */
  copy?(text: string): void;
  cycleVideo(): void;
  /** Draw in this theme from now on (`theme.set`): every screen at once, the terminal's ground too, and kept for next time. */
  setTheme?(name: ThemeName): void;
  /**
   * The door is about to quit (the menu's logoff): true when it may. With programs running in a screen (even
   * one in the background) or an unsaved edit, the first ask says so and refuses; again within 3s goes.
   */
  confirmQuit?(): boolean;
  /**
   * The person logs off (the menu's Goodbye, ctrl+c): in a session, their terminal detaches and everything goes on
   * running (`detaches`); in the door's own terminal, the door quits.
   */
  logoff?(from?: unknown): void;
  /** Logging off only detaches this terminal: the door is a session (src/session/), which goes on without it. */
  readonly detaches?: boolean;
  /**
   * End the door, and with it the session (`session.end`): null once it's ending; else why not, as said (programs
   * run or a draft is unsaved: again within 3s ends it). `force` ends it anyway, the drafts copied to disk first.
   */
  end?(force: boolean): string | null;
  /**
   * The session onto new code (`session.upgrade`): handed to a new daemon, or with `clients` only its terminals started
   * again; what happened. Absent: this door runs in its own terminal, not as a session.
   */
  upgradeSession?(clients: boolean): Promise<{ ok: boolean; message: string }>;
  /** Which terminal the person is typing on now (a session's client), for a logoff begun there: `logoff(from)` lets go of that one. */
  typingOn?(): unknown;
  /**
   * Hand the person's terminal to another program for the duration of `run`, then repaint: $EDITOR (ctrl+e), the drop
   * shell (`screen.shell`). `run` starts its program through the Handover it is given (src/drop.ts): in the door's own
   * terminal, or, in a session, the terminal of the client with the person's keys. The door waits with its event loop
   * running (tiles read, the control socket answering); nothing is painted to that terminal meanwhile. `what` is said by `peek`.
   */
  suspend(run: (terminal: Handover) => Promise<unknown>, what?: string): Promise<void>;
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
  /**
   * Where the person is (PIE-514): their keys and focus, the tile they type in, whether they're busy, how long idle.
   * The shell's one answer (src/whereabouts.ts); a frame around a screen answers it as seen from inside.
   */
  person?(): Whereabouts;
}

export interface Screen {
  title: string;
  /**
   * What the screen is, by name (a screen spec's, PIE-515: `desk`, `board`, `welcome`; the river's, the showcase's):
   * a menu item that keeps state opens only one screen of its name at a time.
   */
  readonly name?: string;
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
  /**
   * Where the person's keys are on this screen (PIE-514), by the names `tile=` uses: the tile with their focus, the
   * one they type in, whether anything here holds their keys. The shell's whereabouts query reads it.
   */
  keys?(): ScreenKeys;
  /** What this screen shows, for agents (`ep0ch-door peek`). */
  describe?(): unknown;
  /** Put a block in front of the user (`ep0ch-door open <id>`). */
  openBlock?(m: import("./board").Msg): void;
  /**
   * The screen's dispatcher (PIE-514): the action sets it registered, run by its keys and clicks and by `act`
   * (`ep0ch-door actions` lists them). A screen without one has only the shell's.
   */
  readonly dispatch?: Dispatcher;
  /** Every key is the screen's, ctrl+c included, and a paste goes to it whole: the person is typing in a terminal tile (PIE-417). */
  rawKeys?(): boolean;
  /** Where raw input bytes go right now (a running terminal tile the person is in), or null to decode keys. */
  rawInput?(): ((bytes: string) => void) | null;
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
  /** The edits open here, by tile: what a session's next daemon opens again after a handoff (src/session/restore.ts). */
  reopen?(): { action: string; tile: string; args?: Record<string, unknown> }[];
  /** No agent drawer and no chip here (the logon, the logoff: the person isn't in yet, or is leaving). */
  noDock?: boolean;
  /**
   * Where the host layer (the agent drawer) may appear over this screen, as its spec says (PIE-513, its policy's
   * `host`): `over` it (the default), `beside` it (the screen drawn shorter), or `none` (it keeps the whole screen).
   */
  hostMode?(): HostMode;
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
  // `ext:<id>` is an extension's, and only the service's extension runtime writes as one (it refuses a
  // client that names it). An agent runs an extension's action as itself: `act ext.<id>.<action>`.
  if (/^ext:/i.test(id)) throw new ActionRefused(`${id} is an extension's actor id: only the outline service writes as an extension; name yourself (--as <your id>) and run its action (act ext.${id.slice(4)}.<action>)`);
  return { kind: "agent", id };
}

export class App implements Ctx {
  private stack: Screen[] = [];
  /** Where frames go: this terminal (a Painter over it), or every client of a session (src/session/). */
  private readonly display: Display;
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
  /** The video mode (the display's: in a session, the client with the person's keys). */
  get video(): Video { return this.display.video; }
  set video(v: Video) { this.display.video = v; }
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
  constructor(private readonly term: AppTerm, readonly board: SocketBoard, public lastCall: number, private readonly done: () => void, private readonly now: () => number = Date.now) {
    this.started = now();
    this.display = isDisplay(term) ? term : new Painter(term as RawTerm);
    this.ground();
    // The host layer (PIE-513): above every screen, kept across switches; the agent is its drawer's first tab.
    this.dock = new AgentDock({ redraw: () => this.redraw(), statusChanged: () => this.statusChanged(), flash: (m, ms) => this.flash(m, ms), screen: () => this.stack.at(-1), person: () => this.person() });
    // The drawer's keys and clicks run the host layer's actions as the person, through the App's dispatcher.
    this.dockRun = (name, args) => { void this.dispatch.pressIn(DOCK_ACTIONS, name, args); };
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

  /**
   * The screen layer's terminal: the whole of it, or (the host layer pulled up beside a screen that asks for that) the
   * rows above the drawer. Screens read their size only here, so their drawing, their hit rows and their keys agree.
   */
  get t() {
    const i = this.term.info, beside = this.dock.besideRows(i.rows, i.cols);
    return beside ? { ...i, rows: Math.max(2, i.rows - beside) } : i;
  }
  screens(): readonly Screen[] { return this.stack; }
  idleFor(): number { return Date.now() - this.lastInput; }
  get graphics() { return this.video !== "cells"; }

  /** Screens left with programs still running in them (the desk's terminals): alive until reopened or the door quits. */
  background: Screen[] = [];
  push(s: Screen) { this.background = this.background.filter(x => x !== s); this.stack.push(s); s.enter?.(this); this.redraw(); this.onStack?.(); }
  /** The screens changed (one opened, left or kept in the background): a session checkpoints them (src/session/restore.ts). */
  onStack: (() => void) | null = null;
  pop() {
    const last = this.stack.length === 1;
    if (!this.leaving(last ? [...this.stack, ...this.background] : [this.stack.at(-1)], last)) return;
    this.leave();
    if (!this.stack.length) return this.quit();
    this.redraw();
    this.onStack?.();
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
    const warn = quitting ? screens.map(s => s?.leaveWarning?.()).find(Boolean) ?? this.dock.leaveWarning() ?? this.quitWarning?.() ?? null : null;
    if (!dirty.length && !warn) return true;
    if (Date.now() - this.quitArmed < 3000) { this.quitArmed = 0; dirty.forEach(s => s.keepDrafts?.()); return true; }
    this.quitArmed = Date.now();
    this.flash(dirty.length ? "an edit isn't saved · ctrl+s saves it · again within 3s leaves (the draft is copied to disk)" : warn!);
    return false;
  }
  editInTile(path: string, cmd: string, done: (code: number | null) => void): boolean { return this.stack.at(-1)?.editInTile?.(path, cmd, done) ?? false; }
  confirmQuit(): boolean { return this.leaving([...this.stack, ...this.background], true); }
  get detaches(): boolean { return !!this.term.detachActive; }
  typingOn(): unknown { return this.term.typingOn?.() ?? null; }
  logoff(from?: unknown): void {
    if (!this.term.detachActive) return this.quit();
    // The session stays where the person was, not on the Goodbye.
    if (this.stack.at(-1)?.title === "logoff") this.stack.pop();
    this.term.detachActive(from);
    this.redraw();
  }
  /** A session's own: hand it over, restart its terminals (src/session/daemon.ts). */
  session: { upgrade(): Promise<{ ok: boolean; message: string }>; reload(): string } | null = null;
  /** Something more that ends with the door, to ask about first (a session's programs kept for screens not open yet). */
  quitWarning: (() => string | null) | null = null;
  async upgradeSession(clients: boolean): Promise<{ ok: boolean; message: string }> {
    if (!this.session) return { ok: false, message: "this door runs in its own terminal, not as a session" };
    return clients ? { ok: true, message: this.session.reload() } : this.session.upgrade();
  }
  /** Paint now (a restore: the screen it opened is drawn at once, so its tiles adopt their programs). */
  flush(): void { if (this.paintTimer) { clearTimeout(this.paintTimer); this.paintTimer = null; } if (!this.closed) this.paint(); }
  end(force: boolean): string | null {
    if (force) { this.terminate(); return null; }
    if (!this.leaving([...this.stack, ...this.background], true)) return this.message;
    this.quit();
    return null;
  }
  /** A message in the status bar: one line, nothing a terminal acts on (an error can quote a title or an extension's words). */
  flash(msg: string, ms = 4000) { this.message = printable(msg, " "); this.messageUntil = Date.now() + ms; this.flashes++; this.redraw(); }
  /** Flashes said so far: a key that said nothing and ran nothing is found by it (cmd+c with nothing to copy). */
  private flashes = 0;

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
  /**
   * The person's clipboard (OSC 52), and a "copied to clipboard" toast over the bottom of the screen for a
   * moment, as Herdr's `ui.toast.clipboard` shows: the status bar's "copied N chars" is easy to miss. Every
   * copy in the door comes here (a reader's selection, a property's value, a step's link). Never an agent's.
   */
  copy(text: string) {
    this.term.write(osc52(text));
    this.toast = { text: `copied to clipboard · ${[...text].length} chars`, until: Date.now() + TOAST_MS };
    this.redraw();
  }
  /** What the toast says and until when (App.copy); the tick takes it away. */
  toast: { text: string; until: number } | null = null;
  /** The terminal's default text and background are the theme's (OSC 10, 11), so uncoloured cells sit on its ground. */
  private grounded = false;
  private ground() {
    // Classic sets no ground; its reset only undoes one this door set (a person's own OSC 10/11 colours stay).
    if (!theme().ground && !this.grounded) return;
    this.grounded = !!theme().ground;
    const t = this.term as Partial<Term>;
    if (t.setGround) t.setGround(groundSeq());
    else this.term.write(groundSeq());
  }
  setTheme(name: ThemeName) {
    if (useTheme(name)) {
      this.ground();
      this.term.invalidate();
      writeState("theme.json", { name });
    }
    this.flash(`theme: ${theme().name} · ${theme().about}`);
    this.redraw();
  }
  cycleVideo() {
    const no = this.display.cycleVideo();
    this.flash(no ?? `video: ${this.video}`);
  }

  /** What has the terminal while the door is suspended, or null (see Ctx.suspend). */
  private away: string | null = null;
  suspended(): string | null { return this.away; }
  async suspend(run: (terminal: Handover) => Promise<unknown>, what = "editor"): Promise<void> {
    if (this.away) throw new Error(`the terminal is already handed over (${this.away})`);
    // The display hands over the person's terminal (in a session, the client's with their keys: the others go on
    // showing the session) and paints nothing to it until the program gives it back.
    this.away = what;
    try { await run({ run: (argv, o) => this.display.handOver(argv, o ?? {}) }); }
    finally { this.away = null; this.redraw(); }
  }

  event(e: OutlineEvent) {
    // The service's extensions changed (a folder added, removed or edited, PIE-507): read the list again and
    // bind it, so what came shows up and what went goes away without a restart (PIE-512).
    if (e.domain === "extensions") { void this.loadExtensions(); return; }
    // A Resource registered or refreshed (PIE-445): only readers showing a projection of it redraw, and
    // those read it again. It isn't an outline change, so nothing else is asked again. An extension's line that
    // ran (`extensions.output`) or an agent that answered (`extensions.agent`) names its note.
    if (e.domain === "resource-catalog") { if (resourceChanged(e.resourceId ?? null, e.resourceId ? undefined : e.blockId)) this.redraw(); return; }
    if (!forScreens(e)) return;
    if (e.change?.kind !== "draft") {
      invalidateLive();
      // A change record names its block: only the links, pages and embeds that show it are asked again.
      // A move or trash takes a subtree along, and an event without a record could be anything.
      const c = e.change;
      if (c) outlineChanged(c.blockId && SCOPED.has(c.kind) ? [c.blockId] : null);
      else if (e.action === "reconnected") outlineChanged([], true);   // the missed changes were replayed first
      else outlineChanged(null, e.action === "reset");
      // Resource events aren't in the change feed, so none were replayed: projections are read again, and the
      // extensions (a restarted service may serve others) are listed again.
      if (!c && (e.action === "reconnected" || e.action === "reset")) { resourceChanged(null); void this.loadExtensions(); }
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
    const service = { protocol: b.protocol, offline: this.offline, sequence: b.lastSequence };
    // pid and nest: which process this door is and what it runs in (`ep0ch where` checks them against EP0CH_NEST).
    return { screen: s?.title, stack: this.stack.map(x => x.title), pid: process.pid, ...(this.term.session ? { session: this.term.session() } : {}), nest: doorNest(process.env) || null, suspended: this.away, video: this.video, host: this.host, workspace: this.workspace,
      ...(this.outline ? { outline: this.outline } : {}), service, dock: this.dock.describe(),
      // Where the person is (PIE-514): the same answer every agent rule reads, so an agent can see why it was refused.
      person: (({ idle, ...w }) => ({ ...w, idle: Number.isFinite(idle) ? Math.round(idle) : null }))(this.person()), state: s?.describe?.() ?? null };
  }

  /**
   * The screen's actions, then the shell's (`screen.*`, and `open` where the screen has none of its own), the
   * host layer's (`host.*`, `agent.*`) and the extensions' (`ext.*`, a handler line's or a block's), which work on
   * every screen: one list, in the order the App's dispatcher looks a name up.
   */
  actions() {
    const s = this.stack.at(-1);
    const d = this.dispatch.list();
    return { screen: s?.title ?? null, actions: d.actions, tiles: s?.dispatch?.list().tiles ?? [] };
  }

  /**
   * Read the service's extensions and bind them (src/extensions.ts): handler lines the readers ask about, the
   * `ext.*` actions, the tile kinds. What came or went is said; the readers read their lines again.
   */
  async loadExtensions(reload = false): Promise<void> {
    const r = await loadExtensions(this.board, reload);
    if (!r) return;
    // A read that failed keeps what was bound, and says so; a service without extensions says nothing here
    // (an extension's tile and lines say why where they'd be).
    if ("error" in r) { this.flash(`couldn't read the outline's extensions: ${r.error}`); return; }
    resourceChanged(null);
    const said = [r.added.length ? `${r.added.join(", ")} added` : "", r.removed.length ? `${r.removed.join(", ")} removed` : ""].filter(Boolean);
    if (said.length && this.extensionsSeen) this.flash(`extensions: ${said.join(" · ")}`);
    if (r.problems.length) this.flash(`extensions: ${r.problems.join(" · ")}`, 12_000);
    this.extensionsSeen = true;
    this.redraw();
  }
  private extensionsSeen = false;

  /**
   * The App's dispatcher (PIE-514): the host layer's actions, the shell's and the extensions', on every screen, then
   * the top screen's own (its dispatcher). A screen's action of a shell action's name is the screen's (the desk's,
   * the board's, the river's `open`). An extension's action a tile kind also lists (tarot's keep) is the tile's when
   * the request names the tile (tile=) or no block; with block= it runs on that block, tile or none.
   */
  readonly dispatch: Dispatcher = new Dispatcher({ title: "door", ctx: () => this }, [
    { set: HOST_TILE_ACTIONS, takes: "screen", claims: req => req.action === "tile.herdr" && req.tile === DOCK_TILE_ID, on: () => ({ dock: this.dock }) },
    { set: DOCK_ACTIONS, takes: "none", fixed: () => HOST_AGENT_TILE, on: (_, how) => ({ dock: this.dock, ctx: how.ctx, here: this.stack.at(-1) }) },
    { set: SHELL_ACTIONS, takes: "none", claims: req => SHELL_ACTIONS.has(req.action) && !this.stack.at(-1)?.dispatch?.has(req.action), on: (_, how) => ({ ctx: how.ctx, here: this.stack.at(-1), again: (name: string, args: Record<string, unknown>) => this.dispatch.act({ action: name, args }, how.actor) }) },
    { set: EXT_ACTIONS, takes: "none", claims: req => EXT_ACTIONS.has(req.action) && !(!!this.stack.at(-1)?.dispatch?.has(req.action) && (req.tile !== undefined || req.args?.block === undefined)), on: (_, how) => ({ ctx: how.ctx }) },
    { delegate: () => this.stack.at(-1)?.dispatch },
  ]);

  /**
   * Where the person is (PIE-514): the top screen's own answer (its `keys`; else whether it holds their keys), the host
   * layer's drawer they may be typing in, the shell or editor the door is suspended under, and how long they've been idle.
   */
  person(): Whereabouts {
    const s = this.stack.at(-1);
    return whereabouts({ screen: s?.title ?? null, keys: s ? screenKeys(s) : null, inHost: this.dock.shown && this.dock.entered, suspended: this.away, loggedOn: !!s && !s.noDock, idle: this.idleFor() });
  }

  /**
   * An agent acts (`ep0ch-door act`), through the App's dispatcher. Never silent: the status bar names the agent and
   * the action before it runs, a refusal says why, and anything it says while it lands is "an agent (<id>) · …".
   */
  async act(req: ActRequest): Promise<unknown> {
    const actor = agentActor(req.as);
    const s = this.stack.at(-1);
    if (!this.dispatch.takes(req)) throw new ActionRefused(`no action ${req.action} on the ${s?.title ?? "current"} screen; here: ${this.dispatch.list().actions.map(a => a.name).join(", ")}`);
    const who = agentLabel(actor);
    this.flash(`${who} · ${req.action}${req.tile ? ` in ${req.tile}` : ""}`);
    try {
      const r = await this.dispatch.act(req, actor);
      this.redraw();
      return r;
    } catch (e) {
      this.flash(`${who} · ${req.action} refused: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
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
    this.display.dispose();
    this.done();
  }

  private key(typed: Key) {
    this.lastInput = Date.now();
    if (!(typed.kind === "mouse" && (typed.action === "wheel-up" || typed.action === "wheel-down"))) this.changed = true;
    // An Option character standing for an alt key is that key everywhere after this, the drawer's alt+a too.
    const k = this.optionAsAlt(typed);
    try { this.route(k); }
    finally {
      // Said once, after the key did its work, so the hint isn't covered by what the key said.
      if (k !== typed && !this.saidOptionKeys) {
        this.saidOptionKeys = true;
        this.flash(`${(typed as { ch: string }).ch} read as alt+${(k as { ch: string }).ch}: this terminal types Option as characters; ${OPTION_AS_ALT_HINT}`, 10_000);
      }
    }
  }

  /** Where a key goes: the status bar's chips, the host layer's drawer, then the top screen. */
  private route(k: Key) {
    // A click on the status bar's `+N ext` shows (or hides) what extensions wrote, as `changes.extensions` does.
    const ext = this.extAt;
    if (ext && k.kind === "mouse" && k.y === ext.row && k.x >= ext.from && k.x < ext.to) {
      if (k.action === "down") void this.dispatch.press("changes.extensions");
      return;
    }
    // A click on the status bar's video mode or theme turns it to the next (video.cycle, theme.cycle).
    for (const [at, action] of [[this.videoAt, "video.cycle"], [this.themeAt, "theme.cycle"]] as const) {
      if (at && k.kind === "mouse" && k.y === at.row && k.x >= at.from && k.x < at.to) {
        if (k.action === "down") void this.dispatch.press(action);
        return;
      }
    }
    // The agent drawer first (PIE-498): its keys while the person is in it, alt+a anywhere, its chip and its rows.
    if (this.dock.key(k, this.stack.at(-1), this.term.info.rows, this.dockRun)) return;
    // alt+v and alt+t turn the video mode and the theme on every screen (but in a terminal tile, whose keys are its program's).
    if (k.kind === "alt" && (k.ch === "v" || k.ch === "t") && !this.stack.at(-1)?.rawKeys?.()) { void this.dispatch.press(k.ch === "v" ? "video.cycle" : "theme.cycle"); return; }
    // A paste goes whole to a screen that takes it (a terminal tile); anywhere else it's typed, key by key.
    if (k.kind === "paste" && !this.stack.at(-1)?.rawKeys?.()) {
      for (const key of pasteKeys(k.text)) this.key(key);
      return;
    }
    // ctrl+c: in a session the person's terminal detaches (nothing ends, nothing is asked); else the door quits, asking first.
    if (k.kind === "char" && k.ctrl && k.ch === "c" && !this.stack.at(-1)?.rawKeys?.()) {
      if (this.detaches) this.logoff();
      else if (this.leaving([...this.stack, ...this.background], true)) this.quit();
      return;
    }
    // cmd+c (super+c) is the copy wherever a reader or a draft has a selection (its copy action runs); where
    // nothing took it (no reader has the keys, or nothing ran and nothing was said), it says so. In a terminal
    // tile it's the program's, as it came (rawKeys).
    const top = this.stack.at(-1);
    if (isCopyKey(k) && top && !top.rawKeys?.()) {
      let ran = false;
      const said = this.flashes, stop = traceActions(() => { ran = true; });
      try { top.key(k, this); } finally { stop(); }
      if (!ran && this.flashes === said) this.flash("nothing selected · drag across the text to copy it, or v and move then y");
      return;
    }
    top?.key(k, this);
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
    if (!alt || this.person().busy) return k;
    return { kind: "alt", ch: alt };
  }
  private saidOptionKeys = false;
  /** Option characters are read as alt keys here (a test sets it). */
  optionKeys = optionKeysOn();

  private tick() {
    const s = this.stack.at(-1);
    let expired = !!this.message && Date.now() > this.messageUntil;
    if (expired) this.message = "";
    if (this.toast && Date.now() > this.toast.until) { this.toast = null; expired = true; }
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
    if (!this.display.showRow(rows - 1, this.statusBar(s, cols))) this.redraw();
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
    // A frame after nothing but wheel reports: views may move what they laid out last time (onlyScrolled).
    paintingScroll(!this.changed);
    this.changed = false;
    try { this.drawFrame(); } finally { paintingScroll(false); this.lastPaint = Date.now(); }
  }

  private drawFrame() {
    const s = this.stack.at(-1);
    if (!s) return;
    const { cols, rows } = this.term.info;
    // The agent drawer (the host layer's, PIE-513) is laid over the screen's bottom rows: over one, the screen drew at
    // its full size under it; beside one, the screen drew in the rows above it (App.t).
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
    if (this.toast) lines = withToast(lines, this.toast.text, cols);
    lines.push(this.statusBar(s, cols));
    // The display draws it in its video mode (CP437 and the tube under kitty+crt; a terminal tile's program output too).
    this.display.show(lines, placements);
    this.schedulePublish();
  }

  /** Where the door is: `host · outline` on an outline host, else `host:workspace root`. */
  get location(): string { return this.outline ? `${this.host} · ${this.outline}` : `${this.host}:${this.workspace}`; }

  /** Where the status bar's video mode and theme are, for a click (video.cycle, theme.cycle). */
  private videoAt: { from: number; to: number; row: number } | null = null;
  private themeAt: { from: number; to: number; row: number } | null = null;
  private statusBar(s: Screen, cols: number): string {
    this.shownTime = this.timeShown();
    const [mins, clock] = this.shownTime.split("|");
    const left = ` ${fg(C.white)}ep0ch${fg(C.lcyan)} │ ${s.title} │ ${this.location}`;
    // The dock's chip starts the right part, so it's always whole and always in the same place from the right.
    const chip = this.dock.active ? this.dock.chip() : "";
    // Extension writes hidden from the count read `+N ext` (a click shows them); shown, `ext on`.
    const ext = this.extEvents ? (this.extensionChanges ? "ext on" : `+${this.extEvents} ext`) : "";
    const extPart = ext ? `${fg(C.dark)}${ext} ${fg(C.lcyan)}│ ` : "";
    const tail = `${this.video} │ ${theme().name} │ on ${mins}m │ ${clock} `;
    const right = `${chip ? `${chip} │ ` : ""}${this.offline ? `${fg(C.lred)}offline ${fg(C.lcyan)}│ ` : ""}${this.events ? `${fg(C.yellow)}+${this.events} new ${fg(C.lcyan)}│ ` : ""}${extPart}${tail}`;
    const from = cols - width(right);
    const extFrom = cols - width(extPart + tail);
    this.extAt = ext && extFrom >= 0 ? { from: extFrom, to: extFrom + width(ext), row: this.term.info.rows - 1 } : null;
    const tailFrom = cols - width(tail), row = this.term.info.rows - 1;
    this.videoAt = tailFrom >= 0 ? { from: tailFrom, to: tailFrom + width(this.video), row } : null;
    this.themeAt = tailFrom >= 0 ? { from: tailFrom + width(`${this.video} │ `), to: tailFrom + width(`${this.video} │ ${theme().name}`), row } : null;
    this.dock.chipAt = chip && from >= 0 ? { from, to: from + width(this.dock.chipText()), row: this.term.info.rows - 1 } : null;
    const middle = this.message ? ` ${fg(C.yellow)}${this.message}${fg(C.lcyan)}` : "";
    return statusLine(left, middle, right, cols);
  }
}

/** How long the "copied to clipboard" toast stays. */
export const TOAST_MS = 1500;

/**
 * The toast laid over the screen's lines (the status bar not among them): one row, bottom centre, two rows above
 * the status bar, over whatever is drawn there; the rest of that row stays as it was.
 */
export function withToast(lines: string[], text: string, cols: number): string[] {
  const t = ` ✓ ${text} `, w = Math.min(width(t), cols);
  const row = Math.max(0, lines.length - 2), at = Math.max(0, Math.floor((cols - w) / 2));
  const out = [...lines];
  const line = out[row] ?? "";
  out[row] = headOf(line, at) + RESET + chip(C.cyan) + pad(t, w) + RESET + tailFrom(line, at + w);
  return out;
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
