import type { RenderElement, RenderSurface } from 'claude-code'

import type { DetailBeside, MentionRow, MentionsList, MentionsPlacement, MentionsPrefs } from '../types'
import type { BlockViewElements } from './block-view'
import { OPENS_HERE, routeOf } from './detail-view'
import { MENTIONS_AGENT } from './mention-message'

/**
 * Recent mentions inside Claude Code: the blocks this conversation's answers
 * mentioned (`[[page]]`, `((id))`, Work IDs), as the outline recorded them
 * through `mentions.ingest`. It reads the same retained history Tree and
 * Detail show under "Recent mentions" (`outliner mentions list`, the
 * service's `mentions.list`), never a list of its own.
 *
 * Where: a compact band above the prompt, or a fuller pane beside the
 * transcript; the person picks (`m`, or `/mentions band|pane|off`), and the
 * choice is kept across sessions. Each mention can show a small preview of
 * its block, drawn by the door's renderer (BlockView; `p` toggles). A press
 * opens the block through the mod's one open (`openNote`): in the door this
 * session runs in, else the Outliner Detail beside Claude in Herdr, else here,
 * in the mod's detail pane (hooks/detail-view.ts). Every action is a Button with a hotkey, so it works by mouse
 * and by keys once the band or pane holds them (ctrl+x tab, or a click); the
 * pane never opens with focus, so the prompt keeps the keys.
 *
 * This file is the pure half (what to ask, what an answer means, the tree);
 * the hooks module (register.ts) holds the state and runs the commands, since
 * only it is handed `$`.
 */

export const PANE_ID = 'outliner-mentions'
/** Where the person's choices are kept across sessions. */
export const PREFS_STORE_KEY = 'mentions-view'
/** At most this many mentions: one hotkey each, 1 to 9. */
export const MENTION_LIMIT = 9

/** Lines of a block's text kept, for where the door can't draw it: the most a preview shows. */
const TEXT_LINES = 8

export const DEFAULT_PREFS: MentionsPrefs = { placement: 'band', previews: false, scope: 'conversation' }

/** The kept choices, each field checked: anything else is the default. */
export function prefsOf(stored: unknown): MentionsPrefs {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  return {
    placement: s.placement === 'pane' || s.placement === 'off' || s.placement === 'band' ? s.placement : DEFAULT_PREFS.placement,
    previews: typeof s.previews === 'boolean' ? s.previews : DEFAULT_PREFS.previews,
    scope: s.scope === 'workspace' ? 'workspace' : 'conversation',
  }
}

/** The `outliner mentions list` arguments for a scope. */
export function mentionsListArgs(scope: MentionsPrefs['scope'], sessionId: string): string[] {
  return ['mentions', 'list', '--limit', String(MENTION_LIMIT), ...(scope === 'conversation' ? ['--agent', MENTIONS_AGENT, '--session', sessionId] : [])]
}

/** `outliner mentions list`'s entries as rows; [] for anything that isn't its answer. */
export function mentionRowsOf(stdout: string): MentionRow[] {
  let parsed: unknown
  try { parsed = JSON.parse(stdout) } catch { return [] }
  const entries = (parsed as { entries?: unknown } | null)?.entries
  if (!Array.isArray(entries)) return []
  return entries.slice(0, MENTION_LIMIT).flatMap((entry: Record<string, any>): MentionRow[] => {
    if (!entry || typeof entry.address !== 'string') return []
    const block = entry.block && typeof entry.block.id === 'string' ? entry.block : null
    return [{
      id: block?.id ?? null,
      revision: Number.isInteger(block?.revision) ? block.revision : null,
      title: typeof entry.title === 'string' && entry.title ? entry.title : entry.address,
      address: entry.address,
      // Only what a text preview can show: the state holds nine of these and every draw reads them.
      text: typeof block?.text === 'string' ? block.text.split('\n').slice(0, TEXT_LINES).join('\n') : '',
      mentionedAt: typeof entry.mentionedAt === 'string' ? entry.mentionedAt : '',
      excerpt: typeof entry.excerpt === 'string' ? entry.excerpt : '',
      ...(block ? {} : { unavailable: typeof entry.unavailableReason === 'string' ? entry.unavailableReason : 'no longer available' }),
    }]
  })
}

/**
 * Where a press opens a block, as the person reads it (openNote's order).
 * `beside`: what the Outliner's `find-detail` found beside Claude in its Herdr
 * workspace (the Detail a press reuses), unknown until it answers.
 */
