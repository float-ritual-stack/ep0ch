import type { On, ProcessRunInit, ProcessRunResult } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import {
  capped,
  DETAIL_LINES,
  outputJsonOf,
  READ_TOOLS,
  type ToolCallView,
  toolResultLineOf,
  type ToolRow,
  toolRowOf,
  toolRowsCommandOf,
  toolRowsPrefsOf,
  WRITE_TOOLS,
} from '../hooks/tool-rows'

tier('user')

// The mod's tool calls as compact rows (hooks/tool-rows.ts). Fictional notes only.

const NOTE = '0f3c2a1b-1111-4222-8333-444455556666'
const THREAD = '7a1e0c2d-2222-4333-8444-555566667777'
const NEW = '9b8a7c6d-3333-4444-8555-666677778888'

const done = (tool: string, input: unknown, output?: unknown): ToolCallView =>
  ({ tool: `mcp__pi-outliner__${tool}`, input, isRunning: false, isErrored: false, isInterrupted: false, output: output === undefined ? undefined : JSON.stringify(output) })

/** A row as one line of words: the glyph, lead, target and change, as the tree lays them out. */
const words = (row: ToolRow | null) =>
  row ? [row.glyph, row.lead, row.target?.label, row.change.length ? `· ${row.change.join(' · ')}` : ''].filter(Boolean).join(' ') : null

