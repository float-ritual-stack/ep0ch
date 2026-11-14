import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { parseFragmentCompletionQuery } from "@ep0ch/outline-core/completion-triggers";
import { enterKeeps as rowEnterKeeps } from "@ep0ch/outline-core/completion-source";
import type { CompletionItem, CompletionState } from "./completer";
import { Canvas } from "../canvas";
import { ListPicker, pickRow } from "./picker";
import { DOCS_BESIDE_COLS, listPreview } from "../bar/list-preview";
import { searchMatchSpans } from "@ep0ch/outline-core/search-match";
import { declaredKeys, keyCaption } from "./actions";
import { COMPLETION_ACCEPT, COMPLETION_MOVE, COMPLETION_DOCS, COMPLETION_DISMISS } from "./completion-actions";
import { C, chip, fg, pad, RESET, width as cells, ellipsize } from "../style";
import { printable } from "../text";
import { drawVariation } from "../library/draw";
import { paintRange, SELECT_BG } from "./selection";

export type CompletionLayout = "anchored" | "sheet";
/** The preview column beside the list in the anchored popup (sketch A): a real column, a third of the width within 40 to 60. */
export const previewColumn = (w: number) => Math.max(40, Math.min(60, Math.floor(w / 3)));
/** When the width has no room for the preview beside the list, it goes under the list, at most this tall. */
export const PREVIEW_UNDER_ROWS = 6;
/**
 * A component's or a value's docs beside a short list stretch the popup to this many rows, when they have them: a
 * card's drawing and its source don't fit in three rows. A note's reader beside it stays as tall as the rows.
 */
export const DOCS_BESIDE_ROWS = 12;
const docsRows = (s: CompletionState) => { const it = s.items[s.index]; return it && !(it.blockId && it.preview) ? DOCS_BESIDE_ROWS : 0; };

/**
 * The popup as lines, one frame, two layouts (PIE-1511; completion-float chooses). `anchored` (A, the default): the
 * list's rows with the preview a column beside them (under them when `w` has no room beside), then a status row
 * (the heading and count, how Jev ranked, the list's note, the scope chips); as wide as its content within `w` and as
 * tall as its rows within `h`; no header and no key hints (those are the status bar's). `sheet` (B): `w` wide, at
 * most `h` tall, the header row first (heading, count, the typed token, scopes), list left and preview right. `rows`
 * gets each line's candidate index (null for the frame, header, context and status rows).
 */
export function renderCompletion(s: CompletionState, w: number, h: number, rows: (number | null)[] = [], layout: CompletionLayout = "anchored", values?: StyleValues): string[] {
  if (h < 4 || w < 8) return completionLines(s, w, h, rows, layout);
  const body = completionLines(s, w - 2, h - 2, rows, layout);
  const inner = Math.max(1, ...body.map(cells));
  const cols = layout === "sheet" ? w : Math.min(w, inner + 2);
  const canvas = new Canvas(cols, body.length + 2);
  const rect = { col: 0, row: 0, cols, rows: body.length + 2 };
  canvas.float(rect, "", "", () => body.forEach((line, y) => canvas.text(1, y + 1, line, cols - 2)), false, values);
  const picker = completionPicker(s);
  const first = rows.findIndex(i => i !== null), last = rows.findLastIndex(i => i !== null);
  if (first >= 0) canvas.thumb({ col: s.listCol ?? 0, row: first, cols: (s.listWidth ?? inner) - (s.listCol ?? 0) + 2, rows: last - first + 3 }, { top: picker.view.top, room: last - first + 1, total: picker.totalRows }, fg(C.yellow));
  rows.unshift(null); rows.push(null);
  s.listCol = (s.listCol ?? 0) + 1;
  s.listWidth = (s.listWidth ?? inner) + 1;
  if (s.previewRect) s.previewRect = { ...s.previewRect, col: s.previewRect.col + 1, row: s.previewRect.row + 1 };
  return canvas.lines();
}

