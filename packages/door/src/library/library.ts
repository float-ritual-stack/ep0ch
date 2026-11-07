// The component library (PIE-618, PIE-1515): a design-system page per component, generated from its schema
// (outline-core's component-schema.ts, the service's `components.schemas`), never written per component. On the left a
// rail: the components by name under their groups, the door's one list (`ListView`, lent to `LISTVIEW_ACTIONS` as a
// `ListTile`, so j k ↑ ↓, / and an agent's own pick work as in every list), its groups and counts read from each schema's
// own `group`. Beside it the page: what the component is and where it goes, one control row (the parts and the width),
// then the part: an overview (the minimal example drawn beside its source, the properties table), one property at a
// time (each value drawn with its source), the two-axis grids the schema marks, and every combination behind a filter
// (picked per axis; the matching variations drawn a page at a time, never the whole space). Each variation is drawn by
// the readers' own renderer (src/library/draw.ts) at 40, 80 or 160 columns, and its source is copied by a click, `y` or
// `act`. Too narrow for the rail beside a readable page, the rail folds into the header (‹ name ›, `,` `.` step).
// A screen spec (`library`) of one tile kind; every key and click runs one of LIBRARY_ACTIONS or the lists' actions.
import { lineEscCloses } from "../surface/completer";
import { axisValues, componentIsLive, grid, spaceSize, spaceVariations, sweep, variation, variationText, type ComponentSchema, type SpaceFilter, type Variation } from "@ep0ch/outline-core/component-schema";
import { currentComponentId } from "@ep0ch/outline-core/note-mover-rename";
import type { ListGroup } from "@ep0ch/outline-core/list-row";
import { stringFrame } from "../canvas";
import { componentsOf } from "../component-schemas";
import type { ListSource } from "../outline-lists";
import { pressOn, RowView, scrolled, wheelRows, type RowPress } from "../scroll";
import { BOLD, C, ellipsize, fg, pad, RESET, UNBOLD, width } from "../style";
import { tabStrip } from "../surface/chip-rows";
import { filterLine } from "../surface/line";
import { LISTVIEW_ACTIONS, type ListHost } from "../surface/list-actions";
import { ListView, listRowsOf, PERSON, selectable, type ListViewRow } from "../surface/list-view";
import { Gesture, Selection, isCopyKey, rowsOf, wordAt, lineAt, paintRange, SELECT_BG, selectText, type Pos } from "../surface/selection";
import { draftPreview } from "../surface/note";
import { ActionRefused, actionSet, def } from "../surface/actions";
import { modeHint, type ModeKey } from "../surface/modes";
import { ch, type Key } from "../term";
import { wrap } from "../text";
import { runOwn, type DeskApi, type Pane, type PaneView } from "../desk/panes";
import type { ScreenSpec } from "../desk/screen-spec";
import type { KindHost, TileKind } from "../desk/tile-kinds";
import { drawingWaits, drawVariation, drawComponentProps, PROP_PLACE_WORDS } from "./draw";

/** The page's parts, each a digit. */
export const PARTS = [
  { part: "overview", key: "1", label: "overview" },
  { part: "property", key: "2", label: "one property at a time" },
  { part: "grid", key: "3", label: "grids" },
  { part: "space", key: "4", label: "every combination" },
] as const;
export type Part = (typeof PARTS)[number]["part"];
/** The keys a part adds to the page's own: the hint row is drawn from these and the page's (LIBRARY_KEYS). */
const PART_KEYS: Record<Part, readonly ModeKey[]> = {
  overview: [],
  property: [{ key: "h", action: "library.axis", args: { by: -1 }, label: "property" }, { key: "l", action: "library.axis", args: { by: 1 }, label: "property" }],
  grid: [{ key: "h", action: "library.grid", args: { by: -1 }, label: "grid" }, { key: "l", action: "library.grid", args: { by: 1 }, label: "grid" }],
  space: [
    { key: "[", action: "library.cursor", args: { rows: -1 }, label: "axis" }, { key: "]", action: "library.cursor", args: { rows: 1 }, label: "axis" },
    { key: "h", action: "library.cursor", args: { by: -1 }, label: "value" }, { key: "l", action: "library.cursor", args: { by: 1 }, label: "value" },
    { key: "space", action: "library.pick", label: "picks" }, { key: "x", action: "library.clear", label: "clears" },
    { key: "n", action: "library.page", args: { by: 1 }, label: "page" }, { key: "p", action: "library.page", args: { by: -1 }, label: "page" },
  ],
};
const COMPONENT_KEYS: readonly ModeKey[] = [{ key: ",", action: "library.component", args: { by: -1 }, label: "component" }, { key: ".", action: "library.component", args: { by: 1 }, label: "component" }];
/** The rail is a list like every other (LIST_KEYS): j k step it, ← → cross its groups, / filters it. */
const RAIL_KEYS: readonly ModeKey[] = [
  { key: "j", action: "list.step", args: { by: 1 }, label: "component" }, { key: "k", action: "list.step", args: { by: -1 }, label: "component" },
  { key: "left", action: "list.step", args: { by: -1, axis: "group" }, label: "group" }, { key: "right", action: "list.step", args: { by: 1, axis: "group" }, label: "group" },
  { key: "/", action: "list.filter", label: "filter" },
];
const LIBRARY_KEYS: readonly ModeKey[] = PARTS.map(p => ({ key: p.key, action: "library.part", args: { part: p.part }, label: "part" }));
const VARIATION_KEYS: readonly ModeKey[] = [
  { key: "J", action: "library.select", args: { by: 1 }, label: "variation" }, { key: "K", action: "library.select", args: { by: -1 }, label: "variation" },
  { key: "y", action: "library.copy", label: "copy whole source" },
  { key: "w", action: "library.width", label: "width" },
];
/** The widths a variation is drawn at: the narrow fallback, a reader, a wide screen. */
export const WIDTHS = [40, 80, 160] as const;
/** Variations of the whole space drawn at once. */
export const SPACE_PAGE = 8;
/** The rail's columns: the longest built-in name (graph-timeline) under its group, with room for a selection. */
export const RAIL_W = 26;
/** The narrowest page beside the rail (a reader's reading width); a narrower tile folds the rail into the header. */
export const PAGE_MIN = 44;
/** The narrowest source frame beside a drawing; narrower, the source goes under the drawing (about 100 columns at 40). */
const SOURCE_MIN = 34;
/** The widest the properties table is drawn: reading width, so a default stays near its name. */
const TABLE_MAX = 120;

