// The home base: what bare `ep0ch` opens where nothing names an outline (no --ws, no EP0CH_WS, no .ep0ch). A screen
// spec on the desk (PIE-515: `homeSpec`) with one tile of its own kind (`home`, HOME_KIND): this machine's outlines,
// then the machines the person has opened outlines on (src/machine.ts keeps that list; ssh config names them), each
// one's outlines once its forward is up, read as `ep0ch doctor` reads them (`machineStatus`). Choosing an outline opens
// the door on it, and offers to write the folder's `.ep0ch` (its name, and its machine when it is another one) so the
// next `ep0ch` there opens it directly. An outline whose session runs (one per outline, src/session/place.ts) says so
// ("● running · 1 attached"), and choosing it attaches to that session.
//
// Every choice is an action of the kind (HOME_ACTIONS): its keys, a click on its row and `act` run the same code. What a
// choice needs typed or picked (a new outline's name, a database to import, a machine from ssh config, whether to write
// `.ep0ch`) is a list picker over the screen (`DeskApi.overlay`, `linePrompt`), each choice of which runs the action
// again with what it was given. The list's scroll is a RowView, as every list's is.
//
// The home base runs before a door is on an outline: `homeBase` (src/door.ts) opens it in this terminal over the host
// the rule names (this machine's, or EP0CH_SOCKET's), and the outline chosen is what the door then opens
// (src/main.ts). On a door already on an outline (a screen opened by name), it shows what it shows, but makes, imports,
// connects and opens nothing: those wait for the home base proper. More sections (running agents, switching outlines
// from a sidebar) are tiles a later spec adds beside this one.
import { hostname } from "node:os";
import { basename, resolve } from "node:path";
import type { Cell } from "./ansi";
import type { Canvas, Rect } from "./canvas";
import type { Placement } from "./kitty";
import { artNamed } from "./packs";
import { hostRequest, type Actor } from "./socket";
import { C, fg, pad, paint, RESET, selected, visible } from "./style";
import { ch, isDown, isUp, type Key } from "./term";
import { ActionRefused, actionSet, def } from "./surface/actions";
import { LineInput } from "./surface/line";
import { centred, linePrompt, ListPicker, pickRow } from "./surface/picker";
import { RowView } from "./scroll";
import type { DeskApi, Pane, PaneView } from "./desk/panes";
import type { ScreenSpec } from "./desk/screen-spec";
import type { KindHost, TileKind } from "./desk/tile-kinds";
import { densest, drawLogo, LOGOS, logoCells } from "./hub/welcome";
import { freeOutlineName, isMachineName, isOutlineName, slugifyOutlineName } from "@ep0ch/outline-core/outline-location";
import { hostLive } from "./discover";
import { forgetMachine, forwardTo, machineStatus, rememberMachine, sshConfigNames, usedMachines } from "./machine";
import { writeDotEp0ch } from "./outlines";
import { runningSessions } from "./session/place";
import type { SessionInfo } from "./session/protocol";

/**
 * What the home base opens on: the folder it was started in, the name and folder `.ep0ch` would get there, a machine
 * named (`--machine`, EP0CH_MACHINE), and the host socket the rule names for this machine (EP0CH_SOCKET's, or its own).
 * `missing`: the door was asked for an outline that machine doesn't have (PIE-545). Nothing was made; the home base
 * says so and offers the ways on first: the one on this machine (when it has one), making it there, cancel.
 */
export interface HomeArgs { folder: string; guess?: { name: string; folder: string }; machine?: string; socket?: string; missing?: { outline: string; machine: string } }

/** What was chosen: the outline, on which machine (none: this one), the `.ep0ch` written, and by whom (an agent's id). */
export interface HomeChoice { outline: string; machine?: string; wrote?: string; by?: string }

/** A host's outlines as the home base shows them: still asking, the names, or why there are none. */
interface Place { outlines: string[] | null; problem: string; busy: string }

type Row =
  | { t: "head"; text: string }
  | { t: "outline"; name: string; machine?: string }
  | { t: "new"; machine?: string }
  | { t: "import" }
  | { t: "machine"; machine: string }
  | { t: "add" }
  | { t: "offer"; act: "open" | "create" | "cancel"; name?: string; machine?: string }
  | { t: "note"; text: string }
  | { t: "gap" };
