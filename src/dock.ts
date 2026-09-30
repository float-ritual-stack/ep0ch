// The dock, first slice (PIE-498): the agent that stays with the person on every screen. One terminal tile
// (`PtyPane`, the terminal tile's own code) belongs to the App, not to a screen. It runs what the daily
// layout's agent runs (`dailyAgent()`: the Herdr launcher on float-2, so the agent lives in a Herdr pane and
// outlives the door), and it starts the first time it's pulled up. A chip on the status bar (`▲ claude`)
// pulls it up as a drawer over the lower part of whatever screen is shown; the screen under it never
// reflows: it's drawn at its full size and the drawer is laid over its bottom rows, as the desk's drawers
// slide over its tiles without moving them.
//
// The daily layout's agent tile is this same instance (`shareAgent` in src/desk/tiles.ts): one door never
// attaches to the Herdr pane twice (Herdr allows one attached client per terminal, and a second attach from
// the same door would only watch). While the drawer shows it, the desk's tile says so instead of drawing it
// at a second size, so the program isn't resized back and forth each paint.
//
// Everything is an action (`DOCK_ACTIONS`: `agent.toggle`, `agent.height`): the chip's click, alt+a, Esc,
// the drawer's dragged top edge and alt+A call them, and so does an agent over `act`. An agent may pull it up
// only under the shell's rule (`agentMayMove`: never while the person types, never within 2s of their last
// key), it's said on the status bar and in the drawer's title, and an agent never enters it: its keys stay
// where they were. Whether it's open and how tall is saved in the door's state (dock.json), so it's still
// there after a screen switch and after a restart; with Herdr it's the same session everywhere.
import type { Ctx, Screen } from "./app";
import { Canvas, type Rect } from "./canvas";
import { agentConfig, herdrBin, herdrRunner, WATCH_TITLE, type HerdrRun } from "./desk/herdr-agent";
import type { DeskApi } from "./desk/panes";
import { ESCAPE_CHORD, isEscapeChord, PtyPane } from "./desk/pty";
import { dailyAgent, type SharedAgent } from "./desk/tiles";
import { readState, writeState } from "./state";
import { agentMayMove } from "./screens";
import { USER, type Actor } from "./socket";
import { ActionRefused, ActionSet, agentLabel } from "./surface/actions";
import { bg, C, fg, RESET } from "./style";
import type { Key } from "./term";

/** The dock agent's tile id and name: what `EP0CH_TILE_ID` and `EP0CH_TILE` tell its program (never a desk id, `t<n>`). */
export const DOCK_TILE_ID = "dock.agent";
export const DOCK_NAME = "claude";
/** The drawer's height, as a share of the rows above the status bar: at least this, at most that. */
export const MIN_SHARE = 0.2, MAX_SHARE = 0.9;
/** alt+A steps through these. */
export const HEIGHT_STEPS = [0.4, 0.5, 0.6, 0.75] as const;
/** A drawer is never shorter than this many rows (its frame and two of the program's). */
const MIN_ROWS = 4;
/** How long after the program's last output the chip still says `working` (no Herdr status to ask). */
const WORKING_MS = 1500;
/** How often Herdr is asked for the agent's state while the drawer shows a Herdr pane. */
const HERDR_POLL_MS = 3000;

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
}

const clamp = (share: number) => Math.max(MIN_SHARE, Math.min(MAX_SHARE, share));
const isAlt = (k: Key, ch: string) => k.kind === "alt" && k.ch === ch;

