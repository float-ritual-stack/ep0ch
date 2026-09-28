// Moving a card between board lanes. A lane is a saved view whose query is a list of property
// clauses that must all hold (`key` present, or `key=value` with a case-insensitive value), so a card
// moves by patching the properties the target lane's query names, and nothing else:
//   - clauses the card already satisfies are left alone (only differing values are patched),
//   - a value clause replaces the card's one block-scope token for that key, or appends one,
//   - everything a patch can't satisfy is refused before any write, with the reason.
// Older services have no negation, OR or date ranges in the grammar: `not`, `or` and `and` are
// rejected by the parser, so such a lane is `invalid` and refused with the parser's own message.
// Newer ones (PIE-398) accept OR, NOT, parentheses and created/updated ranges; a lane using any of
// them reads fine but is refused as a move target, with which construct and why (views.ts
// queryShape). A bare word is a presence clause (`urgent` means "has an urgent:: property"),
// refused when the card lacks it, because a patch would have to invent the value.
import type { Msg } from "./board";
import { EditConflict, type PropertyPatch, type SocketBoard } from "./socket";
import { matchesFilters, type PropertyFilter, type ViewRead } from "./views";

export interface Change { key: string; to: string; from: string | null }
export type MovePlan =
  | { kind: "patch"; changes: Change[] }
  | { kind: "already" }
  | { kind: "refused"; reason: string };

export interface LaneLike { name: string; read?: ViewRead }

const propsOf = (m: Msg) => m.properties ?? Object.entries(m.props).map(([key, value]) => ({ key, value }));

/** What moving `card` into `lane` would patch, or why it can't. Pure: nothing is read or written. */
export function planMove(card: Msg, lane: LaneLike): MovePlan {
  const read = lane.read;
  if (!read) return { kind: "refused", reason: `${lane.name} is still loading` };
  if (read.status !== "ready") return { kind: "refused", reason: `${lane.name} is ${read.status}: ${read.errors[0] ?? "no reason given"}` };
  if (read.unpatchable) {
    if (read.items.some(m => m.id === card.id)) return { kind: "already" };   // the service already lists it there
    return { kind: "refused", reason: `${lane.name}'s query ${read.unpatchable}` };
  }
  if (!read.filters.length) return { kind: "refused", reason: `${lane.name} has no query clauses to satisfy` };
  const props = propsOf(card);
  if (matchesFilters(props, read.filters)) return { kind: "already" };

  const byKey = new Map<string, PropertyFilter[]>();
  for (const f of read.filters) byKey.set(f.key, [...(byKey.get(f.key) ?? []), f]);
  const changes: Change[] = [];
  for (const [key, clauses] of byKey) {
    if (matchesFilters(props, clauses)) continue;                     // this key already agrees
    const have = props.filter(p => p.key === key);
    const values = [...new Map(clauses.filter(c => c.value !== undefined).map(c => [c.value!.toLowerCase(), c.value!])).values()];
    if (values.length === 0)
      return { kind: "refused", reason: `${lane.name} asks for any ${key}:: value; a move can't choose one` };
    if (values.length > 1)
      return { kind: "refused", reason: `${lane.name} asks for ${key} to be ${values.join(" and ")} at once; a move sets one value` };
    if (have.length > 1)
      return { kind: "refused", reason: `the card has ${have.length} ${key}:: values (${have.map(h => h.value).join(", ")}); the door won't guess which one moves` };
    changes.push({ key, to: values[0]!, from: have[0]?.value ?? null });
  }
  return changes.length ? { kind: "patch", changes } : { kind: "already" };
}

/** The patch in words, for flashes and the move picker: `stage queued -> done · track + door`. */
export const describeChanges = (changes: Change[]) =>
  changes.map(c => (c.from === null ? `${c.key} + ${c.to}` : `${c.key} ${c.from} -> ${c.to}`)).join(" · ");

/** A move the door refused before writing, or that the service's revision check refused. */
export class MoveRefused extends Error {
  constructor(message: string, readonly stale = false) { super(message); this.name = "MoveRefused"; }
}

/**
 * Apply a plan with one `properties.patch`, checked against the revision the card was shown at.
 * Token ordinals come from the service at that same revision; if the card moved on in between,
 * nothing is written. Returns the card as the service now has it.
 */
export async function applyMove(board: SocketBoard, card: Msg, changes: Change[]): Promise<Msg> {
  const expected = card.revision;
  if (expected === undefined) throw new MoveRefused("the outline didn't say which revision this card is at");
  const operations: PropertyPatch[] = [];
  for (const c of changes) {
    const { revision, tokens } = await board.propertyTokens(card.id, c.key);
    if (revision !== expected) throw new MoveRefused(`the card changed since the board loaded (revision ${expected} -> ${revision}) · not moved`, true);
    const own = tokens.filter(t => t.scope === "block");
    if (own.length > 1) throw new MoveRefused(`the card has ${own.length} ${c.key}:: values; the door won't guess which one moves`);
    const t = own[0];
    if ((t?.value.toLowerCase() ?? null) !== (c.from?.toLowerCase() ?? null)) throw new MoveRefused(`the card's ${c.key}:: isn't what the board showed · not moved`, true);
    operations.push(t ? { op: "replace", ordinal: t.ordinal, value: c.to } : { op: "append", key: c.key, value: c.to });
  }
  try {
    return await board.patchProperties(card.id, expected, operations);
  } catch (e) {
    if (e instanceof EditConflict) throw new MoveRefused("the card changed elsewhere before the move landed · not moved", true);
    throw e;
  }
}
