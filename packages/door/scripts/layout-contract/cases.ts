// What the contract tables ask (scripts/layout-contract.ts): made-up layouts of a garden's notes, the operations and
// opens tried on them, and act lines. Every container kind (a split, a tab set, a dock, columns, a flow, floats over
// them), every layout operation and every open rule the door has is asked at least once, by the person and by an agent;
// test/layout-contract.test.ts counts them against the door's source. Only the question is here: the generator runs
// the door's own functions for the answer. A tile's name is its id.
import type { Rect } from "../../src/canvas";
import type { Actor } from "../../src/socket";
import type { Ctx, Op, Person, PlacementRequest, Policy, TileFacts } from "../../src/desk/screen-layout";
import type { LayoutSpec, SavedTree, TileSpec } from "../../src/desk/tiles";

/** The room every case has unless it says its own: a wide terminal. */
export const AREA: Rect = { col: 0, row: 0, cols: 160, rows: 46 };
/** A phone held upright: where an open beside a tile no longer reads. */
const NARROW: Rect = { col: 0, row: 0, cols: 44, rows: 30 };

/** A layout and what its tiles are beyond their kind (what a tile's own pane says: the note it shows, a pin, an edit). */
export interface Scene { layout: LayoutSpec; tiles?: Record<string, Partial<TileFacts>> }
/** What a case tells the layout beyond who acts and where the person is: the parts of `Ctx` that are data. */
export type CaseCtx = Pick<Ctx<string>, "home" | "outward" | "screen" | "freshAction" | "empties" | "otherNames" | "expected" | "screenHost" | "self"> & {
  /** The reader opened beside a tile last (Ctx.beside). */ beside?: Record<string, string>;
  /** The tiles opened into a container, and the one last given the keys (Ctx.opened). */ opened?: Record<string, { ids: string[]; active: string | null }>;
};
interface Asked {
  name: string; scene: Scene;
  /** Applied first, each by the person unless it says who: what a saved layout can't hold (a zoom, a lift, an agent's lock, the tile a tile was opened from). */
  setup?: { op: Op<string>; by?: Actor }[];
  by?: Actor; person?: Partial<Person<string>>; area?: Rect; ctx?: CaseCtx;
}
export interface LayoutCase extends Asked { op: Op<string>; /** Tiles the operation brings that it doesn't give a kind (an ungroup's): name → kind. */ brings?: Record<string, string> }
export interface PlaceCase extends Asked { request: PlacementRequest<string> }

const AGENT: Actor = { kind: "agent", id: "seedling-agent" };
const HELPER: Actor = { kind: "agent", id: "compost-agent" };

// ── building a saved layout ──

type Saved = SavedTree;
const T = (kind: string, name: string, more: Partial<TileSpec> = {}): TileSpec => ({ t: "leaf", kind, name, ...more });
const split = (dir: "row" | "col") => (kids: Saved[], weights?: number[], more: { id?: string; key?: string; policy?: Policy; pair?: true } = {}): Saved =>
  ({ t: "split", dir, kids, weights: weights ?? kids.map(() => 1 / kids.length), ...more }) as Saved;
const row = split("row"), col = split("col");
const tabs = (of: TileSpec[], active = 0, more: { id?: string; policy?: Policy } = {}): Saved => ({ t: "tabs", tabs: of, active, ...more });
const dock = (kid: Saved, edge: "left" | "right" | "up" | "down", open: boolean, more: { id?: string; policy?: Policy; keeps?: true } = {}): Saved => ({ t: "dock", kid, edge, open, ...more }) as Saved;
const columns = (kids: Saved[], more: { id?: string; key?: string; source?: string; policy?: Policy; weights?: number[] } = {}): Saved => ({ t: "columns", kids, weights: more.weights ?? kids.map(() => 1), ...more }) as Saved;
const flow = (kids: Saved[], more: Record<string, unknown> = {}): Saved => ({ t: "flow", kids, ...more }) as Saved;

// ── the scenes: one garden, laid out each way the door lays tiles out ──

/** Splits: the beds on the left, the bed being read, and the seed list over the log on the right. */
const garden = (o: { policy?: Policy; side?: Policy; bed?: Partial<TileSpec>; beds?: Partial<TileSpec>; seeds?: Partial<TileSpec>; log?: Partial<TileSpec>; tiles?: Scene["tiles"]; focus?: string; floats?: LayoutSpec["floats"] } = {}): Scene => ({
  layout: {
    focus: o.focus ?? "bed", ...(o.policy ? { policy: o.policy } : {}), ...(o.floats ? { floats: o.floats } : {}),
    root: row([T("tree", "beds", o.beds), T("reader", "bed", o.bed), col([T("query", "seeds", { query: "type=seed", ...o.seeds }), T("activity", "log", o.log)], [0.6, 0.4], { id: "s2", ...(o.side ? { policy: o.side } : {}) })], [0.24, 0.5, 0.26], { id: "s1" }),
  },
  tiles: { beds: { lists: true }, seeds: { lists: true }, bed: { showing: "north-bed" }, ...o.tiles },
});

/** Tabs: the beds beside a tab set of the bed, the tool list and a terminal watering the trays. */
const shed = (o: { active?: number; policy?: Policy; tabsPolicy?: Policy; tiles?: Scene["tiles"]; focus?: string; tools?: Partial<TileSpec> } = {}): Scene => ({
  layout: {
    focus: o.focus ?? "bed", ...(o.policy ? { policy: o.policy } : {}),
    root: row([T("tree", "beds"), tabs([T("reader", "bed"), T("reader", "tools", o.tools), T("pty", "hose", { cmd: ["water", "--trays"] })], o.active ?? 0, { id: "g2", ...(o.tabsPolicy ? { policy: o.tabsPolicy } : {}) })], [0.3, 0.7], { id: "s1" }),
  },
  tiles: { beds: { lists: true }, bed: { showing: "north-bed" }, tools: { showing: "tool-list" }, ...o.tiles },
});

/** Docks: the beds slid out from the left, the bed, and the roots (what links to it) shut on the right. */
const greenhouse = (o: { left?: boolean; right?: boolean; leftPolicy?: Policy; rightPolicy?: Policy; policy?: Policy; tiles?: Scene["tiles"]; focus?: string } = {}): Scene => ({
  layout: {
    focus: o.focus ?? "bed", ...(o.policy ? { policy: o.policy } : {}),
    root: row([dock(T("tree", "beds"), "left", o.left ?? true, { id: "d2", ...(o.leftPolicy ? { policy: o.leftPolicy } : {}) }), row([T("reader", "bed"), T("activity", "log")], [0.7, 0.3], { id: "s3" }), dock(T("backlinks", "roots", { source: "tile:bed" }), "right", o.right ?? false, { id: "d4", ...(o.rightPolicy ? { policy: o.rightPolicy } : {}) })], [0.22, 0.56, 0.22], { id: "s1" }),
  },
  tiles: { beds: { lists: true }, roots: { lists: true, home: "bed" }, bed: { showing: "north-bed" }, ...o.tiles },
});

/** Columns: three lanes of seed trays filled from a hub, over a row the cards open into. */
const plots = (o: { lanes?: Policy; policy?: Policy; readers?: Saved[]; tiles?: Scene["tiles"]; focus?: string } = {}): Scene => ({
  layout: {
    focus: o.focus ?? "sown", policy: { opensInto: "readers", ...o.policy },
    root: col([
      columns([T("query", "sown", { view: "view-sown" }), T("query", "sprouting", { view: "view-sprouting" }), T("query", "picked", { view: "view-picked" })], { id: "c2", key: "lanes", source: "hub:trays", policy: { accepts: ["query"], closable: false, ...o.lanes } }),
      row(o.readers ?? [T("preview", "card", { source: "tile:lanes" }), T("reader", "tray")], undefined, { id: "s3", key: "readers" }),
    ], [0.6, 0.4], { id: "s1" }),
  },
  tiles: { sown: { lists: true, keeps: "hub:trays supplies it, and it goes when its data does" }, sprouting: { lists: true, keeps: "hub:trays supplies it, and it goes when its data does" }, picked: { lists: true, keeps: "hub:trays supplies it, and it goes when its data does" }, ...(JSON.stringify(o.readers ?? "tray").includes("tray") ? { tray: { showing: "tray-7" } } : {}), ...o.tiles },
});

/** A flow: the stream of notes, each opening into the next column, the wide place on the second. */
const stream = (o: { memory?: Record<string, unknown>; policy?: Policy; flowPolicy?: Policy; extra?: Saved[]; tiles?: Scene["tiles"]; focus?: string; mouth?: Partial<TileSpec> } = {}): Scene => ({
  layout: {
    focus: o.focus ?? "bend", ...(o.policy ? { policy: o.policy } : {}),
    root: flow([T("river.column", "spring", { source: "roots" }), T("reader", "bend"), T("reader", "mouth", o.mouth), ...(o.extra ?? [])], { id: "f1", key: "stream", anchor: 1, ...(o.flowPolicy ? { policy: o.flowPolicy } : {}), ...o.memory }),
  },
  tiles: { spring: { lists: true }, bend: { showing: "bend-note" }, mouth: { showing: "mouth-note" }, ...o.tiles },
});

/** One tile alone: the almanac. */
const almanac = (o: { policy?: Policy } = {}): Scene => ({ layout: { focus: "almanac", ...(o.policy ? { policy: o.policy } : {}), root: T("reader", "almanac") }, tiles: { almanac: { showing: "almanac-june" } } });

/**
 * Two readers side by side: the bed, whose opens are wired to the spare reader beside it (`to`: another tile, or a
 * path on another screen), which shows no note until the scene says so.
 */
const pair = (o: { to?: string; spare?: Partial<TileFacts>; beds?: Partial<TileFacts>; bed?: Partial<TileFacts>; wired?: false; policy?: Policy; focus?: string } = {}): Scene => ({
  layout: {
    focus: o.focus ?? "bed", ...(o.policy ? { policy: o.policy } : {}),
    root: row([T("tree", "beds"), T("reader", "bed", o.wired === false ? {} : { wires: [{ verb: "open", to: o.to ?? "spare" }] }), T("reader", "spare")], [0.2, 0.4, 0.4], { id: "s1" }),
  },
  tiles: { beds: { lists: true, ...o.beds }, bed: { showing: "north-bed", ...o.bed }, spare: { ...o.spare } },
});

/** A float over the garden: a note on the trellis, popped out. */
const TRELLIS = { tile: T("reader", "trellis"), rect: { col: 40, row: 6, cols: 70, rows: 24 } };
const withFloat = (o: Parameters<typeof garden>[0] = {}): Scene => garden({ ...o, floats: [TRELLIS], tiles: { trellis: { showing: "trellis-plan" }, ...o.tiles } });

const typing = (tile: string): Partial<Person<string>> => ({ focus: tile, typingIn: tile, busy: true });

// ── layout operations ──

