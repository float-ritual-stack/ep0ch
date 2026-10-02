// Every screen of the board. Outline data arrives async; screens render "loading" until it lands.
import { ART_ACTIONS, type ArtOn } from "./art-actions";
import { WHO_ACTIONS, type WhoHost } from "./who-actions";
import { registerShellKey } from "./shell-keys";
import { basename } from "node:path";
import type { Art, Cell } from "./ansi";
import { artBlock, cloneGrid, locate, stamp } from "./art-view";
import type { Ctx, Frame, Screen } from "./app";
import { subject, type Caller, type Msg } from "./board";
import { artNamed, find, loadArt, members, packs, type Member } from "./packs";
import type { Activity } from "./socket";
import { bg, C, center, fg, pad, paint, RESET, width } from "./style";
import type { Key } from "./term";
import { heatmap } from "./stats";
import { Desk } from "./desk/desk";
import { River } from "./river/river";
import { DeliveryBoard } from "./desk/delivery";
import { Showcase } from "./showcase/showcase";
import { openScreen } from "./desk/screen-specs";
import { ago, bbsDate, rule, wrap } from "./text";
import { NOTE_ACTIONS, NoteSurface, type HeaderInfo, type SurfaceHost } from "./surface/note";
import { shellRunner } from "./drop";
import { ActionRefused, ActionSet } from "./surface/actions";
import { Dispatcher, type TileRef } from "./surface/dispatch";
import { SHELL_IDLE_MS } from "./whereabouts";
import { AGENT_ACTOR_ID, type Actor, type OutlineEvent } from "./socket";

// ── helpers ──────────────────────────────────────────────────────────────────

const nav = (k: Key, len: number, i: number, page: number) => {
  if (k.kind === "up" || (k.kind === "char" && !k.ctrl && k.ch === "k")) return Math.max(0, i - 1);
  if (k.kind === "down" || (k.kind === "char" && !k.ctrl && k.ch === "j")) return Math.min(len - 1, i + 1);
  if (k.kind === "pgup") return Math.max(0, i - page);
  if (k.kind === "pgdn") return Math.min(len - 1, i + page);
  if (k.kind === "home") return 0;
  if (k.kind === "end") return Math.max(0, len - 1);
  return i;
};
const isBack = (k: Key) => k.kind === "esc" || (k.kind === "char" && !k.ctrl && (k.ch === "q" || k.ch === "Q"));

type Mouse = Extract<Key, { kind: "mouse" }>;
const char = (ch: string): Key => ({ kind: "char", ch });
const ENTER: Key = { kind: "enter" };

/**
 * Something a BBS screen drew that the mouse can use: cells `x0`..`x1` (exclusive) of row `y`, the key a
 * click on it sends, and the item it stands for (a menu entry, a list row) when it has one. `twice`: a
 * list row, where the first click selects and a click on the selected row opens (the board's cards).
 */
interface Spot { y: number; x0: number; x1: number; key?: Key; index?: number; twice?: boolean }

/**
 * The mouse on a BBS screen (PIE-452). Each render records where its menu entries, list rows and hint
 * keys are; a click sends the key the spot stands for back through the screen's own `key()`, so a click
 * and its key are one path. A press on an item selects it; releasing on the same spot is the click (on a
 * list row, only once it was already selected: ⏎). A drag with the button down moves the selection with
 * the pointer (the hover the terminal reports: the door asks for button-event tracking, 1002, not motion
 * without a button). The wheel moves a list's selection a row, as it moves a lane's on the board.
 */
class Pointer {
  private spots: Spot[] = [];
  private down: { spot: Spot; open: boolean } | null = null;
  /** A new frame: what the last one drew is gone. */
  frame() { this.spots = []; }
  spot(s: Spot) { this.spots.push(s); }
  /** A list row: the whole width of row `y` stands for item `index`. */
  row(y: number, index: number, w: number) { this.spot({ y, x0: 0, x1: w, key: ENTER, index, twice: true }); }
  at(x: number, y: number): Spot | undefined { return this.spots.find(s => s.y === y && x >= s.x0 && x < s.x1); }

  /**
   * Hand a mouse event to the spots. `select` moves the screen's selection; `send` runs a key through the
   * screen's key handler. `count` (a list's length) lets the wheel move the selection.
   */
  mouse(k: Mouse, h: { sel: number; count?: number; select(i: number): void; send(k: Key): void }): void {
    if (k.action === "wheel-up" || k.action === "wheel-down") {
      if (h.count) h.select(Math.max(0, Math.min(h.count - 1, h.sel + (k.action === "wheel-down" ? 1 : -1))));
      return;
    }
    const s = this.at(k.x, k.y);
    if (k.action === "down") {
      this.down = null;
      if (!s) return;
      const was = s.index !== undefined && s.index === h.sel;
      if (s.index !== undefined) h.select(s.index);
      this.down = { spot: s, open: !s.twice || was };
      return;
    }
    if (k.action === "drag") {
      const d = this.down;
      if (d && !d.spot.twice && s?.index !== undefined && d.spot.index !== undefined) { h.select(s.index); d.spot = s; d.open = true; }
      return;
    }
    // Released: a click, when it lands where it went down (an up with no press here is someone else's).
    const d = this.down;
    this.down = null;
    if (d?.open && s && s.y === d.spot.y && s.x0 === d.spot.x0 && s.key) h.send(s.key);
  }
}

/**
 * One row of text with clickable parts, `x` cells in (or centred in `w`): each part is text in `paint`'s
 * `|NN` colours, or [text, key] for one a click sends `key` from. The parts are recorded in `p` as row `y`.
 */
/** The mouse over a BBS list: its rows and hint keys (see Pointer), then a repaint unless a key already made one. */
function listMouse(p: Pointer, k: Mouse, ctx: Ctx, sel: number, count: number, select: (i: number) => void, send: (k: Key) => void) {
  let sent = false;
  p.mouse(k, { sel, count, select, send: key => { sent = true; send(key); } });
  if (!sent) ctx.redraw();
}

function hotLine(p: Pointer, y: number, w: number, parts: (string | [string, Key, number?])[], opts: { centre?: boolean; x?: number } = {}): string {
  const text = parts.map(q => (typeof q === "string" ? q : q[0])).join("");
  let x = opts.centre ? Math.max(0, Math.floor((w - width(paint(text))) / 2)) : opts.x ?? 0;
  const out = " ".repeat(x) + paint(text);
  for (const q of parts) {
    const n = width(paint(typeof q === "string" ? q : q[0]));
    if (typeof q !== "string") p.spot({ y, x0: x, x1: x + n, key: q[1], index: q[2] });
    x += n;
  }
  return out;
}

const screenArt = artNamed;

/**
 * Art with live text written into it. Cells mode stamps the text into the grid;
 * graphics mode blanks those cells in the image and draws the text as real terminal text on top.
 */
interface Overlay { row: number; col: number; text: string; fg: number; bg?: number; blank?: number }
function artWithText(ctx: Ctx, key: string, art: Art, overlays: Overlay[], at = { col: 0, row: 0 }): { lines: string[]; frame: Frame["placements"]; rows: number } {
  const grid = cloneGrid(art.rows);
  const left = Math.max(0, Math.floor((ctx.t.cols - art.width) / 2));
  const origin = { col: at.col + left, row: at.row };
  for (const o of overlays) {
    const blankLen = o.blank ?? o.text.length;
    stamp(grid, o.row, o.col, " ".repeat(blankLen), C.grey, 0);
    if (!ctx.graphics) stamp(grid, o.row, o.col, o.text, o.fg, o.bg ?? 0);
  }
  const block = artBlock(grid, art.width, ctx.t, { key, at: origin, maxRows: ctx.t.rows - 1 - at.row, fit: "grid", graphics: ctx.graphics });
  const lines = block.lines.map(l => (ctx.graphics ? l : " ".repeat(origin.col) + l));
  if (ctx.graphics) {
    const byRow = new Map<number, Overlay[]>();
    for (const o of overlays) byRow.set(o.row, [...(byRow.get(o.row) ?? []), o]);
    for (const [row, list] of byRow) {
      if (row >= lines.length) continue;
      let s = "", col = 0;
      for (const o of list.sort((a, b) => a.col - b.col)) {
        s += " ".repeat(Math.max(0, origin.col + o.col - col)) + fg(o.fg) + (o.bg !== undefined ? bg(o.bg) : "") + o.text + RESET;
        col = origin.col + o.col + o.text.length;
      }
      lines[row] = s;
    }
  }
  return { lines, frame: block.placements, rows: block.rowsUsed };
}

// ── logon ────────────────────────────────────────────────────────────────────

export class Logon implements Screen {
  title = "logon";
  readonly noDock = true;
  private shown = 0;
  private readonly script: string[];
  /** `then`: a screen opened over the main menu after the logon (EP0CH_LANDING=brief: the daily brief; welcome: the welcome notes). */
  constructor(ctx: Ctx, private readonly then?: () => Screen) {
    this.script = [
      `ATDT ${ctx.host}`,
      "",
      "CONNECT 28800/ARQ/V34/LAPM/V42BIS",
      "",
      `ep0ch · node 1 · ${ctx.outline ?? ctx.workspace} · outline protocol 80`,
    ];
  }
  private get alias() { return process.env.USER ?? "shypht"; }
  tick() { const total = this.script.join("\n").length + 40; if (this.shown >= total) return false; this.shown += 3; return true; }
  render(ctx: Ctx): Frame {
    const art = screenArt("SHY-LOGI.ANS");
    const fields = art ? [locate(art.rows, "Alias")[0], locate(art.rows, "Password:")[0], locate(art.rows, "Phone")[0]] : [];
    const typed = Math.max(0, this.shown - this.script.join("\n").length);
    const values = [this.alias, "*".repeat(Math.min(8, Math.max(0, typed - this.alias.length))), typed > this.alias.length + 8 ? ctx.host : ""];
    let lines: string[] = [], placements: Frame["placements"] = [], rows = 0;
    if (art) {
      const overlays: Overlay[] = fields.flatMap((f, i) => f ? [{ row: f.row, col: f.col + 11, text: [...values[i]!].slice(0, i === 0 ? typed : 99).join(""), fg: C.white, blank: 30 }] : []);
      ({ lines, frame: placements, rows } = artWithText(ctx, "logon", art, overlays));
    }
    const modem = this.script.join("\n").slice(0, this.shown).split("\n").map(l => `  ${fg(C.lgreen)}${l}${RESET}`);
    lines = [...lines, "", ...modem];
    if (typed > this.alias.length + 12) lines.push("", center(paint("|08press |15ENTER|08 to log on · |15Q|08 to hang up"), ctx.t.cols));
    void rows;
    return { lines, placements };
  }
  /** A click anywhere is ⏎ (it hurries the modem, then logs on); the release is the click. */
  private pressed = false;
  key(k: Key, ctx: Ctx) {
    if (k.kind === "mouse") {
      if (k.action === "down") this.pressed = true;
      else if (k.action === "up" && this.pressed) { this.pressed = false; this.key(ENTER, ctx); }
      return;
    }
    // Esc never logs off (PIE-489): here it only says how. Q is the hang-up the screen offers.
    if (k.kind === "esc") { ctx.flash("ENTER logs on · Q hangs up"); return; }
    if (isBack(k)) return ctx.push(new Goodbye());
    if (k.kind === "enter" || k.kind === "char") {
      const total = this.script.join("\n").length + 40;
      if (this.shown < total) { this.shown = total; ctx.redraw(); return; }
      ctx.replace(new MainMenu());
      if (this.then) ctx.push(this.then());
    }
  }
}

