import { sourceLines } from "../draft-view";
import { editState, saidRows } from "./editor";
import { modeBinding, modeHint, type ModeKey } from "./modes";
import { keyTable } from "./keymap";
import { PositionRows } from "../reader-position";
// A rendered view of a Draft, never another text buffer. Adapters own source spans and structural
// operations; Draft owns typing, selection, undo, revisions and incoming patches.
import { componentBlocks, noteStructure } from "@ep0ch/outline-core/component-block";
import { figureProps, figureSource } from "@ep0ch/outline-core/figure-props";
import * as T from "@ep0ch/outline-core/table-shape";
import { type Draft } from "../edit";
import { table, type TableCellBox } from "../doc";
import { C, fg, RESET, pad, width } from "../style";
import { SELECT_BG } from "./selection";
import { type Actor } from "../socket";
import type { Key } from "../term";
import { lastTop, pageRows, scrolled, follow } from "../scroll";

export interface ElementField { line: number; start: number; end: number; paddingEnd?: number; escapes?: RegExp; value: string; encode?: (value: string) => string; decode?: (source: string) => string }
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

export function drawTableFields(values: string[][], width: number, separator?: string) {
  const rows = values.map(row => `| ${row.map(T.encodeCell).join(" | ")} |`);
  rows.splice(1, 0, separator ?? `| ${values[0]?.map(() => "---").join(" | ")} |`);
  const cells: TableCellBox[] = [];
  return { lines: table(rows, width, true, cell => cells.push(cell)), cells };
}