export const LAYOUT_CASES: LayoutCase[] = [
  // open: a new tile at a place
  { name: "open: a reader beside the bed, on its right; the person's keys go to it", scene: garden(), op: { op: "open", tile: "sprout", kind: "reader", name: "sprout", at: { kind: "split", target: "bed", dir: "right" } } },
  { name: "open: above a tile nests a column in the row", scene: garden(), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "split", target: "bed", dir: "up", weight: 0.3 } } },
  { name: "open: a pair in a tile's place is never flattened into its row", scene: garden(), op: { op: "open", tile: "margin", kind: "comment", at: { kind: "split", target: "bed", dir: "right", pair: true, weight: 0.4 }, keys: false } },
  { name: "open: into a tile's tabs makes a tab set, the new tab shown", scene: garden(), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "tabs", target: "bed" } } },
  { name: "open: a tab at an index of a tab set", scene: shed(), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "tabs", target: "bed", index: 0 } } },
  { name: "open: along the screen's bottom edge", scene: garden(), op: { op: "open", tile: "hose", kind: "pty", at: { kind: "edge", dir: "down" } } },
  { name: "open: into a named row, at an index", scene: plots(), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "in", key: "readers", index: 1 } } },
  { name: "open: the next column of a flow, after the column it was opened from", scene: stream(), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "next", from: "bend" } } },
  { name: "open: a float, half the screen", scene: garden(), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "float" } } },
  { name: "open: a float at a rectangle is kept on the screen", scene: garden(), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "float", rect: { col: 150, row: 40, cols: 60, rows: 20 } } } },
  { name: "open: into the dock that keeps work", scene: garden(), op: { op: "open", tile: "hose", kind: "pty", at: { kind: "kept" }, keys: false } },
  { name: "open: beside a tile with room goes right of it", scene: garden(), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "beside", target: "bed", prefers: "beside" } } },
  { name: "open: beside a tile on a narrow screen floats, and says why", scene: garden(), area: NARROW, op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "beside", target: "bed", prefers: "beside" } } },
  { name: "open: beside, wanting width, on a narrow screen goes along the bottom edge", scene: garden(), area: NARROW, op: { op: "open", tile: "sprout", kind: "trail", at: { kind: "beside", target: "bed", prefers: "width" } } },
  { name: "open: beside, strictly, where it wouldn't read is refused", scene: garden(), area: NARROW, op: { op: "open", tile: "sprout", kind: "trail", at: { kind: "beside", target: "bed", prefers: "there", dir: "right", strict: true } } },
  { name: "open: beside as asked, where it doesn't read, goes there all the same and says so", scene: garden(), area: NARROW, op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "beside", target: "bed", prefers: "there", dir: "right" } } },
  { name: "open: beside by the longer side (a preview, a split)", scene: garden(), op: { op: "open", tile: "card", kind: "preview", at: { kind: "beside", target: "log", prefers: "axis" } } },
  { name: "open: beside, under a tile (an inspector)", scene: garden(), op: { op: "open", tile: "dials", kind: "tune", at: { kind: "beside", target: "bed", prefers: "height" } } },
  { name: "open: beside as asked, on the left", scene: garden(), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "beside", target: "bed", prefers: "there", dir: "left" } } },
  { name: "open: a name another tile has is refused", scene: garden(), op: { op: "open", tile: "sprout", kind: "reader", name: "log", at: { kind: "split", target: "bed", dir: "right" } } },
  { name: "open: loosely, a name taken gives way to the kind's next free name", scene: garden(), op: { op: "open", tile: "sprout", kind: "reader", name: "log", loose: true, at: { kind: "split", target: "bed", dir: "right" } } },
  { name: "open: a tile in the layout already is refused", scene: garden(), op: { op: "open", tile: "log", kind: "activity", at: { kind: "edge", dir: "right" } } },
  { name: "open: beside a tile that isn't there is refused", scene: garden(), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "split", target: "orchard", dir: "right" } } },
  { name: "open: nothing goes beside a float", scene: withFloat(), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "split", target: "trellis", dir: "right" } } },
  { name: "open: a locked screen refuses, and says how to unlock it", scene: garden({ policy: { locked: true } }), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "split", target: "bed", dir: "right" } } },
  { name: "open: a locked container refuses under it only", scene: shed({ tabsPolicy: { locked: true } }), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "tabs", target: "bed" } } },
  { name: "open: columns that take only their own kind refuse another", scene: plots(), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "in", key: "lanes" } } },
  { name: "open: a container that takes no drops refuses", scene: plots({ lanes: { droppable: false } }), op: { op: "open", tile: "ripe", kind: "query", at: { kind: "in", key: "lanes" } } },
  { name: "open: a named row that is gone is refused", scene: garden(), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "in", key: "readers" } } },
  { name: "open: the next column needs a flow", scene: garden(), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "next", from: "bed" } } },
  { name: "open: the next column, onto a column already there, goes to it", scene: stream(), op: { op: "open", tile: "mouth", kind: "reader", at: { kind: "next", from: "bend" } } },
  { name: "open: linked in the same step, the tile it was opened from opens into it", scene: garden(), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "split", target: "bed", dir: "right" }, link: "seeds", selectFrom: ["beds"], keys: false } },
  { name: "open: a link to a tile that takes no notes is refused whole", scene: garden(), op: { op: "open", tile: "hose", kind: "pty", at: { kind: "edge", dir: "down" }, link: "seeds" } },
  { name: "open: an agent's new tile never takes the person's keys", scene: garden(), by: AGENT, op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "split", target: "bed", dir: "right" } } },
  { name: "open: an agent's new tab is added behind the tab the person has", scene: shed(), by: AGENT, op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "tabs", target: "bed" } } },
  { name: "open: an agent's open that would resize the tile the person types in is refused", scene: garden(), by: AGENT, person: typing("bed"), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "split", target: "bed", dir: "right" } } },
  { name: "open: an agent's float leaves the tile the person types in its size", scene: garden(), by: AGENT, person: typing("bed"), op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "float" } } },
  { name: "open: an agent's open beside the tile being typed in is refused, never floated over it", scene: garden(), by: AGENT, person: typing("bed"), area: NARROW, op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "beside", target: "bed", prefers: "beside" } } },
  { name: "open: an agent may not open into the tabs of an edit-only tile", scene: shed({ tools: { agents: "edit" } }), by: AGENT, op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "tabs", target: "tools" } } },
  { name: "open: an agent in yolo opens under the person's lock", scene: garden({ policy: { locked: true } }), by: AGENT, person: { yolo: true }, op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "split", target: "bed", dir: "right" } } },
  { name: "open: a stale revision is refused, nothing done", scene: garden(), ctx: { expected: 0 }, op: { op: "open", tile: "sprout", kind: "reader", at: { kind: "split", target: "bed", dir: "right" } } },
  { name: "open: by a placement request, the note lands in the first reader", scene: garden(), person: { focus: "beds" }, op: { op: "open", tile: "sprout", placement: { from: "beds", note: "south-bed" } } },
  { name: "open: by a placement request, a held reader keeps its old note as a spine", scene: garden({ tiles: { bed: { showing: "north-bed", held: true } } }), person: { focus: "beds" }, op: { op: "open", tile: "sprout", placement: { from: "beds", note: "south-bed", to: "bed" } } },
  { name: "open: by a placement request nobody takes is refused", scene: { layout: { root: T("activity", "log") } }, ctx: { screen: null }, op: { op: "open", tile: "sprout", placement: { from: "log", note: "south-bed" } } },

  // close, release, replace, take
  { name: "close: a tile goes, its room shared out, the keys to a tile that shows", scene: garden(), op: { op: "close", tile: "bed" } },
  { name: "close: the last tile of a nested split gives its place back", scene: garden(), op: { op: "close", tile: "log" } },
  { name: "close: a tab leaves its tab set", scene: shed(), op: { op: "close", tile: "bed" } },
  { name: "close: a float goes, the keys back in the layout", scene: withFloat(), person: { focus: "trellis" }, op: { op: "close", tile: "trellis" } },
  { name: "close: a flow's wide column passes the wide place on", scene: stream(), op: { op: "close", tile: "bend" } },
  { name: "close: the keys go back to the tile that opened it", scene: garden(), setup: [{ op: { op: "opened", tile: "log", from: "beds" } }, { op: { op: "focus", tile: "log" } }], op: { op: "close", tile: "log" } },
  { name: "close: opened into a container, the keys go to the tile it opens into now", scene: plots({ readers: [T("preview", "card", { source: "tile:lanes" }), T("reader", "tray"), T("reader", "tray2")] }), setup: [{ op: { op: "focus", tile: "tray2" } }], ctx: { opened: { readers: { ids: ["tray", "tray2"], active: "tray" } }, home: "sown" }, op: { op: "close", tile: "tray2" } },
  { name: "close: opened into a container that holds nothing else, the keys go home", scene: plots(), setup: [{ op: { op: "focus", tile: "tray" } }], ctx: { opened: { readers: { ids: ["tray"], active: "tray" } }, home: "sown" }, op: { op: "close", tile: "tray" } },
  { name: "close: a container that keeps its tiles refuses", scene: plots({ tiles: { sown: { lists: true } } }), op: { op: "close", tile: "sown" } },
  { name: "close: a tile its source supplies stays", scene: plots({ lanes: { closable: true } }), op: { op: "close", tile: "sown" } },
  { name: "close: a tile holding an edit is not closed", scene: garden({ tiles: { bed: { showing: "north-bed", editing: "an edit of north-bed" } } }), op: { op: "close", tile: "bed" } },
  { name: "close: a locked screen keeps every tile", scene: garden({ policy: { locked: true } }), op: { op: "close", tile: "log" } },
  { name: "close: a kind that clears keeps its place", scene: garden({ tiles: { bed: { showing: "north-bed", clearsOnClose: true } } }), op: { op: "close", tile: "bed" } },
  { name: "close: an agent never closes the tile with the person's keys", scene: garden(), by: AGENT, op: { op: "close", tile: "bed" } },
  { name: "close: an agent closes a tile the person isn't in", scene: garden(), by: AGENT, op: { op: "close", tile: "log" } },
  { name: "close: an agent doesn't end a running program", scene: shed({ tiles: { hose: { running: "water --trays" } } }), by: AGENT, op: { op: "close", tile: "hose" } },
  { name: "close: an agent may not close an edit-only tile", scene: garden({ log: { agents: "edit" } }), by: AGENT, op: { op: "close", tile: "log" } },
  { name: "close: a hands-off container refuses an agent for every tile under it", scene: shed({ tabsPolicy: { agents: "off" } }), by: AGENT, person: { focus: "beds" }, op: { op: "close", tile: "tools" } },
  { name: "close: the screen's default limits agents too", scene: garden({ policy: { agents: "edit" } }), by: AGENT, op: { op: "close", tile: "log" } },
  { name: "close: gone already (its program ended), no rule asks", scene: plots(), op: { op: "close", tile: "sown", gone: true } },
  { name: "close: a tile that isn't there is refused", scene: garden(), op: { op: "close", tile: "orchard" } },
  // What a close leaves of the closed reader's note (closeHeir): asked by the close that commits (`heir: true`).
  { name: "close, its note kept: the empty reader its opens are wired to takes the note", scene: pair(), op: { op: "close", tile: "bed", heir: true } },
  { name: "close, its note kept: not asked, nothing is answered of the note", scene: pair(), op: { op: "close", tile: "bed" } },
  { name: "close, its note kept: the reader its container's rule opens into takes it, with no wire", scene: pair({ wired: false, policy: { opensInto: "spare" } }), op: { op: "close", tile: "bed", heir: true } },
  { name: "close, its note kept: with no wire and no rule, no tile is its heir", scene: pair({ wired: false }), op: { op: "close", tile: "bed", heir: true } },
  { name: "close, its note kept: another tile shows the note already, so none takes it", scene: pair({ beds: { showing: "north-bed" } }), op: { op: "close", tile: "bed", heir: true } },
  { name: "close, its note kept: a reader that shows a note of its own keeps it", scene: pair({ spare: { showing: "south-bed" } }), op: { op: "close", tile: "bed", heir: true } },
  { name: "close, its note kept: a pinned reader takes none", scene: pair({ spare: { pinned: true } }), op: { op: "close", tile: "bed", heir: true } },
  { name: "close, its note kept: a reader holding an edit takes none", scene: pair({ spare: { editing: "an edit of seed-list" } }), op: { op: "close", tile: "bed", heir: true } },
  { name: "close, its note kept: a reader holding work takes none", scene: pair({ spare: { holds: true } }), op: { op: "close", tile: "bed", heir: true } },
  { name: "close, its note kept: a reader that follows a list takes none", scene: pair({ spare: { follower: true } }), op: { op: "close", tile: "bed", heir: true } },
  { name: "close, its note kept: a reader that isn't available takes none", scene: pair({ spare: { available: false } }), op: { op: "close", tile: "bed", heir: true } },
  { name: "close, its note kept: an agent's close leaves the reader with the person's keys as it is", scene: pair({ focus: "spare" }), by: AGENT, op: { op: "close", tile: "bed", heir: true } },
  { name: "close, its note kept: an agent's close gives it to the heir when the person is away from this layout", scene: pair({ focus: "spare" }), by: AGENT, person: { here: false }, op: { op: "close", tile: "bed", heir: true } },
  { name: "close, its note kept: an agent's close gives it to a heir the person isn't in", scene: pair({ focus: "beds" }), by: AGENT, op: { op: "close", tile: "bed", heir: true } },
  { name: "close, its note kept: opens wired across to another screen, the heir is there", scene: pair({ to: "nursery/reader" }), op: { op: "close", tile: "bed", heir: true } },
  { name: "close, its note kept: a tile gone already has no heir", scene: pair(), op: { op: "close", tile: "bed", gone: true, heir: true } },
  { name: "close, its note kept: a kind that clears keeps its place and its note goes nowhere", scene: pair({ bed: { clearsOnClose: true } }), op: { op: "close", tile: "bed", heir: true } },
  { name: "close, its note kept: a reader that shows no note leaves none", scene: pair({ bed: { showing: undefined } }), op: { op: "close", tile: "bed", heir: true } },
  { name: "close, its note kept: a tile that reads no notes leaves none", scene: pair({ beds: { showing: "north-bed" }, bed: { showing: undefined } }), person: { focus: "beds" }, op: { op: "close", tile: "beds", heir: true } },
  { name: "release: a tile leaves whole for an undo to put back", scene: garden(), op: { op: "release", tile: "log" } },
  { name: "release: a tile that isn't there is refused", scene: garden(), op: { op: "release", tile: "orchard" } },
  { name: "peek.release: a peek stops following the tile it was opened from", scene: garden({ beds: { wires: [{ verb: "select", to: "glance" }] }, floats: [{ tile: T("reader", "glance"), rect: { col: 60, row: 4, cols: 64, rows: 20 }, peekOf: "beds" }] }), op: { op: "peek.release", tile: "glance" } },
  { name: "replace: a reader takes the blank tile's place, and the keys", scene: { layout: { focus: "blank", root: row([T("tree", "beds"), T("blank", "blank")], [0.3, 0.7], { id: "s1" }) } }, op: { op: "replace", tile: "blank", with: "sprout", kind: "reader", name: "bed" } },
  { name: "replace: an agent replaces a place holder under the person's keys", scene: { layout: { focus: "blank", root: row([T("tree", "beds"), T("blank", "blank")], [0.3, 0.7], { id: "s1" }) } }, by: AGENT, op: { op: "replace", tile: "blank", with: "sprout", kind: "reader" } },
  { name: "replace: an agent never replaces the tile the person has", scene: garden(), by: AGENT, op: { op: "replace", tile: "bed", with: "sprout", kind: "reader" } },
  { name: "replace: a tile holding work is closed first", scene: garden({ tiles: { log: { holds: true } } }), op: { op: "replace", tile: "log", with: "sprout", kind: "reader" } },
  { name: "replace: its container must take the new kind", scene: plots({ lanes: { closable: true }, tiles: { sown: { lists: true } } }), op: { op: "replace", tile: "sown", with: "sprout", kind: "reader" } },
  { name: "replace: linked as it lands", scene: garden(), op: { op: "replace", tile: "log", with: "sprout", kind: "reader", link: "seeds", selectFrom: ["beds"] } },
  { name: "take: a tile leaves for the drawer, whole", scene: garden(), op: { op: "take", tile: "log" } },
  { name: "take: an heir takes its place, its name and the keys", scene: garden(), op: { op: "take", tile: "bed", heir: { id: "sprout" } }, brings: { sprout: "reader" } },
  { name: "take: the screen's last tile stays", scene: almanac(), op: { op: "take", tile: "almanac" } },
  { name: "take: the drawer may be left empty", scene: almanac(), ctx: { empties: true, self: { name: "your drawer", chip: "drawer" } }, op: { op: "take", tile: "almanac" } },
  { name: "take: a container that keeps its tiles in place refuses", scene: garden({ policy: { draggable: false } }), op: { op: "take", tile: "log" } },
  { name: "take: an agent never takes the tile with the person's keys", scene: garden(), by: AGENT, op: { op: "take", tile: "bed" } },

  // group, ungroup
  { name: "group: a tile and those named gather into one tile, in its place", scene: garden(), op: { op: "group", tile: "seeds", take: ["log"], with: "shelf", kind: "screen", name: "shelf" } },
  { name: "group: a whole container gathers", scene: garden(), op: { op: "group", node: "s2", with: "shelf", kind: "screen" } },
  { name: "group: columns filled from a source aren't gathered", scene: plots({ lanes: { closable: true }, tiles: { sown: { lists: true }, sprouting: { lists: true }, picked: { lists: true } } }), op: { op: "group", node: "lanes", with: "shelf", kind: "screen" } },
  { name: "group: a float isn't gathered", scene: withFloat(), op: { op: "group", tile: "trellis", with: "shelf", kind: "screen" } },
  { name: "group: an agent never gathers the tile the person has", scene: garden(), by: AGENT, op: { op: "group", tile: "bed", with: "shelf", kind: "screen" } },
  { name: "ungroup: a group's tiles take its place, laid out as it held them", scene: { layout: { focus: "shelf", root: row([T("tree", "beds"), T("screen", "shelf")], [0.3, 0.7], { id: "s1" }) } }, op: { op: "ungroup", tile: "shelf", tree: { t: "split", dir: "col", kids: [{ t: "leaf", id: "seeds" }, { t: "leaf", id: "log" }], weights: [0.6, 0.4], id: "s9" }, names: [["seeds", "seeds"], ["log", "beds"]], folds: [["log", { dir: "h" }]], agents: [["seeds", "edit"]], wires: [{ from: "seeds", verb: "open", to: "log" }] }, brings: { seeds: "query", log: "reader" } },
  { name: "ungroup: an agent never spills the group the person is in", scene: { layout: { focus: "shelf", root: row([T("tree", "beds"), T("screen", "shelf")], [0.3, 0.7], { id: "s1" }) } }, by: AGENT, op: { op: "ungroup", tile: "shelf", tree: { t: "leaf", id: "seeds" }, names: [["seeds", "seeds"]] }, brings: { seeds: "query" } },
  { name: "ungroup: an agent spills a group the person isn't in, one tile in its place", scene: { layout: { focus: "beds", root: row([T("tree", "beds"), T("screen", "shelf")], [0.3, 0.7], { id: "s1" }) } }, by: AGENT, op: { op: "ungroup", tile: "shelf", tree: { t: "leaf", id: "seeds" }, names: [["seeds", "beds"]] }, brings: { seeds: "query" } },
  { name: "ungroup: a tab stays a group", scene: { layout: { focus: "shelf", root: row([T("tree", "beds"), tabs([T("screen", "shelf"), T("reader", "bed")], 0, { id: "g2" })], [0.3, 0.7], { id: "s1" }) } }, op: { op: "ungroup", tile: "shelf", tree: { t: "split", dir: "col", kids: [{ t: "leaf", id: "seeds" }, { t: "leaf", id: "log" }], weights: [0.5, 0.5] }, names: [["seeds", "seeds"], ["log", "log"]] }, brings: { seeds: "query", log: "activity" } },

  // move, swap
  { name: "move: beside a tile along the row joins the row", scene: garden(), op: { op: "move", tile: "log", to: { kind: "split", target: "beds", dir: "right" } } },
  { name: "move: below a tile makes a column there", scene: garden(), op: { op: "move", tile: "beds", to: { kind: "split", target: "bed", dir: "down" } } },
  { name: "move: into a tile's tabs", scene: garden(), op: { op: "move", tile: "log", to: { kind: "tabs", target: "bed" } } },
  { name: "move: a tab out to the screen's left edge", scene: shed(), op: { op: "move", tile: "tools", to: { kind: "edge", dir: "left" } } },
  { name: "move: onto a spine opens it first", scene: garden({ log: { collapsed: "h" } }), op: { op: "move", tile: "beds", to: { kind: "tabs", target: "log" } } },
  { name: "move: a float lands in the layout", scene: withFloat(), op: { op: "move", tile: "trellis", to: { kind: "split", target: "bed", dir: "right" } } },
  { name: "move: into a shut dock opens it for the person", scene: greenhouse(), op: { op: "move", tile: "log", to: { kind: "tabs", target: "roots" } } },
  { name: "move: an agent's move into a shut dock leaves it shut", scene: greenhouse(), by: AGENT, op: { op: "move", tile: "log", to: { kind: "tabs", target: "roots" } } },
  { name: "move: where it is already is refused", scene: garden(), op: { op: "move", tile: "bed", to: { kind: "tabs", target: "bed" } } },
  { name: "move: the only tile can't go anywhere", scene: almanac(), op: { op: "move", tile: "almanac", to: { kind: "edge", dir: "left" } } },
  { name: "move: a container that keeps its tiles in place refuses", scene: plots({ lanes: { draggable: false }, tiles: { sown: { lists: true } } }), op: { op: "move", tile: "sown", to: { kind: "split", target: "tray", dir: "right" } } },
  { name: "move: a kind the target takes as tabs only", scene: garden({ tiles: { log: { tabs: ["activity"] } } }), op: { op: "move", tile: "bed", to: { kind: "tabs", target: "log" } } },
  { name: "move: an agent never moves the tile the person types in", scene: garden(), by: AGENT, person: typing("bed"), op: { op: "move", tile: "bed", to: { kind: "edge", dir: "right" } } },
  { name: "move: an agent's move leaves the person's keys where they are", scene: garden(), by: AGENT, op: { op: "move", tile: "log", to: { kind: "split", target: "beds", dir: "down" } } },
  { name: "move: an agent may not move a hands-off tile", scene: garden({ log: { agents: "off" } }), by: AGENT, op: { op: "move", tile: "log", to: { kind: "edge", dir: "left" } } },
  { name: "swap: two tiles trade places", scene: garden(), op: { op: "swap", tile: "beds", with: "log" } },
  { name: "swap: a tab with a tile outside its set", scene: shed(), op: { op: "swap", tile: "tools", with: "beds" } },
  { name: "swap: an agent swaps two tiles the person isn't typing in", scene: garden(), by: AGENT, op: { op: "swap", tile: "beds", with: "log" } },
  { name: "swap: an agent may not swap an edit-only tile", scene: garden({ log: { agents: "edit" } }), by: AGENT, op: { op: "swap", tile: "beds", with: "log" } },
  { name: "swap: a tile can't swap with itself", scene: garden(), op: { op: "swap", tile: "bed", with: "bed" } },
  { name: "swap: a float has no place to trade", scene: withFloat(), op: { op: "swap", tile: "trellis", with: "bed" } },
  { name: "swap: a spine swapped where it isn't side by side opens", scene: garden({ beds: { collapsed: true } }), op: { op: "swap", tile: "beds", with: "log" } },

  // float, place
  { name: "float: a tile pops out over the others", scene: garden(), op: { op: "float", tile: "log" } },
  { name: "float: a float goes back beside the tile with the keys", scene: withFloat(), op: { op: "float", tile: "trellis" } },
  { name: "float: a float lands where asked", scene: withFloat(), op: { op: "float", tile: "trellis", at: { kind: "tabs", target: "log" } } },
  { name: "float: a float finds another place when the first takes no drops", scene: withFloat({ side: { droppable: false }, focus: "seeds" }), op: { op: "float", tile: "trellis" } },
  { name: "float: a screen that takes no drops keeps it a float", scene: withFloat({ policy: { droppable: false } }), op: { op: "float", tile: "trellis" } },
  { name: "float: asked for a place that refuses, it says how to put it back", scene: withFloat({ side: { droppable: false } }), op: { op: "float", tile: "trellis", at: { kind: "split", target: "log", dir: "up" } } },
  { name: "float: the only tile has nothing to float over", scene: almanac(), op: { op: "float", tile: "almanac" } },
  { name: "float: an agent never floats the tile with the person's keys", scene: garden(), by: AGENT, op: { op: "float", tile: "bed" } },
  { name: "float: an agent floats another tile, the keys left alone", scene: garden(), by: AGENT, op: { op: "float", tile: "log" } },
  { name: "place: a float moves by cells and is sized", scene: withFloat(), op: { op: "place", tile: "trellis", dx: -10, dy: 4, cols: 50 } },
  { name: "place: the float on top, when none is named", scene: withFloat(), op: { op: "place", col: 300, row: 0 } },
  { name: "place: an agent moves a float the person isn't in", scene: withFloat(), by: AGENT, op: { op: "place", tile: "trellis", dx: 4 } },
  { name: "place: an agent never moves the float the person types in", scene: withFloat(), by: AGENT, person: typing("trellis"), op: { op: "place", tile: "trellis", dx: 4 } },
  { name: "place: a tile in the layout isn't a float", scene: garden(), op: { op: "place", tile: "log", dx: 2 } },
  { name: "place: a locked screen keeps its floats where they are", scene: withFloat({ policy: { locked: true } }), op: { op: "place", tile: "trellis", dx: 2 } },

  // pin, slide
  { name: "pin: a tile goes into a dock on the edge nearest it", scene: garden(), op: { op: "pin", tile: "beds" } },
  { name: "pin: into a dock on the edge asked for", scene: garden(), op: { op: "pin", tile: "log", edge: "down" } },
  { name: "pin: out of its dock, back in the layout", scene: greenhouse(), op: { op: "pin", tile: "beds", on: true } },
  { name: "pin: a dock moves to another edge", scene: greenhouse(), op: { op: "pin", tile: "beds", edge: "right" } },
  { name: "pin: a whole container goes into a dock", scene: garden(), op: { op: "pin", tile: "seeds", container: "s2", edge: "right" } },
  { name: "pin: a float goes into a dock in one step", scene: withFloat(), op: { op: "pin", tile: "trellis" } },
  { name: "pin: pinned already, nothing changes", scene: garden(), op: { op: "pin", tile: "bed", on: true } },
  { name: "pin: the last tile not docked stays", scene: { layout: { focus: "bed", root: row([dock(T("tree", "beds"), "left", true, { id: "d2" }), T("reader", "bed")], [0.3, 0.7], { id: "s1" }) } }, op: { op: "pin", tile: "bed" } },
  { name: "pin: an agent's dock starts shut", scene: garden(), by: AGENT, op: { op: "pin", tile: "log" } },
  { name: "pin: a locked screen refuses", scene: garden({ policy: { locked: true } }), op: { op: "pin", tile: "log" } },
  { name: "slide: a shut dock slides open, the keys into it", scene: greenhouse(), op: { op: "slide", tile: "roots" } },
  { name: "slide: an open dock slides shut, the keys to a tile that shows", scene: greenhouse({ focus: "beds" }), op: { op: "slide", tile: "beds" } },
  { name: "slide: shut, the keys go home", scene: greenhouse({ focus: "beds" }), ctx: { home: "log" }, op: { op: "slide", tile: "beds", open: false } },
  { name: "slide: by its container's id", scene: greenhouse(), op: { op: "slide", tile: "roots", container: "d4", open: true } },
  { name: "slide: a dock that isn't collapsible stays open", scene: greenhouse({ leftPolicy: { collapsible: false } }), op: { op: "slide", tile: "beds", open: false } },
  { name: "slide: a tile that isn't docked is refused", scene: greenhouse(), op: { op: "slide", tile: "bed" } },
  { name: "slide: the dock that is all the screen shows stays open", scene: { layout: { focus: "beds", root: row([dock(T("tree", "beds"), "left", true, { id: "d2" }), dock(T("reader", "bed"), "right", false, { id: "d3" })], [0.5, 0.5], { id: "s1", key: "all" }) } }, op: { op: "slide", tile: "beds", open: false } },
  { name: "slide: an agent doesn't shut the dock the person is busy in", scene: greenhouse({ focus: "beds" }), by: AGENT, person: { focus: "beds", busy: true }, op: { op: "slide", tile: "beds", open: false } },
  { name: "slide: an agent opens a dock, the keys left where they are", scene: greenhouse(), by: AGENT, op: { op: "slide", tile: "roots", open: true } },
  { name: "slide: the host layer stays put away on a full-screen screen", scene: { layout: { focus: "bed", root: row([T("reader", "bed"), dock(T("pty", "screen"), "right", false, { id: "d2" })], [0.7, 0.3], { id: "s1" }) } }, ctx: { screenHost: "none" }, op: { op: "slide", tile: "screen", open: true } },

  // collapse, room, alt.hold
  { name: "collapse: a tile in a row folds to a vertical spine", scene: garden(), person: { focus: "bed" }, op: { op: "collapse", tile: "beds" } },
  { name: "collapse: a tile in a column folds to a horizontal spine", scene: garden(), op: { op: "collapse", tile: "log" } },
  { name: "collapse: a spine opens, the row shared afresh", scene: garden({ beds: { collapsed: true } }), op: { op: "collapse", tile: "beds" } },
  { name: "collapse: open already, nothing changes", scene: garden(), op: { op: "collapse", tile: "beds", on: false } },
  { name: "collapse: a vertical spine needs a tile beside it", scene: garden(), op: { op: "collapse", tile: "log", dir: "v" } },
  { name: "collapse: a tab set folds as one", scene: shed(), person: { focus: "beds" }, op: { op: "collapse", tile: "tools", on: true } },
  { name: "collapse: a flow's column folds, the wide place passed on", scene: stream(), person: { focus: "mouth" }, op: { op: "collapse", tile: "bend", on: true } },
  { name: "collapse: a tile that doesn't fold says whose rule it is", scene: garden({ policy: { collapsible: false } }), op: { op: "collapse", tile: "beds", on: true } },
  { name: "collapse: a float is no spine", scene: withFloat(), op: { op: "collapse", tile: "trellis", on: true } },
  { name: "collapse: an agent never folds the tile with the person's keys", scene: garden(), by: AGENT, op: { op: "collapse", tile: "bed", on: true } },
  { name: "collapse: an agent's fold says who folded it", scene: garden(), by: AGENT, op: { op: "collapse", tile: "beds", on: true } },
  { name: "collapse: with a least width, opening a spine folds another tile so the open ones stay that wide", scene: garden({ policy: { "min-width": 60 }, beds: { collapsed: true } }), area: { col: 0, row: 0, cols: 120, rows: 40 }, op: { op: "collapse", tile: "beds", on: false } },
  { name: "room: an arrival in a flow takes the wide place", scene: stream(), op: { op: "room", tile: "mouth" } },
  { name: "room: an agent's arrival takes the wide place too", scene: stream(), by: AGENT, op: { op: "room", tile: "mouth" } },
  { name: "room: a tile that isn't there is refused", scene: stream(), op: { op: "room", tile: "delta" } },
  { name: "room: an ordinary split keeps its shape", scene: garden(), op: { op: "room", tile: "log" } },
  { name: "alt.hold: an alt-opened reader is held out of the pile, its spine opened", scene: garden({ log: { altReader: true, collapsed: "h" } }), op: { op: "alt.hold", tile: "log" } },
  { name: "alt.hold: a locked screen keeps the pile as it is", scene: garden({ policy: { locked: true }, log: { altReader: true } }), op: { op: "alt.hold", tile: "log" } },
  { name: "alt.hold: an agent may not hold a hands-off tile", scene: garden({ log: { altReader: true, agents: "off" } }), by: AGENT, op: { op: "alt.hold", tile: "log" } },
  { name: "alt.hold: an agent holds a tile it may touch", scene: garden({ log: { altReader: true } }), by: AGENT, op: { op: "alt.hold", tile: "log" } },

  // resize, shares, grow, even, gather
  { name: "resize: a border by its split's id", scene: garden(), op: { op: "resize", split: "s1", border: 0, share: 0.4 } },
  { name: "resize: a border by its split's path", scene: garden(), op: { op: "resize", path: "2", border: 0, share: 0.25 } },
  { name: "resize: a share is kept between 8 and 92 percent", scene: garden(), op: { op: "resize", split: "s2", border: 0, share: 0.99 } },
  { name: "resize: a border beside a dock that slides over sizes the dock alone", scene: greenhouse(), op: { op: "resize", split: "s1", border: 0, share: 0.5 } },
  { name: "resize: a split names one of id or path", scene: garden(), op: { op: "resize", border: 0, share: 0.4 } },
  { name: "resize: a split that is gone is refused", scene: garden(), op: { op: "resize", split: "s7", border: 0, share: 0.4 } },
  { name: "resize: a border the split hasn't is refused", scene: garden(), op: { op: "resize", split: "s2", border: 1, share: 0.4 } },
  { name: "resize: a container that keeps its sizes refuses", scene: garden({ policy: { resizable: false } }), op: { op: "resize", split: "s1", border: 0, share: 0.4 } },
  { name: "resize: a kid fixed in cells keeps its size", scene: { layout: { focus: "bed", root: row([T("tree", "beds"), T("reader", "bed"), tabs([T("activity", "log"), T("who", "callers")], 0, { id: "g2", policy: { fixed: 30 } })], [0.2, 0.6, 0.2], { id: "s1" }) } }, op: { op: "resize", split: "s1", border: 1, share: 0.5 } },
  { name: "resize: a flow sizes its columns itself", scene: stream(), op: { op: "resize", split: "f1", border: 0, share: 0.5 } },
  { name: "resize: an agent never resizes the tile the person types in", scene: garden(), by: AGENT, person: typing("bed"), op: { op: "resize", split: "s1", border: 0, share: 0.4 } },
  { name: "resize: an agent resizes around a hands-off tile's neighbours only", scene: garden({ beds: { agents: "off" } }), by: AGENT, op: { op: "resize", split: "s1", border: 0, share: 0.4 } },
  { name: "shares: every share of a split at once", scene: garden(), op: { op: "shares", split: "s1", shares: [1, 2, 1] } },
  { name: "shares: an agent's shares never resize the tile the person types in", scene: garden(), by: AGENT, person: typing("bed"), op: { op: "shares", split: "s1", shares: [1, 1, 1] } },
  { name: "shares: an agent's shares that leave the typed-in tile its size are taken", scene: garden(), by: AGENT, person: typing("bed"), op: { op: "shares", split: "s2", shares: [1, 1] } },
  { name: "shares: one number for each kid", scene: garden(), op: { op: "shares", split: "s1", shares: [1, 2] } },
  { name: "grow: a tile takes a twentieth more of its row", scene: garden(), op: { op: "grow", tile: "bed", axis: "row", by: 1 } },
  { name: "grow: a tile shrinks in its column", scene: garden(), op: { op: "grow", tile: "log", axis: "col", by: -2 } },
  { name: "grow: an agent grows a tile beside the one the person is in, when they aren't typing", scene: garden(), by: AGENT, op: { op: "grow", tile: "log", axis: "col", by: 1 } },
  { name: "grow: an agent may not resize a hands-off tile", scene: garden({ log: { agents: "off" } }), by: AGENT, op: { op: "grow", tile: "log", axis: "col", by: 1 } },
  { name: "grow: with no border on that axis it is refused", scene: garden(), op: { op: "grow", tile: "bed", axis: "col", by: 1 } },
  { name: "even: every split shares its room equally", scene: garden(), op: { op: "even" } },
  { name: "even: a locked screen refuses", scene: garden({ policy: { locked: true } }), op: { op: "even" } },
  { name: "even: an agent doesn't even out a layout with a hands-off tile", scene: garden({ log: { agents: "off" } }), by: AGENT, op: { op: "even" } },
  { name: "gather: a row's spines go to its left", scene: garden({ log: {}, bed: { collapsed: true } }), person: { focus: "beds" }, op: { op: "gather", tile: "beds", side: "left" } },
  { name: "gather: a row's spines go to its right", scene: garden({ beds: { collapsed: true } }), op: { op: "gather", tile: "bed", side: "right" } },
  { name: "gather: spines to the centre, around the open tiles", scene: garden({ beds: { collapsed: true } }), op: { op: "gather", tile: "bed", side: "centre" } },
  { name: "gather: spines to the sides they are nearest", scene: garden({ beds: { collapsed: true } }), op: { op: "gather", tile: "bed", side: "sides" } },
  { name: "gather: a flow keeps the side as its policy", scene: stream(), op: { op: "gather", tile: "bend", side: "left" } },
  { name: "gather: an agent gathers a row's spines", scene: garden({ beds: { collapsed: true } }), by: AGENT, op: { op: "gather", tile: "bed", side: "right" } },
  { name: "gather: an agent may not gather a row with an edit-only tile in it", scene: garden({ beds: { collapsed: true, agents: "edit" } }), by: AGENT, op: { op: "gather", tile: "bed", side: "right" } },
  { name: "gather: a column has no row to gather in", scene: garden(), op: { op: "gather", tile: "log", side: "left" } },

  // lock, agents, policy
  { name: "lock: the person locks the screen", scene: garden(), op: { op: "lock", on: true } },
  { name: "lock: the person unlocks it", scene: garden({ policy: { locked: true } }), op: { op: "lock" } },
  { name: "lock: locked already, nothing changes", scene: garden({ policy: { locked: true } }), op: { op: "lock", on: true } },
  { name: "lock: an agent's lock is its own to undo", scene: garden(), by: AGENT, op: { op: "lock", on: true } },
  { name: "lock: an agent doesn't unlock the person's lock", scene: garden({ policy: { locked: true } }), by: AGENT, op: { op: "lock", on: false } },
  { name: "lock: an agent undoes a lock an agent set", scene: garden(), setup: [{ by: AGENT, op: { op: "lock", on: true } }], by: AGENT, op: { op: "lock", on: false } },
  { name: "lock: the layout keeps that an agent locked it, not which: another agent undoes it too", scene: garden(), setup: [{ by: AGENT, op: { op: "lock", on: true } }], by: HELPER, op: { op: "lock", on: false } },
  { name: "lock: the person undoes an agent's lock, and it is theirs no more", scene: garden(), setup: [{ by: AGENT, op: { op: "lock", on: true } }], op: { op: "lock", on: false } },
  { name: "agents: a tile is set edit-only for agents", scene: garden(), op: { op: "agents", tile: "bed", level: "edit" } },
  { name: "agents: a tile's own level is taken away, the screen's says again", scene: garden({ policy: { agents: "off" }, bed: { agents: "free" } }), op: { op: "agents", tile: "bed", level: null } },
  { name: "agents: the level it has already changes nothing", scene: garden({ bed: { agents: "edit" } }), op: { op: "agents", tile: "bed", level: "edit" } },
  { name: "agents: an agent may tighten a tile's level", scene: garden(), by: AGENT, op: { op: "agents", tile: "log", level: "off" } },
  { name: "agents: an agent never loosens a tile's level", scene: garden({ log: { agents: "off" } }), by: AGENT, op: { op: "agents", tile: "log", level: "free" } },
  { name: "policy: the screen's own policy is set", scene: garden(), op: { op: "policy", node: "screen", set: { gap: 2, inset: 1, opens: "beside", altOpens: "tab", host: "beside", spines: "end", readable: 60 }, clear: [] } },
  { name: "policy: a container's, by its id", scene: garden(), op: { op: "policy", node: "s2", set: { draggable: false, droppable: false, resizable: false, min: 20, max: 60 }, clear: [] } },
  { name: "policy: the container around a tile", scene: shed(), op: { op: "policy", tile: "tools", set: { closable: false, accepts: ["reader", "pty"], stays: true, shuts: true, overlay: false, collapsible: false }, clear: [] } },
  { name: "policy: a field is cleared, an empty policy goes", scene: plots(), op: { op: "policy", node: "c2", set: {}, clear: ["accepts", "closable"] } },
  { name: "policy: opens land in a tile that takes notes", scene: garden(), op: { op: "policy", node: "screen", set: { opensInto: "bed" }, clear: [] } },
  { name: "policy: opens can't land in a list", scene: garden(), op: { op: "policy", node: "screen", set: { opensInto: "seeds" }, clear: [] } },
  { name: "policy: opens can't land in a tile that isn't there", scene: garden(), op: { op: "policy", node: "screen", set: { opensInto: "orchard" }, clear: [] } },
  { name: "policy: accepts names tile kinds", scene: garden(), op: { op: "policy", node: "s2", set: { accepts: ["scarecrow"] }, clear: [] } },
  { name: "policy: clear names a policy's fields", scene: garden(), op: { op: "policy", node: "s2", set: {}, clear: ["colour"] } },
  { name: "policy: a container that isn't there is refused", scene: garden(), op: { op: "policy", node: "s9", set: { locked: true }, clear: [] } },
  { name: "policy: a container is locked, and only its lock changes while it is", scene: garden(), op: { op: "policy", node: "s2", set: { locked: true }, clear: [] } },
  { name: "policy: a locked container refuses any other change", scene: garden({ side: { locked: true } }), op: { op: "policy", node: "s2", set: { draggable: false }, clear: [] } },
  { name: "policy: an agent tightens the screen's default for agents", scene: garden(), by: AGENT, op: { op: "policy", node: "screen", set: { agents: "edit" }, clear: [] } },
  { name: "policy: an agent never loosens a default", scene: garden({ policy: { agents: "off" } }), by: AGENT, op: { op: "policy", node: "screen", set: {}, clear: ["agents"] } },
  { name: "policy: an agent doesn't unlock a container the person locked", scene: garden({ side: { locked: true } }), by: AGENT, op: { op: "policy", node: "s2", set: { locked: false }, clear: [] } },

  // link, opened
  { name: "link: a tile's opens land in another", scene: garden(), op: { op: "link", tile: "seeds", to: "bed" } },
  { name: "link: its selection feeds a tile too", scene: garden(), op: { op: "link", tile: "beds", to: "bed", verb: "select" } },
  { name: "link: an alt-open with a rule of its own", scene: garden(), op: { op: "link", tile: "seeds", to: "bed", verb: "alt", rule: "tab" } },
  { name: "link: a hover wire", scene: garden(), op: { op: "link", tile: "seeds", to: "bed", verb: "hover" } },
  { name: "link: an open wired to itself opens in place", scene: garden(), op: { op: "link", tile: "seeds", to: "seeds" } },
  { name: "link: a selection can't feed its own tile", scene: garden(), op: { op: "link", tile: "seeds", to: "seeds", verb: "select" } },
  { name: "link: opens land in a tile that takes notes", scene: garden(), op: { op: "link", tile: "seeds", to: "log" } },
  { name: "link: a wire is taken away", scene: garden({ seeds: { wires: [{ verb: "open", to: "bed" }, { verb: "select", to: "bed" }] } }), op: { op: "link", tile: "seeds", verb: "open" } },
  { name: "link: one of a selection's wires is taken away", scene: garden({ beds: { wires: [{ verb: "select", to: "bed" }] } }), op: { op: "link", tile: "beds", to: "bed", verb: "select", remove: true } },
  { name: "link: to a tile on another screen, by its path", scene: garden(), op: { op: "link", tile: "seeds", across: "nursery/reader", rule: "beside" } },
  { name: "link: a locked screen keeps its wires", scene: garden({ policy: { locked: true } }), op: { op: "link", tile: "seeds", to: "bed" } },
  { name: "link: an agent may not retarget an edit-only tile", scene: garden({ seeds: { agents: "edit" } }), by: AGENT, op: { op: "link", tile: "seeds", to: "bed" } },
  { name: "opened: the tile a tile was opened from is kept, for the keys to go back", scene: garden(), op: { op: "opened", tile: "log", from: "bed", typing: true } },
  { name: "opened: an opener that isn't there is refused", scene: garden(), op: { op: "opened", tile: "log", from: "orchard" } },

  // focus, reveal, tab, zoom
  { name: "focus: the person's keys move to a tile", scene: garden(), op: { op: "focus", tile: "seeds" } },
  { name: "focus: a tab behind another comes to the front", scene: shed(), op: { op: "focus", tile: "hose" } },
  { name: "focus: a tile in a shut dock slides it open", scene: greenhouse(), op: { op: "focus", tile: "roots" } },
  { name: "focus: quietly, a shut dock stays shut", scene: greenhouse(), op: { op: "focus", tile: "roots", quiet: true } },
  { name: "focus: a float comes to the top", scene: withFloat({ floats: [TRELLIS, { tile: T("reader", "arbour"), rect: { col: 50, row: 8, cols: 64, rows: 20 } }] }), op: { op: "focus", tile: "trellis" } },
  { name: "focus: a zoom follows the keys", scene: garden(), setup: [{ op: { op: "zoom", tile: "bed" } }], op: { op: "focus", tile: "seeds" } },
  { name: "focus: in a flow, a column off the strip comes on", scene: stream({ extra: [T("reader", "delta"), T("reader", "estuary"), T("reader", "reef")] }), area: { col: 0, row: 0, cols: 90, rows: 40 }, op: { op: "focus", tile: "reef" } },
  { name: "focus: an agent doesn't move the person's keys while they are busy", scene: garden(), by: AGENT, person: { focus: "bed", busy: true }, op: { op: "focus", tile: "seeds" } },
  { name: "focus: an agent's focus moves the keys when the person is idle", scene: garden(), by: AGENT, op: { op: "focus", tile: "seeds" } },
  { name: "reveal: a tile is shown where it is, the keys left alone", scene: shed(), person: { focus: "beds" }, op: { op: "reveal", tile: "tools" } },
  { name: "reveal: a spine opens", scene: garden({ beds: { collapsed: true } }), op: { op: "reveal", tile: "beds" } },
  { name: "reveal: a tile that isn't there is refused", scene: garden(), op: { op: "reveal", tile: "orchard" } },
  { name: "reveal: an agent's never hides the tab the person has", scene: shed(), by: AGENT, op: { op: "reveal", tile: "tools" } },
  { name: "tab: the next tab, the keys with it", scene: shed(), op: { op: "tab", tile: "bed", by: 1 } },
  { name: "tab: the tab before, around the end", scene: shed(), op: { op: "tab", tile: "bed", by: -1 } },
  { name: "tab: a tab by its tile", scene: shed(), person: { focus: "beds" }, op: { op: "tab", tile: "hose" } },
  { name: "tab: a tile that isn't in a tab set", scene: garden(), op: { op: "tab", tile: "bed", by: 1 } },
  { name: "tab: an agent doesn't hide the tab the person has", scene: shed(), by: AGENT, op: { op: "tab", tile: "tools" } },
  { name: "tab: an agent switches a tab set the person isn't in", scene: shed(), by: AGENT, person: { focus: "beds" }, op: { op: "tab", tile: "tools" } },
  { name: "zoom: a tile fills the screen, the keys in it", scene: garden(), op: { op: "zoom", tile: "seeds" } },
  { name: "zoom: zoomed out again", scene: garden(), setup: [{ op: { op: "zoom", tile: "bed" } }], op: { op: "zoom", tile: "bed" } },
  { name: "zoom: not zoomed, nothing changes", scene: garden(), op: { op: "zoom", tile: "bed", on: false } },
  { name: "zoom: a lift is dropped", scene: garden(), setup: [{ op: { op: "zoom", tile: "log", reach: "column" } }], op: { op: "zoom", tile: "log", reach: "column" } },
  { name: "zoom: the person's lift stays up until they drop it; an agent's is refused", scene: garden(), setup: [{ op: { op: "zoom", tile: "log", reach: "column" } }], by: AGENT, op: { op: "zoom", tile: "seeds", reach: "full" } },
  { name: "zoom: the person's own focus elsewhere drops their lift", scene: garden(), setup: [{ op: { op: "zoom", tile: "log", reach: "column" } }], op: { op: "focus", tile: "seeds" } },
  { name: "zoom: a lift over its column leaves the layout as it is", scene: garden(), op: { op: "zoom", tile: "log", reach: "column" } },
  { name: "zoom: a lifted tab comes to the front of its set", scene: shed(), op: { op: "zoom", tile: "tools", reach: "full" } },
  { name: "zoom: a spine opens to be zoomed", scene: garden({ beds: { collapsed: true } }), op: { op: "zoom", tile: "beds" } },
  { name: "zoom: an agent's zoom would hide the tile with the person's keys", scene: garden(), by: AGENT, op: { op: "zoom", tile: "seeds" } },
  { name: "zoom: an agent's lift leaves the keys where they are", scene: garden(), by: AGENT, op: { op: "zoom", tile: "log", reach: "full" } },
  { name: "zoom: an agent's lift never hides the tab the person has", scene: shed(), by: AGENT, op: { op: "zoom", tile: "tools", reach: "column" } },

  // load, fill, source
  { name: "load: the screen may be laid out again", scene: garden(), op: { op: "load", name: "potting" } },
  { name: "load: a locked screen keeps its shape", scene: garden({ policy: { locked: true } }), op: { op: "load", name: "potting" } },
  { name: "load: an agent doesn't lay the desk out under a busy person", scene: garden(), by: AGENT, person: { focus: "bed", busy: true }, op: { op: "load", name: "potting" } },
  { name: "load: an agent doesn't undo a container the person locked", scene: garden({ side: { locked: true } }), by: AGENT, op: { op: "load", name: "potting" } },
  { name: "fill: columns take their source's order, a new lane, and drop one it no longer names", scene: plots(), op: { op: "fill", container: "c2", order: ["picked", "ripening", "sown"], fresh: [{ id: "ripening", kind: "query", name: "ripening" }], drop: ["sprouting"], weights: [["picked", 2]], select: ["card"] } },
  { name: "fill: a lane takes its source's name back when that is free", scene: plots(), op: { op: "fill", container: "c2", order: ["sown", "sprouting", "picked"], names: [["sown", "seeded"], ["picked", "sprouting"]] } },
  { name: "fill: only columns are filled", scene: garden(), op: { op: "fill", container: "s2", order: ["seeds"] } },
  { name: "fill: an agent changes the source's data instead", scene: plots(), by: AGENT, op: { op: "fill", container: "c2", order: ["sown"] } },
  { name: "source: columns are told where their tiles come from", scene: plots(), op: { op: "source", container: "c2", source: "hub:orchard" } },
  { name: "source: an agent doesn't change a screen's source", scene: plots(), by: AGENT, op: { op: "source", container: "c2", source: "hub:orchard" } },

  // flow.widen, flow.travel, flow.hold
  { name: "flow.widen: a column takes the wide place, the keys left where they are", scene: stream(), op: { op: "flow.widen", tile: "mouth" } },
  { name: "flow.widen: the wide column already, nothing changes", scene: stream(), op: { op: "flow.widen", tile: "bend" } },
  { name: "flow.widen: a tile that isn't in a flow", scene: garden(), op: { op: "flow.widen", tile: "bed" } },
  { name: "flow.widen: a locked flow keeps its wide column", scene: stream({ flowPolicy: { locked: true } }), op: { op: "flow.widen", tile: "mouth" } },
  { name: "flow.widen: an agent doesn't squeeze the column the person types in", scene: stream(), by: AGENT, person: typing("bend"), op: { op: "flow.widen", tile: "mouth" } },
  { name: "flow.travel: back to the column this one was opened from", scene: stream({ memory: { anchor: 2, trail: [{ col: 2, from: 1 }] }, focus: "mouth" }), op: { op: "flow.travel", tile: "mouth", dir: -1 } },
  { name: "flow.travel: forward again", scene: stream({ memory: { anchor: 1, trail: [{ col: 2, from: 1 }, { col: 1, ahead: 2 }] } }), op: { op: "flow.travel", tile: "bend", dir: 1 } },
  { name: "flow.travel: nothing to go back to", scene: stream(), op: { op: "flow.travel", tile: "bend", dir: -1 } },
  { name: "flow.travel: the person's keys only", scene: stream({ memory: { anchor: 2, trail: [{ col: 2, from: 1 }] } }), by: AGENT, op: { op: "flow.travel", tile: "mouth", dir: -1 } },
  { name: "flow.hold: a column is held: it resists the squeeze", scene: stream(), op: { op: "flow.hold", tile: "mouth" } },
  { name: "flow.hold: a locked flow holds nothing new", scene: stream({ flowPolicy: { locked: true } }), op: { op: "flow.hold", tile: "mouth" } },
  { name: "flow.hold: an agent holds a column", scene: stream(), by: AGENT, op: { op: "flow.hold", tile: "mouth", on: true } },
  { name: "flow.hold: an agent may not hold a hands-off column", scene: stream({ mouth: { agents: "off" } }), by: AGENT, op: { op: "flow.hold", tile: "mouth", on: true } },
  { name: "flow.hold: a held column is let go", scene: stream({ memory: { held: [2] } }), op: { op: "flow.hold", tile: "mouth", on: false } },

  // rename, names, remember
  { name: "rename: a tile takes a new name, the open rule that names it following", scene: garden({ policy: { opensInto: "bed" } }), op: { op: "rename", tile: "bed", name: "north" } },
  { name: "rename: the name it has changes nothing", scene: garden(), op: { op: "rename", tile: "bed", name: "bed" } },
  { name: "rename: a name another tile has is refused, with a free one", scene: garden(), op: { op: "rename", tile: "bed", name: "log" } },
  { name: "rename: a container's key is no name for a tile", scene: plots(), op: { op: "rename", tile: "tray", name: "lanes" } },
  { name: "rename: an agent may not rename a hands-off tile", scene: garden({ log: { agents: "off" } }), by: AGENT, op: { op: "rename", tile: "log", name: "ledger" } },
  { name: "names: a name the other layer holds gives way here", scene: garden(), ctx: { otherNames: ["log", "bed"] }, op: { op: "names" } },
  { name: "names: with none taken, nothing changes", scene: garden(), op: { op: "names" } },
  { name: "remember: a dock's policy is kept for when it is docked again", scene: garden(), op: { op: "remember", key: "tbeds", policy: { overlay: false, collapsible: true, stray: 1 } as Policy } },

  // the same garden, each actor
  { name: "yolo: an agent the person handed the door closes the tile with their keys", scene: garden(), by: AGENT, person: { yolo: true }, op: { op: "close", tile: "bed" } },
  { name: "yolo: no lock holds an agent the person handed the door", scene: garden({ side: { locked: true } }), by: AGENT, person: { yolo: true }, op: { op: "move", tile: "log", to: { kind: "edge", dir: "left" } } },
  { name: "yolo: a hands-off tile's limit is lifted too", scene: garden({ log: { agents: "off" } }), by: AGENT, person: { yolo: true }, op: { op: "close", tile: "log" } },
  { name: "an agent's container lock is an agent's to undo", scene: garden(), setup: [{ by: AGENT, op: { op: "policy", node: "s2", set: { locked: true }, clear: [] } }], by: HELPER, op: { op: "policy", node: "s2", set: {}, clear: ["locked"] } },
  { name: "pin: a dock taken out and put back slides as it did", scene: greenhouse({ leftPolicy: { overlay: false, stays: true } }), setup: [{ op: { op: "pin", tile: "beds", on: true } }], op: { op: "pin", tile: "beds", on: false } },
  { name: "slide: a second tile of a dock is shown beside the first", scene: { layout: { focus: "bed", root: row([dock(col([T("tree", "beds"), T("query", "seeds")], undefined, { id: "s3" }), "left", false, { id: "d2" }), T("reader", "bed")], [0.3, 0.7], { id: "s1" }) } }, setup: [{ op: { op: "slide", tile: "beds", open: true } }], op: { op: "slide", tile: "seeds", open: true, beside: true } },
  { name: "slide: opening a dock shuts another on its edge", scene: { layout: { focus: "bed", root: row([dock(T("tree", "beds"), "left", true, { id: "d2" }), dock(T("query", "seeds"), "left", false, { id: "d3" }), T("reader", "bed")], [0.2, 0.2, 0.6], { id: "s1" }) } }, op: { op: "slide", tile: "seeds", open: true } },
];

