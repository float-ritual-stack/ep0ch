// The delivery board (PIE-511) as a screen spec (PIE-515): data on the one screen host, the desk. Its lanes are
// query tiles in a columns container whose tiles come from a hub's views (`hub:<id>`, HUB_SOURCE); what the lanes
// share (the hub shown, the cursor, cards moved and written, steps, trash, the picker) is that source's model
// (src/desk/lanes.ts) and its actions (BOARD_ACTIONS). The readers row is where the lanes' opens land (the screen's
// `opensInto`): the preview following the lanes, and the details opened into it (`keep`: two). The outline (the tree
// over its preview) is a dock on the left, the backlinks (the list beside its preview) a dock at the bottom; a
// close in either shuts its dock (`shuts`). Every key here names an action: the desk's, the backlinks kind's, the
// board's.
import type { ScreenSpec } from "./screen-spec";
import type { SavedTree, TileSpec } from "./tiles";

const T = (kind: string, name: string, more: Partial<TileSpec> = {}): TileSpec => ({ t: "leaf", kind, name, ...more });

/** A dock's list with its preview: they stay in their dock, a close shuts it, and neither folds to a spine. */
const DOCK = { draggable: false, shuts: true, collapsible: false } as const;

/**
 * The board's layout: the outline dock on the left, then the lanes over the readers row, the backlinks dock at
 * the bottom. `hub`: the hub its lanes show (empty: the one remembered for the workspace, else the picker's).
 */
function boardTree(hub: string): SavedTree {
  return {
    t: "split", dir: "row", weights: [0.3, 0.7], kids: [
      // The outline slides shut as the keys leave it, and is never narrower than 28.
      { t: "dock", edge: "left", open: false, policy: { min: 28 }, kid: { t: "split", dir: "col", key: "outline", weights: [0.6, 0.4], policy: { ...DOCK }, kids: [T("tree", "tree"), T("preview", "tree-preview", { source: "tile:tree", label: "follows the outline" })] } },
      {
        t: "split", dir: "col", key: "board", weights: [0.42, 0.58, 0.36], kids: [
          // The lanes stay where they are and take only query tiles; a lane closes when its view goes.
          { t: "columns", key: "lanes", source: `hub:${hub}`, kids: [], weights: [], policy: { draggable: false, accepts: ["query"] } },
          // Where the lanes' opens land: the preview (its own place: it stays, takes no tabs, folds) and two details.
          { t: "split", dir: "row", key: "readers", weights: [4], policy: { readable: 48 }, kids: [{ t: "tabs", tabs: [T("preview", "preview", { source: "tile:lanes", label: "preview · follows the board" })], active: 0, policy: { draggable: false, droppable: false, closable: false } }] },
          // The backlinks stay open while a source is read in a detail.
          { t: "dock", edge: "down", open: false, policy: { stays: true }, kid: { t: "split", dir: "row", key: "links", weights: [0.5, 0.5], policy: { ...DOCK }, kids: [T("backlinks", "backlinks", { source: "tile:preview" }), T("preview", "backlinks-preview", { source: "tile:backlinks", label: "follows the backlinks" })] } },
        ],
      },
    ],
  };
}

/** The board as a screen spec. `hub`: the hub to show (`--screen board <id>`). */
export function boardSpec(args: { hub?: unknown } = {}): ScreenSpec {
  const hub = typeof args.hub === "string" ? args.hub : "";
  return {
    name: "board", title: "board", digits: false, home: "lanes", lands: "readers", saves: "delivery.json",
    layout: { focus: "preview", policy: { opensInto: "readers" }, root: boardTree(hub) },
    // ctrl+n on the lanes is a card in the lane the person is in, born with its properties (PIE-591); elsewhere a float.
    newNote: [{ only: ["query"], action: "card.new" }],
    keys: [
      { key: "o", action: "tile.float" },
      { key: "g", action: "board.hub" },
      { key: "t", action: "tile.slide", tile: "tree", unless: ["reader", "preview", "river.column", "echo.reader"] },
      { key: "T", action: "tile.dock", tile: "tree" },
      { key: "S", action: "tile.dock", tile: "tree", args: { edge: "other" }, unless: ["reader", "preview", "river.column", "echo.reader"] },
      { key: "b", action: "backlinks", tile: "backlinks", unless: ["backlinks"] },
      { key: "B", action: "tile.dock", tile: "backlinks" },
      { key: "alt+c", action: "tile.collapse", tile: "all", args: { on: false } },
      { key: "c", action: "tile.collapse", only: ["preview", "reader"] },
      { key: "x", action: "tile.close", only: ["preview", "reader"] },
      { key: "<", action: "tile.resize", args: { axis: "row", by: -1 }, unless: ["backlinks"] },
      { key: ">", action: "tile.resize", args: { axis: "row", by: 1 }, unless: ["backlinks"] },
    ],

  };
}
