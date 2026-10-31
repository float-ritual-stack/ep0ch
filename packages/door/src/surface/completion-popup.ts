import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { parseFragmentCompletionQuery } from "@ep0ch/outline-core/completion-triggers";
import type { CompletionItem, CompletionState } from "./completer";
import { Canvas } from "../canvas";
import { ListPicker, pickRow } from "./picker";
import { listPreview } from "../bar/list-preview";
import { searchMatchSpans } from "@ep0ch/outline-core/search-match";
import { declaredKeys, keyCaption } from "./actions";
import { COMPLETION_ACCEPT, COMPLETION_MOVE, COMPLETION_DOCS, COMPLETION_DISMISS } from "./completion-actions";
import { C, chip, fg, pad, RESET, width as cells, ellipsize } from "../style";
import { printable } from "../text";
import { drawVariation } from "../library/draw";
import { paintRange, SELECT_BG } from "./selection";

/**
 * The popup as lines `w` wide, at most `h` tall: header, candidates (the selected one with its context),
 * footer. `rows`, when given, gets each line's candidate index (null for the header, context and footer).
 */
export function renderCompletion(s: CompletionState, w: number, h: number, rows: (number | null)[] = [], anchor = 0, values?: StyleValues): string[] {
  if (h < 4 || w < 8) return completionLines(s, w, h, rows, anchor);
  const body = completionLines(s, w - 3, h - 3, rows, Math.max(0, anchor - 1));
  const canvas = new Canvas(w, body.length + 3);
  const rect = { col: 0, row: 0, cols: w - 1, rows: body.length + 2 };
  canvas.float(rect, "", "", () => body.forEach((line, y) => canvas.text(1, y + 1, line, w - 3)), false, values);
  const picker = completionPicker(s);
  const listRows = rows.filter(i => i !== null).length;
  canvas.thumb({ col: s.listCol ?? 0, row: 1, cols: (s.listWidth ?? w - 3) - (s.listCol ?? 0) + 2, rows: listRows + 2 }, { top: picker.view.top, room: listRows, total: picker.totalRows }, fg(C.yellow));
  rows.unshift(null); rows.push(null, null);
  s.listCol = (s.listCol ?? 0) + 1;
  s.listWidth = (s.listWidth ?? w - 3) + 1;
  if (s.previewRect) s.previewRect = { ...s.previewRect, col: s.previewRect.col + 1, row: s.previewRect.row + 1 };
  return canvas.lines();
}

