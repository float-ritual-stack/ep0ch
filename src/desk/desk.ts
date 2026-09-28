// The desk: the door owns the whole canvas. A tiling tree of panes, docking, zoom,
// mouse-dragged dividers, and a floating search, all drawn by us rather than a multiplexer.
import type { Ctx, Frame, Screen } from "../app";
import { subject, type Msg } from "../board";
import { Canvas, type Rect } from "../canvas";
import type { Placement } from "../kitty";
import type { Actor, OutlineEvent } from "../socket";
import { ActionRefused, ActionSet, agentLabel, type ActRequest } from "../surface/actions";
import { NOTE_ACTIONS } from "../surface/note";
import { readState, writeState } from "../state";
import { bg, C, fg, pad, paint, RESET } from "../style";
import type { Key } from "../term";
import { colourBody, wrap } from "../text";
import { dividerAt, dock, dragTo, leaves, neighbour, place, remove, resize, split, type Dir, type Divider, type LNode, type Placed } from "./layout";
import { makePane, ReaderPane, type DeskApi, type Pane, type PaneKind } from "./panes";

type Saved = { t: "leaf"; kind: PaneKind } | { t: "split"; dir: "row" | "col"; ratio: number; a: Saved; b: Saved };
interface SavedDesk { root: Saved; focus: number }

const ADD: Record<string, PaneKind> = { t: "tree", r: "reader", h: "thread", a: "activity", w: "who", b: "art" };
const DOCK: Record<string, Dir> = { H: "left", J: "down", K: "up", L: "right" };
const MOVE: Record<string, Dir> = { h: "left", j: "down", k: "up", l: "right" };

export class Desk implements Screen, DeskApi {
  title = "desk";
  ctx!: Ctx;
  current: Msg | null = null;
  private panes = new Map<number, Pane>();
  private root: LNode;
  private focus: number;
  private zoom: number | null = null;
  private nextId = 1;
  private prefix: "" | "wm" | "add" = "";
  private drag: Divider | null = null;
  private placed: Placed = { rects: new Map(), dividers: [] };
  private search: SearchOverlay | null = null;

  constructor() {
    const saved = readState<SavedDesk>("desk.json");
    this.root = saved ? this.revive(saved.root) : this.defaultLayout();
    const ids = leaves(this.root);
    this.focus = ids[saved?.focus ?? 0] ?? ids[0]!;
  }

  private add(kind: PaneKind): number { const id = this.nextId++; this.panes.set(id, makePane(kind)); return id; }

  private defaultLayout(): LNode {
    const tree = this.add("tree"), reader = this.add("reader"), thread = this.add("thread"), activity = this.add("activity");
    return {
      t: "split", dir: "row", ratio: 0.24, a: { t: "leaf", id: tree },
      b: { t: "split", dir: "row", ratio: 0.66, a: { t: "leaf", id: reader },
        b: { t: "split", dir: "col", ratio: 0.58, a: { t: "leaf", id: thread }, b: { t: "leaf", id: activity } } },
    };
  }

  private revive(s: Saved): LNode {
    return s.t === "leaf" ? { t: "leaf", id: this.add(s.kind) } : { t: "split", dir: s.dir, ratio: s.ratio, a: this.revive(s.a), b: this.revive(s.b) };
  }

  private save() {
    const ser = (n: LNode): Saved => n.t === "leaf" ? { t: "leaf", kind: this.panes.get(n.id)!.kind } : { t: "split", dir: n.dir, ratio: n.ratio, a: ser(n.a), b: ser(n.b) };
    writeState("desk.json", { root: ser(this.root), focus: leaves(this.root).indexOf(this.focus) } satisfies SavedDesk);
  }

  // ── DeskApi ────────────────────────────────────────────────────────────────

  enter(ctx: Ctx) { this.ctx = ctx; for (const p of this.panes.values()) { p.init?.(this); p.select?.(this.current, this); } }

  setCurrent(m: Msg | null, opts: { reveal?: boolean; from?: Pane } = {}) {
    this.current = m;
    for (const p of this.panes.values()) {
      p.select?.(m, this);
      if (opts.reveal && m && p !== opts.from) void p.reveal?.(m, this);
    }
    this.redraw();
  }

  focusKind(kind: PaneKind) {
    const id = leaves(this.root).find(i => this.panes.get(i)?.kind === kind);
    if (id !== undefined) { this.focus = id; this.redraw(); }
  }

