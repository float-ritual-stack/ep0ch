// A lift the person's own click or key just dropped (PIE-1298, on PIE-1189's "a lift drops when work moves elsewhere").
// A button outside the lift that toggles it (`::button{act="tile.zoom tile={target} reach=column"}`, Evan's pop it) is
// pressed by that same click or key: the click dropped the lift first, so the press found it down and lifted it again,
// and a second press never dropped it. The press's toggle is that input's, so it finds the lift dropped already and
// leaves it down. The status bar's buttons had the same and keep the lift instead (app.ts, dropUntouched).
//
// One input, one meaning: the drop is remembered only for the press it starts (a press runs within milliseconds of
// its input; a later press of the button lifts it again as it should).

import type { Actor } from "../socket";

/** How long a drop stays the current input's: a press's toggle lands within milliseconds of the key or click. */
const SAME_INPUT_MS = 750;

let dropped: { desk: object; tile: number; reach: string; at: number } | null = null;

/** The person's click or key dropped `desk`'s lift of `tile` (Desk.liftInput, Desk.dropLiftElsewhere). */
export function droppedForInput(desk: object, lift: { tile: number; reach: string }): void {
  dropped = { desk, tile: lift.tile, reach: lift.reach, at: performance.now() };
}

/**
 * Whether the person's toggle of `tile`'s lift at `reach` (tile.zoom with no on=; Desk.zoomTile asks) is the input that
 * just dropped it, so it stays dropped (on=false). Asked once: a yes is used up.
 */
export function keptDropped(desk: object, tile: number, reach: string, actor: Actor, liftedNow: boolean): boolean {
  const d = dropped;
  if (actor.kind !== "user" || liftedNow || !d || d.desk !== desk || d.tile !== tile || d.reach !== reach) return false;
  dropped = null;
  return performance.now() - d.at <= SAME_INPUT_MS;
}
