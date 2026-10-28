import { clipText } from "./overflow";
// mdxcn-style figures (https://mdxcn.dev): a dotted frame with + corners and a [ TITLE ],
// charts made of characters, one accent. Two inputs render the same way:
//   ::graph-<kind>          Comark block with YAML props between --- lines, drawn here natively
//   ```+--- [ TITLE ] ---+  the official fenced ASCII an agent pastes, re-framed to fit the pane
import { BOLD, C, drawEllipsized, fg, pad, RESET, sparkGlyphs, UNBOLD, visible, width as vwidth } from "./style";
import { rowLines, withRowLimit, wrap } from "./text";
import { childRows, resolveLive, setLiveSource, liveSource, type LiveSite } from "./live";
import { asksPerItem, liveProps } from "@ep0ch/outline-core/figure-live";
import { figureResultsMarkdown, resultsHead, type FigureResults, type ResultsContext } from "@ep0ch/outline-core/figure-results";
import { figureProps, type FigureSource } from "@ep0ch/outline-core/figure-props";
import { FIGURES } from "./figures/index";
import { ACCENT, DIM, HI, INK, inlineRows, rowLink, rowLinks, tier, type Props, type RowInline, type RowLink } from "./figures/palette";
export type { RowInline, RowLink } from "./figures/palette";
import { setLinksSource, linksSource } from "./links";
import type { SocketBoard } from "./socket";

/**
 * The outline a note's live parts ask (a figure's `query:` or `view:`, the `::links` components) and what repaints
 * when an answer arrives. Every host of the note surface connects them here: the door's App, and `ep0ch show`
 * (src/notes-cli.ts), so a note draws the same at a shell as in a reader.
 */
export function connectFigures(board: SocketBoard, redraw: () => void): void {
  setLiveSource(board, redraw);
  setLinksSource(board, redraw);
}

/** A tile's synchronous paint borrows its outline; watched answers stay owned by that board. */
export function withFigureBoard<T>(board: SocketBoard, redraw: () => void, draw: () => T): T {
  const live = liveSource(), links = linksSource();
  if (live.board === board && links.board === board) return draw();
  connectFigures(board, redraw);
  try { return draw(); }
  finally { setLiveSource(live.board, live.redraw); setLinksSource(links.board, links.redraw); }
}

/** A run of `s`, `n` times: none for a count below 0 or not a number, so a width that came out negative draws nothing (PIE-941). */
const rep = (s: string, n: number) => s.repeat(Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/**
 * `+ ····· [ TITLE ] ····· +` around body lines, fitted to width. `control`: drawn after the footer when it fits (a
 * live figure's density, tagged so a click changes it), measured by what it draws.
 */
export function frame(title: string, body: string[], W: number, footer = "", control = ""): string[] {
  const w = Math.max(16, W);
  const inner = w - 4;
  // The title shrinks before the frame does: keep at least one dot each side.
  const t = rowLines(title.toUpperCase(), w - 10, 1)[0]!;
  const label = t ? ` [ ${t} ] ` : "";
  const lw = vwidth(label);
  const left = Math.max(1, Math.floor((w - 2 - lw) / 2)), right = Math.max(1, w - 2 - lw - left);
  const top = fg(DIM) + "+" + rep("·", left) + fg(ACCENT) + label + fg(DIM) + rep("·", right) + "+" + RESET;
  const side = (s: string) => fg(DIM) + "┊ " + RESET + pad(s, inner) + fg(DIM) + " ┊" + RESET;
  const shown = footer ? clipText(footer, Math.max(0, w - 8)) : "";
  const fits = !!control && vwidth(shown) + vwidth(control) + (shown ? 3 : 0) + 8 <= w;
  const tail = fits ? (shown ? fg(DIM) + " · " : "") + fg(ACCENT) + control : "";
  const foot = shown || tail ? ` ${shown}${tail} ` : "";
  const fl = vwidth(foot);
  const bottom = fg(DIM) + "+" + rep("·", Math.max(0, w - 4 - fl)) + fg(ACCENT) + foot + fg(DIM) + "··+" + RESET;
  return [top, side(""), ...body.map(side), side(""), foot ? bottom : fg(DIM) + "+" + rep("·", w - 2) + "+" + RESET];
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, "")) || 0);
const fmt = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-US") : String(v ?? ""));

function bar(frac: number, n: number, on: number = ACCENT): string {
  const k = Math.max(0, Math.min(n, Math.round(frac * n)));
  return fg(on) + rep("█", k) + fg(DIM) + rep("-", n - k) + RESET;
}

// ── a figure's reading state (the reader's, never the note's) ─────────────────────────────────────────────

