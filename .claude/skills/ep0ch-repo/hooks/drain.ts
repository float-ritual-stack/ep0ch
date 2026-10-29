/**
 * The drain tick (PIE-1372): in the deployer's sessions, every 30 minutes, the session is handed the drain as a prompt
 * of its own, so the backlog moves while Evan is offline and no one sets a cron by hand. The clock is the engine's, as
 * the settle check's is; the rules (pull order, skips, the daily sweep) are the loki runbook's "Draining Up next" and
 * daddy's request, which the prompt points at rather than repeats. Pure: register.ts runs the clock and the prompt.
 */

import { sweepsFor } from './freshness'

/** Minutes between ticks: the settle check's clock. */
export const DRAIN_EVERY_MS = 30 * 60_000
/** The first tick soon after the session starts, so a fresh session drains within the window. */
export const DRAIN_FIRST_MS = 60_000

/**
 * What the tick reads before it wakes the session: the open PRs and the items in doing and queued. The same answers
 * (and the same day: the daily sweep) as the last drain that went means nothing moved, and the tick stays quiet; a
 * builder that opens a PR or moves its ticket frees a slot, and that changes them.
 */
export const DRAIN_LOOKUPS: readonly (readonly string[])[] = [
  ['gh', 'pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,headRefOid,reviewDecision,isDraft'],
  ['ep0ch', 'find', '--ids', '--query', 'type=roadmap-item AND work-stage=doing'],
  ['ep0ch', 'find', '--ids', '--query', 'type=roadmap-item AND work-stage=queued'],
]

/** The board as the tick saw it, or null when a lookup failed (then the tick wakes the session: it can look). */
export function drainKeyOf(answers: readonly (string | null)[], now: number): string | null {
  if (answers.some(a => a === null)) return null
  return [new Date(now).toISOString().slice(0, 10), ...answers.map(a => a!.trim())].join('\n')
}

/** daddy's request, "Drain on its own clock", which holds the pull order, the skips and the sweep. */
export const DRAIN_REQUEST = '5bfab6fb-75d1-49ee-9ec6-5f02e653a5f6'

/** Whether this session drains: the sweep's rule (EP0CH_DRAIN `on` or `off` decides outright; else the deployer's sessions). */
export const drainsFor: (setting: string | undefined, agent: string | null) => boolean = sweepsFor

/** The tick's prompt: the steps in order, pointing at where each rule lives. */
export function drainPrompt(): string {
  return [
    'Drain tick (the ep0ch-repo mod, every 30 minutes; the loki skill, "Draining Up next"; ' +
      `the rules: ((${DRAIN_REQUEST}|Drain on its own clock))):`,
    '1. Merge what is ready: an open PR whose builder reported green and whose review findings are answered.',
    '2. Fill free builder slots, up to 3 builders: Up next, then #hydra and arc=floor items with a written definition of done, ' +
      'then high-priority queued items, oldest first. Skip [needs::sysop] and one-way doors (infrastructure, deletion, protocol).',
    '3. Validate: when no verifier is out, one ep0ch-verifier that built none of them takes the oldest validate items ' +
      '(drive it on a scratch door or name the covering test); close each with proof, send a finding back to queued with its repro, ' +
      'and ask Evan only for taste or hands ([needs::sysop]).',
    '4. Once a day, while Evan has written nothing in pie, gurgle or float-hub for about 2 hours: the sweep ' +
      '(queued over 5 days: pick it up, re-rank it with a reason, or close it with the reason; no definition of done: write one).',
    '5. A line under the day\'s build log for each pick, re-rank, close and finding.',
    'If there is nothing to merge, no slot to fill and nothing in validate, answer in one line and do nothing else.',
  ].join('\n')
}
