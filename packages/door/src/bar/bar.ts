// The power bar (PIE-656): one palette over every screen, opened by ctrl+k (cmd+k where the terminal sends it), the
// status bar's `^K`, the desk's `/` and the river's `g` (those two in its notes scope), and `act bar.open`. A list on
// the left, what the lit row is on the right, scopes along the top.
//
// It is a list picker (src/surface/picker.ts) with its line typed above the list, held by the App over whatever
// screen is shown and the drawer, as the drawer is: it takes every key while it's open (the person is busy), and
// esc or a click outside puts it away. What it lists is its sources' (src/bar/source.ts): with nothing typed, the
// tiles and then what changed; typed, every source that answers in the main list, each under its heading; after a
// prefix (`%` `/` `>` `+` `@`, an extension's) or tab, one source. A pick is the `bar.pick` action (⏎, a double click;
// alt+⏎ or an alt-click is the alternate), which hands the row back to its source.
//
// The preview is drawn by the readers' renderers, never one of the bar's own: a note through a note surface, Markdown
// through `draftPreview` (renderDoc), a terminal's screen as it is. Under 90 columns it isn't drawn.
import { Canvas, type Rect } from "../canvas";
import type { Ctx } from "../app";
import type { Msg } from "../board";
import { ListPicker, pickRow } from "../surface/picker";
import { LineInput } from "../surface/line";
import { NoteSurface, draftPreview, type SurfaceHost } from "../surface/note";
import { keyCaption } from "../surface/actions";
import { MOUSE_ALT, MOUSE_CTRL, MOUSE_MIDDLE } from "../scroll";
import { C, chip, dim, fg, headOf, MARKS, pad, paint, RESET, TAGS, tailFrom, width } from "../style";
import { paintable, wrap } from "../text";
import type { Key } from "../term";
import type { Actor } from "../socket";
import { barSource, barSources, type BarHost, type BarPreview, type BarRow, type BarSource } from "./source";
import "./sources";

/** One row of the list, with the source it's from and the heading drawn above it (a source's title, a tile's screen). */
export interface BarItem { source: BarSource; row: BarRow; heading?: string }

/** How long typing must pause before a source that asks the service is asked. */
const ASK_MS = 150;
/** Below this many columns the bar draws no preview. */
export const PREVIEW_COLS = 90;

/** Where the bar sits over a screen `cols` by `rows` (the status bar not counted). */
export function barRect(cols: number, rows: number): Rect {
  const w = cols < 70 ? Math.max(20, cols - 2) : Math.floor(cols * 0.84), h = Math.max(8, Math.min(rows - 2, Math.floor(rows * 0.78)));
  return { col: Math.floor((cols - w) / 2), row: Math.max(0, Math.floor((rows - h) / 4)), cols: w, rows: h };
}

export class PowerBar {
  /** The source it's scoped to, or null: the main list. */
  scope: string | null;
  readonly input: LineInput;
  private readonly picker: ListPicker<BarItem, PowerBar>;
  items: BarItem[] = [];
  /** Each source's rows for the last query asked, and the sources still answering. */
  private got = new Map<string, BarRow[]>();
  private asking = new Set<string>();
  private problems = new Map<string, string>();
  /** What a source said of its rows since (`jev ranked`). */
  private said = new Map<string, string>();
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The lit row, by its source and key: kept lit when rows come in around it. */
  private litKey: string | null = null;
  /** The person moved the lit row since the query changed: rows arriving keep it lit; else the first row is. */
  private moved = false;
  /** The last pick's alternate (an alt-, ctrl- or middle click). */
  private alt = false;
  private done = false;
  /** Where it was drawn last (mouse reports are made relative to it), and its tabs. */
  rect: Rect | null = null;
  private tabSpots: { from: number; to: number; scope: string | null }[] = [];
  /** The preview's reader and the notes it read. */
  private readonly surface = new NoteSurface();
  private shownNote: string | null = null;
  private readonly notes = new Map<string, Msg | null | "…">();
  private readonly previews = new Map<string, BarPreview | "…">();

