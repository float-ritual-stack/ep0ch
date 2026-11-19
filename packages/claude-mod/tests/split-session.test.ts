import type { On, ProcessRunResult } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { SPLIT_AGAIN_MS, SPLIT_BLOCK, SPLIT_SHOWN_MS, splitDue, splitOf, splitStatus } from '../hooks/split-session'

tier('user')

const result = (exitCode: number, stdout = '', stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

const FOLDER = '/home/someone/garden'
const HOUR = 3_600_000
const NOW = Date.parse('2026-03-03T12:00:00Z')

/** `ep0ch agent splits --json --session session-1` as it answers: this session in `procs` processes, oldest first. */
const splitsJson = (procs: number) => JSON.stringify({ splits: procs < 2 ? [] : [{
  machine: 'garden-box', sessionId: 'session-1', name: 'kitty-sr-1', lastWrite: NOW - 60_000,
  procs: [28521, 92322, 93001].slice(0, procs).map((pid, i) => ({
    pid, kind: i === 0 ? 'background' : 'interactive', id: i === 0 ? 'fb12351f' : 'session-', status: i === 0 ? 'idle' : 'busy',
    startedAt: NOW - (5 - i) * HOUR, place: i === 0 ? null : 'Herdr pane',
    stop: `ep0ch agent stop ${pid} --session session-`, ...(i === 0 ? { attach: 'claude attach fb12351f' } : {}),
  })),
}] })

/** What `ep0ch agent splits` does when asked: answers this session in that many processes, fails, or never answers. */
type Answer = number | 'fails' | 'hangs'

/** A session in FOLDER bound to no outline (the split check needs none); `claude agents` answers `procs` of this session (`answers` changes it). */
function sessionIn(on: On, procs: Answer, own = 92322) {
  const status: string[] = []
  const ran: string[][] = []
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/someone', PI_OUTLINER_MENTIONS_WORKSPACES: '' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: FOLDER }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context ?? [] }))
  on('ui.status', ($, e) => { status.push(String((e as { text?: unknown }).text ?? e)); return { value: undefined } })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('process.run', async ($, e) => {
    ran.push(e.argv)
    if (e.argv.join(' ') === 'ep0ch agent splits --json --session session-1') {
      if (procs === 'hangs') return new Promise<never>(() => {})
      return { value: procs === 'fails' ? result(1, '', 'no claude on PATH') : result(0, `motd from a login shell\n${splitsJson(procs)}`) }
    }
    if (e.argv[0] === '/bin/sh' && e.argv[2] === 'echo $PPID') return { value: result(0, `${own}\n`) }
    return { value: result(1, '', 'unexpected') }
  })
  /** How many times `ep0ch agent splits` was asked. */
  const asked = () => ran.filter(a => a.slice(0, 3).join(' ') === 'ep0ch agent splits').length
  return { status, ran, clock, asked, answers: (now: Answer) => { procs = now } }
}

const START = { surface: 'terminal', isInteractive: true, cwd: FOLDER } as const
/** What the model gets with a prompt the person sends: the context the mod attached beside it. */
const sent = async ($: any, text = 'plant the beans') => ((await $.prompt.submit({ text, wait: false })).context ?? []) as string[]

describe('a session running twice, said at start (PIE-1369)', () => {
  test('two processes on this session: the first prompt this process sends carries both pids and the commands, and so does the status line', async ($, on) => {
    const s = sessionIn(on, 2)
    await $.session.start(START)
    await s.clock.settle()
    const context = await sent($)
    expect(context[0]).toStartWith(`<${SPLIT_BLOCK}>`)
    const text = context[0]!
    expect(text).toContain('running as 2 processes at once')
    expect(text).toContain('on garden-box')
    expect(text).toContain('pid 28521 (background, idle)')
    expect(text).toContain('reach it: `claude attach fb12351f`')
    expect(text).toContain('pid 92322 (interactive, busy)')
    expect(text).toContain('— this process · reach it: its terminal (Herdr pane)')
    expect(text).toContain('stop it: `ep0ch agent stop 28521 --session session-`')
    expect(s.status.at(-1)).toContain('running twice: pid 28521 too · ep0ch agent stop 28521 --session session-')
    // Said once: the next prompt carries nothing more.
    expect(await sent($, 'and the peas')).toEqual([])
  })

  test('running once: nothing is added and the status line has no warning', async ($, on) => {
    const s = sessionIn(on, 1)
    await $.session.start(START)
    await s.clock.settle()
    expect(await sent($)).toEqual([])
    expect(s.status.join('\n')).not.toContain('running twice')
  })

  test('claude agents not answering: nothing is added and the status line has no warning', async ($, on) => {
    const s = sessionIn(on, 'fails')
    await $.session.start(START)
    await s.clock.settle()
    expect(await sent($)).toEqual([])
    expect(s.status.join('\n')).not.toContain('running twice')
  })
})

const TURN = { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'turn-1' } as const

describe('the warning lasts only as long as the split (PIE-1812)', () => {
  test('the other process ends: the next prompt asks again and the status line clears', async ($, on) => {
    const s = sessionIn(on, 2)
    await $.session.start(START)
    await s.clock.settle()
    await sent($)
    await s.clock.settle()
    expect(s.status.at(-1)).toContain('running twice: pid 28521 too')
    // The person stopped pid 28521 (or its terminal closed): `ep0ch agent splits` answers one process now.
    s.answers(1)
    await s.clock.advance(60_000)
    // The prompt carries nothing about it, and never waits for the answer.
    expect(await sent($, 'and the peas')).toEqual([])
    await s.clock.settle()
    expect(s.status.at(-1)).not.toContain('running twice')
    expect(s.status.at(-1)).not.toContain('28521')
  })

  test('stopped in the turn itself: the turn\'s end asks again, so the line clears without another prompt', async ($, on) => {
    on('turn.complete', ($, e) => ({ text: e.answer }))
    const s = sessionIn(on, 2)
    await $.session.start(START)
    await s.clock.settle()
    await sent($, 'stop the other one')
    await s.clock.settle()
    expect(s.status.at(-1)).toContain('running twice')
    s.answers(1)
    await s.clock.advance(20_000)
    await $.turn.complete(TURN)
    await s.clock.settle()
    expect(s.status.at(-1)).not.toContain('running twice')
  })

  test('the first prompt comes minutes after the start, the other process gone by then: the model is told nothing', async ($, on) => {
    const s = sessionIn(on, 2)
    await $.session.start(START)
    await s.clock.settle()
    expect(s.status.at(-1)).toContain('running twice')
    s.answers(1)
    await s.clock.advance(5 * 60_000)
    expect(await sent($)).toEqual([])
    await s.clock.settle()
    expect(s.status.at(-1)).not.toContain('running twice')
  })

  test('running once: a prompt asks again at most every few minutes, and a split that starts later shows on the line', async ($, on) => {
    const s = sessionIn(on, 1)
    await $.session.start(START)
    await s.clock.settle()
    expect(s.asked()).toBe(1)
    await sent($)
    await s.clock.advance(60_000)
    await sent($, 'and the peas')
    await s.clock.settle()
    expect(s.asked()).toBe(1)
    // A `claude --continue` elsewhere took this session meanwhile.
    s.answers(2)
    await s.clock.advance(3 * 60_000)
    await sent($, 'and the squash')
    await s.clock.settle()
    expect(s.asked()).toBe(2)
    expect(s.status.at(-1)).toContain('running twice: pid 28521 too')
  })

  test('asked again and no answer: the line says only what the last ask found, so the warning goes', async ($, on) => {
    const s = sessionIn(on, 2)
    await $.session.start(START)
    await s.clock.settle()
    await sent($)
    await s.clock.settle()
    expect(s.status.at(-1)).toContain('running twice')
    s.answers('fails')
    await s.clock.advance(60_000)
    await sent($, 'and the peas')
    await s.clock.settle()
    expect(s.status.at(-1)).not.toContain('running twice')
  })

  test('an ask that never answers holds no prompt up, and no second ask starts beside it', async ($, on) => {
    const s = sessionIn(on, 2)
    await $.session.start(START)
    await s.clock.settle()
    await sent($)
    await s.clock.settle()
    const before = s.asked()
    s.answers('hangs')
    await s.clock.advance(60_000)
    expect(await sent($, 'and the peas')).toEqual([])
    await s.clock.settle()
    expect(await sent($, 'and the squash')).toEqual([])
    await s.clock.settle()
    expect(s.asked()).toBe(before + 1)
  })
})

describe('when to ask again', () => {
  test('a warning that shows is checked at each prompt a few seconds on; none showing, every few minutes; never asked yet, now', () => {
    expect(splitDue(true, 0, SPLIT_SHOWN_MS - 1)).toBe(false)
    expect(splitDue(true, 0, SPLIT_SHOWN_MS)).toBe(true)
    expect(splitDue(false, 0, SPLIT_AGAIN_MS - 1)).toBe(false)
    expect(splitDue(false, 0, SPLIT_AGAIN_MS)).toBe(true)
    expect(splitDue(false, -Infinity, 0)).toBe(true)
  })
})

describe('the split in ep0ch agent splits', () => {
  test('the other pids are the ones not this process; this one not known, all but the newest', () => {
    expect(splitStatus(splitOf(splitsJson(3), 'session-1', 28521))).toStartWith('running 3×: pid 92322, 93001 too · ep0ch agent stop 92322')
    // The older one ran /clear-free and is this one: the status line never offers to stop the process it is in.
    expect(splitStatus(splitOf(splitsJson(2), 'session-1', 28521))).toStartWith('running twice: pid 92322 too')
    expect(splitStatus(splitOf(splitsJson(3), 'session-1', null))).toStartWith('running 3×: pid 28521, 92322 too')
    expect(splitOf(splitsJson(1), 'session-1', 1)).toBeNull()
    expect(splitOf(splitsJson(2), 'other-session', 1)).toBeNull()
    expect(splitOf('not json', 'session-1', 1)).toBeNull()
  })
})
