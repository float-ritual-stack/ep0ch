// The screen-layout module (PIE-513): the reducer in the door's one-way data flow. A screen's layout is one value
// (its tree of containers and tiles, its floats, the tiles folded to a spine, the zoom, the links, the tiles' names,
// the screen's policy and lock, its revision) and it changes only one way: `apply(state, op, ctx)`, which applies one
// layout operation for one actor as one transaction and answers either the new state or a refusal with its reason.
// Nothing outside this module changes a tree.
//
// The rules live here, checked inside every operation, so no caller can break them one operation at a time (the
// round-2 review's B7–B11, C3, C4 came from callers doing exactly that):
// - a float has no place in the tree: nothing goes beside it or into its tabs, it swaps with nothing, it doesn't
//   fold, until it's back in the layout; it lands only where the containers there take it (a dock takes it in one step);
// - the nearest policy wins, and a lock above locks everything below; an agent undoes only a lock it set;
// - an agent never moves, floats, pins or closes the tile the person is typing in, never moves their keys while
//   they type, and never hides the tab they have;
// - a container's rule outlives a move that leaves it one tile; something pinned always stays to slide over; the
//   screen is never blank; the keys never stay on a hidden tile;
// - in a flow, focus never moves the layout (only a widen, an open that needs it, or a key to a column off the strip).
//
// What the module doesn't own is said to it (`Ctx`): who acts, where the person's keys are and whether they're
// typing (PIE-514 makes that a shell-owned query; it's only ever read from `ctx.person`), and what each tile is
// (its kind, its kind's default policy, whether it takes notes, what keeps it). Tile instances, gestures and
// painting stay the desk's. Internal: the tree arithmetic (`layout.ts`) and the flow's squeeze (`flow.ts`).
import type { Rect } from "../canvas";
import { byOf, type Actor } from "../socket";
import { arrive, columnOf, leaving, setAhead, setHeld, setFrom, squeeze, tileOfColumn, travelTarget, widen as widenFlow, type Cover } from "./flow";
import {
  activate, besideSlot, chainOf, clone, cycle, describeTree, pinnedTiles, dockOf, docks, dockToEdge, edge, effective, even, forgetIds, has, insert, isLine, kidsOf, leaf, leaves, move,
  node, nodeById, normalise, parentOf, placeScreen, policyOf, remove, resize, serialize as serializeTree, shown, swapLeaf, tabInto, tabsOf, unwrapDock, visible, wrapDock, wrapNodeDock,
  POLICY_KEYS, type Axis, type Container, type Dir, type Dock, type Effective, type Flow, type Float, type HostMode, type Line, type LNode, type Place, type PlacedScreen, type PlaceOpts, type Policy,
} from "./layout";
import { SPINE } from "../spine";
import { agentRefusal, type AgentLevel } from "../surface/agent-level";

// ── what the module reads: the tree queries, re-exported so callers import only this module ──
export {
  chainOf, columnsOf, dividerAt, pinnedTiles, dragShare, dockOf, docks, EDGE_GLYPH, EDGE_WORD, effective, flowOf, isDir, isLine, kidsOf, leaf, leaves, neighbour, node, nodeById,
  pair, parentNode, parentOf, policyOf, revive as reviveTree, shown, splitAxis, splitOf, tabsOf, visible, POLICY_KEYS,
} from "./layout";
/** A copy of a tree to build on (a screen's preset as it's made); the state's own is never changed in place. */
export { clone as copyTree } from "./layout";
/** A tree as saved, by leaf (a spec built in code: tile specs as the leaves). */
export { serialize as serializeTree } from "./layout";
export type {
  Axis, BinaryForm, Columns, Container, Dir, Divider, Dock, Effective, Float, Flow, FlowForm, Grab, HostMode, Line, LNode, NaryForm, OpenRule, Place, Placed, PlacedDock, PlacedScreen, PlaceOpts, Policy, Split, Tabs,
} from "./layout";
export type { Cover } from "./flow";
/** The flow's squeeze, and where back and forward go from a column (its trail). */
export { columnOf, squeeze, fullWidth, PEEK, travelTarget, tileOfColumn } from "./flow";

/**
 * A tile folded to a spine (`tile.collapse`): the agent that folded it, if an agent did, and which way. Vertical (the
 * default) is a strip `SPINE` cells wide in a row of tiles side by side; `dir: "h"` is one row high in a column of
 * stacked tiles. Its weight in the split is untouched, so opening it again gives it back its size.
 */
export type Fold = { by?: string; dir?: "h" };
/** Whether a fold fits a split along `axis`: a vertical spine needs tiles side by side (row), a horizontal one stacked (col). */
export const foldFits = (fold: Fold, axis: string | undefined): boolean => (fold.dir === "h" ? axis === "col" : axis === "row");

/** A screen's layout: everything about where its tiles are, and nothing about what they show. */
export interface LayoutState<I = number> {
  readonly tree: LNode<I>;
  /** Tiles with their own rectangle, above everything, the last on top. */
  readonly floats: readonly Float<I>[];
  /** Tiles folded to a spine (`tile.collapse`), and the agent that folded one, if an agent did. */
  readonly collapsed: ReadonlyMap<I, Fold>;
  /** The tile filling the screen, if one does. */
  readonly zoom: I | null;
  /** Where a tile's opens land (PIE-473): tile → tile. */
  readonly links: ReadonlyMap<I, I>;
  /** Each tile's name: what links, previews, `act tile=` and `peek` call it. */
  readonly names: ReadonlyMap<I, string>;
  /** What an agent may do to a tile of its own (PIE-639): wins over the containers' and the screen's default; absent, they say. */
  readonly agents: ReadonlyMap<I, AgentLevel>;
  /** The screen's own policy (the outermost container's): `locked` there locks the whole screen. */
  readonly policy: Policy;
  /** The locks an agent set ("screen", or a container's id): an agent undoes only these; the person's are theirs. */
  readonly locks: readonly string[];
  /** A dock pinned keeps its policy here, by what it held: put back in a dock, it slides as it did. */
  readonly remembered: ReadonlyMap<string, Policy | undefined>;
  /** The layout's revision: a new one each time its shape changes (`expected=` is checked against it). */
  readonly rev: number;
  /** The next container id's number (`s<n>`, `g<n>`, `d<n>`, `c<n>`, `f<n>`): never given out twice. */
  readonly nextNode: number;
  /** The shape the revision was given for (internal: a change to it is a new revision). */
  readonly shapeKey: string;
}

/** What a tile is, as the layout's rules need it: the desk's tile instances answer it. */
export interface TileFacts {
  kind: string;
  /** Its kind's default policy (the innermost layer). */
  policy?: Policy;
  /** The kinds it takes as tabs, when its kind is picky. */
  tabs?: readonly string[];
  /** It takes notes: a link or an opens-into may name it. */
  notes?: boolean;
  /** Why it stays: a tile source supplies it (the board's lanes), so a close would come back. */
  keeps?: string;
  /** Its kind's own words for why its kind's policy keeps it (closable or draggable off), said whole in place of the policy's. */
  stays?: string;
  /** The edit or comment it holds: it isn't closed under it. */
  editing?: string;
  /** The program running in it: an agent doesn't end it. */
  running?: string;
  /** It only holds a place (the blank tile): an agent may replace it under the person's keys. */
  placeholder?: boolean;
  /** It holds work (a draft): in a flow, its column resists compression. */
  holds?: boolean;
}

/** Where the person is: their keys, the tile they're typing in (an edit, a comment, a terminal), whether they're busy. */
export interface Person<I = number> {
  focus: I;
  /** The tile the person is typing in, or null. PIE-514: a shell-owned query; here it is only ever an input. */
  typingIn: I | null;
  /** The person's keys are held (typing anywhere, a picker or panel open, a ^W chord): an agent doesn't move them. */
  busy: boolean;
  /** Their keys are on this layout at all (false: on another screen, or in the index around a framed one): `focus` is only its own. */
  here?: boolean;
  /**
   * Why an agent may not move their keys now, as the shell's one rule says it (`actorRule` for `touches: "screen"`:
   * busy, away, or at the keys in the last 2s), or null. Left out, being busy is the rule.
   */
  held?: string | null;
}

/** What an operation is applied with: who acts, where the person is, what each tile is, the screen's room. */
export interface Ctx<I = number> {
  actor: Actor;
  person: Person<I>;
  tile(id: I): TileFacts;
  /** The room the screen's tiles have: floats are kept on it, flows are squeezed in it. */
  area: Rect;
  /** The tile kinds that exist (`accepts` names only these), and those that take notes (said in a refusal). */
  kinds?: { all: readonly string[]; notes: readonly string[] };
  /** The revision the caller read: refused, with nothing done, when the shape changed since. */
  expected?: number;
  /** Applied to the host layer: where the screen shown lets it appear (its policy's `host`); `none` keeps it put away. */
  screenHost?: HostMode;
}

/** Where a new or moved tile goes. A drag's places, plus: into a named line (`in`), the next column of a flow, a float. */
export type At<I = number> = Place<I>
  | { kind: "in"; key: string; index?: number; weight?: number }
  | { kind: "next"; from: I }
  | { kind: "float"; rect?: Rect; near?: I };

/** One layout operation. Each is applied for one actor, as one step: all of it, or none of it with the reason. */
export type Op<I = number> =
  | { op: "open"; tile: I; kind: string; name?: string; loose?: boolean; at: At<I>; keys?: false; link?: I }
  | { op: "close"; tile: I; gone?: boolean }
  /** A new tile `with` of `kind` takes tile `tile`'s place whole (its weight, its tab, its dock), and `tile` goes: a blank tile's first step. */
  | { op: "replace"; tile: I; with: I; kind: string; name?: string }
  /** A tile leaves this layout whole, to go on elsewhere (your drawer, PIE-498): moved, not closed. */
  | { op: "take"; tile: I; heir?: { id: I; name?: string } }
  | { op: "move"; tile: I; to: Place<I> }
  | { op: "swap"; tile: I; with: I }
  | { op: "float"; tile: I; at?: At<I> }
  | { op: "place"; tile?: I; dx?: number; dy?: number; col?: number; row?: number; cols?: number; rows?: number }
  | { op: "pin"; tile: I; on?: boolean; edge?: Dir; container?: string }
  | { op: "slide"; tile: I; open?: boolean; container?: string }
  | { op: "collapse"; tile: I; on?: boolean; dir?: "v" | "h" }
  | { op: "resize"; split?: string; path?: string; border: number; share: number }
  | { op: "shares"; split: string; shares: number[] }
  | { op: "grow"; tile: I; axis: Axis; by: number }
  | { op: "even" }
  | { op: "lock"; on?: boolean }
  /** What an agent may do to tile `tile` (PIE-639): its own level, or (`level` null) the containers' and the screen's again. */
  | { op: "agents"; tile: I; level: AgentLevel | null }
  | { op: "policy"; tile?: I; node?: string; set: Policy; clear: string[] }
  | { op: "link"; tile: I; to?: I }
  | { op: "focus"; tile: I; quiet?: boolean }
  | { op: "reveal"; tile: I }
  | { op: "tab"; tile: I; by?: number }
  | { op: "zoom"; tile: I; on?: boolean }
  | { op: "load"; name: string }
  | { op: "fill"; container: string; order: I[]; fresh?: { id: I; kind: string; name?: string }[]; drop?: I[]; weights?: [I, number][]; names?: [I, string][] }
  | { op: "source"; container: string; source: string }
  | { op: "flow.widen"; tile: I }
  | { op: "flow.travel"; tile: I; dir: -1 | 1 }
  | { op: "flow.hold"; tile: I; on?: boolean }
  | { op: "remember"; key: string; policy: Policy };

/** The answer: the new state (and where the person's keys are now), or the refusal and its reason, nothing done. */
export type Result<I = number> =
  | { ok: true; state: LayoutState<I>; focus: I; changed: boolean; answer: Record<string, unknown>; base: LayoutState<I> }
  | { ok: false; refused: string };

/** How a locked screen is unlocked, said with every refusal it causes. */
export const UNLOCK = "alt+k or a click on ▣ locked unlocks it";

/** A refusal inside an operation: caught by `apply`, which answers it with nothing changed. */
class Refused extends Error {}
const refuse = (why: string | null | undefined): void => { if (why) throw new Refused(why); };

// ── the state as an operation changes it (a private copy: a refused operation leaves the caller's as it was) ──