  /** An agent's own bar, never drawn: it asks the service at once instead of waiting for typing to pause. */
  private readonly quick: boolean;
  constructor(private readonly host: BarHost, private readonly pick: (n: number, alt: boolean) => void, o: { query?: string; scope?: string | null; quick?: boolean } = {}) {
    this.quick = !!o.quick;
    this.scope = o.scope ? barSource(o.scope)?.id ?? null : null;
    // The query is plain words for every source (the service's search, a filter over rows): no outline-text completion.
    this.input = new LineInput(o.query ?? "", false, { complete: false });
    this.picker = new ListPicker<BarItem, PowerBar>({
      name: "power bar", items: () => this.items, input: this.input,
      typed: () => this.refresh(),
      heading: (it, _i, w) => (it.heading ? fg(C.dark) + ` ${it.heading} ${"─".repeat(Math.max(0, w - width(it.heading) - 2))}` + RESET : null),
      row: (it, _i, on, w) => [this.rowText(it, on, w)],
      // ⏎ and a double click (an alt-click: the alternate) are `bar.pick`, an action, as an agent's is.
      choose: (_it, i) => this.pick(i + 1, this.alt),
      closed: () => this.close(),
      keys: k => this.ownKey(k),
      clicked: (x, y) => this.clickTab(x, y),
      frame: a => this.frame(a),
    });
    this.refresh();
  }

  /** Put away: nothing it asked for is waited on. */
  close() { this.done = true; this.seq++; if (this.timer) clearTimeout(this.timer); this.timer = null; this.surface.dispose(); }
  ended(): boolean { return this.done || this.picker.ended(); }
  get query(): string { return this.input.text; }
  get selected(): number { return this.picker.sel; }

  /** The sources it asks now: its scope's, or every source in the main list (with nothing typed, those that list then). */
  sources(): BarSource[] {
    const q = this.query.trim();
    if (this.scope) { const s = barSource(this.scope); return s ? [s] : []; }
    return barSources().filter(s => (q ? s.main.typed : s.main.empty));
  }

  /** The scopes along the top: the main list, then each source. */
  scopes(): (string | null)[] { return [null, ...barSources().map(s => s.id)]; }

  /** Change to scope `s` (null: the main list). */
  setScope(s: string | null) {
    this.scope = s ? barSource(s)?.id ?? null : null;
    this.picker.sel = 0; this.litKey = null;
    this.refresh();
  }

  /** The keys it takes before the list's: tab through the scopes, a prefix typed first, backspace out of a scope, alt+⏎. */
  private ownKey(k: Key): boolean {
    if (k.kind === "tab" || k.kind === "backtab") {
      const all = this.scopes(), at = all.indexOf(this.scope);
      this.setScope(all[(at + (k.kind === "tab" ? 1 : -1) + all.length) % all.length]!);
      return true;
    }
    if (k.kind === "backspace" && !this.input.text && this.scope) { this.setScope(null); return true; }
    if (k.kind === "char" && !k.ctrl && !this.input.text && !this.scope) {
      const s = barSources().find(x => x.prefix === k.ch);
      if (s) { this.setScope(s.id); return true; }
    }
    if (k.kind === "alt-enter") { if (this.items.length) this.pick(this.picker.sel + 1, true); return true; }
    return false;
  }

  /** A key or a click while it's open: everything is the bar's. Mouse reports are made relative to where it was drawn. */
  key(k: Key, ctx: Ctx) {
    const was = this.picker.sel;
    if (k.kind === "mouse") {
      const r = this.rect;
      if (!r) return;
      if (k.action === "up" || k.action === "drag") return;
      this.alt = !!((k.mods ?? 0) & (MOUSE_ALT | MOUSE_CTRL)) || k.button === MOUSE_MIDDLE;
      const at = { ...k, x: k.x - r.col, y: k.y - r.row };
      this.picker.key(at, this);
      this.alt = false;
    } else this.picker.key(k, this);
    if (this.picker.sel !== was) this.moved = true;
    ctx.redraw();
  }

  private clickTab(x: number, y: number): boolean {
    if (y !== 1) return false;
    const t = this.tabSpots.find(s => x >= s.from && x < s.to);
    if (t) this.setScope(t.scope);
    return !!t;
  }

