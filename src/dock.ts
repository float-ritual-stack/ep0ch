// The host layer (PIE-513; the dock's first slice was PIE-498): what stays with the person on every screen, above
// the screen layer that is swapped per screen. It is a layout on the one layout engine (`hostLayer` in
// src/desk/screen-layout.ts): a slot for whatever screen is shown, beside a real drawer of tabs whose first tab is
// the agent, one terminal tile (`PtyPane`, the terminal tile's own code) that belongs to the App, not to a screen.
// It runs what `dailyAgent()` says (the Herdr launcher on float-2, so the agent lives in a Herdr pane and outlives
// the door), and it starts the first time it's pulled up. A chip on the status bar (`▲ claude`) pulls the drawer
// up. Where it appears is the screen's to say (its policy's `host`): `over` its lower rows, the screen drawn at
// its full size under it (the default); `beside` it, the screen drawn shorter (the daily desk); or `none`.
//
// A tile has one home: the agent lives here, and no screen has a copy of it (the daily layout's agent tile is
// gone; a layout saved with one comes back without it, `withoutAgentTile`). One door never attaches to the
// Herdr pane twice. The person's keys move through the host layer's own transitions: pulled up by the person,
// they go to the agent; put away (or ctrl+]), back to the screen slot, where the screen's own focus is exactly
// as they left it. An agent's pull never takes them.
//
// Everything is an action (`DOCK_ACTIONS`: `host.toggle`, `host.size`, `host.enter`, `host.leave`, older names
// `agent.toggle`, `agent.height`, `agent.enter`, `agent.leave`; and the agent's own `agent.type`, `agent.knows`,
// `agent.restart`): the
// chip's click, alt+a, Esc, the drawer's dragged top edge, alt+A, the chip's ⟳ and alt+R call them, and so does an
// agent over `act`. An agent may pull it up
// only under the actor rule for what changes the person's screen (`touches: "screen"`, PIE-514: never while the
// person types, never within 2s of their last key), it's said on the status bar and in the drawer's title, and an
// agent never enters it: its keys stay where they were. Whether it's open and how tall is saved in the door's state (dock.json), so it's still
// there after a screen switch and after a restart; with Herdr it's the same session everywhere.
//
// The chip also says what the agent knows (src/desk/agent-env.ts): `door tools` when it started in a door (a mod
// changed since reloads into it live); `started before update ⟳` when an older door started it without some of
// the door's variables, or `no door tools ⟳`, read from the agent process's own environment (in Herdr: the
// pane's process). ⟳ restarts it, keeping
// the conversation; an agent's restart waits until the person isn't typing in it.
import type { Ctx, Screen } from "./app";
import { Canvas, type Rect } from "./canvas";
import { agentConfig, herdrBin, herdrRunner, WATCH_TITLE, type HerdrRun } from "./desk/herdr-agent";
import { DOCK_NAME, DOCK_TILE_ID, judgeAgent, knowsLabel, modDirs, modStamp, readAgent, RESTART_GLYPH, type AgentKnows } from "./desk/agent-env";
import { alive } from "./state";
import { controlPath } from "./control";
import type { DeskApi } from "./desk/panes";
import { ESCAPE_CHORD, isEscapeChord, PtyPane } from "./desk/pty";
import { rawKey } from "./kbd";
import { dailyAgent } from "./desk/tiles";
import { apply as applyLayout, shown as shownTiles, hostDrawer, hostLayer, HOST_SCREEN, placeHost, type Ctx as LayoutCtx, type HostMode, type LayoutState, type Op, type TileFacts } from "./desk/screen-layout";
import { readState, writeState } from "./state";
import { USER, type Actor } from "./socket";
import { ActionRefused, ActionSet, agentLabel } from "./surface/actions";
import { actorRule, type TileRef } from "./surface/dispatch";
import { HOST_AGENT, type Whereabouts } from "./whereabouts";
import { bg, C, fg, RESET } from "./style";
import type { Key } from "./term";

/** The dock agent's tile id and name: what `EP0CH_TILE_ID` and `EP0CH_TILE` tell its program (never a desk id, `t<n>`). */
export { DOCK_TILE_ID };
export { DOCK_NAME };
/** The drawer's height, as a share of the rows above the status bar: at least this, at most that. */
export const MIN_SHARE = 0.2, MAX_SHARE = 0.9;
/** alt+A steps through these. */
export const HEIGHT_STEPS = [0.4, 0.5, 0.6, 0.75] as const;
/** A second ctrl+] within this long is the chord's second press (the terminal tile's window too). */
const CHORD_MS = 1500;
/** How long after the program's last output the chip still says `working` (no Herdr status to ask). */
const WORKING_MS = 1500;
/** How often Herdr is asked for the agent's state while the drawer shows a Herdr pane. */
const HERDR_POLL_MS = 3000;
/** How often what the agent knows is read again (its environment, its start, the mod's newest file). */
const KNOWS_POLL_MS = 15_000;
/** An agent's `agent.restart` waits this long after the person last typed into the agent. */
const RESTART_IDLE_MS = 10_000;

/** What dock.json keeps. */
export interface DockSaved { open: boolean; share: number }
/**
 * What the chip says: not started, working, idle, waiting on the person (Herdr's `blocked`), exited, or
 * `watching`: the Herdr launcher found another door attached to the agent's pane and only watches it (a
 * second ssh session's door), where ⏎ would take the pane from that door.
 */
