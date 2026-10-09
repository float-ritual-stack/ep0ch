// The remote MCP gateway's writes (PIE-615): seven tools, one write path. The tools take the Claude mod's shapes
// (`outline_create`, `outline_patch`, `outline_comment`, `outline_set_property`, `outline_reply`,
// `outline_resolve_thread` and `outline_assign_id`), addressed as the read tools are (a
// uri, or a ref in a named outline), and each runs the outliner's own agent operation (`@ep0ch/outliner/agent-tools`,
// the code behind the mod's tools and `outliner agent …`) over the outline's socket. No rule is restated here: the
// service checks revisions, anchors comments, refuses a dropped page or anchor, and turns a patch that no longer matches
// into a proposal under the note.
//
// What the outline's access setting allows decides what a write becomes:
//   read, none  no write at all;
//   propose     a proposal: a patch or a property is a draft.patch proposal (`propose: always`), a new block is a comment
//               on its parent carrying the text, and a comment, a reply and a resolve are what they say (each changes
//               nothing but its thread: a thread's state is not the note);
//   (outline_assign_id stamps a work id, which is no text proposal: it is applied at full and refused below it.)
//   full        applied, through the service's revision checks; a note open in someone's draft gets a proposal in that
//               draft instead (`propose: held`), never a change under their cursor.
// An outline whose home is another machine is never written here: its writes queue (src/mcp-netmail.ts), and that
// machine applies them with this same `applyWrite` when it pulls them.
//
// Every write is `author: agent`, its actor `mcp:[<persona>/]<principal>` (the principal auth proved: the OAuth client, a URL client id by its host, so claude.ai's
// reads `mcp:claude.ai`, or `claude-code@float-2` on stdio; the persona a declared label within it: `mcp:loki/claude-code@float-2`) and its sessionId the OAuth subject and the call it came in (`<subject>#<call>`, PIE-685), so the outline's activity, the door's flash and the gateway's
// log all say who wrote it.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnvFile } from "./backup/config";
import type { McpAccessLevel } from "@ep0ch/outline-core/protocol";
import { composeActor, composeSessionId, CALL_PATTERN, PERSONA_PATTERN } from "@ep0ch/outline-core/attribution";
import { canonicalLocalMachineName } from "./machine-name";
import type { DraftPatchSpan } from "@ep0ch/outline-core/draft-patch-compare";
import type { BoardAddress } from "./notes-cli";
import type { SocketBoard } from "./socket";

/** The outline a write goes to: a board, and its address when it has one (for what a refusal says). */
export type WriteBoard = SocketBoard & { address?: BoardAddress };

export const MCP_WRITE_TOOLS = ["outline_create", "outline_patch", "outline_comment", "outline_set_property", "outline_assign_id", "outline_reply", "outline_resolve_thread"] as const;
export type McpWriteTool = typeof MCP_WRITE_TOOLS[number];
export const isWriteTool = (name: string): name is McpWriteTool => (MCP_WRITE_TOOLS as readonly string[]).includes(name);

/** Who asked, from the access token. */
export interface McpCaller {
  sub: string;
  clientId?: string;
  /**
   * The call it is making (PIE-685): the HTTP transport's `Mcp-Session-Id`, one per stdio connection, or the id the agent
   * gave on the call (`call`), which wins. Trace only: it rides the write's sessionId after `#` (outline-core
   * attribution.ts) and never changes who the caller is.
   */
  call?: string;
  /** The call id was made for this one request (the caller sent none): the answer tells it to send `call` next time. */
  freshCall?: boolean;
}

/** The `call` argument a request may carry: an id the agent keeps across its requests ("daddy-2026-10-09-0103-k7f"). */
export const CALL_PROPERTY = {
  type: "string", pattern: CALL_PATTERN.source, maxLength: 64,
  description: "Optional. The id of this conversation's call, which you keep across requests: the one list_outlines or an earlier write told you (c-7f3a1c), or a name of your own (letters, digits, . _ -; for example daddy-2026-10-09-0103-k7f). Every write records it, `call:<id or handle>` finds what a call wrote, and outline_query leaves a call's own writes out of its recent-activity reads unless includeOwn. With none, each write is a call of its own and says so. It names a conversation and never who you are.",
} as const;

