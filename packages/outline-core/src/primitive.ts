// The primitive catalogue: what a rich component's view is composed from, and what a page's parts are drawn as. A
// view is a tree of these, every client draws the same ones (the door's `primitiveLines`, a page's HTML, the native
// window's `PRIMS`), and a new component needs no client code. The service checks a view against the field lists here
// (outliner component-primitives.ts) and renders the text targets; this file is the shapes alone. Pure: no I/O.
import type { ListCell, ListPrimitive } from "./list-row";
import type { Align, BandPattern } from "./rules";

export const PRIMITIVE_TYPES = ["text", "blockdown", "badge", "stat", "bar", "table", "checklist", "sparkline", "card", "box", "stack", "row", "band", "track", "image", "button", "list"] as const;
/** The fields each primitive accepts besides `type` (anything else is refused): the one list the validator checks and the scripts reference prints. */
export const PRIMITIVE_FIELDS = {
  text: ["text", "tone", "strong", "act", "link", "revision"],
  blockdown: ["text"],
  badge: ["label", "tone", "act"],
  button: ["label", "act", "tone"],
  stat: ["label", "value", "unit", "tone"],
  bar: ["label", "value", "max", "tone"],
  table: ["columns", "rows", "links", "acts"],
  checklist: ["items"],
  sparkline: ["label", "values"],
  card: ["title", "subtitle", "badge", "link", "act", "children"],
  box: ["title", "children"],
  stack: ["children"],
  row: ["children", "minWidth"],
  band: ["text", "level", "style", "pattern", "align", "row", "tone"],
  track: ["style", "pattern", "tone"],
  image: ["src", "svg", "alt", "size", "fit", "height", "caption"],
  list: ["rows", "groups", "preview", "filter", "enter", "empty", "arrange", "size", "columns", "headers", "page", "title"],
} as const satisfies Record<typeof PRIMITIVE_TYPES[number], readonly string[]>;

export const TONES = ["default", "good", "warn", "bad", "dim", "accent"] as const;
/** A table cell: plain text or a number, or one that presses an action line or opens a note on its own (PIE-1461). */
export type TableCell = ListCell;
export type Tone = typeof TONES[number];

/**
 * What a press runs (PIE-957, PIE-981): an action line as the power bar and `ep0ch act` take it, `<action> key=value …`.
 * Its head is an action the door has (`layout.load`) or a script's name (`ttt-move`), which runs as the script; the
 * words are its slots. The door runs it through its one dispatcher as the person; every other client draws the
 * primitive as it is without it, so a page or an export never gains a write.
 */
export type ActionLine = string;

export type Primitive =
  | ({ type: "text"; strong?: boolean } & Extract<TableCell, object>)
  /**
   * Blockdown a client draws with its own reader (the door's note surface, Detail's, the publisher's HTML), so its
   * headings, lists, links and properties read as they do in a note. A text target gets the source as written.
   */
  | { type: "blockdown"; text: string }
  | { type: "badge"; label: string; tone?: Tone; act?: ActionLine }
  /** A button (PIE-957): a labelled press, drawn in the control row an extension line's controls are. */
  | { type: "button"; label: string; act: ActionLine; tone?: Tone }
  | { type: "stat"; label: string; value: string | number; unit?: string; tone?: Tone }
  | { type: "bar"; label: string; value: number; max: number; tone?: Tone }
  /**
   * `links`: a block id or a Resource ref (`file:`, `web:`, `resource:`) per row (or null) that a client opens on Enter or a click.
   * `acts`: an action line to press per row (or null), in place of its link.
   * A cell is text or a number, or `{ text, act?, link?, tone? }`: a cell of its own that presses or opens (PIE-1461), so one
   * row can open its note from the title and change a property from another column.
   */
  | { type: "table"; columns: string[]; rows: TableCell[][]; links?: (string | null)[]; acts?: (ActionLine | null)[] }
  | { type: "checklist"; items: { label: string; done: boolean }[] }
  | { type: "sparkline"; label?: string; values: number[] }
  | { type: "card"; title: string; subtitle?: string; badge?: { label: string; tone?: Tone }; link?: string; act?: ActionLine; children?: Primitive[] }
  | { type: "box"; title?: string; children: Primitive[] }
  | { type: "stack"; children: Primitive[] }
  /**
   * Side by side. `minWidth`: the narrowest a child may be, in characters (terminal cells; `ch` on the web); where
   * the reader can't give each child that much, the row stacks them, one under the other. Default 12.
   */
  | { type: "row"; children: Primitive[]; minWidth?: number }
  /**
   * A heading in a band of glyph tracks (PIE-599's banner, PIE-600's heading style): three rows, the text on `row`
   * (top, middle or bottom), aligned. `level` is the heading it stands for (a text target draws `#`, `##`, `###`).
   */
  | { type: "band"; text?: string; level?: 1 | 2 | 3; style?: string; pattern?: BandPattern; align?: Align; row?: "top" | "middle" | "bottom"; tone?: Tone }
  /** One row of glyph track: a hard divider. `style`: a heading style by name (PIE-599), drawn with it where a client can. */
  | { type: "track"; style?: string; pattern?: BandPattern; tone?: Tone }
  /**
   * A picture (PIE-827), drawn as each client draws a note's `[img::]` line (outline-core's imagePrimitiveSpec): the
   * door's graphics, dimmed dark-first; a page's served image, when the publish roots allow the file; elsewhere its alt
   * text and file. `src`: a path or a `file:` Resource ref; `size` as `[size::]` (cells, `N%`, `full`); `height` in rows;
   * `caption: false` (PIE-839): the picture alone where it's drawn (a card's cover), its caption only where it isn't.
   * `svg` in place of `src` (PIE-1555): the picture's own markup, a render script's drawing (its text laid out, its
   * `<a href>` links), drawn by the door as an SVG file is; a text or a page target says it with its alt text.
   */
  | { type: "image"; src?: string; svg?: string; alt?: string; size?: string; fit?: "cover" | "contain"; height?: number; caption?: boolean }
  /**
   * A selectable, filterable list with a preview (PIE-747, ADR 0004 contract 3): rows with one activation each, drawn
   * by every client (the door's one ListView, Detail as text, a page as `<ul>`). The viewer's selection, filter and
   * whether they are in it are theirs: never written, never sent. The rows' shape is outline-core's (`list-row.ts`).
   */
  | ListPrimitive;