// ── main menu: the real ep0ch menu, with live commands in its "Menu Cmd" slots ─

/**
 * `one`: the class of a screen that keeps state or starts programs when it opens (the desk's terminal tiles,
 * the board's and the river's saved layouts). Only one of it is on the stack: `screen.open` of it while it's
 * already there is refused (an agent's, on top of the person's desk, would start its programs twice).
 */
/** `action`: the item runs a shell action instead of opening a screen (`!`, `screen.shell`). */
interface MenuItem { key: string; label: string; open: (ctx: Ctx) => Screen | null; one?: string; action?: "screen.shell" }

const ITEMS: MenuItem[] = [
  { key: "N", label: "Newscan", open: ctx => new MessageList("new scan", n => ctx.board.changedSince(ctx.lastCall, n, !!ctx.extensionChanges), "since your last call") },
  { key: "J", label: "Join", open: () => new Conferences() },
  { key: "K", label: "Kanban", open: () => new DeliveryBoard(), one: "board" },
  { key: "R", label: "Read", open: ctx => new MessageList("recent", n => ctx.board.changedSince(0, n), "most recently changed") },
  { key: "W", label: "Who's on", open: () => new WhoOnline() },
  { key: "L", label: "Lastcall", open: () => new LastCallers() },
  { key: "F", label: "Files", open: () => new FileAreas() },
  { key: "S", label: "Stats", open: () => new Stats() },
  { key: "Q", label: "Quay", open: () => new River(), one: "river" },
  { key: "B", label: "Bulletin", open: () => new ArtViewer(members(packs().find(p => /woe0497/i.test(p)) ?? packs()[0]!).filter(m => /\.(ans|asc)$/i.test(m.path)), "SHY-EPO!.ANS") },
  { key: "D", label: "Desk", open: () => openScreen("desk"), one: "desk" },
  { key: "G", label: "Goodbye", open: () => new Goodbye() },
  // The menu art has twelve slots: the showcase (PIE-439) is on its key line and its X key only.
  { key: "X", label: "Showcase", open: () => new Showcase(), one: "showcase" },
  // The daily brief (PIE-435), on the key line too: T for today (B is the Bulletin).
  { key: "T", label: "Today", open: () => openScreen("brief"), one: "brief" },
  // float-hub's own views: its outbox items still waiting, and the welcome notes ([welcome::1]…; without
  // any, the agents' [[claude-now]] page, which C pinned before).
  { key: "O", label: "Waiting", open: () => openScreen("waiting"), one: "waiting" },
  { key: "C", label: "Welcome", open: () => openScreen("welcome"), one: "welcome" },
  // Drop to shell, the BBS's drop to DOS: the person's login shell in their terminal, the door back when it exits.
  { key: "!", label: "Shell", open: () => null, action: "screen.shell" },
];

/** Every screen the menu opens, by its key: what the parity test (PIE-506) presses every key on. */
export const MENU_SCREENS: [string, (ctx: Ctx) => Screen | null][] = ITEMS.map(i => [i.key, i.open]);

export class MainMenu implements Screen {
  title = "main menu";
  private sel = 0;
  private readonly ptr = new Pointer();
  render(ctx: Ctx): Frame {
    this.ptr.frame();
    const art = screenArt("SHY-EMNU.ANS");
    if (!art) return new Help().render(ctx, this.ptr);
    const slots = locate(art.rows, "Menu Cmd").sort((a, b) => a.row - b.row || a.col - b.col);
    // Read the slots column by column, the way the eye scans a three-column menu.
    const ordered = [...slots].sort((a, b) => a.col - b.col || a.row - b.row);
    const overlays: Overlay[] = [];
    ordered.forEach((s, i) => {
      const item = ITEMS[i];
      if (!item) return;
      const on = i === this.sel;
      const label = item.label.padEnd(8).slice(0, 8);
      if (on) overlays.push({ row: s.row, col: s.col, text: label, fg: C.white, bg: C.magenta });
      else {
        const hot = label.toUpperCase().indexOf(item.key);
        overlays.push({ row: s.row, col: s.col, text: label, fg: C.lmagenta });
        if (hot >= 0) overlays.push({ row: s.row, col: s.col + hot, text: label[hot]!, fg: C.white, blank: 1 });
      }
    });
    // Two overlays on the same cells: keep the highlight letter by merging into one run per slot.
    const merged = mergeOverlays(overlays);
    const { lines, frame, rows } = artWithText(ctx, "menu", art, merged);
    // Each slot the art shows is its item's place for the mouse (a short pane cuts the art, and its slots).
    const left = Math.max(0, Math.floor((ctx.t.cols - art.width) / 2));
    ordered.forEach((s, i) => { const item = ITEMS[i]; if (item && s.row < rows) this.ptr.spot({ y: s.row, x0: left + s.col, x1: left + s.col + 8, key: char(item.key), index: i }); });
    const item = ITEMS[this.sel]!;
    const slotted = Math.min(ordered.length, ITEMS.length);
    lines.push("");
    // The key line: every key, each one clickable; the items without a slot in the art (the showcase and
    // today's brief) are named there, and lit when they're the one selected.
    const keys: (string | [string, Key, number])[] = [
      "|09[|15ep0ch|09] |11main menu |08(",
      ...ITEMS.slice(0, slotted).map((i, n): [string, Key, number] => [`${n === this.sel ? "|15" : "|07"}${i.key}`, char(i.key), n]),
      "|08)",
    ];
    const extras = ITEMS.slice(slotted).flatMap((i, j): (string | [string, Key, number])[] => {
      const n = slotted + j, on = n === this.sel;
      return [" |08· ", [on ? `${bg(C.magenta)}|15${i.key} ${i.label}${RESET}` : `|15${i.key} |13${i.label}`, char(i.key), n]];
    });
    // The lit item's name at the width of the longest, so the line (and every key on it) stays put as it changes.
    const lit = ` |07: |15${item.label.padEnd(Math.max(...ITEMS.map(i => i.label.length)))}`;
    const all = [...keys, ...extras, lit];
    // Too wide for one line (80 columns): the named items go on a line of their own under the keys.
    if (width(paint(all.map(q => (typeof q === "string" ? q : q[0])).join(""))) <= ctx.t.cols) lines.push(hotLine(this.ptr, lines.length, ctx.t.cols, all, { centre: true }));
    else {
      lines.push(hotLine(this.ptr, lines.length, ctx.t.cols, [...keys, lit], { centre: true }));
      lines.push(hotLine(this.ptr, lines.length, ctx.t.cols, extras.slice(1), { centre: true }));
    }
    lines.push(center(paint(`|08${ctx.events ? `|14changes on the outline since you logged on: ${ctx.events} · ` : ""}last call ${ctx.lastCall ? bbsDate(ctx.lastCall) : "never"}`), ctx.t.cols));
    return { lines, placements: frame };
  }
  key(k: Key, ctx: Ctx): void {
    this.ctx = ctx;
    if (k.kind === "mouse") {
      // The wheel is ↑ ↓; a click on an item is its key (see Pointer).
      if (k.action === "wheel-up" || k.action === "wheel-down") return this.key({ kind: k.action === "wheel-up" ? "up" : "down" }, ctx);
      let sent = false;
      this.ptr.mouse(k, { sel: this.sel, select: i => { if (i !== this.sel) this.run("menu.select", { name: ITEMS[i]!.key }, ctx); }, send: key => { sent = true; this.key(key, ctx); } });
      if (!sent) ctx.redraw();
      return;
    }
    const by = k.kind === "left" ? -4 : k.kind === "right" ? 4 : k.kind === "up" ? -1 : k.kind === "down" || k.kind === "tab" ? 1 : 0;
    if (by) return this.run("menu.select", { by }, ctx);
    else if (k.kind === "enter") return this.open(ITEMS[this.sel]!, ctx);
    // Esc is back, as everywhere; the menu is the top, so it stays here and says so (PIE-489). Goodbye is
    // G (or a click on it). q stays the menu's own letter, the Quay, as it always was: there's nothing to
    // go back to from here, and q → Quay is in the fingers.
    else if (k.kind === "esc") return shellKey("screen.back", {}, this, ctx);
    else if (k.kind === "char" && !k.ctrl && k.ch.toUpperCase() === "V") return shellKey("video.cycle", {}, this, ctx);
    else if (k.kind === "char" && !k.ctrl && k.ch === "?") return shellKey("screen.help", {}, this, ctx);
    else if (k.kind === "char" && !k.ctrl) {
      const hit = ITEMS.findIndex(i => i.key === k.ch.toUpperCase());
      if (hit >= 0) return this.open(ITEMS[hit]!, ctx);
    }
    ctx.redraw();
  }
  /** A menu item, by key, ⏎ or click: `screen.open`, as an agent's is. */
  private open(item: MenuItem, ctx: Ctx) { shellKey("screen.open", { name: item.key }, this, ctx); }
  /** The person's arrows, Tab and press on an item: the menu's own actions, as `you`. */
  private run<K extends keyof MenuArgs & string>(name: K, args: MenuArgs[K], ctx: Ctx) {
    this.ctx = ctx;
    void this.dispatch.press(name, args);
  }
  /** The lit item (0-based), for MENU_ACTIONS. */
  get selected() { return this.sel; }
  set selected(i: number) { this.sel = ((i % ITEMS.length) + ITEMS.length) % ITEMS.length; }
  private ctx: Ctx | null = null;
  enter(ctx: Ctx) { this.ctx = ctx; }
  describe() { return { kind: "main menu", selected: ITEMS[this.sel]!.key, items: ITEMS.map(i => `${i.key} ${i.label}`) }; }
  readonly dispatch = new Dispatcher({ title: this.title, ctx: () => this.ctx }, [
    { set: MENU_ACTIONS, takes: "none", on: (_, how) => { if (!this.ctx) throw new ActionRefused("the main menu isn't shown yet"); return { menu: this, ctx: how.ctx }; } },
  ]);
}

/** Open a menu item's screen over the current one; the screen opened. */
function openItem(item: MenuItem, ctx: Ctx): Screen | null {
  const s = item.open(ctx);
  if (s) ctx.push(s); else ctx.redraw();
  return s;
}

