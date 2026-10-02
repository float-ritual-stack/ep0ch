// `pane.split` (PIE-412): a new tile beside another, along the longer side, as the desk's ^W o opens one. It's
// kept by its own name because its arguments are its own (dir=row|col, and no where= or to=); the rest of the
// older `pane.*` names (close, resize, zoom, float, pin) are aliases of the tile actions (src/desk/tile-actions.ts):
// one action each, one path. An agent's is said on screen, and it never takes the person's tile.
import type { Actor } from "../socket";
import { ActionRefused, ActionSet } from "../surface/actions";
import type { Axis } from "./screen-layout";
import { tileKinds, tileNoun } from "./tile-kinds";

/** What pane.split did: `tile` the new tile's name, `pane` its number on screen (the older answer, kept). */
export interface PaneDone { pane: string; [k: string]: unknown }

/** A view on the layout tree that opens a tile beside another. `sel` names a tile as `peek` does. */
export interface PaneHost {
  ctx: { flash(msg: string): void };
  splitPane(sel: string | undefined, kind: string | undefined, dir: Axis | undefined, actor: Actor): PaneDone | Promise<PaneDone>;
}

interface On { h: PaneHost; reader?: string }

const axisOf = (s: string | undefined, action: string): Axis | undefined => {
  if (s === undefined) return undefined;
  if (s === "row" || s === "col") return s;
  throw new ActionRefused(`${action}: dir is row (beside) or col (below), not ${s}`);
};
/** The kinds a tile can be, from the registry (extensions' too), as the summary lists them. */
const kinds = () => tileKinds().map(k => k.kind).join(", ");

export const PANE_ACTIONS = new ActionSet<{
  "pane.split": { kind?: string; dir?: string };
}, On>("pane", {
  "pane.split": {
    get summary() { return `open a tile beside tile=<tile> (default the focused one), along its longer side: kind=<kind> (default reader; ${kinds()}), dir=row (beside) or col (below). The person's focus stays where it is. tile.open does the same with where= and to=. The board's details open with a note: open tile=new-detail`; },
    keys: "desk ^W o <kind>; board alt+⏎",
    touches: "shape", replay: "ask", says: (r, a) => `opened ${tileNoun(a.kind ?? "reader", r.pane)}`,
    args: { kind: { type: "string", optional: true, about: "what the new tile shows: a kind from the tile-kind registry (default reader)" }, dir: { type: "string", optional: true, about: "row (beside) or col (below); default along the longer side" } },
    run({ kind, dir }, { h, reader }, actor) { return h.splitPane(reader, kind, axisOf(dir, "pane.split"), actor); },
  },
});
