import { describe, expect, test, tier } from 'claude-code/testing'
import { facetArgs, facetCountsOf, logLine, outlinesOf, SETTLE_DEFAULTS, settleDiff, settlesFor, threadsOf, told, tuningOf, wakeLine, wakeText, type SettleStore } from '../hooks/settle'

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
  const outline = { outline: 'gurgle', machine: 'float-2' }
  const check = (store: SettleStore, all: Record<string, [number, number]>, shaped: Record<string, [number, number]> = {}) =>
    settleDiff(store, outline, threadsOf(counts(all), counts(Object.fromEntries(Object.entries(all).map(([k, [, ago]]) => [k, [1, ago]]))), counts(shaped), NOW, SETTLE_DEFAULTS))

  test('a newly settled thread wakes once; the check does not mark it told, `told` does', () => {
    const first = check({}, { a: [4, 90] })
    expect(first.wake.map(t => t.thread)).toEqual(['a'])
    expect(check(first.next, { a: [4, 90] }).wake).toHaveLength(1)
    const marked = told(first.next, outline, first.wake)
    expect(check(marked, { a: [4, 90] }).wake).toEqual([])
  })
  test('a thread that warms and goes quiet again wakes again: its newest touch moved on', () => {
    let store = told(check({}, { a: [4, 90] }).next, outline, check({}, { a: [4, 90] }).wake)
    store = check(store, { a: [5, 5] }).next
    expect(check(store, { a: [5, 70] }).wake.map(t => t.thread)).toEqual(['a'])
  })
  test('build-log changes are those into or out of settled or shaped; a thread first seen shaped, or merely warming, is none', () => {
    expect(check({}, { a: [4, 90], b: [9, 5], c: [1, 600] }, { z: [1, 5] }).changes.map(c => `${c.thread.thread}:${c.from}>${c.thread.state}`)).toEqual(['a:null>settled'])
    const store = check({}, { a: [4, 90], b: [9, 5] }).next
    expect(check(store, { a: [5, 2], b: [9, 90] }, { a: [1, 2] }).changes.map(c => `${c.thread.thread}:${c.from}>${c.thread.state}`)).toEqual(['a:settled>shaped', 'b:warming>settled'])
  })
})

describe('the words', () => {
  const outline = { outline: 'gurgle', machine: 'float-2' }
  const [t] = threadsOf(counts({ backlog: [5, 74] }), counts({ backlog: [2, 74] }), counts({}), NOW, SETTLE_DEFAULTS)
  test('a wake line gives the counts and the capability link, or says how to give it one', () => {
    expect(wakeLine(t!, outline, NOW, '((cap))')).toBe('thread backlog (gurgle@float-2) settled: 5 chirps, 2 Evan\'s, quiet 74 min, capability ((cap))')
    expect(wakeLine(t!, outline, NOW, null)).toContain('no capability note yet (write [thread::backlog]')
  })
  test('the wake counts the threads it names and the ones it leaves for the next check', () => {
    expect(wakeText(['a', 'b'], 3)).toContain('5 threads have gone quiet')
    expect(wakeText(['a'], 0)).toContain('1 thread has gone quiet')
  })
  test('a build-log line says the change and the counts', () => {
    expect(logLine({ thread: t!, from: 'warming' }, outline, NOW)).toBe('Thread backlog (gurgle@float-2): warming → settled · 5 chirps, 2 Evan\'s, quiet 74 min')
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
  test('outlines are name[@machine]; with none named it is the bound one', () => {
    expect(outlinesOf('gurgle@float-2, pie', null).outlines).toEqual([{ outline: 'gurgle', machine: 'float-2' }, { outline: 'pie' }])
    expect(outlinesOf('', { outline: 'garden' }).outlines).toEqual([{ outline: 'garden' }])
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
