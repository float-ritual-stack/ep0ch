import type { MarkdownProps, ProcessRunInit, ProcessRunResult, RasterProps, RenderElement, RenderSurface, TextProps } from 'claude-code'

import type { BlockCells, BlockViewData } from '../types'

export type { BlockCells, BlockViewData }

/**
 * BlockView: an outline block drawn as the door draws it, in any pane or band
 * of this mod. Glue, not a renderer: the door's own renderer is a CLI,
 * `ep0ch show <id> --cells --width <n>` (packages/door, src/notes-cli.ts and
 * src/cells.ts), and its output is already a `Raster`'s cells: row-major,
 * base64 of u32 LE `[codePoint, fg, bg]`. The mod clips rows and hands them on.
 *
 * Why cells and not styled spans for `Text`: a Raster is one leaf the
 * terminal paints exactly as the door laid it out (columns, rules, colours),
 * with nothing to re-wrap, and `$.ui.blit` can repaint it in place. What it
 * can't hold: a glyph wider than one cell or outside the BMP (the door sends
 * U+FFFD and a blank, columns kept, and counts them in `replaced`), and bold,
 * italic or underline (a cell has colours only).
 *
 * Where the CLI can't draw (no `ep0ch` on PATH, one older than `--cells`, no
 * outline host answering, a surface without `Raster` such as desktop), the
 * block's text is drawn by `Markdown` instead, as a reply is.
 *
 * It needs the outline host and nothing else: no door, no Herdr.
 */

/** Base64 characters per cell: 12 bytes (three u32s), a multiple of 3, so a row never splits a base64 quantum. */
const B64_PER_CELL = 16

/** The most rows kept of one drawing: a preview, not the note. */
export const MAX_ROWS = 24

/** `ep0ch help` lists `show … --cells`: this ep0ch draws cells (an older `show` would refuse the flag; one older than `show` would open a door). */
export const knowsCells = (help: string): boolean => /^\s*ep0ch show\b.*--cells.*--rows/m.test(help)

/** The `ep0ch show` argv for one block at one width: its first rows only, so a long note is never drawn whole. */
export function blockViewArgv(id: string, width: number, rows = MAX_ROWS): string[] {
  return ['ep0ch', 'show', id, '--cells', '--width', String(width), '--rows', String(rows)]
}

/** `ep0ch show --cells`' answer, checked: whole rows of cells for its width, or null. */
export function blockCellsOf(stdout: string): BlockCells | null {
  let parsed: unknown
  try { parsed = JSON.parse(stdout) } catch { return null }
  const { id, columns, rows, cells, replaced } = (parsed ?? {}) as Record<string, unknown>
  if (typeof id !== 'string' || typeof cells !== 'string') return null
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || (columns as number) < 1 || (rows as number) < 0) return null
  if (cells.length !== (columns as number) * (rows as number) * B64_PER_CELL) return null
  return { id, columns: columns as number, rows: rows as number, cells, replaced: Number.isInteger(replaced) ? (replaced as number) : 0 }
}

/** The first `rows` rows of a drawing, cut on whole rows of the base64 itself. */
export function clipRows(view: BlockCells, rows: number): BlockCells {
  const keep = Math.max(0, Math.min(view.rows, Math.floor(rows)))
  return keep === view.rows ? view : { ...view, rows: keep, cells: view.cells.slice(0, keep * view.columns * B64_PER_CELL) }
}

/** Where `ep0ch` runs: the folder whose `.ep0ch` names the outline, and the environment that pins it. */
export type BlockViewSource = { cwd?: string; env?: Record<string, string> }

