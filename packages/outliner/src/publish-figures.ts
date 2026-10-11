// What a page draws for the outline's built-in components (PIE-387's rule: each component the door draws gets an HTML
// render here, or shows its source as code with a quiet "not drawn here yet"): the `::graph-*` figures, the `::links`
// components and saved views (a view's rows, a hub's lanes). What a figure's rows mean, and what a live one's answer
// becomes, is outline-core's (figure-props.ts, figure-live.ts), the same reading the door's figures draw from; the
// publisher asks the service (src/publish.ts) and this module only draws the props in HTML. Dark, phone first, no
// scripts: a tabs figure's tabs are radio buttons a tap switches.
import { cellsOf, dayOf, isoOf, monthOf, MONTH_ABBREVIATIONS, MONTH_NAMES, ordered, records, today, WEEKDAY_NAMES, weekday, weekStart, type Props } from "@ep0ch/outline-core/figure-props";
import { decisionState } from "@ep0ch/outline-core/figure-props";

const esc = (text: unknown) => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, "")) || 0);
const fmt = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-US") : String(v ?? ""));
const pct = (frac: number) => `${Math.max(0, Math.min(100, Math.round(frac * 1000) / 10))}%`;

/** Where a row's note opens on this page, or null when it isn't shown here (locked, outside a share). */
export type RowHref = (blockId: string) => string | null;

/** A row's words, a link to its note when it has one shown here. */
function rowText(text: unknown, block: unknown, href: RowHref): string {
  const to = typeof block === "string" ? href(block) : null;
  return to ? `<a href="${esc(to)}">${esc(text)}</a>` : esc(text);
}

/** A figure's frame: its title over it, its status (live · 12 results, or why not) under it. */
export function figureFrame(kind: string, title: string, body: string, foot = "", error = ""): string {
  return `<figure class="fig fig-${esc(kind)}">${title ? `<figcaption>${esc(title)}</figcaption>` : ""}${body}` +
    `${error ? `<p class="fig-error">${esc(error)}</p>` : ""}${foot ? `<p class="fig-foot">${esc(foot)}</p>` : ""}</figure>`;
}

/** A component this page doesn't draw yet: its source as code, and a quiet word that it isn't drawn here. */
export function componentSourceHtml(lines: readonly string[], why = "not drawn here yet"): string {
  return `<div class="fig-source"><pre><code>${esc(lines.join("\n"))}</code></pre><p class="fig-foot">${esc(why)}</p></div>`;
}

let tabsDrawn = 0;

