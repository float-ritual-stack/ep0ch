// Every screen of the board. Outline data arrives async; screens render "loading" until it lands.
import { basename } from "node:path";
import type { Art, Cell } from "./ansi";
import { artBlock, cloneGrid, locate, stamp } from "./art-view";
import type { Ctx, Frame, Screen } from "./app";
import { subject, type Caller, type Msg } from "./board";
import { find, loadArt, members, packs, type Member } from "./packs";
import type { Activity } from "./socket";
import { bg, C, center, fg, pad, paint, RESET, width } from "./style";
import type { Key } from "./term";
import { heatmap } from "./stats";
import { Desk } from "./desk/desk";
import { River } from "./river/river";
import { DeliveryBoard } from "./desk/delivery";
import { Showcase } from "./showcase/showcase";
import { Brief } from "./brief/brief";
import { ago, bbsDate, rule, wrap } from "./text";
import { NOTE_ACTIONS, NoteSurface, type HeaderInfo, type SurfaceHost } from "./surface/note";
import { ActionRefused, ActionSet, asActor, type ActRequest } from "./surface/actions";
import { USER, type Actor, type OutlineEvent } from "./socket";

// ── helpers ──────────────────────────────────────────────────────────────────

const nav = (k: Key, len: number, i: number, page: number) => {
  if (k.kind === "up" || (k.kind === "char" && k.ch === "k")) return Math.max(0, i - 1);
  if (k.kind === "down" || (k.kind === "char" && k.ch === "j")) return Math.min(len - 1, i + 1);
  if (k.kind === "pgup") return Math.max(0, i - page);
  if (k.kind === "pgdn") return Math.min(len - 1, i + page);
  if (k.kind === "home") return 0;
  if (k.kind === "end") return Math.max(0, len - 1);
  return i;
};
const isBack = (k: Key) => k.kind === "esc" || (k.kind === "char" && (k.ch === "q" || k.ch === "Q"));

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

