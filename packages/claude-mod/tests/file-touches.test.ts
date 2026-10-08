import type { On, ProcessRunInit, ProcessRunResult } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { localDay, projectOf, touchInputOf, touchOf } from '../hooks/file-touches'
import { fileRowOf, type ToolCallView, toolResultLineOf } from '../hooks/tool-rows'

tier('user')

// The files a session touches (PIE-602): Edit and Write rows, and each touch recorded in the outline. Fictional files.

const WORKSPACE = '/work/garden'
const FILE = '/work/garden/beds/plan.md'
const OUTSIDE = '/notes/seed-list.txt'

const EDITED = {
  filePath: FILE, oldString: 'Borlotti', newString: 'Runner beans', originalFile: '# Beds\nBorlotti\n', userModified: false, replaceAll: false,
  structuredPatch: [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 2, lines: ['-Borlotti', '+Runner beans', '+Chard'] }],
  gitDiff: { additions: 2, deletions: 1, patch: '' },
}
const CREATED = { type: 'create', filePath: OUTSIDE, content: 'Borlotti\nChard\n', structuredPatch: [], originalFile: null }

const view = (tool: string, input: unknown, output?: unknown, more: Partial<ToolCallView> = {}): ToolCallView =>
  ({ tool, input, isRunning: false, isErrored: false, isInterrupted: false, ...(output === undefined ? {} : { output }), ...more })

describe('the file rows, pure', () => {
  test('an Edit: the file relative to the session folder, the lines added and removed, a diff to open, the patch folded under it', () => {
    const row = fileRowOf(view('Edit', { file_path: FILE, old_string: 'Borlotti', new_string: 'Runner beans\nChard' }, EDITED), WORKSPACE)!
    expect(row.target).toEqual({ label: 'beds/plan.md', ref: `file:${FILE}` })
    expect(row.also).toEqual({ label: 'diff', ref: `file-diff:${FILE}` })
    expect(row.change).toEqual(['+2 −1'])
    expect(row.glyph).toBe('✎')
    expect(row.detail).toBe('```diff\n@@ -2,1 +2,2 @@\n-Borlotti\n+Runner beans\n+Chard\n```')
  })

  test('a Write that made a file: created, its lines, no diff to open; elsewhere the path is cut to its last parts', () => {
    const row = fileRowOf(view('Write', { file_path: OUTSIDE, content: 'Borlotti\nChard\n' }, CREATED), WORKSPACE)!
    expect([row.glyph, row.target?.label, row.change]).toEqual(['+', '/notes/seed-list.txt', ['created', '+2 −0']])
    expect(row.also).toBeUndefined()
    expect(fileRowOf(view('Write', { file_path: '/a/b/c/d/e.txt', content: '' }, CREATED))!.target?.label).toBe('…/c/d/e.txt')
  })

  test('running and errored: no counts yet, the reason under it; another tool or a relative path is the engine\'s row', () => {
    expect(fileRowOf(view('Edit', { file_path: FILE }, undefined, { isRunning: true }))).toMatchObject({ state: 'running', change: [] })
    expect(fileRowOf(view('Edit', { file_path: FILE }, 'String to replace not found', { isErrored: true }))).toMatchObject({ state: 'errored', error: 'String to replace not found' })
    expect(fileRowOf(view('Bash', { command: 'ls' }))).toBeNull()
    expect(fileRowOf(view('Edit', { file_path: 'beds/plan.md' }))).toBeNull()
    expect(toolResultLineOf('Edit', {}, false)).toBe('')
    expect(toolResultLineOf('Edit', 'oops', true)).toBeNull()
  })

  test('a touch: the file, its counts, and the file before it only when git does not track it', () => {
    expect(touchOf('Edit', { file_path: FILE }, EDITED)).toEqual({ path: FILE, added: 2, removed: 1 })
    expect(touchOf('Edit', { file_path: OUTSIDE }, { ...EDITED, filePath: OUTSIDE, gitDiff: undefined })).toEqual({ path: OUTSIDE, added: 2, removed: 1, original: '# Beds\nBorlotti\n' })
    // A file made: an empty copy from before, so its later diff shows everything since.
    expect(touchOf('Write', { file_path: OUTSIDE }, CREATED)).toEqual({ path: OUTSIDE, added: 2, removed: 0, original: '' })
    expect(touchOf('Write', { file_path: OUTSIDE }, { ...CREATED, content: '' })).toMatchObject({ added: 0 })
    expect(touchOf('Read', { file_path: FILE }, {})).toBeNull()
  })

  test('the project: the git repository, else the session folder, else the file\'s folder', () => {
    expect(projectOf(FILE, '/work/garden', '/elsewhere')).toEqual({ project: 'garden', root: '/work/garden' })
    expect(projectOf(FILE, null, '/work/garden')).toEqual({ project: 'garden', root: '/work/garden' })
    expect(projectOf(OUTSIDE, null, '/work/garden')).toEqual({ project: 'notes', root: '/notes' })
    const at = Date.UTC(2026, 9, 6, 9, 0)
    expect(touchInputOf({ path: FILE, added: 1, removed: 0 }, { project: 'garden', root: WORKSPACE }, 's-1', at)).toEqual({
      path: FILE, project: 'garden', projectRoot: WORKSPACE, session: 's-1', at: '2026-10-06T09:00:00.000Z', day: localDay(at), added: 1, removed: 0,
    })
  })
})

