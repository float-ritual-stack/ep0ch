// Delivery board: a hub's virtual branches as lanes across the top, one shared preview,
// details you open into, an outline drawer that slides over (or pins), and a backlinks
// drawer spanning the readers. Nothing reflows when a drawer opens unless it is pinned.
import type { Ctx, Frame, Screen } from "../app";
import { subject, type Msg } from "../board";
import { Canvas, type Rect } from "../canvas";
import type { Backlink, OutlineEvent } from "../socket";
import { readState, writeState } from "../state";
import { bg, C, fg, pad, paint, RESET } from "../style";
import type { Key } from "../term";
import { ago } from "../text";
import { ReaderPane, TreePane, type DeskApi, type Pane, type PaneKind } from "./panes";

interface Lane { name: string; query: string; limit: number; sort: "created" | "updated"; direction: "asc" | "desc"; items: Msg[] | null; sel: number; top: number }
type Region = "lanes" | "preview" | "detail0" | "detail1" | "tree" | "backlinks";
interface Saved { treePinned: boolean; linksPinned: boolean; lane: number }

const PREFERRED = ["validate", "doing", "queued", "review", "done"];
const HIDDEN = new Set(["superseded"]);
const SEL = bg(C.blue) + fg(C.white);
const PRIORITY: Record<string, number> = { high: C.lred, medium: C.yellow, low: C.dark };

export class DeliveryBoard implements Screen, DeskApi {
  title = "delivery";
  ctx!: Ctx;
  current: Msg | null = null;
  private hub: Msg | null = null;
  private lanes: Lane[] = [];
  private lane = 0;
  private preview = new ReaderPane();
  private details: ReaderPane[] = [];
  private active = 0;                       // which detail Enter replaces
  private tree = new TreePane();
  private treeReady = false;
  private treeOpen = false;
  private treePinned = false;
  private links: { target: Msg; from: string; items: Backlink[] | null; sel: number; top: number } | null = null;
  private linksPinned = false;
  private focus: Region = "lanes";
  private rects = new Map<Region, Rect>();
  private laneRects: Rect[] = [];
  private reload: Timer | null = null;
  private status = "finding the Delivery Flow hub…";

  constructor(private readonly hubId?: string) {
    const s = readState<Saved>("delivery.json");
    if (s) { this.treePinned = s.treePinned; this.treeOpen = s.treePinned; this.linksPinned = s.linksPinned; this.lane = s.lane; }
  }

  private save() { writeState("delivery.json", { treePinned: this.treePinned, linksPinned: this.linksPinned, lane: this.lane } satisfies Saved); }

  // ── data ───────────────────────────────────────────────────────────────────

  async enter(ctx: Ctx) {
    this.ctx = ctx;
    try {
      this.hub = this.hubId ? await ctx.board.get(this.hubId)
        : (await ctx.board.search("Delivery Flow", 20)).find(m => subject(m) === "Delivery Flow") ?? null;
      if (!this.hub) { this.status = "no Delivery Flow hub found; pass --board <block-id>"; return ctx.redraw(); }
      const kids = await ctx.board.children(this.hub.id);
      const lanes = kids.filter(k => k.props.type === "virtual-branch" && k.props.query && !HIDDEN.has(subject(k).toLowerCase()));
      const rank = (n: string) => { const i = PREFERRED.indexOf(n.toLowerCase()); return i < 0 ? 99 : i; };
      this.lanes = lanes.sort((a, b) => rank(subject(a)) - rank(subject(b))).map(k => ({
        name: subject(k), query: k.props.query!, limit: Number(k.props.limit) || 50,
        sort: k.props.sort === "created" ? "created" : "updated", direction: k.props.direction === "asc" ? "asc" : "desc",
        items: null, sel: 0, top: 0,
      }));
      this.lane = Math.min(this.lane, Math.max(0, this.lanes.length - 1));
      this.status = "";
      this.loadLanes();
    } catch (e) { this.status = String((e as Error).message); }
    ctx.redraw();
  }

  private loadLanes() {
    for (const l of this.lanes) this.ctx.board.query(l.query, l.limit, l.sort, l.direction).then(items => {
      const keep = l.items?.[l.sel]?.id;
      l.items = items;
      l.sel = Math.max(0, keep ? items.findIndex(m => m.id === keep) : Math.min(l.sel, items.length - 1));
      if (l === this.lanes[this.lane]) this.follow();
      this.ctx.redraw();
    }, () => { l.items = []; });
  }