/** A part of a row a click runs an action on. */
interface Hit { from: number; to: number; action: string; args?: Record<string, unknown> }
/** One drawn row: its text, what a click on it runs, the variation it belongs to (`vs`: the variations of a grid's row of cells). */
interface Row { text: string; hits?: Hit[]; v?: number; vs?: number[]; margin?: number; cuts?: [number, number][]; frames?: [number, number][] }

/** A row of chips (a TabRow) as a page row. */
const chipRow = (r: { text: string; hits: { from: number; to: number; action: string; args?: Record<string, unknown> }[] }): Row => ({ text: r.text, hits: r.hits.map(h => ({ ...h })) });

/** The schemas' groups in the order they first appear, each with how many it holds: the rail's headings. */
export function railGroups(all: readonly ComponentSchema[]): ListGroup[] {
  const groups = new Map<string, number>();
  for (const s of all) groups.set(s.group, (groups.get(s.group) ?? 0) + 1);
  return [...groups].map(([name, count]) => ({ name, label: name, count }));
}

/** The library: a rail of components beside one component's page, in parts, its variations drawn with their source. */
export class LibraryPane implements Pane {
  readonly kind = "library";
  /** The component shown, by id. */
  component: string;
  part: Part;
  /** The property shown one value at a time (an index into the schema's sweep), the grid shown, the width drawn at. */
  axis = 0;
  gridAt = 0;
  width: number = 80;
  /** Every variation drawn at all of WIDTHS, one under another (the narrow fallback beside what a wide screen gets). */
  allWidths = false;
  /** The values picked per axis of the whole space, the cursor among the chips (an axis row, a value), the page. */
  filter: Record<string, string[]> = {};
  cursor = { row: 0, value: 0 };
  page = 0;
  /** The variation selected, an index into what the part shows. */
  selectedV = 0;
  /** The rail: the one list, its rows the components under their groups. */
  readonly list = new ListView<ComponentSchema>("components");
  private view = new RowView();
  /** Rows PgUp PgDn scroll (RowView.page: the rows shown, less one). */
  pageStep(dir: 1 | -1) { return this.view.page(dir); }
  private desk: DeskApi | null = null;
  /** What the last paint laid out: the fixed rows, the scrolled ones. */
  private head: Row[] = [];
  /** How many of the fixed rows the last paint drew (a short tile draws fewer). */
  private headShown = 0;
  private body: Row[] = [];
  private revealNext = false;
  private gesture = new Gesture();
  private selection: Selection | null = null;
  private selecting = false;
  private drawnWidth = 0;
  private room = 0;
  private selectionPage = "";
  /** Where the page starts (the rail's columns and its rule; 0 with the rail folded), and the rail row each line holds. */
  private pageX = 0;
  private railAt: (number | null)[] = [];
  /** The page column a mouse selection started in: its frame bounds the selection (null: every frame's text, as an agent's `text=` reads it). */
  private within: number | null = null;
  /**
   * A row's bounds as the reader's selection takes them (its margin and cuts): a framed row's text is its frames'
   * insides, and a selection the mouse started keeps to the frame it started in (the drawing or the source beside it),
   * so a triple click or a drag never takes the frame beside it, the padding or the borders.
   */
  private bounds(r: Row | undefined): { margin: number; cuts: [number, number][] } {
    if (!r?.frames?.length) return { margin: r?.margin ?? 0, cuts: r?.cuts ?? [] };
    const at = this.within;
    const keep = at === null ? r.frames : [r.frames.find(([a, b]) => at >= a - 2 && at < b + 2) ?? r.frames.reduce((x, y) => (Math.abs(y[0] - at) < Math.abs(x[0] - at) ? y : x))];
    const cuts: [number, number][] = keep.slice(1).map((f, i) => [keep[i]![1], f[0]]);
    return { margin: keep[0]![0], cuts: [...cuts, [keep[keep.length - 1]![1], Infinity]] };
  }
  private selectRows() { return rowsOf(this.body.map(r => r.text), r => this.bounds(this.body[r]).margin, r => ({ cuts: this.bounds(this.body[r]).cuts })); }
  selectedText() { return this.selection?.text(this.selectRows()) ?? ""; }
  selectText(text: string) {
    const was = this.within;
    this.within = null;
    try { return selectText(this.selectRows(), text).text(this.selectRows()); } finally { this.within = was; }
  }
  private posAt(x: number, y: number): Pos | null {
    if (y < this.headShown || y >= this.headShown + this.room) return null;
    const row = this.view.top + y - this.headShown;
    return row < this.body.length ? { row, col: Math.max(0, Math.min(this.drawnWidth - 1, x)) } : null;
  }

  constructor(spec: { component?: string; part?: string } = {}) {
    this.component = spec.component ?? "heading-style";
    this.part = (PARTS.find(p => p.part === spec.part)?.part ?? "overview");
    this.list.setPick(PERSON, this.component);
  }

  private src(desk: DeskApi | null = this.desk): ListSource | null { return desk ? { board: desk.ctx.board, redraw: () => desk.redraw() } : null; }
  schemas(desk: DeskApi | null = this.desk): readonly ComponentSchema[] { return componentsOf(this.src(desk)); }
  schema(desk: DeskApi | null = this.desk): ComponentSchema { const all = this.schemas(desk); return all.find(s => s.id === this.component) ?? all[0]!; }

  /** Show component `id` (the rail follows): its page from the overview's start, nothing picked of the last one's. */
  show(id: string) {
    if (id !== this.component) { this.component = id; this.axis = 0; this.gridAt = 0; this.filter = {}; this.cursor = { row: 0, value: 0 }; this.page = 0; this.selectedV = 0; this.view.top = 0; this.reveal(); }
    this.list.setPick(PERSON, id);
  }

  /** The rail's rows from the schemas: a heading per group (with its count), the components under it, each by its id. */
  private syncRail(all: readonly ComponentSchema[]) {
    const groups = railGroups(all);
    // An extension's component is listed by its id like any other; its page's header names the extension.
    const rows: ListViewRow<ComponentSchema>[] = all.map(s => ({
      id: s.id, label: s.id, group: s.group, source: s, do: { run: { action: "library.component", args: { name: s.id } } },
    }));
    const shaped = listRowsOf<ComponentSchema>({ rows, groups });
    this.list.setAnswer(PERSON, shaped, { type: "list", rows, groups });
    return { rows: shaped, groups };
  }

