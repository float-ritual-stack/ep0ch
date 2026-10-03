import type { RenderElement, RenderSurface } from 'claude-code'

import type { DetailEntry, DetailHistory, DetailLink, DetailSource } from '../types'
import { linkifyReferences } from './references'

/**
 * The detail view: where a note opens when neither a door nor Herdr is around
 * (the desktop app's Code tab, VS Code, a terminal outside Herdr). It is the
 * third case of the mod's one open (`openNote` in register.ts), after the door
 * and Herdr; never a router of its own. It is the mentions pane's other face:
 * the pane shows the note in place of the list, and back returns to the list
 * (a pane opened beside it would be a tab behind it, out of sight).
 *
 * The note is drawn by BlockView, one renderer per surface: the door's cells
 * on the terminal, Markdown elsewhere. The Markdown is the outliner's read of
 * the note and its children (`outliner list --subtree <id>`), or `ep0ch show
 * <id> --source` (the note alone) where the outliner can't answer, with its
 * references as links. A link pressed navigates within the pane, with history:
 * back and forward. On the terminal, whose cells hold no links, the references
 * are buttons under the drawing.
 *
 * This file is the pure half (routing, history, what a read means, the tree);
 * register.ts holds the state and runs the commands, since only it holds `$`.
 */

/** The most rows the terminal's drawing keeps: a note, not a preview. */
export const DETAIL_ROWS = 400
/** The most blocks of a subtree read: the note and its first descendants. */
export const SUBTREE_LIMIT = 200
/** Markdown's own bound is 10000 characters; a little is kept for the note that says the rest is in the outline. */
const MARKDOWN_BUDGET = 9_800
/** The most link buttons on the terminal: one hotkey each, 1 to 9. */
export const LINK_BUTTONS = 9

/** Where a press opens a note: the door this session runs in, the Outliner Detail beside it in Herdr, or the detail view here. */
export type Route = 'door' | 'herdr' | 'here'

/** The route the environment gives, in openNote's order: a door tile, then Herdr, then here. */
export function routeOf(env: { EP0CH_CONTROL?: string | undefined; HERDR_PANE_ID?: string | undefined; HERDR_WORKSPACE_ID?: string | undefined }): Route {
  if (env.EP0CH_CONTROL) return 'door'
  if (env.HERDR_PANE_ID && env.HERDR_WORKSPACE_ID) return 'herdr'
  return 'here'
}

/**
 * The extra argument `ep0ch help` is asked with: a socket path that never
 * exists, so an ep0ch older than `help` stops at "no carrier" rather than
 * opening a door (block-view.ts' probe, for the same reason).
 */
export const SOURCE_PROBE = '/nonexistent/ep0ch-source-probe.sock'

/** `ep0ch help` lists `show … --source`: this ep0ch prints a note's text as written. */
export const knowsSource = (help: string): boolean => /^\s*ep0ch show\b.*--source/m.test(help)

/** The `ep0ch show` argv that prints a note's text as written. */
export const sourceArgv = (id: string): string[] => ['ep0ch', 'show', id, '--source']

/** What the headings say for the here route. */
export const OPENS_HERE = 'opens here'

export const EMPTY_HISTORY: DetailHistory = { entries: [], at: -1, isShown: false }

/** The history once `entry` is opened, and shown: forward entries dropped, the same note opened again not doubled. */
export function pushed(history: DetailHistory, entry: DetailEntry): DetailHistory {
  // Opened from the list, a note starts a new walk after the one on screen before.
  const kept = history.entries.slice(0, history.at + 1)
  if (kept.at(-1)?.id === entry.id) kept[kept.length - 1] = entry
  else kept.push(entry)
  // A long walk keeps its last 50 steps.
  const entries = kept.slice(-50)
  return { entries, at: entries.length - 1, isShown: true }
}

/** The history moved back (-1) or forward (1); back from the first note is the list. */
export function moved(history: DetailHistory, by: -1 | 1): DetailHistory {
  if (by === -1 && history.at <= 0) return { ...history, isShown: false }
  const at = Math.max(0, Math.min(history.entries.length - 1, history.at + by))
  return { ...history, at, isShown: true }
}

/** Back to the list, the walk kept. */
export const listed = (history: DetailHistory): DetailHistory => ({ ...history, isShown: false })

export const currentOf = (history: DetailHistory): DetailEntry | undefined => history.entries[history.at]

/** A detail history read back from state: anything that isn't one is empty. */
export function historyOf(value: unknown): DetailHistory {
  const v = value as Partial<DetailHistory> | undefined
  if (!v || !Array.isArray(v.entries) || !Number.isInteger(v.at)) return EMPTY_HISTORY
  return { entries: v.entries, at: Math.max(-1, Math.min(v.entries.length - 1, v.at!)), isShown: v.isShown === true && v.entries.length > 0 }
}

