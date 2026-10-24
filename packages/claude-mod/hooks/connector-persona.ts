/**
 * The claude.ai connector's writes from a Claude Code session (PIE-1256). The connector is one OAuth principal, and the
 * gateway's `EP0CH_MCP_PERSONAS` maps it to one default persona, so a write that names none is recorded as that
 * default, whoever in the session made it. The mod fills `persona` with the session's own (the one the "writes as"
 * line shows) on every write the call doesn't name one for, and says so when an answer was recorded as someone else.
 * Pure: a hooks module can't import application code.
 */

import { outputJsonOf } from './tool-rows'

/** The connector's tool prefix in Claude Code: the server `claude.ai ep0ch`. */
export const CONNECTOR_PREFIX = 'mcp__claude_ai_ep0ch__'

/**
 * The door's `MCP_WRITE_TOOLS` (packages/door/src/mcp-writes.ts), which a hooks module can't import: the door's
 * test/claude-mod-contract.test.ts fails when the two lists differ.
 */
export const CONNECTOR_WRITE_TOOLS = [
  'outline_create', 'outline_patch', 'outline_comment', 'outline_reply', 'outline_resolve_thread', 'outline_quote', 'outline_set_property',
  'outline_move', 'outline_trash', 'outline_restore', 'outline_assign_id', 'outline_proposal_apply', 'outline_proposal_dismiss', 'outline_proposal_resolve',
] as const

/** The `tool.call` matcher for those tools. */
export const CONNECTOR_WRITE_MATCH = new RegExp(`^${CONNECTOR_PREFIX}(${CONNECTOR_WRITE_TOOLS.join('|')})$`)

/** The call with the session's persona in it: unchanged (null) when it names one already or the session has none. */
export function personaFilled<I extends Record<string, unknown>>(input: I, persona: string | undefined): (I & { persona: string }) | null {
  if (!persona) return null
  const named = input.persona
  if (typeof named === 'string' ? named.trim() : named !== undefined && named !== null) return null
  return { ...input, persona }
}

/**
 * What a write's answer says about who it was recorded as, when that isn't the session's persona: the line to show,
 * and the `by` it is about (`daddy (claude.ai)`). Null for an answer that isn't a write's, or one recorded as the session.
 */
export function slipOf(output: unknown, persona: string | undefined): { by: string; line: string } | null {
  if (!persona) return null
  const by = outputJsonOf(output)?.by
  if (typeof by !== 'string' || !by.trim()) return null
  if (by === persona || by.startsWith(`${persona} (`)) return null
  return { by, line: `ep0ch: that write through the claude.ai connector was recorded as ${by}, not ${persona}. Pass persona: "${persona}" on the call, or check EP0CH_MCP_PERSONAS.` }
}