const artCache = new Map<string, Art | null>();
function screenArt(file: string): Art | null {
  if (!artCache.has(file)) {
    try { const m = find(file); artCache.set(file, m ? loadArt(m) : null); } catch { artCache.set(file, null); }
  }
  return artCache.get(file)!;
}

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
  private shown = 0;
  private readonly script: string[];
  /** `then`: a screen opened over the main menu after the logon (EP0CH_LANDING=brief: the daily brief). */
  constructor(ctx: Ctx, private readonly then?: () => Screen) {
    this.script = [
      `ATDT ${ctx.host}`,
      "",
      "CONNECT 28800/ARQ/V34/LAPM/V42BIS",
      "",
      `ep0ch · node 1 · ${ctx.workspace} · outline protocol 80`,
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

interface MenuItem { key: string; label: string; open: (ctx: Ctx) => Screen | null }

const ITEMS: MenuItem[] = [
  { key: "N", label: "Newscan", open: ctx => new MessageList("new scan", n => ctx.board.changedSince(ctx.lastCall, n), "since your last call") },
  { key: "J", label: "Join", open: () => new Conferences() },
  { key: "K", label: "Kanban", open: () => new DeliveryBoard() },
  { key: "R", label: "Read", open: ctx => new MessageList("recent", n => ctx.board.changedSince(0, n), "most recently changed") },
  { key: "W", label: "Who's on", open: () => new WhoOnline() },
  { key: "L", label: "Lastcall", open: () => new LastCallers() },
  { key: "F", label: "Files", open: () => new FileAreas() },
  { key: "S", label: "Stats", open: () => new Stats() },
  { key: "Q", label: "Quay", open: () => new River() },
  { key: "B", label: "Bulletin", open: () => new ArtViewer(members(packs().find(p => /woe0497/i.test(p)) ?? packs()[0]!).filter(m => /\.(ans|asc)$/i.test(m.path)), "SHY-EPO!.ANS") },
  { key: "D", label: "Desk", open: () => new Desk() },
  { key: "G", label: "Goodbye", open: () => new Goodbye() },
  // The menu art has twelve slots: the showcase (PIE-439) is on its key line and its X key only.
  { key: "X", label: "Showcase", open: () => new Showcase() },
  // The daily brief (PIE-435), on the key line too: T for today (B is the Bulletin).
  { key: "T", label: "Today", open: () => new Brief() },
];

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
    lines.push(hotLine(this.ptr, lines.length, ctx.t.cols, [
      "|09[|15ep0ch|09] |11main menu |08(",
      ...ITEMS.slice(0, slotted).map((i, n): [string, Key, number] => [`${n === this.sel ? "|15" : "|07"}${i.key}`, char(i.key), n]),
      "|08)",
      ...ITEMS.slice(slotted).flatMap((i, j): (string | [string, Key, number])[] => {
        const n = slotted + j, on = n === this.sel;
        return [" |08· ", [on ? `${bg(C.magenta)}|15${i.key} ${i.label}${RESET}` : `|15${i.key} |13${i.label}`, char(i.key), n]];
      }),
      // The lit item's name at the width of the longest, so the line (and every key on it) stays put as it changes.
      ` |07: |15${item.label.padEnd(Math.max(...ITEMS.map(i => i.label.length)))}`,
    ], { centre: true }));
    lines.push(center(paint(`|08${ctx.events ? `|14${ctx.events} change(s) on the outline since you logged on · ` : ""}last call ${ctx.lastCall ? bbsDate(ctx.lastCall) : "never"}`), ctx.t.cols));
    return { lines, placements: frame };
  }
  key(k: Key, ctx: Ctx): void {
    if (k.kind === "mouse") {
      // The wheel is ↑ ↓; a click on an item is its key (see Pointer).
      if (k.action === "wheel-up" || k.action === "wheel-down") return this.key({ kind: k.action === "wheel-up" ? "up" : "down" }, ctx);
      let sent = false;
      this.ptr.mouse(k, { sel: this.sel, select: i => { this.sel = i; }, send: key => { sent = true; this.key(key, ctx); } });
      if (!sent) ctx.redraw();
      return;
    }
    if (k.kind === "left") this.sel = (this.sel + ITEMS.length - 4) % ITEMS.length;
    else if (k.kind === "right") this.sel = (this.sel + 4) % ITEMS.length;
    else if (k.kind === "up") this.sel = (this.sel + ITEMS.length - 1) % ITEMS.length;
    else if (k.kind === "down" || k.kind === "tab") this.sel = (this.sel + 1) % ITEMS.length;
    else if (k.kind === "enter") return this.open(ITEMS[this.sel]!, ctx);
    else if (k.kind === "esc") return ctx.push(new Goodbye());
    else if (k.kind === "char" && k.ch.toUpperCase() === "V") { ctx.cycleVideo(); return; }
    else if (k.kind === "char" && k.ch === "?") return ctx.push(new Help());
    else if (k.kind === "char") {
      const hit = ITEMS.findIndex(i => i.key === k.ch.toUpperCase());
      if (hit >= 0) { this.sel = hit; return this.open(ITEMS[hit]!, ctx); }
    }
    ctx.redraw();
  }
  private open(item: MenuItem, ctx: Ctx) { openItem(item, ctx); }
  describe() { return { kind: "main menu", selected: ITEMS[this.sel]!.key, items: ITEMS.map(i => `${i.key} ${i.label}`) }; }
}

