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
          { t: "split", dir: "row", key: "readers", weights: [4], policy: { keep: 2 }, kids: [{ t: "tabs", tabs: [T("preview", "preview", { source: "tile:lanes", label: "preview · follows the board" })], active: 0, policy: { draggable: false, droppable: false, closable: false } }] },
          // The backlinks stay open while a source is read in a detail.
          { t: "dock", edge: "down", open: false, policy: { stays: true }, kid: { t: "split", dir: "row", key: "links", weights: [0.5, 0.5], policy: { ...DOCK }, kids: [T("backlinks", "backlinks", { source: "tile:preview" }), T("preview", "backlinks-preview", { source: "tile:backlinks", label: "follows the backlinks" })] } },
        ],
      },
    ],
  };
}

const LANES_HINT = "|08 |15g|08 boards · |15h l|08 lane · |15j k|08 card · |15⏎|08 detail · |15H L|08 move · |15m|08 move to... · |15n ^N|08 new card · |15N|08 note under · |15s|08 steps · |15d d|08 trash · |15i|08 properties · |15C|08 comment · |15c|08 collapse · |15alt+c|08 open all · |15t|08 outline · |15b|08 backlinks · |15tab|08 area · |15q|08 menu";
const READER_HINT = "|08 |15tab|08 area · |15c|08 collapse · |15t|08 outline · |15b|08 backlinks of this reader · |15o|08 pop out · |15x|08 close · |15{ } < >|08 size · |15q esc|08 lanes";

/** The board as a screen spec. `hub`: the hub to show (`--screen board <id>`). */
export function boardSpec(args: { hub?: unknown } = {}): ScreenSpec {
  const hub = typeof args.hub === "string" ? args.hub : "";
  return {
    name: "board", title: "board", digits: false, home: "lanes", lands: "readers", saves: "delivery.json",
    layout: { focus: "preview", policy: { opensInto: "readers" }, root: boardTree(hub) },
    // ctrl+n on the lanes is a card in the lane the person is in, born with its properties (PIE-591); elsewhere a float.
    newNote: [{ only: ["query"], action: "card.new" }],
    keys: [
      { key: "g", action: "board.hub" },
      { key: "t", action: "tile.slide", tile: "tree" },
      { key: "T", action: "tile.dock", tile: "tree" },
      { key: "S", action: "tile.dock", tile: "tree", args: { edge: "other" } },
      { key: "b", action: "backlinks", tile: "backlinks", unless: ["backlinks"] },
      { key: "B", action: "tile.dock", tile: "backlinks" },
      { key: "o", action: "tile.float" },
      { key: "alt+c", action: "tile.collapse", tile: "all", args: { on: false } },
      { key: "c", action: "tile.collapse", only: ["preview", "detail"] },
      { key: "x", action: "tile.close", only: ["preview", "detail"] },
      { key: "{", action: "tile.resize", tile: "lanes", args: { axis: "col", by: -1 } },
      { key: "}", action: "tile.resize", tile: "lanes", args: { axis: "col", by: 1 } },
      { key: "<", action: "tile.resize", args: { axis: "row", by: -1 }, unless: ["backlinks"] },
      { key: ">", action: "tile.resize", args: { axis: "row", by: 1 }, unless: ["backlinks"] },
    ],
    hint: {
      query: LANES_HINT,
      backlinks: "|08 |15j k|08 row · |15⏎|08 open · |15alt+⏎|08 new detail · |15. space|08 group · |15/|08 filter · |15s|08 sort · |15K|08 kind · |15w|08 stage · |15h|08 resolved · |15n|08 this note · |15B|08 pin · |15tab|08 area · |15esc|08 close",
      tree: "|08 |15j k|08 row · |15⏎|08 open · |15L|08 links · |15T|08 dock · |15S|08 side · |15tab|08 area · |15esc|08 close",
      float: "|08 drag the title to move (onto a header or an edge docks it) · drag |15◢|08 to resize · |15H J K L|08 move · |15o|08 back in · |15x|08 close · |15tab|08 area",
      spine: "|15c ⏎|08 open · |15alt+c|08 open all · |15tab|08 area · |15esc|08 lanes",
      "*": READER_HINT,
    },
  };
}