  title() {
    const s = this.schema();
    return `library · ${s.id}${s.origin && s.origin !== "built-in" ? ` · ${s.origin}` : ""} · ${PARTS.find(p => p.part === this.part)!.label}`;
  }
  hint() {
    // Folded into the header, the rail's own keys come after , and . (the ones its ‹ › say).
    const keys = [...(this.pageX ? [...RAIL_KEYS, ...COMPONENT_KEYS] : [...COMPONENT_KEYS, ...RAIL_KEYS]), ...LIBRARY_KEYS, ...PART_KEYS[this.part], ...VARIATION_KEYS];
    return modeHint(keys, () => undefined) + " · drag copies text";
  }
  init(desk: DeskApi) { this.desk = desk; }
  spec(): { component: string; part: Part } { return { component: this.component, part: this.part }; }
  get holdsKeys() { return !!this.list.typing; }
  typing() { return !!this.list.typing; }
  lineField() { return this.list.typing; }
  blur() { this.list.stopTyping(true); }

  /** The rail lent to the lists' actions (`list.step`, `list.pick`, `list.filter`, `list.blocks`): the person's pick shows its page. */
  listHost(desk: DeskApi): ListHost {
    return {
      lists: () => [{ n: 1, key: "components", title: "components", view: this.list, entered: !!desk.hasFocus?.(this), about: "the component library's rail: every component by name under its group" }],
      current: () => "components",
      none: "the library lists no components",
      picked: (_l, row) => { this.show(row.id); },
      open: async (_l, row, _where, _actor, standing) => {
        if (!standing) throw new ActionRefused(`an agent shows a page with library.component name=${row.id}`);
        this.show(row.id);
        return { component: row.id };
      },
      enter: () => { throw new ActionRefused("the rail has the keys whenever the library does: j k step it, ← → its groups, / filters it"); },
      type: () => { this.list.startTyping(filterLine); desk.redraw(); },
      // The person's filter by action (the power bar's list.filter words=) moves the page as typing does.
      keep: (_l, words) => { this.list.setFilter(PERSON, words); this.followFilter(); },
      redraw: () => desk.redraw(),
    };
  }

  // ── laying the page out ────────────────────────────────────────────────