interface Draft<I> {
  tree: LNode<I>; floats: Float<I>[]; collapsed: Map<I, Fold>; zoom: I | null; links: Map<I, I>; names: Map<I, string>; agents: Map<I, AgentLevel>;
  policy: Policy; locks: Set<string>; remembered: Map<string, Policy | undefined>; focus: I; changed: boolean; answer: Record<string, unknown>;
}
const draftOf = <I>(s: LayoutState<I>, focus: I): Draft<I> => ({
  tree: clone(s.tree), floats: s.floats.map(f => ({ id: f.id, rect: { ...f.rect } })), collapsed: new Map([...s.collapsed].map(([k, v]) => [k, { ...v }])), zoom: s.zoom,
  links: new Map(s.links), names: new Map(s.names), agents: new Map(s.agents), policy: { ...s.policy }, locks: new Set(s.locks), remembered: new Map(s.remembered), focus, changed: true, answer: {},
});

/** The tests run with the state frozen: a caller that changes it in place, past `apply`, throws there. */
const FREEZE = process.env.NODE_ENV === "test";
function freeze<T>(x: T): T {
  if (!FREEZE || !x || typeof x !== "object" || Object.isFrozen(x)) return x;
  for (const v of Object.values(x as object)) freeze(v);
  return Object.freeze(x);
}

/** Ids for containers that have none (kept ones first, so a saved id is never taken), and the revision. */
function stamp<I>(tree: LNode<I>, policy: Policy, floats: readonly Float<I>[], prev: { rev: number; nextNode: number; shapeKey: string }): { rev: number; nextNode: number; shapeKey: string } {
  const seen = new Set<string>(), all: Container<I>[] = [];
  let next = prev.nextNode;
  const walk = (n: LNode<I>) => { if (n.t !== "leaf") { all.push(n); kidsOf(n).forEach(walk); } };
  walk(tree);
  const want = (n: Container<I>) => (n.t === "split" ? "s" : n.t === "tabs" ? "g" : n.t === "columns" ? "c" : n.t === "flow" ? "f" : "d");
  for (const n of all) {
    const m = n.id?.startsWith(want(n)) ? /^[sgdcf](\d+)$/.exec(n.id) : null;
    if (m && !seen.has(n.id!)) { seen.add(n.id!); next = Math.max(next, Number(m[1]) + 1); }
    else delete n.id;
  }
  for (const n of all) if (!n.id) n.id = `${want(n)}${next++}`;
  // The shape: containers, tiles, their order, each container's policy and the screen's, the floats. Not shares, the
  // tab shown, whether a dock is open, or a flow's wide column: those don't change what an id or path points at.
  const pol = (n: Container<I>) => (n.policy ? JSON.stringify(n.policy) : "");
  const shape = (n: LNode<I>): string => (n.t === "leaf" ? `t${n.id}` : n.t === "tabs" ? `${n.id}${pol(n)}[${n.ids.join(",")}]` : n.t === "dock" ? `${n.id}<${n.edge}>${pol(n)}(${shape(n.kid)})`
    : `${n.id}${n.t === "columns" ? `columns:${n.source ?? ""}` : n.t === "flow" ? "flow" : n.dir}${pol(n)}(${n.kids.map(shape).join(",")})`);
  const key = shape(tree) + JSON.stringify(policy ?? {}) + floats.map(f => `f${f.id}`).join(",");
  return { rev: key !== prev.shapeKey ? prev.rev + 1 : prev.rev, nextNode: next, shapeKey: key };
}

function seal<I>(d: Draft<I>, prev: { rev: number; nextNode: number; shapeKey: string }): LayoutState<I> {
  const s = stamp(d.tree, d.policy, d.floats, prev);
  return freeze({
    tree: d.tree, floats: d.floats, collapsed: d.collapsed, zoom: d.zoom, links: d.links, names: d.names, agents: d.agents, policy: d.policy,
    locks: [...d.locks], remembered: d.remembered, rev: s.rev, nextNode: s.nextNode, shapeKey: s.shapeKey,
  });
}

/**
 * A layout as a screen starts it (a preset, a saved layout, desk.json coming back): the tree as given, plain, never
 * blank, its containers given ids. `prev` goes on from an earlier state (its revision and ids, its agents' locks
 * and the docks' remembered policy), or from a saved revision and next id.
 */
export function init<I>(parts: { tree: LNode<I>; names: ReadonlyMap<I, string>; floats?: readonly Float<I>[]; collapsed?: ReadonlyMap<I, Fold>; links?: ReadonlyMap<I, I>; agents?: ReadonlyMap<I, AgentLevel>; policy?: Policy },
  prev?: LayoutState<I> | { rev: number; nextNode: number }, opts: { freshIds?: boolean } = {}): LayoutState<I> {
  const given = clone(parts.tree);
  // A layout loaded from elsewhere (not this screen's own save coming back) never hands out an id given here before.
  if (opts.freshIds) forgetIds(given, num => num < (prev?.nextNode ?? 1));
  const tree = normalise(given);
  const d: Draft<I> = {
    tree, floats: (parts.floats ?? []).map(f => ({ id: f.id, rect: { ...f.rect } })), collapsed: new Map(parts.collapsed ?? []), zoom: null, links: new Map(parts.links ?? []), names: new Map(parts.names), agents: new Map(parts.agents ?? []),
    policy: policyOf(parts.policy), locks: new Set(prev && "locks" in prev ? prev.locks : []), remembered: new Map(prev && "remembered" in prev ? prev.remembered : []),
    focus: leaves(tree)[0]!, changed: true, answer: {},
  };
  neverBlank(d);
  return seal(d, { rev: prev?.rev ?? 0, nextNode: prev?.nextNode ?? 1, shapeKey: prev && "shapeKey" in prev ? prev.shapeKey : "" });
}

/** `expected=<rev>`: why it's refused (the shape changed since the revision the caller read), or null. */
export function revisionRefusal<I>(s: LayoutState<I>, expected: unknown): string | null {
  const e = typeof expected === "number" ? expected : typeof expected === "string" && /^\d+$/.test(expected) ? Number(expected) : NaN;
  if (!Number.isInteger(e)) return `expected is the revision layout.get gave (a number), not ${JSON.stringify(expected)}`;
  if (e !== s.rev) return `the layout changed since revision ${e} (it is ${s.rev} now): nothing was done; read layout.get again, or name splits and tiles by id`;
  return null;
}

/**
 * Apply one operation for `ctx.actor`, as one transaction: every rule is checked inside it, and the answer is the new
 * state (with where the person's keys are now, and what the operation has to say) or the refusal, with the state the
 * caller holds left exactly as it was. Pure: a caller may apply to ask (a drag's ghost asks before the release).
 */
export function apply<I>(s: LayoutState<I>, op: Op<I>, ctx: Ctx<I>): Result<I> {
  if (ctx.expected !== undefined) { const why = revisionRefusal(s, ctx.expected); if (why) return { ok: false, refused: why }; }
  const d = draftOf(s, ctx.person.focus);
  try {
    new Step(d, ctx).run(op);
  } catch (e) {
    if (e instanceof Refused) return { ok: false, refused: e.message };
    throw e;
  }
  neverBlank(d);
  return { ok: true, state: seal(d, s), focus: d.focus, changed: d.changed, answer: d.answer, base: s };
}

/** Why `op` would be refused, or null (it isn't applied). */
export function refusal<I>(s: LayoutState<I>, op: Op<I>, ctx: Ctx<I>): string | null {
  const r = apply(s, op, ctx);
  return r.ok ? null : r.refused;
}

/**
 * Never a blank screen: when every tile is in a shut dock (a layout saved that way, the pinned tiles closed), the
 * dock holding the keys opens (else the first), and the keys go to a tile that shows.
 */
function neverBlank<I>(d: Draft<I>) {
  if (visible(d.tree).length || !leaves(d.tree).length) return;
  const dr = dockOf(d.tree, d.focus) ?? docks(d.tree).find(x => leaves(x.kid).length);
  if (!dr) return;
  for (const c of chainOf(d.tree, leaves(dr.kid)[0]!)) if (c.t === "dock") c.open = true;
  if (!visible(d.tree).includes(d.focus) && !d.floats.some(f => f.id === d.focus)) d.focus = visible(d.tree)[0] ?? d.focus;
}

// ── queries ─────────────────────────────────────────────────────────────────

/** The policy layers over tile `id`: the screen's, each container's down to it, then its kind's default. */
export function layers<I>(s: Pick<LayoutState<I>, "tree" | "policy">, id: I, facts?: TileFacts): { by: string; policy?: Policy; flow?: boolean }[] {
  return [{ by: "screen", policy: s.policy }, ...chainOf(s.tree, id).map(c => ({ by: c.id ?? c.t, policy: c.policy, flow: c.t === "flow" })), { by: `${facts?.kind ?? "tile"} tiles`, policy: facts?.policy }];
}
/** What applies to tile `id`: the nearest that says a field wins, and a lock anywhere above locks it. */
export const policyAt = <I>(s: Pick<LayoutState<I>, "tree" | "policy">, id: I, facts?: TileFacts): Effective => effective(layers(s, id, facts));
/** What applies to container `c`: its own policy and those above it. */
export function policyOfNode<I>(s: Pick<LayoutState<I>, "tree" | "policy">, c: Container<I>): Effective {
  return effective([{ by: "screen", policy: s.policy }, ...nodeChain(s.tree, c).map(x => ({ by: x.id ?? x.t, policy: x.policy, flow: x.t === "flow" }))]);
}
/** The containers from the root down to container `c`, `c` last. */
function nodeChain<I>(root: LNode<I>, c: LNode<I>): Container<I>[] {
  const go = (n: LNode<I>): Container<I>[] | null => {
    if (n === c) return n.t === "leaf" ? [] : [n];
    for (const k of kidsOf(n)) { const r = go(k); if (r) return n.t === "leaf" ? r : [n, ...r]; }
    return null;
  };
  return go(root) ?? (c.t === "leaf" ? [] : [c as Container<I>]);
}
/**
 * What an agent may do to tile `id` (PIE-639): the tile's own level, else the nearest container's or the screen's
 * default, else `free`; `by` says which ("tile", "screen" or a container's id).
 */
export function agentLevel<I>(s: Pick<LayoutState<I>, "tree" | "policy" | "agents">, id: I, facts?: TileFacts): { level: AgentLevel; by: string } {
  const own = s.agents.get(id);
  if (own) return { level: own, by: "tile" };
  const e = policyAt(s, id, facts);
  return { level: e.agents, by: e.by.agents ?? "screen" };
}
export const isFloat = <I>(s: Pick<LayoutState<I>, "floats">, id: I) => s.floats.some(f => f.id === id);
/** Every tile: the tree's (a tab set's hidden ones too), then the floats. */
export const allTiles = <I>(s: Pick<LayoutState<I>, "tree" | "floats">): I[] => [...leaves(s.tree), ...s.floats.map(f => f.id)];
/** The tile named `name`, if there is one. */
export const named = <I>(s: Pick<LayoutState<I>, "names">, name: string): I | undefined => [...s.names].find(([, n]) => n === name)?.[0];
/** A name for a new tile of `kind`: the kind, else the kind and the first number free (reader2). */
export function autoName<I>(s: Pick<LayoutState<I>, "names">, kind: string): string {
  const taken = new Set(s.names.values());
  if (!taken.has(kind)) return kind;
  for (let n = 2; ; n++) if (!taken.has(`${kind}${n}`)) return `${kind}${n}`;
}

/**
 * Where tile `id`'s opens land: its own link (when that tile is here), else the opens-into of the nearest container
 * that names a tile here (not itself), else the open rule: the next column of its flow (`next`), or none (the
 * current note).
 */
export function landing<I>(s: Pick<LayoutState<I>, "tree" | "policy" | "links" | "names">, id: I, facts?: TileFacts): { to: I } | { into: string } | { next: true } | null {
  const own = s.links.get(id);
  if (own !== undefined && s.names.has(own)) return { to: own };
  const e = policyAt(s, id, facts);
  const into = e.opensInto ? named(s, e.opensInto) : undefined;
  if (into !== undefined && into !== id) return { to: into };
  // A container by its key (the board's readers row): a tile opened into it holds the note.
  if (into === undefined && e.opensInto && node(s.tree, e.opensInto)) return { into: e.opensInto };
  if (e.opens === "next" && flowHolding(s.tree, id)) return { next: true };
  return null;
}

/** The flow tile `id` is a column of (the nearest one over it), and its column there. */
function flowHolding<I>(tree: LNode<I>, id: I): { flow: Flow<I>; ci: number } | null {
  const f = chainOf(tree, id).filter((c): c is Flow<I> => c.t === "flow").at(-1);
  return f ? { flow: f, ci: columnOf(f, id) } : null;
}

