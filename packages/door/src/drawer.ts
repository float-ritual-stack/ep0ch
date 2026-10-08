// The host layer and its drawer (PIE-513; PIE-498): what stays with the person on every screen, above the screen layer
// that is swapped per screen. It is a layout on the one layout engine (`hostLayer` in src/desk/screen-layout.ts): a
// slot for whatever screen is shown, beside a drawer. The drawer is the drawer: it holds tiles that belong to the App,
// not to a screen, as tabs, and they travel with the person across screens. Its first tab is the drawer's own program
// (`drawerProgram`, src/desk/drawer-program.ts: EP0CH_DAILY_AGENT, else a shell, in the folder that rule names); any tile
// joins it (`tile.drawer`, ^W a, a drag onto the chip or the drawer) and leaves it into the screen shown the same ways.
// A tile moved in or out is the same tile: its program runs on (a session's terminal host keeps it under the key it
// started with, `PtyPane.keptKey`), its note, history and draft stay.
//
// The drawer's tiles live on one desk of their own (`hostSpec`: a tab set on the one screen host, saved in
// drawer-tiles.json in the outline's folder of the state dir), so a reader in the drawer edits, a tree in the drawer opens, a terminal in the drawer
// types exactly as on any screen: no second tile host. The host layer places that desk; its drawer is the
// only drawer the drawer has. A chip on the status bar (`▲ claude`, `▲ shell +2`) pulls it up. Where it appears is the
// screen's to say (its policy's `host`): `over` its lower rows (the default), `beside` it (the screen drawn shorter),
// or `none`.
//
// The person's keys move through the host layer's own transitions: pulled up by the person, they go to the drawer's tab
// shown; put away (or ctrl+]), back to the screen slot, where the screen's own focus is exactly as they left it. An
// agent's pull never takes them.
//
// Everything is an action (`DRAWER_ACTIONS`: `host.toggle`, `host.size`, `host.enter`, `host.leave`; `tile.drawer` is a
// tile action on every screen and in the drawer; and the drawer's own program's `agent.type`, `agent.knows`,
// `agent.restart`). An agent may pull it up only under the actor rule for what changes the person's screen
// (`touches: "screen"`, PIE-514), it's said on the status bar and in the drawer's title, and an agent never enters it.
// Whether it's open and how tall is saved in drawer.json, so it's still there after a screen switch and a restart.
//
// The chip also says what the drawer's agent knows (src/desk/agent-env.ts): `door tools`, or `started before update ⟳`
// / `no door tools ⟳` (⟳ restarts it, keeping the conversation).
import type { Ctx, Screen } from "./app";
import { Canvas, type Rect } from "./canvas";
import { agentConfig, herdrBin, herdrRunner, paneAgentPid, WATCH_TITLE, type HerdrRun } from "./desk/herdr-agent";
import { DRAWER_TILE_ID, judgeAgent, knowsLabel, modDirs, modStamp, readAgent, RESTART_GLYPH, type AgentKnows } from "./desk/agent-env";
import { alive } from "./state";
import { controlPath } from "./control";
import { ESCAPE_CHORD, isEscapeChord, PtyPane, type PtySpec } from "./desk/pty";
import { rawKey } from "./kbd";
import { choiceFile, detectAgents, drawerProgram, HERDR_LAUNCHER, sessionLabel, shellQuote, type DrawerAgent, type DrawerProgram } from "./desk/drawer-program";
import { sessionSlug } from "./desk/herdr-agent";
import { readPlace } from "./session/place";
import { outlineState, stateDir } from "./state";
import { centred, ListPicker, pickRow } from "./surface/picker";
import { spawn as spawnDetached } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Desk, type MovedTile } from "./desk/desk";
import type { Pane } from "./desk/panes";
import type { ScreenSpec } from "./desk/screen-spec";
import type { TileDone, Where } from "./desk/tile-actions";
import { registerTileKind, tileKind, UnavailableTile } from "./desk/tile-kinds";
import { statusMark, waitingOnYou } from "./desk/program-status";
import { rowFacts, WAITING_YOU_KIND_NAME } from "./desk/waiting-you";
import { WHAT_CHANGED_KIND_NAME, type WhatChangedPane } from "./desk/what-changed";
import { PTY_ACTIONS } from "./desk/pty-actions";
import { apply as applyLayout, hostDock, hostLayer, HOST_SCREEN, placeHost, type Ctx as LayoutCtx, type HostMode, type LayoutState, type Op, type TileFacts } from "./desk/screen-layout";
import { readState, writeState } from "./state";
import { USER, type Actor } from "./socket";
import { ActionRefused, actionSet, def, agentLabel, type ActRequest } from "./surface/actions";
import { actorRule, type TileRef } from "./surface/dispatch";
import { HOST_AGENT, type Whereabouts } from "./whereabouts";
import { bg, C, chip as chipStyle, fg, pad, RESET, width } from "./style";
import type { Key } from "./term";
import type { Placement } from "./kitty";

/** The drawer's own tile's id and name (`drawer.agent`): what `EP0CH_TILE_ID` tells its program (never a desk id, `t<n>`). */
export { DRAWER_TILE_ID };
/** The host layer's drawer holds the drawer's desk: one leaf, its tiles the drawer's tabs. */
export const HOST_TILES = "drawer.tiles";
/**
 * The drawer's own tile's kind: a terminal the drawer owns (EP0CH_DAILY_AGENT, else a shell), its first tab. It never
 * closes; it may leave (^W a, a drag out), onto the screen as an ordinary terminal tile, and a new one takes its tab.
 */
export const DRAWER_KIND = "drawer.own";
/** The drawer's desk as a screen spec: one tab set, the drawer's own tile first; what's put in joins it as tabs. */
export function hostSpec(persist = true): ScreenSpec {
  return {
    name: "drawer", title: "drawer", digits: false, ...(persist ? { saves: "drawer-tiles.json" } : {}),
    layout: { focus: DRAWER_TILE_ID, root: { t: "tabs", tabs: [{ t: "leaf", kind: DRAWER_KIND, name: DRAWER_TILE_ID }], active: 0 } as never },
  };
}
/** The drawer's own tile: a terminal whose header says what runs in it (claude, shell), its tile name staying `drawer.agent`. */
class DrawerTile extends PtyPane {
  override kind: string = DRAWER_KIND;
  constructor(spec: PtySpec, public shows: string) { super(spec); }
  /** It never closes: its exit line doesn't offer ^W x. */
  protected override closesBy = "";
  headName() { return this.shows; }
  /** It leaves the drawer for a screen: from now on an ordinary terminal tile there (its program running on), never the drawer's. */
  release() { this.kind = "pty"; this.closesBy = " · ^W x closes"; this.next = null; }
  /**
   * The agent chosen now runs at its next start (agent.restart, or the next door): never in place of one running. Kept
   * aside until then: what runs now is still read as what it was started as (its exit line, its header).
   */
  retarget(p: DrawerProgram) {
    this.next = { cmd: p.cmd, cwd: p.cwd, label: p.name, inShell: p.name !== "shell" && !p.herdr, shows: p.name };
    if (!this.running) this.takeNext();
  }
  private next: { cmd: string[]; cwd: string; label: string; inShell: boolean; shows: string } | null = null;
  private takeNext() { if (!this.next) return; const { shows, ...run } = this.next; Object.assign(this.run, run); this.shows = shows; this.next = null; }
  protected override start(cols: number, rows: number) { this.takeNext(); super.start(cols, rows); }
}
/** The drawer's own kind, registered once: a terminal's actions and keys; it doesn't close (its policy), said in a person's words. */
function registerDrawerKind() {
  if (tileKind(DRAWER_KIND)) return;
  // The terminal kind's own hooks (its keys, its views, what it holds), all but how one is made, its ^W o keys and its
  // start (the drawer gives its own tile its id and home), so the two never drift apart.
  const { kind: _k, keys: _keys, make: _m, start: _s, actions: _a, about: _ab, noun: _n, ...pty } = tileKind("pty")!;
  registerTileKind({
    ...pty,
    kind: DRAWER_KIND, about: "the drawer's own program (EP0CH_DAILY_AGENT, else a shell): the drawer's first tab, the host layer's", noun: "a terminal tile",
    make: () => new UnavailableTile(DRAWER_KIND, "the drawer's own tab is the drawer's (alt+a pulls it up)"),
    inherits: [PTY_ACTIONS], policy: { ...(pty.policy ?? {}), closable: false },
    stays: "your drawer's own program doesn't close · ^W a takes it out onto the screen, or exit it to end it",
  });
}
/** What a drop on the chip or the open drawer says while dragging: the tile goes into your drawer, and travels with you. */
export const DRAWER_DROP = "into your drawer: travels with you";
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

/** What drawer.json keeps: whether it's up, its height, and how many own programs have left it (`gen`, its key's). */
export interface DrawerSaved { open: boolean; share: number; gen?: number }
/**
 * What the chip says: not started, working, idle, waiting on the person, done (a result the person hasn't seen),
 * failed, exited, or `watching`: the Herdr launcher found another door attached to the agent's pane and only watches it
 * (a second ssh session's door), where ⏎ would take the pane from that door. What its program reports (OSC 7501:
 * src/desk/program-status.ts) comes first; without that, Herdr's status, then whether it wrote anything lately.
 */
export type AgentState = "off" | "working" | "idle" | "blocked" | "done" | "failed" | "exited" | "watching";

