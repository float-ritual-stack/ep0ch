// What this Claude is doing, as program status (OSC 7501, PIE-614): the mod reports it to the terminal Claude runs in,
// so a door's terminal tile (or Ghostty, Rex) knows Claude is working, waiting on a permission or a question, done, or
// failed, from Claude's own events instead of reading its screen. Pure: each event's report; register.ts sends it
// (a child that writes it to /dev/tty, Claude's terminal) and says whether to at all.
//
// The events, from the engine's own (`turn.start`, `turn.complete`, the classic PermissionRequest, Notification,
// PostToolUse, PermissionDenied and StopFailure hooks):
// - a turn starts: working;
// - a permission dialog is shown (PermissionRequest that no hook answered; the Notification `permission_prompt`):
//   blocked, kind=permission, saying what it asks;
// - AskUserQuestion, or an MCP elicitation dialog: blocked, kind=question;
// - the tool runs or is denied after that (PostToolUse, PostToolUseFailure, PermissionDenied): working again;
// - the main loop's turn ends: answered, done (its answer's first line); interrupted, idle; refused or an API error, error;
// - the session starts: idle; it ends: cleared.
import { encodeProgramStatus, type StatusInput } from './program-status'

/** The app every report carries (a report replaces its record whole). */
export const CLAUDE_APP = 'claude-code'
/** Asking the terminal's terminfo whether it speaks the protocol: the door puts `Pst` in a tile's xterm-256color. */
export const PST_ARGV = ['tput', 'Pst'] as const

/**
 * What EP0CH_PROGRAM_STATUS says: true (1, on), false (0, off, native: Claude Code reports itself), or null (the terminal's terminfo decides: `Pst`, asked
 * only where there is a TERM). Claude owns its terminal's input, so the mod never sends the feature query.
 */
export function statusSetting(setting: string | null | undefined): boolean | null {
  const v = setting?.trim().toLowerCase() ?? ''
  if (/^(1|on|yes|true)$/.test(v)) return true
  // `native`: Claude Code reports its own status (OSC 7501) and the mod steps aside, so a record never has two writers.
  if (/^(0|off|no|false|native)$/.test(v)) return false
  return null
}

/** The child that writes one report to Claude's terminal. */
export function ttyArgv(seq: string): string[] {
  return ['sh', '-c', 'printf "%s" "$1" > /dev/tty', 'ep0ch-status', seq]
}

/** The report's sequence, with the app. */
export const sequenceOf = (r: StatusInput): string => encodeProgramStatus(r.state === 'clear' ? r : { ...r, app: CLAUDE_APP })

const line = (s: string, max = 200): string => {
  const first = s.split('\n').map(l => l.trim()).find(l => l !== '') ?? ''
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

/** What a tool call is about, in a few words: its command, file, URL or pattern. */
function about(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const i = input as Record<string, unknown>
  for (const k of ['command', 'file_path', 'path', 'url', 'pattern', 'description']) if (typeof i[k] === 'string' && i[k]) return line(i[k] as string, 160)
  return ''
}

export const sessionStarted = (): StatusInput => ({ state: 'idle' })
export const sessionEnded = (): StatusInput => ({ state: 'clear' })
export const working = (): StatusInput => ({ state: 'working' })

/** A permission dialog for `tool`: what it would do. */
export function permissionAsked(tool: string, input: unknown): StatusInput {
  const what = about(input)
  return { state: 'blocked', kind: 'permission', msg: `Allow ${tool}${what ? `: ${what}` : ''}?` }
}

/** AskUserQuestion's first question. */
export function questionAsked(input: unknown): StatusInput {
  const qs = (input as { questions?: { question?: unknown }[] } | null)?.questions
  const q = Array.isArray(qs) && typeof qs[0]?.question === 'string' ? line(qs[0].question) : ''
  return { state: 'blocked', kind: 'question', ...(q ? { msg: q } : { msg: 'Claude asks you a question' }) }
}

/** A Notification: a permission prompt or an elicitation dialog blocks; the rest (idle_prompt, auth_success) says nothing new. */
export function notified(type: string, message: string): StatusInput | null {
  if (type === 'permission_prompt') return { state: 'blocked', kind: 'permission', ...(message ? { msg: line(message) } : {}) }
  if (type === 'elicitation_dialog') return { state: 'blocked', kind: 'question', ...(message ? { msg: line(message) } : {}) }
  return null
}

/** The main loop's turn ended: answered, interrupted, refused, or stopped by an API error. */
export function turnEnded(reason: string, answer: string): StatusInput {
  if (reason === 'answer') { const a = line(answer); return { state: 'done', ...(a ? { msg: a } : {}) } }
  if (reason === 'aborted') return { state: 'idle', msg: 'interrupted' }
  if (reason === 'refusal') return { state: 'error', msg: 'the model refused' }
  return { state: 'error', msg: 'stopped on an API error' }
}

/** StopFailure: the turn died on an API error. */
export function stopFailed(error: unknown, details: string | undefined): StatusInput {
  const what = details ? line(details) : typeof error === 'string' ? error : ''
  return { state: 'error', msg: what ? `stopped: ${what}` : 'stopped on an API error' }
}
