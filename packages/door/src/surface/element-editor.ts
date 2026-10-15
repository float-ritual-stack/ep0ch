// A rendered view of a Draft, never another text buffer. Adapters own source spans and structural
// operations; Draft owns typing, selection, undo, revisions and incoming patches.
import { componentBlocks, noteStructure } from "@ep0ch/outline-core/component-block";
import { figureProps, figureSource } from "@ep0ch/outline-core/figure-props";
import * as T from "@ep0ch/outline-core/table-shape";
import { type Draft } from "../edit";
import { table, type TableCellBox } from "../doc";
import { C, fg, RESET, visible, width, pad } from "../style";
import { SELECT_BG } from "./selection";
import { USER, type Actor } from "../socket";
import type { Key } from "../term";

export interface ElementField { line: number; start: number; end: number; value: string }
export type ElementOperation = "row.add" | "row.remove" | "column.add" | "column.remove" | "row.move" | "column.move";
export interface EditableElement {
  start: number; end: number;
  fields: ElementField[][];
  /** Replacement source for this element only. Null means the operation cannot apply. */
  change(op: ElementOperation, row: number, col: number, to?: number): string[] | null;
  encode(value: string): string;
  /** Draw through the component's existing renderer and report its field hit boxes. */
  draw(values: string[][], width: number): { lines: string[]; cells: TableCellBox[] };
}
/** An extension supplies source mappings, not an editor, save path or private draft. */
export interface ElementEditor {
  id: string;
  read(lines: readonly string[]): EditableElement[];
}

export function drawTableFields(values: string[][], width: number) {
  const rows = values.map(row => `| ${row.map(T.encodeCell).join(" | ")} |`);
  rows.splice(1, 0, `| ${values[0]?.map(() => "---").join(" | ")} |`);
  const cells: TableCellBox[] = [];
  return { lines: table(rows, width, true, cell => cells.push(cell)), cells };
}

const editors = new Map<string, ElementEditor>();
export function registerElementEditor(editor: ElementEditor): () => void {
  if (editors.has(editor.id)) throw new Error(`element editor ${editor.id} is already registered`);
  editors.set(editor.id, editor);
  return () => { if (editors.get(editor.id) === editor) editors.delete(editor.id); };
}
const fieldsOf = (lines: readonly string[], start: number) => lines.flatMap((l, i) => i === 1 ? [] : [T.tableCells(l).map(c => ({ ...c, value: c.text, line: start + i }))]);
function changeRows(rows: string[], op: ElementOperation, row: number, col: number, to?: number): string[] | null {
  const r = row ? row + 1 : 0;
  const result = op === "row.add" ? T.insertRow(rows, r + 1)
    : op === "row.remove" ? T.removeRow(rows, r)
    : op === "column.add" ? T.insertColumn(rows, col + 1)
    : op === "column.remove" ? T.removeColumn(rows, col)
    : op === "row.move" ? T.moveRow(rows, r, to === undefined ? r + 1 : to ? to + 1 : 0)
    : T.moveColumn(rows, col, to ?? col + 1);
  return result?.rows ?? null;
}
registerElementEditor({
  id: "table",
  read(lines) {
    const structure = noteStructure(lines), out: EditableElement[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (structure[i] !== -1 || !T.startsTable(lines, i)) continue;
      const start = i, end = T.tableEnd(lines, i), rows = lines.slice(start, end);
      out.push({ start, end, fields: fieldsOf(rows, start), encode: T.encodeCell, draw: drawTableFields,
        change: (op, row, col, to) => changeRows(rows, op, row, col, to) });
      i = end - 1;
    }
    return out;
  },
});