/**
 * A note's text as Markdown: its first line a heading (unless it is one), and
 * each `::component` block (a live figure, `::links`) fenced under its name,
 * since only the door draws them live.
 */
export function noteMarkdown(text: string, heading: boolean): string {
  const lines = text.replace(/\n+$/, '').split('\n')
  const out: string[] = []
  let inComponent = false
  lines.forEach((line, i) => {
    if (i === 0 && heading && line.trim() && !/^#{1,6}\s/.test(line)) return void out.push(`# ${line.trim()}`)
    const opens = !inComponent && /^::[\w-]+\s*$/.exec(line)
    if (opens) {
      inComponent = true
      return void out.push(`\`\`\`${line.slice(2).trim()}`)
    }
    if (inComponent && line.trim() === '::') {
      inComponent = false
      return void out.push('```')
    }
    out.push(line)
  })
  if (inComponent) out.push('```')
  return out.join('\n')
}

type SubtreeBlock = { id: string; parentId: string | null; position: number; text: string }

/** `outliner list --subtree <id>`' blocks, the note first then its descendants in outline order, with depths below it; null for anything else. */
export function subtreeOf(stdout: string, id: string): { text: string; depth: number }[] | null {
  let parsed: unknown
  try { parsed = JSON.parse(stdout) } catch { return null }
  const raw = (parsed as { blocks?: unknown } | null)?.blocks
  if (!Array.isArray(raw)) return null
  const blocks: SubtreeBlock[] = raw.flatMap((b: Record<string, unknown>) =>
    b && typeof b.id === 'string' && typeof b.text === 'string'
      ? [{ id: b.id, parentId: typeof b.parentId === 'string' ? b.parentId : null, position: Number(b.position) || 0, text: b.text }]
      : [])
  const root = blocks.find(b => b.id === id)
  if (!root) return null
  const children = new Map<string, SubtreeBlock[]>()
  for (const b of blocks) if (b.parentId) children.set(b.parentId, [...(children.get(b.parentId) ?? []), b])
  const out: { text: string; depth: number }[] = []
  const walk = (b: SubtreeBlock, depth: number) => {
    out.push({ text: b.text, depth })
    for (const child of (children.get(b.id) ?? []).sort((x, y) => x.position - y.position)) walk(child, depth + 1)
  }
  walk(root, 0)
  return out
}

/** One descendant as a list item, nested by its depth, its later lines under its first. */
function listItem(text: string, depth: number): string {
  const indent = '  '.repeat(Math.max(0, depth - 1))
  const [first = '', ...rest] = noteMarkdown(text, false).split('\n')
  return [`${indent}- ${first}`, ...rest.map(line => (line ? `${indent}  ${line}` : ''))].join('\n')
}

/** Every stand-in link in linkified Markdown, once each, with its text. */
export function linksOf(markdown: string): DetailLink[] {
  const seen = new Map<string, string>()
  for (const m of markdown.matchAll(/\[((?:\\.|[^\]\\\n])*)\]\((https:\/\/pi-outliner\.invalid\/[^)\s]+)\)/g)) {
    if (!seen.has(m[2]!)) seen.set(m[2]!, m[1]!.replace(/\\(.)/g, '$1'))
  }
  return [...seen].map(([href, label]) => ({ href, label }))
}

/**
 * The detail view's source from a read: the note (a heading and its text),
 * then its descendants as a nested list, each with its references as links
 * (`prefixes`: the outline's Work-ID prefixes). Cut on whole blocks to fit
 * Markdown's bound, saying the rest is in the outline.
 */
export function detailSourceOf(blocks: readonly { text: string; depth: number }[], prefixes: readonly string[], from: 'outliner' | 'ep0ch'): DetailSource {
  const chunks: string[] = []
  let size = 0
  let isTruncated = false
  for (const [i, block] of blocks.entries()) {
    const chunk = linkifyReferences(i === 0 ? noteMarkdown(block.text, true) : listItem(block.text, block.depth), prefixes).text
    if (size + chunk.length + 2 > MARKDOWN_BUDGET) {
      isTruncated = true
      // The note itself too long: its first lines, cut on a line.
      if (i === 0) chunks.push(chunk.slice(0, MARKDOWN_BUDGET).replace(/\n[^\n]*$/, ''))
      break
    }
    // The note's text, a blank line, then its descendants as one list.
    chunks.push(i === 1 ? `\n${chunk}` : chunk)
    size += chunk.length + 1
  }
  let markdown = chunks.join('\n')
  if (isTruncated) markdown += '\n\n_More of it is in the outline._'
  else if (from === 'ep0ch') markdown += '\n\n_The note alone: `ep0ch show --source` reads no children._'
  return { kind: 'source', markdown, links: linksOf(markdown), from, isTruncated }
}

