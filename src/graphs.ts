// mdxcn-style figures (https://mdxcn.dev): a dotted frame with + corners and a [ TITLE ],
// charts made of characters, one accent. Two inputs render the same way:
//   ::graph-<kind>          Comark block with YAML props between --- lines, drawn here natively
//   ```+--- [ TITLE ] ---+  the official fenced ASCII an agent pastes, re-framed to fit the pane
import { C, fg, pad, RESET, SPARK_STEPS, width as vwidth } from "./style";
import { wrap } from "./text";
import { resolveLive } from "./live";

const ACCENT = C.lcyan, DIM = C.dark, INK = C.grey, HI = C.white;
const BOLD = "\x1b[1m", UNBOLD = "\x1b[22m";

/** `+ ····· [ TITLE ] ····· +` around body lines, fitted to width. */
export function frame(title: string, body: string[], W: number, footer = ""): string[] {
  const w = Math.max(16, W);
  const inner = w - 4;
  // The title shrinks before the frame does: keep at least one dot each side.
  let t = title.toUpperCase();
  const fit = w - 10;
  if ([...t].length > fit) t = fit > 1 ? [...t].slice(0, fit - 1).join("") + "…" : "";
  const label = t ? ` [ ${t} ] ` : "";
  const lw = [...label].length;
  const left = Math.max(1, Math.floor((w - 2 - lw) / 2)), right = Math.max(1, w - 2 - lw - left);
  const top = fg(DIM) + "+" + "·".repeat(left) + fg(ACCENT) + label + fg(DIM) + "·".repeat(right) + "+" + RESET;
  const side = (s: string) => fg(DIM) + "┊ " + RESET + pad(s, inner) + fg(DIM) + " ┊" + RESET;
  const foot = footer ? ` ${[...footer].slice(0, Math.max(0, w - 8)).join("")} ` : "";
  const fl = [...foot].length;
  const bottom = fg(DIM) + "+" + "·".repeat(Math.max(0, w - 4 - fl)) + fg(ACCENT) + foot + fg(DIM) + "··+" + RESET;
  return [top, side(""), ...body.map(side), side(""), footer ? bottom : fg(DIM) + "+" + "·".repeat(w - 2) + "+" + RESET];
}

type Props = Record<string, any>;
const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, "")) || 0);
const fmt = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-US") : String(v ?? ""));

function bar(frac: number, n: number, on = ACCENT): string {
  const k = Math.max(0, Math.min(n, Math.round(frac * n)));
  return fg(on) + "█".repeat(k) + fg(DIM) + "-".repeat(n - k) + RESET;
}

/** Tags a row as a link to its note (PIE-441): the reader's `DocEnv.link`, or nothing (text stays text). */
type RowLink = (block: string, text: string) => string;
const rowLink = (link: RowLink | undefined, block: unknown, text: string) => (link && typeof block === "string" ? link(block, text) : text);

