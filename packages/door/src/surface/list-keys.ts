import { keyTable } from "./keymap";
import { modeBinding, modeHint, type ModeKey } from "./modes";
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

export const collectionHint = () => modeHint([
  ...LIST_KEYS.filter(row => ["up", "down", "j", "k", "enter", "esc"].includes(row.key)),
  ...COLLECTION_KEYS.filter(row => row.action === "list.tune" || row.key === "tab"),
], () => undefined).replaceAll(" · ", " ").replace(/\btab\b/g, "⇥");