// ── where an open lands ──

export const PLACE_CASES: PlaceCase[] = [
  // the order: its own wire, the container's opens-into, its home, the open rule, the first reader not pinned
  { name: "its own wire wins: a list's open lands in the tile it is wired to", scene: garden({ seeds: { wires: [{ verb: "open", to: "bed" }] }, policy: { opensInto: "log" } }), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed" } },
  { name: "the screen's opens-into names a tile", scene: { layout: { focus: "beds", policy: { opensInto: "detail" }, root: row([T("tree", "beds"), T("reader", "bed"), T("reader", "detail")], undefined, { id: "s1" }) }, tiles: { beds: { lists: true }, bed: { showing: "north-bed" } } }, request: { from: "beds", note: "south-bed" } },
  { name: "the nearest container's opens-into wins over the screen's", scene: { layout: { focus: "seeds", policy: { opensInto: "bed" }, root: row([T("reader", "bed"), col([T("query", "seeds"), T("reader", "detail")], undefined, { id: "s2", policy: { opensInto: "detail" } })], undefined, { id: "s1" }) }, tiles: { seeds: { lists: true } } }, request: { from: "seeds", note: "south-bed" } },
  { name: "opens-into a container by its key: the reader there takes it", scene: plots(), request: { from: "sown", note: "tray-9" } },
  { name: "opens-into a container with no reader: a new one opens in it", scene: plots({ readers: [T("preview", "card", { source: "tile:lanes" })] }), request: { from: "sown", note: "tray-9" } },
  { name: "opens-into a container: the reader last opened there takes the next", scene: plots({ readers: [T("preview", "card", { source: "tile:lanes" }), T("reader", "tray"), T("reader", "tray2")], tiles: { tray2: { showing: "tray-8" } } }), ctx: { opened: { readers: { ids: ["tray", "tray2"], active: "tray2" } } }, request: { from: "sown", note: "tray-9" } },
  { name: "opens-into a flow by its key: the next column after its last", scene: { layout: { focus: "beds", policy: { opensInto: "stream" }, root: row([T("tree", "beds"), flow([T("reader", "bend"), T("reader", "mouth")], { id: "f2", key: "stream", anchor: 0 })], [0.3, 0.7], { id: "s1" }) }, tiles: { beds: { lists: true }, bend: { showing: "bend-note" }, mouth: { showing: "mouth-note" } } }, request: { from: "beds", note: "south-bed" } },
  { name: "opens-into a container that is gone: the person's open finds a reader, and says so", scene: garden(), person: { focus: "beds" }, request: { from: "beds", note: "south-bed", container: "readers" } },
  { name: "opens-into a container that is gone: an agent's lands nowhere", scene: garden(), by: AGENT, request: { from: "beds", note: "south-bed", container: "readers" } },
  { name: "a list's home: the reader it belongs to", scene: greenhouse({ right: true, focus: "roots" }), request: { from: "roots", note: "south-bed" } },
  { name: "a home on another screen, by its path", scene: garden({ tiles: { seeds: { lists: true, home: "nursery/reader" } } }), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed" } },
  { name: "the open rule next: a new column after its own in its flow", scene: stream({ flowPolicy: { opens: "next" } }), request: { from: "bend", note: "delta-note" } },
  { name: "the open rule next: a column already showing the note is gone to", scene: stream({ flowPolicy: { opens: "next" } }), request: { from: "bend", note: "mouth-note" } },
  { name: "the open rule next, as a layout's rule", scene: { layout: { ...stream().layout, rule: "next" }, tiles: stream().tiles }, request: { from: "mouth", note: "delta-note" } },
  { name: "the open rule beside: a reader beside the tile, which keeps its note", scene: { layout: { focus: "almanac", policy: { opens: "beside" }, root: T("reader", "almanac") }, tiles: { almanac: { showing: "almanac-june" } } }, request: { from: "almanac", note: "frost-dates" } },
  { name: "the open rule beside: the reader opened beside it last takes the next", scene: { layout: { focus: "almanac", policy: { opens: "beside" }, root: row([T("reader", "almanac"), T("reader", "page")], undefined, { id: "s1" }) }, tiles: { almanac: { showing: "almanac-june" }, page: { showing: "frost-dates" } } }, ctx: { beside: { almanac: "page" } }, request: { from: "almanac", note: "rain-gauge" } },
  { name: "the open rule float: a follower floating over the tile", scene: garden({ policy: { opens: "float" } }), person: { focus: "beds" }, request: { from: "beds", note: "south-bed" } },
  { name: "the open rule float: the peek it owns takes the next", scene: garden({ policy: { opens: "float" }, floats: [{ tile: T("reader", "glance"), rect: { col: 60, row: 4, cols: 64, rows: 20 }, peekOf: "beds" }], tiles: { glance: { showing: "west-bed" } } }), person: { focus: "beds" }, request: { from: "beds", note: "south-bed" } },
  { name: "the open rule float: an agent's opens a float of its own", scene: garden({ policy: { opens: "float" }, floats: [{ tile: T("reader", "glance"), rect: { col: 60, row: 4, cols: 64, rows: 20 }, peekOf: "beds" }], tiles: { glance: { showing: "west-bed" } } }), by: AGENT, request: { from: "beds", note: "south-bed" } },
  { name: "the open rule full: the opened reader zoomed", scene: garden({ policy: { opens: "full" } }), request: { from: "bed", note: "south-bed" } },
  { name: "the open rule self: in place, the list showing the note", scene: garden({ policy: { opens: "self" } }), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed" } },
  { name: "the open rule reader: the first reader that isn't pinned", scene: { layout: { focus: "beds", root: row([T("tree", "beds"), T("reader", "pinboard", { mode: "pinned" }), T("reader", "bed")], undefined, { id: "s1" }) }, tiles: { beds: { lists: true }, pinboard: { showing: "watering-rota", pinned: true }, bed: { showing: "north-bed" } } }, request: { from: "beds", note: "south-bed" } },
  { name: "a reader is its own home: the note replaces its own", scene: garden(), request: { from: "bed", note: "south-bed" } },
  { name: "a preferred place from the list's row: beside", scene: garden(), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed", where: "beside" } },
  { name: "a preferred place from the list's row: a float", scene: garden(), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed", where: "float" } },
  { name: "a preferred place from the list's row: full, the list itself zoomed on the note", scene: garden(), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed", where: "full" } },
  { name: "a preferred place from the list's row: in place", scene: garden(), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed", where: "current" } },

  // pinned, held and busy readers
  { name: "a pinned reader keeps its note: the open lands beside it, and says how to unpin", scene: { layout: { focus: "pinboard", root: row([T("tree", "beds"), T("reader", "pinboard", { mode: "pinned" })], [0.3, 0.7], { id: "s1" }) }, tiles: { beds: { lists: true }, pinboard: { showing: "watering-rota", pinned: true } } }, request: { from: "pinboard", note: "south-bed" } },
  { name: "a pinned reader: an idle reader takes the open before a new one is made", scene: { layout: { focus: "pinboard", root: row([T("reader", "pinboard", { mode: "pinned" }), T("reader", "spare")], undefined, { id: "s1" }) }, tiles: { pinboard: { showing: "watering-rota", pinned: true }, spare: { held: true } } }, request: { from: "pinboard", note: "south-bed", to: "pinboard" } },
  { name: "a pinned reader: the reader opened beside it last takes the next", scene: { layout: { focus: "pinboard", root: row([T("reader", "pinboard", { mode: "pinned" }), T("reader", "page")], undefined, { id: "s1" }) }, tiles: { pinboard: { showing: "watering-rota", pinned: true }, page: { showing: "south-bed" } } }, ctx: { beside: { pinboard: "page" } }, request: { from: "pinboard", note: "west-bed" } },
  { name: "a pinned float: a float near it takes the open", scene: garden({ floats: [{ tile: T("reader", "pinboard", { mode: "pinned" }), rect: { col: 60, row: 4, cols: 64, rows: 20 } }], tiles: { pinboard: { showing: "watering-rota", pinned: true } } }), person: { focus: "pinboard" }, request: { from: "pinboard", note: "south-bed" } },
  { name: "a held reader aimed at: its old note stays as a spine beside it", scene: garden({ tiles: { bed: { showing: "north-bed", held: true } } }), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed", to: "bed" } },
  { name: "a held reader with no room for a spine: the note replaces, a step back", scene: garden({ tiles: { bed: { showing: "north-bed", held: true } } }), person: { focus: "seeds" }, area: { col: 0, row: 0, cols: 40, rows: 20 }, request: { from: "seeds", note: "south-bed", to: "bed" } },
  { name: "a held reader, only asked where: the spine isn't measured", scene: garden({ tiles: { bed: { showing: "north-bed", held: true } } }), person: { focus: "seeds" }, area: { col: 0, row: 0, cols: 40, rows: 20 }, request: { from: "seeds", note: "south-bed", to: "bed", inspect: true } },
  { name: "an open naming no tile replaces a held reader's note, no spine", scene: garden({ tiles: { bed: { showing: "north-bed", held: true } } }), person: { focus: "beds" }, request: { from: "beds", note: "south-bed", default: true } },
  { name: "keep off: the open replaces even a held reader's note", scene: garden({ tiles: { bed: { showing: "north-bed", held: true } } }), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed", to: "bed", keep: false } },
  { name: "a reader holding an edit: the person's open lands beside it", scene: garden({ tiles: { bed: { showing: "north-bed", editing: "an edit of north-bed" } } }), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed", to: "bed" } },
  { name: "a reader holding an edit: an agent's open aimed at it is refused", scene: garden({ tiles: { bed: { showing: "north-bed", editing: "an edit of north-bed" } } }), by: AGENT, request: { from: "seeds", note: "south-bed", to: "bed" } },
  { name: "a reader holding an edit: the reader opened beside it takes the next", scene: { layout: { focus: "bed", root: row([T("tree", "beds"), T("reader", "bed"), T("reader", "page")], undefined, { id: "s1" }) }, tiles: { beds: { lists: true }, bed: { showing: "north-bed", editing: "an edit of north-bed" }, page: { showing: "west-bed" } } }, ctx: { beside: { bed: "page" } }, request: { from: "beds", note: "south-bed" } },
  { name: "the tile the person types in: an agent's open goes to another reader", scene: { layout: { focus: "bed", root: row([T("tree", "beds"), T("reader", "bed"), T("reader", "page")], undefined, { id: "s1" }) }, tiles: { beds: { lists: true }, bed: { showing: "north-bed", editing: "an edit of north-bed" }, page: { showing: "west-bed" } } }, by: AGENT, person: typing("bed"), request: { from: "beds", note: "south-bed", default: true } },
  { name: "the tile the person types in, no other reader: an agent's opens beside another tile", scene: garden({ tiles: { bed: { showing: "north-bed", editing: "an edit of north-bed" } } }), by: AGENT, person: typing("bed"), request: { from: "beds", note: "south-bed" } },
  { name: "the tile the person types in, alone: an agent's open is refused", scene: { layout: { focus: "almanac", root: T("reader", "almanac") }, tiles: { almanac: { showing: "almanac-june", editing: "an edit of almanac-june" } } }, by: AGENT, person: typing("almanac"), request: { from: "almanac", note: "frost-dates" } },

  // a note already open
  { name: "a note a reader already shows: the open goes to that reader", scene: { layout: { focus: "beds", root: row([T("tree", "beds"), T("reader", "bed"), T("reader", "page")], undefined, { id: "s1" }) }, tiles: { beds: { lists: true }, bed: { showing: "north-bed" }, page: { showing: "south-bed" } } }, request: { from: "beds", note: "south-bed" } },
  { name: "a note a reader already shows: an agent's reuse leaves the keys", scene: { layout: { focus: "beds", root: row([T("tree", "beds"), T("reader", "bed"), T("reader", "page")], undefined, { id: "s1" }) }, tiles: { beds: { lists: true }, bed: { showing: "north-bed" }, page: { showing: "south-bed" } } }, by: AGENT, request: { from: "beds", note: "south-bed" } },
  { name: "a note a reader already shows, but the open is wired: the wire wins", scene: { layout: { focus: "beds", root: row([T("tree", "beds", { wires: [{ verb: "open", to: "bed" }] }), T("reader", "bed"), T("reader", "page")], undefined, { id: "s1" }) }, tiles: { beds: { lists: true }, bed: { showing: "north-bed" }, page: { showing: "south-bed" } } }, request: { from: "beds", note: "south-bed" } },
  { name: "history: a reader going back to a note another reader shows merges into it", scene: { layout: { focus: "bed", root: row([T("reader", "bed"), T("reader", "page")], undefined, { id: "s1" }) }, tiles: { bed: { showing: "north-bed", history: true }, page: { showing: "south-bed", history: true } } }, request: { from: "bed", note: "south-bed", history: true } },
  { name: "history: with nobody showing the note nothing lands (the reader restored its own place)", scene: garden(), request: { from: "bed", note: "south-bed", history: true } },

  // no reader here
  { name: "no reader here: a new one opens at the screen's right edge, and says so", scene: { layout: { focus: "beds", root: row([T("tree", "beds"), T("activity", "log")], undefined, { id: "s1" }) }, tiles: { beds: { lists: true } } }, request: { from: "beds", note: "south-bed" } },
  { name: "no reader here, on a locked screen: the new one is refused, with how to unlock", scene: { layout: { focus: "beds", policy: { locked: true }, root: row([T("tree", "beds"), T("activity", "log")], undefined, { id: "s1" }) }, tiles: { beds: { lists: true } } }, request: { from: "beds", note: "south-bed" } },
  { name: "no reader in a mount: the open hops out to the tile holding it", scene: { layout: { focus: "beds", root: T("tree", "beds") }, tiles: { beds: { lists: true } } }, ctx: { outward: "t-0a1b2c3d" }, request: { from: "beds", note: "south-bed" } },
  { name: "the drawer's list hands what nothing routes to the screen shown", scene: { layout: { focus: "asks", root: T("waiting-you", "asks") }, tiles: { asks: { lists: true } } }, ctx: { screen: "reader" }, request: { from: "asks", note: "south-bed" } },
  { name: "the drawer's hand-off, when the screen shown has no tiles, is refused", scene: { layout: { focus: "asks", root: T("waiting-you", "asks") }, tiles: { asks: { lists: true } } }, ctx: { screen: null }, request: { from: "asks", note: "south-bed" } },
  { name: "a hover with no wire lands nowhere", scene: garden(), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed", verb: "hover" } },
  { name: "a hover follows its own wire", scene: garden({ seeds: { wires: [{ verb: "hover", to: "bed" }] } }), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed", verb: "hover" } },

  // open fresh (alt+⏎)
  { name: "fresh: the tile its opens land in takes it, its old note kept as a spine beside it", scene: garden({ seeds: { wires: [{ verb: "open", to: "bed" }] } }), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed", fresh: true } },
  { name: "fresh: the alt rule tab opens a tab on the target", scene: garden({ policy: { altOpens: "tab" }, seeds: { wires: [{ verb: "open", to: "bed" }] } }), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed", fresh: true } },
  { name: "fresh: the alt rule tile opens in the target itself", scene: garden({ policy: { altOpens: "tile" }, seeds: { wires: [{ verb: "open", to: "bed" }] } }), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed", fresh: true } },
  { name: "fresh: the alt rule first-unheld takes the first reader free", scene: { layout: { focus: "beds", policy: { altOpens: "first-unheld" }, root: row([T("tree", "beds"), T("reader", "pinboard", { mode: "pinned" }), T("reader", "bed")], undefined, { id: "s1" }) }, tiles: { beds: { lists: true }, pinboard: { showing: "watering-rota", pinned: true }, bed: { showing: "north-bed" } } }, request: { from: "beds", note: "south-bed", fresh: true } },
  { name: "fresh: an alt wire with a rule of its own", scene: garden({ seeds: { wires: [{ verb: "alt", to: "bed", rule: "tab" }] } }), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed", fresh: true } },
  { name: "fresh: an alt wire with no rule opens in its tile", scene: garden({ seeds: { wires: [{ verb: "alt", to: "bed" }] } }), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed", fresh: true } },
  { name: "fresh: a column already showing the note is still gone to", scene: stream({ flowPolicy: { opens: "next" } }), request: { from: "bend", note: "mouth-note", fresh: true } },
  { name: "fresh: into a container by its key, the reader there takes it, its old note a spine in that row", scene: plots(), request: { from: "sown", note: "tray-9", fresh: true } },
  { name: "fresh: the screen's own action for it (the welcome's)", scene: garden(), person: { focus: "seeds" }, ctx: { freshAction: "welcome.open" }, request: { from: "seeds", note: "south-bed", fresh: true } },
  { name: "fresh: from a reader with nothing wired, it takes the note and keeps its old one as a spine", scene: garden(), request: { from: "bed", note: "south-bed", fresh: true } },

  // a tile named, a place named
  { name: "to: the tile named takes it", scene: garden(), by: AGENT, request: { from: "beds", note: "south-bed", to: "bed" } },
  { name: "to, with the rule beside: a reader beside the tile named", scene: garden(), request: { from: "beds", note: "south-bed", to: "bed", rule: "beside" } },
  { name: "to, with the rule tab: a tab on the tile named", scene: garden(), request: { from: "beds", note: "south-bed", to: "bed", rule: "tab" } },
  { name: "to, with the rule first-unheld: the first reader free, else beside", scene: garden({ tiles: { bed: { showing: "north-bed", pinned: true } } }), request: { from: "beds", note: "south-bed", to: "bed", rule: "first-unheld" } },
  { name: "to, with the rule first-unheld: a reader that is free takes it", scene: { layout: { focus: "beds", root: row([T("tree", "beds"), T("reader", "bed"), T("reader", "page")], undefined, { id: "s1" }) }, tiles: { beds: { lists: true }, bed: { showing: "north-bed", pinned: true } } }, request: { from: "beds", note: "south-bed", to: "bed", rule: "first-unheld" } },
  { name: "at: the place named is where a new reader goes", scene: garden(), request: { from: "beds", note: "south-bed", at: { kind: "split", target: "log", dir: "up" } } },
  { name: "a new note as a tab on the tile with the keys", scene: garden(), request: { from: "bed", note: "new-note", newNote: "tab" } },
  { name: "a new note as a tab where tabs aren't taken floats, and says so", scene: plots({ focus: "sown" }), request: { from: "sown", note: "new-note", newNote: "tab" } },
  { name: "a new note as a float", scene: garden(), request: { from: "bed", note: "new-note", newNote: "float" } },
  { name: "an open naming no tile: the first reader free, never a list in place", scene: garden({ policy: { opens: "self" } }), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed", default: true } },
  { name: "an open naming no tile skips a folded reader", scene: { layout: { focus: "beds", root: row([T("tree", "beds"), T("reader", "bed", { collapsed: true }), T("reader", "page")], undefined, { id: "s1" }) }, tiles: { beds: { lists: true }, bed: { showing: "north-bed" } } }, request: { from: "beds", note: "south-bed", default: true } },
  { name: "an act's from= reads the tile's wires, never the screen's fresh action", scene: garden({ seeds: { wires: [{ verb: "open", to: "bed" }] } }), by: AGENT, ctx: { freshAction: "welcome.open" }, request: { from: "seeds", note: "south-bed", act: true, fresh: true } },
  { name: "a wire to another screen: the open goes across, by its rule", scene: garden({ seeds: { wires: [{ verb: "open", to: "nursery/reader", rule: "beside" }] } }), person: { focus: "seeds" }, request: { from: "seeds", note: "south-bed" } },
  { name: "keys false: the open lands and the person's keys stay", scene: garden(), person: { focus: "beds" }, request: { from: "beds", note: "south-bed", to: "bed", keys: false } },
  { name: "a busy person: their own open leaves the keys where they are", scene: garden(), person: { focus: "beds", busy: true }, request: { from: "beds", note: "south-bed", to: "bed" } },
  { name: "a zoomed tile: the person's open from it lands as on any screen", scene: garden(), setup: [{ op: { op: "zoom", tile: "seeds" } }], request: { from: "seeds", note: "south-bed" } },
  { name: "an agent in yolo stands as the person, and still never takes their keys", scene: garden(), by: AGENT, person: { focus: "beds", yolo: true }, request: { from: "beds", note: "south-bed", to: "bed" } },
  { name: "a reader behind another tab takes the open, and comes to the front", scene: shed({ focus: "beds" }), request: { from: "beds", note: "south-bed", to: "tools" } },
  { name: "a reader behind another tab: an agent's open never hides the tab the person has", scene: shed(), by: AGENT, request: { from: "beds", note: "south-bed", to: "tools" } },
  { name: "a reader in a shut dock takes the open, and its dock slides out", scene: { layout: { focus: "beds", root: row([T("tree", "beds"), T("activity", "log"), dock(T("reader", "bed"), "right", false, { id: "d2" })], [0.3, 0.4, 0.3], { id: "s1" }) }, tiles: { beds: { lists: true } } }, request: { from: "beds", note: "south-bed" } },
  { name: "a follower takes a wired open without the keys", scene: { layout: { focus: "beds", root: row([T("tree", "beds", { wires: [{ verb: "open", to: "card" }] }), T("preview", "card", { source: "tile:beds" })], undefined, { id: "s1" }) }, tiles: { beds: { lists: true } } }, request: { from: "beds", note: "south-bed" } },
];

// ── act lines ──

/** An act line, as the power bar, a button and `ep0ch act` take it. `typed`: its arguments are typed by the door's own action of that name. */
export const ACT_LINES: { line: string; repeats?: "list"; typed?: true }[] = [
  { line: "layout.even" },
  { line: "tile.close tile=seeds" },
  { line: "tile.close --tile seeds" },
  { line: "--tile seeds tile.close" },
  { line: "note.trash --as compost-agent" },
  { line: "--as compost-agent --tile bed note.trash" },
  { line: "open id=north-bed as=seedling-agent tile=bed" },
  { line: "tile.rename name=\"north bed\" tile=bed" },
  { line: "tile.rename name='north bed'" },
  { line: "block.mark reason=\"check the \\\"bed\\\" sizes\" line=12" },
  { line: "note.new text=\"\"" },
  { line: "bar.open source=query query=\"type=bed NOT stage=done\"" },
  { line: "bar.open query=type=bed" },
  { line: "tile.open kind=reader to=bed where=right" },
  { line: "tile.open tile=role:reader@garden-work kind=preview" },
  { line: "tile.focus tile=t-0a1b2c3d" },
  { line: "tile.focus tile=^" },
  { line: "tile.focus tile=detail@board" },
  { line: "tile.focus tile=drawer.agent" },
  { line: "script.run name=sow page=north-bed page=south-bed", repeats: "list" },
  { line: "script.run name=sow page=north-bed page=south-bed page=west-bed week=23", repeats: "list" },
  { line: "script.run name=sow page=north-bed page=south-bed" },
  { line: "tile.close tile=seeds tile=log" },
  { line: "   tile.close    tile=seeds   " },
  { line: "" },
  { line: "tile.close seeds" },
  { line: "tile.close =seeds" },
  { line: "tile.close --tile" },
  { line: "--as" },
  { line: "tile.rename name=\"north bed" },
  { line: "layout.resize split=s1 border=0 share=0.4", typed: true },
  { line: "tile.collapse on=true dir=h tile=log", typed: true },
  { line: "tile.collapse on=yes", typed: true },
  { line: "layout.resize split=s1 border=one share=0.4", typed: true },
  { line: "layout.resize split=s1 border=0", typed: true },
  { line: "layout.move tile=log to=beds where=down", typed: true },
  { line: "layout.move tile=log to=beds where=below", typed: true },
  { line: "layout.move tile=log too=beds", typed: true },
  { line: "tile.zoom on=false", typed: true },
  { line: "tile.agent policy=edit tile=bed", typed: true },
];

/** What `tile=` may say: an id (8 or more characters of it), a role with or without a screen, a slot on a screen, the tile that opened this one, and a plain name. */
export const TILE_ADDRESSES: string[] = [
  "t-0a1b2c3d", "T-0A1B2C3D-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "t-0a1b2c", "t4",
  "role:reader", "role:agent@drawer", "role:reader@garden-work", "role:", "drawer.agent",
  "detail@board", "readers@garden-work", "@board", "detail@", "welcome/welcome@board",
  "^", "^^", "^^^",
  "bed", "#3", "3", "nursery/reader", "north bed",
];

/**
 * Which tile an address names (`tile=`, `to=`, a follower's `source: tile:`): the tiles a made-up window has, as the
 * resolver reads one (outline-core's AddressCandidate, with `where` already said), and what is asked of them. `from`:
 * the tile the request acts from, for `^`.
 */
export interface AddressTile { id: string; name: string; role: string; slots: string[]; screen: string; from?: string; copiedFrom?: string; usedAt?: number; where: string }
const tid = (n: number) => `t-${String(n).repeat(8)}-4e5f-4a6b-8c7d-9e0f1a2b3c4d`;
export const ADDRESS_TILES: AddressTile[] = [
  { id: tid(1), name: "beds", role: "query", slots: ["beds"], screen: "garden-work", where: "garden-work/beds" },
  { id: tid(2), name: "bed", role: "reader", slots: ["bed", "readers"], screen: "garden-work", from: tid(1), where: "garden-work/readers/bed" },
  { id: tid(3), name: "seeds", role: "reader", slots: ["seeds", "readers"], screen: "garden-work", from: tid(2), where: "garden-work/readers/seeds" },
  { id: tid(4), name: "roots", role: "backlinks", slots: ["roots"], screen: "garden-work", from: "t-99999999-4e5f-4a6b-8c7d-9e0f1a2b3c4d", where: "garden-work/roots" },
  { id: tid(5), name: "almanac", role: "reader", slots: ["detail"], screen: "shed", copiedFrom: "t-88888888-4e5f-4a6b-8c7d-9e0f1a2b3c4d", where: "shed/almanac" },
  { id: tid(6), name: "sower", role: "agent", slots: ["sower"], screen: "drawer", usedAt: 10, where: "drawer/sower" },
  { id: tid(7), name: "weeder", role: "agent", slots: ["weeder"], screen: "drawer", usedAt: 20, where: "drawer/weeder" },
];
export const ADDRESS_CASES: { address: string; from?: string }[] = [
  // An id: whole, by its first characters, in any case; one nothing has, one a copy was made of, one near another.
  { address: tid(2) }, { address: "t-33333333" }, { address: "T-33333333-4E5F" }, { address: "t-0a1b2c3d" }, { address: "t-88888888" }, { address: "t-11111199" },
  // A role: one tile, several (refused, with the ids to type), several agents (the one used last), on a screen, on none shown.
  { address: "role:query" }, { address: "role:reader" }, { address: "role:reader@shed" }, { address: "role:reader@garden-work" }, { address: "role:agent" }, { address: "drawer.agent" },
  { address: "role:terminal" }, { address: "role:reader@orchard" }, { address: "role:query@shed" },
  // A slot on a screen: one tile, a container's several, none, a screen not on show.
  { address: "detail@shed" }, { address: "beds@garden-work" }, { address: "readers@garden-work" }, { address: "lanes@garden-work" }, { address: "detail@orchard" },
  // The tile that opened the acting one: one step, two, past the first, from nowhere, an opener that was closed.
  { address: "^", from: tid(3) }, { address: "^^", from: tid(3) }, { address: "^^^", from: tid(3) }, { address: "^" }, { address: "^", from: tid(4) }, { address: "^", from: "t-0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" },
  // A name is the caller's own to read, after every address.
  { address: "bed" }, { address: "north bed" }, { address: "3" },
];
