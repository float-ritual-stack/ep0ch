// What a `::graph-*` figure says, before anyone draws it: its kind, its YAML and its Markdown rows read into the
// props every client draws from (the door's figures in characters, the publisher's in HTML). The drawing is each
// client's own; what the rows mean, what a day is and which state a word names are here, once. Pure: no I/O.
//
//   ::graph-<kind>        a component block (component-block.ts) with no arguments
//   ---                   its YAML: the data form, which wins over the Markdown for a field both give
//   title: …
//   ---
//   - label: value        its Markdown rows (figure-markdown.ts), each kind saying what it makes of them
//   ::

import { componentAttrs, componentBlocks, type ComponentBlock } from "./component-block";
import { expandRuns, figureRow, numbersOf, parseFigureMarkdown, type FigureMarkdown, type FigureRow } from "./figure-markdown";
import { readDate } from "./dates";
import { FIGURE_COMPONENT_SCHEMAS } from "./component-schemas-figures";
import type { SiteLink } from "./site";

/** A figure's props, from its YAML (or its Markdown, or the outline). */
export type Props = Record<string, any>;
/** A row, and the note it stands for when it is a child bullet (a click or ⏎ opens it). */
export type Row = FigureRow & { block?: string };
/** A figure's Markdown, its child bullets' rows among its rows. */
export type Markdown = Omit<FigureMarkdown, "rows"> & { rows: Row[] };

/** A component block's figure kind (`::graph-rank` is `rank`), or null when it isn't a live figure (one takes no arguments). */
export function graphKind(block: ComponentBlock): string | null {
  return block.args === null && /^graph-./.test(block.name) ? block.name.slice("graph-".length) : null;
}

/**
 * A figure as written: the YAML between its `---` lines, the Markdown after them (or its whole body when it has no
 * `---`), and the note it is in. `block`: it is that note's figure block (the note's text starts with it), so its child
 * bullets are rows too, as `rows: children` asks anywhere.
 */
export interface FigureSource {
  yaml: string; markdown?: readonly string[]; note?: string; block?: boolean;
  /** The body had its `---` lines (even around nothing). Absent: not known, so an empty `yaml` means it had none. */
  ruled?: boolean;
  /** Where `markdown` starts in the lines read: a row's `line` plus this is its line among them. */
  at?: number;
  /** The `{…}` after the figure's name (`::graph-table{project=lego}`): call-site arguments, read as props under its YAML. */
  attrs?: string;
  /** Where the figure is drawn: the invocations that draw its note (a `::use` on a host, an embed), outermost first. Absent: the note itself. */
  chain?: SiteLink[];
  /** The props of the call that draws it (a `::use`'s, `props.*` in the figure's Site), under its own call-site args. */
  props?: Record<string, string[]>;
}

/** A `::graph-*` block's lines (after its first line, to its `::`) as its YAML and its Markdown. */
export function figureSource(lines: readonly string[], note?: string, block?: boolean, attrs?: string): FigureSource {
  const yaml: string[] = [], markdown: string[] = [];
  let at = -1;
  const rule = (l: string) => /^\s*---\s*$/.test(l);
  // The YAML is between a first `---` (nothing above it but blank lines) and the next; any other `---` is
  // Markdown's (a rule).
  const open = lines.findIndex(l => l.trim());
  let dashes = open >= 0 && rule(lines[open]!) ? 0 : 2;
  for (const [i, l] of lines.entries()) {
    if (dashes < 2 && i < open) continue;
    if (dashes < 2 && rule(l)) { dashes++; continue; }
    if (dashes !== 1 && at < 0) at = i;
    (dashes === 1 ? yaml : markdown).push(l);
  }
  return { yaml: yaml.join("\n"), markdown, at: Math.max(0, at), ruled: open >= 0 && rule(lines[open]!), ...(note ? { note } : {}), ...(block ? { block } : {}), ...(attrs ? { attrs } : {}) };
}

/**
 * The warning for a figure written without its `---` lines (PIE-941): a body of only `key: value` lines (a continuation
 * indented under one is fine) naming at least one of the kind's own YAML props (its schema's: `query:`, `columns:`) is
 * read as Markdown rows, so those props never reach the figure. `body` is the lines between the figure's first line
 * and its `::`. null when it isn't that, or has a `---` rule: a `Note: …` caption on a decision is a caption. One
 * sentence for every surface that draws or lists the figure (the door, Detail, the web, a save's status).
 */