/** What the detail view draws with: the surface's table. */
export type DetailElements = {
  Box: (p: any) => RenderElement
  Text: (p: any) => RenderElement
  Button: (p: any) => RenderElement
}

export type DetailModel = {
  history: DetailHistory
  source: DetailSource | undefined
  /** The note's BlockView: the door's cells on the terminal, Markdown with its links elsewhere. */
  body: RenderElement | null
  surface: RenderSurface
  /** The body's width. */
  columns: number
  /** The command that reads the note in any terminal: the copy button's. */
  command: string | null
  back: () => void
  forward: () => void
  copy: (surface: RenderSurface) => void
  /** Back to the mentions list. */
  list: () => void
  /** A reference pressed: opened in this pane. */
  follow: (href: string, surface: RenderSurface) => void
}

export const DETAIL_KEYS = 'ctrl+x tab: keys here and back · b back · f forward · l the mentions · c copy the command'

/** One line: control characters out, cut to `width` cells. */
const line = (s: string, width: number) => {
  const flat = s.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  return flat.length > width ? `${flat.slice(0, Math.max(1, width - 1))}…` : flat
}

/**
 * The detail view's tree: the note's title and where it opens, the controls
 * (back, forward, the mentions list, the command to copy), the note, and on
 * the terminal its references as buttons.
 */
export function detailTree(ui: DetailElements, m: DetailModel): RenderElement {
  const { Box, Button, Text } = ui
  const width = Math.max(20, m.columns - 2)
  const entry = currentOf(m.history)
  if (!entry) {
    return Box({ key: 'outliner-detail', flexDirection: 'column', children: [
      Text({ dimColor: true, children: `Nothing open: a mention or reference pressed ${OPENS_HERE}.` }),
      Button({ key: 'detail-list', hotkey: 'l', plain: true, label: 'mentions', onPress: () => m.list() }),
    ] })
  }
  const { at, entries } = m.history
  const controls = [
    Button({ key: 'detail-back', hotkey: 'b', plain: true, label: `← ${at > 0 ? line(entries[at - 1]!.title || 'back', 24) : 'mentions'}`, onPress: () => m.back() }),
    ...(at < entries.length - 1 ? [Button({ key: 'detail-forward', hotkey: 'f', plain: true, label: `${line(entries[at + 1]!.title || 'forward', 24)} →`, onPress: () => m.forward() })] : []),
    ...(m.command ? [Button({ key: 'detail-copy', hotkey: 'c', plain: true, label: 'copy the command', onPress: (press: { surface: RenderSurface }) => m.copy(press.surface) })] : []),
    ...(at > 0 ? [Button({ key: 'detail-list', hotkey: 'l', plain: true, label: 'mentions', onPress: () => m.list() })] : []),
  ]
  const source = m.source
  const links = m.surface === 'terminal' && source?.kind === 'source' ? source.links.slice(0, LINK_BUTTONS) : []
  return Box({
    key: 'outliner-detail', flexDirection: 'column', children: [
      Text({ bold: true, wrap: 'truncate-end', children: line(entry.title || entry.id, width) }),
      Text({ dimColor: true, wrap: 'truncate-end', children: `${OPENS_HERE}: no door or Herdr around${entries.length > 1 ? ` · ${at + 1} of ${entries.length}` : ''}` }),
      Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, marginBottom: 1, children: controls }),
      source === undefined
        ? Text({ dimColor: true, children: '  reading…' })
        : source.kind === 'missing'
          ? Text({ dimColor: true, children: `  (can't read it here: ${source.why})` })
          : m.body ?? Text({ dimColor: true, children: '  (empty)' }),
      ...(links.length
        ? [Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, marginTop: 1, children: [
            Text({ dimColor: true, children: 'links' }),
            ...links.map((link, i) => Button({ key: `detail-link-${i + 1}`, hotkey: String(i + 1), plain: true, label: line(link.label, 28), onPress: (press: { surface: RenderSurface }) => m.follow(link.href, press.surface) })),
          ] })]
        : []),
      ...(m.command ? [Text({ dimColor: true, wrap: 'truncate-end', children: `in any terminal: ${m.command}` })] : []),
      Text({ dimColor: true, wrap: 'truncate-end', children: DETAIL_KEYS }),
    ],
  })
}
