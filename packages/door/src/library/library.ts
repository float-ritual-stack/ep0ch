// The component library (PIE-618): a design-system page per component, generated from its schema (outline-core's
// component-schema.ts, the service's `components.schemas`), never written per component. A page has four parts: an
// overview (what it is, where it goes, the minimal example, the properties table), one property at a time (each value
// drawn with the exact source underneath), the two-axis grids the schema marks, and every combination behind a filter
// (picked per axis; the matching variations drawn a page at a time, never the whole space). Each variation is drawn by
// the readers' own renderer (src/library/draw.ts) at 40, 80 or 160 columns, and its source is copied by a click, `y`
// or `act`. A screen spec (`library`) of one tile kind; every key and click runs one of LIBRARY_ACTIONS.
import { axisValues, grid, spaceSize, spaceVariations, sweep, valuesWords, variation, variationText, type ComponentSchema, type PropPlace, type SpaceFilter, type Variation } from "@ep0ch/outline-core/component-schema";
import { componentsOf } from "../component-schemas";
import type { ListSource } from "../outline-lists";
import { RowView, scrolled, wheelRows } from "../scroll";
import { BOLD, C, chip, ellipsize, fg, pad, RESET, selected, UNBOLD, width } from "../style";
import { draftPreview } from "../surface/note";
import { ActionRefused, actionSet, def } from "../surface/actions";
import { ch, type Key } from "../term";
import { wrap } from "../text";
import type { DeskApi, Pane, PaneView } from "../desk/panes";
import type { ScreenSpec } from "../desk/screen-spec";
import type { KindHost, TileKind } from "../desk/tile-kinds";
import { drawingWaits, drawVariation } from "./draw";

/** The page's parts, each a digit. */
export const PARTS = [
  { part: "overview", key: "1", label: "overview" },
  { part: "property", key: "2", label: "one property at a time" },
  { part: "grid", key: "3", label: "grids" },
  { part: "space", key: "4", label: "every combination" },
] as const;
export type Part = (typeof PARTS)[number]["part"];
/** The widths a variation is drawn at: the narrow fallback, a reader, a wide screen. */
export const WIDTHS = [40, 80, 160] as const;
/** Variations of the whole space drawn at once. */
export const SPACE_PAGE = 8;

const PLACE: Record<PropPlace, string> = { line: "on the line", note: "on the declaring note", yaml: "in the YAML" };

/** A part of a row a click runs an action on. */
interface Hit { from: number; to: number; action: string; args?: Record<string, unknown> }
/** One drawn row: its text, what a click on it runs, the variation it belongs to. */
interface Row { text: string; hits?: Hit[]; v?: number }

/** A component's short name, for its tab: its title without the `(::graph-meter)`. */
const shortTitle = (s: ComponentSchema) => s.title.replace(/\s*\(.*\)\s*$/, "");

/** A row of chips, wrapped to `w`: each its label, lit when `on`, the cursor's marked, a click running its action. */
function chipRows(items: { label: string; on: boolean; cursor?: boolean; hit: Omit<Hit, "from" | "to"> }[], w: number, lead = ""): Row[] {
  const rows: Row[] = [];
  let text = lead, hits: Hit[] = [], at = width(lead);
  for (const it of items) {
    const label = ` ${it.label} `, n = width(label);
    if (at + n + 1 > w && at > width(lead)) { rows.push({ text, hits }); text = " ".repeat(width(lead)); hits = []; at = width(lead); }
    const look = it.on ? chip(C.blue) : it.cursor ? fg(C.white) : fg(C.grey);
    const marked = it.cursor ? `\x1b[4m${label}\x1b[24m` : label;
    text += look + marked + RESET + " ";
    hits.push({ from: at, to: at + n, ...it.hit });
    at += n + 1;
  }
  rows.push({ text, hits });
  return rows;
}

/** The library: a component's page, in parts, its variations drawn with their source. */
export class LibraryPane implements Pane {
  readonly kind = "library";
  /** The component shown, by id. */
  component: string;
  part: Part;
  /** The property shown one value at a time (an index into the schema's sweep), the grid shown, the width drawn at. */
  axis = 0;
  gridAt = 0;
  width: number = 80;
  /** The values picked per axis of the whole space, the cursor among the chips (an axis row, a value), the page. */
  filter: Record<string, string[]> = {};
  cursor = { row: 0, value: 0 };
  page = 0;
  /** The variation selected, an index into what the part shows. */
  selectedV = 0;
  private view = new RowView();
  private desk: DeskApi | null = null;
  /** What the last paint laid out: the fixed rows, the scrolled ones. */
  private head: Row[] = [];
  private body: Row[] = [];
  private revealNext = false;