// ── the main menu's own action: which item is lit (PIE-506) ─────────────────

type MenuArgs = { "menu.select": { name?: string; by?: number } };
/** The main menu's lit item: its arrows, Tab and a press on an item run this, as `act` does. */
export const MENU_ACTIONS = new ActionSet<MenuArgs, { menu: MainMenu; ctx: Ctx }>("menu", {
  "menu.select": {
    summary: "light a menu item: name=<its key or label>, or by=<steps> (↑↓ one, ←→ a column of four); ⏎ or its letter opens it (screen.open). An agent's waits until the person is idle and is said on the status bar",
    keys: "↑ ↓ ← → tab, the wheel, click on an item (lit as it is pressed)",
    touches: "screen", replay: "safe", says: out => `· lit ${out.label} on the menu · ⏎ opens it`,
    args: { name: { type: "string", optional: true, about: "the item's key (S) or label (Stats)" }, by: { type: "number", optional: true, about: "steps from the lit item: 1 down, -1 up, 4 a column right" } },
    run({ name, by }, { menu, ctx }) {
      if ((name === undefined) === (by === undefined)) throw new ActionRefused("menu.select takes name=<item> or by=<steps>, one of them");
      const at = name !== undefined ? ITEMS.indexOf(itemNamed(name)!) : menu.selected + by!;
      if (name !== undefined && at < 0) throw new ActionRefused(`no item ${JSON.stringify(name)} on the menu; screen.list lists them`);
      menu.selected = at;
      const item = ITEMS[menu.selected]!;
      ctx.redraw();
      return { selected: item.key, label: item.label };
    },
  },
});

// ── the shell's actions (PIE-489): open a screen, go back, list them; on every screen ─

/**
 * What the shell's actions run on: the door, the screen they act from (the top one), and `again`: another action run
 * through the same dispatcher as the same actor (a menu item that is another action's key, the Shell item's `!`).
 */
export interface ShellOn { ctx: Ctx; here?: Screen; again?(name: string, args: Record<string, unknown>): Promise<unknown> }

export { SHELL_IDLE_MS };

/**
 * Leaving a screen for an agent, past the actor rule (PIE-514: `touches: "screen"`, never while the person types or
 * within SHELL_IDLE_MS of their last key): never one holding unsaved text, never one that can't be left. The person's
 * own leaving asks them instead (App.pop).
 */
function agentMayLeave(here: Screen | undefined) {
  if (here?.unsaved?.()) throw new ActionRefused(`the ${here.title} holds unsaved text; not left`);
  const refusal = here?.leaveRefusal?.();
  if (refusal) throw new ActionRefused(refusal);
}

/** A menu item by its key (`S`), its label (`Stats`) or another name for its screen (`board stats`, `river`). */
function itemNamed(name: string): MenuItem | undefined {
  const n = name.trim().toLowerCase();
  return ITEMS.find(i => i.key.toLowerCase() === n) ?? ITEMS.find(i => i.label.toLowerCase() === n || SCREEN_NAMES[i.key]?.includes(n));
}
/** Other names for what a menu item opens: its screen's title and the words the README uses. */
const SCREEN_NAMES: Record<string, string[]> = {
  N: ["new scan", "newscan"], J: ["join conference", "conferences"], K: ["kanban", "board"], R: ["recent"], W: ["who's online", "who"],
  L: ["last callers"], F: ["file areas"], S: ["board stats"], Q: ["quay", "river"], B: ["art"], D: ["desk"], G: ["goodbye", "logoff", "log off"],
  X: ["showcase"], T: ["today", "brief"], O: ["waiting"], C: ["welcome", "claude-now"], "!": ["drop to shell", "dos"],
};

type ShellArgs = {
  "screen.open": { name: string }; "screen.back": Record<string, never>; "screen.list": Record<string, never>; "screen.shell": Record<string, never>;
  "screen.help": Record<string, never>; "video.cycle": Record<string, never>; "changes.extensions": { include?: boolean };
  "open": { id: string };
};

/** The shell's actions: the menu's letters, ⏎ and clicks, and q/Esc on every BBS screen, run these, as `act` does. */
export const SHELL_ACTIONS = new ActionSet<ShellArgs, ShellOn>("shell", {
  "changes.extensions": {
    summary: "whether \"what changed\" (the status bar's +N new, the new scan) includes what extensions wrote (a refreshed Jira ticket, `ext:…`); include=true or false sets it, else it toggles. Off by default. The person's view: an agent's is refused",
    keys: "a click on the status bar's +N ext",
    touches: "screen", replay: "safe",
    person: "what the person's \"what changed\" shows is theirs; an agent reads changes itself (changes.since, activity.recent with extensions)",
    args: { include: { type: "boolean", optional: true, about: "true to include extension changes, false to leave them out; default: toggle" } },
    run({ include }, { ctx }) {
      ctx.extensionChanges = include ?? !ctx.extensionChanges;
      ctx.events = (ctx.events ?? 0) + (ctx.extensionChanges ? (ctx.extEvents ?? 0) : -(ctx.extEvents ?? 0));
      if (ctx.events < 0) ctx.events = 0;
      ctx.flash(ctx.extensionChanges ? "what changed includes extension writes (refreshed tickets)" : "what changed leaves extension writes out");
      ctx.redraw();
      return { include: ctx.extensionChanges };
    },
  },
  "screen.open": {
    summary: "open a screen from the main menu over the current one (q comes back); an agent's waits until the person is idle and is said on the status bar", keys: "the menu's letters N J K R W L F S Q B D G X T O C, or n j k r w l f s q b d g x t o c, ⏎, click on a menu item or its letter on the key line",
    touches: "screen", replay: "safe", says: out => (out?.key ? { text: `· opened ${out.opened ?? out.key} · q goes back`, ms: 6000 } : null),
    args: { name: { type: "string", about: "the menu key (S), its label (Stats) or the screen's title (board stats)" } },
    run({ name }, { ctx, here, again }, actor): unknown {
      const item = itemNamed(name);
      if (!item) throw new ActionRefused(`no screen ${JSON.stringify(name)} on the menu; screen.list lists them`);
      // Logging off is the person's G alone (an agent's never ends their session).
      if (item.key === "G" && actor.kind === "agent") throw new ActionRefused("an agent doesn't log the person off; only G, pressed or clicked by them, does");
      // An item that is another action's key (the Shell's !) runs that action, through the dispatcher, as the same actor.
      if (item.action) return again ? again(item.action, {}) : Promise.reject(new ActionRefused(`${item.action} runs from the door's own dispatcher`));
      // The menu lights what it opens, so coming back it's where the person left it.
      if (here instanceof MainMenu) here.selected = ITEMS.indexOf(item);
      // By name: the brief, Waiting and the welcome are desks too (PIE-515: specs on it), and each is its own screen.
      const open = item.one && ctx.screens?.().find(x => x.name === item.one);
      if (open) throw new ActionRefused(`the ${open.title} is already open${open === here ? "" : " under this screen; screen.back gets back to it"}`);
      const s = openItem(item, ctx);
      return { opened: s?.title ?? item.label, key: item.key };
    },
  },
  "screen.back": {
    summary: "leave this screen for the one under it (the main menu is the top: there it stays; G logs off)", keys: "q Q, Esc, click on Q back; ⏎ on Who's online and Stats; any key on the help screen (on the main menu, Esc only: q there is the Quay)",
    touches: "screen", replay: "safe", says: out => (out?.from ? { text: `· went back from the ${out.from} to the ${out.to}`, ms: 6000 } : null),
    args: {},
    run(_, { ctx, here }, actor) {
      // Back from the main menu is logging off: the person's G alone.
      if (here instanceof MainMenu) {
        if (actor.kind === "agent") throw new ActionRefused("already at the main menu; an agent doesn't log the person off");
        ctx.flash("you're at the main menu · G logs off");
        return { at: here.title };
      }
      if (actor.kind === "agent") agentMayLeave(here);
      const from = here?.title ?? null;
      ctx.pop();
      const to = ctx.screens?.().at(-1)?.title ?? null;
      return { from, to };
    },
  },
  "screen.shell": {
    summary: "drop to shell (the BBS's drop to DOS): the door steps aside for the person's login shell ($SHELL -l) in their own terminal, in the door's folder, with EP0CH_IN_DOOR, EP0CH_CONTROL and EP0CH_NEST set; exit returns to the door where it was, its tiles running meanwhile. The person's only: an agent's is refused",
    keys: "! on the main menu (or a click on Shell on its key line), ^W ! on the desk",
    touches: "screen", replay: "ask",
    person: "an agent doesn't drop the person to a shell: it would take their terminal. For a shell of your own, open a terminal tile on the desk (tile.open kind=pty)",
    args: {},
    async run(_, { ctx }) {
      const away = ctx.suspended?.();
      if (away) throw new ActionRefused(`the terminal is already handed over (${away})`);
      let code: number | null = null;
      await ctx.suspend(async () => { code = await shellRunner.run(); }, "shell");
      ctx.flash(code === 0 ? "back from the shell" : `back from the shell · it exited ${code ?? "on a signal"}`);
      return { exited: code };
    },
  },
  "screen.help": {
    summary: "open the help screen over this one: every menu item and what it does (any key goes back); an agent's waits until the person is idle and is said on the status bar", keys: "? on the main menu",
    touches: "screen", replay: "safe", says: () => ({ text: "· opened help · any key goes back", ms: 6000 }),
    args: {},
    run(_, { ctx }) {
      ctx.push(new Help());
      return { opened: "help" };
    },
  },
  "video.cycle": {
    summary: "the next video mode: Kitty+CRT, Kitty, plain cells (the person's display: an agent's waits until they're idle and is said on the status bar)", keys: "V on the menu, the board, the desk, the river, the showcase and the views; v in the art viewer, or click on its v video",
    touches: "screen", replay: "safe", says: out => `· switched the video to ${out.video}`,
    args: {},
    run(_, { ctx }) {
      ctx.cycleVideo();
      ctx.redraw();
      return { video: ctx.video };
    },
  },
  "open": {
    summary: "put a note in front of the person (`ep0ch open <id>` is this). A screen with an open of its own (the desk, the board, the river, the views) runs that instead; elsewhere a message reader opens over the screen (a message reader's opens another). An agent's waits until the person is idle, never takes their keys, never lands over what they're typing, and is said on the status bar",
    touches: "screen", replay: "safe",
    args: { id: { type: "string", about: "the block id" } },
    async run({ id }, { ctx, here }) {
      const m = await ctx.board.get(id);
      if (!m) throw new ActionRefused(`no block ${id}`);
      // The screens that reach here (a message reader, the showcase) change what's in front of the person: the
      // idle wait and the rest of the actor rule, as for a screen change. (The desk, the board, the welcome, the
      // brief and the river have an open of their own and never get here.)
      if (here?.openBlock) here.openBlock(m);
      else shellOpenBlock(m, ctx);
      ctx.flash(`opened: ${subject(m).slice(0, 60)}`);
      ctx.redraw();
      return { opened: m.id, id: m.id, screen: ctx.screens?.().at(-1)?.title ?? null };
    },
  },
  "screen.list": {
    summary: "the screens the menu opens (key, label, what it is) and the stack the person is on, bottom first",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { ctx }) {
      return { stack: (ctx.screens?.() ?? []).map(s => s.title), screens: ITEMS.map(i => ({ key: i.key, label: i.label, about: HELP[i.key] ?? "" })) };
    },
  },
});

