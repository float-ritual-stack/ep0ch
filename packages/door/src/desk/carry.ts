// One carry (PIE-1547): a tile moves whole from one layout to another (a screen, the drawer, the glass, a group). Both
// layouts are asked first, as one pure step over their two LayoutStates: the source's `take` and the destination's
// `open`, with what travels (its agent level, fold and in-place wire) landed in that open and the free name picked here.
// Nothing moves unless both may, so there is nothing to put back; the desk commits the two answers and moves the pane.
// The keys are decided once: they follow the tile when they were in it, the actor stands for the person, and the
// destination takes them (the glass doesn't).
import { travelsOf, type Travels } from "./carry-rules";
import { apply, freeName, type At, type Ctx, type LayoutState, type Result } from "./screen-layout";

type Ok<I> = Extract<Result<I>, { ok: true }>;

/** One side of a carry: a layout as it is now, and the context its operations are applied with. */
export interface CarrySide<I> { state: LayoutState<I>; ctx: Ctx<I> }

export interface CarryRequest<I> {
  /** The tile leaving `from`. */
  tile: I;
  /** A new tile takes its place in `from` (a screen's last tile lifted onto the glass leaves a blank). */
  heir?: { id: I; name?: string };
  /** Where it lands in `to`, under the id `to` gives it. */
  land: { id: I; kind: string; at: At<I>; deliberate?: boolean };
  /** It lands without the person's keys, wherever they were (the glass). */
  keys?: false;
}

export type Carried<I> =
  | { ok: true; from: Ok<I>; to: Ok<I>; name: string; travels: Travels; dropped: string[]; keys: boolean }
  | { ok: false; side: "from" | "to"; refused: string };

export { freeName };   // the one rule for a tile's name where it arrives

/** Carry tile `req.tile` from `from` to `to`: both answers, or the refusal and the side that gave it (nothing changes). */
export function carry<I>(from: CarrySide<I>, to: CarrySide<I>, req: CarryRequest<I>): Carried<I> {
  const name = from.state.names.get(req.tile);
  if (name === undefined) return { ok: false, side: "from", refused: `no tile ${String(req.tile)} here` };
  const out = apply(from.state, { op: "take", tile: req.tile, ...(req.heir ? { heir: req.heir } : {}) }, from.ctx);
  if (!out.ok) return { ok: false, side: "from", refused: out.refused };
  // The names it's measured against: the destination's own and the layer beside it, the tile's own name not counted when
  // it leaves with the tile (an heir in its place keeps it: counted).
  const stays = [...out.state.names.values()].includes(name);
  const others = (to.ctx.otherNames ?? []).filter(n => stays || n !== name);
  const as = freeName([...to.state.names.values(), ...others], name);
  const travels = travelsOf(from.state, req.tile);
  const keys = req.keys !== false && from.ctx.standing && from.ctx.person.focus === req.tile && from.ctx.person.here !== false;
  const into = apply(to.state, {
    op: "open", tile: req.land.id, kind: req.land.kind, name: as, at: req.land.at, travels,
    deliberate: req.land.deliberate ?? false, ...(req.keys === false ? { keys: false as const } : {}),
  }, { ...to.ctx, otherNames: others });
  if (!into.ok) return { ok: false, side: "to", refused: into.refused };
  return { ok: true, from: out, to: into, name: as, travels, dropped: (into.answer.dropped as string[] | undefined) ?? [], keys };
}
