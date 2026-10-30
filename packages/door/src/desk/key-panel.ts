// The panel a prefix key opens (PIE-1304): every key that can follow it, grouped, each row clickable, laid out in
// columns over the screen. It draws rows it is given and words none of its own: the ^W rows come from the key table
// joined to each action's own words (wkeys.ts `wRows`), ^W o's from the tile kinds' own keys, and ^W's first group, the
// focused tile's own keys (PIE-1338), from its tile menu's rows (`tileKeys`). A prefix shows it after a
// short pause (which-key's), so a fast typist never sees it; the hint row's one-line strip stays where it can't fit.
import { keyTable } from "../surface/keymap";
import { C, fg, pad, RESET, width } from "../style";
import { drawEllipsized } from "../style";
import { modeHint, type ModeKey } from "../surface/modes";
import { keyCaption } from "../surface/actions";
import type { MenuRow } from "../surface/dispatch";

/**
 * One key in the panel: `key` as typed after the prefix (" " is the space bar), its keycap and what it does. With
 * `action`, the key is the tile's own, typed without the prefix: a click runs its menu row in the tile instead.
 */
export interface PanelKey { key: string; cap: string; label: string; action?: string }
/** A group of keys under its title; `accent`: drawn in the accent, the focused tile's own (PIE-1338). */
export interface PanelGroup { title: string; keys: PanelKey[]; accent?: true }

/**
 * The panel's own keys, said in its foot: a click on a row presses that key, esc lets the prefix go; on ^W, `?` opens
 * the filtered list (W_KEYS' own row). Its foot is drawn from this table, never written as words (PIE-1171).
 */
export const PANEL_KEYS: readonly ModeKey[] = keyTable("key panel", "the panel a prefix opens", [
  { key: "click", action: "keys.panel", label: "a row runs its key" },
  { key: "esc", action: "keys.panel", label: "close", says: "close the panel of the keys that follow a prefix" },
]);
/**
 * Esc's words when the panel lists the tile's own keys (PIE-1338): after ^W the next key is ^W's (x closes the tile), so
 * the tile's own keys are typed once the panel is closed.
 */
export const PANEL_ESC_OWN: ModeKey = { key: "esc", action: "keys.panel", label: "close: then this tile's keys are its own" };

/** The foot under a panel: its keys, then `more` (the prefix's own, as `?` on ^W); `own`, it lists the tile's own keys. */
export function panelFoot(more: readonly ModeKey[] = [], own = false): string {
  const keys = [...PANEL_KEYS.map(k => (own && k.key === "esc" ? PANEL_ESC_OWN : k)), ...more];
  return [modeHint(keys, () => undefined), ...keys.filter(k => k.key === "click").map(k => `${k.key}: ${k.label}`)].filter(Boolean).join(" · ");
}

/** How long a prefix waits before its panel opens: EP0CH_KEY_PANEL_MS when set (tests set 0), else 400 ms. */
export function panelPauseMs(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.EP0CH_KEY_PANEL_MS?.trim() || NaN);
  return Number.isFinite(v) && v >= 0 && v <= 10_000 ? v : 400;
}

/**
 * The focused tile's own keys, the ^W panel's first group (PIE-1338): its tile menu's own rows (the ⋯ menu,
 * `Dispatcher.menu`, from its actions' own `menu` entries; `own`, not the screen's every-tile rows) that have a key of
 * their own, not a ^W chord, each once.
 */
export function tileKeys(name: string, rows: readonly MenuRow[]): PanelGroup {
  const keys: PanelKey[] = [];
  for (const r of rows) {
    if (!r.own || !r.key || r.key.includes(" ") || r.key === "ctrl+w" || keys.some(k => k.key === r.key)) continue;
    keys.push({ key: r.key, cap: keyCaption(r.key), label: r.label, action: r.action });
  }
  return { title: `this tile: ${name}`, keys, accent: true };
}

/** A row of the drawn panel that presses a key: its line, the cells it covers and the key typed after the prefix (or the tile's action it runs). */
export interface PanelSpot { line: number; from: number; to: number; key: string; action?: string }

const GAP = 2, MAX_COL = 34;

/**
 * The groups laid out in `cols` cells and at most `rows` lines: each group a column block (its title, then a row per
 * key), dropped into the shortest column so far. Too tall at its widest columns, it tries more and narrower ones (the
 * labels cut shorter) before giving up. Null when it can't fit (too narrow or too short): the caller keeps its one-line
 * strip.
 */
export function panelLines(groups: readonly PanelGroup[], cols: number, rows: number): { lines: string[]; spots: PanelSpot[]; width: number } | null {
  const shown = groups.filter(g => g.keys.length);
  if (!shown.length) return null;
  // Each group's keycaps are as wide as its own widest (a tile's "j k ↑ ↓" doesn't push ^W's labels over).
  const capOf = (g: PanelGroup) => Math.max(...g.keys.map(k => width(k.cap)));
  const want = Math.max(...shown.map(g => width(g.title)), ...shown.flatMap(g => g.keys.map(k => capOf(g) + 2 + width(k.label))));
  const widest = Math.min(MAX_COL, want, cols), least = Math.max(...shown.map(g => capOf(g) + 8));
  for (let n = Math.max(1, Math.min(shown.length, Math.floor((cols + GAP) / (widest + GAP)))); n <= shown.length; n++) {
    const colW = Math.min(widest, Math.floor((cols - (n - 1) * GAP) / n));
    if (colW < least) return null;
    const drawn = panelColumns(shown, n, colW, capOf);
    if (drawn.length <= rows) return panelDrawn(drawn, colW);
  }
  return null;
}

type Cell = { text: string; key?: string; action?: string };

/** The groups in `n` columns of `colW` cells, each into the shortest so far: the columns' cells as a grid of rows. */
function panelColumns(shown: readonly PanelGroup[], n: number, colW: number, capOf: (g: PanelGroup) => number): (Cell | undefined)[][] {
  const columns: Cell[][] = Array.from({ length: n }, () => []);
  for (const g of shown) {
    const col = columns.reduce((best, c) => (c.length < best.length ? c : best), columns[0]!);
    const capW = capOf(g), [title, cap, label] = g.accent ? [C.lcyan, C.lcyan, C.white] : [C.yellow, C.white, C.grey];
    if (col.length) col.push({ text: "" });
    col.push({ text: fg(title) + drawEllipsized(g.title, colW) + RESET });
    for (const k of g.keys) col.push({ text: fg(cap) + pad(k.cap, capW) + RESET + "  " + fg(label) + drawEllipsized(k.label, colW - capW - 2) + RESET, key: k.key, ...(k.action ? { action: k.action } : {}) });
  }
  const h = Math.max(...columns.map(c => c.length));
  return Array.from({ length: h }, (_, y) => columns.map(c => c[y]));
}

/** The grid drawn: a line per row and a spot per key. */
function panelDrawn(grid: (Cell | undefined)[][], colW: number): { lines: string[]; spots: PanelSpot[]; width: number } {
  const n = grid[0]?.length ?? 1;
  const lines: string[] = [], spots: PanelSpot[] = [];
  grid.forEach((row, y) => {
    let line = "";
    row.forEach((cell, i) => {
      if (cell?.key !== undefined) spots.push({ line: y, from: i * (colW + GAP), to: i * (colW + GAP) + colW, key: cell.key, ...(cell.action ? { action: cell.action } : {}) });
      line += (i ? " ".repeat(GAP) : "") + pad(cell?.text ?? "", colW);
    });
    lines.push(line);
  });
  return { lines, spots, width: n * colW + (n - 1) * GAP };
}