/** Each kind's HTML from its props (static, or a live answer outline-core read). */
const KINDS: Record<string, (p: Props, href: RowHref) => string> = {
  table: (p, href) => {
    const head: string[] = (p.headers ?? []).map(String);
    const rows: string[][] = (Array.isArray(p.rows) ? p.rows : []).map((r: unknown) => (Array.isArray(r) ? r : [r]).map(String));
    const blocks: unknown[] = p.blocks ?? [];
    const align: string[] = Array.isArray(p.align) ? p.align : [];
    const tc = Math.max(0, Number(p.titleColumn) || 0);
    const cell = (tag: "td" | "th", text: string, k: number, block?: unknown) =>
      `<${tag}${align[k] === "right" ? ` class="num"` : ""}>${k === tc && block !== undefined ? rowText(text, block, href) : esc(text)}</${tag}>`;
    const foot: string[] | undefined = Array.isArray(p.footer) ? p.footer.map(String) : undefined;
    return `<div class="fig-scroll"><table>${head.length ? `<thead><tr>${head.map((h, k) => cell("th", h, k)).join("")}</tr></thead>` : ""}` +
      `<tbody>${rows.map((r, i) => `<tr>${r.map((c, k) => cell("td", c, k, blocks[i])).join("")}</tr>`).join("")}</tbody>` +
      `${foot ? `<tfoot><tr>${foot.map((f, k) => cell("th", f, k)).join("")}</tr></tfoot>` : ""}</table></div>`;
  },

  // One tab per value, a tap on a tab (a radio button's label) shows its table: no script.
  tabs: (p, href) => {
    const tabs: Props[] = records(p.tabs);
    if (!tabs.length) return `<p class="dim">no results</p>`;
    const name = `fig-tabs-${++tabsDrawn}`;
    const bar = tabs.map((t, i) => `<input type="radio" class="fig-tab-input" name="${name}" id="${name}-${i}"${i ? "" : " checked"}>` +
      `<label class="fig-tab" for="${name}-${i}">${esc(t.value)} <span class="dim">${esc(t.count)}</span></label>`).join("");
    const panels = tabs.map(t => `<div class="fig-panel">${t.rows?.length ? KINDS.table!({ ...t, titleColumn: t.titleColumn }, href) : `<p class="dim">nothing in ${esc(t.value)}</p>`}` +
      `${t.more ? `<p class="fig-foot">${esc(t.more)} more · limit: ${esc(p.limit ?? 50)} a tab</p>` : ""}</div>`).join("");
    return `<div class="fig-tabs">${bar}<div class="fig-panels">${panels}</div></div>` +
      `${p.truncated ? `<p class="fig-foot">more results than one question answers: counts are at least these</p>` : ""}`;
  },

  stat: (p) => {
    const items: Props[] = records(p.items);
    const marked = items.some(it => it.accent);
    return `<div class="fig-stats">${items.map((it, i) => `<div class="fig-stat${(marked ? it.accent : i === items.length - 1) ? " accent" : ""}">` +
      `<span class="v">${esc(fmt(it.value))}</span><span class="l">${esc(it.label)}</span></div>`).join("")}</div>`;
  },
  kpi: (p, href) => KINDS.stat!(p, href),

  check: (p, href) => `<ul class="fig-list fig-check">${records(p.items).map(it =>
    `<li class="${it.done ? "done" : ""}"><span class="box" aria-label="${it.done ? "done" : "open"}">${it.done ? "☑" : "☐"}</span> ${rowText(it.label, it.block, href)}` +
    `${it.note ? ` <span class="dim">— ${esc(it.note)}</span>` : ""}</li>`).join("")}</ul>`,

  rank: (p, href) => {
    const items: Props[] = records(p.items);
    const max = Math.max(1, ...items.map(i => num(i.value)));
    return `<div class="fig-bars">${items.map(i => `<div class="fig-bar${i.accent ? " accent" : i.muted ? " muted" : ""}"><span class="l">${rowText(i.label, i.block, href)}</span>` +
      `<span class="track"><span class="fill" style="width:${pct(num(i.value) / max)}"></span></span><span class="v">${esc(fmt(i.value))}</span></div>`).join("")}</div>`;
  },
  funnel: (p, href) => KINDS.rank!({ items: records(p.steps).map(s => ({ label: s.label, value: s.display ?? s.value })) }, href),

  timeline: (p, href) => `<ol class="fig-timeline">${records(p.events).map(e =>
    `<li class="${e.state === "now" ? "now" : e.state === "next" ? "next" : ""}"><span class="d">${esc(e.date)}</span><span class="t">${rowText(e.label, e.block, href)}` +
    `${e.note ? ` <span class="dim">— ${esc(e.note)}</span>` : ""}</span></li>`).join("")}</ol>`,

  meter: (p) => {
    if (p.limit === undefined) {
      const v = num(p.value), frac = v > 1 ? v / 100 : v;
      return `<div class="fig-meter"><span class="track"><span class="fill" style="width:${pct(frac)}"></span></span><span class="v">${Math.round(frac * 100)}%</span></div>` +
        `${p.caption ? `<p class="dim">${esc(p.caption)}</p>` : ""}`;
    }
    const limit = num(p.limit), unit = p.unit ? ` ${String(p.unit)}` : "";
    if (!(limit > 0)) return `<p class="fig-error">limit: ${esc(fmt(p.limit))} · a budget is a number above 0</p>`;
    const items: Props[] = records(p.items).length ? records(p.items) : [{ label: p.label ?? "", value: p.value }];
    return items.map(it => {
      const v = Math.max(0, num(it.value)), over = v > limit, room = Math.abs(limit - v);
      return `<div class="fig-meter${over ? " over" : it.accent ? " accent" : ""}">${it.label ? `<span class="l">${esc(it.label)}</span>` : ""}` +
        `<span class="track"><span class="fill" style="width:${pct(Math.min(v, limit) / limit)}"></span></span>` +
        `<span class="v">${esc(fmt(v))} / ${esc(fmt(limit))}${esc(unit)}</span><span class="room">${esc(fmt(room))}${esc(unit)} ${over ? "over" : "left"}</span></div>`;
    }).join("") + (p.caption ? `<p class="dim">${esc(p.caption)}</p>` : "");
  },

  decision: (p, href) => {
    const glyph = { chosen: "●", rejected: "×", open: "○" } as const;
    const options = records(p.options).map(o => {
      const state = decisionState(o.state);
      return `<li class="${state}"><span class="g" aria-label="${state}">${glyph[state]}</span> <span class="t">${rowText(o.label, o.block, href)}</span>` +
        `${o.reason ? ` <span class="dim">— ${esc(o.reason)}</span>` : ""}</li>`;
    }).join("");
    const prose: string[] = Array.isArray(p.text) ? p.text.map(String) : p.text ? [String(p.text)] : [];
    const meta = [p.status, p.date].filter(Boolean).map(String);
    return `<ul class="fig-list fig-decision">${options}</ul>${prose.map(t => `<p>${esc(t)}</p>`).join("")}${meta.length ? `<p class="dim">${esc(meta.join(" · "))}</p>` : ""}`;
  },

  uptime: (p, href) => {
    if (p.days !== undefined && !Array.isArray(p.days)) return `<p class="fig-error">days: is a list of each day's status (ok, degraded, down)</p>`;
    const days: string[] = (p.days ?? []).map((d: unknown) => String(d));
    const states = days.map(d => (["ok", "degraded", "down", "empty"].includes(d) ? d : "empty"));
    if (!states.length) return `<p class="dim">no days</p>`;
    const blocks: (string | undefined)[] = p.blocks ?? [];
    const start = dayOf(p.from);
    const label = (i: number) => (start !== null ? isoOf(start + i) : `day ${i + 1}`);
    const cells = states.map((s, i) => {
      const to = s !== "ok" && blocks[i] ? href(blocks[i]!) : null;
      const cell = `<span class="u ${s}" title="${esc(`${label(i)} · ${s}`)}"></span>`;
      return to ? `<a href="${esc(to)}">${cell}</a>` : cell;
    }).join("");
    const seen = states.filter(s => s !== "empty"), ok = seen.filter(s => s === "ok").length;
    const count = (s: string) => states.filter(d => d === s).length;
    const share = seen.length ? `${Math.round((ok / seen.length) * 1000) / 10}%` : "–";
    return `<div class="fig-uptime">${cells}</div><p class="fig-range dim"><span>${esc(p.from ?? "")}</span><span>${esc(p.to ?? "")}</span></p>` +
      `<p><strong class="accent">${esc(share)} ok</strong> <span class="dim">· ${seen.length} of ${states.length} days · ${count("degraded")} degraded · ${count("down")} down</span></p>`;
  },

  activity: (p) => {
    const counts = new Map<number, number>();
    for (const [k, v] of Object.entries(p.counts ?? {})) { const d = dayOf(k); if (d !== null) counts.set(d, (counts.get(d) ?? 0) + (Number(v) || 0)); }
    const start = weekStart(p.weekStartsOn, 0);
    const last = dayOf(p.to) ?? (counts.size ? Math.max(...counts.keys()) : today());
    const end = last + ((start + 6 - weekday(last) + 7) % 7);
    const firstData = counts.size ? Math.min(...counts.keys()) : last;
    const wanted = Number(p.weeks) || Math.ceil((end - (firstData - ((weekday(firstData) - start + 7) % 7)) + 1) / 7);
    const weeks = Math.max(1, Math.min(53, wanted));
    const first = end - weeks * 7 + 1;
    const max = Math.max(1, ...[...counts].filter(([d]) => d >= first && d <= last).map(([, n]) => n));
    const shade = (n: number) => (n <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((n / max) * 4))));
    const cells: string[] = [];
    for (let c = 0; c < weeks; c++) for (let r = 0; r < 7; r++) {
      const day = first + c * 7 + r, n = counts.get(day) ?? 0;
      cells.push(day > last ? `<span class="a none"></span>` : `<span class="a s${shade(n)}" title="${esc(`${isoOf(day)} · ${n}`)}"></span>`);
    }
    const total = [...counts].filter(([d]) => d >= first && d <= last).reduce((a, [, n]) => a + n, 0);
    const from = new Date(first * 86_400_000), to = new Date(last * 86_400_000);
    return `<div class="fig-activity" style="--weeks:${weeks}">${cells.join("")}</div>` +
      `<p><strong class="accent">${total}</strong> <span class="dim">in ${weeks} week${weeks === 1 ? "" : "s"} · ${MONTH_ABBREVIATIONS[from.getUTCMonth()]} ${from.getUTCDate()} to ${MONTH_ABBREVIATIONS[to.getUTCMonth()]} ${to.getUTCDate()}</span></p>`;
  },

  calendar: (p, href) => {
    const { first, last, year, month } = monthOf(p);
    const days = last - first + 1, now = dayOf(p.today) ?? today();
    const start = weekStart(p.weekStartsOn, 1);
    const marks = records(p.marks).flatMap(m => {
      const on = dayOf(m.date), day = on !== null ? on - first + 1 : Number(m.day);
      return day >= 1 && day <= days ? [{ ...m, day } as Props] : [];
    });
    const marked = new Set(marks.map(m => m.day));
    const lead = (weekday(first) - start + 7) % 7;
    const cells = [...Array(lead)].map(() => `<td></td>`);
    for (let d = 1; d <= days; d++) cells.push(`<td class="${[marked.has(d) ? "mark" : "", first + d - 1 === now ? "today" : ""].filter(Boolean).join(" ")}">${d}</td>`);
    while (cells.length % 7) cells.push(`<td></td>`);
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(`<tr>${cells.slice(i, i + 7).join("")}</tr>`);
    const head = [...Array(7)].map((_, i) => `<th>${WEEKDAY_NAMES[(start + i) % 7]}</th>`).join("");
    const list = marks.sort((a, b) => a.day - b.day).map(m => `<li class="${m.strong ? "strong" : m.muted ? "muted" : ""}"><span class="d">${m.day}</span> ${rowText(m.label, m.block, href)}</li>`).join("");
    return `<table class="fig-calendar"><caption>${MONTH_NAMES[month - 1]} ${year}</caption><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>` +
      `${list ? `<ul class="fig-list fig-marks">${list}</ul>` : ""}`;
  },

  spark: (p) => {
    const d: number[] = (p.data ?? []).map(num);
    if (!d.length) return `<p class="dim">no values</p>`;
    const max = Math.max(...d, 1), steps = "▁▂▃▄▅▆▇█";
    const line = d.map((v, i) => `<span${i === d.length - 1 ? ` class="accent"` : ""}>${steps[Math.min(7, Math.max(0, Math.round((v / max) * 7)))]}</span>`).join("");
    return `<p class="fig-spark" aria-label="${esc(d.join(", "))}">${line}</p>${p.caption ? `<p class="dim">${esc(p.caption)}</p>` : ""}`;
  },
  plot: (p, href) => KINDS.spark!({ ...p, caption: Array.isArray(p.labels) && p.labels.length ? `${p.labels[0]} … ${p.labels.at(-1)}` : p.caption }, href),

  tree: (p) => {
    const walk = (nodes: Props[]): string => `<ul>${nodes.map(n => `<li${n.accent ? ` class="accent"` : ""}>${esc(n.label)}${n.meta ? ` <span class="dim">${esc(n.meta)}</span>` : ""}` +
      `${Array.isArray(n.children) && n.children.length ? walk(records(n.children)) : ""}</li>`).join("")}</ul>`;
    return `<div class="fig-tree">${walk(records(p.nodes))}</div>`;
  },

  chat: (p, href) => {
    const turns = records(p.messages).map(m => ({ ...m, from: String(m.from ?? "") }) as Props);
    const you = String(p.you ?? turns.find(t => t.from)?.from ?? "");
    let last = "";
    return `<ul class="fig-chat">${turns.map(t => {
      const again = t.from === last && !t.aside;
      if (!t.aside) last = t.from;
      return `<li class="${t.aside ? "aside" : t.from === you ? "you" : ""}">${again || !t.from ? "" : `<span class="who">${esc(t.from)}</span> `}${rowText(t.text, t.block, href)}</li>`;
    }).join("")}</ul>`;
  },

  compare: (p, href) => {
    const entries = records(p.entries);
    const named: string[] = Array.isArray(p.columns) && p.columns.length ? p.columns.map(String).slice(0, 3) : [];
    const n = Math.max(2, Math.min(3, named.length || Math.max(0, ...entries.map(e => (Array.isArray(e.cells) ? e.cells.length : 1)))));
    const columns = named.length ? named : Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
    return `<div class="fig-scroll"><table class="fig-compare"><thead><tr><th></th>${columns.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>` +
      entries.map(e => { const cells = Array.isArray(e.cells) ? e.cells.map(String) : [String(e.cells ?? "")];
        return `<tr class="${e.accent ? "accent" : e.muted ? "muted" : ""}"><th>${rowText(e.label, e.block, href)}</th>${columns.map((_, k) => `<td>${esc(cells[k] ?? "")}</td>`).join("")}</tr>`; }).join("") +
      `</tbody></table></div>`;
  },

  matrix: (p) => {
    const cells = cellsOf(p.cells);
    const rows = ordered(p["order-down"] ?? p.downs, [...cells.keys()]);
    const cols = ordered(p["order-across"] ?? p.acrosses, [...new Set([...cells.values()].flatMap(r => [...r.keys()]))]);
    if (!rows.length || !cols.length) return `<p class="dim">no cells</p>`;
    const max = Math.max(1, ...[...cells.values()].flatMap(r => [...r.values()]));
    const at = (r: string, c: string) => cells.get(r)?.get(c) ?? 0;
    return `<div class="fig-scroll"><table class="fig-matrix"><thead><tr><th></th>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>` +
      rows.map(r => `<tr><th>${esc(r)}</th>${cols.map(c => { const n = at(r, c); return `<td class="num" style="--share:${n / max}">${n || "·"}</td>`; }).join("")}</tr>`).join("") +
      `</tbody></table></div>`;
  },
};

