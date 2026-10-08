import { describe, expect, test, tier } from 'claude-code/testing'

import { fileRefOf, threadedPathOf, threadsHeldNote } from '../hooks/file-threads'

tier('user')

// Open comment threads on a file an agent is about to rewrite (PIE-650). Fictional file and comments.
const FILE = '/work/garden/beds/pr-body.md'

describe('the file an Edit or Write is about, pure', () => {
  test('an Edit or Write of an absolute path; nothing else', () => {
    expect(threadedPathOf('Edit', { file_path: FILE })).toBe(FILE)
    expect(threadedPathOf('Write', { file_path: FILE })).toBe(FILE)
    expect(threadedPathOf('Read', { file_path: FILE })).toBeNull()
    expect(threadedPathOf('Edit', { file_path: 'beds/plan.md' })).toBeNull()
    expect(threadedPathOf('Edit', { file_path: '/a/b].md' })).toBeNull()
    expect(threadedPathOf('Edit', {})).toBeNull()
  })

  test('the ref that reads it is the [file::] token the notes write', () => {
    expect(fileRefOf(FILE)).toBe('[file::/work/garden/beds/pr-body.md]')
  })
})

describe('what the held edit says', () => {
  const read = (threads: unknown[]) => ({ kind: 'resource', id: 'resource:r1', threads })

  test('nothing to say without open threads, or for a block read', () => {
    expect(threadsHeldNote(FILE, read([]))).toBeNull()
    expect(threadsHeldNote(FILE, { kind: undefined, id: 'b1' })).toBeNull()
    expect(threadsHeldNote(FILE, null)).toBeNull()
  })

  test('each open thread: who, the quote, the words, whether its passage is still there, and how to answer', () => {
    const note = threadsHeldNote(FILE, read([
      { thread: 't1', anchored: true, quote: 'warms on boot', body: 'Why\non boot?', author: 'agent', actorId: 'reviewer-1', replies: [] },
      { thread: 't2', anchored: false, quote: 'step two', body: 'Keep this step.', author: 'user', replies: [{ id: 'x' }] },
    ]))!
    expect(note).toContain(`${FILE} has 2 open comment threads`)
    expect(note).toContain('- reviewer-1 on “warms on boot”: Why on boot? (thread t1)')
    expect(note).toContain('- user on “step two” (the passage has changed or gone; this is what it said): Keep this step. [1 reply] (thread t2)')
    expect(note).toContain('outline_read resource:r1')
    expect(note).toContain('make it again to go ahead')
  })

  test('a long list is cut with a count', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ thread: `t${i}`, anchored: true, quote: 'q', body: 'b', author: 'user' }))
    expect(threadsHeldNote(FILE, read(many))).toContain('… and 3 more')
  })
})