  redraw() { this.ctx?.redraw(); }

  onEvent(e: OutlineEvent) {
    for (const p of this.panes.values()) p.onEvent?.(this);
    const id = e.blockId;
    const readers = [...this.panes.values()].filter((p): p is ReaderPane => p instanceof ReaderPane);
    // After a reconnect that couldn't catch up, every reader re-reads its note (a draft is only marked).
    const stale = e.action === "reset" ? readers.map(r => r.msg?.id).filter((x): x is string => !!x)
      : id && readers.some(r => r.msg?.id === id && !(e.change?.revision !== undefined && r.msg.revision === e.change.revision && !r.msg.partial)) ? [id] : [];
    for (const x of new Set(stale)) this.ctx.board.get(x).then(m => { if (m) { readers.forEach(r => r.refresh(m)); this.redraw(); } }, () => {});
    if (e.action === "reconnected") for (const r of readers) r.retry(this);   // a note whose read failed while away
  }

  openBlock(m: Msg) { this.setCurrent(m, { reveal: true }); this.focusKind("reader"); }

  // ── actions: what the keys do, by name, for agents (`ep0ch-door act`) ─────

  actions() { return { actions: [...DESK_ACTIONS.list(), ...NOTE_ACTIONS.list()], readers: this.namedReaders().map(r => r.name) }; }

  async act(req: ActRequest, actor: Actor): Promise<unknown> {
    const args = { ...(req.args ?? {}) };
    if (DESK_ACTIONS.has(req.action)) return DESK_ACTIONS.runUntyped(req.action, args, { d: this, reader: req.reader }, actor);
    const r = this.pickReader(req.reader);
    const out = await r.pane.act(req.action, args, this, actor);
    return { reader: r.name, ...(out && typeof out === "object" ? out : { result: out }) };
  }

  /** Reader panes by their number on screen (the one `peek` shows): "2", "3"… */
  private namedReaders(): { name: string; id: number; pane: ReaderPane }[] {
    return leaves(this.root).map((id, i) => ({ name: String(i + 1), id, pane: this.panes.get(id)! }))
      .filter((r): r is { name: string; id: number; pane: ReaderPane } => r.pane instanceof ReaderPane);
  }

  /** A reader by number, "reader" (the first), "focused", or a block id it shows. No name: the focused reader, else the first. */
  private pickReader(sel?: string): { name: string; id: number; pane: ReaderPane } {
    const all = this.namedReaders();
    if (!all.length) throw new ActionRefused("the desk has no reader pane; add one (ctrl+w o r)");
    if (!sel || sel === "focused" || sel === "reader") return (sel !== "reader" && all.find(r => r.id === this.focus)) || all[0]!;
    const named = all.find(r => r.name === sel);
    if (named) return named;
    if (/^[0-9a-f-]{8,}$/.test(sel)) {
      const showing = all.filter(r => r.pane.msg?.id.startsWith(sel));
      const r = showing.find(x => x.pane.editing) ?? showing[0];
      if (r) return r;
      throw new ActionRefused(`no reader shows ${sel}; open it first (open id=${sel})`);
    }
    throw new ActionRefused(`no reader ${sel} on the desk; readers: ${all.map(r => r.name).join(", ")}, focused, or a block id`);
  }

  /** `open`: the note becomes the desk's current note (unpinned readers follow) and the reader gets the keys. */
  async openIn(id: string, sel?: string): Promise<{ reader: string; id: string }> {
    const m = await this.ctx.board.get(id);
    if (!m) throw new ActionRefused(`no block ${id}`);
    const r = this.pickReader(sel);
    this.setCurrent(m, { reveal: true });
    if (r.pane.msg?.id !== m.id && !r.pane.show(m, this)) throw new ActionRefused(`reader ${r.name} is holding an edit or a comment on another note`);
    this.focus = r.id; this.zoom = this.zoom !== null ? r.id : null;
    this.redraw();
    return { reader: r.name, id: m.id };
  }

  focusOn(sel: string): { focus: string } {
    const r = this.pickReader(sel);
    this.focus = r.id; this.zoom = this.zoom !== null ? r.id : null;
    this.redraw();
    return { focus: r.name };
  }

