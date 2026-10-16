import type { On, ProcessRunInit, ProcessRunResult, SessionSendInput } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { entryOf, pageIdOf, unwrapPeer } from '../hooks/peer-log'

tier('user')

// Messages between Claude sessions: each one sent or received is copied under the bound outline's [[peer-messages]]
// page. Fictional sessions, outline and ids. /msg is a prompt command (commands/msg.md): the model sends, through here.

const WORKSPACE = '/work/garden'
const PAGE = '0c0ffee0-1111-4222-8333-444455556666'
const START = { surface: 'terminal', isInteractive: true, cwd: WORKSPACE } as const
const HERDR_LISTING = JSON.stringify({ result: { plugins: [{ plugin_id: 'float.pi-outliner', enabled: true, plugin_root: '/opt/outliner' }] } })
const ENVELOPE = '<cross-session-message from="bridge:session_1" from-name="potting-shed" from-mode="prompting">\nSeedlings are in.\n</cross-session-message>'

type Run = { argv: readonly string[]; init?: ProcessRunInit }
const result = (exitCode: number, stdout = '', stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

/** A session in a folder bound to `garden`, whose `ep0ch find` answers `found`; every send is delivered and recorded. */
function sessionIn(on: On, cwd: string, found: () => ProcessRunResult = () => result(0, `((${PAGE}))\n`)) {
  const runs: Run[] = []
  const sends: SessionSendInput[] = []
  const clock = mock.clock(on)
  mock.env(on, { PI_OUTLINER_MENTIONS_WORKSPACES: '' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: cwd }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__pi-outliner__${e.name}` } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.send', ($, e) => {
    sends.push(e)
    return { isDelivered: true }
  })
  on('session.receive', ($, e) => ({ text: e.text }))
  on('process.run', ($, e) => {
    if (e.argv[0] === 'hostname') return { value: result(0, 'garden-host\n') }
    if (e.argv.includes('bound-folder')) {
      const bound = cwd === WORKSPACE
      return { value: result(0, `${JSON.stringify(bound ? { bound, folder: WORKSPACE, configPath: `${WORKSPACE}/.ep0ch`, outline: 'garden' } : { bound, folder: cwd })}\n`) }
    }
    runs.push(e)
    if (e.argv[0] === 'herdr') return { value: result(0, HERDR_LISTING) }
    if (e.argv[0] !== 'ep0ch') return { value: result(1) }
    if (e.argv[1] === 'find' && e.argv.includes('--query')) return { value: found() }
    if (e.argv[1] === 'new' && e.argv.includes('--json')) return { value: result(0, JSON.stringify({ id: PAGE, title: 'peer-messages' })) }
    if (e.argv[1] === 'new') return { value: result(0, `in “peer-messages”\n`) }
    return { value: result(1, '', 'not in this test') }
  })
  const notes = () => runs.filter(r => r.argv[1] === 'new' && r.argv.includes('--near'))
  return { runs, sends, clock, notes }
}

describe('the copy in the outline', () => {
  test('a message sent is copied under [[peer-messages]] in the bound outline: which way, with whom, when, the text', async ($, on) => {
    const s = sessionIn(on, WORKSPACE)
    await $.session.start(START)
    const sent = await $.session.send({ to: 'potting-shed', text: '[sysop] are the seedlings in?' })
    expect(sent.isDelivered).toBe(true)
    await s.clock.settle()
    const [note] = s.notes()
    expect(note!.argv[2]).toMatch(/^→ to potting-shed · \d{4}-\d\d-\d\d \d\d:\d\d\n\n\[sysop\] are the seedlings in\?$/)
    expect(note!.argv.slice(3, 5)).toEqual(['--near', PAGE])
    expect(note!.init?.env).toMatchObject({ EP0CH_WS: 'garden' })
  })

  test("a peer's message is copied from its sender, the envelope taken off", async ($, on) => {
    const s = sessionIn(on, WORKSPACE)
    await $.session.start(START)
    await $.session.receive({ origin: { kind: 'peer' }, text: ENVELOPE } as any)
    await s.clock.settle()
    expect(s.notes().map(r => r.argv[2])).toEqual([expect.stringMatching(/^← from potting-shed · .+\n\nSeedlings are in\.$/)])
  })

  test('no [[peer-messages]] page yet: it is made once, and the message goes under it', async ($, on) => {
    const s = sessionIn(on, WORKSPACE, () => result(0, ''))
    await $.session.start(START)
    await $.session.send({ to: 'potting-shed', text: 'one' })
    await s.clock.settle()
    await $.session.send({ to: 'potting-shed', text: 'two' })
    await s.clock.settle()
    expect(s.runs.filter(r => r.argv[1] === 'new' && r.argv.includes('--json'))).toHaveLength(1)
    expect(s.notes().map(r => r.argv[4])).toEqual([PAGE, PAGE])
  })

  test('a folder bound to no outline: the message is sent, nothing is written', async ($, on) => {
    const s = sessionIn(on, '/work/elsewhere')
    await $.session.start({ ...START, cwd: '/work/elsewhere' })
    await $.session.send({ to: 'potting-shed', text: 'hello' })
    await s.clock.settle()
    expect(s.sends).toHaveLength(1)
    expect(s.runs.filter(r => r.argv[1] === 'new' || r.argv[1] === 'find')).toEqual([])
  })
})

describe('the parts, pure', () => {
  test('an envelope without from-name falls back to from, and plain text to a peer', () => {
    expect(unwrapPeer('<cross-session-message from="potting-shed">hi</cross-session-message>')).toEqual({ from: 'potting-shed', body: 'hi' })
    expect(unwrapPeer('plain words')).toEqual({ from: 'a peer', body: 'plain words' })
  })

  test('a long message is cut, and says so', () => {
    expect(entryOf('to', 'potting-shed', 0, 'x'.repeat(5000))).toContain('… cut at 4000 characters')
  })

  test('the page id from find --ids or new --json', () => {
    expect(pageIdOf(`((${PAGE}))\n`)).toBe(PAGE)
    expect(pageIdOf(JSON.stringify({ id: PAGE }))).toBe(PAGE)
    expect(pageIdOf('')).toBeUndefined()
  })
})
