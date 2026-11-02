import { keyTable } from "./keymap";
import { modeBinding, type ModeKey } from "./modes";
import { keyCaption } from "./actions";
import type { Key } from "../term";

export const LIST_KEYS = keyTable<ModeKey>("list", "While a list has the keys", [
  { key: "j", action: "list.step", args: { by: 1 }, label: "pick" },
  { key: "down", action: "list.step", args: { by: 1 }, label: "pick" },
  { key: "k", action: "list.step", args: { by: -1 }, label: "pick" },
  { key: "up", action: "list.step", args: { by: -1 }, label: "pick" },
  { key: "home", action: "list.pick", args: { n: 1 }, label: "first" },
  { key: "end", action: "list.pick", label: "last" },
  { key: "enter", action: "list.open", label: "open" },
  { key: "alt+enter", action: "list.open", args: { where: "new" }, label: "beside" },
  { key: "/", action: "list.filter", label: "filter" },
  { key: "esc", action: "list.enter", args: { on: false }, label: "leave" },
]);
export const COLLECTION_KEYS = keyTable<ModeKey>("collection", "While a collection has the keys", [
  { key: "h", action: "list.step", args: { by: -1, axis: "column" }, label: "column" },
  { key: "l", action: "list.step", args: { by: 1, axis: "column" }, label: "column" },
  { key: "left", action: "list.step", args: { by: -1, axis: "column" }, label: "column" },
  { key: "right", action: "list.step", args: { by: 1, axis: "column" }, label: "column" },
  { key: "H", action: "list.step", args: { by: -1, axis: "group" }, label: "group" },
  { key: "L", action: "list.step", args: { by: 1, axis: "group" }, label: "group" },
  { key: "pgup", action: "list.page", args: { by: -1 }, label: "page" },
  { key: "pgdn", action: "list.page", args: { by: 1 }, label: "page" },
  { key: "tab", action: "list.enter", args: { on: false }, label: "leave" },
  { key: ",", action: "list.tune", label: "tune" },
  { key: "s", action: "list.sort", label: "sort" },
  { key: "g", action: "list.group", label: "group" },
]);

export function listBinding(key: Key, collection: boolean, count: number): ModeKey | undefined {
  const b = (collection ? modeBinding(COLLECTION_KEYS, key) : undefined) ?? modeBinding(LIST_KEYS, key);
  return b?.action === "list.pick" && !b.args ? { ...b, args: { n: count } } : b;
}

/**
 * The hint while the cursor is in a collection (PIE-1491): only its own keys, from the tables above, in plain words,
 * short enough to fit a 44-column reader whole (j k stay in the keys box).
 */
export const collectionHint = () => {
  const rows = [...LIST_KEYS, ...COLLECTION_KEYS];
  // Each group names its keys in the order given, so the hint reads the same every time.
  const keys = (action: string, names: string[], join = " ") => names.filter(name => rows.some(r => r.action === action && r.key === name)).map(keyCaption).join(join);
  return [
    `${keys("list.step", ["up", "down"], "")} pick`,
    `${keys("list.open", ["enter"])} open`,
    `${keys("list.enter", ["tab", "esc"])} leave`,
    `${keys("list.tune", [","])} tune`,
  ].join(" · ");
};
