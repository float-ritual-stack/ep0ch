import type { On, ProcessRunResult } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { BOARD_QUERY, BUILD_LOG_QUERY, listedOf, WORKBOARD_BLOCK, workboardText } from '../hooks/workboard-now'

tier('user')

const result = (exitCode: number, stdout = '', stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

const FOLDER = '/home/someone/garden'
const HERDR_LISTING = JSON.stringify({ result: { plugins: [{ plugin_id: 'float.pi-outliner', enabled: true, plugin_root: '/opt/outliner' }] } })
const BOUND = JSON.stringify({ bound: true, folder: FOLDER, configPath: `${FOLDER}/.ep0ch`, outline: 'garden' })

type Row = { id: string; title: string; props?: Record<string, string>; createdAt?: string }
const listed = (rows: Row[], complete = true) => JSON.stringify({
  completeness: { kind: complete ? 'complete' : 'limited' },
  blocks: rows.map(r => ({ id: r.id, title: r.title, properties: Object.entries(r.props ?? {}).map(([key, value]) => ({ key, value })), ...(r.createdAt ? { createdAt: r.createdAt } : {}) })),
})

const ITEMS: Row[] = [
  { id: 'a1', title: 'GAR-12 — Water the tomatoes on a timer', props: { 'work-id': 'GAR-12', 'work-stage': 'doing' } },
  { id: 'a2', title: 'GAR-14 — A shed that remembers where the rake is', props: { 'work-id': 'GAR-14', 'work-stage': 'review' } },
  { id: 'a3', title: 'GAR-9 — Compost bin sensor', props: { 'work-id': 'GAR-9', 'work-stage': 'validate', needs: 'sysop: whether the lid alarm is too loud' } },
]
const LOGS: Row[] = [
  { id: 'log-old', title: 'Build log, Mar 2', createdAt: '2026-03-02T08:00:00Z' },
  { id: 'log-new', title: 'Build log, Mar 3', createdAt: '2026-03-03T08:00:00Z' },
]

type Case = { items: Row[]; logs: Row[]; anyItem?: boolean; prs?: string | null; listMs?: number; ghMs?: number; itemsCut?: boolean }

/** A session in FOLDER, bound to garden; the Outliner's `list` answers from the case, `gh` from `prs` (null: no gh). */
function sessionIn(on: On, c: Case) {
  const lists: string[] = []
  let gh = 0
  const invalidated: string[] = []
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/someone', PI_OUTLINER_MENTIONS_WORKSPACES: '' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'session-1' }))
  on('session.compact', ($, e) => ({ messages: e.messages }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: FOLDER }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ep0ch__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.invalidate', ($, e) => { invalidated.push(e.event); return { value: undefined } })
  on('process.run', async ($, e) => {
    const argv = e.argv
    if (argv[0] === 'herdr') return { value: result(0, HERDR_LISTING) }
    if (argv[0] === 'ep0ch') throw Error('ENOENT: ep0ch')
    if (argv[0] === 'gh') gh++
    if (argv[0] === 'gh' && c.ghMs) await clock.sleep(c.ghMs)
    if (argv[0] === 'gh') return { value: c.prs === undefined || c.prs === null ? result(1, '', 'gh: not a git repository') : result(0, c.prs) }
    if (argv.includes('bound-folder')) return { value: result(0, BOUND) }
    if (argv.includes('work-id-status')) return { value: result(0, '{"prefix":"GAR"}') }
    if (argv.includes('mentions')) return { value: result(0, '{"entries":[]}') }
    if (argv.includes('list')) {
      const query = argv[argv.indexOf('--query') + 1]!
      lists.push(query)
      if (c.listMs) await clock.sleep(c.listMs)
      if (query === BOARD_QUERY) return { value: result(0, listed(c.items, !c.itemsCut)) }
      if (query === BUILD_LOG_QUERY) return { value: result(0, listed(c.logs)) }
      return { value: result(0, listed(c.anyItem ? [{ id: 'old', title: 'GAR-1 — done long ago' }] : [])) }
    }
    return { value: result(1, '', 'unexpected') }
  })
  return { lists, invalidated, clock, gh: () => gh }
}

const START = { surface: 'terminal', isInteractive: true, cwd: FOLDER } as const
const boardOf = async ($: any) => ((await $.prompt.context({ blocks: [] })).blocks as { name: string; text: string }[]).find(b => b.name === WORKBOARD_BLOCK)?.text

describe('workboard now, in the first prompt', () => {
  test('a bound outline with a workboard: the latest build log, the lanes, waiting on the person, open PRs', async ($, on) => {
    const s = sessionIn(on, { items: ITEMS, logs: LOGS, prs: JSON.stringify([{ number: 41, title: 'Rake finder', headRefName: 'rake-finder', isDraft: false }]) })
    await $.session.start(START)
    await s.clock.settle()
    const text = (await boardOf($))!
    expect(text).toContain('The garden workboard')
    expect(text).toContain('- latest build log: Build log, Mar 3 ((log-new))')
    expect(text).toContain('- doing (1):\n  - GAR-12 — Water the tomatoes on a timer')
    expect(text).toContain('- review (1):\n  - GAR-14')
    expect(text).toContain('- validate (1):\n  - GAR-9')
    expect(text).toContain('- waiting on the person (needs::sysop) (1):\n  - GAR-9: whether the lid alarm is too loud')
    expect(text).toContain('- open PRs (1):\n  - #41 Rake finder (rake-finder)')
  })

  test('an outline with no workboard: nothing is added, and gh is never asked', async ($, on) => {
    const s = sessionIn(on, { items: [], logs: [], anyItem: false, prs: '[]' })
    await $.session.start(START)
    await s.clock.settle()
    expect(await boardOf($)).toBeUndefined()
    expect(s.gh()).toBe(0)
  })

  test('a workboard with nothing in flight says so; gh not answering leaves the PRs out', async ($, on) => {
    const s = sessionIn(on, { items: [], logs: [], anyItem: true, prs: null })
    await $.session.start(START)
    await s.clock.settle()
    const text = (await boardOf($))!
    expect(text).toContain('- nothing in doing, review or validate')
    expect(text).not.toContain('PRs')
  })

  test('a slow host never holds the first prompt: it goes without, and is made again when the read lands', async ($, on) => {
    const s = sessionIn(on, { items: ITEMS, logs: LOGS, listMs: 3000 })
    await $.session.start(START)
    await s.clock.settle()
    const context = $.prompt.context({ blocks: [] })
    await s.clock.advance(1500)
    expect((await context).blocks.find((b: { name: string }) => b.name === WORKBOARD_BLOCK)).toBeUndefined()
    expect(s.invalidated).not.toContain('prompt.context')
    await s.clock.advance(2000)
    expect(s.invalidated).toContain('prompt.context')
    expect(await boardOf($)).toContain('GAR-12')
  })

  test('a GitHub that never answers leaves the PRs out, never the board', async ($, on) => {
    const s = sessionIn(on, { items: ITEMS, logs: LOGS, prs: '[]', ghMs: 60_000, listMs: 1000 })
    await $.session.start(START)
    await s.clock.advance(10_000)
    const text = (await boardOf($))!
    expect(text).toContain('GAR-12')
    expect(text).not.toContain('PRs')
  })

  test('a read the service cut short says its counts are partial', async ($, on) => {
    const s = sessionIn(on, { items: ITEMS, logs: LOGS, itemsCut: true })
    await $.session.start(START)
    await s.clock.settle()
    expect(await boardOf($)).toContain('the counts are partial')
  })

  test('after a compaction the workboard is read again, so the remade context is current', async ($, on) => {
    const c: Case = { items: ITEMS, logs: LOGS }
    const s = sessionIn(on, c)
    await $.session.start(START)
    await s.clock.settle()
    expect(await boardOf($)).toContain('GAR-12')
    c.items = [{ id: 'a4', title: 'GAR-15 — Seed swap shelf', props: { 'work-id': 'GAR-15', 'work-stage': 'doing' } }]
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'plant the beans', toolUses: [] }] })
    await s.clock.settle()
    const text = (await boardOf($))!
    expect(text).toContain('GAR-15')
    expect(text).not.toContain('GAR-12')
  })
})

describe('workboard text', () => {
  test('a long lane is cut, with the rest counted', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ id: `i${i}`, title: `GAR-${i} — Bed ${i}`, properties: [{ key: 'work-stage', value: 'doing' }] }))
    const text = workboardText({ outline: 'garden', items, logs: [], prs: [] }, true)!
    expect(text).toContain('- doing (9):')
    expect(text).toContain('  - and 3 more')
    expect(text).toContain('- no build log yet')
    expect(text).toContain('- no open PRs')
  })

  test('list output that is not a list reads as no answer', () => {
    expect(listedOf('error: no carrier')).toBeNull()
    expect(listedOf('{"blocks":[],"completeness":{"kind":"complete"}}')).toEqual({ blocks: [], complete: true })
  })
})