  constructor(spec: { component?: string; part?: string } = {}) {
    this.component = spec.component ?? "heading-style";
    this.part = (PARTS.find(p => p.part === spec.part)?.part ?? "overview");
  }

  private src(desk: DeskApi | null = this.desk): ListSource | null { return desk ? { board: desk.ctx.board, redraw: () => desk.redraw() } : null; }
  schemas(desk: DeskApi | null = this.desk): readonly ComponentSchema[] { return componentsOf(this.src(desk)); }
  schema(desk: DeskApi | null = this.desk): ComponentSchema { const all = this.schemas(desk); return all.find(s => s.id === this.component) ?? all[0]!; }

  title() {
    const s = this.schema();
    return `library · ${s.title}${s.origin && s.origin !== "built-in" ? ` · ${s.origin}` : ""} · ${PARTS.find(p => p.part === this.part)!.label}`;
  }
  hint() {
    const own = this.part === "property" ? "← → property · " : this.part === "grid" ? "← → grid · " : this.part === "space" ? "[ ] axis · ← → value · space picks · x clears · n p page · " : "";
    return `, . component · 1-4 part · ${own}j k variation · y copies · w width · or click`;
  }
  init(desk: DeskApi) { this.desk = desk; }
  spec(): { component: string; part: Part } { return { component: this.component, part: this.part }; }

  // ── laying the page out ────────────────────────────────────────────────

  /** A variation as rows: its label (and its copy control), its drawing at the chosen width (cut at the tile's), its source. */
  private block(v: Variation, i: number, label: string, W: number, src: ListSource | null, cut = W): Row[] {
    const sel = i === this.selectedV, out: Row[] = [];
    const copy = " copy ", room = Math.max(4, cut - width(copy) - 3);
    const head = `${sel ? "▌" : " "} ${ellipsize(label, room)}`;
    out.push({ text: (sel ? selected(true) : fg(C.lcyan)) + pad(head, cut - width(copy)) + RESET + fg(C.dark) + copy + RESET, v: i,
      hits: [{ from: 0, to: cut - width(copy), action: "library.select", args: { n: i + 1 } }, { from: cut - width(copy), to: cut, action: "library.copy", args: { n: i + 1 } }] });
    const drawn = drawVariation(v, this.width, src);
    const wider = this.width + 2 > cut;
    for (const l of drawn) out.push({ text: "  " + (wider ? pad(l, cut - 2) : l) + RESET, v: i });
    if (wider) out.push({ text: fg(C.dark) + pad(`  ↤ drawn at ${this.width} columns, cut at ${cut - 2} · w changes the width`, cut) + RESET, v: i });
    if (drawingWaits(v, src)) out.push({ text: fg(C.dark) + "  asking the outline how the rule draws…" + RESET, v: i });
    const source = (line: string, tag = "") => wrap(line || " ", Math.max(8, cut - 6 - width(tag))).map((l, j) => ({ text: fg(C.dark) + "  ┆ " + (j || !tag ? "" : fg(C.brown) + tag) + fg(C.grey) + l + RESET, v: i }));
    if (v.note) { out.push(...source(v.note, "note · ")); out.push({ text: fg(C.dark) + "  ┆" + RESET, v: i }); }
    for (const l of v.use.split("\n")) out.push(...source(l));
    out.push({ text: "", v: i });
    return out;
  }

  /** The values a variation has that its part varies, as its label: `heading-pattern: waffle · a checkerboard…`. */
  private labelOf(s: ComponentSchema, v: Variation, keys: readonly string[], meaning = false): string {
    const said = keys.map(k => `${k}: ${v.values[k] ?? "(none)"}`).join(" · ");
    if (!meaning || keys.length !== 1) return said;
    const p = s.props.find(x => x.key === keys[0]);
    const m = p?.values?.find(x => x.value === v.values[keys[0]!])?.meaning;
    return m ? `${said} · ${m}` : said;
  }

