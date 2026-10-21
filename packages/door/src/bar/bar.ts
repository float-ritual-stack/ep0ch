import { completeCommand, commandButton } from "./command";
import { clipText } from "../overflow";
import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { lookFor } from "../look";
import { outlineBoards } from "../desk/outline-boards";
// The power bar (PIE-656): one palette over every screen, opened by ctrl+k (cmd+k where the terminal sends it), the
// status bar's `^K`, the desk's `/` and the river's `g` (those two in its notes scope), and `act bar.open`. A list on
// the left, what the lit row is on the right, scopes along the top.
//
// It is a list picker (src/surface/picker.ts) with its line typed above the list, held by the App over whatever
// screen is shown and the drawer, as the drawer is: it takes every key while it's open (the person is busy), and
// esc clears text, then closes an empty line; a click outside puts it away. What it lists is its sources' (src/bar/source.ts): with nothing typed, the
// tiles and then what changed; typed, every source that answers in the main list, each under its heading; after a
// prefix (`%` `/` `>` `+` `@`, an extension's) or alt+← alt+→, one source; tab fills the line with the lit row's words. A pick is the `bar.pick` action (⏎, a double click;
// alt+⏎ or an alt-click is the alternate), which hands the row back to its source.
//
// The preview is drawn by the readers' renderers, never one of the bar's own: a note through a note surface, Markdown
// through `draftPreview` (renderDoc), a terminal's screen as it is. The shared list-preview places it beside or below.
import { Canvas, type Rect } from "../canvas";
import type { Ctx } from "../app";
import type { Msg } from "../board";
import { ListPicker, pickRow } from "../surface/picker";
import { Draft } from "../edit";
import { editorLineKey } from "../surface/editor";
import { Gesture, rowsOf, wordAt, Selection, paintRange, SELECT_BG, isCopyKey, modeKey } from "../surface/selection";
import { NoteSurface, draftPreviewDoc, type SurfaceHost } from "../surface/note";
import { keyCaption, keyName, keyOfName, shownLine, ActionRefused } from "../surface/actions";
import { RowView, wheelRows, MOUSE_ALT, MOUSE_CTRL, MOUSE_MIDDLE } from "../scroll";
import { C, chip, dim, fg, headOf, MARKS, pad, paint, RESET, TAGS, tailFrom, width } from "../style";
import { paintable, rowLines, withRowLimit, wrap } from "../text";
import type { Key } from "../term";
import type { Actor } from "../socket";
import { barSource, barSources, type BarHost, type BarPreview, type BarRow, type BarSource } from "./source";
import "./sources";
import { compactQuestion, formOpen, maskedQuestion, clearPrivateForm } from "./ask";

/** One row of the list, with the source it's from and the heading drawn above it (a source's title, a tile's screen). */
export interface BarItem { source: BarSource; row: BarRow; heading?: string }

/**
 * How long typing must pause before a source that asks the service is asked: EP0CH_BAR_ASK_MS when set (the parity
 * probes set 0: they wait for every ask to be answered before the next key, and 150 ms on each typed key was most of
 * their time in the bar).
 */
const askMs = () => { const v = Number(process.env.EP0CH_BAR_ASK_MS?.trim() || NaN); return Number.isFinite(v) && v >= 0 && v <= 10_000 ? v : 150; };

/** Where the bar sits over a screen `cols` by `rows` (the status bar not counted). */
export function barRect(cols: number, rows: number): Rect {
  const w = cols < 70 ? Math.max(20, cols - 2) : Math.floor(cols * 0.84), h = Math.max(8, Math.min(rows - 2, Math.floor(rows * 0.78)));
  return { col: Math.floor((cols - w) / 2), row: Math.max(0, Math.floor((rows - h) / 4)), cols: w, rows: h };
}

export class PowerBar {
  /** The source it's scoped to, or null: the main list. */
  scope: string | null;
  input: Draft;
  private readonly gesture = new Gesture();
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
  private readonly docsView = new RowView();
  private readonly docsGesture = new Gesture();
  private docsSelection: Selection | null = null;
  private docsRect: Rect | null = null;
  private docsLines: string[] = [];
  private docsDoc: ReturnType<typeof draftPreviewDoc> | null = null;
  private docsRows() {
    const rows = rowsOf(this.docsLines, undefined, r => this.docsDoc?.trims.get(r));
    return { ...rows, joins: (r: number) => this.docsDoc?.wraps?.get(r + 1) };
  }
  private docsKey = "";
  private docsMode = false;
  private docsExamples = new Map<number, string>();
  private menuSpots: { from: number; to: number; action: string; args: Record<string, unknown> }[] = [];
  private shownNote: string | null = null;
  private readonly notes = new Map<string, Msg | null | "…" | { offline: string }>();
  private readonly reads = new Map<string, number>();
  private readonly previews = new Map<string, BarPreview | "…">();

