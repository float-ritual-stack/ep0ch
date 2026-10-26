import { describe, expect, test, tier } from 'claude-code/testing'
import { baselineOf, facetArgs, facetCountsOf, logLine, mergedCounts, outlinesOf, SETTLE_DEFAULTS, settleDiff, settlesFor, newestWith, settleAsks, settleNoteArgs, settleNotesOf, threadsOf, told, tuningOf, wakeLine, wakeText, type SettleStore } from '../hooks/settle'

tier('user')

// The settle check's rules: which threads are warming, settled or shaped, what a check tells and what it keeps.

const MIN = 60_000
const NOW = Date.parse('2026-10-25T12:00:00Z')
const counts = (rows: Record<string, [number, number]>) => new Map(Object.entries(rows).map(([k, [count, ago]]) => [k, { count, last: NOW - ago * MIN }]))
const states = (all: Record<string, [number, number]>, evan: Record<string, [number, number]> = {}, shaped: Record<string, [number, number]> = {}) =>
  Object.fromEntries(threadsOf(counts(all), counts(evan), counts(shaped), NOW, SETTLE_DEFAULTS).map(t => [t.thread, t.state]))

describe('the states', () => {
  test('warming within the quiet window; settled with 3 notes, one of them the person\'s, quiet for it; shaped with tickets', () => {
    expect(states(
      { warm: [9, 59], settled: [3, 61], few: [2, 600], nobody: [9, 600], ticketed: [9, 600] },
      { warm: [2, 59], settled: [1, 61], few: [1, 600], ticketed: [1, 600] },
      { ticketed: [1, 100] },
    )).toEqual({ warm: 'warming', settled: 'settled', few: 'quiet', nobody: 'quiet', ticketed: 'shaped' })
  })
  test('a thread quiet for longer than `within` is dormant, not settling; a thread only tickets name is still shaped', () => {
    expect(states({ old: [5, 8 * 24 * 60] }, { old: [1, 8 * 24 * 60] })).toEqual({ old: 'quiet' })
    expect(states({}, {}, { shapedOnly: [1, 5] })).toEqual({ shapedOnly: 'shaped' })
  })
})

describe('what a check tells and keeps', () => {
  const check = (store: SettleStore, all: Record<string, [number, number]>, shaped: Record<string, [number, number]> = {}) =>
    settleDiff(store, threadsOf(counts(all), counts(Object.fromEntries(Object.entries(all).map(([k, [, ago]]) => [k, [1, ago]]))), counts(shaped), NOW, SETTLE_DEFAULTS))

  test('a newly settled thread wakes once; the check does not mark it told, `told` does', () => {
    const first = check({}, { a: [4, 90] })
    expect(first.wake.map(t => t.thread)).toEqual(['a'])
    expect(check(first.next, { a: [4, 90] }).wake).toHaveLength(1)
    const marked = told(first.next, first.wake)
    expect(check(marked, { a: [4, 90] }).wake).toEqual([])
  })
  test('a thread that warms and goes quiet again wakes again: its newest touch moved on', () => {
    let store = told(check({}, { a: [4, 90] }).next, check({}, { a: [4, 90] }).wake)
    store = check(store, { a: [5, 5] }).next
    expect(check(store, { a: [5, 70] }).wake.map(t => t.thread)).toEqual(['a'])
  })
  test('build-log changes are those into or out of settled or shaped; a thread first seen shaped, or merely warming, is none', () => {
    expect(check({}, { a: [4, 90], b: [9, 5], c: [1, 600] }, { z: [1, 5] }).changes.map(c => `${c.thread.thread}:${c.from}>${c.thread.state}`)).toEqual(['a:null>settled'])
    const store = check({}, { a: [4, 90], b: [9, 5] }).next
    expect(check(store, { a: [5, 2], b: [9, 90] }, { a: [1, 2] }).changes.map(c => `${c.thread.thread}:${c.from}>${c.thread.state}`)).toEqual(['a:settled>shaped', 'b:warming>settled'])
  })
})

describe('one thread across outlines', () => {
  test('counts add and the newest touch wins, so a conversation in one outline and its tickets in another are one thread', () => {
    const merged = mergedCounts([counts({ a: [2, 300], b: [1, 20] }), counts({ a: [3, 120] })])
    expect(merged.get('a')).toEqual({ count: 5, last: NOW - 120 * MIN })
    const all = mergedCounts([counts({ a: [2, 300] }), counts({ a: [3, 120] })])
    const evan = mergedCounts([counts({ a: [1, 300] }), counts({})])
    expect(threadsOf(all, evan, counts({ a: [1, 5] }), NOW, SETTLE_DEFAULTS)[0]).toMatchObject({ thread: 'a', chirps: 5, evan: 1, shaped: true, state: 'shaped' })
    expect(threadsOf(all, evan, counts({}), NOW, SETTLE_DEFAULTS)[0]).toMatchObject({ chirps: 5, state: 'settled' })
  })
})

describe('what shapes a thread', () => {
  test('tickets, a capability note or a hub note carrying its thread (PIE-1311)', () => {
    const argv = settleAsks(SETTLE_DEFAULTS).shaped
    expect(argv[argv.indexOf('--query') + 1]).toBe('(type=roadmap-item OR type=capability OR type=hub OR type=thread) AND thread')
  })
})

describe('the first check', () => {
  test('records what is settled as told, so only a thread that settles later wakes', () => {
    const threads = threadsOf(counts({ a: [4, 200], b: [5, 300], c: [9, 5] }), counts({ a: [1, 200], b: [1, 300], c: [1, 5] }), counts({}), NOW, SETTLE_DEFAULTS)
    const baseline = baselineOf(settleDiff({}, threads).next, threads)
    expect(baseline.line).toBe('Settle check baseline: 2 settled threads at the first run, recorded, not announced (0 shaped, 1 warming)')
    expect(settleDiff(baseline.store, threads).wake).toEqual([])
  })
})

