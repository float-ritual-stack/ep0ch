// What a new card is written as, and where it goes: the pure half of creating cards on the board
// (PIE-406). The board (delivery.ts) reads, asks the service and writes; these only decide.
import { subject, type Msg } from "../board";

type Prop = { key: string; value: string };

/**
 * The text a new card is saved with: what was typed, with each property the lane needs appended to the
 * first line as a `[key::value]` token (where the outliner reads it as the card's own property), unless
 * the text already says so. A typed value that contradicts the lane is refused, never overwritten.
 * `typed` is how the service reads the typed text (properties.preview); null when it can't say, then
 * a plain `[key::` scan stands in, only to avoid adding a second value for a key the text sets.
 */
export function composeCardText(text: string, born: Prop[], typed: Prop[] | null): { text: string } | { refused: string } {
  const lines = text.replace(/\s+$/, "").split("\n");
  const own = (key: string): string[] => typed
    ? typed.filter(p => p.key === key).map(p => p.value)
    : [...text.matchAll(/\[([A-Za-z][\w.-]*)::([^\]\n]*)\]/g)].filter(m => m[1]!.toLowerCase() === key).map(m => m[2]!.trim());
  const add: string[] = [];
  for (const p of born) {
    const have = own(p.key);
    if (have.some(v => v.toLowerCase() === p.value.toLowerCase())) continue;
    if (have.length) return { refused: `the text sets ${p.key}::${have.join(",")}, but the lane needs ${p.key}=${p.value}` };
    add.push(`[${p.key}::${p.value}]`);
  }
  if (add.length) lines[0] = `${lines[0]!.replace(/\s+$/, "")} ${add.join(" ")}`.trimStart();
  return { text: lines.join("\n") };
}

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
