// proposal.*: apply, resolve or dismiss a proposal beside its note (PIE-725), from the reader or by id. PROPOSAL_ACTIONS
// (../note.ts) runs them reader-free; NOTE_ACTIONS spreads them in, so a reader's keys and clicks run the same defs.
import type { NoteSurface, SurfaceHost } from "../note";
import { ActionRefused, def } from "../actions";
import { EXT_UNDO } from "../../extensions";
import { isOpenProposal, NOT_APPLICABLE, proposalApplies } from "../../embeds";
import { outlineChanged } from "../../search-schedule";
import { partyOf } from "../../steps";
import { readerKeys } from "../reader-keys";
import { requesterOf } from "../../socket";

/** The proposal `proposal.resolve` acts on with no id (NoteSurface.resolveTarget): several in view are refused with their ids. */
function resolveTargetOf(surface?: NoteSurface): string {
  const t = surface?.resolveTarget();
  if (t && "several" in t) throw new ActionRefused(`${t.several.length} proposals in view; say which: block=${t.several.join(" or block=")}`);
  return t?.id ?? proposalTarget(undefined, surface);
}

/** The proposal `proposal.apply` or `proposal.dismiss` acts on: `id`, else the one whose embed or control is the current element, else the open proposal shown. */
function proposalTarget(id: string | undefined, surface?: NoteSurface): string {
  const shown = surface?.msg && isOpenProposal(surface.msg) ? surface.msg.id : undefined;
  const target = id ?? surface?.currentProposal() ?? shown;
  if (!target) throw new ActionRefused("say which proposal: id=, or put [ ] on a proposal's embed");
  return target;
}
const proposalDef = def<{ id: { type: "string"; optional: true; about: string } }, { surface?: NoteSurface; host: Pick<SurfaceHost, "ctx" | "redraw"> }>;
export const PROPOSAL_DEFS = {
  "proposal.resolve": def({
    summary: "ask the outline agent to resolve this proposal against the current note", keys: readerKeys("proposal.resolve", { keys: "click", does: "on [resolve]" }),
    touches: "nothing", replay: "ask",
    args: { block: { type: "string", optional: true, about: "proposal block id" }, id: { type: "string", optional: true, about: "proposal block id" } },
    examples: [{ act: "proposal.resolve block=5c2e8b17-4a90-4d3f-b6e1-9f07a3d2c845", does: "resolves the intended edit against the current text" }],
    async run({ block, id }, { surface, host }: { surface?: NoteSurface; host: Pick<SurfaceHost, "ctx" | "redraw"> }, actor) {
      const target = block ?? id ?? resolveTargetOf(surface);
      host.ctx.flash("asking the agent to resolve the proposal");
      try {
        const result = await host.ctx.board.resolveProposal(target, actor);
        if (result.undo) EXT_UNDO.push({ undo: result.undo, label: "Resolve proposal", by: partyOf(actor), context: surface?.msg?.id ?? target });
        outlineChanged([target, ...(surface?.msg ? [surface.msg.id] : [])]);
        host.ctx.flash(result.undo ? `${result.message} · ctrl+z takes it back` : result.message, 8000);
        surface?.noteAgent(actor, result.outcome === "resolved" ? "resolved a proposal" : "asked to resolve a proposal");
        return result;
      } finally { host.redraw(); }
    },
  }),
  "proposal.apply": proposalDef({
    summary: "apply anyway (PIE-501): the edit an agent's draft.patch proposed when it couldn't apply, as an ordinary edit by whoever runs this; on the proposal whose embed or control is the current element, the proposal shown, or id. Refused, with why, on one whose passage was already gone when it was proposed ([proposal-applies::no]: only dismiss is offered)", keys: readerKeys("proposal.apply", { keys: "click", does: "on [apply]" }),
    touches: "nothing", replay: "ask",
    args: { id: { type: "string", optional: true, about: "the proposal block's id (default: the one whose embed or control is the current element, else the note shown)" } },
    examples: [
      { act: "proposal.apply id=5c2e8b17-4a90-4d3f-b6e1-9f07a3d2c845", does: "applies that proposed edit anyway, as an ordinary edit by whoever runs it" },
      { act: "proposal.apply", does: "applies the proposal whose control is current, else the one shown" },
    ],
    async run({ id }, { surface, host }, actor) {
      const target = proposalTarget(id, surface);
      const p = await host.ctx.board.get(target);
      if (p && isOpenProposal(p) && !proposalApplies(p)) throw new ActionRefused(NOT_APPLICABLE);
      try {
        const r = await host.ctx.board.request("draft.proposal.apply", { proposalId: target, mutation: requesterOf(actor) });
        // Its embeds and the notes it changed are drawn again now, not when the outline's event comes.
        outlineChanged([target, ...r.edits.map(x => x.blockId)]);
        host.ctx.flash(`applied the proposal · ${r.edits.map(x => x.route === "draft" ? "into the draft being written" : "saved").join(", ")}${r.warning ? ` · but ${r.warning}` : ""}`, r.warning ? 8000 : undefined);
        surface?.noteAgent(actor, "applied a proposal anyway");
        return r;
      } catch (err) {
        throw new ActionRefused(err instanceof Error ? err.message : String(err));
      } finally { host.redraw(); }
    },
  }),
  "proposal.dismiss": proposalDef({
    summary: "dismiss a proposal (PIE-501) without applying it: the service (draft.proposal.dismiss) marks it dismissed and puts it in Trash, all recorded as whoever runs this, and the note it sits beside stops showing it (an older proposal's embed line comes out of the note, or the draft of it being written). Anyone may dismiss any proposal, an agent another agent's too, attributed", keys: readerKeys("proposal.dismiss", { keys: "click", does: "on [dismiss]" }),
    touches: "nothing", replay: "ask",
    args: { id: { type: "string", optional: true, about: "the proposal block's id (default: the one whose embed or control is the current element, else the note shown)" } },
    examples: [
      { act: "proposal.dismiss id=b83d4e60-2f17-4c9a-8e05-6a1c7d9f3b52", does: "dismisses that proposal without applying it, and puts it in Trash" },
      { act: "proposal.dismiss", does: "dismisses the proposal whose control is current, else the one shown" },
    ],
    async run({ id }, { surface, host }, actor) {
      const target = proposalTarget(id, surface);
      try {
        const r = await host.ctx.board.request("draft.proposal.dismiss", { proposalId: target, mutation: requesterOf(actor) });
        outlineChanged([target, ...(surface?.msg ? [surface.msg.id] : [])]);
        const line = r.embedRemoved === "saved" ? " · its embed line is out of the note" : r.embedRemoved === "draft" ? " · its embed line is out of the draft being written" : "";
        host.ctx.flash(`dismissed the proposal${line}${r.warning ? ` · but ${r.warning}` : ""}`, r.warning ? 8000 : undefined);
        surface?.noteAgent(actor, "dismissed a proposal");
        return r;
      } catch (err) {
        throw new ActionRefused(err instanceof Error ? err.message : String(err));
      } finally { host.redraw(); }
    },
  }),
};