/** How the tiles are placed: a folded tile is a spine across a row; a tile holding work keeps its flow column wide. */
export function placeOpts<I>(s: Pick<LayoutState<I>, "collapsed">, holds?: (id: I) => boolean): PlaceOpts<I> {
  return { fixed: (id, dir) => { const f = s.collapsed.get(id); return f && foldFits(f, dir) ? (f.dir === "h" ? 1 : SPINE) : undefined; }, ...(holds ? { holds } : {}) };
}
/** Tile `id`'s share of the screen along each axis: the product of its weight in each line over it (a flow's columns count whole). */
function shareOf<I>(tree: LNode<I>, id: I): { row: number; col: number } {
  const out = { row: 1, col: 1 };
  const chain = chainOf(tree, id);
  chain.forEach((c, i) => {
    if (!isLine(c) || c.t === "flow") return;
    const next = chain[i + 1];
    const k = c.kids.findIndex(x => (next ? x === next : x.t === "leaf" && x.id === id));
    const sum = c.weights.reduce((a, w) => a + w, 0) || 1;
    if (k >= 0) out[c.dir === "col" ? "col" : "row"] *= c.weights[k]! / sum;
  });
  return out;
}
/** The screen placed in `area`: the tree, the docks sliding over it, each flow's columns (floats keep their own rects). */
export function place<I>(s: Pick<LayoutState<I>, "tree" | "floats" | "collapsed">, area: Rect, holds?: (id: I) => boolean): PlacedScreen<I> {
  return placeScreen({ root: s.tree, floats: [...s.floats] }, area, placeOpts(s, holds));
}
/** Where each tile is in `area`, from the state as it is: the zoomed tile alone, else the tree, the docks over it, the floats. */
export function rects<I>(s: Pick<LayoutState<I>, "tree" | "floats" | "collapsed" | "zoom">, area: Rect, holds?: (id: I) => boolean): Map<I, Rect> {
  if (s.zoom !== null && allTiles(s).includes(s.zoom)) return new Map([[s.zoom, area]]);
  const ps = place(s, area, holds);
  const out = new Map(ps.rects);
  for (const dr of ps.slid) for (const [id, r] of dr.placed.rects) out.set(id, r);
  for (const f of s.floats) out.set(f.id, { ...f.rect });
  return out;
}
/** Each flow column's cover as `area` squeezes it now (by column index). */
function coversOf<I>(s: Pick<LayoutState<I>, "tree" | "floats" | "collapsed">, f: Flow<I>, area: Rect, holds?: (id: I) => boolean): Map<number, Cover> {
  const ps = place(s, area, holds);
  const at = [...(ps.flows ?? []), ...ps.slid.flatMap(x => x.placed.flows ?? [])].find(x => x.node === f || x.node.id === f.id);
  if (at) return new Map(at.cols.map(c => [c.i, c.cover]));
  return new Map(squeeze(f, area.cols, holds).map(c => [c.i, c.cover]));
}

/** The tree as `peek` and `layout.get` show it: each tile by name with its share, each container with its id and path. */
export function describe<I>(s: Pick<LayoutState<I>, "tree" | "collapsed">, name: (id: I) => string, leafId?: (id: I) => string) {
  return describeTree(s.tree, name, placeOpts(s), leafId);
}
/** The tree as `view.subscribe` publishes it: each split's path and shares, each container's policy, each tile by name and id. */
export function shape<I>(s: Pick<LayoutState<I>, "tree">, name: (id: I) => string, tileId: (id: I) => string): unknown {
  const go = (n: LNode<I>, path: string): unknown => {
    const pol = n.t !== "leaf" && n.policy ? { policy: n.policy } : {};
    if (n.t === "leaf") return { tile: name(n.id), id: tileId(n.id) };
    if (n.t === "tabs") return { tabs: n.ids.map(name), id: n.id, shown: name(n.ids[n.active]!), ...pol };
    if (n.t === "dock") return { dock: n.edge, open: n.open, id: n.id, path, ...pol, kid: go(n.kid, path ? `${path}.0` : "0") };
    const kids = n.kids.map((k, i) => go(k, path ? `${path}.${i}` : String(i)));
    if (n.t === "flow") return { flow: true, id: n.id, path, ...(n.anchor !== undefined ? { wide: name(n.anchor) } : {}), ...pol, kids };
    const sum = n.weights.reduce((a, w) => a + w, 0) || 1;
    const shares = n.weights.map(w => Math.round((w / sum) * 1000) / 1000);
    if (n.t === "columns") return { columns: n.source ?? null, id: n.id, path, shares, ...pol, kids };
    return { split: n.dir, id: n.id, path, shares, ...pol, kids };
  };
  return go(s.tree, "");
}
/** The path of a container in the tree ("" the root, "1.0" its second kid's first kid; a dock's kid is its `.0`). */
export function pathOf<I>(root: LNode<I>, target: LNode<I>, path = ""): string | null {
  if (root === target) return path;
  const kids = kidsOf(root);
  for (let i = 0; i < kids.length; i++) { const p = pathOf(kids[i]!, target, path ? `${path}.${i}` : String(i)); if (p !== null) return p; }
  return null;
}
/** The container at `path`, if there is one. */
export function nodeAt<I>(root: LNode<I>, path: string): LNode<I> | null {
  let n: LNode<I> = root;
  for (const p of path.split(".").filter(Boolean)) { const k = kidsOf(n)[Number(p)]; if (!k) return null; n = k; }
  return n;
}

/** The layout as saved: the tree of tiles (each as `leafOf` writes it, `skip`'s left out), the screen's policy, the floats. */
export function serialize<I, L>(s: LayoutState<I>, leafOf: (id: I) => L, skip?: (id: I) => boolean): { root: ReturnType<typeof serializeTree<I, L>>; policy?: Policy; floats?: { tile: L; rect: Rect }[] } {
  let root: LNode<I> | null = s.tree;
  if (skip) { root = clone(s.tree); for (const id of leaves(s.tree)) if (skip(id) && root) root = remove(root, id); }
  return {
    root: serializeTree(root ?? s.tree, leafOf),
    ...(Object.keys(s.policy).length ? { policy: { ...s.policy } } : {}),
    ...(s.floats.length ? { floats: s.floats.filter(f => !skip?.(f.id)).map(f => ({ tile: leafOf(f.id), rect: { ...f.rect } })) } : {}),
  };
}

// ── one step: an operation applied to the draft, its rules checked as it goes ──

/** The fewest cells a float has (unless the screen itself is smaller). */
export const FLOAT_MIN = { cols: 20, rows: 5 };

const AGENT_ORDER: Record<AgentLevel, number> = { free: 0, edit: 1, off: 2 };

class Step<I> {
  constructor(private readonly d: Draft<I>, private readonly ctx: Ctx<I>) {}
  private get agent() { return this.ctx.actor.kind === "agent"; }
  private name(id: I) { return this.d.names.get(id) ?? String(id); }
  private facts(id: I): TileFacts { return this.ctx.tile(id); }
  private isFloat(id: I) { return this.d.floats.some(f => f.id === id); }
  private all() { return [...leaves(this.d.tree), ...this.d.floats.map(f => f.id)]; }
  private policyAt(id: I) { return policyAt(this.d, id, this.facts(id)); }
  private ofNode(c: Container<I>) { return policyOfNode(this.d, c); }

  // ── the rules, each in one place ──

  private lockedWhy(e: Effective, what: string): string {
    return e.by.locked === "screen" ? `the screen is locked: ${what} is refused · ${UNLOCK}` : `${e.by.locked} is locked: ${what} is refused · ^W P (or layout.policy node=${e.by.locked} locked=false) unlocks it`;
  }
  /** The container a policy came from, as a person reads it: its key (the lanes), else its id. */
  /** The refusal for tile `id` kept by layer `by`: its kind's own words when its kind's policy is what keeps it, else `said`. */
  private kept(id: I, by: string | undefined, said: string): string {
    const f = this.facts(id);
    return f.stays && by === `${f.kind} tiles` ? f.stays : said;
  }
  private whose(by: string | undefined) {
    if (by === "screen") return "the screen";
    const key = by === undefined ? undefined : (nodeById(this.d.tree, by) as { key?: string } | null)?.key;
    return key ? `the ${key} container` : by;
  }
  /** The shape can't change around tile `id`: it, or a container over it, is locked. */
  private shape(id: I, what: string) { const e = this.policyAt(id); refuse(e.locked ? this.lockedWhy(e, what) : null); }
  /** A float has no place in the tree: whatever needs one waits until it's back in the layout. */
  private notFloat(id: I, what: string) {
    refuse(this.isFloat(id) ? `${this.name(id)} is a float: ${what} needs a tile in the layout · ^W f (o on the board) or a click on its ⧉ puts it back first` : null);
  }
  /** An agent never moves, floats or pins the tile the person is typing in. */
  private guard(id: I, what: string) {
    refuse(this.agent && this.ctx.person.typingIn === id ? `${this.name(id)} is where the person is typing; an agent doesn't ${what} it` : null);
  }
  /**
   * An agent never resizes the tile the person is typing in (a border moved, a split's shares, a tile grown, the
   * screen evened out): the size it has on screen after the step is the size it had before, or the step is refused.
   */
  private keepsSize(step: () => void) {
    const t = this.agent ? this.ctx.person.typingIn : null;
    if (t === null || !has(this.d.tree, t)) return step();
    const before = shareOf(this.d.tree, t);
    step();
    const after = shareOf(this.d.tree, t);
    // Its share of the screen along each axis, from the weights (not cells, which round as other borders move).
    const moved = (["row", "col"] as const).some(a => Math.abs(after[a] - before[a]) > 1e-9);
    if (moved) refuse(`${this.name(t)} is where the person is typing; an agent doesn't resize it (block.mark gets their attention)`);
  }
  /** An agent doesn't move the person's keys while they type. */
  private mayMoveKeys(what: string) {
    const p = this.ctx.person;
    refuse(!this.agent ? null : p.held !== undefined ? (p.held ? `${p.held} · an agent doesn't ${what} now` : null) : p.busy ? `the person is typing; an agent doesn't ${what} (block.mark gets their attention)` : null);
  }
  /** Tile `id` can't leave where it is: locked, or its container keeps its tiles (draggable off). */
  private drag(id: I) {
    const e = this.policyAt(id);
    if (e.locked) refuse(this.lockedWhy(e, `moving ${this.name(id)}`));
    if (!e.draggable) refuse(this.kept(id, e.by.draggable, `${this.name(id)} stays where it is: ${this.whose(e.by.draggable)} keeps its tiles in place · ^W P there turns draggable on`));
  }
  /**
   * A tile of `kind` can't go where `to` says: the container there is locked, takes no drops, or takes only other
   * kinds; or the tile it would join as a tab takes only other kinds. Nothing goes beside a float or into its tabs.
   */
  private into(kind: string, label: string, to: At<I>) {
    // A place by a tile that isn't here is no place: refused, never a tile left out of the tree.
    if (to.kind === "split" || to.kind === "tabs") { this.present(to.target); this.notFloat(to.target, `putting ${label} ${to.kind === "tabs" ? "into its tabs" : "beside it"}`); }
    let e: Effective, there: string;
    if (to.kind === "tabs") { e = this.policyAt(to.target); there = this.name(to.target); }
    else if (to.kind === "split") {
      // The containers it would join: the target's chain, not its tab set or kind (it doesn't join those).
      const chain = chainOf(this.d.tree, to.target);
      const joins = chain.at(-1)?.t === "tabs" ? chain.slice(0, -1) : chain;
      e = effective([{ by: "screen", policy: this.d.policy }, ...joins.map(c => ({ by: c.id ?? c.t, policy: c.policy }))]);
      there = this.name(to.target);
    } else if (to.kind === "edge") {
      e = effective([{ by: "screen", policy: this.d.policy }, ...(this.d.tree.t !== "leaf" ? [{ by: this.d.tree.id ?? this.d.tree.t, policy: this.d.tree.policy }] : [])]);
      there = `the ${to.dir} edge`;
    } else if (to.kind === "in") {
      const line = node(this.d.tree, to.key);
      if (!line) refuse(`there's no ${to.key} in the layout for ${label}`);
      e = this.ofNode(line!); there = to.key;
    } else if (to.kind === "next") {
      const f = flowHolding(this.d.tree, to.from);
      if (!f) refuse(`${this.name(to.from)} isn't in a flow: nothing opens into a next column there`);
      e = this.ofNode(f!.flow); there = `the column after ${this.name(to.from)}`;
    } else {
      // A float is a new place of its own: the screen's lock (and that of the place it floats over) is all that refuses it.
      e = to.near !== undefined && has(this.d.tree, to.near) ? this.policyAt(to.near) : effective([{ by: "screen", policy: this.d.policy }]);
      there = "a float";
    }
    if (e.locked) refuse(this.lockedWhy(e, `putting ${label} by ${there}`));
    if (to.kind === "float") return;
    if (!e.droppable) refuse(`${this.whose(e.by.droppable)} takes no drops: ${label} can't go by ${there} · ^W P there turns droppable on`);
    if (e.accepts && !e.accepts.includes(kind)) refuse(`${this.whose(e.by.accepts)} takes only ${e.accepts.join(", ") || "nothing"}: not ${label} (${kind})`);
    const t = to.kind === "tabs" ? this.facts(to.target) : undefined;
    if (t?.tabs && !t.tabs.includes(kind)) refuse(`${there} (${t.kind}) takes only ${t.tabs.join(", ") || "no tiles"} as tabs: not ${label} (${kind})`);
  }
  /** A border of container `n` can't move: locked, not resizable, a kid beside it with a fixed size, or a flow. */
  private resizeWhy(n: Container<I>, border?: number): string | null {
    const e = this.ofNode(n);
    if (e.locked) return this.lockedWhy(e, "resizing");
    if (!e.resizable) return `${this.whose(e.by.resizable)} keeps its sizes · ^W P there turns resizable on`;
    if (n.t === "flow") return `${n.id ?? "the flow"} sizes its columns itself: ^W W (tile.widen) gives one the wide place`;
    if (isLine(n) && border !== undefined) for (const k of [n.kids[border], n.kids[border + 1]]) if (k && k.t !== "leaf" && k.policy?.resizable === false) return `${k.id ?? k.t} keeps its size · ^W P there turns resizable on`;
    if (isLine(n) && border !== undefined) for (const k of [n.kids[border], n.kids[border + 1]]) if (k && k.t !== "leaf" && k.policy?.fixed !== undefined) return `${k.id ?? k.t} is fixed at ${k.policy.fixed} cells (layout.policy node=${k.id} fixed=-1 frees it)`;
    return null;
  }