export type AgentState = "off" | "working" | "idle" | "blocked" | "exited" | "watching";

/** What the dock needs from the App. */
export interface DockHost {
  redraw(): void;
  /** Only the status bar changed (the chip): repaint it alone when the screen allows. */
  statusChanged(): void;
  flash(msg: string, ms?: number): void;
  /** The screen shown (the screen layer): where it lets the host layer appear. */
  screen?(): Screen | undefined;
  /** Where the person is (the shell's query, PIE-514): the host layer's operations are applied with it. */
  person?(): Whereabouts;
}

const clamp = (share: number) => Math.max(MIN_SHARE, Math.min(MAX_SHARE, share));
const isAlt = (k: Key, ch: string) => k.kind === "alt" && k.ch === ch;

export class AgentDock {
  /**
   * The host layer: a slot for the screen shown beside a drawer of tabs (the agent its first). One value on the layout
   * engine, changed only by its operations (`do`): pulled up, put away, sized, the keys in it or back on the screen.
   */
  private layer: LayoutState<string>;
  /** Where the person's keys are in the host layer: the screen slot, or the agent (the module's answer each time). */
  private keys: string = HOST_SCREEN;
  /** Who pulled it up, when that was an agent (said in the drawer's title until the person uses it). */
  openedBy: Actor | null = null;
  /** The screen shown lets the drawer be drawn (not the logon or the logoff). Set by the App before each paint. */
  active = false;
  /** Where the drawer was last drawn (full width, above the status bar), and the chip on the status bar. */
  rect: Rect | null = null;
  chipAt: { from: number; to: number; row: number } | null = null;
  private p: PtyPane | null = null;
  /**
   * ctrl+]: when the person last left the drawer with it (a second one within CHORD_MS goes back in and sends
   * the agent a ctrl+], as a terminal tile's does), and when one last went by to the screen (its own second).
   */
  private leftAt = 0;
  private passedAt = 0;
  /** The top edge is being dragged; the program has the mouse until the button comes up. */
  private dragging = false;
  private capture: Rect | null = null;
  private herdrState: { state: AgentState; at: number } | null = null;
  /** What the tile's own code asks of a desk: a repaint, and a flash (it has no setsid or perl to start with). */
  private readonly api = { redraw: () => this.changed(), ctx: { flash: (m: string, ms?: number) => this.host.flash(m, ms) } } as unknown as DeskApi;
  private polling = false;
  private lastPoll = 0;
  /** What the running agent knows (null: not read yet, or not running); the pid it was read from. */
  knows: AgentKnows | null = null;
  knowsPid: number | null = null;
  private knowing = false;
  private lastKnow = 0;
  /** A restart under way: the chip says so, and a second one waits for it. */
  restarting: Promise<RestartDone> | null = null;

  /** `persist`: read and write dock.json (a test's dock may not). `herdr`: how Herdr is asked (a fake in tests). */
  constructor(private readonly host: DockHost, private readonly persist = true, private readonly herdr: HerdrRun | null = defaultHerdr()) {
    const s = persist ? readState<Partial<DockSaved>>("dock.json") : null;
    const open = !!s && typeof s === "object" && s.open === true;
    const share = s && typeof s.share === "number" && Number.isFinite(s.share) ? clamp(s.share) : 0.5;
    this.layer = hostLayer({ tabs: [DOCK_TILE_ID], names: new Map([[DOCK_TILE_ID, DOCK_NAME]]), share, open });
  }

  // ── the host layer, on the layout engine ──

  /** The drawer is pulled up. */
  get open(): boolean { return !!hostDrawer(this.layer)?.open; }
  /** How much of the rows above the status bar the drawer has when it's up (its share of the host layer's split). */
  get share(): number {
    const t = this.layer.tree;
    if (t.t !== "split") return 0.5;
    const i = t.kids.findIndex(k => k.t === "drawer"), sum = t.weights.reduce((a, w) => a + w, 0) || 1;
    return Math.round(((t.weights[i] ?? 0.5) / sum) * 1000) / 1000;
  }
  /** The person is in the drawer: every key but ctrl+], alt+a and alt+A is the agent's. Never set by an agent. */
  get entered(): boolean { return this.keys !== HOST_SCREEN && this.open && this.mode !== "none"; }
  /** Where the screen shown lets the host layer appear: its policy's `host` (a screen without a dock: none). */
  get mode(): HostMode { const s = this.host.screen?.(); return s?.noDock ? "none" : s?.hostMode?.() ?? "over"; }
  /** What the host layer's tiles are: the screen slot (it never closes or moves), the agent's terminal. */
  private facts(id: string): TileFacts {
    if (id === HOST_SCREEN) return { kind: "screen", policy: { closable: false, draggable: false } };
    return { kind: "pty", ...(this.p?.running ? { running: this.p.run.cmd[0] ?? "the agent" } : {}) };
  }
  /** Who acts, and where the person is (the shell's one answer): in the agent, or busy on the screen. */
  private ctx(actor: Actor, rows = 30, cols = 100): LayoutCtx<string> {
    return {
      actor, area: { col: 0, row: 0, cols, rows: Math.max(1, rows - 1) }, tile: id => this.facts(id), screenHost: this.mode,
      person: { focus: this.keys, typingIn: this.entered ? DOCK_TILE_ID : null, busy: this.entered || !!this.host.person?.().busy, ...(this.host.person ? { held: actorRule({ touches: "screen" }, actor, this.host.person(), {}) } : {}) },
    };
  }
  /** One operation on the host layer, for `actor`: its new state and where the keys are now, or the refusal thrown. */
  private do(op: Op<string>, actor: Actor) {
    const r = applyLayout(this.layer, op, this.ctx(actor, this.rows, this.cols));
    if (!r.ok) throw new ActionRefused(r.refused);
    this.layer = r.state;
    this.keys = r.focus;
    return r;
  }
  /** The terminal's size as last drawn (the host layer's room). */
  private rows = 30;
  private cols = 100;

