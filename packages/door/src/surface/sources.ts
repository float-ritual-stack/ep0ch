import { Inspector } from "./inspector";
// The Sources inspector's drawing (PIE-956 S6b): what "where this comes from" opens over a reader. A page shows none of the
// mechanics behind it; this lists every generated region of the note (when each last read), and for one of them shows three
// folds, as the claude.ai artifact's data panel does: Query (its parameters, each editable and written back to the note's
// line), Transform (the script, template or figure YAML that shaped it, with a jump to its note) and Result (the raw rows,
// copyable, then Outline, Read and the Query). Drawn from the service's one answer (`site.sources`, outline-core sources.ts),
// the one a published page's panel draws too. State and drawing only: the reader's mode (src/surface/note.ts) keeps it.
import type { SourceEntry, SourcesAnswer } from "@ep0ch/outline-core/sources";
import { relativeAge } from "../projection";
import { BOLD, C, fg, pad, RESET, UNBOLD, width } from "../style";
import { rowLines, wrap } from "../text";

export type SourcesFold = "query" | "transform" | "result";
export const FOLDS: readonly SourcesFold[] = ["query", "transform", "result"];

export interface SourcesPanel {
  inspector: Inspector;
  block: string;
  answer: SourcesAnswer | null;
  /** Why it can't be read (a service without `site.sources`, a failed read), or null. */
  error: string | null;
  loading: boolean;
  /** The list's selection, and the source whose folds are open (null: the list). */
  sel: number;
  open: number | null;
  folds: Record<SourcesFold, boolean>;
  /** The focused row of the open source (its items, in order). */
  item: number;
  note: string;
  warnings: Record<string, string>;
  /** The outline's name, as the door knows the connection. */
  outline: string;
}

export const newPanel = (block: string, outline: string): SourcesPanel => ({ inspector: new Inspector(), block, answer: null, error: null, loading: true, sel: 0, open: null, folds: { query: true, transform: false, result: true }, item: 0, note: "", warnings: {}, outline });

/** A row the open source can act on: a fold header, a parameter to edit, the jump to the transform's note, a copy. */
export type PanelItem =
  | { kind: "fold"; fold: SourcesFold }
  | { kind: "param"; key: string; value: string }
  | { kind: "jump"; block: string }
  | { kind: "result"; row: number; block?: string }
  | { kind: "download"; format: "csv" | "json" }
  | { kind: "copy"; part: "query" | "transform" | "result" };

export interface PanelHit { row: number; from: number; to: number; action: string; args: Record<string, unknown> }
export interface PanelDraw { lines: string[]; hits: PanelHit[]; items: PanelItem[]; /** The row the focus is on, to keep in view. */ focus: number }

const KIND_WORDS: Record<SourceEntry["kind"], string> = { handler: "handler line", expr: "one-line script", use: "template", figure: "figure", fields: "fields", if: "condition", output: "written output" };

/** The items of source `s` for the folds as they are open, in reading order. */
export function itemsOf(s: SourceEntry, folds: Record<SourcesFold, boolean>): PanelItem[] {
  const out: PanelItem[] = [{ kind: "fold", fold: "query" }];
  if (folds.query) { for (const p of s.query.params) out.push({ kind: "param", key: p.key, value: p.value }); out.push({ kind: "copy", part: "query" }); }
  out.push({ kind: "fold", fold: "transform" });
  if (folds.transform) { if (s.transform.block) out.push({ kind: "jump", block: s.transform.block }); if (s.transform.text !== undefined) out.push({ kind: "copy", part: "transform" }); }
  out.push({ kind: "fold", fold: "result" });
  if (folds.result) {
    const rows = s.result.table ?? s.result.text.split("\n").filter(Boolean).map(x => [x]);
    rows.forEach((r, row) => out.push({ kind: "result", row, ...(s.kind === "figure" && r[0] ? { block: r[0] } : {}) }));
    out.push({ kind: "copy", part: "result" }, { kind: "download", format: "csv" }, { kind: "download", format: "json" });
  }
  return out;
}

const dim = (s: string) => fg(C.dark) + s + RESET;
const age = (iso: string | undefined, now: number) => (iso ? relativeAge(iso, now) : "");

