import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
// The property panel (Detail's property inspector): every property token of the note, repeated keys and
// scope (block, line, inline) kept, behind one key instead of filling the top of the note. A value can be
// copied, followed (block, page and Work-ID values) and edited in place: an edit is one `properties.patch`
// of that token, checked against the revision the panel read, so it never overwrites someone else's change.
// The surface owns the panel and runs its actions; this file draws it and turns keys into intents.
import { popupHint, completerOf, completionOf } from "./completer";
import { pageAddressReferences, referencedBlock } from "@ep0ch/outline-core/link-syntax";
import { isWritablePropertyValue, splitPropertyValue } from "@ep0ch/outline-core/property-grammar";
import { softLinkableKey, softLinkOfValue, type SoftLinkName } from "@ep0ch/outline-core/soft-links";
import { subject, titleLine, type Msg } from "../board";
import { DraftSession, type DraftTarget, type SessionEnv } from "../draft-session";
import { EditConflict, type Actor } from "../socket";
import { printable, type Source } from "../props";
import { MISSING_MARK, pageOf, refView, referencesIn, shortId, drawShortId } from "../refs";
import type { PropertyRecord } from "@ep0ch/outline-core/property-parse";
import { selectedRow, drawEllipsized, C, fg, pad, RESET, width } from "../style";
import { isUp, isDown, type Key } from "../term";
import { rowLines, rule } from "../text";
import { RowView } from "../scroll";
import { modeBinding, modeHint, type ModeKey } from "./modes";
import { LineField } from "./line";
import { DRAFT_KEYS } from "../edit";
import type { SettingsCard } from "./settings-card";

/** One property token as the panel lists it. `ordinal` is what properties.patch replaces (null: unknown here). */
export interface PropRow {
  n: number; key: string; value: string;
  scope: "block" | "line" | "inline"; placement?: string; syntax?: string; line?: number;
  ordinal: number | null;
  /** Where `o` goes: a block id, a page address / Work ID the service resolves, or a soft link (a plain value: PIE-408). */
  target: ValueTarget;
}

export type ValueTarget = { block: string } | { page: string } | { soft: SoftLinkName } | null;

/**
 * Where a value points, when it names something: a block id or `((id))`, a `[[page]]`, or a Work ID in
 * the workspace's own prefix (`PIE-409` when the prefix is PIE; `week-38` or `utf-8` are just text).
 */
