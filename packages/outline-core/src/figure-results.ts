// A live figure's results as plain Markdown (PIE-1355): what copying a page (the reader's Y, `note.copy`) and
// `ep0ch show --markdown` write under each `::graph-*` that asks the outline, so an agent without the outline's MCP can
// read a live page. It reads the props a figure is drawn from (figure-live.ts `liveProps`: the rows the reader draws),
// never a question of its own. Each figure's results are headed with its title, the row count, the time and its
// query, capped per figure, and a cut says so with the command that reads the rest. Pure: no I/O.
//
//   **Results · Open beds** · 3 rows · as of 2026-10-26 17:50 +00:00 · query: `type=bed`
//
//   - [x] ((id|Dig the bed))           check: a step per row ([x] done or approved, else [ ]; any other status said after it)
//   | Title | Updated |                table: the figure's columns, its title cell a reference
//   **doing** · 2                      tabs: a list per group, its other columns after the title
//   _showing 50 of 60 · the rest: `ep0ch find --ws pie --query type=bed --sort updated --direction desc` · MCP: `outline_query {…}`_
import { isChecklistStatus, statusWord, stepDone, type ChecklistStatus } from "./checklist-marks";
import { groupWhere, NONE } from "./figure-live";
import type { Props } from "./figure-props";
import { blockRefText } from "./link-syntax";
import { withThisAs } from "./query-atoms";
import { shellQuote as quoted } from "./shell-word";

/** The most rows one figure's results carry, unless the caller says. */
export const RESULTS_CAP = 50;
/** The most rows one copy's figures carry together: a figure past it says it was cut, with its command. */
export const RESULTS_BUDGET = 400;

export interface ResultsContext {
  /** The outline the figure is in, and the machine it was reached on: named in the command that reads the rest. */
  outline?: string;
  machine?: string;
  /** The note the figure is in: what `this` in its question stands for, in that command. */
  note?: string;
  /** When the results were read (ms). */
  at: number;
  /** Rows this figure may carry (RESULTS_CAP). */
  cap?: number;
}

/** What the service answered, as the reader drew it: how many results came, and whether the question came back cut. */
export interface ResultsFound { n: number; truncated: boolean }

/** A figure's results: the lines, the rows written and found, and whether any were left out. */
export interface FigureResults { lines: string[]; shown: number; total: number; cut: boolean }

