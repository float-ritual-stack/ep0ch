import { describe, expect, test, tier } from 'claude-code/testing'

import { detailSourceOf, EMPTY_HISTORY, knowsSource, moved, noteMarkdown, pushed, routeOf, subtreeOf } from '../hooks/detail-view'

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

  test('history: opening drops forward steps, the same note is not doubled, back and forward stay in bounds', () => {
    let h = pushed(pushed(pushed(EMPTY_HISTORY, A), B), C)
    expect([h.entries.map(e => e.id), h.at]).toEqual([['a', 'b', 'c'], 2])
    h = moved(moved(h, -1), -1)
    expect(h.at).toBe(0)
    expect(moved(h, -1).at).toBe(0)
    h = pushed(h, C)
    expect([h.entries.map(e => e.id), h.at]).toEqual([['a', 'c'], 1])
    expect(pushed(h, C).entries).toHaveLength(2)
  })

  test("a note's Markdown: its first line a heading, ::components fenced under their name", () => {
    expect(noteMarkdown('Bike shed\nWhere the bikes live.', true)).toBe('# Bike shed\nWhere the bikes live.')
    expect(noteMarkdown('## Already one', true)).toBe('## Already one')
    expect(noteMarkdown('Plan\n::graph-table\n---\nquery: "type=x"\n---\n::\nafter', true)).toBe('# Plan\n```graph-table\n---\nquery: "type=x"\n---\n```\nafter')
  })

  test('a subtree read in outline order, nested by depth, whatever order the CLI lists it in', () => {
    const stdout = JSON.stringify({ blocks: [
      { id: 'r', parentId: 'up', position: 3, text: 'Root' },
      { id: 'c2', parentId: 'r', position: 1, text: 'Second' },
      { id: 'g', parentId: 'c1', position: 0, text: 'Grandchild\nits second line' },
      { id: 'c1', parentId: 'r', position: 0, text: 'First' },
    ] })
    const blocks = subtreeOf(stdout, 'r')!
    expect(blocks.map(b => [b.text.split('\n')[0], b.depth])).toEqual([['Root', 0], ['First', 1], ['Grandchild', 2], ['Second', 1]])
    const source = detailSourceOf(blocks, ['PIE'], 'outliner')
    expect(source.kind === 'source' && source.markdown).toBe('# Root\n\n- First\n  - Grandchild\n    its second line\n- Second')
    expect(subtreeOf('nope', 'r')).toBeNull()
    expect(subtreeOf(stdout, 'missing')).toBeNull()
  })

  test("a note longer than Markdown's bound is cut on whole blocks, saying the rest is in the outline", () => {
    const blocks = [{ text: 'Long', depth: 0 }, ...Array.from({ length: 400 }, (_, i) => ({ text: `item ${i} ${'x'.repeat(40)}`, depth: 1 }))]
    const source = detailSourceOf(blocks, [], 'outliner')
    if (source.kind !== 'source') throw Error('no source')
    expect(source.isTruncated).toBe(true)
    expect(source.markdown.length).toBeLessThanOrEqual(10_000)
    expect(source.markdown.endsWith('_More of it is in the outline._')).toBe(true)
  })

  test('links are collected once each with their text', () => {
    const source = detailSourceOf([{ text: 'See [[Bike shed]], PIE-7 and [[Bike shed|the shed]].', depth: 0 }], ['PIE'], 'outliner')
    expect(source.kind === 'source' && source.links).toEqual([
      { href: 'https://pi-outliner.invalid/page/Bike%20shed', label: 'Bike shed' },
      { href: 'https://pi-outliner.invalid/work/PIE-7', label: 'PIE-7' },
    ])
  })

  test('only an ep0ch whose help lists show --source is asked for it', () => {
    expect(knowsSource('  ep0ch show <id>… [--source | --ansi | --cells] [--width <n>]')).toBe(true)
    expect(knowsSource('  ep0ch show <id> [--ansi | --cells] [--width <n>] [--rows <n>]')).toBe(false)
  })
})