/** What the drawer needs from the App. */
export interface DrawerHost {
  redraw(): void;
  /** Only the status bar changed (the chip): repaint it alone when the screen allows. */
  statusChanged(): void;
  flash(msg: string, ms?: number): void;
  /** The screen shown (the screen layer): where it lets the host layer appear. */
  screen?(): Screen | undefined;
  /** The App as its screens see it: the drawer's desk is entered with it (absent in a test's bare drawer: no tiles but its own). */
  ctx?(): Ctx | undefined;
  /** Where the person is (the shell's query, PIE-514): the host layer's operations are applied with it. */
  person?(): Whereabouts;
}

const clamp = (share: number) => Math.max(MIN_SHARE, Math.min(MAX_SHARE, share));
const isAlt = (k: Key, ch: string) => k.kind === "alt" && k.ch === ch;

export class AgentDrawer {
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
  private p: DrawerTile | null = null;
  /** The drawer's tiles, on a desk of their own (made the first time it's needed, with the App as its ctx). */
  private d: Desk | null = null;
  /** What the drawer's own tile runs, read when it's made. */
  private prog: DrawerProgram;
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
  private polling = false;
  private lastPoll = 0;
  /** What the running agent knows (null: not read yet, or not running); the pid it was read from. */
  knows: AgentKnows | null = null;
  knowsPid: number | null = null;
  private knowing = false;
  private lastKnow = 0;
  /** A restart under way: the chip says so, and a second one waits for it. */
  restarting: Promise<RestartDone> | null = null;

  /** `persist`: read and write drawer.json (a test's drawer may not). `herdr`: how Herdr is asked (a fake in tests). */
  constructor(private readonly host: DrawerHost, private readonly persist = true, private readonly herdr: HerdrRun | null = defaultHerdr()) {
    const s = persist ? readState<Partial<DrawerSaved>>("drawer.json") : null;
    const open = !!s && typeof s === "object" && s.open === true;
    const share = s && typeof s.share === "number" && Number.isFinite(s.share) ? clamp(s.share) : 0.5;
    this.gen = s && typeof s.gen === "number" && Number.isInteger(s.gen) && s.gen > 0 ? s.gen : 0;
    this.layer = hostLayer({ tabs: [HOST_TILES], names: new Map([[HOST_TILES, HOST_TILES]]), share, open });
    this.prog = this.program();
    registerDrawerKind();
  }

  /** The drawer's own program and folder, for the outline the door is on. */
  private program(): DrawerProgram {
    // The door's own machine first: an outline on another machine never starts in a same-named local outline's folder.
    const c = this.host.ctx?.(), pl = this.persist ? readPlace(outlineState()) : null;
    return drawerProgram({ outline: c?.outline ?? pl?.outline ?? null, machine: c?.machine ?? pl?.machine ?? null, dir: this.persist ? outlineState() : null, state: this.persist ? stateDir() : null });
  }
  /** This outline's session, as its Herdr pane and doctor name it (`pie-hole@float-2`). */
  private session(): string | null { const c = this.host.ctx?.(), pl = this.persist ? readPlace(outlineState()) : null; return sessionLabel({ outline: c?.outline ?? pl?.outline ?? null, machine: c?.machine ?? pl?.machine ?? null }); }

  /** The agents to choose from here (installed, a shell first; each in Herdr too when Herdr is). */
  agents(): DrawerAgent[] { return detectAgents({ session: this.session() }); }

  /**
   * The person's (or an agent's) choice of the drawer's own agent: saved for this outline's session (or, `dflt`, as
   * the default for every outline). The drawer's own tab runs it from its next start; one running now keeps running
   * (nothing is restarted behind the person's back): agent.restart starts the new one in its place.
   */
  choose(name: string, herdr: boolean, dflt: boolean, actor: Actor): Record<string, unknown> {
    const all = this.agents(), hit = all.find(a => a.name === name && !!a.herdr === herdr);
    if (!hit) throw new ActionRefused(`no agent ${name}${herdr ? " in Herdr" : ""} here; installed: ${all.map(a => `${a.name}${a.herdr ? " (herdr=true)" : ""}`).join(", ")}`);
    if (!this.persist) throw new ActionRefused("this drawer saves nothing (a test's)");
    const file = choiceFile(dflt ? stateDir() : outlineState());
    try { mkdirSync(dirname(file), { recursive: true, mode: 0o700 }); writeFileSync(file, JSON.stringify({ agent: name, ...(herdr ? { herdr: true } : {}) }), { mode: 0o600 }); }
    catch (e) { throw new ActionRefused(`couldn't save the choice in ${file}: ${(e as Error).message}`); }
    this.prog = this.program();
    const p = this.p, running = !!p?.running;
    if (p instanceof DrawerTile) p.retarget(this.prog);
    const env = this.prog.from === "env" ? ` · EP0CH_DAILY_AGENT (${process.env.EP0CH_DAILY_AGENT}) still overrides it in this door` : "";
    this.host.flash(running ? `${this.prog.name} chosen for the drawer · what runs there now keeps running: alt+R starts ${this.prog.name} in its place${env}` : `${this.prog.name} chosen for the drawer${env}`, 8000);
    this.host.redraw();
    void actor;
    return { agent: name, herdr, saved: dflt ? "default" : this.session() ?? "session", runs: this.prog.cmd, startsNow: !running };
  }

  /** The picker over the drawer: the agents installed here; ⏎ chooses one (host.agent), esc leaves it as it is. */
  pick(): { picking: boolean } {
    const d = this.desk;
    if (!d) throw new ActionRefused("the drawer isn't ready");
    // Pulled up for the picker: the first pull's own offer of it would stack a second.
    this.offered = true;
    if (!this.open) this.set(true, USER);
    this.do({ op: "focus", tile: HOST_TILES }, USER);
    const now = this.prog;
    d.overlay(new ListPicker<DrawerAgent, Desk>({
      name: "drawer agent", items: () => this.agents(),
      row: (a, _i, on, w) => [pickRow(` ${a.name}${a.herdr ? " · in Herdr (outlives the door)" : ""}${a.name === now.name && a.herdr === now.herdr ? " · now" : ""}  ${a.cmd.at(-1) === a.name ? "" : a.cmd.join(" ")}`, on, w)],
      choose: a => { void this.run?.("host.agent", { name: a.name, ...(a.herdr ? { herdr: true } : {}) }); },
      frame: (r, n) => ({ rect: centred(r, Math.min(64, r.cols - 2), Math.min(r.rows - 1, n + 2)), title: "the drawer's agent", foot: "↑↓ pick · ⏎ choose · esc · it starts in your shell" }),
    }));
    this.host.redraw();
    return { picking: true };
  }
  /** How the drawer runs its own actions as the person (the App's dispatcher), for the picker's choice. */
  run: ((name: string, args: Record<string, unknown>) => Promise<unknown>) | null = null;

  /** A new shell in the drawer, in its folder, as a tab shown (alt+s): the person's keys go into it; an agent's never do. */
  async newShell(actor: Actor): Promise<TileDone> {
    const d = this.desk;
    if (!d) throw new ActionRefused("the drawer isn't ready");
    // Pulled up for a shell: the picker isn't offered over it (alt+g is the way to it).
    if (actor.kind !== "agent" && !this.open) { this.offered = true; this.set(true, actor); }
    const done = await d.openTile({ kind: "pty", cmd: shellQuote(process.env.SHELL || "sh"), cwd: this.prog.cwd }, DRAWER_TILE_ID, "tabs", actor);
    if (actor.kind !== "agent") { this.do({ op: "focus", tile: HOST_TILES }, actor); d.run("tab.select", {}, done.tile); this.intoShown(); }
    this.host.redraw();
    return done;
  }

  /**
   * The waiting-on-you list (src/desk/waiting-you.ts: what the terminals' programs say waits on the person) as a tab in
   * the drawer, opened once and shown again after: the person's pulls the drawer up and goes to it (alt+w); an agent's
   * opens it behind the tab shown.
   */
  async waiting(actor: Actor): Promise<{ tile: string; waiting: number }> {
    const d = this.desk;
    if (!d) throw new ActionRefused("the drawer isn't ready");
    if (actor.kind !== "agent" && !this.open) { this.offered = true; this.set(true, actor); }
    const tile = this.tabs().find(t => t.kind === WAITING_YOU_KIND_NAME)?.name ?? (await d.openTile({ kind: WAITING_YOU_KIND_NAME }, DRAWER_TILE_ID, "tabs", actor)).tile;
    if (actor.kind !== "agent") { this.do({ op: "focus", tile: HOST_TILES }, actor); d.run("tab.select", {}, tile); this.intoShown(); }
    this.host.redraw();
    return { tile, waiting: waitingOnYou(this).length };
  }

  /**
   * The what-changed list (src/desk/what-changed.ts: the notes others changed since the person last looked) as a tab in
   * the drawer, as `waiting` opens its own. The person's opening it is looking: what it holds is marked seen (the status
   * bar's count goes to 0), while the list keeps marking those rows new. An agent's opens it behind the tab shown and
   * never marks anything seen.
   */
  async changes(actor: Actor): Promise<{ tile: string; changed: number; seen: boolean }> {
    const d = this.desk;
    if (!d) throw new ActionRefused("the drawer isn't ready");
    const store = this.host.ctx?.()?.whatChanged;
    if (!store) throw new ActionRefused("there is no outline here to have changed");
    const person = actor.kind !== "agent";
    // Looking marks what is held seen: only once the changes since the kept position are in.
    await store.settled();
    if (person && !this.open) { this.offered = true; this.set(true, actor); }
    const tile = this.tabs().find(t => t.kind === WHAT_CHANGED_KIND_NAME)?.name ?? (await d.openTile({ kind: WHAT_CHANGED_KIND_NAME }, DRAWER_TILE_ID, "tabs", actor)).tile;
    const changed = store.count();
    if (person) {
      (d.pane(tile) as unknown as WhatChangedPane | undefined)?.keepFresh(store.unseenIds());
      store.markSeen();
      this.do({ op: "focus", tile: HOST_TILES }, actor); d.run("tab.select", {}, tile); this.intoShown();
    }
    this.host.redraw();
    return { tile, changed, seen: person };
  }