  // ── the one agent tile (the host layer's first tab) ──

  /**
   * The agent's tile, made the first time it's asked for; its program starts when it's first drawn. It runs what
   * `dailyAgent()` says when it's made; one not started yet is made again when that has changed since.
   */
  pane(): PtyPane {
    const a = dailyAgent();
    if (this.p && (this.started || same(this.p, a))) return this.p;
    const p = new PtyPane({ cmd: a.cmd, ...(a.cwd ? { cwd: a.cwd } : {}), label: DOCK_NAME, agent: true });
    p.tileId = DOCK_TILE_ID;
    p.place = "dock";
    // The drawer's agent is the dock's (dock.json): a session's next daemon adopts it by that.
    if (this.persist) p.home = "dock.json";
    // The program's output repaints whatever shows it: the drawer, a desk tile, or only the chip.
    p.init(this.api);
    this.p = p;
    return p;
  }
  /** The tile when it has been made (nothing is started by asking). */
  get tile(): PtyPane | null { return this.p; }
  /** Its program has been started (it runs, or it ran and exited). */
  private get started(): boolean { return !!this.p && (this.p.running || this.p.exited !== null); }
  /** The drawer is drawn now: pulled up, on a screen that lets the host layer appear. */
  get shown(): boolean { return this.open && this.active && this.mode !== "none"; }
  /** Drawn beside the screen (the screen shorter), not over it: the rows it takes from the screen, else 0. */
  besideRows(rows: number, cols: number): number {
    if (!this.shown || this.mode !== "beside") return 0;
    const d = placeHost(this.layer, { col: 0, row: 0, cols, rows: rows - 1 }, "beside").drawer;
    return d?.rows ?? 0;
  }

  private changed() { if (this.shown) this.host.redraw(); else this.host.statusChanged(); }

  // ── what it's doing ──

  state(now = Date.now()): AgentState {
    const p = this.p;
    if (!p || (!p.running && p.exited === null)) return "off";
    if (p.exited !== null) return "exited";
    if (p.programTitle === WATCH_TITLE) return "watching";
    if (p.herdr) {
      this.pollHerdr(now);
      const h = this.herdrState;
      if (h && now - h.at < HERDR_POLL_MS * 3) return h.state;
    }
    return now - p.lastOutput < WORKING_MS ? "working" : "idle";
  }

  /** Herdr knows the agent's state (idle, working, blocked): asked every few seconds, only while it's attached through Herdr. */
  private pollHerdr(now: number) {
    if (!this.herdr || this.polling || now - this.lastPoll < HERDR_POLL_MS) return;
    this.polling = true; this.lastPoll = now;
    // The name the launcher said it gave the agent (a test door's is door-<hash>); else the person's own.
    const name = this.tile?.herdr?.name ?? agentConfig().name;
    this.herdr(["agent", "get", name]).then(r => {
      let s: string | undefined;
      try { s = JSON.parse(r.out)?.result?.agent?.agent_status; } catch { s = undefined; }
      const state: AgentState | null = s === "working" ? "working" : s === "idle" || s === "done" ? "idle" : s === "blocked" ? "blocked" : null;
      const was = this.herdrState?.state;
      this.herdrState = state ? { state, at: Date.now() } : null;
      if (state !== was) this.host.statusChanged();
    }, () => { this.herdrState = null; }).finally(() => { this.polling = false; });
  }

  /**
   * The chip's words: `▲ claude`, `▲ claude · working`, `▼ claude · idle` (▼ while it's up), then what it knows:
   * `· door tools`, or `· started before update ⟳` (⟳: a click restarts it).
   */
  chipText(now = Date.now()): string { const c = this.chipParts(now); return c.head + c.knows; }

  /** The chip in two parts: what it's doing, and what it knows (drawn in yellow when it offers ⟳). */
  private chipParts(now: number): { head: string; knows: string } {
    const s = this.state(now);
    if (s !== "off" && s !== "exited") this.pollKnows(now);
    const what = this.restarting ? "restarting" : s === "off" ? "" : s === "blocked" ? "needs you" : s === "exited" ? `exited ${this.p?.exited ?? ""}`.trim() : s;
    const knows = this.restarting || s === "off" || s === "exited" ? "" : knowsLabel(this.knows);
    return { head: `${this.open ? "▼" : "▲"} ${DOCK_NAME}${what ? ` · ${what}` : ""}`, knows: knows ? ` · ${knows}` : "" };
  }

  /** The chip ends in ⟳: a click on it restarts the agent. */
  get offersRestart(): boolean { return !this.restarting && (this.knows?.state === "stale" || this.knows?.state === "no-door"); }