function completionLines(s: CompletionState, w: number, h: number, rows: (number | null)[] = [], layout: CompletionLayout = "anchored"): string[] {
  rows.length = 0;
  s.previewRect = undefined;
  if (h <= 0) return [];
  const sheet = layout === "sheet";
  // Titles come from notes: text.ts's printable takes out what a terminal acts on, pad cuts by cells, and a glyph
  // the VGA font lacks goes as its lookalike at the sink (App, CP437_NEAREST).
  const line = (text: string, colour: string, width = w, back = "") => back + colour + pad(printable(text, " "), width) + RESET;
  const reference = s.target?.kind === "block" || s.target?.kind === "page";
  const echo = reference ? `  ${printable(s.at.line.slice(s.target.start, s.at.col), " ")}▌` : "";
  const scopes = reference ? [...s.target.query.matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9_.-]*):[ \t]*("[^"]*"|'[^']*'|[^\s:]*(?=\s|$))/g)]
    .map(m => chip(C.blue) + ` ${m[1]}: ${printable(m[2]!.replace(/^['"]|['"]$/g, ""), " ")} ` + RESET).join(" ") : "";
  if (!s.items.length) {
    const width = sheet ? w : Math.min(w, Math.max(48, cells(s.message ?? "") + 2));
    const out = reference && h > 1 ? [fg(C.lcyan) + pad(echo + (scopes ? ` ${scopes}` : ""), width) + RESET] : [];
    out.push(line(` ${s.message || "no matches"}`, fg(s.loading ? C.grey : C.yellow), width));
    rows.push(...out.map(() => null));
    return out;
  }
  const out: string[] = [];
  const picker = completionPicker(s);
  picker.sel = s.index;
  const selected = s.items[s.index]!;
  // Show what a choice draws before its longer docs can push it out of view. Every line stays scrollable; a
  // reference uses its own reader once it's read (enrich).
  const preview = (pw: number, ph: number) => {
    if (selected.blockId && selected.preview) { s.previewLines = undefined; return selected.preview(pw, ph); }
    const docs = selected.docs ?? (selected.preview ? "" : selected.insertion);
    const lines = [...(selected.preview?.(pw, 10000) ?? []), ...(docs ? drawVariation({ use: docs, values: {} }, pw) : [])];
    s.previewLines = lines;
    // Not clamped here: the room rule asks once to measure, at a height other than the panel's (previewBy clamps).
    const top = s.previewTop ?? 0;
    return lines.slice(top, top + ph).map((line, i) => {
      const span = s.previewSelection?.span(top + i);
      return span ? paintRange(line, span[0], span[1], SELECT_BG) : line;
    });
  };
  // Whether Jev ordered the list, said quietly, and how sure it is. Where it and a note about the list don't both fit
  // (40 columns, PIE-1409), how sure is said in its own words alone.
  const long = s.jev === "ranked" ? (s.sure?.label ? `jev ranked · ${s.sure.label}` : "jev ranked") : s.jev === "asking" ? "jev…" : "";
  const jev = s.message && s.sure?.label && cells(` ${long} · ${s.message}`) > w ? s.sure.label : long;
  const count = `${printable(s.heading ?? "completions", " ")} ${s.index + 1}/${s.items.length}`;
  const said = [jev, s.message ?? "", scopes, s.loading ? "finding..." : ""].filter(Boolean);
  // The list is as wide as its rows (48 to 60 columns); the preview a column beside it when 30 are free, else under it.
  const labelWidth = listColumns(s, w);
  const beside = previewBeside(s, w);
  const inner = sheet ? w : beside ? Math.min(w, labelWidth + 3 + previewColumn(w)) : labelWidth;
  if (sheet) rows.push(null), out.push(fg(C.lcyan) + pad(` ${count}${echo}${said.map(x => ` · ${x}`).join("")}`, w) + RESET);
  // The sheet's header row, or the anchored popup's rule and status row (when there's room for a row besides), come out of `h`.
  const status = !sheet && h >= 4;
  const bodyRows = sheet ? h - 1 : status ? h - 2 : h;
  const need = picker.lines(labelWidth, bodyRows, 0).length;
  const height = sheet ? bodyRows : beside ? Math.min(bodyRows, Math.max(need, docsRows(s))) : Math.min(bodyRows, need + 1 + PREVIEW_UNDER_ROWS);
  const drawn = listPreview(picker, inner, height, preview, 0, inner, { col: 0, width: labelWidth }, { list: labelWidth, ...(sheet ? {} : { under: PREVIEW_UNDER_ROWS }) });
  if (drawn.preview) s.previewRect = { ...drawn.preview, row: drawn.preview.row + Number(sheet) };
  s.listCol = drawn.listCol;
  s.listWidth = drawn.listWidth;
  s.listRows = drawn.rows.filter(r => r !== null).length;
  rows.push(...drawn.rows); out.push(...drawn.lines);
  if (status) {
    // The status row (sketch A): the count first when it fits with the rest, else the rest alone, cut by cells.
    const parts = [count, ...said];
    if (parts.length > 1 && cells(` ${parts.join(" · ")}`) > inner) parts.shift();
    rows.push(null, null);
    out.push(fg(C.blue) + "─".repeat(inner) + RESET, line(` ${parts.join(" · ")}`, fg(s.message ? C.yellow : C.grey), inner));
  }
  rows.length = Math.min(rows.length, h);
  return out.slice(0, h);
}

