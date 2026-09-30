// Where a new card in a lane goes (PIE-406). What it is born with, and the text or roadmap item it is
// saved as, is the service's plan (`views.planWrite`); the board (delivery.ts) asks for it and writes.
import { subject, type Msg } from "../board";

export interface ParentPick { id: string; why: string }

/**
 * Where a new card in a lane goes: the lane's `[create-parent::<id>]`; else the parent most of the
 * lane's cards share, else most of the board's. "Most" means more than half: a board whose cards
 * are spread across parents gets no guess, and the reason says how to name one.
 */
export function pickParent(laneName: string, def: Msg | undefined, laneItems: Msg[], boardItems: Msg[]): ParentPick | { refused: string } {
  const named = def?.properties?.filter(p => p.key === "create-parent") ?? (def?.props["create-parent"] ? [{ key: "create-parent", value: def.props["create-parent"] }] : []);
  if (named.length > 1) return { refused: `${laneName} has more than one create-parent::` };
  if (named.length === 1) {
    const id = named[0]!.value.replace(/^\(\((.*)\)\)$/, "$1").trim();
    return { id, why: `${laneName}'s create-parent` };
  }
  const majority = (items: Msg[], where: string): ParentPick | null => {
    // A row's parent is only known when the service sent one; top-level cards don't vote for "top level".
    const withParent = items.filter(m => m.parentId);
    if (!withParent.length) return null;
    const tally = new Map<string, number>();
    for (const m of withParent) tally.set(m.parentId!, (tally.get(m.parentId!) ?? 0) + 1);
    const [id, n] = [...tally].sort((a, b) => b[1] - a[1])[0]!;
    return n * 2 > withParent.length ? { id, why: n === withParent.length ? `where ${where} cards live` : `where ${n} of ${withParent.length} ${where} cards live` } : null;
  };
  const dedupe = (items: Msg[]) => [...new Map(items.map(m => [m.id, m])).values()];
  const pick = majority(laneItems, `${laneName}'s`) ?? majority(dedupe(boardItems), "the board's");
  if (pick) return pick;
  return { refused: boardItems.length
    ? `the board's cards live under different parents; give ${laneName} a [create-parent::<block id>] to say where new cards go`
    : `there's no card on the board to take a parent from; give ${laneName} a [create-parent::<block id>]` };
}

/** "Paint the shed": a card's title for a flash, kept short. */
export const titleOf = (m: Msg, n = 50) => { const t = subject(m); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