export function propsWithoutRules(kind: string, body: readonly string[]): string | null {
  const lines = body.filter(l => l.trim());
  const key = /^([A-Za-z][\w-]*):(?:\s|$)/;
  if (!lines.length || lines.some(l => /^\s*---\s*$/.test(l)) || !lines.every(l => key.test(l) || /^\s+\S/.test(l)) || !key.test(lines[0]!)) return null;
  const known = new Set(FIGURE_COMPONENT_SCHEMAS.find(s => s.id === `graph-${kind}`)?.props.filter(p => p.where === "yaml").map(p => p.key));
  const names = lines.flatMap(l => key.exec(l)?.[1] ?? []);
  if (!names.some(name => known.has(name))) return null;
  const shown = names.map(name => `${name}:`);
  return `the ::graph-${kind} has ${shown.slice(0, 3).join(", ")}${shown.length > 3 ? ` and ${shown.length - 3} more` : ""} but no --- lines: they are read as Markdown rows, not properties; put them between --- lines`;
}

/**
 * The rows of each `::graph-check` in a note's `lines` that hold a box (PIE-864): steps, as a checklist's are. `line`
 * is the row's line among `lines`, `box` where its `[ ]` starts in it. The service's checklist reads them from here,
 * and the door and the web pages place each row's box by its `line`.
 */
export function figureSteps(lines: readonly string[]): { line: number; box: number }[] {
  const out: { line: number; box: number }[] = [];
  for (const c of componentBlocks(lines)) {
    if (c.end <= c.start || graphKind(c) !== "check") continue;
    const src = figureSource(lines.slice(c.start + 1, c.end));
    for (const r of parseFigureMarkdown(src.markdown ?? []).rows) {
      if (!r.status) continue;
      const line = c.start + 1 + (src.at ?? 0) + r.line, box = /^\s*(?:[-*+]|\d+[.)])\s+/.exec(lines[line] ?? "")?.[0].length;
      if (box !== undefined && lines[line]![box] === "[") out.push({ line, box });
    }
  }
  return out;
}

/** A note's child bullets as figure rows, as the caller asks the outline for them; null when it can't ask. */
export type ChildRows = (note: string) => { rows: Row[]; waiting: boolean } | null;

/**
 * A value that starts with `{{` is YAML's flow map (`title: {{this.title}}` parses as an object, or fails), but it is a
 * `{{ }}` placeholder: quote such a plain value, so it reaches the figure as the text it was written as.
 */
