import type { On, ProcessRunInit, ProcessRunResult } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'
import { drawArgv, drawnNoteOf, GUIDE_BLOCK, guideText, UPFRONT_TOOLS, withDrawing } from '../hooks/outline-guide'
import { outputJsonOf } from '../hooks/tool-rows'

tier('user')

// PIE-721: what the session's outline can hold, in front of the model: the guide as a context block, the core tools up
// front, and a written figure drawn back. A plugin test has no processes: `ep0ch` and the installed CLI are answered
// here. Fictional notes only.

const result = (exitCode: number, stdout: string, stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

const WORKSPACE = '/work/garden'
const NOTE = '0f3c2a1b-1111-4222-8333-444455556666'
const HERDR_LISTING = JSON.stringify({ result: { plugins: [{ plugin_id: 'float.pi-outliner', enabled: true, plugin_root: '/opt/outliner' }] } })
const GUIDE = '# What an ep0ch outline can hold\n\nNotes are Blockdown.\n\n## Components (2 components; as garden has them)\n### figures\n- graph-stat: Big numbers · live\n- graph-check: A list with boxes'
const DRAWN = '┌ the beds ─────┐\n│ 4      2      │\n│ raised bags   │\n└───────────────┘\n'

type Run = { argv: readonly string[]; init?: ProcessRunInit }
type Case = { guide?: ProcessRunResult; edit?: Record<string, unknown>; show?: ProcessRunResult }

function sessionIn(on: On, c: Case) {
  const runs: Run[] = []
  const registered: { name: string; isDeferred?: unknown }[] = []
  const clock = mock.clock(on)
  mock.env(on, { PI_OUTLINER_MENTIONS_WORKSPACES: '' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: WORKSPACE }))
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('tool.register', ($, e) => {
    registered.push({ name: e.name, isDeferred: (e as { isDeferred?: unknown }).isDeferred })
    return { value: { tool: `mcp__ep0ch__${e.name}` } }
  })
  on('process.run', ($, e) => {
    if (e.argv[0] === 'hostname') return { value: result(0, 'garden-host\n') }
    runs.push(e)
    if (e.argv[0] === 'herdr') return { value: result(0, HERDR_LISTING) }
    if (e.argv.includes('bound-folder')) return { value: result(0, `{"bound":true,"folder":"${WORKSPACE}","outline":"garden"}\n`) }
    if (e.argv.includes('work-id-status')) return { value: result(0, '{"prefix":"GDN"}') }
    if (e.argv[0] === 'ep0ch' && e.argv[1] === 'library' && e.argv[2] === '--guide') return { value: c.guide ?? result(1, '', 'ep0ch: no such flag') }
    if (e.argv[0] === 'ep0ch' && e.argv[1] === 'show') return { value: c.show ?? result(0, DRAWN) }
    if (e.argv.includes('agent') && e.argv.includes('edit')) return { value: result(0, `${JSON.stringify(c.edit ?? { id: NOTE, revision: 4 })}\n`) }
    return { value: result(1, '', 'error: unexpected command\n') }
  })
  return { runs, registered, clock }
}

const START = { surface: 'terminal', isInteractive: true, cwd: WORKSPACE } as const
const guideOf = async ($: any) => ((await $.prompt.context({ blocks: [] })).blocks as { name: string; text: string }[]).find(b => b.name === GUIDE_BLOCK)?.text

describe('the guide in the first prompt', () => {
  test('a bound outline: what ep0ch library --guide says, read in the workspace, with this session\'s lines after it', async ($, on) => {
    const s = sessionIn(on, { guide: result(0, `${GUIDE}\n`) })
    await $.session.start(START)
    await s.clock.settle()
    const text = (await guideOf($))!
    expect(text).toStartWith(GUIDE)
    expect(text).toContain('In this session: outline_edit rewrites a note whole')
    const read = s.runs.find(r => r.argv[0] === 'ep0ch' && r.argv[1] === 'library')!
    expect(read.argv).toEqual(['ep0ch', 'library', '--guide'])
    expect(read.init?.cwd).toBe(WORKSPACE)
    // Read once a session: a second context reads the same answer.
    await guideOf($)
    expect(s.runs.filter(r => r.argv[1] === 'library')).toHaveLength(1)
  })

  test('an ep0ch that can\'t say it (an older door, no host): no block, and nothing else changes', async ($, on) => {
    const s = sessionIn(on, {})
    await $.session.start(START)
    await s.clock.settle()
    expect(await guideOf($)).toBeUndefined()
  })
})

