// One proposal/write path for the MCP gateway and scripts started by outside agents.
import { randomUUID } from "node:crypto";
import { actorLabel } from "@ep0ch/outline-core/attribution";
import type { McpAccessLevel } from "@ep0ch/outline-core/protocol";


export interface WriteActor { actorId: string; sessionId?: string; taskId?: string }
export type McpWriteTool = "outline_create" | "outline_patch" | "outline_comment" | "outline_reply" | "outline_resolve_thread" | "outline_quote" | "outline_set_property" | "outline_move" | "outline_trash" | "outline_restore" | "outline_assign_id" | "outline_proposal_apply" | "outline_proposal_dismiss";
export interface WriteBoard {
  address?: { outline: string; machine: string };
  request<T>(action: string, args: Record<string, unknown>): Promise<T>;
  info(): Promise<unknown>;
  comments(id: string): Promise<{ id: string; replies: { id: string }[] }[]>;
}
const clientOf = (board: WriteBoard) => ({
  request: <T>({ action, ...args }: { action: string } & Record<string, unknown>) => board.request<T>(action, args),
  requireCompatibleService: () => board.info(),
});
const pick = (args: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.filter(k => args[k] !== undefined).map(k => [k, args[k]]));
/** Why a work id isn't stamped at this level (it is no proposal), or null when it may be. */
export const assignIdRefusal = (level: McpAccessLevel): string | null => level === "full" ? null
  : `outline_assign_id stamps the note and can't be proposed: it needs full access (this outline's is ${level}).`;

/** Why a note isn't brought back from Trash at this level (it is no proposal), or null when it may be. */
export const restoreRefusal = (level: McpAccessLevel): string | null => level === "full" ? null
  : `outline_restore brings a note back from Trash and can't be proposed: it needs full access (this outline's is ${level}).`;

/** Settling a proposal cannot become another proposal; check before queueing and again at its destination. */
export const proposalSettlementRefusal = (tool: McpWriteTool, level: McpAccessLevel): string | null =>
  (tool === "outline_proposal_apply" || tool === "outline_proposal_dismiss") && level !== "full"
    ? `${tool} settles a proposal and can't be proposed: it needs full access (this outline's is ${level}).` : null;

/** Whether a level allows writes, and which kind. */
/** When a patch was read at an older revision and applied on the newer one, say which (PIE-687). */
const rebasedSaid = (edits: readonly { revision?: number; rebasedFrom?: number }[]): string => {
  const rebased = edits.filter(edit => edit.rebasedFrom !== undefined);
  return rebased.length ? ` on the newer text (rebased from revision ${rebased.map(edit => edit.rebasedFrom).join(", ")}; now at ${rebased.map(edit => edit.revision).join(", ")})` : "";
};

export const writesAt = (level: McpAccessLevel): "proposals" | "applied" | null => level === "full" ? "applied" : level === "propose" ? "proposals" : null;

/**
 * One write, checked for shape and ready to apply: the block it is about (a patch's or comment's note, a new block's
 * parent), and its input as the agent operation takes it, without the address. `revision` is what the caller read.
 */
export interface McpWrite { tool: McpWriteTool; blockId: string; input: Record<string, unknown>; revision?: number }

/** What a write became. `uri`: the block it changed or made (a proposal's or comment's note). */
export interface WriteOutcome {
  outcome: "applied" | "proposed" | "unchanged";
  uri?: string;
  /** In words, for the person reading the tool's answer. */
  said: string;
  /** The service's answer, as the agent operation returned it. */
  detail: unknown;
  /** The same caller's same patch was already open beside the note: `uri`'s proposal is that one, and nothing new was written (PIE-725). */
  deduped?: true;
}