export class AgentDock implements SharedAgent {
  open = false;
  share = 0.5;
  /** The person is in the drawer: every key but ctrl+], alt+a and alt+A is the agent's. Never set by an agent. */
  entered = false;
  /** Who pulled it up, when that was an agent (said in the drawer's title until the person uses it). */
  openedBy: Actor | null = null;
  /** The screen shown lets the drawer be drawn (not the logon or the logoff). Set by the App before each paint. */
  active = false;
  /** Where the drawer was last drawn (full width, above the status bar), and the chip on the status bar. */
  rect: Rect | null = null;
  chipAt: { from: number; to: number; row: number } | null = null;
  private p: PtyPane | null = null;
  private viewers = new Set<{ redraw(): void }>();
  /** The top edge is being dragged; the program has the mouse until the button comes up. */
  private dragging = false;
  private capture: Rect | null = null;
  private herdrState: { state: AgentState; at: number } | null = null;
  /** What the tile's own code asks of a desk: a repaint, and a flash (it has no setsid or perl to start with). */
  private readonly api = { redraw: () => this.changed(), ctx: { flash: (m: string, ms?: number) => this.host.flash(m, ms) } } as unknown as DeskApi;
  private polling = false;
  private lastPoll = 0;

  /** `persist`: read and write dock.json (a test's dock may not). `herdr`: how Herdr is asked (a fake in tests). */
  constructor(private readonly host: DockHost, private readonly persist = true, private readonly herdr: HerdrRun | null = defaultHerdr()) {
    const s = persist ? readState<Partial<DockSaved>>("dock.json") : null;
    if (s && typeof s === "object") {
      this.open = s.open === true;
      if (typeof s.share === "number" && Number.isFinite(s.share)) this.share = clamp(s.share);
    }
  }