  /**
   * The agent's process: in Herdr, the process in the agent's pane (`pane process-info`); else the tile's own
   * program. Null when it isn't running or Herdr doesn't say.
   */
  async agentPid(): Promise<number | null> {
    const p = this.p;
    if (!p?.running) return null;
    if (!p.herdr) return p.pid ?? null;
    if (!this.herdr) return null;
    const pane = await this.herdrPaneId(p.herdr.pane);
    if (!pane) return null;
    const info = await this.herdr(["pane", "process-info", "--pane", pane]);
    try { const pid = Number(JSON.parse(info.out)?.result?.process_info?.shell_pid); return pid > 0 ? pid : null; } catch { return null; }
  }

  private async herdrPaneId(label: string): Promise<string | null> {
    if (!this.herdr) return null;
    const listed = await this.herdr(["pane", "list"]);
    try { const hit = (JSON.parse(listed.out)?.result?.panes ?? []).find((x: any) => x?.label === label); return hit?.pane_id ? String(hit.pane_id) : null; } catch { return null; }
  }

  /** Read again what the agent knows, every KNOWS_POLL_MS while it runs (and at once after a start). */
  private pollKnows(now: number) {
    if (this.knowing || now - this.lastKnow < KNOWS_POLL_MS) return;
    this.knowing = true; this.lastKnow = now;
    void this.readKnows().finally(() => { this.knowing = false; });
  }

  /** What the agent knows now: its own environment and start against the installed mod. Says a change on the chip. */
  async readKnows(): Promise<AgentKnows | null> {
    const pid = await this.agentPid().catch(() => null);
    let knows = pid ? judgeAgent(await readAgent(pid), modStamp(modDirs())) : null;
    // Without a control socket of its own, this door has none to give a restarted agent: ⟳ wouldn't help.
    if (knows?.state === "no-door" && !controlPath) knows = { state: "unknown", why: "this door has no control socket to give it" };
    const was = this.knows ? `${this.knows.state}|${this.knows.why}` : "";
    this.knows = knows; this.knowsPid = pid;
    if ((knows ? `${knows.state}|${knows.why}` : "") !== was) this.host.statusChanged();
    return knows;
  }

