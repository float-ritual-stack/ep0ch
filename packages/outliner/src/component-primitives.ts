import { actRequestOf, lineWords } from "@ep0ch/outline-core/action-line";
import { viewToneAsButton, type ButtonLookWords } from "@ep0ch/outline-core/button-call";
import { cleanExtensionText, inertBlockdown } from "./extension-records";
import { ALIGNS, BAND_PATTERNS, type Align, type BandPattern } from "@ep0ch/outline-core/rules";
import { HEADING_STYLE_NAME } from "@ep0ch/outline-core/heading-styles";
import { isResourceRef, parseResourceRef } from "@ep0ch/outline-core/resource-ref";
import { fileName, imageSource, parseSize } from "@ep0ch/outline-core/media-line";
import { safeExtensionHtml } from "./extension-html";
import { ACTIVATION_KINDS, LIST_MAX_ROWS, LIST_PREVIEWS, activationCount, listHead, listSections, listCellText, openedRef, type ListCell, type ListGroup, type ListPrimitive, type ListRow } from "@ep0ch/outline-core/list-row";

/**
 * The shared primitive catalogue a rich component (kind 3 of the extension
 * design) is composed from, and its render targets.
 *
 * A component is headless: its **data** is the truth, and its **view** is a
 * tree of primitives every client already knows how to draw (box, card,
 * table, stat, bar, checklist, sparkline, badge, text, image, with stack and row to
 * arrange them, and band and track for headings and dividers, PIE-600). So a new component needs no client code. The service renders
 * the text targets here (markdown, blockdown, html, json, csv and a plain
 * `terminal` text); a client that draws primitives natively (the door) takes
 * `view` instead.
 *
 * Fallback chain, for one target:
 *   1. the component's own rendering for that target (`targets`, an escape hatch);
 *   2. the version composed from its primitives;
 *   3. the fallback the *requester* names (default `json`: the data itself).
 * An unknown primitive never breaks a reader: it degrades to its text.
 */

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
  image: ["src", "alt", "size", "fit", "height", "caption"],
  list: ["rows", "groups", "preview", "filter", "enter", "empty", "arrange", "size", "columns", "headers", "page"],
} as const satisfies Record<typeof PRIMITIVE_TYPES[number], readonly string[]>;

export const RENDER_TARGETS = ["terminal", "markdown", "blockdown", "html", "json", "csv"] as const;
export type RenderTarget = typeof RENDER_TARGETS[number];
export const TONES = ["default", "good", "warn", "bad", "dim", "accent"] as const;
/** A table cell: plain text or a number, or one that presses an action line or opens a note on its own (PIE-1461). */
export type TableCell = ListCell;
/** A cell's text, whatever its shape. */
export const cellText = listCellText;
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
   */
  | { type: "image"; src: string; alt?: string; size?: string; fit?: "cover" | "contain"; height?: number; caption?: boolean }
  /**
   * A selectable, filterable list with a preview (PIE-747, ADR 0004 contract 3): rows with one activation each, drawn
   * by every client (the door's one ListView, Detail as text, a page as `<ul>`). The viewer's selection, filter and
   * whether they are in it are theirs: never written, never sent. The rows' shape is outline-core's (`list-row.ts`).
   */
  | ListPrimitive;

export interface ComponentOutput {
  readonly placement?: "replace";
  /** The truth: what `json` (and `csv`, for rows) returns. */
  readonly data: unknown;
  readonly view: Primitive;
  /** Escape hatch: the component's own rendering for some targets. */
  readonly targets?: Partial<Record<RenderTarget, string>>;
}

export interface RenderedComponent {
  readonly target: RenderTarget;
  readonly body: string;
  /** Which step of the fallback chain answered. */
  readonly via: "component" | "primitives" | "fallback";
  readonly contentType: string;
}

const MAX_DEPTH = 8;
const MAX_NODES = 400;
const MAX_TEXT = 2_000;
/** A blockdown primitive holds a section of a note: as much as a child note a component reads (`context.children`). */
const MAX_BLOCKDOWN = 16_000;
export const ROW_MIN_WIDTH = 12;
const MAX_CHILDREN = 100;
const MAX_ROWS = 200;
const MAX_COLUMNS = 12;
const MAX_VALUES = 200;
const MAX_DATA_BYTES = 256 * 1024;
/** The tallest an image primitive is drawn, in rows. */
const MAX_IMAGE_ROWS = 60;
const BLOCK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What a link in a view may name: a block, or a Resource (PIE-754) the client opens the way the links tile does. */
const linkable = (link: string) => BLOCK_ID.test(link) || (isResourceRef(link) && !("problem" in parseResourceRef(link)));

export const CONTENT_TYPES: Record<RenderTarget, string> = {
  terminal: "text/plain; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  blockdown: "text/blockdown; charset=utf-8",
  html: "text/html; charset=utf-8",
  json: "application/json",
  csv: "text/csv; charset=utf-8",
};

export class ComponentError extends Error {}

function fail(path: string, message: string): never {
  throw new ComponentError(`${path || "view"} ${message}`);
}

function text(value: unknown, path: string, optional = false, max = MAX_TEXT): string | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string") fail(path, "must be text");
  if (value.length > max) fail(path, `is longer than ${max} characters`);
  // Kept clean: terminal escapes and control characters never reach a reader (the door's own drawing, `terminal`).
  return cleanExtensionText(value, true);
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "must be a number");
  return value;
}

function tone(value: unknown, path: string): Tone | undefined {
  if (value === undefined) return undefined;
  if (!TONES.includes(value as Tone)) fail(path, `must be one of ${TONES.join(", ")}`);
  return value as Tone;
}

const ACT_HEAD = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const MAX_ACT = 400;

/**
 * A press's action line, checked for its shape (the service can't tell which action names a door has): a head word, then
 * `key=value` words; no `as=` (a press runs as the person). Returns it as written.
 */
function actionLine(value: unknown, path: string): ActionLine {
  if (typeof value !== "string") fail(path, "must be an action line as the power bar takes it, such as `ttt-move at=5`");
  if (value.length > MAX_ACT) fail(path, `is longer than ${MAX_ACT} characters`);
  let req;
  try { req = actRequestOf(lineWords(value)); } catch (error) { fail(path, `isn't an action line: ${error instanceof Error ? error.message : String(error)} (an action, then key=value words: \`ttt-move at=5\`)`); }
  if (!ACT_HEAD.test(req.action)) fail(path, "must start with an action's name (layout.load, ext.<id>.run) or a script's name");
  if (req.as !== undefined) fail(path, "runs as the person: leave out as=");
  return value.trim();
}

function only(object: Record<string, unknown>, keys: readonly string[], path: string): void {
  for (const key of Object.keys(object)) if (key !== "type" && !keys.includes(key)) fail(path, `has a field it doesn't know: ${key}`);
}

const MAX_LIST_GROUPS = 50;
const MAX_ROW_ID = 200;
const MAX_INSERT = 500;
const MAX_COPY = 2_000;
const MAX_ARGS = 20;