  /** The fixed rows (the component tabs, the parts and widths, the part's own controls) and the scrolled ones, for width `W`. */
  layout(W: number, desk: DeskApi | null = this.desk): { head: Row[]; body: Row[]; shown: Variation[] } {
    const src = this.src(desk), all = this.schemas(desk), s = this.schema(desk);
    const head: Row[] = [];
    head.push(...chipRows(all.map(c => ({ label: shortTitle(c) + (c.origin && c.origin !== "built-in" ? " ·ext" : ""), on: c.id === s.id, hit: { action: "library.component", args: { name: c.id } } })), W));
    const parts = chipRows(PARTS.map(p => ({ label: `${p.key} ${p.label}`, on: p.part === this.part, hit: { action: "library.part", args: { part: p.part } } })), W);
    const widths = chipRows(WIDTHS.map(n => ({ label: String(n), on: n === this.width, hit: { action: "library.width", args: { cols: n } } })), W, fg(C.dark) + "width" + RESET);
    // The widths at the right of the parts' row when they fit, else under it.
    const last = parts[parts.length - 1]!, room = W - width(last.text) - width(widths[0]!.text) - 1;
    if (widths.length === 1 && room >= 1) {
      const at = width(last.text) + room;
      last.text += " ".repeat(room) + widths[0]!.text;
      last.hits = [...(last.hits ?? []), ...widths[0]!.hits!.map(h => ({ ...h, from: h.from + at, to: h.to + at }))];
      head.push(...parts);
    } else head.push(...parts, ...widths);
    const body: Row[] = [], shown: Variation[] = [];
    const cut = Math.max(20, W);
    const text = (t: string, colour: number = C.grey) => wrap(t, Math.max(8, W - 2)).forEach(l => body.push({ text: fg(colour) + l + RESET }));
    const heading = (t: string) => body.push({ text: fg(C.white) + BOLD + t + UNBOLD + RESET });
    const md = (t: string) => draftPreview(t, Math.max(10, W - 1), src as never).forEach(l => body.push({ text: l }));
    if (this.part === "overview") {
      md(s.intro);
      body.push({ text: "" });
      md(`**Where it goes:** ${s.where}.`);
      body.push({ text: "" });
      heading("Minimal example");
      const v = variation(s, {});
      shown.push(v);
      body.push(...this.block(v, 0, Object.entries(v.values).map(([k, x]) => `${k}: ${x}`).join(" · ") || "as written", W, src, cut));
      heading("Properties");
      const kw = Math.min(24, Math.max(...s.props.map(p => width(p.token ?? p.key)))), ww = 22, vw = Math.max(10, Math.min(36, W - kw - ww - 14));
      body.push({ text: fg(C.dark) + pad("key", kw) + "  " + pad("where", ww) + "  " + pad("values", vw) + "  default" + RESET });
      for (const p of s.props) {
        body.push({ text: fg(C.lcyan) + pad(p.token ?? p.key, kw) + "  " + fg(C.grey) + pad(PLACE[p.where], ww) + "  " + fg(C.white) + pad(valuesWords(p), vw) + "  " + fg(C.brown) + (p.default ?? "") + RESET });
        wrap(p.meaning, Math.max(8, W - kw - 4)).forEach(l => body.push({ text: " ".repeat(kw + 2) + fg(C.dark) + l + RESET }));
      }
    } else if (this.part === "property") {
      const axis = s.sweep[Math.min(this.axis, s.sweep.length - 1)];
      head.push(...chipRows(s.sweep.map((k, i) => ({ label: k, on: k === axis, hit: { action: "library.axis", args: { key: k } } })), W));
      const p = s.props.find(x => x.key === axis);
      if (!axis || !p) text("this component marks no property to show one value at a time", C.dark);
      else {
        head.push({ text: fg(C.dark) + pad(`${PLACE[p.where]} · ${p.meaning}`, W) + RESET });
        sweep(s, axis).forEach(v => { body.push(...this.block(v, shown.length, this.labelOf(s, v, [axis], true), W, src, cut)); shown.push(v); });
      }
    } else if (this.part === "grid") {
      const g = s.grids[Math.min(this.gridAt, s.grids.length - 1)];
      head.push(...chipRows(s.grids.map(([a, b], i) => ({ label: `${a} × ${b}`, on: i === Math.min(this.gridAt, s.grids.length - 1), hit: { action: "library.grid", args: { n: i + 1 } } })), W));
      if (!g) text("this component marks no two properties to draw as a grid", C.dark);
      else {
        const [a, b] = g, laid = grid(s, a, b);
        // Side by side when the row's cells fit at the width drawn, else one under another.
        const per = laid.rows[0]?.cells.length ?? 1, cellW = this.width + 4, side = per * cellW <= W;
        for (const row of laid.rows) {
          heading(`${a}: ${row.value}`);
          if (!side) { for (const c of row.cells) { body.push(...this.block(c, shown.length, this.labelOf(s, c, [b]), W, src, cut)); shown.push(c); } continue; }
          const blocks = row.cells.map(c => { const r = this.block(c, shown.length, this.labelOf(s, c, [b]), cellW - 2, src, cellW - 2); shown.push(c); return r; });
          const tall = Math.max(...blocks.map(x => x.length));
          for (let j = 0; j < tall; j++) {
            let t = "", hits: Hit[] = [];
            blocks.forEach((rows, k) => {
              const r = rows[j];
              t += pad(r?.text ?? "", cellW - 2) + RESET + "  ";
              hits = hits.concat((r?.hits ?? []).map(h => ({ ...h, from: h.from + k * cellW, to: h.to + k * cellW })));
            });
            body.push({ text: t, hits });
          }
        }
      }
    } else {
      const axes = s.space.flatMap(k => { const p = s.props.find(x => x.key === k); return p ? [{ key: k, values: axisValues(p) }] : []; });
      const lw = Math.min(20, Math.max(0, ...axes.map(a => width(a.key))));
      axes.forEach((a, r) => {
        const picked = this.filter[a.key] ?? [];
        const lead = (r === this.cursor.row ? fg(C.white) + "› " : "  ") + fg(C.lcyan) + pad(a.key, lw) + RESET + " ";
        head.push(...chipRows(a.values.map((v, j) => ({ label: v, on: picked.includes(v), cursor: r === this.cursor.row && j === this.cursor.value, hit: { action: "library.pick", args: { axis: a.key, value: v } } })), W, lead));
      });
      const filter: SpaceFilter = this.filter, size = spaceSize(s, filter);
      const from = Math.min(this.page * SPACE_PAGE, Math.max(0, size.matching - 1));
      const page = spaceVariations(s, filter, from, SPACE_PAGE);
      const say = `${size.matching} of ${size.all} match · ${page.length ? `${from + 1}–${from + page.length} shown` : "none shown"} · `;
      const controls = [["n next", "library.page", { by: 1 }], ["p previous", "library.page", { by: -1 }], ["x clear", "library.clear", {}]] as const;
      let t = fg(C.grey) + say, at = width(say);
      const hits: Hit[] = [];
      for (const [label, action, args] of controls) { t += fg(C.lcyan) + label + fg(C.dark) + "  "; hits.push({ from: at, to: at + width(label), action, args }); at += width(label) + 2; }
      head.push({ text: t + RESET, hits });
      page.forEach(v => { body.push(...this.block(v, shown.length, this.labelOf(s, v, s.space), W, src, cut)); shown.push(v); });
    }
    return { head, body, shown };
  }