/** Runs a host command: `$.process.run`, handed in by the hooks module (only it holds `$`). */
export type RunCommand = (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>

let helped: Promise<string | null> | undefined

/** Forgets what `ep0ch help` said, so it is asked again (an `ep0ch install` mid-session; tests). */
export function resetBlockViewProbe(): void {
  helped = undefined
}

/**
 * `ep0ch help`'s text, asked once a module load, or null where there is no usable
 * `ep0ch`: what each of the mod's `ep0ch` commands checks before it runs
 * (`--cells` here, `export` for the detail view).
 */
export function ep0chHelp(run: RunCommand): Promise<string | null> {
  return (helped ??= run(['ep0ch', 'help'], { timeoutMs: 5000 })
    .then(help => (help.exitCode === 0 ? help.stdout : null), () => null))
}

/** An answer that didn't serve: asked again next time (an `ep0ch install` mid-session). */
export function forgetEp0chHelp(): void {
  helped = undefined
}

/**
 * Draws block `id` at `width` columns through the door's CLI. Never throws:
 * any failure is `{ kind: 'text', why }`, and the caller draws the text.
 */
export async function loadBlockView(run: RunCommand, id: string, width: number, source: BlockViewSource = {}, rows = MAX_ROWS): Promise<BlockViewData> {
  try {
    // Once a module load: an ep0ch older than `--cells` never runs `show` with it, nor one older than `show` at all.
    const help = await ep0chHelp(run)
    if (help === null || !knowsCells(help)) {
      forgetEp0chHelp()
      return { kind: 'text', why: 'ep0ch is not on PATH, or too old to draw cells (ep0ch install)' }
    }
    const ran = await run(blockViewArgv(id, width, rows), { ...source, timeoutMs: 15_000 })
    if (ran.exitCode !== 0) {
      const reason = ran.stderr.trim().split('\n').at(-1)?.replace(/^ep0ch: /, '')
      return { kind: 'text', why: reason || 'ep0ch show failed' }
    }
    const cells = blockCellsOf(ran.stdout)
    return cells ? { kind: 'cells', ...clipRows(cells, rows) } : { kind: 'text', why: 'ep0ch show --cells printed no cells' }
  } catch (error) {
    forgetEp0chHelp()
    return { kind: 'text', why: error instanceof Error ? error.message : String(error) }
  }
}

/** The elements BlockView draws with: any surface's table has Text and Markdown; the terminal's has Raster. */
export type BlockViewElements = {
  Text: (props: TextProps & { children?: unknown }) => RenderElement
  Markdown: (props: MarkdownProps) => RenderElement
  Raster?: (props: RasterProps) => RenderElement
}

export type BlockViewProps = {
  /** Unique among the Rasters of the tree (`$.ui.blit` names it). */
  key: string
  /** The drawing, or undefined while it loads. */
  data: BlockViewData | undefined
  /** The surface drawing it: cells only where it has a Raster (the terminal). */
  surface: RenderSurface
  /** At most this many rows. */
  maxRows: number
  /** The block's text, drawn as Markdown when there are no cells. */
  text?: string
  /**
   * The links in `text` a press answers (stand-in hrefs, as `linkifyReferences`
   * makes them) and what a press on one does: the detail pane's navigation.
   * Absent, the Markdown is a preview: dim, its links the surface's own.
   */
  links?: { hrefs: readonly string[]; press: (href: string, surface: RenderSurface) => void }
}

/** The first `rows` lines of a block's text, for Markdown. */
const firstLines = (text: string, rows: number) => text.split('\n').slice(0, Math.max(1, rows)).join('\n')

/**
 * One block's drawing, one renderer per surface: on the terminal the door's
 * cells as a Raster; elsewhere (desktop, VS Code), or where the door can't
 * draw, the block's text as Markdown: a dim preview, or with `links` the
 * detail pane's body, its references pressed to navigate. Else a dim line
 * while it loads.
 */
export function BlockView(ui: BlockViewElements, { key, data, surface, maxRows, text, links }: BlockViewProps): RenderElement {
  if (data?.kind === 'cells' && surface === 'terminal' && ui.Raster && data.rows > 0) {
    const view = clipRows(data, maxRows)
    return ui.Raster({ key, columns: view.columns, rows: view.rows, cells: view.cells })
  }
  if (data === undefined && surface === 'terminal') return ui.Text({ dimColor: true, children: '  drawing…' })
  if (text?.trim() && links) {
    // Whole: the detail view's Markdown is already bounded, and its last line may say the rest is in the outline.
    return ui.Markdown({
      key,
      text: text.trim(),
      ...(links.hrefs.length ? { pressableLinks: links.hrefs.slice(0, 256), onLinkPress: (link, press) => links.press(link.href, press.surface) } : {}),
    })
  }
  if (text?.trim()) return ui.Markdown({ key, text: firstLines(text.trim(), maxRows), dimColor: true })
  return ui.Text({ dimColor: true, children: data?.kind === 'text' ? `  (no preview: ${data.why})` : '  (empty)' })
}

/** The width a drawing is asked for: the door's own bounds (10 and up), and no wider than a preview needs. */
export const viewColumns = (width: number): number => Math.max(10, Math.min(200, Math.floor(width)))

/** The session state id of one drawing: a block at a revision and a width, so an edit or a resize draws it again. */
export const blockViewId = (id: string, revision: number | null | undefined, width: number): string => `${id}@${revision ?? ''}@${viewColumns(width)}`
