import type { On, ProcessRunResult } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { type BindingFacts, cardLines, mismatchOf, statusLine, type WhereFacts, whereFactsOf } from '../hooks/binding'

tier('user')

const result = (exitCode: number, stdout = '', stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

const HOME = '/home/someone'
const FOLDER = `${HOME}/garden`
const HERDR_LISTING = JSON.stringify({ result: { plugins: [{ plugin_id: 'float.pi-outliner', enabled: true, plugin_root: '/opt/outliner' }] } })
const HELP = 'ep0ch: a BBS door\n\n  ep0ch where [--json]             where this runs\n  ep0ch help'

/** `bound-folder`'s answer: FOLDER's .ep0ch names `outline` (on `machine`), or nothing names one. */
const boundTo = (outline: string | null, machine?: string) => (folder: string) => outline
  ? JSON.stringify({ bound: true, folder: FOLDER, configPath: `${FOLDER}/.ep0ch`, outline, ...(machine ? { machine } : {}) })
  : JSON.stringify({ bound: false, folder })

/** What `ep0ch where --json` says: this machine and folder, and the door around Claude, if any. */
function whereJson(door: null | { outline: string; machine?: string; host: string; drawer?: boolean; tile?: string }, herdr: null | { pane: string; label?: string; agent?: boolean } = null): string {
  return JSON.stringify({
    inDoor: !!door,
    here: { machine: 'near-box', folder: FOLDER },
    herdr: herdr ? { pane: herdr.pane, label: herdr.label ?? null, agent: !!herdr.agent } : null,
    door: door ? {
      pid: 4242, control: '/run/door.sock', answers: true, screen: 'Daily', outline: door.outline, workspace: '/outlines/x',
      host: door.host, machine: door.machine ?? null, moved: false,
      tile: door.drawer ? { id: 'drawer.agent', name: 'claude', found: true, shown: true, focused: false, descends: true, drawer: true } : { id: 't1', name: door.tile ?? 'claude', found: true, shown: true, focused: true, descends: true },
    } : null,
    layers: [], keys: { mine: null, typing: null, tile: null, text: 'x' },
    summary: door ? 'stack: door:4242/daily/t1:claude · keys: x' : 'stack: (nothing recorded) · not in a door · keys: x',
  })
}

type Case = { env?: Record<string, string>; bound: (folder: string) => string; where: string | null; mentions?: string; whereMs?: number }

/** A session in FOLDER: the Outliner answers `bound-folder` from the case, `ep0ch where --json` from the case (null: no ep0ch). */
function sessionIn(on: On, c: Case) {
  const statuses: (string | undefined)[] = []
  const runs: (readonly string[])[] = []
  const invalidated: string[] = []
  const clock = mock.clock(on)
  mock.env(on, { HOME, PI_OUTLINER_MENTIONS_WORKSPACES: '', ...c.env })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'session-1' }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.cwd', () => ({ value: FOLDER }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__pi-outliner__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))
  on('ui.status', ($, e) => { statuses.push(e.text); return { value: undefined } })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.invalidate', ($, e) => { invalidated.push(e.event); return { value: undefined } })
  on('process.run', async ($, e) => {
    runs.push(e.argv)
    if (c.whereMs && e.argv[1] === 'where') await clock.sleep(c.whereMs)
    const argv = e.argv
    if (argv[0] === 'herdr') return { value: result(0, HERDR_LISTING) }
    if (argv[0] === 'ep0ch') {
      if (c.where === null) throw Error('ENOENT: ep0ch')
      return { value: argv[1] === 'help' ? result(0, HELP) : result(0, c.where) }
    }
    if (argv.includes('bound-folder')) return { value: result(0, c.bound(argv.at(-1)!)) }
    if (argv.includes('work-id-status')) return { value: result(0, '{"prefix":"GAR"}') }
    if (argv.includes('mentions')) return { value: result(0, c.mentions ?? '{"entries":[]}') }
    return { value: result(1, '', 'unexpected') }
  })
  return { statuses, runs, clock, invalidated }
}

const START = { surface: 'terminal', isInteractive: true, cwd: FOLDER } as const

const band = ($: any, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'pi-outliner', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { top: 0, bodyRows: 20, rows: 0 }, view: {} } })

/** The card's words, row by row, as the band draws them. */
async function cardText(drawn: any): Promise<string> {
  const card = await drawn.find({ key: 'binding-card' })
  return card ? JSON.stringify(card) : ''
}

