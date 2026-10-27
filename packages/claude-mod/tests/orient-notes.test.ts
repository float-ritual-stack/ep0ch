import type { On, ProcessRunResult } from 'claude-code'
import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { BOARD_QUERY } from '../hooks/workboard-now'
import { NOTE_CHARS, ORIENT_BLOCK, orientQuery, orientText } from '../hooks/orient-notes'

tier('user')

const result = (exitCode: number, stdout = '', stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

const FOLDER = '/home/someone/garden'
const HERDR_LISTING = JSON.stringify({ result: { plugins: [{ plugin_id: 'float.pi-outliner', enabled: true, plugin_root: '/opt/outliner' }] } })
const BOUND = JSON.stringify({ bound: true, folder: FOLDER, configPath: `${FOLDER}/.ep0ch`, outline: 'garden' })

/** `ep0ch where --json` outside a door, the folder's .ep0ch naming `agent` (or none). */
const whereJson = (agent: string | null) => JSON.stringify({
  inDoor: false,
  here: { machine: 'near-box', folder: FOLDER, persona: agent ? { name: agent, source: 'file', file: `${FOLDER}/.ep0ch` } : null },
  herdr: null, door: null, layers: [], keys: { mine: null, typing: null, tile: null, text: 'x' },
  summary: 'stack: (nothing recorded) · not in a door · keys: x',
})

type Note = { id: string; title: string; text: string; orient: string; updatedAt: string }

const SAM: Note = { id: 'n-sam', title: 'How we work in the garden', orient: 'sam', updatedAt: '2026-03-03T08:00:00Z',
  text: 'How we work in the garden [orient::sam]\n\n- **Water first:** the beds by the shed dry out by noon.\n- **Ask before pruning** the pear.' }
const ALL: Note = { id: 'n-all', title: 'Garden rules for everyone', orient: 'all', updatedAt: '2026-03-01T08:00:00Z',
  text: 'Garden rules for everyone [orient::all]\n\n- Close the gate behind you.' }

/**
 * The service's answer to the mod's query, as the real one would: the notes whose orient matches a clause of it. The
 * test reads the query the mod sent, so "alex gets nothing" is the service's answer to alex's query, never a filter here.
 */
function answer(query: string, notes: readonly Note[]): Note[] {
  const wanted = [...query.matchAll(/orient="([^"]*)"/g)].map(m => m[1])
  return notes.filter(n => wanted.includes(n.orient))
}

type Case = { agent: string | null; notes: Note[]; listMs?: number }

/** A session in FOLDER, bound to garden; `ep0ch where` names the case's agent, `list` answers from its notes. */
function sessionIn(on: On, c: Case) {
  const queries: string[] = []
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
    if (argv[0] === 'ep0ch' && argv[1] === 'where') return { value: result(0, whereJson(c.agent)) }
    if (argv[0] === 'ep0ch') throw Error('ENOENT: ep0ch')
    if (argv[0] === 'gh') return { value: result(1, '', 'gh: not a git repository') }
    if (argv.includes('bound-folder')) return { value: result(0, BOUND) }
    if (argv.includes('work-id-status')) return { value: result(0, '{"prefix":"GAR"}') }
    if (argv.includes('mentions')) return { value: result(0, '{"entries":[]}') }
    if (argv.includes('list')) {
      const query = argv[argv.indexOf('--query') + 1]!
      if (query === BOARD_QUERY || !query.includes('orient')) return { value: result(0, '{"blocks":[],"completeness":{"kind":"complete"}}') }
      queries.push(query)
      if (c.listMs) await clock.sleep(c.listMs)
      const blocks = answer(query, c.notes).map(n => ({ id: n.id, title: n.title, text: n.text, properties: [{ key: 'orient', value: n.orient }], updatedAt: n.updatedAt }))
      return { value: result(0, JSON.stringify({ blocks, completeness: { kind: 'complete' } })) }
    }
    return { value: result(1, '', 'unexpected') }
  })
  return { queries, invalidated, clock }
}

const START = { surface: 'terminal', isInteractive: true, cwd: FOLDER } as const
type Block = { name: string; text: string }
const blocksOf = async ($: any) => (await $.prompt.context({ blocks: [] })).blocks as Block[]
const orientOf = async ($: any) => (await blocksOf($)).find(b => b.name === ORIENT_BLOCK)?.text

