// Narrowing an answer a test expects to be one shape of its action's union (the wire contract,
// @ep0ch/outliner/wire): another shape fails the test with what it was, never a silent undefined.

/** A `draft.patch` (or any outcome-shaped answer) that a test expects to have been proposed. */
export function proposed<T extends { outcome: string }>(r: T): Extract<T, { outcome: "proposed" }> {
  if (r.outcome !== "proposed") throw new Error(`expected a proposal, got ${r.outcome}: ${JSON.stringify(r)}`);
  return r as Extract<T, { outcome: "proposed" }>;
}

/** A `changes.since` page that a test expects to hold changes (not a reset). */
export function changes<T extends { kind: string }>(page: T): Extract<T, { kind: "changes" }> {
  if (page.kind !== "changes") throw new Error(`expected a page of changes, got ${page.kind}: ${JSON.stringify(page)}`);
  return page as Extract<T, { kind: "changes" }>;
}