/** The outliner's agent operations, as much of them as a write uses (loaded by a name the door's checker doesn't follow). */
interface AgentTools {
  settleProposal(c: unknown, input: Record<string, unknown>, op: "apply" | "dismiss", actor: WriteActor): Promise<unknown>;
  createBlock(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<{ id: string; revision: number }>;
  commentOn(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<{ thread: string; blockId?: string; resourceId?: string; deduplicated?: boolean }>;
  replyTo(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<{ thread: string; reply: string; deduplicated?: boolean }>;
  editComment(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<{ thread: string; mark: string; revision: number }>;
  resolveThread(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<{ thread: string; lifecycle: string }>;
  patchDraft(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<PatchResult>;
  setBlockProperty(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<PatchResult | { outcome: "unchanged"; key: string; value: string }>;
  assignWorkId(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<{ outcome: "applied" | "unchanged"; workId: string; page: string }>;
  moveBlock(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<{ outcome: "applied" | "unchanged"; said: string } & Record<string, unknown>>;
  trashBlock(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<{ outcome: "applied" | "unchanged"; said: string } & Record<string, unknown>>;
  restoreBlock(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<{ outcome: "applied"; said: string } & Record<string, unknown>>;
  resolveRef(c: unknown, ref: string): Promise<{ id: string; fragmentId?: string }>;
  resourceRefOf(ref: string): unknown | null;
  readResource(c: unknown, ref: unknown): Promise<Record<string, unknown>>;
}
type PatchResult = { outcome: "applied"; edits: { blockId: string; route: "draft" | "saved"; revision?: number; rebasedFrom?: number }[] } | { outcome: "proposed"; reason: string; proposalId: string; beside: string; deduped?: true };
export interface ApplyOptions {
  /** The outline's access setting where it is applied now. */
  level: McpAccessLevel;
  actor: WriteActor;
  /** The block's URI, for the answer. */
  uri: (blockId: string) => string;
  /** Propose whatever the level: a queued write whose note may have changed since it was read (src/mcp-netmail.ts). */
  proposeOnly?: boolean;
  /** The revision the patch is checked against, when it isn't the caller's (a queued write on a note that didn't change). */
  revision?: number;
  /** A queued write: a comment whose passage has gone lands on the whole note, saying so. */
  queued?: { at: string };
}

/**
 * Applies one write to a live outline through the service, as `level` allows. The one write path: the gateway runs
 * it for this machine's outlines, and a machine pulling its queued writes runs it for its own.
 */
export async function applyWrite(board: WriteBoard, write: McpWrite, o: ApplyOptions): Promise<WriteOutcome> {
  const kind = writesAt(o.level);
  if (!kind) throw new Error(`MCP access is ${o.level}${board.address ? ` for ${board.address.outline}@${board.address.machine}` : ""}: no writes`);
  const module = "./agent-tools";
  const tools = await import(module) as AgentTools;
  const client = clientOf(board);
  if (write.tool === "outline_assign_id") {
    const why = assignIdRefusal(o.level) ?? (o.proposeOnly ? "outline_assign_id stamps the note and can't be proposed: the note changed since it was read." : null);
    if (why) throw Object.assign(new Error(why), { name: "WorkToolRefusal" });
  }
  if (write.tool === "outline_restore") {
    const why = restoreRefusal(o.level) ?? (o.proposeOnly ? "outline_restore can't be proposed: the note changed since it was read." : null);
    if (why) throw Object.assign(new Error(why), { name: "WorkToolRefusal" });
  }
  const settlementRefusal = proposalSettlementRefusal(write.tool, o.level);
  if (settlementRefusal) throw Object.assign(new Error(settlementRefusal), { name: "WorkToolRefusal" });
  const propose = kind === "proposals" || o.proposeOnly ? "always" : "held";
  const patched = (r: PatchResult, what: string): WriteOutcome => r.outcome === "applied"
    ? { outcome: "applied", uri: o.uri(write.blockId), said: `${what} applied${r.edits[0]?.route === "draft" ? " to the live draft" : ""}${rebasedSaid(r.edits)}`, detail: r }
    : r.deduped
      ? { outcome: "proposed", uri: o.uri(write.blockId), deduped: true, said: `${what} already proposed: the same patch of yours is still open beside the note (${o.uri(r.proposalId)}), so nothing new was written; it waits for its owner to apply or dismiss`, detail: r }
      : { outcome: "proposed", uri: o.uri(write.blockId), said: `${what} proposed, not applied: ${r.reason}; the proposal is ${o.uri(r.proposalId)}, beside the note for its owner to apply or dismiss`, detail: r };
  // A reply or a resolve names a thread of the note it is addressed to. One that isn't there (deleted, or never on this note) is a refusal here; a queued write lands on the whole note, saying so.
  const threadGone = async (): Promise<string | null> => {
    const thread = String(write.input.thread);
    return (await board.comments(write.blockId)).some(t => t.id === thread) ? null : thread;
  };
  const gone = async (what: string, thread: string, note: string): Promise<WriteOutcome> => {
    const body = `${what} a thread that is gone (${thread}; as it read when this was written, ${o.queued!.at}):\n\n${note}`;
    const c = await tools.commentOn(client, { ref: write.blockId, whole: true, body, requestId: `${String(write.input.requestId ?? randomUUID())}:gone` }, o.actor);
    return { outcome: "applied", uri: o.uri(write.blockId), said: `commented on the whole of ${o.uri(write.blockId)} (thread ${c.thread}): the thread ${thread} was gone when it landed`, detail: c };
  };
  switch (write.tool) {
    case "outline_proposal_apply":
    case "outline_proposal_dismiss": {
      const op = write.tool === "outline_proposal_apply" ? "apply" : "dismiss";
      const r = await tools.settleProposal(client, { ref: write.blockId }, op, o.actor);
      return { outcome: "applied", uri: o.uri(write.blockId), said: op === "apply" ? "applied the proposal" : "dismissed the proposal", detail: r };
    }
    case "outline_reply": {
      if (write.input.edit !== undefined) {
        // A posted comment's or reply's words changed (PIE-763): at full access, applied; else a reply proposing them.
        const mark = String(write.input.edit), body = String(write.input.body);
        const thread = (await board.comments(write.blockId)).find(t => t.id === mark || t.replies.some(r => r.id === mark));
        if (!thread) throw new Error(`No comment or reply ${mark} on ${o.uri(write.blockId)}; outline_threads lists the note's threads.`);
        if (kind !== "applied" || o.proposeOnly) {
          const r = await tools.replyTo(client, { thread: thread.id, body: `Proposed edit of ((${mark})), from ${o.actor.actorId}:\n\n${body}` }, o.actor);
          return { outcome: "proposed", uri: o.uri(write.blockId), said: `edit proposed, not applied: a reply in thread ${thread.id} (${r.reply}) gives the new words for its owner to take`, detail: r };
        }
        const r = await tools.editComment(client, { mark, body, observed: write.input.observed }, o.actor);
        return { outcome: "applied", uri: o.uri(write.blockId), said: `edited ${mark === thread.id ? "the comment" : "a reply"} in thread ${thread.id} on ${o.uri(write.blockId)} (revision ${r.revision})`, detail: r };
      }
      const missing = await threadGone();
      if (missing) {
        if (o.queued) return gone("Replied to", missing, String(write.input.body));
        throw new Error(`No thread ${missing} on ${o.uri(write.blockId)}; outline_threads lists the note's threads.`);
      }
      const r = await tools.replyTo(client, write.input, o.actor);
      return { outcome: "applied", uri: o.uri(write.blockId), said: `replied in thread ${r.thread} on ${o.uri(write.blockId)} (reply ${r.reply})`, detail: r };
    }
    case "outline_resolve_thread": {
      const missing = await threadGone();
      if (missing) {
        if (o.queued) return gone(write.input.resolved ? "Resolved" : "Reopened", missing, `(${write.input.resolved ? "resolve" : "reopen"} asked of ${actorLabel(o.actor.actorId)}; nothing to change)`);
        throw new Error(`No thread ${missing} on ${o.uri(write.blockId)}; outline_threads lists the note's threads.`);
      }
      const r = await tools.resolveThread(client, write.input, o.actor);
      return { outcome: "applied", uri: o.uri(write.blockId), said: `thread ${r.thread} on ${o.uri(write.blockId)} is now ${r.lifecycle}`, detail: r };
    }
    case "outline_quote": {
      const marks = (write.input.marks as unknown[]).map(String), where = String(write.input.where ?? "inbox").trim();
      const listed = marks.map(m => `((${m}))`).join(", ");
      if (kind !== "applied" || o.proposeOnly) {
        // A new block is a proposal at propose access: a comment on the note, for its owner to quote.
        const body = `Proposed quote of ${listed} into a new block (${where === "note" ? "under this note" : where === "inbox" ? "in the Inbox" : `under ${where}`}), from ${actorLabel(o.actor.actorId)}${write.input.text ? `:\n\n${String(write.input.text)}` : ""}`;
        const c = await tools.commentOn(client, { ref: write.blockId, whole: true, body }, o.actor);
        return { outcome: "proposed", uri: o.uri(write.blockId), said: `proposed as a comment on ${o.uri(write.blockId)} (thread ${c.thread}): this outline takes proposals, not new blocks`, detail: c };
      }
      const on = new Set((await board.comments(write.blockId)).flatMap(t => [t.id, ...t.replies.map(r => r.id)]));
      const away = marks.find(m => !on.has(m));
      if (away) throw new Error(`No mark ${away} on ${o.uri(write.blockId)}; outline_threads lists the note's threads and replies.`);
      const place = where === "inbox" ? { kind: "inbox" as const } : where === "note" ? { kind: "note" as const } : { kind: "under" as const, blockId: (await tools.resolveRef(client, where)).id };
      const r = await client.request<{ block: { id: string }; placement: { said: string }; undo?: string }>({ action: "marks.quote", input: { marks, place, ...(write.input.text ? { text: String(write.input.text) } : {}) }, mutation: { author: "agent", ...o.actor } });
      return { outcome: "applied", uri: o.uri(r.block.id), said: `quoted ${listed} ${r.placement.said}: ${o.uri(r.block.id)} transcludes each and links back with [from::]`, detail: r };
    }
    case "outline_create": {
      if (kind === "applied" && !o.proposeOnly) {
        const made = await tools.createBlock(client, { parent: write.blockId, ...write.input }, o.actor);
        return { outcome: "applied", uri: o.uri(made.id), said: `created ${o.uri(made.id)} under ${o.uri(write.blockId)}`, detail: made };
      }
      // A new block can't be a draft.patch: it is offered as a comment on its parent, for its owner to make.
      const body = `Proposed new block under this note, from ${actorLabel(o.actor.actorId)}:\n\n${String(write.input.text)}`;
      const c = await tools.commentOn(client, { ref: write.blockId, whole: true, body }, o.actor);
      return { outcome: "proposed", uri: o.uri(write.blockId), said: `proposed as a comment on ${o.uri(write.blockId)} (thread ${c.thread}): this outline takes proposals, not new blocks`, detail: c };
    }
    case "outline_patch":
      return patched(await tools.patchDraft(client, { ref: write.blockId, ...write.input, revision: o.revision ?? write.revision, propose }, o.actor), "patch");
    case "outline_set_property": {
      const r = await tools.setBlockProperty(client, { ref: write.blockId, ...write.input, revision: o.revision ?? write.revision, propose }, o.actor);
      if (r.outcome === "unchanged") return { outcome: "unchanged", uri: o.uri(write.blockId), said: `[${r.key}::${r.value}] is already set`, detail: r };
      return patched(r, `[${String(write.input.key)}::${String(write.input.value)}]`);
    }
    case "outline_move":
    case "outline_trash": {
      const move = write.tool === "outline_move";
      if (kind !== "applied" || o.proposeOnly) {
        // A move or a trash is no draft.patch: it is offered as a comment on the note, for its owner to make.
        const place = write.input.parent !== undefined ? (write.input.parent === "root" ? "to the top level" : `under ${String(write.input.parent)}${write.input.position !== undefined ? ` at position ${String(write.input.position)}` : ""}`)
          : write.input.before !== undefined ? `before ${String(write.input.before)}` : `after ${String(write.input.after)}`;
        const body = `Proposed ${move ? `move of this note ${place}` : "trashing of this note (with what is under it)"}, from ${actorLabel(o.actor.actorId)}`;
        const c = await tools.commentOn(client, { ref: write.blockId, whole: true, body }, o.actor);
        return { outcome: "proposed", uri: o.uri(write.blockId), said: `proposed as a comment on ${o.uri(write.blockId)} (thread ${c.thread}): this outline takes proposals, not ${move ? "moves" : "trashing"}`, detail: c };
      }
      const r = await (move ? tools.moveBlock : tools.trashBlock)(client, { ref: write.blockId, ...write.input, ...((o.revision ?? write.revision) !== undefined ? { revision: o.revision ?? write.revision } : {}) }, o.actor);
      return { outcome: r.outcome, uri: o.uri(write.blockId), said: r.said, detail: r };
    }
    case "outline_restore": {
      const r = await tools.restoreBlock(client, { ref: write.blockId }, o.actor);
      return { outcome: "applied", uri: o.uri(write.blockId), said: r.said, detail: r };
    }
    case "outline_assign_id": {
      const r = await tools.assignWorkId(client, { ref: write.blockId, revision: o.revision ?? write.revision }, o.actor);
      return r.outcome === "unchanged"
        ? { outcome: "unchanged", uri: o.uri(write.blockId), said: `${r.page} was already its id`, detail: r }
        : { outcome: "applied", uri: o.uri(write.blockId), said: `gave ${o.uri(write.blockId)} the id ${r.workId}: ${r.page} reaches it`, detail: r };
    }
    case "outline_comment": {
      try {
        const c = await tools.commentOn(client, { ref: write.blockId, ...write.input }, o.actor);
        return { outcome: "applied", uri: o.uri(write.blockId), said: `commented on ${o.uri(write.blockId)} (thread ${c.thread})`, detail: c };
      } catch (e) {
        if (!o.queued || typeof write.input.quote !== "string") throw e;
        // The passage it was about changed while the comment waited: it lands on the whole note, quoting it.
        const body = `On “${write.input.quote}” (as it read when this was written, ${o.queued.at}; it has changed since):\n\n${String(write.input.body)}`;
        const c = await tools.commentOn(client, { ref: write.blockId, whole: true, body, ...pick(write.input, ["requestId"]) }, o.actor);
        return { outcome: "applied", uri: o.uri(write.blockId), said: `commented on the whole of ${o.uri(write.blockId)} (thread ${c.thread}): the passage changed while it waited`, detail: c };
      }
    }
  }
}