/**
 * How many lines a table row's title may take: compact one (cut with …), cozy (the default)
 * two (cut with … past them), comfortable three, with a blank line between rows
 * (PIE-815: a question's title is the question). Named for how much room each gives, as mail and list views name theirs.
 */
export const DENSITIES = ["compact", "cozy", "comfortable"] as const;
export type Density = (typeof DENSITIES)[number];
export const isDensity = (s: unknown): s is Density => DENSITIES.includes(s as Density);
const TITLE_LINES: Record<Density, number> = { compact: 1, cozy: 2, comfortable: 3 };

/** A figure's control a reader draws: one of a tabs figure's tabs, or its density (a table's too). */
export interface FigureControl { figure: string; tab?: string; density?: true }
/** What a reader learns of each figure it drew: which it is, its tabs and their counts, and what's chosen now. */
export interface FigureInfo { key: string; n: number; kind: string; title: string; density: Density; tabs?: { value: string; count: number }[]; tab?: string }

/**
 * A reader's hold on its figures (src/surface/note.ts): what the person (or an agent) chose for each, by the figure's
 * key; `tag` makes a tab or the density a control; `seen` is told each figure drawn. `all`: nobody can switch here
 * (`ep0ch show`, `--cells`): a tabs figure draws every group in turn. Without it (an embed, a draft's preview) a
 * figure draws its first tab at the density its YAML says, as text.
 */
export interface FiguresEnv {
  /**
   * Counted as the figures are drawn, in reading order, callouts' bodies included (one env for a whole layout): each
   * figure's number, and how many before it had its title. A figure's key is its title and that count, so adding a
   * figure with another title above it keeps its tab and density.
   */
  drawn?: { n: number; titles: Map<string, number> };
  ui?(key: string): { tab?: string; density?: Density } | undefined;
  tag?(c: FigureControl, text: string): string;
  seen?(info: FigureInfo): void;
  all?: boolean;
  lines?: number;
  /** A library drawing supplies a sample answer through the same live props compiler. */
  answer?: import("@ep0ch/outline-core/figure-live").FigureAnswer;
}
/** One figure's share of that, as the drawing code gets it; `rows`: what the reader lends its rows (PIE-864). */
interface FigureUI { lines: number; key: string; density: Density; tab?: string; tag?: (c: FigureControl, text: string) => string; all?: boolean; rows?: RowInline }

