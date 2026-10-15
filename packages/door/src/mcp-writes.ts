// The remote MCP gateway's writes (PIE-615, PIE-877): eleven tools, one write path. The tools take the Claude mod's shapes
// (`outline_create`, `outline_patch`, `outline_comment`, `outline_set_property`, `outline_reply`,
// `outline_resolve_thread`, `outline_assign_id`, `outline_move`, `outline_trash` and `outline_restore`), and `outline_quote` (marks quoted into a new block, `marks.quote`), addressed as the read tools are (a
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
//               (outline_move and outline_trash are comments on the note naming the change, for its owner to make;)
//   (outline_assign_id stamps a work id, and outline_restore brings a note back from Trash, which is no proposal: each is applied at full and refused below it.)
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
import { actorLabel, composeActor, composeSessionId, CALL_PATTERN, PERSONA_PATTERN } from "@ep0ch/outline-core/attribution";
import { sessionPersona, type LocationReader } from "@ep0ch/outline-core/outline-location";
import { canonicalLocalMachineName } from "@ep0ch/outliner/machine-name";
import { AGENT_TOOL_DEFINITIONS, AGENT_TOOL_SURFACES, describeTool, type TargetWords } from "@ep0ch/outline-core/agent-tool-definitions";
import type { BoardAddress } from "./notes-cli";
import type { SocketBoard } from "./socket";

/** The outline a write goes to: a board, and its address when it has one (for what a refusal says). */
export type WriteBoard = SocketBoard & { address?: BoardAddress };

/** The write tools, in the order tools/list offers them. */
export const MCP_WRITE_TOOLS = ["outline_create", "outline_patch", "outline_comment", "outline_reply", "outline_resolve_thread", "outline_quote", "outline_set_property", "outline_move", "outline_trash", "outline_restore", "outline_assign_id", "outline_proposal_apply", "outline_proposal_dismiss"] as const;
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
  /**
   * The persona the connection names (PIE-804): the gateway's `/<name>/mcp` path. It wins over every other source, and,
   * like any persona, is recorded and never checked (ADR 0003 §2).
   */
  persona?: string;
  /**
   * The most this connection may do in an outline, whatever the outline's setting lets it (a named path's, `propose` by
   * default; `pathCap`). Asked with the outline, or with none for the connection's own default.
   */
  cap?: (where?: BoardAddress) => McpAccessLevel;
  /** The folder a stdio server runs in: the nearest `.ep0ch`'s `agent` there names its persona (ADR 0003 §3). */
  folder?: string;
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

/**
 * A client's short name: the name its registration was given here (`EP0CH_MCP_CLIENT_NAMES`, `<client_id>=<name>`, read
 * with the persona list: a dynamically registered client's id says nothing, `chatgpt` does), else a URL client id (a CIMD
 * client) by its host, anything else as it is.
 */