  // ── the one agent tile (SharedAgent: the desk's daily agent tile is this one) ──

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
    // The program's output repaints whatever shows it: the drawer, a desk tile, or only the chip.
    p.init(this.api);
    this.p = p;
    return p;
  }
  /** The tile when it has been made (nothing is started by asking). */
  get tile(): PtyPane | null { return this.p; }
  /** Its program has been started (it runs, or it ran and exited). */
  private get started(): boolean { return !!this.p && (this.p.running || this.p.exited !== null); }
  /**
   * The daily layout's agent tile `spec` wants: this one when it runs the same program (the usual case: both are
   * `dailyAgent()`), else null and the tile gets its own (a command the person changed, or one set since this started).
   */
  paneFor(spec: { cmd?: string[]; cwd?: string }): PtyPane | null {
    const p = this.pane();
    return !spec.cmd?.length || same(p, { cmd: spec.cmd, cwd: spec.cwd }) ? p : null;
  }
  isShared(p: unknown): boolean { return !!p && p === this.p; }
  /** The drawer shows it now: a desk tile of the same program draws a note instead (one size at a time). */
  drawnElsewhere(p: unknown): boolean { return this.isShared(p) && this.shown; }
  watch(v: { redraw(): void }) { this.viewers.add(v); }
  unwatch(v: { redraw(): void }) { this.viewers.delete(v); }

  get shown(): boolean { return this.open && this.active; }

  private changed() {
    for (const v of this.viewers) v.redraw();
    if (this.shown) this.host.redraw(); else this.host.statusChanged();
  }

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
    const name = agentConfig().name;
    this.herdr(["agent", "get", name]).then(r => {
      let s: string | undefined;
      try { s = JSON.parse(r.out)?.result?.agent?.agent_status; } catch { s = undefined; }
      const state: AgentState | null = s === "working" ? "working" : s === "idle" || s === "done" ? "idle" : s === "blocked" ? "blocked" : null;
      const was = this.herdrState?.state;
      this.herdrState = state ? { state, at: Date.now() } : null;
      if (state !== was) this.host.statusChanged();
    }, () => { this.herdrState = null; }).finally(() => { this.polling = false; });
  }

  /** The chip's words: `▲ claude`, `▲ claude · working`, `▼ claude · idle` (▼ while it's up). */
  chipText(now = Date.now()): string {
    const s = this.state(now);
    return `${this.open ? "▼" : "▲"} ${DOCK_NAME}${s === "off" ? "" : ` · ${s === "blocked" ? "needs you" : s === "exited" ? `exited ${this.p?.exited ?? ""}`.trim() : s}`}`;
  }
  /** The chip as drawn on the status bar (its colour says the state). */
  chip(now = Date.now()): string {
    const s = this.state(now);
    const c = s === "working" ? C.yellow : s === "blocked" ? C.lmagenta : s === "exited" ? C.lred : s === "watching" ? C.lcyan : C.white;
    return `${bg(this.open ? C.cyan : C.blue)}${fg(c)}${this.chipText(now)}${bg(C.blue)}${fg(C.lcyan)}`;
  }

  // ── actions ──

  /** Pull it up or put it away. The person's pull enters it (their keys go to the agent); an agent's never does. */
  set(open: boolean, actor: Actor) {
    if (open) {
      this.pane();
      this.open = true;
      if (actor.kind === "agent") { if (!this.entered) this.openedBy = actor; }
      else { this.entered = true; this.openedBy = null; }
    } else {
      this.open = false; this.entered = false; this.openedBy = null; this.capture = null; this.dragging = false;
    }
    this.save();
    this.host.redraw();
  }

  height(share: number) {
    this.share = clamp(share);
    this.save();
    this.host.redraw();
  }

  private save() { if (this.persist) writeState("dock.json", { open: this.open, share: this.share } satisfies DockSaved); }

  describe() {
    const p = this.p;
    return {
      open: this.open, shown: this.shown, entered: this.entered, share: Math.round(this.share * 100) / 100,
      rect: this.shown ? this.rect : null, state: this.state(), tile: { id: DOCK_TILE_ID, name: DOCK_NAME },
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

  /** The drawer's rows over a screen `rows` tall (the last row is the status bar): where it starts and how many. */
  place(cols: number, rows: number): Rect {
    const room = rows - 1;
    const h = Math.max(Math.min(MIN_ROWS, room), Math.min(room - 1, Math.round(room * this.share)));
    return { col: 0, row: room - h, cols, rows: h };
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
      : `${fg(C.dark)}click in it to type · alt+a or Esc puts it away · alt+A height`;
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
      if (s === "\x1ba") return run("agent.toggle", { open: false });
      if (s === "\x1bA") return run("agent.height", { share: nextStep(this.share) });
      p.inputRaw(s);
    };
  }

  /** A key or a mouse event, before the screen: true when the dock took it. `screen` is the one under it. */
  key(k: Key, screen: Screen | undefined, rows: number, run: DockRun): boolean {
    if (!this.active) return false;
    if (k.kind === "mouse") return this.mouse(k, rows, run);
    if (this.shown && this.entered) {
      const p = this.pane();
      if (isEscapeChord(k)) { this.entered = false; this.host.flash(`back to the ${screen?.title ?? "screen"} · click in ${DOCK_NAME} to type again · Esc or alt+a puts it away`); this.host.redraw(); return true; }
      if (isAlt(k, "a")) { run("agent.toggle", { open: false }); return true; }
      if (isAlt(k, "A")) { run("agent.height", { share: nextStep(this.share) }); return true; }
      if (!p.running) {
        if (k.kind === "enter") { p.restart(); this.host.redraw(); }
        else this.host.flash(`${DOCK_NAME} exited · ⏎ runs it again · ${ESCAPE_CHORD} back to the ${screen?.title ?? "screen"}`);
        return true;
      }
      if (k.kind === "paste") p.paste(k.text); else p.key(k, this.api);
      return true;
    }
    if (isAlt(k, "a")) { run("agent.toggle", {}); return true; }
    if (this.shown && isAlt(k, "A")) { run("agent.height", { share: nextStep(this.share) }); return true; }
    // Esc puts it away when the screen isn't using it (an edit, a filter, a terminal the person is in).
    if (this.shown && k.kind === "esc" && !screen?.holdsKeys?.() && !screen?.rawKeys?.()) { run("agent.toggle", { open: false }); return true; }
    return false;
  }

  private mouse(k: Extract<Key, { kind: "mouse" }>, rows: number, run: DockRun): boolean {
    const p = this.p;
    if (this.dragging) {
      if (k.action === "drag") { const room = rows - 1; run("agent.height", { share: (room - Math.max(1, k.y)) / room }); }
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
      if (k.action === "down") run("agent.toggle", {});
      return true;
    }
    const r = this.shown ? this.rect : null;
    if (!r) return false;
    const inside = k.y >= r.row && k.y < r.row + r.rows;
    if (!inside) {
      // A click on the screen above hands the keys back to it; the drawer stays up.
      if (k.action === "down" && this.entered) { this.entered = false; this.host.redraw(); }
      return false;
    }
    if (k.action === "down" && k.y === r.row) { this.dragging = true; return true; }
    const x = k.x - r.col - 1, y = k.y - r.row - 1;
    const pane = this.pane();
    if (k.action === "down") {
      if (!this.entered) { this.entered = true; this.openedBy = null; }
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
export type DockRun = (name: "agent.toggle" | "agent.height", args: Record<string, unknown>) => void;

function defaultHerdr(): HerdrRun | null {
  const bin = herdrBin();
  return bin ? herdrRunner(bin, 2000) : null;
}

export interface DockOn { dock: AgentDock; ctx: Ctx; here: Screen | undefined }
type DockArgs = { "agent.toggle": { open?: boolean }; "agent.height": { share: number } };

/** The dock's actions: on every screen, as the shell's are. */
export const DOCK_ACTIONS = new ActionSet<DockArgs, DockOn>("dock", {
  "agent.toggle": {
    summary: "pull the agent drawer up over the screen, or put it away (open=true/false; neither toggles). The person's pull gives it their keys; an agent's never does, waits until they're idle, and is said on screen",
    keys: "alt+a, a click on the ▲ claude chip in the status bar; Esc (or ctrl+] then Esc) puts it away",
    args: { open: { type: "boolean", optional: true, about: "true pulls it up, false puts it away; left out, it toggles" } },
    run({ open }, { dock, ctx, here }, actor) {
      const want = open ?? !dock.open;
      if (actor.kind === "agent") {
        if (!dock.active) throw new ActionRefused(`the door is at the ${here?.title ?? "logon"}; the drawer shows once the person has logged on`);
        if (!want && dock.entered) throw new ActionRefused(`the person is typing in the agent drawer; an agent doesn't put it away`);
        if (want !== dock.open) agentMayMove(here, ctx, actor);
      }
      if (want !== dock.open || (want && actor.kind !== "agent" && !dock.entered)) dock.set(want, actor);
      if (actor.kind === "agent") ctx.flash(`${want ? "pulled up" : "put away"} the agent drawer`, 6000);
      return { open: dock.open, entered: dock.entered, share: dock.share, state: dock.state() };
    },
  },
  "agent.height": {
    summary: "how much of the screen the agent drawer covers, as a share of the rows above the status bar (0.2 to 0.9); the screen under it doesn't move",
    keys: "drag the drawer's top edge; alt+A steps 40%, 50%, 60%, 75%",
    args: { share: { type: "number", about: "0.2 to 0.9 (0.5: half the screen)" } },
    run({ share }, { dock }, actor) {
      if (!(share > 0 && share <= 1)) throw new ActionRefused(`share is a fraction of the screen, 0.2 to 0.9, not ${share}`);
      if (actor.kind === "agent" && dock.entered) throw new ActionRefused("the person is typing in the agent drawer; an agent doesn't resize it under them");
      dock.height(share);
      return { share: dock.share, open: dock.open };
    },
  },
});

/** A person's key or click: the action as `you`; a refusal is said, not thrown. */
export function dockRunner(dock: AgentDock, ctx: Ctx, here: () => Screen | undefined): DockRun {
  return (name, args) => {
    const say = (e: unknown) => ctx.flash(e instanceof Error ? e.message : String(e));
    try { DOCK_ACTIONS.runUntyped(name, args, { dock, ctx, here: here() }, USER).catch(say); } catch (e) { say(e); }
  };
}

/** The drawer laid over a screen's lines: its rows replace the screen's (a full-width drawer, nothing reflows). */
export function overlay(lines: string[], drawer: { rect: Rect; lines: string[] }): string[] {
  const out = [...lines];
  drawer.lines.forEach((l, i) => { out[drawer.rect.row + i] = l + RESET; });
  return out;
}
