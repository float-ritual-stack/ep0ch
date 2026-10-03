import type { On, ProcessRunInit, ProcessRunResult } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { mentionRowsOf, mentionsListArgs, prefsOf } from '../hooks/mentions-view'
import { resetBlockViewProbe } from '../hooks/block-view'

tier('user')

const result = (exitCode: number, stdout: string, stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

const WORKSPACE = '/work/outliner'
const BLOCK = '11111111-2222-4333-8444-555555555555'
const OTHER = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const PANE = 'outliner-mentions'

const LISTED = JSON.stringify({
  entries: [
    { key: BLOCK, address: 'chain-oil', title: 'Chain oil', block: { id: BLOCK, revision: 3, text: 'Chain oil\nThe wax one, not the spray.' }, mentionedAt: '2026-10-03T09:41:00.000Z', excerpt: 'Filed under [[chain-oil]].' },
    { key: 'address:old-padlock', address: 'old-padlock', title: 'old-padlock', block: null, unavailableReason: 'No page old-padlock', mentionedAt: '2026-10-03T09:40:00.000Z', excerpt: 'And [[old-padlock]].' },
    { key: OTHER, address: OTHER, title: 'Bike shed', block: { id: OTHER, revision: 1, text: 'Bike shed\nWhere the bikes live.' }, mentionedAt: '2026-10-03T09:39:00.000Z', excerpt: 'In ((…)).' },
  ],
  completeness: { kind: 'complete' }, retention: { messages: 2, maximum: 100 }, notChecked: [],
})

const CELLS = (columns: number) => {
  const words = new Uint32Array(columns * 2 * 3).fill(0x01000000)
  for (let i = 0; i < columns * 2; i++) words[i * 3] = 0x41
  let binary = ''
  for (const byte of new Uint8Array(words.buffer)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

type Run = { argv: readonly string[]; init?: ProcessRunInit }

/** In an ep0ch-door tile, in Herdr, or neither: what openNote reads. */
const IN_DOOR = { EP0CH_TILE: 'claude', EP0CH_CONTROL: '/state/door-claude.sock', HERDR_PANE_ID: '', HERDR_WORKSPACE_ID: '' }
const IN_HERDR = { HERDR_PANE_ID: 'w:p9', HERDR_TAB_ID: 'w:t1', HERDR_WORKSPACE_ID: 'w' }
const NEITHER = { HERDR_PANE_ID: '', HERDR_WORKSPACE_ID: '' }

/**
 * A session in WORKSPACE (bound to the outline `garden`) whose commands answer
 * as an installed Outliner, a fake `ep0ch` and Herdr would; `ep0ch` is the
 * door's CLI only (`help`, `show --cells`), never its source.
 */
/** The Outliner's Herdr opens the mod ran (`src/herdr-open.ts`), by mode. */
const herdrOpens = (runs: readonly Run[], mode: 'ensure-detail' | 'find-detail') =>
  runs.filter(run => run.argv[2]?.endsWith('/src/herdr-open.ts') && run.argv.includes(mode))

/** `beside`: the admin Detail the Outliner's find-detail and ensure-detail find beside Claude in Herdr, or null for none. */
function sessionIn(on: On, env: Record<string, string>, stored: Record<string, unknown> = {}, ep0ch: 'cells' | 'missing' = 'cells', placed = true, listed = LISTED, beside: string | null = 'admin-detail') {
  const runs: Run[] = []
  const toasts: string[] = []
  const opened: string[] = []
  const closed: string[] = []
  const clock = mock.clock(on)
  mock.env(on, env)
  // The store beneath the plugins, readable by the test.
  on('store.get', ($, e) => ({ value: stored[e.key] }))
  on('store.set', ($, e) => { stored[e.key] = JSON.parse(JSON.stringify(e.value)); return { value: undefined } })
  // The engine's own band, where the mod leaves it.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: WORKSPACE }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__pi-outliner__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', ($, e) => { opened.push(e.id); return { value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'opened unasked under 144 columns (120 now)' } } })
  on('ui.close', ($, e) => { closed.push(e.id); return { value: undefined } })
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined } })
  on('process.run', ($, e) => {
    runs.push(e)
    const ok = (stdout: string) => ({ value: result(0, stdout) })
    const [cmd, sub] = e.argv
    if (cmd === 'herdr') {
      return ok(JSON.stringify({ result: { plugins: [{ plugin_id: 'float.pi-outliner', enabled: true, plugin_root: '/opt/outliner' }] } }))
    }
    if (cmd === 'ep0ch') {
      if (ep0ch === 'missing') throw Error('ep0ch: not found')
      if (sub === 'help') return ok('  ep0ch show <id> [--ansi | --cells] [--width <n>] [--rows <n>]\n')
      const width = Number(e.argv[e.argv.indexOf('--width') + 1])
      return ok(JSON.stringify({ id: e.argv[2], columns: width, rows: 2, cells: CELLS(width), replaced: 0 }))
    }
    if (e.argv.includes('bound-folder')) return ok(JSON.stringify({ bound: true, folder: WORKSPACE, outline: 'garden' }))
    if (e.argv.includes('work-id-status')) return ok('{"prefix":"PIE"}')
    if (e.argv.includes('mentions')) return ok(listed)
    if (e.argv.includes('resolve')) return ok(`{"id":"${BLOCK}","title":"Chain oil"}`)
    if (herdrOpens([e], 'find-detail').length) return ok(JSON.stringify({ detailClientId: beside }))
    if (herdrOpens([e], 'ensure-detail').length) {
      // ensure-detail opens one when there is none; from then on find-detail finds it.
      const opened = !beside
      beside ??= 'opened-detail'
      return ok(JSON.stringify({ detailClientId: beside, opened }))
    }
    if (e.argv.includes('link')) return ok('{"title":"Chain oil"}')
    if (e.argv.includes('door-open')) return ok('{"reader":"centre"}')
    return ok('{}')
  })
  resetBlockViewProbe()
  async function begin($: any) {
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: WORKSPACE })
    await clock.settle()
  }
  const kept = () => prefsOf(stored['mentions-view'])
  return { runs, toasts, opened, closed, clock, begin, kept }
}