const KINDS: Record<string, (p: Props, w: number, link?: RowLink, ui?: FigureUI) => string[]> = {
  // The kinds in src/figures/ (check, decision, chat, keys, uptime, activity, calendar, annotate, …).
  ...FIGURES,

  timeline: (p, w, link, ui) => {
    const ev: Props[] = p.events ?? [];
    // The date column is at most a third of the frame, so the text column always has room to wrap in.
    const dw = Math.min(Math.max(0, ...ev.map(e => vwidth(String(e.date ?? "")))), Math.max(1, (w >> 1) - 5));
    const ind = dw + 5, tw = Math.max(6, w - ind);
    // Narrow (PIE-581): the side note goes under its event rather than after it.
    const narrow = tier(w) === "narrow";
    return ev.flatMap((e, i) => {
      const now = e.state === "now", next = e.state === "next", last = i === ev.length - 1;
      const dot = next ? fg(DIM) + "○" : fg(now ? ACCENT : HI) + "●";
      // The text wraps in its column: a continuation line hangs under the text, and the spine runs down beside it.
      // Its words and side note through the reader's inline drawing (PIE-864), as a check row's are.
      const lines = inlineRows(String(e.label ?? ""), tw, now ? ACCENT : next ? DIM : HI, ui?.rows, typeof e.block === "string");
      const note = e.note ? inlineRows(String(e.note), 10_000, DIM, ui?.rows)[0]! : "";
      const inline = !!note && !narrow && vwidth(lines.at(-1)!) + 4 + vwidth(note) <= tw;
      const body = rowLinks(link, e.block, lines).map((l, k) => l + (inline && k === lines.length - 1 ? `${fg(DIM)}  — ${note}` : "") + RESET);
      const under = e.note && !inline ? inlineRows(String(e.note), tw, DIM, ui?.rows) : [];
      const spine = (last ? " " : fg(DIM) + "│" + RESET) + rep(" ", ind - 1);
      const date = fg(next ? DIM : INK) + pad(drawEllipsized(String(e.date ?? ""), dw), dw);
      return [
        pad(`${dot}  ${date}  ${body[0]}`, w),
        ...body.slice(1).map(l => pad(spine + l, w)),
        ...under.map(l => pad(spine + l, w)),
        ...(last ? [] : [fg(DIM) + "│" + RESET]),
      ];
    });
  },

  stat: (p, w) => {
    const items: Props[] = p.items ?? [];
    // The accent: the bold item (Markdown) or `accent: true`, else the last.
    const marked = items.some(it => it.accent);
    const cells = items.map((it, i) => ({ v: String(it.value ?? ""), l: String(it.label ?? ""), accent: marked ? !!it.accent : i === items.length - 1 }));
    // A tile is as wide as its longest value or label plus four, at most the figure (`pad` cuts what is longer).
    const cw = Math.min(Math.max(w, 4), Math.max(...cells.map(c => Math.max(vwidth(c.v), vwidth(c.l)))) + 4);
    // Tiles wrap into rows of as many as fit (PIE-581): a fifth tile goes under the first, never past the edge.
    const per = Math.max(1, Math.floor(Math.max(cw, w) / cw));
    const out: string[] = [];
    for (let i = 0; i < cells.length; i += per) {
      const row = cells.slice(i, i + per);
      if (i) out.push("");
      out.push(row.map(c => fg(c.accent ? ACCENT : HI) + BOLD + pad(c.v, cw) + UNBOLD).join("") + RESET);
      const labels = row.map(c => rowLines(c.l, cw));
      for (let line = 0; line < Math.max(...labels.map(l => l.length)); line++) out.push(labels.map(l => fg(DIM) + pad(l[line] ?? "", cw)).join("") + RESET);
    }
    return out;
  },

  kpi: (p, w) => KINDS.stat!(p, w),

  rank: (p, w, link) => {
    const items: Props[] = p.items ?? [];
    const lw = Math.min(Math.max(...items.map(i => vwidth(String(i.label)))), Math.max(1, Math.floor(w / 3))), vw = Math.max(...items.map(i => fmt(i.value).length));
    const max = Math.max(...items.map(i => num(i.value)), 1), bw = Math.max(6, Math.min(40, w - lw - vw - 6));
    // A bold row (Markdown) or `accent: true` is the accent; an italic one (`muted: true`) recedes.
    return items.flatMap(i => {
      const rows = rowLines(String(i.label), lw).map((label, n) => `${fg(i.accent ? ACCENT : i.muted ? DIM : HI)}${pad(label, lw)}${n ? "" : `  ${fg(DIM)}[${bar(num(i.value) / max, bw - 2, i.muted ? INK : ACCENT).replace(/█/g, "=")}${fg(DIM)}]  ${fg(i.accent ? ACCENT : INK)}${fmt(i.value).padStart(vw)}`}${RESET}`);
      return rowLinks(link, i.query ? "" : i.block, rows, undefined, i.query);
    });
  },

  funnel: (p, w) => KINDS.rank!({ items: (p.steps ?? []).map((s: Props) => ({ label: s.label, value: s.display ?? s.value, raw: s.value })) }, w),

  waterfall: (p, w) => {
    const items: Props[] = p.items ?? [];
    const lw = Math.min(Math.max(...items.map(i => vwidth(String(i.label)))), Math.max(1, Math.floor(w / 3)));
    // The scale holds the highest the running total gets to, not just the largest step (a rise past the first bar's
    // height would draw past the bar's end).
    let peak = 0, sum = 0;
    for (const [i, it] of items.entries()) { sum = i === 0 || i === items.length - 1 ? num(it.value) : sum + num(it.value); peak = Math.max(peak, Math.abs(sum), Math.abs(num(it.value))); }
    const bw = Math.max(8, Math.min(36, w - lw - 10)), total = Math.max(peak, 1);
    const cells = (v: number) => Math.round((Math.abs(v) / total) * bw);
    let run = 0;
    return items.flatMap((it, i) => {
      const v = num(it.value), first = i === 0, last = i === items.length - 1;
      let row: string;
      if (first || last) { row = fg(last ? ACCENT : HI) + rep("█", cells(v)) + fg(DIM) + rep("-", bw - cells(v)); run = v; }
      else { const end = cells(run), start = cells(run + v); row = fg(DIM) + rep("-", Math.min(start, end)) + fg(v < 0 ? C.lblue : ACCENT) + rep("█", Math.abs(end - start)) + fg(DIM) + rep("-", bw - Math.max(start, end)); run += v; }
      const out = rowLines(String(it.label), lw).map((label, n) => `${fg(HI)}${pad(label, lw)}${n ? "" : `  ${row}${fg(last ? ACCENT : v < 0 ? C.lblue : INK)}  ${String(v).padStart(4)}`}${RESET}`);
      return last ? [fg(DIM) + rep("·", lw + bw + 8) + RESET, ...out] : out;
    });
  },

  spark: (p) => {
    const glyphs = sparkGlyphs((p.data ?? []).map(num));
    const s = glyphs.map((g, i) => fg(i === glyphs.length - 1 ? ACCENT : C.lblue) + g).join("") + RESET;
    return p.caption ? [s, fg(DIM) + p.caption + RESET] : [s];
  },

  plot: (p, w) => KINDS.spark!({ ...p, caption: p.labels ? `${p.labels[0]} … ${p.labels.at(-1)}` : p.caption }, w),

  // A share (`value: 0.4`, or a live count of `done:`), or with `limit:` a budget (PIE-578): each value drawn to the
  // limit, the limit a mark at the bar's end, the headroom said beneath (an overrun in red). Rows `- label: 48`
  // draw one bar each against the same limit.
  meter: (p, w) => {
    if (p.limit === undefined) {
      const v = num(p.value), frac = v > 1 ? v / 100 : v;
      return [`${bar(frac, Math.max(10, Math.min(40, w - 8)))}  ${fg(ACCENT)}${Math.round(frac * 100)}%${RESET}`, ...(p.caption ? [fg(DIM) + p.caption + RESET] : [])];
    }
    const limit = num(p.limit), unit = p.unit ? ` ${drawEllipsized(String(p.unit), 12)}` : "";
    if (!(limit > 0)) return [fg(C.lred) + `limit: ${fmt(p.limit)} · a budget is a number above 0` + RESET];
    const items: Props[] = Array.isArray(p.items) && p.items.length ? p.items.filter(it => it && typeof it === "object") : [{ label: p.label ?? "", value: p.value }];
    const lw = Math.min(Math.max(0, ...items.map(it => vwidth(String(it.label ?? "")))), Math.max(6, Math.floor(w / 3)));
    const vw = Math.max(...items.map(it => fmt(num(it.value)).length), fmt(limit).length);
    const bw = Math.max(8, Math.min(40, w - lw - vw * 2 - (tier(w) === "narrow" ? 0 : unit.length + 3) - 7));
    const out: string[] = [];
    for (const it of items) {
      const v = Math.max(0, num(it.value)), over = v > limit, k = Math.max(0, Math.min(bw, Math.round((Math.min(v, limit) / limit) * bw)));
      const fill = fg(over ? C.lred : it.accent ? ACCENT : HI) + rep("█", k) + fg(DIM) + rep("-", bw - k) + fg(over ? C.lred : DIM) + "┃" + RESET;
      const labels = rowLines(String(it.label ?? ""), lw);
      const label = lw ? fg(it.accent ? ACCENT : HI) + pad(labels[0]!, lw) + "  " : "";
      // Narrow: `90/150` and the unit beneath, so the bar keeps its room.
      const said = tier(w) === "narrow" ? `${fmt(v)}/${fmt(limit)}` : `${fmt(v).padStart(vw)}${fg(DIM)} / ${fmt(limit)}${unit}`;
      out.push(`${label}${fill}  ${fg(over ? C.lred : INK)}${said}${RESET}`);
      out.push(...labels.slice(1).map(l => fg(it.accent ? ACCENT : HI) + pad(l, lw) + RESET));
      const room = Math.abs(limit - v);
      out.push(rep(" ", lw ? lw + 2 : 0) + (over ? fg(C.lred) + `${fmt(room)}${unit} over` : fg(DIM) + `${fmt(room)}${unit} left`) + RESET);
    }
    if (p.caption) out.push(fg(DIM) + p.caption + RESET);
    return out;
  },

  gantt: (p, w) => {
    const items: Props[] = p.items ?? [], lw = Math.min(Math.max(...items.map(i => vwidth(String(i.label)))), Math.max(1, Math.floor(w / 3)));
    const bw = Math.max(10, Math.min(56, w - lw - 3));
    const rows = items.flatMap(it => {
      const s = Math.round(num(it.start) * bw), e = Math.max(s + 1, Math.round(num(it.end) * bw)), c = s + Math.round((e - s) * num(it.complete ?? 0));
      const active = num(it.complete) > 0 && num(it.complete) < 1;
      return rowLines(String(it.label), lw).map((label, n) => `${fg(active ? ACCENT : HI)}${pad(label, lw)}${n ? "" : `  ${fg(DIM)}${rep("-", s)}${fg(active ? ACCENT : HI)}${rep("█", c - s)}${fg(active ? C.blue : DIM)}${rep("░", e - c)}${fg(DIM)}${rep("-", bw - e)}`}${RESET}`);
    });
    const ticks: string[] = p.ticks ?? [];
    const axis = rep(" ", lw + 2) + ticks.map((t, i) => t.padEnd(i === ticks.length - 1 ? 0 : Math.floor(bw / Math.max(1, ticks.length - 1)))).join("");
    const marker = p.progress !== undefined ? [rep(" ", lw + 2 + Math.round(num(p.progress) * bw)) + fg(ACCENT) + "▾" + RESET] : [];
    return [...marker, ...rows, fg(DIM) + axis + RESET];
  },

  tree: (p, w) => {
    const out: string[] = [];
    const walk = (nodes: Props[], lead: string) => nodes.forEach((n, i) => {
      const last = i === nodes.length - 1;
      out.push(...rowLines(lead + (last ? "└─ " : "├─ ") + n.label + (n.meta ? "  " + n.meta : ""), w, undefined, { hang: vwidth(lead) + 3 }).map(line => fg(n.accent ? ACCENT : HI) + line + RESET));
      if (n.children) walk(n.children, lead + (last ? "   " : "│  "));
    });
    walk(p.nodes ?? [], "");
    return out;
  },

  table: (p, w, link, ui) => {
    let head: string[] = (p.headers ?? []).map(String), rows: string[][] = (Array.isArray(p.rows) ? p.rows : []).map((r: unknown) => (Array.isArray(r) ? r : [r]).map(String));
    let foot: string[] | undefined = Array.isArray(p.footer) ? p.footer.map(String) : undefined;
    let align: string[] = Array.isArray(p.align) ? p.align : [];
    // Narrow (PIE-581): the title column and one more; the rest are counted in the footer, never wrapped to nothing.
    const width0 = Math.max(0, ...[head, ...rows].map(r => r.length));
    let tcol = Math.min(Math.max(0, width0 - 1), Math.max(0, Number(p.titleColumn) || 0));
    let dropped = 0;
    const reduce = (keep: number[]) => {
      const cut = (r: string[]) => keep.map(k => r[k] ?? "");
      head = cut(head); rows = rows.map(cut); foot = foot && cut(foot); align = cut(align);
      tcol = Math.max(0, keep.indexOf(tcol));
    };
    const id = head.findIndex(c => c.toLowerCase() === "id");
    const title = head.findIndex(c => c.toLowerCase() === "title");
    const natural = Array.from({ length: width0 }, (_, k) => Math.max(...[head, ...rows].map(r => vwidth(r[k] ?? "")))).reduce((a, b) => a + b, 0) + (width0 - 1) * 3;
    if (id >= 0 && title >= 0 && natural > w) {
      reduce([...Array(width0).keys()].filter(k => k !== id));
      dropped++;
    }
    const remaining = width0 - dropped;
    if (tier(w) === "narrow" && remaining > 2) {
      reduce([tcol, [...Array(remaining).keys()].find(k => k !== tcol)!]);
      dropped += remaining - 2;
    }
    const all = [head, ...rows, ...(foot ? [foot] : [])];
    const n = Math.max(...all.map(r => r.length));
    // Nothing to draw (a figure written without its `---` lines also says so: figureProps' warning, PIE-941).
    if (!n) return [fg(DIM) + "no columns or rows" + RESET];
    let cw = Array.from({ length: n }, (_, k) => Math.max(...all.map(r => vwidth(r[k] ?? ""))));
    const room = w - (n - 1) * 3;
    while (cw.reduce((a, b) => a + b, 0) > room && Math.max(...cw) > 1) { const k = cw.indexOf(Math.max(...cw)); cw[k]!--; }
    const cell = (s: string, k: number) => { const t = drawEllipsized(s, cw[k]!), gap = rep(" ", Math.max(0, cw[k]! - vwidth(t))); return align[k] === "right" ? gap + t : t + gap; };
    const line = (r: string[], style: string) => r.map((c, k) => style + cell(c, k)).join(fg(DIM) + " ┊ ") + RESET;
    const rule = fg(DIM) + rep("·", Math.min(w, cw.reduce((a, b) => a + b, 0) + (n - 1) * 3)) + RESET;
    // Each cell shares the row limit; every physical line belongs to the same note.
    const density = ui?.density ?? (isDensity(p.density) ? p.density : "cozy"), most = ui?.lines ?? 2;
    const tc = tcol;
    const drawRow = (r: string[]) => {
      const cells = r.map((c, k) => rowLines(c, cw[k]!, most));
      return Array.from({ length: Math.max(...cells.map(c => c.length)) }, (_, i) => line(cells.map(c => c[i] ?? ""), fg(INK)));
    };
    const blocks: unknown[] = p.blocks ?? [];
    const body = rows.flatMap((r, i) => [...(density === "comfortable" && i ? [""] : []), ...rowLinks(link, blocks[i], drawRow(r), ui?.key)]);
    return [line(head, fg(HI)), rule, ...body, ...(foot ? [rule, line(foot, fg(HI))] : []), ...(dropped ? [fg(DIM) + `+${dropped} column${dropped === 1 ? "" : "s"} · widen to see` + RESET] : [])];
  },

  // A query's results grouped by a property, one tab per value (src/live.ts), the chosen tab's rows drawn as a table.
  // Where nobody can switch (`ep0ch show`), every tab's rows in turn under a heading of their own.
  // PIE-533: hand-authored tabs (`:::tab{label="…"}` slots inside `::graph-tabs`, each a body of its own) would be
  // parsed beside `tabs:` here and drawn by this same bar; not built yet.
  tabs: (p, w, link, ui) => {
    const tabs: { value: string; count: number; more: number }[] = p.tabs ?? [];
    if (!tabs.length) return [];
    const sel = tabs.find(t => t.value === ui?.tab) ?? tabs[0]!;
    // A question that came back cut (over 1000 results): the counts are at least these, said once after the bar.
    const plus = "";
    const table = (t: Props) => (t.rows?.length ? KINDS.table!(t, w, link, ui) : [fg(DIM) + `nothing in ${t.value}` + RESET])
      .concat(t.more ? [fg(DIM) + `${t.more} more · limit: ${p.limit ?? 50} a tab` + RESET] : []);
    if (ui?.all) {
      const bar = tabs.map(t => `${t.value} ${t.count}${plus}`).join(" · ");
      return [...wrap(bar, w).map(l => fg(INK) + l + RESET), ...tabs.flatMap(t => ["", fg(ACCENT) + BOLD + `▸ ${t.value.toUpperCase()} · ${t.count}${plus}` + UNBOLD + RESET, ...table(t)])];
    }
    // The bar: each label its value and count, the chosen one lit and underlined; a bar wider than the figure wraps.
    const bars: { text: string; under: string }[] = [];
    let text = "", under = "", at = 0;
    for (const t of tabs) {
      const label = `${t.value} ${t.count}${plus}`, lw = vwidth(label), on = t === sel;
      if (at && at + 3 + lw > w) { bars.push({ text, under }); text = ""; under = ""; at = 0; }
      if (at) { text += fg(DIM) + " · "; under += "   "; at += 3; }
      const drawn = (on ? fg(ACCENT) + BOLD : fg(INK)) + label + (on ? UNBOLD : "") + RESET;
      text += ui?.tag ? ui.tag({ figure: ui.key, tab: t.value }, drawn) : drawn;
      under += on ? fg(ACCENT) + rep("▀", lw) + RESET : rep(" ", lw);
      at += lw;
    }
    bars.push({ text, under });
    if (p.truncated) bars.push({ text: fg(DIM) + "more results than one question answers: counts are at least these" + RESET, under: "" });
    return [...bars.flatMap(b => [b.text + RESET, b.under]), ...table({ ...sel, limit: p.limit, titleColumn: (sel as Props).titleColumn, density: p.density })];
  },
};

