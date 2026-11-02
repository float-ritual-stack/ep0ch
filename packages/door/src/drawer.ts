import type { Reveal } from "./reveal";
// One host desk: its tree occupies the drawer, its floats the glass. Both change through apply.
// Quiet focus enters a glass tile without opening or rearranging the drawer.
import type { Ctx, Screen, Frame } from "./app";
import { Canvas, type Rect } from "./canvas";
import { DRAWER_TILE_ID, judgeAgent, knowsLabel, modDirs, modStamp, readAgent, RESTART_GLYPH, type AgentKnows } from "./desk/agent-env";
import { controlPath } from "./control";
import { ESCAPE_CHORD, isEscapeChord, livePrograms, PtyPane } from "./desk/pty";
import { rawKey } from "./kbd";
import { choiceFile, detectAgents, drawerProgram, programName, sessionLabel, shellQuote, type DrawerAgent, type DrawerProgram } from "./desk/drawer-program";
import { NamedAgentPane } from "./desk/named-agent-pane";
import type { ZoomReach } from "./desk/screen-layout";
import { readPlace } from "./session/place";
import { outlineState, stateDir } from "./state";
import { LineField } from "./surface/line";
import { centred, ListPicker, pickRows, pickRow } from "./surface/picker";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Desk, savedLayoutNames, type MovedTile } from "./desk/desk";
import { ptyBackend, type KeptProgram } from "./desk/pty-backend";
import type { Pane } from "./desk/panes";
import type { ScreenSpec } from "./desk/screen-spec";
import type { TileDone, Where } from "./desk/tile-actions";
import { tileRegistry } from "./desk/tile-registry";
import { parseTileAddress, resolveAddress, ROLE_AGENT, whyNone, type ResolveOpts } from "./desk/tile-address";
import { statusMark, waitingOnYou } from "./desk/program-status";
import { rowFacts, WAITING_YOU_KIND_NAME } from "./desk/waiting-you";
import { ACCESS_MATRIX_KIND_NAME, sourceOf } from "./desk/access-matrix";
import { gatherMatrix } from "./mcp-access-matrix";
import { AGENTS_KIND_NAME } from "./desk/agents-panel";
import { agentIn, agentOf, asSession, configsOf, cwdOf, pickSession, sessionCommand, sessionFacts, shownWords, stateOf, tildeOf, untilde, withIds, type AgentConfig, type AgentSession, type Shown } from "./desk/agent-sessions";
import { existsSync, statSync } from "node:fs";
import { basename, resolve as resolvePath } from "node:path";
import { words } from "./text";
import { WHAT_CHANGED_KIND_NAME, type WhatChangedPane } from "./desk/what-changed";
import { realTileDeps, tileOf, type TileOfAnswer, type TileProc } from "./tile-of";
import { isBarKey } from "./shell-keys";
import { apply as applyLayout, hostDock, hostLayer, HOST_SCREEN, layerOrder, layersAbove, lockChipText, placeHost, type Ctx as LayoutCtx, type HostMode, type LayoutState, type Op, type TileFacts } from "./desk/screen-layout";
import { readState, writeState } from "./state";
import { USER, type Actor } from "./socket";
import { ActionRefused, actionSet, def, preset, agentLabel, type ActRequest, type Again } from "./surface/actions";
import { layoutStanding, standsAsPerson, stepRule, type Dispatcher, type TileRef } from "./surface/dispatch";
import { HOST_AGENT, HOST_TILES, NOBODY, type Whereabouts } from "./whereabouts";
import { bg, C, chip as chipStyle, fg, pad, RESET, width } from "./style";
import type { Key } from "./term";
import type { Placement } from "./kitty";

/** How long `host.tileOf mark=` waits for the marker to reach the door (it travels the pty stream, beside the request). */
export const MARK_WAIT_MS = 400;
/** `drawer.agent`: the alias of `role:agent`, the agent tab used last (src/desk/tile-address.ts). */
export { DRAWER_TILE_ID };
/** The host layer's drawer holds the drawer's desk: one leaf, its tiles the drawer's tabs. */
export { HOST_TILES };
/**
 * The drawer's desk as a screen spec: one tab set. Every agent in it is an ordinary terminal tab with role `agent`
 * (PIE-1331); the first pull of a drawer that has never been saved opens one running the last agent picked.
 */
export function hostSpec(persist = true): ScreenSpec {
  return {
    name: "drawer", title: "drawer", digits: false, layouts: true, ...(persist ? { saves: "drawer-tiles.json" } : {}),
    layout: { root: { t: "tabs", tabs: [], active: 0 } as never },
  };
}
/** What a drop on the chip or the open drawer says while dragging: the tile goes into your drawer, and travels with you. */
export const DRAWER_DROP = "into your drawer: travels with you";
/** The drawer's height, as a share of the rows above the status bar: at least this, at most that. */
export const MIN_SHARE = 0.2, MAX_SHARE = 0.9;
/** alt+A steps through these. */
export const HEIGHT_STEPS = [0.4, 0.5, 0.6, 0.75] as const;
/** A second ctrl+] within this long is the chord's second press (the terminal tile's window too). */
/** Why `drawer.agent` names nothing, and what opens one. */
const NO_AGENT = "no agent tab is open · agent.lift (✦a) opens one running the last agent picked; a right-click on the ▲ chip picks another";
const CHORD_MS = 1500;
/** How long after the program's last output the chip still says `working` (no program status report). */
const WORKING_MS = 1500;
/** How often what the agent knows is read again (its environment, its start, the mod's newest file). */
const KNOWS_POLL_MS = 15_000;
/** An agent's `agent.restart` waits this long after the person last typed into the agent. */
const RESTART_IDLE_MS = 10_000;

/** What drawer.json keeps: whether it's up (folded to a strip or not), and its height. */
export interface DrawerSaved { open: boolean; share: number; folded?: boolean }
/**
 * What the chip says: not started, working, idle, waiting on the person, done (a result the person hasn't seen),
 * failed, exited, or watching (a second view of a named hc terminal). Named agents read hc's status;
 * local programs use their OSC reports, then whether they wrote anything lately.
 */
export type AgentState = "empty" | "off" | "working" | "idle" | "blocked" | "done" | "failed" | "exited" | "watching";

/** What the drawer needs from the App. */
export interface DrawerHost {
  statusChip?(): { from: number; to: number; row: number } | null;
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
  /** The ▣ chip on the drawer's frame while its layout is locked (PIE-1346), where it was last drawn: a click unlocks it. */
  private lockAt: { from: number; to: number } | null = null;
  /** The screen shown lets the drawer be drawn (not the logon or the logoff). Set by the App before each paint. */
  active = false;
  /** Where the drawer was last drawn (full width, above the status bar), and the chip on the status bar. */
  rect: Rect | null = null;
  get chipAt(): { from: number; to: number; row: number } | null { return this.host.statusChip?.() ?? null; }
  /** The drawer's tiles, on a desk of their own (made the first time it's needed, with the App as its ctx). */
  private d: Desk | null = null;
  /** What a new agent tab runs: the last agent picked (or EP0CH_DAILY_AGENT, else a shell), in its folder. */
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
  private knowledge = new WeakMap<PtyPane, { knows: AgentKnows | null; pid: number | null; at: number; polling: boolean }>();
  /** What the agent tab used last knows, also returned by agent.knows and restart. */
  get knows(): AgentKnows | null { const p = this.tile; return p ? this.knowledge.get(p)?.knows ?? null : null; }
  get knowsPid(): number | null { const p = this.tile; return p ? this.knowledge.get(p)?.pid ?? null : null; }
  /** A restart under way: the chip says so, and a second one waits for it. */
  restarting: Promise<RestartDone> | null = null;
  private readonly restoresGlass: boolean;

  /** `persist`: read and write drawer.json (a test's drawer may not). */
  constructor(private readonly host: DrawerHost, private readonly persist = true) {
    const s = persist ? readState<Partial<DrawerSaved>>("drawer.json") : null;
    this.restoresGlass = persist && !!readState<{ floats?: unknown[] }>("drawer-tiles.json", outlineState())?.floats?.length;
    const open = !!s && typeof s === "object" && s.open === true;
    this.strip = open && s?.folded === true;
    const share = s && typeof s.share === "number" && Number.isFinite(s.share) ? clamp(s.share) : 0.5;
    this.layer = hostLayer({ tabs: [HOST_TILES], names: new Map([[HOST_TILES, HOST_TILES]]), share, open });
    this.prog = this.program();
  }

  /** What a new agent tab runs and its folder, for the outline the door is on. */
  private program(picked = false): DrawerProgram {
    // The door's own machine first: an outline on another machine never starts in a same-named local outline's folder.
    const c = this.host.ctx?.(), pl = this.persist ? readPlace(outlineState()) : null;
    // A pick just made runs what was picked; configured defaults decide only what opens by itself.
    return drawerProgram({ picked, ...(picked ? { env: { ...process.env, EP0CH_DAILY_AGENT: undefined } } : {}), outline: c?.outline ?? pl?.outline ?? null, machine: c?.machine ?? pl?.machine ?? null, dir: this.persist ? outlineState() : null, state: this.persist ? stateDir() : null });
  }
  /** This outline's session, as doctor names it (`garden@garden-box`). */
  private session(): string | null { const c = this.host.ctx?.(), pl = this.persist ? readPlace(outlineState()) : null; return sessionLabel({ outline: c?.outline ?? pl?.outline ?? null, machine: c?.machine ?? pl?.machine ?? null }); }

  /** The agents to choose from here (installed, a shell first). */
  agents(): DrawerAgent[] { return detectAgents({ session: this.session() }); }

