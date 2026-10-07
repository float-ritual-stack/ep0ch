// The remote MCP gateway's writes (PIE-615): four tools, one write path. The tools take the Claude mod's shapes
// (`outline_create`, `outline_patch`, `outline_comment`, and `outline_set_property`), addressed as the read tools are (a
// uri, or a ref in a named outline), and each runs the outliner's own agent operation (`@ep0ch/outliner/agent-tools`,
// the code behind the mod's tools and `outliner agent …`) over the outline's socket. No rule is restated here: the
// service checks revisions, anchors comments, refuses a dropped page or anchor, and turns a patch that no longer matches
// into a proposal under the note.
//
// What the outline's access setting allows decides what a write becomes:
//   read, none  no write at all;
//   propose     a proposal: a patch or a property is a draft.patch proposal (`propose: always`), a new block is a comment
//               on its parent carrying the text, and a comment is a comment (it changes nothing but its thread);
//   full        applied, through the service's revision checks; a note open in someone's draft gets a proposal in that
//               draft instead (`propose: held`), never a change under their cursor.
// An outline whose home is another machine is never written here: its writes queue (src/mcp-netmail.ts), and that
// machine applies them with this same `applyWrite` when it pulls them.
//
// Every write is `author: agent`, its actor `mcp:<client>` (the OAuth client: a URL client id by its host, so claude.ai's
// reads `mcp:claude.ai`) and its session the OAuth subject, so the outline's activity, the door's flash and the gateway's
// log all say who wrote it.
import type { McpAccessLevel } from "@ep0ch/outline-core/protocol";
import type { DraftPatchSpan } from "@ep0ch/outline-core/draft-patch-compare";
import type { BoardAddress } from "./notes-cli";
import type { SocketBoard } from "./socket";

/** The outline a write goes to: a board, and its address when it has one (for what a refusal says). */
type WriteBoard = SocketBoard & { address?: BoardAddress };

export const MCP_WRITE_TOOLS = ["outline_create", "outline_patch", "outline_comment", "outline_set_property"] as const;
export type McpWriteTool = typeof MCP_WRITE_TOOLS[number];
export const isWriteTool = (name: string): name is McpWriteTool => (MCP_WRITE_TOOLS as readonly string[]).includes(name);

/** Who asked, from the access token. */
export interface McpCaller { sub: string; clientId?: string }

/** The agent a write is attributed to (the outliner's AgentActor). */
export interface WriteActor { actorId: string; sessionId?: string }

/** A client's short name: a URL client id (a CIMD client) by its host, anything else as it is. */
export function clientName(clientId: string | undefined): string {
  if (!clientId) return "client";
  try { const url = new URL(clientId); if (url.hostname) return url.hostname; } catch { /* not a URL */ }
  return clientId.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 64) || "client";
}
export const actorOf = (caller: McpCaller): WriteActor => ({ actorId: `mcp:${clientName(caller.clientId)}`, sessionId: caller.sub });

/** Whether a level allows writes, and which kind. */
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
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const pick = (args: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.filter(k => args[k] !== undefined).map(k => [k, args[k]]));

/**
 * A write tool's arguments checked for shape (the address is the caller's: `uri` or `ref`), as the Claude mod's
 * tools check theirs; the service checks the rest. The block is filled in once the address is resolved.
 */
export function writeInput(tool: McpWriteTool, args: Record<string, unknown>): Omit<McpWrite, "blockId"> | { error: string } {
  switch (tool) {
    case "outline_create":
      if (!nonEmpty(args.text)) return { error: "Give the new block's text." };
      if (args.position !== undefined && !(Number.isInteger(args.position) && (args.position as number) >= 0)) return { error: "position is a whole number from 0 (first)." };
      return { tool, input: pick(args, ["text", "position"]) };
    case "outline_patch": {
      if (typeof args.revision !== "number") return { error: "Give the revision outline_read returned." };
      if (!Array.isArray(args.patches) || !args.patches.length) return { error: "Give at least one patch: {observed, replacement}." };
      for (const p of args.patches as DraftPatchSpan[]) if (!p || !nonEmpty(p.observed) || typeof p.replacement !== "string") return { error: "Each patch needs observed (the exact text you read, never empty) and replacement." };
      if (args.policy !== undefined && args.policy !== "edit" && args.policy !== "prose") return { error: "policy is edit (the default) or prose." };
      return { tool, revision: args.revision, input: { policy: "edit", ...pick(args, ["patches", "mark", "policy", "allowStructural"]) } };
    }
    case "outline_comment":
      if (!nonEmpty(args.body)) return { error: "Give a non-empty comment." };
      if ((args.whole === true) === (typeof args.quote === "string")) return { error: "Give either quote (exact source text) or whole: true." };
      return { tool, input: pick(args, ["body", "quote", "whole", "start", "prefix", "suffix", "requestId"]) };
    case "outline_set_property":
      if (typeof args.revision !== "number") return { error: "Give the revision outline_read returned." };
      if (!nonEmpty(args.key) || !nonEmpty(args.value)) return { error: "Give the key and a non-empty value." };
      return { tool, revision: args.revision, input: pick(args, ["key", "value"]) };
  }
}