  render(w: number, h: number, focused: boolean, desk: DeskApi): PaneView {
    this.desk = desk;
    const laid = this.layout(w, desk);
    this.head = laid.head; this.body = laid.body;
    if (this.selectedV >= laid.shown.length) this.selectedV = Math.max(0, laid.shown.length - 1);
    const headRows = this.head.slice(0, Math.max(0, h - 1));
    const room = Math.max(0, h - headRows.length - 1);
    const rows = this.body.map((r, i) => (r.v === this.selectedV ? i : -1)).filter(i => i >= 0);
    const sel = rows.length ? [rows[0]!, rows[rows.length - 1]!] as const : null;
    if (this.revealNext) { this.view.reveal(); this.revealNext = false; }
    const top = this.view.place(sel ? this.selectedV : null, this.body.length, room, sel);
    const rule = fg(C.dark) + "─".repeat(Math.max(0, w)) + RESET;
    const lines = [...headRows.map(r => pad(r.text, w) + RESET), rule, ...this.body.slice(top, top + room).map(r => pad(r.text, w) + RESET)];
    void focused;
    return { lines, scroll: { top, total: this.body.length, room } };
  }

  /** The row a click at `y` is on, and what a click there at `x` runs. */
  private hitAt(x: number, y: number): Hit | null {
    const row = y < this.head.length ? this.head[y] : y === this.head.length ? undefined : this.body[this.view.top + y - this.head.length - 1];
    return row?.hits?.find(h => x >= h.from && x < h.to) ?? (row?.v !== undefined ? { from: 0, to: 0, action: "library.select", args: { n: row.v + 1 } } : null);
  }

