/**
 * A patch placed for a holder that places none itself (`draft.place`).
 *
 * The door finds a patch's spans in its own buffer and decides whether they may change (outline-core's
 * `placeDraftPatch`). A client that reads no Blockdown (the native window) can't: asked to `patch` or `revert`, it
 * answers with its draft as it stands (`HeldDraft`: the text, where the cursor and the selection's other end are,
 * and a `version` that names that text). Here the service makes the same decision over that draft and sends back
 * the spans to replace (`place`), which the holder takes only while its text is still that version: one that was
 * typed in since says what it holds now, and the patch is placed again.
 *
 * So the rule for what an agent may change under the person's hands has one owner whichever window they type in,
 * and the router asks a holder the same three things either way: this wraps the way it asks.
 */
import { applyLocated } from "@ep0ch/outline-core/draft-patch-compare";
import { patchDid, patchedSpans, placeDraftPatch, revertSpans, withoutPatched, type PatchedSpan } from "@ep0ch/outline-core/draft-patch-place";
import type { DraftHold, DraftHolderAnswer, HeldDraft } from "./draft-patch";
import type { DraftHolderAsk } from "./draft-patch-router";

type AskHolder = (hold: DraftHold, ask: DraftHolderAsk) => Promise<DraftHolderAnswer>;

/** How often a patch is placed again in a draft that was typed in while it was on its way. */
const PLACE_TRIES = 3;
/** How many patches placed in drafts are kept to take back (a patch that didn't apply everywhere, an undo). */
const PLACED_KEPT = 200;

const heldDraft = (answer: DraftHolderAnswer): HeldDraft | undefined => "draft" in answer ? answer.draft : undefined;

/**
 * `ask`, with a patch placed here for a holder that answers with its draft instead of placing it. A holder that
 * places its own (the door) is asked and answers as before.
 */
export function placingFor(ask: AskHolder): AskHolder {
  // What each placed patch changed, by its id: taking it back is a compare against what it wrote.
  const placed = new Map<string, PatchedSpan[]>();
  const keep = (patchId: string, spans: PatchedSpan[]) => {
    placed.set(patchId, spans);
    for (const oldest of placed.keys()) { if (placed.size <= PLACED_KEPT) break; placed.delete(oldest); }
  };
  return async (hold, request) => {
    const first = await ask(hold, request);
    let draft = heldDraft(first);
    if (!draft || (request.kind !== "patch" && request.kind !== "revert")) return first;
    for (let attempt = 0; attempt < PLACE_TRIES; attempt += 1) {
      const held: HeldDraft = draft;
      if (request.kind === "revert") {
        const patched = placed.get(request.patchId);
        const spans = patched && revertSpans(held.text, patched);
        if (!spans) return { reverted: false };
        const answer = await ask(hold, { kind: "place", patchId: request.patchId, version: held.version, spans, revert: true });
        if ("applied" in answer && answer.applied) { placed.delete(request.patchId); return { reverted: true }; }
        draft = heldDraft(answer);
        if (!draft) return { reverted: false };
        continue;
      }
      const where = placeDraftPatch({ text: held.text, base: held.revision, cursor: held.cursor, anchor: held.anchor, busy: held.busy }, request, request.mutation.author === "user");
      if (!where.ok) return { applied: false, reason: where.reason };
      const after = applyLocated(held.text, where.spans);
      const answer = await ask(hold, {
        kind: "place", patchId: request.patchId, version: held.version, spans: where.spans, mutation: request.mutation, did: patchDid(request),
        ...(request.standsOn ? { standsOn: request.standsOn } : {}),
      });
      if ("applied" in answer && answer.applied) {
        keep(request.patchId, patchedSpans(held.text, after, where.spans));
        if (!request.undoPatches) return { applied: true };
        // What the draft would be without this run's patches, for the receipt that undoes them.
        const without = withoutPatched(after, [...request.undoPatches, request.patchId].flatMap(id => placed.has(id) ? [placed.get(id)!] : []));
        if (without === null) throw new Error("The script's draft patch changed since; nothing was undone");
        return { applied: true, inverse: { before: after, text: without, revision: request.standsOn?.revision ?? held.revision } };
      }
      draft = heldDraft(answer);
      if (!draft) return answer;
    }
    return request.kind === "revert" ? { reverted: false } : { applied: false, reason: "the draft was typed in each time the patch was placed" };
  };
}