type Pick = Exclude<Row, { t: "head" } | { t: "note" } | { t: "gap" }>;
const picks = (r: Row): r is Pick => r.t !== "head" && r.t !== "note" && r.t !== "gap";
const on = (machine?: string) => (machine ? ` on ${machine}` : "");
const sessionKey = (outline: string, machine?: string) => `${machine ?? ""}/${outline}`;
/** A choice's identity: it stays picked while rows come and go around it (a machine connecting, a list read). */
const idOf = (r: Pick) => `${r.t}:${r.t === "offer" ? r.act : ""}:${"name" in r ? r.name ?? "" : ""}:${"machine" in r ? r.machine ?? "" : ""}`;

export class HomePane implements Pane {
  readonly kind = "home";
  /** This machine's host (the socket the rule names: the home base's board). */
  here: Place = { outlines: null, problem: "", busy: "asking the outline host…" };
  /** The machines, in the order shown: the one named first, then those opened before, the most recent first. */
  machines = new Map<string, Place>();
  /** The sessions running on this state dir, by outline (`<machine>/<name>`, no machine: this one's): ⏎ attaches to one. */
  running = new Map<string, SessionInfo>();
  /** The choice picked, by identity. */
  private picked = "";
  private readonly view = new RowView();
  private shownRows: Row[] = [];
  constructor(readonly args: HomeArgs) {
    // A missing outline starts on cancel, never on making one: ⏎ alone makes nothing. Once this machine's outlines are
    // read and it has one, on opening that (load).
    if (args.missing) this.picked = idOf({ t: "offer", act: "cancel" });
  }

  title() { return `home base · ${hostname()}`; }
  hint() { return "j k pick · ⏎ open · n new · i import · a add machine · x forget · r reload · q quit"; }

  /** The missing outline (args.missing), and whether this machine has one of that name, once its outlines are read. */
  private missing() {
    const m = this.args.missing;
    return m ? { ...m, localHas: !!this.here.outlines?.includes(m.outline) } : null;
  }

  /** The picked choice's place among the choices (0 when it's gone). */
  get at(): number { return Math.max(0, this.choices().findIndex(c => idOf(c) === this.picked)); }
  set at(n: number) { const c = this.choices()[n]; if (c) { this.picked = idOf(c); this.moved = true; } }
  /** The cursor was moved: what it starts on (below) no longer follows the outlines read. */
  private moved = false;

  init(desk: DeskApi) {
    for (const m of [...(this.args.machine ? [this.args.machine] : []), ...usedMachines().map(u => u.name)]) {
      if (!this.machines.has(m)) this.machines.set(m, { outlines: null, problem: "", busy: "looking at its forward…" });
    }
    void this.load(desk);
    // A machine named (--machine, EP0CH_MACHINE) is connected to at once, when the home base may.
    if (this.args.machine && desk.ctx.home) void desk.press?.(this, HOME_ACTIONS, "home.connect", { machine: this.args.machine }, true);
  }

  /** Every host asked again: this machine's, and each machine's forward as it is (none is started). */
  async load(desk: DeskApi) {
    const socket = desk.ctx.board.path;
    await Promise.all([
      hostLive(socket, 3000).then(live => {
        this.here = live ? { outlines: live.outlines, problem: "", busy: "" }
          : { outlines: null, problem: `no outline host answers at ${socket} · start it: systemctl --user start outliner-host (launchctl on macOS)`, busy: "" };
        const m = this.missing();
        if (m?.localHas && !this.moved) this.picked = idOf({ t: "offer", act: "open", name: m.outline });
      }),
      ...[...this.machines.keys()].map(m => this.loadMachine(m)),
      runningSessions().then(rs => { this.running = new Map(rs.map(r => [sessionKey(r.info.place.outline, r.info.place.machine), r.info])); }, () => {}),
    ]);
    desk.redraw();
  }

  /** A machine's outlines through its forward, when it is up, as `ep0ch doctor` reads them (`home.connect` starts it). */
  async loadMachine(machine: string) {
    try {
      const s = await machineStatus(machine);
      this.machines.set(machine, { outlines: s.outlines, problem: s.outlines ? "" : s.connected ? "connected, but no outline host answers through it" : "not connected · ⏎ connects", busy: "" });
    } catch (e) {
      this.machines.set(machine, { outlines: null, problem: (e as Error).message, busy: "" });
    }
  }

