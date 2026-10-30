import { describe, expect, test, tier } from 'claude-code/testing'
import { heardText, outcomeKey, outcomeLine, outcomesPageOf, untold, wakes, type Outcome } from '../hooks/proposals-heard'
import { viewedNoteOf, withView } from '../hooks/outline-guide'

tier('user')

// What a session hears of its proposals (PIE-1086), and outline_read's view (PIE-1272). Made-up notes and ids.

const NOTE = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222222'
const P2 = '33333333-3333-4333-8333-333333333333'
const at = (m: number) => `2026-10-29T12:${String(m).padStart(2, '0')}:00.000Z`
const outcome = (proposal: string, state: Outcome['state'], revision: number, more: Partial<Outcome> = {}): Outcome =>
  ({ proposal, note: NOTE, title: 'Seed swap', state, at: at(revision), revision, ...more })

describe('what became of a proposal', () => {
  test('each outcome is told once, in order, with the note and the proposal as links', () => {
    const page = outcomesPageOf(JSON.stringify({ actor: 'wren', outcomes: [outcome(P1, 'proposed', 1, { reason: 'the note is open in a draft' }), outcome(P1, 'stale', 2, { by: 'user', reason: 're-read the note and send the edit again, or leave the proposal to Evan' })], cursor: at(2), complete: true }))!
    expect(page.cursor).toBe(at(2))
    const told = new Set<string>()
    const first = untold(page.outcomes, told)
    expect(first.map(o => o.state)).toEqual(['proposed', 'stale'])
    for (const o of first) told.add(outcomeKey(o))
    const later = [...page.outcomes, outcome(P1, 'dismissed', 3, { by: 'user' })]
    expect(untold(later, told).map(o => o.state)).toEqual(['dismissed'])
    expect(outcomeLine(first[1]!)).toBe(`- gone stale: ((${P1}|your edit of Seed swap)) no longer fits ((${NOTE}|Seed swap)), : Evan changed the note after it was proposed: re-read the note and send the edit again, or leave the proposal to Evan`)
    expect(outcomeLine(first[0]!)).toContain('proposed instead of applied: ((')
    expect(outcomeLine(first[0]!)).not.toContain('|proposal))')
  })

  test('only a stale proposal asks the session to act, and says how', () => {
    expect(wakes([outcome(P1, 'applied', 2, { by: 'user' })])).toBe(false)
    expect(wakes([outcome(P2, 'stale', 2)])).toBe(true)
    expect(heardText([outcome(P2, 'stale', 2)])).toContain('send the edit again with outline_patch')
    expect(heardText([outcome(P1, 'applied', 2)])).toContain('Nothing to do')
  })

  test('an answer that is not a page is said, not guessed at', () => {
    expect(outcomesPageOf('not json')).toBeNull()
    expect(outcomesPageOf(JSON.stringify({ outcomes: 'no' }))).toBeNull()
  })
})

describe("outline_read's view", () => {
  test('a read with view draws the note it read, at the width asked, into the answer', () => {
    const read = JSON.stringify({ id: NOTE, revision: 3, text: 'Seed swap' })
    expect(viewedNoteOf('outline_read', read, { ref: 'PIE-1', view: true })).toEqual({ id: NOTE, width: 44 })
    expect(viewedNoteOf('outline_read', read, { ref: 'PIE-1', view: true, width: 80 })).toEqual({ id: NOTE, width: 80 })
    expect(viewedNoteOf('outline_read', read, { ref: 'PIE-1' })).toBeNull()
    expect(viewedNoteOf('outline_find', read, { view: true })).toBeNull()
    expect(JSON.parse(withView(read, 'Seed swap\n  Bring borlotti.\n\n'))).toEqual({ id: NOTE, revision: 3, text: 'Seed swap', view: ['Seed swap', '  Bring borlotti.'] })
  })
})