  /** A press (its kind has keys of its own, so the desk hands it the mouse): what the click lands on runs. */
  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi): boolean {
    if (k.action === "down" && (k.button ?? 0) === 0) this.click(x, y, desk);
    return false;
  }

  click(x: number, y: number, desk: DeskApi) {
    const hit = this.hitAt(x, y);
    if (hit) void desk.press?.(this, LIBRARY_ACTIONS, hit.action, hit.args ?? {});
  }
  wheel(dir: 1 | -1, desk: DeskApi) { void desk.press?.(this, LIBRARY_ACTIONS, "library.scroll", { by: wheelRows(dir) }); }
  key(): boolean { return false; }

  // ── what the actions change ────────────────────────────────────────────

  scrollBy(by: number) { this.view.top = scrolled(this.view.top, by, this.view.maxTop); }
  reveal() { this.revealNext = true; }
  /** The space's axes, as the chips list them. */
  spaceAxes(s = this.schema()): { key: string; values: string[] }[] {
    return s.space.flatMap(k => { const p = s.props.find(x => x.key === k); return p ? [{ key: k, values: axisValues(p) }] : []; });
  }
  /**
   * The variations the part shows now, in the order it draws them, from what's chosen (never from the last paint: an
   * action and the next one see the same list whether or not the screen was drawn between them).
   */
  get shown(): Variation[] {
    const s = this.schema();
    if (this.part === "overview") return [variation(s, {})];
    if (this.part === "property") { const axis = s.sweep[Math.min(this.axis, s.sweep.length - 1)]; return axis ? sweep(s, axis) : []; }
    if (this.part === "grid") { const g = s.grids[Math.min(this.gridAt, s.grids.length - 1)]; return g ? grid(s, g[0], g[1]).rows.flatMap(r => r.cells) : []; }
    const size = spaceSize(s, this.filter);
    return spaceVariations(s, this.filter, Math.min(this.page * SPACE_PAGE, Math.max(0, size.matching - 1)), SPACE_PAGE);
  }

  /** What the page shows now, for `peek` and an agent's answer: the part's choice, the filter, the variations with their source. */
  describe() {
    const s = this.schema();
    const size = spaceSize(s, this.filter);
    return {
      component: s.id, title: s.title, origin: s.origin ?? "built-in", part: this.part, width: this.width,
      components: this.schemas().map(c => c.id),
      ...(this.part === "property" ? { property: s.sweep[Math.min(this.axis, s.sweep.length - 1)] ?? null, properties: s.sweep } : {}),
      ...(this.part === "grid" ? { grid: s.grids[Math.min(this.gridAt, s.grids.length - 1)] ?? null, grids: s.grids } : {}),
      ...(this.part === "space" ? { filter: this.filter, matching: size.matching, all: size.all, page: this.page + 1, cursor: { axis: this.spaceAxes(s)[this.cursor.row]?.key ?? null, value: this.spaceAxes(s)[this.cursor.row]?.values[this.cursor.value] ?? null } } : {}),
      selected: this.shown.length ? this.selectedV + 1 : null,
      variations: this.shown.map((v, i) => ({ n: i + 1, values: v.values, source: variationText(v) })),
    };
  }
}

const libraryOf = (pane: unknown): LibraryPane => {
  if (!(pane instanceof LibraryPane)) throw new ActionRefused("that isn't the library");
  return pane;
};
/** The variation `n` names (from 1), else the selected one. */
function variationAt(p: LibraryPane, n: number | undefined): { v: Variation; i: number } {
  if (!p.shown.length) throw new ActionRefused("nothing is drawn here to copy: pick a part with variations (2, 3 or 4)");
  const i = n === undefined ? p.selectedV : n - 1;
  const v = p.shown[i];
  if (!v) throw new ActionRefused(`there is no variation ${n}; there are ${p.shown.length}`);
  return { v, i };
}
/** `by` steps through `n` choices from `at`, wrapping. */
const step = (at: number, by: number, n: number) => (n ? (((at + by) % n) + n) % n : 0);