  unsaved() { return this.drafts().length > 0; }
  keepDrafts() { return this.drafts().flatMap(p => p.keepDrafts()); }
  private drafts() { return [...this.panes.values()].filter((p): p is ReaderPane => p instanceof ReaderPane && p.unsaved()); }

  describe() {
    const order = leaves(this.root);
    return {
      kind: "desk", current: this.current ? { id: this.current.id, title: subject(this.current) } : null, zoom: this.zoom,
      panes: order.map((id, i) => { const p = this.panes.get(id)!; const r = this.placed.rects.get(id); return { n: i + 1, kind: p.kind, title: p.title(), focused: id === this.focus, rect: r, showing: p instanceof ReaderPane && p.msg ? { id: p.msg.id, title: subject(p.msg) } : undefined, agent: p instanceof ReaderPane ? p.surface.agent ?? undefined : undefined, editing: p instanceof ReaderPane && p.draft ? { id: p.draft.blockId, dirty: p.draft.dirty, changedElsewhere: p.draft.changedElsewhere, conflict: p.draft.conflict } : undefined, commenting: p instanceof ReaderPane && p.session ? p.session.describe() : undefined }; }),
    };
  }

  // ── drawing ────────────────────────────────────────────────────────────────

  render(ctx: Ctx): Frame {
    const { cols, rows } = ctx.t;
    const canvas = new Canvas(cols, rows - 1);
    const area: Rect = { col: 0, row: 0, cols, rows: rows - 2 };
    this.placed = this.zoom !== null && this.panes.has(this.zoom)
      ? { rects: new Map([[this.zoom, area]]), dividers: [] }
      : place(this.root, area);
    let placements: Placement[] = [];
    const order = leaves(this.root);
    for (const [id, r] of this.placed.rects) {
      const pane = this.panes.get(id)!;
      const focused = id === this.focus;
      const n = order.indexOf(id) + 1;
      canvas.box(r, fg(focused ? C.lcyan : C.blue), `${fg(focused ? C.white : C.dark)}${n} ${fg(focused ? C.lcyan : C.cyan)}${pane.title()}`, focused ? fg(C.dark) + pane.hint() : "");
      const inner: Rect = { col: r.col + 1, row: r.row + 1, cols: r.cols - 2, rows: r.rows - 2 };
      if (inner.cols < 1 || inner.rows < 1) continue;
      const view = pane.render(inner.cols, inner.rows, focused, this);
      view.lines.slice(0, inner.rows).forEach((l, i) => canvas.text(inner.col, inner.row + i, l, inner.cols));
      for (const p of view.placements ?? []) {
        placements.push({ ...p, key: `p${id}:${p.key}`, col: p.col + inner.col, row: p.row + inner.row, cols: Math.min(p.cols, inner.cols), rows: Math.min(p.rows, inner.rows) });
      }
    }
    if (this.search) {
      const r: Rect = { col: Math.floor(cols * 0.1), row: Math.floor(rows * 0.12), cols: Math.floor(cols * 0.8), rows: Math.floor(rows * 0.72) };
      canvas.clear(r, bg(C.black));
      canvas.box(r, fg(C.yellow), `${fg(C.yellow)}search the board`, fg(C.dark) + "↑↓ pick · ⏎ open · esc close");
      this.search.render(r.cols - 2, r.rows - 2).forEach((l, i) => canvas.text(r.col + 1, r.row + 1 + i, l, r.cols - 2));
      placements = [];   // images would bleed through the overlay
    }
    canvas.text(0, rows - 2, this.hints(cols), cols);
    return { lines: canvas.lines(), placements };
  }

  private hints(cols: number): string {
    const s = this.prefix === "wm"
      ? "|14^W |07hjkl |08focus · |07HJKL |08dock to edge · |07< > + - |08size · |07= |08even · |07z |08zoom · |07o |08add · |07x |08close · |07s |08swap next"
      : this.prefix === "add"
        ? "|14add pane: |07t |08outline · |07r |08reader · |07h |08thread · |07a |08activity · |07w |08who · |07b |08bulletin art"
        : `|08 Tab/1-9 focus · |15^W|08 window · |15/|08 search · |15V|08 video · |15q|08 menu${this.zoom !== null ? " · |14zoomed" : ""}${this.current ? ` · |03${subject(this.current).slice(0, 50)}` : ""}`;
    return pad(paint(s), cols);
  }

