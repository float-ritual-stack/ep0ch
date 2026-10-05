// A tile's menu (PIE-492): the ⋯ in every tile's header, a right-click anywhere in a tile, ^W . and `tile.menu` open it.
// Its rows are what the dispatcher would run in that tile (`Dispatcher.menu`, from each action's `menu` rows): the tile
// actions, its kind's, a reader's note actions, a board's lane actions. It is a list picker on the desk's overlay
// stack, anchored under the ⋯ or at the pointer: one click or ⏎ runs a row through the dispatcher as the person, a
// row's own key runs it too, and a dimmed row says why it would be refused. An agent gets the same rows as data.
import type { Rect } from "../canvas";
import { keyCaption, keyName } from "../surface/actions";
import type { MenuRow } from "../surface/dispatch";
import { ListPicker } from "../surface/picker";
import { C, chip, fg, pad, RESET, selected, width } from "../style";

/** What the menu runs a row on: the person's press on the screen's dispatcher, and the status bar for a refusal. */
export interface MenuHost {
  dispatch: { press(name: string, args?: Record<string, unknown>, tile?: string): Promise<unknown> };
  ctx: { flash(msg: string): void };
}

/** Keys the list takes itself: a row bound to one still shows it as its keycap, but ⏎ runs the lit row and j k move. */
const LIST_KEYS = new Set(["up", "down", "j", "k", "enter", "tab", "shift+tab", "home", "end", "pgup", "pgdn"]);

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

/** The menu of tile `title`'s rows, its top left corner at `at` (its top right with `right`: under the ⋯), kept on the screen. */
export function tileMenu<H extends MenuHost>(o: { title: string; rows: MenuRow[]; at: { col: number; row: number; right?: boolean } }): ListPicker<MenuRow, H> {
  const { rows } = o;
  const caps = rows.map(r => (r.key ? ` ${keyCaption(r.key)} ` : ""));
  const capW = Math.max(0, ...caps.map(width));
  const textW = Math.max(width(o.title) + 2, ...rows.map(r => width(r.label) + 2), ...rows.map(r => width(r.group) + 4));
  const groups = rows.filter((r, i) => i === 0 || rows[i - 1]!.group !== r.group).length;
  const run = (r: MenuRow, h: H) => (r.refused ? h.ctx.flash(r.refused) : void h.dispatch.press(r.action, r.args, r.tile));
  // ^W, then the key after it: a row's chord (^W x closes).
  let chord = false;
  const p: ListPicker<MenuRow, H> = new ListPicker<MenuRow, H>({
    name: "tile menu", items: () => rows, clickChooses: true,
    heading: (r, i, w) => (i === 0 || rows[i - 1]!.group !== r.group ? fg(C.dark) + ` ${r.group} ${"─".repeat(Math.max(0, w - width(r.group) - 2))}` + RESET : null),
    row: (r, i, on, w) => {
      const cap = caps[i] ? (r.refused ? fg(C.dark) : chip(C.dark)) + caps[i] + RESET : "";
      return [(on ? selected() : fg(r.refused ? C.dark : C.grey)) + pad(` ${r.label}`, w - width(caps[i]!)) + RESET + cap];
    },
    choose: (r, _i, h) => run(r, h),
    // A row's own key runs it (the first that isn't refused; a refused one says why), unless it's a key the list moves by.
    keys: (k, h) => {
      const name = k.kind === "mouse" ? null : keyName(k);
      if (!name) return false;
      const was = chord;
      chord = false;
      if (name === "ctrl+w" && !was) { chord = true; return true; }
      if (!was && LIST_KEYS.has(name)) return false;
      const full = was ? `ctrl+w ${name}` : name;
      const i = [rows.findIndex(r => r.key === full && !r.refused), rows.findIndex(r => r.key === full)].find(n => n >= 0);
      if (i === undefined) return was;
      p.sel = i;
      p.close(h);
      run(rows[i]!, h);
      return true;
    },
    frame: a => {
      const w = Math.min(a.cols, Math.max(32, textW + capW + 2));
      // Why the lit row can't run now, under the rows: it's what a click on it would say.
      const lit = rows[p.sel], why = lit?.refused ? wrap(`✕ ${lit.refused}`, w - 3).slice(0, 4).map(l => fg(C.dark) + " " + l + RESET) : [];
      const h = Math.min(a.rows, rows.length + groups + 2 + why.length);
      const col = Math.max(0, Math.min(o.at.right ? o.at.col - w + 1 : o.at.col, a.cols - w));
      const row = o.at.row + h <= a.rows ? o.at.row : Math.max(0, o.at.row - h + 1);
      const rect: Rect = { col, row, cols: w, rows: h };
      return { rect, title: o.title, foot: rows.length ? "⏎ or a click runs · esc" : "nothing to do here · esc", tail: why };
    },
  });
  return p;
}