/** `s` as an inline code span, its backticks fenced by longer ones. */
const code = (s: string) => {
  const ticks = "`".repeat(Math.max(0, ...[...s.matchAll(/`+/g)].map(m => m[0].length)) + 1);
  return ticks.length > 1 || s.startsWith(" ") || s.endsWith(" ") ? `${ticks} ${s} ${ticks}` : `\`${s}\``;
};
const two = (n: number) => String(n).padStart(2, "0");
/** A time as `2026-10-26 17:50 +01:00`, in this machine's zone, said. */
export const resultsTime = (ms: number) => {
  const d = new Date(ms), off = -d.getTimezoneOffset(), zone = `${off < 0 ? "-" : "+"}${two(Math.floor(Math.abs(off) / 60))}:${two(Math.abs(off) % 60)}`;
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())} ${zone}`;
};
const rows = (n: number, truncated: boolean) => `${n}${truncated ? "+" : ""} row${n === 1 && !truncated ? "" : "s"}`;
/** A table cell: one line, its pipes escaped (a GFM parser gives them back). */
const cell = (s: string) => s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");

/** The question as written: `query: …` or `view: …`. */
function asked(p: Props): string | null {
  if (p.query) return `query: ${code(String(p.query))}`;
  if (p.view) return `view: ${code(String(p.view))}`;
  return null;
}

/**
 * How to read every result of a question: the `ep0ch find` command, and outline_query's arguments from `offset`. `this`
 * in it is the note it was asked for (`ctx.note`), since at a shell it stands for nothing.
 */
export function restCommand(p: Props, ctx: Pick<ResultsContext, "outline" | "machine" | "note">, offset: number, asked = p.query ? String(p.query) : undefined): string | null {
  const { outline, machine } = ctx;
  const ws = `${outline ? ` --ws ${quoted(outline)}` : ""}${machine ? ` --machine ${quoted(machine)}` : ""}`;
  const of = outline ? { outline: machine ? `${outline}@${machine}` : outline } : {};
  const where = asked !== undefined && ctx.note ? withThisAs(asked, ctx.note) : asked;
  if (where !== undefined) {
    const sort = String(p.sort ?? "updated"), direction = String(p.direction ?? "desc");
    return `${code(`ep0ch find${ws} --query ${quoted(where)} --sort ${quoted(sort)} --direction ${quoted(direction)}`)} · MCP: ${code(`outline_query ${JSON.stringify({ ...of, query: where, sort: `${sort} ${direction}`, offset })}`)}`;
  }
  if (p.view) {
    const view = String(p.view).replace(/^\(\(|\)\)$/g, "").split("|")[0]!;
    return `${code(`ep0ch find${ws} --view ${quoted(view)}`)} · MCP: ${code(`outline_query ${JSON.stringify({ ...of, view, offset })}`)}`;
  }
  return null;
}

/** The line a cut figure (or tab) ends with: how many of how many, and the command that reads the rest. */
function cutLine(shown: number, total: number, truncated: boolean, rest: string | null): string {
  return `_showing ${shown} of ${total}${truncated ? "+" : ""}${rest ? ` · the rest: ${rest}` : ""}_`;
}

/** A row's reference, when it stands for a note; else its words. */
const ref = (block: unknown, label: string) => (typeof block === "string" && block ? blockRefText(block, label) : label);

/** A table's rows as a GFM table (headers, then a row each), its title column a reference to the row's note. */
function table(t: Props, n: number): string[] {
  const headers: string[] = (t.headers ?? []).map(String), body: string[][] = (t.rows ?? []).slice(0, n), blocks: unknown[] = t.blocks ?? [];
  if (!headers.length) return [];
  const title = Number(t.titleColumn ?? 0);
  const line = (cells: string[]) => `| ${cells.map(c => c || " ").join(" | ")} |`;
  return [line(headers.map(cell)), `|${headers.map(() => " --- ").join("|")}|`, ...body.map((r, i) => line(headers.map((_, k) => cell(k === title ? ref(blocks[i], String(r[k] ?? "")) : String(r[k] ?? "")))))];
}

/** One tab's (or a table's) rows as a list: the title as a reference, then each other column as `header: value`. */
function list(t: Props, n: number): string[] {
  const headers: string[] = (t.headers ?? []).map(String), body: string[][] = (t.rows ?? []).slice(0, n), blocks: unknown[] = t.blocks ?? [];
  const title = Number(t.titleColumn ?? 0);
  return body.map((r, i) => `- ${[ref(blocks[i], String(r[title] ?? "")), ...headers.flatMap((h, k) => (k === title || !r[k] ? [] : [`${h}: ${r[k]}`]))].join(" · ")}`);
}

/** A tab's question: the figure's, narrowed to the tab's value (or to no value, for the NONE tab), as a rank bar's is. */
const tabWhere = (p: Props, value: string) => groupWhere(String(p.query), String(p.group ?? "status"), value === NONE ? null : value);

/** The line a figure's results start with (and the blank line after it): its title, `count`, the time and its question. */
export function resultsHead(kind: string, props: Props, count: string, at: number): string[] {
  const question = asked(props);
  return [`**Results · ${String(props.title ?? `graph-${kind}`)}** · ${[count, `as of ${resultsTime(at)}`, ...(question ? [question] : [])].join(" · ")}`, ""];
}

/** A check row's box as Markdown has it (`[x]` done or approved, else `[ ]`), its status said after it when the box can't. */
function stepBox(status: unknown, done: unknown): { box: string; said: string } {
  const s: ChecklistStatus = isChecklistStatus(status) ? status : done ? "done" : "todo";
  return { box: stepDone(s) ? "[x]" : "[ ]", said: s === "done" || s === "todo" ? "" : ` · ${statusWord(s)}` };
}

/**
 * A live figure's results as Markdown lines, from the props the reader draws it with (`liveProps`' output) and what its
 * question found; null for a kind that has no Markdown form here (a quadrant, a matrix, a calendar: the caller writes its
 * drawing instead). `found` null: it wasn't answered (`error` says why). `error` with an answer: the service's word on it
 * (a key nobody has written, with the nearest), said under the rows.
 */
export function figureResultsMarkdown(kind: string, props: Props, found: ResultsFound | null, ctx: ResultsContext, error?: string): FigureResults | null {
  const cap = Math.max(0, ctx.cap ?? RESULTS_CAP);
  const head = (count: string) => resultsHead(kind, props, count, ctx.at);
  if (!found && error) return { lines: [...head("not answered"), `_${error}_`], shown: 0, total: 0, cut: false };
  const r = written(kind, props, found, ctx, cap, head);
  if (r && error) r.lines.push("", `_${error}_`);
  return r;
}

function written(kind: string, props: Props, found: ResultsFound | null, ctx: ResultsContext, cap: number, head: (count: string) => string[]): FigureResults | null {
  const n = found?.n ?? 0, truncated = !!found?.truncated;
  const flat = (all: string[], total: number) => {
    // A question that came back cut (more results than it asks for) is cut here too, whatever the cap.
    const shown = Math.min(cap, all.length), cut = shown < total || truncated;
    const lines = [...head(rows(total, truncated)), ...(all.length ? all.slice(0, shown) : ["_no results_"])];
    if (cut) lines.push("", cutLine(shown, total, truncated, restCommand(props, ctx, shown)));
    return { lines, shown, total, cut };
  };
  switch (kind) {
    case "check": {
      const items: Props[] = props.items ?? [];
      return flat(items.map(i => { const b = stepBox(i.status, i.done); return `- ${b.box} ${ref(i.block, String(i.label ?? ""))}${b.said}${i.note ? ` — ${i.note}` : ""}`; }), items.length);
    }
    case "timeline": {
      const events: Props[] = props.events ?? [];
      return flat(events.map(e => `- ${e.date ? `${e.date} · ` : ""}${ref(e.block, String(e.label ?? ""))}${e.state === "now" ? " (now)" : ""}`), events.length);
    }
    case "decision": {
      const options: Props[] = props.options ?? [];
      return flat(options.map(o => `- ${o.state ? `${o.state} · ` : ""}${ref(o.block, String(o.label ?? ""))}${o.reason ? ` — ${o.reason}` : ""}`), options.length);
    }
    case "table": {
      const all: unknown[] = props.rows ?? [], shown = Math.min(cap, all.length), total = all.length, cut = shown < total || truncated;
      const lines = [...head(rows(total, truncated)), ...(total ? table(props, shown) : ["_no results_"])];
      if (cut) lines.push("", cutLine(shown, total, truncated, restCommand(props, ctx, shown)));
      return { lines, shown, total, cut };
    }
    case "tabs": {
      // The cap is the figure's, shared by its groups in order: a group past it says how many it holds and how to read them.
      const tabs: Props[] = props.tabs ?? [];
      const lines = head(`${tabs.length} group${tabs.length === 1 ? "" : "s"}, ${rows(tabs.reduce((s, t) => s + (Number(t.count) || 0), 0), truncated)}`);
      let shown = 0, total = 0, cut = truncated;
      tabs.forEach((t, i) => {
        const count = Number(t.count) || 0, have: number = (t.rows ?? []).length, k = Math.min(cap - shown, have);
        shown += k; total += count;
        lines.push(...(i ? [""] : []), `**${t.value}** · ${count}`, "", ...(k ? list(t, k) : count ? [] : [`_nothing in ${t.value}_`]));
        if (k < count) { cut = true; lines.push(...(k ? [""] : []), cutLine(k, count, false, props.query ? restCommand(props, ctx, k, tabWhere(props, String(t.value))) : null)); }
      });
      return { lines, shown, total, cut };
    }
    case "rank": case "stat": case "kpi": {
      const items: Props[] = props.items ?? [];
      const lines = [...head(rows(items.length, false)), ...(items.length ? items.map(i => `- ${i.label ?? ""}: ${i.value ?? ""}`) : ["_no results_"])];
      return { lines, shown: items.length, total: items.length, cut: false };
    }
    case "meter": {
      const items: Props[] = props.items ?? [];
      const said = items.length ? items.map(i => `- ${i.label ? `${i.label}: ` : ""}${i.value}`) : [`- ${props.caption ?? `${Math.round(Number(props.value) * 100)}%`}`];
      return { lines: [...head(rows(n, truncated)), ...said], shown: said.length, total: n, cut: false };
    }
    default:
      return null;
  }
}
