// The panel a prefix key opens (PIE-1304): every key that can follow it, grouped, each row clickable, laid out in
// columns over the screen. It draws rows it is given and words none of its own: the ^W rows come from the key table
// joined to each action's own words (wkeys.ts `wRows`), ^W o's from the tile kinds' own keys. A prefix shows it after a
// short pause (which-key's), so a fast typist never sees it; the hint row's one-line strip stays where it can't fit.
import { C, fg, pad, RESET, width } from "../style";
import { drawEllipsized } from "../style";

/** One key in the panel: `key` as typed after the prefix (" " is the space bar), its keycap and what it does. */
export interface PanelKey { key: string; cap: string; label: string }
export interface PanelGroup { title: string; keys: PanelKey[] }

/** How long a prefix waits before its panel opens: EP0CH_KEY_PANEL_MS when set (tests set 0), else 400 ms. */
export function panelPauseMs(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.EP0CH_KEY_PANEL_MS?.trim() || NaN);
  return Number.isFinite(v) && v >= 0 && v <= 10_000 ? v : 400;
}

/** A row of the drawn panel that presses a key: its line, the cells it covers and the key typed after the prefix. */
export interface PanelSpot { line: number; from: number; to: number; key: string }

const GAP = 2, MAX_COL = 34;

/**
 * The groups laid out in `cols` cells and at most `rows` lines: each group a column block (its title, then a row per
 * key), dropped into the shortest column so far. Null when it can't fit (too narrow or too short): the caller keeps its
 * one-line strip.
 */
export function panelLines(groups: readonly PanelGroup[], cols: number, rows: number): { lines: string[]; spots: PanelSpot[]; width: number } | null {
  const shown = groups.filter(g => g.keys.length);
  if (!shown.length) return null;
  const capW = Math.max(...shown.flatMap(g => g.keys.map(k => width(k.cap))));
  const want = Math.max(...shown.map(g => width(g.title)), ...shown.flatMap(g => g.keys.map(k => capW + 2 + width(k.label))));
  const colW = Math.min(MAX_COL, want, cols);
  const n = Math.max(1, Math.min(shown.length, Math.floor((cols + GAP) / (colW + GAP))));
  if (colW < capW + 8) return null;
  const columns: { text: string; key?: string }[][] = Array.from({ length: n }, () => []);
  for (const g of shown) {
    const col = columns.reduce((best, c) => (c.length < best.length ? c : best), columns[0]!);
    if (col.length) col.push({ text: "" });
    col.push({ text: fg(C.yellow) + drawEllipsized(g.title, colW) + RESET });
    for (const k of g.keys) col.push({ text: fg(C.white) + pad(k.cap, capW) + RESET + "  " + fg(C.grey) + drawEllipsized(k.label, colW - capW - 2) + RESET, key: k.key });
  }
  const h = Math.max(...columns.map(c => c.length));
  if (h > rows) return null;
  const lines: string[] = [], spots: PanelSpot[] = [];
  for (let y = 0; y < h; y++) {
    let line = "";
    columns.forEach((c, i) => {
      const cell = c[y];
      if (cell?.key !== undefined) spots.push({ line: y, from: i * (colW + GAP), to: i * (colW + GAP) + colW, key: cell.key });
      line += (i ? " ".repeat(GAP) : "") + pad(cell?.text ?? "", colW);
    });
    lines.push(line);
  }
  return { lines, spots, width: n * colW + (n - 1) * GAP };
}
