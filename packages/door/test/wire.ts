// Narrowing an answer a test expects to be one shape of its action's union (the wire contract,
// @ep0ch/outliner/wire): another shape fails the test with what it was, never a silent undefined.

/** A `draft.patch` (or any outcome-shaped answer) that a test expects to have been proposed. */
export function proposed<T extends { outcome: string }>(r: T): Extract<T, { outcome: "proposed" }> {
  if (r.outcome !== "proposed") throw new Error(`expected a proposal, got ${r.outcome}: ${JSON.stringify(r)}`);
  return r as Extract<T, { outcome: "proposed" }>;
}

/** A `changes.since` page that a test expects to hold changes (not a reset). */
export function changesOf<T extends { kind: string }>(page: T): Extract<T, { kind: "changes" }> {
  if (page.kind !== "changes") throw new Error(`expected a page of changes, got ${page.kind}: ${JSON.stringify(page)}`);
  return page as Extract<T, { kind: "changes" }>;
}

/** An annotation anchor a test expects to be a quote of text. */
export function quoteOf<T extends { kind: string }>(anchor: T): Extract<T, { kind: "text-quote" }> {
  if (anchor.kind !== "text-quote") throw new Error(`expected a text quote, got ${anchor.kind}`);
  return anchor as Extract<T, { kind: "text-quote" }>;
}

/** An annotation subject a test expects to be a block. */
export function blockOf<T extends { kind: string }>(subject: T): Extract<T, { kind: "block" }> {
  if (subject.kind !== "block") throw new Error(`expected a block subject, got ${subject.kind}`);
  return subject as Extract<T, { kind: "block" }>;
}