  /** The rows, in order: this machine's outlines and what to add there, then each machine and its outlines, then "add". */
  rows(): Row[] {
    const rows: Row[] = [];
    const m = this.missing();
    if (m) {
      rows.push({ t: "head", text: `${m.machine} has no outline ${m.outline}` },
        { t: "note", text: `nothing was created there · ${this.here.outlines ? (m.localHas ? "this machine has one" : "neither has this machine") : "asking this machine…"}` });
      if (m.localHas) rows.push({ t: "offer", act: "open", name: m.outline });
      rows.push({ t: "offer", act: "create", name: m.outline, machine: m.machine }, { t: "offer", act: "cancel" }, { t: "gap" });
    }
    rows.push({ t: "head", text: `this machine · ${hostname()}` });
    const list = (p: Place, machine?: string) => {
      if (p.busy) rows.push({ t: "note", text: p.busy });
      else if (p.problem && machine === undefined) rows.push({ t: "note", text: p.problem });
      for (const name of p.outlines ?? []) rows.push({ t: "outline", name, ...(machine ? { machine } : {}) });
      if (p.outlines && !p.outlines.length) rows.push({ t: "note", text: "no outlines yet" });
    };
    list(this.here);
    rows.push({ t: "new" }, { t: "import" }, { t: "gap" }, { t: "head", text: "other machines" });
    if (!this.machines.size) rows.push({ t: "note", text: "none opened from here yet · a adds one from ~/.ssh/config" });
    for (const [m, p] of this.machines) {
      rows.push({ t: "machine", machine: m });
      if (p.outlines) { list(p, m); rows.push({ t: "new", machine: m }); }
    }
    rows.push({ t: "add" });
    return rows;
  }

  /** The rows that can be picked, in order: what `home.pick n=` counts. */
  choices(): Pick[] { return this.rows().filter(picks); }

  private rowText(r: Row): string {
    switch (r.t) {
      case "head": return paint(`|14${r.text}`);
      case "note": return paint(`|08   ${r.text}`);
      case "gap": return "";
      case "outline": {
        const s = this.running.get(sessionKey(r.name, r.machine));
        if (!s) return `   ${r.name}`;
        const n = s.clients.filter(c => !c.watch).length;
        return `   ${r.name}  ${fg(C.lgreen)}● running${fg(C.dark)} · ${n ? `${n} attached` : "none attached"}${RESET}`;
      }
      case "new": return `   + new outline${on(r.machine)}…`;
      case "offer": return r.act === "open" ? `   open ${r.name} on this machine` : r.act === "create" ? `   + create ${r.name} on ${r.machine}` : "   cancel: open nothing";
      case "import": return "   ↓ import a database…";
      case "add": return " + add a machine…";
      case "machine": {
        const p = this.machines.get(r.machine);
        const state = p?.busy || (p?.outlines ? `forward up · ${p.outlines.length} outline${p.outlines.length === 1 ? "" : "s"}` : p?.problem ?? "");
        return ` ${fg(C.lcyan)}${r.machine}${fg(C.dark)}  ${state}`;
      }
    }
  }

  render(w: number, h: number, focused: boolean): PaneView {
    const rows = (this.shownRows = this.rows()), at = this.at;
    const sel = rows.findIndex(r => picks(r) && idOf(r) === idOf(rows.filter(picks)[at]!));
    this.view.place(sel >= 0 ? sel : null, rows.length, h);
    return {
      lines: rows.slice(this.view.top, this.view.top + h).map((r, i) => {
        const text = this.rowText(r);
        return this.view.top + i === sel ? selected(focused) + pad(visible(text), w) + RESET : pad(fg(C.grey) + text, w) + RESET;
      }),
    };
  }