/** Every `::graph-*` kind drawn here (the showcase seed has one of each). */
export const GRAPH_KINDS: readonly string[] = Object.keys(KINDS);

export { figureSource, graphKind, type FigureSource } from "@ep0ch/outline-core/figure-props";

/** The figure's Site as the service takes it: where it is drawn (a template's host) and its call-site args. */
const liveSiteOf = (src: FigureSource, args?: Record<string, string>): LiveSite | undefined =>
  src.chain?.length || (args && Object.keys(args).length) || (src.props && Object.keys(src.props).length)
    ? { ...(src.chain?.length ? { chain: src.chain } : {}), ...(args ? { args } : {}), ...(src.props && Object.keys(src.props).length ? { props: src.props } : {}) } : undefined;

/**
 * Render a `::graph-kind` block: `source` is its YAML (between --- lines), or the whole FigureSource (its Markdown and
 * its note too). `link`: rows that stand for a note (a live figure's, a child bullet's) are tagged with it, so the
 * reader steps to them and opens them (PIE-441). `figures`: the reader's hold on its figures (its chosen tab and density
 * for this one, `n`th in the note), see FiguresEnv. `rows`: what the reader lends the figure's rows (PIE-864: their
 * words drawn as the note's are, a check row's box a step's control), see RowInline.
 */