export function quoteBraces(yaml: string): string {
  return yaml.split("\n").map(line => {
    const m = /^(\s*(?:-\s+)*(?:[A-Za-z_][\w.-]*:\s+)?)(\{\{.*)$/.exec(line);
    return m ? `${m[1]}"${m[2]!.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : line;
  }).join("\n");
}

/**
 * A figure's props: its YAML over what its Markdown rows and (for a figure block, or `rows: children`) its note's child
 * bullets give. The YAML wins: a field it sets is never taken from the Markdown. `children`: the rows came from child
 * notes; `waiting`: they are still being asked for.
 */
export function figureProps(kind: string, src: FigureSource, childRows?: ChildRows): { props: Props; children: boolean; waiting: boolean; warning?: string; args?: Record<string, string> } | { error: string } {
  let yaml: Props = {};
  try { yaml = (Bun.YAML.parse(quoteBraces(src.yaml)) as Props) ?? {}; }
  catch (e) { return { error: `bad YAML: ${(e as Error).message}` }; }
  if (typeof yaml !== "object" || Array.isArray(yaml)) return { error: "the YAML between --- lines is a map of props (title: …)" };
  const md: Markdown = parseFigureMarkdown(src.markdown ?? []);
  // The fields this kind's rows give that the YAML leaves open: only those can come from child bullets.
  // The first field a kind's rows give is its rows (events, items, marks, days…); the rest go with them (a calendar's
  // month, an uptime's dates). A YAML that gives the rows, or asks the outline for them, takes none from children.
  const probe = Object.keys(FIGURE_MARKDOWN[kind]?.({ rows: [figureRow("2026-03-02: 1")], paragraphs: [], fences: [] }, {}) ?? {});
  const rowFields = probe.filter(k => !(k in yaml));
  const own = (probe[0] !== undefined && probe[0] in yaml) || !!(yaml.query || yaml.view || yaml.source);
  const wantsChildren = !!src.note && !own && rowFields.length > 0 && (yaml.rows === "children" || (src.block === true && yaml.rows !== "body"));
  const kids = wantsChildren && childRows ? childRows(src.note!) : null;
  if (kids) md.rows.push(...kids.rows);
  const from = FIGURE_MARKDOWN[kind]?.(md, yaml) ?? {};
  // "child notes" only when a field drawn came from them: rows this kind makes nothing of don't count.
  const children = !!kids?.rows.length && rowFields.some(k => k in (FIGURE_MARKDOWN[kind]!({ rows: kids.rows, paragraphs: [], fences: [] }, yaml)));
  // Props written without their `---` lines are drawn as Markdown; the figure says so (PIE-941).
  const warning = src.ruled || src.yaml.trim() ? null : propsWithoutRules(kind, src.markdown ?? []);
  // Call-site arguments (`::graph-table{project=lego}`) sit under the YAML and over the Markdown; they are `props.*` to a `{{ }}` in it.
  const args = src.attrs ? Object.fromEntries(componentAttrs(src.attrs).pairs.map(p => [p.key, p.value])) : undefined;
  return { props: { ...from, ...args, ...yaml }, children, waiting: !!kids?.waiting, ...(warning ? { warning } : {}), ...(args && Object.keys(args).length ? { args } : {}) };
}

// ── shared readings ──────────────────────────────────────────────────────────────────────────────────

/**
 * `ordered`: the names listed first (an `xs:`, an `order-across:`), deduplicated, then the rest in the order seen.
 */
export function ordered(listed: unknown, seen: readonly string[]): string[] {
  const given = [...new Set((Array.isArray(listed) ? listed : []).map(String))];
  return [...given, ...seen.filter((v, i, a) => v && !given.includes(v) && a.indexOf(v) === i)];
}
/** A list prop as an array of objects (a YAML list of maps), anything else as none. */
export const records = (v: unknown): Record<string, any>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, any> => !!x && typeof x === "object") : []);

export type DecisionState = "chosen" | "rejected" | "open";

/** A `decision-state` (or an option's `state:`) as one of the three; anything else is open. */
export function decisionState(v: unknown): DecisionState {
  const s = String(v ?? "").trim().toLowerCase();
  if (["chosen", "accepted", "decided", "yes", "picked", "done"].includes(s)) return "chosen";
  if (["rejected", "declined", "no", "dropped", "superseded"].includes(s)) return "rejected";
  return "open";
}

export type Cells = Map<string, Map<string, number>>;

/** `cells` as a map of maps, from a Map, a YAML map of maps, or nothing. */
export function cellsOf(v: unknown): Cells {
  if (v instanceof Map) return v as Cells;
  const out: Cells = new Map();
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [r, cols] of Object.entries(v as Record<string, unknown>)) {
      if (!cols || typeof cols !== "object" || Array.isArray(cols)) continue;
      out.set(r, new Map(Object.entries(cols as Record<string, unknown>).map(([c, n]) => [c, Number(n) || 0])));
    }
  }
  return out;
}

/** Add `n` to a cell, making its row and column as needed. */
export function addCell(cells: Cells, row: string, col: string, n: number): void {
  const r = cells.get(row) ?? new Map<string, number>();
  cells.set(row, r);
  r.set(col, (r.get(col) ?? 0) + n);
}

// ── days: dates are written `YYYY-MM-DD` and counted as whole days, in no time zone ───────────────────

export const DAY = 86_400_000;
/** `YYYY-MM-DD` (or a longer ISO time, or a Date), or any date a value holds as people write it (`Oct 20`, `10/20`: outline-core `dates.ts`), as a day number, or null. */
export function dayOf(v: unknown): number | null {
  if (v instanceof Date) return Math.floor(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()) / DAY);
  const text = String(v ?? "").trim();
  // The shared reader first, so a zoned time falls on the same day here as in a query; a date with words after it
  // (`2026-10-20 standup`) is still its day.
  const when = text ? readDate(text) : null;
  if (when) return Math.floor(when.from / DAY);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY) : null;
}
export const isoOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
/** The day a moment (epoch ms) falls on, as the person's clock says. */
export const localDay = (ms: number) => { const d = new Date(ms); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); };
/** Today, as the person's clock says, as a day number. */
export const today = () => localDay(Date.now());
/** A day's weekday, 0 Sunday to 6 Saturday. */
export const weekday = (day: number) => (day + 4) % 7;
/** `weekStartsOn:` as 0 (Sunday) to 6: a number, or a day's name (`mon`, `Monday`). */
export function weekStart(v: unknown, fallback = 1): number {
  if (typeof v === "number" && v >= 0 && v <= 6) return Math.floor(v);
  const i = ["su", "mo", "tu", "we", "th", "fr", "sa"].indexOf(String(v ?? "").trim().toLowerCase().slice(0, 2));
  return i >= 0 ? i : fallback;
}
export const WEEKDAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
export const MONTH_ABBREVIATIONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

export type DayState = "ok" | "degraded" | "down" | "empty";
/** A status as written (ok, up, success; degraded, warn, partial; down, fail, error) as one of the four. */
export function dayState(v: unknown): DayState {
  const s = String(v ?? "").trim().toLowerCase();
  if (["ok", "up", "success", "succeeded", "pass", "passed", "done", "green"].includes(s)) return "ok";
  if (["degraded", "warn", "warning", "partial", "slow", "amber", "yellow"].includes(s)) return "degraded";
  if (["down", "fail", "failed", "failure", "error", "missed", "red"].includes(s)) return "down";
  return "empty";
}
const WORSE: Record<DayState, number> = { empty: 0, ok: 1, degraded: 2, down: 3 };
/** The worse of two days' states (a day with a failed run and a good one was degraded at best). */
export const worse = (a: DayState, b: DayState): DayState => (WORSE[a] >= WORSE[b] ? a : b);

/** A day per date from `from` to `to` (the results' own first and last when not given), each the worst state that day. */
export function uptimeDays(results: { day: number; state: DayState; block?: string }[], from?: number | null, to?: number | null): Props {
  if (!results.length && (from == null || to == null)) return { days: [] };
  const lo = from ?? Math.min(...results.map(r => r.day)), hi = to ?? Math.max(...results.map(r => r.day));
  const n = Math.max(0, Math.min(3660, hi - lo + 1));
  const days: DayState[] = Array(n).fill("empty"), blocks: (string | undefined)[] = Array(n).fill(undefined);
  for (const r of results) {
    const i = r.day - lo;
    if (i < 0 || i >= n) continue;
    const was = days[i]!;
    days[i] = worse(was, r.state);
    if (days[i] !== was || !blocks[i]) blocks[i] = r.block;
  }
  return { days, blocks, from: isoOf(lo), to: isoOf(hi) };
}

/** The month a calendar shows (its `year`/`month`, else today's), as day numbers. */
export function monthOf(p: Props): { first: number; last: number; year: number; month: number } {
  const now = new Date((dayOf(p.today) ?? today()) * DAY);
  const year = Number(p.year) || now.getUTCFullYear(), month = Math.min(12, Math.max(1, Number(p.month) || now.getUTCMonth() + 1));
  return { first: Math.floor(Date.UTC(year, month - 1, 1) / DAY), last: Math.floor(Date.UTC(year, month, 0) / DAY), year, month };
}

// ── what each kind makes of its rows ─────────────────────────────────────────────────────────────────

/** The first number in a row's value, else its value as written. */
const valueOf = (r: Row) => numbersOf(r)[0] ?? r.value;

/** Every number in the rows' values and the paragraphs, runs spelled out, in order. */
function sparkOf(md: Markdown): Props {
  const data = [...md.rows.flatMap(numbersOf), ...md.paragraphs.flatMap(p => expandRuns(p).map(Number).filter(Number.isFinite))];
  return data.length ? { data } : {};
}

const PATH = /\s*(?:→|->)\s*/;

/** What each kind makes of a figure's Markdown rows: props under its YAML's. */
export const FIGURE_MARKDOWN: Record<string, (md: Markdown, p: Props) => Props> = {
  // - 2026-03: label   **now**   *next*   — a muted note
  timeline: md => (md.rows.length ? {
    events: md.rows.map(r => ({ date: r.label ?? "", label: r.label === null ? r.text : r.value, state: r.emphasis === "strong" ? "now" : r.emphasis === "em" ? "next" : undefined, note: r.note ?? undefined, block: r.block })),
  } : {}),
  // - [x] done   - [ ] open   - **done** (bold without a box)   — a muted note
  check: md => (md.rows.length ? {
    // A written row's `line` (its line in the Markdown read) and its box's status: a mark on it rewrites that box (PIE-864).
    items: md.rows.map(r => ({ label: r.text, done: r.done ?? r.emphasis === "strong", note: r.note ?? undefined, block: r.block,
      ...(r.block === undefined ? { line: r.line } : {}), ...(r.status ? { status: r.status } : {}) })),
  } : {}),
  // - label: 12   **the accent row**   *a receding one*
  rank: md => (md.rows.length ? { items: md.rows.map(r => ({ label: r.label ?? r.text, value: valueOf(r), accent: r.emphasis === "strong", muted: r.emphasis === "em" })) } : {}),
  funnel: md => (md.rows.length ? { steps: md.rows.map(r => ({ label: r.label ?? r.text, value: valueOf(r) })) } : {}),
  // - outbox: 18   the bold one is the accent (else the last)
  stat: md => (md.rows.length ? { items: md.rows.map(r => ({ label: r.label ?? "", value: r.label === null ? r.text : r.value, accent: r.emphasis === "strong" })) } : {}),
  kpi: (md, p) => FIGURE_MARKDOWN.stat!(md, p),
  // - label: 48   one bar each against the YAML's limit:; the bold one is the accent
  meter: md => (md.rows.length ? { items: md.rows.map(r => ({ label: r.label ?? "", value: valueOf(r), accent: r.emphasis === "strong" })) } : {}),
  // 2 0 5 11 3*2 (rows or paragraphs); a row each (`- Mon: 2`) labels the points
  spark: md => sparkOf(md),
  plot: md => {
    const s = sparkOf(md);
    const labelled = md.rows.length > 1 && md.rows.every(r => r.label !== null && numbersOf(r).length === 1);
    return labelled ? { ...s, labels: md.rows.map(r => r.label) } : s;
  },
  // `- **chosen** — reason`, `- *rejected* — reason`, `- open — reason`; paragraphs after them are the text.
  decision: md => ({
    ...(md.rows.length ? { options: md.rows.map(r => ({ label: r.text, state: r.emphasis === "strong" ? "chosen" : r.emphasis === "em" ? "rejected" : "open", reason: r.note ?? undefined, block: r.block })) } : {}),
    ...(md.paragraphs.length ? { text: md.paragraphs } : {}),
  }),
  // `- speaker: message`; a row without a speaker is the last one's again; an italic row is an aside.
  chat: md => {
    if (!md.rows.length) return {};
    let from = "";
    return {
      messages: md.rows.map(r => {
        if (r.label !== null) from = r.label;
        return { from, text: r.label !== null ? r.value : r.text, aside: r.emphasis === "em", block: r.block };
      }),
    };
  },
  // `- ctrl+k: what it does`; bold learns first.
  keys: md => {
    const rows = md.rows.filter(r => r.label !== null);
    return rows.length ? { keys: rows.map(r => ({ keys: r.label, action: r.value, learn: r.emphasis === "strong", block: r.block })) } : {};
  },
  // Every value of the rows and paragraphs (`ok*20 degraded down`), in order; `- 2026-09-01: …` dates the first.
  uptime: md => {
    // Each dated row starts at its date (a gap between rows is days with no run); an undated one follows on.
    const results: { day: number; state: DayState }[] = [], undated: string[] = [];
    let at: number | null = null;
    const put = (v: string) => { if (at === null) undated.push(v); else results.push({ day: at++, state: dayState(v) }); };
    for (const r of md.rows) { const d = dayOf(r.label); if (d !== null) at = d; r.values.forEach(put); }
    md.paragraphs.flatMap(p => expandRuns(p)).forEach(put);
    // Values before the first date are the days just before it.
    if (results.length) return uptimeDays([...undated.map((v, i) => ({ day: results[0]!.day - undated.length + i, state: dayState(v) })), ...results]);
    return undated.length ? { days: undated } : {};
  },
  // `- 2026-03-02: 0 1 4 2 0*3`: counts for that day and the days after it.
  activity: md => {
    const counts: Record<string, number> = {};
    for (const r of md.rows) {
      const d = dayOf(r.label);
      if (d === null) continue;
      r.values.forEach((v, i) => { const n = Number(v); if (Number.isFinite(n)) counts[isoOf(d + i)] = (counts[isoOf(d + i)] ?? 0) + n; });
    }
    return Object.keys(counts).length ? { counts } : {};
  },
  // `- 12: launch`, `- 2026-03-12: launch` (a date in the month); bold leads, italic recedes.
  calendar: md => {
    const marks = md.rows.flatMap(r => {
      if (r.label === null) return [];
      const date = dayOf(r.label);
      const day = date !== null ? new Date(date * DAY).getUTCDate() : /^\d{1,2}$/.test(r.label) ? Number(r.label) : NaN;
      const mark = { day, label: r.value + (r.note ? ` — ${r.note}` : ""), strong: r.emphasis === "strong", muted: r.emphasis === "em", block: r.block };
      return Number.isFinite(day) ? [date !== null ? { ...mark, date: isoOf(date) } : mark] : [];
    });
    const dated = md.rows.map(r => dayOf(r.label)).find(d => d !== null);
    const ym = dated != null ? new Date(dated * DAY) : null;
    return { ...(marks.length ? { marks } : {}), ...(ym ? { year: ym.getUTCFullYear(), month: ym.getUTCMonth() + 1 } : {}) };
  },
  // The first fence is the code; the ordered list after it, the notes (numbered as written, or in order).
  annotate: md => {
    const fence = md.fences[0];
    const listed = md.rows.filter(r => r.depth === 0);
    const notes: string[] = [];
    // Numbered as written while the number is near the list (a gap is a marker with no note); `0.` or a number far
    // past it follows the others instead of opening a hole.
    const spill: string[] = [];
    listed.forEach((r, i) => {
      const n = r.ordinal ?? i + 1, text = r.text + (r.note ? ` — ${r.note}` : "");
      if (n >= 1 && n <= listed.length + 10) notes[n - 1] = text; else spill.push(text);
    });
    notes.push(...spill);
    return { ...(fence ? { code: fence.lines.join("\n"), lang: fence.lang } : {}), ...(notes.length ? { notes: Array.from(notes, n => n ?? "") } : {}) };
  },
  // `- label: x, y`; a bold row is the accent, an italic one recedes. The YAML's `xs:` and `ys:` order the axes.
  quadrant: md => (md.rows.length
    ? { points: md.rows.map(r => ({ label: r.label ?? r.text, x: r.values[0] ?? "", y: r.values[1] ?? "", accent: r.emphasis === "strong", muted: r.emphasis === "em", block: r.block })) }
    : {}),
  // `- row: col=3 col2=1`: a cell per `name=n`; a bare number is the `value` column.
  matrix: md => {
    if (!md.rows.length) return {};
    const cells: Cells = new Map();
    for (const r of md.rows) {
      const row = r.label ?? r.text;
      for (const tok of r.values) {
        const m = /^(.+?)=(-?\d+(?:\.\d+)?)$/.exec(tok);
        if (m) addCell(cells, row, m[1]!, Number(m[2]));
        else if (tok && Number.isFinite(Number(tok))) addCell(cells, row, "value", Number(tok));
      }
    }
    return { cells };
  },
  // `- label: a | b | c`: the cells between `|`s. The YAML's `columns:` names them.
  compare: md => (md.rows.length
    ? { entries: md.rows.map(r => ({ label: r.label ?? r.text, cells: (r.label === null ? "" : r.value).split(/\s*\|\s*/).map(s => s.trim()), accent: r.emphasis === "strong", muted: r.emphasis === "em", block: r.block })) }
    : {}),
  // `- a → b: 7` (or `->`): a flow of 7; no number is a flow of 1; a bold row is the accent.
  flow: md => {
    if (!md.rows.length) return {};
    const flows = md.rows.flatMap(r => {
      const steps = (r.label ?? r.text).split(PATH).map(s => s.trim()).filter(Boolean);
      if (steps.length < 2) return [];
      // No number is a flow of 1; a written 0 stays 0.
      const given = r.label === null ? undefined : r.values[0];
      const value = given === undefined || given === "" ? 1 : Number.isFinite(Number(given)) ? Math.max(0, Number(given)) : 1;
      return steps.slice(1).map((to, i) => ({ from: steps[i]!, to, value, accent: r.emphasis === "strong" }));
    });
    return { flows };
  },
};
