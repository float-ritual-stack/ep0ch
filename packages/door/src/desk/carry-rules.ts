// What one carry and one close decide (PIE-1547), as pure rules over a layout's parts: what travels with a tile to
// another layout and how it lands there, and where the person's keys go as a tile leaves. The layout's steps (`take`,
// `open`, `close`, `slide`) call these; `carry.ts` asks both layouts; the desk only applies the answers.
import { leaves, node, type Float, type LNode } from "./layout";
import type { AgentLevel } from "../surface/agent-level";

/** A tile's fold to a spine (`tile.collapse`): the agent that folded it, and `h` for a horizontal spine. */
type Fold = { by?: string; dir?: "h" };
type Wire<I> = { from: I; to: I; verb: "select" | "open" | "alt" | "hover" };

/** What a layout said of a tile that goes with it to another: what an agent may do to it, its fold, its opens wired to itself (PIE-1516). */
export type Travels = { agents?: AgentLevel; fold?: Fold; inPlace?: true };
/** The tile a tile was opened from, which it gives the person's keys back to as it goes, and whether they were typing in that tile's program (PIE-1445). */
export type OpenedFrom<I = number> = { from: I; typing?: true };
/** Where the person's keys went as a tile left: back to its opener, to the tile its container opens into now, or home. */
export type KeysWent = { tile: string; by: "opener" | "into" | "home"; typing?: true };

/** What travels with tile `id`. */
export function travelsOf<I>(s: { agents: ReadonlyMap<I, AgentLevel>; collapsed: ReadonlyMap<I, Fold>; wires: readonly Wire<I>[] }, id: I): Travels {
  const agents = s.agents.get(id), fold = s.collapsed.get(id);
  return { ...(agents ? { agents } : {}), ...(fold ? { fold: { ...fold } } : {}), ...(s.wires.some(w => w.from === id && w.to === id && w.verb === "open") ? { inPlace: true as const } : {}) };
}

/**
 * What travelled lands with tile `id` in its open's step: its agent level; its fold where one fits (`folds` gives the
 * tiles it folds, or null where it can't); its in-place wire (it was one where it came from: the tile is the same). What
 * can't land is named.
 */
export function landTravels<I>(d: { agents: Map<I, AgentLevel>; collapsed: Map<I, Fold>; wires: Wire<I>[] }, id: I, t: Travels, folds: (fold: Fold) => I[] | null): string[] {
  const dropped: string[] = [];
  if (t.agents) d.agents.set(id, t.agents);
  const set = t.fold ? folds(t.fold) : [];
  if (t.fold && set) for (const x of set) d.collapsed.set(x, { ...t.fold });
  else if (t.fold) dropped.push("its fold (nothing beside it here to fold against)");
  if (t.inPlace) d.wires.push({ from: id, to: id, verb: "open" });
  return dropped;
}

/**
 * Where the person's keys go as tile `id` leaves, or null (its heir has them). Opened into a container (the board's
 * detail): the top float, else the tile that container opens into now, else `home`. Else back to the tile it was opened
 * from. `present` says a tile is still in the layout, after `id` left it.
 */
export function keysBackTo<I>(d: { tree: LNode<I>; floats: readonly Float<I>[] }, id: I, present: (x: I) => boolean, back: OpenedFrom<I> | undefined, into: [string, { ids: I[]; active: I | null }] | undefined, home: I | undefined): { id: I; by: KeysWent["by"]; typing?: true } | null {
  const here = (x: I | null | undefined): x is I => x !== undefined && x !== null && x !== id && present(x);
  if (into) {
    const top = d.floats.at(-1)?.id;
    if (here(top)) return { id: top, by: "into" };
    const [key, r] = into, c = node(d.tree, key);
    // In the container's order, then any it still names that the layout moved out of it.
    const order = c ? leaves(c) : [], live = r.ids.filter(x => here(x) && !d.floats.some(f => f.id === x));
    const ids = [...order.filter(x => live.includes(x)), ...live.filter(x => !order.includes(x))];
    const at = r.active !== null && ids.includes(r.active) ? r.active : ids.at(-1);
    if (here(at)) return { id: at, by: "into" };
    return here(home) ? { id: home, by: "home" } : null;
  }
  return back && here(back.from) ? { id: back.from, by: "opener", ...(back.typing ? { typing: true as const } : {}) } : null;
}
