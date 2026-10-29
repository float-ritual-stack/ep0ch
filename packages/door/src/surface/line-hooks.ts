// The door's side of every line field (src/surface/line.ts), in a file of its own with nothing but types imported, so
// the completer (src/surface/completer.ts) and the App can set it without importing the field, which imports them.
import type { Key } from "../term";
import type { LineField } from "./line";

/**
 * What a line completes (PIE-626): by default outline text, as a draft does (`[[` `((` `[file::`, a callout, a `[key::`);
 * `grammar: "filter"` a `key:value` filter's words; `grammar: "act"` an act line's arguments (the power bar's line:
 * `tile.zoom t` then `tile=`, then this screen's tiles, PIE-1076); `valueKey` the value of that property (the panel's field); `false`
 * names, paths and plain queries, which aren't outline text.
 */
export type LineCompletion = false | { grammar?: "text" | "filter" | "act"; valueKey?: string };

/**
 * The door's side of every line (src/surface/completer.ts and the App set these when they load, so this file stays
 * small): the connection a line made while the door runs belongs to, what happens around its keys, and the clipboard
 * a cut or a copy goes to.
 */
export const lineCompletionHooks: {
  ambient?: () => object | null;
  before?: (i: LineField, k: Key) => boolean;
  after?: (i: LineField, k: Key, took: boolean, text: string) => void;
  copy?: (text: string) => void;
} = {};

