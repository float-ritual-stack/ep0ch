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
import { ago, bbsDate, colourBody, rule, wrap } from "./text";

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
  constructor(ctx: Ctx) {
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
  key(k: Key, ctx: Ctx) {
    if (isBack(k)) return ctx.push(new Goodbye());
    if (k.kind === "enter" || k.kind === "char") {
      const total = this.script.join("\n").length + 40;
      if (this.shown < total) { this.shown = total; ctx.redraw(); return; }
      ctx.replace(new MainMenu());
    }
  }
}

// ── main menu: the real ep0ch menu, with live commands in its "Menu Cmd" slots ─

interface MenuItem { key: string; label: string; open: (ctx: Ctx) => Screen | null }

const ITEMS: MenuItem[] = [
  { key: "N", label: "Newscan", open: ctx => new MessageList("new scan", n => ctx.board.changedSince(ctx.lastCall, n), "since your last call") },
  { key: "J", label: "Join", open: () => new Conferences() },
  { key: "R", label: "Read", open: ctx => new MessageList("recent", n => ctx.board.changedSince(0, n), "most recently changed") },
  { key: "W", label: "Who's on", open: () => new WhoOnline() },
  { key: "L", label: "Lastcall", open: () => new LastCallers() },
  { key: "F", label: "Files", open: () => new FileAreas() },
  { key: "S", label: "Stats", open: () => new Stats() },
  { key: "Q", label: "Quay", open: () => new River() },
  { key: "B", label: "Bulletin", open: () => new ArtViewer(members(packs().find(p => /woe0497/i.test(p)) ?? packs()[0]!).filter(m => /\.(ans|asc)$/i.test(m.path)), "SHY-EPO!.ANS") },
  { key: "D", label: "Desk", open: () => new Desk() },
  { key: "?", label: "Help", open: () => new Help() },
  { key: "G", label: "Goodbye", open: () => new Goodbye() },
];

export class MainMenu implements Screen {
  title = "main menu";
  private sel = 0;
  render(ctx: Ctx): Frame {
    const art = screenArt("SHY-EMNU.ANS");
    if (!art) return new Help().render(ctx);
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
    const { lines, frame } = artWithText(ctx, "menu", art, merged);
    const item = ITEMS[this.sel]!;
    lines.push("");
    lines.push(center(paint(`|09[|15ep0ch|09] |11main menu |08(|07${ITEMS.map(i => i.key).join("")}|08) |07: |15${item.label}`), ctx.t.cols));
    lines.push(center(paint(`|08${ctx.events ? `|14${ctx.events} change(s) on the outline since you logged on · ` : ""}last call ${ctx.lastCall ? bbsDate(ctx.lastCall) : "never"}`), ctx.t.cols));
    return { lines, placements: frame };
  }
  key(k: Key, ctx: Ctx) {
    if (k.kind === "left") this.sel = (this.sel + ITEMS.length - 4) % ITEMS.length;
    else if (k.kind === "right") this.sel = (this.sel + 4) % ITEMS.length;
    else if (k.kind === "up") this.sel = (this.sel + ITEMS.length - 1) % ITEMS.length;
    else if (k.kind === "down" || k.kind === "tab") this.sel = (this.sel + 1) % ITEMS.length;
    else if (k.kind === "enter") return this.open(ITEMS[this.sel]!, ctx);
    else if (k.kind === "esc") return ctx.push(new Goodbye());
    else if (k.kind === "char" && k.ch.toUpperCase() === "V") { ctx.cycleVideo(); return; }
    else if (k.kind === "char") {
      const hit = ITEMS.findIndex(i => i.key === k.ch.toUpperCase());
      if (hit >= 0) { this.sel = hit; return this.open(ITEMS[hit]!, ctx); }
    }
    ctx.redraw();
  }
  private open(item: MenuItem, ctx: Ctx) {
    const s = item.open(ctx);
    if (s) ctx.push(s); else ctx.redraw();
  }
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
      const num = (m.props["work-id"] ?? String(n + 1)).padStart(7).slice(-7);
      const row = ` ${num}  ${pad(m.author ?? "?", 17)} ${pad(subject(m), Math.max(10, w - 52))} ${bbsDate(m.updatedAt)}`;
      lines.push(n === this.sel ? bg(C.blue) + fg(C.white) + pad(row, w) + RESET : fg(C.lcyan) + num.padStart(8) + fg(C.brown) + "  " + pad(m.author ?? "?", 17) + " " + fg(C.grey) + pad(subject(m), Math.max(10, w - 52)) + " " + fg(C.dark) + bbsDate(m.updatedAt) + RESET);
    });
    while (lines.length < h - 1) lines.push("");
    lines.push(paint("|08  ↑↓ select · |15ENTER|08 read · |15T|08 thread · |15Q|08 back"));
    return { lines };
  }
  key(k: Key, ctx: Ctx) {
    const list = this.items ?? [];
    if (isBack(k)) return ctx.pop();
    if (!list.length) return;
    if (k.kind === "enter") return ctx.push(new Reader(list, this.sel));
    if (k.kind === "char" && k.ch.toLowerCase() === "t") return ctx.push(new MessageList(`thread: ${subject(list[this.sel]!).slice(0, 30)}`, () => ctx.board.children(list[this.sel]!.id), "", false));
    this.sel = nav(k, list.length, this.sel, ctx.t.rows - 10);
    ctx.redraw();
  }
}