/** One line of text, bounded: a row's label, detail or mark. */
function oneLineText(value: unknown, path: string, max = MAX_TEXT): string {
  const clean = text(value, path, false, max)!;
  if (clean.includes("\n")) fail(path, "must be one line");
  return clean;
}

/** What ⏎ does on a row: exactly one of open, run, copy, insert (ADR 0004 contract 3), each checked for what it may name. */
function activation(value: unknown, path: string): NonNullable<ListRow["do"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, `must be { ${ACTIVATION_KINDS.join(" | ")}: … }`);
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!(ACTIVATION_KINDS as readonly string[]).includes(key)) fail(path, `has a field it doesn't know: ${key} (a row does one of ${ACTIVATION_KINDS.join(", ")})`);
  const count = activationCount(raw);
  if (count !== 1) fail(path, `must do exactly one thing, ${count ? `not ${count}` : "none given"}: one of ${ACTIVATION_KINDS.join(", ")} (a row with no \`do\` is a header)`);
  if (raw.open !== undefined) {
    if (typeof raw.open === "object" && raw.open) {
      const open = raw.open as Record<string, unknown>;
      only(open, ["ref", "where", "revision", "at", "atLabel", "atSays"], `${path}.open`);
      if (typeof open.ref !== "string" || !linkable(open.ref)) fail(`${path}.open.ref`, "must be a block id or Resource ref");
      if (open.where !== undefined && !["current", "beside", "float", "full"].includes(open.where as string)) fail(`${path}.open.where`, "must be current, beside, float or full");
      const revision = open.revision === undefined ? undefined : finite(open.revision, `${path}.open.revision`);
      if (revision !== undefined && (!Number.isInteger(revision) || revision < 1)) fail(`${path}.open.revision`, "must be a positive integer");
      const at = open.at === undefined ? undefined : finite(open.at, `${path}.open.at`);
      if (at !== undefined && (!Number.isInteger(at) || at < 0)) fail(`${path}.open.at`, "must be a character offset from zero");
      for (const key of ["atLabel", "atSays"] as const) if (open[key] !== undefined && typeof open[key] !== "string") fail(`${path}.open.${key}`, "must be text");
      return { open: { ref: open.ref as string, where: open.where as "current" | "beside" | "float" | "full" | undefined, ...(revision !== undefined ? { revision } : {}), ...(at !== undefined ? { at, atLabel: open.atLabel as string | undefined, atSays: open.atSays as string | undefined } : {}) } };
    }
    if (typeof raw.open !== "string" || !linkable(raw.open)) fail(`${path}.open`, "must be a block id or a Resource ref (file:/path, web:https://…, resource:<id>)");
    return { open: raw.open };
  }
  if (raw.copy !== undefined) return { copy: text(raw.copy, `${path}.copy`, false, MAX_COPY)! };
  if (raw.insert !== undefined) {
    const line = oneLineText(raw.insert, `${path}.insert`, MAX_INSERT);
    return { insert: line };
  }
  const run = raw.run;
  if (!run || typeof run !== "object" || Array.isArray(run)) fail(`${path}.run`, "must be { action, args? }");
  const call = run as Record<string, unknown>;
  only(call, ["action", "args"], `${path}.run`);
  if (typeof call.action !== "string" || !ACT_HEAD.test(call.action)) fail(`${path}.run.action`, "must be an action's name (layout.load, ext.<id>.run) or a script's name");
  if (call.args === undefined) return { run: { action: call.action } };
  if (!call.args || typeof call.args !== "object" || Array.isArray(call.args)) fail(`${path}.run.args`, "must map each argument's name to its text");
  const entries = Object.entries(call.args as Record<string, unknown>);
  if (entries.length > MAX_ARGS) fail(`${path}.run.args`, `has more than ${MAX_ARGS} arguments`);
  return { run: { action: call.action, args: Object.fromEntries(entries.map(([key, v]) => {
    if (!/^[A-Za-z][\w.-]{0,39}$/.test(key) || key === "as") fail(`${path}.run.args.${key}`, "isn't an argument name a press can pass (a press runs as the person: leave out as)");
    return [key, oneLineText(v, `${path}.run.args.${key}`, MAX_ACT)];
  })) } };
}

function tableCell(cell: unknown, at: string): TableCell {
  if (typeof cell === "number") return finite(cell, at);
  if (cell && typeof cell === "object" && !Array.isArray(cell)) {
    const raw = cell as Record<string, unknown>;
    only(raw, ["text", "act", "link", "revision", "tone"], at);
    const out: Extract<TableCell, object> = { text: text(raw.text, `${at}.text`)! };
    if (raw.act !== undefined) out.act = actionLine(raw.act, `${at}.act`);
    if (raw.revision !== undefined) {
      out.revision = finite(raw.revision, `${at}.revision`);
      if (!Number.isInteger(out.revision) || out.revision < 1) fail(`${at}.revision`, "must be a positive integer");
    }
    if (raw.link !== undefined) {
      if (typeof raw.link !== "string" || !linkable(raw.link)) fail(`${at}.link`, "must be a block id or a Resource ref (file:/path, web:https://…, resource:<id>)");
      out.link = raw.link;
    }
    if (out.act && out.link) fail(at, "a cell presses or opens, not both");
    const cellTone = tone(raw.tone, `${at}.tone`);
    if (cellTone) out.tone = cellTone;
    return out;
  }
  return text(cell, at)!;
}

function listRow(value: unknown, path: string): ListRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "must be a row: { id, label, detail?, mark?, tone?, group?, preview?, do? }");
  const row = value as Record<string, unknown>;
  only(row, ["id", "label", "detail", "mark", "tone", "group", "preview", "do", "cells", "cover", "bind", "body"], path);
  const id = oneLineText(row.id, `${path}.id`, MAX_ROW_ID);
  if (!id.trim()) fail(`${path}.id`, "must not be empty");
  let preview: ListRow["preview"];
  if (row.preview !== undefined) {
    if (!row.preview || typeof row.preview !== "object" || Array.isArray(row.preview)) fail(`${path}.preview`, "must be { block } or { markdown }");
    const p = row.preview as Record<string, unknown>;
    only(p, ["block", "markdown"], `${path}.preview`);
    if ((p.block === undefined) === (p.markdown === undefined)) fail(`${path}.preview`, "must be exactly one of { block } or { markdown }");
    if (p.block !== undefined) {
      if (typeof p.block !== "string" || !BLOCK_ID.test(p.block)) fail(`${path}.preview.block`, "must be a block id");
      preview = { block: p.block };
    } else preview = { markdown: text(p.markdown, `${path}.preview.markdown`, false, MAX_BLOCKDOWN)! };
  }
  return {
    id,
    label: oneLineText(row.label, `${path}.label`),
    ...(row.cells !== undefined ? { cells: cells(row.cells, `${path}.cells`) } : {}),
    ...(row.body !== undefined ? { body: strings(row.body, `${path}.body`) } : {}),
    ...(row.cover !== undefined ? { cover: oneLineText(row.cover, `${path}.cover`) } : {}),
    ...(row.bind !== undefined ? { bind: oneLineText(row.bind, `${path}.bind`) } : {}),
    ...(row.detail !== undefined ? { detail: oneLineText(row.detail, `${path}.detail`) } : {}),
    ...(row.mark !== undefined ? { mark: oneLineText(row.mark, `${path}.mark`, 8) } : {}),
    ...(tone(row.tone, `${path}.tone`) ? { tone: row.tone as Tone } : {}),
    ...(row.group !== undefined ? { group: oneLineText(row.group, `${path}.group`, MAX_ROW_ID) } : {}),
    ...(preview ? { preview } : {}),
    ...(row.do !== undefined ? { do: activation(row.do, `${path}.do`) } : {}),
  };
}