const band = ($: any, columns = 100) =>
  $.ui.mount({ plugin: 'pi-outliner', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: columns, scroll: { top: 0, bodyRows: 20, rows: 0 }, view: {} } })

const pane = ($: any, surface: 'terminal' | 'desktop' = 'terminal', columns = 60) =>
  $.ui.mount({ plugin: 'pi-outliner', surface, component: 'Pane', requestId: PANE, props: { title: 'Mentions', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { top: 0, bodyRows: 30, rows: 0 }, view: {} } })

describe('Recent mentions in Claude Code', () => {
  test('the band (the default): the mentions this conversation made, as buttons with hotkeys, read as Tree reads them', async ($, on) => {
    const session = sessionIn(on, IN_HERDR)
    await session.begin($)
    const list = session.runs.find(run => run.argv.includes('mentions'))!
    expect(list.argv.slice(3)).toEqual(['mentions', 'list', '--limit', '9', '--agent', 'claude', '--session', 'session-1'])
    expect(list.init?.cwd).toBe(WORKSPACE)

    const drawn = await band($)
    const first = await drawn.find({ key: 'mention-1' })
    expect([first?.type, first?.props.hotkey, first?.text]).toEqual(['Button', '1', 'Chain oil'])
    // A mention that no longer resolves is shown, not pressable.
    expect(await drawn.find({ key: 'mention-2' })).toBeUndefined()
    expect((await drawn.find({ key: 'mention-3' }))?.text).toBe('Bike shed')
    expect(await drawn.find({ type: 'Raster' })).toBeUndefined()
    // The pane was never opened: the band is the choice.
    expect(session.opened).toEqual([])
  })

  test('band or pane: the person picks, the pane opens without the keys, and the choice is kept for the next session', async ($, on) => {
    const stored: Record<string, unknown> = {}
    const session = sessionIn(on, IN_HERDR, stored)
    await session.begin($)
    const drawn = await band($)
    await drawn.press({ key: 'mentions-move' })
    expect(session.opened).toEqual([PANE])
    // The band gives way to the pane: the engine's own is drawn there again.
    expect(await drawn.find({ key: 'mention-1' })).toBeUndefined()
    expect(await drawn.find({ key: 'engine' })).toBeDefined()
    await drawn.unmount()
    expect(session.kept()).toEqual({ placement: 'pane', previews: false, scope: 'conversation' })
    const shown = await pane($)
    expect((await shown.find({ key: 'mention-1' }))?.text).toBe('Chain oil')
    // The Outliner's find-detail found the admin Detail beside Claude: a press opens there.
    expect((await shown.find({ type: 'Text', text: /opens in the Outliner Detail beside you/ }))).toBeDefined()

    // Back to the band, from the pane's own button.
    await shown.press({ key: 'mentions-move' })
    expect(session.closed).toEqual([PANE])
    expect(session.kept().placement).toBe('band')
  })

  test('a session that starts with the pane chosen opens it (unasked: the engine seats it only where it is a sidebar)', async ($, on) => {
    const session = sessionIn(on, IN_HERDR, { 'mentions-view': { placement: 'pane', previews: true, scope: 'conversation' } })
    await session.begin($)
    expect(session.opened).toEqual([PANE])
    expect(await (await band($)).find({ key: 'engine' })).toBeDefined()
  })

  test('a pane opened unasked on a narrow terminal waits: said once, with how to have the band', async ($, on) => {
    const session = sessionIn(on, IN_HERDR, { 'mentions-view': { placement: 'pane', previews: false, scope: 'conversation' } }, 'cells', false)
    await session.begin($)
    expect(session.toasts).toEqual(['The Recent mentions pane waits: opened unasked under 144 columns (120 now). /mentions band shows them above the prompt instead.'])
  })

  test('an empty band leaves the slot: nothing mentioned yet draws the engine\'s own', async ($, on) => {
    const session = sessionIn(on, IN_HERDR, {}, 'cells', true, JSON.stringify({ entries: [] }))
    await session.begin($)
    expect(await (await band($)).find({ key: 'engine' })).toBeDefined()
  })

  test('/mentions picks by keys too: off hides both, pane opens it, a word it doesn\'t know is the usage', async ($, on) => {
    const session = sessionIn(on, IN_HERDR)
    await session.begin($)
    const off = await $.command.run({ command: 'mentions', args: 'off' } as any)
    expect(off.text).toContain('hidden')
    expect(await (await band($)).find({ key: 'engine' })).toBeDefined()
    await $.command.run({ command: 'mentions', args: 'pane' } as any)
    expect(session.opened).toEqual([PANE])
    expect((await $.command.run({ command: 'mentions', args: 'sideways' } as any)).text).toContain('Usage: /mentions')
  })

  test('previews toggle: each mention shows its block as the door draws it (ep0ch show --cells), at the width it has', async ($, on) => {
    const session = sessionIn(on, IN_HERDR)
    await session.begin($)
    const shown = await pane($, 'terminal', 60)
    expect(await shown.find({ type: 'Raster' })).toBeUndefined()
    await shown.press({ key: 'mentions-previews' })
    expect(session.kept().previews).toBe(true)
    // Drawn off the render, then redrawn when it lands.
    await session.clock.settle()
    const raster = await shown.find({ key: 'mention-preview-1' })
    expect(raster?.type).toBe('Raster')
    expect([raster?.props.columns, raster?.props.rows]).toEqual([56, 2])
    expect((await shown.find({ key: 'mention-preview-3' }))?.type).toBe('Raster')
    // The door's CLI drew it in the session's outline, from its folder; nothing else of the door's was reached.
    const drew = session.runs.filter(run => run.argv[0] === 'ep0ch' && run.argv[1] === 'show')
    expect(drew.map(run => run.argv)).toEqual([
      ['ep0ch', 'show', BLOCK, '--cells', '--width', '56', '--rows', '24'],
      ['ep0ch', 'show', OTHER, '--cells', '--width', '56', '--rows', '24'],
    ])
    expect(drew[0]!.init?.cwd).toBe(WORKSPACE)
    expect(drew[0]!.init?.env).toMatchObject({ EP0CH_WS: 'garden' })
    await shown.unmount()

    // Drawn once a session at a width: another drawing reads it, and runs nothing.
    const before = session.runs.length
    const again = await pane($, 'terminal', 60)
    await session.clock.settle()
    expect(session.runs.length).toBe(before)
    expect((await again.find({ key: 'mention-preview-1' }))?.type).toBe('Raster')

    // The band previews its newest two, as wide as the band: a new width is drawn after a pause, once.
    const inBand = await band($, 80)
    await session.clock.advance(300)
    expect((await inBand.find({ key: 'mention-preview-1' }))?.props.columns).toBe(77)
  })

  test('previews without a usable ep0ch: the block\'s text, as Markdown; the desktop draws the text too', async ($, on) => {
    const session = sessionIn(on, IN_HERDR, { 'mentions-view': { placement: 'pane', previews: true, scope: 'conversation' } }, 'missing')
    await session.begin($)
    const shown = await pane($)
    await session.clock.settle()
    const preview = await shown.find({ key: 'mention-preview-1' })
    expect([preview?.type, preview?.text]).toEqual(['Markdown', 'Chain oil\nThe wax one, not the spray.'])
    await shown.unmount()
    const desktop = await pane($, 'desktop')
    expect((await desktop.find({ key: 'mention-preview-1' }))?.type).toBe('Markdown')
  })

  describe('a press opens the block where the person is, through the one open (openNote)', () => {
    test('in a door tile: the door opens it from this tile, as the agent, and Herdr is not touched', async ($, on) => {
      const session = sessionIn(on, IN_DOOR)
      await session.begin($)
      session.runs.length = 0
      await (await band($)).press({ key: 'mention-1' })
      await session.clock.settle()
      const opened = session.runs.find(run => run.argv.includes('door-open'))!
      expect(opened.argv.slice(-8)).toEqual(['door-open', BLOCK, '--control', IN_DOOR.EP0CH_CONTROL, '--actor', 'claude-code', '--from', 'claude'])
      expect(session.runs.some(run => run.argv.includes('link') || run.argv[3] === 'open')).toBe(false)
      expect(session.toasts).toEqual([])
    })

    test('in Herdr: the admin Detail already beside Claude is reused (ensure-detail), without focus', async ($, on) => {
      const session = sessionIn(on, IN_HERDR)
      await session.begin($)
      session.runs.length = 0
      await (await pane($)).press({ key: 'mention-3' })
      await session.clock.settle()
      expect(herdrOpens(session.runs, 'ensure-detail').map(run => run.argv.slice(3))).toEqual([['--mode', 'ensure-detail', '--no-focus']])
      const link = session.runs.find(run => run.argv.includes('link'))!
      expect(link.argv.slice(3)).toEqual(['link', `pi-outliner://block/${OTHER}`, '--detail-client', 'admin-detail', '--no-focus'])
      // Nothing of the mod's own opens or focuses a pane; the door is not asked.
      expect(session.runs.filter(run => run.argv[0] === 'herdr' && run.argv[1] !== 'plugin')).toEqual([])
      expect(session.runs.some(run => run.argv.includes('focus') || run.argv.includes('door-open'))).toBe(false)
    })

    test('in Herdr with no Detail beside Claude: the heading says a new one, a press opens it unfocused, then the heading says it is beside you', async ($, on) => {
      const session = sessionIn(on, IN_HERDR, { 'mentions-view': { placement: 'pane', previews: false, scope: 'conversation' } }, 'cells', true, LISTED, null)
      await session.begin($)
      const shown = await pane($)
      expect((await shown.find({ type: 'Text', text: /opens in a new Outliner Detail beside you/ }))).toBeDefined()
      session.runs.length = 0
      await shown.press({ key: 'mention-1' })
      await session.clock.settle()
      expect(herdrOpens(session.runs, 'ensure-detail')[0]?.argv).toContain('--no-focus')
      expect(session.runs.find(run => run.argv.includes('link'))?.argv.slice(3)).toEqual(['link', `pi-outliner://block/${BLOCK}`, '--detail-client', 'opened-detail', '--no-focus'])
      expect(session.runs.some(run => run.argv.includes('focus'))).toBe(false)
      expect((await shown.find({ type: 'Text', text: /opens in the Outliner Detail beside you/ }))).toBeDefined()
    })

    test('neither: the command that reads it is copied, the toast leads with it, and the band keeps it', async ($, on) => {
      const session = sessionIn(on, NEITHER)
      const copied: string[] = []
      on('ui.copy', ($, e) => { copied.push(e.text); return { value: { isCopied: true } } })
      await session.begin($)
      const drawn = await band($)
      await drawn.press({ key: 'mention-1' })
      await session.clock.settle()
      const command = `ep0ch show ${BLOCK} --ws garden`
      expect(copied).toEqual([command])
      const said = `Copied \`${command}\`: it reads Chain oil in any terminal (this session is not in an ep0ch-door tile, nor in Herdr).`
      expect(session.toasts).toEqual([said])
      expect((await drawn.find({ type: 'Text', text: said }))).toBeDefined()
      await drawn.unmount()
      expect((await (await pane($)).find({ type: 'Text', text: /a press says how to open it/ }))).toBeDefined()
    })

    test('neither, and no clipboard: the whole message, with the exact command and the ((id)) to copy', async ($, on) => {
      const session = sessionIn(on, NEITHER)
      await session.begin($)
      await (await band($)).press({ key: 'mention-1' })
      await session.clock.settle()
      expect(session.toasts).toEqual([
        `Can't open Chain oil here: this session is not in an ep0ch-door tile, nor in Herdr. Read it with \`ep0ch show ${BLOCK} --ws garden\`, or copy ((${BLOCK})) to open it in the Outliner.`,
      ])
    })
  })

  test('after an answer is ingested, the list is read again', async ($, on) => {
    const session = sessionIn(on, IN_HERDR)
    await session.begin($)
    session.runs.length = 0
    await $.turn.complete({ reason: 'answer', answer: 'Filed [[chain-oil]].', durationMs: 5, isAborted: false, turnId: 't-1' })
    await session.clock.settle()
    const ran = session.runs.filter(run => run.argv[0] === '/bin/sh' && !run.argv.includes('bound-folder')).map(run => run.argv.slice(3, 5).join(' '))
    // Then the Outliner's find-detail, for the heading's "opens in".
    expect(ran).toEqual(['mentions ingest', 'mentions list', '--mode find-detail'])
  })

  test('the list as the CLI gives it: titles, revisions, and a mention that no longer resolves', () => {
    expect(mentionRowsOf(LISTED).map(row => [row.id, row.revision, row.title, row.unavailable ?? null])).toEqual([
      [BLOCK, 3, 'Chain oil', null],
      [null, null, 'old-padlock', 'No page old-padlock'],
      [OTHER, 1, 'Bike shed', null],
    ])
    expect(mentionRowsOf('nope')).toEqual([])
    // Every conversation's mentions: no --agent or --session.
    expect(mentionsListArgs('workspace', 'session-1')).toEqual(['mentions', 'list', '--limit', '9'])
    expect(prefsOf({ placement: 'sideways', previews: 'yes' })).toEqual({ placement: 'band', previews: false, scope: 'conversation' })
  })
})
