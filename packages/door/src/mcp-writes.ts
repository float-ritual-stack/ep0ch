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

export { assignIdRefusal, restoreRefusal, proposalSettlementRefusal, writesAt } from "@ep0ch/outliner/mcp-write";
export type { McpWrite, WriteOutcome } from "@ep0ch/outliner/mcp-write";
import type { McpWrite, WriteOutcome } from "@ep0ch/outliner/mcp-write";
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
  moveBlock(c: unknown, input: Record<string, unknown>, actor: WriteActor & { author?: "user" | "agent" }): Promise<{ outcome: "applied" | "unchanged"; said: string } & Record<string, unknown>>;
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
 * A move of note `input.ref` by the outliner's own `moveBlock`, the one rule for where a note lands (outline_move, the CLI
 * and the door's person all come here): under `parent` (a ref, or `root`) at `position`, `before` or `after` a sibling, or
 * one `step`; with `revision`, only the note as it was read. `actor.author` is who asked ("user" for the person).
 */
export async function moveWithRules(board: WriteBoard, input: { ref: string; parent?: string; before?: string; after?: string; position?: number; revision?: number; step?: string }, actor: WriteActor & { author?: "user" | "agent" }): Promise<{ outcome: "applied" | "unchanged"; said: string; parentId?: string | null; position: number; previousParentId?: string | null; previousPosition: number } & Record<string, unknown>> {
  return (await loadAgentTools()).moveBlock(clientOf(board), input, actor) as never;
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

export type { ApplyOptions } from "@ep0ch/outliner/mcp-write";
export async function applyWrite(board: WriteBoard, write: McpWrite, options: import("@ep0ch/outliner/mcp-write").ApplyOptions): Promise<WriteOutcome> {
  const module = "@ep0ch/outliner/mcp-write";
  return (await import(module)).applyWrite(board, write, options);
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
