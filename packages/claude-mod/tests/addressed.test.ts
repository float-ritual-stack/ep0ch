import { describe, expect, test, tier } from 'claude-code/testing'
import { addressedWakeText, askKey, asksOf, mentionArgs, newAsks, repliesArgs, shownAsks, threadsToRead, WAKE_LINES, wordsOf } from '../hooks/addressed'
import type { ListedBlock } from '../hooks/workboard-now'

tier('user')

// Which comments are asks to a persona, and when one stops being one. Made-up notes and ids.

const NOTE = '11111111-1111-4111-8111-111111111111'
const T1 = '22222222-2222-4222-8222-222222222222'
const T2 = '33333333-3333-4333-8333-333333333333'
const MIN = 60_000
const NOW = Date.parse('2026-10-29T12:00:00Z')
const when = (ago: number) => new Date(NOW - ago * MIN).toISOString()

const root = (id: string, words: string, ago: number, who: { author: string; actorId?: string }, status = 'open'): ListedBlock => ({
  id, title: words.split('\n')[0]!, parentId: NOTE, createdAt: when(ago), ...who,
  properties: [{ key: 'type', value: 'annotation' }, { key: 'annotation-status', value: status }],
  text: `Comment on “Whole note”\n[type::annotation] [annotation-status::${status}]\n${words}`,
})
const reply = (id: string, thread: string, words: string, ago: number, who: { author: string; actorId?: string }): ListedBlock => ({
  id, title: words, parentId: thread, createdAt: when(ago), ...who,
  properties: [{ key: 'type', value: 'annotation-reply' }, { key: 'parent-annotation', value: thread }],
  text: `Comment on “Whole note”\n[type::annotation-reply] [parent-annotation::${thread}]\n${words}`,
})
const note: ListedBlock = { id: NOTE, title: 'Bean planting plan', properties: [] }
const EVAN = { author: 'user' }
const DADDY = { author: 'agent', actorId: 'mcp:daddy/claude.ai' }
const LOKI = { author: 'agent', actorId: 'loki/claude-code@garden-host' }
const LOKI_WEB = { author: 'agent', actorId: 'mcp:loki/claude.ai' }
const KITTY = { author: 'agent', actorId: 'kitty/claude-code@garden-host' }

const asks = (persona: string, blocks: ListedBlock[]) => asksOf(persona, 'garden', blocks, [note], [])

describe('an ask', () => {
  test('an open thread naming @loki with no reply from loki is an ask, naming the note, the words and who wrote it', () => {
    const [ask, ...rest] = asks('loki', [root(T1, '@loki move the beans to the sunny bed', 30, EVAN)])
    expect(rest).toEqual([])
    expect(ask).toMatchObject({ thread: T1, note: NOTE, title: 'Bean planting plan', from: 'Evan', person: true, words: '@loki move the beans to the sunny bed', asks: 1 })
  })

  test('a reply from loki after it answers it, from any of its clients; a reply before a later ask does not', () => {
    expect(asks('loki', [root(T1, '@loki which bed?', 120, DADDY), reply('r1', T1, 'The sunny one.', 60, LOKI_WEB)])).toEqual([])
    const again = asks('loki', [root(T1, '@loki which bed?', 120, DADDY), reply('r1', T1, 'The sunny one.', 60, LOKI), reply('r2', T1, '@loki and the peas?', 30, EVAN)])
    expect(again.map(a => [a.from, a.words])).toEqual([['Evan', '@loki and the peas?']])
  })

  test('a mention in a reply of a thread that never named loki is an ask too: kitty about loki\'s traffic', () => {
    const got = asks('loki', [root(T1, 'Is the outbox stuck?', 90, EVAN), reply('r1', T1, '@loki your check-ins stopped at 3 AM', 20, KITTY)])
    expect(got.map(a => a.from)).toEqual(['kitty'])
  })

  test('a resolved thread, loki naming itself, @loki-sr and an @loki only in the quoted passage are no asks', () => {
    expect(asks('loki', [root(T1, '@loki done?', 30, EVAN, 'resolved')])).toEqual([])
    expect(asks('loki', [root(T1, 'Noting for @loki later', 30, LOKI)])).toEqual([])
    expect(asks('loki', [root(T1, '@loki-sr take this one', 30, EVAN)])).toEqual([])
    const quoted = { ...root(T1, 'Is this right?', 30, EVAN), text: 'Comment on “ask @loki”\n[type::annotation] [annotation-status::open]\nIs this right?' }
    expect(asks('loki', [quoted])).toEqual([])
  })

  test('any persona works the same: @kitty is kitty\'s, not loki\'s', () => {
    const blocks = [root(T1, '@kitty a gentler wind-down list?', 30, EVAN)]
    expect(asks('kitty', blocks)).toHaveLength(1)
    expect(asks('loki', blocks)).toEqual([])
  })

  test('Evan\'s asks come first, then the newest', () => {
    const got = asks('loki', [root(T1, '@loki one', 5, DADDY), root(T2, '@loki two', 50, EVAN)])
    expect(got.map(a => a.thread)).toEqual([T2, T1])
  })
})