  // ── input ──────────────────────────────────────────────────────────────────

  key(k: Key, ctx: Ctx) {
    if (this.search) {
      if (this.search.key(k, this) === "close") this.search = null;
      return this.redraw();
    }
    // An open edit takes every key, window commands included, until it is saved or closed,
    // and clicks can't move focus off it.
    const focused = this.panes.get(this.focus);
    if (focused instanceof ReaderPane && focused.editing) {
      if (k.kind === "mouse") { if (k.action === "down") this.ctx.flash("finish the edit first · ctrl+s saves · esc closes"); return; }
      focused.key(k, this); return;
    }
    if (k.kind === "mouse") return this.mouse(k);
    if (this.prefix) return this.command(k);
    if (k.kind === "char" && k.ctrl && k.ch === "w") { this.prefix = "wm"; return this.redraw(); }
    if (k.kind === "tab" || k.kind === "backtab") {
      const ids = this.zoom !== null ? [this.zoom] : leaves(this.root);
      const i = ids.indexOf(this.focus);
      this.focus = ids[(i + (k.kind === "tab" ? 1 : ids.length - 1)) % ids.length]!;
      this.save(); return this.redraw();
    }
    const pane = this.panes.get(this.focus);
    if (pane?.key(k, this)) return;
    if (k.kind === "char" && !k.ctrl) {
      if (k.ch === "/") { this.search = new SearchOverlay(); return this.redraw(); }
      if (k.ch === "V") return ctx.cycleVideo();
      if (/^[1-9]$/.test(k.ch)) { const id = leaves(this.root)[Number(k.ch) - 1]; if (id !== undefined) { this.focus = id; this.zoom = this.zoom !== null ? id : null; } return this.redraw(); }
      if (k.ch === "q") return ctx.pop();
    }
    if (k.kind === "esc") { if (this.zoom !== null) { this.zoom = null; return this.redraw(); } return ctx.pop(); }
  }

  private command(k: Key) {
    const mode = this.prefix;
    this.prefix = "";
    const c = k.kind === "char" ? k.ch : k.kind === "left" ? "h" : k.kind === "right" ? "l" : k.kind === "up" ? "k" : k.kind === "down" ? "j" : "";
    if (mode === "add") {
      const kind = ADD[c];
      if (kind) {
        const id = this.add(kind);
        this.root = split(this.root, this.focus, id, this.placed.rects.get(this.focus) ?? { col: 0, row: 0, cols: 80, rows: 24 });
        this.zoom = null; this.focus = id;
        const p = this.panes.get(id)!;
        p.init?.(this); p.select?.(this.current, this);
        this.save();
      }
      return this.redraw();
    }
    if (MOVE[c]) { const n = neighbour(this.placed.rects, this.focus, MOVE[c]!); if (n !== null) this.focus = n; }
    else if (DOCK[c]) { this.root = dock(this.root, this.focus, DOCK[c]!); this.zoom = null; }
    else if (c === "<" || c === ">") resize(this.root, this.focus, "row", c === ">" ? 0.05 : -0.05);
    else if (c === "+" || c === "-") resize(this.root, this.focus, "col", c === "+" ? 0.05 : -0.05);
    else if (c === "=") { const even = (n: LNode) => { if (n.t === "split") { n.ratio = 0.5; even(n.a); even(n.b); } }; even(this.root); }
    else if (c === "z") this.zoom = this.zoom === null ? this.focus : null;
    else if (c === "o") { this.prefix = "add"; return this.redraw(); }
    else if (c === "s") {
      const ids = leaves(this.root), i = ids.indexOf(this.focus), j = ids[(i + 1) % ids.length]!;
      const a = this.panes.get(this.focus)!, b = this.panes.get(j)!;
      this.panes.set(this.focus, b); this.panes.set(j, a); this.focus = j;
    }
    else if (c === "x" && leaves(this.root).length > 1) {
      const next = remove(this.root, this.focus);
      if (next) { this.panes.delete(this.focus); this.root = next; this.focus = leaves(next)[0]!; this.zoom = null; }
    }
    this.save();
    this.redraw();
  }

