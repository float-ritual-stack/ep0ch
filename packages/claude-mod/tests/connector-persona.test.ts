import { describe, expect, test, tier } from 'claude-code/testing'
import { CONNECTOR_WRITE_MATCH, CONNECTOR_WRITE_TOOLS, personaFilled, slipOf } from '../hooks/connector-persona'

tier('user')

// Which connector calls get the session's persona, and when an answer says it was recorded as someone else.

describe('which calls', () => {
  test("the connector's write tools match; its reads, this mod's tools and other servers do not", () => {
    for (const name of CONNECTOR_WRITE_TOOLS) expect(CONNECTOR_WRITE_MATCH.test(`mcp__claude_ai_ep0ch__${name}`)).toBe(true)
    for (const name of ['mcp__claude_ai_ep0ch__outline_read', 'mcp__claude_ai_ep0ch__outline_patch_x', 'mcp__ep0ch__outline_patch', 'mcp__other__outline_patch', 'outline_patch'])
      expect(CONNECTOR_WRITE_MATCH.test(name)).toBe(false)
  })
})

describe('personaFilled', () => {
  test('adds the session persona when the call names none', () => {
    expect(personaFilled({ ref: 'a' }, 'loki')).toEqual({ ref: 'a', persona: 'loki' })
    expect(personaFilled({ ref: 'a', persona: '' }, 'loki')).toEqual({ ref: 'a', persona: 'loki' })
    expect(personaFilled({ ref: 'a', persona: null }, 'loki')).toEqual({ ref: 'a', persona: 'loki' })
  })
  test('a call that names one, or a session with none, is left alone', () => {
    expect(personaFilled({ ref: 'a', persona: 'daddy' }, 'loki')).toBeNull()
    expect(personaFilled({ ref: 'a' }, undefined)).toBeNull()
  })
})

describe('slipOf', () => {
  const answer = (by: string) => JSON.stringify({ outcome: 'applied', by })
  test('an answer recorded as the session says nothing', () => {
    expect(slipOf(answer('loki (claude.ai)'), 'loki')).toBeNull()
    expect(slipOf(answer('loki'), 'loki')).toBeNull()
  })
  test('one recorded as someone else, or as the principal alone, names who', () => {
    expect(slipOf(answer('daddy (claude.ai)'), 'loki')?.by).toBe('daddy (claude.ai)')
    expect(slipOf(answer('claude.ai'), 'loki')?.line).toContain('recorded as claude.ai, not loki')
    expect(slipOf(answer('lokiness (claude.ai)'), 'loki')).not.toBeNull()
  })
  test('text blocks are read, and an answer with no `by` or a session with no persona says nothing', () => {
    expect(slipOf({ content: [{ type: 'text', text: answer('daddy (claude.ai)') }] }, 'loki')).not.toBeNull()
    expect(slipOf('{"outcome":"applied"}', 'loki')).toBeNull()
    expect(slipOf('not json', 'loki')).toBeNull()
    expect(slipOf(answer('daddy (claude.ai)'), undefined)).toBeNull()
  })
})