  /**
   * A variation as rows: the drawing in a frame titled by its label, its source in a frame titled "source · y copies"
   * (a click there copies it), side by side when the source frame keeps SOURCE_MIN columns beside the drawing, else
   * the source under it. The drawing is at the chosen width, cut at the frame's when the page is narrower.
   */
  private block(v: Variation, i: number, label: string, W: number, src: ListSource | null): Row[] {
    const sel = i === this.selectedV;
    const ink = sel ? fg(C.lcyan) + BOLD : fg(C.dark);
    // A chosen width wider than the page is drawn at the page's own width, and the frame says so: a 44-column page reads
    // the drawing whole, as a reader that wide would draw it, rather than cut (all widths are cut, each saying so).
    const fits = this.allWidths || this.width + 4 <= W ? this.width : Math.max(10, W - 4);
    if (fits !== this.width) label = `at ${fits} (${this.width} is wider than the page) · ${label}`;
    const want = (this.allWidths ? WIDTHS[WIDTHS.length - 1]! : fits) + 4;
    const side = want + 1 + SOURCE_MIN <= W;
    const dw = side ? want : Math.max(12, Math.min(want, W)), sw = side ? W - dw - 1 : Math.max(12, W);
    const df = stringFrame(dw, { ink }), sf = stringFrame(sw, { ink: fg(C.dark) });
    // The drawing's rows, each cut to the frame (a width wider than it says so).
    const drawn: string[] = [];
    for (const cols of this.allWidths ? WIDTHS : [fits]) {
      if (this.allWidths) drawn.push(fg(C.dark) + `${cols} columns` + RESET);
      drawn.push(...drawVariation(v, cols, src).map(l => ellipsize(l, df.inner)));
      if (cols > df.inner) drawn.push(fg(C.dark) + ellipsize(`← drawn at ${cols} columns, cut at ${df.inner} · w changes the width`, df.inner) + RESET);
    }
    if (drawingWaits(v, src)) drawn.push(fg(C.dark) + "asking the outline how the rule draws…" + RESET);
    const source: string[] = [];
    const wrapped = (line: string, tag = "") => wrap(line || " ", Math.max(8, sf.inner - width(tag))).forEach((l, j) => source.push((j || !tag ? "" : fg(C.brown) + tag) + fg(C.grey) + l + RESET));
    if (v.note) { wrapped(v.note, "note · "); source.push(fg(C.dark) + "·" + RESET); }
    for (const l of v.use.split("\n")) wrapped(l);
    const copyTitle = " source · y copies ", top = (t: string) => ` ${t} `;
    const select = (from: number, to: number): Hit => ({ from, to, action: "library.select", args: { n: i + 1 } });
    const copy = (from: number, to: number): Hit => ({ from, to, action: "library.copy", args: { n: i + 1 } });
    const out: Row[] = [];
    // A frame's glyphs and padding are never selected text: the margin and the cuts leave them out.
    if (side) {
      const n = Math.max(drawn.length, source.length);
      out.push({ text: df.top(top(label)) + " " + sf.top(copyTitle), v: i, margin: W, hits: [select(0, dw), copy(dw + 1, W)] });
      for (let j = 0; j < n; j++) out.push({ text: df.row(drawn[j] ?? "") + " " + sf.row(source[j] ?? ""), v: i, frames: [[2, dw - 2], [dw + 3, W - 2]], hits: [select(0, dw)] });
      out.push({ text: df.bottom() + " " + sf.bottom(), v: i, margin: W });
    } else {
      out.push({ text: df.top(top(label)), v: i, margin: W, hits: [select(0, dw)] });
      for (const l of drawn) out.push({ text: df.row(l), v: i, frames: [[2, dw - 2]] });
      out.push({ text: df.bottom(), v: i, margin: W });
      out.push({ text: sf.top(copyTitle), v: i, margin: W, hits: [copy(0, sw)] });
      for (const l of source) out.push({ text: sf.row(l), v: i, frames: [[2, sw - 2]] });
      out.push({ text: sf.bottom(), v: i, margin: W });
    }
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

  /** The page's header row: the component's name, group and whether it reads live; folded, the rail's ‹ name › too. */
  private headerRow(W: number, all: readonly ComponentSchema[], s: ComponentSchema, folded: boolean): Row {
    const live = componentIsLive(s) ? "live: yes" : "live: no";
    const origin = s.origin && s.origin !== "built-in" ? ` · ${s.origin}` : "";
    if (!folded) return { text: fg(C.white) + BOLD + s.id + UNBOLD + fg(C.dark) + ` · ${s.group} · ${live}${origin}` + RESET };
    const at = all.findIndex(c => c.id === s.id) + 1;
    // The rail is folded, so the filter being typed (or kept) is said here, with how many it leaves.
    const typed = this.list.typing ? this.list.typing.plain() : this.list.filter();
    const name = `‹ ${s.id} ›`, rest = typed || this.list.typing ? `  / ${typed} · ${this.list.pickable().length} of ${all.length}` : `  ${s.group} · ${at} of ${all.length}`;
    return {
      text: fg(C.lcyan) + "‹ " + fg(C.white) + BOLD + s.id + UNBOLD + fg(C.lcyan) + " ›" + fg(C.dark) + ellipsize(rest, Math.max(0, W - width(name))) + RESET,
      hits: [{ from: 0, to: 2, action: "library.component", args: { by: -1 } }, { from: width(name) - 2, to: width(name), action: "library.component", args: { by: 1 } }],
    };
  }

  /** The control row: the parts, then the widths beside them (on the next row when they don't fit). */
  private controls(W: number): Row[] {
    const parts = tabStrip(PARTS.map(p => ({ label: p.label, on: p.part === this.part, hit: { action: "library.part", args: { part: p.part } } })), { width: W, overflow: "wrap" });
    const widths = tabStrip([...WIDTHS.map(n => ({ label: String(n), on: !this.allWidths && n === this.width, hit: { action: "library.width", args: { cols: n } } })), { label: "all", on: this.allWidths, hit: { action: "library.width", args: { all: true } } }], { width: W, lead: fg(C.dark) + "width" + RESET });
    const last = parts[parts.length - 1]!, gap = 1; // the strip ends in a space of its own: two between
    const single = widths.length === 1;
    if (single && width(last.text) + gap + width(widths[0]!.text) <= W) {
      const at = width(last.text) + gap;
      return [...parts.slice(0, -1).map(chipRow), { text: last.text + RESET + " ".repeat(gap) + widths[0]!.text, hits: [...last.hits, ...widths[0]!.hits.map(h => ({ ...h, from: h.from + at, to: h.to + at }))] }];
    }
    return [...parts.map(chipRow), ...widths.map(chipRow)];
  }

  /** The fixed rows (the header) and the scrolled ones (the page), for a page `W` wide; `folded`: the rail is in the header. */
  layout(W: number, desk: DeskApi | null = this.desk, folded = false): { head: Row[]; body: Row[]; shown: Variation[] } {
    const src = this.src(desk), all = this.schemas(desk), s = this.schema(desk);
    const head: Row[] = [this.headerRow(W, all, s, folded)];
    const body: Row[] = [], shown: Variation[] = [];
    const text = (t: string, colour: number = C.grey) => wrap(t, Math.max(8, W - 2)).forEach(l => body.push({ text: fg(colour) + l + RESET }));
    const heading = (t: string) => body.push({ text: fg(C.white) + BOLD + t + UNBOLD + RESET });
    const md = (t: string) => draftPreview(t, Math.max(10, W - 1), src as never).forEach(l => body.push({ text: l }));
    // The overview reads from the top: what it is, where it goes, the controls, the example, the table. The other parts
    // are worked in: their controls stay put above the variations they choose (what it is is a 1 away).
    const fixed = this.part === "overview" ? body : head;
    if (this.part === "overview") { md(s.intro); md(`**Where:** ${s.where}.`); body.push({ text: "" }); }
    fixed.push(...this.controls(W));
    if (this.part === "overview") {
      body.push({ text: "" });
      const v = variation(s, {});
      shown.push(v);
      const values = Object.entries(v.values).map(([k, x]) => `${k}: ${x}`).join(" · ");
      body.push(...this.block(v, 0, values ? `drawn · ${values}` : "drawn", W, src));
      heading("properties");
      // The one properties table (::graph-props, PIE-1032), at reading width: an action's page draws its arguments with it too.
      drawComponentProps(s, Math.max(20, Math.min(TABLE_MAX, W - 1))).forEach(l => body.push({ text: l }));
    } else if (this.part === "property") {
      const axis = s.sweep[Math.min(this.axis, s.sweep.length - 1)];
      head.push(...tabStrip(s.sweep.map(k => ({ label: k, on: k === axis, hit: { action: "library.axis", args: { key: k } } })), { width: W, overflow: "wrap" }).map(chipRow));
      const p = s.props.find(x => x.key === axis);
      if (!axis || !p) text("this component marks no property to show one value at a time", C.dark);
      else {
        head.push({ text: fg(C.dark) + ellipsize(`${PROP_PLACE_WORDS[p.where]} · ${p.meaning}`, W) + RESET });
        sweep(s, axis).forEach(v => { body.push(...this.block(v, shown.length, this.labelOf(s, v, [axis], true), W, src)); shown.push(v); });
      }
    } else if (this.part === "grid") {
      const g = s.grids[Math.min(this.gridAt, s.grids.length - 1)];
      head.push(...tabStrip(s.grids.map(([a, b], i) => ({ label: `${a} × ${b}`, on: i === Math.min(this.gridAt, s.grids.length - 1), hit: { action: "library.grid", args: { n: i + 1 } } })), { width: W, overflow: "wrap" }).map(chipRow));
      if (!g) text("this component marks no two properties to draw as a grid", C.dark);
      else {
        const [a, b] = g, laid = grid(s, a, b);
        // Side by side when the row's cells fit at the width drawn, else one under another.
        const per = laid.rows[0]?.cells.length ?? 1, cellW = this.width + 6, side = !this.allWidths && per * cellW <= W;
        for (const row of laid.rows) {
          if (body.length) body.push({ text: "" });
          heading(`${a}: ${row.value}`);
          if (!side) { for (const c of row.cells) { body.push(...this.block(c, shown.length, this.labelOf(s, c, [b]), W, src)); shown.push(c); } continue; }
          const blocks = row.cells.map(c => { const r = this.block(c, shown.length, this.labelOf(s, c, [b]), cellW - 2, src); shown.push(c); return r; });
          const tall = Math.max(...blocks.map(x => x.length));
          for (let j = 0; j < tall; j++) {
            let t = "", hits: Hit[] = [];
            const frames: [number, number][] = [];
            const vs: number[] = [];
            blocks.forEach((rows, k) => {
              const r = rows[j], x0 = k * cellW;
              // Each cell's frames, moved to where the cell sits: only their insides are selected text.
              for (const [f, e] of r?.frames ?? []) frames.push([x0 + f, x0 + e]);
              t += pad(r?.text ?? "", cellW - 2) + RESET + "  ";
              hits = hits.concat((r?.hits ?? []).map(h => ({ ...h, from: h.from + x0, to: h.to + x0 })));
              // A click anywhere on a cell's drawing or source selects it, as on a variation one under another.
              if (r?.v !== undefined) { vs.push(r.v); hits.push({ from: x0, to: x0 + cellW - 2, action: "library.select", args: { n: r.v + 1 } }); }
            });
            body.push({ text: t, hits, vs, ...(frames.length ? { frames } : { margin: W }) });
          }
        }
      }
    } else {
      const axes = this.spaceAxes(s);
      const lw = Math.min(20, Math.max(0, ...axes.map(a => width(a.key))));
      axes.forEach((a, r) => {
        const picked = this.filter[a.key] ?? [];
        const lead = (r === this.cursor.row ? fg(C.white) + "› " : "  ") + fg(C.lcyan) + pad(a.key, lw) + RESET + " ";
        head.push(...tabStrip(a.values.map((v, j) => ({ label: v, on: picked.includes(v), cursor: r === this.cursor.row && j === this.cursor.value, hit: { action: "library.pick", args: { axis: a.key, value: v } } })), { width: W, lead: lead }).map(chipRow));
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
      page.forEach(v => { body.push(...this.block(v, shown.length, this.labelOf(s, v, s.space), W, src)); shown.push(v); });
    }
    if (this.part !== "overview") head.push({ text: fg(C.dark) + "─".repeat(Math.max(0, W)) + RESET });
    return { head, body, shown };
  }

  /** Whether a tile `w` wide draws the rail beside the page (else it folds into the header). */
  static railBeside(w: number) { return w - RAIL_W - 1 >= PAGE_MIN; }

  render(w: number, h: number, focused: boolean, desk: DeskApi): PaneView {
    this.desk = desk;
    const all = this.schemas(desk), beside = LibraryPane.railBeside(w);
    const rail = this.syncRail(all);
    this.pageX = beside ? RAIL_W + 1 : 0;
    const pw = w - this.pageX;
    const laid = this.layout(pw, desk, !beside);
    const page = JSON.stringify([w, this.component, this.part, this.axis, this.gridAt, this.filter, this.page, this.width, this.allWidths]);
    if (page !== this.selectionPage) { this.selection = null; this.gesture.cancel(); this.selectionPage = page; }
    this.drawnWidth = pw;
    this.head = laid.head; this.body = laid.body;
    if (this.selectedV >= laid.shown.length) this.selectedV = Math.max(0, laid.shown.length - 1);
    const headRows = this.head.slice(0, Math.max(0, Math.min(this.head.length, h - 3)));
    this.headShown = headRows.length;
    const room = this.room = Math.max(0, h - this.headShown);
    // The selected variation comes into view when it changes; on the overview the page keeps its top (its intro).
    const rows = this.part === "overview" ? [] : this.body.map((r, i) => (r.v === this.selectedV || r.vs?.includes(this.selectedV) ? i : -1)).filter(i => i >= 0);
    const sel = rows.length ? [rows[0]!, rows[rows.length - 1]!] as const : null;
    if (this.revealNext) { this.view.reveal(); this.revealNext = false; }
    const top = this.view.place(sel ? this.selectedV : null, this.body.length, room, sel);
    const pageLines = [...headRows.map(r => pad(r.text, pw) + RESET), ...this.body.slice(top, top + room).map((r, i) => {
      const line = pad(r.text, pw) + RESET, span = this.selection?.span(top + i);
      if (!span) return line;
      // Lit only inside the bounds the copy takes: the frame it started in, never the one beside it.
      const b = this.bounds(r);
      return paintRange(line, Math.max(b.margin, span[0]), Math.min(span[1], b.cuts[0]?.[0] ?? Infinity), SELECT_BG);
    })];
    if (!beside) { this.railAt = []; return { lines: pageLines, scroll: { top, total: this.body.length, room } }; }
    // The rail: its count (or the filter being typed, which the list draws itself), the list, the keys under it.
    const foot = h >= 12 ? [fg(C.dark) + "j k component" + RESET, fg(C.dark) + "←→ group" + RESET] : [];
    // The rows under the list: the keys, and a blank row above them.
    const below = foot.length ? foot.length + 1 : 0;
    const filtered = this.list.filter() || this.list.typing;
    const count = filtered ? `${this.list.pickable().length} of ${all.length}` : `${all.length} components`;
    const railHead = fg(C.dark) + ellipsize(`${count} · / filter`, RAIL_W) + RESET;
    const drawn = this.list.draw({ primitive: { type: "list", rows: rail.rows, groups: rail.groups }, cols: RAIL_W, lines: 1, room: Math.max(1, h - 1 - below), focused, selection: true, empty: "no component matches" });
    const railLines = [railHead, ...drawn.lines];
    this.railAt = [null, ...drawn.rowAt];
    while (railLines.length < h - foot.length) railLines.push("");
    railLines.push(...foot);
    const rule = fg(C.dark) + "│" + RESET;
    const lines = Array.from({ length: Math.max(h, pageLines.length) }, (_, i) => pad(railLines[i] ?? "", RAIL_W) + RESET + rule + (pageLines[i] ?? ""));
    return { lines: lines.slice(0, h), scroll: { top, total: this.body.length, room } };
  }

  /** The row a click at `y` is on, and what a click there at `x` runs (page columns). */
  private hitAt(x: number, y: number): Hit | null {
    const row = y < this.headShown ? this.head[y] : this.body[this.view.top + y - this.headShown];
    return row?.hits?.find(h => x >= h.from && x < h.to) ?? (row?.v !== undefined ? { from: 0, to: 0, action: "library.select", args: { n: row.v + 1 } } : null);
  }

  /** A press on the rail: a component row is picked (its page shown), a second click opens it, the count starts the filter. */
  private railMouse(k: Extract<Key, { kind: "mouse" }>, y: number, desk: DeskApi, press?: RowPress) {
    if (k.action === "wheel-up" || k.action === "wheel-down") {
      if (this.list.pickable().length) runOwn(LISTVIEW_ACTIONS, "list.step", { by: k.action === "wheel-up" ? -1 : 1 }, { pane: this, desk });
      return;
    }
    if (k.action !== "down" || (k.button ?? 0) !== 0) return;
    if (y === 0) { runOwn(LISTVIEW_ACTIONS, "list.filter", {}, { pane: this, desk }); return; }
    const i = this.railAt[y];
    const row = i === null || i === undefined ? undefined : this.list.visible()[i];
    if (!row || !selectable(row)) return;
    const gesture = this.list.press(i!, pressOn(k, press, this.list.pickedId() === row.id));
    runOwn(LISTVIEW_ACTIONS, gesture === "open" || gesture === "fresh" ? "list.open" : "list.pick", { id: row.id }, { pane: this, desk });
  }

  /** A press (its kind has keys of its own, so the desk hands it the mouse): what the click lands on runs. */
  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, desk: DeskApi, press?: RowPress): boolean {
    const drag = k.action === "drag" || k.action === "up";
    if (this.pageX && x < this.pageX - 1 && !(drag && this.gesture.pressed)) { this.railMouse(k, y, desk, press); desk.redraw(); return true; }
    x -= this.pageX;
    if (k.action.startsWith("wheel")) { this.wheel(k.action === "wheel-up" ? -1 : 1, desk); return true; }
    if ((k.button ?? 0) !== 0) return false;
    if (k.action === "down") {
      if (x < 0) return true;
      const n = this.gesture.press(x, y);
      if (n === 1) this.within = x;
      const at = this.posAt(x, y);
      this.selecting = false;
      if (n === 1) this.selection = null;
      if (at && n > 1) this.selection = n === 2 ? wordAt(this.selectRows(), at) : lineAt(this.selectRows(), at.row);
    } else if (k.action === "drag") {
      const g = this.gesture.pressed;
      if (g && this.gesture.drag(x, y)) {
        const from = g.n > 1 && this.selection ? this.selection.start : this.posAt(g.x, g.y);
        const to = this.posAt(Math.max(0, x), y);
        if (from && to) {
          if (!this.selecting) { this.selection = new Selection(from, from); this.selecting = true; }
          this.selection!.head = to;
        }
      }
    } else if (k.action === "up") {
      const r = this.gesture.release(x, y);
      if (r.click) { this.selection = null; this.click(x, y, desk); }
      else if (r.copy && this.selectedText().trim()) void desk.press?.(this, LIBRARY_ACTIONS, "library.copy", { part: "selection" });
    }
    desk.redraw();
    return true;
  }

  click(x: number, y: number, desk: DeskApi) {
    const hit = this.hitAt(x, y);
    if (hit) {
      if (hit.action !== "library.select") this.gesture.forget();
      void desk.press?.(this, LIBRARY_ACTIONS, hit.action, hit.args ?? {});
    }
  }
  wheel(dir: 1 | -1, desk: DeskApi) { void desk.press?.(this, LIBRARY_ACTIONS, "library.scroll", { by: wheelRows(dir) }); }
  /** Esc takes back the filter being typed (esc-rule.ts). */
  escCloses() { return this.list.typing ? lineEscCloses(this.list.typing, "the filter") : undefined; }
  /** The person typing the rail's filter: letters narrow it as they're typed, ⏎ keeps them, esc goes back. */
  key(k: Key, desk: DeskApi): boolean {
    if (!this.list.typing) return false;
    if (k.kind === "enter" || k.kind === "esc") this.list.stopTyping(k.kind === "enter");
    else if (!this.list.typing.take(k)) return k.kind !== "tab" && k.kind !== "backtab";
    this.followFilter();
    desk.redraw();
    return true;
  }

  /** The person's filter changed: the page shows the component the rail has picked among what it leaves, so `y` copies what's shown. */
  private followFilter() {
    const first = this.list.picked();
    if (first && first.id !== this.component) this.show(first.id);
  }

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
      component: s.id, title: s.title, group: s.group, origin: s.origin ?? "built-in", part: this.part, width: this.allWidths ? "all" : this.width,
      components: this.schemas().map(c => c.id),
      rail: { beside: this.pageX > 0, groups: railGroups(this.schemas()).map(g => ({ group: g.name, count: g.count })), ...(this.list.filter() ? { filter: this.list.filter(), matching: this.list.pickable().map(r => r.id) } : {}) },
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
/** A whole number an action's argument must be (a place in a list, a step), else refused naming it. */
function whole<T extends number | undefined>(name: string, v: T): T {
  if (v !== undefined && !Number.isInteger(v)) throw new ActionRefused(`${name} is a whole number, not ${v}`);
  return v;
}
/** `by` steps through `n` choices from `at`, wrapping. */
const step = (at: number, by: number, n: number) => (n ? (((at + by) % n) + n) % n : 0);

/** What the library does: the keys, a click and `act` call the same actions. */
export const LIBRARY_ACTIONS = actionSet<KindHost>()("library", {
  "library.component": def({
    summary: "show a component's page: name=<its id> (heading-style, callout, rule, graph-stat, box, an extension's: library --brief lists them), or by=1/-1 for the next or previous",
    keys: ", . or a click on ‹ › when the rail is folded into the header (the rail's j k ↑ ↓ and clicks are list.step and list.pick)", touches: "screen", replay: "safe", says: r => `showed the ${r.title} page`,
    args: { name: { type: "string", optional: true, about: "the component's id" }, by: { type: "number", optional: true, about: "1 the next, -1 the previous" } },
    examples: [
      { act: "library.component name=callout tile=library", does: "shows the callout component's page" },
      { act: "library.component by=1 tile=library", does: "shows the next component's page" },
    ],
    run({ name, by }, { pane }) {
      whole("by", by);
      const p = libraryOf(pane), all = p.schemas();
      const at = name !== undefined ? all.findIndex(s => s.id === currentComponentId(name)) : step(all.findIndex(s => s.id === p.schema().id), by ?? 1, all.length);
      if (at < 0) throw new ActionRefused(`no component ${name}; components: ${all.map(s => s.id).join(", ")}`);
      p.show(all[at]!.id);
      return { component: p.component, title: all[at]!.title, group: all[at]!.group };
    },
  }),
  "library.part": def({
    summary: `show a part of the page: part=${PARTS.map(x => x.part).join(", ")} (the overview, each property's values, the grids, the whole space behind a filter)`,
    keys: "1 2 3 4, or a click on a part", touches: "screen", replay: "safe",
    args: { part: { type: "string", about: PARTS.map(x => x.part).join(", ") } },
    examples: [
      { act: "library.part part=overview tile=library", does: "shows the page's overview" },
      { act: "library.part part=space tile=library", does: "shows every combination of the component's picked values" },
    ],
    run({ part }, { pane }) {
      const p = libraryOf(pane), to = PARTS.find(x => x.part === part || x.key === part);
      if (!to) throw new ActionRefused(`part is ${PARTS.map(x => x.part).join(", ")}`);
      if (to.part !== p.part) { p.part = to.part; p.selectedV = 0; p.reveal(); }
      return { part: p.part };
    },
  }),
  "library.axis": def({
    summary: "one property at a time: show key=<a property> (one the component sweeps), or by=1/-1 for the next or previous; shows that part",
    keys: "h l in one property at a time, or a click on a property", touches: "screen", replay: "safe",
    args: { key: { type: "string", optional: true, about: "the property" }, by: { type: "number", optional: true, about: "1 the next, -1 the previous" } },
    examples: [
      { act: "library.axis key=fold tile=library", does: "shows the fold property and its values on the callout page" },
      { act: "library.axis by=1 tile=library", does: "shows the next property the component sweeps" },
    ],
    run({ key, by }, { pane }) {
      whole("by", by);
      const p = libraryOf(pane), s = p.schema();
      const at = key !== undefined ? s.sweep.indexOf(key) : step(p.axis, by ?? 1, s.sweep.length);
      if (at < 0) throw new ActionRefused(`${s.id} doesn't sweep ${key}; it sweeps ${s.sweep.join(", ")}`);
      p.part = "property"; p.axis = at; p.selectedV = 0; p.reveal();
      return { property: s.sweep[at] ?? null, values: (p.schema().props.find(x => x.key === s.sweep[at]) ? axisValues(p.schema().props.find(x => x.key === s.sweep[at])!) : []) };
    },
  }),
  "library.grid": def({
    summary: "show a two-axis grid the component marks: n=<from 1>, or by=1/-1; shows that part",
    keys: "h l in grids, or a click on a grid", touches: "screen", replay: "safe",
    args: { n: { type: "number", optional: true, about: "the grid, from 1" }, by: { type: "number", optional: true, about: "1 the next, -1 the previous" } },
    examples: [
      { act: "library.grid n=1 tile=library", does: "shows the component's first two-axis grid" },
      { act: "library.grid by=-1 tile=library", does: "shows the previous grid" },
    ],
    run({ n, by }, { pane }) {
      whole("n", n); whole("by", by);
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
    keys: "[ ] h l in every combination", touches: "screen", replay: "safe",
    args: { rows: { type: "number", optional: true, about: "1 down an axis, -1 up" }, by: { type: "number", optional: true, about: "1 right a value, -1 left" } },
    examples: [
      { act: "library.cursor rows=1 tile=library", does: "moves the cursor to the axis below" },
      { act: "library.cursor by=1 tile=library", does: "moves the cursor to the value on its right" },
    ],
    run({ rows, by }, { pane }) {
      whole("rows", rows); whole("by", by);
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
    examples: [
      { act: "library.pick axis=callout value=tip on=true tile=library", does: "picks tip on the callout axis and draws the matching variations" },
      { act: "library.pick axis=fold value=- tile=library", does: "toggles the folded value of fold in the picked set" },
    ],
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
    examples: [
      { act: "library.clear tile=library", does: "clears every picked value" },
      { act: "library.clear axis=fold tile=library", does: "clears the picks on the fold axis only" },
    ],
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
    examples: [
      { act: "library.page by=1 tile=library", does: "draws the next page of matching variations" },
      { act: "library.page n=1 tile=library", does: "returns to the first page of variations" },
    ],
    run({ by, n }, { pane }) {
      whole("by", by); whole("n", n);
      const p = libraryOf(pane), pages = Math.max(1, Math.ceil(spaceSize(p.schema(), p.filter).matching / SPACE_PAGE));
      const to = n !== undefined ? n - 1 : p.page + (by ?? 1);
      if (to < 0 || to >= pages) throw new ActionRefused(`page is 1 to ${pages}`);
      p.part = "space"; p.page = to; p.selectedV = 0; p.reveal();
      return { page: to + 1, pages };
    },
  }),
  "library.select": def({
    summary: "select a variation: n=<from 1> or by=1/-1; text= returns matching drawn words without changing the person's selection or clipboard",
    keys: [{ keys: "J K", does: "select a variation" }, { keys: "click", does: "on a variation" }, { keys: "drag", does: "select text" }, { keys: "double-click", does: "select text (a triple click too)" }], touches: "screen", touchesWith: args => args.text !== undefined ? "nothing" : "screen", replay: "safe",
    args: { text: { type: "string", optional: true, about: "words as drawn; returns them without changing the person's selection or clipboard" }, n: { type: "number", optional: true, about: "the variation, from 1" }, by: { type: "number", optional: true, about: "1 the next, -1 the previous" } },
    examples: [
      { act: "library.select n=3 tile=library", does: "selects the third variation drawn and brings it into view" },
      { act: "library.select by=1 tile=library", does: "selects the next variation" },
    ],
    run({ n, by, text }, { pane }) {
      whole("n", n); whole("by", by);
      const p = libraryOf(pane);
      if (text !== undefined) return { text: p.selectText(text) };
      if (!p.shown.length) throw new ActionRefused("nothing is drawn here to select: pick a part with variations (2, 3 or 4)");
      const at = n !== undefined ? n - 1 : Math.max(0, Math.min(p.shown.length - 1, p.selectedV + (by ?? 1)));
      if (at < 0 || at >= p.shown.length) throw new ActionRefused(`variation is 1 to ${p.shown.length}`);
      p.selectedV = at; p.reveal();
      return { n: at + 1, values: p.shown[at]!.values };
    },
  }),
  "library.copy": def({
    summary: "copy a variation's source (n=<from 1>, else the selected one): the declaring note and the text that uses it (part=use or part=note for one); the person's goes to their clipboard, an agent's comes back as the answer",
    keys: "y or a click on a source frame's title for the whole source; drag release or cmd+c for selected text", touches: "nothing", replay: "safe", says: r => "text" in r ? `copied ${r.text.length} chars` : `copied the source of variation ${r.n}`,
    personWith: a => (a.part === "selection" ? "the person's selection is theirs: an agent names the words with library.select text=" : null),
    args: { n: { type: "number", optional: true, about: "the variation, from 1" }, part: { type: "string", optional: true, about: "all (default), use, note or selection" } },
    examples: [
      { act: "library.copy n=2 tile=library", does: "gives back the declaring note and text of the second variation" },
      { act: "library.copy part=use tile=library", does: "gives back only the text that uses the selected variation" },
    ],
    run({ n, part }, { pane, desk }, actor) {
      whole("n", n);
      const p = libraryOf(pane);
      if (part === "selection") {
        const text = p.selectedText();
        if (!text.trim()) throw new ActionRefused("nothing selected: drag over the example first");
        if (desk.ctx.copy?.(text, "the library") === false) throw new ActionRefused("the selection is more than the clipboard takes");
        return { text };
      }
      const { v, i } = variationAt(p, n);
      const text = part === "use" ? v.use : part === "note" ? (v.note ?? "") : variationText(v);
      if (part !== undefined && part !== "all" && part !== "use" && part !== "note") throw new ActionRefused("part is all, use, note or selection");
      if (!text) throw new ActionRefused("this variation has no declaring note");
      // The person's copy selects what they copied; an agent's changes nothing of theirs (not what their next y copies).
      if (actor.kind !== "agent") { p.selectedV = i; desk.ctx.copy?.(text, "the library"); }
      return { n: i + 1, source: text };
    },
  }),
  "library.width": def({
    words: "draw the library at a chosen width",
    summary: `draw the variations at cols=${WIDTHS.join(", ")} columns, or all=true at every one of them one under another (without either, the next of these): the narrow fallback, a reader, a wide screen; wider than the tile is cut at its edge`,
    keys: "w, or a click on a width", touches: "screen", replay: "safe",
    args: { cols: { type: "number", optional: true, about: WIDTHS.join(", ") }, all: { type: "boolean", optional: true, about: "draw at every width" } },
    examples: [
      { act: "library.width cols=40 tile=library", does: "draws the variations at 40 columns" },
      { act: "library.width all=true tile=library", does: "draws the variations at every width, one under another" },
    ],
    run({ cols, all }, { pane }) {
      const p = libraryOf(pane);
      if (cols !== undefined && all) throw new ActionRefused("give cols or all, not both");
      if (cols !== undefined && !(WIDTHS as readonly number[]).includes(cols)) throw new ActionRefused(`cols is ${WIDTHS.join(", ")}`);
      // The cycle: each width, then all of them, then round again.
      const at = p.allWidths ? WIDTHS.length : WIDTHS.indexOf(p.width as never);
      const next = step(at, 1, WIDTHS.length + 1);
      if (all || (cols === undefined && next === WIDTHS.length)) { p.allWidths = true; p.reveal(); return { width: "all" }; }
      const to = cols ?? WIDTHS[next]!;
      p.allWidths = false; p.width = to; p.reveal();
      return { width: to };
    },
  }),
  "library.scroll": def({
    words: "scroll the page",
    summary: "scroll the page by=<rows> (negative up)", keys: [{ keys: "wheel", does: "scroll the page" }, { keys: "pgup pgdn", does: "scroll the page" }], touches: "screen", replay: "safe",
    args: { by: { type: "number", about: "rows, negative up" } },
    examples: [
      { act: "library.scroll by=15 tile=library", does: "scrolls the page down fifteen rows" },
      { act: "library.scroll by=-15 tile=library", does: "scrolls the page up fifteen rows" },
    ],
    run({ by }, { pane }) { whole("by", by); const p = libraryOf(pane); p.scrollBy(by); return { by }; },
  }),
});

/** The keys of the library tile, each an action: the rail's are the lists' own (j k ↑ ↓, ← → its groups, Home End, /). */
function pressed(p: LibraryPane, k: Key): { action: string; args?: Record<string, unknown> } | null {
  const c = k.kind === "char" && !k.ctrl ? ch(k) : null;
  const space = p.part === "space", own = (by: number) => (p.part === "property" ? { action: "library.axis", args: { by } } : p.part === "grid" ? { action: "library.grid", args: { by } } : space ? { action: "library.cursor", args: { by } } : null);
  if (c === "," || c === ".") return { action: "library.component", args: { by: c === "." ? 1 : -1 } };
  // The rail is a list like every other: j k ↓ ↑ step it (LIST_KEYS), so a variation is J K.
  if (k.kind === "down" || k.kind === "up" || c === "j" || c === "k") return { action: "list.step", args: { by: k.kind === "down" || c === "j" ? 1 : -1 } };
  if (k.kind === "left" || k.kind === "right") return { action: "list.step", args: { by: k.kind === "right" ? 1 : -1, axis: "group" } };
  if (k.kind === "home") return { action: "list.pick", args: { n: 1 } };
  if (k.kind === "end") return { action: "list.pick", args: { n: Math.max(1, p.list.pickable().length) } };
  if (c === "/") return { action: "list.filter" };
  const part = PARTS.find(x => x.key === c);
  if (part) return { action: "library.part", args: { part: part.part } };
  if (c === "h") return own(-1);
  if (c === "l") return own(1);
  if (c === "J") return { action: "library.select", args: { by: 1 } };
  if (c === "K") return { action: "library.select", args: { by: -1 } };
  if (k.kind === "pgdn" || k.kind === "pgup") return { action: "library.scroll", args: { by: p.pageStep(k.kind === "pgdn" ? 1 : -1) } };
  if (c === "y") return { action: "library.copy" };
  if (isCopyKey(k)) return { action: "library.copy", args: { part: "selection" } };
  if (c === "w") return { action: "library.width" };
  if (space && (c === "[" || c === "]")) return { action: "library.cursor", args: { rows: c === "]" ? 1 : -1 } };
  if (space && (c === " " || k.kind === "enter")) return { action: "library.pick" };
  if (space && c === "x") return { action: "library.clear" };
  if (space && (c === "n" || c === "p")) return { action: "library.page", args: { by: c === "n" ? 1 : -1 } };
  return null;
}

/** The library as a tile kind: one page at a time, opened by the `library` screen. */
export const LIBRARY_KIND: TileKind = {
  kind: "library", about: "the component library: a rail of components by group beside a page per component (its properties, each value drawn with its source, grids, every combination), from the component schemas",
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