  /** The what-changed rows, titles read, for `changes.list`. */
  async changesRead(): Promise<{ changed: Record<string, unknown>[] }> {
    const door = this.host.ctx?.();
    await door?.whatChanged?.titles(door.board);
    return { changed: door?.whatChanged?.facts() ?? [] };
  }

  /** Open block `id` on the screen shown, as its details open (a new detail when `fresh`), or where an open naming no tile lands. */
  async openOnScreen(id: string, fresh: boolean, actor: Actor): Promise<{ reader: string | null; id: string }> {
    const screen = tilesOf(this.host.screen?.());
    if (!screen) throw new ActionRefused("this screen has no tiles to open it in · q goes back to one");
    if (screen.hasPlaces()) return screen.openPlace(id, fresh ? "new-detail" : "detail", actor);
    return screen.openLanding(id, actor);
  }

  /**
   * Go to tile `p` (the waiting-on-you list's status.go, the power bar's tiles): in the drawer, it's pulled up with that
   * tab shown and the keys in it; on the screen shown, the drawer goes away and the keys go to it; on a screen under
   * this one or kept in the background, that screen comes to the top first (`Ctx.raise`; the person's only: an agent
   * never moves their screen this way). A spine opens first (`tile.expand`); `zoom` zooms it after.
   */
  goTo(p: Pane, actor: Actor, o: { zoom?: boolean } = {}): { tile: string; in: "drawer" | "screen"; raised?: string } {
    const d = this.d, inDrawer = d?.nameOfPane(p) ?? "";
    if (d && inDrawer) {
      if (!this.open) { this.offered = true; this.set(true, actor); }
      this.do({ op: "focus", tile: HOST_TILES }, actor);
      d.run("tab.select", {}, inDrawer);
      this.intoShown();
      p.focused?.(d, actor);
      if (o.zoom) d.zoomTile(inDrawer, true, actor);
      this.host.redraw();
      return { tile: inDrawer, in: "drawer" };
    }
    let screen = tilesOf(this.host.screen?.()), name = screen?.nameOfPane(p) ?? "", raised: string | undefined;
    const what = (p as { statusName?(): string }).statusName?.() ?? "that tile";
    if (!screen || !name) {
      const ctx = this.host.ctx?.(), under = ctx ? [...(ctx.screens?.() ?? []), ...(ctx.kept?.() ?? [])].find(s => s !== this.host.screen?.() && !!tilesOf(s)?.nameOfPane(p)) : undefined;
      if (!under || !ctx?.raise) throw new ActionRefused(`${what} isn't on this screen or in your drawer: it's on a screen under this one (q goes back to it)`);
      if (actor.kind === "agent") throw new ActionRefused(`${what} is on the ${under.title}, under this screen: an agent doesn't move the person's screen to it (screen.open names a screen, as the person's idle allows)`);
      ctx.raise(under);
      raised = under.title;
      screen = tilesOf(under); name = screen!.nameOfPane(p);
    }
    if (this.open) this.set(false, actor);
    if (screen!.tileOutline().some(t => t.name === name && t.collapsed)) screen!.collapseTile(name, false, actor);
    screen!.focusPane(p, actor);
    // Already the focused tile, the focus didn't move: the person is back in it all the same.
    p.focused?.(screen!, actor);
    if (o.zoom) screen!.zoomTile(name, true, actor);
    this.host.redraw();
    return { tile: name, in: "screen", ...(raised ? { raised } : {}) };
  }

  /** The session ended: its own Herdr pane closes (never another session's: the pane is named for this one). */
  closeOwnPane(): boolean {
    const label = this.p?.herdr?.pane, session = this.session();
    // This session's pane exactly (a test door's carries its scope, 8 hex digits, after it): never one whose name only starts so.
    const slug = session ? sessionSlug(session) : "";
    if (!label || !slug || !(label === slug || (label.startsWith(`${slug}-`) && /^[0-9a-f]{8}$/.test(label.slice(slug.length + 1))))) return false;
    try { spawnDetached(process.execPath, [HERDR_LAUNCHER, "--close", label], { detached: true, stdio: "ignore" }).unref(); return true; } catch { return false; }
  }
  /** What the drawer's own tab is called (claude, shell): the chip's name. */
  get name(): string { return this.prog.name; }
  /** What it runs and where, and why (`ep0ch doctor`, peek). */
  get runs(): DrawerProgram { return this.prog; }

  /**
   * The drawer's desk, made the first time it's needed (with the App to enter it): its own tile first, then what was
   * in it when the door last ran (drawer-tiles.json), each tile adopting its program as it's first drawn.
   */
  get desk(): Desk | null {
    if (this.d) return this.d;
    const ctx = this.host.ctx?.();
    if (!ctx) return null;
    // Its tiles' ids are `k<n>`: a tile in the drawer's id is never a screen tile's (tile= reaches either by id).
    const d = new Desk(hostSpec(this.persist), { given: new Map([[DRAWER_TILE_ID, this.pane()]]), where: () => this.whereIn(), idPrefix: "k" });
    this.d = d;
    d.enter(ctx);
    d.shownAs(this.shown);
    return d;
  }
  /** Where the person is, as the drawer's desk sees it: in it while they're in the drawer, else nowhere on it. */
  private whereIn(): Whereabouts {
    const w = this.host.person?.();
    const base: Whereabouts = w ?? { focus: null, typingIn: null, busy: false, keys: "screen", screen: null, idle: Infinity, away: null };
    if (!this.entered || !this.d) return { ...base, focus: null, typingIn: null };
    const k = this.d.keys();
    return { ...base, focus: k.focus, typingIn: k.typingIn ?? k.focus, busy: true, keys: "host" };
  }
  /** The drawer's desk when it has been made (reading this never makes it). */
  get made(): Desk | null { return this.d; }
  /** The tile the person types in, in the drawer (its tile name; the drawer's own is `drawer.agent`), or null. */
  typingTile(): string | null { if (!this.entered) return null; const k = this.d?.keys(); return k?.typingIn ?? k?.focus ?? DRAWER_TILE_ID; }
  /** `d` is the drawer's desk. */
  isDrawer(d: unknown): boolean { return !!d && d === this.d; }
  /** The drawer's desk (once made) and the screen shown's tiles (a desk, or a desk inside it: the showcase's section). */
  desks(): Desk[] {
    const screen = tilesOf(this.host.screen?.());
    return [...(this.d ? [this.d] : []), ...(screen && screen !== this.d ? [screen] : [])];
  }
  /** The drawer's tiles, as tabs: the drawer's own first. */
  tabs(): { name: string; id: string; kind: string; title: string; shown: boolean; focused: boolean; pid?: number }[] {
    const d = this.desk;
    if (!d) return [{ name: DRAWER_TILE_ID, id: DRAWER_TILE_ID, kind: DRAWER_KIND, title: this.name, shown: true, focused: this.entered }];
    const g = d.layoutGet() as { tiles: { name: string; id: string; kind: string; title: string; shown: boolean; focused: boolean }[] };
    // A terminal's pid: `ep0ch where` from its program finds it here, though it started on another screen (its EP0CH_TILE_ID was that one's).
    return g.tiles.map(t => { const p = d.pane(t.name), pid = p instanceof PtyPane ? p.pid : undefined; return { name: t.name, id: t.id, kind: t.kind, title: t.title, shown: t.shown, focused: this.entered && t.focused, ...(pid ? { pid } : {}) }; });
  }
  /** The tab the drawer shows now. */
  private shownTabOf(): { name: string; kind: string } | null { const t = this.tabs().find(x => x.shown); return t ? { name: t.name, kind: t.kind } : null; }
  /** The tile the drawer shows now (^W A brings it to the screen, its own tab too), else the last put in. */
  shownTab(): string | null { const t = this.tabs(); return (t.find(x => x.shown) ?? t.at(-1))?.name ?? null; }

  // ── the host layer, on the layout engine ──