  /**
   * Restart the agent so it starts with the door's environment and the installed mod, keeping the conversation:
   * - in a terminal tile (or the drawer), its program is asked to exit (SIGTERM; SIGKILL after 8s), then the same
   *   command runs again (a bare `claude` with --continue; door-claude continues by itself);
   * - in Herdr, the process in the agent's pane alone is asked to exit, the pane closes with it, and the tile's
   *   launcher runs again: it makes a new pane with today's variables and starts the agent there, continuing.
   * Nothing but that one agent process (and this door's own launcher for it) is signalled.
   */
  restart(): Promise<RestartDone> {
    if (this.restarting) return this.restarting;
    const p = this.pane();
    const run = async (): Promise<RestartDone> => {
      const was = this.knows?.state ?? null;
      const herdr = p.herdr?.pane ?? null;
      if (herdr && p.running) {
        // Restarting only the attach would leave the old agent in its pane: without its pid, nothing is done.
        const pid = await this.agentPid();
        if (!pid) throw new ActionRefused(`couldn't find the agent's process in Herdr pane ${herdr}; restart it there (/exit, then ⏎ in the tile)`);
        try { process.kill(pid, "SIGTERM"); } catch { /* gone */ }
        const until = Date.now() + 8000;
        while (alive(pid) && Date.now() < until) await Bun.sleep(100);
        if (alive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
        // The pane goes with its process; the launcher's attach ends with it.
        const end = Date.now() + 3000;
        while (p.running && Date.now() < end) await Bun.sleep(50);
      }
      await p.stop();
      p.restart(true);
      this.knows = null; this.lastKnow = 0;
      return { restarted: true, ...(herdr ? { herdr } : {}), was };
    };
    this.restarting = run().finally(() => { this.restarting = null; this.changed(); });
    this.changed();
    return this.restarting;
  }
  /** The chip as drawn on the status bar (its colour says the state). */
  chip(now = Date.now()): string {
    const s = this.state(now);
    const c = s === "working" ? C.yellow : s === "blocked" ? C.lmagenta : s === "exited" ? C.lred : s === "watching" ? C.lcyan : C.white;
    const { head, knows } = this.chipParts(now);
    return `${bg(this.open ? C.cyan : C.blue)}${fg(c)}${head}${knows && this.offersRestart ? fg(C.yellow) : ""}${knows}${bg(C.blue)}${fg(C.lcyan)}`;
  }

  // ── actions ──

  /**
   * Pull it up or put it away, by the host layer's drawer operation: the person's pull gives the agent their keys
   * (the module's transition), an agent's never does; put away, the keys go back to the screen slot. On a screen
   * that keeps the whole screen (host none) it's refused, with why.
   */
  set(open: boolean, actor: Actor) {
    // An agent's pull of a drawer that's up already changes nothing; the person's goes into it.
    if (open && this.open && actor.kind === "agent") return;
    if (open) this.pane();
    this.do({ op: "drawer", tile: DOCK_TILE_ID, open }, actor);
    if (open && actor.kind !== "agent") this.do({ op: "focus", tile: DOCK_TILE_ID }, actor);
    if (open) this.openedBy = actor.kind === "agent" ? (this.entered ? null : actor) : null;
    else { this.openedBy = null; this.capture = null; this.dragging = false; }
    this.save();
    this.host.redraw();
  }

  /** Its height, by the host layer's own split (the drawer's share, the screen slot the rest), for `actor`. */
  height(share: number, actor: Actor = USER) {
    const s = clamp(share), t = this.layer.tree;
    if (t.t === "split" && t.id) this.do({ op: "shares", split: t.id, shares: t.kids.map(k => (k.t === "drawer" ? s : 1 - s)) }, actor);
    this.save();
    this.host.redraw();
  }

  private save() { if (this.persist) writeState("dock.json", { open: this.open, share: this.share } satisfies DockSaved); }

  describe() {
    const p = this.p;
    return {
      open: this.open, shown: this.shown, entered: this.entered, share: Math.round(this.share * 100) / 100, host: this.mode,
      rect: this.shown ? this.rect : null, state: this.state(), tile: { id: DOCK_TILE_ID, name: DOCK_NAME },
      knows: this.knows ? { ...this.knows, pid: this.knowsPid } : null, ...(this.restarting ? { restarting: true } : {}),
      ...(this.openedBy?.kind === "agent" ? { openedBy: this.openedBy.id } : {}),
      ...(p?.herdr ? { herdr: p.herdr } : {}),
      terminal: p ? p.describe() : null,
    };
  }

  /** Quitting the door would end the agent (it runs in the drawer itself, not in Herdr): said, and asked twice. */
  leaveWarning(): string | null {
    const p = this.p;
    return p?.running && !p.herdr ? `${p.title()} is running in the agent drawer · quitting ends it · again within 3s quits` : null;
  }

  // ── drawing ──

  /**
   * The drawer's rows over (or beside) a screen `rows` tall (the last row is the status bar): the host layer placed
   * by the layout engine, as the screen shown lets it appear. At least a frame and a row of the program, while room.
   */
  place(cols: number, rows: number): Rect {
    this.rows = rows; this.cols = cols;
    const room = rows - 1;
    // The engine's answer as it is (the drawer's own `min` keeps a frame and a row): `besideRows` reads the same one.
    const d = placeHost(this.layer, { col: 0, row: 0, cols, rows: room }, this.mode === "none" ? "over" : this.mode).drawer;
    return d ?? { col: 0, row: room, cols, rows: 0 };
  }

  /** The drawer, full width, laid over the screen's bottom rows: its lines, from row `rect.row`. */
  render(cols: number, rows: number, screen: string): { rect: Rect; lines: string[] } {
    const r = this.place(cols, rows);
    this.rect = r;
    const canvas = new Canvas(cols, r.rows);
    const box: Rect = { col: 0, row: 0, cols, rows: r.rows };
    canvas.clear(box, bg(C.black));
    const p = this.pane();
    const by = this.openedBy ? ` · ${fg(C.lmagenta)}pulled up by ${agentLabel(this.openedBy)}${fg(C.yellow)}` : "";
    const watching = this.state() === "watching";
    const where = watching ? ` · ${fg(C.lcyan)}another door has it${fg(C.yellow)}` : p.herdr ? ` · in Herdr (${p.herdr.pane})` : "";
    const title = `${fg(this.entered ? C.yellow : C.white)}${this.chipText()}${fg(C.yellow)}${where}${by} ${fg(C.dark)}· ↕ drag this edge`;
    // A second door only watches: its ⏎ would take the agent's pane from the door that has it, so it says so.
    const hint = watching
      ? `${fg(C.lcyan)}${this.entered ? "⏎ takes it over from the other door · q stops watching" : "click in it, then ⏎ takes it over from the other door"} · ${this.entered ? ESCAPE_CHORD : "alt+a"} ${this.entered ? `back to the ${screen}` : "puts it away"}`
      : this.entered
      ? `${fg(C.yellow)}every key goes to ${DOCK_NAME} · ${ESCAPE_CHORD} back to the ${screen} · alt+a puts it away`
      : `${fg(C.dark)}click in it or ${ESCAPE_CHORD} to type · alt+a or Esc puts it away · alt+A height`;
    canvas.box(box, fg(this.entered ? C.yellow : C.brown), title, hint);
    const inner = { cols: cols - 2, rows: r.rows - 2 };
    if (inner.cols >= 2 && inner.rows >= 1) {
      const view = p.render(inner.cols, inner.rows, this.entered, this.api, this.entered);
      view.lines.slice(0, inner.rows).forEach((l, i) => canvas.text(1, 1 + i, l, inner.cols));
    }
    return { rect: r, lines: canvas.lines() };
  }

  // ── keys and the mouse (App.key gives them here first) ──

  /** Raw input while the person is in the drawer and the agent runs: every byte is its, but alt+a and alt+A. */
  rawInput(run: DockRun): ((bytes: string) => void) | null {
    const p = this.p;
    if (!this.shown || !this.entered || !p?.running) return null;
    return (s: string) => {
      // As legacy ESC-and-a-letter or as a Kitty keyboard report (src/kbd.ts).
      const k = rawKey(s);
      if (k?.kind === "alt" && k.ch === "a") return run("host.toggle", { open: false });
      if (k?.kind === "alt" && k.ch === "A") return run("host.size", { share: nextStep(this.share) });
      p.inputRaw(s);
    };
  }

  /** A key or a mouse event, before the screen: true when the dock took it. `screen` is the one under it. */
  key(k: Key, screen: Screen | undefined, rows: number, run: DockRun): boolean {
    if (!this.active) return false;
    if (k.kind === "mouse") return this.mouse(k, rows, run);
    if (this.shown && this.entered) {
      const p = this.pane();
      if (isEscapeChord(k)) { run("host.leave", {}); return true; }
      if (isAlt(k, "a")) { run("host.toggle", { open: false }); return true; }
      if (isAlt(k, "A")) { run("host.size", { share: nextStep(this.share) }); return true; }
      if (!p.running) {
        if (k.kind === "enter") run("host.enter", { restart: true });
        else this.host.flash(`${DOCK_NAME} exited · ⏎ runs it again · ${ESCAPE_CHORD} back to the ${screen?.title ?? "screen"}`);
        return true;
      }
      if (k.kind === "paste") p.paste(k.text); else p.typed(k);
      return true;
    }
    if (isAlt(k, "a")) { run("host.toggle", {}); return true; }
    if (isAlt(k, "R")) { run("agent.restart", {}); return true; }
    if (this.shown && isEscapeChord(k)) return this.chordBack(screen, run);
    if (this.shown && isAlt(k, "A")) { run("host.size", { share: nextStep(this.share) }); return true; }
    // Esc puts it away when the screen isn't using it (an edit, a filter, a terminal the person is in).
    if (this.shown && k.kind === "esc" && !screen?.holdsKeys?.() && !screen?.rawKeys?.()) { run("host.toggle", { open: false }); return true; }
    return false;
  }

  /**
   * ctrl+] with the drawer up and the person out of it: back in (the keyboard's way, as a click is), or, right
   * after leaving it with ctrl+], back in with a ctrl+] sent to the agent. A screen's own ctrl+] comes first: in
   * its terminal tile it leaves the tile, and its second right after goes to that tile's program.
   */
  private chordBack(screen: Screen | undefined, run: DockRun): boolean {
    const now = Date.now();
    if (now - this.leftAt < CHORD_MS && this.p?.running) { run("host.enter", { send: "\x1d" }); return true; }
    if (screen?.rawKeys?.() || now - this.passedAt < CHORD_MS) { this.passedAt = now; return false; }
    run("host.enter", {});
    return true;
  }

  /**
   * The person goes into the drawer (ctrl+], a click in it): their keys are the agent's. One that exited waits
   * for ⏎ (`restart`), as it always has: going in only says so.
   */
  enter(send?: string, restart = false): { entered: boolean; restarted?: boolean } {
    if (!this.shown) throw new ActionRefused("the agent drawer is put away · alt+a pulls it up");
    const p = this.pane();
    this.leftAt = 0; this.openedBy = null;
    // Into the tab the drawer shows (the agent, its first).
    const dr = hostDrawer(this.layer);
    this.do({ op: "focus", tile: (dr && shownTiles(dr.kid)[0]) ?? DOCK_TILE_ID }, USER);
    if (!p.running && p.exited !== null) {
      if (restart) { p.restart(); this.host.redraw(); return { entered: true, restarted: true }; }
      this.host.flash(`${DOCK_NAME} exited · ⏎ runs it again · ${ESCAPE_CHORD} back to the screen`);
      this.host.redraw();
      return { entered: true };
    }
    if (send && p.running) { p.input(send); this.host.flash(`sent ${ESCAPE_CHORD} to ${DOCK_NAME}`); }
    this.host.redraw();
    return { entered: true };
  }

  /** The person's keys go back to the screen (ctrl+], a click above the drawer); the drawer stays up. */
  leave(screen: Screen | undefined, said = true): { entered: boolean } {
    if (!this.entered) throw new ActionRefused("the person isn't in the agent drawer");
    // Back to the screen slot: the screen's own focus is as they left it.
    this.do({ op: "focus", tile: HOST_SCREEN }, USER);
    this.leftAt = Date.now();
    if (said) this.host.flash(`back to the ${screen?.title ?? "screen"} · ${ESCAPE_CHORD} or a click goes back in (${ESCAPE_CHORD} again now sends it to ${DOCK_NAME}) · Esc or alt+a puts it away`);
    this.host.redraw();
    return { entered: false };
  }

  private mouse(k: Extract<Key, { kind: "mouse" }>, rows: number, run: DockRun): boolean {
    const p = this.p;
    if (this.dragging) {
      // Dragged past the ends (onto the status row, or the top): as far as it goes, not a refusal.
      if (k.action === "drag") { const room = rows - 1; run("host.size", { share: clamp((room - Math.max(1, k.y)) / room) }); }
      if (k.action === "up") this.dragging = false;
      return true;
    }
    if (this.capture) {
      const c = this.capture;
      if (k.action === "drag" || k.action === "up") p?.mouse({ ...k }, k.x - c.col - 1, k.y - c.row - 1);
      if (k.action === "up") this.capture = null;
      return true;
    }
    const chip = this.chipAt;
    if (chip && k.y === chip.row && k.x >= chip.from && k.x < chip.to) {
      // ⟳, the chip's last cell when it offers one, restarts the agent; anywhere else on the chip toggles the drawer.
      if (k.action === "down") run(this.offersRestart && k.x >= chip.to - 1 ? "agent.restart" : "host.toggle", {});
      return true;
    }
    const r = this.shown ? this.rect : null;
    if (!r) return false;
    const inside = k.y >= r.row && k.y < r.row + r.rows;
    if (!inside) {
      // A click on the screen above hands the keys back to it; the drawer stays up.
      if (k.action === "down" && this.entered) run("host.leave", { quiet: true });
      return false;
    }
    if (k.action === "down" && k.y === r.row) { this.dragging = true; return true; }
    const x = k.x - r.col - 1, y = k.y - r.row - 1;
    const pane = this.pane();
    if (k.action === "down") {
      if (!this.entered) run("host.enter", {});
      if (pane.wantsMouse() && y >= 0 && x >= 0) { this.capture = r; pane.mouse(k, x, y); }
      this.host.redraw();
      return true;
    }
    if (k.action === "wheel-up" || k.action === "wheel-down") pane.mouse(k, Math.max(0, x), Math.max(0, y));
    return true;
  }
}

/** The tile runs this program in this folder. */
const same = (p: PtyPane, a: { cmd: string[]; cwd?: string }) => p.run.cmd.join("\0") === a.cmd.join("\0") && (p.run.cwd ?? "") === (a.cwd ?? "");

/** alt+A: the next height step after `share` (past the last, the first). */
export function nextStep(share: number): number {
  return HEIGHT_STEPS.find(s => s > share + 0.01) ?? HEIGHT_STEPS[0];
}

/** How the dock's keys and clicks run its actions: as the person, a refusal said on the status bar. */
export type DockRun = (name: "host.toggle" | "host.size" | "agent.restart" | "host.enter" | "host.leave", args: Record<string, unknown>) => void;

/** What `agent.restart` answers once the agent runs again. */
export interface RestartDone { restarted: boolean; herdr?: string; was: AgentKnows["state"] | null }

function defaultHerdr(): HerdrRun | null {
  const bin = herdrBin();
  return bin ? herdrRunner(bin, 2000) : null;
}

export interface DockOn { dock: AgentDock; ctx: Ctx; here: Screen | undefined }
type DockArgs = { "agent.type": { text: string }; "host.toggle": { open?: boolean }; "host.size": { share: number }; "agent.restart": Record<string, never>; "agent.knows": Record<string, never>; "host.enter": { send?: string; restart?: boolean }; "host.leave": { quiet?: boolean } };

/** The dock's actions: on every screen, as the shell's are. */
export const DOCK_ACTIONS = new ActionSet<DockArgs, DockOn>("dock", {
  "host.enter": {
    aliases: ["agent.enter"],
    summary: "go into the agent drawer: the person's keys go to the agent until ctrl+]; restart=true runs one that exited again (⏎ on it). The person's only: an agent's would take their keys",
    keys: "ctrl+], click in the drawer, ⏎ on an exited agent; ctrl+] then ctrl+] sends ctrl+] to it",
    touches: "screen", replay: "safe",
    person: "going into the drawer takes the person's keys; an agent pulls it up with host.toggle and leaves their keys where they are",
    args: { send: { type: "string", optional: true, about: "bytes to give the agent first (a literal ctrl+])" }, restart: { type: "boolean", optional: true, about: "run an agent that exited again, as ⏎ on it does" } },
    run({ send, restart }, { dock }) { return dock.enter(send, restart); },
  },
  "host.leave": {
    aliases: ["agent.leave"],
    summary: "the person's keys go back to the screen from the agent drawer; the drawer stays up. The person's only",
    keys: "ctrl+], click on the screen above the drawer",
    touches: "screen", replay: "safe",
    person: "the person's keys are theirs: an agent doesn't take them out of the drawer",
    args: { quiet: { type: "boolean", optional: true, about: "say nothing on the status bar (a click away)" } },
    run({ quiet }, { dock, here }) { return dock.leave(here, !quiet); },
  },
  "host.toggle": {
    aliases: ["agent.toggle"],
    summary: "pull the host layer's drawer (the agent, its first tab) up over or beside the screen, as the screen lets it (its policy's host), or put it away (open=true/false; neither toggles). The person's pull gives it their keys; an agent's never does, waits until they're idle, and is said on screen. Refused on a screen that keeps the whole screen (host none)",
    keys: "alt+a, a click on the ▲ claude chip in the status bar; Esc (or ctrl+] then Esc) puts it away",
    touches: "screen", replay: "safe",
    says: out => ({ text: `· ${out.open ? "pulled up" : "put away"} the agent drawer`, ms: 6000 }),
    args: { open: { type: "boolean", optional: true, about: "true pulls it up, false puts it away; left out, it toggles" } },
    run({ open }, { dock }, actor) {
      const want = open ?? !dock.open;
      if (want !== dock.open || want) dock.set(want, actor);
      return { open: dock.open, entered: dock.entered, share: dock.share, state: dock.state() };
    },
  },
  "host.size": {
    aliases: ["agent.height"],
    summary: "how much of the screen the agent drawer covers, as a share of the rows above the status bar (0.2 to 0.9); over a screen, the screen under it doesn't move; beside one, the screen is drawn shorter",
    keys: "drag the drawer's top edge; alt+A steps 40%, 50%, 60%, 75%",
    touches: "tile", while: "typing", replay: "safe", way: "an agent doesn't resize it under them",
    args: { share: { type: "number", about: "0.2 to 0.9 (0.5: half the screen)" } },
    run({ share }, { dock }, actor) {
      if (!(share > 0 && share <= 1)) throw new ActionRefused(`share is a fraction of the screen, 0.2 to 0.9, not ${share}`);
      dock.height(share, actor);
      return { share: dock.share, open: dock.open };
    },
  },
  "agent.restart": {
    summary: "restart the agent (▲ claude) so it starts with the door's environment (EP0CH_CONTROL, EP0CH_NEST …) and the installed Claude mod: that agent alone is asked to exit (SIGTERM, SIGKILL after 8s) and the same command runs again, keeping the conversation (door-claude continues; a bare claude gets --continue). In Herdr it comes back in a new door-claude pane. An agent's restart is refused while the person types in it, and is said on screen",
    keys: `a click on ${RESTART_GLYPH} at the end of the ▲ claude chip (shown when it started without the door's variables, or without door tools); alt+R`,
    touches: "tile", while: "typing", replay: "ask", way: "an agent doesn't restart it under them",
    says: () => ({ text: `· restarted ${DOCK_NAME}`, ms: 6000 }),
    args: {},
    async run(_, { dock, ctx }, actor) {
      const p = dock.tile;
      // The agent's own window: the person who typed into it lately may be about to again.
      const idle = Date.now() - (p?.personKeyAt ?? 0);
      if (actor.kind === "agent" && p && idle < RESTART_IDLE_MS) throw new ActionRefused(`the person typed into the agent ${(idle / 1000).toFixed(1)}s ago; try again once they've left it ${RESTART_IDLE_MS / 1000}s`);
      ctx.flash(`restarting ${DOCK_NAME}${p?.herdr ? ` in Herdr (${p.herdr.pane})` : ""} · the conversation is kept`, 6000);
      return dock.restart();
    },
  },
  "agent.type": {
    summary: "send the agent (▲ claude, the host layer's agent) text as typed: \\n is ⏎, \\e Esc. The agent lives in the host layer, never as a tile on a screen, so this is how another agent types to it (tile.type types into a screen's terminal tile). Refused while the person is typing in it, and while it isn't running",
    keys: "the person types in the drawer (ctrl+], a click in it)",
    touches: "tile", while: "typing", replay: "ask", way: "an agent doesn't type there",
    says: () => `· typed to ${DOCK_NAME}`,
    args: { text: { type: "string", about: "what to type (\\n ⏎, \\e Esc)" } },
    run({ text }, { dock }) {
      const p = dock.tile;
      if (!p?.running) throw new ActionRefused(`${DOCK_NAME} isn't running · alt+a pulls it up and starts it`);
      p.input(text.replace(/\\n/g, "\r").replace(/\\e/g, "\x1b"));
      return { tile: DOCK_NAME, chars: text.length };
    },
  },
  "agent.knows": {
    summary: "what the agent (▲ claude) knows: read now from its own process (its environment and start time) against the installed Outliner Claude mod. state current (door tools; a changed mod reloads into it live), stale (started by an older door, without its variables), no-door (no EP0CH_CONTROL) or unknown",
    keys: "the ▲ claude chip says it: · door tools, · started before update ⟳",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { dock }) { return { knows: await dock.readKnows(), pid: dock.knowsPid }; },
  },
});