  key(k: Key, desk: DeskApi): boolean {
    const run = (action: string, args: Record<string, unknown> = {}) => { void desk.press?.(this, HOME_ACTIONS, action, args); return true; };
    const c = ch(k), here = this.choices()[this.at], n = this.choices().length;
    if (isUp(k)) return this.at > 0 ? run("home.pick", { n: this.at }) : true;
    if (isDown(k)) return this.at + 1 < n ? run("home.pick", { n: this.at + 2 }) : true;
    if (k.kind === "enter" && here) return this.choose(here, desk);
    if (c === "n") return run("home.new", here && "machine" in here && here.machine ? { machine: here.machine } : {});
    if (c === "i") return run("home.import");
    if (c === "a") return run("home.add");
    if (c === "x" && here?.t === "machine") return run("home.forget", { machine: here.machine });
    if (c === "r") return run("home.reload");
    return false;
  }

  /** What ⏎ or a click on a row runs, as the person. */
  private choose(r: Pick, desk: DeskApi): boolean {
    if (r.t === "offer") {
      const [action, args] = r.act === "open" ? ["home.open", { outline: r.name }] : r.act === "create" ? ["home.new", { name: r.name, machine: r.machine }] : ["home.cancel", {}];
      void desk.press?.(this, HOME_ACTIONS, action as string, args as Record<string, unknown>);
      return true;
    }
    const args: Record<string, unknown> =
      r.t === "outline" ? { outline: r.name, ...(r.machine ? { machine: r.machine } : {}) }
      : r.t === "new" ? (r.machine ? { machine: r.machine } : {})
      : r.t === "machine" ? { machine: r.machine } : {};
    const action = { outline: "home.open", new: "home.new", import: "home.import", machine: "home.connect", add: "home.add" }[r.t];
    void desk.press?.(this, HOME_ACTIONS, action, args);
    return true;
  }

  /** A click picks the row (`home.pick`), then chooses it, as ⏎ does: a launcher's rows act on one click. */
  click(_x: number, y: number, desk: DeskApi) {
    const r = this.shownRows[this.view.top + y];
    if (!r || !picks(r)) return;
    const n = this.choices().findIndex(c => idOf(c) === idOf(r)) + 1;
    void desk.press?.(this, HOME_ACTIONS, "home.pick", { n })?.then(() => { if (this.picked === idOf(r)) this.choose(r, desk); });
  }

  wheel(dir: 1 | -1, desk: DeskApi) {
    const to = this.at + dir;
    if (to >= 0 && to < this.choices().length) void desk.press?.(this, HOME_ACTIONS, "home.pick", { n: to + 1 });
  }

  describe() {
    return {
      folder: this.args.folder, ...(this.args.guess ? { writes: `${this.args.guess.folder}/.ep0ch` } : {}),
      ...(this.missing() ? { missing: this.missing() } : {}),
      here: { host: hostname(), outlines: this.here.outlines, ...(this.here.problem ? { problem: this.here.problem } : {}) },
      machines: [...this.machines].map(([m, p]) => ({ machine: m, outlines: p.outlines, ...(p.problem ? { state: p.problem } : {}) })),
      choices: this.choices().map((r, i) => {
        const s = r.t === "outline" ? this.running.get(sessionKey(r.name, r.machine)) : undefined;
        return { n: i + 1, kind: r.t, ...(r.t === "offer" ? { act: r.act } : {}), ...("name" in r && r.name ? { outline: r.name } : {}), ...("machine" in r && r.machine ? { machine: r.machine } : {}), ...(s ? { session: { pid: s.pid, attached: s.clients.filter(c => !c.watch).length } } : {}) };
      }),
      picked: this.at + 1,
    };
  }

  // ── the band: the logo, and what the home base holds ──

  private logoFor(rows: number): { rows: Cell[][]; width: number } | null {
    const art = artNamed(LOGOS[0]!.file);
    if (!art || rows < 24) return null;
    const cells = logoCells(art, LOGOS[0]!);
    return cells.rows.length ? { rows: densest(cells.rows, Math.min(cells.rows.length, rows >= 40 ? 8 : 5)), width: cells.width } : null;
  }

  bandRows(rows: number): number { const logo = this.logoFor(rows); return logo ? logo.rows.length + 1 : 2; }