  /**
   * Ask the sources again for what's typed now: those that answer at once now, those that ask the service after a pause.
   * `background` (what changed, a source came or went; not the person's typing): only the sources that answer at once
   * are asked again, the rows the service gave are kept, and what's lit stays lit.
   */
  refresh(background = false) {
    if (this.done) return;
    if (background) {
      for (const s of this.sources()) if (!s.asks) { try { const r = s.rows(this.query, this.host); if (Array.isArray(r)) this.got.set(s.id, r); } catch { /* kept as it was */ } }
      return this.build(true);
    }
    const n = ++this.seq, q = this.query, sources = this.sources();
    this.moved = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.got = new Map(); this.asking.clear(); this.problems.clear(); this.said.clear(); this.previews.clear();
    const alive = () => n === this.seq && !this.done;
    const answer = (s: BarSource, rows: BarRow[]) => {
      if (!alive()) return;
      this.asking.delete(s.id); this.got.set(s.id, rows); this.build(); this.host.ctx.redraw();
      // An agent's bar is read once and put away: no re-ordering asked for it.
      const again = this.quick ? null : s.later?.(q, rows, this.host, alive);
      // The same hits re-ordered (Jev): what's lit stays lit, as it did in the search it replaced.
      if (again) void again.then(r => { if (r && alive()) { this.got.set(s.id, r.rows); if (r.said) this.said.set(s.id, r.said); this.build(true); this.host.ctx.redraw(); } });
    };
    const fail = (s: BarSource, e: unknown) => {
      if (!alive()) return;
      this.asking.delete(s.id); this.problems.set(s.id, e instanceof Error ? e.message : String(e)); this.build(); this.host.ctx.redraw();
    };
    const ask = (s: BarSource) => { try { const r = s.rows(q, this.host); if (Array.isArray(r)) answer(s, r); else void r.then(rows => answer(s, rows), e => fail(s, e)); } catch (e) { fail(s, e); } };
    const later = sources.filter(s => s.asks);
    for (const s of sources) { if (s.asks) this.asking.add(s.id); else { this.asking.add(s.id); ask(s); } }
    this.build();
    // A source that asks the service (the notes search, an extension's) waits for typing to pause.
    if (later.length && this.quick) for (const s of later) ask(s);
    else if (later.length) this.timer = setTimeout(() => { this.timer = null; for (const s of later) ask(s); }, ASK_MS);
  }

  /** Resolves once every source asked has answered (or `ms` passed); the sources still out, if any (an agent's rows aren't whole). */
  async settled(ms = 5000): Promise<string[]> {
    const end = Date.now() + ms;
    while (this.asking.size && Date.now() < end) await Bun.sleep(20);
    return [...this.asking];
  }

  /** The rows again from what each source answered: in the main list each source's few under its heading. */
  private build(keepLit = this.moved) {
    const lit = this.items[this.picker.sel];
    const keep = keepLit ? (lit ? `${lit.source.id}\0${lit.row.key}` : this.litKey) : null;
    const out: BarItem[] = [];
    for (const s of this.sources()) {
      const rows = this.got.get(s.id) ?? [];
      const shown = this.scope ? rows : rows.slice(0, s.main.most ?? 8);
      let group: string | undefined;
      shown.forEach((row, i) => {
        const head = i === 0 ? (this.scope ? row.group : row.group ? `${s.title} · ${row.group}` : s.title) : row.group !== group ? row.group : undefined;
        group = row.group;
        out.push({ source: s, row, ...(head ? { heading: head } : {}) });
      });
    }
    this.items = out;
    const at = keep ? out.findIndex(it => `${it.source.id}\0${it.row.key}` === keep) : -1;
    this.picker.sel = at >= 0 ? at : 0;
    this.litKey = keep;
  }

  /** A row: its indent and mark, its words, then dim what it is and its key, as wide as the list. */
  private rowText(it: BarItem, on: boolean, w: number): string {
    const r = it.row, indent = "  ".repeat(Math.min(6, r.depth ?? 0)), cap = r.keycap ? ` ${keyCaption(r.keycap)} ` : "";
    const left = ` ${indent}${r.mark ? `${r.mark} ` : ""}${r.label}`, detail = r.refused ? `✕ ${r.refused}` : r.detail ?? "";
    const room = Math.max(1, w - width(cap)), lw = Math.min(width(left), Math.max(Math.floor(room * 0.6), room - width(detail) - 2));
    const rest = room - lw > 3 && detail ? `  ${detail}` : "";
    const capChip = cap ? chip(C.dark) + cap + RESET : "";
    if (on) return pickRow(pad(left, lw) + rest, true, room) + capChip;
    return fg(r.refused ? C.dark : C.grey) + pad(left, lw) + fg(C.dark) + pad(rest, room - lw) + RESET + capChip;
  }