const KINDS: Record<string, (p: Props, w: number, link?: RowLink) => string[]> = {
  check: (p, w, link) => (p.items ?? []).flatMap((it: Props) => {
    const box = it.done ? fg(ACCENT) + "[x]" : fg(DIM) + "[ ]";
    const lines = wrap(String(it.label ?? ""), w - 6);
    return lines.map((l, i) => (i ? "      " : box + RESET + "  ") + fg(it.done ? HI : INK) + (i ? l : rowLink(link, it.block, l)) + RESET)
      .concat(it.note ? ["      " + fg(DIM) + it.note + RESET] : []);
  }),

  timeline: (p, w, link) => {
    const ev: Props[] = p.events ?? [];
    const dw = Math.max(0, ...ev.map(e => String(e.date ?? "").length));
    return ev.flatMap((e, i) => {
      const now = e.state === "now", next = e.state === "next";
      const dot = next ? fg(DIM) + "○" : fg(now ? ACCENT : HI) + "●";
      const line = `${dot}  ${fg(next ? DIM : INK)}${String(e.date ?? "").padEnd(dw)}  ${fg(now ? ACCENT : next ? DIM : HI)}${rowLink(link, e.block, String(e.label ?? ""))}${RESET}`;
      return i < ev.length - 1 ? [pad(line, w), fg(DIM) + "│" + RESET] : [pad(line, w)];
    });
  },

  stat: (p) => {
    const items: Props[] = p.items ?? [];
    const cells = items.map((it, i) => ({ v: String(it.value ?? ""), l: String(it.label ?? ""), accent: i === items.length - 1 }));
    const cw = Math.max(...cells.map(c => Math.max(c.v.length, c.l.length))) + 4;
    return [
      cells.map(c => fg(c.accent ? ACCENT : HI) + BOLD + c.v.padEnd(cw) + UNBOLD).join("") + RESET,
      cells.map(c => fg(DIM) + c.l.padEnd(cw)).join("") + RESET,
    ];
  },

  kpi: (p) => KINDS.stat!(p, 0),

  rank: (p, w) => {
    const items: Props[] = p.items ?? [];
    const lw = Math.max(...items.map(i => String(i.label).length)), vw = Math.max(...items.map(i => fmt(i.value).length));
    const max = Math.max(...items.map(i => num(i.value)), 1), bw = Math.max(6, Math.min(40, w - lw - vw - 6));
    return items.map(i => `${fg(HI)}${String(i.label).padEnd(lw)}  ${fg(DIM)}[${bar(num(i.value) / max, bw - 2).replace(/█/g, "=")}${fg(DIM)}]  ${fg(INK)}${fmt(i.value).padStart(vw)}${RESET}`);
  },

  funnel: (p, w) => KINDS.rank!({ items: (p.steps ?? []).map((s: Props) => ({ label: s.label, value: s.display ?? s.value, raw: s.value })) }, w),

  waterfall: (p, w) => {
    const items: Props[] = p.items ?? [];
    const lw = Math.max(...items.map(i => String(i.label).length));
    const bw = Math.max(8, Math.min(36, w - lw - 10)), total = Math.max(...items.map(i => Math.abs(num(i.value))), 1);
    const cells = (v: number) => Math.round((Math.abs(v) / total) * bw);
    let run = 0;
    return items.flatMap((it, i) => {
      const v = num(it.value), first = i === 0, last = i === items.length - 1;
      let row: string;
      if (first || last) { row = fg(last ? ACCENT : HI) + "█".repeat(cells(v)) + fg(DIM) + "-".repeat(bw - cells(v)); run = v; }
      else { const end = cells(run), start = cells(run + v); row = fg(DIM) + "-".repeat(Math.min(start, end)) + fg(v < 0 ? C.lblue : ACCENT) + "█".repeat(Math.abs(end - start)) + fg(DIM) + "-".repeat(bw - Math.max(start, end)); run += v; }
      const out = `${fg(HI)}${String(it.label).padEnd(lw)}  ${row}${fg(last ? ACCENT : v < 0 ? C.lblue : INK)}  ${String(v).padStart(4)}${RESET}`;
      return last ? [fg(DIM) + "·".repeat(lw + bw + 8) + RESET, out] : [out];
    });
  },

  spark: (p) => {
    const d: number[] = (p.data ?? []).map(num), max = Math.max(...d, 1), top = SPARK_STEPS.length - 1;
    const s = d.map((v, i) => fg(i === d.length - 1 ? ACCENT : C.lblue) + SPARK_STEPS[Math.min(top, Math.max(0, Math.round((v / max) * top)))]).join("") + RESET;
    return p.caption ? [s, fg(DIM) + p.caption + RESET] : [s];
  },

  plot: (p, w) => KINDS.spark!({ ...p, caption: p.labels ? `${p.labels[0]} … ${p.labels.at(-1)}` : p.caption }, w),

  meter: (p, w) => {
    const v = num(p.value), frac = v > 1 ? v / 100 : v;
    return [`${bar(frac, Math.max(10, Math.min(40, w - 8)))}  ${fg(ACCENT)}${Math.round(frac * 100)}%${RESET}`, ...(p.caption ? [fg(DIM) + p.caption + RESET] : [])];
  },

  gantt: (p, w) => {
    const items: Props[] = p.items ?? [], lw = Math.max(...items.map(i => String(i.label).length));
    const bw = Math.max(10, Math.min(56, w - lw - 3));
    const rows = items.map(it => {
      const s = Math.round(num(it.start) * bw), e = Math.max(s + 1, Math.round(num(it.end) * bw)), c = s + Math.round((e - s) * num(it.complete ?? 0));
      const active = num(it.complete) > 0 && num(it.complete) < 1;
      return `${fg(active ? ACCENT : HI)}${String(it.label).padEnd(lw)}  ${fg(DIM)}${"-".repeat(s)}${fg(active ? ACCENT : HI)}${"█".repeat(c - s)}${fg(active ? C.blue : DIM)}${"░".repeat(e - c)}${fg(DIM)}${"-".repeat(bw - e)}${RESET}`;
    });
    const ticks: string[] = p.ticks ?? [];
    const axis = " ".repeat(lw + 2) + ticks.map((t, i) => t.padEnd(i === ticks.length - 1 ? 0 : Math.floor(bw / Math.max(1, ticks.length - 1)))).join("");
    const marker = p.progress !== undefined ? [" ".repeat(lw + 2 + Math.round(num(p.progress) * bw)) + fg(ACCENT) + "▾" + RESET] : [];
    return [...marker, ...rows, fg(DIM) + axis + RESET];
  },

  tree: (p) => {
    const out: string[] = [];
    const walk = (nodes: Props[], lead: string) => nodes.forEach((n, i) => {
      const last = i === nodes.length - 1;
      out.push(fg(DIM) + lead + (last ? "└─ " : "├─ ") + fg(n.accent ? ACCENT : HI) + n.label + (n.meta ? fg(DIM) + "  " + n.meta : "") + RESET);
      if (n.children) walk(n.children, lead + (last ? "   " : "│  "));
    });
    walk(p.nodes ?? [], "");
    return out;
  },

  table: (p, w, link) => {
    const head: string[] = (p.headers ?? []).map(String), rows: string[][] = (p.rows ?? []).map((r: unknown[]) => r.map(String));
    const foot: string[] | undefined = p.footer?.map(String);
    const align: string[] = p.align ?? [];
    const all = [head, ...rows, ...(foot ? [foot] : [])];
    const n = Math.max(...all.map(r => r.length));
    let cw = Array.from({ length: n }, (_, k) => Math.max(...all.map(r => (r[k] ?? "").length)));
    const room = w - (n - 1) * 3;
    while (cw.reduce((a, b) => a + b, 0) > room) { const k = cw.indexOf(Math.max(...cw)); cw[k]!--; }
    const cell = (s: string, k: number) => { const t = s.length > cw[k]! ? s.slice(0, cw[k]! - 1) + "…" : s; return align[k] === "right" ? t.padStart(cw[k]!) : t.padEnd(cw[k]!); };
    const line = (r: string[], style: string) => r.map((c, k) => style + cell(c, k)).join(fg(DIM) + " ┊ ") + RESET;
    const rule = fg(DIM) + "·".repeat(Math.min(w, cw.reduce((a, b) => a + b, 0) + (n - 1) * 3)) + RESET;
    // A live table's row stands for its note: the whole row is the link (cells are cut by length first).
    const blocks: unknown[] = p.blocks ?? [];
    return [line(head, fg(HI)), rule, ...rows.map((r, i) => rowLink(link, blocks[i], line(r, fg(INK)))), ...(foot ? [rule, line(foot, fg(HI))] : [])];
  },
};

