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

/** A note's text cut at its last line break within `max` characters (at a space when one line is longer), or whole. */
function cut(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false }
  const line = text.lastIndexOf('\n', max)
  const at = line > 0 ? line : Math.max(text.lastIndexOf(' ', max), 0) || max
  return { text: text.slice(0, at).trimEnd(), cut: true }
}

/** The note's body: its text without its first line (the title and its properties), which the block's heading names. */
function bodyOf(note: ListedBlock): string {
  const text = (note.text ?? '').trim()
  const first = text.indexOf('\n')
  return first < 0 ? '' : text.slice(first + 1).trim()
}

/** One line: control characters become spaces, and a long title is cut with an ellipsis. */
function clip(s: string, max: number): string {
  const line = s.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

export type OrientFacts = {
  outline?: string
  machine?: string
  agent?: string
  notes: readonly ListedBlock[]
  /** False: the service had more notes than were read; the block says so and how to list them. */
  complete?: boolean
}

/** The block's text, or null when no note orients this session. Every line counts toward BLOCK_CHARS. */
export function orientText(f: OrientFacts): string | null {
  if (!f.notes.length) return null
  const who = f.agent ? `[orient::${f.agent}] or [orient::all]` : '[orient::all] (this session names no agent)'
  const lines = [`Read this first: the ${f.outline ?? 'outline'} outline's own orientation, the notes carrying ${who}, newest first (read when this conversation started; read a note again before acting on it):`]
  let room = BLOCK_CHARS - lines[0]!.length
  for (const note of orientOrder(f.notes)) {
    const show = showCommand(note.id, f.outline, f.machine)
    const head = `\n## ${clip(note.title || note.id, 80)} ((${note.id}))`
    const more = `… read the rest: ${show}`
    room -= head.length
    if (room < 200) { lines.push(head, `(no room left here: ${show})`); room -= show.length + 25; continue }
    const body = cut(bodyOf(note), Math.min(NOTE_CHARS, room - more.length - 2))
    lines.push(head)
    if (body.text) lines.push(body.text)
    if (body.cut) lines.push(more)
    room -= body.text.length + (body.cut ? more.length + 1 : 0) + 1
  }
  if (f.complete === false) lines.push(`\n(more notes carry orient than were read: ep0ch find${f.outline ? ` --ws ${f.outline}` : ''} --query 'orient')`)
  return lines.join('\n')
}

/** What the binding card says: the note it orients from, and how many more. */
export function orientsFrom(notes: readonly ListedBlock[]): string | null {
  if (!notes.length) return null
  const [first, ...rest] = orientOrder(notes)
  return `${clip(first!.title || first!.id, 60)} ((${first!.id}))${rest.length ? ` and ${rest.length} more` : ''}`
}