/** The `::graph-*` kinds a page draws; any other shows its source, "not drawn here yet". */
export const HTML_FIGURE_KINDS: readonly string[] = Object.keys(KINDS);

/** A figure's body in HTML, or null when this kind isn't drawn on a page yet. */
export function figureBodyHtml(kind: string, props: Props, href: RowHref): string | null {
  const draw = KINDS[kind];
  if (!draw) return null;
  try { return draw(props, href); }
  catch (e) { return `<p class="fig-error">couldn't draw: ${esc((e as Error).message)}</p>`; }
}

// ── saved views: a view's rows, a hub's lanes ──────────────────────────────────────────────────────────

/** One row of a view: its note, its title, its summary chips. */
export interface ViewRow { id: string; title: string; href: string | null; chips: { label: string; value: string }[] }

/** A view as the service read it, ready to draw: its rows (in its order, grouped when it groups), or why none. */
export interface ViewLane {
  title: string;
  href: string | null;
  /** Its rows, in the service's order; under `group` they are grouped by that property's value, as they come. */
  rows: ViewRow[];
  groups?: { value: string; rows: ViewRow[] }[];
  count: number;
  truncated: boolean;
  /** The view's question, said when it has no rows. */
  query: string;
  /** The service's status when it isn't ready (missing, invalid…), with its errors. */
  problem?: string;
}