/** The list's width in a popup `w` wide: its rows' own width, 48 to 60 columns, never past `w`. */
export const listColumns = (s: CompletionState, w: number) => Math.min(w, Math.max(48, Math.min(listMaxCols(w), Math.max(...s.items.map(rowWidth)))));
/** Whether a popup `w` wide puts the preview beside the list (Helix's rule: 30 columns free) rather than under it. */
export const previewBeside = (s: CompletionState, w: number) => w - listColumns(s, w) - 3 >= DOCS_BESIDE_COLS;

/**
 * How tall the anchored popup (A) comes out at most, framed, in `w` columns and at most `h` rows, from the list alone:
 * the preview beside it is as tall as the rows, under it at most PREVIEW_UNDER_ROWS. The float places by this before
 * drawing once, so a frame never draws the preview twice at two heights (which would reset its scroll).
 */
export function anchoredRows(s: CompletionState, w: number, h: number): number {
  if (!s.items.length) return Math.min(h, 4);
  const inner = Math.max(1, w - 2), bodyRows = Math.max(1, h - 4);
  const picker = completionPicker(s);
  picker.sel = s.index;
  const need = picker.lines(listColumns(s, inner), bodyRows, 0).length;
  const body = previewBeside(s, inner) ? Math.min(bodyRows, Math.max(need, docsRows(s))) : Math.min(bodyRows, need + 1 + PREVIEW_UNDER_ROWS);
  return Math.min(h, body + 4);
}

/** The columns a row wants on its one line: marker, label, its detail, its kind and a component's arrow (the list caps it). */
const listMaxCols = (w: number) => Math.min(60, Math.max(48, w - 36));
function rowWidth(it: CompletionItem): number {
  return 3 + cells(printable(it.label, " ")) + (it.detail ? 2 + cells(printable(it.detail, " ")) : 0) + cells(it.kind) + (it.children ? 4 : 2);
}

/**
 * Whether ⏎ is the field's rather than the popup's (PIE-1339), and what the footer says it does then. ⏎ inserts the lit
 * row as Tab does, except: a filter's words or a property value's (filter-key, filter-value) keep ⏎ to apply what's
 * typed (a `[[` or `((` in that line still inserts); a figure's YAML and a script fence's settings keep ⏎ a new line,
 * since a line there ends in one; a property or a heading's `::` offered before anything is typed does too; and so does
 * a row that would leave the line as it is (the value already typed out). A deliberate choice (arrows, the wheel, a
 * click, Tab or ctrl+space) makes ⏎ insert. A lone new page is never taken by ⏎ unless chosen (PIE-592).
 */
export function enterKeeps(s: CompletionState): "new line" | "applies" | null {
  // The rule is outline-core's, one for every completer; this says what the door's popup holds.
  return rowEnterKeeps(s.items[s.index], { chosen: !!s.picked, line: s.at.line, start: s.target.start, end: s.target.end, applies: !!s.line });
}

