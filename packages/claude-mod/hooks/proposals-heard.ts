/**
 * What became of this session's proposals (PIE-1086): an edit of its that was proposed instead of applied, and every
 * change after (stale, applied, dismissed, resolved), heard once each. The service reads them from the proposals' own
 * revisions (`outliner agent proposals`, the outliner's proposal-outcomes.ts, the reader outline_proposals and the MCP
 * gateway share); this file only keeps which were told and says them.
 *
 * Pure: register.ts runs the command and the clock, since only it is handed `$`.
 */

export type OutcomeState = 'proposed' | 'stale' | 'applied' | 'dismissed' | 'resolved'

export interface Outcome {
  proposal: string
  note: string
  title: string
  state: OutcomeState
  at: string
  revision: number
  by?: string
  reason?: string
}

export interface OutcomesPage {
  outcomes: Outcome[]
  cursor: string
  complete: boolean
}

/** How often a session looks (ms). Short: a stale proposal is worth redoing while the session still has the edit in mind. */
export const HEARD_EVERY_MS = 2 * 60_000

/** `agent proposals`' input: everything after the cursor. */
export const proposalsInput = (since: string): string => JSON.stringify({ since })

/** The page `agent proposals` printed, or null when it isn't one. */
export function outcomesPageOf(stdout: string): OutcomesPage | null {
  try {
    const page = JSON.parse(stdout) as Partial<OutcomesPage>
    if (!Array.isArray(page.outcomes) || typeof page.cursor !== 'string') return null
    return { outcomes: page.outcomes.filter(o => o && typeof o.proposal === 'string' && typeof o.state === 'string'), cursor: page.cursor, complete: page.complete !== false }
  } catch {
    return null
  }
}

/** One outcome once: its proposal at the revision that says it. */
export const outcomeKey = (o: Outcome) => `${o.proposal}@${o.revision}`

/** The outcomes not told yet, oldest first. */
export const untold = (outcomes: readonly Outcome[], told: ReadonlySet<string>): Outcome[] => outcomes.filter(o => !told.has(outcomeKey(o)))

const label = (title: string, id: string) => title.replace(/[|()\[\]\n]+/g, ' ').trim().slice(0, 60) || id.slice(0, 8)
const byOf = (by: string | undefined) => (!by ? '' : by === 'user' ? ' by Evan' : ` by ${by}`)

const SAID: Record<OutcomeState, string> = {
  proposed: 'proposed instead of applied',
  stale: 'gone stale',
  applied: 'applied',
  dismissed: 'dismissed',
  resolved: 'resolved',
}

/**
 * One outcome's line: what it became, on which note, who made it so, and why. Each link is labelled by its note (PIE-1436):
 * the proposal as "your edit of <title>", never a bare "proposal". Stale is something that happened to the note, not
 * something its changer did to the proposal, so it says who changed the note.
 */
export function outcomeLine(o: Outcome): string {
  const title = label(o.title, o.note), edit = `((${o.proposal}|your edit of ${title}))`, note = `((${o.note}|${title}))`
  const why = o.reason ? `: ${o.reason}` : ''
  if (o.state === 'stale') return `- gone stale: ${edit} no longer fits ${note}, which ${!o.by ? 'someone' : o.by === 'user' ? 'Evan' : o.by} changed since${why}`
  return `- ${SAID[o.state] ?? o.state}${byOf(o.state === 'proposed' ? undefined : o.by)}: ${edit} on ${note}${why}`
}

/** Outcomes one message lists; the rest are counted. */
export const HEARD_LINES = 12

/** The inbound text: each outcome a line, and what to do about a stale one. */
export function heardText(outcomes: readonly Outcome[]): string {
  const shown = outcomes.slice(-HEARD_LINES)
  const stale = outcomes.some(o => o.state === 'stale')
  return [
    `What became of your proposals in the outline (${outcomes.length} ${outcomes.length === 1 ? 'change' : 'changes'}, oldest first):`,
    ...(outcomes.length > shown.length ? [`- and ${outcomes.length - shown.length} earlier ones: outline_proposals lists them all`] : []),
    ...shown.map(outcomeLine),
    stale
      ? 'A stale proposal no longer fits its note: re-read the note (outline_read) and send the edit again with outline_patch, or dismiss your proposal (outline_proposal_dismiss) when it is no longer wanted.'
      : 'Nothing to do unless you meant to follow up; outline_proposals lists them any time.',
  ].join('\n')
}

/** Whether these outcomes wake an idle session: only a stale one asks it to act. */
export const wakes = (outcomes: readonly Outcome[]): boolean => outcomes.some(o => o.state === 'stale')
