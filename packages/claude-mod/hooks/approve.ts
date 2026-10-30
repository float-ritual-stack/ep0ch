// Approve from the phone (PIE-1386): a permission dialog this session shows is also written as an ask note in the one
// outline the person's list is in (askOutlineOf: pie, client work aside), under its [[permission-asks]] page, with
// `[needs::sysop: …]` on its first line so the Waiting on Evan view (and any view of `needs`) lists it, and its steps:
// allow once, allow this one command for the session (when a rule can name it), deny. The person ticks one, on the web
// page (my.ep0ch.sh, a tap) or in the door: both are the one `checklist.update`, written as `author: user`. The dialog
// shows in the session at the same time, and the first answer wins: a tick answers the dialog (a tick an agent wrote
// counts for nothing), and an answer at the terminal closes the note at once, saying so. Pure: register.ts runs the CLI
// and the clock.
import { boxStatus } from './link-grammar.js'
import { EVENT_KEYS } from './outline-tools'

export const ASK_PAGE = 'permission-asks'

/** The ask's steps, by what each answers; the session step's words name what it grants (sessionGrantOf). */
export const ASK_STEPS = {
  allow: 'allow this once',
  session: 'allow for this session',
  deny: 'deny',
} as const
export type AskAnswer = keyof typeof ASK_STEPS

/** How long the ask stays on the person's list while the dialog waits in the session (PIE-1386's 600 s). */
export const BACKGROUND_WAIT_MS = 600_000

/**
 * How long the ask stays on the person's list: `EP0CH_APPROVE_WAIT` in seconds when it is set (0 turns it off); else
 * 600 s in a session nobody watches (a background job, `CLAUDE_JOB_DIR`), and none in one someone does: whoever watches
 * answers its dialog there, so an ask would only be noise on the list. The dialog shows at once either way; the hook
 * holding the ask never holds it.
 */
export function approveWaitMs(env: { EP0CH_APPROVE_WAIT?: string; CLAUDE_JOB_DIR?: string }): number {
  const given = env.EP0CH_APPROVE_WAIT?.trim()
  if (given) {
    const seconds = Number(given)
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) * 1000 : 0
  }
  return env.CLAUDE_JOB_DIR?.trim() ? BACKGROUND_WAIT_MS : 0
}

/** What a dialog asks, in one line: the tool and the gist of its input (the command, the file, the URL). */
export function askLine(tool: string, input: unknown): string {
  const o = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const gist = [o.command, o.file_path, o.url, o.path, o.pattern, o.description].find(v => typeof v === 'string' && v.trim()) as string | undefined
  const one = (gist ?? '').replace(/\s+/g, ' ').trim()
  return `${tool}${one ? `: ${one.length > 120 ? `${one.slice(0, 119)}…` : one}` : ''}`
}

/**
 * The ask note's text. `who` names the session (its persona, machine and folder); `[ask-tool::…]` keeps the tool;
 * `session` is the session step's words (sessionGrantOf), left out when no rule names the call exactly.
 */
