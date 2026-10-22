/**
 * What the session's outline can hold, in front of the model (PIE-721), so it reaches for figures, views, callouts and
 * rules without the person reminding it:
 *
 * - **The guide** (`ep0ch library --guide`: the house lines and every component the outline has, its extensions' among
 *   them, one line each) as a context block of the first prompt, read once a session beside the workboard's.
 * - **The core tools up front** (`isDeferred: false`): the ones a session reads and writes notes with, and the component
 *   library, are in the prompt's tool list rather than behind tool search.
 * - **The note drawn back** after a write that wrote a figure (or was warned about one): `ep0ch show` draws it as the
 *   door does, so a figure that doesn't draw shows in the tool's result, beside the write's `warnings`.
 *
 * Pure: the argv, the block's name, the texts. hooks/register.ts runs them.
 */

export const GUIDE_BLOCK = 'ep0ch-outline-guide'
export const GUIDE_ARGV: readonly string[] = ['ep0ch', 'library', '--guide']
/** How long a session waits for the guide: it is read once, off the start, so a slow host only leaves it out. */
export const GUIDE_TIMEOUT_MS = 8000

/** The tools listed up front: outline-core's one list (agent-tool-definitions.ts), the ones this mod registers. */
export { UP_FRONT_TOOLS as UPFRONT_TOOLS } from './agent-tool-definitions'

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
/** The drawing's size: the door's reading width, and the note's first rows (a figure lower down is the warnings' to say). */
const DRAW_WIDTH = 80
const DRAW_ROWS = 40
export const DRAW_TIMEOUT_MS = 8000

/** What the write itself wrote: the text, the appended or section text, the patches' replacements. */
function writtenText(input: Record<string, unknown>): string {
  const section = input.replaceSection && typeof input.replaceSection === 'object' ? (input.replaceSection as { body?: unknown }).body : undefined
  const patches = Array.isArray(input.patches) ? input.patches.map(p => (p && typeof p === 'object' ? (p as { replacement?: unknown }).replacement : '')) : []
  return [input.text, input.append, section, ...patches].filter((t): t is string => typeof t === 'string').join('\n')
}

/**
 * The note to draw back after a write, or null: only when the write itself wrote a `::graph-` figure, or its answer
 * warns about one (a one-word patch elsewhere in a note that holds a figure draws nothing). The id is the result's own
 * (`id`, a patch's first edit's `blockId`), never the ref the agent gave.
 */
export function drawnNoteOf(tool: string, resultText: string, input: Record<string, unknown> = {}): string | null {
  if (!DRAWN_BACK.includes(tool)) return null
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(resultText) as Record<string, unknown> } catch { return null }
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : []
  const wroteFigure = /^\s*::graph-/m.test(writtenText(input))
  if (!wroteFigure && !warnings.some(w => typeof w === 'string' && w.includes('::graph-'))) return null
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