  /** Its frame over `a`: the scopes, the line, the rows and (wide enough) the lit row's preview. */
  private frame(a: Rect) {
    const rect: Rect = { col: 0, row: 0, cols: a.cols, rows: a.rows }, w = rect.cols - 2;
    // The scopes, the one shown lit; their spots for a click.
    let x = 1, tabs = "";
    this.tabSpots = [];
    for (const s of this.scopes()) {
      const src = s ? barSource(s) : null, word = src ? `${src.prefix}${src.title}` : "all";
      const lit = s === this.scope;
      this.tabSpots.push({ from: x + 1, to: x + 1 + width(word), scope: s });
      tabs += (lit ? chip(C.cyan, C.black) : fg(C.grey)) + ` ${word} ` + RESET;
      x += width(word) + 2;
    }
    const busy = this.asking.size ? `${[...this.asking].map(id => barSource(id)?.title ?? id).join(", ")}…` : "";
    const said = [...this.problems].map(([id, why]) => `${barSource(id)?.title ?? id}: ${why}`).join(" · ");
    const count = [`${this.items.length} row${this.items.length === 1 ? "" : "s"}`, ...this.said.values()].join(" · ");
    const line = paint("|14› ") + this.input.show(Math.max(10, w - 30)) + paint(` |08${busy || count}`);
    const head = [tabs, line, fg(C.blue) + "─".repeat(w) + RESET];
    const tail = said ? [fg(C.lred) + pad(` ${said}`, w) + RESET] : [];
    const listRoom = rect.rows - 2 - head.length - tail.length;
    const it = this.items[this.picker.sel];
    const empty = !this.items.length && !this.asking.size;
    const hint = this.scope ? barSource(this.scope)?.about ?? "" : this.query.trim() ? "nothing here matches" : "nothing open yet";
    const side = rect.cols >= PREVIEW_COLS ? Math.floor(w * 0.46) : 0;
    const preview = side && it ? this.previewLines(it, w - side - 3, listRoom) : side && empty ? wrap(hint, w - side - 4).map(l => dim(l)) : [];
    return {
      rect, title: " power bar ",
      foot: "↑↓ pick · ⏎ go · alt+⏎ zoom or new detail · ⇥ scope · esc",
      head, ...(tail.length ? { tail } : {}),
      ...(side ? { side: { w: side, lines: preview } } : {}),
    };
  }

  /** What the lit row is, `w` by `h`, through the readers' renderers; `…` while it's read. */
  private previewLines(it: BarItem, w: number, h: number): string[] {
    // A preview that answers at once is asked each frame (a terminal's screen as it is now); one read is kept for this
    // query's rows (cleared when they're asked again), and an answer for rows since replaced is dropped.
    const key = `${it.source.id}\0${it.row.key}`, n = this.seq;
    let p = this.previews.get(key);
    if (p === undefined) {
      try {
        const got = it.source.preview(it.row, this.host);
        if (got instanceof Promise) {
          this.previews.set(key, "…");
          void got.then(v => { if (n === this.seq) { this.previews.set(key, v); this.host.ctx.redraw(); } }, () => { if (n === this.seq) this.previews.set(key, { lines: ["(no preview)"] }); });
          p = "…";
        } else p = got;
      } catch (e) { p = { lines: [e instanceof Error ? e.message : String(e)] }; }
    }
    if (p === "…") return [dim("…")];
    if (!p) return [];
    if ("lines" in p) return p.lines.slice(0, h).map(l => fg(C.grey) + headOf(paintable(l), w) + RESET);
    if ("markdown" in p) return draftPreview(p.markdown, w, { board: this.host.ctx.board, redraw: () => this.host.ctx.redraw() }).slice(0, h);
    return this.notePreview(p.note, w, h);
  }