/** What the library does: the keys, a click and `act` call the same actions. */
export const LIBRARY_ACTIONS = actionSet<KindHost>()("library", {
  "library.component": def({
    summary: "show a component's page: name=<its id> (heading-style, callout, rule, graph-meter, graph-spark, an extension's), or by=1/-1 for the next or previous",
    keys: ", . or a click on its tab", touches: "screen", replay: "safe", says: r => `showed the ${r.title} page`,
    args: { name: { type: "string", optional: true, about: "the component's id" }, by: { type: "number", optional: true, about: "1 the next, -1 the previous" } },
    run({ name, by }, { pane }) {
      const p = libraryOf(pane), all = p.schemas();
      const at = name !== undefined ? all.findIndex(s => s.id === name) : step(all.findIndex(s => s.id === p.schema().id), by ?? 1, all.length);
      if (at < 0) throw new ActionRefused(`no component ${name}; components: ${all.map(s => s.id).join(", ")}`);
      if (all[at]!.id !== p.component) { p.component = all[at]!.id; p.axis = 0; p.gridAt = 0; p.filter = {}; p.cursor = { row: 0, value: 0 }; p.page = 0; p.selectedV = 0; p.reveal(); }
      return { component: p.component, title: all[at]!.title };
    },
  }),
  "library.part": def({
    summary: `show a part of the page: part=${PARTS.map(x => x.part).join(", ")} (the overview, each property's values, the grids, the whole space behind a filter)`,
    keys: "1 2 3 4, or a click on a part", touches: "screen", replay: "safe",
    args: { part: { type: "string", about: PARTS.map(x => x.part).join(", ") } },
    run({ part }, { pane }) {
      const p = libraryOf(pane), to = PARTS.find(x => x.part === part || x.key === part);
      if (!to) throw new ActionRefused(`part is ${PARTS.map(x => x.part).join(", ")}`);
      if (to.part !== p.part) { p.part = to.part; p.selectedV = 0; p.reveal(); }
      return { part: p.part };
    },
  }),
  "library.axis": def({
    summary: "one property at a time: show key=<a property> (one the component sweeps), or by=1/-1 for the next or previous; shows that part",
    keys: "← → h l in one property at a time, or a click on a property", touches: "screen", replay: "safe",
    args: { key: { type: "string", optional: true, about: "the property" }, by: { type: "number", optional: true, about: "1 the next, -1 the previous" } },
    run({ key, by }, { pane }) {
      const p = libraryOf(pane), s = p.schema();
      const at = key !== undefined ? s.sweep.indexOf(key) : step(p.axis, by ?? 1, s.sweep.length);
      if (at < 0) throw new ActionRefused(`${s.id} doesn't sweep ${key}; it sweeps ${s.sweep.join(", ")}`);
      p.part = "property"; p.axis = at; p.selectedV = 0; p.reveal();
      return { property: s.sweep[at] ?? null, values: (p.schema().props.find(x => x.key === s.sweep[at]) ? axisValues(p.schema().props.find(x => x.key === s.sweep[at])!) : []) };
    },
  }),
  "library.grid": def({
    summary: "show a two-axis grid the component marks: n=<from 1>, or by=1/-1; shows that part",
    keys: "← → h l in grids, or a click on a grid", touches: "screen", replay: "safe",
    args: { n: { type: "number", optional: true, about: "the grid, from 1" }, by: { type: "number", optional: true, about: "1 the next, -1 the previous" } },
    run({ n, by }, { pane }) {
      const p = libraryOf(pane), s = p.schema();
      if (!s.grids.length) throw new ActionRefused(`${s.id} marks no grids`);
      const at = n !== undefined ? n - 1 : step(p.gridAt, by ?? 1, s.grids.length);
      if (at < 0 || at >= s.grids.length) throw new ActionRefused(`grid is 1 to ${s.grids.length}`);
      p.part = "grid"; p.gridAt = at; p.selectedV = 0; p.reveal();
      return { grid: s.grids[at] };
    },
  }),
  "library.cursor": def({
    summary: "move the cursor among the whole space's chips: rows=±1 to the axis above or below, by=±1 to the value beside (the person's keys; an agent picks with library.pick)",
    keys: "[ ] ← → h l in every combination", touches: "screen", replay: "safe",
    args: { rows: { type: "number", optional: true, about: "1 down an axis, -1 up" }, by: { type: "number", optional: true, about: "1 right a value, -1 left" } },
    run({ rows, by }, { pane }) {
      const p = libraryOf(pane), axes = p.spaceAxes();
      if (!axes.length) throw new ActionRefused("this component's space has no axes");
      const row = step(p.cursor.row, rows ?? 0, axes.length);
      const value = step(row === p.cursor.row ? p.cursor.value : Math.min(p.cursor.value, axes[row]!.values.length - 1), by ?? 0, axes[row]!.values.length);
      p.part = "space"; p.cursor = { row, value };
      return { axis: axes[row]!.key, value: axes[row]!.values[value] };
    },
  }),
  "library.pick": def({
    summary: "every combination: pick or unpick value=<v> of axis=<key> (on=true or false, else it toggles; without them, the value at the cursor); the matching variations are drawn, a page at a time",
    keys: "space or ⏎ in every combination, or a click on a value", touches: "screen", replay: "safe", says: r => `${r.on ? "picked" : "unpicked"} ${r.axis} ${r.value} · ${r.matching} match`,
    args: { axis: { type: "string", optional: true, about: "the axis (a property of the space)" }, value: { type: "string", optional: true, about: "its value" }, on: { type: "boolean", optional: true, about: "true picks, false unpicks; else it toggles" } },
    run({ axis, value, on }, { pane }) {
      const p = libraryOf(pane), axes = p.spaceAxes();
      const row = axis === undefined ? p.cursor.row : axes.findIndex(a => a.key === axis);
      const a = axes[row];
      if (!a) throw new ActionRefused(`${p.schema().id}'s space has no axis ${axis}; its axes: ${axes.map(x => x.key).join(", ")}`);
      const v = value ?? a.values[p.cursor.value];
      const at = a.values.indexOf(v ?? "");
      if (at < 0) throw new ActionRefused(`${a.key} has no value ${value}; its values: ${a.values.join(", ")}`);
      const picked = new Set(p.filter[a.key] ?? []), now = on ?? !picked.has(v!);
      if (now) picked.add(v!); else picked.delete(v!);
      p.filter = { ...p.filter, [a.key]: a.values.filter(x => picked.has(x)) };
      if (!p.filter[a.key]!.length) delete p.filter[a.key];
      p.part = "space"; p.cursor = { row, value: at }; p.page = 0; p.selectedV = 0; p.reveal();
      return { axis: a.key, value: v, on: now, filter: p.filter, matching: spaceSize(p.schema(), p.filter).matching };
    },
  }),
  "library.clear": def({
    summary: "every combination: clear what's picked (axis=<key> clears that axis only)",
    keys: "x in every combination, or a click on x clear", touches: "screen", replay: "safe",
    args: { axis: { type: "string", optional: true, about: "only this axis" } },
    run({ axis }, { pane }) {
      const p = libraryOf(pane);
      if (axis !== undefined) { const f = { ...p.filter }; delete f[axis]; p.filter = f; } else p.filter = {};
      p.part = "space"; p.page = 0; p.selectedV = 0; p.reveal();
      return { filter: p.filter, matching: spaceSize(p.schema(), p.filter).matching };
    },
  }),
  "library.page": def({
    summary: `every combination: the next (by=1) or previous (by=-1) page of the matching variations, ${SPACE_PAGE} at a time, or n=<from 1>`,
    keys: "n p in every combination, or a click on n next or p previous", touches: "screen", replay: "safe",
    args: { by: { type: "number", optional: true, about: "1 the next page, -1 the previous" }, n: { type: "number", optional: true, about: "the page, from 1" } },
    run({ by, n }, { pane }) {
      const p = libraryOf(pane), pages = Math.max(1, Math.ceil(spaceSize(p.schema(), p.filter).matching / SPACE_PAGE));
      const to = n !== undefined ? n - 1 : p.page + (by ?? 1);
      if (to < 0 || to >= pages) throw new ActionRefused(`page is 1 to ${pages}`);
      p.part = "space"; p.page = to; p.selectedV = 0; p.reveal();
      return { page: to + 1, pages };
    },
  }),
  "library.select": def({
    summary: "select a variation drawn here: n=<from 1>, or by=1/-1 for the next or previous; it comes into view",
    keys: "j k ↓ ↑, or a click on a variation", touches: "screen", replay: "safe",
    args: { n: { type: "number", optional: true, about: "the variation, from 1" }, by: { type: "number", optional: true, about: "1 the next, -1 the previous" } },
    run({ n, by }, { pane }) {
      const p = libraryOf(pane);
      if (!p.shown.length) throw new ActionRefused("nothing is drawn here to select: pick a part with variations (2, 3 or 4)");
      const at = n !== undefined ? n - 1 : Math.max(0, Math.min(p.shown.length - 1, p.selectedV + (by ?? 1)));
      if (at < 0 || at >= p.shown.length) throw new ActionRefused(`variation is 1 to ${p.shown.length}`);
      p.selectedV = at; p.reveal();
      return { n: at + 1, values: p.shown[at]!.values };
    },
  }),
  "library.copy": def({
    summary: "copy a variation's source (n=<from 1>, else the selected one): the declaring note and the text that uses it (part=use or part=note for one); the person's goes to their clipboard, an agent's comes back as the answer",
    keys: "y, or a click on copy", touches: "nothing", replay: "safe", says: r => `copied the source of variation ${r.n}`,
    args: { n: { type: "number", optional: true, about: "the variation, from 1" }, part: { type: "string", optional: true, about: "all (default), use or note" } },
    run({ n, part }, { pane, desk }, actor) {
      const p = libraryOf(pane), { v, i } = variationAt(p, n);
      const text = part === "use" ? v.use : part === "note" ? (v.note ?? "") : variationText(v);
      if (part !== undefined && part !== "all" && part !== "use" && part !== "note") throw new ActionRefused("part is all, use or note");
      if (!text) throw new ActionRefused("this variation has no declaring note");
      p.selectedV = i;
      if (actor.kind !== "agent") desk.ctx.copy?.(text, "the library");
      return { n: i + 1, source: text };
    },
  }),
  "library.width": def({
    summary: `draw the variations at cols=${WIDTHS.join(", ")} columns (without cols, the next): the narrow fallback, a reader, a wide screen; wider than the tile is cut at its edge`,
    keys: "w, or a click on a width", touches: "screen", replay: "safe",
    args: { cols: { type: "number", optional: true, about: WIDTHS.join(", ") } },
    run({ cols }, { pane }) {
      const p = libraryOf(pane);
      const to = cols ?? WIDTHS[step(WIDTHS.indexOf(p.width as never), 1, WIDTHS.length)]!;
      if (!(WIDTHS as readonly number[]).includes(to)) throw new ActionRefused(`cols is ${WIDTHS.join(", ")}`);
      p.width = to; p.reveal();
      return { width: to };
    },
  }),
  "library.scroll": def({
    summary: "scroll the page by=<rows> (negative up)", keys: "the wheel, pgup pgdn", touches: "screen", replay: "safe",
    args: { by: { type: "number", about: "rows, negative up" } },
    run({ by }, { pane }) { const p = libraryOf(pane); p.scrollBy(by); return { by }; },
  }),
});