  drawBand(canvas: Canvas, r: Rect, desk: DeskApi): Placement[] {
    const ctx = desk.ctx, logo = this.logoFor(ctx.t.rows), n = this.here.outlines?.length;
    const info = [
      "|15e p 0 c h |08· |11home base",
      `|07${hostname()} |08· ${n === undefined ? "asking…" : `${n} outline${n === 1 ? "" : "s"}`} · ${this.machines.size} other machine${this.machines.size === 1 ? "" : "s"}`,
      this.args.missing ? `|12${this.args.missing.machine} has no outline ${this.args.missing.outline} |08· nothing was created` : `|08${this.args.guess ? `opening one offers to write ${this.args.guess.folder}/.ep0ch` : `${this.args.folder} names no outline`}`,
    ];
    if (!logo) { info.slice(0, 2).forEach((l, i) => canvas.text(1, r.row + i, paint(l), r.cols - 2)); return []; }
    const drawn = drawLogo(canvas, r, ctx, logo, "home-logo", info);
    // No room beside it: the counts on the row under it.
    if (!drawn.withInfo) canvas.text(drawn.x0, r.row + logo.rows.length, paint(`${info[0]} |08· ${info[1]!.replace(/^\|07/, "")}`), r.cols - drawn.x0);
    return drawn.placements;
  }
}

// ── what the actions do ──

/** The home base proper, or why not: making, importing, connecting and opening wait for it (a door on an outline has none). */
function homeOf(desk: DeskApi) {
  const home = desk.ctx.home;
  if (!home) throw new ActionRefused("the home base makes, connects and opens outlines only before a door is on one: run `ep0ch` where no outline is named, or `ep0ch --ws <name>`");
  return home;
}

const machineChecked = (machine?: string) => {
  if (machine !== undefined && !isMachineName(machine)) throw new ActionRefused(`"${machine}" isn't an ssh config name`);
  return machine;
};

/** The host a choice goes to: this machine's (the board's socket), or the machine's forward, started when it isn't up. */
async function hostOf(desk: DeskApi, machine?: string): Promise<string> {
  if (!machineChecked(machine)) return desk.ctx.board.path;
  try { return (await forwardTo(machine!)).socket; } catch (e) { throw new ActionRefused((e as Error).message); }
}

/** Open `outline`: the door goes on to it. With the folder nameable, `write` puts its `.ep0ch` there first. */
function open(pane: HomePane, desk: DeskApi, outline: string, machine: string | undefined, write: boolean | undefined, actor: Actor) {
  const home = homeOf(desk);
  machineChecked(machine);
  const place = machine ? pane.machines.get(machine) : pane.here;
  // Only an outline the host listed: the door that opens next creates a name nobody has, so a typo would make one.
  if (!place?.outlines) throw new ActionRefused(machine ? `${machine}'s outlines aren't read yet: home.connect machine=${machine}` : "this machine's outlines aren't read yet (is its outline host running?)");
  if (!place.outlines.includes(outline)) throw new ActionRefused(`no outline ${outline}${on(machine)}; home.new name=${outline}${machine ? ` machine=${machine}` : ""} makes it`);
  // The person is asked whether the folder should name it; an agent writes only when told to (write=true).
  if (write === undefined && pane.args.guess && actor.kind !== "agent") {
    offerWrite(pane, desk, outline, machine);
    return { asked: `write ${pane.args.guess.folder}/.ep0ch?` };
  }
  if (write && !pane.args.guess) throw new ActionRefused(`${pane.args.folder} is too broad to name an outline for every folder below it: open it with write=false`);
  let wrote: string | undefined;
  try { wrote = write ? writeDotEp0ch(pane.args.guess!.folder, outline, false, machine) : undefined; }
  catch (e) { throw new ActionRefused((e as Error).message); }
  if (machine) rememberMachine(machine);
  home.choose({ outline, ...(machine ? { machine } : {}), ...(wrote ? { wrote } : {}), ...(actor.kind === "agent" ? { by: actor.id } : {}) });
  return { opened: outline, ...(machine ? { machine } : {}), ...(wrote ? { wrote } : {}) };
}