  /** An agent's own bar, never drawn: it asks the service at once instead of waiting for typing to pause. */
  private readonly quick: boolean;
  constructor(private readonly host: BarHost, private readonly pick: (n: number, alt: boolean) => void, o: { query?: string; scope?: string | null; quick?: boolean } = {}) {
    this.quick = !!o.quick;
    this.scope = o.scope ? barSource(o.scope)?.id ?? null : null;
    // The query is plain words for every source (the service's search, a filter over rows): no outline-text completion.
    this.input = new Draft("power-bar", 0, o.query ?? "");
    this.picker = new ListPicker<BarItem, PowerBar>({
      stays: true,
      name: "power bar", items: () => this.items,
      heading: (it, _i, w) => (!this.compact() && it.heading ? fg(C.dark) + ` ${it.heading} ${"─".repeat(Math.max(0, w - width(it.heading) - 2))}` + RESET : null),
      row: (it, _i, on, w) => this.rowText(it, on, w),
      // ⏎ and a double click (an alt-click: the alternate) are `bar.pick`, an action, as an agent's is.
      choose: (_it, i) => this.pick(i + 1, this.alt),
      closed: () => { clearPrivateForm(); this.close(); },
      keys: k => this.ownKey(k),
      clickChooses: !!this.compact(),
      clicked: (x, y) => this.clickTab(x, y),
      frame: a => this.frame(a),
    });
    this.refresh();
  }

  private compact() { return this.scope === "ask" ? compactQuestion() : null; }

