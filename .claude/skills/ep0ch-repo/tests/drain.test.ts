import type { On } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { DRAIN_REQUEST, drainPrompt } from '../hooks/drain'

tier('user')

const MIN = 60_000
const START = { surface: 'terminal', isInteractive: true, cwd: '/work/ep0ch' } as const

/**
 * A session in the repository whose `.ep0ch` is `files` (path under /work/ep0ch → text; none by default), with no cron
 * set by hand: it records the prompts the mod submits and its toasts.
 */
function sessionIn(on: On, files: Record<string, string> = {}, env: Record<string, string> = {}) {
  const submitted: string[] = []
  const toasts: string[] = []
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
  on('prompt.submit', ($, e) => { submitted.push(e.text); return (dropping ? { drop: 'busy' } : { text: e.text }) as never })
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }) as never)
  return { submitted, toasts, clock, drop: (d: boolean) => { dropping = d } }
}

const LOKI = { '.ep0ch/config.toml': 'ws = "garden"\nmachine = "garden-host"\nagent = "loki"\n' }

describe('the drain tick', () => {
  test('a deployer session with no cron set by hand gets the drain soon after it starts, then every 30 minutes', async ($, on) => {
    const s = sessionIn(on, LOKI)
    await $.session.start(START)
    await s.clock.advance(2 * MIN)
    expect(s.submitted).toEqual([drainPrompt()])
    expect(s.submitted[0]).toContain(DRAIN_REQUEST)
    expect(s.submitted[0]).toContain('up to 3 builders')
    await s.clock.advance(30 * MIN)
    expect(s.submitted).toHaveLength(2)
    await s.clock.advance(30 * MIN)
    expect(s.submitted).toHaveLength(3)
  })

  test('the old `.ep0ch` file names the deployer too', async ($, on) => {
    const s = sessionIn(on, { '.ep0ch': 'ws = "garden"\nagent = "loki"\n' })
    await $.session.start(START)
    await s.clock.advance(31 * MIN)
    expect(s.submitted).toHaveLength(2)
  })

  test('a session that is not the deployer\'s (a builder\'s worktree, another agent) never gets it', async ($, on) => {
    const builder = sessionIn(on)
    await $.session.start(START)
    await builder.clock.advance(61 * MIN)
    expect(builder.submitted).toEqual([])
  })

  test('another agent\'s .ep0ch never gets it', async ($, on) => {
    const s = sessionIn(on, { '.ep0ch/config.toml': 'ws = "garden"\nagent = "kitty"\n' })
    await $.session.start(START)
    await s.clock.advance(61 * MIN)
    expect(s.submitted).toEqual([])
  })

  test('EP0CH_DRAIN=off stops the deployer\'s; on runs it anywhere', async ($, on) => {
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
    await $.session.start(START)
    await s.clock.advance(2 * MIN)
    expect(s.submitted).toHaveLength(2)
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
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 10, isAborted: false, turnId: 't' })
    await s.clock.advance(2 * MIN)
    expect(s.submitted).toHaveLength(1)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 10, isAborted: false, turnId: 't2' })
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