/** Open a menu item's screen over the current one. */
function openItem(item: MenuItem, ctx: Ctx) {
  const s = item.open(ctx);
  if (s) ctx.push(s); else ctx.redraw();
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

export class MessageList implements Screen {
  private items: Msg[] | null = null;
  private error = "";
  private sel = 0;
  private receiving: { started: number; limit: number } | null = null;
  private readonly ptr = new Pointer();
  /** `paged` loaders take a limit: a quick first page, then the full scan behind it. */
  constructor(readonly title: string, private readonly load: (limit: number) => Promise<Msg[]>, private readonly caption = "", private readonly paged = true) {}
  enter(ctx: Ctx) {
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
    const list = this.items ?? [];
    if (k.kind === "mouse") return listMouse(this.ptr, k, ctx, this.sel, list.length, i => { this.sel = i; }, key => this.key(key, ctx));
    if (isBack(k)) return ctx.pop();
    if (!list.length) return;
    if (k.kind === "enter") return ctx.push(new MessageReader(list, this.sel));
    if (k.kind === "char" && k.ch.toLowerCase() === "t") return ctx.push(new MessageList(`thread: ${subject(list[this.sel]!).slice(0, 30)}`, () => ctx.board.children(list[this.sel]!.id), "", false));
    this.sel = nav(k, list.length, this.sel, ctx.t.rows - 10);
    ctx.redraw();
  }
}

/** What a message reader's own actions (MESSAGE_ACTIONS) run on. */
interface MessageOn { r: MessageReader; ctx: Ctx }

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
  personIn(): string { const s = this.surface; return s.draft ? "an edit" : s.session ? "a comment" : "the property panel"; }

  /** The surface's host: this screen, its header, and where a followed link opens (the next reader on the stack). */
  host(ctx: Ctx): SurfaceHost {
    return {
      ctx,
      redraw: () => ctx.redraw(),
      navigate: (m, how) => {
        // An agent never takes the person's keys: while they're in an edit, a comment or the panel here,
        // what it followed is named, not opened over them.
        if (how?.agent && this.surface.holdsKeys) { ctx.flash(`not opened while you're in ${this.personIn()}: ${subject(m).slice(0, 50)}`); return; }
        ctx.push(new MessageReader([m], 0));
      },
      header: (m, w, info) => this.header(m, w, info),
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

  /** An agent moved the reader: said in the status bar and, until the person moves on, in the reader. */
  moved<T extends { index: number; of: number }>(out: T, ctx: Ctx, actor: Actor): T {
    if (actor.kind === "agent") { ctx.flash(`moved to message ${out.index} of ${out.of}`); this.surface.noteAgent(actor, `moved here (message ${out.index} of ${out.of})`); }
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
    if (this.surface.holdsKeys) { this.surface.key(k, host); return; }
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    // q is always back; the surface has no q. U is the surface's u (up), as the BBS had it.
    if (c === "q" || c === "Q") return ctx.pop();
    if (this.surface.key(c === "U" ? { kind: "char", ch: "u" } : k, host)) return;
    // What the surface doesn't take: the BBS keys. ⏎ is "next" unless an element is current (the surface's).
    const run = (name: "message.next" | "message.previous" | "message.thread") => {
      Promise.resolve().then(() => MESSAGE_ACTIONS.run(name, {}, { r: this, ctx }, USER)).catch((e: Error) => ctx.flash(e.message)).finally(() => ctx.redraw());
    };
    if (k.kind === "esc") return ctx.pop();
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
    const stale = e.action === "reset" || (e.blockId === m.id && !(e.change?.revision !== undefined && m.revision === e.change.revision && !m.partial));
    if (stale) ctx.board.get(m.id).then(x => { if (x) { this.surface.refresh(x); ctx.redraw(); } }, () => {});
    // A reply written or removed under this message changes its count.
    if (this.replies?.for === m.id && (e.action === "reset" || (e.change && ["create", "move", "delete", "restore", "purge"].includes(e.change.kind)))) this.countReplies(m.id, ctx);
  }

  unsaved() { return this.surface.unsaved(); }
  keepDrafts() { return this.surface.keepDrafts(); }
  holdsKeys() { return this.surface.holdsKeys; }

  describe() {
    return { kind: "message reader", message: { n: this.index + 1, of: this.list.length }, replies: this.replies?.n ?? null, reader: READER, ...this.surface.describe() };
  }

  /** `open <id>`: the note in a new message reader above this one, unless the person is in an edit, a comment or the panel here. */
  openBlock(m: Msg) {
    if (this.surface.holdsKeys) throw new ActionRefused(`the person is in ${this.personIn()} here; try again once they close it`);
    this.ctx?.push(new MessageReader([m], 0));
  }

  actions() { return { actions: [...MESSAGE_ACTIONS.list(), ...NOTE_ACTIONS.list()], readers: [READER] }; }

  async act(req: ActRequest, actor: Actor): Promise<unknown> {
    const ctx = this.ctx;
    if (!ctx) throw new ActionRefused("the message reader isn't shown yet");
    const args = { ...(req.args ?? {}) };
    const sel = req.reader;
    if (sel && sel !== READER && sel !== "focused" && !(/^[0-9a-f-]{8,}$/.test(sel) && this.surface.msg?.id.startsWith(sel)))
      throw new ActionRefused(`the message reader has one reader, "${READER}"${this.surface.msg ? `, showing ${this.surface.msg.id}` : ""}; not ${sel}`);
    if (MESSAGE_ACTIONS.has(req.action)) return MESSAGE_ACTIONS.runUntyped(req.action, args, { r: this, ctx: asActor(ctx, actor) }, actor);
    if (!NOTE_ACTIONS.has(req.action)) throw new ActionRefused(`no action ${req.action} in the message reader; \`actions\` lists them`);
    const out = await this.surface.act(req.action, args, this.host(ctx), actor);
    return { reader: READER, ...(out && typeof out === "object" ? out : { result: out }) };
  }
}

/** The message reader's one reader, as `actions` and `act reader=` name it. */
const READER = "message";

/** The message reader's own keys, as actions: next, previous, thread. The note's actions are NOTE_ACTIONS. */
export const MESSAGE_ACTIONS = new ActionSet<{ "message.next": Record<string, never>; "message.previous": Record<string, never>; "message.thread": Record<string, never> }, MessageOn>("message", {
  "message.next": {
    summary: "read the next message in the list the reader was opened from", keys: "n, ⏎ (with no element current), →",
    args: {},
    run(_, { r, ctx }, actor) { return r.moved(r.step(1, ctx), ctx, actor); },
  },
  "message.previous": {
    summary: "read the previous message in the list", keys: "p, ←",
    args: {},
    run(_, { r, ctx }, actor) { return r.moved(r.step(-1, ctx), ctx, actor); },
  },
  "message.thread": {
    summary: "list the message's replies (its children) as messages", keys: "t",
    args: {},
    run(_, { r, ctx }, actor) {
      if (actor.kind === "agent" && r.surface.holdsKeys) throw new ActionRefused(`the person is in ${r.personIn()} here; try again once they close it`);
      r.thread(ctx);
      return { opened: "thread" };
    },
  },
});

export class Conferences implements Screen {
  title = "join conference";
  private confs: Msg[] | null = null;
  private sel = 0;
  private readonly ptr = new Pointer();
  enter(ctx: Ctx) { ctx.board.roots().then(r => { this.confs = r; ctx.redraw(); }, e => ctx.flash(String(e.message))); }
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
    const list = this.confs ?? [];
    if (k.kind === "mouse") return listMouse(this.ptr, k, ctx, this.sel, list.length, i => { this.sel = i; }, key => this.key(key, ctx));
    if (isBack(k)) return ctx.pop();
    if (k.kind === "enter" && list[this.sel]) {
      const c = list[this.sel]!;
      return ctx.push(new MessageList(subject(c).slice(0, 40), () => ctx.board.children(c.id), c.props.type ?? "", false));
    }
    this.sel = nav(k, list.length, this.sel, 10);
    ctx.redraw();
  }
}

export class Search implements Screen {
  title = "search";
  private q = "";
  render(ctx: Ctx): Frame {
    return { lines: ["", center(paint("|09─=|11[ |15TEXT SEARCH |11]|09=─"), ctx.t.cols), "", paint(`  |11Search for: |15${this.q}|07_`), "", paint("|08  ENTER to scan the whole board · ESC back")] };
  }
  key(k: Key, ctx: Ctx) {
    if (k.kind === "esc") return ctx.pop();
    if (k.kind === "backspace") this.q = this.q.slice(0, -1);
    else if (k.kind === "enter" && this.q.trim()) return ctx.replace(new MessageList(`search: ${this.q}`, n => ctx.board.search(this.q, n)));
    else if (k.kind === "char" && !k.ctrl) this.q += k.ch;
    ctx.redraw();
  }
}

// ── who's online and last callers ────────────────────────────────────────────

export class WhoOnline implements Screen {
  title = "who's online";
  private callers: Caller[] | null = null;
  private subjects = new Map<string, string>();
  private asking = new Set<string>();
  private readonly ptr = new Pointer();
  enter(ctx: Ctx) { this.load(ctx); }
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
  key(k: Key, ctx: Ctx) {
    if (k.kind === "mouse") return this.ptr.mouse(k, { sel: -1, select() {}, send: key => this.key(key, ctx) });
    if (isBack(k) || k.kind === "enter") ctx.pop(); else if (k.kind === "char" && k.ch === "r") this.load(ctx);
  }
}

export class LastCallers implements Screen {
  title = "last callers";
  private rows: Activity[] | null = null;
  private sel = 0;
  private readonly ptr = new Pointer();
  enter(ctx: Ctx) { ctx.board.activity(80).then(r => { this.rows = r; ctx.redraw(); }, e => ctx.flash(String(e.message))); }
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
    const rows = this.rows ?? [];
    if (k.kind === "mouse") return listMouse(this.ptr, k, ctx, this.sel, rows.length, i => { this.sel = i; }, key => this.key(key, ctx));
    if (isBack(k)) return ctx.pop();
    if (k.kind === "enter" && rows.length) return ctx.push(new MessageReader(rows.map(r => r.block), this.sel));
    this.sel = nav(k, rows.length, this.sel, ctx.t.rows - 10);
    ctx.redraw();
  }
}