export function opensIn(env: { EP0CH_CONTROL?: string | undefined; HERDR_PANE_ID?: string | undefined; HERDR_WORKSPACE_ID?: string | undefined }, beside?: DetailBeside): string {
  const route = routeOf(env)
  if (route === 'door') return 'opens in this door'
  if (route === 'herdr') {
    if (beside?.found === 'refused') return `can't open beside you: ${beside.why}`
    return beside?.found === 'detail' ? 'opens in the Outliner Detail beside you' : 'opens in a new Outliner Detail beside you'
  }
  return `${OPENS_HERE}, in a detail pane`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `HH:MM` of an ISO time, in local time; '' for anything else. */
export function clockOf(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** One line: control characters out, cut to `width` cells. */
const line = (s: string, width: number) => {
  const flat = s.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  return flat.length > width ? `${flat.slice(0, Math.max(1, width - 1))}…` : flat
}

/**
 * The choices a word of `/mentions` makes, or null for a word it doesn't know. `places` is whether the word is
 * about where the mentions are (`band`, `pane`, `off`, or none): only those open or close anything. `preview` and
 * `scope` change what is shown and leave the band or pane where it is.
 */
export function commandChoice(args: string): { change: (p: MentionsPrefs) => MentionsPrefs; places: boolean } | null {
  const word = args.trim().toLowerCase()
  const placements: Record<string, MentionsPlacement> = { band: 'band', pane: 'pane', off: 'off', hide: 'off' }
  const placement = placements[word]
  if (placement) return { change: p => ({ ...p, placement }), places: true }
  if (word === 'preview' || word === 'previews') return { change: p => ({ ...p, previews: !p.previews }), places: false }
  if (word === 'scope' || word === 'all') return { change: p => ({ ...p, scope: p.scope === 'conversation' ? 'workspace' : 'conversation' }), places: false }
  if (word === '') return { change: p => (p.placement === 'off' ? { ...p, placement: 'band' } : p), places: true }
  return null
}

export const COMMAND_USAGE = 'Usage: /mentions [band | pane | off | preview | scope]'

/** What `/mentions` answers once its choice is made. `placed`: whether a chosen pane is on screen (else the band stands in). */
export const choicesText = (p: MentionsPrefs, placed = true): string =>
  `Recent mentions: ${p.placement === 'off' ? 'hidden' : p.placement === 'pane' && !placed ? 'in the band, standing in for the pane (not on screen yet; m shows it)' : `in the ${p.placement}`}, previews ${p.previews ? 'on' : 'off'}, ${p.scope === 'conversation' ? 'this conversation' : 'all conversations'}.`

/** How many rows a preview takes: a few in the band, more in the pane. */
export const PREVIEW_ROWS = { band: 6, pane: 8 } as const

/** A preview sits under its entry (indented in the pane, after its number in the band): as wide as what's left of the body. */
export const previewWidthOf = (site: 'band' | 'pane', columns: number): number => Math.max(20, site === 'pane' ? columns - 4 : columns - 3)

/** Whether the band has anything to say: mentions, or a note or reason. An empty one leaves the slot to others. */
export const bandHasContent = (list: MentionsList): boolean => list.rows.length > 0 || !!list.note || !!list.why

/** Which rows get a preview (by index): none with previews off; in the band, the newest two that resolve. */
export function previewedRows(site: 'band' | 'pane', prefs: MentionsPrefs, rows: readonly MentionRow[]): number[] {
  if (!prefs.previews) return []
  const resolved = rows.flatMap((row, i) => (row.id ? [i] : []))
  return site === 'band' ? resolved.slice(0, 2) : resolved
}

/** What the band and pane draw with: the surface's table. */
export type SiteElements = BlockViewElements & { Box: (p: any) => RenderElement; Button: (p: any) => RenderElement }

export type MentionsModel = {
  site: 'band' | 'pane'
  /** The body's width (`bodyColumns`). */
  columns: number
  prefs: MentionsPrefs
  list: MentionsList
  /** Where a press opens, as `opensIn` says it. */
  opens: string
  /** Each previewed row's BlockView, by row index. */
  previews: ReadonlyMap<number, RenderElement>
  /** A mention pressed (its button or hotkey), on the surface that pressed it. */
  open: (row: MentionRow, surface: RenderSurface) => void
  /** A control pressed: the choices it makes. */
  choose: (change: (p: MentionsPrefs) => MentionsPrefs) => void
}

/**
 * The engine's keys for the band and the pane, as their hint lines say them: ctrl+x tab moves the keys to the
 * band or pane and back to the prompt (Esc hands them back too); there Tab and the arrows move, Enter or a
 * hotkey presses. ctrl+x ctrl+a folds the band; ctrl+x x closes the pane (kept hidden until /mentions pane).
 */
export const BAND_KEYS = 'ctrl+x tab: keys here and back · tab/arrows move · enter or 1-9 opens · ctrl+x ctrl+a: fold'
export const PANE_KEYS = 'ctrl+x tab: keys here and back · tab/arrows move · enter or 1-9 opens · ctrl+x x: close · /mentions pane: show it again'

/** The band's or the pane's tree: the mentions as buttons (hotkeys 1 to 9), their previews, and the controls. */
export function mentionsTree(ui: SiteElements, m: MentionsModel): RenderElement {
  const { Box, Button, Text } = ui
  const { site, prefs: p, list } = m
  const width = Math.max(20, m.columns - 2)
  const controls = [
    Button({ key: 'mentions-previews', hotkey: 'p', plain: true, label: p.previews ? 'previews off' : 'previews', onPress: () => m.choose(x => ({ ...x, previews: !x.previews })) }),
    Button({ key: 'mentions-scope', hotkey: 's', plain: true, label: p.scope === 'conversation' ? 'all conversations' : 'this conversation', onPress: () => m.choose(x => ({ ...x, scope: x.scope === 'conversation' ? 'workspace' : 'conversation' })) }),
    // register.ts's ui.press hook takes this press and moves it: an open from the press is the person's, placed at any
    // width, where one from this closure would be the plugin's own. In the band standing in for a waiting pane, `m`
    // shows the pane.
    Button({ key: 'mentions-move', hotkey: 'm', plain: true, label: site === 'pane' ? 'to band' : p.placement === 'pane' ? 'show pane' : 'to pane', onPress: () => {} }),
    Button({ key: 'mentions-hide', hotkey: 'x', plain: true, label: 'hide', onPress: () => m.choose(x => ({ ...x, placement: 'off' })) }),
  ]
  const heading = `Mentioned${p.scope === 'workspace' ? ' (all conversations)' : ''}`
  const entry = (row: MentionRow, i: number) => row.id
    ? Button({ key: `mention-${i + 1}`, hotkey: String(i + 1), plain: true, label: line(row.title, site === 'band' ? 28 : width - 3), onPress: (press: { surface: RenderSurface }) => m.open(row, press.surface) })
    : Text({ dimColor: true, children: `${i + 1}: ${line(row.title, 24)} (gone)` })
  const empty = list.why ? `(${line(list.why, width - 2)})` : list.loaded ? '(nothing mentioned yet)' : '(reading…)'

  if (site === 'band') {
    // Which mention each preview is: its number, beside the drawing.
    const numbered = [...m.previews].map(([i, preview]) => Box({ flexDirection: 'row', children: [Box({ width: 2, flexShrink: 0, children: Text({ dimColor: true, children: String(i + 1) }) }), preview] }))
    return Box({
      key: 'mentions-band', flexDirection: 'column', children: [
        Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: [
          Text({ dimColor: true, children: heading }),
          ...(list.rows.length ? list.rows.map(entry) : [Text({ dimColor: true, children: empty })]),
          ...controls,
        ] }),
        ...(list.note ? [Text({ dimColor: true, children: list.note })] : []),
        ...numbered,
        Text({ dimColor: true, wrap: 'truncate-end', children: BAND_KEYS }),
      ],
    })
  }
  const items = list.rows.map((row, i) => {
    const preview = m.previews.get(i)
    // What the answer wrote, unless that is the block's id or its title; when, in local time; and the words around it.
    const written = row.address !== row.title && !UUID.test(row.address) ? row.address : ''
    const about = [written, clockOf(row.mentionedAt), row.excerpt, row.unavailable ?? '']
    return Box({
      key: `mention-row-${i + 1}`, flexDirection: 'column', marginBottom: 1, children: [
        entry(row, i),
        Text({ dimColor: true, wrap: 'truncate-end', children: `   ${line(about.filter(Boolean).join(' · '), width - 3)}` }),
        ...(preview ? [Box({ paddingLeft: 3, children: preview })] : []),
      ],
    })
  })
  // The mentions before the controls: Tab and the arrows reach them first, as in the band.
  return Box({
    key: 'mentions-pane', flexDirection: 'column', children: [
      Box({ marginBottom: 1, children: Text({ bold: true, children: `${heading} · ${m.opens}` }) }),
      ...(list.note ? [Box({ marginBottom: 1, children: Text({ dimColor: true, children: list.note }) })] : []),
      ...(items.length ? items : [Box({ marginBottom: 1, children: Text({ dimColor: true, children: empty }) })]),
      Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: controls }),
      Text({ dimColor: true, children: PANE_KEYS }),
    ],
  })
}
