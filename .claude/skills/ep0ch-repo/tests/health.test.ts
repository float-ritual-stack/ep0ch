import type { On } from 'claude-code'
import { expect, mock, test, tier } from 'claude-code/testing'

tier('user')

const MIN = 60_000
const START = { surface: 'terminal', isInteractive: true, cwd: '/work/garden' } as const

function session(on: On, agent = 'loki', lastWeek?: string) {
  const submitted: string[] = []
  const persisted = new Map<string, unknown>(lastWeek ? [['code-health-week', lastWeek]] : [])
  const clock = mock.clock(on)
  mock.env(on, { EP0CH_AGENT: agent, EP0CH_DRAIN: 'off' })
  on('store.get', ($, e) => ({ value: persisted.get(e.key) }))
  on('store.set', ($, e) => { persisted.set(e.key, e.value); return { value: undefined } })
  on('session.root', () => ({ value: '/work/garden' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
  on('prompt.submit', ($, e) => { submitted.push(e.text); return { text: e.text } as never })
  return { clock, submitted, persisted }
}

test('loki gets Code health at Sunday 18:00 Toronto, persists the week, and gets it only once across resumes', async ($, on) => {
  const s = session(on)
  await s.clock.set(Date.parse('2026-11-01T22:58:00Z'))
  await $.session.start(START)
  await s.clock.advance(MIN)
  expect(s.submitted).toEqual([])
  await s.clock.advance(30 * MIN)
  expect(s.submitted).toHaveLength(1)
  expect(s.submitted[0]).toContain('Code health')
  expect(s.submitted[0]).toContain('bun scripts/health-ratchet.ts --report')
  expect(s.submitted[0]).toContain('PIE-1376')
  expect(s.submitted[0]).toContain('[type::health-pass]')
  expect(s.submitted[0]).toContain('gurgle')
  expect(s.persisted.get('code-health-week')).toBe('2026-W44')
  await $.session.start(START)
  await s.clock.advance(90 * MIN)
  expect(s.submitted).toHaveLength(1)
  await s.clock.advance(7 * 24 * 60 * MIN)
  expect(s.submitted).toHaveLength(2)
  expect(s.persisted.get('code-health-week')).toBe('2026-W45')
})

test('a fresh registration reads the persisted week before deciding to submit', async ($, on) => {
  const s = session(on, 'loki', '2026-W44')
  await s.clock.set(Date.parse('2026-11-01T23:00:00Z'))
  await $.session.start(START)
  await s.clock.advance(61 * MIN)
  expect(s.submitted).toEqual([])
})

for (const [name, before] of [
  ['daylight time', '2026-10-25T21:59:00Z'],
  ['the spring clock change', '2026-03-08T21:59:00Z'],
  ['the fall clock change', '2026-11-01T22:59:00Z'],
  ['an ISO week belonging to the previous year', '2027-01-03T22:59:00Z'],
]) test(`Sunday 18:00 follows Toronto through ${name}`, async ($, on) => {
  const s = session(on)
  await s.clock.set(Date.parse(before))
  await $.session.start(START)
  await s.clock.advance(MIN / 2)
  expect(s.submitted).toEqual([])
  await s.clock.advance(MIN)
  expect(s.submitted).toHaveLength(1)
  if (name.startsWith('an ISO')) expect(s.persisted.get('code-health-week')).toBe('2026-W53')
})

for (const [agent, at] of [
  ['builder', '2026-11-01T23:00:00Z'],
  ['loki', '2026-11-02T23:00:00Z'],
]) test(`no weekly pass for ${agent} at ${at}`, async ($, on) => {
  const s = session(on, agent)
  await s.clock.set(Date.parse(at))
  await $.session.start(START)
  await s.clock.advance(61 * MIN)
  expect(s.submitted).toEqual([])
})
