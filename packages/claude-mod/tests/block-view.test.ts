import type { ProcessRunResult } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

import { BLOCK_VIEW_PROBE, blockCellsOf, blockViewArgv, blockViewId, BlockView, clipRows, knowsCells, loadBlockView, resetBlockViewProbe } from '../hooks/block-view'

tier('user')

const result = (exitCode: number, stdout: string, stderr = ''): ProcessRunResult =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

const BLOCK = '11111111-2222-4333-8444-555555555555'

/** Cells as `ep0ch show --cells` packs them: each row's text, one colour for all. */
function cellsOf(rows: string[], columns: number, fg = 0xff8800): string {
  const words = new Uint32Array(columns * rows.length * 3)
  rows.forEach((row, y) => {
    for (let x = 0; x < columns; x++) words.set([(row[x] ?? ' ').codePointAt(0)!, fg, 0x01000000], (y * columns + x) * 3)
  })
  let binary = ''
  for (const byte of new Uint8Array(words.buffer)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const SHOWN = (rows: string[], columns = 12) => JSON.stringify({ id: BLOCK, columns, rows: rows.length, cells: cellsOf(rows, columns), replaced: 0 })

const HELP = `ep0ch: a BBS door\n  ep0ch show <id> [--ansi | --cells] [--width <n>] [--rows <n>] [--ws <name>]\n`

/** Elements as a surface's table builds them: plain data, enough to read back. */
const UI = {
  Text: (props: any) => ({ type: 'Text', props }) as any,
  Markdown: (props: any) => ({ type: 'Markdown', props }) as any,
  Raster: (props: any) => ({ type: 'Raster', props }) as any,
}

describe('BlockView', () => {
  test('the door draws it: `ep0ch show --cells` at the width asked for, read as a Raster cut to whole rows', async () => {
    resetBlockViewProbe()
    const runs: (readonly string[])[] = []
    const run = async (argv: readonly string[]) => {
      runs.push(argv)
      return argv[1] === 'help' ? result(0, HELP) : result(0, SHOWN(['Chain oil', '', 'The wax one.', 'Bike shed']))
    }
    const data = await loadBlockView(run, BLOCK, 12, { cwd: '/work/outliner', env: { EP0CH_WS: 'garden' } })
    expect(runs).toEqual([['ep0ch', 'help', BLOCK_VIEW_PROBE], blockViewArgv(BLOCK, 12)])
    // Its first rows only: a long note is never drawn whole.
    expect(blockViewArgv(BLOCK, 12)).toEqual(['ep0ch', 'show', BLOCK, '--cells', '--width', '12', '--rows', '24'])
    expect(data).toMatchObject({ kind: 'cells', columns: 12, rows: 4 })

    const drawn = BlockView(UI, { key: 'p1', data, surface: 'terminal', maxRows: 2, text: 'Chain oil' }) as any
    expect(drawn.type).toBe('Raster')
    expect(drawn.props).toEqual({ key: 'p1', columns: 12, rows: 2, cells: cellsOf(['Chain oil', ''], 12) })
  })

  test('without a usable ep0ch (not on PATH, or older than --cells): the block\'s text as Markdown, never a door opened', async () => {
    resetBlockViewProbe()
    const missing = await loadBlockView(async () => { throw Error('ep0ch: command not found') }, BLOCK, 40)
    expect(missing.kind).toBe('text')
    // An ep0ch older than `help` takes the probe's socket path, never there, and stops at "no carrier".
    const ancient: (readonly string[])[] = []
    const noHelp = await loadBlockView(async argv => { ancient.push(argv); return result(1, '', 'ep0ch: no carrier on /nonexistent/ep0ch-cells-probe.sock') }, BLOCK, 40)
    expect([noHelp.kind, ancient]).toEqual(['text', [['ep0ch', 'help', BLOCK_VIEW_PROBE]]])
    const old: (readonly string[])[] = []
    const tooOld = await loadBlockView(async argv => { old.push(argv); return result(0, '  ep0ch show <id> [--ansi] [--width <n>]\n') }, BLOCK, 40)
    expect(tooOld.kind).toBe('text')
    // Only the help probe ran: `show` was never asked for cells it can't draw.
    expect(old).toEqual([['ep0ch', 'help', BLOCK_VIEW_PROBE]])

    const drawn = BlockView(UI, { key: 'p1', data: missing, surface: 'terminal', maxRows: 2, text: 'Chain oil\nThe wax one.\nBike shed' }) as any
    expect(drawn).toEqual({ type: 'Markdown', props: { key: 'p1', text: 'Chain oil\nThe wax one.', dimColor: true } })
  })

  test('a refusal (no host, no such note) is the reason, and the text is drawn', async () => {
    resetBlockViewProbe()
    const data = await loadBlockView(async argv => argv[1] === 'help' ? result(0, HELP) : result(1, '', 'ep0ch: no note x in this outline\n'), BLOCK, 40)
    expect(data).toEqual({ kind: 'text', why: 'no note x in this outline' })
  })

  test('a surface without Raster (desktop) draws the text; while it loads, the terminal says so', () => {
    const cells = { kind: 'cells' as const, ...blockCellsOf(SHOWN(['Chain oil']))! }
    expect((BlockView(UI, { key: 'p', data: cells, surface: 'desktop', maxRows: 3, text: 'Chain oil' }) as any).type).toBe('Markdown')
    expect((BlockView(UI, { key: 'p', data: undefined, surface: 'terminal', maxRows: 3 }) as any).props.children).toContain('drawing')
  })

  test('cells are checked: whole rows for the width, or nothing', () => {
    expect(blockCellsOf('not json')).toBeNull()
    expect(blockCellsOf(JSON.stringify({ id: BLOCK, columns: 12, rows: 2, cells: cellsOf(['a'], 12) }))).toBeNull()
    const two = blockCellsOf(SHOWN(['a', 'b']))!
    expect(clipRows(two, 1)).toEqual({ ...two, rows: 1, cells: cellsOf(['a'], 12) })
    expect(clipRows(two, 9)).toBe(two)
    expect(knowsCells(HELP)).toBe(true)
    // A drawing is kept per block, revision and width: an edit or a resize draws it again.
    expect(blockViewId(BLOCK, 3, 40)).not.toBe(blockViewId(BLOCK, 4, 40))
    expect(blockViewId(BLOCK, 3, 40)).not.toBe(blockViewId(BLOCK, 3, 41))
  })
})