const rowItem = (r: ViewRow) => `<li data-block="${esc(r.id)}">${r.href ? `<a href="${esc(r.href)}"><span class="t">${esc(r.title || "untitled")}</span></a>` : `<span class="t">${esc(r.title || "untitled")}</span>`}` +
  `${r.chips.length ? `<span class="m">${r.chips.map(c => `<span class="chip">${esc(c.label)}: ${esc(c.value)}</span>`).join(" ")}</span>` : ""}</li>`;

/** A view's rows: its list (under group headings when it groups), or plainly that it has none and what it asks. */
export function viewRowsHtml(lane: ViewLane): string {
  if (lane.problem) return `<p class="fig-error">${esc(lane.problem)}</p>`;
  if (!lane.rows.length) return `<p class="dim">No notes match this view yet.${lane.query ? ` It asks <code>${esc(lane.query)}</code>.` : ""}</p>`;
  const more = lane.truncated ? `<p class="fig-foot">the first ${lane.rows.length} of ${lane.count}; the view's limit</p>` : "";
  if (lane.groups) {
    return lane.groups.map(g => `<h4 class="view-group">${esc(g.value)} <span class="dim">${g.rows.length}</span></h4><ul class="kids view-rows">${g.rows.map(rowItem).join("")}</ul>`).join("") + more;
  }
  return `<ul class="kids view-rows">${lane.rows.map(rowItem).join("")}</ul>${more}`;
}