describe('orientation notes, in the first prompt (PIE-1353)', () => {
  test("agent sam gets its note and everyone's, newest first, in the first prompt and again after a compaction", async ($, on) => {
    const c: Case = { agent: 'sam', notes: [ALL, SAM] }
    const s = sessionIn(on, c)
    await $.session.start(START)
    await s.clock.settle()
    const text = (await orientOf($))!
    expect(s.queries).toContain('orient="sam" OR orient="all"')
    expect(text).toContain('[orient::sam] or [orient::all]')
    expect(text).toContain('## How we work in the garden ((n-sam))')
    expect(text).toContain('- **Ask before pruning** the pear.')
    // The heading names the note; its own title line isn't given twice.
    expect(text).not.toContain('How we work in the garden [orient::sam]')
    expect(text.indexOf('n-sam')).toBeLessThan(text.indexOf('n-all'))
    // The note changes; the compaction reads it anew, and the remade context carries the new text.
    c.notes = [ALL, { ...SAM, text: `${SAM.text}\n- **New:** the hose moved to the north bed.`, updatedAt: '2026-03-04T08:00:00Z' }]
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'plant the beans', toolUses: [] }] })
    await s.clock.settle()
    expect(await orientOf($)).toContain('the hose moved to the north bed')
  })

  test('agent alex is asked for its own notes and gets nothing of sam\'s', async ($, on) => {
    const s = sessionIn(on, { agent: 'alex', notes: [SAM] })
    await $.session.start(START)
    await s.clock.settle()
    expect(await orientOf($)).toBeUndefined()
    expect(s.queries).toContain('orient="alex" OR orient="all"')
  })

  test('a session naming no agent reads only the notes for everyone', async ($, on) => {
    const s = sessionIn(on, { agent: null, notes: [SAM, ALL] })
    await $.session.start(START)
    await s.clock.settle()
    const text = (await orientOf($))!
    expect(s.queries).toContain('orient="all"')
    expect(text).toContain('Close the gate')
    expect(text).not.toContain('pruning')
  })

  test('the binding says which note the session orients from', async ($, on) => {
    const s = sessionIn(on, { agent: 'sam', notes: [ALL, SAM] })
    await $.session.start(START)
    await s.clock.settle()
    const binding = (await blocksOf($)).find(b => b.name === 'outlineBinding')!.text
    expect(binding).toContain('- orients: from How we work in the garden ((n-sam)) and 1 more')
  })

  test('a slow host never holds the first prompt: it goes without, and is made again when the read lands', async ($, on) => {
    const s = sessionIn(on, { agent: 'sam', notes: [SAM], listMs: 3000 })
    await $.session.start(START)
    await s.clock.settle()
    const context = $.prompt.context({ blocks: [] })
    await s.clock.advance(1500)
    expect(((await context).blocks as Block[]).find(b => b.name === ORIENT_BLOCK)).toBeUndefined()
    await s.clock.advance(2000)
    expect(s.invalidated).toContain('prompt.context')
    expect(await orientOf($)).toContain('Water first')
  })
})

describe('orientation text', () => {
  test('a long note is cut at a line with the command that reads the rest', () => {
    const long = ['Field guide [orient::all]', ...Array.from({ length: 400 }, (_, i) => `- row ${i} of the field guide`)].join('\n')
    const text = orientText({ outline: 'garden', machine: 'shed', notes: [{ id: 'n-long', title: 'Field guide', text: long, properties: [] }] })!
    expect(text.length).toBeLessThan(NOTE_CHARS + 600)
    expect(text).toContain('- row 0 of the field guide')
    expect(text).not.toContain('- row 399')
    expect(text).toMatch(/of the field guide\n… read the rest: ep0ch show --ws garden --machine shed n-long$/)
  })

  test('one long paragraph is cut at a space; a read the service cut short says so', () => {
    const text = orientText({ outline: 'garden', complete: false, notes: [{ id: 'n-p', title: 'Prose', text: `Prose [orient::all]\n${'water the beds '.repeat(400)}`, properties: [] }] })!
    expect(text).toMatch(/ (?:water|the|beds)\n… read the rest: ep0ch show --ws garden n-p\n/)
    expect(text).toContain("more notes carry orient than were read: ep0ch find --ws garden --query 'orient'")
  })

  test('no notes, no block; an agent name is quoted in the query', () => {
    expect(orientText({ outline: 'garden', notes: [] })).toBeNull()
    expect(orientQuery('cow.boy')).toBe('orient="cow.boy" OR orient="all"')
  })
})