describe('the formatter: one row per tool', () => {
  test('outline_edit append: the appended first line, the revision, and the text to unfold', () => {
    const row = toolRowOf(done('outline_edit', { ref: 'PIE-569', expectedRevision: 1, append: '\n## Inside or outside the frame\n- **By mouse**, a drag' },
      { id: NOTE, revision: 2, previousRevision: 1, diff: '@@ line 4\n+## Inside or outside the frame' }))
    expect(words(row)).toBe('✎ PIE-569 · appended "Inside or outside the frame" · rev 1→2')
    expect(row!.target).toEqual({ label: 'PIE-569', ref: 'PIE-569' })
    expect(row!.detail).toBe('## Inside or outside the frame\n- **By mouse**, a drag')
    expect(row!.state).toBe('done')
  })

  test('outline_edit replaceSection and text: the diff the tool returned', () => {
    const section = toolRowOf(done('outline_edit', { ref: NOTE, expectedRevision: 3, replaceSection: { heading: '## Beans', body: 'Runner only.' } },
      { id: NOTE, revision: 4, previousRevision: 3, diff: '@@ line 5\n-Borlotti\n+Runner only.', section: { heading: '## Beans', previous: 'Borlotti' } }),
    id => (id === NOTE ? 'Seed swap plan' : undefined))
    expect(words(section)).toBe('✎ Seed swap plan · replaced § Beans · rev 3→4')
    expect(section!.detail).toBe('```diff\n@@ line 5\n-Borlotti\n+Runner only.\n```')
    const whole = toolRowOf(done('outline_edit', { ref: `((${NOTE}))`, expectedRevision: 4, text: 'Seed swap plan\n\nAll beans.' }, { id: NOTE, revision: 4, previousRevision: 4, diff: '' }))
    expect(words(whole)).toBe('✎ ((0f3c2a1b…)) · rewrote the note (no change) · rev 4')
    expect(whole!.detail).toBe('Seed swap plan\n\nAll beans.')
  })

  test('outline_edit with allowStructural says what it dropped', () => {
    const row = toolRowOf(done('outline_edit', { ref: 'PIE-12', expectedRevision: 2, text: 'Plain', allowStructural: true },
      { id: NOTE, revision: 3, previousRevision: 2, diff: '@@ line 1\n-Old [page::Seed Swap]\n+Plain', dropped: ['[page::Seed Swap]'] }))
    expect(row!.warning).toBe('dropped [page::Seed Swap]')
  })

  test('outline_patch: one span quoted, applied or proposed, and the spans as a diff', () => {
    const input = { ref: NOTE, revision: 3, patches: [{ observed: 'runner  beans', replacement: 'runner beans' }] }
    const applied = toolRowOf(done('outline_patch', input, { outcome: 'applied', edits: [{ blockId: NOTE, route: 'draft' }] }))
    expect(words(applied)).toBe('✎ ((0f3c2a1b…)) · patched "runner beans" · applied to the live draft')
    expect(applied!.detail).toBe('```diff\n-runner  beans\n+runner beans\n```')
    const proposed = toolRowOf(done('outline_patch', { ...input, patches: [...input.patches, { observed: 'a', replacement: 'b' }] },
      { outcome: 'proposed', reason: 'the text changed under it', proposalId: THREAD, embedded: null, embeddedIn: NOTE }))
    expect(words(proposed)).toBe('✎ ((0f3c2a1b…)) · patched 2 spans')
    expect(proposed!.warning).toBe('proposed, not applied: the text changed under it')
  })

  test('outline_assign_id: the id given, or already there', () => {
    const input = { ref: NOTE, revision: 3 }
    expect(words(toolRowOf(done('outline_assign_id', input, { outcome: 'applied', workId: 'GDN-001', page: '[[GDN-001]]' })))).toBe('✎ ((0f3c2a1b…)) · id GDN-001')
    expect(words(toolRowOf(done('outline_assign_id', input, { outcome: 'unchanged', workId: 'GDN-001' })))).toBe('✎ ((0f3c2a1b…)) · id GDN-001 · (already had it)')
  })

  test('outline_set_property: the chip set, and applied, proposed or no change', () => {
    const input = { ref: NOTE, key: 'crop', value: 'leek', revision: 3 }
    expect(words(toolRowOf(done('outline_set_property', input, { outcome: 'applied', edits: [{ blockId: NOTE, route: 'saved' }] }))))
      .toBe('✎ ((0f3c2a1b…)) · set [crop::leek] · applied')
    expect(words(toolRowOf(done('outline_set_property', input, { outcome: 'unchanged', key: 'crop', value: 'leek' })))).toBe('✎ ((0f3c2a1b…)) · set [crop::leek] · (no change)')
    expect(toolRowOf(done('outline_set_property', input, { outcome: 'proposed', reason: 'the text changed under it' }))!.warning).toBe('proposed, not applied: the text changed under it')
  })

  test('outline_create: the new block (pressable) once made, its parent, and the body', () => {
    const running = toolRowOf({ ...done('outline_create', { parent: 'PIE-569', text: 'A tab can hold a split\n\nTwo tiles side by side.' }), isRunning: true })
    expect(words(running)).toBe('+ "A tab can hold a split" · created · under PIE-569')
    expect(running!.target).toBeNull()
    expect(running!.state).toBe('running')
    const made = toolRowOf(done('outline_create', { parent: 'PIE-569', text: 'A tab can hold a split\n\nTwo tiles side by side.' }, { id: NEW, ref: `((${NEW}))`, revision: 1 }))
    expect(words(made)).toBe('+ "A tab can hold a split" · created · under PIE-569')
    expect(made!.target).toEqual({ label: '"A tab can hold a split"', ref: NEW })
    expect(made!.detail).toBe('A tab can hold a split\n\nTwo tiles side by side.')
    expect(words(toolRowOf(done('outline_create', { parent: 'root', text: 'Top' })))).toBe('+ "Top" · created · at the top')
  })

  test('outline_comment, outline_reply and outline_resolve_thread', () => {
    const comment = toolRowOf(done('outline_comment', { ref: 'PIE-492', quote: 'runner beans', body: 'Which variety?' }, { thread: THREAD, lifecycle: 'open' }))
    expect(words(comment)).toBe('💬 comment on PIE-492 · on "runner beans" · "Which variety?"')
    expect(comment!.detail).toBe('> runner beans\n\nWhich variety?')
    expect(words(toolRowOf(done('outline_comment', { ref: 'PIE-492', whole: true, body: 'Looks right.' })))).toBe('💬 comment on PIE-492 · on the whole note · "Looks right."')
    const reply = toolRowOf(done('outline_reply', { thread: THREAD, body: 'Scarlet emperor.' }))
    expect(words(reply)).toBe('💬 reply in thread 7a1e0c2d… · "Scarlet emperor."')
    expect(reply!.target!.ref).toBe(THREAD)
    expect(words(toolRowOf(done('outline_resolve_thread', { thread: THREAD, resolved: true })))).toBe('✓ resolved thread 7a1e0c2d…')
    expect(words(toolRowOf(done('outline_resolve_thread', { thread: THREAD, resolved: false })))).toBe('↺ reopened thread 7a1e0c2d…')
  })

  test('note_section and work_body: a diff from what was there', () => {
    const section = toolRowOf(done('note_section', { block: 'PIE-12', heading: '## Plan', body: 'Swap at ten.\nBring labels.', expectedRevision: 2 },
      { blockId: NOTE, ref: `((${NOTE}))`, revision: 3, workId: 'PIE-12', previous: 'Swap at ten.' }))
    expect(words(section)).toBe('✎ PIE-12 · replaced § Plan · rev 3')
    expect(section!.detail).toBe('```diff\n@@ line 2\n+Bring labels.\n```')
    const body = toolRowOf(done('work_body', { item: NOTE, body: 'New body' }, { blockId: NOTE, ref: `((${NOTE}))`, revision: 5, workId: 'PIE-12', previous: 'Old body' }))
    expect(words(body)).toBe('✎ PIE-12 · replaced the body · rev 5')
    expect(body!.detail).toBe('```diff\n@@ line 1\n-Old body\n+New body\n```')
  })

  test('the work tools: create, stage, set, deliver, complete', () => {
    const created = toolRowOf(done('work_create', { title: 'A tab can hold a split', project: 'ep0ch', arc: 'tiles', tracks: ['door'], priority: 'medium', body: 'Two tiles.' },
      { workId: 'PIE-570', blockId: NEW, ref: `((${NEW}))`, revision: 1, workStage: 'unprioritized', workQueueId: NOTE }))
    expect(words(created)).toBe('+ PIE-570 · created · "A tab can hold a split" · medium')
    expect(created!.detail).toBe('**A tab can hold a split**\n\nTwo tiles.')
    expect(words(toolRowOf({ ...done('work_create', { title: 'Later', priority: 'low' }), isRunning: true }))).toBe('+ new item · "Later" · low')
    expect(words(toolRowOf(done('work_stage', { item: 'PIE-561', stage: 'queued' }, { workId: 'PIE-561', key: 'work-stage', previous: 'later', value: 'queued', changed: true }))))
      .toBe('⇄ PIE-561 · stage later → queued')
    expect(words(toolRowOf(done('work_set', { item: NOTE, key: 'priority', value: 'high' }, { workId: 'PIE-561', key: 'priority', previous: 'low', value: 'high' }))))
      .toBe('⇄ PIE-561 · priority low → high')
    expect(words(toolRowOf(done('work_deliver', { item: 'PIE-561', repo: 'garden/plot', pr: 42 },
      { workId: 'PIE-561', delivery: { deliveryKey: 'PIE-561/plot', stage: 'review' }, pullRequest: { number: 42, state: 'OPEN' } }))))
      .toBe('⇡ PIE-561 · delivered garden/plot#42 · open · PIE-561/plot')
    const completed = toolRowOf(done('work_complete', { item: 'PIE-561', allMerged: true, proof: 'Merged and checked\n\nThe swap ran.' }))
    expect(words(completed)).toBe('✓ PIE-561 · completed · proof "Merged and checked"')
    expect(completed!.detail).toBe('Merged and checked\n\nThe swap ran.')
  })

  test('view_order: a write with ids, a read without', () => {
    const order = { view: NOTE, order: [{ id: THREAD, title: 'Bring labels', workId: 'PIE-12' }, { id: NOTE, title: 'Seed swap plan' }] }
    const set = toolRowOf(done('view_order', { view: NOTE, ids: ['PIE-12'] }, order), () => 'Garden board')
    expect(words(set)).toBe('⇅ reordered Garden board · 1 first')
    expect(set!.kind).toBe('write')
    expect(set!.detail).toBe('1. PIE-12 Bring labels\n2. Seed swap plan')
    expect(toolRowOf(done('view_order', { view: NOTE }, order))!.kind).toBe('read')
  })

  test('the read tools: one quiet line each', () => {
    const read = toolRowOf(done('outline_read', { ref: NOTE }, { id: NOTE, title: 'Seed swap plan', revision: 3, properties: { page: 'Seed Swap', crop: 'beans' }, children: [{}, {}] }))
    expect(words(read)).toBe('⌕ read Seed swap plan · 2 properties · 2 children · rev 3')
    expect(read!.kind).toBe('read')
    expect(words(toolRowOf(done('outline_read', { ref: 'PIE-12' }, { title: 'Bare', revision: 1, properties: {}, children: [] })))).toBe('⌕ read PIE-12 · rev 1')
    expect(words(toolRowOf(done('outline_find', { text: 'dropdown menu' }, { blocks: [{ id: NOTE, title: 'Menus' }], complete: false }))))
      .toBe('⌕ find "dropdown menu" · 1 hit+')
    expect(words(toolRowOf(done('outline_find', { property: 'crop=leek', under: 'PIE-12' }, { blocks: [], complete: true }))))
      .toBe('⌕ find property crop=leek under PIE-12 · 0 hits')
    expect(words(toolRowOf(done('outline_changes', { since: '2026-03-01T00:00:00Z', actor: 'garden-agent' }, { entries: [{ id: NOTE, title: 'Seed swap plan', kind: 'text', author: 'agent' }], cursor: 9, complete: true }))))
      .toBe('⌕ changes since 2026-03-01T00:00:00Z by garden-agent · 1 block')
    expect(words(toolRowOf(done('outline_resolve', { ref: '[[Seed Swap]]' }, { id: NOTE, title: 'Seed swap plan' })))).toBe('⌕ resolve Seed Swap · → Seed swap plan')
    expect(words(toolRowOf(done('show', { reference: 'PIE-12' }, 'Shown')))).toBe('⌕ show PIE-12')
  })

  test('every tool the mod draws has a row for a usual input', () => {
    expect([...WRITE_TOOLS, ...READ_TOOLS].sort()).toEqual([
      'note_section', 'outline_assign_id', 'outline_changes', 'outline_comment', 'outline_create', 'outline_edit', 'outline_find', 'outline_patch', 'outline_read',
      'outline_reply', 'outline_resolve', 'outline_resolve_thread', 'outline_set_property', 'show', 'view_order', 'work_body', 'work_complete', 'work_create',
      'work_deliver', 'work_set', 'work_stage',
    ])
  })
})