/** The outliner's agent operations, as much of them as a write uses (loaded by a name the door's checker doesn't follow). */
interface AgentTools {
  createBlock(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<{ id: string; revision: number }>;
  commentOn(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<{ thread: string; blockId?: string; deduplicated?: boolean }>;
  patchDraft(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<PatchResult>;
  setBlockProperty(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<PatchResult | { outcome: "unchanged"; key: string; value: string }>;
}
type PatchResult = { outcome: "applied"; edits: { blockId: string; route: "draft" | "saved"; revision?: number }[] } | { outcome: "proposed"; reason: string; proposalId: string; embedded: string | null; embeddedIn: string };
const AGENT_TOOLS_MODULE = "@ep0ch/outliner/agent-tools";
let agentTools: Promise<AgentTools> | null = null;
const loadAgentTools = () => agentTools ??= import(AGENT_TOOLS_MODULE) as Promise<AgentTools>;

/** The board as the agent operations' client: its requests, and its protocol check. */
const clientOf = (board: WriteBoard) => ({
  request: <T>({ action, ...rest }: { action: string } & Record<string, unknown>) => board.request<T>(action, rest),
  requireCompatibleService: () => board.info(),
});

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
  const tools = await loadAgentTools();
  const client = clientOf(board);
  const propose = kind === "proposals" || o.proposeOnly ? "always" : "held";
  const patched = (r: PatchResult, what: string): WriteOutcome => r.outcome === "applied"
    ? { outcome: "applied", uri: o.uri(write.blockId), said: `${what} applied${r.edits[0]?.route === "draft" ? " to the live draft" : ""}`, detail: r }
    : { outcome: "proposed", uri: o.uri(write.blockId), said: `${what} proposed, not applied: ${r.reason}; the proposal is ${o.uri(r.proposalId)}, under the note for its owner to apply or dismiss`, detail: r };
  switch (write.tool) {
    case "outline_create": {
      if (kind === "applied" && !o.proposeOnly) {
        const made = await tools.createBlock(client, { parent: write.blockId, ...write.input }, o.actor);
        return { outcome: "applied", uri: o.uri(made.id), said: `created ${o.uri(made.id)} under ${o.uri(write.blockId)}`, detail: made };
      }
      // A new block can't be a draft.patch: it is offered as a comment on its parent, for its owner to make.
      const body = `Proposed new block under this note, from ${o.actor.actorId}:\n\n${String(write.input.text)}`;
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

const REF_ADDRESS = {
  uri: { type: "string", description: "The block's ep0ch:// URI (it names its outline)" },
  ref: { type: "string", description: "The block's id or ((id)), in `outline`" },
};
const REVISION = { type: "integer", minimum: 1, description: "The revision outline_read returned. A note that changed since gets a proposal, never an overwrite." };

/** The write tools' definitions, for tools/list. `outline`: the outline property the read tools describe. */
export function writeToolDefinitions(outline: Record<string, unknown>) {
  const addressed = (properties: Record<string, unknown>, required: string[]) => ({
    type: "object",
    properties: { ...REF_ADDRESS, outline, ...properties },
    required,
    additionalProperties: false,
    oneOf: [{ required: ["uri"] }, { required: ["ref"] }],
  });
  const answer = "The answer says applied, proposed (with why and the proposal's URI) or queued (an outline whose home is another machine: it lands when that machine pulls it), with the block's URI. " +
    "An outline at `propose` access takes proposals only; `full` applies; `read` takes no writes (list_outlines shows each one's access).";
  return [
    {
      name: "outline_create",
      description: `Create a block under a parent (the uri or ref is the parent), at position among its siblings (0 is first; default last). At propose access it becomes a comment on the parent carrying the text. ${answer}`,
      inputSchema: addressed({ text: { type: "string" }, position: { type: "integer", minimum: 0 } }, ["text"]),
    },
    {
      name: "outline_patch",
      description: "Small edits to a note (draft.patch): each patch names the exact observed text (never empty) and its replacement, against the revision outline_read returned; all apply as one edit or none. " +
        "A note that changed under it, or one open in someone's draft, gets one proposal for its owner instead. policy edit (the default) refuses dropping a [page::…] or a linked ^anchor unless allowStructural; prose keeps every link, anchor and property. " + answer,
      inputSchema: addressed({
        revision: REVISION,
        patches: { type: "array", minItems: 1, items: { type: "object", properties: { observed: { type: "string" }, replacement: { type: "string" }, range: { type: "object", properties: { start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 0 } }, required: ["start", "end"] } }, required: ["observed", "replacement"] } },
        mark: { type: "string", description: "The @request line the patch answers: spans must end above it" },
        policy: { type: "string", enum: ["edit", "prose"], default: "edit" },
        allowStructural: { type: "boolean" },
      }, ["revision", "patches"]),
    },
    {
      name: "outline_comment",
      description: `Start a comment thread on a note: on an exact quote of its source text (add start, prefix or suffix when the quote repeats), or on the whole note. A requestId makes a retry return the same thread. A comment changes nothing but its thread, so propose access allows it. ${answer}`,
      inputSchema: addressed({
        body: { type: "string" }, quote: { type: "string", description: "Exact source text the comment is about" }, whole: { type: "boolean" },
        start: { type: "integer", minimum: 0 }, prefix: { type: "string" }, suffix: { type: "string" }, requestId: { type: "string" },
      }, ["body"]),
    },
    {
      name: "outline_set_property",
      description: `Set one [key::value] property on a note's header line (the chips that end its first line): the value replaced where the key is, or the chip added at the line's end, against the revision outline_read returned, as one outline_patch span. A key written more than once is a list: edit it with outline_patch. ${answer}`,
      inputSchema: addressed({ key: { type: "string" }, value: { type: "string", description: "One line, without ]" }, revision: REVISION }, ["key", "value", "revision"]),
    },
  ];
}