const LOCAL: Case = { bound: boundTo('garden'), where: whereJson(null) }
const DOOR: Case = { env: { EP0CH_CONTROL: '/run/door.sock', EP0CH_NEST: 'door:4242/daily/t1:claude' }, bound: boundTo('garden'), where: whereJson({ outline: 'garden', host: 'near-box' }) }
const REMOTE: Case = {
  env: { EP0CH_CONTROL: '/run/door.sock', EP0CH_NEST: 'door:4242/drawer/drawer.agent:claude › herdr:door-claude' },
  bound: boundTo('harbor', 'far'),
  where: whereJson({ outline: 'harbor', machine: 'far', host: 'far-box', drawer: true }, { pane: 'door-claude', label: 'door-claude', agent: true }),
}
const MISMATCH: Case = {
  env: { EP0CH_CONTROL: '/run/door.sock', EP0CH_NEST: 'door:4242/drawer/drawer.agent:claude › herdr:door-claude' },
  bound: boundTo('garden'),
  where: whereJson({ outline: 'harbor', machine: 'far', host: 'far-box', drawer: true }, { pane: 'door-claude', label: 'door-claude', agent: true }),
}
const UNBOUND: Case = { bound: boundTo(null), where: whereJson(null, { pane: 'w1:p3' }) }
const UNBOUND_IN_DOOR: Case = { ...MISMATCH, bound: boundTo(null) }