describe('the formatter: states and shapes', () => {
  test('errored: red, with the first line of the reason the model read', () => {
    const row = toolRowOf({ ...done('outline_edit', { ref: 'PIE-12', expectedRevision: 1, append: 'More' }), isErrored: true,
      output: 'PIE-12 is at revision 4, not 1: it changed since you read it. Read it again, then edit\nmore detail' })
    expect(row!.state).toBe('errored')
    expect(row!.error).toBe('PIE-12 is at revision 4, not 1: it changed since you read it. Read it again, then edit')
    expect(toolRowOf({ ...done('work_stage', { item: 'PIE-1', stage: 'doing' }), isErrored: true })!.error).toBe('the call failed')
    expect(toolRowOf({ ...done('work_stage', { item: 'PIE-1', stage: 'doing' }), isErrored: true, output: 'Error: unknown stage doing2' })!.error).toBe('unknown stage doing2')
  })

  test('interrupted and running', () => {
    expect(toolRowOf({ ...done('outline_edit', { ref: 'PIE-12', expectedRevision: 1, append: 'More' }), isInterrupted: true, isErrored: true })!.state).toBe('interrupted')
    const running = toolRowOf({ ...done('outline_edit', { ref: 'PIE-12', expectedRevision: 1, append: 'More' }), isRunning: true })
    expect(words(running)).toBe('✎ PIE-12 · appended "More"')
    expect(running!.state).toBe('running')
  })

  test('malformed input or another tool: null, so the engine draws its own row', () => {
    for (const input of [null, undefined, 'PIE-12', [], 7, {}, { ref: 42 }, { ref: 'PIE-12' }, { ref: 'PIE-12', append: 5 }]) {
      expect(toolRowOf(done('outline_edit', input))).toBeNull()
    }
    expect(toolRowOf(done('outline_patch', { ref: 'PIE-1', patches: 'no' }))).toBeNull()
    expect(toolRowOf(done('work_deliver', { item: 'PIE-1', repo: 'a/b', pr: '42' }))).toBeNull()
    expect(toolRowOf(done('door_act', { action: 'layout.get' }))).toBeNull()
    expect(toolRowOf({ ...done('outline_edit', { ref: 'PIE-1', expectedRevision: 1, append: 'x' }), tool: 'Bash' })).toBeNull()
  })

  test('an output that is not JSON still draws the row from the input', () => {
    const row = toolRowOf({ ...done('outline_edit', { ref: 'PIE-12', expectedRevision: 1, append: 'More' }), output: 'not json' })
    expect(words(row)).toBe('✎ PIE-12 · appended "More"')
  })

  test('the output as a string, text blocks or content blocks', () => {
    const json = { revision: 2 }
    expect(outputJsonOf(JSON.stringify(json))).toEqual(json)
    expect(outputJsonOf([{ type: 'text', text: JSON.stringify(json) }])).toEqual(json)
    expect(outputJsonOf({ content: [{ type: 'text', text: JSON.stringify(json) }] })).toEqual(json)
    expect(outputJsonOf(json)).toEqual(json)
    expect(outputJsonOf(`warning: old host\n${JSON.stringify(json)}`)).toEqual(json)
    expect(outputJsonOf('plain words')).toBeNull()
    expect(outputJsonOf(undefined)).toBeNull()
  })

  test('long content is capped, saying how many more lines; a fence cut open is closed', () => {
    const long = Array.from({ length: DETAIL_LINES + 7 }, (_, i) => `line ${i + 1}`).join('\n')
    expect(capped(long).split('\n').at(-1)).toBe('*… 7 more lines*')
    const fence = ['```diff', ...Array.from({ length: DETAIL_LINES + 2 }, (_, i) => `+${i}`), '```'].join('\n')
    const cut = capped(fence).split('\n')
    expect(cut.filter(l => l === '```').length).toBe(1)
    expect(cut.at(-1)).toBe('*… 4 more lines*')
    expect(capped('short\ttab\u0007bell')).toBe('short\ttabbell')
    const wide = capped('x'.repeat(12_000)).split('\n')
    expect(wide[0]!.length).toBe(8001)
    expect(wide.at(-1)).toBe('*… the rest is cut*')
    const fourTicks = capped(['````diff', ...Array.from({ length: DETAIL_LINES + 2 }, (_, i) => `+${i}`), '````'].join('\n')).split('\n')
    expect(fourTicks.at(-3)).toBe('````')
    const tildes = capped(['~~~', ...Array.from({ length: DETAIL_LINES + 2 }, (_, i) => `${i}`), '~~~'].join('\n')).split('\n')
    expect(tildes.at(-3)).toBe('~~~')
  })

  test('the result line: one line for a write, nothing for a read, the engine for an error', () => {
    expect(toolResultLineOf('mcp__pi-outliner__outline_edit', JSON.stringify({ revision: 2, previousRevision: 1 }), false)).toBe('✓ rev 2')
    expect(toolResultLineOf('mcp__pi-outliner__outline_patch', JSON.stringify({ outcome: 'applied', edits: [] }), false)).toBe('✓ applied')
    expect(toolResultLineOf('mcp__pi-outliner__outline_comment', JSON.stringify({ thread: THREAD, lifecycle: 'open' }), false)).toBe('✓ thread open')
    expect(toolResultLineOf('mcp__pi-outliner__outline_reply', JSON.stringify({ thread: THREAD, reply: NOTE }), false)).toBe('✓ replied')
    expect(toolResultLineOf('mcp__pi-outliner__outline_read', JSON.stringify({ revision: 2 }), false)).toBe('')
    expect(toolResultLineOf('mcp__pi-outliner__outline_edit', 'refused', true)).toBeNull()
    expect(toolResultLineOf('mcp__pi-outliner__outline_edit', 'not json', false)).toBeNull()
    expect(toolResultLineOf('Bash', '{}', false)).toBeNull()
  })

  test('the choice: on by default, /tool-rows on|off', () => {
    expect(toolRowsPrefsOf(undefined)).toEqual({ enabled: true })
    expect(toolRowsPrefsOf({ enabled: false })).toEqual({ enabled: false })
    expect(toolRowsPrefsOf({ enabled: 'no' })).toEqual({ enabled: true })
    expect(toolRowsCommandOf(' OFF ')).toEqual({ enabled: false })
    expect(toolRowsCommandOf('on')).toEqual({ enabled: true })
    expect(toolRowsCommandOf('')).toBeNull()
  })
})

