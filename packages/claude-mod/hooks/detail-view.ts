import type { RenderElement, RenderSurface } from 'claude-code'

import type { DetailEntry, DetailHistory, DetailLink, DetailSource } from '../types'
import { linkifyReferences } from './references'
import { COMPONENT_OPEN, componentBlocks } from './component-block'

/**
 * The detail view: where a note opens when neither a door nor Herdr is around
 * (the desktop app's Code tab, VS Code, a terminal outside Herdr). It is the
 * third case of the mod's one open (`openNote` in register.ts), after the door
 * and Herdr; never a router of its own. It is the mentions pane's other face:
 * the pane shows the note in place of the list, and back returns to the list
 * (a pane opened beside it would be a tab behind it, out of sight).
 *
 * The note is drawn by BlockView, one renderer per surface: the door's cells
 * on the terminal, Markdown elsewhere. The Markdown is the door's own export of
 * the note and its children (`ep0ch export <id> --children`, PIE-534: the body
 * verbatim, children as nested lists), or, where no usable `ep0ch` is on PATH,
 * the outliner's read (`outliner list --subtree <id>`) laid out the same way;
 * its references become links. A link pressed navigates within the pane, with
 * history: back and forward. On the terminal, whose cells hold no links, the
 * references are buttons under the drawing.
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

/** `ep0ch help` lists `export`: this ep0ch writes a note and its children as Markdown. */
export const knowsExport = (help: string): boolean => /^\s*ep0ch export\b/m.test(help)

/** The `ep0ch export` argv: the note and everything under it, as Markdown, to stdout. */
export const exportArgv = (id: string): string[] => ['ep0ch', 'export', id, '--children', '--format', 'md', '--out', '-']

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
 * Markdown as the pane shows it: the note's first line a heading (unless it is
 * one), and each `::component` (a live figure, which only the door draws live)
 * as code: one with a body (`::graph-table` … `::`, where outline-core's rule
 * says it ends) fenced under its name, a one-line kind (`::links`,
 * `::backlinks`) as an inline code line.
 */
export function displayMarkdown(text: string): string {
  const lines = text.split('\n')
  const blocks = new Map(componentBlocks(lines).map(c => [c.start, c]))
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (i === 0 && line.trim() && !/^#{1,6}\s/.test(line)) { out.push(`# ${line.trim()}`); continue }
    const block = blocks.get(i)
    if (block && block.end > i) {
      // Its fence is longer than any inside it, so a code example in the figure stays inside.
      const body = lines.slice(i + 1, block.end)
      const longest = Math.max(2, ...body.map(l => /^\s*(`+)/.exec(l)?.[1]!.length ?? 0))
      const fence = '`'.repeat(longest + 1)
      out.push(fence + block.name, ...body, fence)
      i = block.end
      continue
    }
    const open = !block && COMPONENT_OPEN.exec(line)
    out.push(open && !open[2] ? `\`::${open[1]}\`` : line)
  }
  return out.join('\n')
}

/** `ep0ch export`'s Markdown without its front matter (the note's identity): the body and its children. */
export function exportBodyOf(stdout: string): string | null {
  const body = stdout.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/\s+$/, '')
  return body.trim() ? body : null
}

/**
 * `outliner list --subtree <id>`' answer laid out as the export lays a note
 * out: its text, a blank line, then its descendants as nested list items, in
 * the order and depth the service gives. Null for anything that isn't one.
 */
export function subtreeMarkdownOf(stdout: string, id: string): { markdown: string; isTruncated: boolean } | null {
  let parsed: unknown
  try { parsed = JSON.parse(stdout) } catch { return null }
  const { blocks, completeness } = (parsed ?? {}) as { blocks?: unknown; completeness?: { kind?: unknown } }
  if (!Array.isArray(blocks)) return null
  const [root, ...rest] = blocks as { id?: unknown; text?: unknown; depth?: unknown }[]
  if (!root || root.id !== id || typeof root.text !== 'string') return null
  const items = rest.flatMap(b => {
    if (typeof b?.text !== 'string') return []
    const indent = '  '.repeat(Math.max(0, (Number(b.depth) || 1) - 1))
    const [first = '', ...more] = b.text.replace(/\n+$/, '').split('\n')
    return [[`${indent}- ${first}`, ...more.map(line => (line ? `${indent}  ${line}` : ''))].join('\n')]
  })
  const markdown = [root.text.replace(/\n+$/, ''), ...(items.length ? ['', ...items] : [])].join('\n')
  return { markdown, isTruncated: completeness?.kind !== undefined && completeness.kind !== 'complete' }
}

/** Every stand-in link in linkified Markdown, once each, with its text. */
export function linksOf(markdown: string): DetailLink[] {
  const seen = new Map<string, string>()
  for (const m of markdown.matchAll(/\[((?:\\.|[^\]\\\n])*)\]\((https:\/\/pi-outliner\.invalid\/[^)\s]+)\)/g)) {
    if (!seen.has(m[2]!)) seen.set(m[2]!, m[1]!.replace(/\\(.)/g, '$1'))
  }
  return [...seen].map(([href, label]) => ({ href, label }))
}

/** What Markdown can't hold: escape sequences and control characters other than tab and newline. */
const sanitized = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')

/**
 * The detail view's source from a read: shown as `displayMarkdown` lays it
 * out, its references as links (`prefixes`: the outline's Work-ID prefixes),
 * cut on a whole line to fit Markdown's bound, saying the rest is in the
 * outline (as when the read itself was cut short).
 */
export function detailSourceOf(markdown: string, prefixes: readonly string[], from: 'ep0ch' | 'outliner', isCut = false): DetailSource {
  let text = linkifyReferences(displayMarkdown(sanitized(markdown)), prefixes).text
  let isTruncated = isCut
  if (text.length > MARKDOWN_BUDGET) {
    isTruncated = true
    const cut = text.lastIndexOf('\n', MARKDOWN_BUDGET)
    text = text.slice(0, cut > 0 ? cut : MARKDOWN_BUDGET)
  }
  if (isTruncated) text += '\n\n_More of it is in the outline._'
  return { kind: 'source', markdown: text, links: linksOf(text).slice(0, 256), from, isTruncated }
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