  run(op: Op<I>) {
    const out = this.dispatch(op);
    this.reconcileFolds();
    return out;
  }
  /**
   * After any operation: a fold that doesn't fit where its tile is now (not side by side, not stacked, or gone with the
   * split around it) opens, and a tab set is folded or open as one, by the tab it shows.
   */
  private reconcileFolds() {
    const seen = new Set<I>();
    for (const id of [...this.d.collapsed.keys()]) {
      if (seen.has(id)) continue;
      const set = has(this.d.tree, id) ? this.foldSet(id) : [id];
      for (const t of set) seen.add(t);
      const tabs = tabsOf(this.d.tree, id);
      const f = this.d.collapsed.get(tabs ? tabs.ids[tabs.active]! : id);
      if (!f || !has(this.d.tree, id) || !foldFits(f, parentOf(this.d.tree, id)?.parent.dir)) for (const t of set) this.d.collapsed.delete(t);
      else for (const t of set) this.d.collapsed.set(t, { ...f });
    }
  }
  private dispatch(op: Op<I>) {
    if (this.agent) this.agentGate(op);
    switch (op.op) {
      case "open": return this.open(op);
      case "close": return this.close(op.tile, !!op.gone);
      case "replace": return this.replace(op);
      case "take": return this.take(op.tile, op.heir);
      case "move": return this.move(op.tile, op.to);
      case "swap": return this.swap(op.tile, op.with);
      case "float":
        // Popping a tile out or putting it back moves the tile the person has: an agent doesn't, typing or not (as it
        // doesn't close or fold it).
        if (this.agent && op.tile === this.d.focus) refuse(`${this.name(op.tile)} has the person's keys; an agent doesn't float it`);
        return this.isFloat(op.tile) ? this.land(op.tile, op.at) : this.float(op.tile);
      case "place": return this.place(op);
      case "pin": return this.pin(op.tile, op.on, op.edge, op.container);
      case "slide": return this.slide(op.tile, op.open, op.container);
      case "collapse": return this.collapse(op.tile, op.on, op.dir);
      case "resize": return this.keepsSize(() => this.resizeBorder(op));
      case "shares": return this.keepsSize(() => this.shares(op.split, op.shares));
      case "grow": return this.keepsSize(() => this.grow(op.tile, op.axis, op.by));
      case "even": return this.keepsSize(() => this.even());
      case "lock": return this.lock(op.on);
      case "agents": return this.setAgents(op.tile, op.level);
      case "policy": return this.setPolicy(op);
      case "link": return this.link(op.tile, op.to);
      case "focus": return this.focus(op.tile, !!op.quiet);
      case "reveal": return this.reveal(op.tile);
      case "tab": return this.tab(op.tile, op.by);
      case "zoom": return this.zoom(op.tile, op.on);
      case "load": return this.load(op.name);
      case "fill": return this.fill(op);
      case "source": return this.source(op.container, op.source);
      case "flow.widen": return this.widen(op.tile);
      case "flow.travel": return this.travel(op.tile, op.dir);
      case "flow.hold": return this.holdColumn(op.tile, op.on);
      case "remember": return this.rememberPolicy(op.key, op.policy);
    }
  }

  /**
   * What an agent may do to a tile (PIE-639): an operation that navigates, moves, closes or retargets a tile whose level
   * is `edit` or `off` is refused, whichever caller asked. The person's own operations never come here.
   */
  private agentGate(op: Op<I>) {
    // `only: "off"`: the level that refuses it (resizing a split moves no limited tile; a hands-off one is not touched).
    const no = (id: I, what: string, only?: "off") => {
      if (!this.all().includes(id)) return;
      const { level, by } = agentLevel(this.d, id, this.facts(id));
      if (only && level !== only) return;
      refuse(agentRefusal(level, this.name(id), what, { by }));
    };
    const each = (ids: I[], what: string, only?: "off") => { for (const id of ids) no(id, what, only); };
    const under = (n: LNode<I> | null | undefined) => (n ? leaves(n) : []);
    switch (op.op) {
      case "close": return no(op.tile, "closing it");
      case "replace": return no(op.tile, "replacing it");
      case "take": return no(op.tile, "taking it away");
      case "move": no(op.tile, "moving it"); if (op.to.kind === "tabs") no(op.to.target, "putting another tile in its tabs"); return;
      case "swap": no(op.tile, "swapping it"); return no(op.with, "swapping it");
      case "float": return no(op.tile, "floating it");
      case "place": return op.tile !== undefined ? no(op.tile, "moving or sizing it") : undefined;
      case "pin": return op.container ? each(under(nodeById(this.d.tree, op.container)), "docking it") : no(op.tile, "docking it");
      case "slide": {
        // Sliding a dock shut hides every tile in it.
        const nd = op.container ? nodeById(this.d.tree, op.container) : null;
        return each(under(nd?.t === "dock" ? nd : dockOf(this.d.tree, op.tile)), "sliding its dock", undefined);
      }
      case "collapse": return no(op.tile, "folding it");
      case "grow": return no(op.tile, "resizing it", "off");
      case "resize": { const n = op.split !== undefined ? nodeById(this.d.tree, op.split) : nodeAt(this.d.tree, op.path ?? ""); return isLine(n as LNode<I>) ? each([...under((n as Line<I>).kids[op.border]), ...under((n as Line<I>).kids[op.border + 1])], "resizing it", "off") : undefined; }
      case "shares": return each(under(nodeById(this.d.tree, op.split)), "resizing it", "off");
      case "even": return each(this.all(), "evening out the layout (it resizes it)", "off");
      case "link": no(op.tile, "changing where its opens land"); if (op.to !== undefined) no(op.to, "linking opens into it"); return;
      case "tab": { const ts = tabsOf(this.d.tree, op.tile); no(op.tile, "switching its tabs"); return ts ? no(ts.ids[ts.active]!, "hiding it by switching tabs") : undefined; }
      case "zoom": return no(op.tile, "zooming it");
      case "flow.widen": case "flow.travel": case "flow.hold": return no(op.tile, "widening, holding or travelling it");
      case "load": return each(this.all(), `laying the screen out as ${op.name} (it replaces the tiles)`);
      case "open": if (op.at.kind === "tabs") no(op.at.target, "opening a tile into its tabs"); return;
      case "agents": {
        // An agent may tighten a tile's level (free to edit, edit to off), never loosen it: the person's command frees it.
        const was = agentLevel(this.d, op.tile, this.facts(op.tile)), want = op.level ?? policyAt(this.d, op.tile, this.facts(op.tile)).agents;
        refuse(AGENT_ORDER[want] < AGENT_ORDER[was.level] ? agentRefusal(was.level, this.name(op.tile), "loosening its own limit", { by: was.by }) : null);
        return;
      }
      case "policy": {
        // The same for a container's or the screen's default: it may be tightened, never loosened or cleared.
        if (op.set.agents === undefined && !op.clear.includes("agents")) return;
        const chain = op.tile !== undefined ? chainOf(this.d.tree, op.tile) : [];
        const c = op.node === "screen" ? "screen" : op.node ? nodeById(this.d.tree, op.node) : chain.at(-1) ?? "screen";
        if (!c) return;
        const layersWith = (agents: AgentLevel | undefined) => {
          const own = (pol: Policy | undefined) => { const { agents: _a, ...rest } = pol ?? {}; return agents ? { ...rest, agents } : rest; };
          return c === "screen" ? [{ by: "screen", policy: own(this.d.policy) }]
            : [{ by: "screen", policy: this.d.policy }, ...nodeChain(this.d.tree, c).map(x => ({ by: x.id ?? x.t, policy: x === c ? own(x.policy) : x.policy, flow: x.t === "flow" }))];
        };
        const was = effective(layersWith((c === "screen" ? this.d.policy : c.policy)?.agents)).agents;
        const now = effective(layersWith(op.set.agents)).agents;
        const by = c === "screen" ? "screen" : c.id ?? c.t;
        refuse(AGENT_ORDER[now] < AGENT_ORDER[was] ? agentRefusal(was, by === "screen" ? "the screen" : by, "loosening its default", { by, command: `^W P, or layout.policy node=${by} agents=free` }) : null);
        return;
      }
    }
  }
  /** Tile `id`'s own level (PIE-639); `null` takes it away, so the container's and the screen's say again. */
  private setAgents(id: I, level: AgentLevel | null) {
    this.present(id);
    const before = this.d.agents.get(id) ?? null;
    if (before === level) { this.d.changed = false; this.d.answer = { tile: this.name(id), agents: agentLevel(this.d, id, this.facts(id)).level, changed: false }; return; }
    if (level === null) this.d.agents.delete(id); else this.d.agents.set(id, level);
    this.d.answer = { tile: this.name(id), agents: agentLevel(this.d, id, this.facts(id)).level, own: level !== null, changed: true };
  }

  private present(id: I) { refuse(this.all().includes(id) ? null : `no tile ${this.name(id)} in the layout`); }

  /** A tile put at a place in the tree: beside a tile, into its tabs, along an outer edge, into a named line, or the next column. */
  private putAt(id: I, at: At<I>) {
    const t = this.d.tree;
    if (at.kind === "edge") this.d.tree = edge(t, id, at.dir);
    else if (at.kind === "tabs") this.d.tree = tabInto(t, at.target, id, at.index);
    else if (at.kind === "split") this.d.tree = besideSlot(t, at.target, leaf(id), at.dir);
    else if (at.kind === "in") this.d.tree = insert(t, at.key, leaf(id), at.weight ?? 1, at.index);
    else if (at.kind === "next") {
      const f = flowHolding(t, at.from)!;
      f.flow.kids.splice(f.ci + 1, 0, leaf(id)); f.flow.weights.splice(f.ci + 1, 0, 1);
    }
    this.d.tree = normalise(this.d.tree);
  }

