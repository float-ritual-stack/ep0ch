/**
 * "Orient here" (PIE-1353): the notes an outline keeps for whoever binds to it, given to the model as one context
 * block of the first prompt and again after a compaction or `/clear`. A note says who it is for with an open property,
 * `[orient::<agent>]` or `[orient::all]`; the service answers the one query (the views' grammar), so nothing here
 * lists notes or keys. The agent is the persona the session writes as (OUTLINER_ACTOR, EP0CH_AGENT, the folder's
 * `.ep0ch` `agent`).
 *
 * This file is pure: the query, and the text from what `list` answered. register.ts runs it.
 */

import type { ListedBlock } from './workboard-now'

export const ORIENT_BLOCK = 'orientNotes'
/** How long the read may take; past it the block is left out, and made again when it lands. */
export const ORIENT_TIMEOUT_MS = 6000
/** `list`'s columns: the whole text (the note as written) and when it changed (the order notes stack in). */
export const ORIENT_FIELDS = 'id,title,text,timestamps'
/** How many notes a read asks for: an outline keeps a few, so this is all of them. */
export const ORIENT_LIMIT = 20
/** Characters of one note given whole; past them it is cut at a line with where to read the rest. */
export const NOTE_CHARS = 4000
/** Characters of the whole block: a note that would pass it is named with its command, not given. */
export const BLOCK_CHARS = 12000

/** A query value, quoted in the grammar's own way (only `\\` and `\"` are escapes). */
const quoted = (value: string) => `"${value.replace(/["\\]/g, '\\$&')}"`

/** The notes for `agent` and for everyone; with no agent, those for everyone. */
export function orientQuery(agent: string | undefined): string {
  return agent ? `orient=${quoted(agent)} OR orient=${quoted('all')}` : `orient=${quoted('all')}`
}

/** The command that reads a note whole, in the session's outline (and on its machine). */
export function showCommand(id: string, outline: string | undefined, machine?: string): string {
  return ['ep0ch show', outline && `--ws ${outline}`, machine && `--machine ${machine}`, id].filter(Boolean).join(' ')
}

/** The notes newest first: the one changed last leads (and keeps its room when the block is full). */
export function orientOrder(notes: readonly ListedBlock[]): ListedBlock[] {
  return [...notes].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

/** A note's text cut at a line within `max` characters, or whole when it fits. */
function cut(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false }
  const at = text.lastIndexOf('\n', max)
  return { text: text.slice(0, at > max / 2 ? at : max).trimEnd(), cut: true }
}

/** One line: control characters become spaces, and a long title is cut with an ellipsis. */
function clip(s: string, max: number): string {
  const line = s.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

export type OrientFacts = { outline?: string; machine?: string; agent?: string; notes: readonly ListedBlock[] }

/** The block's text, or null when no note orients this session. */
export function orientText(f: OrientFacts): string | null {
  if (!f.notes.length) return null
  const who = f.agent ? `[orient::${f.agent}] or [orient::all]` : '[orient::all] (this session names no agent)'
  const lines = [`Read this first: the ${f.outline ?? 'outline'} outline's own orientation, the notes carrying ${who}, newest first (read when this conversation started; read a note again before acting on it):`]
  let room = BLOCK_CHARS
  for (const note of orientOrder(f.notes)) {
    const show = showCommand(note.id, f.outline, f.machine)
    const head = `\n## ${clip(note.title || note.id, 80)} ((${note.id}))`
    const body = cut((note.text ?? note.title).trim(), Math.min(NOTE_CHARS, room))
    if (room < 200) { lines.push(`${head}\n(no room left here: ${show})`); continue }
    lines.push(head, body.text)
    if (body.cut) lines.push(`… read the rest: ${show}`)
    room -= body.text.length
  }
  return lines.join('\n')
}

/** What the binding card says: the note it orients from, and how many more. */
export function orientsFrom(notes: readonly { id: string; title: string }[]): string | null {
  if (!notes.length) return null
  const [first, ...rest] = notes
  return `${clip(first!.title || first!.id, 60)} ((${first!.id}))${rest.length ? ` and ${rest.length} more` : ''}`
}