export function renderGraph(kind: string, source: string | FigureSource, W: number, link?: RowLink, figures?: FiguresEnv, rows?: RowInline, site?: LiveSite): string[] {
  const src = typeof source === "string" ? { yaml: source } : source;
  const read = figureProps(kind, src, note => childRows(note, liveSiteOf(src)));
  if ("error" in read) return frame(kind, [fg(C.lred) + read.error + RESET], W);
  let props = read.props;
  // Props written without their `---` lines (PIE-941): said in the figure, whatever it then draws.
  const warn = read.warning ? [fg(C.lred) + read.warning + RESET] : [];
  // The figure's name in its reader: where it is in the note, and its title.
  const title = String(props.title ?? kind), count = figures ? (figures.drawn ??= { n: 0, titles: new Map() }) : { n: 0, titles: new Map<string, number>() };
  const n = ++count.n, same = count.titles.get(title) ?? 0;
  count.titles.set(title, same + 1);
  const key = `${title}#${same}`;
  // All kinds lend their row targets the same figure identity, including rows outside the current viewport.
  const rowLink = link;
  link = rowLink ? (block, text, _figure, query) => rowLink(block, text, key, query) : undefined;
  const chosen = figures?.ui?.(key);
  const writtenLines = props.lines === undefined ? undefined : Number(props.lines);
  const validLines = writtenLines === undefined || Number.isSafeInteger(writtenLines) && writtenLines >= 0;
  if (!validLines) warn.push(fg(C.yellow) + "lines needs a whole number: 0 truncates, 1 or more wraps" + RESET);
  const ui: FigureUI = { lines: chosen?.density ? TITLE_LINES[chosen.density] : writtenLines !== undefined && validLines ? writtenLines : isDensity(props.density) ? TITLE_LINES[props.density] : figures?.lines ?? 2, key, density: chosen?.density ?? (isDensity(props.density) ? props.density : "cozy"), ...(chosen?.tab !== undefined ? { tab: chosen.tab } : {}), ...(figures?.tag ? { tag: figures.tag } : {}), ...(figures?.all ? { all: true } : {}), ...(rows ? { rows } : {}) };
  // A block with query:/view: is answered from the outline now, not from copied values.
  const live = figures?.answer && (props.query || props.view || kind === "tabs") ? { ...liveProps(kind, props, figures.answer), status: "library demo", waiting: false } : resolveLive(kind, props, src.note, { ...liveSiteOf(src, read.args), ...site });
  if (live) {
    if (live.error && !live.status) return frame(title, [fg(C.lred) + live.error + RESET], W, "live");
    if (live.waiting) return frame(title, [fg(DIM) + "asking the outline…" + RESET], W, "live");
    props = live.props;
    const draw = KINDS[kind];
    const tabs: { value: string; count: number }[] | undefined = kind === "tabs" ? (props.tabs ?? []).map((t: Props) => ({ value: t.value, count: t.count })) : undefined;
    const tab = tabs ? (tabs.find(t => t.value === ui.tab) ?? tabs[0])?.value : undefined;
    figures?.seen?.({ key, n, kind, title, density: ui.density, ...(tabs ? { tabs } : {}), ...(tab !== undefined ? { tab } : {}) });
    const body = draw ? withRowLimit(ui.lines, () => draw(props, Math.max(10, W - 4), link, { ...ui, ...(tab !== undefined ? { tab } : {}) })) : [];
    if (live.error) body.push(fg(C.lred) + live.error + RESET);
    if (!body.length) body.push(fg(DIM) + "no results" + RESET);
    body.push(...warn);
    return frame(String(props.title ?? ""), body, W, live.status ?? "live", densityControl(kind, ui));
  }
  const draw = KINDS[kind];
  if (!draw) return frame(props.title ?? kind, [fg(DIM) + `graph-${kind} isn't drawn in the terminal yet` + RESET], W);
  if (kind === "table") figures?.seen?.({ key, n, kind, title, density: ui.density });
  const footer = read.waiting ? "asking for its child notes…" : read.children ? "live · child notes" : "";
  try { return frame(String(props.title ?? ""), [...withRowLimit(ui.lines, () => draw(props, Math.max(10, W - 4), link, ui)), ...warn], W, footer, kind === "table" ? densityControl(kind, ui) : ""); }
  catch (e) { return frame(kind, [fg(C.lred) + `couldn't draw: ${(e as Error).message}` + RESET], W); }
}