function listGroup(value: unknown, path: string): ListGroup {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "must be { name, label, count, glyph?, note? }");
  const raw = value as Record<string, unknown>;
  only(raw, ["name", "label", "glyph", "count", "note", "ids", "groups"], path);
  if (!Number.isInteger(raw.count) || (raw.count as number) < 0) fail(`${path}.count`, "must be a whole number");
  return { name: oneLineText(raw.name, `${path}.name`, MAX_ROW_ID), label: oneLineText(raw.label, `${path}.label`), count: raw.count as number,
    ...(raw.ids !== undefined ? { ids: strings(raw.ids, `${path}.ids`) } : {}),
    ...(raw.groups !== undefined ? { groups: groupList(raw.groups, `${path}.groups`) } : {}),
    ...(raw.glyph !== undefined ? { glyph: oneLineText(raw.glyph, `${path}.glyph`, 8) } : {}),
    ...(raw.note !== undefined ? { note: oneLineText(raw.note, `${path}.note`) } : {}) };
}

function cells(value: unknown, path: string): ListCell[] {
  if (!Array.isArray(value)) fail(path, "must be a list of cells");
  return (value as unknown[]).map((cell, i) => tableCell(cell, `${path}[${i}]`));
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(path, "must be a list of text");
  return (value as unknown[]).map((v, i) => oneLineText(v, `${path}[${i}]`));
}

function groupList(value: unknown, path: string): ListGroup[] {
  if (!Array.isArray(value)) fail(path, "must be a list of groups");
  return (value as unknown[]).map((v, i) => listGroup(v, `${path}[${i}]`));
}

function listPrimitive(node: Record<string, unknown>, path: string): ListPrimitive {
  only(node, PRIMITIVE_FIELDS.list, path);
  if (!Array.isArray(node.rows) || node.rows.length > LIST_MAX_ROWS) fail(`${path}.rows`, `must be a list of at most ${LIST_MAX_ROWS} rows`);
  const rows = node.rows.map((row, index) => listRow(row, `${path}.rows[${index}]`));
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (seen.has(row.id)) fail(`${path}.rows[${index}].id`, `repeats ${row.id}: a row's id is unique in its list (it keys the selection)`);
    seen.add(row.id);
  }
  let groups: ListGroup[] | undefined;
  if (node.groups !== undefined) {
    if (!Array.isArray(node.groups) || node.groups.length > MAX_LIST_GROUPS) fail(`${path}.groups`, `must be a list of at most ${MAX_LIST_GROUPS} groups`);
    groups = node.groups.map((group, index) => listGroup(group, `${path}.groups[${index}]`));
  }
  if (node.preview !== undefined && !(LIST_PREVIEWS as readonly string[]).includes(node.preview as string)) fail(`${path}.preview`, `must be one of ${LIST_PREVIEWS.join(", ")}`);
  for (const key of ["filter", "enter"] as const) if (node[key] !== undefined && typeof node[key] !== "boolean") fail(`${path}.${key}`, "must be true or false");
  if (node.arrange !== undefined && !["table", "rows", "grid", "lanes"].includes(node.arrange as string)) fail(`${path}.arrange`, "must be table, rows, grid or lanes");
  if (node.size !== undefined && !["small", "large"].includes(node.size as string)) fail(`${path}.size`, "must be small or large");
  if (node.page !== undefined && (!Number.isInteger(node.page) || Number(node.page) < 1)) fail(`${path}.page`, "must be a positive number of rows");
  return { type: "list", rows,
    ...(node.arrange !== undefined ? { arrange: node.arrange as ListPrimitive["arrange"] } : {}),
    ...(node.size !== undefined ? { size: node.size as ListPrimitive["size"] } : {}),
    ...(node.columns !== undefined ? { columns: strings(node.columns, `${path}.columns`) } : {}),
    ...(node.headers !== undefined ? { headers: strings(node.headers, `${path}.headers`) } : {}),
    ...(node.page !== undefined ? { page: node.page as number } : {}),
    ...(groups ? { groups } : {}),
    ...(node.preview !== undefined ? { preview: node.preview as ListPrimitive["preview"] } : {}),
    ...(node.filter !== undefined ? { filter: node.filter as boolean } : {}),
    ...(node.enter !== undefined ? { enter: node.enter as boolean } : {}),
    ...(node.empty !== undefined ? { empty: oneLineText(node.empty, `${path}.empty`) } : {}) };
}

