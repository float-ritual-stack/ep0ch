// Approve from the phone (PIE-1386): a permission dialog this session would show is written as an ask note in the bound
// outline, under its [[permission-asks]] page, with `[needs::sysop: …]` on its first line so the Waiting on Evan view
// (and any view of `needs`) lists it, and three steps: allow once, allow for this session, deny. The person ticks one,
// on the web page (my.ep0ch.sh, a tap) or in the door: both are the one `checklist.update`, written as `author: user`.
// The hook waits for that tick and answers the dialog with it; a tick an agent wrote counts for nothing, and when the
// wait runs out the ordinary dialog shows. Pure: register.ts runs the CLI and the clock.

export const ASK_PAGE = 'permission-asks'

/** The ask's three steps, by what each answers. */
export const ASK_STEPS = {
  allow: 'allow this once',
  session: 'allow for this session',
  deny: 'deny',
} as const
export type AskAnswer = keyof typeof ASK_STEPS

/** How long a session waits for the person's tick before the ordinary dialog shows (PIE-1386's 600 s). */
export const BACKGROUND_WAIT_MS = 600_000

/**
 * How long to wait for a tick: `EP0CH_APPROVE_WAIT` in seconds when it is set (0 turns it off); else 600 s in a session
 * nobody watches (a background job, `CLAUDE_JOB_DIR`), and none in one someone does, whose dialog shows at once as before.
 * Holding the hook holds the dialog, so an interactive session doesn't by default.
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

/** The ask note's text. `who` names the session (its persona, machine and folder); `[ask-tool::…]` keeps the tool. */
export function askText(tool: string, input: unknown, who: string, asked: string): string {
  const line = askLine(tool, input)
  const chip = line.replace(/[[\]]/g, '')
  const body = input && typeof input === 'object' ? JSON.stringify(input, null, 2) : String(input ?? '')
  const shown = body.length > 2000 ? `${body.slice(0, 2000)}\n… cut at 2000 characters` : body
  return [
    `Allow ${chip.length > 60 ? `${chip.slice(0, 59)}…` : chip}? [needs::sysop: ${chip}] [type::permission-ask] [ask-tool::${tool.replace(/[[\]]/g, '')}]`,
    '',
    `- [ ] ${ASK_STEPS.allow}`,
    `- [ ] ${ASK_STEPS.session}`,
    `- [ ] ${ASK_STEPS.deny}`,
    '',
    `${who} asked at ${asked}. Tick one: only your tick answers it; the dialog shows if nobody does.`,
    '',
    '```json',
    shown.replace(/```/g, '` ` `'),
    '```',
  ].join('\n')
}

/** Each step's box as written, by its answer: `x`/`+`/`✓` say yes to that step, `-`/`✗` no. */
function boxes(text: string): Map<AskAnswer, string> {
  const found = new Map<AskAnswer, string>()
  for (const line of text.split('\n')) {
    const m = /^\s*[-*+]\s+\[(.)\]\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    const which = (Object.keys(ASK_STEPS) as AskAnswer[]).find(k => ASK_STEPS[k] === m[2])
    if (which && !found.has(which)) found.set(which, m[1]!)
  }
  return found
}

/**
 * The answer the note's steps give, or null while none is ticked. A deny wins over an allow ticked with it; an allow
 * marked rejected is a deny.
 */
export function answerOf(text: string): AskAnswer | null {
  const b = boxes(text)
  const yes = (k: AskAnswer) => ['x', 'X', '+', '✓', '✔'].includes(b.get(k) ?? '')
  const no = (k: AskAnswer) => ['-', '✗'].includes(b.get(k) ?? '')
  if (yes('deny') || no('allow') || no('session')) return 'deny'
  if (yes('session')) return 'session'
  if (yes('allow')) return 'allow'
  return null
}

/** The note once answered: its `needs` chip gone (it waits on nobody), and who answered, how and when. */
export function closedText(text: string, said: string): string {
  const [first = '', ...rest] = text.split('\n')
  const head = first.replace(/\s*\[needs::[^\]]*\]/, '').replace(/^Allow /, 'Asked: allow ')
  return [head, ...rest, '', said].join('\n')
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
  ['ep0ch', 'new', `[page::${ASK_PAGE}]\nPermission dialogs sessions put to the person, one note each: tick a step to answer (PIE-1386).`, '--as', actor, '--json']
