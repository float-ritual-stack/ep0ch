import type { On, ProcessRunResult } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { DRAIN_REQUEST, drainKeyOf, drainPrompt } from '../hooks/drain'
import { agentOfEp0ch, sweepsFor } from '../hooks/freshness'

tier('user')

const MIN = 60_000
const START = { surface: 'terminal', isInteractive: true, cwd: '/work/ep0ch' } as const
const TURN = { reason: 'answer', answer: 'ok', durationMs: 10, isAborted: false, turnId: 't' } as const

const result = (exitCode: number, stdout = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

/**
 * A session in the repository whose `.ep0ch` is `files` (path under /work/ep0ch → text; none by default), with no cron
 * set by hand. `board` is what gh and ep0ch find answer (the open PRs, the items in doing and queued), changed by a
 * test to say something moved; it records the prompts the mod submits and its toasts.
 */
function sessionIn(on: On, files: Record<string, string> = {}, env: Record<string, string> = {}) {
  const submitted: string[] = []
  const toasts: string[] = []
  const board = { prs: '[{"number":501}]', doing: '((pie-1))', queued: '((pie-2))', failing: false }
  let dropping = false
  const clock = mock.clock(on)
  mock.env(on, env)
  on('session.cwd', () => ({ value: '/work/ep0ch' }))
  on('session.root', () => ({ value: '/work/ep0ch' }))
  on('fs.read', ($, e) => {
    const text = files[e.path.replace('/work/ep0ch/', '')]
    if (text !== undefined) return { value: text }
    throw Error(`ENOENT: ${e.path}`)
  })
  on('process.run', ($, e) => {
    if (board.failing) return { value: result(1) }
    if (e.argv[0] === 'gh') return { value: result(0, board.prs) }
    if (e.argv[0] === 'ep0ch') return { value: result(0, e.argv.join(' ').includes('doing') ? board.doing : board.queued) }
    return { value: result(1) }
  })
  on('prompt.submit', ($, e) => { submitted.push(e.text); return (dropping ? { drop: 'busy' } : { text: e.text }) as never })
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }) as never)
  return { submitted, toasts, clock, board, drop: (d: boolean) => { dropping = d } }
}

const LOKI = { '.ep0ch/config.toml': 'ws = "garden"\nmachine = "garden-host"\nagent = "loki"\n' }

/** The drain's turn ends, and a builder moves its ticket: the next tick has something to do. */
async function drainedAndMoved($: any, s: ReturnType<typeof sessionIn>, n: number) {
  await $.turn.complete(TURN)
  s.board.doing = `((pie-${n}))`
}