/** Checks a view tree against the catalogue and its bounds; returns a clean copy. */
export function validatePrimitive(value: unknown, path = "view", depth = 0, count = { nodes: 0 }): Primitive {
  if (depth > MAX_DEPTH) fail(path, `nests deeper than ${MAX_DEPTH}`);
  if (++count.nodes > MAX_NODES) fail(path, `has more than ${MAX_NODES} primitives`);
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "must be a primitive object");
  const node = value as Record<string, unknown>;
  const children = (key = "children"): Primitive[] => {
    const list = node[key];
    if (!Array.isArray(list)) fail(`${path}.${key}`, "must be a list");
    if (list.length > MAX_CHILDREN) fail(`${path}.${key}`, `has more than ${MAX_CHILDREN} items`);
    return list.map((child, index) => validatePrimitive(child, `${path}.${key}[${index}]`, depth + 1, count));
  };
  switch (node.type) {
    case "text": {
      only(node, PRIMITIVE_FIELDS.text, path);
      if (node.strong !== undefined && typeof node.strong !== "boolean") fail(`${path}.strong`, "must be true or false");
      const { type, strong, ...cell } = node;
      return { type: "text", ...tableCell(cell, path) as Extract<TableCell, object>, ...(strong ? { strong: true } : {}) };
    }
    case "blockdown":
      only(node, PRIMITIVE_FIELDS.blockdown, path);
      return { type: "blockdown", text: text(node.text, `${path}.text`, false, MAX_BLOCKDOWN)! };
    case "badge":
      only(node, PRIMITIVE_FIELDS.badge, path);
      return { type: "badge", label: text(node.label, `${path}.label`)!, ...(tone(node.tone, `${path}.tone`) ? { tone: node.tone as Tone } : {}),
        ...(node.act !== undefined ? { act: actionLine(node.act, `${path}.act`) } : {}) };
    case "button":
      only(node, PRIMITIVE_FIELDS.button, path);
      return { type: "button", label: text(node.label, `${path}.label`)!, act: actionLine(node.act, `${path}.act`), ...(tone(node.tone, `${path}.tone`) ? { tone: node.tone as Tone } : {}) };
    case "stat": {
      only(node, PRIMITIVE_FIELDS.stat, path);
      const statValue = typeof node.value === "number" ? finite(node.value, `${path}.value`) : text(node.value, `${path}.value`)!;
      return { type: "stat", label: text(node.label, `${path}.label`)!, value: statValue,
        ...(node.unit !== undefined ? { unit: text(node.unit, `${path}.unit`)! } : {}),
        ...(tone(node.tone, `${path}.tone`) ? { tone: node.tone as Tone } : {}) };
    }
    case "bar": {
      only(node, PRIMITIVE_FIELDS.bar, path);
      const max = finite(node.max, `${path}.max`);
      if (max <= 0) fail(`${path}.max`, "must be more than 0");
      return { type: "bar", label: text(node.label, `${path}.label`)!, value: finite(node.value, `${path}.value`), max,
        ...(tone(node.tone, `${path}.tone`) ? { tone: node.tone as Tone } : {}) };
    }
    case "table": {
      only(node, PRIMITIVE_FIELDS.table, path);
      if (!Array.isArray(node.columns) || node.columns.length === 0 || node.columns.length > MAX_COLUMNS) fail(`${path}.columns`, `must list 1 to ${MAX_COLUMNS} columns`);
      const columns = node.columns.map((column, index) => text(column, `${path}.columns[${index}]`)!);
      if (!Array.isArray(node.rows) || node.rows.length > MAX_ROWS) fail(`${path}.rows`, `must be a list of at most ${MAX_ROWS} rows`);
      const rows = node.rows.map((row, index) => {
        if (!Array.isArray(row) || row.length !== columns.length) fail(`${path}.rows[${index}]`, `must have ${columns.length} cells`);
        return row.map((cell, column) => tableCell(cell, `${path}.rows[${index}][${column}]`));
      });
      let links: (string | null)[] | undefined;
      if (node.links !== undefined) {
        if (!Array.isArray(node.links) || node.links.length !== rows.length) fail(`${path}.links`, "must have one entry per row");
        links = node.links.map((link, index) => {
          if (link === null) return null;
          if (typeof link !== "string" || !linkable(link)) fail(`${path}.links[${index}]`, "must be a block id, a Resource ref (file:/path, web:https://…, resource:<id>) or null");
          return link;
        });
      }
      let acts: (ActionLine | null)[] | undefined;
      if (node.acts !== undefined) {
        if (!Array.isArray(node.acts) || node.acts.length !== rows.length) fail(`${path}.acts`, "must have one entry per row");
        acts = node.acts.map((act, index) => (act === null ? null : actionLine(act, `${path}.acts[${index}]`)));
        if (links?.some((link, index) => link !== null && acts![index])) fail(`${path}.acts`, "can't press a row that also links");
      }
      return { type: "table", columns, rows, ...(links ? { links } : {}), ...(acts ? { acts } : {}) };
    }
    case "checklist": {
      only(node, PRIMITIVE_FIELDS.checklist, path);
      if (!Array.isArray(node.items) || node.items.length > MAX_ROWS) fail(`${path}.items`, `must be a list of at most ${MAX_ROWS} items`);
      return { type: "checklist", items: node.items.map((item, index) => {
        if (!item || typeof item !== "object") fail(`${path}.items[${index}]`, "must be { label, done }");
        const entry = item as Record<string, unknown>;
        only(entry, ["label", "done"], `${path}.items[${index}]`);
        if (typeof entry.done !== "boolean") fail(`${path}.items[${index}].done`, "must be true or false");
        return { label: text(entry.label, `${path}.items[${index}].label`)!, done: entry.done };
      }) };
    }
    case "sparkline": {
      only(node, PRIMITIVE_FIELDS.sparkline, path);
      if (!Array.isArray(node.values) || node.values.length === 0 || node.values.length > MAX_VALUES) fail(`${path}.values`, `must list 1 to ${MAX_VALUES} numbers`);
      return { type: "sparkline", ...(node.label !== undefined ? { label: text(node.label, `${path}.label`)! } : {}),
        values: node.values.map((entry, index) => finite(entry, `${path}.values[${index}]`)) };
    }
    case "card": {
      only(node, PRIMITIVE_FIELDS.card, path);
      let badge: { label: string; tone?: Tone } | undefined;
      if (node.badge !== undefined) {
        if (!node.badge || typeof node.badge !== "object") fail(`${path}.badge`, "must be { label, tone? }");
        const raw = node.badge as Record<string, unknown>;
        only(raw, ["label", "tone"], `${path}.badge`);
        badge = { label: text(raw.label, `${path}.badge.label`)!, ...(tone(raw.tone, `${path}.badge.tone`) ? { tone: raw.tone as Tone } : {}) };
      }
      if (node.link !== undefined && (typeof node.link !== "string" || !linkable(node.link))) fail(`${path}.link`, "must be a block id or a Resource ref (file:/path, web:https://…, resource:<id>)");
      if (node.act !== undefined && node.link !== undefined) fail(`${path}.act`, "can't press a card that also links");
      return { type: "card", title: text(node.title, `${path}.title`)!,
        ...(node.subtitle !== undefined ? { subtitle: text(node.subtitle, `${path}.subtitle`)! } : {}),
        ...(badge ? { badge } : {}),
        ...(node.link !== undefined ? { link: node.link as string } : {}),
        ...(node.act !== undefined ? { act: actionLine(node.act, `${path}.act`) } : {}),
        ...(node.children !== undefined ? { children: children() } : {}) };
    }
    case "box":
      only(node, PRIMITIVE_FIELDS.box, path);
      return { type: "box", ...(node.title !== undefined ? { title: text(node.title, `${path}.title`)! } : {}), children: children() };
    case "stack":
      only(node, PRIMITIVE_FIELDS.stack, path);
      return { type: "stack", children: children() };
    case "row": {
      only(node, PRIMITIVE_FIELDS.row, path);
      if (node.minWidth !== undefined && (!Number.isInteger(node.minWidth) || (node.minWidth as number) < 4 || (node.minWidth as number) > 200)) fail(`${path}.minWidth`, "must be a whole number from 4 to 200");
      return { type: "row", children: children(), ...(node.minWidth !== undefined ? { minWidth: node.minWidth as number } : {}) };
    }
    case "band": {
      only(node, PRIMITIVE_FIELDS.band, path);
      if (node.style !== undefined && (typeof node.style !== "string" || !HEADING_STYLE_NAME.test(node.style))) fail(`${path}.style`, "must be a heading style's name");
      if (node.level !== undefined && node.level !== 1 && node.level !== 2 && node.level !== 3) fail(`${path}.level`, "must be 1, 2 or 3");
      const choice = <T extends string>(key: string, options: readonly T[]): T | undefined => {
        if (node[key] === undefined) return undefined;
        if (!options.includes(node[key] as T)) fail(`${path}.${key}`, `must be one of ${options.join(", ")}`);
        return node[key] as T;
      };
      const pattern = choice("pattern", BAND_PATTERNS), align = choice("align", ALIGNS), row = choice("row", ["top", "middle", "bottom"] as const);
      return { type: "band", ...(node.text !== undefined ? { text: text(node.text, `${path}.text`)! } : {}),
        ...(node.style !== undefined ? { style: node.style as string } : {}),
        ...(node.level !== undefined ? { level: node.level as 1 | 2 | 3 } : {}),
        ...(pattern ? { pattern } : {}), ...(align ? { align } : {}), ...(row ? { row } : {}),
        ...(tone(node.tone, `${path}.tone`) ? { tone: node.tone as Tone } : {}) };
    }
    case "track": {
      only(node, PRIMITIVE_FIELDS.track, path);
      if (node.style !== undefined && (typeof node.style !== "string" || !HEADING_STYLE_NAME.test(node.style))) fail(`${path}.style`, "must be a heading style's name");
      if (node.pattern !== undefined && !BAND_PATTERNS.includes(node.pattern as BandPattern)) fail(`${path}.pattern`, `must be one of ${BAND_PATTERNS.join(", ")}`);
      return { type: "track", ...(node.style !== undefined ? { style: node.style as string } : {}), ...(node.pattern !== undefined ? { pattern: node.pattern as BandPattern } : {}),
        ...(tone(node.tone, `${path}.tone`) ? { tone: node.tone as Tone } : {}) };
    }
    case "image": {
      only(node, PRIMITIVE_FIELDS.image, path);
      const src = text(node.src, `${path}.src`)!;
      // A file the outline names, as a note's image line does: never a page on the web or a stored Resource.
      if (!src.trim() || src.includes("\0") || (isResourceRef(src) && !src.startsWith("file:")) || (src.startsWith("file:") && "problem" in parseResourceRef(src)))
        fail(`${path}.src`, "must be a file's path or a file: Resource ref (file:/path)");
      if (node.size !== undefined && (typeof node.size !== "string" || !parseSize(node.size))) fail(`${path}.size`, "must be a size as [size::] writes it: cells (24), N% (50%) or full");
      if (node.fit !== undefined && node.fit !== "cover" && node.fit !== "contain") fail(`${path}.fit`, "must be cover or contain");
      if (node.caption !== undefined && typeof node.caption !== "boolean") fail(`${path}.caption`, "must be true or false");
      if (node.height !== undefined && (!Number.isInteger(node.height) || (node.height as number) < 1 || (node.height as number) > MAX_IMAGE_ROWS)) fail(`${path}.height`, `must be a whole number of rows from 1 to ${MAX_IMAGE_ROWS}`);
      return { type: "image", src: src.trim(), ...(node.alt !== undefined ? { alt: text(node.alt, `${path}.alt`)! } : {}),
        ...(node.size !== undefined ? { size: node.size as string } : {}), ...(node.fit !== undefined ? { fit: node.fit as "cover" | "contain" } : {}),
        ...(node.height !== undefined ? { height: node.height as number } : {}), ...(node.caption !== undefined ? { caption: node.caption as boolean } : {}) };
    }
    case "list":
      return listPrimitive(node, path);
    default:
      fail(`${path}.type`, `must be one of ${PRIMITIVE_TYPES.join(", ")}`);
  }
}