const editors = new Map<string, ElementEditor>();
export function registerElementEditor(editor: ElementEditor): () => void {
  if (editors.has(editor.id)) throw new Error(`element editor ${editor.id} is already registered`);
  editors.set(editor.id, editor);
  return () => { if (editors.get(editor.id) === editor) editors.delete(editor.id); };
}
const fieldsOf = (lines: readonly string[], start: number) => lines.flatMap((l, i) => i === 1 ? [] : [T.tableCells(l).map(c => ({ ...c, value: c.text, line: start + i, escapes: T.cellEscapes }))]);
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
      out.push({ start, end, fields: fieldsOf(rows, start), encode: T.encodeCell, draw: (values, width) => drawTableFields(values, width, rows[1]),
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
function graphYaml(lines: readonly string[]) {
  const body = lines.slice(1, -1), yaml = figureSource(body).yaml;
  const start = body.findIndex(line => /^\s*---\s*$/.test(line)) + 2;
  return { start, end: start + (yaml ? yaml.split("\n").length : 0) };
}
function graphWrite(lines: readonly string[], values: string[][], op: ElementOperation, row: number, to?: number): string[] {
  const out = [...lines], fields = graphFields(lines, 0), yaml = graphYaml(lines);
  const rowsLine = lines.findIndex((line, i) => i >= yaml.start && i < yaml.end && /^rows:/.test(line));
  if (op === "row.add") {
    if (fields.length === 1) out[rowsLine] = out[rowsLine]!.replace(/ ?\[\s*\]/, "");
    const after = row === 0 ? rowsLine : fields[row]![0]!.line;
    out.splice(after + 1, 0, `  - ${JSON.stringify(values[row + 1])}`);
  } else if (op === "row.remove") {
    out.splice(fields[row]![0]!.line, 1);
    if (fields.length === 2) out[rowsLine] = out[rowsLine]!.replace("rows:", "rows: []");
  } else if (op === "row.move") {
    // Move row source through the existing row slots; comments between them belong to the note.
    const source = fields.slice(1).map(r => lines[r[0]!.line]!);
    const [moved] = source.splice(row - 1, 1);
    source.splice((to ?? row + 1) - 1, 0, moved!);
    fields.slice(1).forEach((r, i) => { out[r[0]!.line] = source[i]!; });
  } else {
    fields.forEach((r, i) => {
      const line = r[0]!.line, source = lines[line]!;
      out[line] = source.slice(0, source.indexOf("[")) + JSON.stringify(values[i]) + source.slice(source.indexOf("]", r.at(-1)!.end) + 1);
    });
  }
  return out;
}
function graphFields(lines: readonly string[], start: number): ElementField[][] {
  const out: ElementField[][] = [], yaml = graphYaml(lines);
  let headers: ElementField[] = [];
  let rows = false;
  for (let i = yaml.start; i < yaml.end; i++) {
    const l = lines[i]!;
    if (/^rows:\s*(?:#.*)?$/.test(l)) { rows = true; continue; }
    if (rows && /^(?!#)\S/.test(l)) rows = false;
    if (!/^headers: \[/.test(l) && !(rows && /^  - \[/.test(l))) continue;
    const fields: ElementField[] = [];
    const from = l.indexOf("[") + 1, to = l.lastIndexOf("]");
    if (to < from) continue;
    const body = l.slice(from, to);
    for (const m of body.matchAll(/"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[^,\s][^,]*/g)) {
      const raw = m[0].trim(), offset = from + m.index! + m[0].indexOf(raw);
      if (!raw) continue;
      const quoted = raw.startsWith('"') || raw.startsWith("'");
      let value: unknown;
      try { value = Bun.YAML.parse(raw); } catch { return []; }
      if (value !== null && typeof value === "object") return [];
      fields.push({ line: start + i, start: offset + (quoted ? 1 : 0), end: offset + raw.length - (quoted ? 1 : 0),
        value: String(value ?? ""), ...(quoted ? { escapes: raw.startsWith("'") ? /''/g : /\\(?:u[0-9a-fA-F]{4}|[\s\S])/gu } : {}), ...(raw.startsWith("'") ? { encode: (s: string) => s.replace(/'/g, "''"), decode: (s: string) => s.replace(/''/g, "'") }
          : !quoted ? { encode: (s: string) => JSON.stringify(s) } : {}) });
    }
    if (l.startsWith("headers:")) headers = fields; else out.push(fields);
  }
  return [headers, ...out];
}
registerElementEditor({
  id: "graph-table",
  read(lines) {
    return componentBlocks(lines).flatMap(b => {
      if (b.name !== "graph-table" || b.args !== null) return [];
      const end = b.end + 1, values = graphData(lines, b.start, end);
      if (!values) return [];
      const source = lines.slice(b.start, end);

      const fields = graphFields(source, b.start);
      if (fields.length !== values.length || fields.some((r, i) => r.length !== values[i]!.length)) return [];
      return [{ start: b.start, end, fields, draw: drawTableFields, encode: (s: string) => JSON.stringify(s).slice(1, -1),
        change(op: ElementOperation, row: number, col: number, to?: number) {
          const rows = values.map(r => `| ${r.map(v => T.encodeCell(JSON.stringify(v))).join(" | ")} |`);
          rows.splice(1, 0, `| ${values[0]!.map(() => "---").join(" | ")} |`);
          const changed = changeRows(rows, op, row, col, to);
          return changed && graphWrite(source, changed.flatMap((r, i) => i === 1 ? [] : [T.tableCells(r).map(c => c.text ? JSON.parse(c.text) as string : "")]), op, row, to);
        } }];
    });
  },
});

/**
 * A table or figure being edited as cells: its keys, one table `key()` matches and the hint draws, the person's keymap
 * applied (PIE-1542). Typing in a cell is the edit control's.
 */
export const ELEMENT_KEYS: readonly ModeKey[] = keyTable("rich", "a table or figure being edited as cells", [
  { key: "tab", action: "rich.move", args: { direction: "next" }, label: "cells", says: "move to the next cell" }, { key: "enter", action: "rich.move", args: { direction: "next" }, label: "cells", says: "move to the next cell" },
  { key: "shift+tab", action: "rich.move", args: { direction: "previous" }, label: "cells", says: "move to the previous cell" },
  { key: "up", action: "rich.move", args: { direction: "up" }, label: "cells", says: "move to the cell above" }, { key: "down", action: "rich.move", args: { direction: "down" }, label: "cells", says: "move to the cell below" },
  { key: "alt+r", action: "rich.change", args: { op: "row.add" }, label: "row", says: "add a row under the cell" }, { key: "alt+d", action: "rich.change", args: { op: "row.remove" }, label: "row", says: "remove the cell's row" },
  { key: "alt+v", action: "rich.change", args: { op: "column.add" }, label: "column", says: "add a column after the cell" }, { key: "alt+x", action: "rich.change", args: { op: "column.remove" }, label: "column", says: "remove the cell's column" },
  { key: "ctrl+s", action: "edit.save", label: "save", says: "save the note" }, { key: "ctrl+o", action: "rich.toggle", label: "raw", says: "edit the table or figure as its raw text again" },
]);

export class ElementEdit {
  on = false;
  private positionRows: PositionRows;
  private get top() { return this.positionRows.top; }
  private set top(value: number) { this.positionRows.top = value; }
  get scrollFigure() { return { top: this.top, room: this.room, total: this.total }; }
  private total = 0;
  private room = 1;
  scroll(by: number) {
    this.top = scrolled(this.top, by, lastTop(this.total, this.room));
    this.draft.follow = false;
  }
  private spots: (TableCellBox & { field: ElementField; caret?: number })[] = [];
  private controls: { from: number; to: number; action: "rich.toggle" | "rich.move" | "rich.change" | "rich.input" | "rich.scroll" | "rich.erase" | "draft.place"; op?: string }[] = [];
  constructor(readonly draft: Draft) { this.positionRows = new PositionRows(draft.position); this.positionRows.origin = 2; }
  elements() {
    const d = this.draft;
    const elements = [...editors.values()].flatMap(e => e.read(d.lines)).sort((a, b) => a.start - b.start);
    // A typed trailing space is content at the caret, even while the table grammar trims it as padding.
    for (const e of elements) for (const row of e.fields) for (const f of row) {
      if (f.line === d.row && d.col > f.end && d.col <= (f.paddingEnd ?? f.end)) f.end = d.col;
    }
    return elements;
  }
  current() {
    const d = this.draft;
    for (const element of this.elements()) for (let row = 0; row < element.fields.length; row++) for (let col = 0; col < element.fields[row]!.length; col++) {
      const field = element.fields[row]![col]!;
      if (field.line === d.row && d.col >= field.start && d.col <= field.end) return { element, field, row, col };
    }
    return null;
  }
  /** The cell the cursor is in, by its place in the note's tables: what a reload finds again (`landIn`). */
  cellNow() {
    const c = this.current();
    return c && { element: this.elements().findIndex(e => e.start === c.element.start), head: this.draft.lines[c.element.start], row: c.row, col: c.col };
  }
  /**
   * The text changed under rich edit (a reload): the cursor goes to the end of the same cell, or the nearest one left, so
   * the next key lands in a cell and never in the table's syntax. When the table at that number isn't the same one (its
   * first row differs: "changed") or none is left ("gone"), rich edit closes and the cursor waits on a line of its own at
   * the note's end: what's typed next goes neither into a table's syntax nor onto someone else's sentence.
   */
  landIn(cell: ReturnType<ElementEdit["cellNow"]>): "kept" | "changed" | "gone" {
    // The cursor is still where the old text had it: in the new text that can be a cell's padding, which `elements` would take for what's typed.
    this.draft.col = 0;
    const es = cell ? this.elements() : [], e = cell && es[cell.element];
    const row = e?.fields[cell?.row ?? 0] ?? e?.fields.at(-1), f = row?.[cell?.col ?? 0] ?? row?.at(-1);
    if (f && this.draft.lines[e?.start ?? -1] === cell?.head) { this.draft.place(f.line, f.end); return "kept"; }
    this.on = false;
    this.draft.landAtEnd();
    return e ? "changed" : "gone";
  }
  open(by: Actor) {
    const d = this.draft;
    if (d.busy) throw new Error("the save is still landing");
    this.on = true;
    // A raw selection can cross prose and delimiters; rich input belongs to one field.
    d.place(d.row, d.col);
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
    this.draft.splice(c.field.start, c.field.end, (c.field.encode ?? c.element.encode)(value), {}, by);
    const f = this.elements().find(e => e.start === c.element.start)?.fields[c.row]?.[c.col];
    if (f) this.draft.place(f.line, f.end);
  }
  private atom(field: ElementField, at: number) {
    const source = this.draft.lines[field.line]!.slice(field.start, field.end);
    if (!field.escapes) return null;
    for (const m of source.matchAll(field.escapes)) {
      const start = field.start + m.index!, end = start + m[0].length;
      if (start <= at && at < end) return { start, end };
    }
    return null;
  }
  erase(backward: boolean, by: Actor) {
    const c = this.current(); if (!c) return;
    const d = this.draft, atom = this.atom(c.field, backward ? d.col - 1 : d.col);
    if (c.field.encode) {
      if (!d.anchor) {
        if (backward ? d.col <= c.field.start : d.col >= c.field.end) return;
        // Select with the draft's cursor rules, then encode the remaining value as typing does.
        if (atom) d.place(d.row, backward ? atom.start : atom.end, true);
        else d.key({ kind: backward ? "left" : "right", shift: true });
      }
      this.input("", by);
    } else if (atom) d.splice(atom.start, atom.end, "", {}, by);
  }
  input(text: string, by: Actor, cut = false) {
    const c = this.current(); if (!c) return;
    const d = this.draft;
    if (cut && c.field.encode) this.set((c.field.decode ?? ((s: string) => s))(d.lines[d.row]!.slice(c.field.start, d.col)), by);
    else if (cut) d.splice(d.col, c.field.end, "", {}, by);
    else if (c.field.encode) {
      const anchor = d.anchor?.row === d.row ? d.anchor.col : d.col;
      const start = Math.max(c.field.start, Math.min(d.col, anchor)), end = Math.min(c.field.end, Math.max(d.col, anchor));
      const line = d.lines[d.row]!;
      const decode = c.field.decode ?? ((s: string) => s);
      const prefix = decode(line.slice(c.field.start, start)) + text;
      this.set(prefix + decode(line.slice(end, c.field.end)), by);
      const next = this.current();
      if (next) d.place(next.field.line, next.field.start + (next.field.encode ?? next.element.encode)(prefix).length);
    } else d.pasteText(c.element.encode(text), by);
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
  key(k: Key, run: (action: "rich.toggle" | "rich.move" | "rich.change" | "rich.input" | "rich.scroll" | "rich.erase" | "draft.place", args?: Record<string, unknown>) => void): boolean {
    // shift with ↑ ↓ ⏎ is the key itself in a cell: it moves between cells, never selects out of one (PIE-1542 review).
    const plain = (k.kind === "up" || k.kind === "down" || k.kind === "enter") && "shift" in k && k.shift && !("pasted" in k && k.pasted) ? ({ kind: k.kind } as Key) : k;
    const bound = modeBinding(ELEMENT_KEYS, plain);
    if (bound?.action === "rich.toggle") { run("rich.toggle"); return true; }
    if (!this.on) return false;
    if (this.draft.busy) return true;
    if (k.kind === "pgup" || k.kind === "pgdn") { run("rich.scroll", { by: (k.kind === "pgup" ? -1 : 1) * pageRows(this.room) }); return true; }
    this.draft.follow = true;
    if (k.kind === "esc") { run("rich.toggle", { on: false }); return true; }
    if (bound?.action === "rich.move" || bound?.action === "rich.change") { run(bound.action, bound.args); return true; }
    const c = this.current(); if (!c) { this.on = false; return false; }
    if (k.kind === "paste" || (k.kind === "char" && !k.ctrl && (c.field.encode || c.element.encode(k.ch) !== k.ch)) || k.kind === "alt-enter" || (k.kind === "enter" && "pasted" in k)) {
      run("rich.input", { text: k.kind === "paste" ? k.text : k.kind === "char" ? k.ch : "\n" }); return true;
    }
    if ((k.kind === "backspace" || k.kind === "delete") && c.field.encode) {
      run("rich.erase", { backward: k.kind === "backspace" }); return true;
    }
    if (["backspace", "delete", "left", "right"].includes(k.kind)) {
      const backward = k.kind === "backspace" || k.kind === "left";
      const atom = this.atom(c.field, this.draft.col - (backward ? 1 : 0));
      if (atom && atom.end - atom.start > 1) {
        if (k.kind === "left" || k.kind === "right") {
          run("draft.place", { line: c.field.line + 1, col: (backward ? atom.start : atom.end) + 1, extend: !!k.shift }); return true;
        }
        if (!this.draft.anchor) { run("rich.erase", { backward }); return true; }
      }
    }
    if (k.kind === "char" && k.ctrl && ["a", "e", "k"].includes(k.ch)) {
      if (k.ch === "k") run("rich.input", { text: "", cut: true });
      else run("draft.place", { line: c.field.line + 1, col: (k.ch === "a" ? c.field.start : c.field.end) + 1 });
      return true;
    }
    if (k.kind === "home" || k.kind === "end") { run("draft.place", { line: c.field.line + 1, col: (k.kind === "home" ? c.field.start : c.field.end) + 1, extend: !!k.shift }); return true; }
    if ((k.kind === "left" || (k.kind === "backspace" && !this.draft.anchor)) && this.draft.col <= c.field.start) return true;
    if ((k.kind === "right" || (k.kind === "delete" && !this.draft.anchor)) && this.draft.col >= c.field.end) return true;
    return false;
  }
  click(x: number, y: number, run: (action: "rich.toggle" | "rich.move" | "rich.change" | "rich.input" | "rich.scroll" | "rich.erase" | "draft.place", args?: Record<string, unknown>) => void, extend = false, press = false) {
    if (y === 0 && press) return true;
    if (y === 0) { const c = this.controls.find(c => x >= c.from && x < c.to); if (c) { run(c.action, c.op ? { op: c.op } : {}); return true; } }
    const s = this.spots.find(s => y === s.y && x >= s.x && x < s.x + s.width);
    if (!s) return false;
    const current = this.current();
    if (extend && current && (current.field.line !== s.field.line || current.field.start !== s.field.start)) return true;
    const cellX = Math.max(0, x - s.x - s.inset);
    let offset = s.offset, used = 0;
    for (const ch of s.text) { if (used + width(ch) > cellX) break; used += width(ch); offset += ch.length; }
    if (s.caret !== undefined && offset > s.caret) offset--;
    const col = Math.min(s.field.end, s.field.start + offset);
    const atom = this.atom(s.field, col);
    run("draft.place", { line: s.field.line + 1, col: (atom?.start ?? col) + 1, extend });
    return true;
  }
  render(w: number, h: number, draw: (text: string, width: number) => { lines: string[]; source: number[] }, attribution?: string): string[] {
    const d = this.draft, cur = this.current();
    const labels = [["[raw ^O]", "rich.toggle"], ["[+row]", "rich.change", "row.add"], ["[-row]", "rich.change", "row.remove"], ["[+col]", "rich.change", "column.add"], ["[-col]", "rich.change", "column.remove"]];
    let x = 0; this.controls = labels.map(([label, action, op]) => { const c = { from: x, to: x + label!.length, action: action as "rich.toggle" | "rich.change", op }; x += label!.length + 1; return c; });
    const body: string[] = [], spots: typeof this.spots = [];
    const hidden = d.hiddenAnswerLines();
    const sourceRows: number[] = [];
    const prose = (start: number, end: number) => {
      let lines: number[] = [], text: string[] = [];
      const flush = () => {
        if (!text.length) return;
        const doc = draw(text.join("\n"), w);
        body.push(...doc.lines);
        sourceRows.push(...doc.source.map(i => lines[i] ?? -1));
        lines = []; text = [];
      };
      // The lines as the raw rows lay them out (src/draft-view.ts): only their drawing is the reader's here.
      for (const l of sourceLines(d, start, end, w, (_, line) => w - width(line))) {
        text.push(l.line + (l.beside ? l.status : "")); lines.push(l.i);
        if (l.status && !l.beside) { text.push(l.status.trim()); lines.push(l.i); }
        if (l.kept.length) { flush(); body.push(...l.kept); sourceRows.push(...l.kept.map(() => l.i)); }
      }
      flush();
    };
    let at = 0, cursor = 0;
    for (const e of this.elements()) {
      if (hidden.has(e.start)) continue;
      if (e.start > at) prose(at, e.start);
      const values = e.fields.map(row => row.map(f => {
        // Source spelling while editing keeps escaped characters and the cursor honest.
        let text = d.lines[f.line]!.slice(f.start, f.end);
        if (f.line === d.row && d.col >= f.start && d.col <= f.end) {
          const offset = d.col - f.start;
          text = text.slice(0, offset) + "│" + text.slice(offset);
          text = SELECT_BG + text + RESET;
        }
        return text;
      }));
      const painted = e.draw(values, w), rendered = painted.lines, base = body.length;
      for (const box of painted.cells) {
        const f = e.fields[box.row]?.[box.col];
        if (!f) continue;
        const active = cur?.field.line === f.line && cur.field.start === f.start;
        spots.push({ ...box, y: base + box.y, field: f, ...(active ? { caret: d.col - f.start } : {}) });
        if (active && d.col - f.start >= box.offset && d.col - f.start <= box.offset + box.text.length) cursor = base + box.y;
      }
      sourceRows.push(...rendered.map((_, y) => spots.find(s => s.y === base + y)?.field.line ?? -1));
      body.push(...rendered); at = e.end;
    }
    if (at < d.lines.length) prose(at, d.lines.length);
    // What the draft says, whole, up to three rows; a command held during a reload is said over "reloading…".
    const said = (d.status.phase === "reloading" && d.note) || d.status.doing || d.note;
    const under = said ? saidRows(said, w, Math.min(3, Math.max(1, h - 4)), C.cyan) : [fg(C.cyan) + pad(attribution || modeHint(ELEMENT_KEYS, () => undefined), w) + RESET];
    // The draft's state on its own row, as the raw edit draws it (a change elsewhere takes that row: nothing moves). A box
    // with room for one row keeps the state when something's wrong (PIE-1560).
    const head = h >= 4 ? [...editState(d, w), ...under] : d.status.conflict || d.status.changedElsewhere ? editState(d, w) : under;
    const above = 1 + head.length, room = Math.max(1, h - above);
    this.positionRows.moveOrigin(above);
    this.positionRows.source = sourceRows;
    this.total = body.length; this.room = room;
    // Rows that fit start at the first, whatever scrolled them before (the raw rows' rule, src/draft-view.ts).
    if (this.total <= room) this.top = 0;
    else if (d.follow) this.top = follow(cursor, this.top, room);
    // The cursor's line where it is on screen, in the position's terms (src/draft-view.ts): an agent's patch keeps it there.
    const first = sourceRows.indexOf(d.row);
    d.position.caret = first >= this.top && first < this.top + room ? { line: d.row, row: above + first - this.top } : null;
    this.spots = spots.map(s => ({ ...s, y: s.y - this.top + above }));
    return [fg(C.lcyan) + pad(labels.map(l => l[0]).join(" "), w) + RESET,
      ...head,
      ...body.slice(this.top, this.top + room)];
  }
}
/** The draft's rich cells adapter (src/draft-view.ts), made on first use and kept with its other views. */
export function elementEdit(d: Draft): ElementEdit { return (d.views.rich ??= new ElementEdit(d)); }