/** ⏎ on an outline, launched in a folder that can be named: write its `.ep0ch`, or open it this time only. */
function offerWrite(pane: HomePane, desk: DeskApi, outline: string, machine?: string) {
  const folder = pane.args.guess!.folder;
  const items = [
    { write: true, label: `open ${outline}${on(machine)}, and write .ep0ch in ${basename(folder)}` },
    { write: false, label: `open ${outline}${on(machine)} this time only` },
  ];
  desk.overlay?.(new ListPicker({
    name: "home-write", items: () => items,
    row: (it, _i, lit, w) => [pickRow(` ${it.label}`, lit, w)],
    choose: it => void desk.press?.(pane, HOME_ACTIONS, "home.open", { outline, ...(machine ? { machine } : {}), write: it.write }),
    frame: a => ({ rect: centred(a, Math.min(70, a.cols - 4), 7), title: `open ${outline}${on(machine)}`, foot: "⏎ or a double click chooses · esc closes", head: [paint(`|08 with .ep0ch naming it, the next ep0ch in ${basename(folder)} opens it directly:`), paint(`|08 ${folder}/.ep0ch`), ""] }),
  }));
}

/** Make an outline (`outlines.create`) on this machine's host or a machine's, then open it. */
async function make(pane: HomePane, desk: DeskApi, name: string | undefined, machine: string | undefined, write: boolean | undefined, actor: Actor) {
  homeOf(desk);
  machineChecked(machine);
  if (name === undefined) {
    if (actor.kind === "agent") throw new ActionRefused("home.new takes name=");
    const taken = (machine ? pane.machines.get(machine)?.outlines : pane.here.outlines) ?? [];
    const offered = freeOutlineName(pane.args.guess?.name ?? slugifyOutlineName(basename(pane.args.folder)), taken);
    desk.overlay?.(linePrompt({ name: "home-new", title: `new outline${on(machine)}`, text: offered, head: [paint("|08 lowercase letters, digits and hyphens")], doing: t => `make ${t}${on(machine)} and open it`, done: t => void desk.press?.(pane, HOME_ACTIONS, "home.new", { name: t, ...(machine ? { machine } : {}) }) }));
    return { asked: "name" };
  }
  if (!isOutlineName(name)) throw new ActionRefused(`"${name}" isn't an outline name: lowercase letters, digits and hyphens, up to 32`);
  const socket = await hostOf(desk, machine);
  await hostRequest(socket, "outlines.create", { name }).catch(e => { throw new ActionRefused((e as Error).message); });
  await (machine ? pane.loadMachine(machine) : pane.load(desk));
  return { created: name, ...(machine ? { machine } : {}), ...(open(pane, desk, name, machine, write, actor) as object) };
}

