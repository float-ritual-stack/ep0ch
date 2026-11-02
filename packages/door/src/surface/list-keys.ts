import { keyTable } from "./keymap";
import { effective } from "./keymap";
import { modeBinding, type ModeKey } from "./modes";
import { keyCaption } from "./actions";
import type { Key } from "../term";

export const LIST_KEYS = keyTable<ModeKey>("list", "While a list has the keys", [
  { key: "j", action: "list.step", args: { by: 1 }, label: "pick" },
  { key: "down", action: "list.step", args: { by: 1 }, label: "pick" },
  { key: "k", action: "list.step", args: { by: -1 }, label: "pick" },
  { key: "up", action: "list.step", args: { by: -1 }, label: "pick" },
  { key: "home", action: "list.pick", args: { n: 1 }, label: "first", says: "pick the list's first row" },
  { key: "end", action: "list.pick", label: "last", says: "pick the list's last row" },
  { key: "enter", action: "list.open", label: "open" },
  { key: "alt+enter", action: "list.open", args: { where: "new" }, label: "beside" },
  { key: "/", action: "list.filter", label: "filter", says: "type words that narrow the list to the rows they match" },
  { key: "esc", action: "list.enter", args: { on: false }, label: "leave", says: "come out of the links list you went into" },
]);
export const COLLECTION_KEYS = keyTable<ModeKey>("collection", "While a collection has the keys", [
  { key: "h", action: "list.step", args: { by: -1, axis: "column" }, label: "column", says: "move the pick one column left in a gallery, or one lane left on a board" },
  { key: "l", action: "list.step", args: { by: 1, axis: "column" }, label: "column", says: "move the pick one column right in a gallery, or one lane right on a board" },
  { key: "left", action: "list.step", args: { by: -1, axis: "column" }, label: "column", says: "move the pick one column left in a gallery, or one lane left on a board" },
  { key: "right", action: "list.step", args: { by: 1, axis: "column" }, label: "column", says: "move the pick one column right in a gallery, or one lane right on a board" },
  { key: "H", action: "list.step", args: { by: -1, axis: "group" }, label: "group", says: "move the pick to the group before" },
  { key: "L", action: "list.step", args: { by: 1, axis: "group" }, label: "group", says: "move the pick to the next group" },
  { key: "pgup", action: "list.page", args: { by: -1 }, label: "page", says: "turn the collection back a page" },
  { key: "pgdn", action: "list.page", args: { by: 1 }, label: "page", says: "turn the collection on a page" },
  { key: ",", action: "list.tune", label: "tune", says: "open the collection's settings card" },
  { key: "s", action: "list.sort", label: "sort", says: "choose the property the collection sorts by" },
  { key: "g", action: "list.group", label: "group", says: "choose the property the collection groups by" },
]);

/** The keys of `action` in these tables, as one row of keycaps (`j ↓ k ↑`); `axis` narrows a step to its axis. */
export const keysOf = (tables: readonly (readonly ModeKey[])[], action: string, axis?: string) =>
  [...new Set(tables.flatMap(t => effective(t).filter(r => r.action === action && (axis === undefined ? r.args?.axis === undefined : r.args?.axis === axis)).map(r => keyCaption(r.key))))].join(" ");

export function listBinding(key: Key, collection: boolean, count: number): ModeKey | undefined {
  const b = (collection ? modeBinding(COLLECTION_KEYS, key) : undefined) ?? modeBinding(LIST_KEYS, key);
  return b?.action === "list.pick" && !b.args ? { ...b, args: { n: count } } : b;
}

/**
 * The keys a collection's row adds to the row's own hint (PIE-1491, PIE-1501): from the tables above, in plain words,
 * short enough to fit a 44-column reader whole (j k stay in the keys box). No mode to leave: the `[ ]` position is on
 * the row, and esc lets go of it as it does anywhere.
 */
export const collectionHint = () => {
  const rows = [...LIST_KEYS, ...COLLECTION_KEYS];
  // Each group names its keys in the order given, so the hint reads the same every time.
  const keys = (action: string, names: string[], join = " ", axis?: string) => names.filter(name => rows.some(r => r.action === action && r.key === name && (axis === undefined || r.args?.axis === axis))).map(keyCaption).join(join);
  return [
    `${keys("list.step", ["up", "down"], "")} pick`,
    `${keys("list.step", ["h", "l"], " ", "column")} column`,
    `${keys("list.tune", [","])} tune`,
  ].join(" · ");
};
