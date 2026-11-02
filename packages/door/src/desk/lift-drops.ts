// A lift the person's own click or key just dropped (PIE-1298, on PIE-1189's "a lift drops when work moves elsewhere").
// A button outside the lift that toggles it (`::button{act="tile.zoom tile={target} reach=column"}`, Evan's pop it) is
// pressed by that same click or key: the click dropped the lift first, so the press found it down and lifted it again,
// and a second press never dropped it. The press's toggle is that input's, so it finds the lift dropped already and
// leaves it down. The status bar's buttons had the same and keep the lift instead (app.ts, dropUntouched).
//
// One input, one meaning: the drop is remembered only for the press it starts. It is a short timer, not a promise to wait
// on: the status bar dispatches its own press and can wrap it (dropUntouched), but a reader's press is dispatched deep in
// its tile, so the drop and the toggle meet here. A press's toggle lands about 15ms after its key; what the timer could
// swallow is a click elsewhere and then a click on the button inside 200ms meaning to lift it back.

import type { Actor } from "../socket";
import { INVITES } from "../surface/invite";

/** How long a drop stays the current input's: a press's toggle lands within milliseconds of the key or click. */
const SAME_INPUT_MS = 200;

type Drop = { desk: object; tile: number; reach: string; at: number; spent?: true };
let dropped: Drop | null = null;

/** The drop the person's current input made, while it is that input's and not yet used. */
const fresh = (): Drop | null => (dropped && !dropped.spent && performance.now() - dropped.at <= SAME_INPUT_MS ? dropped : null);

// A press minted by that input (a one-action-per-line button runs as an invited script run) carries the drop as its cause,
// so the run's toggle, whenever it lands, is the click's too.
INVITES.inputCause = fresh;

/** The person's click or key dropped `desk`'s lift of `tile` (Desk.liftInput, Desk.dropLiftElsewhere). */
export function droppedForInput(desk: object, lift: { tile: number; reach: string }): void {
  dropped = { desk, tile: lift.tile, reach: lift.reach, at: performance.now() };
}

/**
 * Whether a toggle of `tile`'s lift at `reach` (tile.zoom with no on=; Desk.zoomTile asks) was caused by the input that just
 * dropped it, so it stays dropped (on=false): the person's own action is caused by their current input, a run's action by
 * the press that invited it. Asked once: a yes uses the drop up.
 */
export function keptDropped(desk: object, tile: number, reach: string, actor: Actor, liftedNow: boolean): boolean {
  const d = (actor.kind === "user" ? fresh() : INVITES.causeOf(actor.invitation)) as Drop | null | undefined;
  if (liftedNow || !d || d.spent || d.desk !== desk || d.tile !== tile || d.reach !== reach) return false;
  d.spent = true;
  return true;
}