/** The host layer's agent as the actor rule sees it: the tile an agent's typing, resizing or restarting would be under. */
export const HOST_AGENT_TILE: TileRef = { name: HOST_AGENT, kind: "pty", label: `${DOCK_NAME} in the agent drawer` };

/**
 * `tile.herdr` for the host layer's agent (`tile=dock.agent`): the same rule as a desk terminal's (PTY_ACTIONS), said by
 * the Herdr launcher as it attaches, on whatever screen is shown.
 */
export const HOST_TILE_ACTIONS = new ActionSet<{ "tile.herdr": { pane?: string; name?: string; on?: boolean } }, { dock: AgentDock }>("host", {
  "tile.herdr": {
    summary: "the host layer's agent (tile=dock.agent) lives in Herdr pane pane=<label> (on=false: it no longer does): quitting the door then ends only the attach",
    touches: "nothing", replay: "ask",
    args: { pane: { type: "string", optional: true, about: "the Herdr pane's label (door-claude)" }, name: { type: "string", optional: true, about: "the agent's name in Herdr (door; a test door's door-<hash>)" }, on: { type: "boolean", optional: true, about: "false: it no longer shows a Herdr agent" } },
    run({ pane, name, on }, { dock }) {
      const p = dock.tile;
      if (!p) throw new ActionRefused(`${DOCK_TILE_ID} hasn't started`);
      if (on === false) { p.herdr = null; return { tile: DOCK_TILE_ID, herdr: null }; }
      if (!pane) throw new ActionRefused("tile.herdr needs pane=<the Herdr pane's label>");
      if (!p.running) throw new ActionRefused(`${DOCK_TILE_ID}'s program isn't running`);
      p.herdr = { pane, ...(name ? { name } : {}) };
      return { tile: DOCK_TILE_ID, herdr: p.herdr };
    },
  },
});

/** The drawer laid over a screen's lines: its rows replace the screen's (a full-width drawer, nothing reflows). */
export function overlay(lines: string[], drawer: { rect: Rect; lines: string[] }): string[] {
  const out = [...lines];
  drawer.lines.forEach((l, i) => { out[drawer.rect.row + i] = l + RESET; });
  return out;
}