describe('the words', () => {
  const [t] = threadsOf(counts({ backlog: [5, 74] }), counts({ backlog: [2, 74] }), counts({}), NOW, SETTLE_DEFAULTS)
  test('a wake line gives the counts and says how to shape it: a note that carries its thread', () => {
    expect(wakeLine(t!, NOW)).toBe('thread backlog settled: 5 chirps, 2 Evan\'s, quiet 74 min, nothing shapes it yet (write [thread::backlog] on its capability note, its hub or its tickets)')
  })
  test('the wake counts the threads it names and the ones it leaves for the next check', () => {
    expect(wakeText(['a', 'b'], 3)).toContain('5 threads have gone quiet')
    expect(wakeText(['a'], 0)).toContain('1 thread has gone quiet')
  })
  test('a build-log line says the change and the counts', () => {
    expect(logLine({ thread: t!, from: 'warming' }, NOW)).toBe('Thread backlog: warming → settled · 5 chirps, 2 Evan\'s, quiet 74 min')
  })
})

describe('the settings', () => {
  test('tuning is key=value pairs, and a mistake names the form', () => {
    expect(tuningOf('chirps=5; quiet=30; wake-max=2').config).toMatchObject({ chirps: 5, quiet: 30, wakeMax: 2, every: 30 })
    expect(tuningOf('evan-query=actor=evan').config.evanQuery).toBe('actor=evan')
    const bad = tuningOf('chirps=lots; nope=1')
    expect(bad.problems.join('\n')).toContain('chirps wants a positive whole number')
    expect(bad.problems.join('\n')).toContain('unknown key "nope"')
    expect(bad.problems.at(-1)).toContain('write it like: chirps=3')
  })
  test('outlines are name[@machine]; with none named they are pie and gurgle on the bound outline\'s machine', () => {
    expect(outlinesOf('gurgle@float-2, pie', null).outlines).toEqual([{ outline: 'gurgle', machine: 'float-2' }, { outline: 'pie' }])
    expect(outlinesOf('', { outline: 'garden', machine: 'float-2' }).outlines).toEqual([{ outline: 'pie', machine: 'float-2' }, { outline: 'gurgle', machine: 'float-2' }])
    expect(outlinesOf('', { outline: 'garden' }).outlines).toEqual([{ outline: 'pie' }, { outline: 'gurgle' }])
    expect(tuningOf('base=thread AND NOT type=quote AND NOT thread=pie-requests; quiet=90').config.base).toBe('thread AND NOT type=quote AND NOT thread=pie-requests')
    expect(outlinesOf('Not A Name', null).problems.at(-1)).toContain('write it like: gurgle@float-2')
  })
  test('the deployer\'s persona runs it unless on or off says otherwise', () => {
    expect(settlesFor(undefined, 'loki')).toBe(true)
    expect(settlesFor('', 'daddy')).toBe(false)
    expect(settlesFor('on', undefined)).toBe(true)
    expect(settlesFor('off', 'loki')).toBe(false)
  })
})

describe('the service\'s answer', () => {
  test('list --facets thread is read as counts and last update; a key nobody carries is empty, a non-answer is null', () => {
    const answer = JSON.stringify({ blocks: [], facets: [{ key: 'thread', count: 5, values: [{ value: 'a', count: 5, last: '2026-10-25T11:00:00.000Z' }] }] })
    expect(facetCountsOf(answer)!.get('a')).toEqual({ count: 5, last: Date.parse('2026-10-25T11:00:00.000Z') })
    expect(facetCountsOf('{"blocks":[],"facets":[]}')!.size).toBe(0)
    expect(facetCountsOf('{"blocks":[]}')).toBeNull()
    expect(facetCountsOf('not json')).toBeNull()
  })
  test('the question asks for one row and every value', () => {
    expect(facetArgs('thread')).toEqual(['list', '--query', 'thread', '--fields', 'id', '--limit', '1', '--facets', 'thread', '--facet-values', '1000'])
  })
})

describe('the settings on the capability note', () => {
  const row = (id: string, props: Record<string, string>, updatedAt: string) => ({ id, title: 'Settle', properties: Object.entries(props).map(([key, value]) => ({ key, value })), updatedAt })
  test('asks for capability notes carrying either setting, with their update times', () => {
    const argv = settleNoteArgs()
    expect(argv[argv.indexOf('--query') + 1]).toBe('type=capability AND (settle-tuning OR settle-outlines)')
    expect(argv[argv.indexOf('--fields') + 1]).toContain('timestamps')
  })
  test('the newest edited note carrying a setting wins, each setting on its own; an empty property is no setting', () => {
    const notes = settleNotesOf(JSON.stringify({ blocks: [
      row('a', { 'settle-tuning': 'chirps=9', 'settle-outlines': 'pie' }, '2026-10-24T10:00:00Z'),
      row('b', { 'settle-tuning': 'chirps=2' }, '2026-10-25T10:00:00Z'),
      row('c', { 'settle-tuning': '  ' }, '2026-10-26T10:00:00Z'),
      row('d', {}, '2026-10-27T10:00:00Z'),
    ] }))
    expect(notes?.map(n => n.id)).toEqual(['a', 'b'])
    expect(newestWith(notes!, 'tuning')?.tuning).toBe('chirps=2')
    // The newer note has no outlines: the older one's still counts.
    expect(newestWith(notes!, 'outlines')?.outlines).toBe('pie')
    expect(newestWith([], 'tuning')).toBeNull()
    expect(settleNotesOf('not json')).toBeNull()
  })
})
