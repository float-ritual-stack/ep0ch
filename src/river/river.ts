// River: Quay's model (niri placement, Andy-style compression, Twitter threads) in character cells.
// Columns sit in one horizontal strip. Opening a note inserts a column beside its source; columns
// compress full → peek → spine as they recede from focus. Replies expand in place.
import { CP437_HIGH } from "../ansi";
import type { Ctx, Frame, Screen } from "../app";
import { subject, type Msg } from "../board";
import { Canvas, type Rect } from "../canvas";
import type { Placement } from "../kitty";
import type { IndexBlock, OutlineEvent } from "../socket";
import { readState, writeState } from "../state";
import { bg, C, fg, pad, paint, RESET } from "../style";
import type { Key } from "../term";
import { ago, colourBody, wrap } from "../text";
import { rasterize, rotateCW, type Rgba } from "../vga";

type Source = { kind: "roots" } | { kind: "block"; id: string } | { kind: "tag"; key: string; value: string };
interface Clause { key: string; value: string; exclude: boolean }
interface PaneS {
  source: Source;
  root: Msg | null;
  items: Msg[] | null;
  open: Set<string>;
  kids: Map<string, Msg[] | "loading">;
  sel: number;
  top: number;
  filter: Clause[];
  error?: string;
}
interface Col { uid: number; panes: PaneS[]; pane: number; pinned: boolean }
type Cover = "full" | "peek" | "spine";
interface Row { m: Msg; depth: number }
interface Hit { rect: Rect; col: number; pane: number; rows: { card: number; replies: boolean }[] }

const SPINE = 3, PEEK = 24;
const SEL = bg(C.blue) + fg(C.white);
const CHIP_COLOURS = [C.lgreen, C.lcyan, C.yellow, C.lmagenta, C.lred, C.lblue];
const GLYPH: Record<string, string> = { hub: "◎", workboard: "▦", workspace: "▣", notes: "▤", "virtual-branch": "⑂", "roadmap-item": "◆", proof: "✓", synthesis: "✦", inbox: "✉", note: "·" };
const toCp437 = new Map<string, number>([...CP437_HIGH].map((c, i) => [c, 128 + i]));

// ── the index: counts, titles, instant search ────────────────────────────────

