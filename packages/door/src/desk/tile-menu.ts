// A tile's menu (PIE-492): the ⋯ in every tile's header, a right-click anywhere in a tile, ^W . and `tile.menu` open it.
// Its rows are what the dispatcher would run in that tile (`Dispatcher.menu`, from each action's `menu` rows): the tile
// actions, its kind's, a reader's note actions, a board's lane actions. It is a list picker on the desk's overlay
// stack, anchored under the ⋯ or at the pointer: one click or ⏎ runs a row through the dispatcher as the person, a
// row's own key runs it too, and a dimmed row says why it would be refused. An agent gets the same rows as data.
import type { Rect } from "../canvas";
import { keyCaption, keyName } from "../surface/actions";
import type { MenuRow } from "../surface/dispatch";
import { ListPicker } from "../surface/picker";
import { LineInput } from "../surface/line";
import { filtered, litCells } from "../bar/filter";
import { refused } from "../shell-keys";
import { C, chip, fg, pad, RESET, selected, width } from "../style";

/** What the menu runs a row on: the person's press on the screen's dispatcher, and the status bar for a refusal. */
export interface MenuHost {
  dispatch: { press(name: string, args?: Record<string, unknown>, tile?: string): Promise<unknown> };
  ctx: { flash(msg: string): void; refuse?(msg: string): void };
}

/** Keys the list takes itself: a row bound to one still shows it as its keycap, but ⏎ runs the lit row and j k move. */
const LIST_KEYS = new Set(["up", "down", "enter", "tab", "shift+tab", "home", "end", "pgup", "pgdn"]);

/** `s` in lines at most `w` wide, broken at spaces. */
function wrap(s: string, w: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of s.split(" ")) {
    if (line && width(line) + 1 + width(word) > w) { out.push(line); line = ""; }
    line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/**
 * The menu of tile `title`'s rows, its top left corner at `at` (its top right with `right`: under the ⋯), kept on the
 * screen. Typing filters the rows (PIE-879) with the power bar's matcher (`filtered`, src/bar/filter.ts): the query shows
 * on the box's top row, matched letters are lit, a group with no row left goes, ⏎ or a click runs one, backspace widens
 * and esc clears the query before it puts the menu away. A row's key that is a chord (ctrl+w x, alt+h, ctrl+z) still
 * runs it; a bare letter is for the query. `q`: a query to start with.
 */
export function tileMenu<H extends MenuHost>(o: { title: string; rows: MenuRow[]; at: { col: number; row: number; right?: boolean }; q?: string }): ListPicker<MenuRow, H> {
  const all = o.rows;
  const input = new LineInput(o.q ?? "", false, { complete: false });
  const shown = () => filtered(all, input.text, r => [r.label, r.group, r.key ? keyCaption(r.key) : ""]);
  // Re-read only when the query changed: the picker asks for its items many times a frame.
  let seen = input.text, rows = shown();
  const sync = () => { if (input.text !== seen) { seen = input.text; rows = shown(); } return rows; };
  const caps = (rs: MenuRow[]) => rs.map(r => (r.key ? ` ${keyCaption(r.key)} ` : ""));
  const capW = Math.max(0, ...caps(all).map(width));
  const textW = Math.max(width(o.title) + 2, ...all.map(r => width(r.label) + 2), ...all.map(r => width(r.group) + 4));
  // A refused row says why as any refused key or click does (the focused tile's frame and the status bar, PIE-727).
  const run = (r: MenuRow, h: H) => (r.refused ? refused(h.ctx, r.refused) : void h.dispatch.press(r.action, r.args, r.tile));
  // ^W, then the key after it: a row's chord (^W x closes).
  let chord = false;
  const p: ListPicker<MenuRow, H> = new ListPicker<MenuRow, H>({
    name: "tile menu", items: sync, clickChooses: true, input, escClears: true,
    typed: () => { sync(); p.sel = 0; },
    heading: (r, i, w) => (i === 0 || rows[i - 1]!.group !== r.group ? fg(C.dark) + ` ${r.group} ${"─".repeat(Math.max(0, w - width(r.group) - 2))}` + RESET : null),
    row: (r, i, on, w) => {
      const cap = caps(rows)[i] ?? "";
      const lit = litCells(r.label, input.text);
      const label = [...r.label].map((c, j) => (lit.has(j) ? fg(C.yellow) + c + fg(on ? C.white : r.refused ? C.dark : C.grey) : c)).join("");
      const capCell = cap ? (r.refused ? fg(C.dark) : chip(C.dark)) + cap + RESET : "";
      return [(on ? selected() : fg(r.refused ? C.dark : C.grey)) + pad(` ${label}`, w - width(cap)) + RESET + capCell];
    },
    choose: (r, _i, h) => run(r, h),
    // A row's own chord runs it (the first that isn't refused; a refused one says why), unless it's a key the list moves by.
    keys: (k, h) => {
      const name = k.kind === "mouse" ? null : keyName(k);
      if (!name) return false;
      const was = chord;
      chord = false;
      if (name === "ctrl+w" && !was) { chord = true; return true; }
      // A bare letter or digit starts or goes on with the query: only a chord (ctrl+, alt+, ^W then a key) is a row's.
      if (!was && (name.length === 1 || LIST_KEYS.has(name))) return false;
      const full = was ? `ctrl+w ${name}` : name;
      const i = [all.findIndex(r => r.key === full && !r.refused), all.findIndex(r => r.key === full)].find(n => n >= 0);
      if (i === undefined) return was;
      p.close(h);
      run(all[i]!, h);
      return true;
    },
    frame: a => {
      sync();
      const w = Math.min(a.cols, Math.max(32, textW + capW + 2));
      // Why the lit row can't run now, under the rows: it's what a click on it would say.
      const lit = rows[p.sel], why = lit?.refused ? wrap(`✕ ${lit.refused}`, w - 3).slice(0, 4).map(l => fg(C.dark) + " " + l + RESET) : [];
      const groups = rows.filter((r, i) => i === 0 || rows[i - 1]!.group !== r.group).length;
      const h = Math.min(a.rows, rows.length + groups + 3 + why.length);
      const col = Math.max(0, Math.min(o.at.right ? o.at.col - w + 1 : o.at.col, a.cols - w));
      // Below the anchor, else above it; on the screen either way (a terminal made smaller since).
      const row = Math.max(0, Math.min(o.at.row + h <= a.rows ? o.at.row : o.at.row - h + 1, a.rows - h));
      const rect: Rect = { col, row, cols: w, rows: h };
      const foot = !all.length ? "nothing to do here · esc" : !rows.length ? "no row matches · backspace · esc clears" : input.text ? "⏎ or a click runs · esc clears" : "type to filter · ⏎ or a click runs · esc";
      return { rect, title: o.title, foot, head: [" " + input.show(w - 4)], tail: why };
    },
  });
  return p;
}