  private mouse(k: Extract<Key, { kind: "mouse" }>) {
    if (k.action === "up") { if (this.drag) { this.drag = null; this.save(); } return; }
    if (k.action === "drag" && this.drag) { dragTo(this.drag, k.x, k.y); return this.redraw(); }
    const hit = [...this.placed.rects].find(([, r]) => k.x >= r.col && k.x < r.col + r.cols && k.y >= r.row && k.y < r.row + r.rows);
    if (k.action === "down") {
      const d = this.zoom === null ? dividerAt(this.placed.dividers, k.x, k.y) : null;
      if (d) { this.drag = d; return; }
      if (!hit) return;
      this.focus = hit[0];
      const r = hit[1];
      if (k.x > r.col && k.y > r.row) this.panes.get(hit[0])?.click?.(k.x - r.col - 1, k.y - r.row - 1, this);
      return this.redraw();
    }
    if (hit && (k.action === "wheel-up" || k.action === "wheel-down")) this.panes.get(hit[0])?.wheel?.(k.action === "wheel-up" ? -1 : 1, this);
  }
}

// ── floating search ──────────────────────────────────────────────────────────

class SearchOverlay {
  private q = "";
  private hits: Msg[] = [];
  private sel = 0;
  private busy = false;
  private timer: Timer | null = null;
  private seq = 0;

  key(k: Key, desk: Desk): "keep" | "close" {
    if (k.kind === "esc") return "close";
    if (k.kind === "up") this.sel = Math.max(0, this.sel - 1);
    else if (k.kind === "down" || k.kind === "tab") this.sel = Math.min(Math.max(0, this.hits.length - 1), this.sel + 1);
    else if (k.kind === "enter") { const m = this.hits[this.sel]; if (m) { desk.setCurrent(m, { reveal: true }); return "close"; } }
    else if (k.kind === "backspace") { this.q = this.q.slice(0, -1); this.run(desk); }
    else if (k.kind === "char" && !k.ctrl) { this.q += k.ch; this.run(desk); }
    return "keep";
  }

  private run(desk: Desk) {
    if (this.timer) clearTimeout(this.timer);
    const q = this.q.trim();
    if (q.length < 2) { this.hits = []; return; }
    this.timer = setTimeout(() => {
      const n = ++this.seq;
      this.busy = true; desk.redraw();
      desk.ctx.board.search(q, 30).then(h => { if (n === this.seq) { this.hits = h; this.sel = 0; this.busy = false; desk.redraw(); } }, () => { this.busy = false; });
    }, 250);
  }

  render(w: number, h: number): string[] {
    const listW = Math.floor(w * 0.42);
    const lines = [paint(`|14/ |15${this.q}|07▁ ${this.busy ? "|08searching…" : `|08${this.hits.length} hit(s)`}`), fg(C.blue) + "─".repeat(w) + RESET];
    const m = this.hits[this.sel];
    const preview = m ? [fg(C.white) + subject(m) + RESET, ...wrap(m.text.split("\n").slice(1).join("\n").trim(), w - listW - 3).map(colourBody)] : [];
    for (let i = 0; i < h - 2; i++) {
      const hit = this.hits[i];
      const left = hit ? (i === this.sel ? bg(C.blue) + fg(C.white) : fg(C.grey)) + pad(` ${hit.props["work-id"] && !subject(hit).startsWith(hit.props["work-id"]) ? hit.props["work-id"] + " " : ""}${subject(hit)}`, listW) + RESET : " ".repeat(listW);
      lines.push(left + fg(C.blue) + " │ " + RESET + (preview[i] ?? ""));
    }
    return lines;
  }
}

interface DeskOn { d: Desk; reader?: string }

/** What the desk adds to a reader's note actions: which note is current, and which pane has the keys. */
export const DESK_ACTIONS = new ActionSet<{ "open": { id: string }; "focus": Record<string, never> }, DeskOn>("desk", {
  "open": {
    summary: "make a note the desk's current one and give its reader (reader=<pane number>) the keys", keys: "enter in the outline, / search",
    args: { id: { type: "string", about: "the block id" } },
    async run({ id }, { d, reader }, actor) {
      const r = await d.openIn(id, reader);
      d.ctx.flash(`${agentLabel(actor)} opened a note in reader ${r.reader}`);
      return r;
    },
  },
  "focus": {
    summary: "give keys to reader=<pane number>", keys: "tab, 1-9, click",
    args: {},
    run(_, { d, reader }) { if (!reader) throw new ActionRefused("focus needs reader=<pane number>"); return d.focusOn(reader); },
  },
});