  private open(op: Extract<Op<I>, { op: "open" }>) {
    if (this.all().includes(op.tile)) {
      // Opened into the next column, onto a tile already there: the person goes to it (back returns where they came from).
      if (op.at.kind === "next") return this.reach(op.tile, op.at.from);
      refuse(`${this.name(op.tile)} is in the layout already`);
    }
    let name = op.name;
    if (name !== undefined && named(this.d, name) !== undefined) { if (op.loose) name = undefined; else refuse(`there's already a tile named ${name}`); }
    const label = name ?? `a new ${op.kind} tile`;
    this.into(op.kind, label, op.at);
    this.d.names.set(op.tile, name ?? autoName(this.d, op.kind));
    if (op.at.kind === "float") {
      const r = op.at.rect ?? this.newFloatRect();
      this.d.floats.push({ id: op.tile, rect: this.onScreen({ ...r }) });
    } else {
      const wasShown = shown(this.d.tree);
      this.putAt(op.tile, op.at);
      // An agent's new tab is added without being shown over the tab the person has there.
      if (this.agent && wasShown.includes(this.d.focus) && !shown(this.d.tree).includes(this.d.focus)) activate(this.d.tree, this.d.focus);
      if (op.at.kind === "next") {
        const f = flowHolding(this.d.tree, op.tile)!;
        setFrom(f.flow, f.ci, op.at.from);
      }
    }
    this.d.zoom = null;
    // The person's new tile takes their keys (unless the view gives them elsewhere: `keys: false`); an agent's never does.
    if (!this.agent && op.keys !== false) {
      const from = op.at.kind === "next" ? op.at.from : undefined;
      this.give(op.tile);
      if (from !== undefined) { const f = flowHolding(this.d.tree, op.tile)!; arrive(f.flow, f.ci, columnOf(f.flow, from), coversOf(this.d, f.flow, this.ctx.area, id => !!this.facts(id).holds)); }
    }
    // Opened as where another tile's opens land (tile.preview): linked in the same step, by link's rules.
    if (op.link !== undefined) this.linkTo(op.link, op.tile, this.ctx.kinds ? this.ctx.kinds.notes.includes(op.kind) : true, op.kind);
    this.d.answer = { tile: this.d.names.get(op.tile), ...(op.link !== undefined ? { link: this.name(op.link) } : {}) };
  }
  /** The person's open found the column already open: back from there returns to where they opened it from. */
  private reach(id: I, from: I) {
    const f = flowHolding(this.d.tree, id);
    if (!f) refuse(`${this.name(id)} isn't in a flow`);
    if (this.agent) { this.d.changed = false; return; }
    const fromCol = columnOf(f!.flow, from);
    if (fromCol >= 0 && fromCol !== f!.ci) setFrom(f!.flow, f!.ci, from);
    this.give(id);
    arrive(f!.flow, f!.ci, fromCol, coversOf(this.d, f!.flow, this.ctx.area, x => !!this.facts(x).holds));
  }
  /** The person's keys go to tile `id`; in a flow, the column they leave is the one they were reading. */
  private give(id: I) {
    const was = this.d.focus;
    const f = flowHolding(this.d.tree, id);
    if (f && was !== id) { const wf = flowHolding(this.d.tree, was); if (wf?.flow === f.flow && wf.ci !== f.ci) f.flow.read = was; }
    this.d.focus = id;
  }

  private close(id: I, gone: boolean) {
    this.present(id);
    const name = this.name(id), f = this.facts(id);
    if (!gone) {
      // A tile that stays says so first, to anyone: its container's rule, not who asked.
      this.shape(id, `closing ${name}`);
      const e = this.policyAt(id);
      const fold = e.collapsible ? " · tile.collapse folds it to a spine" : "";
      // An edit in it is said first: it's what the person would lose.
      if (f.editing) refuse(`not closed: it holds ${f.editing} · e or ⏎ enters it`);
      // A tab set of one holding the rule is the tile's own place (the board's preview, the river's library).
      const own = chainOf(this.d.tree, id).find(c => c.id === e.by.closable && c.t === "tabs" && c.ids.length === 1);
      if (!e.closable) refuse(own ? `${name} stays: its place (${own.id}) keeps it${fold} · ^W P there turns closable on` : this.kept(id, e.by.closable, `${name} stays: ${this.whose(e.by.closable)} keeps its tiles${fold} · ^W P there turns closable on`));
      if (f.keeps) refuse(`${name} stays: ${f.keeps}${fold}`);
      if (!this.isFloat(id) && leaves(this.d.tree).length <= 1) refuse("the screen's last tile stays");
      if (this.agent && id === this.d.focus) refuse(`${name} has the person's keys; an agent doesn't close it`);
      if (this.agent && f.running) refuse(`${name} is running ${f.running}; an agent doesn't end it`);
    }
    this.lift(id);
    this.d.answer = { tile: name };
  }
  /**
   * A new tile takes tile `id`'s place, and `id` goes (the blank tile's rows: an outline, a reader, a terminal where it
   * was). It's a close of `id` and an open where it was in one step, so both sets of rules ask: never a tile that holds
   * work or that its place keeps, never into a locked shape or a container that doesn't take the new kind; an agent's
   * never the tile with the person's keys. The person's keys go to the new tile when they were on the old one.
   */
  private replace(op: Extract<Op<I>, { op: "replace" }>) {
    const id = op.tile;
    this.present(id);
    if (this.all().includes(op.with)) refuse(`${this.name(op.with)} is in the layout already`);
    const name = this.name(id), f = this.facts(id);
    this.shape(id, `replacing ${name}`);
    if (f.editing) refuse(`${name} holds ${f.editing} · e or ⏎ enters it`);
    if (f.running) refuse(`${name} is running ${f.running}: ^W x ends it first`);
    if (f.holds) refuse(`${name} holds work: ^W x closes it first`);
    if (f.keeps) refuse(`${name} stays: ${f.keeps}`);
    const e = this.policyAt(id);
    if (!e.closable) refuse(this.kept(id, e.by.closable, `${name} stays: ${this.whose(e.by.closable)} keeps its tiles · ^W P there turns closable on`));
    if (e.accepts && !e.accepts.includes(op.kind)) refuse(`${this.whose(e.by.accepts)} takes only ${e.accepts.join(", ") || "nothing"}: not a ${op.kind} tile`);
    // The person's keys on it: an agent replaces only a place holder (the blank tile), and never where they're typing.
    if (this.agent && id === this.d.focus && !f.placeholder) refuse(`${name} has the person's keys; an agent doesn't replace it`);
    this.guard(id, "replace");
    let newName = op.name;
    if (newName !== undefined && named(this.d, newName) !== undefined && named(this.d, newName) !== id) refuse(`there's already a tile named ${newName}`);
    const float = this.d.floats.find(x => x.id === id);
    if (float) float.id = op.with; else swapLeaf(this.d.tree, id, op.with);
    const had = this.d.focus === id;
    this.forget(id);
    this.d.names.set(op.with, newName ?? autoName(this.d, op.kind));
    if (had) this.d.focus = op.with;
    this.d.answer = { tile: this.d.names.get(op.with), replaced: name };
  }
  /**
   * A tile leaves this layout whole (into your drawer, or from it to a screen): its program, note and history
   * go with it, so nothing is closed. It moves, so the move rules ask: not out of a locked shape or a container that
   * keeps its tiles, never the tile the person types in (nor, for an agent, the one with their keys), never the last.
   * `heir`: a new tile takes its place, its name and its keys (the drawer's own tab, whose next program starts there).
   */
  private take(id: I, heir?: { id: I; name?: string }) {
    this.present(id);
    const name = this.name(id);
    this.guard(id, "move");
    this.drag(id);
    // A tile its place keeps (closable off: the river's Library, the board's preview) or its source supplies (a lane)
    // stays: taken away, the screen's save would come back without it. A kind that only doesn't close (its `stays`)
    // still leaves whole.
    const e = this.policyAt(id), f = this.facts(id);
    if (!e.closable && !(f.stays && e.by.closable === `${f.kind} tiles`)) refuse(`${name} stays: ${this.whose(e.by.closable)} keeps it · ^W P there turns closable on`);
    if (f.keeps) refuse(`${name} stays: ${f.keeps}`);
    if (!heir && !this.isFloat(id) && leaves(this.d.tree).length <= 1) refuse(`${name} is the screen's last tile: it stays (the screen is never blank)`);
    if (this.agent && this.ctx.person.here !== false && id === this.d.focus) refuse(`${name} has the person's keys; an agent doesn't take it away`);
    if (heir) {
      if (this.all().includes(heir.id)) refuse(`${this.name(heir.id)} is in the layout already`);
      const float = this.d.floats.find(x => x.id === id);
      if (float) float.id = heir.id; else swapLeaf(this.d.tree, id, heir.id);
      const had = this.d.focus === id;
      this.forget(id);
      this.d.names.set(heir.id, heir.name ?? name);
      if (had) this.d.focus = heir.id;
    } else this.lift(id);
    this.d.answer = { tile: name, taken: true, ...(heir ? { heir: this.d.names.get(heir.id) } : {}) };
  }
  /** Tile `id` out of the tree (or the floats), its flow column passed on, the keys to its heir. */
  private lift(id: I) {
    const float = this.isFloat(id);
    // Its flow column goes with it: the wide place and the one kept full pass on as the river's do, and the keys
    // go to the column before it (the one after, for the first), as the river's do.
    const fl = float ? null : flowHolding(this.d.tree, id);
    const alone = !!fl && leaves(fl.flow.kids[fl.ci]!).length === 1;
    const heir = fl && alone ? tileOfColumn(fl.flow, fl.ci > 0 ? fl.ci - 1 : fl.ci + 1) : undefined;
    if (fl && alone) leaving(fl.flow, fl.ci, coversOf(this.d, fl.flow, this.ctx.area, x => !!this.facts(x).holds));
    const next = float ? this.d.tree : remove(this.d.tree, id);
    if (!next) { this.d.changed = false; return; }
    this.d.tree = normalise(next);
    this.forget(id);
    if (this.d.focus === id) this.d.focus = (heir !== undefined && has(this.d.tree, heir) ? heir : undefined) ?? visible(this.d.tree).find(x => !this.d.collapsed.has(x)) ?? visible(this.d.tree)[0] ?? this.all()[0]!;
  }
  /** A tile gone: its float, its spine, its name, its links and those to it. */
  private forget(id: I) {
    this.d.floats = this.d.floats.filter(f => f.id !== id);
    this.d.collapsed.delete(id); this.d.agents.delete(id);
    this.d.names.delete(id); this.d.links.delete(id);
    for (const [from, to] of this.d.links) if (to === id) this.d.links.delete(from);
    if (this.d.zoom === id) this.d.zoom = null;
  }

  private move(src: I, to: Place<I>) {
    this.present(src);
    // A tile dropped onto a spine opens it first, in the same step: a refused move leaves the fold as it was.
    if ("target" in to && to.target !== src) for (const t of this.foldSet(to.target)) this.d.collapsed.delete(t);
    this.guard(src, "move");
    this.drag(src);
    this.into(this.facts(src).kind, this.name(src), to);
    // A float moved into the tree lands there: it isn't a float any more.
    if (this.isFloat(src)) {
      this.d.floats = this.d.floats.filter(f => f.id !== src);
      this.putAt(src, to);
      if (!this.agent) this.d.focus = src;
      return;
    }
    const next = move(this.d.tree, src, to);
    if (!next) refuse(`${this.name(src)} can't go there: ${leaves(this.d.tree).length < 2 ? "it's the only tile" : "that's where it is"}`);
    this.d.tree = next!;
    // A spine moved where it isn't side by side with others opens.
    this.unfoldMisfit(src);
    // Moved into a shut dock (its handle), the dock opens for the person; an agent's leaves it as it was. An
    // agent's move of the tile the person has into a shut dock opens it too: their tile never vanishes.
    const wasShown = visible(this.d.tree);
    for (const c of chainOf(this.d.tree, src)) if (c.t === "dock" && !c.open && (!this.agent || src === this.d.focus)) c.open = true;
    activate(this.d.tree, src);
    // An agent's move into the tabs the person has open leaves their tab shown.
    if (this.agent && wasShown.includes(this.d.focus) && !shown(this.d.tree).includes(this.d.focus)) activate(this.d.tree, this.d.focus);
    this.d.zoom = null;
    if (!this.agent) this.d.focus = src;
  }

  private swap(a: I, b: I) {
    this.present(a); this.present(b);
    if (a === b) refuse("a tile can't swap with itself");
    this.guard(a, "move"); this.guard(b, "move");
    this.notFloat(a, "a swap"); this.notFloat(b, "a swap");
    this.drag(a); this.drag(b);
    this.into(this.facts(a).kind, this.name(a), { kind: "tabs", target: b });
    this.into(this.facts(b).kind, this.name(b), { kind: "tabs", target: a });
    const go = (n: LNode<I>): LNode<I> => {
      if (n.t === "leaf") return n.id === a ? leaf(b) : n.id === b ? leaf(a) : n;
      if (n.t === "tabs") return { ...n, ids: n.ids.map(x => (x === a ? b : x === b ? a : x)) };
      if (n.t === "dock") return { ...n, kid: go(n.kid) };
      return { ...n, kids: n.kids.map(go) };
    };
    this.d.tree = go(this.d.tree);
    // A spine swapped where it isn't side by side with others opens, as a move does.
    for (const id of [a, b]) this.unfoldMisfit(id);
  }