  /** The drawer is pulled up. */
  get open(): boolean { return !!hostDock(this.layer)?.open; }
  /** How much of the rows above the status bar the drawer has when it's up (its share of the host layer's split). */
  get share(): number {
    const t = this.layer.tree;
    if (t.t !== "split") return 0.5;
    const i = t.kids.findIndex(k => k.t === "dock"), sum = t.weights.reduce((a, w) => a + w, 0) || 1;
    return Math.round(((t.weights[i] ?? 0.5) / sum) * 1000) / 1000;
  }
  /** The person is in the drawer: every key but ctrl+], alt+a, alt+A, alt+s and alt+g is the drawer's tab's. Never set by an agent. */
  get entered(): boolean { return this.keys !== HOST_SCREEN && this.open && this.mode !== "none"; }
  /** Where the screen shown lets the host layer appear: its policy's `host` (a screen without a drawer: none). */
  get mode(): HostMode { const s = this.host.screen?.(); return s?.noDrawer ? "none" : s?.hostMode?.() ?? "over"; }
  /** What the host layer's tiles are: the screen slot (it never closes or moves), the agent's terminal. */
  private facts(id: string): TileFacts {
    if (id === HOST_SCREEN) return { kind: "screen", policy: { closable: false, draggable: false } };
    return { kind: "drawer", ...(this.p?.running ? { running: this.p.run.cmd[0] ?? "the agent" } : {}) };
  }
  /** Who acts, and where the person is (the shell's one answer): in the agent, or busy on the screen. */
  private ctx(actor: Actor, rows = 30, cols = 100): LayoutCtx<string> {
    return {
      actor, area: { col: 0, row: 0, cols, rows: Math.max(1, rows - 1) }, tile: id => this.facts(id), screenHost: this.mode,
      person: { focus: this.keys, typingIn: this.entered ? HOST_TILES : null, busy: this.entered || !!this.host.person?.().busy, ...(this.host.person ? { held: actorRule({ touches: "screen" }, actor, this.host.person(), {}) } : {}) },
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
   * The drawer's own tile, made the first time it's asked for; its program starts when it's first drawn. It runs what
   * `drawerProgram()` says when it's made (the drawer's desk is given it, so it's made once).
   */
  pane(): PtyPane {
    if (this.p) return this.p;
    this.prog = this.program();
    const a = this.prog;
    // An agent starts inside the person's login shell (PtyPane: no dead tile when it exits); a shell is just the shell.
    const p = new DrawerTile({ cmd: a.cmd, cwd: a.cwd, label: a.name, agent: true, inShell: a.name !== "shell" && !a.herdr }, a.name);
    p.tileId = DRAWER_TILE_ID;
    p.place = "drawer";
    // The drawer's own program is the drawer's (drawer.json): a session's next daemon adopts it by that. One that left
    // for a screen keeps the key it started with, so each own program after it has a key of its own (`#<gen>`).
    if (this.persist) p.home = this.gen ? `drawer.json#${this.gen}` : "drawer.json";
    this.p = p;
    return p;
  }
  /** The drawer's own tile when it has been made (nothing is started by asking). */
  get tile(): PtyPane | null { return this.p; }
  /** The drawer is drawn now: pulled up, on a screen that lets the host layer appear. */
  get shown(): boolean { return this.open && this.active && this.mode !== "none"; }
  /** Drawn beside the screen (the screen shorter), not over it: the rows it takes from the screen, else 0. */
  besideRows(rows: number, cols: number): number {
    if (!this.shown || this.mode !== "beside") return 0;
    const d = placeHost(this.layer, { col: 0, row: 0, cols, rows: rows - 1 }, "beside").dock;
    return d?.rows ?? 0;
  }

  private changed() { if (this.shown) this.host.redraw(); else this.host.statusChanged(); }

  // ── what it's doing ──

  state(now = Date.now()): AgentState {
    const p = this.p;
    if (!p || (!p.running && p.exited === null)) return "off";
    if (p.exited !== null || p.agentExit !== null) return "exited";
    if (p.programTitle === WATCH_TITLE) return "watching";
    // The program said what it's doing: no guessing.
    const said = p.status.urgent();
    if (said) return said.state === "error" ? "failed" : said.state;
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
    // A drag that ended by a key (esc, f, p, a) leaves no mouse event here: the light goes out with it.
    if (this.dropHover && !tilesOf(this.host.screen?.())?.draggedTile()) this.dropHover = null;
    const s = this.state(now);
    if (s !== "off" && s !== "exited") this.pollKnows(now);
    // What it reported says it in its own words (needs you, asks you, working 40%); else the state's.
    const said = this.p?.status.urgent();
    const what = this.restarting ? "restarting" : s === "off" ? "" : said && s !== "exited" && s !== "watching" ? statusMark(said).word : s === "blocked" ? "needs you" : s === "exited" ? (this.p?.exited === null && this.p?.agentExit !== null ? `exited ${this.p.agentExit} · shell` : `exited ${this.p?.exited ?? ""}`.trim()) : s;
    const knows = this.restarting || s === "off" || s === "exited" ? "" : knowsLabel(this.knows);
    // The drawer's own name, then how many more tiles it holds (`▲ claude +2`): a drag over it says it goes in there.
    const more = this.d ? this.tabs().length - 1 : 0;
    const out = { head: `${this.open ? "▼" : "▲"} ${this.name}${more > 0 ? ` +${more}` : ""}${what ? ` · ${what}` : ""}`, knows: knows ? ` · ${knows}` : "" };
    // A drag over it says it goes in there, in the chip's own width: the chip doesn't move under the pointer.
    // (The status bar's right part is right-aligned: a longer chip grows leftwards, a shorter one is padded.)
    if (this.dropHover) { const say = `⤓ ${this.dropHover} ${DRAWER_DROP}`, w = width(out.head + out.knows); return { head: width(say) >= w ? say : pad(say, w), knows: "" }; }
    return out;
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
    // The pane's program is the login-shell wrapper (inLoginShell): the agent is the foreground process that isn't a
    // shell. Signalling the wrapper would leave the agent running with no pane.
    try { const pi = JSON.parse(info.out)?.result?.process_info; return paneAgentPid(pi); } catch { return null; }
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
   *   command runs again (a bare `claude` with --continue);
   * - in Herdr, the agent's process in its pane alone is asked to exit (the pane stays, the person's shell), and the
   *   tile's launcher runs again: it finds the session's pane left a shell and starts the agent in it, continuing.
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
        // The pane stays (the shell the agent ran in): the attach is stopped below, and the launcher starts it there again.
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
    const c = s === "working" ? C.yellow : s === "blocked" ? C.lmagenta : s === "done" ? C.lgreen : s === "exited" || s === "failed" ? C.lred : s === "watching" ? C.lcyan : C.white;
    const { head, knows } = this.chipParts(now);
    if (this.dropHover) return `${chipStyle(C.yellow, C.black)}${head}${bg(C.blue)}${fg(C.lcyan)}`;
    return `${bg(this.open ? C.cyan : C.blue)}${fg(c)}${head}${knows && this.offersRestart ? fg(C.yellow) : ""}${knows}${bg(C.blue)}${fg(C.lcyan)}`;
  }
  /** A tile dragged over the drawer (its chip, its drawer): what a release there does (the chip and the drawer light up). */
  private dropHover: string | null = null;

  // ── actions ──

  /**
   * Pull it up or put it away, by the host layer's drawer operation: the person's pull gives the drawer's tab shown their
   * keys (the module's transition), an agent's never does; put away, the keys go back to the screen slot. On a screen
   * that keeps the whole screen (host none) it's refused, with why.
   */
  set(open: boolean, actor: Actor) {
    // An agent's pull of a drawer that's up already changes nothing; the person's goes into it.
    if (open && this.open && actor.kind === "agent") return;
    if (open) this.pane();
    this.do({ op: "slide", tile: HOST_TILES, open }, actor);
    if (open && actor.kind !== "agent") { this.do({ op: "focus", tile: HOST_TILES }, actor); this.intoShown(); }
    if (open) this.openedBy = actor.kind === "agent" ? (this.entered ? null : actor) : null;
    else { this.openedBy = null; this.capture = null; this.dragging = false; }
    this.d?.shownAs(this.shown);
    this.save();
    // Pulled up by the person with no agent chosen for this session yet: the picker is offered (once a door).
    if (open && actor.kind !== "agent" && this.prog.from === "none" && !this.offered && this.persist && this.host.ctx?.()) { this.offered = true; void this.run?.("host.agent", {}); }
    this.host.redraw();
  }
  private offered = false;

  /** The person's keys go into the tab the drawer shows: a terminal there takes them (its program types), as tile.enter does. */
  private intoShown(send?: string) {
    const d = this.desk, t = this.shownTabOf();
    if (!d || !t) return;
    const p = d.pane(t.name);
    if (d.focusedName() !== t.name) d.run("tile.focus", {}, t.name);
    // A terminal not started yet starts as it's first drawn: the keys go into it then (render).
    if (p instanceof PtyPane && !p.running && p.exited === null) { this.wantIn = { send }; return; }
    this.wantIn = null;
    if (p instanceof PtyPane && p.running) d.run("tile.enter", send ? { send } : {}, t.name);
  }
  /** The person went into the drawer before its terminal started: their keys go into it once it has. */
  private wantIn: { send?: string } | null = null;

  /** Its height, by the host layer's own split (the drawer's share, the screen slot the rest), for `actor`. */
  height(share: number, actor: Actor = USER) {
    const s = clamp(share), t = this.layer.tree;
    if (t.t === "split" && t.id) this.do({ op: "shares", split: t.id, shares: t.kids.map(k => (k.t === "dock" ? s : 1 - s)) }, actor);
    this.save();
    this.host.redraw();
  }

  private save() { if (this.persist) writeState("drawer.json", { open: this.open, share: this.share, ...(this.gen ? { gen: this.gen } : {}) } satisfies DrawerSaved); }
  /** How many own programs have left the drawer for a screen: the next one's key (`home`) says it. */
  private gen = 0;

  // ── the drawer: tiles in and out, whole (tile.drawer) ──

  /**
   * Tile `name` of screen `from` into the drawer, as a tab: the layout's `take` there, then its `open` here, both asked
   * first so nothing moves unless both may. The same instance: its program runs on, its note and history stay. The
   * person's drawer pulls the drawer up on it (their keys with it when they had them); an agent's adds the tab behind
   * the one shown and leaves the drawer and the keys as they are.
   */
  put(from: Desk, name: string, actor: Actor, keys = false): TileDone {
    const d = this.desk;
    if (!d) throw new ActionRefused("the drawer isn't ready (no screen is shown yet)");
    if (from === d) throw new ActionRefused(`${name} is in the drawer already`);
    this.dropHover = null;
    const kind = (from.pane(name) as { kind?: string } | undefined)?.kind ?? "tile";
    const out = from.takeRefusal(name, actor);
    if (out) throw new ActionRefused(out);
    const spec = { name, spec: { t: "leaf" as const, kind } };
    const into = d.bringRefusal(spec, undefined, "tabs", actor);
    if (into) throw new ActionRefused(`the drawer doesn't take ${name}: ${into}`);
    const moved = from.takeOut(name, actor);
    const done = this.bring(d, moved, undefined, "tabs", actor, a => from.bringIn(moved, undefined, undefined, a));
    if (actor.kind !== "agent") {
      // Shown on its tab, the drawer up; the keys come along only when they were in it.
      d.run("tab.select", {}, done.tile);
      if (!this.open && this.mode !== "none") this.do({ op: "slide", tile: HOST_TILES, open: true }, actor);
      if ((moved.typing || keys) && this.open) { this.do({ op: "focus", tile: HOST_TILES }, actor); this.intoShown(); }
      this.save();
    }
    this.d?.shownAs(this.shown);
    this.host.redraw();
    return { ...done, inDrawer: true, from: moved.from };
  }

  /**
   * Tile `name` in the drawer back into the screen shown, beside `to` (`where`), the same way round: asked there and here
   * first, then moved. The drawer's own tab stays (its policy). The person's keys go with it when they were in it.
   */
  take(name: string, to: string | undefined, where: Where | undefined, actor: Actor): TileDone {
    const d = this.desk, shown = this.host.screen?.();
    if (!d) throw new ActionRefused("the drawer isn't ready");
    const screen = tilesOf(shown);
    if (!screen || screen === d) throw new ActionRefused(`the ${shown?.title ?? "screen"} has no tiles to put ${name} among · open one with tiles (D the desk, K the board, R the river), then tile.drawer on=false tile=${name}`);
    // The drawer's own tab leaves as an ordinary terminal tile named for what runs in it, and a new own tab takes its place.
    const old = this.p instanceof DrawerTile && d.pane(name) === this.p ? this.p : null;
    const as = old ? freeName(screen, old.shows) : name;
    const out = d.takeRefusal(name, actor, !!old);
    if (out) throw new ActionRefused(out);
    const kind = old ? "pty" : (d.pane(name) as { kind?: string } | undefined)?.kind ?? "tile";
    const into = screen.bringRefusal({ name: as, spec: { t: "leaf", kind } }, to, where, actor);
    if (into) throw new ActionRefused(`the ${screen.title} doesn't take ${as} there: ${into}`);
    const wasIn = this.entered;
    let moved: MovedTile;
    if (old) {
      // The next own program is a new one, kept under a key of its own (the one leaving keeps the key it started with).
      this.gen++; this.p = null;
      const heir = this.pane();
      const out = d.takeOut(name, actor, heir);
      old.release();
      moved = { ...out, name: as, spec: { ...out.spec, kind: "pty", name: as } };
      this.save();
    } else moved = d.takeOut(name, actor);
    const done = this.bring(screen, moved, to, where, actor, a => d.bringIn(moved, undefined, "tabs", a));
    // The person's keys were in it in the drawer: they go with it, back on the screen.
    if (wasIn && actor.kind !== "agent") { this.do({ op: "focus", tile: HOST_SCREEN }, actor); screen.focusTile(done.tile, actor); }
    // The person took the drawer's own program out: the drawer goes away, and its new one starts when it comes up again.
    if (old && actor.kind !== "agent" && this.open) this.set(false, actor);
    this.host.redraw();
    return { ...done, inDrawer: false, into: screen.title, ...(old ? { fresh: true } : {}) };
  }

  /** `bringIn`, and if it's refused after all (a race), the tile goes back where it came from, for the same actor: never lost. */
  private bring(to: Desk, moved: MovedTile, at: string | undefined, where: Where | undefined, actor: Actor, back: (actor: Actor) => unknown): TileDone {
    try { return to.bringIn(moved, at, where, actor); }
    catch (e) { try { back(actor); } catch { /* nowhere: it's ended below */ } throw e; }
  }

  /**
   * Tiles still running on a screen that goes for good: into the drawer, behind the tab shown, nobody's keys moved,
   * each under a name free there; said once. The panes it took (one it couldn't ends with the screen).
   */
  /** Why tiles like these couldn't go into the drawer now (its layout locked, say), or null: leaving a screen asks first. */
  keepRefusal(moved: Pick<MovedTile, "name" | "spec">[]): string | null {
    const d = this.desk;
    if (!d) return null;
    for (const m of moved) { const why = d.bringRefusal({ ...m, name: freeName(d, m.name) }, undefined, "tabs", { kind: "agent", id: "door" }); if (why) return `${m.name} couldn't go into your drawer: ${why}`; }
    return null;
  }
  keep(moved: MovedTile[]): Pane[] {
    const d = this.desk;
    if (!d) return [];
    const took: string[] = [], panes: Pane[] = [];
    for (const m of moved) {
      const as = freeName(d, m.name);
      try { d.bringIn({ ...m, name: as }, undefined, "tabs", { kind: "agent", id: "door" }); took.push(as); panes.push(m.pane); } catch { /* ends with the screen */ }
    }
    if (took.length) this.host.flash(`${took.join(", ")} went into your drawer · alt+a shows ${took.length === 1 ? "it" : "them"}`, 8000);
    if (took.length) this.host.redraw();
    return panes;
  }

  /**
   * An agent's `act` naming a tile the screen shown doesn't have but the drawer does: the drawer's desk answers it
   * (tile.type into a terminal in the drawer, a note action in a reader in the drawer, tile.drawer on=false).
   */
  routes(req: ActRequest, top: Screen | undefined): boolean {
    if (!req.tile || req.tile === "focused" || req.tile === DRAWER_TILE_ID && req.action === "tile.herdr") return false;
    const d = this.d, here = top?.dispatch?.tile?.(req.tile) ?? null, inDrawer = d?.dispatch.tile(req.tile) ?? null;
    // One name on the screen shown and in the drawer: never a guess (typing into the wrong terminal); the ids tell them apart.
    if (here && inDrawer && here.name === req.tile && inDrawer.name === req.tile && d!.dispatch.takes(req)) throw new ActionRefused(`${req.tile} names a tile here${here.id ? ` (${here.id})` : ""} and one in the drawer${inDrawer.id ? ` (${inDrawer.id})` : ""} · name it by id: tile=${inDrawer.id ?? inDrawer.name} for the drawer's`);
    if (here) return false;
    // By its name or id only: a number (`tile=1`) or a block is a place on the screen shown, never a drawer tab's.
    return !!d && !!inDrawer && (inDrawer.name === req.tile || inDrawer.id === req.tile) && d.dispatch.takes(req);
  }

  describe() {
    const p = this.p;
    return {
      open: this.open, shown: this.shown, entered: this.entered, share: Math.round(this.share * 100) / 100, host: this.mode,
      rect: this.shown ? this.rect : null, state: this.state(), tile: { id: DRAWER_TILE_ID, name: this.name },
      runs: { cmd: this.prog.cmd, cwd: this.prog.cwd, why: { program: this.prog.programWhy, folder: this.prog.folderWhy } },
      tiles: this.tabs(),
      knows: this.knows ? { ...this.knows, pid: this.knowsPid } : null, ...(this.restarting ? { restarting: true } : {}),
      ...(this.openedBy?.kind === "agent" ? { openedBy: this.openedBy.id } : {}),
      ...(p?.herdr ? { herdr: p.herdr } : {}),
      terminal: p ? p.describe() : null,
    };
  }

  /** Quitting the door would end what runs in the drawer (not in Herdr): said, and asked twice. */
  leaveWarning(): string | null {
    const p = this.p;
    if (p?.running && !p.herdr) return `${p.title()} is running in the drawer · quitting ends it · again within 3s quits`;
    const inDrawer = this.d ? this.tabs().filter(t => t.name !== DRAWER_TILE_ID).map(t => this.d!.pane(t.name)).filter((x): x is PtyPane => x instanceof PtyPane && x.running) : [];
    return inDrawer.length ? `${inDrawer.map(x => x.title()).join(", ")} ${inDrawer.length === 1 ? "runs" : "run"} in the drawer · quitting ends ${inDrawer.length === 1 ? "it" : "them"} · again within 3s quits` : null;
  }

  // ── drawing ──

  /**
   * The drawer's rows over (or beside) a screen `rows` tall (the last row is the status bar): the host layer placed
   * by the layout engine, as the screen shown lets it appear. At least its bar, a tile's frame and a row of it.
   */
  place(cols: number, rows: number): Rect {
    this.rows = rows; this.cols = cols;
    const room = rows - 1;
    const d = placeHost(this.layer, { col: 0, row: 0, cols, rows: room }, this.mode === "none" ? "over" : this.mode).dock;
    return d ?? { col: 0, row: room, cols, rows: 0 };
  }

  /**
   * The drawer, full width, laid over the screen's bottom rows: its bar (what's in it, who pulled it up, the edge to
   * drag), the drawer's desk (its tiles, the tab shown, tabs in its header when it holds more than one), and its keys.
   */
  render(cols: number, rows: number, screen: string): { rect: Rect; lines: string[]; placements: Placement[] } {
    const r = this.place(cols, rows);
    this.rect = r;
    const canvas = new Canvas(cols, r.rows);
    canvas.clear({ col: 0, row: 0, cols, rows: r.rows }, bg(C.black));
    const p = this.pane();
    const by = this.openedBy ? ` · ${fg(C.lmagenta)}pulled up by ${agentLabel(this.openedBy)}${fg(C.yellow)}` : "";
    const watching = this.state() === "watching";
    const where = watching ? ` · ${fg(C.lcyan)}another door has it${fg(C.yellow)}` : p.herdr ? ` · in Herdr (${p.herdr.pane})` : "";
    const edge = this.dropHover ? C.yellow : this.entered ? C.yellow : C.brown;
    const title = this.dropHover ? `${chipStyle(C.yellow, C.black)} ⤓ release: ${this.dropHover} ${DRAWER_DROP} ${bg(C.black)}` : `${fg(this.entered ? C.yellow : C.white)}${this.chipText()}${fg(C.yellow)}${where}${by} ${fg(C.dark)}· ↕ drag this edge · ⤓ drop a tile here`;
    canvas.text(0, 0, `${fg(edge)}${"═".repeat(2)} ${title} ${fg(edge)}${"═".repeat(Math.max(0, cols))}${RESET}`, cols);
    let placements: Placement[] = [];
    const d = this.desk;
    if (d && r.rows >= 4) {
      d.shownAs(true);
      // The desk draws its tiles in the rows between the bar and the drawer's own key row (its hint row isn't drawn:
      // the frame's own hint and the drawer's row say the keys).
      // The App's own context, its terminal the drawer's size (cell size and graphics as they are).
      const ctx = this.host.ctx?.();
      const sized = ctx ? new Proxy(ctx, { get: (o, k) => (k === "t" ? { ...o.t, cols, rows: r.rows } : typeof (o as any)[k] === "function" ? (o as any)[k].bind(o) : (o as any)[k]) }) : ({ t: { cols, rows: r.rows, cellW: 9, cellH: 16, kitty: false } } as unknown as Ctx);
      const frame = d.render(sized);
      frame.lines.slice(0, r.rows - 2).forEach((l, i) => canvas.text(0, 1 + i, l, cols));
      // Drawn, a terminal the person went into has started: their keys go into it now.
      if (this.wantIn && this.entered) { const w = this.wantIn; queueMicrotask(() => { if (this.wantIn === w) this.intoShown(w.send); }); }
      placements = (frame.placements ?? []).filter(pl => pl.row + pl.rows <= r.rows - 2).map(pl => ({ ...pl, row: pl.row + r.row + 1 }));
    }
    const name = this.shownTabOf()?.name ?? this.name;
    const hint = watching
      ? `${fg(C.lcyan)}${this.entered ? "⏎ takes it over from the other door · q stops watching" : "click in it, then ⏎ takes it over from the other door"} · ${this.entered ? ESCAPE_CHORD : "alt+a"} ${this.entered ? `back to the ${screen}` : "puts it away"}`
      : this.entered && d?.overlaid()
      ? `${fg(C.yellow)}the picker has the keys · ↑↓ ⏎ chooses · esc leaves it as it is`
      : this.entered && d?.waitsOnExit()
      ? `${fg(C.yellow)}${d.exitedSay(name, name === DRAWER_TILE_ID ? this.name : name, `the ${screen}`)} · alt+a puts it away`
      : this.entered && d?.rawKeys()
      ? `${fg(C.yellow)}every key goes to ${name === DRAWER_TILE_ID ? this.name : name} · ${ESCAPE_CHORD} back to the ${screen} · alt+s new shell · alt+g agent · alt+a puts it away`
      : this.entered
      ? `${fg(C.yellow)}in the drawer, on ${name === DRAWER_TILE_ID ? this.name : name}${d?.pane(name) instanceof PtyPane ? " · ⏎ types in it" : ""} · ^W a takes it out · ^W ] [ other tabs · Esc or ${ESCAPE_CHORD} back to the ${screen} · alt+a puts it away`
      : `${fg(C.dark)}click in it or ${ESCAPE_CHORD} to type · alt+s new shell · alt+g agent · alt+a or Esc puts it away · alt+A height · ^W a puts a tile in, ^W A brings a tab here`;
    canvas.text(1, r.rows - 1, hint + RESET, cols - 2);
    return { rect: r, lines: canvas.lines(), placements };
  }

  // ── keys and the mouse (App.key gives them here first) ──

  /** Raw input while the person is in the drawer and a terminal there runs: every byte is its, but alt+a, alt+A, alt+s and alt+g. */
  rawInput(run: DrawerRun): ((bytes: string) => void) | null {
    if (!this.shown || !this.entered) return null;
    const raw = this.d?.rawInput();
    if (!raw) return null;
    return (s: string) => {
      // As legacy ESC-and-a-letter or as a Kitty keyboard report (src/kbd.ts).
      const k = rawKey(s);
      if (k?.kind === "alt" && k.ch === "a") return run("host.toggle", { open: false });
      if (k?.kind === "alt" && k.ch === "A") return run("host.size", { share: nextStep(this.share) });
      // The drawer's own keys, as everywhere in it: a new shell, its agent's picker.
      if (k?.kind === "alt" && k.ch === "s") return run("host.shell", {});
      if (k?.kind === "alt" && k.ch === "g") return run("host.agent", {});
      raw(s);
    };
  }

  /** A key or a mouse event, before the screen: true when the drawer took it. `screen` is the one under it. */
  key(k: Key, screen: Screen | undefined, rows: number, run: DrawerRun): boolean {
    if (!this.active) return false;
    if (k.kind === "mouse") return this.mouse(k, screen, rows, run);
    if (this.shown && this.entered) {
      if (isEscapeChord(k)) { run("host.leave", {}); return true; }
      if (isAlt(k, "a")) { run("host.toggle", { open: false }); return true; }
      if (isAlt(k, "A")) { run("host.size", { share: nextStep(this.share) }); return true; }
      if (isAlt(k, "s")) { run("host.shell", {}); return true; }
      if (isAlt(k, "g")) { run("host.agent", {}); return true; }
      const d = this.desk;
      if (!d) return true;
      // Esc and q step back out of the drawer (to the screen) where its tab isn't using them; never the screen's back.
      // A terminal there that exited isn't using them either.
      if ((k.kind === "esc" || (k.kind === "char" && !k.ctrl && k.ch === "q")) && (!d.holdsKeys() || d.waitsOnExit()) && !d.draggedTile()) { run("host.leave", { quiet: true }); return true; }
      const ctx = this.host.ctx?.();
      if (ctx) d.key(k, ctx);
      return true;
    }
    if (isAlt(k, "a")) { run("host.toggle", {}); return true; }
    if (isAlt(k, "R")) { run("agent.restart", {}); return true; }
    // alt+s: a new shell in the drawer, here; alt+g: choose the drawer's agent (its picker). On every screen, as alt+a.
    if (isAlt(k, "s")) { run("host.shell", {}); return true; }
    if (isAlt(k, "g")) { run("host.agent", {}); return true; }
    if (this.shown && isEscapeChord(k)) return this.chordBack(screen, run);
    if (this.shown && isAlt(k, "A")) { run("host.size", { share: nextStep(this.share) }); return true; }
    // Esc puts it away when the screen isn't using it (an edit, a filter, a terminal the person is in).
    if (this.shown && k.kind === "esc" && !screen?.holdsKeys?.() && !screen?.rawKeys?.()) { run("host.toggle", { open: false }); return true; }
    return false;
  }

  /**
   * ctrl+] with the drawer up and the person out of it: back in (the keyboard's way, as a click is), or, right
   * after leaving it with ctrl+], back in with a ctrl+] sent to the terminal there. A screen's own ctrl+] comes
   * first: in its terminal tile it leaves the tile, and its second right after goes to that tile's program.
   */
  private chordBack(screen: Screen | undefined, run: DrawerRun): boolean {
    const now = Date.now();
    if (now - this.leftAt < CHORD_MS) { run("host.enter", { send: "\x1d" }); return true; }
    if (screen?.rawKeys?.() || now - this.passedAt < CHORD_MS) { this.passedAt = now; return false; }
    run("host.enter", {});
    return true;
  }

  /**
   * The person goes into the drawer (ctrl+], a click in it): their keys are the tab shown's. A terminal that exited
   * waits for ⏎ (`restart`): going in only says so.
   */
  enter(send?: string, restart = false): { entered: boolean; restarted?: boolean } {
    if (!this.shown) throw new ActionRefused("the drawer is put away · alt+a pulls it up");
    this.leftAt = 0; this.openedBy = null;
    this.do({ op: "focus", tile: HOST_TILES }, USER);
    const d = this.desk, t = this.shownTabOf(), q = t && d ? d.pane(t.name) : undefined;
    if (q instanceof PtyPane && !q.running && q.exited !== null) {
      if (restart) { d!.run("tile.restart", {}, t!.name); this.host.redraw(); return { entered: true, restarted: true }; }
      this.host.flash(d!.exitedSay(t!.name, t!.name === DRAWER_TILE_ID ? this.name : t!.name));
      d!.run("tile.focus", {}, t!.name);
      this.host.redraw();
      return { entered: true };
    }
    this.intoShown(send);
    if (send && q instanceof PtyPane && q.running) this.host.flash(`sent ${ESCAPE_CHORD} to ${t!.name === DRAWER_TILE_ID ? this.name : t!.name}`);
    this.host.redraw();
    return { entered: true };
  }

  /** The person's keys go back to the screen (ctrl+], a click above the drawer); the drawer stays up. */
  leave(screen: Screen | undefined, said = true): { entered: boolean } {
    if (!this.entered) throw new ActionRefused("the person isn't in the drawer");
    // Back to the screen slot: the screen's own focus is as they left it. A terminal there stops taking keys.
    this.do({ op: "focus", tile: HOST_SCREEN }, USER);
    this.d?.stopTyping();
    this.wantIn = null;
    this.leftAt = Date.now();
    if (said) this.host.flash(`back to the ${screen?.title ?? "screen"} · ${ESCAPE_CHORD} or a click goes back in (${ESCAPE_CHORD} again now sends it to ${this.name}) · Esc or alt+a puts it away`);
    this.host.redraw();
    return { entered: false };
  }

  /** The drawer's desk's rows on the terminal: the drawer's, below its bar. */
  private deskRow(): number { return (this.rect?.row ?? 0) + 1; }

  private mouse(k: Extract<Key, { kind: "mouse" }>, shown: Screen | undefined, rows: number, run: DrawerRun): boolean {
    const screen = tilesOf(shown);
    if (this.dragging) {
      // Dragged past the ends (onto the status row, or the top): as far as it goes, not a refusal.
      if (k.action === "drag") { const room = rows - 1; run("host.size", { share: clamp((room - Math.max(1, k.y)) / room) }); }
      if (k.action === "up") this.dragging = false;
      return true;
    }
    const r = this.shown ? this.rect : null;
    const chip = this.chipAt;
    const onChip = !!chip && k.y === chip.row && k.x >= chip.from && k.x < chip.to;
    const inDrawer = !!r && k.y >= r.row && k.y < r.row + r.rows;
    // A screen's tile dragged by its title over the drawer (the chip, the drawer): it lights up; released, it goes in.
    const dragged = screen && screen !== this.d ? screen.draggedTile() : null;
    // No drag any more (let go elsewhere, esc, a key that acted on it): the chip and the drawer stop lighting up.
    if (!dragged && this.dropHover) { this.dropHover = null; this.host.redraw(); }
    if (dragged) {
      const over = onChip || inDrawer;
      const hover = over ? dragged : null;
      if (hover !== this.dropHover) { this.dropHover = hover; screen!.drawerHover(hover ? `⤓ ${DRAWER_DROP}` : null); this.host.redraw(); }
      if (!over) return false;
      if (k.action === "up") {
        this.dropHover = null;
        screen!.cancelDrag();
        void screen!.perform("tile.drawer", { on: true }, USER, dragged);
      }
      return true;
    }
    // A tab of the drawer dragged by its title out of the drawer, over the screen: where it would land there, by the
    // screen's own drop zones; released there, it's taken out into that place.
    const out = this.d?.draggedTile() ?? null;
    if (out && r && k.y < r.row && (k.action === "drag" || k.action === "up")) {
      if (k.action === "up") this.capture = null;
      const kind = this.tabs().find(t => t.name === out)?.kind ?? "tile";
      const target = screen ? screen.foreignAt(k.x, k.y, { name: out, kind }) : null;
      if (k.action === "up") {
        this.d!.cancelDrag();
        screen?.cancelDrag();
        if (!target) this.host.flash(`not moved: ${out} stays in the drawer · drop it on a tile's side, its header or centre, or the screen's edge`);
        else if (target.refused) this.host.flash(`not moved: ${target.refused}`);
        else this.takeRun(out, target.to, target.where);
      }
      return true;
    }
    if (out && r && k.y >= r.row) screen?.cancelDrag();
    if (this.capture) {
      // A press in the drawer keeps the mouse until the button comes up (a terminal's drag, a tab dragged).
      if (k.action === "drag" || k.action === "up") this.d?.key({ ...k, y: k.y - this.deskRow() }, this.host.ctx!()!);
      if (k.action === "up") this.capture = null;
      return true;
    }
    if (onChip) {
      // ⟳, the chip's last cell when it offers one, restarts the agent; anywhere else on the chip toggles the drawer.
      if (k.action === "down") run(this.offersRestart && k.x >= chip!.to - 1 ? "agent.restart" : "host.toggle", {});
      return true;
    }
    if (!r) return false;
    if (!inDrawer) {
      // A click on the screen above hands the keys back to it; the drawer stays up.
      if (k.action === "down" && this.entered) run("host.leave", { quiet: true });
      return false;
    }
    if (k.action === "down" && k.y === r.row) { this.dragging = true; return true; }
    if (k.y === r.row + r.rows - 1 && k.action === "down") return true;      // the drawer's key row
    const ctx = this.host.ctx?.(), d = this.desk;
    if (!ctx || !d) return true;
    if (k.action === "down") {
      if (!this.entered) { this.do({ op: "focus", tile: HOST_TILES }, USER); this.leftAt = 0; this.openedBy = null; }
      this.capture = r;
    }
    d.key({ ...k, y: k.y - this.deskRow() }, ctx);
    this.host.redraw();
    return true;
  }

  /** A tab dragged out and dropped on the screen: taken out there, as the person. */
  private takeRun(name: string, to: string | undefined, where: Where) {
    const d = this.d;
    if (d) void d.perform("tile.drawer", { on: false, ...(to ? { to } : {}), where }, USER, name);
  }
}

/** The screen's own tiles: the screen when it's a desk, or a desk inside it (the showcase's section), else none. */
function tilesOf(shown: Screen | undefined): Desk | null { return shown instanceof Desk ? shown : shown?.tilesHere?.() ?? null; }

/** `base`, or `base2`, `base3` …: the first name no tile on `screen` has. */
function freeName(screen: Desk, base: string): string {
  let n = base;
  for (let i = 2; screen.pane(n); i++) n = `${base}${i}`;
  return n;
}

/** alt+A: the next height step after `share` (past the last, the first). */
export function nextStep(share: number): number {
  return HEIGHT_STEPS.find(s => s > share + 0.01) ?? HEIGHT_STEPS[0];
}

/** How the drawer's keys and clicks run its actions: as the person, a refusal said on the status bar. */
export type DrawerRun = (name: "host.toggle" | "host.size" | "agent.restart" | "host.enter" | "host.leave" | "host.shell" | "host.agent", args: Record<string, unknown>) => void;

/** What `agent.restart` answers once the agent runs again. */
export interface RestartDone { restarted: boolean; herdr?: string; was: AgentKnows["state"] | null }

function defaultHerdr(): HerdrRun | null {
  const bin = herdrBin();
  return bin ? herdrRunner(bin, 2000) : null;
}

export interface DrawerOn { drawer: AgentDrawer; ctx: Ctx; here: Screen | undefined }

/** The drawer's actions: on every screen, as the shell's are. */
export const DRAWER_ACTIONS = actionSet<DrawerOn>()("drawer", {
  "host.enter": def({
    summary: "go into the drawer: the person's keys go to the tab it shows (its own program first) until ctrl+]; restart=true runs one that exited again (⏎ on it). The person's only: an agent's would take their keys",
    keys: "ctrl+], click in the drawer, ⏎ on an exited agent; ctrl+] then ctrl+] sends ctrl+] to it",
    touches: "screen", replay: "safe",
    person: "going into the drawer takes the person's keys; an agent pulls it up with host.toggle and leaves their keys where they are",
    args: { send: { type: "string", optional: true, about: "bytes to give the agent first (a literal ctrl+])" }, restart: { type: "boolean", optional: true, about: "run an agent that exited again, as ⏎ on it does" } },
    run({ send, restart }, { drawer }) { return drawer.enter(send, restart); },
  }),
  "host.leave": def({
    summary: "the person's keys go back to the screen from the drawer; the drawer stays up. The person's only",
    keys: "ctrl+], esc or q in the drawer (where its tab isn't using them), a click on the screen above the drawer",
    touches: "screen", replay: "safe",
    person: "the person's keys are theirs: an agent doesn't take them out of the drawer",
    args: { quiet: { type: "boolean", optional: true, about: "say nothing on the status bar (a click away)" } },
    run({ quiet }, { drawer, here }) { return drawer.leave(here, !quiet); },
  }),
  "host.toggle": def({
    summary: "pull the drawer (the host layer's drawer; its own program the first tab) up over or beside the screen, as the screen lets it (its policy's host), or put it away (open=true/false; neither toggles). The person's pull gives it their keys; an agent's never does, waits until they're idle, and is said on screen. Refused on a screen that keeps the whole screen (host none)",
    keys: "alt+a, a click on the ▲ claude chip in the status bar; Esc (or ctrl+] then Esc) puts it away",
    touches: "screen", replay: "safe",
    says: out => ({ text: `· ${out.open ? "pulled up" : "put away"} the drawer`, ms: 6000 }),
    args: { open: { type: "boolean", optional: true, about: "true pulls it up, false puts it away; left out, it toggles" } },
    run({ open }, { drawer }, actor) {
      const want = open ?? !drawer.open;
      if (want !== drawer.open || want) drawer.set(want, actor);
      return { open: drawer.open, entered: drawer.entered, share: drawer.share, state: drawer.state() };
    },
  }),
  "host.shell": def({
    summary: "a new shell in the drawer (the person's $SHELL, in the drawer's folder), as a tab shown: the person's goes into it; an agent's opens it behind the tab shown, their keys where they were",
    keys: "alt+s (on every screen, and in the drawer)",
    touches: "shape", replay: "ask",
    says: (out: { tile?: string }) => `· opened a shell in the drawer (${out.tile ?? "shell"})`,
    args: {},
    run(_, { drawer }, actor) { return drawer.newShell(actor); },
  }),
  "host.waiting": def({
    summary: "the waiting-on-you list as a tab in the drawer: what the programs in terminal tiles say waits on the person (blocked on a permission, a question or a login; failed; done and not yet seen), from their program status (OSC 7501), across the screen's terminals and the drawer's. The person's pulls the drawer up and goes to it; an agent's opens it behind the tab shown (status.list reads the same rows)",
    keys: "alt+w (on every screen, and in the drawer), a click on the status bar's waiting count",
    touches: "shape", replay: "ask",
    says: (out: { tile?: string }) => `· opened the waiting-on-you list in the drawer (${out.tile ?? "waiting-you"})`,
    args: {},
    run(_, { drawer }, actor) { return drawer.waiting(actor); },
  }),
  "changes.open": def({
    summary: "the what-changed list as a tab in the drawer: the notes others (agents, other clients, extensions when asked for) changed since the person last looked, newest first, with who, when and what, from the service's change feed. The person's pulls the drawer up and goes to it, and looking marks what it holds seen (the status bar's +N new goes to 0, kept per outline); an agent's opens it behind the tab shown and never marks anything seen (changes.list reads the same rows). Rows: changes.pick, changes.go (⏎, alt+⏎ in a new detail), changes.diff, changes.seen",
    keys: "alt+o (on every screen), a click on the status bar's +N new",
    touches: "shape", replay: "ask",
    says: (out: { tile?: string }) => `· opened what changed in the drawer (${out.tile ?? "what-changed"})`,
    args: {},
    run(_, { drawer }, actor) { return drawer.changes(actor); },
  }),
  "changes.list": def({
    summary: "what changed since the person last looked, read: each note others changed (id, title, who, kind, when, seen, revision), newest first, from the service's change feed. Changes nothing, and never marks anything seen",
    keys: "the status bar's +N new, the drawer's what-changed tab",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { drawer }) { return drawer.changesRead(); },
  }),
  "status.list": def({
    summary: "what waits on the person, read: each terminal tile's program status rows that ask something of them (blocked, failed, done unseen), most urgent first, with the tile, the record (state, kind, progress, app, title, msg) and since when. `peek` gives every terminal's records too (terminal.status)",
    keys: "the status bar's waiting count, the drawer's waiting-on-you tab",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { drawer }) { return { waiting: waitingOnYou(drawer).map((r, i) => rowFacts(r, i + 1)) }; },
  }),
  "host.agent": def({
    summary: "the drawer's own agent (its first tab): name=<agent> chooses one installed here (claude, codex, pi, … or shell; herdr=true runs it in Herdr, where it outlives the door), saved for this outline's session (default=true: for every outline). It starts inside the person's login shell, from the drawer's own tab's next start: one running keeps running (agent.restart starts the new one in its place). No name: the person's picker of the agents installed here. EP0CH_DAILY_AGENT, when set, still overrides it",
    keys: "alt+g (the picker; on every screen, and in the drawer), ⏎ in it; alt+a or a click on the chip offers it once a door, when no agent is chosen yet",
    touches: "screen", replay: "ask",
    says: (out: { agent?: string }) => (out.agent ? `· chose ${out.agent} for the drawer` : null),
    args: { name: { type: "string", optional: true, about: "the agent: claude, codex, pi, … or shell (host.agent with no name lists them on screen)" }, herdr: { type: "boolean", optional: true, about: "run it in this session's own Herdr pane (it outlives the door)" }, default: { type: "boolean", optional: true, about: "the default for every outline's session, not only this one" } },
    run({ name, herdr, default: dflt }, { drawer }, actor) {
      if (!name) {
        if (actor.kind === "agent") return { agents: drawer.agents().map(a => ({ name: a.name, cmd: a.cmd, ...(a.herdr ? { herdr: true } : {}) })), now: drawer.runs.name, from: drawer.runs.from };
        return drawer.pick();
      }
      return drawer.choose(name, !!herdr, !!dflt, actor);
    },
  }),
  "host.size": def({
    summary: "how much of the screen the drawer covers, as a share of the rows above the status bar (0.2 to 0.9); over a screen, the screen under it doesn't move; beside one, the screen is drawn shorter",
    keys: "drag the drawer's top edge; alt+A steps 40%, 50%, 60%, 75%",
    touches: "tile", while: "typing", replay: "safe", way: "an agent doesn't resize it under them",
    args: { share: { type: "number", about: "0.2 to 0.9 (0.5: half the screen)" } },
    run({ share }, { drawer }, actor) {
      if (!(share > 0 && share <= 1)) throw new ActionRefused(`share is a fraction of the screen, 0.2 to 0.9, not ${share}`);
      drawer.height(share, actor);
      return { share: drawer.share, open: drawer.open };
    },
  }),
  "agent.restart": def({
    summary: "restart the drawer's own program (▲ claude, its first tab) so it starts with the door's environment (EP0CH_CONTROL, EP0CH_NEST …) and the installed Claude mod: that agent alone is asked to exit (SIGTERM, SIGKILL after 8s) and the same command runs again, keeping the conversation (a bare claude gets --continue on this restart). In Herdr it comes back in the session's own pane. An agent's restart is refused while the person types in it, and is said on screen",
    keys: `a click on ${RESTART_GLYPH} at the end of the ▲ claude chip (shown when it started without the door's variables, or without door tools); alt+R`,
    touches: "tile", while: "typing", replay: "ask", way: "an agent doesn't restart it under them",
    says: (out: { name?: string }) => ({ text: `· restarted ${out?.name ?? "the drawer's program"}`, ms: 6000 }),
    args: {},
    async run(_, { drawer, ctx }, actor) {
      const p = drawer.tile;
      // The agent's own window: the person who typed into it lately may be about to again.
      const idle = Date.now() - (p?.personKeyAt ?? 0);
      if (actor.kind === "agent" && p && idle < RESTART_IDLE_MS) throw new ActionRefused(`the person typed into the agent ${(idle / 1000).toFixed(1)}s ago; try again once they've left it ${RESTART_IDLE_MS / 1000}s`);
      ctx.flash(`restarting ${drawer.name}${p?.herdr ? ` in Herdr (${p.herdr.pane})` : ""} · the conversation is kept`, 6000);
      return drawer.restart().then(r => ({ ...r, name: drawer.name }));
    },
  }),
  "agent.type": def({
    summary: "send the drawer's own program (▲ claude, its first tab) text as typed: \\n is ⏎, \\e Esc. It lives in the host layer, never as a tile on a screen, so this is how another agent types to it (tile.type types into a screen's terminal tile). Refused while the person is typing in it, and while it isn't running",
    keys: "the person types in the drawer (ctrl+], a click in it)",
    touches: "tile", while: "typing", replay: "ask", way: "an agent doesn't type there",
    says: (out: { tile?: string }) => `· typed to ${out?.tile ?? "the drawer"}`,
    args: { text: { type: "string", about: "what to type (\\n ⏎, \\e Esc)" } },
    run({ text }, { drawer }) {
      const p = drawer.tile;
      if (!p?.running) throw new ActionRefused(`${drawer.name} isn't running · alt+a pulls it up and starts it`);
      p.input(text.replace(/\\n/g, "\r").replace(/\\e/g, "\x1b"));
      return { tile: drawer.name, chars: text.length };
    },
  }),
  "agent.knows": def({
    summary: "what the drawer's own agent (▲ claude) knows: read now from its own process (its environment and start time) against the installed Outliner Claude mod. state current (door tools; a changed mod reloads into it live), stale (started by an older door, without its variables), no-door (no EP0CH_CONTROL) or unknown",
    keys: "the ▲ claude chip says it: · door tools, · started before update ⟳",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { drawer }) { return { knows: await drawer.readKnows(), pid: drawer.knowsPid }; },
  }),
});

