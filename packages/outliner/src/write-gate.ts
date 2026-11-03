/*
 * The write gate (PIE-1544, ADR 0005): the one place that decides what an agent's write becomes. Every surface an agent
 * writes through asks it — the MCP gateway and stdio server, the Claude mod and the CLI's agent operations, a script's
 * tools and place(), scripts.run, the netmail drain — passing who is calling and its cap as data. It answers the level
 * the caller writes at and what the write becomes: applied, proposed as a patch beside the note, proposed as a comment
 * on it, or refused, with the words every surface says. Pure: no I/O; the caller reads `mcp.access.status` (yolo
 * already applied by the service) and hands it in.
 */
import { lowerLevel, type McpAccessLevel } from "@ep0ch/outline-core/protocol";

/** Who is asking: a session on this machine (`local`: the Claude mod, the CLI's agent operations) or anyone else. */
export interface GateCaller {
  /** `local` writes as `full` where the owner never set a level, as the host's own extensions do (server.ts grantedLevel). */
  local?: boolean;
  /** The caller's principal: the one that made an outline over MCP writes there with `full` (PIE-679). */
  principal?: string;
  /** The most this connection may do in this outline (a named path's cap, PIE-804). */
  cap?: McpAccessLevel;
}

/** The outline's setting, as `mcp.access.status` answers it. */
export interface GateStatus { level: McpAccessLevel; owner?: string; set?: boolean }

/** Which outline, for the words: `via` says how it was read (a mirror, as of when). */
export interface GateWhere { outline: string; machine: string; via?: string }

/** Why the level is what it is. */
export type LimitedBy = "grant" | "owner" | "cap" | "unset";

/** The level a caller writes at in an outline: the setting, the maker's `full`, a local session's `full` on an unset outline, then its cap. */
export function effectiveLevel(status: GateStatus, caller: GateCaller = {}): { level: McpAccessLevel; limitedBy: LimitedBy } {
  let level = status.level, limitedBy: LimitedBy = "grant";
  // A host that doesn't say (`set` absent: one not yet updated) is read as unset, so a local session writes as it always has.
  if (caller.local && status.set !== true) { level = "full"; limitedBy = "unset"; }
  else if (caller.principal && status.owner && status.level !== "none" && status.owner === caller.principal) { level = "full"; limitedBy = "owner"; }
  if (caller.cap) {
    const capped = lowerLevel(caller.cap, level);
    if (capped !== level) { level = capped; limitedBy = "cap"; }
  }
  return { level, limitedBy };
}

/** What a write becomes. */
export type Becomes = "applied" | "proposed-patch" | "proposed-comment" | "refused";

/**
 * What each write tool becomes at `propose`: a patch beside the note (draft.patch's proposal), a comment on the note
 * carrying it, applied as it is (a comment or a mark is already a proposal's kind of write), or `full` only, with why
 * it can't be a proposal. A tool not named here is `full` only.
 */
const AT_PROPOSE: Readonly<Record<string, Exclude<Becomes, "refused"> | { fullOnly: string; queued?: "applied" }>> = {
  outline_patch: "proposed-patch",
  outline_set_property: "proposed-patch",
  outline_edit: "proposed-patch",
  outline_create: "proposed-comment",
  outline_move: "proposed-comment",
  outline_trash: "proposed-comment",
  outline_quote: "proposed-comment",
  outline_comment: "applied",
  outline_reply: "applied",
  outline_resolve_thread: "applied",
  // A script runs at propose: its own writes are proposals (place() and its tools ask this gate again).
  script_run: "applied",
  outline_assign_id: { fullOnly: "stamps the note" },
  outline_restore: { fullOnly: "brings a note back from Trash" },
  outline_proposal_apply: { fullOnly: "settles a proposal", queued: "applied" },
  outline_proposal_dismiss: { fullOnly: "settles a proposal", queued: "applied" },
  outline_proposal_resolve: { fullOnly: "settles a proposal", queued: "applied" },
  view_order: { fullOnly: "reorders a view" },
  artifact_deploy: { fullOnly: "deploys a site" },
  // A script's reach past the outline (host-api.ts): no proposal can carry it.
  act: { fullOnly: "dispatches door actions" },
  sh: { fullOnly: "runs commands" },
  fetch: { fullOnly: "fetches URLs" },
};

/** The words for an outline: `pie@float-2`, or `this outline` when the caller has no address. */
const named = (where?: GateWhere) => where ? `${where.outline}@${where.machine}${where.via ? ` (${where.via})` : ""}` : "this outline";

/** Why a level takes no writes, and the command that allows them. The same words on every surface. */
export function noWritesWords(level: McpAccessLevel, where?: GateWhere): string {
  const fix = where ? `its owner runs \`ep0ch mcp access propose --ws ${where.outline}\` (proposals) or \`… full …\` (applied) on ${where.machine} to allow them`
    : "its owner runs `ep0ch mcp access propose` (proposals) or `… full` (applied) to allow them";
  return `MCP access is ${level} for ${named(where)}, which takes no writes; ${fix}.`;
}

export interface GateAnswer {
  level: McpAccessLevel;
  becomes: Becomes;
  /** With `refused`: why, in the words every surface says. */
  why?: string;
}

export interface GateAsk {
  /** The agent tool (outline_patch, outline_edit, script_run, …). */
  tool: string;
  level: McpAccessLevel;
  where?: GateWhere;
  /** A queued write whose note changed since it was read: proposed whatever the level (src/mcp-netmail.ts). */
  proposeOnly?: boolean;
  /** A create at the top level, which no proposal can carry (a proposal is a comment on a note). */
  top?: boolean;
}

/** What an agent's write becomes at a level: the one decision. */
export function gate({ tool, level, where, proposeOnly, top }: GateAsk): GateAnswer {
  if (level !== "propose" && level !== "full") return { level, becomes: "refused", why: noWritesWords(level, where) };
  const proposing = level === "propose" || !!proposeOnly;
  if (!proposing) return { level, becomes: "applied" };
  const kind = AT_PROPOSE[tool] ?? { fullOnly: "changes the outline directly" };
  if (typeof kind === "object") {
    // A queued settlement at full lands whatever changed: settling is about the proposal, not the note's text.
    if (level === "full" && kind.queued) return { level, becomes: kind.queued };
    const why = level === "propose" ? `it needs full access (this outline's is ${level})` : "the note changed since it was read";
    return { level, becomes: "refused", why: `${tool} ${kind.fullOnly} and can't be proposed: ${why}.` };
  }
  if (tool === "outline_create" && top) return { level, becomes: "refused", why: "A new top-level note can't be proposed: a proposal is a comment on a note, and the top level is none. Give a parent note, or ask for full access (ep0ch mcp access full)." };
  return { level, becomes: kind };
}

/** A gate refusal as an error, named as the agent tools name theirs (a refusal, never retried). */
export const gateRefusal = (why: string): Error => Object.assign(new Error(why), { name: "WorkToolRefusal" });

/** What a level's writes become, in a listing's word (`applied`, `proposals`), or null when it takes none: the gate's answer for a patch. */
export function writesAt(level: McpAccessLevel): "applied" | "proposals" | null {
  const { becomes } = gate({ tool: "outline_patch", level });
  return becomes === "applied" ? "applied" : becomes === "refused" ? null : "proposals";
}