export function askText(tool: string, input: unknown, who: string, asked: string, session?: string): string {
  const line = askLine(tool, input)
  const chip = line.replace(/[[\]]/g, '')
  const body = input && typeof input === 'object' ? JSON.stringify(input, null, 2) : String(input ?? '')
  const shown = body.length > 2000 ? `${body.slice(0, 2000)}\n… cut at 2000 characters` : body
  return [
    `Allow ${chip.length > 60 ? `${chip.slice(0, 59)}…` : chip}? [needs::sysop: ${chip}] [type::permission-ask] [ask-tool::${tool.replace(/[[\]]/g, '')}]`,
    '',
    `- [ ] ${ASK_STEPS.allow}`,
    ...(session ? [`- [ ] ${session}`] : []),
    `- [ ] ${ASK_STEPS.deny}`,
    '',
    `${who} asked at ${asked}. Tick one, or answer the dialog in the session: the first answer wins, and only your tick counts here.`,
    '',
    '```json',
    shown.replace(/```/g, '` ` `'),
    '```',
  ].join('\n')
}

/** The session step, whatever it names: `allow <what> for this session`. */
const SESSION_STEP = /^allow (?:.+ )?for this session$/

/** The words a step was ticked with: the session step's own (`allow \`touch\` for this session`), else ASK_STEPS'. */
export function stepWords(text: string, answer: AskAnswer): string {
  if (answer !== 'session') return ASK_STEPS[answer]
  for (const line of text.split('\n')) {
    const m = /^\s*[-*+]\s+\[.\]\s+(.+?)(?:\s+\^[A-Za-z0-9][\w-]*)?\s*$/.exec(line)
    if (m && SESSION_STEP.test(m[1]!)) return m[1]!
  }
  return ASK_STEPS.session
}

/** Each step's status as its box reads (outline-core's one box grammar, bundled), by its answer. */
function boxes(text: string): Map<AskAnswer, ReturnType<typeof boxStatus>> {
  const found = new Map<AskAnswer, ReturnType<typeof boxStatus>>()
  for (const line of text.split('\n')) {
    // A step's id (`^t-…`, which a first change gives it) is not its words.
    const m = /^\s*[-*+]\s+(\[.\])\s+(.+?)(?:\s+\^[A-Za-z0-9][\w-]*)?\s*$/.exec(line)
    if (!m) continue
    const which = SESSION_STEP.test(m[2]!) ? 'session' : (Object.keys(ASK_STEPS) as AskAnswer[]).find(k => ASK_STEPS[k] === m[2])
    if (which && !found.has(which)) found.set(which, boxStatus(m[1]!))
  }
  return found
}

/**
 * The answer the note's steps give, or null while none is ticked. A deny wins over an allow ticked with it; an allow
 * marked rejected is a deny.
 */
export function answerOf(text: string): AskAnswer | null {
  const b = boxes(text)
  const yes = (k: AskAnswer) => b.get(k) === 'done' || b.get(k) === 'approved'
  const no = (k: AskAnswer) => b.get(k) === 'rejected'
  if (yes('deny') || no('allow') || no('session')) return 'deny'
  if (yes('session')) return 'session'
  if (yes('allow')) return 'allow'
  return null
}

/** A rule the session step adds: the shape of a PermissionRequest's own `addRules` suggestion, kept for the session. */
export type SessionRule = { type: 'addRules'; rules: Array<{ toolName: string; ruleContent?: string }>; behavior: 'allow'; destination: 'session' }

/**
 * A shell command a rule names exactly: one command, no chaining, pipes, substitution or redirection, and no `*` or
 * `:` (a rule reads them as a wildcard or a prefix, which would grant more than the one command).
 */
const SIMPLE_COMMAND = /^[A-Za-z0-9_./-]+(?:\s+[^;&|`$<>(){}*:\\\n]*)?$/

/** File commands that only add (a file, a folder): the ones whose accept-edits suggestion becomes a prefix rule. */
const ADDING_COMMANDS: readonly string[] = ['touch', 'mkdir']

/**
 * What "allow for this session" grants, and its words: exactly what the dialog's own rule for this one call grants,
 * never more. The dialog's `addRules` allow suggestions, kept for the session only. When it suggests none, a rule for
 * that one Bash command: `touch` or `mkdir`, whose suggestion is accept-edits mode (which would let the next `rm` run
 * unasked), gets its prefix (`Bash(touch:*)`), narrower than that mode; any other (an `rm` included) gets the exact
 * command. A mode switch or a folder is never granted.
 * Null when no rule names the call exactly: the ask then offers only once and deny.
 */
export function sessionGrantOf(tool: string, input: unknown, suggestions: readonly unknown[] = []): { rules: SessionRule[]; words: string } | null {
  const suggested = suggestions.flatMap(u => {
    const o = u && typeof u === 'object' ? u as Record<string, unknown> : {}
    if (o.type !== 'addRules' || o.behavior !== 'allow' || !Array.isArray(o.rules)) return []
    const rules = o.rules.filter((r): r is { toolName: string; ruleContent?: string } => !!r && typeof r === 'object' && typeof (r as { toolName?: unknown }).toolName === 'string')
      .map(r => ({ toolName: r.toolName, ...(typeof r.ruleContent === 'string' ? { ruleContent: r.ruleContent } : {}) }))
    return rules.length ? [{ type: 'addRules' as const, rules, behavior: 'allow' as const, destination: 'session' as const }] : []
  })
  if (suggested.length) return { rules: suggested, words: `allow ${suggested.flatMap(u => u.rules).map(ruleWords).join(', ')} for this session` }
  const command = tool === 'Bash' && input && typeof input === 'object' ? (input as { command?: unknown }).command : undefined
  if (typeof command !== 'string' || !SIMPLE_COMMAND.test(command.trim())) return null
  const edits = suggestions.some(u => !!u && typeof u === 'object' && (u as { type?: unknown; mode?: unknown }).type === 'setMode' && (u as { mode?: unknown }).mode === 'acceptEdits')
  const first = command.trim().split(/\s+/)[0]!
  const rule = { toolName: 'Bash', ruleContent: edits && ADDING_COMMANDS.includes(first) ? `${first}:*` : command.trim() }
  return { rules: [{ type: 'addRules', rules: [rule], behavior: 'allow', destination: 'session' }], words: `allow ${ruleWords(rule)} for this session` }
}

/** One rule in words: every `touch` command for `Bash(touch:*)`, the command for an exact Bash rule, else `Tool(content)`. */
function ruleWords(rule: { toolName: string; ruleContent?: string }): string {
  const code = (s: string) => `\`${s.replace(/`/g, "'")}\``
  if (rule.toolName === 'Bash' && rule.ruleContent?.endsWith(':*')) return `every ${code(rule.ruleContent.slice(0, -2))} command`
  if (rule.toolName === 'Bash' && rule.ruleContent) return code(rule.ruleContent)
  return rule.ruleContent ? code(`${rule.toolName}(${rule.ruleContent})`) : `every ${code(rule.toolName)} call`
}