/**
 * A person's key or click: the shell's action, as `you`, through a dispatcher of the shell's set for the screen it's
 * pressed on (inside a frame, the frame's screens); a refusal is said on the status bar. Any screen's q, Esc and V run these.
 */
export function shellKey<K extends keyof ShellArgs & string>(name: K, args: ShellArgs[K], here: Screen, ctx: Ctx) {
  // One dispatcher per screen, made the first time it runs a shell key and kept with it (never one per key).
  let s = shells.get(here);
  if (!s) {
    const e: { ctx: Ctx; d: Dispatcher } = { ctx, d: null as unknown as Dispatcher };
    e.d = new Dispatcher({ get title() { return here.title; }, ctx: () => e.ctx }, [{ set: SHELL_ACTIONS, takes: "none", on: (_, how) => ({ ctx: how.ctx, here, again: (n: string, a: Record<string, unknown>) => e.d.press(n, a) }) }]);
    shells.set(here, s = e);
  }
  s.ctx = ctx;
  void s.d.press(name, args);
}
/** Each screen's shell dispatcher (`shellKey`), and the context it's shown in now (the door's, or a frame's). */
const shells = new WeakMap<Screen, { ctx: Ctx; d: Dispatcher }>();

// The desk and the showcase run q, Esc and V through this too (they can't import this module back).
registerShellKey(shellKey);

/** Drop to shell by the person's key or click (the menu's `!`, the desk's `^W !`): `screen.shell`. */
export const dropToShell = (here: Screen, ctx: Ctx) => shellKey("screen.shell", {}, here, ctx);

/** q and Esc on a BBS screen: `screen.back`. */
const back = (here: Screen, ctx: Ctx) => shellKey("screen.back", {}, here, ctx);

/** `open <id>` on a screen with no readers of its own (the menu, a list): a message reader over it. */
export function shellOpenBlock(m: Msg, ctx: Ctx) {
  ctx.push(new MessageReader([m], 0));
}

// ── the BBS lists' actions: select, open, read (PIE-489) ─────────────────────

/** One row of a BBS list, as `list.read` gives it. */
export interface ListRow { n: number; title: string; id?: string; [k: string]: unknown }

/** A BBS list screen: its rows, the lit one, and what ⏎ on a row opens. */
interface BbsList extends Screen {
  sel: number;
  /** The screen's context, kept from enter, render and key (never an agent's). */
  ctx: Ctx | null;
  readonly dispatch: Dispatcher;
  listRows(): ListRow[] | null;
  /** ⏎ on row `i`: the screen it opens, pushed; or a refusal. */
  openRow(i: number, ctx: Ctx): void;
  /** `t` on row `i`: its replies as a list, pushed; absent on a list whose rows have none. */
  threadRow?(i: number, ctx: Ctx): void;
}
interface ListOn { list: BbsList; ctx: Ctx }
type ListArgs = { "list.select": { n: number }; "list.open": { n?: number }; "list.read": { from?: number; limit?: number }; "list.thread": { n?: number } };

const rowsOf = (list: BbsList) => {
  const rows = list.listRows();
  if (!rows) throw new ActionRefused(`the ${list.title} is still loading`);
  return rows;
};
const rowAt = (list: BbsList, n: number) => {
  const rows = rowsOf(list);
  if (!rows.length) throw new ActionRefused(`the ${list.title} is empty`);
  if (!Number.isInteger(n) || n < 1 || n > rows.length) throw new ActionRefused(`the ${list.title} has ${rows.length} row${rows.length === 1 ? "" : "s"}; n is 1-${rows.length}, not ${n}`);
  return rows[n - 1]!;
};

/** The lists' actions: j k ↑↓ PgUp PgDn and the wheel run list.select, ⏎ and a click on the lit row list.open. */
export const LIST_ACTIONS = new ActionSet<ListArgs, ListOn>("list", {
  "list.select": {
    summary: "light row n of the list (an agent's waits until the person is idle and is said on the status bar)", keys: "j k ↑↓ PgUp PgDn Home End, a click, the wheel",
    touches: "screen", replay: "safe", says: out => `· lit row ${out.selected}: ${out.row.title.slice(0, 50)}`,
    args: { n: { type: "number", about: "the row, from 1 (list.read numbers them)" } },
    run({ n }, { list, ctx }) {
      const row = rowAt(list, n);
      list.sel = n - 1;
      ctx.redraw();
      return { selected: n, row };
    },
  },
  "list.open": {
    summary: "open a row as ⏎ does (read, join, browse): the lit one, or row n", keys: "⏎, a click on the lit row",
    touches: "screen", replay: "safe", says: out => ({ text: `· opened row ${out.n}: ${out.row.title.slice(0, 50)} · q goes back`, ms: 6000 }),
    args: { n: { type: "number", optional: true, about: "the row, from 1; the lit one when left out" } },
    run({ n }, { list, ctx }) {
      const at = n ?? list.sel + 1;
      const row = rowAt(list, at);
      const was = list.sel;
      list.sel = at - 1;
      // A row that opens nothing (a pack with no art) is refused, and the light goes back where it was.
      try { list.openRow(at - 1, ctx); } catch (e) { list.sel = was; throw e; }
      const opened = ctx.screens?.().at(-1);
      return { opened: opened && opened !== list ? opened.title : null, n: at, row };
    },
  },
  "list.thread": {
    summary: "list a row's replies (its children) as messages over this list, as t does on a message list: the lit row, or row n (q comes back)", keys: "t, T, click on T thread",
    touches: "screen", replay: "safe", says: out => ({ text: `· opened the replies of row ${out.n}: ${out.row.title.slice(0, 50)} · q goes back`, ms: 6000 }),
    args: { n: { type: "number", optional: true, about: "the row, from 1; the lit one when left out" } },
    run({ n }, { list, ctx }) {
      if (!list.threadRow) throw new ActionRefused(`the ${list.title}'s rows have no threads; list.open opens a row`);
      const at = n ?? list.sel + 1;
      const row = rowAt(list, at);
      list.threadRow(at - 1, ctx);
      return { opened: ctx.screens?.().at(-1)?.title ?? null, n: at, row };
    },
  },
  "list.read": {
    summary: "the list's rows (numbered from 1) and which one is lit; moves nothing",
    touches: "nothing", replay: "safe",
    args: { from: { type: "number", optional: true, about: "the first row, from 1 (default 1)" }, limit: { type: "number", optional: true, about: "how many rows (default 100)" } },
    run({ from, limit }, { list }) {
      const rows = rowsOf(list);
      const start = Math.max(1, from ?? 1);
      return { screen: list.title, selected: rows.length ? list.sel + 1 : null, of: rows.length, rows: rows.slice(start - 1, start - 1 + Math.max(1, limit ?? 100)) };
    },
  },
});

/** A list's keys and clicks: the same actions, as `you`, through the list's dispatcher. */
function listKey<K extends keyof ListArgs & string>(list: BbsList, name: K, args: ListArgs[K], ctx: Ctx) {
  list.ctx = ctx;
  void list.dispatch.press(name, args);
}

/** A list's keys: q Esc back, ⏎ open, the movement keys select. False when the key isn't one of these. */
function listKeys(list: BbsList, k: Key, ctx: Ctx, page: number): boolean {
  if (isBack(k)) { back(list, ctx); return true; }
  const count = list.listRows()?.length ?? 0;
  if (!count) return false;
  if (k.kind === "enter") { listKey(list, "list.open", {}, ctx); return true; }
  const to = nav(k, count, list.sel, page);
  if (to !== list.sel) { listKey(list, "list.select", { n: to + 1 }, ctx); return true; }
  return false;
}

/** What a list shows, for `peek`: the lit row and the first rows (list.read has them all). */
function listDescribe(list: BbsList) {
  const rows = list.listRows();
  return { kind: "list", title: list.title, selected: rows?.length ? list.sel + 1 : null, of: rows?.length ?? null, rows: rows?.slice(0, 20) ?? null };
}

/** A list screen's dispatcher: the list's actions (the shell's come from the App's). */
function listDispatch(list: BbsList): Dispatcher {
  // `title` read when asked: a list's is set in its constructor, after its fields (this dispatcher among them).
  return new Dispatcher({ get title() { return list.title; }, ctx: () => list.ctx }, [{
    set: LIST_ACTIONS, takes: "none",
    on: (_, how) => { if (!list.ctx) throw new ActionRefused(`the ${list.title} isn't shown yet`); return { list, ctx: how.ctx }; },
  }]);
}

function mergeOverlays(list: Overlay[]): Overlay[] {
  // Later single-letter overlays land inside an earlier label; split the label around them.
  const out: Overlay[] = [];
  for (const o of list) {
    const host = out.find(h => h.row === o.row && o.col >= h.col && o.col < h.col + h.text.length && h !== o);
    if (!host || o.text.length !== 1) { out.push({ ...o }); continue; }
    const cut = o.col - host.col;
    const tail = host.text.slice(cut + 1);
    const blank = host.blank ?? host.text.length;
    host.text = host.text.slice(0, cut);
    host.blank = cut;
    out.push({ ...o, blank: 1 });
    if (tail) out.push({ row: host.row, col: o.col + 1, text: tail, fg: host.fg, bg: host.bg, blank: blank - cut - 1 });
  }
  return out.filter(o => o.text.length || (o.blank ?? 0) > 0);
}

// ── message lists and the reader ─────────────────────────────────────────────