/** One lane: the view's name (a link to its page) and count over its rows. */
export function viewLaneHtml(lane: ViewLane): string {
  const name = lane.href ? `<a href="${esc(lane.href)}">${esc(lane.title)}</a>` : esc(lane.title);
  return `<section class="lane ext-box"><h3>${name} <span class="dim">${lane.count}${lane.truncated ? "+" : ""}</span></h3>${viewRowsHtml(lane)}</section>`;
}

/** A hub's board: its views side by side when the page is wide, stacked on a phone (the `ext-row` grid). */
export function boardHtml(lanes: readonly ViewLane[]): string {
  return `<section class="board"><div class="ext-row" style="--ext-min:13rem">${lanes.map(viewLaneHtml).join("")}</div></section>`;
}

// ── `::links`, `::outlinks`, `::resources`, `::backlinks` ──────────────────────────────────────────────

/** One row of a links component: what it says, where it opens (null: not shown here), and a quiet word after it. */
export interface LinkRowHtml { text: string; href: string | null; note?: string }
/** One group of a links component, in the Tree's order and words. */
export interface LinkGroupHtml { name: string; glyph: string; rows: LinkRowHtml[]; note?: string }

export function linksHtml(title: string, groups: readonly LinkGroupHtml[], foot: string, error = ""): string {
  const alone = groups.length === 1;
  const body = groups.map(g => {
    const rows = g.rows.length
      ? `<ul class="fig-list fig-links">${g.rows.map(r => `<li><span class="g">${esc(g.glyph)}</span> ${r.href ? `<a href="${esc(r.href)}">${esc(r.text)}</a>` : esc(r.text)}${r.note ? ` <span class="dim">${esc(r.note)}</span>` : ""}</li>`).join("")}</ul>`
      : `<p class="dim">${esc(g.note ?? "nothing here yet")}</p>`;
    return alone ? rows : `<h4 class="view-group">${esc(g.name)} <span class="dim">${g.rows.length}</span></h4>${rows}`;
  }).join("");
  return figureFrame("links", title, body, foot, error);
}