/** Checks a component handler's result: `{ data, view, targets? }`. */
export function validateComponent(value: unknown): ComponentOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ComponentError("a component returns { data, view }");
  const raw = value as Record<string, unknown>;
  if (!("data" in raw)) throw new ComponentError("a component returns data (the truth its view shows)");
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(raw.data ?? null));
  } catch {
    throw new ComponentError("data must be plain JSON");
  }
  if (size > MAX_DATA_BYTES) throw new ComponentError("data is larger than 256 KiB");
  const view = validatePrimitive(raw.view);
  let targets: Partial<Record<RenderTarget, string>> | undefined;
  if (raw.targets !== undefined) {
    if (!raw.targets || typeof raw.targets !== "object" || Array.isArray(raw.targets)) throw new ComponentError("targets must map a target to its text");
    targets = {};
    for (const [target, body] of Object.entries(raw.targets as Record<string, unknown>)) {
      if (!RENDER_TARGETS.includes(target as RenderTarget)) throw new ComponentError(`targets.${target} is not a render target (${RENDER_TARGETS.join(", ")})`);
      if (typeof body !== "string" || Buffer.byteLength(body) > MAX_DATA_BYTES) throw new ComponentError(`targets.${target} must be text up to 256 KiB`);
      targets[target as RenderTarget] = cleanExtensionText(body, true);
    }
  }
  if (raw.placement !== undefined && raw.placement !== "replace") throw new ComponentError("placement must be replace (draw in the handler line\'s place)");
  return { data: raw.data ?? null, view, ...(raw.placement === "replace" ? { placement: "replace" as const } : {}), ...(targets ? { targets } : {}) };
}

// ── Renderers ────────────────────────────────────────────────────────────

const SPARKS = "▁▂▃▄▅▆▇█";

function sparkline(values: readonly number[]): string {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return values.map((value) => SPARKS[high === low ? 3 : Math.round(((value - low) / (high - low)) * (SPARKS.length - 1))]).join("");
}