/** A call's key for matching its dialog's ask: who runs it (a subagent's loop or the main one), the tool and its input. */
export function callKey(tool: string, input: unknown, agentId?: string): string {
  const o = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const envelope = new Set<string>([...EVENT_KEYS, 'requestMeta', 'consent'])
  const kept = Object.keys(o).filter(k => !envelope.has(k)).sort()
  return JSON.stringify([agentId ?? '', tool, kept.map(k => [k, o[k]])])
}

/** How a call ended in the session: it ran, or it didn't (denied at the dialog, or refused), with the session's words. */
export type CallEnd = { ran: boolean; said?: string }

/** What `tool.call`'s answer says about how the call ended. */
export function callEndOf(r: { deny?: unknown; isError?: unknown; text?: unknown } | undefined): CallEnd {
  const said = typeof r?.deny === 'string' ? r.deny : typeof r?.text === 'string' ? r.text : undefined
  const line = said?.split('\n').find(l => l.trim())?.trim()
  return { ran: !r?.deny && !r?.isError, ...(line ? { said: line.length > 120 ? `${line.slice(0, 119)}…` : line } : {}) }
}

/** What a turn's end says of a call it never settled when it wasn't interrupted: nobody answered (PIE-1451). */
export const TURN_ENDED = 'the turn ended without it'

/** The close-out line for an ask the dialog answered in the session before any tick. */
export function answeredInSession(end: CallEnd, at: string): string {
  // A turn that ended under the dialog (the session stopped): nobody answered it, so it doesn't say anyone did.
  if (!end.ran && end.said === TURN_ENDED) return `The session's turn ended at ${at} before anyone answered: it didn't run.`
  return end.ran
    ? `Answered in the session (the dialog) at ${at}: it ran.`
    : `Answered in the session (the dialog) at ${at}: it didn't run${end.said ? ` (${end.said.replace(/[[\]]/g, '')})` : ''}.`
}

/**
 * The calls under way, by callKey, each with how it ended once it has: a dialog the person answers in the session ends
 * its call, which the hook asking the outline waits on beside the tick. Most recent first among equal keys.
 */
export class CallsUnderWay {
  private readonly calls: Array<{ key: string; ended: Promise<CallEnd>; finish: (end: CallEnd) => void }> = []

  /** A call starting; the function given back ends it (once: a later end is ignored). */
  start(key: string): (end: CallEnd) => void {
    let settle: (end: CallEnd) => void = () => {}
    const ended = new Promise<CallEnd>(r => { settle = r })
    const entry = {
      key, ended, finish: (end: CallEnd) => {
        const at = this.calls.indexOf(entry)
        if (at >= 0) this.calls.splice(at, 1)
        settle(end)
      },
    }
    this.calls.push(entry)
    return entry.finish
  }

  /** Ends every call under way in one loop (a subagent's id, or the main loop's undefined): its turn is over. */
  endLoop(agentId: string | undefined, end: CallEnd): void {
    for (const call of [...this.calls]) if ((JSON.parse(call.key) as unknown[])[0] === (agentId ?? '')) call.finish(end)
  }