// Graph tables retain their other YAML fields. Only headers/rows are rewritten, as JSON flow
// sequences (also YAML), so every value has an exact editable source span. Queries stay service-owned.
function graphData(lines: readonly string[], start: number, end: number) {
  const source = figureSource(lines.slice(start + 1, end - 1));
  const parsed = figureProps("table", source);
  if ("error" in parsed) return null;
  const p = parsed.props;
  if (p.query || p.view || p.source || !Array.isArray(p.rows) || !Array.isArray(p.headers)) return null;
  return [p.headers.map(String), ...p.rows.map((r: unknown) => (Array.isArray(r) ? r : [r]).map(String))] as string[][];
}
function graphWrite(lines: readonly string[], values: string[][]): string[] {
  const out = [...lines];
  const ranges: { key: string; start: number; end: number }[] = [];
  for (let i = 0; i < out.length; i++) {
    const key = /^(headers|rows):/.exec(out[i]!);
    if (!key) continue;
    let end = i + 1;
    while (end < out.length && !/^(?:[^\s#][^:]*:|---\s*$|::\s*$)/.test(out[end]!)) end++;
    ranges.push({ key: key[1]!, start: i, end });
  }
  for (const r of ranges.reverse()) out.splice(r.start, r.end - r.start, ...(r.key === "headers"
    ? [`headers: ${JSON.stringify(values[0] ?? [])}`]
    : [values.length > 1 ? "rows:" : "rows: []", ...values.slice(1).map(row => `  - ${JSON.stringify(row)}`)]));
  return out;
}
function graphFields(lines: readonly string[], start: number): ElementField[][] {
  const out: ElementField[][] = [];
  let rows = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l === "rows:") { rows = true; continue; }
    if (rows && /^\S/.test(l)) rows = false;
    if (!/^headers: \[/.test(l) && !(rows && /^  - \[/.test(l))) continue;
    const fields: ElementField[] = [];
    for (const m of l.matchAll(/"(?:\\.|[^"\\])*"/g)) fields.push({ line: start + i, start: m.index! + 1, end: m.index! + m[0].length - 1, value: JSON.parse(m[0]) });
    out.push(fields);
  }
  return out;
}
registerElementEditor({
  id: "graph-table",
  read(lines) {
    return componentBlocks(lines).flatMap(b => {
      if (b.name !== "graph-table" || b.args !== null) return [];
      const end = b.end + 1, values = graphData(lines, b.start, end);
      if (!values) return [];
      const source = lines.slice(b.start, end), normalized = graphWrite(source, values);
      if (normalized.join("\n") !== source.join("\n")) return [];
      return [{ start: b.start, end, fields: graphFields(source, b.start), draw: drawTableFields, encode: (s: string) => JSON.stringify(s).slice(1, -1),
        change(op: ElementOperation, row: number, col: number, to?: number) {
          const rows = values.map(r => `| ${r.map(T.encodeCell).join(" | ")} |`);
          rows.splice(1, 0, `| ${values[0]!.map(() => "---").join(" | ")} |`);
          const changed = changeRows(rows, op, row, col, to);
          return changed && graphWrite(source, changed.flatMap((r, i) => i === 1 ? [] : [T.tableCells(r).map(c => c.text)]));
        } }];
    });
  },
});

export class ElementEdit {
  on = false;
  private top = 0;
  private painted: { text: string; cursor: number } | null = null;
  private spots: { x: number; y: number; width: number; field: ElementField }[] = [];
  private controls: { from: number; to: number; action: "rich.toggle" | "rich.move" | "rich.change" | "draft.place"; op?: string }[] = [];
  constructor(readonly draft: Draft) {}
  elements() { return [...editors.values()].flatMap(e => e.read(this.draft.lines)).sort((a, b) => a.start - b.start); }
  current() {
    const d = this.draft;
    for (const element of this.elements()) for (let row = 0; row < element.fields.length; row++) for (let col = 0; col < element.fields[row]!.length; col++) {
      const field = element.fields[row]![col]!;
      if (field.line === d.row && d.col >= field.start && d.col <= field.end) return { element, field, row, col };
    }
    return null;
  }
  open(by: Actor) {
    const d = this.draft;
    if (d.busy) throw new Error("the save is still landing");
    // Normalize only static graph table data, once, in the same undo history.
    const lines = [...d.lines];
    for (const b of componentBlocks(lines).reverse()) {
      if (b.name !== "graph-table" || b.args !== null) continue;
      const values = graphData(lines, b.start, b.end + 1);
      if (values) lines.splice(b.start, b.end + 1 - b.start, ...graphWrite(lines.slice(b.start, b.end + 1), values));
    }
    if (lines.join("\n") !== d.text) d.replace(lines.join("\n"), by, "table fields", true);
    this.on = true;
    if (!this.current()) {
      const fields = this.elements().flatMap(e => e.fields.flat());
      const f = fields.find(f => f.line >= d.row) ?? fields[0];
      if (f) d.place(f.line, f.start);
    }
  }
  move(direction: string) {
    const cur = this.current(), fields = this.elements().flatMap(e => e.fields.flat());
    if (!cur) { const f = fields.find(f => f.line >= this.draft.row) ?? fields[0]; if (f) this.draft.place(f.line, f.start); return; }
    const { element: e, field: f, row, col } = cur;
    const next = direction === "up" ? e.fields[row - 1]?.[col] : direction === "down" ? e.fields[row + 1]?.[col]
      : fields[fields.findIndex(x => x.line === f.line && x.start === f.start) + (direction === "previous" || direction === "left" ? -1 : 1)];
    if (next) this.draft.place(next.line, next.start);
    else { this.on = false; this.draft.place(direction === "up" ? Math.max(0, e.start - 1) : Math.min(this.draft.lines.length - 1, e.end), 0); }
  }
  set(value: string, by: Actor) {
    if (this.draft.busy) throw new Error("the save is still landing");
    const c = this.current(); if (!c) throw new Error("choose a table cell first; rich.move direction=next");
    this.draft.splice(c.field.start, c.field.end, c.element.encode(value), {}, by);
  }
  change(op: ElementOperation, by: Actor, to?: number) {
    if (this.draft.busy) throw new Error("the save is still landing");
    const c = this.current(); if (!c) throw new Error("choose a table cell first; rich.move direction=next");
    const result = c.element.change(op, c.row, c.col, to);
    if (!result) throw new Error("that operation would remove the header or last column, or move outside the table");
    const lines = [...this.draft.lines]; lines.splice(c.element.start, c.element.end - c.element.start, ...result);
    this.draft.replace(lines.join("\n"), by, op, true);
    const e = this.elements().find(e => e.start === c.element.start);
    const row = Math.min(e!.fields.length - 1, c.row + (op === "row.add" ? 1 : 0));
    const f = e?.fields[row]?.[Math.min(e.fields[row]!.length - 1, c.col + (op === "column.add" ? 1 : 0))];
    if (f) this.draft.place(f.line, f.start);
  }
  /** Only the draft's existing key handler types. Clamp it to the source field, keeping the delimiters. */
  key(k: Key, run: (action: "rich.toggle" | "rich.move" | "rich.change" | "draft.place", args?: Record<string, unknown>) => void): boolean {
    if (k.kind === "char" && k.ctrl && k.ch === "o") { run("rich.toggle"); return true; }
    if (!this.on) return false;
    if (this.draft.busy) return true;
    if (k.kind === "esc") { run("rich.toggle", { on: false }); return true; }
    if (["tab", "backtab", "up", "down", "enter"].includes(k.kind)) { run("rich.move", { direction: k.kind === "backtab" ? "previous" : k.kind === "tab" || k.kind === "enter" ? "next" : k.kind }); return true; }
    const c = this.current(); if (!c) { this.on = false; return false; }
    if (k.kind === "char" && !k.ctrl && c.element.encode(k.ch) !== k.ch) {
      this.draft.pasteText(c.element.encode(k.ch), USER); return true;
    }
    if (k.kind === "alt" && ["r", "c", "d", "x"].includes(k.ch)) { run("rich.change", { op: ({ r: "row.add", c: "column.add", d: "row.remove", x: "column.remove" } as Record<string, string>)[k.ch] }); return true; }
    if (k.kind === "char" && k.ctrl && ["a", "e", "k"].includes(k.ch)) {
      if (k.ch === "k") this.draft.splice(this.draft.col, c.field.end, "");
      else run("draft.place", { line: c.field.line + 1, col: (k.ch === "a" ? c.field.start : c.field.end) + 1 });
      return true;
    }
    if (k.kind === "home" || k.kind === "end") { run("draft.place", { line: c.field.line + 1, col: (k.kind === "home" ? c.field.start : c.field.end) + 1, extend: !!k.shift }); return true; }
    if ((k.kind === "backspace" || k.kind === "left") && this.draft.col <= c.field.start && !this.draft.anchor) return true;
    if ((k.kind === "delete" || k.kind === "right") && this.draft.col >= c.field.end && !this.draft.anchor) return true;
    return false;
  }
  click(x: number, y: number, run: (action: "rich.toggle" | "rich.move" | "rich.change" | "draft.place", args?: Record<string, unknown>) => void, extend = false, press = false) {
    if (y === 0 && press) return true;
    if (y === 0) { const c = this.controls.find(c => x >= c.from && x < c.to); if (c) { run(c.action, c.op ? { op: c.op } : {}); return true; } }
    const s = this.spots.find(s => y === s.y && x >= s.x && x < s.x + s.width);
    if (!s) return false;
    const current = this.current();
    if (extend && current && (current.field.line !== s.field.line || current.field.start !== s.field.start)) return true;
    run("draft.place", { line: s.field.line + 1, col: Math.min(s.field.end, s.field.start + Math.max(0, x - s.x - 1)) + 1, extend });
    return true;
  }
  render(w: number, h: number, draw: (text: string, width: number) => string[]): string[] {
    const d = this.draft, cur = this.current();
    const labels = [["[raw ^O]", "rich.toggle"], ["[+row]", "rich.change", "row.add"], ["[-row]", "rich.change", "row.remove"], ["[+col]", "rich.change", "column.add"], ["[-col]", "rich.change", "column.remove"]];
    let x = 0; this.controls = labels.map(([label, action, op]) => { const c = { from: x, to: x + label!.length, action: action as "rich.toggle" | "rich.change", op }; x += label!.length + 1; return c; });
    const body: string[] = [], spots: typeof this.spots = [];
    let at = 0, cursor = 0;
    for (const e of this.elements()) {
      if (e.start > at) body.push(...draw(d.lines.slice(at, e.start).join("\n"), w));
      const values = e.fields.map(row => row.map(f => {
        // Source spelling while editing keeps escaped characters and the cursor honest.
        let text = d.lines[f.line]!.slice(f.start, f.end);
        if (f.line === d.row && d.col >= f.start && d.col <= f.end) {
          const offset = d.col - f.start;
          text = text.slice(0, offset) + "▏" + text.slice(offset);
          text = SELECT_BG + text + RESET;
        }
        return text;
      }));
      const painted = e.draw(values, w), rendered = painted.lines, base = body.length;
      for (const box of painted.cells) {
        const f = e.fields[box.row]?.[box.col];
        if (!f) continue;
        spots.push({ x: box.x, y: base + box.y, width: box.width, field: f });
        if (cur?.field.line === f.line && cur.field.start === f.start) cursor = base + box.y;
      }
      body.push(...rendered); at = e.end;
    }
    if (at < d.lines.length) body.push(...draw(d.lines.slice(at).join("\n"), w));
    const room = Math.max(1, h - 2);
    if (this.painted && this.painted.text !== d.text && cur) this.top = Math.max(0, this.top + cursor - this.painted.cursor);
    this.painted = { text: d.text, cursor };
    if (cursor < this.top) this.top = cursor;
    if (cursor >= this.top + room) this.top = cursor - room + 1;
    this.spots = spots.map(s => ({ ...s, y: s.y - this.top + 2 }));
    d.frame = null;
    return [fg(C.lcyan) + pad(labels.map(l => l[0]).join(" "), w) + RESET,
      fg(C.cyan) + pad(d.note || "Tab/↑↓ cells · alt+r/d row · alt+c/x column · ctrl+s save · ctrl+o raw", w) + RESET,
      ...body.slice(this.top, this.top + room)];
  }
}
const views = new WeakMap<Draft, ElementEdit>();
export function elementEdit(d: Draft): ElementEdit { let v = views.get(d); if (!v) { v = new ElementEdit(d); views.set(d, v); } return v; }