/**
 * A figure as mdxcn's fenced ASCII (what `ep0ch export` writes in its place): the same drawing at `W` columns with
 * every colour and link taken off, framed `+---- [ TITLE ] ----+`, `| … |`, `+----+`, so `reframeAscii` (and any
 * Markdown reader) reads it back. A live figure's status line becomes its last row.
 */
export function figureAscii(kind: string, source: string | FigureSource, W = 60): string[] {
  const drawn = renderGraph(kind, source, W).map(l => visible(l).trimEnd());
  if (drawn.length < 2) return drawn;
  // The dots at each end become dashes (a · in the title stays); an untitled figure is titled by its kind, so
  // reframeAscii reads it back.
  const w = vwidth(drawn[0]!), bottom = drawn.at(-1)!;
  const label = drawn[0]!.includes(" [ ") ? null : ` [ ${kind.toUpperCase()} ] `;
  const left = label ? Math.max(1, Math.floor((w - 2 - label.length) / 2)) : 0;
  const top = label ? "+" + rep("-", left) + label + rep("-", Math.max(1, w - 2 - left - label.length)) + "+"
    : drawn[0]!.replace(/^\+·+/, m => "+" + rep("-", m.length - 1)).replace(/·+\+$/, m => rep("-", m.length - 1) + "+");
  const body = drawn.slice(1, -1).map(l => "|" + l.slice(1, -1) + "|");
  const status = bottom.replace(/^\+[·]*|[·]*\+$/g, "").trim();
  if (status) body.splice(body.length - 1, 0, "| " + rep(" ", Math.max(0, w - 4 - vwidth(status))) + status + " |");
  return [top, ...body, "+" + rep("-", Math.max(0, w - 2)) + "+"];
}