  /**
   * How the call with this key ends: the newest under way with it, else the only one of its tool in the same loop (a
   * hook rewrote its input); undefined for none.
   */
  ending(key: string, tool: string): Promise<CallEnd> | undefined {
    const same = this.calls.filter(c => c.key === key)
    if (same.length) return same.at(-1)!.ended
    const loop = (JSON.parse(key) as unknown[])[0]
    const ofTool = this.calls.filter(c => { const [l, t] = JSON.parse(c.key) as unknown[]; return l === loop && t === tool })
    return ofTool.length === 1 ? ofTool[0]!.ended : undefined
  }
}

/**
 * The note once answered: its `needs` chip gone (it waits on nobody), its steps no longer boxes (PIE-1451: a tick after
 * the answer would answer nothing), the one ticked kept as `✓ **…**` and the rest struck, and who answered, how and when.
 */
export function closedText(text: string, said: string): string {
  const [first = '', ...rest] = text.split('\n')
  const head = first.replace(/\s*\[needs::[^\]]*\]/, '').replace(/^Allow /, 'Asked: allow ')
  let fenced = false
  const steps = rest.map(line => {
    if (/^\s*(`{3,}|~{3,})/.test(line)) fenced = !fenced
    const m = fenced ? null : /^(\s*[-*+]\s+)(\[.\])\s+(.+?)(\s+\^[A-Za-z0-9][\w-]*)?\s*$/.exec(line)
    if (!m) return line
    const status = boxStatus(m[2]!)
    // A step's id (`^t-…`, which the person's tick gave it) stays: the service refuses an edit that drops a list item's id.
    const id = m[4] ?? ''
    return status === 'done' || status === 'approved' ? `${m[1]}✓ **${m[3]}**${id}` : `${m[1]}~~${m[3]}~~${id}`
  })
  return [head, ...steps, '', said].join('\n')
}

/** The close-out line for an ask whose session ended before any answer (PIE-1451): the dialog went with it. */
export function sessionEndedLine(reason: string, at: string): string {
  return `The session ended (${reason.replace(/[[\]]/g, '')}) at ${at} before anyone answered: it didn't run.`
}

/** A tick that counts: the note's last write is the person's (`author: user`), never an agent's or the system's. */
export function byThePerson(read: { author?: unknown }): boolean {
  return read.author === 'user'
}

export type AskRead = { text: string; revision: number; author?: string; actorId?: string }

/** `agent read`'s JSON as an ask: its text, revision and who wrote it last; null for anything else. */
export function askReadOf(stdout: string): AskRead | null {
  try {
    const o = JSON.parse(stdout) as Record<string, unknown>
    if (typeof o.text !== 'string' || typeof o.revision !== 'number') return null
    return { text: o.text, revision: o.revision, ...(typeof o.author === 'string' ? { author: o.author } : {}), ...(typeof o.actorId === 'string' ? { actorId: o.actorId } : {}) }
  } catch {
    return null
  }
}

export const askPageFindArgv = (): string[] => ['ep0ch', 'find', '--query', `page = "${ASK_PAGE}"`, '--ids']
export const askPageCreateArgv = (actor: string): string[] =>
  ['ep0ch', 'new', `[page::${ASK_PAGE}]\nPermission dialogs sessions put to the person, one note each: tick a step to answer, or answer the dialog in the session; the first answer wins (PIE-1386). These are agents' asks; a needs note written in another outline stays on that outline's own list.`, '--as', actor, '--json']

/** Client work stays in its own outline: a session bound to one of these keeps its asks there, never in pie. */
export const KEEPS_ITS_ASKS: readonly string[] = ['float-hub']

/**
 * Where a session's asks go (one list for the person, PIE-1386): `EP0CH_APPROVE_WS` (`<name>` or `<name>@<machine>`,
 * default `pie`), on the machine the bound outline is on unless it names one; null for the bound outline itself (a
 * session bound to float-hub, client work, or to that outline already).
 */
export function askOutlineOf(bound: { outline?: string; machine?: string }, given: string | undefined): { outline: string; machine?: string } | null {
  if (bound.outline && KEEPS_ITS_ASKS.includes(bound.outline)) return null
  const [name, at] = (given?.trim() || 'pie').split('@')
  if (!name || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(name) || name === bound.outline) return null
  const machine = at?.trim() || bound.machine
  return { outline: name, ...(machine ? { machine } : {}) }
}