/** The keys of the library tile, each an action. */
function pressed(p: LibraryPane, k: Key): { action: string; args?: Record<string, unknown> } | null {
  const c = k.kind === "char" && !k.ctrl ? ch(k) : null;
  const space = p.part === "space", own = (by: number) => (p.part === "property" ? { action: "library.axis", args: { by } } : p.part === "grid" ? { action: "library.grid", args: { by } } : space ? { action: "library.cursor", args: { by } } : null);
  if (c === "," || c === ".") return { action: "library.component", args: { by: c === "." ? 1 : -1 } };
  const part = PARTS.find(x => x.key === c);
  if (part) return { action: "library.part", args: { part: part.part } };
  if (k.kind === "left" || c === "h") return own(-1);
  if (k.kind === "right" || c === "l") return own(1);
  if (k.kind === "down" || c === "j") return { action: "library.select", args: { by: 1 } };
  if (k.kind === "up" || c === "k") return { action: "library.select", args: { by: -1 } };
  if (k.kind === "pgdn" || k.kind === "pgup") return { action: "library.scroll", args: { by: (k.kind === "pgdn" ? 1 : -1) * 10 } };
  if (c === "y") return { action: "library.copy" };
  if (c === "w") return { action: "library.width" };
  if (space && (c === "[" || c === "]")) return { action: "library.cursor", args: { rows: c === "]" ? 1 : -1 } };
  if (space && (c === " " || k.kind === "enter")) return { action: "library.pick" };
  if (space && c === "x") return { action: "library.clear" };
  if (space && (c === "n" || c === "p")) return { action: "library.page", args: { by: c === "n" ? 1 : -1 } };
  return null;
}