export class MessageList implements BbsList {
  private items: Msg[] | null = null;
  private error = "";
  sel = 0;
  ctx: Ctx | null = null;
  private receiving: { started: number; limit: number } | null = null;
  private readonly ptr = new Pointer();
  /** `paged` loaders take a limit: a quick first page, then the full scan behind it. */
  constructor(readonly title: string, private readonly load: (limit: number) => Promise<Msg[]>, private readonly caption = "", private readonly paged = true) {}
  enter(ctx: Ctx) {
    this.ctx = ctx;
    const fail = (e: any) => { this.error = String(e?.message ?? e); this.receiving = null; ctx.redraw(); };
    if (!this.paged) { this.load(0).then(m => { this.items = m; ctx.redraw(); }, fail); return; }
    this.load(40).then(first => {
      this.items = first; ctx.redraw();
      if (first.length < 40) return;
      this.receiving = { started: Date.now(), limit: 400 };
      this.load(400).then(all => { this.items = all; this.receiving = null; ctx.redraw(); }, fail);
    }, fail);
  }
  tick() { return this.receiving !== null; }
  render(ctx: Ctx): Frame {
    const w = ctx.t.cols, h = ctx.t.rows - 1;
    this.ptr.frame();
    const lines = [
      center(paint(`|09─=|11[ |15${this.title.toUpperCase()} |11]|09=─`), w),
      center(paint(`|08${this.items ? `${this.items.length} message(s)` : "scanning…"}${this.caption ? ` · ${this.caption}` : ""}${this.receiving ? ` · |14receiving up to ${this.receiving.limit} ${"▒▓█▓"[Math.floor(Date.now() / 150) % 4]} ${((Date.now() - this.receiving.started) / 1000).toFixed(1)}s` : ""}`), w),
      "",
      paint(`|09  Msg#  |09From              |09Subject${" ".repeat(Math.max(0, w - 62))}|09Date`),
      rule(w),
    ];
    if (this.error) lines.push(paint(`|12  ${this.error}`));
    const list = this.items ?? [];
    if (this.items && !list.length) lines.push("", center(paint("|11No new messages. |08Press |15Q|08, then |15R|08 to read the latest."), w));
    const page = h - lines.length - 2;
    const start = Math.max(0, Math.min(this.sel - Math.floor(page / 2), list.length - page));
    list.slice(start, start + page).forEach((m, i) => {
      const n = start + i;
      this.ptr.row(lines.length, n, w);
      const num = (m.props["work-id"] ?? String(n + 1)).padStart(7).slice(-7);
      const row = ` ${num}  ${pad(m.author ?? "?", 17)} ${pad(subject(m), Math.max(10, w - 52))} ${bbsDate(m.updatedAt)}`;
      lines.push(n === this.sel ? bg(C.blue) + fg(C.white) + pad(row, w) + RESET : fg(C.lcyan) + num.padStart(8) + fg(C.brown) + "  " + pad(m.author ?? "?", 17) + " " + fg(C.grey) + pad(subject(m), Math.max(10, w - 52)) + " " + fg(C.dark) + bbsDate(m.updatedAt) + RESET);
    });
    while (lines.length < h - 1) lines.push("");
    lines.push(hotLine(this.ptr, lines.length, w, ["|08  ↑↓ select · ", ["|15ENTER|08 read", ENTER], " · ", ["|15T|08 thread", char("t")], " · ", ["|15Q|08 back", char("q")]]));
    return { lines };
  }
  key(k: Key, ctx: Ctx) {
    this.ctx = ctx;
    const list = this.items ?? [];
    if (k.kind === "mouse") return listMouse(this.ptr, k, ctx, this.sel, list.length, i => listKey(this, "list.select", { n: i + 1 }, ctx), key => this.key(key, ctx));
    if (listKeys(this, k, ctx, ctx.t.rows - 10)) return;
    if (!list.length) return;
    if (k.kind === "char" && !k.ctrl && k.ch.toLowerCase() === "t") return listKey(this, "list.thread", {}, ctx);
    ctx.redraw();
  }
  threadRow(i: number, ctx: Ctx) {
    const m = this.items![i]!;
    ctx.push(new MessageList(`thread: ${subject(m).slice(0, 30)}`, () => ctx.board.children(m.id), "", false));
  }
  listRows(): ListRow[] | null {
    return this.items?.map((m, i) => ({ n: i + 1, title: subject(m), id: m.id, author: m.author ?? null, updatedAt: m.updatedAt, ...(m.props["work-id"] ? { workId: m.props["work-id"] } : {}) })) ?? null;
  }
  openRow(i: number, ctx: Ctx) { ctx.push(new MessageReader(this.items!, i)); }
  describe() { return listDescribe(this); }
  readonly dispatch: Dispatcher = listDispatch(this);
}

/** What a message reader's own actions (MESSAGE_ACTIONS) run on. */
interface MessageOn { r: MessageReader; ctx: Ctx; actor: Actor }

/**
 * The BBS message reader (PIE-426): the BBS message header (Date, To, From, Subj, Conf, Stat) over the
 * shared note surface (src/surface/note.ts), hosted through SurfaceHost as the board, the desk and the
 * river host it. The surface draws, folds, edits and comments on the message, steps through its links
 * and other elements (`[ ]`, ⏎, a click), selects and copies, and takes agents' note actions; the
 * reader adds the BBS keys (next, previous, thread) and opens a followed link as the next reader on the
 * screen stack, the way `U` always opened the message above.
 */
export class MessageReader implements Screen {
  title = "reading";
  readonly surface = new NoteSurface();
  private replies: { for: string; n: number | null } | null = null;
  private shown = false;
  private ctx: Ctx | null = null;
  constructor(private readonly list: Msg[], private index: number) {}

  private get msg() { return this.list[this.index]!; }
  /** What the person is in here, for a refusal: "an edit", "a comment", "the property panel". */
  personIn(): string { const w = this.surface.sessionWord() ?? "property panel"; return w === "property panel" ? "the property panel" : `${w === "edit" ? "an" : "a"} ${w}`; }

  /** The surface's host: this screen, its header, and where a followed link opens (the next reader on the stack). */
  host(ctx: Ctx): SurfaceHost {
    return {
      ctx,
      redraw: () => ctx.redraw(),
      navigate: (m, how) => {
        // An agent never takes the person's keys: while they're in an edit, a comment or the panel here,
        // what it followed is named, not opened over them.
        if (how?.by?.kind === "agent" && this.surface.holdsKeys) { ctx.flash(`not opened while you're in ${this.personIn()}: ${subject(m).slice(0, 50)}`); return; }
        ctx.push(new MessageReader([m], 0));
      },
      header: (m, w, info) => this.header(m, w, info),
      // What the surface doesn't take is the BBS reader's: next, previous, the thread, back.
      ownKeys: "nNpPtTqQU",
      // Its own keys and clicks run its note actions through the reader's dispatcher.
      press: (name, args, quiet, given) => this.dispatch.pressIn(NOTE_ACTIONS, name, args, READER, quiet, given),
    };
  }

  /** The BBS message header, from the note the surface shows (the whole one once a list row is read). */
  private header(m: Msg, w: number, info: HeaderInfo): string[] {
    const status = m.props.status ?? m.props.type ?? "public message";
    const replies = this.replies?.for === m.id ? this.replies.n : null;
    const c = info.comments;
    const comments = c?.total ? ` |08· ${c.open ? `|14■ ${c.open} open comment${c.open === 1 ? "" : "s"}` : `■ ${c.total} resolved`} |08(m)` : "";
    const props = info.properties ? ` |08· i ${info.properties} propert${info.properties === 1 ? "y" : "ies"}` : "";
    return [
      paint(`|09Date: |07${bbsDate(m.updatedAt).padEnd(24)}|09Number: |15${m.props["work-id"] ?? m.id.slice(0, 8)} |08(${this.index + 1} of ${this.list.length})`),
      // Addressed with a `to::` property, else to everyone, as a BBS message is.
      paint(`|09  To: |07${pad(m.props.to?.trim() || "ALL", 24)}|09Refer#: |07${m.parentId?.slice(0, 8) ?? "none"}`),
      paint(`|09From: |14${pad(m.author ?? "?", 23)} |09Reply: |07${replies === null ? "…" : replies}`),
      paint(`|09Subj: |15${subject(m).slice(0, Math.max(1, w - 6))}`),
      paint(`|09Conf: |11${pad(info.crumbs, Math.max(1, w - 6))}`),
      paint(`|09Stat: |13${status.toUpperCase()}${props}${comments}`),
    ].map(l => pad(l, w));
  }

  // The screen's own ctx is kept from enter, render and key: never an agent's (asActor), which only lasts for its action.
  enter(ctx: Ctx) { this.ctx = ctx; this.open(ctx); }

  /** Show the message at `index` in the surface; false while an edit, a comment or a value being typed holds it. */
  private open(ctx: Ctx): boolean {
    this.shown = true;
    if (!this.surface.show(this.msg, this.host(ctx))) return false;
    const id = this.msg.id;
    this.replies = { for: id, n: null };
    this.countReplies(id, ctx);
    return true;
  }

  /** The reply count: the message's children, less its comments and their replies (stored as children too). */
  private countReplies(id: string, ctx: Ctx) {
    ctx.board.children(id).then(kids => {
      if (this.replies?.for !== id) return;
      this.replies.n = kids.filter(k => k.props.type !== "annotation" && k.props.type !== "annotation-reply").length;
      ctx.redraw();
    }, () => {});
  }

  /** Next (+1) or previous (-1) message in the list this reader was opened from. */
  step(dir: 1 | -1, ctx: Ctx): { index: number; of: number; id: string } {
    const to = this.index + dir;
    if (to < 0 || to >= this.list.length) throw new ActionRefused(dir > 0 ? "end of messages" : "this is the first message");
    const was = this.index;
    this.index = to;
    if (!this.open(ctx)) { this.index = was; throw new ActionRefused(`finish ${this.personIn()} first · ctrl+s saves · esc closes`); }
    return { index: to + 1, of: this.list.length, id: this.msg.id };
  }

  /** An agent moved the reader: said in the reader until the person moves on (the status bar says it too: MESSAGE_ACTIONS' says). */
  moved<T extends { index: number; of: number }>(out: T, actor: Actor): T {
    this.surface.noteAgent(actor, `moved here (message ${out.index} of ${out.of})`);
    return out;
  }

  /** `T`: the message's replies, as a message list. */
  thread(ctx: Ctx) {
    const m = this.surface.msg ?? this.msg;
    ctx.push(new MessageList(`thread: ${subject(m).slice(0, 30)}`, () => ctx.board.children(m.id), "", false));
  }

  render(ctx: Ctx): Frame {
    if (!this.shown) this.open(ctx);
    this.ctx = ctx;
    const w = ctx.t.cols, h = ctx.t.rows - 1;
    const v = this.surface.render(w, Math.max(1, h - 1), this.host(ctx));
    const lines = v.lines.slice(0, h - 1);
    while (lines.length < h - 1) lines.push("");
    lines.push(this.hint(v.scroll, w));
    return { lines, placements: v.placements };
  }

  /**
   * The surface's hint, with the BBS keys where a host's own go (before the reading keys; an element, a
   * selection, an edit or the panel say their own keys instead), then how far down and the way back.
   */
  private hint(scroll: { top: number; room: number; total: number } | undefined, w: number): string {
    const s = this.surface;
    const more = scroll && scroll.total > scroll.room ? ` · ${Math.round(((scroll.top + scroll.room) / scroll.total) * 100)}%` : "";
    return pad(fg(C.dark) + "  " + s.hint("n next · p prev · t thread · ") + (s.holdsKeys ? "" : `${more} · q back`) + RESET, w);
  }

