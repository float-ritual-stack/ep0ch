/**
 * What the session's outline can hold, in front of the model (PIE-721), so it reaches for figures, views, callouts and
 * rules without the person reminding it:
 *
 * - **The guide** (`ep0ch library --guide`: the house lines and every component the outline has, its extensions' among
 *   them, one line each) as a context block of the first prompt, read once a session beside the workboard's.
 * - **The core tools up front** (`isDeferred: false`): the ones a session reads and writes notes with, and the component
 *   library, are in the prompt's tool list rather than behind tool search.
 * - **The note drawn back** after a write that holds a figure: `ep0ch show` draws it as the door does, so a figure that
 *   doesn't draw shows in the tool's result, beside the write's `warnings`.
 *
 * Pure: the argv, the block's name, the texts. hooks/register.ts runs them.
 */

export const GUIDE_BLOCK = 'ep0ch-outline-guide'
export const GUIDE_ARGV: readonly string[] = ['ep0ch', 'library', '--guide']
/** How long a session waits for the guide: it is read once, off the start, so a slow host only leaves it out. */
export const GUIDE_TIMEOUT_MS = 8000

/** The tools listed up front: reading, finding, writing a note, and the component library. */
export const UPFRONT_TOOLS: readonly string[] = ['outline_read', 'outline_find', 'outline_edit', 'outline_create', 'outline_patch', 'outline_components']

/** This session's own lines after the guide's: what the mod's tools do that the gateway's don't. */
const MOD_LINES = [
  '',
  'In this session: outline_edit rewrites a note whole or appends to it; a write that holds a figure comes back drawn as the door draws it (ep0ch show), with its `components` and `warnings`, so read the drawing before saying it is done.',
]

/** The guide as the block carries it, or null when `ep0ch library --guide` gave nothing usable (an older door, no outline). */
export function guideText(stdout: string): string | null {
  const text = stdout.trim()
  return text.startsWith('# What an ep0ch outline can hold') ? [text, ...MOD_LINES].join('\n') : null
}

/** The write tools whose result is drawn back when what they wrote holds a figure. */
export const DRAWN_BACK: readonly string[] = ['outline_edit', 'outline_create', 'outline_patch']
/** The drawing's size: the door's reading width, and enough rows for a figure or two. */
const DRAW_WIDTH = 80
const DRAW_ROWS = 40
export const DRAW_TIMEOUT_MS = 8000

/**
 * The note a write's result says it wrote and holds a figure (`components` with a `graph-` id), or null: nothing to draw.
 * The id is the result's own (`id`, a patch's first edit's `blockId`), never the ref the agent gave.
 */
export function drawnNoteOf(tool: string, resultText: string): string | null {
  if (!DRAWN_BACK.includes(tool)) return null
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(resultText) as Record<string, unknown> } catch { return null }
  const components = Array.isArray(parsed.components) ? parsed.components : []
  if (!components.some(c => typeof c === 'string' && c.startsWith('graph-'))) return null
  const edits = Array.isArray(parsed.edits) ? parsed.edits as { blockId?: unknown }[] : []
  const id = typeof parsed.id === 'string' ? parsed.id : typeof edits[0]?.blockId === 'string' ? edits[0].blockId : null
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

/** `ep0ch show` for the note, at the door's width and capped in rows. */
export const drawArgv = (id: string): string[] => ['ep0ch', 'show', id, '--width', String(DRAW_WIDTH), '--rows', String(DRAW_ROWS)]

/**
 * The write's result with the note's drawing before it (the result's JSON stays last, where the tool rows read it:
 * tool-rows.ts `outputJsonOf`); the result alone when the drawing is empty.
 */
export function withDrawing(resultText: string, drawn: string): string {
  const text = drawn.replace(/\s+$/, '')
  return text ? `The note as it draws (ep0ch show, ${DRAW_WIDTH} columns):\n${text}\n\n${resultText}` : resultText
}