/** The library as a tile kind: one page at a time, opened by the `library` screen. */
export const LIBRARY_KIND: TileKind = {
  kind: "library", about: "the component library: a page per component (its properties, each value drawn with its source, grids, every combination), from the component schemas",
  noun: "the library",
  // Where it opens (its component and part) is its state, as a service-drawn tile keeps its own.
  make: spec => new LibraryPane({ ...(typeof spec.state?.component === "string" ? { component: spec.state.component } : {}), ...(typeof spec.state?.part === "string" ? { part: spec.state.part } : {}) }),
  actions: LIBRARY_ACTIONS,
  press: (p, k) => pressed(p as LibraryPane, k),
  save: p => ({ state: (p as LibraryPane).spec() }),
  peek: p => ({ library: (p as LibraryPane).describe() }),
};

/** The library screen: one library tile; `component` and `part` say where it opens. */
export function librarySpec(args: Record<string, unknown> = {}): ScreenSpec {
  const component = typeof args.component === "string" ? args.component : undefined, part = typeof args.part === "string" ? args.part : undefined;
  return {
    name: "library", title: "component library", digits: false,
    layout: { focus: "library", root: { t: "leaf", kind: "library", name: "library", ...(component || part ? { state: { ...(component ? { component } : {}), ...(part ? { part } : {}) } } : {}) } },
  };
}