/**
 * A live figure's results as Markdown (PIE-1355: what a page copy writes under it), from the rows the reader draws it
 * with (resolveLive, asked in the same Site renderGraph asks in, so a drawn figure's answer is the one copied). Null for
 * a figure that asks the outline nothing; `waiting` while its answer hasn't come, unless `final` (the copy has waited):
 * then it says it wasn't answered in time (`unanswered`). A kind with no Markdown form is its ASCII twin in a fence.
 */
export function figureResults(kind: string, source: FigureSource, ctx: ResultsContext, final = false): (FigureResults & { waiting?: false; unanswered?: true }) | { waiting: true } | null {
  const read = figureProps(kind, source);
  if ("error" in read) return null;
  const props = read.props;
  if (!(props.query || props.view || asksPerItem(kind, props))) return null;
  const live = resolveLive(kind, props, source.note, liveSiteOf(source, read.args));
  if (!live) return null;
  if (live.waiting) {
    if (!final) return { waiting: true };
    return { ...figureResultsMarkdown(kind, props, null, ctx, `the outline didn't answer in time${source.note ? `: ep0ch show ${source.note} --markdown asks again` : ""}`)!, unanswered: true };
  }
  // No status: the question wasn't answered (its error says why); else its error is the service's word on the answer.
  const found = live.status ? live.found ?? { n: 0, truncated: false } : null;
  const md = figureResultsMarkdown(kind, live.props, found, ctx, live.error);
  if (md) return md;
  // Its drawing, not its rows: it takes none of the copy's row budget.
  return { lines: [...resultsHead(kind, live.props, "as drawn", ctx.at), "```", ...figureAscii(kind, source), "```"], shown: 0, total: live.found?.n ?? 0, cut: false };
}