  key(k: Key, ctx: Ctx) {
    this.ctx = ctx;
    const host = this.host(ctx);
    if (k.kind === "mouse") return this.mouse(k, ctx, host);
    // An edit, a comment or the property panel takes every key, q and esc included, until it closes.
    if (this.surface.holdsKeys || this.surface.choosing) { this.surface.key(k, host); return; }
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    // q is always back; the surface has no q. U is the surface's u (up), as the BBS had it.
    if (c === "q" || c === "Q") return back(this, ctx);
    if (this.surface.key(c === "U" ? { kind: "char", ch: "u" } : k, host)) return;
    // What the surface doesn't take: the BBS keys. ⏎ is "next" unless an element is current (the surface's).
    const run = (name: "message.next" | "message.previous" | "message.thread") => { void this.dispatch.press(name); };
    if (k.kind === "esc") return back(this, ctx);
    if (c === "n" || c === "N" || k.kind === "enter" || k.kind === "right") return run("message.next");
    if (c === "p" || c === "P" || k.kind === "left") return run("message.previous");
    if (c === "t" || c === "T") return run("message.thread");
    if (c === "u" || c === "U") { ctx.flash("already at the top of the conference"); return; }
    if (k.kind === "home" || k.kind === "end") { this.surface.scrollKey(k, host); return; }
    ctx.redraw();
  }

  /** The mouse over the reader: the surface's press, drag, release (a click or a selection) and wheel. The hint row isn't the surface's. */
  private mouse(k: Extract<Key, { kind: "mouse" }>, ctx: Ctx, host: SurfaceHost) {
    const inside = k.y < ctx.t.rows - 2;
    if (k.action === "wheel-up" || k.action === "wheel-down") { if (inside) this.surface.wheel(k.action === "wheel-down" ? 1 : -1, host); return; }
    if (k.action === "down") { if (inside) this.surface.press(k.x, k.y, host); return; }
    if (k.action === "drag") { this.surface.drag(k.x, k.y, host); return; }
    if (k.action === "up") { this.surface.release(k.x, k.y, host); ctx.redraw(); }
  }

  onEvent(e: OutlineEvent, ctx: Ctx) {
    const m = this.surface.msg, host = this.host(ctx);
    this.surface.onEvent(host);
    if (e.action === "reconnected") this.surface.retry(host);
    if (!m) return;
    if (this.surface.staleOn(e)) this.surface.reread(host);
    // A reply written or removed under this message changes its count.
    if (this.replies?.for === m.id && (e.action === "reset" || (e.change && ["create", "move", "delete", "restore", "purge"].includes(e.change.kind)))) this.countReplies(m.id, ctx);
  }

  unsaved() { return this.surface.unsaved(); }
  keepDrafts() { return this.surface.keepDrafts(); }
  /** Screen.dispose: the reader is closed; its draft's hold on the service is let go (PIE-501). */
  dispose() { this.surface.dispose(); }
  /** Screen.holdsKeys: an edit, a comment or the panel the person is in, or a step's status choice (as on the desk and the river). */
  holdsKeys() { return this.surface.holdsKeys || this.surface.choosing; }
  /** Screen.keys: the one reader has the person's focus; they type in it while it holds their keys. */
  keys() {
    const busy = this.holdsKeys();
    return { focus: READER, typingIn: busy ? READER : null, busy, ...(busy ? { why: `the person is in ${this.personIn()} on the ${this.title}` } : {}) };
  }

  describe() {
    return { kind: "message reader", message: { n: this.index + 1, of: this.list.length }, replies: this.replies?.n ?? null, reader: READER, ...this.surface.describe() };
  }

  /** `open <id>`: the note in a new message reader above this one, unless the person is in an edit, a comment or the panel here. */
  openBlock(m: Msg) {
    if (this.surface.holdsKeys) throw new ActionRefused(`the person is in ${this.personIn()} here; try again once they close it`);
    this.ctx?.push(new MessageReader([m], 0));
  }

  /** Its one tile, as `tile=` names it: `message` (or the block it shows). */
  private tile(): TileRef {
    const m = this.surface.msg;
    return { name: READER, kind: "reader", shows: m?.id ?? null, editing: this.surface.editing, holds: a => this.surface.heldBy(a) };
  }
  private ctxShown(): Ctx {
    if (!this.ctx) throw new ActionRefused("the message reader isn't shown yet");
    return this.ctx;
  }
  /** The message reader's dispatcher: its own actions (next, previous, thread), then its reader's note actions. */
  readonly dispatch: Dispatcher = new Dispatcher({
    title: "message reader", ctx: () => this.ctx, keys: () => this.keys(), tiles: () => [this.tile()],
    draftOf: () => ({ board: this.ctx?.board, blockId: this.surface.msg?.id ?? null, session: this.surface.draftSession() }),
  }, [
    { set: MESSAGE_ACTIONS, takes: "screen", on: (_, how) => ({ r: this, ctx: how.ctx, actor: how.actor }) },
    {
      set: NOTE_ACTIONS, takes: "tile", noun: "a reader",
      on: (_, how) => ({ surface: this.surface, host: (how.given as SurfaceHost | undefined) ?? this.host(this.ctxShown()) }),
      run: (name, args, on, actor, typed) => this.surface.run(name, args, on.host, actor, typed),
      answer: (out: unknown) => ({ reader: READER, ...(out && typeof out === "object" ? out : { result: out }) }),
    },
  ]);
}

/** The message reader's one reader, as `actions` and `act reader=` name it. */
const READER = "message";

/** The message reader's own keys, as actions: next, previous, thread. The note's actions are NOTE_ACTIONS. */
export const MESSAGE_ACTIONS = new ActionSet<{ "message.next": Record<string, never>; "message.previous": Record<string, never>; "message.thread": Record<string, never> }, MessageOn>("message", {
  "message.next": {
    summary: "read the next message in the list the reader was opened from (an agent's waits until the person is idle, and is said)", keys: "n N, ⏎ (with no element current), →",
    touches: "screen", replay: "safe", says: out => `· moved to message ${out.index} of ${out.of}`,
    args: {},
    run(_, { r, ctx, actor }) { return r.moved(r.step(1, ctx), actor); },
  },
  "message.previous": {
    summary: "read the previous message in the list (an agent's waits until the person is idle, and is said)", keys: "p P, ←",
    touches: "screen", replay: "safe", says: out => `· moved to message ${out.index} of ${out.of}`,
    args: {},
    run(_, { r, ctx, actor }) { return r.moved(r.step(-1, ctx), actor); },
  },
  "message.thread": {
    summary: "list the message's replies (its children) as messages", keys: "t T",
    touches: "screen", replay: "safe", says: () => "· opened the thread · q goes back",
    args: {},
    run(_, { r, ctx }) {
      r.thread(ctx);
      return { opened: "thread" };
    },
  },
});

export class Conferences implements BbsList {
  title = "join conference";
  private confs: Msg[] | null = null;
  sel = 0;
  ctx: Ctx | null = null;
  private readonly ptr = new Pointer();
  enter(ctx: Ctx) { this.ctx = ctx; ctx.board.roots().then(r => { this.confs = r; ctx.redraw(); }, e => ctx.flash(String(e.message))); }
  render(ctx: Ctx): Frame {
    const w = ctx.t.cols;
    this.ptr.frame();
    const lines = [center(paint("|09─=|11[ |15CONFERENCES |11]|09=─"), w), center(paint("|08top-level blocks on the board"), w), ""];
    (this.confs ?? []).forEach((c, i) => {
      this.ptr.row(lines.length, i, w);
      const label = `${String(i + 1).padStart(3)}  ${pad(subject(c), w - 30)} ${fg(C.dark)}${c.props.type ?? ""}`;
      lines.push(i === this.sel ? bg(C.blue) + fg(C.white) + pad(label, w) + RESET : fg(C.lcyan) + label.slice(0, 5) + fg(C.grey) + label.slice(5) + RESET);
    });
    if (!this.confs) lines.push(paint("|08  dialing…"));
    lines.push("", hotLine(this.ptr, lines.length + 1, w, ["|08  ↑↓ select · ", ["|15ENTER|08 join", ENTER], " · ", ["|15Q|08 back", char("q")]]));
    return { lines };
  }
  key(k: Key, ctx: Ctx) {
    this.ctx = ctx;
    const list = this.confs ?? [];
    if (k.kind === "mouse") return listMouse(this.ptr, k, ctx, this.sel, list.length, i => listKey(this, "list.select", { n: i + 1 }, ctx), key => this.key(key, ctx));
    if (listKeys(this, k, ctx, 10)) return;
    ctx.redraw();
  }
  listRows(): ListRow[] | null { return this.confs?.map((c, i) => ({ n: i + 1, title: subject(c), id: c.id, type: c.props.type ?? null })) ?? null; }
  openRow(i: number, ctx: Ctx) {
    const c = this.confs![i]!;
    ctx.push(new MessageList(subject(c).slice(0, 40), () => ctx.board.children(c.id), c.props.type ?? "", false));
  }
  describe() { return listDescribe(this); }
  readonly dispatch: Dispatcher = listDispatch(this);
}

// ── who's online and last callers ────────────────────────────────────────────