function completionLines(s: CompletionState, w: number, h: number, rows: (number | null)[] = [], anchor = 0): string[] {
  rows.length = 0;
  s.previewRect = undefined;
  if (h <= 0) return [];
  // Titles come from notes: text.ts's printable takes out what a terminal acts on, pad cuts by cells, and a glyph
  // the VGA font lacks goes as its lookalike at the sink (App, CP437_NEAREST).
  const line = (text: string, colour: string, back = "") => back + colour + pad(printable(text, " "), w) + RESET;
  const reference = s.target?.kind === "block" || s.target?.kind === "page";
  const echo = reference ? `  ${printable(s.at.line.slice(s.target.start, s.at.col), " ")}▌` : "";
  const scopes = reference ? [...s.target.query.matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9_.-]*):[ \t]*("[^"]*"|'[^']*'|[^\s:]*(?=\s|$))/g)]
    .map(m => chip(C.blue) + ` ${m[1]}: ${printable(m[2]!.replace(/^['"]|['"]$/g, ""), " ")} ` + RESET).join(" ") : "";
  if (!s.items.length) {
    const out = reference && h > 1 ? [fg(C.lcyan) + pad(echo + (scopes ? ` ${scopes}` : ""), w) + RESET] : [];
    out.push(line(` ${s.message || "no matches"}`, fg(s.loading ? C.grey : C.yellow)));
    rows.push(...out.map(() => null));
    return out;
  }
  const header = h >= 3, footer = h >= 2 && (!reference || h >= 6);
  const out: string[] = [];
  const ranking = !footer && s.jev ? ` · jev ${s.jev}` : "";
  if (header) rows.push(null), out.push(fg(C.lcyan) + pad(` ${printable(s.heading ?? "completions", " ")} ${s.index + 1}/${s.items.length}${echo}${ranking}${scopes ? ` ${scopes}` : ""}${s.loading ? " · finding..." : ""}`, w) + RESET);
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
  const labelWidth = Math.min(w, Math.max(48, Math.min(listMaxCols(w), Math.max(...s.items.map(rowWidth)))));
  const anchorCol = s.target.kind === "agent" || s.target.kind === "component" || s.target.kind === "attribute" || s.target.kind === "attribute-value" ? 0 : anchor;
  const drawn = listPreview(picker, w, Math.min(24, h - Number(header) - Number(footer)), preview, 0, w, { col: anchorCol, width: labelWidth }, { list: labelWidth });
  if (drawn.preview) s.previewRect = { ...drawn.preview, row: drawn.preview.row + Number(header) };
  s.listCol = drawn.listCol;
  s.listWidth = drawn.listWidth;
  rows.push(...drawn.rows); out.push(...drawn.lines);
  // Whether Jev ordered the list, said quietly first, where a narrow popup doesn't cut it.
  const long = s.jev === "ranked" ? (s.sure?.label ? `jev ranked · ${s.sure.label} · ` : "jev ranked · ") : s.jev === "asking" ? "jev… · " : "";
  // Where it and a note about the list don't both fit (40 columns, PIE-1409), how sure is said in its own words alone.
  const jev = s.message && s.sure?.label && cells(` ${long}${s.message}`) > w ? `${s.sure.label} · ` : long;
  const hint = completionHint(s, selected);
  const enter = enterKeeps(s);
  const keys = enter ? `↑↓ tab ⏎ ${enter} esc` : "↑↓ ⏎/tab esc";
  // The keys stay said under a note about the list (the first 20, a refusal): the note first, the keys after it.
  const said = s.message ? `${s.message} · ` : "";
  const fitted = cells(` ${jev}${said}${hint}`) <= w ? hint : cells(` ${jev}${said}${keys}`) <= w ? keys : "";
  if (footer) rows.push(null), out.push(line(` ${jev}${said}${fitted}`.replace(/ · $/, ""), fg(s.message ? C.yellow : C.grey)));
  rows.length = Math.min(rows.length, h);
  return out.slice(0, h);
}

/** The columns a row wants: marker, label, its detail (up to a cap), its kind and a component's arrow. */
const listMaxCols = (w: number) => Math.min(60, Math.max(48, w - 36));
function rowWidth(it: CompletionItem): number {
  return Math.max(3 + cells(printable(it.label, " ")) + cells(it.kind) + (it.children ? 4 : 2),
    it.detail ? 4 + cells(printable(it.detail, " ")) : 0);
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
  const item = s.items[s.index];
  if (s.picked || !item) return null;
  const unchanged = s.at.line.slice(0, s.target.start) + item.insertion + s.at.line.slice(s.target.end) === s.at.line;
  return item.enter || item.newPage || item.querySuggestion || unchanged ? (s.line ? "applies" : item.enter ?? "new line") : null;
}

/** Whether the docs panel has more than it shows (a reference's reader always may): shift+up/down, PgUp/PgDn scroll it. */
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
  const insert = enter ? `⏎ ${enter} · tab inserts` : `${caps(COMPLETION_ACCEPT.keys, 2).replace(" ", "/").split("/").reverse().join("/")} inserts`;
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
        const lit = new Set(it.matches ?? searchMatchSpans(it.label, s.target.query));
        const words = [...label].map((c, i) => lit.has(i) ? fg(C.yellow) + c + fg(C.grey) : c).join("");
        const text = ` ${on ? "»" : " "} ${words}` + (addition ? fg(C.dark) + addition + fg(C.grey) : "");
        const tail = fg(C.dark) + kind + fg(C.grey) + arrow;
        return [pickRow(pad(text, w - cells(kind) - cells(arrow)) + tail, on, w),
          ...(it.detail ? [pickRow(fg(C.dark) + "    " + printable(it.detail, " "), on, w, C.dark)] : [])];
      },
      heading: (it, i, w) => it.group && it.group !== s.items[i - 1]?.group ? fg(C.dark) + pad(` ${it.group} (${s.items.filter(row => row.group === it.group).length})`, w) + RESET : null,
      choose: () => {},
    });
    pickers.set(s, picker);
  }
  return picker;
}