export class Reader implements Screen {
  title = "reading";
  private scroll = 0;
  private crumbs: string | null = null;
  private replies: number | null = null;
  constructor(private readonly list: Msg[], private index: number) {}
  private get msg() { return this.list[this.index]!; }
  enter(ctx: Ctx) { this.fetch(ctx); }
  private fetch(ctx: Ctx) {
    const id = this.msg.id;
    this.crumbs = null; this.replies = null;
    ctx.board.ancestors(id).then(a => { if (this.msg.id === id) { this.crumbs = a.map(subject).join(" › ") || "(top level)"; ctx.redraw(); } }, () => {});
    ctx.board.get(id).then(m => { if (m && this.msg.id === id) { this.replies = m.childIds.length; ctx.redraw(); } }, () => {});
  }
  render(ctx: Ctx): Frame {
    const w = ctx.t.cols, h = ctx.t.rows - 1, m = this.msg;
    const status = m.props.status ?? m.props.type ?? "public message";
    const header = [
      paint(`|09Date: |07${bbsDate(m.updatedAt).padEnd(24)}|09Number: |15${m.props["work-id"] ?? m.id.slice(0, 8)} |08(${this.index + 1} of ${this.list.length})`),
      paint(`|09  To: |07${"ALL".padEnd(24)}|09Refer#: |07${m.parentId?.slice(0, 8) ?? "none"}`),
      paint(`|09From: |14${pad(m.author ?? "?", 23)} |09Reply: |07${this.replies === null ? "…" : this.replies}`),
      paint(`|09Subj: |15${subject(m).slice(0, w - 30)}`) ,
      paint(`|09Conf: |11${pad(this.crumbs ?? "…", w - 7)}`),
      paint(`|09Stat: |13${status.toUpperCase()}`),
      rule(w),
    ];
    const body = wrap(m.text.split("\n").slice(1).join("\n").replace(/^\n+/, ""), w - 2).map(l => " " + colourBody(l));
    const room = h - header.length - 2;
    this.scroll = Math.max(0, Math.min(this.scroll, body.length - room));
    const lines = [...header, ...body.slice(this.scroll, this.scroll + room)];
    while (lines.length < h - 1) lines.push("");
    const more = body.length > room ? ` · ${Math.round(((this.scroll + room) / body.length) * 100)}%` : "";
    lines.push(paint(`|08  |15N|08ext |15P|08rev |15T|08hread |15U|08p · ↑↓ scroll${more} · |15Q|08 back`));
    return { lines };
  }
  key(k: Key, ctx: Ctx) {
    if (isBack(k)) return ctx.pop();
    const c = k.kind === "char" ? k.ch.toLowerCase() : "";
    if (c === "n" || k.kind === "enter" || k.kind === "right") { if (this.index < this.list.length - 1) { this.index++; this.scroll = 0; this.fetch(ctx); } else ctx.flash("end of messages"); }
    else if (c === "p" || k.kind === "left") { if (this.index > 0) { this.index--; this.scroll = 0; this.fetch(ctx); } }
    else if (c === "t") return ctx.push(new MessageList(`thread: ${subject(this.msg).slice(0, 30)}`, () => ctx.board.children(this.msg.id), "", false));
    else if (c === "u") {
      const parent = this.msg.parentId;
      if (!parent) { ctx.flash("already at the top of the conference"); return; }
      ctx.board.get(parent).then(p => { if (p) ctx.push(new Reader([p], 0)); }, () => {});
      return;
    }
    else if (k.kind === "up" || c === "k") this.scroll = Math.max(0, this.scroll - 1);
    else if (k.kind === "down" || c === "j" || c === " ") this.scroll += c === " " ? ctx.t.rows - 10 : 1;
    else if (k.kind === "pgdn") this.scroll += ctx.t.rows - 10;
    else if (k.kind === "pgup") this.scroll = Math.max(0, this.scroll - (ctx.t.rows - 10));
    ctx.redraw();
  }
}

