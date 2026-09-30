// Moving a card between board lanes. A lane is a saved view, and what a move into it must patch is
// the service's answer (`views.planWrite`, pi-herdr-outliner src/view-writes.ts): the plain clauses of
// the lane's query it sets, the rest of the query that must already hold, and the reason when a patch
// can't satisfy it. The door shows that plan and applies it; it never parses a query to make one.
import type { Msg } from "./board";
import { EditConflict, USER, type Actor, type MovePlan, type PlannedChange, type SocketBoard } from "./socket";

export type { MovePlan, PlannedChange as Change };

/** The patch in words, for flashes and the move picker: `stage queued -> done · track + door`. */
export const describeChanges = (changes: PlannedChange[]) =>
  changes.map(c => (c.from === null ? `${c.key} + ${c.to}` : `${c.key} ${c.from} -> ${c.to}`)).join(" · ");

/** A move the door refused before writing, or that the service's revision check refused. */
export class MoveRefused extends Error {
  constructor(message: string, readonly stale = false) { super(message); this.name = "MoveRefused"; }
}

/** Why the service can't plan: an older outline without `views.planWrite`. */
export const NO_PLANNER = "this outline can't plan moves (views.planWrite, PIE-490); restart it from a current pi-herdr-outliner";

/**
 * The service's plan for moving `card` into each of `lanes`, by the lane's view id. The plans are made
 * at the card's current revision, which must be the one the board showed: otherwise the card changed
 * under the person and every plan is refused as stale.
 */
export async function planMoves(board: SocketBoard, card: Msg, viewIds: string[]): Promise<Map<string, MovePlan>> {
  const r = await board.planMoves(viewIds, card.id);
  if (!r) return new Map(viewIds.map(id => [id, { kind: "refused", reason: NO_PLANNER }]));
  if (card.revision !== undefined && r.revision !== card.revision) {
    const stale: MovePlan = { kind: "refused", reason: `the card changed since the board loaded (revision ${card.revision} -> ${r.revision})`, stale: true };
    return new Map(viewIds.map(id => [id, r.plans.get(id)?.kind === "already" ? { kind: "already" } : stale]));
  }
  return r.plans;
}

/**
 * Apply a planned patch with one `properties.patch`, at the revision the plan was made at (the one the
 * card was shown at). If the card moved on in between, nothing is written. Returns the card as the
 * service now has it.
 */
export async function applyMove(board: SocketBoard, card: Msg, plan: Extract<MovePlan, { kind: "patch" }>, actor: Actor = USER): Promise<Msg> {
  if (card.revision === undefined) throw new MoveRefused("the outline didn't say which revision this card is at");
  if (plan.revision !== card.revision) throw new MoveRefused(`the card changed since the board loaded (revision ${card.revision} -> ${plan.revision}) · not moved`, true);
  try {
    return await board.patchProperties(card.id, plan.revision, plan.operations, actor);
  } catch (e) {
    if (e instanceof EditConflict) throw new MoveRefused("the card changed elsewhere before the move landed · not moved", true);
    throw e;
  }
}