// ── file areas: the WOE packs, straight out of their zips ────────────────────

export class FileAreas implements Screen {
  title = "file areas";
  private list = packs();
  private sel = 0;
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
    if (k.kind === "mouse") return listMouse(this.ptr, k, ctx, this.sel, this.list.length, i => { this.sel = i; }, key => this.key(key, ctx));
    if (isBack(k)) return ctx.pop();
    if (k.kind === "enter" && this.list[this.sel]) {
      const m = members(this.list[this.sel]!).filter(x => /\.(ans|asc)$/i.test(x.path));
      if (m.length) ctx.push(new ArtViewer(m)); else ctx.flash("no ANSI or ASCII in that pack");
      return;
    }
    this.sel = nav(k, this.list.length, this.sel, 5);
    ctx.redraw();
  }
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
    if (isBack(k)) return ctx.pop();
    const c = k.kind === "char" ? k.ch : "";
    if (c === "." || c === ">" || k.kind === "right") { this.index = (this.index + 1) % this.items.length; this.load(); }
    else if (c === "," || c === "<" || k.kind === "left") { this.index = (this.index + this.items.length - 1) % this.items.length; this.load(); }
    else if (c === "i") { this.ice = !this.ice; this.load(); this.reveal = Infinity; }
    else if (c === "v") ctx.cycleVideo();
    else if (k.kind === "enter" || c === " ") this.reveal = Infinity;
    else if (k.kind === "down" || c === "j") this.scroll = Math.min(Math.max(0, (this.art?.height ?? 0) - 10), this.scroll + 2);
    else if (k.kind === "up" || c === "k") this.scroll = Math.max(0, this.scroll - 2);
    else if (k.kind === "pgdn") this.scroll = Math.min(Math.max(0, (this.art?.height ?? 0) - 10), this.scroll + 20);
    else if (k.kind === "pgup") this.scroll = Math.max(0, this.scroll - 20);
    ctx.redraw();
  }
}

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
    if (isBack(k) || k.kind === "enter") ctx.pop();
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
        "", paint("|08   Kanban, Quay, Desk, Today, Showcase and the message reader write: edits, comments, card moves, trash and restore"),
        paint("|08   go to the outline, recorded as you, or as the agent that did them. The other screens only read."),
        paint("|08   Video cycles Kitty+CRT → Kitty → plain cells. Art and stats are pixels; every word is real terminal text."),
      ],
    };
  }
  /**
   * Any key closes help. So does a click, except on an item's row: that closes help and opens the item, as
   * its key does on the menu (a mouse path of its own: here the keys only close).
   */
  key(k: Key, ctx: Ctx) {
    if (k.kind !== "mouse") return ctx.pop();
    if (k.action === "down" && !this.ptr.at(k.x, k.y)) return ctx.pop();
    this.ptr.mouse(k, { sel: -1, select() {}, send: key => {
      const item = key.kind === "char" ? ITEMS.find(i => i.key === key.ch) : undefined;
      ctx.pop();
      if (item) openItem(item, ctx);
    } });
  }
}
const HELP: Record<string, string> = {
  N: "messages changed since your last call", J: "top-level blocks as conferences", R: "the 200 most recently changed blocks",
  W: "every client attached to the outline right now", L: "who edited what, agents and humans", F: "the WOE art packs, read from their zips",
  S: "activity heatmap and top posters", K: "delivery board: stage lanes, one preview, details, outline and backlinks drawers", Q: "the river: Quay's columns, spines and threads over the live outline", B: "the ep0ch menu by shypht, 1997",
  D: "the desk: outline, reader, thread and live panes you tile yourself", X: "the showcase: every shared part, live (on a showcase outline)", T: "today's brief: the newest type::daily-brief note, live; , . step days", V: "cycle video mode (hidden hotkey)", "?": "this screen", G: "log off (and remember this call)",
};

export class Goodbye implements Screen {
  title = "logoff";
  private at = Date.now();
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