describe('where this Claude is bound: the card, the status line, the context', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: a folder whose .ep0ch names an outline on this machine`, async ($, on) => {
      const s = sessionIn(on, LOCAL)
      await $.session.start({ ...START, surface })
      await s.clock.settle()
      const text = await cardText(await band($, surface))
      expect(text).toContain('garden, on this machine (near-box)')
      expect(text).toContain('~/garden/.ep0ch names it')
      expect(text).toContain('runs on near-box in ~/garden')
      expect(text).toContain('not in a door')
      expect(text).not.toContain('⚠')
      expect(s.statuses.at(-1)).toBe('outline: garden @ near-box · folder')
      const { blocks } = await $.prompt.context({ blocks: [] })
      const block = blocks.find(b => b.name === 'outlineBinding')!.text
      expect(block).toContain('- outline: garden, on this machine (near-box)')
      expect(block).toContain('- why: ~/garden/.ep0ch names it')
    })

    test(`${surface}: in a door tile on the same outline`, async ($, on) => {
      const s = sessionIn(on, DOOR)
      await $.session.start({ ...START, surface })
      await s.clock.settle()
      const text = await cardText(await band($, surface))
      expect(text).toContain("~/garden/.ep0ch names it, and the door you're in is on it too")
      expect(text).toContain('in the \\"claude\\" tile of the garden door')
      expect(s.statuses.at(-1)).toBe('outline: garden @ near-box · folder, door')
    })

    test(`${surface}: in the drawer of a door whose outline is on another machine`, async ($, on) => {
      const s = sessionIn(on, REMOTE)
      await $.session.start({ ...START, surface })
      await s.clock.settle()
      const text = await cardText(await band($, surface))
      expect(text).toContain('harbor, on far (another machine)')
      expect(text).toContain('in the drawer of the harbor door · its own Herdr pane door-claude')
      expect(text).toContain("the harbor door's outline is on far (far-box)")
      expect(s.statuses.at(-1)).toBe('outline: harbor @ far · folder, door')
    })

    test(`${surface}: the folder names one outline and the door is on another: a yellow line`, async ($, on) => {
      const s = sessionIn(on, MISMATCH)
      await $.session.start({ ...START, surface })
      await s.clock.settle()
      const drawn = await band($, surface)
      const warn = await drawn.find({ type: 'Text', text: /^⚠ this folder names garden; you're in harbor's door/ })
      expect(warn?.props.color).toBe('yellow')
      expect(s.statuses.at(-1)).toBe('outline: garden @ near-box · folder · ⚠ door is harbor @ far')
      const block = (await $.prompt.context({ blocks: [] })).blocks.find(b => b.name === 'outlineBinding')!.text
      expect(block).toContain("careful: this folder names garden; you're in harbor's door. The outline tools write to garden; the door tools act in harbor's door.")
    })

    test(`${surface}: nothing names an outline: the tools are off, and the exact command that binds the folder`, async ($, on) => {
      const s = sessionIn(on, UNBOUND)
      await $.session.start({ ...START, surface })
      await s.clock.settle()
      const text = await cardText(await band($, surface))
      expect(text).toContain('none: the outline, workboard and mention tools are off')
      expect(text).toContain('nothing names one in ~/garden or above it (no .ep0ch)')
      expect(text).toContain('ep0ch init <name>')
      expect(text).toContain('not in a door · in a Herdr pane')
      expect(text).not.toContain('w1:p3')
      expect(s.statuses.at(-1)).toBe('outline: none (tools off) · ep0ch init <name>')
    })
  }

  test('unbound, in a door: the command names the door\'s outline and its machine', async ($, on) => {
    const s = sessionIn(on, UNBOUND_IN_DOOR)
    await $.session.start(START)
    await s.clock.settle()
    const text = await cardText(await band($))
    expect(text).toContain('the door tools still act in the harbor door')
    expect(text).toContain('ep0ch init harbor --machine far')
    expect(s.statuses.at(-1)).toBe('outline: none (tools off) · door harbor @ far · ep0ch init harbor --machine far')
  })

  test('no ep0ch: the folder\'s outline still shows, and the door is said to be unchecked', async ($, on) => {
    const s = sessionIn(on, { ...LOCAL, where: null })
    await $.session.start(START)
    await s.clock.settle()
    const text = await cardText(await band($))
    expect(text).toContain('garden, on this machine')
    expect(text).toContain('runs on this machine in ~/garden')
    expect(text).toContain('not checked: no `ep0ch` on PATH, or `ep0ch where` did not answer in time')
  })

  test('the card shows while finding, hides on h, comes back after /clear and with /outline; the status line stays', async ($, on) => {
    const s = sessionIn(on, LOCAL)
    await $.session.start(START)
    expect(s.statuses[0]).toBe('outline: finding…')
    await s.clock.settle()
    const drawn = await band($)
    expect((await drawn.find({ key: 'binding-hide' }))?.props.hotkey).toBe('h')
    await drawn.press({ key: 'binding-hide' })
    await s.clock.settle()
    expect(await (await band($)).find({ key: 'binding-card' })).toBeUndefined()
    expect(await (await band($)).find({ key: 'engine' })).toBeDefined()
    await $.session.end({ reason: 'clear' } as any)
    await s.clock.settle()
    expect(await (await band($)).find({ key: 'binding-card' })).toBeDefined()
    await (await band($)).press({ key: 'binding-hide' })
    await s.clock.settle()
    const answer = await $.command.run({ command: 'outline', args: '' } as any)
    expect(answer.text).toContain('outline: garden, on this machine (near-box)')
    await s.clock.settle()
    expect(await (await band($)).find({ key: 'binding-card' })).toBeDefined()
    expect(s.statuses.at(-1)).toBe('outline: garden @ near-box · folder')
  })

  test('the binding is read again on a later turn, so the status line follows a door that changed outline', async ($, on) => {
    const c: Case = { ...DOOR }
    const s = sessionIn(on, c)
    await $.session.start(START)
    await s.clock.settle()
    expect(s.statuses.at(-1)).toBe('outline: garden @ near-box · folder, door')
    c.where = whereJson({ outline: 'harbor', machine: 'far', host: 'far-box' })
    await s.clock.advance(31_000)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 'turn-1' })
    await s.clock.settle()
    expect(s.statuses.at(-1)).toBe('outline: garden @ near-box · folder · ⚠ door is harbor @ far')
    expect(s.runs.filter(r => r[0] === 'ep0ch' && r[1] === 'where').length).toBe(2)
    expect(s.runs.some(r => r[0] === 'ep0ch' && r[1] === 'help')).toBe(false)
  })
})

describe('where this Claude is bound: more cases', () => {
  test('beside Recent mentions the card says the binding alone, and the mentions keep their keys', async ($, on) => {
    const mentions = JSON.stringify({ entries: [{ address: '((x))', title: 'Bike shed', block: { id: '11111111-2222-4333-8444-555555555555', revision: 1, text: 'Bike shed' }, mentionedAt: '2026-10-03T00:00:00Z', excerpt: '' }] })
    const s = sessionIn(on, { ...MISMATCH, mentions })
    await $.session.start(START)
    await s.clock.settle()
    const drawn = await band($)
    const text = await cardText(drawn)
    expect(text).toContain('garden, on this machine (near-box)')
    expect(text).toContain("this folder names garden; you're in harbor's door")
    expect(text).not.toContain('runs on')
    expect((await drawn.find({ key: 'mention-1' }))?.props.hotkey).toBe('1')
    expect((await drawn.find({ key: 'mentions-hide' }))?.props.hotkey).toBe('x')
  })

  test('a folder opted out in the mod\'s folder list: said so, from the lookup the tools made', async ($, on) => {
    const s = sessionIn(on, { ...LOCAL, env: { PI_OUTLINER_MENTIONS_WORKSPACES: FOLDER, PI_OUTLINER_MENTIONS_MODE: 'folder' } })
    await $.session.start(START)
    await s.clock.settle()
    expect(await cardText(await band($))).toContain("~/garden is opted out in the mod's folder list")
    expect(s.statuses.at(-1)).toBe('outline: none (opted out)')
  })

  test('a lookup that fails (EP0CH_SOCKET in Claude\'s environment) says why, and the tools are off', async ($, on) => {
    const s = sessionIn(on, { ...LOCAL, env: { EP0CH_SOCKET: '/elsewhere/host.sock' } })
    await $.session.start(START)
    await s.clock.settle()
    const text = await cardText(await band($))
    expect(text).toContain('not known: the outline tools are off')
    expect(text).toContain("EP0CH_SOCKET in Claude's environment")
    expect(s.statuses.at(-1)).toMatch(/^outline: not known · EP0CH_SOCKET/)
  })

  test('a door that reached its host outright (EP0CH_SOCKET) on another machine is not taken for this one', async ($, on) => {
    const s = sessionIn(on, { ...DOOR, where: whereJson({ outline: 'garden', host: 'far-box' }) })
    await $.session.start(START)
    await s.clock.settle()
    expect(s.statuses.at(-1)).toBe('outline: garden @ near-box · folder · ⚠ door is garden @ far-box')
    expect(await cardText(await band($))).toContain("this folder names garden on near-box; the door you're in shows garden on far-box")
  })

  test('the first prompt asked before the binding landed is made again when it does', async ($, on) => {
    const s = sessionIn(on, { ...LOCAL, whereMs: 4000 })
    await $.session.start(START)
    await s.clock.settle()
    const context = $.prompt.context({ blocks: [] })
    await s.clock.advance(1500)
    expect((await context).blocks.find(b => b.name === 'outlineBinding')!.text).toContain('still being looked up')
    expect(s.invalidated).not.toContain('prompt.context')
    await s.clock.advance(3000)
    expect(s.invalidated).toContain('prompt.context')
    expect((await $.prompt.context({ blocks: [] })).blocks.find(b => b.name === 'outlineBinding')!.text).toContain('- outline: garden')
  })
})

describe('binding helpers', () => {
  const where = whereFactsOf(whereJson({ outline: 'harbor', machine: 'far', host: 'far-box', drawer: true }, { pane: 'door-claude', label: 'door-claude', agent: true }))!
  const facts = (folder: BindingFacts['folder'], w: WhereFacts | null = where): BindingFacts => ({ folder, where: w, cwd: FOLDER, home: HOME, doorTools: true })

  test('where --json is read for its facts; anything else is not one', () => {
    expect(where).toEqual({
      inDoor: true, here: { machine: 'near-box', folder: FOLDER }, herdr: { pane: 'door-claude', label: 'door-claude', agent: true },
      door: { answers: true, outline: 'harbor', machine: 'far', host: 'far-box', drawer: true, tile: 'claude' },
    })
    expect(whereFactsOf('usage: ep0ch …')).toBeNull()
    expect(whereFactsOf('{"summary":"x"}')).toBeNull()
  })

  test('the same name on two machines is a mismatch too, said with the machines', () => {
    expect(mismatchOf(facts({ kind: 'bound', workspace: { root: FOLDER, outline: 'harbor', pinned: true } })))
      .toBe("this folder names harbor on near-box; the door you're in shows harbor on far. The outline tools write to harbor on near-box; the door tools act in that door.")
    expect(mismatchOf(facts({ kind: 'bound', workspace: { root: FOLDER, outline: 'harbor', machine: 'far', pinned: true } }))).toBeNull()
  })

  test('plain words: no tile ids, pids or sockets on the card', () => {
    const text = cardLines(facts({ kind: 'bound', workspace: { root: FOLDER, outline: 'garden', pinned: true } })).map(l => l.text).join('\n')
    expect(text).not.toMatch(/drawer\.agent|\bt1\b|4242|\.sock|pid/)
  })

  test('opted out, and a lookup that failed, say why', () => {
    expect(cardLines(facts({ kind: 'opted-out', root: FOLDER }))[1]!.text).toBe("~/garden is opted out in the mod's folder list")
    expect(statusLine(facts({ kind: 'failed', why: 'Herdr could not discover the Outliner installation' }))).toBe('outline: not known · Herdr could not discover the Outliner installation')
    expect(statusLine(null)).toBe('outline: finding…')
  })
})