export class Conferences implements Screen {
  title = "join conference";
  private confs: Msg[] | null = null;
  private sel = 0;
  enter(ctx: Ctx) { ctx.board.roots().then(r => { this.confs = r; ctx.redraw(); }, e => ctx.flash(String(e.message))); }
  render(ctx: Ctx): Frame {
    const w = ctx.t.cols;
    const lines = [center(paint("|09─=|11[ |15CONFERENCES |11]|09=─"), w), center(paint("|08top-level blocks on the board"), w), ""];
    (this.confs ?? []).forEach((c, i) => {
      const label = `${String(i + 1).padStart(3)}  ${pad(subject(c), w - 30)} ${fg(C.dark)}${c.props.type ?? ""}`;
      lines.push(i === this.sel ? bg(C.blue) + fg(C.white) + pad(label, w) + RESET : fg(C.lcyan) + label.slice(0, 5) + fg(C.grey) + label.slice(5) + RESET);
    });
    if (!this.confs) lines.push(paint("|08  dialing…"));
    return { lines };
  }
  key(k: Key, ctx: Ctx) {
    if (isBack(k)) return ctx.pop();
    const list = this.confs ?? [];
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
  enter(ctx: Ctx) { this.load(ctx); }
  private load(ctx: Ctx) {
    ctx.board.callers().then(c => {
      this.callers = c; ctx.redraw();
      for (const x of c) if (x.target && !this.subjects.has(x.target)) ctx.board.get(x.target).then(m => { if (m) { this.subjects.set(x.target!, subject(m)); ctx.redraw(); } }, () => {});
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
    return { lines };
  }
  key(k: Key, ctx: Ctx) { if (isBack(k) || k.kind === "enter") ctx.pop(); else if (k.kind === "char" && k.ch === "r") this.load(ctx); }
}

export class LastCallers implements Screen {
  title = "last callers";
  private rows: Activity[] | null = null;
  private sel = 0;
  enter(ctx: Ctx) { ctx.board.activity(80).then(r => { this.rows = r; ctx.redraw(); }, e => ctx.flash(String(e.message))); }
  render(ctx: Ctx): Frame {
    const w = ctx.t.cols, h = ctx.t.rows - 1;
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
      const row = ` ${ago(r.at).padStart(5)}  ${pad(r.actor, 21)} ${pad(r.kind === "properties" ? "props" : "edit", 6)} ${pad(subject(r.block), w - 40)}`;
      lines.push(start + i === this.sel ? bg(C.blue) + fg(C.white) + pad(row, w) + RESET
        : `${fg(C.dark)}${row.slice(0, 7)}${fg(r.author === "agent" ? C.lmagenta : r.author === "user" ? C.yellow : C.cyan)}${row.slice(7, 30)}${fg(C.dark)}${row.slice(30, 37)}${fg(C.grey)}${row.slice(37)}${RESET}`);
    });
    while (lines.length < h - 1) lines.push("");
    lines.push(paint("|08  |13agents|08 · |14you|08 · |03system|08 · ENTER read · Q back"));
    return { lines };
  }
  key(k: Key, ctx: Ctx) {
    const rows = this.rows ?? [];
    if (isBack(k)) return ctx.pop();
    if (k.kind === "enter" && rows.length) return ctx.push(new Reader(rows.map(r => r.block), this.sel));
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
  render(ctx: Ctx): Frame {
    const w = ctx.t.cols, h = ctx.t.rows - 1;
    const lines = [center(paint("|09─=|11[ |15FILE AREA 1 · WOE ART PACKS |11]|09=─"), w), "", paint("|09 Filename        Size  Date      Description"), rule(w)];
    this.list.forEach((p, i) => {
      if (!this.diz.has(p)) this.diz.set(p, readDiz(p));
      const size = Bun.file(p).size;
      const d = this.diz.get(p)!;
      const on = i === this.sel;
      const head = ` ${pad(basename(p).toUpperCase(), 14)} ${String(Math.round(size / 1024)).padStart(5)}k  ${pad(d[0] ?? "", w - 32)}`;
      lines.push(on ? bg(C.blue) + fg(C.white) + pad(head, w) + RESET : fg(C.lcyan) + head.slice(0, 15) + fg(C.grey) + head.slice(15, 23) + fg(C.white) + head.slice(23) + RESET);
      if (on) for (const extra of d.slice(1, 6)) lines.push(`${" ".repeat(24)}${fg(C.dark)}${pad(extra, w - 25)}${RESET}`);
    });
    while (lines.length < h - 1) lines.push("");
    lines.push(paint("|08  ↑↓ select · |15ENTER|08 browse pack · Q back"));
    return { lines };
  }
  key(k: Key, ctx: Ctx) {
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
    lines.push(paint(`|08  |15, .|08 prev/next · ↑↓ scroll · |15i|08 iCE · |15v|08 video (${ctx.video}) · |15Q|08 back`));
    return { lines, placements };
  }
  key(k: Key, ctx: Ctx) {
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
  enter(ctx: Ctx) { ctx.board.changedSince(0, 300).then(m => { this.msgs = m; ctx.redraw(); }, e => ctx.flash(String(e.message))); }
  render(ctx: Ctx): Frame {
    const w = ctx.t.cols;
    const lines = [center(paint("|09─=|11[ |15BOARD STATS |11]|09=─"), w), center(paint("|08when the last 300 messages were written · hour of day × day of week"), w), ""];
    if (!this.msgs) return { lines: [...lines, paint("|08  counting…")] };
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
    return { lines, placements: hm.placements };
  }
  key(k: Key, ctx: Ctx) { if (isBack(k) || k.kind === "enter") ctx.pop(); }
}

export class Help implements Screen {
  title = "help";
  render(ctx: Ctx): Frame {
    const w = ctx.t.cols;
    return {
      lines: [
        center(paint("|09─=|11[ |15ep0ch · a door into the outline |11]|09=─"), w), "",
        ...ITEMS.map(i => paint(`   |09[|15${i.key}|09] |11${i.label.padEnd(10)}|07${HELP[i.key] ?? ""}`)),
        "", paint("|08   Read-only. Nothing you do here writes to the outline."),
        paint("|08   Video cycles Kitty+CRT → Kitty → plain cells. Art and stats are pixels; every word is real terminal text."),
      ],
    };
  }
  key(_: Key, ctx: Ctx) { ctx.pop(); }
}
const HELP: Record<string, string> = {
  N: "messages changed since your last call", J: "top-level blocks as conferences", R: "the 200 most recently changed blocks",
  W: "every client attached to the outline right now", L: "who edited what, agents and humans", F: "the WOE art packs, read from their zips",
  S: "activity heatmap and top posters", Q: "the river: Quay's columns, spines and threads over the live outline", B: "the ep0ch menu by shypht, 1997",
  D: "the desk: outline, reader, thread and live panes you tile yourself", V: "cycle video mode (hidden hotkey)", "?": "this screen", G: "log off (and remember this call)",
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