/** The host layer's agent as the actor rule sees it: the tile an agent's typing, resizing or restarting would be under. */
export const HOST_AGENT_TILE: TileRef = { name: HOST_AGENT, kind: "pty", label: "the drawer's own terminal" };

/**
 * `tile.herdr` for the host layer's agent (`tile=drawer.agent`): the same rule as a desk terminal's (PTY_ACTIONS), said by
 * the Herdr launcher as it attaches, on whatever screen is shown.
 */
export const HOST_TILE_ACTIONS = actionSet<{ drawer: AgentDrawer }>()("host", {
  "tile.herdr": def({
    summary: "the drawer's own program (tile=drawer.agent) lives in Herdr pane pane=<label> (on=false: it no longer does): quitting the door then ends only the attach",
    touches: "nothing", replay: "ask",
    args: { pane: { type: "string", optional: true, about: "the Herdr pane's label (door-<outline>)" }, name: { type: "string", optional: true, about: "the agent's name in Herdr (door; a test door's door-<hash>)" }, on: { type: "boolean", optional: true, about: "false: it no longer shows a Herdr agent" } },
    run({ pane, name, on }, { drawer }) {
      const p = drawer.tile;
      if (!p) throw new ActionRefused("your drawer's own program hasn't started");
      if (on === false) { p.herdr = null; return { tile: DRAWER_TILE_ID, herdr: null }; }
      if (!pane) throw new ActionRefused("tile.herdr needs pane=<the Herdr pane's label>");
      if (!p.running) throw new ActionRefused("your drawer's own program isn't running");
      p.herdr = { pane, ...(name ? { name } : {}) };
      return { tile: DRAWER_TILE_ID, herdr: p.herdr };
    },
  }),
});

/** The drawer laid over a screen's lines: its rows replace the screen's (a full-width drawer, nothing reflows). */
export function overlay(lines: string[], drawer: { rect: Rect; lines: string[] }): string[] {
  const out = [...lines];
  drawer.lines.forEach((l, i) => { out[drawer.rect.row + i] = l + RESET; });
  return out;
}
