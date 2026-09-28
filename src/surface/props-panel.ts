// The property panel (Detail's property inspector): every property token of the note, repeated keys and
// scope (block, line, inline) kept, behind one key instead of filling the top of the note. A value can be
// copied, followed (block, page and Work-ID values) and edited in place: an edit is one `properties.patch`
// of that token, checked against the revision the panel read, so it never overwrites someone else's change.
// The surface owns the panel and runs its actions; this file draws it and turns keys into intents.
import type { Msg } from "../board";
import { printable, type Source } from "../props";
import { pageOf, refView, referencesIn } from "../refs";
import type { PropertyRecord } from "../socket";
import { bg, C, fg, pad, RESET, width } from "../style";
import type { Key } from "../term";
import { rule } from "../text";

/** One property token as the panel lists it. `ordinal` is what properties.patch replaces (null: unknown here). */
export interface PropRow {
  n: number; key: string; value: string;
  scope: "block" | "line" | "inline"; placement?: string; syntax?: string; line?: number;
  ordinal: number | null;
  /** Where `o` goes: a block id, or a page address / Work ID the service resolves. */
  target: { block: string } | { page: string } | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Where a value points, when it names something: a block id or `((id))`, a `[[page]]`, or a Work ID in
 * the workspace's own prefix (`PIE-409` when the prefix is PIE; `week-38` or `utf-8` are just text).
 */
export function valueTarget(key: string, value: string, workIdPrefix: string | null = null): PropRow["target"] {
  const v = value.trim();
  const ref = v.match(/^\(\(([A-Za-z0-9_-]{8,})(?:\^[A-Za-z0-9][A-Za-z0-9_-]*)?(?:\|[^)]*)?\)\)$/);
  if (ref) return { block: ref[1]! };
  if (UUID.test(v)) return { block: v };
  const page = v.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
  if (page) return { page: page[1]!.trim() };
  // `work-id` and `page` declare this note's own addresses; they don't point anywhere else.
  if (key === "work-id" || key === "page") return null;
  const [prefix, n] = [v.slice(0, v.lastIndexOf("-")), v.slice(v.lastIndexOf("-") + 1)];
  if (workIdPrefix && prefix.toLowerCase() === workIdPrefix.toLowerCase() && /^\d+$/.test(n)) return { page: v };
  return null;
}

/**
 * The panel's rows: the service's tokens for the note's text when it offers them (`properties.preview`),
 * otherwise the block properties the note was read with (no line/inline scope, no ordinals).
 */
export function propertyRows(m: Msg, tokens: PropertyRecord[] | null, workIdPrefix: string | null = null): PropRow[] {
  const src = tokens
    ? tokens.map(t => ({ key: t.key, value: t.value, scope: t.scope, placement: t.placement, syntax: t.syntax, line: t.line, ordinal: t.ordinal }))
    : (m.properties ?? Object.entries(m.props).map(([key, value]) => ({ key, value }))).map(p => ({ ...p, scope: "block" as const, ordinal: null }));
  return src.map((p, i) => ({ n: i + 1, ...p, target: valueTarget(p.key, p.value, workIdPrefix) }));
}

/**
 * How a row's value reads: a block value also shows the target's title, as a link would. `noteText`: the
 * note's whole text, whose one references answer holds the value's target.
 */
export function valueView(r: PropRow, src: Source | null, noteText?: string): string {
  const v = printable(r.value);
  if (r.target && "block" in r.target) {
    const res = referencesIn(noteText ?? `((${r.target.block}))`, src)?.get(r.target.block);
    const view = refView(r.target.block, undefined, undefined, res);
    return res ? `${view.text}  ${v.length > 13 ? v.slice(0, 8) + "…" : v}` : v;
  }
  if (r.target && "page" in r.target) {
    const p = pageOf(r.target.page, src);
    return p?.status === "missing" ? `${v} · Missing target` : p?.block ? `${v}  ${printable(p.block.text.split("\n")[0] ?? "").replace(/\[[\w-]+::[^\]]*\]/g, "").trim().slice(0, 60)}` : v;
  }
  return v;
}

/** A value `properties.patch` would take, or why not (the service's own rules: non-empty, no `]`, one line). */
export function checkValue(r: PropRow, value: string): string | null {
  const v = value.trim();
  if (!v) return "a property value can't be empty";
  if (/[\]\r\n]/.test(v)) return "a property value can't contain ] or a line break";
  if (r.syntax === "hashtag" && !/^[\p{L}\p{N}_/-]+$/u.test(v)) return "a #hashtag value is one word; e edits the note to change it into a [key::value]";
  return null;
}

/** A one-line value being edited. */
export interface Field { row: PropRow; text: string; cursor: number; revision: number; saving: boolean; note: string; changedElsewhere: boolean }

export type PanelIntent = "copy" | "follow" | "edit" | "save" | "cancel" | "close" | "summary" | "full" | null;

export class PropertyPanel {
  sel = 0;
  top = 0;
  /** Fill the whole reader (Detail's dedicated Properties pane) instead of sitting above the note. */
  full = false;
  field: Field | null = null;
  /** What the last copy, follow or save said, until the selection moves. */
  note = "";