  /** Put away: nothing it asked for is waited on. */
  close() { this.input = new Draft("power-bar", 0, ""); this.done = true; this.seq++; if (this.timer) clearTimeout(this.timer); this.timer = null; this.surface.dispose(); }
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
    if (this.scope === "ask" && maskedQuestion() && s !== "ask") { this.input = new Draft("power-bar", 0, ""); clearPrivateForm(); }
    this.scope = s ? barSource(s)?.id ?? null : null;
    this.picker.sel = 0; this.litKey = null;
    this.refresh();
  }

  /**
   * The keys it takes before the list's: alt+← alt+→ (or ESC b, ESC f: Option+arrows in some terminals) through the scopes, tab to complete the line (as a shell does: the
   * lit row's words, the bar stays open), a prefix typed first, alt+⏎.
   */
  private ownKey(k: Key): boolean {
    if (this.compact()?.choice && k.kind === "char" && !k.ctrl && (k.ch === "j" || k.ch === "k")) return false;
    // Terminals that send Option+←/→ as word jumps (ESC b, ESC f) reach the same scopes.
    const step = k.kind === "alt-left" || (k.kind === "alt" && k.ch === "b") ? -1 : k.kind === "alt-right" || (k.kind === "alt" && k.ch === "f") ? 1 : 0;
    if (step) {
      const all = this.scopes(), at = all.indexOf(this.scope);
      this.setScope(all[(at + step + all.length) % all.length]!);
      return true;
    }
    // In an action's form (PIE-1031) shift+tab, and backspace on an empty line, go back a field.
    const form = this.scope === "ask" && formOpen();
    if (form && (k.kind === "backtab" || (k.kind === "backspace" && !this.input.text))) { void this.host.dispatch.press("bar.form", { op: "back" }); return true; }
    if (k.kind === "alt" && k.ch === "v") { void this.host.dispatch.press("bar.docs", { op: "focus" }); return true; }
    if (k.kind === "alt" && (k.ch === "j" || k.ch === "k")) { void this.host.dispatch.press("bar.docs", { op: "scroll", by: k.ch === "j" ? 3 : -3 }); return true; }
    if (this.docsMode && this.docsSelection && (["up", "down", "left", "right", "pgup", "pgdn", "home", "end", "enter", "esc"].includes(k.kind) || k.kind === "char" && "hjklvy".includes(k.ch) || isCopyKey(k))) {
      void this.host.dispatch.press("bar.docs", { op: "key", key: keyName(k) }); return true;
    }
    if (isCopyKey(k) && this.docsSelection && !this.input.selectedText()) { void this.host.dispatch.press("bar.docs", { op: "copy" }); return true; }
    if (k.kind === "tab" || k.kind === "backtab") {
      if (k.kind === "tab") void this.host.dispatch.press("bar.edit", { op: "complete" });
      return true;
    }
    if (k.kind === "char" && !k.ctrl && !this.input.text && !this.scope) {
      const s = barSources().find(x => x.prefix === k.ch);
      if (s) { this.setScope(s.id); return true; }
    }
    if (k.kind === "up" && !this.query && this.host.runs.length) { void this.host.dispatch.press("bar.command", { op: "recall" }); return true; }
    if (k.kind === "alt" && ["o", "y", "i", "m"].includes(k.ch)) { void this.host.dispatch.press(k.ch === "i" ? "bar.insert" : "bar.command", k.ch === "i" ? {} : { op: k.ch === "o" ? "copy" : k.ch === "y" ? "button" : "menu" }); return true; }
    if (k.kind === "right" && this.input.col === this.query.length && /\s/.test(this.query) && this.host.dispatch.has(this.query.split(/\s/)[0]!)) { void this.host.dispatch.press("bar.edit", { op: "complete" }); return true; }
    if (k.kind === "alt-enter") { if (this.items.length) this.pick(this.picker.sel + 1, true); return true; }
    if (k.kind === "alt-backspace") { void this.host.dispatch.press("bar.edit", { op: "delete-word" }); return true; }
    if (k.kind === "char" && k.ctrl && ["u", "w", "x", "z"].includes(k.ch) && !k.shift) {
      void this.host.dispatch.press("bar.edit", { op: k.ch === "u" ? "clear" : k.ch === "w" ? "delete-word" : k.ch === "x" ? "cut" : "undo" });
      return true;
    }
    if (k.kind === "paste") { void this.host.dispatch.press("bar.edit", { op: "paste", text: k.text }); return true; }
    const before = this.query;
    const took = editorLineKey(this.input, k, text => { if (!(this.scope === "ask" && maskedQuestion())) this.host.ctx.copy?.(text); });
    if (this.scope === "ask" && maskedQuestion()) { this.input.undos = []; this.input.redos = []; }
    if (this.query !== before) this.refresh();
    return took;
  }

  async edit(op: string, o: { text?: string; from?: number; to?: number } = {}, clipboard = true) {
    if (op === "select" || o.from !== undefined || o.to !== undefined) { this.input.place(0, o.from ?? 0); this.input.place(0, o.to ?? this.query.length, true); }
    if (op === "complete") await this.complete();
    else if (op === "clear") this.clear();
    else if (op !== "select") {
      const k: Key = op === "paste" ? { kind: "paste", text: o.text ?? "" } : op === "delete-word" ? { kind: "alt-backspace" } : { kind: "char", ctrl: true, ch: op === "cut" ? "x" : "z" };
      editorLineKey(this.input, k, text => { if (clipboard && !(this.scope === "ask" && maskedQuestion())) this.host.ctx.copy?.(text); });
      if (this.scope === "ask" && maskedQuestion()) { this.input.undos = []; this.input.redos = []; }
      this.refresh();
    }
    this.host.ctx.redraw();
  }

  async complete() {
    const before = this.query;
    if (this.host.dispatch.has(before.split(/\s/)[0]!) && /\s/.test(before)) {
      const completed = await completeCommand(before, this.host);
      if (before !== this.query || this.done) return;
      if (completed !== null) { this.input.splice(0, this.query.length, completed); this.refresh(); this.host.ctx.redraw(); return; }
    }
    if (this.scope === "ask" && maskedQuestion()) return;
    const it = this.items[this.picker.sel];
    if (!it) return;
    const typed = this.query;
    const fills = this.items.map(it => it.row.fill ?? it.row.label).filter(text => text.startsWith(typed));
    let prefix = fills[0] ?? "";
    for (const fill of fills.slice(1)) {
      const a = [...prefix], b = [...fill];
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      prefix = a.slice(0, i).join("");
    }
    const lit = it.row.fill ?? it.row.label;
    const extendsTyped = (text: string) => text.startsWith(typed) && text.length > typed.length;
    // A lone long title advances a word at a time; multiple rows can agree on a longer prefix.
    const fill = fills.length > 1 && extendsTyped(prefix) ? prefix : lit.startsWith(typed)
      ? typed + (lit.slice(typed.length).match(/^\s*\S+\s*/)?.[0] ?? "") : lit;
    if (fill === typed) return;
    const start = fill.startsWith(typed) ? typed.length : 0;
    this.input.splice(0, typed.length, fill, {}, undefined, { start, end: fill.length });
    this.refresh();
  }

  clear() { if (this.scope === "ask" && maskedQuestion()) this.input = new Draft("power-bar", 0, ""); else this.input.splice(0, this.query.length, ""); this.refresh(); }

  /** A key or a click while it's open: everything is the bar's. Mouse reports are made relative to where it was drawn. */
  key(k: Key, ctx: Ctx) {
    const was = this.picker.sel;
    if (k.kind === "esc" && this.query && !this.compact() && !this.docsMode) { void this.host.dispatch.press("bar.edit", { op: "clear" }); return; }
    if (k.kind === "mouse") {
      const r = this.rect;
      if (!r) return;
      const dr = this.docsRect;
      if (dr && (this.docsGesture.pressed || k.x >= r.col + dr.col && k.x < r.col + dr.col + dr.cols && k.y >= r.row + dr.row && k.y < r.row + dr.row + dr.rows)) {
        const x = k.x - r.col - dr.col, y = k.y - r.row - dr.row + this.docsView.top;
        if (k.action === "wheel-up" || k.action === "wheel-down") void this.host.dispatch.press("bar.docs", { op: "scroll", by: wheelRows(k.action === "wheel-down" ? 1 : -1) });
        else if (k.action === "down") {
          const clicks = this.docsGesture.press(k.x, k.y);
          void this.host.dispatch.press("bar.docs", { op: "select", row: y, col: x, clicks });
        } else if (k.action === "drag" && this.docsGesture.drag(k.x, k.y)) void this.host.dispatch.press("bar.docs", { op: "extend", row: y, col: x });
        else if (k.action === "up") {
          const release = this.docsGesture.release(k.x, k.y);
          if (release.copy) void this.host.dispatch.press("bar.docs", { op: "copy" });
          else if (release.click && this.docsExamples.has(y)) void this.host.dispatch.press("bar.docs", { op: "example", row: y });
        }
        ctx.redraw(); return;
      }
      const compact = this.compact();
      const inputX = compact ? 2 + width(compact.title) : 3;
      const x = k.x - r.col - inputX, y = k.y - r.row - (compact ? 1 : 2);
      if ((k.action === "down" && y === 0 && x >= 0 && x < Math.max(10, r.cols - 32)) || this.gesture.pressed) {
        const d = this.input;
        const select = (from: number, to = from) => { void this.host.dispatch.press("bar.edit", { op: "select", from, to }); };
        if (k.action === "down") {
          const n = this.gesture.press(k.x, k.y), p = d.posAt(x, 0);
          select(p.col);
          if (n > 1) {
            const cs = [...d.text], col = [...d.text.slice(0, d.col)].length;
            const selection = wordAt(rowsOf([d.text]), { row: 0, col });
            select(n === 3 ? 0 : cs.slice(0, selection.start.col).join("").length,
              n === 3 ? d.text.length : cs.slice(0, selection.end.col + 1).join("").length);
          }
        } else if (k.action === "drag" && this.gesture.drag(k.x, k.y)) {
          const p = d.posAt(x, 0); select(d.anchor?.col ?? d.col, p.col);
        } else if (k.action === "up" && this.gesture.release(k.x, k.y).copy) {
          const text = d.selectedText(); if (text && !(this.scope === "ask" && maskedQuestion())) ctx.copy?.(text);
        }
        ctx.redraw(); return;
      }
      if (k.action === "up" || k.action === "drag") return;
      this.alt = !!((k.mods ?? 0) & (MOUSE_ALT | MOUSE_CTRL)) || k.button === MOUSE_MIDDLE;
      const at = { ...k, x: k.x - r.col, y: k.y - r.row };
      if (k.action === "down" && k.button === 2) {
        const hit = this.picker.itemAt(at.y);
        if (hit !== null) { this.picker.sel = hit; void this.host.dispatch.press("bar.command", { op: "menu" }); }
      } else this.picker.key(at, this);
      this.alt = false;
    } else if (this.docsMode && k.kind === "esc") this.ownKey(k); else this.picker.key(k, this);
    if (this.picker.sel !== was) this.moved = true;
    ctx.redraw();
  }

  /** What the source it's scoped to draws above its rows (an action's form), as drawn last. */
  private sourceHead: string[] = [];

  private clickTab(x: number, y: number): boolean {
    if (this.menuOpen && y === 3) {
      const hit = this.menuSpots.find(s => x >= s.from && x < s.to);
      if (hit) { void this.host.dispatch.press(hit.action, hit.args); return true; }
    }
    // A line of the scoped source's head (a form's field, its act line): under the bar's line.
    if (y >= 3 + Number(this.menuOpen) && y < 3 + Number(this.menuOpen) + this.sourceHead.length) { const s = this.scope ? barSource(this.scope) : undefined; return !!s?.headClick?.(y - 3 - Number(this.menuOpen), this.host); }
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
      // The outline changed: the notes the preview read are read again (the old one stays drawn until the new arrives).
      for (const id of [...this.notes.keys()]) this.readNote(id, true);
      for (const s of this.sources()) if (!s.asks) { try { const r = s.rows(this.query, this.host, this.scope); if (Array.isArray(r)) this.got.set(s.id, r); } catch { /* kept as it was */ } }
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
    const ask = (s: BarSource) => { try { const r = s.rows(q, this.host, this.scope); if (Array.isArray(r)) answer(s, r); else void r.then(rows => answer(s, rows), e => fail(s, e)); } catch (e) { fail(s, e); } };
    const later = sources.filter(s => s.asks);
    for (const s of sources) { if (s.asks) this.asking.add(s.id); else { this.asking.add(s.id); ask(s); } }
    this.build();
    // A source that asks the service (the notes search, an extension's) waits for typing to pause.
    if (later.length && this.quick) for (const s of later) ask(s);
    else if (later.length) this.timer = setTimeout(() => { this.timer = null; for (const s of later) ask(s); }, askMs());
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
    // In the main list a source whose row what's typed names outright (a pasted action line) comes first, that row lit.
    const sources = this.sources(), named = (s: BarSource) => !this.scope && !!this.got.get(s.id)?.some(r => r.exact);
    for (const s of [...sources.filter(named), ...sources.filter(s => !named(s))]) {
      const rows = this.got.get(s.id) ?? [];
      const shown = this.scope ? rows : rows.slice(0, s.main.most ?? 8);
      let group: string | undefined;
      shown.forEach((row, i) => {
        const head = i === 0 ? (this.scope ? row.group : row.group ? `${s.title} · ${row.group}` : s.title) : row.group !== group ? row.group : undefined;
        group = row.group;
        out.push({ source: s, row, ...(head ? { heading: head } : {}) });
      });
    }
    // In another source's scope (never an answer's, `alone`), the row a source names outright comes first: a typed action line runs from anywhere.
    const scoped = this.scope ? barSource(this.scope) : undefined, q = this.query.trim();
    const guests = scoped && !scoped.alone && q ? barSources().filter(s => s !== scoped && s.named).flatMap((s): BarItem[] => {
      try { const row = s.named!(q, this.host); return row ? [{ source: s, row: { ...row, exact: true }, heading: s.title }] : []; } catch { return []; }
    }) : [];
    const runs: BarSource = {
      id: "runs", title: "runs", prefix: "", by: "door", about: "this session's answers", main: { empty: false, typed: false },
      rows: () => [], preview: row => ({ lines: [row.detail ?? ""] }),
      pick: async (row, host, how) => {
        const source = barSource("actions")!;
        const command = source.named!(row.fill!, host) ?? (await source.rows(row.fill!, host, "actions")).find(r => r.fill === row.fill);
        if (!command) throw new Error("this action is no longer available");
        return source.pick(command, host, how);
      },
    };
    this.items = [...guests, ...out, ...(!scoped || scoped.id === "actions" ? [...this.host.runs].reverse() : []).map((run, i): BarItem => ({ source: runs, heading: i === 0 ? "this session" : undefined, row: { key: `run:${i}`, label: run.line, fill: run.line, detail: `${run.refused ? "refused: " : ""}${run.answer}` } }))];
    const at = keep ? this.items.findIndex(it => `${it.source.id}\0${it.row.key}` === keep) : -1;
    this.picker.sel = at >= 0 ? at : 0;
    this.litKey = keep;
  }

  /** A row: its indent and mark, its words, then dim what it is and its key, as wide as the list. */
  private rowText(it: BarItem, on: boolean, w: number): string[] {
    const r = it.row, head = ` ${"  ".repeat(Math.min(6, r.depth ?? 0))}${r.mark ? `${r.mark} ` : ""}`;
    const detail = r.refused ? ` · ${r.refused}` : r.subtitle ? ` · ${r.subtitle}` : r.detail ? ` · ${r.detail}` : "";
    const cap = r.keycap ? ` ${keyCaption(r.keycap)} ` : "";
    return rowLines(head + r.label + detail, w - width(cap), undefined, { hang: width(head) }).map((line, i) =>
      pickRow(line, on, w - width(cap), r.refused ? C.dark : C.grey) + (i ? " ".repeat(width(cap)) : cap));
  }

  /** Its frame over `a`: the scopes, the line, the rows and (wide enough) the lit row's preview. */
  private frame(a: Rect) {
    const rect: Rect = { col: 0, row: 0, cols: a.cols, rows: a.rows }, w = rect.cols - 2;
    const compact = this.compact();
    if (compact) {
      this.tabSpots = []; this.sourceHead = [];
      const label = clipText(compact.title, Math.max(1, w - 12));
      const input = this.scope === "ask" && maskedQuestion() ? "·".repeat(Math.min(this.query.length, Math.max(1, w - width(label) - 2))) + "█" : this.input.render(Math.max(1, w - width(label) - 2), 1)[0];
      return { rect, title: "", foot: compact.choice ? "click or j k ⏎ choose · esc cancel" : "⏎ run · esc cancel",
        head: [fg(C.lcyan) + ` ${label} ` + RESET + (compact.choice ? "" : input)] };
    }
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
    const line = paint("|14› ") + (this.scope === "ask" && maskedQuestion() ? "*".repeat(Math.min(this.query.length, Math.max(10, w - 30))) : this.input.render(Math.max(10, w - 30), 1)[0]) + paint(` |08${busy || count}`);
    const scoped = this.scope ? barSource(this.scope) : undefined;
    this.sourceHead = scoped?.head?.(w, this.host) ?? [];
    this.menuSpots = [];
    let menu = " ";
    for (const [label, action, args] of [["copy command", "bar.command", { op: "copy" }], ["copy button", "bar.command", { op: "button" }], ["insert button", "bar.insert", {}]] as const) {
      this.menuSpots.push({ from: menu.length + 1, to: menu.length + label.length + 3, action, args });
      menu += `[${label}] `;
    }
    const head = [tabs, line, ...(this.menuOpen ? [menu] : []), ...this.sourceHead, fg(C.blue) + "─".repeat(w) + RESET];
    const tail = said ? [fg(C.lred) + pad(` ${said}`, w) + RESET] : [];
    const it = this.items[this.picker.sel];
    const empty = !this.items.length && !this.asking.size;
    const hint = this.scope ? barSource(this.scope)?.about ?? "" : this.query.trim() ? "nothing here matches" : "nothing open yet";
    const preview = (pw: number, ph: number) => it ? this.previewLines(it, pw, ph) : empty ? wrap(hint, pw).map(l => dim(l)) : [];
    return {
      rect, title: " power bar ",
      foot: this.docsMode ? "docs: arrows / page keys select · y or cmd+c copy · enter example · esc returns to line" : scoped?.foot?.() ?? "esc clear/close · ↑↓ pick · ⏎ run · ⇥ complete · alt+o copy · alt+y button · alt+i insert · alt+m menu · alt+v docs",
      head, ...(tail.length ? { tail } : {}),
      preview, previewPlaced: (rect: Rect | null) => { this.docsRect = this.docsLines.length ? rect : null; },
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
    if (!p || p === "…" || "note" in p) this.docsLines = [];
    if (p === "…") return [dim("…")];
    if (!p) return [];
    if ("lines" in p || "markdown" in p) {
      if (this.docsKey !== key + w) { this.docsKey = key + w; this.docsView.reset(); this.docsSelection = null; this.docsMode = false; }
      this.docsDoc = "markdown" in p ? draftPreviewDoc(p.markdown, w, { board: this.host.ctx.board, redraw: () => this.host.ctx.redraw() }) : null;
      this.docsLines = this.docsDoc?.lines ?? ("lines" in p ? p.lines.flatMap(l => rowLines(paintable(l), w)).map(l => fg(C.grey) + l + RESET) : []);
      this.docsExamples.clear();
      const info = this.host.dispatch.list().actions.find(a => a.name === (it.row.data as { action?: string })?.action);
      const plain = this.docsLines.map(l => rowsOf([l]).cells(0).join(""));
      let after = plain.findIndex(l => l.includes("EXAMPLES"));
      for (const ex of info?.examples ?? []) {
        const first = ex.act.split(/\s+/)[0]!;
        const found = plain.findIndex((l, i) => i > after && l.includes(first));
        if (found >= 0) {
          this.docsExamples.set(found, ex.act);
          for (let i = found + 1; i < plain.length && !plain[i]!.includes("→") && plain[i]!.replace(/[┊│ ]/g, ""); i++) this.docsExamples.set(i, ex.act);
          after = found;
        }
      }
      const top = this.docsView.place(null, this.docsLines.length, h);
      return this.docsLines.slice(top, top + h).map((l, i) => {
        const span = this.docsSelection?.span(top + i, width(l));
        return span ? paintRange(l, span[0], span[1], SELECT_BG) : l;
      });
    }
    return this.notePreview(p.note, w, h);
  }

  /**
   * Read note `id` for the preview. An answer of none is a note that is gone; a read that failed (offline, refused) is said
   * as that, never as gone. A re-read (`again`, after a change) keeps the old note drawn until the new one arrives.
   */
  private readNote(id: string, again = false) {
    if (!again) this.notes.set(id, "…");
    // The newest read of a note is the one that counts: an older answer arriving later is dropped.
    const gen = (this.reads.get(id) ?? 0) + 1;
    this.reads.set(id, gen);
    void this.host.note(id).then(
      m => { if (this.done || this.reads.get(id) !== gen) return; this.notes.set(id, m); this.shownNote = null; this.host.ctx.redraw(); },
      e => { if (this.done || this.reads.get(id) !== gen) return; this.notes.set(id, { offline: e instanceof Error ? e.message : String(e) }); this.shownNote = null; this.host.ctx.redraw(); },
    );
  }

  /** A note as a reader draws it: the bar's own note surface, its top `h` rows. */
  private notePreview(id: string, w: number, h: number): string[] {
    const m = this.notes.get(id);
    if (m === undefined) { this.readNote(id); return [dim("…")]; }
    if (m === "…") return [dim("…")];
    if (!m) return [dim("(that note is gone)")];
    if ("offline" in m) return [dim(`(${m.offline})`)];
    const app = this.host.ctx;
    // A reader's host with nothing to host but the drawing: no graphics (an image is named on its line), no keys.
    const ctx = { board: (m.address ? outlineBoards(app).peek(m.address)?.board : undefined) ?? app.board, t: { cols: w, rows: h, cellW: 9, cellH: 18, kitty: false }, graphics: false, flash: (s: string) => app.flash(s), redraw: () => app.redraw() } as unknown as Ctx;
    const sh: SurfaceHost = { ctx, redraw: () => app.redraw(), navigate() {} };
    if (this.shownNote !== id) { this.surface.show(m, sh); this.shownNote = id; }
    return this.surface.render(w, h, sh).lines.slice(0, h).map(l => l.replace(TAGS, "").replace(MARKS, ""));
  }

  /** Drawn over a screen `cols` by `rows`: where, and its rows. */
  draw(cols: number, rows: number): { rect: Rect; lines: string[] } {
    const compact = this.compact();
    const height = compact ? (compact.choice ? Math.min(this.items.length, 6) : 0) + 3 : 0;
    const r = (this.rect = compact ? { col: 1, row: Math.max(0, rows - height - 1), cols: Math.min(cols - 3, Math.max(48, width(compact.title) + 24)), rows: height } : barRect(cols, rows));
    const canvas = new Canvas(r.cols + 1, r.rows + 1);
    const values = lookFor(this.host.ctx, { screen: this.host.screens().at(-1)?.title }, r.cols).values;
    withRowLimit(values["rows.lines"], () => this.picker.draw(canvas, { col: 0, row: 0, cols: r.cols, rows: r.rows }, values));
    return { rect: { ...r, cols: r.cols + 1, rows: r.rows + 1 }, lines: canvas.lines() };
  }

  private recordRun(line: string, result: unknown, refused: boolean) {
    this.host.runs.push({ line, answer: typeof result === "string" ? result : JSON.stringify(result), refused });
    if (this.host.runs.length > 8) this.host.runs.shift();
    this.input.splice(0, this.query.length, line); this.refresh(); this.host.ctx.redraw();
  }

  /** What `peek` and `bar.open` say: the scope, the query and the rows, numbered from 1, the lit one marked. */
  describe(): Record<string, unknown> {
    return {
      runs: this.host.runs, docs: { top: this.docsView.top, total: this.docsLines.length, rect: this.docsRect, examples: [...this.docsExamples].map(([row, line]) => ({ row, line })) },
      scope: this.scope ?? "all", query: this.scope === "ask" && maskedQuestion() ? "[hidden]" : this.query, selected: this.items.length ? this.picker.sel + 1 : null,
      ...(() => { const st = this.scope ? barSource(this.scope)?.state?.() : null; return st ? { form: st } : {}; })(),
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

  docs(op: string, o: { by?: number; row?: number; col?: number; clicks?: number; key?: string } = {}): { top: number; text: string } | { text: string } {
    const rows = this.docsRows(), pos = { row: Math.max(0, Math.min(rows.count - 1, o.row ?? 0)), col: Math.max(0, o.col ?? 0) };
    if (op === "key" && this.docsSelection) {
      const key = keyOfName(o.key!);
      if (!key) throw new ActionRefused("name a docs key: arrows, pgup, pgdn, home, end, y, enter or esc");
      const result = modeKey(key, this.docsSelection, rows, this.docsView.room);
      if (result === "copy") return this.docs("copy");
      if (result === "done") this.docsMode = false;
      if (result === "moved") this.docsView.place(this.docsSelection.head.row, this.docsLines.length, this.docsView.room);
      if (key.kind === "enter") return this.docs("example", { row: this.docsSelection.head.row });
    }
    else if (op === "focus") { this.docsMode = !this.docsMode; if (this.docsMode) this.docsSelection = new Selection({ row: this.docsView.top, col: 0 }, { row: this.docsView.top, col: 0 }, true); }
    else if (op === "scroll") this.docsView.scroll(o.by ?? 1);
    else if (op === "select") { this.docsSelection = o.clicks === 3 ? new Selection({ row: pos.row, col: 0 }, { row: pos.row, col: rows.cells(pos.row).length - 1 }) : o.clicks === 2 ? wordAt(rows, pos) : new Selection(pos, pos); }
    else if (op === "extend" && this.docsSelection) this.docsSelection.head = pos;
    else if (op === "copy") { const text = this.docsSelection?.text(rows) ?? ""; if (text) this.host.ctx.copy?.(text); return { text }; }
    else if (op === "example") {
      const line = this.docsExamples.get(o.row ?? 0);
      if (!line) throw new Error("click an example's command line");
      this.docsMode = false;
      this.input.splice(0, this.query.length, line.replace(/^ep0ch act /, "")); this.refresh();
    }
    this.host.ctx.redraw();
    return { top: this.docsView.top, text: this.docsSelection?.text(rows) ?? "" };
  }

  commandLine(n = this.selected + 1): string {
    const it = this.items[n - 1];
    if (it?.source.id === "runs" || it?.row.key.startsWith("line:")) return it.row.fill!;
    if (it?.source.id === "actions") {
      const d = it.row.data as { action: string; args?: Record<string, unknown>; tile?: string };
      return shownLine(d.action, d.args, d.tile);
    }
    return this.query;
  }

  menuOpen = false;
  async command(op: string, n?: number) {
    if (op === "menu") { this.menuOpen = !this.menuOpen; this.host.ctx.redraw(); return; }
    const line = op === "recall" ? this.host.runs.at(-1)?.line : this.commandLine(n);
    if (!line) throw new Error("type an act line first");
    if (op === "recall") { this.input.splice(0, this.query.length, line); this.refresh(); return { line }; }
    const text = op === "button" ? commandButton(line) : `ep0ch act ${line}`;
    this.host.ctx.copy?.(text);
    return { text };
  }

  keepsRun(n: number): boolean {
    const it = this.items[n - 1];
    if (!it) return false;
    if (it.source.id === "runs") return true;
    if (it.source.id !== "actions") return false;
    const d = it.row.data as { action: string; form?: boolean };
    return !d.form && (it.row.key.startsWith("line:") || it.row.key === d.action);
  }

  /** Pick row `n` (from 1): its source does it, as `actor`. */
  async pickRow(n: number, alt: boolean, actor: Actor): Promise<unknown> {
    const it = this.items[n - 1];
    if (!it) throw new Error(this.items.length ? `pick 1 to ${this.items.length}` : "the bar lists nothing to pick");
    this.picker.sel = n - 1;
    const keep = actor.kind === "user" && this.keepsRun(n), line = this.commandLine(n);
    try {
      const result = await it.source.pick(it.row, this.host, { alt, actor }) ?? null;
      if (keep) this.recordRun(line, result, false);
      return { picked: rowFacts(it, n), result };
    } catch (e) {
      if (keep) this.recordRun(line, e instanceof Error ? e.message : String(e), true);
      throw e;
    }
  }
}

/** A row as an agent and `peek` read it. */
export function rowFacts(it: BarItem, n: number): Record<string, unknown> {
  const r = it.row;
  return { n, source: it.source.id, key: r.key, label: r.label, ...(r.detail ? { detail: r.detail } : {}), ...(r.depth ? { depth: r.depth } : {}), ...(r.group ? { group: r.group } : {}), ...(r.keycap ? { keycap: r.keycap } : {}), ...(r.refused ? { refused: r.refused } : {}) };
}

/** The bar's rows laid over a screen's `lines` (without the status bar). */
export function overBar(lines: string[], bar: { rect: Rect; lines: string[] }, values?: StyleValues): string[] {
  const canvas = new Canvas(Math.max(...lines.map(width)), lines.length);
  lines.forEach((line, y) => canvas.text(0, y, line));
  canvas.backdrop(values);
  const out = canvas.lines(), { col, cols } = bar.rect;
  bar.lines.forEach((l, i) => {
    const y = bar.rect.row + i;
    if (y >= out.length) return;
    const base = out[y] ?? "", head = headOf(base, col);
    out[y] = head + " ".repeat(Math.max(0, col - width(head))) + RESET + l + RESET + tailFrom(base, col + cols);
  });
  return out;
}