function meter(value: number, max: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** A track's glyphs as plain text, `width` wide: what a text target draws for a band's or a track's rows. */
export function trackText(pattern: BandPattern | undefined, width = 40): string {
  const unit = { stack: "▁▂▃▅▃▂", waffle: "▪▫", uptime: "▌▌▌░", dots: "· ", rule: "─" }[pattern ?? "rule"];
  return unit.repeat(Math.ceil(width / unit.length)).slice(0, width);
}

const statText = (node: Extract<Primitive, { type: "stat" }>) => `${node.value}${node.unit ? ` ${node.unit}` : ""}`;
const cell = (value: TableCell) => cellText(value);
/** One line, no control characters: what a terminal cell may hold. */
const oneLine = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ");

/** Plain terminal text: no colour, so any client can show it; the door draws `view` itself. */
function terminalLines(node: Primitive): string[] {
  switch (node.type) {
    case "text": return oneLine(node.text).split(/\n/);
    case "blockdown": return node.text.split("\n").map(oneLine);
    case "badge": return [`[${oneLine(node.label)}]`];
    case "button": return [`[${oneLine(node.label)}]`];
    case "stat": return [`${oneLine(node.label)}  ${oneLine(statText(node))}`];
    case "bar": return [`${oneLine(node.label)}  ${meter(node.value, node.max)}  ${node.value}/${node.max}`];
    case "sparkline": return [`${node.label ? `${oneLine(node.label)}  ` : ""}${sparkline(node.values)}`];
    case "checklist": return node.items.map((item) => `[${item.done ? "x" : " "}] ${oneLine(item.label)}`);
    case "table": {
      const all = [node.columns, ...node.rows.map((row) => row.map(cell))].map((row) => row.map(oneLine));
      const widths = node.columns.map((_, index) => Math.max(...all.map((row) => row[index]!.length)));
      const line = (row: string[]) => row.map((value, index) => value.padEnd(widths[index]!)).join("  ").trimEnd();
      return [line(all[0]!), widths.map((width) => "─".repeat(width)).join("  "), ...all.slice(1).map(line)];
    }
    case "card": {
      const head = `▌ ${oneLine(node.title)}${node.badge ? `  [${oneLine(node.badge.label)}]` : ""}`;
      return [head, ...(node.subtitle ? [`▌ ${oneLine(node.subtitle)}`] : []), ...(node.children ?? []).flatMap(terminalLines).map((line) => `  ${line}`)];
    }
    case "box": {
      const inner = node.children.flatMap(terminalLines);
      return [`┌─${node.title ? ` ${oneLine(node.title)} ` : ""}`, ...inner.map((line) => `│ ${line}`), "└─"];
    }
    case "stack": return node.children.flatMap(terminalLines);
    case "list": return listTerminal(node);
    case "band": {
      const words = oneLine(node.text ?? ""), width = Math.max(40, words.length + 8);
      const placed = node.align === "center" ? words.padStart(Math.floor((width + words.length) / 2)).padEnd(width)
        : node.align === "right" ? words.padStart(width) : words.padEnd(width);
      const at = node.row === "top" ? 0 : node.row === "bottom" ? 2 : 1;
      return [0, 1, 2].map((r) => (r === at && words ? placed.trimEnd() : trackText(node.pattern, width)));
    }
    case "track": return [trackText(node.pattern)];
    case "image": return [`[image${node.alt ? `: ${oneLine(node.alt)}` : ""}] ${oneLine(imageSource(node.src))}`];
    case "row": {
      const columns = node.children.map(terminalLines);
      const widths = columns.map((lines) => Math.max(0, ...lines.map((line) => line.length)));
      const height = Math.max(0, ...columns.map((lines) => lines.length));
      return Array.from({ length: height }, (_, row) =>
        columns.map((lines, index) => (lines[row] ?? "").padEnd(widths[index]!)).join("   ").trimEnd());
    }
  }
}


function listContent(node: ListPrimitive): Primitive {
  if (node.arrange === "table") return { type: "table", columns: node.headers ?? node.columns ?? ["title"], rows: node.rows.map(r => r.cells ?? [r.label]) };
  const cards = (rows: readonly ListRow[]): Primitive[] => rows.map(r => ({ type: "card", title: r.label, subtitle: r.detail,
    children: [...(r.cover ? [{ type: "text" as const, text: r.cover }] : []), ...(r.body ?? []).map(text => ({ type: "text" as const, text }))] }));
  if (node.arrange === "lanes" && node.groups?.length) return { type: "row", minWidth: 24, children: node.groups.map(group => ({ type: "box", title: listHead(group), children: listSections({ rows: node.rows, groups: [group] }).flatMap(section => [
    ...(group.groups?.length && section.head ? [{ type: "text" as const, text: listHead(section.head), strong: true }] : []), ...cards(section.rows),
  ]) })) };
  return { type: node.arrange === "grid" ? "row" : "stack", ...(node.arrange === "grid" ? { minWidth: node.size === "large" ? 44 : 28 } : {}), children: cards(node.rows) };
}

/** A list as terminal text: a section's header, its rows indented under it, `mark label · detail`. */
function listTerminal(node: ListPrimitive): string[] {
  if (node.arrange) return terminalLines(listContent(node));
  const sections = listSections(node);
  if (!node.rows.length) return [oneLine(node.empty ?? "nothing here")];
  return sections.flatMap(({ head, rows }) => [
    ...(head ? [`▾ ${oneLine(listHead(head))}${head.note ? ` · ${oneLine(head.note)}` : ""}`] : []),
    ...rows.map((row) => `${head ? "  " : ""}${row.mark ? oneLine(row.mark) : row.do ? "·" : "■"} ${oneLine(row.label)}${row.detail ? ` · ${oneLine(row.detail)}` : ""}`),
  ]);
}
/** The first row with a Markdown preview: what a page shows after the list (a page has no viewer state, so the first). */
const firstPreview = (node: ListPrimitive): string | null => {
  for (const row of node.rows) if (row.preview && "markdown" in row.preview) return row.preview.markdown;
  return null;
};

const mdInline = (value: string) => oneLine(value).replace(/([\\`*_|<>])/g, "\\$1");

/**
 * How a reader that draws Markdown wants a row: `row` gets each child's Markdown and returns the lines that stand for
 * the row (Detail lays them side by side, src/detail-embeds.ts). Without it a row is its children in order.
 */
export interface MarkdownDraw {
  row?(parts: readonly string[], node: Extract<Primitive, { type: "row" }>): string[];
}

function markdownLines(node: Primitive, draw: MarkdownDraw = {}): string[] {
  const inner = (child: Primitive) => markdownLines(child, draw);
  switch (node.type) {
    case "text": {
      const text = node.strong ? `**${mdInline(node.text)}**` : mdInline(node.text);
      return [node.link && BLOCK_ID.test(node.link) ? `[${text}](#${node.link})` : text, ""];
    }
    // Blockdown is the reader's own: as written, between blank lines.
    case "blockdown": return [node.text.replace(/\r\n?/g, "\n").trim(), ""];
    case "badge": return [`\`${oneLine(node.label).replace(/`/g, "'")}\``, ""];
    case "button": return [`\`${oneLine(node.label).replace(/`/g, "'")}\``, ""];
    case "stat": return [`- **${mdInline(node.label)}:** ${mdInline(statText(node))}`];
    case "bar": return [`- ${mdInline(node.label)}: ${meter(node.value, node.max)} ${node.value}/${node.max}`];
    case "sparkline": return [`- ${node.label ? `${mdInline(node.label)}: ` : ""}${sparkline(node.values)}`];
    case "checklist": return [...node.items.map((item) => `- [${item.done ? "x" : " "}] ${mdInline(item.label)}`), ""];
    case "table": return [
      `| ${node.columns.map(mdInline).join(" | ")} |`,
      `| ${node.columns.map(() => "---").join(" | ")} |`,
      ...node.rows.map((row) => `| ${row.map((value) => mdInline(cell(value))).join(" | ")} |`),
      "",
    ];
    case "card": return [
      `**${mdInline(node.title)}**${node.badge ? ` \`${oneLine(node.badge.label).replace(/`/g, "'")}\`` : ""}${node.subtitle ? ` · _${mdInline(node.subtitle)}_` : ""}`,
      "",
      ...(node.children ?? []).flatMap(inner),
    ];
    case "box": return [...(node.title ? [`**${mdInline(node.title)}**`, ""] : []), ...node.children.flatMap(inner)];
    case "stack": return node.children.flatMap(inner);
    // A bulleted list, a group's header a bold line over its rows; the first row's preview after it.
    case "list": {
      if (node.arrange && node.rows.length) return markdownLines(listContent(node), draw);
      if (!node.rows.length) return [`*${mdInline(node.empty ?? "nothing here")}*`, ""];
      const preview = firstPreview(node);
      return [
        ...listSections(node).flatMap(({ head, rows }) => [
          ...(head ? [`**${mdInline(listHead(head))}**${head.note ? ` · ${mdInline(head.note)}` : ""}`, ""] : []),
          ...rows.map((row) => `- ${row.mark ? `${mdInline(row.mark)} ` : ""}${row.do ? mdInline(row.label) : `**${mdInline(row.label)}**`}${row.detail ? ` — ${mdInline(row.detail)}` : ""}`),
          "",
        ]),
        ...(preview ? ["> " + preview.replace(/\r\n?/g, "\n").trim().split("\n").join("\n> "), ""] : []),
      ];
    }
    case "row": {
      if (draw.row) return [...draw.row(node.children.map((child) => tidy(inner(child))), node), ""];
      // Side by side where each child is one line (badges, short text): a board's squares stay a row in Markdown.
      const parts = node.children.map((child) => tidy(inner(child)));
      // A row of stats (a card's fields) is a list, one a line: joined, a record's said and passage ran into one bullet.
      if (node.children.every((child) => child.type === "stat")) return [...node.children.flatMap(inner), ""];
      return parts.every((part) => part && !part.includes("\n")) ? [parts.join(" "), ""] : node.children.flatMap(inner);
    }
    // A band is its heading wherever a target can't draw tracks; a track is a thematic break.
    case "band": return node.text ? [`${"#".repeat(node.level ?? 2)} ${mdInline(node.text)}`, ""] : ["---", ""];
    case "track": return ["---", ""];
    // Its words and its file's name: a Markdown reader can't reach the outline's files, and a page never shows a path.
    case "image": return [`*image${node.alt ? `: ${mdInline(node.alt)}` : ""}* \`${fileName(imageSource(node.src)).replace(/`/g, "'")}\``, ""];
  }
}