  /** Where a new float goes: half the screen, a little lower and to the right of the last one. */
  private newFloatRect(): Rect {
    const a = this.ctx.area, n = this.d.floats.length;
    return { col: Math.round(a.cols * 0.22) + n * 3, row: a.row + Math.round(a.rows * 0.12) + n * 2, cols: Math.round(a.cols * 0.5), rows: Math.round(a.rows * 0.6) };
  }
  /** A float's rectangle kept on the screen: never smaller than a float is drawn, never off it. */
  private onScreen(r: Rect): Rect { return keepOnScreen(r, this.ctx.area); }

  private float(id: I) {
    this.present(id);
    this.guard(id, "float");
    this.drag(id);
    if (leaves(this.d.tree).length < 2) refuse(`${this.name(id)} is the only tile in the layout; there's nothing for it to float over`);
    this.d.tree = normalise(remove(this.d.tree, id)!);
    this.d.collapsed.delete(id);
    this.d.floats.push({ id, rect: this.onScreen(this.newFloatRect()) });
    if (!this.agent) this.d.focus = id;
    this.d.zoom = null;
    this.d.answer = { floated: true };
  }
  /**
   * A float back in the layout: where `at` says (else beside the tile the person has, or the last pinned tile), when the
   * containers there take it (locked, droppable, accepts, as any move asks); else beside the first pinned tile whose
   * containers do, else along an outer edge; refused, with the first place's reason, when nothing takes it.
   */
  private land(id: I, at?: At<I>) {
    this.guard(id, "float");
    const e = effective([{ by: "screen", policy: this.d.policy }]);
    if (e.locked) refuse(this.lockedWhy(e, `putting ${this.name(id)} back`));
    const kind = this.facts(id).kind, name = this.name(id);
    const why = (next: LNode<I>): string | null => {
      if (!has(next, id)) return `there's no place for ${name} in the layout`;
      const e = effective([{ by: "screen", policy: this.d.policy }, ...chainOf(next, id).map(c => ({ by: c.id ?? c.t, policy: c.policy }))]);
      if (e.locked) return this.lockedWhy(e, `putting ${name} back`);
      if (!e.droppable) return `${this.whose(e.by.droppable)} takes no drops: ${name} doesn't land there · ^W P there turns droppable on`;
      if (e.accepts && !e.accepts.includes(kind)) return `${this.whose(e.by.accepts)} takes only ${e.accepts.join(", ") || "nothing"}: not ${name} (${kind})`;
      return null;
    };
    // Where the float would land at `to`, the tree as it is left alone.
    const tryAt = (to: At<I>): LNode<I> => {
      const keep = this.d.tree;
      this.d.tree = clone(keep);
      try { this.putAt(id, to); return this.d.tree; } finally { this.d.tree = keep; }
    };
    const focus = this.d.focus;
    const base = this.isFloat(focus) || focus === id || !has(this.d.tree, focus) ? (pinnedTiles(this.d.tree).at(-1) ?? leaves(this.d.tree).at(-1)!) : focus;
    const first = tryAt(at ?? { kind: "split", target: base, dir: "right" });
    const refused = why(first);
    let next: LNode<I> | null = refused ? null : first;
    if (!next) {
      // Beside a pinned tile only: one in a dock would put the float where it isn't shown (a shut dock).
      const tries: At<I>[] = [...pinnedTiles(this.d.tree).map(t => ({ kind: "split" as const, target: t, dir: "right" as const })), ...(["right", "down", "left", "up"] as Dir[]).map(dir => ({ kind: "edge" as const, dir }))];
      for (const t of tries) { const n = tryAt(t); if (!why(n)) { next = n; break; } }
    }
    if (!next) refuse(refused);
    this.d.tree = next!;
    this.d.floats = this.d.floats.filter(f => f.id !== id);
    this.d.answer = { floated: false };
  }

  private place(op: Extract<Op<I>, { op: "place" }>) {
    const focus = this.d.focus;
    const id = op.tile !== undefined ? op.tile : this.isFloat(focus) ? focus : this.d.floats.at(-1)?.id;
    const f = id !== undefined ? this.d.floats.find(x => x.id === id) : undefined;
    if (id === undefined || !f) refuse(`${id !== undefined ? this.name(id) : "no tile"} isn't a float; tile.float (o on the board) pops a tile out as one`);
    this.guard(id!, "move");
    // Moving or sizing a float changes the screen's shape: refused while it's locked (as any move is).
    this.shape(id!, `moving ${this.name(id!)}`);
    const r = { ...f!.rect };
    if (op.cols !== undefined) r.cols = op.cols;
    if (op.rows !== undefined) r.rows = op.rows;
    r.col = op.col ?? r.col + (op.dx ?? 0);
    r.row = op.row ?? r.row + (op.dy ?? 0);
    f!.rect = this.onScreen(r);
    this.d.answer = { tile: this.name(id!), rect: { ...f!.rect } };
  }

  /** What a dock's policy is remembered by: the container it held, else its tile. */
  private dockKey(dr: Dock<I>): string { return dr.kid.t === "leaf" ? `t${String(dr.kid.id)}` : dr.kid.id ?? `t${String(leaves(dr.kid)[0])}`; }
  private remember(dr: Dock<I> | null, key: string) { const p = this.d.remembered.get(key); if (dr && p && !dr.policy) dr.policy = { ...p }; }

  private pin(id: I, on: boolean | undefined, edgeTo: Dir | undefined, container?: string) {
    this.present(id);
    // A float goes into a dock in one step: it lands back in the layout (where the containers take it, as ^W f
    // would), then its dock wraps it, both in this one transaction (refused whole, it stays the float it was).
    // on=true puts it back pinned outright.
    if (this.isFloat(id)) {
      if (this.agent && id === this.d.focus) refuse(`${this.name(id)} has the person's keys; an agent doesn't move it`);
      if (container !== undefined) refuse(`${this.name(id)} is a float: no container holds it · tile.dock without container= puts it in a dock of its own`);
      this.land(id);
      if (on === true) { this.d.answer = { pinned: true, floated: false }; return; }
      on = false;
    }
    const name = this.name(id), focus = this.d.focus;
    // A whole container (a split of tiles: the board's outline and its preview) goes into a dock as one.
    if (container !== undefined && on !== true) {
      const c = nodeById(this.d.tree, container);
      if (!c || c.t === "dock") refuse(`no container ${container} to put in a dock; layout.get gives each one's id`);
      if (!leaves(c!).includes(id)) refuse(`${container} doesn't hold ${name}`);
      if (leaves(c!).includes(focus)) this.guard(focus, "move");
      const inDock = dockOf(this.d.tree, id);
      const chain = chainOf(this.d.tree, id);
      if (inDock && chain.indexOf(inDock) < chain.indexOf(c!) && (!edgeTo || inDock.edge === edgeTo)) {
        this.d.changed = false;
        this.d.answer = { pinned: false, changed: false, edge: inDock.edge, container: inDock.id };
        return;
      }
      this.shape(id, `putting ${container} in a dock`);
      const open = !this.agent || leaves(c!).includes(focus);
      const next = inDock && edgeTo ? dockToEdge(this.d.tree, inDock, edgeTo) : wrapNodeDock(this.d.tree, c!, edgeTo, open);
      if (!next) refuse(`${container} is the whole layout, holds every tile not docked, or is docked already; a dock needs something to slide over`);
      this.d.tree = normalise(next!);
      const now = dockOf(this.d.tree, id);
      if (now && !inDock) this.remember(now, container);
      this.d.answer = { pinned: !now, ...(now ? { edge: now.edge, container: now.id, open: now.open } : {}) };
      return;
    }
    const dr = dockOf(this.d.tree, id);
    const pinned = !dr;
    const want = on ?? (edgeTo ? false : !pinned);
    if (want === pinned && !(edgeTo && !want && dr && dr.edge !== edgeTo)) {
      this.d.changed = false;
      this.d.answer = { pinned, changed: false, ...(dr ? { edge: dr.edge, container: dr.id } : {}) };
      return;
    }
    for (const t of tabsOf(this.d.tree, id)?.ids ?? [id]) this.guard(t, "move");
    this.shape(id, want ? `taking ${name} out of its dock` : `putting ${name} in a dock`);
    if (want) { this.d.remembered.set(this.dockKey(dr!), dr!.policy); this.d.tree = normalise(unwrapDock(this.d.tree, dr!)); }
    else if (dr && edgeTo) {
      const next = dockToEdge(this.d.tree, dr, edgeTo);
      if (!next) refuse(`${dr.id ?? "the dock"} holds every tile; there's nothing for it to slide over`);
      this.d.tree = normalise(next!);
    } else {
      // The person's dock opens on what they have; an agent's starts shut unless it holds their keys.
      const open = !this.agent || (tabsOf(this.d.tree, id)?.ids ?? [id]).includes(focus);
      const next = wrapDock(this.d.tree, id, edgeTo, open);
      if (!next) refuse(`${name} is the last tile not docked (or its tab set is the whole layout); a dock needs something to slide over`);
      this.d.tree = normalise(next!);
      const nd = dockOf(this.d.tree, id);
      if (nd) this.remember(nd, this.dockKey(nd));
    }
    const now = dockOf(this.d.tree, id);
    this.d.answer = { pinned: !now, ...(now ? { edge: now.edge, container: now.id, open: now.open } : {}) };
  }

  private slide(id: I, open: boolean | undefined, container?: string) {
    this.present(id);
    const name = this.name(id);
    // The dock named (a handle's, an outer one holding another dock), else the innermost holding the tile.
    const nd = container ? nodeById(this.d.tree, container) : null;
    if (container && nd?.t !== "dock") refuse(`no dock ${container} in the layout; layout.get gives each dock's id (d<n>)`);
    const dr = nd?.t === "dock" ? nd : dockOf(this.d.tree, id);
    if (!dr) refuse(`${name} isn't docked · tile.dock (^W p) docks it`);
    const want = open ?? !dr!.open;
    if (want && this.ctx.screenHost === "none" && has(this.d.tree, HOST_SCREEN as unknown as I)) refuse("the screen shown keeps the whole screen (its host policy is none): the host layer comes back on another screen");
    if (!want && !this.ofNode(dr!).collapsible) refuse(`${dr!.id ?? "the dock"} stays open: it doesn't slide shut · ^W P there turns collapsible on`);
    // Shutting the dock that has the person's keys moves them: the same rule as any move of the keys.
    const inside = leaves(dr!.kid);
    if (!want && inside.includes(this.d.focus)) this.mayMoveKeys("shut the dock they have");
    // The last dock showing anything stays open: shut, the screen would be blank (every tile in a dock).
    if (!want && dr!.open) { dr!.open = false; const none = !visible(this.d.tree).length; dr!.open = true; if (none) refuse(`${dr!.id ?? "the dock"} is all the screen shows: shut, nothing would be left · ^W p on a tile in it undocks it`); }
    if (dr!.open === want) this.d.changed = false;
    dr!.open = want;
    if (want) { if (!this.agent && !this.ctx.person.busy) { this.d.focus = visible(dr!.kid).find(x => x === id) ?? visible(dr!.kid)[0] ?? id; activate(this.d.tree, this.d.focus); } }
    else if (inside.includes(this.d.focus)) this.d.focus = visible(this.d.tree)[0] ?? this.d.focus;
    this.d.answer = { open: want, edge: dr!.edge, ...(dr!.id ? { container: dr!.id } : {}) };
  }

  /** The tiles a fold covers: a tab set folds as one (its shown tab's spine), so each of its tabs carries the fold. */
  private foldSet(id: I): I[] { return tabsOf(this.d.tree, id)?.ids ?? [id]; }
  /** A spine moved or swapped where its fold doesn't fit (not side by side, or not stacked) opens. */
  private unfoldMisfit(id: I) {
    const f = this.d.collapsed.get(id);
    if (f && !foldFits(f, parentOf(this.d.tree, id)?.parent.dir)) for (const t of this.foldSet(id)) this.d.collapsed.delete(t);
  }