export class WhoOnline implements Screen {
  title = "who's online";
  private callers: Caller[] | null = null;
  private subjects = new Map<string, string>();
  private asking = new Set<string>();
  private readonly ptr = new Pointer();
  enter(ctx: Ctx) { this.ctx = ctx; this.load(ctx); }
  private load(ctx: Ctx) {
    ctx.board.callers().then(c => {
      this.callers = c; ctx.redraw();
      // Titles only, in one read where the service can (blocks.read).
      // Only titles that were read are kept; a failed or missing one is asked again on the next load.
      const ids = [...new Set(c.map(x => x.target).filter((t): t is string => !!t && !this.subjects.has(t) && !this.asking.has(t)))];
      if (!ids.length) return;
      for (const id of ids) this.asking.add(id);
      const done = () => { for (const id of ids) this.asking.delete(id); ctx.redraw(); };
      ctx.board.readMany(ids, ["title"]).then(ms => { for (const m of ms) this.subjects.set(m.id, subject(m)); done(); }, done);
    }, e => ctx.flash(String(e.message)));
  }
  onEvent(_: unknown, ctx: Ctx) { this.load(ctx); }
  render(ctx: Ctx): Frame {
    const w = ctx.t.cols;
    const lines = [
      center(paint("|09─=|11[ |15WHO'S ONLINE |11]|09=─"), w), "",
      paint(`|09 Node  |09Caller      |09Location                  |09Activity`), rule(w),
    ];
    (this.callers ?? []).forEach((c, i) => {
      const you = c.id === ctx.board.clientId;
      const act = c.target ? `reading "${this.subjects.get(c.target) ?? c.target.slice(0, 8)}"` : c.activity;
      lines.push(`${fg(C.lcyan)}${String(i + 1).padStart(4)}   ${fg(you ? C.yellow : C.white)}${pad(you ? "you" : c.name, 11)} ${fg(C.brown)}${pad(c.host, 25)} ${fg(C.grey)}${pad(act, w - 46)}${RESET}`);
    });
    if (!this.callers) lines.push(paint("|08  polling nodes…"));
    lines.push("", paint("|08  Every Tree, Detail and agent attached to the outline is a node. The door registers as an observer, so it's listed too."));
    this.ptr.frame();
    lines.push("", hotLine(this.ptr, lines.length + 1, w, ["|08  ", ["|15R|08 refresh", char("r")], " · ", ["|15Q|08 back", char("q")]]));
    return { lines };
  }
  private ctx: Ctx | null = null;
  key(k: Key, ctx: Ctx) {
    this.ctx = ctx;
    if (k.kind === "mouse") return this.ptr.mouse(k, { sel: -1, select() {}, send: key => this.key(key, ctx) });
    if (isBack(k) || k.kind === "enter") back(this, ctx);
    else if (k.kind === "char" && !k.ctrl && (k.ch === "r" || k.ch === "R")) void this.dispatch.press("who.refresh");
  }
  /** Who's online as the who actions' host (src/who-actions.ts): r asks the service again. */
  private host(ctx: Ctx): WhoHost { return { refresh: () => this.load(ctx), rows: () => this.rows() }; }
  /** The callers as last read, for `who.refresh` and `peek`. */
  rows() { return (this.callers ?? []).map((c, i) => ({ n: i + 1, name: c.name, host: c.host, activity: c.activity, target: c.target ?? null, reading: c.target ? this.subjects.get(c.target) ?? null : null })); }
  describe() { return { kind: "who's online", callers: this.callers ? this.rows() : null }; }
  readonly dispatch: Dispatcher = new Dispatcher({ title: this.title, ctx: () => this.ctx }, [{
    set: WHO_ACTIONS, takes: "none",
    on: () => { if (!this.ctx) throw new ActionRefused("who's online isn't shown yet"); return { pane: this.host(this.ctx) }; },
  }]);
}

export class LastCallers implements BbsList {
  title = "last callers";
  private rows: Activity[] | null = null;
  sel = 0;
  ctx: Ctx | null = null;
  private readonly ptr = new Pointer();
  enter(ctx: Ctx) { this.ctx = ctx; ctx.board.activity(80).then(r => { this.rows = r; ctx.redraw(); }, e => ctx.flash(String(e.message))); }
  render(ctx: Ctx): Frame {
    const w = ctx.t.cols, h = ctx.t.rows - 1;
    this.ptr.frame();
    const rows = this.rows ?? [];
    const tally = new Map<string, number>();
    for (const r of rows) tally.set(r.actor, (tally.get(r.actor) ?? 0) + 1);
    const top = [...tally].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([a, n]) => `|14${a}|08×${n}`).join("  ");
    const lines = [
      center(paint("|09─=|11[ |15LAST CALLERS |11]|09=─"), w),
      center(paint(rows.length ? top : "|08dialing…"), w), "",
      paint(`|09  When  |09Caller                |09Did    |09Message`), rule(w),
    ];
    const page = h - lines.length - 2;
    const start = Math.max(0, Math.min(this.sel - Math.floor(page / 2), rows.length - page));
    rows.slice(start, start + page).forEach((r, i) => {
      this.ptr.row(lines.length, start + i, w);
      const row = ` ${ago(r.at).padStart(5)}  ${pad(r.actor, 21)} ${pad(r.kind === "properties" ? "props" : "edit", 6)} ${pad(subject(r.block), w - 40)}`;
      lines.push(start + i === this.sel ? bg(C.blue) + fg(C.white) + pad(row, w) + RESET
        : `${fg(C.dark)}${row.slice(0, 7)}${fg(r.author === "agent" ? C.lmagenta : r.author === "user" ? C.yellow : C.cyan)}${row.slice(7, 30)}${fg(C.dark)}${row.slice(30, 37)}${fg(C.grey)}${row.slice(37)}${RESET}`);
    });
    while (lines.length < h - 1) lines.push("");
    lines.push(hotLine(this.ptr, lines.length, w, ["|08  |13agents|08 · |14you|08 · |03system|08 · ", ["ENTER read", ENTER], " · ", ["Q back", char("q")]]));
    return { lines };
  }
  key(k: Key, ctx: Ctx) {
    this.ctx = ctx;
    const rows = this.rows ?? [];
    if (k.kind === "mouse") return listMouse(this.ptr, k, ctx, this.sel, rows.length, i => listKey(this, "list.select", { n: i + 1 }, ctx), key => this.key(key, ctx));
    if (listKeys(this, k, ctx, ctx.t.rows - 10)) return;
    ctx.redraw();
  }
  listRows(): ListRow[] | null {
    return this.rows?.map((r, i) => ({ n: i + 1, title: subject(r.block), id: r.block.id, actor: r.actor, author: r.author, did: r.kind, at: r.at })) ?? null;
  }
  openRow(i: number, ctx: Ctx) { ctx.push(new MessageReader(this.rows!.map(r => r.block), i)); }
  describe() { return listDescribe(this); }
  readonly dispatch: Dispatcher = listDispatch(this);
}

// ── file areas: the WOE packs, straight out of their zips ────────────────────

export class FileAreas implements BbsList {
  title = "file areas";
  private list = packs();
  sel = 0;
  ctx: Ctx | null = null;
  enter(ctx: Ctx) { this.ctx = ctx; }
  private diz = new Map<string, string[]>();
  private readonly ptr = new Pointer();
  render(ctx: Ctx): Frame {
    const w = ctx.t.cols, h = ctx.t.rows - 1;
    this.ptr.frame();
    const lines = [center(paint("|09─=|11[ |15FILE AREA 1 · WOE ART PACKS |11]|09=─"), w), "", paint("|09 Filename        Size  Date      Description"), rule(w)];
    this.list.forEach((p, i) => {
      if (!this.diz.has(p)) this.diz.set(p, readDiz(p));
      const size = Bun.file(p).size;
      const d = this.diz.get(p)!;
      const on = i === this.sel;
      // The pack's row, and the description lines the selected pack shows under it, are its place for the mouse.
      this.ptr.row(lines.length, i, w);
      if (on) for (let j = 1; j <= Math.min(5, Math.max(0, d.length - 1)); j++) this.ptr.row(lines.length + j, i, w);
      const head = ` ${pad(basename(p).toUpperCase(), 14)} ${String(Math.round(size / 1024)).padStart(5)}k  ${pad(d[0] ?? "", w - 32)}`;
      lines.push(on ? bg(C.blue) + fg(C.white) + pad(head, w) + RESET : fg(C.lcyan) + head.slice(0, 15) + fg(C.grey) + head.slice(15, 23) + fg(C.white) + head.slice(23) + RESET);
      if (on) for (const extra of d.slice(1, 6)) lines.push(`${" ".repeat(24)}${fg(C.dark)}${pad(extra, w - 25)}${RESET}`);
    });
    while (lines.length < h - 1) lines.push("");
    lines.push(hotLine(this.ptr, lines.length, w, ["|08  ↑↓ select · ", ["|15ENTER|08 browse pack", ENTER], " · ", ["Q back", char("q")]]));
    return { lines };
  }
  key(k: Key, ctx: Ctx) {
    this.ctx = ctx;
    if (k.kind === "mouse") return listMouse(this.ptr, k, ctx, this.sel, this.list.length, i => listKey(this, "list.select", { n: i + 1 }, ctx), key => this.key(key, ctx));
    if (listKeys(this, k, ctx, 5)) return;
    ctx.redraw();
  }
  listRows(): ListRow[] { return this.list.map((p, i) => ({ n: i + 1, title: basename(p), description: (this.diz.get(p) ?? readDiz(p))[0] ?? "" })); }
  openRow(i: number, ctx: Ctx) {
    const m = members(this.list[i]!).filter(x => /\.(ans|asc)$/i.test(x.path));
    if (!m.length) throw new ActionRefused("no ANSI or ASCII in that pack");
    ctx.push(new ArtViewer(m));
  }
  describe() { return listDescribe(this); }
  readonly dispatch: Dispatcher = listDispatch(this);
}

function readDiz(pack: string): string[] {
  const diz = members(pack).find(m => /file_id\.diz$/i.test(m.path));
  if (!diz) return [];
  try {
    return loadArt(diz).rows.map(r => r.map(c => (c.code < 32 || c.code > 126 ? " " : String.fromCharCode(c.code))).join("").trimEnd()).filter(l => l.trim());
  } catch { return []; }
}