  /** A note as a reader draws it: the bar's own note surface, its top `h` rows. */
  private notePreview(id: string, w: number, h: number): string[] {
    const m = this.notes.get(id);
    if (m === undefined) {
      this.notes.set(id, "…");
      void this.host.note(id).then(n => { this.notes.set(id, n); this.host.ctx.redraw(); }, () => this.notes.set(id, null));
      return [dim("…")];
    }
    if (m === "…") return [dim("…")];
    if (!m) return [dim("(that note is gone)")];
    const app = this.host.ctx;
    // A reader's host with nothing to host but the drawing: no graphics (an image is named on its line), no keys.
    const ctx = { board: app.board, t: { cols: w, rows: h, cellW: 9, cellH: 18, kitty: false }, graphics: false, flash: (s: string) => app.flash(s), redraw: () => app.redraw() } as unknown as Ctx;
    const sh: SurfaceHost = { ctx, redraw: () => app.redraw(), navigate() {} };
    if (this.shownNote !== id) { this.surface.show(m, sh); this.shownNote = id; }
    return this.surface.render(w, h, sh).lines.slice(0, h).map(l => l.replace(TAGS, "").replace(MARKS, ""));
  }

  /** Drawn over a screen `cols` by `rows`: where, and its rows. */
  draw(cols: number, rows: number): { rect: Rect; lines: string[] } {
    const r = (this.rect = barRect(cols, rows));
    const canvas = new Canvas(r.cols, r.rows);
    this.picker.draw(canvas, { col: 0, row: 0, cols: r.cols, rows: r.rows });
    return { rect: r, lines: canvas.lines() };
  }

  /** What `peek` and `bar.open` say: the scope, the query and the rows, numbered from 1, the lit one marked. */
  describe(): Record<string, unknown> {
    return {
      scope: this.scope ?? "all", query: this.query, selected: this.items.length ? this.picker.sel + 1 : null,
      ...(this.asking.size ? { asking: [...this.asking] } : {}), ...(this.said.size ? { said: Object.fromEntries(this.said) } : {}), ...(this.problems.size ? { problems: Object.fromEntries(this.problems) } : {}),
      rows: this.items.map((it, i) => rowFacts(it, i + 1)),
    };
  }

  /** The row of `source` with `key`, from 1; refused with what there is. */
  rowNamed(source: string | undefined, key: string | undefined): number {
    if (source === undefined || key === undefined) throw new Error("name the row with both source= and key= (as bar.open answers them), or n=");
    const s = barSource(source)?.id ?? source;
    const i = this.items.findIndex(it => it.source.id === s && it.row.key === key);
    if (i < 0) throw new Error(`no row ${key} from ${source} in what the bar lists now`);
    return i + 1;
  }

  /** Pick row `n` (from 1): its source does it, as `actor`. */
  async pickRow(n: number, alt: boolean, actor: Actor): Promise<unknown> {
    const it = this.items[n - 1];
    if (!it) throw new Error(this.items.length ? `pick 1 to ${this.items.length}` : "the bar lists nothing to pick");
    this.picker.sel = n - 1;
    return { picked: rowFacts(it, n), result: await it.source.pick(it.row, this.host, { alt, actor }) ?? null };
  }
}

/** A row as an agent and `peek` read it. */
export function rowFacts(it: BarItem, n: number): Record<string, unknown> {
  const r = it.row;
  return { n, source: it.source.id, key: r.key, label: r.label, ...(r.detail ? { detail: r.detail } : {}), ...(r.depth ? { depth: r.depth } : {}), ...(r.group ? { group: r.group } : {}), ...(r.keycap ? { keycap: r.keycap } : {}), ...(r.refused ? { refused: r.refused } : {}) };
}

/** The bar's rows laid over a screen's `lines` (without the status bar). */
export function overBar(lines: string[], bar: { rect: Rect; lines: string[] }): string[] {
  const out = [...lines], { col, cols } = bar.rect;
  bar.lines.forEach((l, i) => {
    const y = bar.rect.row + i;
    if (y >= out.length) return;
    const base = out[y] ?? "", head = headOf(base, col);
    out[y] = head + " ".repeat(Math.max(0, col - width(head))) + RESET + l + RESET + tailFrom(base, col + cols);
  });
  return out;
}