describe('what a check asks and tells', () => {
  test('the mentions query names the persona; replies are read for every thread the mentions sit in', () => {
    expect(mentionArgs('loki')).toContain('((type=annotation AND annotation-status=open) OR type=annotation-reply) AND text~"@loki"')
    const read = threadsToRead([root(T1, '@loki', 1, EVAN), reply('r', T2, '@loki', 1, EVAN)])
    expect(read).toEqual({ threads: [T1, T2], roots: [T2] })
    const many = Array.from({ length: 45 }, (_, i) => `t${i}`)
    expect(repliesArgs(many)).toHaveLength(2)
  })

  test('an ask is new until told, and new again when asked again', () => {
    const [ask] = asks('loki', [root(T1, '@loki one', 30, EVAN)])
    expect(newAsks([ask!], new Map())).toHaveLength(1)
    expect(newAsks([ask!], new Map([[askKey(ask!), ask!.at]]))).toEqual([])
    expect(newAsks([ask!], new Map([[askKey(ask!), ask!.at - 1]]))).toHaveLength(1)
  })

  test('the wake lists every open ask, the new first, with the thread to reply in', () => {
    const got = asks('loki', [root(T1, '@loki one', 5, DADDY), root(T2, '@loki two', 50, EVAN)])
    const text = addressedWakeText('loki', got, new Set([askKey(got[1]!)]), NOW, 'garden')
    expect(text).toContain('Addressed to @loki: 2 open threads ask you with no reply from you (1 new).')
    const lines = text.split('\n').filter(l => l.startsWith('- '))
    expect(lines[0]).toBe(`- new: daddy, 5 min ago, on ((${NOTE}|Bean planting plan)), thread ${T1}: "@loki one"`)
    expect(lines[1]).toStartWith('- still waiting: Evan, 50 min ago')
    expect(text).toContain('outline_reply')
  })

  test('a wake shows ten at most, the new first, so an ask past the last line is still new at the next check', () => {
    const many = asks('loki', Array.from({ length: 12 }, (_, i) => root(`t${i}`, `@loki ask ${i}`, i + 1, DADDY)))
    const fresh = new Set(many.slice(2).map(askKey))
    const shown = shownAsks(many, fresh)
    expect(shown).toHaveLength(WAKE_LINES)
    expect(shown.every(a => fresh.has(askKey(a)))).toBe(true)
    expect(addressedWakeText('loki', many, fresh, NOW, 'garden')).toContain('- and 2 more')
  })

  test('the words are the comment\'s own, not the header the service writes', () => {
    expect(wordsOf('Review on “Whole note”\n[type::annotation] [kind::review]\n@loki look\nmore')).toBe('@loki look\nmore')
  })
})