  /**
   * Fold `id` to a spine, or open it. `dir` `v` is a vertical spine (tiles side by side), `h` a horizontal one (stacked);
   * none takes the way its split runs. A tab set folds as one and a docked tile in a split of its dock folds there;
   * a dock's lone tile isn't a fold (the desk shuts the dock instead).
   */
  private collapse(id: I, on: boolean | undefined, dir?: "v" | "h") {
    this.present(id);
    const name = this.name(id), was = this.d.collapsed.get(id), want = on ?? !was;
    if (dir !== undefined && dir !== "v" && dir !== "h") refuse(`tile.collapse: dir is v (a vertical spine) or h (a horizontal one), not ${dir}`);
    if (!want && !was) { this.d.changed = false; this.d.answer = { collapsed: false, changed: false }; return; }
    if (!want) { for (const t of this.foldSet(id)) this.d.collapsed.delete(t); this.d.answer = { collapsed: false }; return; }
    const p = parentOf(this.d.tree, id);
    const axis = p?.parent.t === "flow" ? undefined : p?.parent.dir;
    const fold: Fold = (dir ?? (axis === "col" ? "h" : "v")) === "h" ? { dir: "h" } : {};
    // Folded already the way asked for: nothing to do.
    if (was && (was.dir ?? "v") === (fold.dir ?? "v")) { this.d.changed = false; this.d.answer = { collapsed: true, changed: false }; return; }
    this.notFloat(id, "a spine");
    this.shape(id, `folding ${name}`);
    if (!p || p.parent.t === "flow" || !foldFits(fold, axis)) {
      refuse(p?.parent.t === "flow" ? `${name} is a column of a flow: it squeezes to a spine by itself as it recedes (^W W widens it)`
        : !p ? `${name} isn't side by side or stacked with other tiles: only a tile in a row or a column folds to a spine`
        : fold.dir === "h" ? `${name} isn't stacked with other tiles: a horizontal spine needs a tile above or below it (dir=v folds it to a vertical one)`
        : `${name} isn't side by side with other tiles: a vertical spine needs a tile beside it (dir=h folds it to a horizontal one)`);
    }
    const e = this.policyAt(id);
    if (!e.collapsible) refuse(`${name} stays open: ${e.by.collapsible} doesn't fold · ^W P there turns collapsible on`);
    if (this.agent && this.foldSet(id).includes(this.d.focus)) refuse(`${this.name(this.d.focus)} has the person's keys; an agent doesn't fold it`);
    const by = byOf(this.ctx.actor);
    for (const t of this.foldSet(id)) this.d.collapsed.set(t, { ...by, ...fold });
    this.d.answer = { collapsed: true, dir: fold.dir === "h" ? "h" : "v" };
  }

  private resizeBorder(op: Extract<Op<I>, { op: "resize" }>) {
    if ((op.path === undefined) === (op.split === undefined)) refuse("layout.resize names its split by split=<id> (layout.get gives each one), or by path=<p>");
    const n0 = op.split !== undefined ? nodeById(this.d.tree, op.split) : nodeAt(this.d.tree, op.path!);
    if (!n0 || !isLine(n0)) refuse(op.split !== undefined ? `no split ${op.split} in the layout (it's gone: its tiles were moved or closed); layout.get gives each split's id` : `no split at path ${JSON.stringify(op.path)}; layout.get gives each split's path`);
    const n = n0 as Line<I>;
    if (!Number.isInteger(op.border) || op.border < 0 || op.border >= n.kids.length - 1) refuse(`split ${n.id} has borders 0-${n.kids.length - 2}`);
    refuse(this.resizeWhy(n, op.border));
    const border = op.border, f = Math.max(0.08, Math.min(0.92, op.share));
    const sum = n.weights[border]! + n.weights[border + 1]!;
    // A dock sliding over takes no room: only its own size changes, and the pinned kids keep their shares.
    const slides = (k: LNode<I> | undefined) => k?.t === "dock" && k.policy?.overlay !== false;
    const di = slides(n.kids[border]) ? border : slides(n.kids[border + 1]) ? border + 1 : -1;
    if (di >= 0) {
      const total = n.weights.reduce((a, w) => a + w, 0), want = di === border ? sum * f : sum * (1 - f);
      const others = total - n.weights[di]!, scale = others > 0 ? (total - want) / others : 1;
      n.weights = n.weights.map((w, i) => (i === di ? want : w * scale));
    } else { n.weights[border] = sum * f; n.weights[border + 1] = sum - n.weights[border]!; }
    this.d.answer = { split: n.id, path: pathOf(this.d.tree, n) ?? "", border, share: Math.round(f * 1000) / 1000, tiles: leaves(n).map(x => this.name(x)) };
  }

  /** Every share of a split at once (a screen sizing its own preset to the terminal: the welcome's columns). */
  private shares(split: string, shares: number[]) {
    const n = nodeById(this.d.tree, split);
    if (!n || !isLine(n) || n.t === "flow") refuse(`no split ${split} in the layout; layout.get gives each split's id`);
    const line = n as Line<I>;
    if (shares.length !== line.kids.length || !shares.every(x => Number.isFinite(x) && x > 0)) refuse(`split ${split} has ${line.kids.length} kids: shares are that many positive numbers`);
    refuse(this.resizeWhy(line));
    const sum = shares.reduce((a, x) => a + x, 0);
    line.weights = shares.map(x => x / sum);
  }

  private grow(id: I, axis: Axis, by: number) {
    this.present(id);
    // The container whose border it would move: the innermost along that axis over it.
    const along = [...chainOf(this.d.tree, id)].reverse().find(c => isLine(c) && c.dir === axis && c.kids.length > 1);
    if (along) refuse(this.resizeWhy(along)); else this.shape(id, "resizing");
    if (!resize(this.d.tree, id, axis, 0.05 * by)) refuse(`tile ${this.name(id)} has no border ${axis === "row" ? "beside it" : "above or below it"} to move`);
  }

  private even() {
    if (this.d.policy.locked) refuse(`the screen is locked: evening it out is refused · ${UNLOCK}`);
    // A split that keeps its sizes (locked, resizable off) keeps them.
    even(this.d.tree, n => !!this.resizeWhy(n));
  }

  /** Who set or took away lock `key`: an agent undoes only a lock it set. */
  private lockedBy(key: string, lock: boolean) {
    if (this.agent && !lock && !this.d.locks.has(key)) refuse(`${key === "screen" ? "the screen" : key} was locked by the person; an agent doesn't unlock it (block.mark gets their attention)`);
    if (lock && this.agent) this.d.locks.add(key); else this.d.locks.delete(key);
  }
  private lock(on: boolean | undefined) {
    const locked = !!this.d.policy.locked, want = on ?? !locked;
    if (want === locked) { this.d.changed = false; this.d.answer = { locked: want, changed: false }; return; }
    this.lockedBy("screen", want);
    const { locked: _l, ...rest } = this.d.policy;
    this.d.policy = want ? { ...rest, locked: true } : rest;
    this.d.answer = { locked: want, changed: true };
  }

  private setPolicy(op: Extract<Op<I>, { op: "policy" }>) {
    const chain = op.tile !== undefined ? chainOf(this.d.tree, op.tile) : [];
    const c: Container<I> | "screen" | null = op.node === "screen" ? "screen" : op.node ? nodeById(this.d.tree, op.node) : chain.at(-1) ?? "screen";
    if (!c) refuse(`no container ${op.node} in the layout; layout.get gives each one's id (s<n> a split, g<n> a tab set, d<n> a dock, f<n> a flow), or node=screen`);
    const bad = op.clear.filter(k => !(POLICY_KEYS as readonly string[]).includes(k));
    if (bad.length) refuse(`layout.policy: clear names ${POLICY_KEYS.join(", ")}, not ${bad.join(", ")}`);
    const name = c === "screen" ? "screen" : c!.id ?? c!.t;
    const before: Policy = c === "screen" ? this.d.policy : c!.policy ?? {};
    const e = c === "screen" ? effective([{ by: "screen", policy: this.d.policy }]) : this.ofNode(c!);
    if (e.locked && [...Object.keys(op.set), ...op.clear].some(k => k !== "locked")) refuse(this.lockedWhy(e, `changing ${name}'s policy`));
    if (op.set.opensInto !== undefined) {
      const to = named(this.d, op.set.opensInto);
      if (to === undefined && !node(this.d.tree, op.set.opensInto)) refuse(`no tile or container ${op.set.opensInto} for opens to land in`);
      if (to !== undefined && !this.facts(to).notes) refuse(`${op.set.opensInto} is a ${this.facts(to).kind} tile: opens land in a tile that takes notes`);
    }
    if (op.set.accepts && this.ctx.kinds) { const unknown = op.set.accepts.filter(k => !this.ctx.kinds!.all.includes(k)); if (unknown.length) refuse(`layout.policy: accepts names tile kinds (${this.ctx.kinds.all.join(", ")}), not ${unknown.join(", ")}`); }
    const locking = op.set.locked === true ? true : (op.set.locked === false || op.clear.includes("locked")) && before.locked ? false : null;
    if (locking !== null && locking !== !!before.locked) this.lockedBy(name, locking);
    const next: Policy = { ...before, ...op.set };
    for (const k of op.clear) delete (next as Record<string, unknown>)[k];
    const policy = policyOf(next);
    if (c === "screen") this.d.policy = policy;
    else if (Object.keys(policy).length) c!.policy = policy; else delete c!.policy;
    this.d.answer = { node: name, policy };
  }

  private link(id: I, to: I | undefined) {
    this.present(id);
    if (to === undefined) { this.shape(id, `changing where ${this.name(id)}'s opens land`); this.d.links.delete(id); this.d.answer = { link: null }; return; }
    this.present(to);
    const f = this.facts(to);
    this.linkTo(id, to, !!f.notes, f.kind);
    this.d.answer = { link: this.name(to) };
  }
  /** Tile `id`'s opens land in `to` (of `kind`, which takes notes or not): the one rule for a link, set by link or an open. */
  private linkTo(id: I, to: I, notes: boolean, kind: string) {
    this.present(id);
    this.shape(id, `changing where ${this.name(id)}'s opens land`);
    if (to === id) refuse(`${this.name(id)} can't open into itself · leave to= out to unlink`);
    if (!notes) refuse(`${this.name(to)} is a ${kind} tile: opens land in a tile that takes notes${this.ctx.kinds ? ` (${this.ctx.kinds.notes.join(", ")})` : ""}`);
    this.d.links.set(id, to);
  }

  private focus(id: I, quiet: boolean) {
    this.present(id);
    if (id !== this.d.focus) this.mayMoveKeys("move their keys");
    this.give(id);
    activate(this.d.tree, id);
    this.d.zoom = this.d.zoom !== null ? id : null;
    if (quiet) return;
    this.bringOut(id);
  }

  /**
   * Tile `id` shown where it is, the person's keys left where they are (tile.preview finding the preview it would
   * make): its tab shown (an agent's never over the tab the person has), its spine opened, then as focus brings a
   * tile out. Nothing moves and nothing is made.
   */
  private reveal(id: I) {
    this.present(id);
    const set = tabsOf(this.d.tree, id);
    if (set && !(this.agent && set.ids.includes(this.d.focus) && this.d.focus !== id)) activate(this.d.tree, id);
    for (const t of this.foldSet(id)) this.d.collapsed.delete(t);
    // An agent doesn't move a flow's strip under the column the person is typing in (as its widen doesn't).
    const f = flowHolding(this.d.tree, id), typing = this.ctx.person.typingIn;
    const steps = !(this.agent && f && typing !== null && flowHolding(this.d.tree, typing)?.flow === f.flow);
    this.bringOut(id, steps);
    this.d.answer = { tile: this.name(id) };
  }

  /** What showing tile `id` takes: a float comes to the top, the docks around it slide open, its flow column comes on the strip. */
  private bringOut(id: I, flowSteps = true) {
    // A float given the keys comes to the top.
    const fi = this.d.floats.findIndex(f => f.id === id);
    if (fi >= 0 && fi < this.d.floats.length - 1) this.d.floats.push(...this.d.floats.splice(fi, 1));
    // A tile in a shut dock: the dock slides open (every dock around it).
    for (const c of chainOf(this.d.tree, id)) if (c.t === "dock") c.open = true;
    // A column off the flow's strip altogether: the wide place steps toward it until it's on, nothing else moves.
    const f = flowSteps ? flowHolding(this.d.tree, id) : null;
    if (f) {
      const shownNow = () => coversOf(this.d, f.flow, this.ctx.area, x => !!this.facts(x).holds).has(f.ci);
      let a = Math.max(0, columnOf(f.flow, f.flow.anchor));
      while (a !== f.ci && !shownNow()) { a += f.ci > a ? 1 : -1; f.flow.anchor = tileOfColumn(f.flow, a); }
    }
  }

  private tab(id: I, by: number | undefined) {
    this.present(id);
    const set = tabsOf(this.d.tree, id);
    if (!set) refuse(`${this.name(id)} isn't in a tab set`);
    const hadFocus = set!.ids.includes(this.d.focus);
    const showing = by ? set!.ids[(set!.active + by + set!.ids.length) % set!.ids.length]! : id;
    // An agent never hides the tab the person has.
    if (this.agent && hadFocus && showing !== this.d.focus) refuse(`${this.name(this.d.focus)} is the tab the person has; an agent doesn't hide it`);
    if (by) cycle(this.d.tree, id, by > 0 ? 1 : -1); else activate(this.d.tree, id);
    // The person's click or key moves their keys with the tab.
    if (!this.agent && hadFocus) this.d.focus = showing;
    this.d.answer = { tile: this.name(showing), tabs: set!.ids.map(x => this.name(x)) };
  }