/** Dark, quiet, in the page's type; tabs are radios, so `:checked` picks the panel (up to MAX_TABS of them). */
const MAX_TABS = 40;
export const FIGURE_STYLE = `
.fig{margin:1.25rem 0;padding:.75rem .9rem;border:1px dotted var(--rule);border-radius:.35rem;overflow-wrap:anywhere;font:15px/1.5 ui-sans-serif,system-ui,sans-serif}
.fig figcaption{font:600 12px/1.4 ui-sans-serif,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--link);margin:0 0 .6rem}
.fig .dim,.fig-foot{color:var(--dim)}
.fig-foot{font:12px/1.5 ui-monospace,Menlo,monospace;margin:.6rem 0 0}
.fig-error{color:#dd8a80;margin:.5rem 0 0}
.fig .accent,.fig strong.accent{color:var(--link)}
.fig table{display:table;width:100%;font:14px/1.45 ui-sans-serif,system-ui,sans-serif}
.fig td,.fig th{min-width:0}
.fig td.num,.fig th.num{text-align:right}
.fig-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.fig-tabs{display:flex;flex-wrap:wrap;gap:.25rem .9rem;align-items:baseline}
.fig-tab-input{position:absolute;opacity:0;width:1px;height:1px}
.fig-tab{cursor:pointer;padding:.45rem 0;min-height:2rem;border-bottom:2px solid transparent;color:var(--fg)}
.fig-tab-input:checked+.fig-tab{color:var(--link);border-bottom-color:var(--link);font-weight:600}
.fig-tab-input:focus-visible+.fig-tab{outline:1px solid var(--link);outline-offset:2px}
.fig-panels{flex-basis:100%;min-width:0}
.fig-panel{display:none}
${Array.from({ length: MAX_TABS }, (_, i) => `.fig-tab-input:nth-of-type(${i + 1}):checked~.fig-panels>.fig-panel:nth-child(${i + 1})`).join(",")}{display:block}
.fig-stats{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(7rem,1fr))}
.fig-stat .v{display:block;font:600 24px/1.2 ui-sans-serif,system-ui,sans-serif;color:var(--fg)}
.fig-stat.accent .v{color:var(--link)}
.fig-stat .l{display:block;color:var(--dim);font-size:13px}
.fig-list{list-style:none;margin:0;padding:0}
.fig-list li{padding:.3rem 0;border-bottom:1px solid var(--rule)}
.fig-list li:last-child{border-bottom:0}
.fig-check .box{color:var(--dim)}
.fig-check li.done .box{color:var(--link)}
.fig-bars,.fig-meter{font:14px/1.4 ui-monospace,Menlo,monospace}
.fig-bar,.fig-meter{display:grid;grid-template-columns:minmax(0,10rem) 1fr auto;gap:.6rem;align-items:center;margin:.3rem 0}
.fig-meter{grid-template-columns:auto 1fr auto}
.fig-meter .room{grid-column:1/-1;color:var(--dim);font-size:12px}
.fig-meter.over .fill{background:#dd8a80}.fig-meter.over .room{color:#dd8a80}
.track{display:block;height:.6rem;background:#232321;border-radius:.2rem;overflow:hidden}
.fill{display:block;height:100%;background:var(--link)}
.fig-bar.muted .fill{background:var(--dim)}
.fig-bar .l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fig-timeline{list-style:none;margin:0;padding:0 0 0 .9rem;border-left:1px solid var(--rule)}
.fig-timeline li{position:relative;padding:.25rem 0 .55rem .5rem}
.fig-timeline li::before{content:"●";position:absolute;left:-1.32rem;color:var(--fg);font-size:12px;top:.4rem}
.fig-timeline li.now::before{color:var(--link)}.fig-timeline li.next::before{content:"○";color:var(--dim)}
.fig-timeline li.next{color:var(--dim)}
.fig-timeline .d{display:block;font:12px/1.4 ui-monospace,Menlo,monospace;color:var(--dim)}
.fig-decision .g{display:inline-block;width:1.1em;color:var(--fg)}
.fig-decision li.chosen .g{color:var(--link)}.fig-decision li.chosen .t{font-weight:600}
.fig-decision li.rejected{color:var(--dim)}.fig-decision li.rejected a{color:var(--dim)}
.fig-uptime{display:flex;flex-wrap:wrap;gap:2px}
.fig-uptime .u{display:block;width:.55rem;height:1.4rem;border-radius:1px;background:#2a2a28}
.fig-uptime .u.ok{background:var(--link)}.fig-uptime .u.degraded{background:#d9b46a}.fig-uptime .u.down{background:#dd8a80}
.fig-range{display:flex;justify-content:space-between;font:12px/1.4 ui-monospace,Menlo,monospace;margin:.25rem 0}
.fig-activity{display:grid;grid-template-rows:repeat(7,.7rem);grid-auto-flow:column;grid-auto-columns:.7rem;gap:2px;overflow-x:auto;max-width:100%}
.fig-activity .a{border-radius:1px;background:#232321}
.fig-activity .a.none{background:none}
.fig-activity .s1{background:#2c3a52}.fig-activity .s2{background:#3e5679}.fig-activity .s3{background:#6189c4}.fig-activity .s4{background:var(--link)}
.fig-calendar{max-width:22rem}
.fig-calendar caption{text-align:left;font-weight:600;padding:0 0 .35rem}
.fig-calendar th,.fig-calendar td{text-align:center;padding:.3rem 0;border:0}
.fig-calendar td.mark{color:var(--link);font-weight:600}
.fig-calendar td.today{outline:1px solid var(--fg);outline-offset:-2px;border-radius:.2rem}
.fig-marks .d{display:inline-block;min-width:1.6em;color:var(--link)}
.fig-marks li.muted{color:var(--dim)}
.fig-spark{font:20px/1 ui-monospace,Menlo,monospace;letter-spacing:1px;color:#6189c4;margin:.25rem 0}
.fig-tree ul{list-style:none;margin:0;padding-left:1rem;border-left:1px solid var(--rule)}
.fig-tree>ul{border-left:0;padding-left:0}
.fig-chat{list-style:none;margin:0;padding:0}
.fig-chat li{padding:.2rem 0}.fig-chat .who{font-weight:600}.fig-chat li.you .who{color:var(--link)}.fig-chat li.aside{color:var(--dim);font-style:italic}
.fig-compare tr.accent th{color:var(--link)}.fig-compare tr.muted{color:var(--dim)}
.fig-matrix td{background:rgba(143,184,255,calc(var(--share,0)*.35))}
.fig-source pre{margin:1rem 0 .25rem}
.fig-source .fig-foot{margin:0 0 1rem}
.fig-links .g{color:var(--dim)}
.view-group{font:600 12px/1.4 ui-sans-serif,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin:1rem 0 .3rem}
.view-rows .chip{display:inline-block;margin-right:.5rem}
section.board{margin:1.5rem 0}
.lane h3{font:600 14px/1.4 ui-sans-serif,system-ui,sans-serif;margin:0 0 .4rem}
.lane h3 a{text-decoration:none}
.lane ul.kids li>a{padding:.5rem .2rem;min-height:2.5rem}
.lane ul.kids .m{padding:0 .2rem .5rem}
`;