/** Import a database (`outlines.import`) as a new outline on this machine's host, then open it. */
async function importDb(pane: HomePane, desk: DeskApi, path: string | undefined, name: string | undefined, write: boolean | undefined, actor: Actor) {
  homeOf(desk);
  if (path === undefined) {
    if (actor.kind === "agent") throw new ActionRefused("home.import takes path= (a .sqlite file on this machine) and name=");
    desk.overlay?.(linePrompt({ name: "home-import", title: "import a database", text: "", prefilled: false, head: [paint("|08 a .sqlite file on this machine: its notes, properties, pages and work ids (it is only read)")], doing: t => `next: name the outline made from ${basename(t)}`, done: t => void desk.press?.(pane, HOME_ACTIONS, "home.import", { path: t }) }));
    return { asked: "path" };
  }
  const file = resolve(path.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
  if (name === undefined) {
    if (actor.kind === "agent") throw new ActionRefused("home.import takes name=");
    const offered = freeOutlineName(slugifyOutlineName(basename(file).replace(/\.sqlite$/, "")), pane.here.outlines ?? []);
    desk.overlay?.(linePrompt({ name: "home-import", title: `import ${basename(file)} as`, text: offered, doing: t => `import it as ${t} and open it`, done: t => void desk.press?.(pane, HOME_ACTIONS, "home.import", { path: file, name: t }) }));
    return { asked: "name" };
  }
  if (!isOutlineName(name)) throw new ActionRefused(`"${name}" isn't an outline name: lowercase letters, digits and hyphens, up to 32`);
  const r = await hostRequest<{ imported: { blocks: number } }>(desk.ctx.board.path, "outlines.import", { path: file, name }, 600_000).catch(e => { throw new ActionRefused((e as Error).message); });
  await pane.load(desk);
  return { imported: file, blocks: r.imported.blocks, ...(open(pane, desk, name, undefined, write, actor) as object) };
}

/** Start a machine's forward (when it isn't up) and read its outlines. */
async function connect(pane: HomePane, desk: DeskApi, machine: string) {
  homeOf(desk);
  machineChecked(machine);
  if (!pane.machines.has(machine)) pane.machines.set(machine, { outlines: null, problem: "", busy: "" });
  pane.machines.get(machine)!.busy = "connecting…";
  desk.redraw();
  try { await forwardTo(machine); }
  catch (e) { pane.machines.set(machine, { outlines: null, problem: (e as Error).message, busy: "" }); desk.redraw(); throw new ActionRefused((e as Error).message); }
  rememberMachine(machine);
  await pane.loadMachine(machine);
  desk.redraw();
  return { machine, outlines: pane.machines.get(machine)?.outlines ?? [] };
}

/** `a`: the machines in ssh config not listed yet, filtered as it's typed; a name typed that isn't there is offered too. */
function addPicker(pane: HomePane, desk: DeskApi) {
  const names = sshConfigNames().filter(n => !pane.machines.has(n));
  const input = new LineInput("");
  desk.overlay?.(new ListPicker<string, unknown>({
    name: "home-add", input,
    items: () => {
      const t = input.text.trim(), list = names.filter(n => n.toLowerCase().includes(t.toLowerCase()));
      return t && isMachineName(t) && !list.includes(t) && !pane.machines.has(t) ? [...list, t] : list;
    },
    row: (n, _i, lit, w) => [pickRow(` ${n}${names.includes(n) ? "" : "  (not in ~/.ssh/config)"}`, lit, w)],
    choose: n => void desk.press?.(pane, HOME_ACTIONS, "home.add", { machine: n }),
    frame: (a, n) => { const r = centred(a, Math.min(70, a.cols - 4), Math.min(a.rows - 4, n + 4)); return { rect: r, title: "add a machine", foot: "type to filter · ⏎ or a double click adds · esc", head: [" " + input.show(r.cols - 4)] }; },
  }));
}

const WRITE = { type: "boolean", about: "write .ep0ch in the folder the home base was opened in (ws, and machine)", optional: true } as const;

/** The home base's choices. The keys, a click on a row and `act` call the same code. */
export const HOME_ACTIONS = actionSet<KindHost>()("home", {
  "home.pick": def({
    summary: "move the home base's cursor to choice n (as describe numbers them, from 1)", keys: "j k ↑ ↓ wheel click",
    touches: "screen", replay: "safe",
    args: { n: { type: "number", about: "the choice's place, from 1" } },
    run({ n }, { pane }) {
      const p = pane as HomePane, c = p.choices();
      if (!(n >= 1 && n <= c.length)) throw new ActionRefused(`pick 1 to ${c.length}`);
      p.at = n - 1;
      return { picked: n, ...c[n - 1] };
    },
  }),
  "home.open": def({
    summary: "open an outline the home base lists: the door goes on to it. The person is asked whether to write the folder's .ep0ch; an agent's writes it with write=true", keys: "⏎ click",
    touches: "screen", replay: "ask",
    says: r => (r?.opened ? `opened ${r.opened}${on(r.machine)}${r.wrote ? ` · wrote ${r.wrote}` : ""}` : null),
    args: { outline: { type: "string", about: "the outline's name" }, machine: { type: "string", about: "the machine it is on (an ssh config name); left out, this one", optional: true }, write: WRITE },
    run({ outline, machine, write }, { pane, desk }, actor) { return open(pane as HomePane, desk, outline, machine, write, actor); },
  }),
  "home.new": def({
    summary: "make an outline and open it: name=, on machine= (left out, this one), write= as home.open. The person's without a name types one", keys: "n click",
    touches: "screen", replay: "ask",
    args: { name: { type: "string", about: "the new outline's name", optional: true }, machine: { type: "string", about: "an ssh config name", optional: true }, write: WRITE },
    run({ name, machine, write }, { pane, desk }, actor) { return make(pane as HomePane, desk, name, machine, write, actor); },
  }),
  "home.import": def({
    summary: "import a database (.sqlite on this machine) as a new outline and open it: path=, name=, write= as home.open. The person's types them", keys: "i click",
    touches: "screen", replay: "ask",
    args: { path: { type: "string", about: "the database file", optional: true }, name: { type: "string", about: "the new outline's name", optional: true }, write: WRITE },
    run({ path, name, write }, { pane, desk }, actor) { return importDb(pane as HomePane, desk, path, name, write, actor); },
  }),
  "home.connect": def({
    summary: "start a machine's forward when it isn't up, and list its outlines", keys: "⏎ click",
    touches: "nothing", replay: "ask",
    args: { machine: { type: "string", about: "an ssh config name" } },
    run({ machine }, { pane, desk }) { return connect(pane as HomePane, desk, machine); },
  }),
  "home.add": def({
    summary: "add a machine to the home base (and connect to it): machine=. The person's picks one from ~/.ssh/config", keys: "a click",
    touches: "nothing", replay: "ask",
    args: { machine: { type: "string", about: "an ssh config name", optional: true } },
    async run({ machine }, { pane, desk }, actor) {
      homeOf(desk);
      if (machine === undefined) {
        if (actor.kind === "agent") throw new ActionRefused("home.add takes machine=");
        addPicker(pane as HomePane, desk);
        return { asked: "machine" };
      }
      return connect(pane as HomePane, desk, machine);
    },
  }),
  "home.forget": def({
    summary: "take a machine off the home base (its forward, if one runs, is left as it is)", keys: "x",
    touches: "nothing", replay: "safe",
    args: { machine: { type: "string", about: "an ssh config name" } },
    run({ machine }, { pane, desk }) {
      homeOf(desk);
      const p = pane as HomePane;
      if (!p.machines.delete(machine)) throw new ActionRefused(`${machine} isn't on the home base`);
      forgetMachine(machine);
      desk.redraw();
      return { forgot: machine };
    },
  }),
  "home.cancel": def({
    summary: "leave the home base, opening nothing (as q does): what the missing outline's cancel runs", keys: "⏎ click",
    touches: "screen", replay: "ask",
    args: {},
    run(_, { desk }) {
      const home = homeOf(desk);
      if (!home.cancel) throw new ActionRefused("this home base can't be left by an action: q leaves it");
      home.cancel();
      return { cancelled: true };
    },
  }),
  "home.reload": def({
    summary: "ask every host again: this machine's and each machine's forward as it is", keys: "r",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { pane, desk }) { const p = pane as HomePane; await p.load(desk); return p.describe(); },
  }),
});