/** Whether the docs panel has more than it shows (a reference's reader always may): shift+up/down scroll it (PgUp/PgDn page the list). */
export function docsScroll(s: CompletionState): boolean {
  const item = s.items[s.index];
  if (!item) return false;
  if (item.blockId && item.preview) return true;
  return !!s.previewLines && !!s.previewRect && s.previewLines.length > s.previewRect.rows;
}

/** The footer's words for the popup's keys, from what the lit row can do and what ⏎ does here: the popup's and its host's hint row. */
/** The first `n` keys an action's own `keys` names, as keycaps (`up/down` is `↑ ↓`, `shift+up` `shift+↑`). */
function caps(keys: string, n: number): string {
  return [...declaredKeys(keys)].slice(0, n).map(keyCaption).join(" ").replace(/shift\+↑ shift\+↓/, "shift+↑↓");
}
export const popupHint = (s: CompletionState): string => completionHint(s, s.items[s.index]);
function completionHint(s: CompletionState, selected: CompletionItem | undefined): string {
  const enter = enterKeeps(s);
  const insert = enter ? `${keyCaption("enter")} ${enter} · ${keyCaption("tab")} inserts` : `${caps(COMPLETION_ACCEPT.keys, 2).replace(" ", "/").split("/").reverse().join("/")} inserts`;
  if (!selected) return "esc dismisses";
  const docs = docsScroll(s) ? ` · ${caps(COMPLETION_DOCS.keys, 2)} docs` : "";
  const extra = [
    selected.children ? "→ variations" : "", s.target.kind === "component" ? "← returns · y/[copy] source" : "",
    selected.definition ? "g/[g] definition" : "", s.target.kind === "block" && !parseFragmentCompletionQuery(s.target.query) ? "^/# narrow" : "",
  ].filter(Boolean).map(x => ` · ${x}`).join("");
  return `${caps(COMPLETION_MOVE.keys, 2).replace(" ", "")} move · ${insert}${docs}${extra} · ${caps(COMPLETION_DISMISS.keys, 1)} dismiss`;
}

const pickers = new WeakMap<CompletionState, ListPicker<CompletionItem, void>>();
export function completionPicker(s: CompletionState): ListPicker<CompletionItem, void> {
  let picker = pickers.get(s);
  if (!picker) {
    picker = new ListPicker({ name: "completion", items: () => s.items, maxItems: 10,
      // A row (PIE-1339): marker, label with the typed letters lit, its detail dim, its kind at the right edge. Every row
      // draws the same way from its own fields; a component's › opens its variations.
      row: (it, _i, on, w) => {
        const arrow = it.children ? " ›" : "";
        const kind = it.kind ? ` ${it.kind} ` : " ";
        const room = Math.max(1, w - 3 - cells(kind) - cells(arrow));
        const label = ellipsize(printable(it.addition ? it.label.slice(0, -it.addition.length) : it.label, " "), room);
        const addition = it.addition ? ellipsize(it.addition, Math.max(0, room - cells(label))) : "";
        // One row per match (PIE-1511): its detail (where it is, a ranked row's score) dim after the label, cut to the room left.
        const left = room - cells(label) - cells(addition) - 2;
        const detail = it.detail && left >= 4 ? "  " + ellipsize(printable(it.detail, " "), left) : "";
        const lit = new Set(it.matches ?? searchMatchSpans(it.label, s.target.query));
        const words = [...label].map((c, i) => lit.has(i) ? fg(C.yellow) + c + fg(C.grey) : c).join("");
        const text = ` ${on ? "»" : " "} ${words}` + (addition ? fg(C.dark) + addition + fg(C.grey) : "") + (detail ? fg(C.dark) + detail + fg(C.grey) : "");
        const tail = fg(C.dark) + kind + fg(C.grey) + arrow;
        return [pickRow(pad(text, w - cells(kind) - cells(arrow)) + tail, on, w)];
      },
      heading: (it, i, w) => it.group && it.group !== s.items[i - 1]?.group ? fg(C.dark) + pad(` ${it.group} (${s.items.filter(row => row.group === it.group).length})`, w) + RESET : null,
      choose: () => {},
    });
    pickers.set(s, picker);
  }
  return picker;
}