/** The fully wrapped panel, its click targets, its items and the focused row; Inspector owns the viewport. */
export function drawSources(p: SourcesPanel, w: number, now: number, wide = true): PanelDraw {
  const lines: string[] = [], hits: PanelHit[] = [];
  const put = (text: string, hit?: { from: number; to: number; action: string; args?: Record<string, unknown> }[]) => {
    for (const line of wrap(text, w)) {
      for (const x of hit ?? []) hits.push({ row: lines.length, from: x.from, to: x.to, action: x.action, args: x.args ?? {} });
      lines.push(pad(line, w) + RESET);
    }
  };
  const a = p.answer;
  const updated = a ? `Updated ${age(a.readAt, now) || "just now"}` : "";
  const refresh = "⟳ r";
  const head = (title: string) => {
    put(` ${fg(C.yellow)}${BOLD}${title}${UNBOLD}${RESET}`);
    const left = a ? `${updated} ` : "";
    put(` ${dim(left)}${a ? fg(C.lcyan) + refresh + RESET + "  " : ""}${fg(C.lcyan)}✕${RESET}`, [
      ...(a ? [{ from: 1 + width(left), to: 1 + width(left) + width(refresh), action: "sources.refresh" }] : []),
      { from: 1 + width(left) + (a ? width(refresh) + 2 : 0), to: 2 + width(left) + (a ? width(refresh) + 2 : 0), action: "sources.close" },
    ]);
  };
  if (p.error) { head("Sources"); put(""); put(` ${fg(C.lred)}${p.error}${RESET}`); return { lines, hits, items: [], focus: 0 }; }
  if (!a) { head("Sources"); put(""); put(` ${dim("reading what this note generates…")}`); return { lines, hits, items: [], focus: 0 }; }
  const s = p.open !== null ? a.sources[p.open] : undefined;

  // The page's list: every generated region, its name and when it last read.
  if (!s) {
    head(`Sources · ${a.sources.length} generated region${a.sources.length === 1 ? "" : "s"}`);
    put(dim(" ".repeat(1) + "─".repeat(Math.max(0, w - 2))));
    if (!a.sources.length) put(` ${dim("nothing on this note is generated: no handler line, ::=, ::use, figure, ::fields, ::if or written output")}`);
    let focus = 2;
    a.sources.forEach((x, i) => {
      if (i === p.sel) focus = lines.length;
      const on = i === p.sel, when = age(x.readAt, now) || (x.kind === "output" ? "written" : ""), kind = KIND_WORDS[x.kind];
      const left = ` ${on ? fg(C.yellow) + "▸" : " "} ${on ? fg(C.white) + BOLD : fg(C.lcyan)}${x.name}${UNBOLD}${RESET}${x.problem ? fg(C.yellow) + " !" + RESET : ""}`;
      const right = `${dim(kind)}  ${dim(when)}`;
      for (const text of rowLines(`${left}  ${right}`, w, Infinity, { hang: 3 })) put(text, [{ from: 0, to: w, action: "sources.enter", args: { n: i + 1 } }]);
    });
    put("");
    put(` ${dim("j k select · ⏎ open · r read again · esc close")}`);
    return { lines, hits, items: [], focus };
  }

  // One source, three folds.
  const items = itemsOf(s, p.folds);
  const at = Math.min(p.item, items.length - 1);
  let focus = 0;
  const mark = (i: number) => (i === at ? fg(C.yellow) + "▸" + RESET : " ");
  const row = (i: number, text: string, hit?: PanelHit["action"], args: Record<string, unknown> = {}) => { if (i === at) focus = lines.length; for (const line of rowLines(`${mark(i)} ${text}`, w, Infinity, { hang: 2 })) put(line, [{ from: 0, to: w, action: hit ?? "sources.item", args: hit ? args : { n: i + 1 } }]); };
  put(` ${fg(C.lcyan)}← ${RESET}${fg(C.yellow)}${BOLD}${s.name}${UNBOLD}${RESET} ${dim(`· ${KIND_WORDS[s.kind]} · line ${s.line + 1}${s.endLine > s.line ? `–${s.endLine + 1}` : ""}`)}${" ".repeat(0)}`, [{ from: 0, to: 3, action: "sources.back" }]);
  if (s.readAt) put(` ${dim(`read ${age(s.readAt, now)} · ${s.live ? "live: drawn again when what it read changes" : "as written"}`)}`);
  else if (s.live === false) put(` ${dim("as written: its text is the note's")}`);
  if (s.problem) for (const l of wrap(s.problem, w - 3)) put(` ${fg(C.yellow)}${l}${RESET}`);
  put("");
  let i = 0;
  const fold = (f: SourcesFold, label: string, extra: string) => {
    const open = p.folds[f];
    row(i, `${fg(C.white)}${BOLD}${label}${UNBOLD}${RESET} ${dim(open ? "▾" : "▸")}${extra ? " " + dim(extra) : ""}`, "sources.fold", { fold: f });
    i++;
  };
  fold("query", "Query", `${s.query.params.length} parameter${s.query.params.length === 1 ? "" : "s"}`);
  if (p.folds.query) {
    for (const x of s.query.params) { row(i, `  ${fg(C.grey)}${pad(x.key, 12)}${RESET} ${fg(C.white)}${x.value}${RESET}${s.query.editable ? "  " + fg(C.lcyan) + "[e edit]" + RESET : ""}`, "sources.item", { n: i + 1 });
      if (p.warnings[x.key]) put(`    ${fg(C.yellow)}${p.warnings[x.key]}${RESET}`);
      if (p.inspector.field?.key === x.key) {
        const start = lines.length, field = p.inspector.fieldDraw(w, start);
        if (i === at) focus = start + field.focus;
        for (const line of field.lines) put(line);
        for (const hit of field.hits) hits.push({ ...hit, row: start + hit.row, action: "sources.field" });
      }
      i++; }
    if (!s.query.params.length) put(`    ${dim("takes no parameters")}`);
    for (const l of wrap(s.query.text, w - 6)) put(`    ${fg(C.grey)}${l}${RESET}`);
    row(i, `  ${fg(C.lcyan)}[y copy query]${RESET}`, "sources.copy", { part: "query" }); i++;
    if (!s.query.editable) put(`    ${dim("edit it in the note: this kind is written there, not through a field")}`);
  }
  fold("transform", "Transform", s.transform.label);
  if (p.folds.transform) {
    if (s.transform.block) { row(i, `  ${fg(C.lcyan)}[g jump to its note]${RESET}`, "sources.jump", {}); i++; }
    if (s.transform.text !== undefined) {
      const body = s.transform.text.split("\n");
      for (const l of body) put(`    ${fg(C.grey)}${l}${RESET}`);

      row(i, `  ${fg(C.lcyan)}[y copy]${RESET}`, "sources.copy", { part: "transform" }); i++;
    } else put(`    ${dim("nothing to show: it reads what the line says")}`);
  }
  fold("result", "Result", `${s.result.rows} row${s.result.rows === 1 ? "" : "s"}`);
  if (p.folds.result) {
    const table = s.result.table;
    if (table && s.result.columns) {
      const cols = s.result.columns;
      for (const r of table) { row(i, `  ${fg(C.grey)}${r.map((c, n) => `${cols[n]}: ${c}`).join(" · ")}${RESET}`, "sources.pick", { n: i + 1 }); i++; }
    } else for (const l of s.result.text.split("\n").filter(Boolean)) { row(i, `  ${fg(C.grey)}${l}${RESET}`, "sources.pick", { n: i + 1 }); i++; }
    row(i, `  ${fg(C.lcyan)}[y copy result]${RESET}`, "sources.copy", { part: "result" }); i++;
    row(i, `  ${fg(C.lcyan)}[c download CSV]${RESET}`, "sources.download", { format: "csv" }); i++;
    row(i, `  ${fg(C.lcyan)}[J download JSON]${RESET}`, "sources.download", { format: "json" }); i++;
    put("");
    put(` ${dim("Outline")}  ${fg(C.white)}${p.outline || "this outline"}${RESET}`);
    put(` ${dim("Read")}     ${fg(C.white)}${s.readAt ? `${s.live ? "live, " : ""}as of ${s.readAt}` : "as written"}${RESET}`);
    put(` ${dim("Query")}    ${fg(C.white)}${s.query.text.replace(/^\s*>\s*/, "")}${RESET}`);
  }
  put("");
  put(` ${dim(p.note || "j k move · ⏎ fold or edit · e edit · y copy · g jump · esc back")}`);
  if (wide && w >= 108) {
    const cols = Math.floor((w - 4) / 3), narrow = drawSources(p, cols, now, false);
    const starts = FOLDS.map(f => narrow.hits.find(h => h.action === "sources.fold" && h.args.fold === f)!.row);
    const head = hits.find(h => h.action === "sources.fold")!.row;
    p.inspector.remapEditor(0, head - starts[0]!);
    const out = lines.slice(0, head), mapped = hits.filter(h => h.row < head);
    const height = Math.max(...starts.map((start, n) => (starts[n + 1] ?? narrow.lines.length) - start));
    for (let row = 0; row < height; row++) out.push(starts.map((start, n) => pad(row < (starts[n + 1] ?? narrow.lines.length) - start ? narrow.lines[start + row]! : "", cols) + RESET).join("  "));
    let focused = focus;
    starts.forEach((start, n) => {
      const end = starts[n + 1] ?? narrow.lines.length, col = n * (cols + 2);
      for (const hit of narrow.hits.filter(h => h.row >= start && h.row < end)) mapped.push({ ...hit, row: head + hit.row - start, from: hit.from + col, to: hit.to + col });
      if (narrow.focus >= start && narrow.focus < end) focused = head + narrow.focus - start;
    });
    return { lines: out, hits: mapped, items, focus: focused };
  }
  return { lines, hits, items, focus };
}

/** The source whose lines hold note line `line` (from 0), the nearest enclosing: the innermost when regions nest. */
export function sourceAt(a: SourcesAnswer, line: number): number {
  let best = -1;
  a.sources.forEach((s, i) => { if (line >= s.line && line <= s.endLine && (best < 0 || s.endLine - s.line <= a.sources[best]!.endLine - a.sources[best]!.line)) best = i; });
  return best;
}