/** What a home tile was made with (its spec's `state`), checked: the folder, the guess offered, a machine named, the outline it lacks. */
function homeArgsOf(x: unknown): HomeArgs {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, any>;
  const guess = o.guess && typeof o.guess.name === "string" && typeof o.guess.folder === "string" ? { name: o.guess.name as string, folder: o.guess.folder as string } : undefined;
  const missing = o.missing && isOutlineName(o.missing.outline) && isMachineName(o.missing.machine) ? { outline: o.missing.outline as string, machine: o.missing.machine as string } : undefined;
  return { folder: typeof o.folder === "string" ? o.folder : process.cwd(), ...(guess ? { guess } : {}), ...(isMachineName(o.machine) ? { machine: o.machine } : {}), ...(missing ? { missing } : {}) };
}

/** The home base as a tile kind: the list, its actions, its band and what `peek` says. */
export const HOME_KIND: TileKind = {
  kind: "home", about: "the home base: this machine's outlines and the machines opened from here", noun: "the home base",
  make: s => new HomePane(homeArgsOf(s.state)),
  actions: HOME_ACTIONS,
  band: {
    rows: (p, _cols, rows) => (p as HomePane).bandRows(rows),
    draw: (p, canvas, r, desk) => (p as HomePane).drawBand(canvas, r, desk),
  },
  peek: p => ({ home: (p as HomePane).describe() }),
};

/** The home base: one tile, the whole screen, no drawer over it (nothing to work on yet). */
export function homeSpec(args: Partial<HomeArgs> = {}): ScreenSpec {
  return {
    name: "home", title: "home base", band: "home", digits: false,
    hint: "|15⏎|08 open · |15n|08 new · |15i|08 import · |15a|08 add a machine · |15x|08 forget · |15r|08 reload · |15q|08 quit",
    layout: { focus: "home", policy: { host: "none" }, root: { t: "leaf", kind: "home", name: "home", state: { ...args } } },
  };
}