// ─── Drawn through the mod ─────────────────────────────────────────────────

const result = (exitCode: number, stdout: string, stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

const WORKSPACE = '/work/garden'
const HERDR_LISTING = JSON.stringify({ result: { plugins: [{ plugin_id: 'float.pi-outliner', enabled: true, plugin_root: '/opt/outliner' }] } })
const ENSURED = JSON.stringify({ treePane: 'w:p1', detailPane: 'w:p2', detailClientId: 'admin-detail', opened: false, outline: 'garden' })
type Run = { argv: readonly string[]; init?: ProcessRunInit }

/** A session in the garden folder, in Herdr; the engine's own rows are keyed `engine`. */
function sessionIn(on: On, stored: Record<string, unknown> = {}) {
  const runs: Run[] = []
  const toasts: string[] = []
  const clock = mock.clock(on)
  mock.env(on, { PI_OUTLINER_MENTIONS_WORKSPACES: '', HERDR_PANE_ID: 'w:p9', HERDR_TAB_ID: 'w:t1', HERDR_WORKSPACE_ID: 'w' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: WORKSPACE }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__pi-outliner__${e.name}` } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', { component: 'ToolUse' }, ($, e) => $.ui.resolve(e).Box({ key: 'engine', children: $.ui.resolve(e).Text({ children: `engine ${e.props.tool}` }) }))
  on('ui.render', { component: 'ToolResult' }, ($, e) => $.ui.resolve(e).Box({ key: 'engine-result', children: $.ui.resolve(e).Text({ children: 'engine result' }) }))
  // The store beneath the plugins, readable by the test.
  on('store.get', ($, e) => ({ value: stored[e.key] }))
  on('store.set', ($, e) => { stored[e.key] = JSON.parse(JSON.stringify(e.value)); return { value: undefined } })
  on('process.run', ($, e) => {
    runs.push(e)
    const argv = e.argv
    if (argv[0] === 'herdr') return { value: result(0, HERDR_LISTING) }
    if (argv[0] === 'ep0ch') return { value: result(1, '', 'no ep0ch') }
    if (argv.includes('bound-folder')) return { value: result(0, `{"bound":true,"folder":"${WORKSPACE}","outline":"garden"}\n`) }
    if (argv.includes('work-id-status')) return { value: result(0, '{"prefix":"PIE","observedPrefixes":["PIE"]}') }
    if (argv.includes('mentions')) return { value: result(0, '{"entries":[]}') }
    if (argv.includes('agent') && argv.includes('resolve')) return { value: result(0, `{"id":"${NOTE}","title":"Seed swap plan","revision":3}\n`) }
    if (argv[2]?.endsWith('/src/herdr-open.ts')) return { value: result(0, `${ENSURED}\n`) }
    if (argv.includes('link')) return { value: result(0, '{"kind":"work","title":"Seed swap plan"}') }
    return { value: result(1, '', 'unexpected') }
  })
  return { runs, toasts, clock }
}

const START = { surface: 'terminal', isInteractive: true, cwd: WORKSPACE } as const
const EDIT = { ref: 'PIE-569', expectedRevision: 1, append: '\n## Inside or outside\n- **By mouse**, a drag' }

function mountRow($: any, surface: 'terminal' | 'desktop', props: Partial<ToolCallView> & { tool: string; input: unknown }, id = 'toolu_1') {
  return $.ui.mount({
    plugin: 'pi-outliner', surface, component: 'ToolUse', requestId: id,
    props: { tool_use_id: id, isRunning: false, isErrored: false, isInterrupted: false, ...props },
  })
}

describe('the rows in the transcript', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: collapsed by default; ▸ unfolds the appended text as Markdown, ▾ folds it`, async ($, on) => {
      const s = sessionIn(on)
      await $.session.start({ ...START, surface })
      await s.clock.settle()
      const drawn = await mountRow($, surface, { tool: 'mcp__pi-outliner__outline_edit', input: EDIT, output: JSON.stringify({ id: NOTE, revision: 2, previousRevision: 1, diff: '' }) })
      expect(await drawn.find({ key: 'engine' })).toBeUndefined()
      expect((await drawn.find({ key: 'tool-row-open-toolu_1' }))?.text).toBe('PIE-569')
      expect(await drawn.find({ type: 'Text', text: /appended "Inside or outside" · rev 1→2/ })).toBeDefined()
      expect((await drawn.find({ key: 'tool-row-fold-toolu_1' }))?.text).toContain('▸')
      expect(await drawn.find({ type: 'Markdown' })).toBeUndefined()
      await drawn.press({ key: 'tool-row-fold-toolu_1' })
      expect((await drawn.find({ key: 'tool-row-fold-toolu_1' }))?.text).toContain('▾')
      expect(JSON.stringify(await drawn.find({ type: 'Markdown' }))).toContain('## Inside or outside')
      await drawn.press({ key: 'tool-row-fold-toolu_1' })
      expect(await drawn.find({ type: 'Markdown' })).toBeUndefined()
    })
  }

  test('the target pressed opens the note where references open (the Outliner Detail beside Claude)', async ($, on) => {
    const s = sessionIn(on)
    await $.session.start(START)
    await s.clock.settle()
    const drawn = await mountRow($, 'terminal', { tool: 'mcp__pi-outliner__outline_edit', input: EDIT, output: JSON.stringify({ revision: 2, previousRevision: 1 }) })
    s.runs.length = 0
    await drawn.press({ key: 'tool-row-open-toolu_1' })
    await s.clock.settle()
    const link = s.runs.find(run => run.argv.includes('link'))
    expect(link?.argv).toContain('pi-outliner://work/PIE-569')
    expect(link?.argv).toContain('--no-focus')
  })

  test("a block id's title is looked up once, off the draw, and the row draws it", async ($, on) => {
    const s = sessionIn(on)
    await $.session.start(START)
    await s.clock.settle()
    const drawn = await mountRow($, 'terminal', { tool: 'mcp__pi-outliner__outline_comment', input: { ref: NOTE, whole: true, body: 'Which variety?' } })
    await s.clock.settle()
    expect((await drawn.find({ key: 'tool-row-open-toolu_1' }))?.text).toBe('Seed swap plan')
    await mountRow($, 'terminal', { tool: 'mcp__pi-outliner__outline_read', input: { ref: NOTE } }, 'toolu_2')
    await s.clock.settle()
    expect(s.runs.filter(run => run.argv.includes('agent') && run.argv.includes('resolve'))).toHaveLength(1)
  })

  test('an errored call: the reason in red on the row, and the engine draws the full error', async ($, on) => {
    const s = sessionIn(on)
    await $.session.start(START)
    await s.clock.settle()
    const drawn = await mountRow($, 'terminal', { tool: 'mcp__pi-outliner__work_stage', input: { item: 'PIE-561', stage: 'done' }, isErrored: true, output: 'Done needs proof: use work_complete' })
    const error = await drawn.find({ type: 'Text', text: /✗ Done needs proof/ })
    expect(error).toBeDefined()
    expect(JSON.stringify(error)).toContain('red')
    const resultRow = await $.ui.mount({ plugin: 'pi-outliner', surface: 'terminal', component: 'ToolResult', requestId: 'toolu_1',
      props: { tool_use_id: 'toolu_1', tool: 'mcp__pi-outliner__work_stage', output: 'Done needs proof: use work_complete', isErrored: true } })
    expect(await resultRow.find({ key: 'engine-result' })).toBeDefined()
  })

  test('the result under a write is one line; under a read, nothing', async ($, on) => {
    const s = sessionIn(on)
    await $.session.start(START)
    await s.clock.settle()
    await mountRow($, 'terminal', { tool: 'mcp__pi-outliner__outline_edit', input: EDIT })
    await mountRow($, 'terminal', { tool: 'mcp__pi-outliner__outline_read', input: { ref: 'PIE-12' } }, 'toolu_2')
    const write = await $.ui.mount({ plugin: 'pi-outliner', surface: 'terminal', component: 'ToolResult', requestId: 'toolu_1',
      props: { tool_use_id: 'toolu_1', tool: 'mcp__pi-outliner__outline_edit', output: JSON.stringify({ revision: 2, previousRevision: 1 }), isErrored: false } })
    expect((await write.find({ type: 'Text', text: /✓ rev 2/ }))).toBeDefined()
    const read = await $.ui.mount({ plugin: 'pi-outliner', surface: 'terminal', component: 'ToolResult', requestId: 'toolu_2',
      props: { tool_use_id: 'toolu_2', tool: 'mcp__pi-outliner__outline_read', output: JSON.stringify({ revision: 2 }), isErrored: false } })
    expect(await read.find({ key: 'engine-result' })).toBeUndefined()
    expect(await read.find({ type: 'Text' })).toBeUndefined()
  })

  test('a malformed input, and another tool, are the engine’s rows', async ($, on) => {
    const s = sessionIn(on)
    await $.session.start(START)
    await s.clock.settle()
    const malformed = await mountRow($, 'terminal', { tool: 'mcp__pi-outliner__outline_edit', input: { ref: 42 } })
    expect(await malformed.find({ key: 'engine' })).toBeDefined()
    const other = await mountRow($, 'terminal', { tool: 'mcp__pi-outliner__door_peek', input: {} }, 'toolu_3')
    expect(await other.find({ key: 'engine' })).toBeDefined()
    // The engine drew the call's row, so its result is the engine's too.
    const result = await $.ui.mount({ plugin: 'pi-outliner', surface: 'terminal', component: 'ToolResult', requestId: 'toolu_1',
      props: { tool_use_id: 'toolu_1', tool: 'mcp__pi-outliner__outline_edit', output: JSON.stringify({ revision: 2 }), isErrored: false } })
    expect(await result.find({ key: 'engine-result' })).toBeDefined()
  })

  test('/tool-rows off leaves the engine’s rows, kept for the next session; /tool-rows on brings them back', async ($, on) => {
    const stored: Record<string, unknown> = {}
    const s = sessionIn(on, stored)
    await $.session.start(START)
    await s.clock.settle()
    const said = await $.command.run({ command: 'tool-rows', args: 'off' } as any)
    expect(said.text).toContain('off')
    expect(stored['tool-rows']).toEqual({ enabled: false })
    const drawn = await mountRow($, 'terminal', { tool: 'mcp__pi-outliner__outline_edit', input: EDIT })
    expect(await drawn.find({ key: 'engine' })).toBeDefined()
    await $.command.run({ command: 'tool-rows', args: 'on' } as any)
    expect(await drawn.find({ key: 'engine' })).toBeUndefined()
    expect((await $.command.run({ command: 'tool-rows', args: '' } as any)).text).toContain('Now on.')
  })
})