const result = (exitCode: number, stdout = '', stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })
type Run = { argv: readonly string[]; init?: ProcessRunInit }

/** A session in the garden folder (bound to `garden`), in a door tile or not, whose Edit and Write the test answers. */
function sessionIn(on: On, env: Record<string, string> = {}) {
  const runs: Run[] = []
  const readAnswer: { value: unknown } = { value: { kind: 'resource', id: 'resource:r1', threads: [] } }
  const toasts: string[] = []
  const copied: string[] = []
  const clock = mock.clock(on)
  mock.env(on, { PI_OUTLINER_MENTIONS_WORKSPACES: '', HERDR_PANE_ID: '', HERDR_WORKSPACE_ID: '', ...env })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: WORKSPACE }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__pi-outliner__${e.name}` } }))
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('ui.copy', ($, e) => { copied.push(e.text); return { value: { isCopied: true } } })
  on('ui.render', { component: 'ToolUse' }, ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  // Claude Code's own Edit and Write, as the engine answers them.
  on('tool.call', { tool: 'Edit' }, () => ({ result: EDITED, ref: 'r', text: 'ok' } as any))
  on('tool.call', { tool: 'Write' }, () => ({ result: CREATED, ref: 'r', text: 'ok' } as any))
  on('process.run', ($, e) => {
    runs.push(e)
    const argv = e.argv
    if (argv[0] === 'herdr') return { value: result(0, JSON.stringify({ result: { plugins: [{ plugin_id: 'float.pi-outliner', enabled: true, plugin_root: '/opt/outliner' }] } })) }
    if (argv[0] === 'git') return { value: argv.includes('/work/garden/beds') ? result(0, '/work/garden\n') : result(128, '', 'fatal: not a git repository') }
    if (argv[0] === 'ep0ch' && argv[1] === 'open') return { value: result(0, '{"opened":true,"reader":"middle"}\n') }
    if (argv[0] === 'ep0ch') return { value: result(1, '', 'no ep0ch') }
    if (argv.includes('bound-folder')) return { value: result(0, `{"bound":true,"folder":"${WORKSPACE}","outline":"garden"}\n`) }
    if (argv.includes('work-id-status')) return { value: result(0, '{"prefix":"PIE"}') }
    if (argv.includes('mentions')) return { value: result(0, '{"entries":[]}') }
    if (argv.includes('agent') && argv.includes('read')) return { value: result(0, JSON.stringify(readAnswer.value)) }
    if (argv.includes('touch-file')) return { value: result(0, JSON.stringify({ id: 'b1', created: true, touches: 1, ...(JSON.parse(e.init?.stdin ?? '{}').original ? { snapshot: '/outlines/garden/file-touches/session-1/x-seed-list.txt' } : {}) })) }
    return { value: result(1, '', 'unexpected') }
  })
  const touches = () => runs.filter(r => r.argv.includes('touch-file')).map(r => JSON.parse(r.init?.stdin ?? '{}'))
  return { runs, toasts, copied, clock, touches, readAnswer }
}

const START = { surface: 'terminal', isInteractive: true, cwd: WORKSPACE } as const

describe('each touch, recorded in the session\'s outline', () => {
  test('an Edit that ran is recorded by `agent touch-file` as this session, after the call answered; the copy from before goes with the first touch only', async ($, on) => {
    const s = sessionIn(on)
    await $.session.start(START)
    await s.clock.settle()
    const answered = await $.tool.call({ tool: 'Edit', file_path: FILE, old_string: 'Borlotti', new_string: 'Runner beans\nChard' } as any)
    expect((answered as any).result).toEqual(EDITED)
    await s.clock.settle()
    expect(s.touches()).toEqual([expect.objectContaining({ path: FILE, project: 'garden', projectRoot: '/work/garden', session: 'session-1', added: 2, removed: 1 })])
    const run = s.runs.find(r => r.argv.includes('touch-file'))!
    expect(run.argv).toEqual(expect.arrayContaining(['agent', 'touch-file', '--stdin', '--actor', 'claude-code', '--session', 'session-1']))
    expect(run.init?.cwd).toBe(WORKSPACE)

    // A file outside git: its copy from before goes once.
    await $.tool.call({ tool: 'Write', file_path: OUTSIDE, content: 'Borlotti\nChard\n' } as any)
    await s.clock.settle()
    expect(s.touches().at(-1)).toMatchObject({ path: OUTSIDE, project: 'notes' })
  })

  test('the first Edit of a file with open comment threads is held once with them (PIE-650); the same edit again goes through, and a file without threads is never held', async ($, on) => {
    const s = sessionIn(on)
    await $.session.start(START)
    await s.clock.settle()
    s.readAnswer.value = { kind: 'resource', id: 'resource:r1', threads: [{ thread: 't1', anchored: true, quote: 'Borlotti', body: 'Runner beans, not borlotti?', author: 'agent', actorId: 'reviewer-1', replies: [] }] }
    const edit = { tool: 'Edit', file_path: FILE, old_string: 'Borlotti', new_string: 'Runner beans\nChard' } as any
    const held = await $.tool.call(edit) as any
    expect(held.deny).toContain('has 1 open comment thread')
    expect(held.deny).toContain('Runner beans, not borlotti?')
    const read = s.runs.find(r => r.argv.includes('agent') && r.argv.includes('read'))!
    expect(JSON.parse(read.init?.stdin ?? '{}')).toEqual({ ref: `[file::${FILE}]` })
    expect(s.touches()).toEqual([])
    expect(((await $.tool.call(edit)) as any).result).toEqual(EDITED)
    // Another file, with no threads: asked once, never held.
    s.readAnswer.value = { kind: 'resource', id: 'resource:r2', threads: [] }
    expect(((await $.tool.call({ tool: 'Write', file_path: OUTSIDE, content: 'Borlotti\nChard\n' } as any)) as any).deny).toBeUndefined()
  })

  test('in a door tile, the file pressed opens there (ep0ch open file:), and diff opens its changes; outside a door the path is copied and said', async ($, on) => {
    const s = sessionIn(on, { EP0CH_CONTROL: '/state/sessions/local/garden/door.sock', EP0CH_TILE: 'claude' })
    await $.session.start(START)
    await s.clock.settle()
    const drawn = await $.ui.mount({ plugin: 'pi-outliner', surface: 'terminal', component: 'ToolUse', requestId: 'toolu_9',
      props: { tool_use_id: 'toolu_9', tool: 'Edit', input: { file_path: FILE, old_string: 'a', new_string: 'b' }, output: EDITED, isRunning: false, isErrored: false, isInterrupted: false } })
    expect(await drawn.find({ key: 'engine' })).toBeUndefined()
    expect((await drawn.find({ key: 'tool-row-open-toolu_9' }))?.text).toBe('beds/plan.md')
    await drawn.press({ key: 'tool-row-open-toolu_9' })
    await drawn.press({ key: 'tool-row-also-toolu_9' })
    await s.clock.settle()
    const opens = s.runs.filter(r => r.argv[0] === 'ep0ch' && r.argv[1] === 'open')
    expect(opens.map(r => r.argv.slice(2))).toEqual([
      [`file:${FILE}`, '--as', 'claude-code', '--json'],
      [`file:${FILE}`, 'diff=true', '--as', 'claude-code', '--json'],
    ])
    expect(opens[0]!.init?.env).toMatchObject({ EP0CH_CONTROL: '/state/sessions/local/garden/door.sock' })
    expect(s.toasts).toEqual([])
  })

  test('outside a door: the path is copied and the toast says where it would open', async ($, on) => {
    const s = sessionIn(on)
    await $.session.start(START)
    await s.clock.settle()
    const drawn = await $.ui.mount({ plugin: 'pi-outliner', surface: 'terminal', component: 'ToolUse', requestId: 'toolu_9',
      props: { tool_use_id: 'toolu_9', tool: 'Edit', input: { file_path: FILE, old_string: 'a', new_string: 'b' }, output: EDITED, isRunning: false, isErrored: false, isInterrupted: false } })
    await drawn.press({ key: 'tool-row-open-toolu_9' })
    await s.clock.settle()
    expect(s.copied).toEqual([FILE])
    expect(s.toasts).toEqual([`plan.md opens in an ep0ch door, and this Claude isn't in one · copied ${FILE}`])
  })
})