  private zoom(id: I, on: boolean | undefined) {
    this.present(id);
    const want = on ?? this.d.zoom !== id;
    // Zooming another tile would hide the one with the person's keys.
    if (this.agent && want && id !== this.d.focus) refuse(`zooming tile ${this.name(id)} would hide tile ${this.name(this.d.focus)}, which has the person's keys`);
    if (!want) this.d.zoom = null;
    else { this.d.zoom = id; if (!this.agent) this.d.focus = id; }
    this.d.answer = { zoomed: this.d.zoom === id };
  }

  /** Permission to lay the screen out again (the new layout comes in through `init`). */
  private load(name: string) {
    if (this.d.policy.locked) refuse(`the screen is locked: loading ${name} would change its shape · ${UNLOCK}`);
    // A layout loaded drops every container's lock with it: an agent doesn't, over a lock the person set.
    if (this.agent) {
      const locks = (n: LNode<I>): string[] => (n.t === "leaf" ? [] : [...(n.policy?.locked ? [n.id ?? n.t] : []), ...kidsOf(n).flatMap(locks)]);
      const theirs = locks(this.d.tree).find(k => !this.d.locks.has(k));
      if (theirs) refuse(`${theirs} was locked by the person; loading ${name} would undo it, and an agent doesn't (block.mark gets their attention)`);
    }
    this.mayMoveKeys("lay the desk out under them");
    this.d.changed = false;
  }

  /**
   * Columns filled from their source (PIE-511): its tiles in the source's order (a tile the person moved out stays
   * where they put it; others they put in, after); the ones the source no longer names gone; then the new ones named,
   * so a new tile takes the name of one it replaces (another hub's lane "Done"). A tile it keeps gets the source's
   * name back (`names`) when that's free: one named by its kind while its name was taken, or a view renamed.
   */
  private fill(op: Extract<Op<I>, { op: "fill" }>) {
    if (this.agent) refuse("a columns container is filled from its source by the screen; an agent changes the source's data (its hub's views) instead");
    for (const id of op.drop ?? []) {
      if (!this.all().includes(id)) { this.forget(id); continue; }
      const next = this.isFloat(id) ? this.d.tree : remove(this.d.tree, id);
      if (next) this.d.tree = normalise(next);
      this.forget(id);
      if (this.d.focus === id) this.d.focus = visible(this.d.tree).find(x => !this.d.collapsed.has(x)) ?? visible(this.d.tree)[0] ?? this.all()[0]!;
    }
    // In two steps, so two kept tiles whose views swapped names both get theirs: each that differs lets its name go, then
    // takes the source's when no other tile holds it (else it's named by its kind).
    const renames = (op.names ?? []).filter(([id, name]) => this.d.names.has(id) && this.d.names.get(id) !== name);
    const was = new Map(renames.map(([id]) => [id, this.d.names.get(id)!] as const));
    for (const [id] of renames) this.d.names.delete(id);
    for (const [id, name] of renames) this.d.names.set(id, named(this.d, name) === undefined ? name : named(this.d, was.get(id)!) === undefined ? was.get(id)! : autoName(this.d, this.facts(id).kind));
    for (const t of op.fresh ?? []) this.d.names.set(t.id, t.name !== undefined && named(this.d, t.name) === undefined ? t.name : autoName(this.d, t.kind));
    const c = nodeById(this.d.tree, op.container);
    if (!c || c.t !== "columns") { if (op.drop?.length) return; refuse(`no columns ${op.container} in the layout`); }
    const col = c as Extract<Container<I>, { t: "columns" }>;
    const fresh = new Set((op.fresh ?? []).map(t => t.id));
    const w = new Map(op.weights ?? []);
    const at = (id: I) => col.kids.findIndex(k => k.t === "leaf" && k.id === id);
    const kids: LNode<I>[] = [], weights: number[] = [];
    for (const id of op.order) {
      const i = at(id);
      if (i < 0 && !fresh.has(id)) continue;
      kids.push(i >= 0 ? col.kids[i]! : leaf(id)); weights.push(w.get(id) ?? (i >= 0 ? col.weights[i]! : 1));
    }
    const all = new Set(this.all());
    col.kids.forEach((k, i) => { if (!kids.includes(k) && leaves(k).length && leaves(k).every(id => all.has(id) || fresh.has(id))) { kids.push(k); weights.push(col.weights[i]!); } });
    col.kids = kids; col.weights = weights;
    this.d.tree = normalise(this.d.tree);
  }

  private source(container: string, source: string) {
    if (this.agent) refuse("where a columns container's tiles come from is the screen's (the board's hub: board.hub)");
    const c = nodeById(this.d.tree, container);
    if (!c || c.t !== "columns") refuse(`no columns ${container} in the layout`);
    (c as Extract<Container<I>, { t: "columns" }>).source = source;
  }

  // ── a flow's own operations ──

  private flowOf(id: I) {
    this.present(id);
    const f = flowHolding(this.d.tree, id);
    if (!f) refuse(`${this.name(id)} isn't in a flow: a flow's columns widen, pin and go back and forward`);
    return f!;
  }
  /** The explicit shift: the tile's column takes the wide place. The person's keys stay where they are. */
  private widen(id: I) {
    const f = this.flowOf(id);
    const e = this.ofNode(f.flow);
    if (e.locked) refuse(this.lockedWhy(e, "widening"));
    // The column the person is typing in never squeezes under them for an agent's shift.
    const typing = this.ctx.person.typingIn;
    if (this.agent && typing !== null && typing !== id && columnOf(f.flow, typing) >= 0) refuse(`the person is typing in ${this.name(typing)}, a column of this flow; an agent's widen would squeeze it (block.mark gets their attention)`);
    const before = f.flow.anchor;
    widenFlow(f.flow, f.ci);
    if (f.flow.anchor === before) this.d.changed = false;
    this.d.answer = { wide: true };
  }
  /**
   * Back (-1) or forward (1) from the tile's column: the keys go to the column it was opened from, or the one back
   * last left; it widens only if it's covered, so the text comes back where it was. The person's keys only.
   */
  private travel(id: I, dir: -1 | 1) {
    if (this.agent) refuse("back and forward in a flow move the person's keys between columns; an agent opens beside (open, link.follow) instead");
    const f = this.flowOf(id);
    const to = travelTarget(f.flow, f.ci, dir);
    if (to < 0) refuse(dir < 0 ? "nothing to go back to: this column wasn't opened from one still open" : "nothing ahead: go back first");
    if (dir < 0) setAhead(f.flow, to, f.ci);
    f.flow.read = tileOfColumn(f.flow, f.ci);
    this.d.focus = tileOfColumn(f.flow, to)!;
    if (coversOf(this.d, f.flow, this.ctx.area, x => !!this.facts(x).holds).get(to) !== "full") widenFlow(f.flow, to);
    this.d.answer = { tile: this.name(this.d.focus) };
  }
  /** Hold the tile's column (it resists compression, as the river's `p` does) or let it go; default toggles. */
  private holdColumn(id: I, on: boolean | undefined) {
    const f = this.flowOf(id);
    const e = this.ofNode(f.flow);
    if (e.locked) refuse(this.lockedWhy(e, "holding a column"));
    const was = (f.flow.held ?? []).some(t => columnOf(f.flow, t) === f.ci);
    const want = on ?? !was;
    if (want === was) this.d.changed = false;
    setHeld(f.flow, f.ci, want);
    this.d.answer = { held: want };
  }
  /** A view's own dock's policy, kept for when it's put back in a dock after a restart pinned (only when none is kept). */
  private rememberPolicy(key: string, policy: Policy) {
    if (this.d.remembered.has(key)) { this.d.changed = false; return; }
    this.d.remembered.set(key, policyOf(policy));
  }
}

/** A float's rectangle kept in `area`: never smaller than a float is drawn (unless the screen is), never off it. */
export function keepOnScreen(r0: Rect, area: Rect): Rect {
  const r = { ...r0 }, W = area.cols, H = area.rows, top = area.row;
  r.cols = Math.max(0, Math.min(W, Math.max(FLOAT_MIN.cols, Math.round(r.cols)))); r.rows = Math.max(0, Math.min(H, Math.max(FLOAT_MIN.rows, Math.round(r.rows))));
  r.col = Math.max(0, Math.min(W - r.cols, Math.round(r.col))); r.row = Math.max(top, Math.min(top + H - r.rows, Math.round(r.row)));
  return r;
}

// ── the host layer (PIE-513, Evan's two layers) ─────────────────────────────
//
// Two layers: the screen layer is swapped per screen (board, river, reader, LORD), each as small as it was designed;
// the host layer is above every screen and stays across screen switches (the agent, the admin outline and detail,
// terminals; later a shelf for bundles in transit). The host layer is a layout like any other, so it changes by the
// same `apply`: its tree holds one slot for whatever screen is shown (`HOST_SCREEN`) beside a real dock of tabs.
// The person's keys move through the same transitions: a dock opened by the person takes them (to the tab shown),
// shut it gives them back to the screen slot, where the screen's own focus is exactly as they left it. The screen
// spec says where the host layer may appear (its policy's `host`), read by `placeHost` and by the dock operation
// (`ctx.screenHost`). It's the drawer (PIE-498): any tile put there travels with the person across screens.

/** The host layer's tile for the screen shown: the screen layer's place in it. */
export const HOST_SCREEN = "screen";
/** A host layer: its dock at `edge`, `share` of the room when it's out, holding `tabs` (the first shown). */
export function hostLayer(o: { tabs: string[]; names?: ReadonlyMap<string, string>; edge?: Dir; share?: number; open?: boolean; shown?: string }, prev?: LayoutState<string> | { rev: number; nextNode: number }): LayoutState<string> {
  const edge = o.edge ?? "down", share = Math.max(0.05, Math.min(0.95, o.share ?? 0.5));
  const active = Math.max(0, o.tabs.indexOf(o.shown ?? o.tabs[0]!));
  const kid: LNode<string> = o.tabs.length === 1 ? leaf(o.tabs[0]!) : { t: "tabs", ids: [...o.tabs], active, policy: {} };
  // It stays up when the keys go back to the screen; at least a frame and a row of what it shows.
  const dock: Dock<string> = { t: "dock", kid, edge, open: !!o.open, policy: { stays: true, min: 4 } };
  const first = edge === "left" || edge === "up";
  const tree: LNode<string> = { t: "split", dir: edge === "left" || edge === "right" ? "row" : "col", kids: first ? [dock, leaf(HOST_SCREEN)] : [leaf(HOST_SCREEN), dock], weights: first ? [share, 1 - share] : [1 - share, share], key: "host" };
  const names = new Map<string, string>([[HOST_SCREEN, HOST_SCREEN], ...o.tabs.map(t => [t, o.names?.get(t) ?? t] as [string, string])]);
  return init({ tree, names }, prev);
}
/** The host layer's one dock: your drawer, docked to the bottom edge (its tabs over or beside the screen). */
export function hostDock<I>(s: Pick<LayoutState<I>, "tree">): Dock<I> | null { return docks(s.tree)[0] ?? null; }
/**
 * Where the two layers go in `area`, as the screen shown lets the host layer appear (`mode`, its policy's `host`):
 * `over`, the dock slides over the screen's edge and the screen keeps all its room; `beside`, the dock takes its
 * room and the screen is drawn narrower (or shorter); `none`, the screen has it all and the host layer isn't drawn.
 */
export function placeHost<I>(s: LayoutState<I>, area: Rect, mode: HostMode = "over"): { screen: Rect; dock: Rect | null; tiles: Map<I, Rect> } {
  const dr = hostDock(s);
  const slot = HOST_SCREEN as unknown as I;
  if (mode === "none" || !dr || !dr.open) return { screen: area, dock: null, tiles: new Map() };
  // The screen's policy, not the stored dock's, says whether it slides over or takes its room.
  const tree = clone(s.tree);
  const d = docks(tree)[0]!;
  d.policy = { ...d.policy, overlay: mode === "over" };
  const ps = placeScreen({ root: tree, floats: [] }, area, placeOpts(s));
  const slid = ps.slid.find(x => x.node === d);
  const tiles = new Map<I, Rect>(slid ? slid.placed.rects : [...ps.rects].filter(([id]) => id !== slot));
  const room = ps.docks?.find(x => x.node === d)?.rect;
  return { screen: ps.rects.get(slot) ?? area, dock: slid?.rect ?? (room && room.cols > 0 && room.rows > 0 ? room : null), tiles };
}
