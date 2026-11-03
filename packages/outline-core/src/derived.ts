// Derived blocks (PIE-674, PIE-1333): a block that only exists because of another one, and folds into it wherever a
// list of notes is drawn. A proposal (`draft-proposal`), a comment or a reply (`annotation`, `annotation-reply`) and a
// delivery hang from the note they are about; outline_query's `fold` collapses them into that note with a count, and
// the publisher folds them out of a note's "inside" list the same way. One classifier and one summary, here, for both.
// Pure: no I/O.

export type DerivedKind = "proposal" | "comment" | "delivery";

const KIND_OF_TYPE: Record<string, DerivedKind> = { "draft-proposal": "proposal", annotation: "comment", "annotation-reply": "comment", delivery: "delivery" };

/** What a block's `type` makes it, when it only exists because of another block: a proposal, a comment or a delivery. */
export const derivedKindOf = (type: string | undefined): DerivedKind | undefined => (type && Object.hasOwn(KIND_OF_TYPE, type) ? KIND_OF_TYPE[type] : undefined);

/** How many derived blocks a note holds, by kind. */
export interface ChangeCounts { count: number; proposals: number; comments: number; deliveries: number }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The counts of these kinds: one per derived block, the rest left out. */
export function countChanges(kinds: readonly (DerivedKind | undefined)[]): ChangeCounts {
  const of = (kind: DerivedKind) => kinds.filter(k => k === kind).length;
  const proposals = of("proposal"), comments = of("comment"), deliveries = of("delivery");
  return { count: proposals + comments + deliveries, proposals, comments, deliveries };
}

/** "3 changes (1 proposal, 2 comments)". */
export function changesSummary(c: ChangeCounts): string {
  const parts = [c.proposals && plural(c.proposals, "proposal"), c.comments && plural(c.comments, "comment"), c.deliveries && plural(c.deliveries, "delivery", "deliveries")].filter(Boolean);
  return `${plural(c.count, "change")} (${parts.join(", ")})`;
}
