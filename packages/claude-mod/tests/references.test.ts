import { describe, expect, test, tier } from 'claude-code/testing'

import { replyBlocks } from '../hooks/reply-lines'
import { unlabelledBlockIds, linkifyReferences, outlinerReferenceOf, outlinerUriFor, outlinerUriOf, webOriginOf } from '../hooks/references'

tier('user')

const UUID = '88476cef-3559-492e-85c3-2d6d31de882e'
const STAND_IN = 'https://pi-outliner.invalid/'
const WEB = 'https://my.ep0ch.sh/pub/p/'

describe('references', () => {
  test('pages, block references and Work IDs link to their pages on the web client (PIE-926)', async () => {
    const { text, hrefs } = linkifyReferences(
      `See PIE-356, [[PIE-325]], [[Daily notes|the notes]] and ((${UUID})).`,
      ['PIE'],
    )
    expect(text).toBe(
      `See [PIE-356](${WEB}PIE-356), [PIE-325](${WEB}PIE-325), ` +
        `[the notes](${WEB}Daily%20notes) and [${UUID.slice(0, 8)}…](${WEB}${UUID}).`,
    )
    expect(hrefs).toEqual([
      `${WEB}PIE-356`,
      `${WEB}PIE-325`,
      `${WEB}Daily%20notes`,
      `${WEB}${UUID}`,
    ])
  })

  test('a labelled block reference draws its label, and repeats share one href', async () => {
    const { text, hrefs } = linkifyReferences(`((${UUID}|the ticket)) then PIE-1 and PIE-1`, ['PIE'])
    expect(text).toBe(
      `[the ticket](${WEB}${UUID}) then [PIE-1](${WEB}PIE-1) and [PIE-1](${WEB}PIE-1)`,
    )
    expect(hrefs).toHaveLength(2)
  })

  test('code, existing links, URLs and near-misses are left alone', async () => {
    const source = [
      'Inline `PIE-1` and `[[page]]`.',
      '```',
      `PIE-2 ((${UUID}))`,
      '```',
      '[PIE-3](https://example.com/PIE-3) and https://github.com/x/PIE-4 and <https://a.b/PIE-5>',
      'pie-6, XPIE-7, PIE-8a, feat/PIE-9, UTF-8, [[]]',
    ].join('\n')
    expect(linkifyReferences(source, ['PIE'])).toEqual({ text: source, hrefs: [] })
  })

  test('a four-backtick fence is code until four backticks close it; indented code is code too (PIE-631)', async () => {
    const fenced = ['````md', '```', `PIE-1 and ((${UUID}))`, '```', '````', 'After: PIE-2'].join('\n')
    const { text, hrefs } = linkifyReferences(fenced, ['PIE'])
    expect(text).toBe(['````md', '```', `PIE-1 and ((${UUID}))`, '```', '````', `After: [PIE-2](${WEB}PIE-2)`].join('\n'))
    expect(hrefs).toEqual([`${WEB}PIE-2`])
    expect(linkifyReferences('Text\n\n    PIE-3 in code\n\nPIE-4', ['PIE']).hrefs).toEqual([`${WEB}PIE-4`])
  })

  test('a block reference preserves its fragment when pressed', async () => {
    const { text, hrefs } = linkifyReferences(`See ((${UUID}^beds|the beds)).`, [])
    expect(text).toBe(`See [the beds](${WEB}${UUID}#beds).`)
    expect(hrefs).toEqual([`${WEB}${UUID}#beds`])
    expect(outlinerUriFor(`((${UUID}^beds))`)).toBe(`pi-outliner://block/${UUID}?fragment=beds`)
  })

  test('bare Work IDs follow the configured prefixes only', async () => {
    expect(linkifyReferences('ABC-12 and PIE-3', ['ABC']).hrefs).toEqual([`${WEB}ABC-12`])
    expect(linkifyReferences('PIE-3 and [[x]]', []).hrefs).toEqual([`${WEB}x`])
  })

  test('link-label brackets are escaped', async () => {
    expect(linkifyReferences(`((${UUID}|x [y] z))`, []).text).toBe(`[x \\[y\\] z](${WEB}${UUID})`)
  })

  test('stand-ins map back to Outliner URIs; other links do not', async () => {
    expect(outlinerUriOf(`${STAND_IN}block/${UUID}`)).toBe(`pi-outliner://block/${UUID}`)
    expect(outlinerUriOf(`${STAND_IN}page/Daily%20notes`)).toBe('pi-outliner://page/Daily%20notes')
    expect(outlinerUriOf(`${STAND_IN}work/PIE-1`)).toBe('pi-outliner://work/PIE-1')
    expect(outlinerUriOf(`${STAND_IN}resource/x`)).toBeNull()
    expect(outlinerUriOf(`${STAND_IN}work/PIE-1/extra`)).toBeNull()
    expect(outlinerUriOf('https://example.com/work/PIE-1')).toBeNull()
  })

  test('a page link names the session\'s outline, or the one the reference names, and maps back to the Outliner URI (PIE-926)', async () => {
    const web = { origin: 'https://web.example', outline: 'garden' }
    const { text, hrefs } = linkifyReferences(`PIE-7, [[Bed plan^north]], ((orchard:${UUID})) and ((${UUID}^beds)).`, ['PIE'], () => undefined, () => undefined, web)
    expect(hrefs).toEqual([
      'https://web.example/pub/o/garden/p/PIE-7',
      'https://web.example/pub/o/garden/p/Bed%20plan#north',
      `https://web.example/pub/o/orchard/p/${UUID}`,
      `https://web.example/pub/o/garden/p/${UUID}#beds`,
    ])
    expect(text).toContain('[orchard · ')
    const back = hrefs.map(href => outlinerUriOf(href, web))
    expect(back).toEqual([
      'pi-outliner://work/PIE-7',
      'pi-outliner://page/Bed%20plan?fragment=north',
      `pi-outliner://block/orchard%3A${UUID}`,
      `pi-outliner://block/${UUID}?fragment=beds`,
    ])
    // A press in a terminal stays the mod's (a reference), not a link out of the outline.
    expect(replyBlocks(text, web).flatMap(b => b.kind === 'line' ? b.parts : []).filter(p => 'ref' in p && !('external' in p))).toHaveLength(4)
    expect(webOriginOf('https://my.example.test/, https://other.example')).toBe('https://my.example.test')
    expect(webOriginOf(undefined)).toBe('https://my.ep0ch.sh')
    expect(outlinerUriOf('https://web.example/pub/p/x#line:74', web)).toBeNull()
    // Another site's page of that shape is a link out; so is one on another origin than this session's.
    expect(outlinerUriOf('https://blog.example/pub/p/intro', web)).toBeNull()
    expect(outlinerUriOf('https://web.example/pub/p/intro')).toBeNull()
    // Another outline's page and Work ID keep their outline; its qualifier is never written twice.
    const other = linkifyReferences('[[orchard:Bed plan]]', [], () => undefined, () => undefined, web)
    expect(other.hrefs).toEqual(['https://web.example/pub/o/orchard/p/Bed%20plan'])
    expect(outlinerUriOf(other.hrefs[0]!, web)).toBe('pi-outliner://page/orchard%3ABed%20plan')
    expect(outlinerUriOf('https://web.example/pub/o/orchard/p/PIE-7', web)).toBe('pi-outliner://page/orchard%3APIE-7')
    // A home-outline address Claude wrote stays the home outline's, whatever this session is bound to.
    expect(linkifyReferences('See https://web.example/pub/p/PIE-8.', [], () => undefined, () => undefined, web).text).toBe('See [PIE-8](https://web.example/pub/p/PIE-8).')
  })

  test('a reference as the model writes it becomes an Outliner URI', async () => {
    expect(outlinerUriFor(' PIE-12 ')).toBe('pi-outliner://work/PIE-12')
    expect(outlinerUriFor('[[Daily notes]]')).toBe('pi-outliner://page/Daily%20notes')
    expect(outlinerUriFor(`((${UUID}))`)).toBe(`pi-outliner://block/${UUID}`)
    expect(outlinerUriFor(UUID.toUpperCase())).toBe(`pi-outliner://block/${UUID}`)
    expect(outlinerUriFor('pi-outliner://work/PIE-1')).toBe('pi-outliner://work/PIE-1')
    expect(outlinerUriFor('Daily notes')).toBe('pi-outliner://page/Daily%20notes')
    expect(outlinerUriFor('  ')).toBeNull()
  })

  test('a URI goes back to the reference the outline writes: ((id)), [[page]], the Work ID', () => {
    for (const reference of [`((${UUID}))`, '[[Daily notes]]', 'PIE-7']) {
      expect(outlinerReferenceOf(outlinerUriFor(reference)!)).toBe(reference)
    }
    expect(outlinerReferenceOf(`pi-outliner://block/${UUID.toUpperCase()}`)).toBe(`((${UUID}))`)
  })

  test('an unaliased ((id)) shows the note title, or the short id until it is known; an alias always wins (PIE-1043)', () => {
    const none = linkifyReferences(`See ((${UUID})) and ((${UUID}^beds)).`, [])
    expect(none.text).toBe(`See [${UUID.slice(0, 8)}…](${WEB}${UUID}) and [${UUID.slice(0, 8)}…](${WEB}${UUID}#beds).`)
    const titled = linkifyReferences(`See ((${UUID})) and ((${UUID}^beds)) and ((${UUID}|mine)).`, [], () => 'Bike shed')
    expect(titled.text).toBe(`See [Bike shed](${WEB}${UUID}) and [Bike shed › beds](${WEB}${UUID}#beds) and [mine](${WEB}${UUID}).`)
    expect(linkifyReferences(`((${UUID}))`, [], () => 'x'.repeat(80)).text).toContain(`[${'x'.repeat(47)}…]`)
    expect(unlabelledBlockIds(`((${UUID.toUpperCase()})) ((${UUID}^a)) ((${UUID}|alias)) https://my.ep0ch.sh/pub/p/${UUID}`)).toEqual([UUID])
  })

  test('my.ep0ch.sh links Claude writes, bare or in a link, are the same references; other URLs are left alone', async () => {
    const source = `See https://my.ep0ch.sh/pub/p/PIE-8. And [it](https://my.ep0ch.sh/pub/p/Daily%20notes), https://my.ep0ch.sh/pub/p/${UUID} and https://example.com/a.`
    const { text, hrefs } = linkifyReferences(source, [], id => (id === UUID ? 'Bike shed' : undefined))
    expect(text).toBe(
      `See [PIE-8](${WEB}PIE-8). And [it](${WEB}Daily%20notes), [Bike shed](${WEB}${UUID}) and https://example.com/a.`,
    )
    expect(hrefs).toEqual([`${WEB}PIE-8`, `${WEB}Daily%20notes`, `${WEB}${UUID}`])
    expect(linkifyReferences('`https://my.ep0ch.sh/pub/p/PIE-8`', []).hrefs).toEqual([])
  })

  test('replyBlocks: lines holding references are parts, the rest Markdown runs, code left alone', async () => {
    const { text } = linkifyReferences('# Title\nplain\n- see PIE-1 and **PIE-2**\n```\nPIE-3\n```', ['PIE'])
    const blocks = replyBlocks(text)
    expect(blocks.map(b => b.kind)).toEqual(['markdown', 'line', 'markdown'])
    expect(blocks[1]).toEqual({
      kind: 'line',
      parts: [{ text: '• ' }, { text: 'see ' }, { ref: `${WEB}PIE-1`, label: 'PIE-1' }, { text: ' and ' }, { ref: `${WEB}PIE-2`, label: 'PIE-2' }],
    })
    expect(JSON.stringify(blocks)).not.toContain('PIE-3](')
  })

  // Evan, Oct 26: cowboy's reply mentioning PC-1349 lost every blank line between its parts.
  test('replyBlocks: a blank line between parts is a row of its own, so a reply with a reference keeps its gaps', async () => {
    const { text } = linkifyReferences('The keys are in.\n\n- PR 1874 (PIE-1349) waits on review\n\nDo you want me to queue it?\n\nI updated the PIE-1349 page.', ['PIE'])
    const kinds = replyBlocks(text).map(b => b.kind)
    expect(kinds).toEqual(['markdown', 'blank', 'line', 'blank', 'markdown', 'blank', 'line'])
  })

  test('replyBlocks: a reply with no line of its own stays one Markdown run, blank lines and all', async () => {
    const blocks = replyBlocks('One paragraph.\n\nAnother, **bold**.\n\n- a list')
    expect(blocks).toEqual([{ kind: 'markdown', text: 'One paragraph.\n\nAnother, **bold**.\n\n- a list' }])
  })

  test('replyBlocks: emphasis that spans a reference and other text draws as bold or italic, never the literal markers', async () => {
    const { text } = linkifyReferences('**A bold line with PIE-1030 inside it**\nSome *italic PIE-2 words* and ***both PIE-3***', ['PIE'])
    const blocks = replyBlocks(text)
    expect(JSON.stringify(blocks)).not.toContain('*')
    expect(blocks[0]).toEqual({
      kind: 'line',
      parts: [{ text: 'A bold line with ', style: 'bold' }, { ref: `${WEB}PIE-1030`, label: 'PIE-1030' }, { text: ' inside it', style: 'bold' }],
    })
    expect(blocks[1]).toEqual({
      kind: 'line',
      parts: [
        { text: 'Some ' }, { text: 'italic ', style: 'italic' }, { ref: `${WEB}PIE-2`, label: 'PIE-2' }, { text: ' words', style: 'italic' },
        { text: ' and ' }, { text: 'both ', style: 'bold-italic' }, { ref: `${WEB}PIE-3`, label: 'PIE-3' },
      ],
    })
  })

  test('replyBlocks: a table with a reference in a row stays one table, its cells parts', async () => {
    const { text } = linkifyReferences('Before\n| Ticket | What |\n| --- | --- |\n| PIE-1031 | **argument** forms |\n| plain | row |\nAfter', ['PIE'])
    const blocks = replyBlocks(text)
    expect(blocks.map(b => b.kind)).toEqual(['markdown', 'table', 'markdown'])
    expect(blocks[0]).toEqual({ kind: 'markdown', text: 'Before' })
    expect(blocks[2]).toEqual({ kind: 'markdown', text: 'After' })
    const table = blocks[1]!
    if (table.kind !== 'table') throw Error('not a table')
    expect(table.header).toEqual([[{ text: 'Ticket' }], [{ text: 'What' }]])
    expect(table.rows).toEqual([
      [[{ ref: `${WEB}PIE-1031`, label: 'PIE-1031' }], [{ text: 'argument', style: 'bold' }, { text: ' forms' }]],
      [[{ text: 'plain' }], [{ text: 'row' }]],
    ])
    // A table with no reference stays the engine's.
    expect(replyBlocks('| a | b |\n| - | - |\n| 1 | 2 |').map(b => b.kind)).toEqual(['markdown'])
  })
})