/** Every `::graph-*` kind drawn here (the showcase seed has one of each). */
export const GRAPH_KINDS: readonly string[] = Object.keys(KINDS);

export function isGraphStart(line: string): string | null {
  const m = line.match(/^\s*::graph-([a-z-]+)\s*$/);
  return m ? m[1]! : null;
}

/**
 * Render a `::graph-kind` block whose YAML (between --- lines) is in `yaml`. `link`: a live figure's rows
 * that stand for a note are tagged with it, so the reader steps to them and opens them (PIE-441).
 */
export function renderGraph(kind: string, yaml: string, W: number, link?: RowLink): string[] {
  let props: Props = {};
  try { props = (Bun.YAML.parse(yaml) as Props) ?? {}; }
  catch (e) { return frame(kind, [fg(C.lred) + `bad YAML: ${(e as Error).message}` + RESET], W); }
  // A block with query:/view: is answered from the outline now, not from copied values.
  const live = resolveLive(kind, props);
  if (live) {
    if (live.error && !live.status) return frame(String(props.title ?? kind), [fg(C.lred) + live.error + RESET], W, "live");
    if (live.waiting) return frame(String(props.title ?? kind), [fg(DIM) + "asking the outline…" + RESET], W, "live");
    props = live.props;
    const draw = KINDS[kind];
    const body = draw ? draw(props, Math.max(10, W - 4), link) : [];
    if (live.error) body.push(fg(C.lred) + live.error + RESET);
    if (!body.length) body.push(fg(DIM) + "no results" + RESET);
    return frame(String(props.title ?? ""), body, W, live.status ?? "live");
  }
  const draw = KINDS[kind];
  if (!draw) return frame(props.title ?? kind, [fg(DIM) + `graph-${kind} isn't drawn in the terminal yet` + RESET], W);
  try { return frame(String(props.title ?? ""), draw(props, Math.max(10, W - 4)), W); }
  catch (e) { return frame(kind, [fg(C.lred) + `couldn't draw: ${(e as Error).message}` + RESET], W); }
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