  /** Keys while the panel is open. Most become intents the surface runs (the same code as the actions). */
  key(k: Key, rows: number): PanelIntent {
    const f = this.field;
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    if (f) {
      if (f.saving) return null;
      if (k.kind === "enter") return "save";
      if (k.kind === "esc") return "cancel";
      if (k.kind === "backspace") { if (f.cursor > 0) { f.text = f.text.slice(0, f.cursor - 1) + f.text.slice(f.cursor); f.cursor--; } }
      else if (k.kind === "delete") f.text = f.text.slice(0, f.cursor) + f.text.slice(f.cursor + 1);
      else if (k.kind === "left") f.cursor = Math.max(0, f.cursor - 1);
      else if (k.kind === "right") f.cursor = Math.min(f.text.length, f.cursor + 1);
      else if (k.kind === "home" || (k.kind === "char" && k.ctrl && k.ch === "a")) f.cursor = 0;
      else if (k.kind === "end" || (k.kind === "char" && k.ctrl && k.ch === "e")) f.cursor = f.text.length;
      else if (k.kind === "char" && k.ctrl && k.ch === "u") { f.text = ""; f.cursor = 0; }
      else if (k.kind === "char" && !k.ctrl) { f.text = f.text.slice(0, f.cursor) + k.ch + f.text.slice(f.cursor); f.cursor += k.ch.length; }
      f.note = "";
      return null;
    }
    const move = (d: number) => { if (rows) { this.sel = (this.sel + d + rows) % rows; this.note = ""; } };
    if (k.kind === "tab" || k.kind === "down" || c === "j") move(1);
    else if (k.kind === "backtab" || k.kind === "up" || c === "k") move(-1);
    else if (c === "y") return "copy";
    else if (c === "o") return "follow";
    else if (k.kind === "enter" || c === "e") return "edit";
    else if (c === "s") return "summary";
    else if (c === "I") return "full";
    else if (k.kind === "esc" || c === "i" || c === "q") return "close";
    return null;
  }

  hint(): string {
    if (this.field) return this.field.saving ? "saving…" : "type the value · enter saves · esc cancels";
    return "tab/j k value · y copy · o follow · enter/e edit · s summary · I full · esc close";
  }

  /** The panel's lines, at most `h`, `w` wide. `summary` holds the keys the summary line shows. */
  render(rows: PropRow[], w: number, h: number, info: { revision?: number; summary: readonly string[]; source: string; scopes: "ready" | "loading" | "block"; src: Source | null; text?: string }): string[] {
    const scopes = info.scopes === "ready" ? "" : info.scopes === "loading" ? " · reading…" : " · block only (no properties.preview here)";
    const title = `properties · ${rows.length}${info.revision !== undefined ? ` · rev ${info.revision}` : ""}${scopes}`;
    const out = [rule(w, [...title].length > w - 8 ? [...title].slice(0, Math.max(1, w - 9)).join("") + "…" : title)];
    const foot = this.field?.note || this.note;
    const room = Math.max(1, h - 1 - (foot ? 1 : 0));
    if (!rows.length) out.push(fg(C.dark) + pad("  no properties", w) + RESET);
    this.sel = Math.max(0, Math.min(this.sel, rows.length - 1));
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + room) this.top = this.sel - room + 1;
    const keyW = Math.min(16, Math.max(3, ...rows.map(r => width(r.key))));
    for (const r of rows.slice(this.top, this.top + room)) {
      const i = r.n - 1, on = i === this.sel;
      const mark = info.summary.includes(r.key.toLowerCase()) ? fg(C.yellow) + "■" : " ";
      const scope = r.scope === "block" ? "" : `(${r.scope})`;
      const f = this.field && this.field.row.n === r.n ? this.field : null;
      const valW = Math.max(1, w - keyW - 4 - (scope ? scope.length + 1 : 0));
      let value: string;
      if (f) {
        // The field scrolls so the cursor stays in view.
        const start = Math.max(0, f.cursor - valW + 2);
        const shown = f.text.slice(start, start + valW - 1);
        const cur = f.cursor - start;
        value = fg(C.white) + shown.slice(0, cur) + bg(C.lcyan) + fg(C.black) + (shown[cur] ?? " ") + RESET + fg(C.white) + shown.slice(cur + 1);
      } else value = (r.target ? fg(C.lcyan) : fg(C.yellow)) + valueView(r, info.src, info.text);
      const shown = pad(value, valW);
      const line = mark + " " + fg(C.brown) + pad(printable(r.key), keyW) + "  " + (scope && !f ? value + RESET + " " + fg(C.dark) + scope : shown) + RESET;
      out.push(on ? bg(C.blue) + pad(line.split(RESET).join(RESET + bg(C.blue)), w) + RESET : pad(line, w));
    }
    if (foot) out.push(fg(this.field?.changedElsewhere || /not saved|can't|refused|failed/.test(foot) ? C.lred : C.yellow) + pad(foot, w) + RESET);
    return out.slice(0, h);
  }
}