class OutlineIndex {
  byId = new Map<string, IndexBlock>();
  counts = new Map<string, number>();
  loaded = false;
  set(list: IndexBlock[]) {
    this.byId = new Map(list.map(b => [b.id, b]));
    this.counts = new Map();
    for (const b of list) if (b.parentId) this.counts.set(b.parentId, (this.counts.get(b.parentId) ?? 0) + 1);
    this.loaded = true;
  }
  count(id: string): number | undefined { return this.loaded ? this.counts.get(id) ?? 0 : undefined; }
  search(q: string, limit = 40): IndexBlock[] {
    const s = q.toLowerCase().trim();
    if (!s) return [...this.byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
    const scored: [number, IndexBlock][] = [];
    for (const b of this.byId.values()) {
      const t = b.title.toLowerCase(), w = (b.props["work-id"] ?? "").toLowerCase();
      const score = w === s ? 0 : t.startsWith(s) || w.startsWith(s) ? 1 : t.includes(s) || w.includes(s) ? 2 : -1;
      if (score >= 0) scored.push([score, b]);
    }
    return scored.sort((a, b) => a[0] - b[0] || b[1].updatedAt - a[1].updatedAt).slice(0, limit).map(x => x[1]);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

const authorColour = (a: string | null) => {
  const s = (a ?? "").toLowerCase();
  if (s === "user" || s === "detail" || s === "tree") return C.yellow;
  if (s === "system") return C.cyan;
  return C.lmagenta;
};
const chipColour = (key: string) => CHIP_COLOURS[[...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % CHIP_COLOURS.length]!;
const chips = (props: Record<string, string>) =>
  ["type", "status", "stage", "project", "priority"].filter(k => props[k]).map(k => `${fg(chipColour(k))}#${props[k]}${RESET}`).join(" ");
const glyph = (m: Msg) => GLYPH[m.props.type ?? ""] ?? "◇";
const bodyLines = (m: Msg) => m.text.split("\n").slice(1).map(l => l.replace(/\[[\w-]+::[^\]]*\]/g, "").trimEnd()).filter(l => l.trim());

function parseFilter(s: string): Clause[] {
  return s.split(/\s+/).filter(Boolean).map(tok => {
    const exclude = tok.startsWith("-");
    const body = exclude ? tok.slice(1) : tok;
    const at = body.indexOf(":");
    return at > 0 ? { key: body.slice(0, at), value: body.slice(at + 1), exclude } : { key: "text", value: body, exclude };
  });
}
const filterText = (f: Clause[]) => f.map(c => `${c.exclude ? "-" : ""}${c.key === "text" ? "" : c.key + ":"}${c.value}`).join(" ");
function passes(m: Msg, f: Clause[]): boolean {
  return f.every(c => {
    const v = c.key === "author" ? m.author ?? "" : c.key === "text" ? m.text : m.props[c.key];
    const hit = c.key === "text" ? m.text.toLowerCase().includes(c.value.toLowerCase())
      : c.value === "*" ? v !== undefined : (v ?? "").toLowerCase() === c.value.toLowerCase();
    return c.exclude ? !hit : hit;
  });
}

const spineCache = new Map<string, Rgba>();
function spineImage(title: string, colour: number): Rgba {
  const key = `${colour}:${title}`;
  let img = spineCache.get(key);
  if (!img) {
    const row = [...title].map(ch => ({ code: ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : toCp437.get(ch) ?? 63, fg: colour, bg: 0 }));
    img = rotateCW(rasterize([row], 0, 0, row.length, 1, { clearBg: true }));
    spineCache.set(key, img);
  }
  return img;
}

// ── the river ────────────────────────────────────────────────────────────────

interface SavedRiver { cols: { panes: { source: Source; filter: Clause[] }[]; pinned: boolean }[]; focus: number }

export class River implements Screen {
  title = "river";
  ctx!: Ctx;
  private cols: Col[] = [];
  private focus = 0;
  private uid = 1;
  private idx = new OutlineIndex();
  private indexing: number | null = null;
  private lastIndex = 0;
  private lastTick = 0;
  private mode: "" | "filter" | "palette" | "tags" | "help" = "";
  private input = "";
  private matches: IndexBlock[] = [];
  private msel = 0;
  private tagChoices: [string, string][] = [];
  private hits: Hit[] = [];
  private colRects: { col: number; rect: Rect }[] = [];
  private reloads = new Map<PaneS, Timer>();

  enter(ctx: Ctx) {
    this.ctx = ctx;
    const cached = readState<{ blocks: IndexBlock[] }>("river-index.json");
    if (cached?.blocks?.length) this.idx.set(cached.blocks);
    this.refreshIndex();
    const saved = readState<SavedRiver>("river.json");
    if (saved?.cols?.length) {
      for (const c of saved.cols) this.cols.push({ uid: this.uid++, pinned: c.pinned, pane: 0, panes: c.panes.map(p => this.pane(p.source, p.filter)) });
      this.focus = Math.min(saved.focus, this.cols.length - 1);
    } else {
      this.cols.push({ uid: this.uid++, pinned: true, pane: 0, panes: [this.pane({ kind: "roots" })] });
    }
    for (const c of this.cols) for (const p of c.panes) this.load(p);
  }

  private pane(source: Source, filter: Clause[] = []): PaneS {
    return { source, root: null, items: null, open: new Set(), kids: new Map(), sel: 0, top: 0, filter };
  }

  private save() {
    writeState("river.json", {
      cols: this.cols.map(c => ({ pinned: c.pinned, panes: c.panes.map(p => ({ source: p.source, filter: p.filter })) })),
      focus: this.focus,
    } satisfies SavedRiver);
  }

  private refreshIndex() {
    if (this.indexing !== null) return;
    this.indexing = Date.now();
    this.ctx.board.index().then(list => {
      this.idx.set(list); this.lastIndex = Date.now(); this.indexing = null;
      writeState("river-index.json", { blocks: list });
      this.ctx.redraw();
    }, () => { this.indexing = null; });
  }

  private load(p: PaneS) {
    const b = this.ctx.board;
    const done = (items: Msg[]) => { p.items = items; p.error = undefined; p.sel = Math.min(p.sel, Math.max(0, items.length - 1)); this.ctx.redraw(); };
    const fail = (e: Error) => { p.error = e.message; this.ctx.redraw(); };
    if (p.source.kind === "roots") b.roots().then(done, fail);
    else if (p.source.kind === "tag") b.byProp(p.source.key, p.source.value).then(done, fail);
    else {
      const id = p.source.id;
      b.get(id).then(m => { p.root = m; this.ctx.redraw(); }, () => {});
      b.children(id).then(done, fail);
    }
  }

  private titleOf(p: PaneS): string {
    if (p.source.kind === "roots") return "Library";
    if (p.source.kind === "tag") return `#${p.source.value}`;
    return p.root ? subject(p.root) : this.idx.byId.get(p.source.id)?.title ?? "…";
  }

  private flat(p: PaneS): Row[] {
    const out: Row[] = [];
    const walk = (list: Msg[], depth: number) => {
      for (const m of list) {
        if (depth === 0 && !passes(m, p.filter)) continue;
        out.push({ m, depth });
        const k = p.kids.get(m.id);
        if (p.open.has(m.id) && Array.isArray(k)) walk(k, depth + 1);
      }
    };
    walk(p.items ?? [], 0);
    return out;
  }

  private get col() { return this.cols[this.focus]; }
  private get paneS() { const c = this.col; return c ? c.panes[c.pane] : undefined; }
  private selected(): Msg | undefined { const p = this.paneS; return p ? this.flat(p)[p.sel]?.m : undefined; }

  // ── layout: progressive compression ───────────────────────────────────────

  private layout(W: number): { col: number; cover: Cover; width: number }[] {
    const n = this.cols.length;
    const FULL = Math.max(40, Math.min(76, Math.round(W * 0.42)));
    // Too many columns even as spines: keep the ones nearest focus.
    const visible = [...this.cols.keys()].sort((a, b) => Math.abs(a - this.focus) - Math.abs(b - this.focus) || b - a)
      .slice(0, Math.max(1, Math.floor(W / SPINE))).sort((a, b) => a - b);
    const cover = new Map<number, Cover>(visible.map(i => [i, "spine"]));
    let spare = W - visible.length * SPINE;
    const order = [...visible].sort((a, b) => {
      const da = a === this.focus ? -1 : this.cols[a]!.pinned ? 0.5 : Math.abs(a - this.focus);
      const db = b === this.focus ? -1 : this.cols[b]!.pinned ? 0.5 : Math.abs(b - this.focus);
      return da - db || b - a;
    });
    for (const i of order) {
      if (spare >= FULL - SPINE) { cover.set(i, "full"); spare -= FULL - SPINE; }
      else if (spare >= PEEK - SPINE) { cover.set(i, "peek"); spare -= PEEK - SPINE; }
    }
    const width = new Map<number, number>(visible.map(i => [i, cover.get(i) === "full" ? FULL : cover.get(i) === "peek" ? PEEK : SPINE]));
    // Hand any leftover to the focused column so the strip fills the screen.
    width.set(this.focus, (width.get(this.focus) ?? FULL) + Math.max(0, spare));
    void n;
    return visible.map(i => ({ col: i, cover: cover.get(i)!, width: width.get(i)! }));
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  render(ctx: Ctx): Frame {
    const { cols: W, rows } = ctx.t;
    const H = rows - 2;
    const canvas = new Canvas(W, rows - 1);
    const placements: Placement[] = [];
    this.hits = []; this.colRects = [];
    let x = 0;
    for (const { col: ci, cover, width } of this.layout(W)) {
      const col = this.cols[ci]!;
      const rect: Rect = { col: x, row: 0, cols: width, rows: H };
      this.colRects.push({ col: ci, rect });
      x += width;
      const focused = ci === this.focus;
      if (cover === "spine") { this.spine(canvas, placements, col, rect, focused, ctx); continue; }
      const p0 = col.panes[0]!;
      const count = p0.items ? ` ${fg(C.dark)}${this.flat(p0).length}` : "";
      canvas.box(rect, fg(focused ? C.lcyan : col.pinned ? C.cyan : C.blue),
        `${col.pinned ? fg(C.yellow) + "⊙ " : ""}${fg(focused ? C.white : C.grey)}${this.titleOf(p0)}${count}`,
        focused && cover === "full" ? fg(C.dark) + "space replies · ⏎ open · s split · f filter · # tags" : "");
      const inner: Rect = { col: rect.col + 1, row: rect.row + 1, cols: rect.cols - 2, rows: rect.rows - 2 };
      const n = col.panes.length;
      const each = Math.floor(inner.rows / n);
      col.panes.forEach((p, pi) => {
        const r: Rect = { col: inner.col, row: inner.row + pi * each, cols: inner.cols, rows: pi === n - 1 ? inner.rows - pi * each : each };
        let body = r;
        if (n > 1 || p.filter.length) {
          const active = focused && pi === col.pane;
          const head = `${fg(active ? C.lcyan : C.blue)}── ${fg(active ? C.white : C.grey)}${this.titleOf(p)} ${p.filter.length ? fg(C.yellow) + "⌕ " + filterText(p.filter) + " " : ""}`;
          canvas.text(r.col, r.row, pad(head + fg(active ? C.lcyan : C.blue) + "─".repeat(r.cols), r.cols), r.cols);
          body = { ...r, row: r.row + 1, rows: r.rows - 1 };
        }
        const view = cover === "peek" ? this.peek(p, body, focused && pi === col.pane) : this.full(p, body, focused && pi === col.pane);
        view.lines.forEach((l, i) => canvas.text(body.col, body.row + i, l, body.cols));
        this.hits.push({ rect: body, col: ci, pane: pi, rows: view.rows });
      });
    }
    if (this.mode === "palette") this.drawPalette(canvas, W, rows);
    if (this.mode === "tags") this.drawTags(canvas, W, rows);
    if (this.mode === "help") this.drawHelp(canvas, W, rows);
    canvas.text(0, rows - 2, this.hints(W), W);
    return { lines: canvas.lines(), placements: this.mode === "" || this.mode === "filter" ? placements : [] };
  }

  private spine(canvas: Canvas, placements: Placement[], col: Col, r: Rect, focused: boolean, ctx: Ctx) {
    const colour = focused ? C.white : col.pinned ? C.yellow : C.lcyan;
    for (let y = r.row; y < r.row + r.rows; y++) canvas.text(r.col + r.cols - 1, y, fg(C.blue) + "│" + RESET, 1);
    canvas.text(r.col, r.row, fg(col.pinned ? C.yellow : C.dark) + (col.pinned ? "⊙" : "·") + RESET, 1);
    const title = this.titleOf(col.panes[0]!);
    const t = ctx.t;
    if (ctx.graphics) {
      // Rotated VGA text: 16px wide per glyph row, 9px per character down the spine.
      const maxChars = Math.max(1, Math.floor(((r.rows - 2) * t.cellH * 16) / (2 * t.cellW * 9)));
      const text = title.length > maxChars ? title.slice(0, maxChars - 1) + "…" : title;
      const img = spineImage(text, colour);
      const rowsNeeded = Math.max(1, Math.ceil((img.height * (2 * t.cellW / img.width)) / t.cellH));
      placements.push({ key: `spine:${col.uid}`, image: img, col: r.col, row: r.row + 1, cols: 2, rows: Math.min(rowsNeeded, r.rows - 1), z: -1 });
    } else {
      [...title].slice(0, r.rows - 1).forEach((ch, i) => canvas.text(r.col, r.row + 1 + i, fg(colour) + ch + RESET, 1));
    }
  }

  private peek(p: PaneS, r: Rect, active: boolean): { lines: string[]; rows: Hit["rows"] } {
    const rows = this.flat(p);
    const lines: string[] = [], hit: Hit["rows"] = [];
    p.top = Math.max(0, Math.min(p.top, p.sel - Math.floor(r.rows / 2)));
    rows.slice(p.top, p.top + r.rows).forEach((row, i) => {
      const n = p.top + i;
      const t = `${"  ".repeat(row.depth)}${glyph(row.m)} ${subject(row.m)}`;
      lines.push(n === p.sel ? (active ? SEL : bg(C.dark) + fg(C.white)) + pad(t, r.cols) + RESET : fg(C.grey) + pad(t, r.cols) + RESET);
      hit.push({ card: n, replies: false });
    });
    if (!p.items) lines.push(fg(C.dark) + "…" + RESET);
    return { lines, rows: hit };
  }

  private full(p: PaneS, r: Rect, active: boolean): { lines: string[]; rows: Hit["rows"] } {
    const w = r.cols;
    const all: { text: string; card: number; replies: boolean }[] = [];
    const push = (text: string, card = -1, replies = false) => all.push({ text, card, replies });
    if (p.error) push(fg(C.lred) + p.error + RESET);
    if (p.source.kind === "block" && p.root) {
      const m = p.root;
      push(fg(C.white) + pad(`${glyph(m)} ${subject(m)}`, w) + RESET);
      push(`${fg(authorColour(m.author))}${m.author ?? "?"}${fg(C.dark)} · ${ago(m.updatedAt)}  ${chips(m.props)}`);
      const body = wrap(bodyLines(m).join("\n"), w - 1);
      body.slice(0, 12).forEach(l => push(" " + colourBody(l)));
      if (body.length > 12) push(fg(C.dark) + ` … ${body.length - 12} more lines (open in the desk reader for all)` + RESET);
      const label = `── ${p.items ? this.flat(p).length : "…"} replies `;
      push(fg(C.blue) + label + "─".repeat(Math.max(0, w - label.length)) + RESET);
    }
    const rows = this.flat(p);
    rows.forEach((row, n) => {
      const m = row.m, on = n === p.sel;
      const rail = fg(C.blue) + "│ ".repeat(row.depth) + RESET;
      const mark = on ? fg(active ? C.lcyan : C.grey) + "▌" + RESET : " ";
      const tw = Math.max(8, w - row.depth * 2 - 2);
      const title = `${glyph(m)} ${subject(m)}`;
      push(rail + mark + (on && active ? SEL : fg(C.white)) + pad(title, tw) + RESET, n);
      push(rail + " " + pad(`${fg(authorColour(m.author))}${m.author ?? "?"}${fg(C.dark)} · ${ago(m.updatedAt)}  ${chips(m.props)}`, tw), n);
      for (const l of wrap(bodyLines(m).slice(0, 2).join(" "), tw).slice(0, 2)) push(rail + " " + fg(C.grey) + pad(l, tw) + RESET, n);
      const count = this.idx.count(m.id) ?? (Array.isArray(p.kids.get(m.id)) ? (p.kids.get(m.id) as Msg[]).length : undefined);
      if (p.kids.get(m.id) === "loading") push(rail + " " + fg(C.dark) + "↳ loading replies…" + RESET, n, true);
      else if (count) push(rail + " " + fg(C.cyan) + (p.open.has(m.id) ? `▾ ${count} replies · hide` : `↳ ${count} replies`) + RESET, n, true);
      push(rail, n);
    });
    if (!p.items && !p.error) push(fg(C.dark) + "dialing…" + RESET);
    // Keep the selected card on screen.
    const first = all.findIndex(l => l.card === p.sel), last = all.findLastIndex(l => l.card === p.sel);
    if (first >= 0) {
      if (first < p.top) p.top = Math.max(0, first - (p.source.kind === "block" && p.sel === 0 ? first : 0));
      if (last >= p.top + r.rows) p.top = last - r.rows + 1;
    }
    p.top = Math.max(0, Math.min(p.top, Math.max(0, all.length - r.rows)));
    const view = all.slice(p.top, p.top + r.rows);
    return { lines: view.map(l => l.text), rows: view.map(l => ({ card: l.card, replies: l.replies })) };
  }

  private hints(W: number): string {
    if (this.mode === "filter") return pad(paint(`|14filter this pane: |15${this.input}|07▁ |08 type:hub -status:done author:codex word · ⏎ apply · esc cancel`), W);
    const meter = this.indexing !== null ? ` · |14indexing ${"▒▓█▓"[Math.floor(Date.now() / 150) % 4]} ${((Date.now() - this.indexing) / 1000).toFixed(0)}s` : this.idx.loaded ? ` · |08${this.idx.byId.size} indexed` : "";
    return pad(paint(`|08 h l columns · j k notes · |15⏎|08 open beside · |15alt⏎|08 duplicate · |15space|08 replies · |15/|08 jump · |15?|08 keys · |15esc|08 menu${meter}`), W);
  }

  private overlay(canvas: Canvas, W: number, rows: number, wFrac: number, hFrac: number, title: string): Rect {
    const r: Rect = { col: Math.floor(W * (1 - wFrac) / 2), row: Math.floor(rows * (1 - hFrac) / 3), cols: Math.floor(W * wFrac), rows: Math.floor(rows * hFrac) };
    canvas.clear(r, bg(C.black));
    canvas.box(r, fg(C.yellow), fg(C.yellow) + title);
    return { col: r.col + 1, row: r.row + 1, cols: r.cols - 2, rows: r.rows - 2 };
  }

  private drawPalette(canvas: Canvas, W: number, rows: number) {
    const r = this.overlay(canvas, W, rows, 0.6, 0.6, `jump · ${this.idx.loaded ? `${this.idx.byId.size} notes, local` : "index loading…"}`);
    canvas.text(r.col, r.row, paint(`|14/ |15${this.input}|07▁`), r.cols);
    this.matches.slice(0, r.rows - 2).forEach((b, i) => {
      const parent = b.parentId ? this.idx.byId.get(b.parentId)?.title ?? "" : "top level";
      const line = `${pad(`${b.props["work-id"] && !b.title.startsWith(b.props["work-id"]) ? b.props["work-id"] + " " : ""}${b.title}`, Math.floor(r.cols * 0.6))} ${fg(C.dark)}${parent}`;
      canvas.text(r.col, r.row + 2 + i, (i === this.msel ? SEL : fg(C.grey)) + pad(line, r.cols) + RESET, r.cols);
    });
  }

  private drawTags(canvas: Canvas, W: number, rows: number) {
    const r = this.overlay(canvas, W, rows, 0.4, 0.4, "open a virtual branch");
    this.tagChoices.forEach(([k, v], i) => canvas.text(r.col + 1, r.row + i, paint(`|15${i + 1} |08${k}:: |11#${v}`), r.cols - 1));
    if (!this.tagChoices.length) canvas.text(r.col + 1, r.row, paint("|08this note has no properties"), r.cols);
  }

  private drawHelp(canvas: Canvas, W: number, rows: number) {
    const r = this.overlay(canvas, W, rows, 0.56, 0.7, "river · keys");
    const help = [
      "h l / ← →      previous / next column",
      "j k / ↑ ↓      previous / next note",
      "⏎              reveal if open, else insert beside the source",
      "alt ⏎          force a duplicate column",
      "space          expand replies in place",
      "s              split this note down as its own pane",
      "tab            next stacked pane in the column",
      "p              dock / undock the column (resists compression)",
      "x              close pane, or the column when it has one",
      "f              filter this pane (type:hub -status:done author:x word)",
      "#              open a virtual branch from this note's properties",
      "/              jump: instant search over the whole index",
      "q              quote (needs write access; the door is read-only)",
      "click          focus a spine, pick a note, open replies",
    ];
    help.forEach((l, i) => canvas.text(r.col + 1, r.row + i, fg(C.grey) + l + RESET, r.cols - 1));
  }

  // ── actions ───────────────────────────────────────────────────────────────

  private open(m: Msg, duplicate: boolean) {
    if (!duplicate) {
      const at = this.cols.findIndex(c => c.panes[0]!.source.kind === "block" && (c.panes[0]!.source as { id: string }).id === m.id);
      if (at >= 0) { this.focus = at; this.save(); return this.ctx.redraw(); }
    }
    const p = this.pane({ kind: "block", id: m.id });
    p.root = m;
    this.cols.splice(this.focus + 1, 0, { uid: this.uid++, panes: [p], pane: 0, pinned: false });
    this.focus += 1;
    this.load(p);
    this.save();
    this.ctx.redraw();
  }

  private openTag(key: string, value: string) {
    const p = this.pane({ kind: "tag", key, value });
    this.cols.splice(this.focus + 1, 0, { uid: this.uid++, panes: [p], pane: 0, pinned: false });
    this.focus += 1;
    this.load(p); this.save(); this.ctx.redraw();
  }

  private toggle(p: PaneS, m: Msg) {
    if (p.open.has(m.id)) { p.open.delete(m.id); return this.ctx.redraw(); }
    p.open.add(m.id);
    if (!p.kids.has(m.id)) {
      p.kids.set(m.id, "loading");
      this.ctx.board.children(m.id).then(k => { p.kids.set(m.id, k); this.ctx.redraw(); }, () => { p.kids.set(m.id, []); this.ctx.redraw(); });
    }
    this.ctx.redraw();
  }

  tick() {
    if (this.indexing === null) return false;
    const now = Date.now();
    if (now - this.lastTick < 250) return false;
    this.lastTick = now;
    return true;
  }

  onEvent(e: OutlineEvent) {
    const id = e.blockId;
    if (id) for (const c of this.cols) for (const p of c.panes) {
      const shows = (p.source.kind === "block" && p.source.id === id) || p.items?.some(m => m.id === id || m.parentId === id);
      if (!shows) continue;
      clearTimeout(this.reloads.get(p));
      this.reloads.set(p, setTimeout(() => this.load(p), 800));
    }
    if (Date.now() - this.lastIndex > 60_000) this.refreshIndex();
  }

  key(k: Key, ctx: Ctx) {
    if (this.mode) return this.modal(k);
    if (k.kind === "mouse") return this.mouse(k);
    const col = this.col, p = this.paneS;
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    const n = p ? this.flat(p).length : 0;
    if (k.kind === "left" || c === "h") this.focus = Math.max(0, this.focus - 1);
    else if (k.kind === "right" || c === "l") this.focus = Math.min(this.cols.length - 1, this.focus + 1);
    else if (p && (k.kind === "down" || c === "j")) p.sel = Math.min(Math.max(0, n - 1), p.sel + 1);
    else if (p && (k.kind === "up" || c === "k")) p.sel = Math.max(0, p.sel - 1);
    else if (p && k.kind === "pgdn") p.sel = Math.min(Math.max(0, n - 1), p.sel + 8);
    else if (p && k.kind === "pgup") p.sel = Math.max(0, p.sel - 8);
    else if (p && k.kind === "home") p.sel = 0;
    else if (p && k.kind === "end") p.sel = Math.max(0, n - 1);
    else if (col && (k.kind === "tab" || k.kind === "backtab")) col.pane = (col.pane + (k.kind === "tab" ? 1 : col.panes.length - 1)) % col.panes.length;
    else if (k.kind === "enter" || k.kind === "alt-enter") { const m = this.selected(); if (m) return this.open(m, k.kind === "alt-enter"); }
    else if (c === " ") { const m = this.selected(); if (p && m) return this.toggle(p, m); }
    else if (c === "s" && col) {
      const m = this.selected();
      if (m) { const np = this.pane({ kind: "block", id: m.id }); np.root = m; col.panes.push(np); col.pane = col.panes.length - 1; this.load(np); this.save(); }
    }
    else if (c === "p" && col) { col.pinned = !col.pinned; this.save(); }
    else if (c === "x" && col) {
      if (col.panes.length > 1) { col.panes.splice(col.pane, 1); col.pane = Math.max(0, col.pane - 1); }
      else if (this.cols.length > 1) { this.cols.splice(this.focus, 1); this.focus = Math.max(0, this.focus - 1); }
      this.save();
    }
    else if (c === "f" && p) { this.mode = "filter"; this.input = filterText(p.filter); }
    else if (c === "#") { const m = this.selected(); this.tagChoices = m ? Object.entries(m.props).filter(([key]) => !["source-block", "proof", "work-batch"].includes(key)).slice(0, 9) : []; this.mode = "tags"; }
    else if (c === "/") { this.mode = "palette"; this.input = ""; this.matches = this.idx.search(""); this.msel = 0; }
    else if (c === "?") this.mode = "help";
    else if (c === "q") ctx.flash("quote writes a new note; this door is read-only");
    else if (c === "V") return ctx.cycleVideo();
    else if (k.kind === "esc") return ctx.pop();
    else return;
    this.save();
    ctx.redraw();
  }

  private modal(k: Key) {
    const ctx = this.ctx;
    if (this.mode === "help") { this.mode = ""; return ctx.redraw(); }
    if (k.kind === "esc") { this.mode = ""; return ctx.redraw(); }
    if (this.mode === "tags") {
      const i = k.kind === "char" ? Number(k.ch) - 1 : -1;
      const t = this.tagChoices[i];
      this.mode = "";
      if (t) return this.openTag(t[0], t[1]);
      return ctx.redraw();
    }
    if (this.mode === "palette" && (k.kind === "up" || k.kind === "down")) {
      this.msel = Math.max(0, Math.min(this.matches.length - 1, this.msel + (k.kind === "down" ? 1 : -1)));
      return ctx.redraw();
    }
    if (k.kind === "enter" || k.kind === "alt-enter") {
      if (this.mode === "filter") { const p = this.paneS; if (p) { p.filter = parseFilter(this.input); p.sel = 0; p.top = 0; this.save(); } }
      if (this.mode === "palette") {
        const b = this.matches[this.msel];
        if (b) ctx.board.get(b.id).then(m => { if (m) this.open(m, k.kind === "alt-enter"); }, () => {});
      }
      this.mode = "";
      return ctx.redraw();
    }
    if (k.kind === "backspace") this.input = this.input.slice(0, -1);
    else if (k.kind === "char" && !k.ctrl) this.input += k.ch;
    if (this.mode === "palette") { this.matches = this.idx.search(this.input); this.msel = 0; }
    ctx.redraw();
  }

  private mouse(k: Extract<Key, { kind: "mouse" }>) {
    const inside = (r: Rect) => k.x >= r.col && k.x < r.col + r.cols && k.y >= r.row && k.y < r.row + r.rows;
    if (k.action === "down") {
      const h = this.hits.find(h => inside(h.rect));
      const cr = this.colRects.find(c => inside(c.rect));
      if (cr) this.focus = cr.col;
      if (h) {
        const col = this.cols[h.col]!, p = col.panes[h.pane]!;
        col.pane = h.pane;
        const row = h.rows[k.y - h.rect.row];
        if (row && row.card >= 0) {
          const same = p.sel === row.card;
          p.sel = row.card;
          const m = this.flat(p)[row.card]?.m;
          if (m && row.replies) return this.toggle(p, m);
          if (m && same) return this.open(m, false);
        }
      }
      this.save();
      return this.ctx.redraw();
    }
    if (k.action === "wheel-up" || k.action === "wheel-down") {
      const h = this.hits.find(h => inside(h.rect));
      if (!h) return;
      const p = this.cols[h.col]!.panes[h.pane]!;
      p.sel = Math.max(0, Math.min(this.flat(p).length - 1, p.sel + (k.action === "wheel-down" ? 1 : -1)));
      this.ctx.redraw();
    }
  }
}
