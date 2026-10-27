import type { On, ProcessRunResult } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { SPLIT_BLOCK, splitOf, splitStatus } from '../hooks/split-session'

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

/** A session in FOLDER bound to no outline (the split check needs none); `claude agents` answers `procs` of this session. */
function sessionIn(on: On, procs: number | 'fails', own = 92322) {
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
    if (e.argv.join(' ') === 'ep0ch agent splits --json --session session-1') return { value: procs === 'fails' ? result(1, '', 'no claude on PATH') : result(0, `motd from a login shell\n${splitsJson(procs)}`) }
    if (e.argv[0] === '/bin/sh' && e.argv[2] === 'echo $PPID') return { value: result(0, `${own}\n`) }
    return { value: result(1, '', 'unexpected') }
  })
  return { status, ran, clock }
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