/** A caller whose call is the one the request names (`call`), else the one it already has. */
export function withCall(caller: McpCaller, named: unknown): McpCaller {
  return typeof named === "string" && CALL_PATTERN.test(named) ? { ...caller, call: named, freshCall: false } : caller;
}

/** The agent a write is attributed to (the outliner's AgentActor). */
export interface WriteActor { actorId: string; sessionId?: string }

/** A client's short name: a URL client id (a CIMD client) by its host, anything else as it is. */
export function clientName(clientId: string | undefined): string {
  if (!clientId) return "client";
  try { const url = new URL(clientId); if (url.hostname) return url.hostname; } catch { /* not a URL */ }
  return clientId.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 64) || "client";
}

/** The subject a stdio caller has: there is no token, so one fixed name; its client name is what tells callers apart. */
export const STDIO_SUBJECT = "stdio";

/**
 * Who auth proved a caller is (PIE-679), the part of a write's attribution that a persona can't change.
 * The HTTP gateway: the OAuth client its verified token names (`claude.ai`), else the token's subject.
 * Stdio and the mod: the client the connection names, on this machine (`claude-code@float-2`): a process of the
 * owner's own, so the machine is what tells two of the same client apart.
 */
export function principalOf(caller: McpCaller, machine: string = canonicalLocalMachineName()): string {
  if (caller.sub === STDIO_SUBJECT) return `${clientName(caller.clientId)}@${machine}`;
  return clientName(caller.clientId ?? caller.sub);
}

/** An MCP setting: the environment's, else `~/.config/ep0ch/mcp.env`'s (EP0CH_MCP_PERSONAS, EP0CH_MCP_SCRATCH_CAP). */
export function mcpSetting(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key];
  if (value !== undefined) return value;
  try {
    const file = join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config"), "ep0ch", "mcp.env");
    return existsSync(file) ? parseEnvFile(readFileSync(file, "utf8"))[key] : undefined;
  } catch { return undefined; }
}

/**
 * The persona a caller writes under, on top of its principal, and why a claimed one was not used.
 *
 * A persona is a label: it maps only within the principal auth proved, never across. `EP0CH_MCP_PERSONAS` (in the
 * environment, else in `~/.config/ep0ch/mcp.env`) is a comma list of `<who>=<persona>`, `<who>` being the principal
 * (`claude-code@float-2`, or the gateway's `claude.ai`) or the token's subject. A stdio process may also declare its
 * own (`OUTLINER_ACTOR`, else `EP0CH_AGENT`), which holds only where the list does not give that persona to another
 * principal: `claude-code@laptop` claiming `loki` while the list says `claude-code@float-2=loki` is refused. Read at each
 * write, so a change takes effect without a restart. A subject wins over a principal, a list over a claim.
 */
export function personaClaim(caller: McpCaller, env: Record<string, string | undefined> = process.env, machine?: string): { persona?: string; refused?: string } {
  const principal = principalOf(caller, machine);
  const entries = (mcpSetting(env, "EP0CH_MCP_PERSONAS") ?? "").split(",").map(e => e.split("=").map(x => x.trim()) as [string, string]).filter(([k, v]) => k && v && PERSONAS.test(v));
  const map = new Map(entries);
  const listed = map.get(caller.sub) ?? map.get(principal);
  if (listed) return { persona: listed };
  const claim = caller.sub === STDIO_SUBJECT ? (env.OUTLINER_ACTOR?.trim() || env.EP0CH_AGENT?.trim() || undefined) : undefined;
  if (!claim || !PERSONAS.test(claim)) return {};
  const owner = entries.find(([who, persona]) => persona === claim && who !== principal && who !== caller.sub);
  if (owner) return { refused: `${claim} belongs to ${owner[0]} in EP0CH_MCP_PERSONAS, not to ${principal}` };
  return { persona: claim };
}
/** A persona's name: what an actor id may hold before the `/`. */
const PERSONAS = PERSONA_PATTERN;

