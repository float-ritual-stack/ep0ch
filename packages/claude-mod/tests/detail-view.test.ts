import { describe, expect, test, tier } from 'claude-code/testing'

import { detailSourceOf, displayMarkdown, EMPTY_HISTORY, exportBodyOf, knowsExport, listed, moved, pushed, routeOf, subtreeMarkdownOf } from '../hooks/detail-view'

// outline-core's test/fixtures/component-notes.ts COMARK_NOTE (a plugin test can't import outside its folder).
const COMARK_NOTE = ['Comark notes', '::graph-annotate', '```md', '::graph-stat', '---', 'title: Example', '---', '::', '```', '1. the example figure', '::', '', '## Second', '', '::graph-stat', '---', 'title: Open', '---', '::', '', 'after']

tier('user')

const A = { uri: 'pi-outliner://page/a', id: 'a', title: 'A' }
const B = { uri: 'pi-outliner://page/b', id: 'b', title: 'B' }
const C = { uri: 'pi-outliner://page/c', id: 'c', title: 'C' }

describe('the detail pane, pure', () => {
  test("the route is openNote's order: a door tile, then Herdr, then here", () => {
    expect(routeOf({ EP0CH_CONTROL: '/s.sock', HERDR_PANE_ID: 'w:p1', HERDR_WORKSPACE_ID: 'w' })).toBe('door')
    expect(routeOf({ HERDR_PANE_ID: 'w:p1', HERDR_WORKSPACE_ID: 'w' })).toBe('herdr')
    expect(routeOf({ HERDR_PANE_ID: 'w:p1', HERDR_WORKSPACE_ID: '' })).toBe('here')
    expect(routeOf({})).toBe('here')
  })

  test('history: opening drops forward steps, the same note is not doubled; back from the first note is the list', () => {
    let h = pushed(pushed(pushed(EMPTY_HISTORY, A), B), C)
    expect([h.entries.map(e => e.id), h.at, h.isShown]).toEqual([['a', 'b', 'c'], 2, true])
    h = moved(moved(h, -1), -1)
    expect([h.at, h.isShown]).toEqual([0, true])
    expect(moved(h, -1)).toMatchObject({ at: 0, isShown: false })
    h = pushed(h, C)
    expect([h.entries.map(e => e.id), h.at]).toEqual([['a', 'c'], 1])
    expect(pushed(h, C).entries).toHaveLength(2)
    expect(listed(h)).toMatchObject({ at: 1, isShown: false })
    expect(moved(listed(h), 1).isShown).toBe(true)
  })

  test("shown Markdown: the first line a heading, a ::figure with a body fenced, a one-line ::links kept one line", () => {
    expect(displayMarkdown('Bike shed\nWhere the bikes live.')).toBe('# Bike shed\nWhere the bikes live.')
    expect(displayMarkdown('## Already one')).toBe('## Already one')
    expect(displayMarkdown('Plan\n::graph-table\n---\nquery: "type=x"\n---\n::\nafter')).toBe('# Plan\n```graph-table\n---\nquery: "type=x"\n---\n```\nafter')
    // Where a figure ends is outline-core's rule (hooks/component-block.ts, a checked copy): a bare `::` in its code
    // example stays inside a fence longer than the example's.
    expect(displayMarkdown(COMARK_NOTE.join('\n')).split('\n')).toEqual([
      '# Comark notes', '````graph-annotate', ...COMARK_NOTE.slice(2, 10), '````', '', '## Second', '',
      '```graph-stat', ...COMARK_NOTE.slice(15, 18), '```', '', 'after',
    ])
    expect(displayMarkdown('T\n::resources jira\ntitle: Around\n::')).toBe('# T\n```resources jira\ntitle: Around\n```')
    // ::links has no closing line: what follows stays Markdown, its references still links.
    const source = detailSourceOf('Hub\n::links\nSee [[Bike shed]].', [], 'ep0ch')
    expect(source.kind === 'source' && source.markdown).toBe('# Hub\n`::links`\nSee [Bike shed](https://pi-outliner.invalid/page/Bike%20shed).')
  })

  test("ep0ch export's Markdown without its front matter", () => {
    expect(exportBodyOf('---\nid: "x"\nauthor: "user"\n---\nBike shed\nbody\n\n- a child\n')).toBe('Bike shed\nbody\n\n- a child')
    expect(exportBodyOf('---\nid: "x"\n---\n')).toBeNull()
  })

  test("the outliner's subtree laid out as the export lays it out, in the service's order and depth; a cut read says so", () => {
    const stdout = JSON.stringify({ blocks: [
      { id: 'r', depth: 0, text: 'Root' },
      { id: 'c1', depth: 1, text: 'First' },
      { id: 'g', depth: 2, text: 'Grandchild\nits second line' },
      { id: 'c2', depth: 1, text: 'Second' },
    ], completeness: { kind: 'complete' } })
    expect(subtreeMarkdownOf(stdout, 'r')).toEqual({ markdown: 'Root\n\n- First\n  - Grandchild\n    its second line\n- Second', isTruncated: false })
    expect(subtreeMarkdownOf(stdout.replace('"complete"', '"truncated"'), 'r')?.isTruncated).toBe(true)
    expect(subtreeMarkdownOf('nope', 'r')).toBeNull()
    expect(subtreeMarkdownOf(stdout, 'c1')).toBeNull()
    const cut = detailSourceOf('Root', [], 'outliner', true)
    expect(cut.kind === 'source' && cut.markdown).toBe('# Root\n\n_More of it is in the outline._')
  })

  test("a note longer than Markdown's bound is cut on a whole line, saying the rest is in the outline", () => {
    const long = ['Long', ...Array.from({ length: 400 }, (_, i) => `- item ${i} ${'x'.repeat(40)}`)].join('\n')
    const source = detailSourceOf(long, [], 'ep0ch')
    if (source.kind !== 'source') throw Error('no source')
    expect(source.isTruncated).toBe(true)
    expect(source.markdown.length).toBeLessThanOrEqual(10_000)
    expect(source.markdown.endsWith('x\n\n_More of it is in the outline._')).toBe(true)
  })

  test('control characters and escapes a note may hold (ANSI art, CRLF) never reach Markdown', () => {
    const source = detailSourceOf('Art\r\n\x1b[31mred\x1b[0m\x07 done', [], 'ep0ch')
    expect(source.kind === 'source' && source.markdown).toBe('# Art\nred done')
  })

  test('links are collected once each with their text', () => {
    const source = detailSourceOf('See [[Bike shed]], PIE-7 and [[Bike shed|the shed]].', ['PIE'], 'outliner')
    expect(source.kind === 'source' && source.links).toEqual([
      { href: 'https://pi-outliner.invalid/page/Bike%20shed', label: 'Bike shed' },
      { href: 'https://pi-outliner.invalid/work/PIE-7', label: 'PIE-7' },
    ])
  })

  test('only an ep0ch whose help lists export is asked for it', () => {
    expect(knowsExport('  ep0ch export [<id>…] [--query "<expression>"] [--view <id>]')).toBe(true)
    expect(knowsExport('  ep0ch show <id> [--ansi | --cells] [--width <n>] [--rows <n>]')).toBe(false)
  })
})