describe('the drain tick', () => {
  test('a deployer session with no cron set by hand gets the drain soon after it starts, then every 30 minutes the board moves', async ($, on) => {
    const s = sessionIn(on, LOKI)
    await s.clock.set(Date.parse('2026-10-28T12:00:00Z'))
    await $.session.start(START)
    await s.clock.advance(2 * MIN)
    expect(s.submitted).toEqual([drainPrompt()])
    expect(s.submitted[0]).toContain(DRAIN_REQUEST)
    expect(s.submitted[0]).toContain('up to 3 builders')
    await drainedAndMoved($, s, 3)
    await s.clock.advance(30 * MIN)
    expect(s.submitted).toHaveLength(2)
    await drainedAndMoved($, s, 4)
    await s.clock.advance(30 * MIN)
    expect(s.submitted).toHaveLength(3)
  })

  test('quiet when nothing moved; a new PR, a new day or a lookup that fails wakes it again', async ($, on) => {
    const s = sessionIn(on, LOKI)
    await s.clock.set(Date.parse('2026-10-28T12:00:00Z'))
    await $.session.start(START)
    await s.clock.advance(2 * MIN)
    await $.turn.complete(TURN)
    await s.clock.advance(60 * MIN)
    expect(s.submitted).toHaveLength(1)
    s.board.prs = '[{"number":501},{"number":502}]'
    await s.clock.advance(30 * MIN)
    expect(s.submitted).toHaveLength(2)
    await $.turn.complete(TURN)
    // The next day: the daily sweep's chance, with the board unchanged.
    await s.clock.advance(12 * 60 * MIN)
    expect(s.submitted).toHaveLength(3)
    await $.turn.complete(TURN)
    s.board.failing = true
    await s.clock.advance(30 * MIN)
    expect(s.submitted).toHaveLength(4)
  })

  test('one drain at a time: while its turn hasn\'t ended (a long turn ahead of it), ticks wait', async ($, on) => {
    const s = sessionIn(on, LOKI)
    await $.session.start(START)
    await s.clock.advance(2 * MIN)
    s.board.prs = '[]'
    await s.clock.advance(120 * MIN)
    expect(s.submitted).toHaveLength(1)
    await $.turn.complete(TURN)
    await s.clock.advance(30 * MIN)
    expect(s.submitted).toHaveLength(2)
  })

  test('the old `.ep0ch` file names the deployer too', async ($, on) => {
    const s = sessionIn(on, { '.ep0ch': 'ws = "garden"\nagent = "loki"\n' })
    await $.session.start(START)
    await s.clock.advance(2 * MIN)
    expect(s.submitted).toHaveLength(1)
  })

  test('a session that is not the deployer\'s (a builder\'s worktree, another agent) never gets it', async ($, on) => {
    const builder = sessionIn(on)
    await $.session.start(START)
    await builder.clock.advance(61 * MIN)
    expect(builder.submitted).toEqual([])
  })

  test('EP0CH_AGENT naming another agent in loki\'s folder never gets it', async ($, on) => {
    const s = sessionIn(on, LOKI, { EP0CH_AGENT: 'kitty' })
    await $.session.start(START)
    await s.clock.advance(61 * MIN)
    expect(s.submitted).toEqual([])
  })

  test('EP0CH_DRAIN=off stops the deployer\'s', async ($, on) => {
    const off = sessionIn(on, LOKI, { EP0CH_DRAIN: 'off' })
    await $.session.start(START)
    await off.clock.advance(61 * MIN)
    expect(off.submitted).toEqual([])
  })

  test('EP0CH_DRAIN=on runs it in a session with no agent', async ($, on) => {
    const s = sessionIn(on, {}, { EP0CH_DRAIN: 'on' })
    await $.session.start(START)
    await s.clock.advance(2 * MIN)
    expect(s.submitted).toHaveLength(1)
  })

  test('a start again (a /clear, a resume) keeps one clock, not two', async ($, on) => {
    const s = sessionIn(on, LOKI)
    await $.session.start(START)
    await s.clock.advance(2 * MIN)
    await drainedAndMoved($, s, 3)
    await $.session.start(START)
    await s.clock.advance(2 * MIN)
    expect(s.submitted).toHaveLength(2)
    await drainedAndMoved($, s, 4)
    await s.clock.advance(30 * MIN)
    expect(s.submitted).toHaveLength(3)
  })

  test('a start again before the first tick fires gives one first tick, not two', async ($, on) => {
    const s = sessionIn(on, LOKI)
    await $.session.start(START)
    await s.clock.advance(MIN / 2)
    await $.session.start(START)
    await s.clock.advance(2 * MIN)
    expect(s.submitted).toHaveLength(1)
  })

  test('a mod reloaded mid-session (no session.start) arms the clock at the next turn', async ($, on) => {
    const s = sessionIn(on, LOKI)
    await $.turn.complete(TURN)
    await s.clock.advance(2 * MIN)
    expect(s.submitted).toHaveLength(1)
    await drainedAndMoved($, s, 3)
    await s.clock.advance(30 * MIN)
    expect(s.submitted).toHaveLength(2)
  })

  test('a dropped tick is said once, and the next tick tries again', async ($, on) => {
    const s = sessionIn(on, LOKI)
    s.drop(true)
    await $.session.start(START)
    await s.clock.advance(31 * MIN)
    expect(s.submitted).toHaveLength(2)
    expect(s.toasts).toEqual(["Drain tick didn't reach this session (busy); the next tick tries again."])
    s.drop(false)
    await s.clock.advance(30 * MIN)
    expect(s.submitted).toHaveLength(3)
  })
})

describe('drain helpers', () => {
  test('the board key: the day and the answers, or null when one failed', () => {
    const now = Date.parse('2026-10-28T12:00:00Z')
    expect(drainKeyOf(['[]', 'a', 'b'], now)).toBe('2026-10-28\n[]\na\nb')
    expect(drainKeyOf(['[]', null, 'b'], now)).toBeNull()
  })

  test('an .ep0ch agent in either TOML quote, with a comment; on/off/true/false', () => {
    expect(agentOfEp0ch('agent = \'loki\'')).toBe('loki')
    expect(agentOfEp0ch('agent = "loki"  # the deployer')).toBe('loki')
    expect(sweepsFor('false', 'loki')).toBe(false)
    expect(sweepsFor('true', null)).toBe(true)
  })
})