export function valueTarget(key: string, value: string, workIdPrefix: string | null = null): { block: string } | { page: string } | null {
  const v = value.trim();
  const ref = referencedBlock(v);
  if (ref) return { block: ref.blockId };
  const [page] = pageAddressReferences(v);
  if (page && page.start === 0 && page.end === v.length) return { page: page.displayAddress };
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
export function propertyRows(m: Msg, tokens: PropertyRecord[] | null, workIdPrefix: string | null = null, softIgnore: readonly string[] = []): PropRow[] {
  const src = tokens
    ? tokens.map(t => ({ key: t.key, value: t.value, scope: t.scope, placement: t.placement, syntax: t.syntax, line: t.line, ordinal: t.ordinal }))
    : m.properties.map(p => ({ ...p, scope: "block" as const, ordinal: null }));
  src.sort((a, b) => Number(a.scope !== "block") - Number(b.scope !== "block"));
  // A plain value is a soft link (PIE-408), the value's own page, the one item a row follows; a list's follow from the note's text.
  const soft = (key: string, value: string): ValueTarget => {
    const items = splitPropertyValue(value), name = items.length === 1 && softLinkableKey(key, softIgnore) ? softLinkOfValue(key, items[0]!) : null;
    return name ? { soft: name } : null;
  };
  return src.map((p, i) => ({ n: i + 1, ...p, target: valueTarget(p.key, p.value, workIdPrefix) ?? soft(p.key, p.value) }));
}

/**
 * How a row's value reads: a block value also shows the target's title, as a link would. `noteText`: the
 * note's whole text, whose one references answer holds the value's target.
 */
export function valueView(r: PropRow, src: Source | null, noteText?: string): string {
  const items = splitPropertyValue(r.value);
  const v = printable(r.value);
  if (items.length > 1 || items[0] !== r.value.trim()) return items.map(item => `[ ${printable(item)} ]`).join(" ");
  if (r.target && "block" in r.target) {
    const res = referencesIn(noteText ?? `((${r.target.block}))`, src)?.get(r.target.block);
    const view = refView(r.target.block, undefined, undefined, res);
    return res ? `${view.text}  ${shortId(v)}` : v;
  }
  if (r.target && "page" in r.target) {
    const p = pageOf(r.target.page, src);
    return p?.status === "missing" ? `${v} ${MISSING_MARK}` : p?.block ? `${v}  ${printable(titleLine(p.block.text).text)}` : v;
  }
  return v;
}

/** One `{{ }}` of the note as the service read it: for the panel's "Values read here". */
export interface ValueRow { expression: string; words: string; problem?: string; from?: string }

/** A value `properties.patch` would take, or why not (the service's own rules: non-empty, one line, balanced brackets). */
export function checkValue(r: PropRow, value: string): string | null {
  const v = value.trim();
  if (!v) return "a property value can't be empty";
  if (!isWritablePropertyValue(v)) return "a property value is one line with balanced brackets (a link such as [[page]] is fine)";
  if (r.syntax === "hashtag" && !/^[\p{L}\p{N}_/-]+$/u.test(v)) return "a #hashtag value is one word; e edits the note to change it into a [key::value]";
  return null;
}

/**
 * A one-line value being edited: a draft session like any other (PIE-1658), so its line, its "changed elsewhere", a
 * stale save and ctrl+r are the session's. `row` is where it saves, found again by a reload.
 */
export interface Field { row: PropRow; session: DraftSession; input: LineField }

/** What a value's session asks of its reader: write one token of a note at a revision, read the note and its rows now. */
export interface ValueHost {
  write(m: Msg, revision: number, row: PropRow, value: string, by: Actor): Promise<Msg>;
  read(): Promise<{ m: Msg; rows: PropRow[] } | null>;
}

/** Open the field for `row` of `m` (one of its `rows`), at the revision the panel read: its session, its line field. */
export function valueField(m: Msg & { revision: number }, rows: PropRow[], row: PropRow, host: ValueHost, env: SessionEnv = {}): Field {
  const input = Object.assign(new LineField(row.value, false, { complete: { valueKey: row.key } }), { near: m.id });
  const f = { row } as Field;
  f.input = input;
  f.session = DraftSession.open(valueDraftTarget(m, rows.filter(r => r.key === row.key).findIndex(r => r.n === row.n), f, host), { draft: input, base: m.revision }, env);
  // ⏎ saves: held during a write or a reload, it's a command to press again, never text.
  input.enterSaves = true;
  return f;
}

/**
 * Where a value is written (PIE-1658): one `properties.patch` of its token at the revision the panel read, refused as
 * stale if the note moved on. ctrl+r reads the note again and finds the value at the same key and place among that key's.
 */
function valueDraftTarget(m: Msg, nth: number, f: Field, host: ValueHost): DraftTarget {
  let note = m;
  return {
    place: `value:${m.id}:${f.row.key}:${f.row.n}`, back: `enter on ${f.row.key} brings it back`, label: `${m.id.slice(0, 8)}-${f.row.key}`,
    what: `the value of ${f.row.key} on “${subject(m)}”`, verb: "save", leaveWrites: false, near: m.id, returns: { what: "value", does: "saves" },
    async submit(s, by, { report }) {
      const why = checkValue(f.row, s.draft.text);
      if (why) return { ok: false, why, said: why };
      const value = s.draft.text.trim();
      if (value === f.row.value) return { ok: true, said: "unchanged" };
      report.phase("saving");
      try {
        const saved = await host.write(note, s.draft.base, f.row, value, by);
        return { ok: true, revision: saved.revision, result: saved };
      } catch (e) {
        if (e instanceof EditConflict) return { ok: false, stale: true, why: "changed elsewhere since the panel read it · not saved" };
        const why = `not saved: ${e instanceof Error ? e.message : String(e)}`;
        return { ok: false, why, said: why };
      }
    },
    async reload() {
      const now = await host.read();
      if (!now) return { none: "the note is gone from the outline" };
      // The same key's value at the same place among that key's: where the note now keeps it.
      const row = now.rows.filter(r => r.key === f.row.key)[nth];
      if (!row) return { none: `${f.row.key} isn't on the note any more · esc, then pick another value` };
      f.row = row; note = now.m;
      return { loaded: { ...now.m, text: row.value } };
    },
  };
}

export type PanelIntent = "copy" | "follow" | "edit" | "save" | "cancel" | "reload" | "close" | "summary" | "full" | null;

/** The panel's keys, one row per key: `key()` reads the intent off this table and the hint draws it. */
type PanelKey = ModeKey & { intent?: Exclude<PanelIntent, null> };
const PANEL_KEYS: readonly PanelKey[] = [
  { key: "tab", action: "props.pick", args: { by: 1 }, label: "value" }, { key: "j", action: "props.pick", args: { by: 1 }, label: "value" }, { key: "k", action: "props.pick", args: { by: -1 }, label: "value" },
  { key: "y", action: "props.copy", label: "copy", intent: "copy" }, { key: "o", action: "props.follow", label: "follow", intent: "follow" },
  { key: "enter", action: "props.edit", label: "edit", intent: "edit" }, { key: "e", action: "props.edit", label: "edit", intent: "edit" },
  { key: "s", action: "props.summary", label: "summary", intent: "summary" }, { key: "I", action: "props", args: { full: true }, label: "full", intent: "full" },
  { key: "esc", action: "props.close", label: "close", intent: "close" }, { key: "i", action: "props.close", label: "close", intent: "close" }, { key: "q", action: "props.close", label: "close", intent: "close" },
];

export class PropertyPanel {
  sel = 0;
  view = new RowView();
  /** Fill the whole reader (Detail's dedicated Properties pane) instead of sitting above the note. */
  full = false;
  field: Field | null = null;
  /** What the last copy, follow or save said, until the selection moves. */
  note = "";
  /** Where the last render drew each row (`y` in its lines) and where its value starts, for clicks. */
  at: { y: number; n: number; from: number; target: boolean; w: number }[] = [];
  /** The surface row the panel was last drawn from: clicks come in the surface's rows. */
  origin = 0;
  /** The settings card (PIE-786), when the panel shows a configurable note's fields instead of its tokens (`,`). */
  card: SettingsCard | null = null;

  /** Keys while the panel is open. Most become intents the surface runs (the same code as the actions). */
  key(k: Key, rows: number): PanelIntent {
    const f = this.field;
    if (f) {
      // A write or a reload under way holds what's typed (the session's), to land once it answers.
      if (f.session.holding(k, held => { f.input.take(held); })) return null;
      // An open completion popup takes ⏎, esc and the arrows first (the line's own keys, PIE-626); what it leaves is the panel's.
      if (f.input.take(k)) { f.session.status.say(""); return null; }
      if (k.kind === "esc") return "cancel";
      // ⏎, and the draft's own save and reload keys (ctrl+s, ctrl+r: DRAFT_KEYS, as every place a person types has them).
      const bound = f.input.binding(k)?.action;
      return k.kind === "enter" || bound === "edit.save" ? "save" : bound === "edit.reload" ? "reload" : null;
    }
    const move = (d: number) => { if (rows) { this.sel = (this.sel + d + rows) % rows; this.note = ""; } };
    if (k.kind === "tab" || isDown(k)) move(1);
    else if (k.kind === "backtab" || isUp(k)) move(-1);
    else return (modeBinding(PANEL_KEYS, k) as (typeof PANEL_KEYS)[number] | undefined)?.intent ?? null;
    return null; // the move above
  }

  /**
   * The mouse at `x`, `y` (the surface's cells) on the value being typed: the field's (a press places its cursor, a
   * double click selects a word, a drag selects). False when it isn't on the field and none of its presses is held.
   */
  fieldMouse(action: "down" | "drag" | "up", x: number, y: number): boolean {
    const f = this.field, at = f && this.at.find(a => a.n === f.row.n);
    return !!f && !!at && f.input.mouse({ kind: "mouse", action, button: 0, x, y }, { x: at.from, y: this.origin + at.y, w: at.w });
  }

  /** The panel's last line: what the value's session says (its conflict, "changed elsewhere"), else what the panel last did. */
  foot(): string {
    const st = this.field?.session.status;
    return (st && (st.note || (st.conflict ? `! ${st.conflict}` : st.changedElsewhere ? "!! the note changed elsewhere since this value was read · ctrl+r loads it" : ""))) || this.note;
  }

  hint(): string {
    const f = this.field, st = f?.session.status;
    if (f && st) return st.doing ?? (completionOf(f.input)?.items.length ? popupHint(completionOf(f.input)!) : `type the value · enter saves · esc cancels${st.conflict || st.changedElsewhere ? ` · ${modeHint(DRAFT_KEYS.filter(r => r.action === "edit.reload"), () => undefined)}` : ""}`);
    return modeHint(PANEL_KEYS, () => undefined);
  }

  /** The panel's lines, at most `h`, `w` wide. `summary` holds the keys the summary line shows. */
  render(rows: PropRow[], w: number, h: number, info: { look?: StyleValues; origin?: number; revision?: number; summary: readonly string[]; source: string; scopes: "ready" | "loading" | "block"; src: Source | null; text?: string; values?: readonly ValueRow[] }): string[] {
    const scopes = info.scopes === "ready" ? "" : info.scopes === "loading" ? " · reading…" : " · block only (no properties.preview here)";
    const title = `properties · ${rows.length}${info.revision !== undefined ? ` · rev ${info.revision}` : ""}${scopes}`;
    const out = [rule(w, drawEllipsized(title, Math.max(2, w - 8)))];
    const st = this.field?.session.status, foot = this.foot();
    const room = Math.max(1, h - 1 - (foot ? 1 : 0));
    if (!rows.length) out.push(fg(C.dark) + pad("  no properties", w) + RESET);
    this.sel = Math.max(0, Math.min(this.sel, rows.length - 1));
    const entries: ({ heading: string } | { row: PropRow })[] = [];
    let previous = "";
    for (const r of rows) {
      const group = r.scope === "block" ? "Block properties" : "Inline and line properties";
      if (group !== previous) entries.push({ heading: group });
      entries.push({ row: r });
      previous = group;
    }
    const keyW = Math.min(16, Math.max(3, ...rows.map(r => width(r.key))));
    const drawn = entries.flatMap<{ text: string; row: PropRow | null }>(entry => {
      if ("heading" in entry) return [{ text: fg(C.dark) + pad(entry.heading, w) + RESET, row: null }];
      const r = entry.row, f = this.field?.row.n === r.n ? this.field : null;
      const mark = info.summary.includes(r.key.toLowerCase()) ? fg(C.yellow) + "■" : " ";
      const scope = r.scope === "block" ? "" : ` (${r.scope})`;
      const valW = Math.max(1, w - keyW - 5 - scope.length);
      const reads = valueView(r, info.src, info.text), block = r.target && "block" in r.target ? r.target.block : undefined;
      const shown = block ? reads.replace(shortId(block), () => drawShortId(block)) : reads;
      const value = f ? f.input.show(valW) : (r.target ? fg(C.lcyan) : fg(C.yellow)) + shown;
      const line = " " + mark + " " + fg(C.brown) + pad(printable(r.key), keyW) + "  " + value + RESET + fg(C.dark) + scope + RESET;
      return rowLines(line, w, f ? 1 : undefined, { hang: keyW + 5 }).map(text => ({ text, row: r }));
    });
    const selected = drawn.findIndex(r => r.row?.n === this.sel + 1), end = drawn.findLastIndex(r => r.row?.n === this.sel + 1);
    this.view.place(this.sel, drawn.length, room, [Math.max(0, selected), Math.max(0, end)]);
    this.at = [];
    for (const entry of drawn.slice(this.view.top, this.view.top + room)) {
      const r = entry.row;
      if (!r) { out.push(entry.text); continue; }
      const on = r.n - 1 === this.sel, f = this.field?.row.n === r.n ? this.field : null;
      if (out.length < h) this.at.push({ y: out.length, n: r.n, from: keyW + 5, target: !!r.target, w: Math.max(1, w - keyW - 5 - (r.scope === "block" ? 0 : r.scope.length + 3)) });
      out.push(on ? selectedRow(entry.text, w) : pad(entry.text, w));
      // The value being typed completes as a draft does: the popup opens under it, and a click on a candidate chooses it.
      if (f) {
        const c = completerOf(f.input), pop = completionOf(f.input);
        if (c) c.drawn = null;
        if (c && pop && out.length < h) {
          c.drawn = { row: (info.origin ?? 0) + out.length, anchor: keyW + 5 + f.input.cursorCol, items: [] };
        }
      }
    }
    // The `{{ }}` the note reads (PIE-533 S2): what each says, what it reads as (or why not), and the note it came from.
    const values = info.values ?? [];
    if (values.length && out.length + 2 < h - (foot ? 1 : 0)) {
      out.push(fg(C.dark) + pad(`Values read here · ${values.length}`, w) + RESET);
      for (const v of values.slice(0, Math.max(0, h - 1 - (foot ? 1 : 0) - out.length))) {
        const key = drawEllipsized(`{{${printable(v.expression)}}}`, Math.max(8, keyW + 12));
        const reads = v.problem ? fg(C.brown) + printable(v.problem) : fg(C.yellow) + printable(v.words) + (v.from ? fg(C.dark) + `  ${drawShortId(v.from)}` : fg(C.dark) + "  computed");
        out.push(pad("  " + fg(C.lcyan) + key + RESET + "  " + reads + RESET, w));
      }
    }
    if (foot) out.push(fg(st?.conflict || st?.changedElsewhere || /not saved|can't|refused|failed/.test(foot) ? C.lred : C.yellow) + pad(foot, w) + RESET);
    return out.slice(0, h);
  }
}

/** A panel row as `peek` and the props actions report it. */
export const describeRow = (r: PropRow, src: Source | null, text: string) => ({
  n: r.n, key: r.key, value: r.value, scope: r.scope, ...(r.placement ? { placement: r.placement } : {}),
  ordinal: r.ordinal, ...(r.target ? { target: r.target, reads: printable(valueView(r, src, text)) } : {}),
});