describe('the core tools up front', () => {
  test('reading, finding, writing a note and the components are listed in the prompt; the rest wait behind tool search', async ($, on) => {
    const s = sessionIn(on, {})
    await $.session.start(START)
    await s.clock.settle()
    for (const name of UPFRONT_TOOLS) expect(s.registered.find(t => t.name === name)?.isDeferred).toBe(false)
    expect(s.registered.find(t => t.name === 'outline_trash')?.isDeferred).toBeUndefined()
  })
})

describe('a written figure drawn back', () => {
  test('a write whose note now holds a figure comes back with the note as it draws, its JSON still last', async ($, on) => {
    const s = sessionIn(on, { edit: { id: NOTE, revision: 4, components: ['graph-stat'], warnings: ['the ::graph-stat on line 2 doesn\'t take titel: did you mean title?'] } })
    await $.session.start(START)
    await s.clock.settle()
    s.runs.length = 0
    const out = await $.tool.call({ tool: 'mcp__ep0ch__outline_edit', ref: NOTE, expectedRevision: 3, append: '::graph-stat\n---\n---\n::' })
    const text = String(out.result)
    expect(text).toStartWith('The note as it draws (ep0ch show, 80 columns):\n┌ the beds')
    expect(outputJsonOf(text)).toMatchObject({ id: NOTE, components: ['graph-stat'] })
    expect(s.runs.find(r => r.argv[0] === 'ep0ch' && r.argv[1] === 'show')!.argv).toEqual(['ep0ch', 'show', NOTE, '--width', '80', '--rows', '40'])
  })

  test('a write with no figure is answered as before, and nothing is drawn', async ($, on) => {
    const s = sessionIn(on, { edit: { id: NOTE, revision: 4, components: ['callout'] } })
    await $.session.start(START)
    await s.clock.settle()
    s.runs.length = 0
    const out = await $.tool.call({ tool: 'mcp__ep0ch__outline_edit', ref: NOTE, expectedRevision: 3, append: '> [!tip] water at nine' })
    expect(JSON.parse(String(out.result))).toMatchObject({ id: NOTE, components: ['callout'] })
    expect(s.runs.some(r => r.argv[0] === 'ep0ch' && r.argv[1] === 'show')).toBe(false)
  })

  test('a drawing that fails leaves the write\'s answer as it was', async ($, on) => {
    const s = sessionIn(on, { edit: { id: NOTE, revision: 4, components: ['graph-stat'] }, show: result(1, '', 'ep0ch: the host is down') })
    await $.session.start(START)
    await s.clock.settle()
    const out = await $.tool.call({ tool: 'mcp__ep0ch__outline_edit', ref: NOTE, expectedRevision: 3, append: 'x' })
    expect(JSON.parse(String(out.result))).toMatchObject({ id: NOTE })
  })
})

describe('the pure parts', () => {
  test('guideText: the CLI\'s guide with the session\'s lines; anything else is no guide', () => {
    expect(guideText(`${GUIDE}\n`)).toStartWith(GUIDE)
    expect(guideText('usage: ep0ch library …')).toBeNull()
    expect(guideText('')).toBeNull()
  })

  test('drawnNoteOf: the written note when it holds a figure, by the result\'s own id', () => {
    expect(drawnNoteOf('outline_edit', JSON.stringify({ id: NOTE, components: ['graph-tabs'] }))).toBe(NOTE)
    expect(drawnNoteOf('outline_create', JSON.stringify({ id: NOTE, components: ['links', 'graph-check'] }))).toBe(NOTE)
    expect(drawnNoteOf('outline_patch', JSON.stringify({ outcome: 'applied', edits: [{ blockId: NOTE }], components: ['graph-stat'] }))).toBe(NOTE)
    expect(drawnNoteOf('outline_edit', JSON.stringify({ id: NOTE, components: ['callout'] }))).toBeNull()
    expect(drawnNoteOf('outline_comment', JSON.stringify({ id: NOTE, components: ['graph-stat'] }))).toBeNull()
    expect(drawnNoteOf('outline_edit', 'not json')).toBeNull()
    expect(drawnNoteOf('outline_edit', JSON.stringify({ id: 'PIE-12', components: ['graph-stat'] }))).toBeNull()
  })

  test('withDrawing: the drawing first, the JSON last; nothing drawn leaves the result alone', () => {
    const json = JSON.stringify({ id: NOTE, revision: 4 })
    expect(withDrawing(json, DRAWN)).toBe(`The note as it draws (ep0ch show, 80 columns):\n${DRAWN.trimEnd()}\n\n${json}`)
    expect(outputJsonOf(withDrawing(json, DRAWN))).toEqual({ id: NOTE, revision: 4 })
    expect(withDrawing(json, '  \n')).toBe(json)
    expect(drawArgv(NOTE)).toEqual(['ep0ch', 'show', NOTE, '--width', '80', '--rows', '40'])
  })
})
