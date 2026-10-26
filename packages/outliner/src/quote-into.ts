// `quote` into a note (PIE-1247): the drag's drop. The subjects are read (anchors written) by the store, then inserted
// after the note's line as one `draft.patch`, the edit every agent and producer sends: a draft held open takes it in
// place, a line rewritten since makes it a proposal beside the note, never a write over the person's words.
import type { DraftPatchRouter } from "./draft-patch-router";
import { markBelow } from "./place";
import { quoteLine, readQuoteInput, type QuoteInput } from "./quote";
import type { OutlinerStore } from "./store";
import type { MutationProvenance, QuoteReceipt } from "./types";

export { readQuoteInput };

export async function quoteInto(store: Pick<OutlinerStore, "quoteSubjects">, drafts: Pick<DraftPatchRouter, "read" | "patch">, input: QuoteInput, mutation: MutationProvenance): Promise<QuoteReceipt> {
  if (input.place.kind !== "into") throw new Error("quoteInto needs place into");
  const { blockId, observed: seen } = input.place;
  // Refused before anything is written (an anchor in the part's note included).
  if (input.subjects.some(s => (s.kind === "element" ? s.blockId : s.id) === blockId)) throw new Error("a part of this note can't be quoted into itself: drop it into another note, or detach it");
  const draft = await drafts.read(blockId);
  const lines = draft.text.split("\n");
  let line = input.place.line;
  // The line as the dropper saw it: moved since (lines written above it), it is where it is now, once.
  if (seen !== undefined && lines[line] !== seen) {
    const at = lines.flatMap((l, i) => (l === seen ? [i] : []));
    if (at.length !== 1) throw new Error(`the line it was dropped after ("${seen.slice(0, 40)}") ${at.length ? "is there more than once now" : "changed since"}: drop it again`);
    line = at[0]!;
  }
  if (line >= lines.length) throw new Error(`${blockId} has ${lines.length} lines: line ${line + 1} isn't one of them`);
  const subjects = store.quoteSubjects(input.subjects, mutation);
  const inserted = subjects.map(s => quoteLine(s, input.as)).join("\n");
  const start = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0), observed = lines[line]!;
  const mark = markBelow(lines, line);
  const result = await drafts.patch({
    blockId, revision: draft.revision, mutation, current: true, policy: "edit", propose: "on-conflict",
    patches: [{ observed, range: { start, end: start + observed.length }, replacement: `${observed}\n${inserted}` }],
    ...(mark ? { mark: { text: mark } } : {}),
  });
  const applied = result.outcome === "applied";
  const what = input.as === "copy" ? "a copy" : subjects.length > 1 ? `${subjects.length} references` : "a reference";
  return {
    into: { blockId, outcome: applied ? "applied" : "proposed", ...("revision" in result && typeof result.revision === "number" ? { revision: result.revision } : {}), ...(!applied && "reason" in result && result.reason ? { reason: String(result.reason) } : {}) },
    subjects,
    said: applied ? `put ${what} after line ${line + 1}` : `proposed ${what} beside the note: ${"reason" in result ? result.reason : "the line changed"}`,
  };
}