export class ArtViewer implements Screen {
  title = "art";
  private index: number;
  private art: Art | null = null;
  private error = "";
  private scroll = 0;
  private ice = false;
  private reveal = Infinity;
  private readonly ptr = new Pointer();
  constructor(private readonly items: Member[], start?: string) {
    this.index = Math.max(0, start ? items.findIndex(m => basename(m.path).toLowerCase() === start.toLowerCase()) : 0);
    this.load();
  }
  private load() {
    try { this.art = loadArt(this.items[this.index]!, { ice: this.ice || undefined }); this.error = ""; }
    catch (e) { this.art = null; this.error = String((e as Error).message); }
    this.scroll = 0;
    this.reveal = 0;   // modem-speed draw, one row at a time
    this.title = `art · ${basename(this.items[this.index]!.path)}`;
  }
  enter(ctx: Ctx) { this.ctx = ctx; }
  tick() { if (!this.art || this.reveal >= this.art.height) return false; this.reveal += 1; return true; }
  render(ctx: Ctx): Frame {
    const w = ctx.t.cols, h = ctx.t.rows - 1;
    const art = this.art;
    const side = w >= (art?.width ?? 80) + 34 ? 32 : 0;
    const lines: string[] = [];
    let placements: Frame["placements"] = [];
    if (art) {
      const block = artBlock(art.rows, art.width, ctx.t, { key: "viewer", at: { col: 0, row: 0 }, maxRows: h - 1, scroll: this.scroll, reveal: this.reveal, fit: "true", graphics: ctx.graphics });
      lines.push(...block.lines);
      placements = block.placements;
    } else lines.push(paint(`|12  ${this.error}`));
    while (lines.length < h - 1) lines.push("");
    if (side && art) {
      const s = art.sauce;
      const panel = [
        paint("|13SAUCE RECORD"), "",
        ...([["file", basename(this.items[this.index]!.path)], ["pack", basename(this.items[this.index]!.pack)], ["title", s?.title], ["artist", s?.author], ["group", s?.group], ["date", s?.date], ["size", `${art.width}×${art.height}`], ["flags", (this.ice ? "iCE colours" : s?.ice ? "iCE (sauce)" : "—")], ["bytes", art.bytes.toLocaleString()]] as [string, string | undefined][])
          .map(([k, v]) => `${fg(C.dark)}${k.padEnd(8)}${fg(C.white)}${pad(v || "—", side - 9)}${RESET}`),
        "", ...(s?.comments ?? []).flatMap(c => wrap(c, side - 1)).map(c => fg(C.grey) + c + RESET),
        "", paint(`|08${this.index + 1} of ${this.items.length}`),
      ];
      panel.forEach((p, i) => { if (i < lines.length) lines[i] = pad(lines[i]!, w - side) + " " + p; });
    }
    this.ptr.frame();
    lines.push(hotLine(this.ptr, lines.length, w, ["|08  ", ["|15,", char(",")], " ", ["|15.", char(".")], "|08 prev/next · ", ["↑", { kind: "up" }], ["↓", { kind: "down" }], " scroll · ", ["|15i|08 iCE", char("i")], " · ", [`|15v|08 video (${ctx.video})`, char("v")], " · ", ["|15Q|08 back", char("q")]]));
    return { lines, placements };
  }
  key(k: Key, ctx: Ctx): void {
    // The wheel scrolls as ↑ ↓ do; a click on the hint's keys is those keys.
    if (k.kind === "mouse") {
      if (k.action === "wheel-up" || k.action === "wheel-down") return this.key({ kind: k.action === "wheel-up" ? "up" : "down" }, ctx);
      return this.ptr.mouse(k, { sel: -1, select() {}, send: key => this.key(key, ctx) });
    }
    this.ctx = ctx;
    if (isBack(k)) return back(this, ctx);
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    const run = <K extends keyof ArtArgs & string>(name: K, args: ArtArgs[K]) => void this.dispatch.press(name, args);
    if (c === "." || c === ">" || k.kind === "right") return run("art.step", { by: 1 });
    if (c === "," || c === "<" || k.kind === "left") return run("art.step", { by: -1 });
    if (c === "i") return run("art.ice", {});
    if (c === "v") return shellKey("video.cycle", {}, this, ctx);
    if (k.kind === "enter" || c === " ") return run("art.reveal", {});
    const by = k.kind === "down" || c === "j" ? 2 : k.kind === "up" || c === "k" ? -2 : k.kind === "pgdn" ? 20 : k.kind === "pgup" ? -20 : 0;
    if (by) return run("art.scroll", { by });
  }
  private ctx: Ctx | null = null;
  /** The next (+1) or previous (-1) piece in the pack, drawn at modem speed. */
  step(by: number) { const n = this.items.length; this.index = (((this.index + by) % n) + n) % n; this.load(); return this.about(); }
  /** iCE colours on or off (blink becomes bright backgrounds), drawn whole. */
  setIce(on: boolean) { this.ice = on; this.load(); this.reveal = Infinity; return this.about(); }
  /** Scroll by rows within the piece. */
  scrollBy(by: number) { this.scroll = Math.max(0, Math.min(Math.max(0, (this.art?.height ?? 0) - 10), this.scroll + by)); return this.about(); }
  /** Draw the rest at once (skip the modem-speed reveal). */
  revealAll() { this.reveal = Infinity; return this.about(); }
  get iceOn() { return this.ice; }
  about() { return { piece: basename(this.items[this.index]!.path), n: this.index + 1, of: this.items.length, ice: this.ice, scroll: this.scroll, height: this.art?.height ?? null }; }
  describe() { return { kind: "art", ...this.about(), sauce: this.art?.sauce ?? null }; }
  readonly dispatch: Dispatcher = new Dispatcher({ title: "art viewer", ctx: () => this.ctx }, [{
    set: ART_ACTIONS, takes: "none",
    on: () => { if (!this.ctx) throw new ActionRefused("the art viewer isn't shown yet"); return this.on(this.ctx); },
  }]);
  /** The viewer as the art actions' host (src/art-actions.ts). */
  private on(ctx: Ctx): ArtOn { return { pane: this, desk: { ctx, redraw: () => ctx.redraw() } }; }
}

type ArtArgs = { "art.step": { by: number }; "art.scroll": { by: number }; "art.ice": { on?: boolean }; "art.reveal": Record<string, never> };

// ── stats, help, goodbye ─────────────────────────────────────────────────────

export class Stats implements Screen {
  title = "board stats";
  private msgs: Msg[] | null = null;
  private readonly ptr = new Pointer();
  enter(ctx: Ctx) { ctx.board.changedSince(0, 300).then(m => { this.msgs = m; ctx.redraw(); }, e => ctx.flash(String(e.message))); }
  render(ctx: Ctx): Frame {
    const w = ctx.t.cols;
    this.ptr.frame();
    const lines = [center(paint("|09─=|11[ |15BOARD STATS |11]|09=─"), w), center(paint("|08when the last 300 messages were written · hour of day × day of week"), w), ""];
    const back = (at: number) => hotLine(this.ptr, at, w, ["|08  ", ["|15Q|08 back", char("q")]]);
    if (!this.msgs) return { lines: [...lines, paint("|08  counting…"), "", back(lines.length + 2)] };
    const hm = heatmap(this.msgs.map(m => m.updatedAt), ctx.t, ctx.graphics, { col: 6, row: lines.length + 1 });
    lines.push(paint(`|08      ${"0".padEnd(hm.hourWidth * 6)}${"6".padEnd(hm.hourWidth * 6)}${"12".padEnd(hm.hourWidth * 6)}${"18".padEnd(hm.hourWidth * 6)}23`));
    hm.lines.forEach((l, i) => lines.push(`${fg(C.dark)}${(hm.labels[i] ?? "").padEnd(6)}${RESET}${l}`));
    lines.push("");
    const authors = new Map<string, number>();
    for (const m of this.msgs) authors.set(m.author ?? "?", (authors.get(m.author ?? "?") ?? 0) + 1);
    lines.push(paint("|11  top posters"));
    const max = Math.max(...authors.values());
    for (const [a, n] of [...authors].sort((x, y) => y[1] - x[1]).slice(0, 8)) {
      const bar = "█".repeat(Math.max(1, Math.round((n / max) * (w - 40))));
      lines.push(`  ${fg(C.yellow)}${pad(a, 22)}${fg(C.lcyan)}${String(n).padStart(5)} ${fg(C.blue)}${bar}${RESET}`);
    }
    lines.push("", back(lines.length + 1));
    return { lines, placements: hm.placements };
  }
  key(k: Key, ctx: Ctx) {
    if (k.kind === "mouse") return this.ptr.mouse(k, { sel: -1, select() {}, send: key => this.key(key, ctx) });
    if (isBack(k) || k.kind === "enter") back(this, ctx);
  }
}

export class Help implements Screen {
  title = "help";
  private readonly ptr = new Pointer();
  /** `ptr`: where the item rows are recorded for the mouse (the main menu's own, when it draws this without its art). */
  render(ctx: Ctx, ptr = this.ptr): Frame {
    const w = ctx.t.cols;
    ptr.frame();
    return {
      lines: [
        center(paint("|09─=|11[ |15ep0ch · a door into the outline |11]|09=─"), w), "",
        ...ITEMS.map((i, n) => hotLine(ptr, 2 + n, w, [[`   |09[|15${i.key}|09] |11${i.label.padEnd(10)}|07${HELP[i.key] ?? ""}`, char(i.key), n]])),
        "", paint("|08   Kanban, Quay, Desk, Today, Waiting, Claude·now, Showcase and the message reader write: edits, comments, card moves, trash and restore"),
        paint("|08   go to the outline, recorded as you, or as the agent that did them. The other screens only read."),
        paint("|08   Video cycles Kitty+CRT → Kitty → plain cells. Art and stats are pixels; every word is real terminal text."),
        paint("|08   |15q|08 or |15Esc|08 goes back on every screen. The menu is the top: there |15q|08 is the Quay, |15Esc|08 stays, and only |15G|08 logs off."),
      ],
    };
  }
  /**
   * Any key closes help. So does a click, except on an item's row: that closes help and opens the item, as
   * its key does on the menu (a mouse path of its own: here the keys only close).
   */
  key(k: Key, ctx: Ctx) {
    if (k.kind !== "mouse") return back(this, ctx);
    if (k.action === "down" && !this.ptr.at(k.x, k.y)) return back(this, ctx);
    this.ptr.mouse(k, { sel: -1, select() {}, send: key => {
      const item = key.kind === "char" ? ITEMS.find(i => i.key === key.ch) : undefined;
      back(this, ctx);
      if (item) shellKey("screen.open", { name: item.key }, this, ctx);
    } });
  }
}
const HELP: Record<string, string> = {
  N: "messages changed since your last call", J: "top-level blocks as conferences", R: "the 200 most recently changed blocks",
  W: "every client attached to the outline right now", L: "who edited what, agents and humans", F: "the WOE art packs, read from their zips",
  S: "activity heatmap and top posters", K: "delivery board: stage lanes, one preview, details, outline and backlinks drawers", Q: "the river: Quay's columns, spines and threads over the live outline", B: "the ep0ch menu by shypht, 1997",
  D: "the desk: outline, reader, thread and live tiles you lay out yourself", X: "the showcase: every shared part, live (on a showcase outline)", T: "today's brief: the newest type::daily-brief note, live; , . step days", O: "waiting on others: outbox items still waiting, by who they wait on, longest first", C: "Claude · now: the [[claude-now]] page, pinned and live", V: "cycle video mode (hidden hotkey)", "?": "this screen", G: "log off (and remember this call)",
  "!": "drop to shell: your login shell in this terminal; exit comes back here, tiles still running",
};

export class Goodbye implements Screen {
  title = "logoff";
  readonly noDock = true;
  private at = Date.now();
  /** Logging off quits the door: with programs still running (the desk in the background), it asks first. */
  enter(ctx: Ctx) { if (ctx.confirmQuit && !ctx.confirmQuit()) ctx.pop(); else this.at = Date.now(); }
  tick(ctx: Ctx) { if (Date.now() - this.at > 1600) { ctx.quit(); return false; } return true; }
  render(ctx: Ctx): Frame {
    const w = ctx.t.cols;
    const t = Date.now() - this.at;
    return {
      lines: [
        "", "", center(paint("|11Thanks for calling |15ep0ch|11."), w), "",
        center(paint(`|08your last call is now ${bbsDate(Date.now())}`), w), "",
        t > 700 ? center(paint("|07+++"), w) : "", t > 1000 ? center(paint("|07ATH0"), w) : "", t > 1300 ? center(paint("|15NO CARRIER"), w) : "",
      ],
    };
  }
  key() {}
}

export type { Cell };