  /**
   * The person's (or an agent's) pick of an agent (PIE-1331): saved for this outline's session (or, `dflt`, as the default
   * for every outline) as what a new agent tab starts, and started now in a new tab. Nothing that runs is ended: closing
   * an agent is ^W x on its tab.
   */
  async choose(name: string, dflt: boolean, actor: Actor, folder?: string): Promise<Record<string, unknown>> {
    const all = this.agents(), hit = all.find(a => a.name === name);
    if (!hit) throw new ActionRefused(`no agent ${name} here; installed: ${all.map(a => a.name).join(", ")}`);
    if (!this.persist) throw new ActionRefused("this drawer saves nothing (a test's)");
    const file = choiceFile(dflt ? stateDir() : outlineState());
    const choice = JSON.stringify({ agent: name, ...(folder ? { folder: resolvePath(untilde(folder)) } : {}) });
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, choice, { mode: 0o600 });
      if (dflt) {
        mkdirSync(outlineState(), { recursive: true, mode: 0o700 });
        writeFileSync(choiceFile(outlineState()), choice, { mode: 0o600 });
      }
    }
    catch (e) { throw new ActionRefused(`couldn't save the choice in ${file}: ${(e as Error).message}`); }
    this.prog = this.program();
    const picked = this.program(true);
    const done = this.newAgentTab(actor, picked);
    const env = this.prog.from === "env" ? ` · EP0CH_DAILY_AGENT (${process.env.EP0CH_DAILY_AGENT}) still decides what a new tab runs by itself in this door` : "";
    this.host.flash(`${picked.name} started in a new tab (${done.name})${env} · ^W x closes one`, 8000);
    this.host.redraw();
    return { agent: name, saved: dflt ? "default" : this.session() ?? "session", runs: picked.cmd, tile: done.tile, name: done.name };
  }

  /**
   * A new agent tab in the drawer running the last agent picked (`prog`), with role agent: beside the tab shown. The
   * person's comes up with their keys in it; an agent's opens behind the tab shown, and its program starts now.
   */
  newAgentTab(actor: Actor, prog: DrawerProgram = this.prog): TileDone {
    const made = !this.d, d = this.desk;
    if (!d) throw new ActionRefused("the drawer isn't ready (no screen is shown yet)");
    const person = this.ctx(actor).standing;
    if (person && !this.open) { this.offered = true; this.set(true, actor); }
    // A drawer never saved opens its first agent tab as it is made: when it runs this program, that one is the new tab.
    const first = made ? this.firstTab : null;
    const firstPane = first ? d.pane(String(first.name)) : undefined;
    const done = first && firstPane instanceof PtyPane && firstPane.run.cmd.join(" ") === prog.cmd.join(" ") ? first : this.agentTab(d, actor, prog);
    if (person) { this.do({ op: "focus", tile: HOST_TILES }, actor); d.focusTile(done.tile, actor); this.intoShown(); }
    else { const pane = d.pane(done.tile) ?? d.pane(String(done.name)); if (pane instanceof PtyPane) pane.startNow(...this.termSize()); }
    this.host.redraw();
    return done;
  }
  /** An agent tab on desk `d` (the drawer's), not started: it starts when drawn. A named agent attaches, or shows a card. */
  private agentTab(d: Desk, actor: Actor, a: DrawerProgram = this.prog): TileDone {
    if (a.named) {
      const p = new NamedAgentPane(a.named);
      tileRegistry.setRole(p, ROLE_AGENT);
      return d.bringIn({ pane: p, name: freeName(d, a.name), spec: { t: "leaf", kind: "pty" }, from: "drawer", typing: false }, this.tabBase(d), "tabs", actor);
    }
    const p = new PtyPane({ cmd: a.cmd, cwd: a.cwd, label: a.name, agent: true, inShell: a.name !== "shell" });
    tileRegistry.setRole(p, ROLE_AGENT);
    return d.bringIn({ pane: p, name: freeName(d, a.name), spec: { t: "leaf", kind: "pty" }, from: "drawer", typing: false }, this.tabBase(d), "tabs", actor);
  }

  private namedSurface(d: Desk): boolean {
    const a = this.prog.named!;
    const p = d.addressable([d]).map(c => c.value.pane).find(p => p instanceof NamedAgentPane && p.config.persona === a.persona && p.config.outline === a.outline && p.config.outlineMachine === a.outlineMachine);
    if (!(p instanceof NamedAgentPane)) return false;
    Object.assign(p.config, a);
    return true;
  }

  /** The picker over the drawer: the agents installed here; ⏎ starts one in a new agent tab (host.agent), esc leaves it as it is. */
  pick(): { picking: boolean } {
    const d = this.desk;
    if (!d) throw new ActionRefused("the drawer isn't ready");
    // Pulled up for the picker: the first pull's own offer of it would stack a second.
    this.offered = true;
    if (!this.open) this.set(true, USER);
    this.do({ op: "focus", tile: HOST_TILES }, USER);
    const now = this.prog;
    let everywhere = false;
    let scopeAt: { row: number; from: number; to: number } | null = null;
    const folder = new LineField(now.cwd, false, { complete: false });
    d.overlay(new ListPicker<{ agent: DrawerAgent }, Desk>({
      name: "drawer agent", input: folder, clickChooses: true, scrolls: true,
      items: () => this.agents().map(agent => ({ agent })),
      bindings: [{ key: "tab", action: "agent.scope", label: "scope" }],
      dispatch: () => { everywhere = !everywhere; this.host.redraw(); },
      clicked: (x, y) => {
        if (!scopeAt || y !== scopeAt.row || x < scopeAt.from || x >= scopeAt.to) return false;
        everywhere = !everywhere; this.host.redraw(); return true;
      },
      row: (item, _i, on, w) => {
        const a = item.agent;
        return pickRows(` ${a.name}${a.name === now.name ? " · last picked" : ""}  ${a.cmd.at(-1) === a.name ? "" : a.cmd.join(" ")}`, on, w);
      },
      choose: item => {
        const a = item.agent;
        void this.run?.("host.agent", { name: a.name, default: everywhere, in: folder.text });
      },
      frame: (area, n) => {
        const rect = centred(area, Math.min(64, area.cols - 2), Math.min(area.rows - 1, n + 9));
        const override = now.from === "env" ? ["EP0CH_DAILY_AGENT overrides your choice.", "Check ~/.zshrc, ~/.zprofile, ~/.profile or the launcher.", `Remove: export EP0CH_DAILY_AGENT=${shellQuote(process.env.EP0CH_DAILY_AGENT ?? "")}`] : [];
        scopeAt = { row: rect.row + 1 + override.length, from: rect.col + 1, to: rect.col + rect.cols - 1 };
        return {
          rect, title: "a new agent tab · ^W x closes one",
          head: [...override, `Save for ${everywhere ? "every outline" : "this outline"}`, "Folder:", folder.show(rect.cols - 2)],
          field: { line: override.length + 2, col: 0 },
        };
      },
    }));
    this.host.redraw();
    return { picking: true };
  }
  /** How the drawer runs its own actions as the person (the App's dispatcher), for the picker's choice. */
  run: ((name: string, args: Record<string, unknown>) => Promise<unknown>) | null = null;

  /** Where a new tab of the drawer opens: beside the tab shown. */
  private tabBase(d: Desk | null = this.d): string | undefined { const t = d?.focusedName(); return t && d?.pane(t) ? t : undefined; }

  /** A shell stays one key away, even with no tab open. */
  async newShell(actor: Actor): Promise<TileDone> {
    const d = this.desk;
    if (!d) throw new ActionRefused("the drawer isn't ready");
    // Pulled up for a shell: the picker isn't offered over it (alt+g is the way to it).
    if (this.ctx(actor).standing && !this.open) { this.offered = true; this.set(true, actor); }
    const done = await d.openTile({ kind: "pty", cmd: shellQuote(process.env.SHELL || "sh"), cwd: this.prog.cwd }, this.tabBase(), "tabs", actor);
    if (this.ctx(actor).standing) { this.do({ op: "focus", tile: HOST_TILES }, actor); d.focusTile(done.tile, actor); this.intoShown(); }
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
    if (this.ctx(actor).standing && !this.open) { this.offered = true; this.set(true, actor); }
    const tile = this.tabs().find(t => t.kind === WAITING_YOU_KIND_NAME)?.name ?? (await d.openTile({ kind: WAITING_YOU_KIND_NAME }, this.tabBase(), "tabs", actor)).tile;
    if (this.ctx(actor).standing) { this.do({ op: "focus", tile: HOST_TILES }, actor); d.focusTile(tile, actor); this.intoShown(); }
    this.host.redraw();
    return { tile, waiting: waitingOnYou(this).length + (this.host.ctx?.()?.heldAsks?.count() ?? 0) + (this.host.ctx?.()?.waitingAsks?.count() ?? 0) };
  }

  /**
   * The who-can-reach-what matrix (src/desk/access-matrix.ts) as a tab in the drawer, opened once and shown again after, as
   * `waiting` opens its list: the person's pulls the drawer up and goes to it; an agent's opens it behind the tab shown.
   */
  async accessMatrix(actor: Actor): Promise<{ tile: string }> {
    const d = this.desk;
    if (!d) throw new ActionRefused("the drawer isn't ready");
    if (this.ctx(actor).standing && !this.open) { this.offered = true; this.set(true, actor); }
    const tile = this.tabs().find(t => t.kind === ACCESS_MATRIX_KIND_NAME)?.name ?? (await d.openTile({ kind: ACCESS_MATRIX_KIND_NAME }, this.tabBase(), "tabs", actor)).tile;
    if (this.ctx(actor).standing) { this.do({ op: "focus", tile: HOST_TILES }, actor); d.focusTile(tile, actor); this.intoShown(); }
    this.host.redraw();
    return { tile };
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
    const person = this.ctx(actor).standing;
    // Looking marks what is held seen: only once the changes since the kept position are in.
    await store.settled();
    if (person && !this.open) { this.offered = true; this.set(true, actor); }
    const tile = this.tabs().find(t => t.kind === WHAT_CHANGED_KIND_NAME)?.name ?? (await d.openTile({ kind: WHAT_CHANGED_KIND_NAME }, this.tabBase(), "tabs", actor)).tile;
    const changed = store.count();
    if (person) {
      (d.pane(tile) as unknown as WhatChangedPane | undefined)?.keepFresh(store.unseenIds());
      if (actor.kind === "user") store.markSeen();
      this.do({ op: "focus", tile: HOST_TILES }, actor); d.focusTile(tile, actor); this.intoShown();
    }
    this.host.redraw();
    return { tile, changed, seen: person && actor.kind === "user" };
  }

  /** The door this drawer is in (its outline, board and machine), or none. */
  ctxOfDoor() { return this.host.ctx?.(); }

  /** The what-changed rows, titles read, for `changes.list`. */
  async changesRead(): Promise<{ changed: Record<string, unknown>[] }> {
    const door = this.host.ctx?.();
    await door?.whatChanged?.titles(door.board);
    return { changed: door?.whatChanged?.facts() ?? [] };
  }

  /** Open block `id` on the screen shown, as its details open (a new detail when `fresh`), or where an open naming no tile lands. */
  async openOnScreen(id: string, fresh: boolean, actor: Actor, from?: string, reveal?: Reveal): Promise<{ tile: string | null; name?: string; id: string }> {
    // The tile it comes from has a link to a tile of the screen (alt+l): that tile takes it, whatever has the keys (PIE-700).
    const linked = from && !fresh && this.d ? await this.d.openOnLink(id, from, actor) : null;
    if (linked) {
      const at = this.d!.resolveTile(linked)!.tile;
      return { tile: at.id!, name: at.name, id };
    }
    const screen = tilesOf(this.host.screen?.());
    if (!screen) throw new ActionRefused("this screen has no tiles to open it in · q goes back to one");
    const opened = screen.hasPlaces() ? await screen.openPlace(id, fresh ? "new-detail" : "detail", actor) : fresh ? await screen.openFresh(id, actor) : await screen.openLanding(id, actor);
    if (reveal) screen.revealIn(opened.tile, reveal, actor);
    return opened;
  }

  /**
   * Go to tile `p` (the waiting-on-you list's status.go, the power bar's tiles): in the drawer, it's pulled up with that
   * tab shown and the keys in it; on the screen shown, the drawer goes away and the keys go to it; on a screen under
   * this one or kept in the background, that screen comes to the top first (`Ctx.raise`; the person's only: an agent
   * never moves their screen this way). A spine opens first (`tile.expand`); `zoom` zooms it after (a reach, `column` or
   * `full`, lifts it instead: agent.lift).
   */
  goTo(p: Pane, actor: Actor, o: { zoom?: boolean | ZoomReach } = {}): { tile: string; name: string; in: "drawer" | "screen"; raised?: string } {
    const d = this.d, inDrawer = d?.nameOfPane(p) ?? "";
    if (d && inDrawer) {
      const float = d.floatingTiles().find(f => f.pane === p);
      if (float && actor.kind === "user") { this.enterGlass(float.tile); this.host.redraw(); return { tile: float.tile, name: float.name, in: "drawer" }; }
      if (!this.open) { this.offered = true; this.set(true, actor); }
      this.do({ op: "focus", tile: HOST_TILES }, actor);
      d.focusTile(inDrawer, actor);
      this.intoShown();
      p.focused?.(d, actor);
      if (o.zoom) d.zoomTile(inDrawer, true, actor, o.zoom === true ? "screen" : o.zoom);
      this.host.redraw();
      const { tile, name } = d.tileInfo(inDrawer);
      return { tile, name, in: "drawer" };
    }
    let screen = tilesOf(this.host.screen?.()), name = screen?.nameOfPane(p) ?? "", raised: string | undefined;
    const what = (p as { statusName?(): string }).statusName?.() ?? "that tile";
    if (!screen || !name) {
      const ctx = this.host.ctx?.(), under = ctx ? [...(ctx.screens?.() ?? []), ...(ctx.kept?.() ?? [])].find(s => s !== this.host.screen?.() && !!tilesOf(s)?.nameOfPane(p)) : undefined;
      if (!under) throw new ActionRefused(`${what} isn't on any screen this door shows, nor in your drawer · agents.list says where each agent is`);
      if (!ctx?.raise) throw new ActionRefused(`${what} isn't on this screen or in your drawer: it's on the ${under.title}, under this one (q goes back to it)`);
      if (!this.ctx(actor).standing) throw new ActionRefused(`${what} is on the ${under.title}, under this screen: an agent doesn't move the person's screen to it (screen.open names a screen, as the person's idle allows)`);
      const held = stepRule("screen", actor, this.host.person?.() ?? NOBODY, { host: true });
      if (held) throw new ActionRefused(held);
      ctx.raise(under);
      raised = under.title;
      screen = tilesOf(under); name = screen!.nameOfPane(p);
    }
    if (this.open) this.set(false, actor);
    if (screen!.tileOutline().some(t => t.name === name && t.collapsed)) screen!.collapseTile(name, false, actor);
    screen!.focusPane(p, actor);
    // Already the focused tile, the focus didn't move: the person is back in it all the same.
    p.focused?.(screen!, actor);
    if (o.zoom) screen!.zoomTile(name, true, actor, o.zoom === true ? "screen" : o.zoom);
    this.host.redraw();
    return { tile: screen!.tileInfo(name).tile, name, in: "screen", ...(raised ? { raised } : {}) };
  }

  // ── agent sessions (PIE-737): every agent the door holds, wherever it's shown ──

  /**
   * Every agent session this door holds: its terminals (the drawer's, the screen shown's, those on screens under it or
   * kept in the background) running an agent or started as one. Read now, from the terminals themselves.
   */
  sessions(now = Date.now()): AgentSession[] {
    const panes = livePrograms().filter(p => p.door === this);
    const rows: Omit<AgentSession, "id">[] = panes.flatMap(p => {
      const own = tileRegistry.roleOf(p) === ROLE_AGENT;
      const s = asSession(p, { own, now });
      if (!s) return [];
      const st = own && p.named ? ((x: AgentState) => ({ state: x === "blocked" ? "waiting" as const : x === "failed" ? "failed" as const : x === "working" ? "working" as const : x === "done" ? "done" as const : "idle" as const, word: x === "blocked" ? "needs you" : x }))(this.paneState(p, now)) : stateOf(p, now);
      return [{ ...s, ...st, shown: this.shownOf(p), pid: p.pid ?? null }];
    });
    // What the terminal host keeps with no tile (PIE-1432): every program, an agent or not, so none is dropped unseen.
    for (const k of this.untiled()) {
      const live = k.pid ? agentIn(k.pid) : null;
      rows.push({
        program: k.session?.program ?? agentOf(k.cmd) ?? live?.program ?? programName(k.cmd), folder: live?.cwd ?? k.cwd ?? cwdOf(k.pid) ?? process.cwd(),
        persona: k.session?.persona ?? live?.persona ?? null, config: k.session?.config ?? null, how: "kept",
        ...stateOf({ status: { urgent: () => null } as never, lastOutput: k.at ?? 0 }, now), shown: { in: "no tile", key: k.key, at: k.at }, pane: null, pid: k.pid,
      });
    }
    // Your drawer's first, then the screen shown, then the rest, then what has no tile; each in the order its tiles were made.
    const rank = (x: Shown) => (x.in === "drawer" ? 0 : x.in === "screen" && x.here ? 1 : x.in === "no tile" ? 3 : 2);
    return withIds(rows.sort((a, b) => rank(a.shown) - rank(b.shown)));
  }

  /**
   * What the terminal host keeps with no tile and no saved layout to come back to (PIE-1432): a program a screen not
   * opened since the restart will adopt isn't one (`savedLayoutNames`); the rest are the agent panel's "no tile" rows.
   */
  untiled(): KeptProgram[] { return (ptyBackend().kept?.() ?? []).filter(k => !(this.persist && savedLayoutNames(k.key))); }

  /** Where terminal `p` is shown now: your drawer, the screen shown, a screen under it or kept, or nowhere. */
  shownOf(p: Pane): Shown {
    const inDrawer = this.d?.nameOfPane(p);
    if (inDrawer) return { in: "drawer", tile: this.d!.tileInfo(inDrawer).tile, name: inDrawer, ...((p as PtyPane).named ? { address: (p as PtyPane).named!.terminal?.address } : {}) };
    const top = this.host.screen?.(), ctx = this.host.ctx?.();
    const screens = [top, ...[...(ctx?.screens?.() ?? [])].reverse(), ...(ctx?.kept?.() ?? [])].filter((x, i, all): x is Screen => !!x && all.indexOf(x) === i);
    for (const sc of screens) {
      const name = tilesOf(sc)?.nameOfPane(p);
      if (name) return { in: "screen", screen: sc.title, tile: tilesOf(sc)!.tileInfo(name).tile, name, here: sc === top };
    }
    return { in: "nowhere" };
  }

  /** The session `sel` names (its id, program:folder, a tile it's in, or n from 1), or refused with what runs. */
  sessionOf(sel: string | number | undefined): AgentSession {
    const rows = this.sessions();
    if (!rows.length) throw new ActionRefused("no agent sessions run · agent.start (n in the agent panel, `ep0ch agent` from a folder) starts one");
    const s = sel === undefined ? null : pickSession(rows, sel);
    if (!s) throw new ActionRefused(sel === undefined ? `which session: session=<id> · ${rows.map(r => r.id).join(", ")}` : `no agent session ${sel} · running: ${rows.map(r => r.id).join(", ")}`);
    return s;
  }

  /** The agent configs in the outline (`[agent-config::<name>]` notes), read now; none when the outline can't say. */
  async configs(): Promise<AgentConfig[]> {
    const board = this.host.ctx?.()?.board;
    if (!board) return [];
    try { return configsOf(await board.query("agent-config", 100)); } catch { return []; }
  }

  /** What a new session can run: the outline's agent configs, then the agents installed here. */
  async programs(): Promise<{ name: string; program: string; args: string[]; persona?: string; folder?: string; config: boolean }[]> {
    const configs = (await this.configs()).map(c => ({ ...c, config: true }));
    const installed = this.agents().filter(a => a.name !== "shell" && !configs.some(c => c.name === a.name)).map(a => ({ name: a.name, program: a.cmd[0]!, args: a.cmd.slice(1), config: false }));
    return [...configs, ...installed];
  }

  /**
   * Start a session of `program` in folder `in` (or attach the one already running there: the same program in the same
   * folder is the same session, unless `fresh`). It opens as a tab in your drawer, its conversation continued where the
   * program keeps one for that folder. The person's goes to it (the drawer up, their keys in it); an agent's starts it
   * behind the tab shown, and attaching moves nothing of theirs.
   */
  async startSession(o: { program?: string; in?: string; persona?: string; args?: string; fresh?: boolean }, actor: Actor): Promise<Record<string, unknown>> {
    const d = this.desk;
    if (!d) throw new ActionRefused("the drawer isn't ready (no screen is shown yet)");
    const all = await this.programs();
    const want = o.program?.trim() || (this.prog.name !== "shell" ? this.prog.name : "claude");
    const hit = all.find(c => c.name === want) ?? (all.find(c => !c.config && c.program === want) ?? null);
    if (!hit) throw new ActionRefused(`no agent ${want} here · ${all.length ? `choose one of: ${all.map(c => c.name).join(", ")}` : "none is installed, and the outline has no agent configs"} · an agent config is a note with [agent-config::<name>] [program::<command>] (and args::, persona::, folder::)`);
    const folder = resolvePath(untilde(o.in?.trim() || hit.folder || this.prog.cwd));
    let dir = false;
    try { dir = existsSync(folder) && statSync(folder).isDirectory(); } catch { dir = false; }
    if (!dir) throw new ActionRefused(`no folder ${folder} · in=<a folder that exists> (~ is your home)`);
    const program = agentOf([hit.program]) ?? basename(hit.program);
    const persona = o.persona?.trim() || hit.persona;
    const person = this.ctx(actor).standing;
    if (!o.fresh) {
      const had = this.sessions().find(s => s.program === program && s.folder === folder);
      if (had) {
        // Kept with no tile (PIE-1432): attaching puts it back in a drawer tab, the same process.
        const pane = had.pane ?? this.putBack(had, actor).pane;
        const went = person ? this.goTo(pane, actor) : null;
        return { attached: true, started: false, ...sessionFacts(had), ...(went ? { went: went.in } : {}) };
      }
    }
    const args = [...hit.args, ...words(o.args ?? "")];
    const cmd = sessionCommand(hit.program, args, folder);
    const resumed = cmd.length > 1 + args.length;
    if (person && !this.open) { this.offered = true; this.set(true, actor); }
    const done = await d.openTile({ kind: "pty", cmd: shellQuote(hit.program), cwd: folder, name: freeName(d, program.replace(/[^\w-]/g, "-") || "agent") }, this.tabBase(), "tabs", actor);
    const p = d.pane(done.tile) as PtyPane;
    // An agent tab like any other (PIE-1331): the role is what the lift, the chip and `drawer.agent` read.
    tileRegistry.setRole(p, ROLE_AGENT);
    // The session's own command and mark, before its program starts (it starts now: an agent's tab isn't drawn yet).
    p.run.cmd = cmd;
    p.run.session = { program, ...(persona ? { persona } : {}), ...(hit.config ? { config: hit.name } : {}) };
    p.startNow(...this.termSize());
    if (person) { this.do({ op: "focus", tile: HOST_TILES }, actor); d.focusTile(done.tile, actor); this.intoShown(); }
    this.host.redraw();
    return { attached: false, started: true, program, folder, ...(persona ? { persona } : {}), ...(hit.config ? { config: hit.name } : {}), cmd, resumed, tile: done.tile, name: done.name };
  }

  /** Jump to session `sel`: where it's shown, the keys in it (the person's only). */
  goSession(sel: string | number | undefined, actor: Actor) {
    const s = this.sessionOf(sel);
    // A person's only (agents.go), so it takes the keys: one with no tile comes back in a drawer tab first.
    const pane = s.pane ?? this.putBack(s, actor).pane;
    const went = this.goTo(pane, actor);
    return { session: s.id, ...went };
  }

  /**
   * A program the terminal host keeps with no tile (PIE-1432), back in a tile: a new agent tab in your drawer, behind the
   * tab shown, that adopts it by its key (its command as the host keeps it, so the adopt takes it: never a second start).
   */
  private putBack(s: AgentSession, actor: Actor): { pane: PtyPane; tile: string; name: string } {
    const d = this.desk;
    if (!d) throw new ActionRefused("the drawer isn't ready (no screen is shown yet)");
    if (s.shown.in !== "no tile") throw new ActionRefused(`${s.id} has a tile already`);
    const key = s.shown.key, kept = this.untiled().find(k => k.key === key);
    if (!kept) throw new ActionRefused(`${s.id} isn't kept any more (it ended, or a tile took it) · agents.list says what runs`);
    // An agent (by its command, or started as a session) runs in the person's login shell, its session mark kept.
    const agent = !!agentOf(kept.cmd) || !!kept.session;
    const p = new PtyPane({ cmd: kept.cmd, cwd: kept.cwd ?? s.folder, label: s.program, ...(agent ? { agent: true, inShell: true } : {}), ...(kept.session ? { session: kept.session } : {}) });
    // Its first start is the adopt: the key it is kept under, and the command it was kept with.
    p.keptKey = key;
    if (agent) tileRegistry.setRole(p, ROLE_AGENT);
    const tile = d.bringIn({ pane: p, name: freeName(d, s.program.replace(/[^\w-]/g, "-") || "agent"), spec: { t: "leaf", kind: "pty" }, from: "drawer", typing: false }, this.tabBase(d), "tabs", actor);
    p.startNow(...this.termSize());
    if (p.pid !== kept.pid) this.host.flash(`${s.id} couldn't be adopted: a new one started in ${String(tile.name)}`, 8000);
    this.host.redraw();
    return { pane: p, tile: tile.tile, name: String(tile.name) };
  }

  /** Pull session `sel` into your drawer, from the screen it's on: the same process, the conversation kept. */
  pullSession(sel: string | number | undefined, actor: Actor): Record<string, unknown> {
    const s = this.sessionOf(sel);
    if (s.shown.in === "no tile") { const back = this.putBack(s, actor); return { session: s.id, pid: back.pane.pid ?? null, tile: back.tile, name: back.name, inDrawer: true }; }
    if (s.shown.in === "drawer") throw new ActionRefused(`${s.id} is in your drawer already (${s.shown.name}) · d docks it on this screen`);
    if (s.shown.in === "nowhere") throw new ActionRefused(`${s.id} isn't on a screen this door shows`);
    const ctx = this.host.ctx?.(), top = this.host.screen?.(), address = s.shown.tile;
    const sc = [top, ...(ctx?.screens?.() ?? []), ...(ctx?.kept?.() ?? [])].find(x => !!x && tilesOf(x)?.pane(address) === s.pane);
    const from = tilesOf(sc);
    if (!from) throw new ActionRefused(`${s.id} isn't on a screen this door shows`);
    const done = this.put(from, s.shown.tile, actor);
    return { session: s.id, pid: s.pid, ...done };
  }

  /** Dock session `sel` on the screen shown, from your drawer or another screen: the same process, the conversation kept. */
  dockSession(sel: string | number | undefined, actor: Actor): Record<string, unknown> {
    let s = this.sessionOf(sel);
    // With no tile: back in a drawer tab first, then out onto the screen like any other.
    if (s.shown.in === "no tile") { const back = this.putBack(s, actor); return { session: s.id, pid: back.pane.pid ?? null, ...this.take(back.tile, undefined, undefined, actor) }; }
    if (s.shown.in === "screen" && s.shown.here) throw new ActionRefused(`${s.id} is on this screen already (${s.shown.name})`);
    // On another screen: through your drawer, whole.
    if (s.shown.in === "screen") { this.pullSession(s.id, actor); s = this.sessions().find(x => x.pane === s.pane) ?? s; }
    if (s.shown.in !== "drawer") throw new ActionRefused(`${s.id} isn't on a screen this door shows`);
    const done = this.take(s.shown.tile, undefined, undefined, actor);
    return { session: s.id, pid: s.pid, ...done };
  }

  /**
   * The person's new session: a picker of what can run (the outline's agent configs, the agents installed here), then of
   * the folder (yours, the drawer's, the config's, the running sessions'); ⏎ starts it (agent.start), esc leaves it.
   */
  async newSessionPicker(): Promise<{ picking: string }> {
    const d = this.desk;
    if (!d) throw new ActionRefused("the drawer isn't ready");
    const all = await this.programs();
    if (!all.length) throw new ActionRefused("no agent is installed here, and the outline has no agent configs · a note with [agent-config::<name>] [program::<command>] makes one");
    this.offered = true;
    if (!this.open) this.set(true, USER);
    this.do({ op: "focus", tile: HOST_TILES }, USER);
    d.overlay(new ListPicker<(typeof all)[number], Desk>({
      name: "new agent session", items: () => all,
      row: (c, _i, on, w) => [...pickRows(` ${c.name}${c.config ? " · from the outline" : ""}${c.persona ? ` · as ${c.persona}` : ""}  ${[c.program, ...c.args].join(" ")}${c.folder ? ` · in ${c.folder}` : ""}`, on, w)],
      choose: c => { void this.folderPicker(c.name, c.folder); },
      frame: (r, n) => ({ rect: centred(r, Math.min(72, r.cols - 2), Math.min(r.rows - 1, n + 2)), title: "a new agent session: which program" }),
    }));
    this.host.redraw();
    return { picking: "program" };
  }

  /** The folder for a new session of `program`: the config's, the drawer's, the running sessions', your home. */
  private async folderPicker(program: string, given?: string) {
    const d = this.desk;
    if (!d) return;
    const home = process.env.HOME ?? "";
    const folders = [...new Set([given ? resolvePath(untilde(given)) : null, this.prog.cwd, ...this.sessions().map(s => s.folder), home].filter((x): x is string => !!x))];
    d.overlay(new ListPicker<string, Desk>({
      name: "new agent session folder", items: () => folders,
      row: (f, i, on, w) => [...pickRows(` ${tildeOf(f)}${f === this.prog.cwd ? " · the drawer's folder" : i === 0 && given ? " · the config's" : this.sessions().some(s => s.folder === f) ? " · a session runs here" : ""}`, on, w)],
      choose: f => { void this.run?.("agent.start", { program, in: f }); },
      frame: (r, n) => ({ rect: centred(r, Math.min(72, r.cols - 2), Math.min(r.rows - 1, n + 2)), title: `${program}: in which folder` }),
    }));
    this.host.redraw();
  }

  /**
   * The agent panel (src/desk/agents-panel.ts) as a tab in your drawer, opened once and shown again after: the person's
   * pulls the drawer up and goes to it (alt+g); an agent's opens it behind the tab shown.
   */
  async agentsPanel(actor: Actor): Promise<{ tile: string; name: string; sessions: number }> {
    const d = this.desk;
    if (!d) throw new ActionRefused("the drawer isn't ready");
    if (this.ctx(actor).standing && !this.open) { this.offered = true; this.set(true, actor); }
    const tile = this.tabs().find(t => t.kind === AGENTS_KIND_NAME)?.name ?? (await d.openTile({ kind: AGENTS_KIND_NAME }, this.tabBase(), "tabs", actor)).tile;
    if (this.ctx(actor).standing) { this.do({ op: "focus", tile: HOST_TILES }, actor); d.focusTile(tile, actor); this.intoShown(); }
    this.host.redraw();
    const answer = d.tileInfo(tile);
    return { tile: answer.tile, name: answer.name, sessions: this.sessions().length };
  }

  /** What a new agent tab runs (claude, shell): the last agent picked. */
  get name(): string { return this.prog.name; }
  /** What it runs and where, and why (`ep0ch doctor`, peek). */
  get runs(): DrawerProgram { return this.prog; }

  /**
   * The drawer's desk, made the first time it's needed (with the App to enter it; a saved one the first time a tile is
   * asked for, `known`): what was in it when the door last ran (drawer-tiles.json), each terminal adopting the program
   * the terminal host kept for it as the desk is made, the rest starting as first drawn. A drawer never saved before
   * gets one agent tab running the last agent picked.
   */
  get desk(): Desk | null {
    if (this.d) return this.d;
    const ctx = this.host.ctx?.();
    if (!ctx) return null;
    // The App learns its outline after construction; choose only when the drawer can use that context.
    this.prog = this.program();
    const fresh = !this.persist || readState<unknown>("drawer-tiles.json", outlineState()) === null;
    // Its tiles' ids are `k<n>`: a tile in the drawer's id is never a screen tile's (tile= reaches either by id).
    const d = new Desk(hostSpec(this.persist), { where: () => this.whereIn(), idPrefix: "k", area: { col: 0, row: 0, cols: this.cols, rows: this.rows - 1 } });
    this.d = d;
    d.enter(ctx);
    d.shownAs(this.shown || !!d.floatingTiles().length);
    // As the spec's own tile would be: the drawer's focus, which is no one's keys until the person goes in.
    if (fresh && !d.tileCount()) this.firstTab = this.agentTab(d, USER);
    if (!fresh) {
      if (this.prog.named && !this.namedSurface(d)) this.firstTab = this.agentTab(d, USER);
      // Not when first drawn (PIE-1342): asked before the drawer is up, the agent tab names its running program, and a lift lifts that one.
      for (const c of d.addressable([d])) { const p = c.value.pane; if (p instanceof PtyPane && !p.running && p.keptAs && ptyBackend().holds(p.keptAs)) p.startNow(...this.termSize()); }
    }
    return d;
  }
  /**
   * The drawer's desk for a tile asked of the host layer (`resolveTile`, `unnamed`, the agent tabs): once made, or when it
   * has saved tabs (drawer-tiles.json) it is restored now, so they are known from the first ask, not the first draw
   * (PIE-1342). A drawer never saved isn't made by asking, nor by a screen's links and followers reading `desks()`.
   */
  private get known(): Desk | null { return this.d ?? (this.persist && readState<unknown>("drawer-tiles.json", outlineState()) !== null ? this.desk : null); }
  /** The agent tab a drawer never saved opened as it was made (`newAgentTab` right after takes it as its own). */
  private firstTab: TileDone | null = null;
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
  /** The tile the person types in, in the drawer (its tile name), or null. */
  typingTile(): string | null { if (!this.entered) return null; const k = this.d?.keys(); return k?.typingIn ?? k?.focus ?? null; }
  /** `d` is the drawer's desk. */
  isDrawer(d: unknown): boolean { return !!d && d === this.d; }
  /** The drawer's desk (once made) and the screen shown's tiles (a desk, or a desk inside it: the showcase's section). */
  desks(): Desk[] {
    const screen = [...(this.host.ctx?.()?.screens?.() ?? [])].reverse().map(tilesOf).find(Boolean) ?? tilesOf(this.host.screen?.());
    return [...(this.d ? [this.d] : []), ...(screen && screen !== this.d ? [screen] : [])];
  }
  /** What `tile=` names across layers (HostLayer.resolveTile): an id, `drawer.agent`, a path, a drawer tab's name; a bare name on a screen is that screen's own. */
  resolveTile(sel: string, o?: ResolveOpts): { tile: TileRef; dispatch: Dispatcher; desk: Desk } | null {
    // An id, a role (`role:agent`, `drawer.agent`) and a slot are the tile's identity: the one resolver (Desk.resolveTile),
    // asked from any desk of the family, answers them. A bare name is a drawer tab's, never a screen's.
    const asking = this.asking();
    if (!asking) return null;
    const hit = asking.resolveTile(sel, o) ?? null;
    return hit && (parseTileAddress(sel).kind !== "name" || o?.program || sel.includes("/") || hit.tile.id === sel || this.isDrawer(hit.desk)) ? hit : null;
  }
  /** A desk to ask the resolver from: the drawer's (a saved one restored to be asked), else the screen shown's. */
  private asking(): Desk | null { return this.known ?? this.desks()[0] ?? null; }
  /** Why `sel` names no tile in the host layer, in words and with what to run, or null when it says nothing (HostLayer.unnamed). */
  unnamed(sel: string): string | null {
    const address = parseTileAddress(sel), asking = this.asking();
    if (!asking || address.kind === "name") return null;
    if (address.kind !== "role" || address.role !== ROLE_AGENT || (address.scope !== undefined && address.scope !== "drawer")) return whyNone(address, asking.addressable());
    return NO_AGENT;
  }
  /** The terminal tile a process is drawn in, on the drawer or the screen shown (`host.tileOf`, PIE-1043). */
  tileOf(q: { mark?: string; pid?: number; port?: number }): TileOfAnswer {
    // Every terminal of the family (the drawer's, the screen's, and those in their groups and mounts), as the resolver reads them.
    const tiles: TileProc[] = [];
    for (const t of this.asking()?.addressable() ?? []) {
      const p = t.value.pane;
      if (p instanceof PtyPane) tiles.push({ id: t.id, name: t.name, pid: p.pid ?? 0, saw: token => p.status.saw(token) });
    }
    return tileOf(tiles, q, realTileDeps());
  }
  /** The drawer's tiles, as tabs. */
  tabs(): { name: string; id: string; kind: string; title: string; shown: boolean; focused: boolean; pid?: number }[] {
    const d = this.desk;
    if (!d) return [];
    // Chip reads must not materialize every tile's inspection and terminal scrollback.
    const floats = d.floatingTiles();
    const tiles = d.tileOutline().filter(t => !floats.some(f => f.tile === t.id));
    // A terminal's pid: `ep0ch where` from its program finds it here, though it started on another screen (its EP0CH_TILE_ID was that one's).
    return tiles.map(t => { const p = d.pane(t.name), pid = p instanceof PtyPane ? p.pid : undefined; return { name: t.name, id: t.id, kind: t.kind, title: t.label, shown: d.shownNow(p!), focused: this.entered && t.focused, ...(pid ? { pid } : {}) }; });
  }
  /** The tab the drawer shows now. */
  private shownTabOf(): { name: string; kind: string } | null { const name = this.shownTab(), t = this.tabs().find(x => x.name === name); return t ? { name: t.name, kind: t.kind } : null; }
  /** The tile the drawer shows now (^W A brings it to the screen), else the last put in. */
  shownTab(): string | null { return this.shownAmong(this.tabs()); }
  /** The tab shown among `t` (the tabs, which the caller asks for once: each asking walks the drawer's whole desk). */
  private shownAmong(t: ReturnType<AgentDrawer["tabs"]>): string | null { return (t.find(x => x.shown && x.focused) ?? t.find(x => x.shown) ?? t.at(-1))?.name ?? null; }
  private shownPane(tabs?: ReturnType<AgentDrawer["tabs"]>): Pane | null { return this.d ? this.d.pane(this.shownAmong(tabs ?? this.tabs()) ?? "") ?? null : null; }

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
  /**
   * Folded to a spine (PIE-1254): the drawer is up as a strip at its edge with its title, its tiles as they were; `+`,
   * `=`, ⏎, space, alt+h, ^W c or a click opens it. A tile in it with nothing beside it folds the drawer this way.
   */
  get folded(): boolean { return this.strip && this.open; }
  private strip = false;
  /** ^W was pressed on the strip: the next key is the window chord's (c opens it). */
  private foldPrefix = false;
  /**
   * The person is in the drawer: every key but ctrl+], alt+a, alt+A, alt+s and alt+g is the drawer's tab's. Never set by an
   * agent. With the drawer down, that's the tile of it they went into lifted (PIE-1359), while that lift lasts.
   */
  get entered(): boolean { return this.glassHasKeys() || this.mode !== "none" && this.keysIn; }
  /**
   * The person's keys are the drawer's, shown or not: a screen with no drawer (the message log) hides it over them, and
   * closing that screen hands them back to the drawer's tab (PIE-1431: an Esc there is that screen's, never the agent's).
   */
  get keysIn(): boolean {
    if (this.glassHasKeys()) return true;
    if (this.keys === HOST_SCREEN) return false;
    return this.liftIn !== null ? this.inLift() : this.open;
  }
  /** The drawer's lift the person went into with the drawer down (put away or folded), else null. */
  private liftIn: Desk["lifted"] = null;
  /** That lift is still up: their keys are in its tile. One dropped (or lifted again since, an agent's too) isn't. */
  private inLift(): boolean { return !!this.liftIn && this.d?.liftedDesk?.lifted === this.liftIn; }
  /** The person's keys are in the drawer's lifted tile, gone into with the drawer down (on its folded strip isn't). */
  get inLifted(): boolean { return this.entered && this.liftIn !== null; }
  /** Where the screen shown lets the host layer appear: its policy's `host` (a screen without a drawer: none). */
  get mode(): HostMode { const s = this.host.screen?.(); return s?.noDrawer ? "none" : s?.hostMode?.() ?? "over"; }
  /** What the host layer's tiles are: the screen slot (it never closes or moves), the drawer with what runs in it. */
  private facts(id: string): TileFacts {
    if (id === HOST_SCREEN) return { kind: "screen", policy: { closable: false, draggable: false } };
    const running = this.d ? livePrograms().find(p => p.door === this && p.running && !!this.d!.nameOfPane(p)) : undefined;
    return { kind: "drawer", ...(running ? { running: running.run.cmd[0] ?? "a program" } : {}) };
  }
  /** Who acts, and where the person is (the shell's one answer): in the agent, or busy on the screen. */
  private ctx(actor: Actor, rows = 30, cols = 100): LayoutCtx<string> {
    const where = this.host.person?.() ?? NOBODY, who = layoutStanding(actor, where, { host: true });
    return {
      actor, standing: who.standing, keys: who.keys, protectTyping: who.protectTyping, area: { col: 0, row: 0, cols, rows: Math.max(1, rows - 1) }, tile: id => this.facts(id), screenHost: this.mode,
      person: { focus: this.liftIn !== null && !this.inLift() ? HOST_SCREEN : this.keys, typingIn: this.entered ? HOST_TILES : null, busy: this.entered || where.busy, ...(this.host.person ? { held: who.held } : {}) },
    };
  }
  /** One operation on the host layer, for `actor`: its new state and where the keys are now, or the refusal thrown. */
  private do(op: Op<string>, actor: Actor) {
    // A lift the person went into has dropped: their keys were back on the screen from then (entered says so).
    if (this.liftIn !== null && this.keys !== HOST_SCREEN && !this.inLift()) { this.liftIn = null; this.keys = HOST_SCREEN; this.d?.stopTyping(); }
    const r = applyLayout(this.layer, op, this.ctx(actor, this.rows, this.cols));
    if (!r.ok) throw new ActionRefused(r.refused);
    const moved = this.keys !== r.focus;
    this.layer = r.state;
    this.keys = r.focus;
    if (moved) for (const d of this.desks()) d.liftedDesk?.dropLiftElsewhere();
    return r;
  }
  /** A drawer terminal's size, cols and rows, from the room last drawn: what a program started or adopted off screen gets. */
  private termSize(): [number, number] { return [this.cols - 2, Math.max(5, Math.round(this.rows * this.share) - 3)]; }
  /** The terminal's size as last drawn (the host layer's room). */
  private rows = 30;
  private cols = 100;

  // ── the agent tabs ──

  /** The agent tab used last (`drawer.agent`, `role:agent`): on the drawer or the screen shown, the one the person typed in or clicked last. Null when none is open. */
  get tile(): PtyPane | null { return this.agentPane()?.pane ?? null; }
  /** The agent tab used last's tile name (`claude`), else what a new one is called: what an action answers. */
  agentName(): string { const a = this.agentPane(); return (a && a.desk.nameOfPane(a.pane)) || this.name; }
  /**
   * The agent tab used last as the actor rule sees the drawer's actions' tile (agent.type, agent.restart): by the name the
   * person's whereabouts give the tile they type in (`drawer:<name>` in the drawer, its name on the screen shown).
   */
  agentRef(): TileRef {
    const a = this.agentPane(), name = a ? a.desk.nameOfPane(a.pane) : "";
    if (!a || !name) return { ...HOST_AGENT_TILE, label: `${this.name} in the drawer` };
    const inDrawer = this.agentTabs(this.desks()).find(t => t.pane === a.pane)?.screen === "drawer";
    return { name: inDrawer ? `drawer:${name}` : name, kind: "pty", label: `${name}${inDrawer ? " in the drawer" : ""}` };
  }
  /** The agent tab used last's id (`t-…`), or null when none is open. */
  agentId(): string | null { const a = this.agentPane(); return a ? tileRegistry.idOf(a.pane) : null; }
  /** The drawer is drawn now: pulled up, on a screen that lets the host layer appear. */
  get shown(): boolean { return this.open && this.active && this.mode !== "none"; }
  liesOver(row: number): "drawer" | "lift" | null {
    if (this.d?.liftedDesk) return "lift";
    const r = this.rect;
    return this.shown && r && row >= r.row && row < r.row + r.rows ? "drawer" : null;
  }
  /** Drawn beside the screen (the screen shorter), not over it: the rows it takes from the screen, else 0. */
  besideRows(rows: number, cols: number): number {
    if (!this.shown || this.mode !== "beside") return 0;
    const d = placeHost(this.layer, { col: 0, row: 0, cols, rows: rows - 1 }, "beside", this.folded).dock;
    return d?.rows ?? 0;
  }

  private changed() { if (this.shown) this.host.redraw(); else this.host.statusChanged(); }

  // ── what it's doing ──

  state(now = Date.now()): AgentState { return this.paneState(this.shownPane(), now); }

  private paneState(p: Pane | null, now: number): AgentState {
    if (this.d && !p) return "empty";
    if (p instanceof NamedAgentPane) {
      if (p.card) return (p.look?.kind === "ended" || p.terminal?.state === "finished") ? "exited" : "off";
      if (p.observing) return "watching";
      const state = p.terminal?.status?.state;
      return state === "error" ? "failed" : state ?? "idle";
    }
    if (!(p instanceof PtyPane) || (!p.running && p.exited === null)) return "off";
    if (p.exited !== null || p.agentExit !== null) return "exited";
    // The program said what it's doing: no guessing.
    const said = p.status.urgent();
    if (said) return said.state === "error" ? "failed" : said.state;
    return now - p.lastOutput < WORKING_MS ? "working" : "idle";
  }

  /**
   * The chip's words: `▲ claude`, `▲ claude · working`, `▼ claude · idle` (▼ while it's up), then what it knows:
   * `· door tools`, or `· started before update ⟳` (⟳: a click restarts it).
   */
  chipText(now = Date.now()): string { const c = this.chipParts(now); return c.head + c.knows; }

  /** The chip in two parts: what it's doing, and what it knows (drawn in yellow when it offers ⟳). */
  private chipParts(now: number): { head: string; knows: string } {
    // A drag that ended by a key (esc, f, p, a) leaves no mouse event here: the light goes out with it.
    if (this.dropHover && !tilesOf(this.host.screen?.())?.draggedTile()) { this.dropHover = null; this.dropSays = DRAWER_DROP; this.d?.cancelDrag(); }
    // The tabs once for the chip: the shown one, the pane, its state, the restart offer and how many more there are all read them (each asking walks the drawer's desk).
    const tabs = this.d ? this.tabs() : null;
    const shown = tabs ? this.shownAmong(tabs) : null, pane = this.shownPane(tabs ?? undefined), p = pane instanceof PtyPane ? pane : null;
    const s = this.paneState(pane, now);
    if (p && s !== "off" && s !== "exited" && s !== "empty") this.pollKnows(now, p);
    // What it reported says it in its own words (needs you, asks you, working 40%); else the state's.
    const said = p?.status.urgent();
    const what = this.restarting && p === this.tile ? "restarting" : s === "off" ? "" : said && s !== "exited" && s !== "watching" ? statusMark(said).word : s === "blocked" ? "needs you" : s === "exited" ? p?.named ? `exited ${p.named.look?.kind === "ended" ? p.named.look.exit ?? "" : p.named.terminal?.exit_code ?? ""}`.trim() : (p?.exited === null && p?.agentExit !== null ? `exited ${p.agentExit} · shell` : `exited ${p?.exited ?? ""}`.trim()) : s;
    let knows = this.restarting || s === "off" || s === "exited" || s === "empty" || !p ? "" : knowsLabel(this.knowledge.get(p)?.knows ?? null);
    if (!this.offersRestartAt(pane)) knows = knows.replace(RESTART_GLYPH, "").trimEnd();
    const own = !shown;
    const more = tabs ? Math.max(0, tabs.length - 1) : 0;
    const env = this.prog.from === "env" && (own || (!!p && tileRegistry.roleOf(p) === ROLE_AGENT && shown === this.prog.name));
    const out = { head: `${this.open ? "▼" : "▲"} ${own ? this.name : shown}${env ? " (from EP0CH_DAILY_AGENT)" : ""}${more > 0 ? ` +${more}` : ""}${what ? ` · ${what}` : ""}`, knows: knows ? ` · ${knows}` : "" };
    // A drag over it says it goes in there, in the chip's own width: the chip doesn't move under the pointer.
    // (The status bar's right part is right-aligned: a longer chip grows leftwards, a shorter one is padded.)
    if (this.dropHover) { const say = `⤓ ${this.dropHover} ${this.dropSays}`, w = width(out.head + out.knows); return { head: width(say) >= w ? say : pad(say, w), knows: "" }; }
    return out;
  }

  /** The chip ends in ⟳: a click on it restarts the agent. */
  get offersRestart(): boolean { return this.offersRestartAt(this.shownPane()); }
  private offersRestartAt(shown: Pane | null): boolean { return !!shown && shown === this.tile && !this.restarting && (this.knows?.state === "stale" || this.knows?.state === "no-door"); }

  async agentPid(p: PtyPane | null = this.tile): Promise<number | null> { return p?.named ? null : p?.pid ?? null; }

  /** Read again what the agent knows, every KNOWS_POLL_MS while it runs (and at once after a start). */
  private pollKnows(now: number, p: PtyPane) {
    const poll = this.knowledgeOf(p);
    if (poll.polling || now - poll.at < KNOWS_POLL_MS) return;
    poll.polling = true; poll.at = now;
    void this.readKnows(p).finally(() => { poll.polling = false; });
  }

  private knowledgeOf(p: PtyPane) {
    let poll = this.knowledge.get(p);
    if (!poll) { poll = { knows: null, pid: null, at: -Infinity, polling: false }; this.knowledge.set(p, poll); }
    return poll;
  }

  /** What the agent knows now: its own environment and start against the installed mod. Says a change on the chip. */
  async readKnows(p: PtyPane | null = this.tile): Promise<AgentKnows | null> {
    if (!p) return null;
    const poll = this.knowledgeOf(p);
    const pid = await this.agentPid(p).catch(() => null);
    let knows = pid ? judgeAgent(await readAgent(pid), modStamp(modDirs())) : null;
    // Without a control socket of its own, this door has none to give a restarted agent: ⟳ wouldn't help.
    if (knows?.state === "no-door" && !controlPath) knows = { state: "unknown", why: "this door has no control socket to give it" };
    const was = poll.knows ? `${poll.knows.state}|${poll.knows.why}` : "";
    poll.knows = knows; poll.pid = pid;
    if ((knows ? `${knows.state}|${knows.why}` : "") !== was) this.host.statusChanged();
    return knows;
  }

  /**
   * Restart the agent tab. A program in the tile is asked to exit, then the same command runs again
   * (a bare `claude` with --continue). A named agent's command is `hc attach`: this detaches and attaches
   * again. The hc terminal keeps running.
   */
  restart(): Promise<RestartDone> {
    if (this.restarting) return this.restarting;
    const p = this.tile;
    if (!p) return Promise.reject(new ActionRefused(NO_AGENT));
    const run = async (): Promise<RestartDone> => {
      const was = this.knows?.state ?? null;
      if (p.named) { await p.named.refresh(); return { restarted: true, was }; }
      await p.stop();
      p.restart(true);
      this.knowledge.delete(p);
      return { restarted: true, was };
    };
    this.restarting = run().finally(() => { this.restarting = null; this.changed(); });
    this.changed();
    return this.restarting;
  }
  /**
   * The chip as drawn on the status bar (its colour says the state). `short`: for a narrow bar (PIE-1213), only which
   * program and how many more (`▼ shell +1`); `tiny`: its arrow alone. Its colour still says the state.
   */
  chip(now = Date.now(), size: "whole" | "short" | "tiny" = "whole"): string { return this.chips(now)[size]; }
  /** The chip in its three sizes, read once (the status bar takes all three each frame). */
  chips(now = Date.now()): { whole: string; short: string; tiny: string } {
    const s = this.state(now);
    const c = s === "working" ? C.yellow : s === "blocked" ? C.lmagenta : s === "done" ? C.lgreen : s === "exited" || s === "failed" ? C.lred : s === "watching" ? C.lcyan : C.white;
    const parts = this.chipParts(now);
    // Short: the program and its count, without where its name came from or what it's doing.
    const of = (head: string, knows: string) => this.dropHover
      ? `${chipStyle(C.yellow, C.black)}${parts.head}${bg(C.blue)}${fg(C.lcyan)}`
      : `${bg(this.open ? C.cyan : C.blue)}${fg(c)}${head}${knows && this.offersRestart ? fg(C.yellow) : ""}${knows}${bg(C.blue)}${fg(C.lcyan)}`;
    return { whole: of(parts.head, parts.knows), short: of(parts.head.split(" · ")[0]!.replace(/ \(from [^)]*\)/, ""), ""), tiny: of(parts.head.slice(0, 1), "") };
  }
  /** A tile dragged over the drawer (its chip, its drawer): what a release there does (the chip and the drawer light up). */
  private dropHover: string | null = null;
  /** What a release over the drawer would do, in words (the chip's and the drag's): a tab, or a drop zone's landing. */
  private dropSays = DRAWER_DROP;

  // ── actions ──

  /**
   * Pull it up or put it away, by the host layer's drawer operation: the person's pull gives the drawer's tab shown their
   * keys (the module's transition), an agent's never does; put away, the keys go back to the screen slot. On a screen
   * that keeps the whole screen (host none) it's refused, with why.
   */
  set(open: boolean, actor: Actor) {
    // An agent's pull of a drawer that's up already changes nothing; the person's goes into it.
    if (open && this.open && !this.ctx(actor).standing) return;
    if (this.ctx(actor).standing) this.restoreGlassKeys();
    this.strip = false;
    if (open) void this.desk;
    this.do({ op: "slide", tile: HOST_TILES, open }, actor);
    if (open && this.ctx(actor).standing) { this.liftIn = null; this.do({ op: "focus", tile: HOST_TILES }, actor); this.intoShown(); }
    if (open) this.openedBy = actor.kind === "agent" ? (this.entered ? null : actor) : null;
    else { this.openedBy = null; this.capture = null; this.dragging = false; }
    this.d?.shownAs(this.shown || !!this.d.floatingTiles().length);
    this.save();
    // Pulled up by the person with no agent chosen for this session yet: the picker is offered (once a door).
    if (open && this.tabs().length > 0 && actor.kind !== "agent" && this.prog.from === "none" && !this.offered && this.persist && this.host.ctx?.()) { this.offered = true; void this.run?.("host.agent", {}); }
    this.host.redraw();
  }
  private offered = false;

  /** The person's keys go into the tab the drawer shows: a terminal there takes them (its program types), as tile.enter does. */
  private intoShown(send?: string) {
    const d = this.desk, t = this.shownTabOf();
    if (!d || !t) return;
    // The person goes into a tab to type in it: a strip opens first.
    if (this.strip) { this.strip = false; this.save(); }
    const p = d.pane(t.name);
    d.run("tile.focus", {}, t.name);
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

  private save() { if (this.persist) writeState("drawer.json", { open: this.open, share: this.share, ...(this.folded ? { folded: true } : {}) } satisfies DrawerSaved); }

  // ── the drawer: tiles in and out, whole (tile.drawer) ──

  /**
   * Tile `name` of screen `from` into the drawer, as a tab: the layout's `take` there, then its `open` here, both asked
   * first so nothing moves unless both may. The same instance: its program runs on, its note and history stay. The
   * person's drawer pulls the drawer up on it (their keys with it when they had them); an agent's adds the tab behind
   * the one shown and leaves the drawer and the keys as they are.
   */
  /**
   * Why tile `name` of screen `from` can't go into the drawer (there, if `to`/`where` say where), or null: the screen
   * keeps it (its last tile, a fixed shape), or the drawer's layout won't take it there. `put` refuses with it, and a drag over the drawer shows it before the release.
   */
  putRefusal(from: Desk, name: string, actor: Actor, to?: string, where?: Where): string | null {
    const d = this.desk;
    if (!d) return "the drawer isn't ready (no screen is shown yet)";
    if (from === d) return d.tileNow(name, actor).float ? null : `${name} is in the drawer already`;
    const out = from.takeRefusal(name, actor);
    if (out) return out;
    const kind = (from.pane(name) as { kind?: string } | undefined)?.kind ?? "tile";
    // As a tab of the one shown, unless the drop says where in the drawer's layout (`to`, `where`: its drop zones').
    const into = d.bringRefusal({ name, spec: { t: "leaf" as const, kind } }, to, where ?? "tabs", actor);
    return into ? `the drawer doesn't take ${name}: ${into}` : null;
  }

  /** `keep`: the drawer stays as shown or put away (agent.lift's fetch, PIE-1337: the lift shows the tab, not the drawer). */
  put(from: Desk, name: string, actor: Actor, keys = false, to?: string, where?: Where, keep = false): TileDone {
    const d = this.desk;
    const no = this.putRefusal(from, name, actor, to, where);
    if (no || !d) throw new ActionRefused(no ?? "the drawer isn't ready (no screen is shown yet)");
    if (from === d) return this.host.ctx!()!.glass!.tuck(name, actor);
    this.dropHover = null;
    const moved = from.takeOut(name, actor);
    const done = this.bring(d, moved, to, where ?? "tabs", actor, a => from.bringIn(moved, undefined, undefined, a));
    if (this.ctx(actor).standing) {
      // Shown on its tab, the drawer up; the keys come along only when they were in it.
      d.focusTile(done.tile, actor);
      if (!this.open && this.mode !== "none" && !keep) this.do({ op: "slide", tile: HOST_TILES, open: true }, actor);
      if ((moved.typing || keys) && this.open) { this.do({ op: "focus", tile: HOST_TILES }, actor); this.intoShown(); }
      this.save();
    }
    this.d?.shownAs(this.shown || !!this.d.floatingTiles().length);
    this.host.redraw();
    return { ...done, inDrawer: true, from: moved.from };
  }

  /**
   * `tile.collapse` of a drawer tile with nothing beside it (Desk.collapseTile): the drawer folds to a strip at its
   * edge, or opens again as it was (on=false; left out it toggles). The person's keys stay on it (the strip is what
   * has them, as a spine on a screen). A drawer put away is pulled up by opening it; folding it has nothing to fold.
   */
  collapse(name: string, on: boolean | undefined, actor: Actor): TileDone {
    const done = (collapsed: boolean, changed = true): TileDone => ({ tile: this.desk!.tileInfo(name).tile, name, collapsed, drawer: true, ...(changed ? {} : { changed: false }) });
    if (!this.open) {
      if (on === true) throw new ActionRefused("the drawer is put away: nothing to fold · alt+a pulls it up (host.toggle open=true)");
      this.set(true, actor);
      if (this.ctx(actor).standing) this.desk!.focusTile(name, actor);
      return done(false);
    }
    const want = on ?? !this.folded;
    if (want === this.folded) return done(want, false);
    const why = this.foldRefusal(actor);
    if (why) throw new ActionRefused(why);
    this.strip = want;
    this.foldPrefix = false;
    if (want) { this.d?.stopTyping(); this.wantIn = null; this.capture = null; this.dragging = false; }
    else if (this.ctx(actor).standing) { this.do({ op: "focus", tile: HOST_TILES }, actor); this.desk!.focusTile(name, actor); this.leftAt = 0; this.openedBy = null; }
    this.save();
    this.d?.shownAs(this.shown || !!this.d.floatingTiles().length);
    this.host.redraw();
    return done(want);
  }

  /** Why `actor` can't fold the drawer, or open its strip, now: an agent, with the person in the drawer. */
  foldRefusal(actor: Actor): string | null {
    return !this.ctx(actor).standing && this.entered ? "the person is in the drawer: an agent doesn't fold it or open it" : null;
  }

  /** `drawer.away` from a drawer tile's menu: the drawer put away (`host.toggle open=false`), its tiles as they are. */
  away(name: string, actor: Actor): TileDone {
    const tile = this.desk!.tileInfo(name).tile;
    this.set(false, actor);
    return { tile, name, open: false };
  }

  /**
   * Tile `name` in the drawer back into the screen shown, beside `to` (`where`), the same way round: asked there and here
   * first, then moved, an agent tab too. The person's keys go with it when they were in it.
   */
  take(name: string, to: string | undefined, where: Where | undefined, actor: Actor): TileDone {
    const d = this.desk, shown = this.host.screen?.();
    if (!d) throw new ActionRefused("the drawer isn't ready");
    const screen = tilesOf(shown);
    if (!screen || screen === d) throw new ActionRefused(`the ${shown?.title ?? "screen"} has no tiles to put ${name} among · open one with tiles (D the desk, K the board, R the river), then tile.drawer on=false tile=${name}`);
    const out = d.takeRefusal(name, actor);
    if (out) throw new ActionRefused(out);
    const kind = (d.pane(name) as { kind?: string } | undefined)?.kind ?? "tile";
    const into = screen.bringRefusal({ name, spec: { t: "leaf", kind } }, to, where, actor);
    if (into) throw new ActionRefused(`the ${screen.title} doesn't take ${name} there: ${into}`);
    const wasIn = this.entered;
    if (this.glassHasKeys(d.tileInfo(name).tile)) { this.glassReturn = null; this.capture = null; }
    const moved = d.takeOut(name, actor);
    const done = this.bring(screen, moved, to, where, actor, a => d.bringIn(moved, undefined, "tabs", a));
    // The person's keys were in it in the drawer: they go with it, back on the screen.
    if (wasIn && this.ctx(actor).standing) { this.do({ op: "focus", tile: HOST_SCREEN }, actor); screen.focusTile(done.tile, actor); }
    this.host.redraw();
    return { ...done, inDrawer: false, into: screen.title };
  }

  /** Every desk the door holds: the drawer's, each screen on the stack (one a pushed screen covers too) and each kept in the background. */
  private allDesks(): Desk[] {
    const ctx = this.host.ctx?.();
    const stack = [...(ctx?.screens?.() ?? []), ...(ctx?.kept?.() ?? [])].map(tilesOf).filter((d): d is Desk => !!d);
    const d = this.known;
    return [...(d ? [d] : []), ...stack, ...[tilesOf(this.host.screen?.())].filter((x): x is Desk => !!x)];
  }
  /**
   * The agent tab agent.lift lifts, the one the person is using: the one lifted now (so again drops it), else the one
   * they last typed in or clicked. Agent tabs are the terminals with role agent and the agent sessions, in the drawer and
   * on the screen shown. Null when there is none.
   */
  liftPick(): { pane: PtyPane; tile: string; own: boolean; inDrawer: boolean } | null {
    const roles = this.agentTabs(this.desks()).map(t => ({ pane: t.pane, tile: t.id, own: true, inDrawer: t.screen === "drawer" }));
    const tabs = this.sessions().filter(s => !roles.some(r => r.pane === s.pane) && (s.shown.in === "drawer" || (s.shown.in === "screen" && s.shown.here)));
    const all = [...roles, ...tabs.map(s => ({ pane: s.pane!, tile: (s.shown as { tile: string }).tile, own: false, inDrawer: s.shown.in === "drawer" }))];
    const lifted = all.find(a => this.desks().some(d => d.liftsPane(a.pane)));
    if (lifted) return lifted;
    return all.reduce<(typeof all)[number] | null>((best, a) => (!best || a.pane.usedAt > best.pane.usedAt ? a : best), null);
  }
  /** One of the agent tabs is lifted now: agent.lift drops it. */
  liftsAgent(): boolean { const p = this.liftPick(); return !!p && this.desks().some(d => d.liftsPane(p.pane)); }
  /**
   * agent.lift's tile: its pick, else (a lift, not a drop: there's nothing to drop) the agent tab used last on a screen not
   * shown, pulled into the drawer, else a new agent tab.
   */
  liftTile(actor: Actor, on?: boolean): string {
    // The drawer made first (a drawer never saved opens its first agent tab as it is): the pick sees it.
    if (on !== false) void this.desk;
    const pick = this.liftPick();
    if (pick) return pick.tile;
    if (on === false || !this.desk) return `role:${ROLE_AGENT}`;
    const away = this.findAgent(this.allDesks());
    if (away && !this.putRefusal(away.desk, away.name, actor)) return this.put(away.desk, away.name, actor, false, undefined, undefined, true).tile;
    return this.agentTab(this.desk, actor).tile;
  }
  /**
   * The agent tab used last and the desk it is on, as the tile grammar's `drawer.agent` reads it (the one finder:
   * resolveTile and the lift ask it): in the drawer or on the screen shown. Null when none is open. A saved drawer is restored to answer; a new tab is never
   * made by asking.
   */
  agentPane(): { pane: PtyPane; desk: Desk } | null {
    this.asking();
    const hit = this.findAgent(this.desks());
    return hit ? { pane: hit.pane, desk: hit.desk } : null;
  }
  /** The tile `role:agent` names among `desks` (and the screens mounted in them), by the address resolver: the one used last. */
  private findAgent(desks: (Desk | null | undefined)[]): { pane: PtyPane; desk: Desk; name: string } | null {
    const roots = desks.filter((d): d is Desk => !!d), asking = this.asking();
    if (!asking || !roots.length) return null;
    const hit = resolveAddress(parseTileAddress(`role:${ROLE_AGENT}`), asking.addressable(roots));
    return hit && hit.value.pane instanceof PtyPane ? { pane: hit.value.pane, desk: hit.value.desk, name: hit.name } : null;
  }
  /** Every agent tab (role agent) among `desks` (every desk the door holds, by default), with its id. */
  private agentTabs(desks: Desk[] = this.allDesks()): { pane: PtyPane; desk: Desk; name: string; id: string; screen: string }[] {
    const asking = this.asking();
    if (!asking || !desks.length) return [];
    return asking.addressable(desks).flatMap(c => (c.role === ROLE_AGENT && c.value.pane instanceof PtyPane ? [{ pane: c.value.pane, desk: c.value.desk, name: c.name, id: c.id, screen: c.screen }] : []));
  }
  /** Whether `actor` acts as the person here (their press, or an agent on it): only then do the keys move with a lift. */
  standsFor(actor: Actor): boolean { return this.ctx(actor).standing; }

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

  /** Where the drawer is drawn now (its strip while folded), or null when it is put away. */
  drawnRect(): Rect | null { return this.shown ? this.rect : null; }
  describe() {
    const pane = this.shownPane(), p = pane instanceof PtyPane ? pane : null;
    const shown = this.tabs().find(t => t.name === this.shownTab());
    const known = p ? this.knowledge.get(p) : null;
    return {
      open: this.open, shown: this.shown, entered: this.entered, share: Math.round(this.share * 100) / 100, host: this.mode,
      rect: this.drawnRect(), state: this.state(), tile: shown ? { tile: shown.id, name: shown.name } : null,
      runs: { cmd: this.prog.cmd, cwd: this.prog.cwd, why: { program: this.prog.programWhy, folder: this.prog.folderWhy } },
      tiles: this.tabs().map(({ id, ...tab }) => ({ tile: id, ...tab })),
      sessions: this.sessions().map(s => sessionFacts(s)),
      knows: known?.knows ? { ...known.knows, pid: known.pid } : null, ...(this.restarting ? { restarting: true } : {}),
      ...(this.openedBy?.kind === "agent" ? { openedBy: this.openedBy.id } : {}),
      ...(p?.named ? { namedAgent: p.named.describe().namedAgent } : {}),
      terminal: p ? p.describe() : null,
    };
  }

  /** Quitting the door would end what runs in the drawer (hc agents keep running): said, and asked twice. */
  leaveWarning(): string | null {
    const inDrawer = this.d ? this.tabs().map(t => this.d!.pane(t.name)).filter((x): x is PtyPane => x instanceof PtyPane && x.running && !x.named) : [];
    return inDrawer.length ? `${inDrawer.map(x => x.title()).join(", ")} ${inDrawer.length === 1 ? "runs" : "run"} in the drawer · quitting ends ${inDrawer.length === 1 ? "it" : "them"} · again within 3s quits` : null;
  }

  /**
   * The drawer's rows over (or beside) a screen `rows` tall (the last row is the status bar): the host layer placed
   * by the layout engine, as the screen shown lets it appear. At least its bar, a tile's frame and a row of it.
   */
  place(cols: number, rows: number): Rect {
    this.rows = rows; this.cols = cols;
    const room = rows - 1;
    const d = placeHost(this.layer, { col: 0, row: 0, cols, rows: room }, this.mode === "none" ? "over" : this.mode, this.folded).dock;
    return d ?? { col: 0, row: room, cols, rows: 0 };
  }

  /** Render the host desk once, with the drawer's tree in its dock and glass floats in the full terminal. */
  private hostFrame: Frame = { lines: [] };
  glassFrame() { return { ...this.hostFrame, rects: this.d?.drawnAbove().floats.flatMap(f => [f.rect, ...f.shadow]) ?? [], menus: this.shown || this.glassHasKeys() ? this.d?.drawnAbove().menus ?? [] : [] }; }
  render(cols: number, rows: number, screen: string): { rect: Rect; lines: string[]; placements: Placement[] } {
    const r = this.place(cols, rows), d = this.shown || this.restoresGlass ? this.desk : this.d;
    this.rect = this.shown ? r : null;
    const canvas = new Canvas(cols, r.rows), ctx = this.host.ctx?.();
    this.hostFrame = { lines: [] };
    if (d && ctx) {
      d.shownAs(this.shown || !!d.floatingTiles().length);
      d.screenOrigin = { col: 0, row: 0 };
      const sized = new Proxy(ctx, { get: (o, k) => k === "t" ? { ...o.t, cols, rows } : typeof (o as any)[k] === "function" ? (o as any)[k].bind(o) : (o as any)[k] });
      this.hostFrame = d.render(sized, { root: { col: 0, row: r.row + 1, cols, rows: Math.max(0, r.rows - 2) }, shown: this.shown && !this.folded && r.rows >= 4, area: { col: 0, row: 0, cols, rows: rows - 1 } });
      if (this.glassReturn && !d.floatingTiles().some(f => f.tile === this.glassReturn!.tile)) this.restoreGlassKeys();
      this.hostFrame.lines.slice(r.row + 1, r.row + r.rows - 1).forEach((l, i) => canvas.text(0, i + 1, l, cols));
      if (this.wantIn && this.entered) { const w = this.wantIn; queueMicrotask(() => { if (this.wantIn === w) this.intoShown(w.send); }); }
    }
    const lockChip = d?.screenLocked() ? lockChipText(d.layoutSelf()) : "";
    const lock = lockChip ? ` ${chipStyle(C.yellow, C.black)}${lockChip}${bg(C.black)}` : "";
    const pane = this.shownPane(), p = pane instanceof PtyPane ? pane : null;
    const by = this.openedBy ? ` · ${fg(C.lmagenta)}pulled up by ${agentLabel(this.openedBy)}${fg(C.yellow)}` : "";
    const where = this.state() === "watching" ? ` · ${fg(C.lcyan)}another door has it${fg(C.yellow)}` : p?.named ? ` · hc ${p.named.config.persona}` : "";
    const edge = this.dropHover || this.entered ? C.yellow : C.brown;
    const head = `══ ${this.chipText()}${this.folded ? "" : where + by}`;
    this.lockAt = lockChip && !this.dropHover ? { from: r.col + width(head) + 1, to: r.col + width(head) + 1 + width(lockChip) } : null;
    const hint = this.folded ? "· + ⏎ or a click opens it · esc leaves" : `· ↕ drag this edge${lock ? "" : " · ⤓ drop a tile here"}`;
    const title = this.dropHover ? `${chipStyle(C.yellow, C.black)} ⤓ release: ${this.dropHover} ${this.dropSays} ${bg(C.black)}` : head + lock + fg(C.dark) + " " + hint;
    canvas.text(0, 0, fg(edge) + title + " " + "═".repeat(cols) + RESET, cols);
    if (!this.folded) canvas.text(1, r.rows - 1, fg(C.dark) + (this.entered ? "drawer · - folds it · esc steps out · esc again puts it away" : "drawer · esc puts it away") + RESET, cols - 2);
    const placements = (this.hostFrame.placements ?? []).filter(pl => pl.row >= r.row + 1 && pl.row + pl.rows < r.row + r.rows);
    return { rect: r, lines: canvas.lines(), placements };
  }

  private glassReturn: { keys: string; focus: string | null; tile: string } | null = null;
  glassHasKeys(tile?: string): boolean { return !!this.glassReturn && (!tile || this.glassReturn.tile === tile); }
  private enterGlass(tile: string) {
    this.glassReturn ??= { keys: this.keys, focus: this.d?.focusName() ?? null, tile };
    this.glassReturn.tile = tile;
    this.liftIn = null; this.wantIn = null;
    this.do({ op: "focus", tile: HOST_TILES, quiet: true }, USER);
    this.d!.focusTile(tile, USER);
  }
  restoreGlassKeys() {
    const back = this.glassReturn;
    if (!back) return;
    this.glassReturn = null;
    if (back.focus && this.d?.pane(back.focus)) this.d.focusTile(back.focus, USER);
    this.do({ op: "focus", tile: back.keys, quiet: true }, USER);
  }

  /** Raw input while the person is in the drawer and a terminal there runs: every byte is its, but alt+a, alt+A, alt+s and alt+g. */
  rawInput(run: DrawerRun): ((bytes: string) => void) | null {
    if (!this.entered || (this.folded && this.liftIn === null)) return null;
    const raw = this.d?.rawInput();
    if (!raw) return null;
    return (s: string) => {
      // As legacy ESC-and-a-letter or as a Kitty keyboard report (src/kbd.ts).
      const k = rawKey(s);
      if (k?.kind === "alt" && k.ch === "a") return run("host.toggle", { open: !this.shown });
      if (k?.kind === "alt" && k.ch === "A") return run("host.size", { share: nextStep(this.share) });
      // The drawer's own keys, as everywhere in it: a new shell, its agent's picker.
      if (k?.kind === "alt" && k.ch === "s") return run("host.shell", {});
      if (k?.kind === "alt" && k.ch === "g") return run("agents.open", {});
      raw(s);
    };
  }

  menuInput(k: Key): boolean {
    const ctx = this.host.ctx?.(), screen = this.host.screen?.();
    if (k.kind !== "mouse" || this.capture || !ctx) return false;
    return ctx.glass!.menuInput(k, this.glassFrame().menus, this.covers(screen).paint.menus, screen);
  }
  glassInput(k: Key): boolean {
    const ctx = this.host.ctx?.(), d = this.d;
    if (k.kind !== "mouse" || !d || !ctx) return false;
    if (ctx.glass!.dragFloat(k, tilesOf(this.host.screen?.()))) { if (k.action === "up") this.capture = null; return true; }
    const f = d.floatingTiles().findLast(f => k.x >= f.rect.col && k.x < f.rect.col + f.rect.cols && k.y >= f.rect.row && k.y < f.rect.row + f.rect.rows);
    if (f || this.glassHasKeys() && this.capture) {
      if (f && k.action === "down") { this.enterGlass(f.tile); this.capture = f.rect; }
      if (k.action === "up") this.capture = null;
      d.key(k, ctx); return true;
    }
    if (k.action === "down" && this.glassHasKeys()) this.restoreGlassKeys();
    return false;
  }

  /** A key or a mouse event, before the screen: true when the drawer took it. `screen` is the one under it. */
  key(k: Key, screen: Screen | undefined, rows: number, run: DrawerRun): boolean {
    if (this.glassInput(k)) return true;
    if (!this.active && !this.glassHasKeys()) return false;
    if (k.kind === "mouse") return this.mouse(k, screen, rows, run);
    if (this.entered) {
      // In a tile of it lifted with the drawer down (PIE-1359), the keys are that tile's as in the drawer, the strip's none.
      const strip = this.folded && this.liftIn === null && !this.glassHasKeys();
      if (isEscapeChord(k)) {
        // Typing in a terminal there, the first steps out of the program as on a screen (the tile keeps the keys: `-` folds
        // it), a second soon after goes to the program, and in a group it comes out of the group; with nothing to step
        // out of, it leaves the drawer.
        const d = this.desk, ctx = this.host.ctx?.();
        if (d && ctx && !strip && d.chordSteps()) { d.key(k, ctx); return true; }
        run("host.leave", {}); return true;
      }
      if (isAlt(k, "a")) { run("host.toggle", { open: !this.shown }); return true; }
      if (isAlt(k, "A")) { run("host.size", { share: nextStep(this.share) }); return true; }
      if (isAlt(k, "s")) { run("host.shell", {}); return true; }
      if (isAlt(k, "g")) { run("agents.open", {}); return true; }
      if (isAlt(k, "M") && !this.desk?.rawInput()) { void this.host.ctx?.()?.press?.("status.log"); return true; }
      const d = this.desk;
      if (!d) return true;
      // Esc and q step back out of the drawer (to the screen) where its tab isn't using them; never the screen's back.
      // A terminal there that exited isn't using them either.
      if ((k.kind === "esc" || (k.kind === "char" && !k.ctrl && k.ch === "q")) && (!d.holdsKeys() || d.waitsOnExit()) && !d.draggedTile() && !d.linkingFrom()) { run("host.leave", { quiet: true }); return true; }
      // ctrl+k, cmd+k or alt+k: the power bar, from the drawer too (PIE-1346), folded or not, as on a screen: never typing or in a terminal tile.
      if (isBarKey(k) && !this.foldPrefix && !d.rawKeys() && !d.holdsKeys()) { void this.host.ctx?.()?.press?.("bar.open"); return true; }
      if (strip) return this.stripKey(k, d);
      const ctx = this.host.ctx?.();
      if (ctx) d.key(k, ctx);
      return true;
    }
    if (isAlt(k, "a")) { run("host.toggle", {}); return true; }
    if (isAlt(k, "R")) { run("agent.restart", {}); return true; }
    // alt+s: a new shell in the drawer, here; alt+g: the agent panel, every session (PIE-737). On every screen, as alt+a.
    if (isAlt(k, "s")) { run("host.shell", {}); return true; }
    if (isAlt(k, "g")) { run("agents.open", {}); return true; }
    if (this.shown && isEscapeChord(k)) return this.chordBack(screen, run);
    if (this.shown && isAlt(k, "A")) { run("host.size", { share: nextStep(this.share) }); return true; }
    // Esc puts it away when the screen isn't using it (an edit, a filter, a terminal the person is in).
    if (this.shown && k.kind === "esc" && !screen?.holdsKeys?.() && !screen?.rawKeys?.()) { run("host.toggle", { open: false }); return true; }
    return false;
  }

  /**
   * A key with the drawer folded to a strip and the person on it: the keys that open a spine open it (+ = ⏎ space
   * alt+h, ^W c), as `tile.collapse` on=false; the rest are nothing's (a tile out of sight takes no key).
   */
  private stripKey(k: Key, d: Desk): boolean {
    const open = () => { d.run("tile.collapse", { on: false }, this.shownTab() ?? undefined); };
    const after = this.foldPrefix;
    this.foldPrefix = false;
    if (after) { if (k.kind === "char" && !k.ctrl && k.ch === "c") open(); return true; }
    if (k.kind === "char" && k.ctrl && k.ch === "w") { this.foldPrefix = true; return true; }
    if (isAlt(k, "h") || k.kind === "enter" || (k.kind === "char" && !k.ctrl && ["+", "=", " "].includes(k.ch))) open();
    return true;
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
    // A tile of it lifted with the drawer down is gone into where it is (PIE-1359): the drawer stays down.
    const lifted = this.d?.liftedDesk;
    if (lifted && !drawerUp(this)) return this.intoLift(lifted, send, restart);
    if (!this.shown) throw new ActionRefused("the drawer is put away · alt+a pulls it up");
    this.leftAt = 0; this.openedBy = null; this.liftIn = null;
    this.do({ op: "focus", tile: HOST_TILES }, USER);
    const d = this.desk, t = this.shownTabOf(), q = t && d ? d.pane(t.name) : undefined;
    if (q instanceof PtyPane && !q.running && q.exited !== null) {
      if (restart) { d!.run("tile.restart", {}, t!.name); this.host.redraw(); return { entered: true, restarted: true }; }
      this.host.flash(`${t!.name} exited`);
      d!.run("tile.focus", {}, t!.name);
      this.host.redraw();
      return { entered: true };
    }
    this.intoShown(send);
    if (send && q instanceof PtyPane && q.running) this.host.flash(`sent ${ESCAPE_CHORD} to ${t!.name}`);
    this.host.redraw();
    return { entered: true };
  }

  /**
   * Into the drawer's tile lifted while the drawer is down: the person's keys go to it (a terminal there takes them), the
   * drawer left put away or folded. The lift dropped, they're the screen's again.
   */
  private intoLift(d: Desk, send?: string, restart = false): { entered: boolean; restarted?: boolean } {
    const name = d.liftedName()!, p = d.pane(name);
    // Its focus first (and its group's, lifted from one): a keys move drops a lift whose tile hasn't them (dropLiftElsewhere).
    d.focusLift();
    this.liftIn = d.lifted; this.leftAt = 0; this.openedBy = null;
    // Quiet: the host layer's focus never slides a shut drawer up.
    this.do({ op: "focus", tile: HOST_TILES, quiet: true }, USER);
    if (p instanceof PtyPane && !p.running && p.exited !== null) {
      if (restart) { d.run("tile.restart", {}, name); this.host.redraw(); return { entered: true, restarted: true }; }
      this.host.flash(`${name} exited`);
    } else if (p instanceof PtyPane && p.running) d.run("tile.enter", send ? { send } : {}, name);
    this.host.redraw();
    return { entered: true };
  }

  /** The person's keys go back to the screen (ctrl+], a click above the drawer); the drawer stays up. */
  leave(screen: Screen | undefined, said = true): { entered: boolean } {
    if (!this.entered) throw new ActionRefused("the person isn't in the drawer");
    if (this.glassHasKeys()) { this.d?.stopTyping(); this.restoreGlassKeys(); this.host.redraw(); return { entered: this.entered }; }
    // Back to the screen slot: the screen's own focus is as they left it. A terminal there stops taking keys.
    this.do({ op: "focus", tile: HOST_SCREEN }, USER);
    this.liftIn = null;
    this.d?.stopTyping();
    this.wantIn = null;
    this.leftAt = Date.now();
    if (!this.tabs().length) { this.set(false, USER); return { entered: false }; }
    if (said) this.host.flash(`back to the ${screen?.title ?? "screen"}`);
    this.host.redraw();
    return { entered: false };
  }

  /**
   * The drawer's cells the screen shown draws over (PIE-1221), by the one layer order (`layerOrder`): its menus always,
   * its floats unless the person is in the drawer. The frame paints the screen's cells there (`paint`, shadows
   * included), and a click there is the screen's (`hit`).
   */
  covers(shown: Screen | undefined): { paint: { floats: Rect[]; menus: Rect[] }; hit: Rect[] } {
    const r = this.shown ? this.rect : null, d = tilesOf(shown), paint = { floats: [] as Rect[], menus: [] as Rect[] }, hit: Rect[] = [];
    if (!d || d === this.d) return { paint, hit };
    const clip = (b: Rect): Rect[] => {
      if (!r) return [];
      const col = Math.max(b.col, r.col), row = Math.max(b.row, r.row);
      const cols = Math.min(b.col + b.cols, r.col + r.cols) - col, rows = Math.min(b.row + b.rows, r.row + r.rows) - row;
      return cols > 0 && rows > 0 ? [{ col, row, cols, rows }] : [];
    };
    const drawn = d.drawnAbove();
    for (const layer of layersAbove(layerOrder({ inDrawer: this.entered }), "drawer")) {
      if (layer === "floats") { paint.floats.push(...drawn.floats.flatMap(f => [f.rect, ...f.shadow]).flatMap(clip)); hit.push(...drawn.floats.flatMap(f => clip(f.rect))); }
      if (layer === "menus") { paint.menus.push(...drawn.menus); hit.push(...drawn.menus); }
    }
    return { paint, hit };
  }

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
    // A cell the screen's float or menu is drawn over (covers) is the screen's, its edge and chips too; so is a float
    // being moved or sized, until the button comes up.
    const covered = (k.action !== "down" && !!screen && screen !== this.d && screen.floatGesture()) || this.covers(shown).hit.some(c => k.x >= c.col && k.x < c.col + c.cols && k.y >= c.row && k.y < c.row + c.rows);
    const inDrawer = !!r && k.y >= r.row && k.y < r.row + r.rows && !covered;
    // alt+l waiting for a tile (PIE-700): a click on the other desk picks it, the drawer's list linking to a reader of the
    // screen above or a screen tile to one in the drawer; the keys stay where they are.
    if (k.action === "down" && screen && this.d && screen !== this.d) {
      if (this.d.linkingHere() && !inDrawer && !onChip) {
        shown!.key(k, this.host.ctx!()!);
        return true;
      }
      if (screen.linkingHere() && inDrawer) {
        this.d.key(k, this.host.ctx!()!);
        return true;
      }
    }
    // A screen's tile dragged by its title over the drawer (the chip, the drawer): it lights up; released, it goes in.
    const dragged = screen && screen !== this.d ? screen.draggedTile() : null;
    // No drag any more (let go elsewhere, esc, a key that acted on it): the chip and the drawer stop lighting up.
    if (!dragged && this.dropHover) { this.dropHover = null; this.dropSays = DRAWER_DROP; this.d?.cancelDrag(); this.host.redraw(); }
    if (dragged) {
      const over = onChip || inDrawer;
      // Over the drawer's body it lands where the drawer desk's own drop zones say (an edge of a tile, its tab strip: the
      // ghost it draws), as a tile dragged onto a group does; over the chip, or where no zone is, it goes in as a tab.
      const kind = (screen!.pane(dragged) as { kind?: string } | undefined)?.kind ?? "tile";
      const zone = inDrawer && !onChip && this.d && r!.rows >= 4 ? this.d.foreignAt(k.x, k.y, { name: dragged, kind }) : null;
      if (!zone) this.d?.cancelDrag();
      // What the release will do is what `tile.drawer` will do: the screen keeping its last tile, the drawer's layout refusing the place, the zone's own refusal.
      const why = over ? this.putRefusal(screen!, dragged, USER, zone?.to, zone?.where ?? undefined) ?? zone?.refused ?? null : null;
      const says = why ? `✕ ${why}` : zone ? `into your drawer: ${zone.label}` : DRAWER_DROP;
      const hover = over ? dragged : null;
      if (hover !== this.dropHover || says !== this.dropSays) { this.dropHover = hover; this.dropSays = says; screen!.drawerHover(hover ? `⤓ ${says}` : null); this.host.redraw(); }
      if (!over) return false;
      if (k.action === "up") {
        this.dropHover = null; this.dropSays = DRAWER_DROP;
        this.d?.cancelDrag();
        screen!.cancelDrag();
        if (why) this.host.flash(`not moved: ${why}`);
        else void screen!.perform("tile.drawer", { on: true, ...(zone ? { ...(zone.to ? { to: zone.to } : {}), where: zone.where } : {}) }, USER, dragged);
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
      if (k.action === "drag" || k.action === "up") this.d?.key(k, this.host.ctx!()!);
      if (k.action === "up") this.capture = null;
      return true;
    }
    if (onChip) return true;
    if (!r) return false;
    if (!inDrawer) {
      // A click on the screen above hands the keys back to it; the drawer stays up.
      if (k.action === "down" && this.entered) run("host.leave", { quiet: true });
      return false;
    }
    // Its ▣ chip, on the frame (folded or not): a click unlocks the drawer, its own layout.lock.
    if (k.action === "down" && k.y === r.row && this.lockAt && k.x >= this.lockAt.from && k.x < this.lockAt.to && this.desk) { this.desk.pressLock(); return true; }
    // Folded: a click on the strip opens it, with the person's keys on it (it has no edge to drag).
    if (this.folded) {
      if (k.action === "down" && this.desk) { this.liftIn = null; this.do({ op: "focus", tile: HOST_TILES }, USER); this.leftAt = 0; this.openedBy = null; this.desk.run("tile.collapse", { on: false }, this.shownTab() ?? undefined); }
      return true;
    }
    if (k.action === "down" && k.y === r.row) { this.dragging = true; return true; }
    if (k.y === r.row + r.rows - 1 && k.action === "down") return true;      // the drawer's key row
    const ctx = this.host.ctx?.(), d = this.desk;
    if (!ctx || !d) return true;
    if (k.action === "down") {
      if (!this.entered || this.liftIn !== null) { this.liftIn = null; this.do({ op: "focus", tile: HOST_TILES }, USER); this.leftAt = 0; this.openedBy = null; }
      this.capture = r;
    }
    d.key(k, ctx);
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

/** The drawer is up: drawn, not put away or folded to its strip (agent.lift only goes into it then, PIE-1336). */
const drawerUp = (d: AgentDrawer) => d.shown && !d.folded;
/** How the drawer's keys and clicks run its actions: as the person, a refusal said on the status bar. */
export type DrawerRun = (name: "host.toggle" | "host.size" | "agent.restart" | "host.enter" | "host.leave" | "host.shell" | "host.agent" | "agents.open", args: Record<string, unknown>) => void;

/** What `agent.restart` answers once the agent runs again. */
export interface RestartDone { restarted: boolean; was: AgentKnows["state"] | null }

export interface DrawerOn extends Again { drawer: AgentDrawer; ctx: Ctx; here: Screen | undefined }

/** The drawer's actions: on every screen, as the shell's are. */
export const DRAWER_ACTIONS = actionSet<DrawerOn>()("drawer", {
  "host.enter": def({
    summary: "go into the drawer: the person's keys go to the tab it shows until ctrl+]; with the drawer put away or folded, to its tile lifted above the screen (the drawer stays down) until the lift drops; restart=true runs one that exited again (⏎ on it). The person's only: an agent's would take their keys",
    keys: "ctrl+], click in the drawer or in its lifted tile, ⏎ on an exited agent; ctrl+] then ctrl+] sends ctrl+] to it",
    touches: "screen", replay: "safe",
    person: "going into the drawer takes the person's keys; an agent pulls it up with host.toggle and leaves their keys where they are",
    args: { send: { type: "string", optional: true, about: "bytes to give the agent first (a literal ctrl+])" }, restart: { type: "boolean", optional: true, about: "run an agent that exited again, as ⏎ on it does" } },
    examples: [
      { act: "host.enter", does: "sends the person's keys to the drawer's tab until ctrl+]" },
      { act: "host.enter restart=true", does: "runs the exited agent in the drawer again and goes into it" },
    ],
    run({ send, restart }, { drawer }) { return drawer.enter(send, restart); },
  }),
  "host.leave": def({
    summary: "the person's keys go back to the screen from the drawer; the drawer stays up. The person's only",
    keys: "ctrl+], esc or q in the drawer (where its tab isn't using them), a click on the screen above the drawer",
    touches: "screen", replay: "safe",
    person: "the person's keys are theirs: an agent doesn't take them out of the drawer",
    args: { quiet: { type: "boolean", optional: true, about: "say nothing on the status bar (a click away)" } },
    examples: [
      { act: "host.leave", does: "gives the person's keys back to the screen, the drawer staying up" },
      { act: "host.leave quiet=true", does: "gives the keys back without a word on the status bar" },
    ],
    run({ quiet }, { drawer, here }) { return drawer.leave(here, !quiet); },
  }),
  "host.toggle": def({
    summary: "pull the drawer (the host layer's drawer: your agent tabs and the tiles put in) up over or beside the screen, as the screen lets it (its policy's host), or put it away (open=true/false; neither toggles). The person's pull gives it their keys; an agent's never does, waits until they're idle, and is said on screen. Refused on a screen that keeps the whole screen (host none)",
    keys: "alt+a, a click on the ▲ claude chip in the status bar; Esc (or ctrl+] then Esc) puts it away",
    touches: "screen", host: true, replay: "safe",
    says: out => ({ text: `· ${out.open ? "pulled up" : "put away"} the drawer`, ms: 6000 }),
    args: { open: { type: "boolean", optional: true, about: "true pulls it up, false puts it away; left out, it toggles" } },
    examples: [
      { act: "host.toggle open=true", does: "pulls the drawer up over or beside the screen" },
      { act: "host.toggle open=false", does: "puts the drawer away" },
    ],
    run({ open }, { drawer }, actor) {
      const want = open ?? !drawer.open;
      if (want !== drawer.open || want) drawer.set(want, actor);
      return { open: drawer.open, entered: drawer.entered, share: drawer.share, state: drawer.state() };
    },
  }),
  "host.shell": def({
    summary: "a new shell in the drawer (the person's $SHELL, in the drawer's folder), as a tab shown: the person's goes into it; an agent's opens it behind the tab shown, their keys where they were",
    keys: "alt+s (on every screen, and in the drawer), or a click on Shell at home",
    touches: "shape", replay: "ask",
    says: (out: { name?: string }) => `· opened a shell in the drawer (${out.name ?? "shell"})`,
    args: {},
    run(_, { drawer }, actor) { return drawer.newShell(actor); },
  }),
  "host.waiting": def({
    summary: "the waiting-on-you list as a tab in the drawer: what the programs in terminal tiles say waits on the person (blocked on a permission, a question or a login; failed; done and not yet seen), from their program status (OSC 7501), across the screen's terminals and the drawer's. The person's pulls the drawer up and goes to it; an agent's opens it behind the tab shown (status.list reads the same rows)",
    keys: "alt+w (on every screen, and in the drawer), a click on the status bar's waiting count",
    touches: "shape", replay: "ask",
    says: (out: { name?: string }) => `· opened the waiting-on-you list in the drawer (${out.name ?? "waiting-you"})`,
    args: {},
    run(_, { drawer }, actor) { return drawer.waiting(actor); },
  }),
  "access.open": def({
    summary: "the who-can-reach-what matrix as a tab in the drawer: which MCP caller (a named path, a stdio client) can reach which outline and how far, the lower of the outline's grant and the caller's cap, with each one's calls in the last 7 days. The person's pulls the drawer up and goes to it (n r p f plan a change, ⏎ applies it: the person's only); an agent's opens it behind the tab shown (mcp.access.matrix reads the same data)",
    keys: [{ via: "the power bar (ctrl+k, > access.open), then % lists it among the tiles" }],
    touches: "shape", replay: "ask",
    says: (out: { name?: string }) => `· opened who can reach what in the drawer (${out.name ?? "access-matrix"})`,
    args: {},
    run(_, { drawer }, actor) { return drawer.accessMatrix(actor); },
  }),
  "mcp.access.matrix": def({
    summary: "who can reach what, read: each MCP caller (a named path such as /gpty/mcp, or a client such as claude-code@float-2) against each outline of this door's machine, the effective level (the lower of the outline's grant and the caller's cap) with why, and the caller's calls in the last 7 days and last call per outline. Reads the grants (ep0ch mcp access), the caps (EP0CH_MCP_PATH_ACCESS) and the usage records (ep0ch mcp usage); changing access is the person's (access.apply on the tile)",
    keys: [{ via: "ep0ch mcp access --matrix --json prints the same" }],
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { drawer }) {
      const door = drawer.ctxOfDoor();
      if (!door) throw new ActionRefused("this door has no outline to read the matrix from");
      const m = await gatherMatrix([sourceOf(door)]);
      return { callers: m.callers, outlines: m.outlines, cells: m.cells.flat(), caps: m.caps, usage: m.usage, localMachine: m.localMachine };
    },
  }),
  "changes.open": def({
    summary: "the what-changed list as a tab in the drawer: the notes others (agents, other clients, extensions when asked for) changed since the person last looked, newest first, with who, when and what, from the service's change feed. The person's pulls the drawer up and goes to it, and looking marks what it holds seen (the status bar's +N new goes to 0, kept per outline); an agent's opens it behind the tab shown and never marks anything seen (changes.list reads the same rows). Rows: changes.pick, changes.go (⏎, alt+⏎ in a new detail), changes.diff, changes.seen",
    keys: "alt+o (on every screen), a click on the status bar's +N new",
    touches: "shape", replay: "ask",
    says: (out: { name?: string }) => `· opened what changed in the drawer (${out.name ?? "what-changed"})`,
    args: {},
    run(_, { drawer }, actor) { return drawer.changes(actor); },
  }),
  "changes.list": def({
    summary: "what changed since the person last looked, read: each note others changed (id, title, who, kind, when, seen, revision), newest first, from the service's change feed. Changes nothing, and never marks anything seen",
    keys: [{ via: "the status bar's +N new" }, { via: "the drawer's what-changed tab" }],
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { drawer }) { return drawer.changesRead(); },
  }),
  "status.list": def({
    summary: "what waits on the person, read: each terminal tile's program status rows that ask something of them (blocked, failed, done unseen), most urgent first, with the tile, the record (state, kind, progress, app, title, msg) and since when. `peek` gives every terminal's records too (terminal.status)",
    keys: [{ via: "the status bar's waiting count" }, { via: "the drawer's waiting-on-you tab" }],
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { drawer, ctx }) { return { waiting: waitingOnYou(drawer).map((r, i) => rowFacts(r, i + 1)), messages: ctx.messages?.rows ?? [] }; },
  }),
  "host.tileOf": def({
    words: "find the terminal tile a process is drawn in",
    summary: "which terminal tile (the drawer's or the screen's) a process is drawn in, read: mark=<token> finds the tile whose program wrote the marker OSC 7501 ; ?mark=<token> to its terminal (over ssh, or through tmux's passthrough: a program that can't read its own input, PIE-1306; waited for up to 400ms); pid=<pid> finds the tile whose program is that process or its ancestor; port=<n> the tile whose program, or a descendant of it, holds a TCP connection with that local port (the ssh client in a tile, for the sshd on the far end: its client port is the second field of SSH_CONNECTION). Answers {tile, id, by} with tile null when none matches. Changes nothing and says nothing on the screen: the Claude mod asks it to open a pressed reference where the tile's opens go",
    keys: [{ via: "ep0ch act host.tileOf mark=<token>|pid=<pid>|port=<n>" }],
    touches: "nothing", replay: "safe",
    args: {
      mark: { type: "string", optional: true, about: "the token a program wrote to its terminal as OSC 7501 ; ?mark=<token>" },
      pid: { type: "number", optional: true, about: "a process on this machine" },
      port: { type: "number", optional: true, about: "a local TCP port held by a process in a terminal tile" },
    },
    examples: [
      { act: "host.tileOf mark=k7f3a1c09e2b", does: "names the terminal tile whose program wrote OSC 7501 ; ?mark=k7f3a1c09e2b" },
      { act: "host.tileOf port=51234", does: "names the terminal tile whose ssh client uses local port 51234" },
    ],
    async run({ mark, pid, port }, { drawer }) {
      if (mark === undefined && pid === undefined && port === undefined) throw new ActionRefused("host.tileOf: give mark=<token>, pid=<pid> or port=<local tcp port>");
      // A marker crosses the ssh link on its own time, beside this request: it is waited for a moment before pid and port answer.
      if (mark !== undefined) {
        for (const until = Date.now() + MARK_WAIT_MS; Date.now() < until; await Bun.sleep(25)) {
          const found = drawer.tileOf({ mark });
          if (found.tile) return found;
        }
      }
      return drawer.tileOf({ ...(mark !== undefined ? { mark } : {}), ...(pid !== undefined ? { pid } : {}), ...(port !== undefined ? { port } : {}) });
    },
  }),
  "host.agent": def({
    summary: "a new agent tab in the drawer: name=<agent> picks one installed here (claude, codex, pi, … or shell) and starts it in a new tab, inside the person's login shell; the pick is saved as what the next new agent tab starts, for this outline's session (default=true: for every outline). Nothing running is ended: ^W x on a tab closes it. No name: the person's picker of the agents installed here. EP0CH_DAILY_AGENT, when set, still overrides it",
    keys: [{ keys: "alt-click right-click", does: "on the agent chip, opens the picker (a plain click opens and closes the drawer)" }, { via: "the power bar finds agent or claude" }],
    touches: "screen", replay: "ask",
    says: (out: { agent?: string; name?: string }) => (out.agent ? `· started ${out.agent} in a new agent tab (${out.name})` : null),
    args: { name: { type: "string", optional: true, about: "the agent: claude, codex, pi, … or shell (host.agent with no name lists them on screen)" }, default: { type: "boolean", optional: true, about: "the default for every outline's session, not only this one" }, in: { type: "string", optional: true, about: "the folder it starts in (~ is your home); left out: the project's .ep0ch folder, else the outline's own" } },
    examples: [
      { act: "host.agent name=codex", does: "starts codex in a new agent tab, and saves it as what the next one starts in this outline's session" },
    ],
    run({ name, default: dflt, in: folder }, { drawer }, actor) {
      if (!name) {
        if (actor.kind === "agent") return { agents: drawer.agents().map(a => ({ name: a.name, cmd: a.cmd })), now: drawer.runs.name, from: drawer.runs.from };
        return drawer.pick();
      }
      return drawer.choose(name, !!dflt, actor, folder);
    },
  }),
  "agents.open": def({
    summary: "the agent panel as a tab in your drawer (PIE-737): every agent session this door holds (started with agent.start or `ep0ch agent`, a claude, codex or pi run in a terminal tile, the drawer's own), with its program, folder, persona, what it's doing (working, waiting on you, idle) and where it's shown. Its rows: ⏎ or a click agents.go, a agents.drawer, d agents.dock, n agents.new. The person's pulls the drawer up and goes to it; an agent's opens it behind the tab shown (agents.list reads the same rows)",
    keys: "alt+g (on every screen, and in the drawer)",
    touches: "shape", replay: "ask",
    says: (out: { name?: string }) => `· opened the agent panel in the drawer (${out.name ?? "agents"})`,
    args: {},
    run(_, { drawer }, actor) { return drawer.agentsPanel(actor); },
  }),
  "agents.list": def({
    summary: "every agent session this door holds, read: id (<program>:<folder>), program, folder, persona, config, how it became one (started, found running in a terminal tile, the drawer's own), state (working, waiting, idle, done, failed) and where it's shown. Changes nothing",
    keys: [{ keys: "alt+g", does: "opens the agent panel" }],
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { drawer }) { return { sessions: drawer.sessions().map((s, i) => sessionFacts(s, i + 1)) }; },
  }),
  "agent.start": def({
    summary: "start an agent session, or attach the one running: program= (an agent config in the outline, a note with [agent-config::<name>] [program::<command>] and args::, persona::, folder::; or an agent installed here: claude, codex, pi, …) in folder in= (left out: the config's, else the drawer's). The same program in the same folder is the same session: it's attached, not started twice (fresh=true starts another). A new one opens as a tab in your drawer, continuing the program's last conversation in that folder (claude and pi --continue, codex resume --last, when there is one), inside your login shell, so it leaves you a shell when it exits. The person's goes to it; an agent's (and `ep0ch agent`) starts it behind the tab shown and never moves their keys",
    keys: [{ keys: "n", does: "in the agent panel, then the program and the folder" }, { via: "`ep0ch agent [--program <name>] [--in <folder>]` from any folder" }],
    touches: "shape", replay: "ask",
    says: (out: { program?: string; folder?: string; attached?: boolean; id?: string }) => (out?.attached ? `· attached ${out.id}` : `· started ${out?.program ?? "an agent"} in ${out?.folder ? tildeOf(out.folder) : "a folder"} (your drawer)`),
    args: {
      program: { type: "string", optional: true, about: "an agent config's name or an installed agent (claude, codex, pi); left out: the drawer's agent, else claude" },
      in: { type: "string", optional: true, about: "the folder it runs in (~ is your home)" },
      persona: { type: "string", optional: true, about: "the persona it writes under (EP0CH_AGENT, OUTLINER_ACTOR), over the config's" },
      args: { type: "string", optional: true, about: "more arguments for the program" },
      fresh: { type: "boolean", optional: true, about: "start another even when one runs in that folder" },
    },
    examples: [
      { act: "agent.start program=claude in=~/garden", does: "starts claude in ~/garden as a tab in the drawer, or attaches the one running" },
      { act: "agent.start program=codex in=~/bikes fresh=true", does: "starts another codex in ~/bikes even if one runs there" },
    ],
    run(a, { drawer }, actor) { return drawer.startSession(a, actor); },
  }),
  "agents.new": def({
    summary: "a new agent session: the person's picks the program (the outline's agent configs, the agents installed here), then the folder, and starts it (agent.start). An agent names them: agents.new program=<name> in=<folder> is agent.start",
    keys: "n in the agent panel, or a click on New Agent in its empty state",
    touches: "shape", replay: "ask",
    args: { program: { type: "string", optional: true, about: "as agent.start's" }, in: { type: "string", optional: true, about: "as agent.start's" } },
    examples: [
      { act: "agents.new", does: "asks the person for the program, then the folder, and starts it" },
      { act: "agents.new program=pi in=~/sheds", does: "starts pi in ~/sheds as a tab in the drawer" },
    ],
    run({ program, in: folder }, { drawer }, actor) {
      if (actor.kind === "agent" || program) return drawer.startSession({ ...(program ? { program } : {}), ...(folder ? { in: folder } : {}) }, actor);
      return drawer.newSessionPicker();
    },
  }),
  "agents.go": def({
    summary: "jump to an agent session (session=<id, program:folder, a tile, or n from 1>): where it's shown, the drawer up on its tab or the screen's tile, the person's keys in it. The person's only: going takes their keys",
    keys: "⏎ or a click on a row of the agent panel",
    touches: "screen", replay: "ask",
    person: "going to a session takes the person's keys; an agent reads it (agents.list) and types with tile.type",
    args: { session: { type: "string", about: "the session: its id (agents.list), program:folder, the tile it's in, or n from 1" } },
    examples: [
      { act: "agents.go session=2", does: "jumps to the second agent session, the person's keys in it" },
      { act: "agents.go session=claude:garden", does: "jumps to the claude session in the garden folder" },
    ],
    run({ session }, { drawer }, actor) { return drawer.goSession(session, actor); },
  }),
  "agents.drawer": def({
    summary: "pull an agent session into your drawer (session=…), from the screen it's on: the same process and conversation, now with you on every screen. The person's shows it there; an agent's adds it behind the tab shown",
    keys: [{ keys: "a", does: "on a row of the agent panel" }, { keys: "^W a", does: "on its tile" }],
    touches: "shape", replay: "ask",
    says: (out: { session?: string }) => `· pulled ${out?.session ?? "a session"} into your drawer`,
    args: { session: { type: "string", about: "as agents.go's" } },
    examples: [
      { act: "agents.drawer session=claude:garden", does: "pulls that session from its screen into the drawer, still running" },
    ],
    run({ session }, { drawer }, actor) { return drawer.pullSession(session, actor); },
  }),
  "agents.ask": def({
    summary: "ask an agent session (session=…): the power bar with @<its persona> on its line, to type what you ask and send it (agent.ask, PIE-1437). The person's only: it opens their bar; an agent asks with agent.ask to=<persona> text=…",
    keys: [{ keys: "@", does: "on a row of the agent panel" }],
    touches: "nothing", replay: "safe",
    person: "it opens the person's power bar; an agent runs agent.ask itself",
    args: { session: { type: "string", about: "as agents.go's" } },
    examples: [
      { act: "agents.ask session=1", does: "opens the bar with the first session's @persona on its line" },
    ],
    run({ session }, { drawer, ctx }) {
      const s = drawer.sessionOf(session);
      if (!s.persona) throw new ActionRefused(`${s.id} writes as no persona, so no @mail reaches it · start one with agent.start persona=<name>`);
      return ctx.press?.("bar.open", { query: `@${s.persona} ` }) ?? { query: `@${s.persona} ` };
    },
  }),
  "agents.dock": def({
    summary: "dock an agent session on the screen shown (session=…), out of your drawer or off another screen: the same process and conversation, now a tile here",
    keys: "d on a row of the agent panel; ^W A on its tab in the drawer",
    touches: "shape", replay: "ask",
    says: (out: { session?: string; into?: string }) => `· docked ${out?.session ?? "a session"} on the ${out?.into ?? "screen"}`,
    args: { session: { type: "string", about: "as agents.go's" } },
    examples: [
      { act: "agents.dock session=claude:garden", does: "docks that session as a tile on the screen shown, still running" },
    ],
    run({ session }, { drawer }, actor) { return drawer.dockSession(session, actor); },
  }),
  "host.size": def({
    summary: "how much of the screen the drawer covers, as a share of the rows above the status bar (0.2 to 0.9); over a screen, the screen under it doesn't move; beside one, the screen is drawn shorter",
    keys: [{ keys: "drag", does: "the drawer's top edge" }, { keys: "alt+A", does: "steps 40%, 50%, 60%, 75%" }],
    touches: "tile", while: "typing", replay: "safe", way: "an agent doesn't resize it under them",
    args: { share: { type: "number", about: "0.2 to 0.9 (0.5: half the screen)" } },
    examples: [
      { act: "host.size share=0.5", does: "sets the drawer to half the rows above the status bar" },
      { act: "host.size share=0.75", does: "sets the drawer to three quarters of the screen" },
    ],
    run({ share }, { drawer }, actor) {
      if (!(share > 0 && share <= 1)) throw new ActionRefused(`share is a fraction of the screen, 0.2 to 0.9, not ${share}`);
      drawer.height(share, actor);
      return { share: drawer.share, open: drawer.open };
    },
  }),
  // A preset (PIE-1279): tile.zoom on the agent tab the person is using (Drawer.liftPick: the one lifted, else the one
  // typed in or clicked last), so its toggle is tile.zoom's own. A folded or put-away drawer stays as it is unless
  // drawer=true brings it up (alt+a) with the lift (Evan, Oct 26: "if the drawer isn't already expanded, it shouldn't
  // expand the drawer to float the agent"); with no agent tab open one opens running the last agent picked (PIE-1331).
  "agent.lift": preset({
    summary: "lift the agent tab you're using above everything as a column (reach=full: across the terminal), wherever it is: the one you last typed in or clicked (an agent from alt+g too); with none open, a new agent tab running the last agent picked opens first. A folded or put-away drawer stays as it is (drawer=true brings it up too). Again, or on=false, drops it. The person's lift takes their keys and clicks, the drawer down too, until it drops; an agent's lift never replaces the person's",
    keys: [{ keys: "✦a", does: "lift the agent tab" }, { via: "a status-bar button (::button{label=\"▲ lift\" act=\"agent.lift\"} in your bar note)" }, { keys: "^W Z", does: "on its tile, does the same where it is" }],
    touches: "screen", host: true, replay: "safe",
    says: (out: { zoomed?: boolean }) => ({ text: out?.zoomed ? "· lifted the agent tab" : "· dropped the agent tab", ms: 4000 }),
    args: {
      on: { type: "boolean", optional: true, about: "true lifts, false drops; left out, it toggles" },
      reach: { type: "string", optional: true, choices: ["column", "full"], about: "column (default) or full" },
      drawer: { type: "boolean", optional: true, about: "true brings a folded or put-away drawer up with the lift, as alt+a does; left out, the drawer stays as it is" },
    },
    examples: [
      { act: "agent.lift", does: "lifts the agent tab you're using as a column wherever it is, or drops it when it's lifted; the drawer stays as it is" },
      { act: "agent.lift reach=full", does: "lifts it across the whole terminal" },
      { act: "agent.lift drawer=true", does: "lifts it and brings the drawer up with it" },
    ],
    to: { action: "tile.zoom", tile: ({ on }, { drawer }, actor) => drawer.liftTile(actor, on), args: { reach: "column" }, own: ["drawer"] },
    // A lift of it (not a drop) comes with the person's keys (drawer=true brings the drawer up first, as alt+a does): the
    // program in the drawer is gone into (host.enter is the person's own), one on a screen takes the focus there. With the
    // drawer down it's gone into where it's lifted, after the zoom (PIE-1359): the drawer stays down.
    first: [
      { action: "host.toggle", args: { open: true }, when: (a, { drawer }) => a.on !== false && a.drawer === true && !drawer.liftsAgent() && !drawer.shown && (drawer.liftPick()?.inDrawer ?? true) },
      { action: "tile.collapse", args: { on: false }, tile: ({ on }, { drawer }, actor) => drawer.liftTile(actor, on), when: (a, { drawer }) => a.on !== false && a.drawer === true && !drawer.liftsAgent() && drawer.folded && (drawer.liftPick()?.inDrawer ?? true) },
      { action: "tile.focus", tile: ({ on }, { drawer }, actor) => drawer.liftTile(actor, on), when: ({ on }, { drawer }, actor) => on !== false && !drawer.liftsAgent() && drawer.standsFor(actor) && (drawerUp(drawer) || !(drawer.liftPick()?.inDrawer ?? true)) },
      { action: "host.enter", when: ({ on }, { drawer }, actor) => on !== false && !drawer.liftsAgent() && actor.kind === "user" && drawerUp(drawer) && (drawer.liftPick()?.inDrawer ?? false) && !drawer.entered },
    ],
    then: [
      { action: "host.enter", when: (_a, { drawer }, actor, out) => actor.kind === "user" && !!(out as { zoomed?: boolean } | undefined)?.zoomed && !drawerUp(drawer) && !!drawer.made?.liftedDesk && !drawer.inLifted },
    ],
  }),
  "agent.restart": def({
    summary: "restart the agent tab used last (▲ claude). A program in the tile is asked to exit (SIGTERM, SIGKILL after 8s) and the same command runs again (a bare claude gets --continue on this restart). A named agent's command is hc attach: this detaches and attaches again, and the hc terminal keeps running. An agent's restart is refused while the person types in it, and is said on screen",
    keys: `a click on ${RESTART_GLYPH} at the end of the ▲ claude chip (shown when it started without the door's variables, or without door tools); alt+R`,
    touches: "tile", while: "typing", replay: "ask", way: "an agent doesn't restart it under them",
    says: (out: { name?: string }) => ({ text: `· restarted ${out?.name ?? "the agent tab"}`, ms: 6000 }),
    args: {},
    async run(_, { drawer, ctx }, actor) {
      const p = drawer.tile;
      // The agent's own window: the person who typed into it lately may be about to again. Who it holds back is the
      // actor rule's standing (their press's run and yolo stand as them), only the window is this program's own.
      const idle = Date.now() - (p?.personKeyAt ?? 0);
      if (p && idle < RESTART_IDLE_MS && !standsAsPerson(actor, ctx.person?.() ?? NOBODY, "tile")) throw new ActionRefused(`the person typed into the agent ${(idle / 1000).toFixed(1)}s ago; try again once they've left it ${RESTART_IDLE_MS / 1000}s`);
      const name = p ? drawer.agentName() : drawer.name;
      ctx.flash(`restarting ${name} · the conversation is kept`, 6000);
      return drawer.restart().then(r => ({ ...r, name }));
    },
  }),
  "agent.type": def({
    summary: "send the agent tab used last (▲ claude) text as typed: \\n is ⏎, \\e Esc (tile.type tile=<its id> types into any one). Refused while the person is typing in it, and while it isn't running",
    keys: [{ keys: "ctrl+]", does: "the person types in the drawer" }, { keys: "click", does: "in the drawer, to type in it" }],
    touches: "tile", while: "typing", replay: "ask", way: "an agent doesn't type there",
    says: (out: { name?: string }) => `· typed to ${out?.name ?? "the drawer"}`,
    args: { text: { type: "string", about: "what to type (\\n ⏎, \\e Esc)" } },
    examples: [
      { act: "agent.type text=\"check the seed-swap note\\n\"", does: "types that line into the agent tab used last and presses ⏎" },
    ],
    run({ text }, { drawer }) {
      const p = drawer.tile;
      if (!p?.running) throw new ActionRefused(p ? `${drawer.agentName()} isn't running · ⏎ on its tab runs it again` : NO_AGENT);
      p.input(text.replace(/\\n/g, "\r").replace(/\\e/g, "\x1b"));
      return { tile: drawer.agentId(), name: drawer.agentName(), chars: text.length };
    },
  }),
  "agent.knows": def({
    summary: "what the agent tab used last (▲ claude) knows: read now from its own process (its environment and start time) against the installed Outliner Claude mod. state current (door tools; a changed mod reloads into it live), stale (started before the mod manifest changed, or by an older door without its variables), no-door (no EP0CH_CONTROL) or unknown",
    keys: [{ via: "the ▲ claude chip says it: · door tools, · started before update ⟳" }],
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { drawer }) { return { knows: await drawer.readKnows(), pid: drawer.knowsPid }; },
  }),
});

/** The host layer's agent as the actor rule sees it: the tile an agent's typing, resizing or restarting would be under. */
export const HOST_AGENT_TILE: TileRef = { name: HOST_AGENT, kind: "pty", label: "the drawer's agent tab" };

/** The drawer laid over a screen's lines: its rows replace the screen's (a full-width drawer, nothing reflows). */
export function overlay(lines: string[], drawer: { rect: Rect; lines: string[] }): string[] {
  const out = [...lines];
  drawer.lines.forEach((l, i) => { out[drawer.rect.row + i] = l + RESET; });
  return out;
}