/** A table's or tabs figure's density as a control on its footer, where a reader can change it (a click, ⏎ on it, =). */
function densityControl(kind: string, ui: FigureUI): string {
  if ((kind !== "table" && kind !== "tabs") || !ui.tag || ui.all) return "";
  return ui.tag({ figure: ui.key, density: true }, `≡ ${ui.density}`);
}

/** mdxcn's fenced ASCII: `+--- [ TITLE ] ---+`, `| … |` rows, `+----+`. Returns null when it isn't one. */
export function reframeAscii(code: string[], W: number): string[] | null {
  const top = code[0]?.match(/^\+-+ \[ (.+?) \] -+\+\s*$/);
  const bottom = code.at(-1)?.match(/^\+-+\+\s*$/);
  if (!top || !bottom) return null;
  const body = code.slice(1, -1).map(l => l.replace(/^\| ?/, "").replace(/ ?\|\s*$/, "").trimEnd());
  while (body.length && !body[0]!.trim()) body.shift();
  while (body.length && !body.at(-1)!.trim()) body.pop();
  const styled = body.map(l => l
    .replace(/(█+)/g, `${fg(ACCENT)}$1${fg(INK)}`)
    .replace(/(░+)/g, `${fg(C.blue)}$1${fg(INK)}`)
    .replace(/\[x\]/g, `${fg(ACCENT)}[x]${fg(INK)}`)
    .replace(/(●)/g, `${fg(HI)}$1${fg(INK)}`));
  return frame(top[1]!, styled.map(l => fg(INK) + l + RESET), Math.min(W, Math.max(...body.map(l => vwidth(l))) + 6));
}