// A list ends where a paragraph starts; collapse runs of blank lines.
const tidy = (lines: readonly string[]) => lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

/** A view as Markdown; `draw` is how the reader wants what it draws itself (a row). */
export function componentMarkdown(view: Primitive, draw: MarkdownDraw = {}): string {
  return tidy(markdownLines(view, draw));
}

const markdown = (view: Primitive) => componentMarkdown(view);

const html = (value: string | number) => String(value).replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
/** A button (PIE-1287) as the door draws it, tone, glyph, frame and fill, and inert: a page never runs what it would. */
export const buttonHtml = (label: string, look: ButtonLookWords = {}) =>
  `<span class="ep-button tone-${look.tone ?? "quiet"}${look.frame && look.frame !== "none" ? ` frame-${look.frame}` : ""}${look.fill ? " fill" : ""}" role="button" aria-disabled="true">${look.glyph ? `<span aria-hidden="true">${html(look.glyph)}</span> ` : ""}${html(label)}</span>`;

const toneClass = (value: Tone | undefined) => value && value !== "default" ? ` ext-${value}` : "";

function htmlOf(node: Primitive, count = { images: 0 }): string {
  switch (node.type) {
    case "text": {
      const text = node.strong ? `<strong>${html(node.text)}</strong>` : html(node.text);
      return `<p class="ext-text${toneClass(node.tone)}">${node.link && BLOCK_ID.test(node.link) ? `<a href="#${html(node.link)}">${text}</a>` : text}</p>`;
    }
    // The source, escaped: a reader with a Blockdown renderer draws it (the publisher, BLOCKDOWN_HTML), any other
    // shows it as written.
    case "blockdown": return `<div class="ext-blockdown">${html(node.text)}</div>`;
    case "badge": return `<span class="ext-badge${toneClass(node.tone)}">${html(node.label)}</span>`;
    // Inert (ADR 0005, readers read): a page draws the label and runs nothing.
    case "button": return buttonHtml(node.label, { tone: viewToneAsButton(node.tone) });
    case "stat": return `<div class="ext-stat${toneClass(node.tone)}"><span class="ext-label">${html(node.label)}</span> <strong>${html(statText(node))}</strong></div>`;
    case "bar": return `<div class="ext-bar${toneClass(node.tone)}"><span class="ext-label">${html(node.label)}</span> <meter min="0" max="${node.max}" value="${node.value}">${node.value}/${node.max}</meter> ${node.value}/${node.max}</div>`;
    case "sparkline": return `<div class="ext-sparkline">${node.label ? `<span class="ext-label">${html(node.label)}</span> ` : ""}${sparkline(node.values)}</div>`;
    case "checklist": return `<ul class="ext-checklist">${node.items.map((item) => `<li><input type="checkbox" disabled${item.done ? " checked" : ""}> ${html(item.label)}</li>`).join("")}</ul>`;
    case "table": return `<table class="ext-table"><thead><tr>${node.columns.map((column) => `<th>${html(column)}</th>`).join("")}</tr></thead><tbody>${
      node.rows.map((row) => `<tr>${row.map((value) => `<td>${typeof value === "object" && value.link && BLOCK_ID.test(value.link) ? `<a href="#${html(value.link)}">${html(value.text)}</a>` : html(cell(value))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    case "card": return `<section class="ext-card"><header><strong>${html(node.title)}</strong>${node.badge ? ` <span class="ext-badge${toneClass(node.badge.tone)}">${html(node.badge.label)}</span>` : ""}${
      node.subtitle ? `<div class="ext-subtitle">${html(node.subtitle)}</div>` : ""}</header>${(node.children ?? []).map((child) => htmlOf(child, count)).join("")}</section>`;
    case "box": return `<section class="ext-box">${node.title ? `<h4>${html(node.title)}</h4>` : ""}${node.children.map((child) => htmlOf(child, count)).join("")}</section>`;
    case "stack": return `<div class="ext-stack">${node.children.map((child) => htmlOf(child, count)).join("")}</div>`;
    // A `<ul>` per section, the first row's Markdown preview after it (a page has no viewer state). Inert: a row's
    // activation runs nothing here (ADR 0005, readers read).
    case "list": {
      if (node.arrange && node.rows.length) {
        const link = (ref: string, label: string) => `<span data-collection-open="${html(ref)}">${html(label)}</span>`;
        const open = (r: ListRow, label: string) => link(openedRef(r) ?? r.id, label);
        const card = (r: ListRow) => `<article class="ext-card"><h4>${open(r, r.label)}</h4>${r.cover ? `<div class="ext-cover">${html(r.cover)}</div>` : ""}<p>${html(r.detail ?? "")}</p>${(r.body ?? []).map(line => `<p>${html(line)}</p>`).join("")}</article>`;
        if (node.arrange === "table") return `<table class="ext-table"><thead><tr>${(node.headers ?? node.columns ?? ["title"]).map(key => `<th>${html(key)}</th>`).join("")}</tr></thead><tbody>${node.rows.map(r => `<tr>${(r.cells ?? [r.label]).map((cell, i) => `<td>${typeof cell === "object" && cell.link ? link(cell.link, cellText(cell)) : i === 0 ? open(r, cellText(cell)) : html(cellText(cell))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
        const style = `display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,${node.size === "large" ? 28 : 18}rem),1fr))`;
        if (node.arrange === "lanes" && node.groups?.length) return `<div class="ext-collection-lanes" style="${style}">${node.groups.map(g => `<section><h3>${html(listHead(g))}</h3>${listSections({ rows: node.rows, groups: [g] }).map(s => `${g.groups?.length && s.head ? `<h4>${html(listHead(s.head))}</h4>` : ""}${s.rows.map(card).join("")}`).join("")}</section>`).join("")}</div>`;
        return `<div class="ext-collection-${node.arrange}"${node.arrange === "grid" ? ` style="${style}"` : ""}>${node.rows.map(card).join("")}</div>`;
      }
      if (!node.rows.length) return `<p class="ext-list-empty">${html(node.empty ?? "nothing here")}</p>`;
      const preview = firstPreview(node);
      return `<div class="ext-list">${listSections(node).map(({ head, rows }) =>
        `${head ? `<h4 class="ext-list-group">${html(listHead(head))}${head.note ? ` <span class="ext-label">${html(head.note)}</span>` : ""}</h4>` : ""}<ul>${rows.map((row) =>
          `<li class="${row.do ? "ext-row-item" : "ext-row-head"}${toneClass(row.tone)}">${row.mark ? `<span class="ext-mark">${html(row.mark)}</span> ` : ""}${row.do ? html(row.label) : `<strong>${html(row.label)}</strong>`}${row.detail ? ` <span class="ext-label">${html(row.detail)}</span>` : ""}</li>`).join("")}</ul>`).join("")}${
        preview ? `<div class="ext-blockdown ext-list-preview">${html(preview)}</div>` : ""}</div>`;
    }
    case "row": return `<div class="ext-row"${node.minWidth !== undefined ? ` style="--ext-min:${node.minWidth}ch"` : ""}>${node.children.map((child) => htmlOf(child, count)).join("")}</div>`;
    case "band": {
      const level = node.level ?? 2;
      return `<div class="ext-band ext-${node.pattern ?? "rule"}${toneClass(node.tone)}" data-align="${node.align ?? "left"}" data-row="${node.row ?? "middle"}">${
        node.text ? `<h${level}>${html(node.text)}</h${level}>` : ""}</div>`;
    }
    // A place the publisher fills with the image it serves (src/publish-components.ts readImages), by its order in the
    // view; any other reader shows what a page shows for an image it can't serve: its words and its file's name.
    case "image": return `<figure class="media media-missing ext-image" data-ext-image="${count.images++}"><span class="media-what">image</span> ${
      node.alt ? `${html(node.alt)} ` : ""}<code>${html(fileName(imageSource(node.src)))}</code></figure>`;
    case "track": return `<hr class="ext-track ext-${node.pattern ?? "rule"}${toneClass(node.tone)}">`;
  }
}

/** A view's image primitives in reading order: what `data-ext-image` counts, so the publisher finds the one a page asks for. */
export function viewImages(node: Primitive): Extract<Primitive, { type: "image" }>[] {
  if (node.type === "image") return [node];
  const children = node.type === "box" || node.type === "stack" || node.type === "row" ? node.children : node.type === "card" ? node.children ?? [] : [];
  return children.flatMap(viewImages);
}

function firstList(node: Primitive): ListPrimitive | null {
  if (node.type === "list") return node;
  const children = node.type === "box" || node.type === "stack" || node.type === "row" ? node.children : node.type === "card" ? node.children ?? [] : [];
  for (const child of children) {
    const found = firstList(child);
    if (found) return found;
  }
  return null;
}

function firstTable(node: Primitive): Extract<Primitive, { type: "table" }> | null {
  if (node.type === "table") return node;
  const children = node.type === "box" || node.type === "stack" || node.type === "row" ? node.children : node.type === "card" ? node.children ?? [] : [];
  for (const child of children) {
    const found = firstTable(child);
    if (found) return found;
  }
  return null;
}

const csvCell = (value: unknown) => {
  const raw = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};

/** Rows, when there are any: the view's first table, else data that is a list of flat objects. */
function csv(output: ComponentOutput): string | null {
  const table = firstTable(output.view);
  if (table) return [table.columns, ...table.rows.map((row) => row.map(cell))].map((row) => row.map(csvCell).join(",")).join("\n");
  // A list is its rows' label and detail.
  const list = firstList(output.view);
  if (list) return [["label", "detail"], ...list.rows.map((row) => [row.label, row.detail ?? ""])].map((row) => row.map(csvCell).join(",")).join("\n");
  if (Array.isArray(output.data) && output.data.length && output.data.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
    const columns = [...new Set(output.data.flatMap((row) => Object.keys(row as object)))];
    return [columns.map(csvCell).join(","), ...output.data.map((row) => columns.map((column) => csvCell((row as Record<string, unknown>)[column])).join(","))].join("\n");
  }
  return null;
}

function fromPrimitives(output: ComponentOutput, target: RenderTarget): string | null {
  switch (target) {
    // Clean even for a result kept before the service cleaned what it keeps.
    case "terminal": return cleanExtensionText(terminalLines(output.view).join("\n"), true);
    case "markdown": return markdown(output.view);
    case "blockdown": return inertBlockdown(markdown(output.view));
    case "html": return `<div class="ext-component">${htmlOf(output.view)}</div>`;
    case "json": return JSON.stringify(output.data, null, 2);
    case "csv": return csv(output);
  }
}

/**
 * One component for one target, down the fallback chain: its own rendering,
 * then its primitives, then the requester's `fallback` (default `json`).
 */
export function renderComponent(output: ComponentOutput, target: RenderTarget, fallback: RenderTarget = "json"): RenderedComponent {
  const own = output.targets?.[target];
  if (own !== undefined) {
    // Its own HTML is kept to the page's markup: no scripts, styles, frames or handlers (src/extension-html.ts).
    const body = target === "blockdown" ? inertBlockdown(own) : target === "html" ? `<div class="ext-component">${safeExtensionHtml(own)}</div>` : cleanExtensionText(own, true);
    return { target, body, via: "component", contentType: CONTENT_TYPES[target] };
  }
  const composed = fromPrimitives(output, target);
  if (composed !== null) return { target, body: composed, via: "primitives", contentType: CONTENT_TYPES[target] };
  const backup = fromPrimitives(output, fallback === target ? "json" : fallback) ?? JSON.stringify(output.data, null, 2);
  const body = target === "html" ? `<pre class="ext-fallback">${html(backup)}</pre>` : backup;
  return { target, body, via: "fallback", contentType: target === "html" ? CONTENT_TYPES.html : CONTENT_TYPES[fallback === target ? "json" : fallback] };
}

/** Markdown for an output handler's text in a target (kind 2 has no view: markdown is its data). */
export function renderMarkdownOutput(markdownText: string, target: RenderTarget): RenderedComponent {
  switch (target) {
    case "markdown":
    case "terminal":
      return { target, body: cleanExtensionText(markdownText, true), via: "primitives", contentType: CONTENT_TYPES[target] };
    case "blockdown":
      return { target, body: inertBlockdown(markdownText), via: "primitives", contentType: CONTENT_TYPES.blockdown };
    case "html":
      return { target, body: `<pre class="ext-output">${html(markdownText)}</pre>`, via: "fallback", contentType: CONTENT_TYPES.html };
    case "json":
      return { target, body: JSON.stringify({ markdown: markdownText }, null, 2), via: "primitives", contentType: CONTENT_TYPES.json };
    case "csv":
      return { target, body: JSON.stringify({ markdown: markdownText }, null, 2), via: "fallback", contentType: CONTENT_TYPES.json };
  }
}