  onEvent(e: OutlineEvent) {
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => this.loadLanes(), 1200);
    void e;
  }

  private card(): Msg | undefined { const l = this.lanes[this.lane]; return l?.items?.[l.sel]; }
  private follow() { const m = this.card(); if (m && m.id !== this.preview.msg?.id) { this.current = m; this.preview.show(m, this); } }

  // ── DeskApi (the reused tree and reader panes call back through this) ────

  setCurrent(m: Msg | null, opts: { reveal?: boolean; from?: Pane } = {}) {
    if (!m) return;
    this.current = m;
    const from = opts.from;
    if (from instanceof ReaderPane && from !== this.preview) from.show(m, this);   // links open in place
    else this.preview.show(m, this);
    this.redraw();
  }
  focusKind(kind: PaneKind) { if (kind === "reader" && this.current) this.openDetail(this.current, false); }
  redraw() { this.ctx?.redraw(); }

  private openDetail(m: Msg, fresh: boolean) {
    if (fresh || !this.details.length) {
      if (this.details.length >= 2) this.details.shift();
      this.details.push(new ReaderPane());
      this.active = this.details.length - 1;
    }
    this.details[this.active]!.show(m, this);
    this.focus = `detail${this.active}` as Region;
    if (!this.treePinned) this.treeOpen = false;
    this.redraw();
  }

  private readerFor(r: Region): { pane: ReaderPane; label: string } | null {
    if (r === "preview" || r === "lanes") return { pane: this.preview, label: "preview" };
    if (r === "detail0" || r === "detail1") { const i = Number(r.slice(6)); const p = this.details[i]; return p ? { pane: p, label: `detail ${i + 1}` } : null; }
    return null;
  }

  private showLinks(r: Region) {
    const rd = this.readerFor(r) ?? this.readerFor("preview");
    const m = rd?.pane.msg;
    if (!rd || !m) return this.ctx.flash("nothing in that reader to find backlinks for");
    const links: NonNullable<DeliveryBoard["links"]> = { target: m, from: rd.label, items: null, sel: 0, top: 0 };
    this.links = links;
    this.focus = "backlinks";
    this.ctx.board.backlinks(m.id).then(items => { links.items = items; this.redraw(); }, e => { links.items = []; this.ctx.flash(String(e.message)); });
    this.redraw();
  }

  // ── drawing ────────────────────────────────────────────────────────────────

  render(ctx: Ctx): Frame {
    const { cols: W, rows } = ctx.t;
    const H = rows - 2;
    const canvas = new Canvas(W, rows - 1);
    this.rects.clear();
    const treeW = Math.max(30, Math.min(64, Math.round(W * 0.3)));
    const x0 = this.treePinned && this.treeOpen ? treeW : 0;
    const area: Rect = { col: x0, row: 0, cols: W - x0, rows: H };

    // Lanes across the top.
    const laneH = Math.max(8, Math.round(H * 0.42));
    this.drawLanes(canvas, { ...area, rows: laneH });

    // Readers: the shared preview plus up to two details, side by side.
    let readersH = H - laneH;
    const linksH = Math.max(8, Math.round(readersH * 0.45));
    if (this.links && this.linksPinned) readersH -= linksH;
    const readers: { region: Region; pane: ReaderPane; label: string }[] = [
      { region: "preview", pane: this.preview, label: "preview · follows the board" },
      ...this.details.map((p, i) => ({ region: `detail${i}` as Region, pane: p, label: `detail ${i + 1}${this.details.length > 1 && i === this.active ? " · ⏎ opens here" : ""}` })),
    ];
    const pw = this.details.length ? Math.max(30, Math.round(area.cols * (this.details.length === 1 ? 0.4 : 0.3))) : area.cols;
    let x = area.col;
    readers.forEach((r, i) => {
      const w = i === 0 ? pw : i === readers.length - 1 ? area.col + area.cols - x : Math.round((area.cols - pw) / this.details.length);
      this.drawReader(canvas, { col: x, row: laneH, cols: w, rows: readersH }, r.region, r.pane, r.label);
      x += w;
    });

    // Backlinks drawer spans every reader; overlays unless pinned.
    if (this.links) {
      const r: Rect = { col: area.col, row: laneH + (this.linksPinned ? readersH : readersH - linksH), cols: area.cols, rows: linksH };
      this.drawLinks(canvas, r);
    }
    // Outline drawer slides over from the left unless pinned.
    if (this.treeOpen) this.drawTree(canvas, { col: 0, row: 0, cols: treeW, rows: H }, !this.treePinned);

    canvas.text(0, rows - 2, this.hints(W), W);
    return { lines: canvas.lines() };
  }

  private frame(canvas: Canvas, r: Rect, region: Region, title: string, hint = "") {
    const on = this.focus === region;
    canvas.box(r, fg(on ? C.lcyan : C.blue), `${fg(on ? C.white : C.grey)}${title}`, on ? fg(C.dark) + hint : "");
    this.rects.set(region, r);
    return { col: r.col + 1, row: r.row + 1, cols: r.cols - 2, rows: r.rows - 2 } satisfies Rect;
  }

  private drawLanes(canvas: Canvas, r: Rect) {
    this.laneRects = [];
    if (!this.lanes.length) { canvas.box(r, fg(C.blue), fg(C.grey) + (this.hub ? subject(this.hub) : "board")); canvas.text(r.col + 2, r.row + 1, fg(C.dark) + this.status + RESET); return; }
    const n = this.lanes.length;
    let x = r.col;
    this.lanes.forEach((l, i) => {
      const w = i === n - 1 ? r.col + r.cols - x : Math.floor(r.cols / n);
      const rect: Rect = { col: x, row: r.row, cols: w, rows: r.rows };
      this.laneRects.push(rect);
      x += w;
      const on = this.focus === "lanes" && i === this.lane;
      canvas.box(rect, fg(on ? C.lcyan : i === this.lane ? C.cyan : C.blue),
        `${fg(on ? C.white : C.grey)}${l.name} ${fg(C.dark)}${l.items ? l.items.length : "…"}`);
      const inner = { col: rect.col + 1, row: rect.row + 1, cols: rect.cols - 2, rows: rect.rows - 2 };
      const items = l.items ?? [];
      const rowsPer = 2;
      const fit = Math.max(1, Math.floor(inner.rows / rowsPer));
      if (l.sel < l.top) l.top = l.sel;
      if (l.sel >= l.top + fit) l.top = l.sel - fit + 1;
      items.slice(l.top, l.top + fit).forEach((m, j) => {
        const k = l.top + j, sel = k === l.sel;
        const wid = m.props["work-id"] ?? "";
        const title = subject(m).replace(new RegExp(`^${wid}\\s*[—-]\\s*`), "");
        const pri = PRIORITY[m.props.priority ?? ""] ?? C.dark;
        const meta = `${fg(pri)}● ${fg(C.lcyan)}${wid} ${fg(C.dark)}${m.props.track ?? ""} · ${ago(m.updatedAt)}`;
        const y = inner.row + j * rowsPer;
        if (sel) {
          const style = on ? SEL : bg(C.dark) + fg(C.white);
          canvas.text(inner.col, y, style + pad(` ${wid} ${m.props.priority ?? ""} · ${ago(m.updatedAt)}`, inner.cols) + RESET, inner.cols);
          canvas.text(inner.col, y + 1, style + pad(` ${title}`, inner.cols) + RESET, inner.cols);
        } else {
          canvas.text(inner.col, y, pad(" " + meta, inner.cols) + RESET, inner.cols);
          canvas.text(inner.col, y + 1, fg(C.grey) + pad(` ${title}`, inner.cols) + RESET, inner.cols);
        }
      });
      if (!l.items) canvas.text(inner.col, inner.row, fg(C.dark) + " loading…" + RESET, inner.cols);
    });
  }

  private drawReader(canvas: Canvas, r: Rect, region: Region, pane: ReaderPane, label: string) {
    const inner = this.frame(canvas, r, region, label, pane.hint());
    if (inner.cols < 4 || inner.rows < 1) return;
    pane.render(inner.cols, inner.rows).lines.slice(0, inner.rows).forEach((l, i) => canvas.text(inner.col, inner.row + i, l, inner.cols));
  }

  private drawLinks(canvas: Canvas, r: Rect) {
    const L = this.links!;
    if (!this.linksPinned) canvas.clear(r, bg(C.black));
    const count = L.items ? `${L.items.length} source${L.items.length === 1 ? "" : "s"}` : "…";
    const inner = this.frame(canvas, r, "backlinks", `backlinks · ${subject(L.target).slice(0, 60)} · ${count} ${fg(C.dark)}(from ${L.from})${this.linksPinned ? " · pinned" : ""}`, "⏎ open in detail · B pin · esc close");
    const items = L.items ?? [];
    const per = 2, fit = Math.max(1, Math.floor(inner.rows / per));
    if (L.sel < L.top) L.top = L.sel;
    if (L.sel >= L.top + fit) L.top = L.sel - fit + 1;
    items.slice(L.top, L.top + fit).forEach((b, j) => {
      const k = L.top + j, sel = k === L.sel && this.focus === "backlinks";
      const y = inner.row + j * per;
      canvas.text(inner.col, y, (sel ? SEL : fg(C.white)) + pad(` ${b.title}`, Math.floor(inner.cols * 0.55)) + (sel ? "" : fg(C.dark)) + pad(` ${b.context}`, inner.cols - Math.floor(inner.cols * 0.55)) + RESET, inner.cols);
      canvas.text(inner.col, y + 1, fg(C.dark) + `   ${b.kinds} · ${ago(b.updatedAt)}  ` + fg(C.grey) + b.snippet + RESET, inner.cols);
    });
    if (L.items && !items.length) canvas.text(inner.col + 1, inner.row, fg(C.dark) + "nothing links here" + RESET, inner.cols);
  }

  private drawTree(canvas: Canvas, r: Rect, overlay: boolean) {
    if (!this.treeReady) { this.tree.init(this); this.treeReady = true; }
    if (overlay) canvas.clear(r, bg(C.black));
    const inner = this.frame(canvas, r, "tree", `outline${this.treePinned ? " · pinned" : " · drawer"}`, "⏎ open in detail · T pin · esc close");
    this.tree.render(inner.cols, inner.rows, this.focus === "tree", this).lines.slice(0, inner.rows)
      .forEach((l, i) => canvas.text(inner.col, inner.row + i, l, inner.cols));
    // A shadow edge so the drawer reads as floating.
    if (overlay) for (let y = r.row; y < r.row + r.rows; y++) canvas.text(r.col + r.cols, y, fg(C.dark) + "▐" + RESET, 1);
  }

  private hints(W: number): string {
    const base = this.focus === "lanes"
      ? "|08 h l lane · j k card · |15⏎|08 open in detail · |15alt⏎|08 new detail · |15t|08 outline · |15b|08 backlinks · |15tab|08 next area · |15x|08 close detail · |15esc|08 menu"
      : "|08 |15tab|08 next area · |15t|08 outline · |15b|08 backlinks of this reader · |15x|08 close detail · |15esc|08 back to lanes";
    return pad(paint(base + (this.status ? ` · |14${this.status}` : "")), W);
  }

  // ── input ──────────────────────────────────────────────────────────────────

  private regions(): Region[] {
    const r: Region[] = ["lanes", "preview", ...this.details.map((_, i) => `detail${i}` as Region)];
    if (this.links) r.push("backlinks");
    if (this.treeOpen) r.push("tree");
    return r;
  }

  key(k: Key, ctx: Ctx) {
    if (k.kind === "mouse") return this.mouse(k);
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    // Globals first.
    if (k.kind === "tab" || k.kind === "backtab") {
      const rs = this.regions(), i = rs.indexOf(this.focus);
      this.focus = rs[(i + (k.kind === "tab" ? 1 : rs.length - 1)) % rs.length]!;
      if (this.focus.startsWith("detail")) this.active = Number(this.focus.slice(6));
      return this.redraw();
    }
    if (c === "t") { this.treeOpen = !this.treeOpen || this.focus !== "tree"; this.focus = this.treeOpen ? "tree" : "lanes"; if (!this.treeOpen) this.treePinned = false; this.save(); return this.redraw(); }
    if (c === "T") { this.treePinned = !this.treePinned; this.treeOpen = this.treePinned || this.treeOpen; this.save(); return this.redraw(); }
    if (c === "b" && this.focus !== "backlinks") return this.showLinks(this.focus);
    if (c === "B") { this.linksPinned = !this.linksPinned; if (!this.links) this.showLinks(this.focus); this.save(); return this.redraw(); }
    if (c === "x" && this.focus.startsWith("detail")) {
      this.details.splice(Number(this.focus.slice(6)), 1);
      this.active = Math.max(0, this.details.length - 1);
      this.focus = this.details.length ? `detail${this.active}` as Region : "lanes";
      return this.redraw();
    }
    if (c === "V") return ctx.cycleVideo();
    if (k.kind === "esc") {
      if (this.focus === "tree" && !this.treePinned) { this.treeOpen = false; this.focus = "lanes"; return this.redraw(); }
      if (this.focus === "backlinks" && !this.linksPinned) { this.links = null; this.focus = "lanes"; return this.redraw(); }
      if (this.focus !== "lanes") { this.focus = "lanes"; return this.redraw(); }
      if (this.treeOpen && !this.treePinned) { this.treeOpen = false; return this.redraw(); }
      if (this.links && !this.linksPinned) { this.links = null; return this.redraw(); }
      return ctx.pop();
    }

    if (this.focus === "lanes") return this.laneKey(k, c);
    if (this.focus === "tree") { this.tree.key(k, this); return; }
    if (this.focus === "backlinks") return this.linksKey(k, c);
    const rd = this.readerFor(this.focus);
    if (rd && !rd.pane.key(k, this) && k.kind === "enter" && rd.pane === this.preview && this.preview.msg) this.openDetail(this.preview.msg, false);
  }

  private laneKey(k: Key, c: string) {
    const l = this.lanes[this.lane];
    const n = l?.items?.length ?? 0;
    if (k.kind === "left" || c === "h") this.lane = Math.max(0, this.lane - 1);
    else if (k.kind === "right" || c === "l") this.lane = Math.min(this.lanes.length - 1, this.lane + 1);
    else if (l && (k.kind === "down" || c === "j")) l.sel = Math.min(Math.max(0, n - 1), l.sel + 1);
    else if (l && (k.kind === "up" || c === "k")) l.sel = Math.max(0, l.sel - 1);
    else if (l && k.kind === "pgdn") l.sel = Math.min(Math.max(0, n - 1), l.sel + 8);
    else if (l && k.kind === "pgup") l.sel = Math.max(0, l.sel - 8);
    else if (k.kind === "enter" || k.kind === "alt-enter") { const m = this.card(); if (m) return this.openDetail(m, k.kind === "alt-enter"); }
    else if (c === "r") this.loadLanes();
    else return;
    this.follow(); this.save(); this.redraw();
  }

  private linksKey(k: Key, c: string) {
    const L = this.links!, n = L.items?.length ?? 0;
    if (k.kind === "down" || c === "j") L.sel = Math.min(Math.max(0, n - 1), L.sel + 1);
    else if (k.kind === "up" || c === "k") L.sel = Math.max(0, L.sel - 1);
    else if (k.kind === "enter" || k.kind === "alt-enter") {
      const b = L.items?.[L.sel];
      if (b) this.ctx.board.get(b.id).then(m => { if (m) { this.current = m; this.openDetail(m, k.kind === "alt-enter"); } }, () => {});
      return;
    }
    this.redraw();
  }

  private mouse(k: Extract<Key, { kind: "mouse" }>) {
    const inside = (r: Rect) => k.x >= r.col && k.x < r.col + r.cols && k.y >= r.row && k.y < r.row + r.rows;
    // Drawers sit on top, so they get first claim.
    const order: Region[] = ["tree", "backlinks", "preview", "detail0", "detail1"];
    const region = order.find(r => this.rects.has(r) && inside(this.rects.get(r)!) && (r !== "tree" || this.treeOpen) && (r !== "backlinks" || !!this.links));
    if (k.action === "wheel-up" || k.action === "wheel-down") {
      const dir = k.action === "wheel-up" ? -1 : 1;
      const rd = region ? this.readerFor(region) : null;
      if (rd) rd.pane.wheel(dir as 1 | -1, this);
      else if (region === "tree") this.tree.wheel(dir as 1 | -1, this);
      else { const li = this.laneRects.findIndex(inside); const l = this.lanes[li]; if (l) { l.sel = Math.max(0, Math.min((l.items?.length ?? 1) - 1, l.sel + dir)); if (li === this.lane) this.follow(); this.redraw(); } }
      return;
    }
    if (k.action !== "down") return;
    if (region) {
      if (this.treeOpen && !this.treePinned && region !== "tree") this.treeOpen = false;
      this.focus = region;
      if (region.startsWith("detail")) this.active = Number(region.slice(6));
      if (region === "tree") { const r = this.rects.get("tree")!; this.tree.click(k.x - r.col - 1, k.y - r.row - 1, this); }
      return this.redraw();
    }
    const li = this.laneRects.findIndex(inside);
    if (li >= 0) {
      if (this.treeOpen && !this.treePinned) this.treeOpen = false;
      const l = this.lanes[li]!, r = this.laneRects[li]!;
      const idx = l.top + Math.floor((k.y - r.row - 1) / 2);
      const same = this.lane === li && l.sel === idx && this.focus === "lanes";
      this.lane = li; this.focus = "lanes";
      if (l.items && idx >= 0 && idx < l.items.length) { l.sel = idx; this.follow(); if (same) return this.openDetail(l.items[idx]!, false); }
      this.redraw();
    }
  }
}
