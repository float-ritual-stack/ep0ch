import { READING_WIDTH } from './link-grammar.js'
/**
 * What the session's outline can hold, in front of the model (PIE-721), so it reaches for figures, views, callouts and
 * rules without the person reminding it:
 *
 * - **The guide** (`ep0ch library --guide`: the house lines and every component the outline has, its extensions' among
 *   them, one line each) as a context block of the first prompt, read once a session beside the workboard's.
 * - **The core tools up front** (`isDeferred: false`): the ones a session reads and writes notes with, and the component
 *   library, are in the prompt's tool list rather than behind tool search.
 * - **The note drawn back** after a write is the service's answer now (PIE-588): the agent tools' write answer carries
 *   `view`, the part it changed as the door draws it, whenever it holds a component, a warning or a fix; the mod passes
 *   it on as the claude.ai connector does. Only outline_read's `view: true` is drawn here (`ep0ch show`, PIE-1272).
 *
 * Pure: the argv, the block's name, the texts. hooks/register.ts runs them.
 */

export const GUIDE_BLOCK = 'ep0ch-outline-guide'
export const GUIDE_ARGV: readonly string[] = ['ep0ch', 'library', '--guide']
/** How long a session waits for the guide: it is read once, off the start, so a slow host only leaves it out. */
export const GUIDE_TIMEOUT_MS = 8000

/** The tools listed up front: outline-core's one list (agent-tool-definitions.ts), the ones this mod registers. */
export { UP_FRONT_TOOLS as UPFRONT_TOOLS } from './link-grammar.js'

/** This session's own lines after the guide's: what the mod's tools do that the gateway's don't. */
const MOD_LINES = [
  'To make the outline do something new (a button, a rule, a script, an extension), use the ep0ch-extend skill (ep0ch --skill ep0ch-extend); ep0ch docs extensions is the reference.',
  '',
  'In this session: outline_edit rewrites a note whole or appends to it; a write with a component, a warning or a fix to make comes back with `view`, the part it changed as the door draws it, beside its `components` and `warnings`: read it before saying it is done.',
]

/** The guide as the block carries it, or null when `ep0ch library --guide` gave nothing usable (an older door, no outline). */
export function guideText(stdout: string): string | null {
  const text = stdout.trim()
  return text.startsWith('# What an ep0ch outline can hold') ? [text, ...MOD_LINES].join('\n') : null
}

/** The drawing's width: Evan's reading width (a 44-column desk tile, write-shape's readingWidth). */
const DRAW_WIDTH = READING_WIDTH
export const DRAW_TIMEOUT_MS = 8000

/**
 * outline_read with `view: true` (PIE-1272): the note it read and the width to draw it at (Evan's reading width when
 * none is asked), or null. The id is the read's own (`id`), never the ref the agent gave.
 */
export function viewedNoteOf(tool: string, resultText: string, input: Record<string, unknown>): { id: string; width: number } | null {
  if (tool !== 'outline_read' || input.view !== true) return null
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(resultText) as Record<string, unknown> } catch { return null }
  const id = typeof parsed.id === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.id) ? parsed.id : null
  return id ? { id, width: typeof input.width === 'number' ? input.width : DRAW_WIDTH } : null
}

/** `ep0ch show` for a read's view: the whole note, at the width asked. */
export const viewArgv = (id: string, width: number): string[] => ['ep0ch', 'show', id, '--width', String(width)]

/** The read's result with `view` in it: the drawing a line each, as the gateway's outline_read answers it; or `viewError`, why it couldn't be drawn. */
export function withView(resultText: string, drawn: string | { error: string }): string {
  try {
    const parsed = JSON.parse(resultText) as Record<string, unknown>
    return JSON.stringify({ ...parsed, ...(typeof drawn === 'string' ? { view: drawn.replace(/\s+$/, '').split('\n') } : { viewError: drawn.error }) })
  } catch {
    return resultText
  }
}