export const personaOf = (caller: McpCaller, env?: Record<string, string | undefined>, machine?: string): string | undefined => personaClaim(caller, env, machine).persona;

/** The attribution of a caller's write: `mcp:<persona>/<principal>` (outline-core's attribution.ts), its sessionId the subject and call. */
export const actorOf = (caller: McpCaller, env?: Record<string, string | undefined>, machine?: string): WriteActor => {
  const persona = personaOf(caller, env, machine);
  return { actorId: composeActor({ ...(persona ? { persona } : {}), principal: principalOf(caller, machine), mcp: true }), sessionId: sessionIdOf(caller) };
};

/** A write's sessionId: the subject, and `#<call>` when the caller has one (outline-core attribution.ts). */
export const sessionIdOf = (caller: McpCaller): string => composeSessionId({ subject: caller.sub, ...(caller.call ? { call: caller.call } : {}) });

/**
 * What an outline's access setting means for this caller (PIE-679): the principal that made a scratch outline writes to it with
 * `full`, whatever the setting lets the others (`read`). A setting of `none` is a person's denial and holds for everyone.
 */
export const levelFor = (status: { level: McpAccessLevel; owner?: string }, caller: McpCaller | undefined, machine?: string): McpAccessLevel =>
  caller && status.owner && status.level !== "none" && status.owner === principalOf(caller, machine) ? "full" : status.level;

/** Why a work id isn't stamped at this level (it is no proposal), or null when it may be. */
export const assignIdRefusal = (level: McpAccessLevel): string | null => level === "full" ? null
  : `outline_assign_id stamps the note and can't be proposed: it needs full access (this outline's is ${level}).`;

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
      return { tool, input: pick(args, ["body", "quote", "whole", "start", "prefix", "suffix", "requestId", "from", "revision"]) };
    case "outline_reply":
      if (!nonEmpty(args.thread) || !nonEmpty(args.body)) return { error: "Give the thread (an id outline_threads returned) and a non-empty reply." };
      return { tool, input: pick(args, ["thread", "body", "requestId"]) };
    case "outline_resolve_thread":
      if (!nonEmpty(args.thread) || typeof args.resolved !== "boolean") return { error: "Give the thread (an id outline_threads returned) and resolved: true or false." };
      return { tool, input: pick(args, ["thread", "resolved"]) };
    case "outline_set_property":
      if (typeof args.revision !== "number") return { error: "Give the revision outline_read returned." };
      if (!nonEmpty(args.key) || !nonEmpty(args.value)) return { error: "Give the key and a non-empty value." };
      return { tool, revision: args.revision, input: pick(args, ["key", "value"]) };
    case "outline_assign_id":
      if (typeof args.revision !== "number") return { error: "Give the revision outline_read returned." };
      return { tool, revision: args.revision, input: {} };
  }
}