export function clientName(clientId: string | undefined, env: Record<string, string | undefined> | null = process.env): string {
  if (!clientId) return "client";
  const named = env && (mcpSetting(env, "EP0CH_MCP_CLIENT_NAMES") ?? "").split(",").map(e => e.split("=").map(x => x.trim())).find(([id]) => id === clientId)?.[1];
  if (named && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(named)) return named;
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
export function principalOf(caller: McpCaller, machine: string = canonicalLocalMachineName(), env: Record<string, string | undefined> = process.env): string {
  // A stdio client names itself in its initialize: the gateway's registered-name list is for OAuth clients only.
  if (caller.sub === STDIO_SUBJECT) return `${clientName(caller.clientId, null)}@${machine}`;
  return clientName(caller.clientId ?? caller.sub, env);
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
 * The persona a caller writes as (ADR 0003 §3, as amended): a recorded name, never a permission, so nothing here refuses
 * one. First match wins: the connection's own name for itself (the gateway's `/<name>/mcp` path); for stdio,
 * `OUTLINER_ACTOR`, else `EP0CH_AGENT`, else the `agent` of the nearest `.ep0ch` from the folder it runs in
 * (outline-core's `sessionPersona`); then this machine's default, `EP0CH_MCP_PERSONAS` (in the environment, else in
 * `~/.config/ep0ch/mcp.env`), a comma list of `<who>=<persona>` where `<who>` is the token's subject or the principal
 * (`claude-code@float-2`, the gateway's `claude.ai`), a subject winning; else none. The principal is always recorded
 * beside it, so a persona never hides where a write came from. Read at each write, so a change takes effect without a restart.
 */
export function personaClaim(caller: McpCaller, env: Record<string, string | undefined> = process.env, machine?: string): { persona?: string } {
  // The connection's own name for itself (the gateway's path): what this caller writes as.
  if (caller.persona && PERSONAS.test(caller.persona)) return { persona: caller.persona };
  if (caller.sub === STDIO_SUBJECT) {
    const own = sessionPersona({ env, folder: caller.folder ?? "", fs: caller.folder ? DISK : NO_DISK });
    if (own) return { persona: own.name };
  }
  const principal = principalOf(caller, machine, env);
  const entries = (mcpSetting(env, "EP0CH_MCP_PERSONAS") ?? "").split(",").map(e => e.split("=").map(x => x.trim()) as [string, string]).filter(([k, v]) => k && v && PERSONAS.test(v));
  const map = new Map(entries);
  const listed = map.get(caller.sub) ?? map.get(principal);
  return listed ? { persona: listed } : {};
}
/** The disk as outline-core's location rule reads it, and no disk (a caller with no folder has no `.ep0ch`). */
const DISK: LocationReader = { readFile: p => { try { return readFileSync(p, "utf8"); } catch { return undefined; } }, exists: existsSync };
const NO_DISK: LocationReader = { readFile: () => undefined, exists: () => false };
/** A persona's name: what an actor id may hold before the `/`. */
const PERSONAS = PERSONA_PATTERN;

export const personaOf = (caller: McpCaller, env?: Record<string, string | undefined>, machine?: string): string | undefined => personaClaim(caller, env, machine).persona;

/** The attribution of a caller's write: `mcp:<persona>/<principal>` (outline-core's attribution.ts), its sessionId the subject and call. */
export const actorOf = (caller: McpCaller, env?: Record<string, string | undefined>, machine?: string): WriteActor => {
  const persona = personaOf(caller, env, machine);
  return { actorId: composeActor({ ...(persona ? { persona } : {}), principal: principalOf(caller, machine, env), mcp: true }), sessionId: sessionIdOf(caller) };
};

/** A write's sessionId: the subject, and `#<call>` when the caller has one (outline-core attribution.ts). */
export const sessionIdOf = (caller: McpCaller): string => composeSessionId({ subject: caller.sub, ...(caller.call ? { call: caller.call } : {}) });

/**
 * What an outline's access setting means for this caller (PIE-679): the principal that made a scratch outline writes to it with
 * `full`, whatever the setting lets the others (`read`). A setting of `none` is a person's denial and holds for everyone.
 */
export const levelFor = (status: { level: McpAccessLevel; owner?: string }, caller: McpCaller | undefined, machine: string | undefined, where: BoardAddress | undefined): McpAccessLevel => {
  const level = caller && status.owner && status.level !== "none" && status.owner === principalOf(caller, machine) ? "full" : status.level;
  // A connection capped lower (a named path's `propose`) gets no more than its cap in this outline, whatever it allows.
  const cap = caller?.cap?.(where);
  return cap && LEVELS.indexOf(cap) < LEVELS.indexOf(level) ? cap : level;
};

/**
 * What a named path may do at most, in each outline (PIE-804): `EP0CH_MCP_PATH_ACCESS`, a comma list of
 * `<persona>[@<outline>[@<machine>]]=<level>` (`gpty@gurgle=full,gpty=propose`). The most specific entry for the outline
 * wins (with its machine, then the outline alone, then the persona alone), else `propose`. An outline is named as with
 * `--ws`, a mirror as `<outline>@<machine>`. It is a cap: the outline's own level still bounds it.
 */
export function pathCap(spec: string, persona: string): (where?: BoardAddress) => McpAccessLevel {
  const entries = new Map<string, McpAccessLevel>();
  for (const entry of spec.split(",")) {
    const [who = "", level = ""] = entry.split("=").map(x => x.trim());
    if ((LEVELS as readonly string[]).includes(level)) entries.set(who.toLowerCase(), level as McpAccessLevel);
  }
  const name = persona.toLowerCase();
  return where => (where ? entries.get(`${name}@${where.outline}@${where.machine}`.toLowerCase()) ?? entries.get(`${name}@${where.outline}`.toLowerCase()) : undefined)
    ?? entries.get(name) ?? "propose";
}
const LEVELS: readonly McpAccessLevel[] = ["none", "read", "propose", "full"];

/** Why a work id isn't stamped at this level (it is no proposal), or null when it may be. */
export const assignIdRefusal = (level: McpAccessLevel): string | null => level === "full" ? null
  : `outline_assign_id stamps the note and can't be proposed: it needs full access (this outline's is ${level}).`;

/** Why a note isn't brought back from Trash at this level (it is no proposal), or null when it may be. */
export const restoreRefusal = (level: McpAccessLevel): string | null => level === "full" ? null
  : `outline_restore brings a note back from Trash and can't be proposed: it needs full access (this outline's is ${level}).`;

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

/** Stands in for the block a write is addressed to (the caller's uri or ref, resolved later) while its definition checks the rest. */
const ADDRESSED = "(the addressed block)";

/**
 * A write tool's arguments checked for shape by its one definition (@ep0ch/outline-core/agent-tool-definitions, the
 * check the Claude mod and the host API make); the address is the caller's (`uri` or `ref`), filled in once resolved.
 * The service checks the rest.
 */
export function writeInput(tool: McpWriteTool, args: Record<string, unknown>): Omit<McpWrite, "blockId"> | { error: string } {
  if (tool === "outline_quote") {
    if (!Array.isArray(args.marks) || !args.marks.length || !args.marks.every(nonEmpty)) return { error: "Give marks: the ids of highlights, comments or replies on the note (outline_threads lists them)." };
    if (args.where !== undefined && !nonEmpty(args.where)) return { error: "where is inbox (the default), note (under the note) or a block's ref." };
    return { tool, input: pick(args, ["marks", "where", "text"]) };
  }
  const definition = SHARED_WRITE_TOOLS.find(d => d.name === tool)!;
  const target = definition.target ?? "ref";
  const command = definition.command({ ...args, [target]: ADDRESSED });
  if (typeof command === "string") return { error: command };
  // outline_reply's edit runs the edit-comment operation: the gateway keeps it as the tool's own `edit`.
  const { [target]: _address, ...input } = command.input;
  if (command.operation === "edit-comment") {
    const { mark, ...words } = input;
    return { tool, input: { edit: mark, ...words } };
  }
  // A revision is the note's, checked where the write lands; a comment's is a Resource's, part of its input.
  const { revision, ...rest } = input;
  if (tool === "outline_comment" || typeof revision !== "number") return { tool, input };
  return { tool, revision, input: rest };
}

/** The outliner's agent operations, as much of them as a write uses (loaded by a name the door's checker doesn't follow). */
interface AgentTools {
  settleProposal(c: unknown, input: { ref: string }, op: "apply" | "dismiss", actor: WriteActor): Promise<unknown>;
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
 * An agent's move of note `ref` under `parent` (inbox resolved by the caller to its id), first: the outliner's own
 * `moveBlock`, the one outline_move runs, with its rules (no system note moved, none but the Inbox a parent), attributed.
 */
export async function moveAsAgent(board: WriteBoard, ref: string, parent: string, actor: WriteActor): Promise<{ outcome: "applied" | "unchanged"; said: string } & Record<string, unknown>> {
  return (await loadAgentTools()).moveBlock(clientOf(board), { ref, parent, position: 0 }, actor);
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
  if (write.tool === "outline_restore") {
    const why = restoreRefusal(o.level) ?? (o.proposeOnly ? "outline_restore can't be proposed: the note changed since it was read." : null);
    if (why) throw Object.assign(new Error(why), { name: "WorkToolRefusal" });
  }
  if ((write.tool === "outline_proposal_apply" || write.tool === "outline_proposal_dismiss") && o.level !== "full") {
    throw new Error(`${write.tool} settles a proposal and can't be proposed: it needs full access (this outline's is ${o.level}).`);
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

const REF_ADDRESS = {
  uri: { type: "string", description: "The block's ep0ch:// URI (it names its outline)" },
  ref: { type: "string", description: "The block in `outline`: its id, ((id)), [[page]] or Work ID (PIE-123); for outline_read and outline_comment also a Resource: resource:<id> or a [file::path] token" },
};

/** How the gateway names the block a shared tool acts on (outline-core agent-tool-definitions' `{note}` and `{parent}`). */
const GATEWAY_WORDS: TargetWords = { note: "the note (its uri, or ref in `outline`)", parent: "the parent (its uri, or ref in `outline`)" };

/** What the outline's access setting makes of each shared write, said after its description. */
const ACCESS_NOTES: Readonly<Record<string, string>> = {
  outline_create: "At propose access it becomes a comment on the parent carrying the text.",
  outline_comment: "A comment changes nothing but its thread, so propose access allows it.",
  outline_reply: "A reply changes nothing but its thread, so propose access allows it; with edit, at propose access it's a reply in the thread proposing the new words. If the thread is gone by the time a queued reply lands, it becomes a comment on the whole note saying so.",
  outline_resolve_thread: "Settling a thread changes only the thread, never the note, so propose access allows it.",
  outline_move: "At propose access it becomes a comment on the note naming the move.",
  outline_trash: "At propose access it becomes a comment on the note proposing it.",
  outline_restore: "It needs full access (a restore is no proposal).",
  outline_assign_id: "It stamps the note, so it can't be a proposal: it needs full access, and a note that changed since is refused.",
};

/** The shared write tools the gateway registers (PIE-720): each defined once, addressed the gateway's way. */
const SHARED_WRITE_TOOLS = AGENT_TOOL_DEFINITIONS.filter(d => d.writes && AGENT_TOOL_SURFACES[d.name]?.gateway === true);

/** A shared tool's call as the gateway takes it: the block it acts on as `ref` (the note a thread is on, for a thread tool). */
export function gatewayExample(name: string): Record<string, unknown> | undefined {
  const definition = SHARED_WRITE_TOOLS.find(d => d.name === name);
  if (!definition) return undefined;
  const { [definition.target ?? "ref"]: target, ...rest } = definition.example;
  return { ref: target ?? "PIE-123", ...rest };
}

/** The write tools' definitions, for tools/list. `outline`: the outline property the read tools describe. */
export function writeToolDefinitions(outline: Record<string, unknown>) {
  const addressed = (properties: Record<string, unknown>, required: readonly string[]) => ({
    type: "object",
    properties: { ...REF_ADDRESS, outline, ...properties, call: CALL_PROPERTY },
    required,
    additionalProperties: false,
    oneOf: [{ required: ["ref"] }, { required: ["uri"] }],
  });
  const answer = "The answer says applied, proposed (with why and the proposal's URI) or queued (an outline whose home is another machine: it lands when that machine pulls it), with the block's URI. " +
    "An outline at `propose` access takes proposals only; `full` applies; `read` takes no writes (list_outlines shows each one's access).";
  const shared = SHARED_WRITE_TOOLS.map(definition => {
    // The block it acts on is the gateway's address (uri, or ref in outline); a thread tool's address is the note it is on.
    const { [definition.target ?? ""]: _target, ...properties } = definition.properties;
    return {
      name: definition.name,
      description: [describeTool(definition, GATEWAY_WORDS), definition.target ? "" : "The uri or ref is the note the thread is on.", ACCESS_NOTES[definition.name], answer].filter(Boolean).join(" "),
      inputSchema: addressed(properties, definition.required.filter(key => key !== definition.target)),
    };
  });
  const tools = [
    ...shared,
    {
      name: "outline_quote",
      description: `Quote marks into a new block (the margin's quote-tweet): highlights, comments or replies on a note (the uri or ref is the note; marks are ids outline_threads returned), each transcluded as !((mark)) under one [from::((mark))] line, so the new block traces back to where it was said and each mark lists it as quoted in. where: inbox (the top of the Inbox, the default), note (under the note) or a block's ref to put it under. text: the new block's own words above the quotes (its first line is its title). The marks stay where they are. At propose access it becomes a comment on the note proposing it. ${answer}`,
      inputSchema: addressed({ marks: { type: "array", minItems: 1, maxItems: 20, items: { type: "string" } }, where: { type: "string" }, text: { type: "string" } }, ["marks"]),
    },
  ];
  const at = (name: string) => (MCP_WRITE_TOOLS as readonly string[]).indexOf(name);
  return tools.sort((a, b) => at(a.name) - at(b.name));
}