/** The outliner's agent operations, as much of them as a write uses (loaded by a name the door's checker doesn't follow). */
interface AgentTools {
  createBlock(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<{ id: string; revision: number }>;
  commentOn(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<{ thread: string; blockId?: string; resourceId?: string; deduplicated?: boolean }>;
  replyTo(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<{ thread: string; reply: string; deduplicated?: boolean }>;
  resolveThread(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<{ thread: string; lifecycle: string }>;
  patchDraft(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<PatchResult>;
  setBlockProperty(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<PatchResult | { outcome: "unchanged"; key: string; value: string }>;
  assignWorkId(c: unknown, input: Record<string, unknown>, actor: WriteActor): Promise<{ outcome: "applied" | "unchanged"; workId: string; page: string }>;
  resolveRef(c: unknown, ref: string): Promise<{ id: string; fragmentId?: string }>;
  resourceRefOf(ref: string): unknown | null;
  readResource(c: unknown, ref: unknown): Promise<Record<string, unknown>>;
}
type PatchResult = { outcome: "applied"; edits: { blockId: string; route: "draft" | "saved"; revision?: number; rebasedFrom?: number }[] } | { outcome: "proposed"; reason: string; proposalId: string; beside: string; deduped?: true };
const AGENT_TOOLS_MODULE = "@ep0ch/outliner/agent-tools";
let agentTools: Promise<AgentTools> | null = null;
const loadAgentTools = () => agentTools ??= import(AGENT_TOOLS_MODULE) as Promise<AgentTools>;

/** The board as the agent operations' client: its requests, and its protocol check. */
const clientOf = (board: WriteBoard) => ({
  request: <T>({ action, ...rest }: { action: string } & Record<string, unknown>) => board.request<T>(action, rest),
  requireCompatibleService: () => board.info(),
});

/**
 * The block a ref names in an outline: its id, `((id))`, `[[page]]`, a Work ID (PIE-123) or a pi-outliner:// link,
 * resolved by the outliner's own `resolveRef`, the one the Claude mod's tools use. Reads only: a page that doesn't
 * resolve is an error, never a new page. A title is refused, as there.
 */
export async function resolveBoardRef(board: WriteBoard, ref: string): Promise<{ id: string; fragmentId?: string }> {
  return (await loadAgentTools()).resolveRef(clientOf(board), ref);
}

/**
 * Whether `ref` names a Resource (`resource:<id>`, or a `[file::path]` token) instead of a block, by the outliner's own
 * reading of it (PIE-650). A Resource is read and commented on live, in the outline it is registered in.
 */
export async function isResourceRef(ref: string): Promise<boolean> {
  try { return !!(await loadAgentTools()).resourceRefOf(ref); } catch { return true; }
}

/** A Resource with its stored text and open comment threads (`outliner agent read`, as the Claude mod's outline_read gives it). */
export async function readResourceOn(board: WriteBoard, ref: string): Promise<Record<string, unknown>> {
  const tools = await loadAgentTools();
  return tools.readResource(clientOf(board), tools.resourceRefOf(ref));
}

/** A comment on a Resource's text, as the agent (the same operation as a block's comment, kept for the note whose link names it with `from`). */
export async function commentOnResourceOn(board: WriteBoard, ref: string, input: Record<string, unknown>, actor: WriteActor): Promise<WriteOutcome> {
  const c = await (await loadAgentTools()).commentOn(clientOf(board), { ref, ...input }, actor);
  return { outcome: "applied", uri: c.resourceId ? `resource:${c.resourceId}` : ref, said: `commented on ${ref} (thread ${c.thread}); the Resource is not written`, detail: c };
}

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
  if (write.tool === "outline_assign_id") {
    const why = assignIdRefusal(o.level) ?? (o.proposeOnly ? "outline_assign_id stamps the note and can't be proposed: the note changed since it was read." : null);
    if (why) throw Object.assign(new Error(why), { name: "WorkToolRefusal" });
  }
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
    case "outline_reply": {
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
        if (o.queued) return gone(write.input.resolved ? "Resolved" : "Reopened", missing, `(${write.input.resolved ? "resolve" : "reopen"} asked of ${o.actor.actorId}; nothing to change)`);
        throw new Error(`No thread ${missing} on ${o.uri(write.blockId)}; outline_threads lists the note's threads.`);
      }
      const r = await tools.resolveThread(client, write.input, o.actor);
      return { outcome: "applied", uri: o.uri(write.blockId), said: `thread ${r.thread} on ${o.uri(write.blockId)} is now ${r.lifecycle}`, detail: r };
    }
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

const REF_ADDRESS = {
  uri: { type: "string", description: "The block's ep0ch:// URI (it names its outline)" },
  ref: { type: "string", description: "The block in `outline`: its id, ((id)), [[page]] or Work ID (PIE-123); for outline_read and outline_comment also a Resource: resource:<id> or a [file::path] token" },
};
const REVISION = { type: "integer", minimum: 1, description: "The revision outline_read returned. A note that changed since gets a proposal, never an overwrite." };

/** The write tools' definitions, for tools/list. `outline`: the outline property the read tools describe. */
export function writeToolDefinitions(outline: Record<string, unknown>) {
  const addressed = (properties: Record<string, unknown>, required: string[]) => ({
    type: "object",
    properties: { ...REF_ADDRESS, outline, ...properties, call: CALL_PROPERTY },
    required,
    additionalProperties: false,
    oneOf: [{ required: ["ref"] }, { required: ["uri"] }],
  });
  const answer = "The answer says applied, proposed (with why and the proposal's URI) or queued (an outline whose home is another machine: it lands when that machine pulls it), with the block's URI. " +
    "An outline at `propose` access takes proposals only; `full` applies; `read` takes no writes (list_outlines shows each one's access).";
  const threadWrite = { thread: { type: "string", description: "The thread's id, from outline_threads or outline_comment. The uri or ref is the note it is on." } };
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
      description: `Start a comment thread on a note: on an exact quote of its source text (add start, prefix or suffix when the quote repeats), or on the whole note. A requestId makes a retry return the same thread. A comment changes nothing but its thread, so propose access allows it. ` +
        `ref may name a Resource instead (resource:<id>, or a [file::path] token): the quote is then exact text of the file as outline_read returned it, from names the note whose link opened it, and the file is never written. ${answer}`,
      inputSchema: addressed({
        body: { type: "string" }, quote: { type: "string", description: "Exact source text the comment is about" }, whole: { type: "boolean" },
        start: { type: "integer", minimum: 0 }, prefix: { type: "string" }, suffix: { type: "string" }, requestId: { type: "string" },
        from: { type: "string", description: "A Resource comment: the note whose link opened it (kept as the thread's reference context)" },
        revision: { type: "integer", minimum: 1, description: "A Resource comment: the revision outline_read returned; the comment is refused if the file changed since" },
      }, ["body"]),
    },
    {
      name: "outline_reply",
      description: `Reply in a comment thread of a note (the uri or ref is the note; thread is the id outline_threads returned). A requestId makes a retry return the same reply. A reply changes nothing but its thread, so propose access allows it. If the thread is gone by the time a queued reply lands, it becomes a comment on the whole note saying so. ${answer}`,
      inputSchema: addressed({ ...threadWrite, body: { type: "string" }, requestId: { type: "string" } }, ["thread", "body"]),
    },
    {
      name: "outline_resolve_thread",
      description: `Resolve a comment thread of a note (resolved: true), or reopen it (false). Settling a thread changes only the thread, never the note, so propose access allows it. ${answer}`,
      inputSchema: addressed({ ...threadWrite, resolved: { type: "boolean" } }, ["thread", "resolved"]),
    },
    {
      name: "outline_set_property",
      description: `Set one [key::value] property on a note's header line (the chips that end its first line): the value replaced where the key is, or the chip added at the line's end, against the revision outline_read returned, as one outline_patch span. A key written more than once is a list: edit it with outline_patch. ${answer}`,
      inputSchema: addressed({ key: { type: "string" }, value: { type: "string", description: "One line, without ]" }, revision: REVISION }, ["key", "value", "revision"]),
    },
    {
      name: "outline_assign_id",
      description: "Give an existing note the outline's next work id (its prefix, whatever the outline has), against the revision outline_read returned. The id is the note's page address, so [[HUB-002]] reaches it: no [page::…] needed. " +
        "For notes that aren't roadmap items, such as an outbox draft. A note that already has an id answers with it, unchanged. It stamps the note, so it can't be a proposal: it needs full access, and a note that changed since is refused. " + answer,
      inputSchema: addressed({ revision: REVISION }, ["revision"]),
    },
  ];
}
