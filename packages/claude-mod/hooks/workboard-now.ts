/**
 * "Workboard now" (PIE-843): one screen of where the work stands, as a context block of the first prompt and again
 * after a compaction or `/clear`, for a session bound to an outline that has a workboard. Read from the service (the
 * Outliner CLI's `list --query`, the views' query grammar) and `gh`, never kept anywhere of the mod's own.
 *
 * This file is pure: the queries and argv, and the text from what they answered. register.ts runs them.
 */

export const WORKBOARD_BLOCK = 'workboardNow'
/** How long the whole read may take; past it the block is left out (a slow host never holds the first prompt longer). */
export const WORKBOARD_TIMEOUT_MS = 6000
/** How long `gh pr list` may take: open PRs are a nicety, left out when GitHub is slow. */
export const PRS_TIMEOUT_MS = 3000
/** Items shown per lane; the rest are counted. */
export const LANE_ROWS = 6

const STAGES = ['doing', 'review', 'validate'] as const
type Stage = (typeof STAGES)[number]

/**
 * The roadmap items in flight, and those waiting on the person (`needs::sysop`) in any stage but done or superseded.
 * One query, so one CLI run; the lanes are told apart from each row's properties.
 */
export const BOARD_QUERY = 'type=roadmap-item AND (work-stage=doing OR work-stage=review OR work-stage=validate OR (needs AND NOT work-stage=done AND NOT work-stage=superseded))'
/** Whether the outline keeps a workboard at all: asked only when nothing is in flight. */
export const ANY_ITEM_QUERY = 'type=roadmap-item'
export const BUILD_LOG_QUERY = 'type=build-log'

/** The Outliner CLI's `list` for a query (its argv after `cli.ts`). */
export function listArgs(query: string, limit: number, fields = 'id,title,properties'): string[] {
  return ['list', '--query', query, '--fields', fields, '--limit', String(limit)]
}

export const PRS_ARGV = ['gh', 'pr', 'list', '--state', 'open', '--limit', '20', '--json', 'number,title,headRefName,isDraft'] as const

/** A row of `list`: its properties as the service sends them, one entry per occurrence (never a key → value map). */
export type ListedBlock = { id: string; title: string; properties: { key: string; value: string }[]; text?: string; createdAt?: string; updatedAt?: string; parentId?: string; author?: string; actorId?: string }
/** A property's first value on a row, if it has one. */
const valueOf = (item: ListedBlock, key: string): string | undefined => item.properties.find(p => p.key === key)?.value
export type OpenPr = { number: number; title: string; branch: string; draft: boolean }

/** How many rows a read asks for: far more than a board holds, so the counts are whole (a cut read says so). */
export const LIST_LIMIT = 500

export type Listed = { blocks: ListedBlock[]; complete: boolean }

/**
 * `list`'s JSON as rows (properties as sent; the text, parent and writer when asked for) and whether the service said that was
 * all of them, or null when it isn't that.
 */
export function listedOf(stdout: string): Listed | null {
  let parsed: unknown
  try { parsed = JSON.parse(stdout) } catch { return null }
  const { blocks, completeness } = (parsed ?? {}) as { blocks?: unknown; completeness?: { kind?: unknown } }
  if (!Array.isArray(blocks)) return null
  return { complete: completeness?.kind === 'complete', blocks: blocks.flatMap((b): ListedBlock[] => {
    if (!b || typeof b.id !== 'string') return []
    const properties = (Array.isArray(b.properties) ? b.properties : []).flatMap((p: { key?: unknown; value?: unknown }) => (typeof p?.key === 'string' && typeof p.value === 'string' ? [{ key: p.key, value: p.value }] : []))
    return [{ id: b.id, title: typeof b.title === 'string' ? b.title : '', properties, ...(typeof b.text === 'string' ? { text: b.text } : {}), ...(typeof b.createdAt === 'string' ? { createdAt: b.createdAt } : {}), ...(typeof b.updatedAt === 'string' ? { updatedAt: b.updatedAt } : {}), ...(typeof b.parentId === 'string' ? { parentId: b.parentId } : {}), ...(typeof b.author === 'string' ? { author: b.author } : {}), ...(typeof b.actorId === 'string' ? { actorId: b.actorId } : {}) }]
  }) }
}

/** `gh pr list --json`'s answer, or null when it isn't one. */
export function openPrsOf(stdout: string): OpenPr[] | null {
  let parsed: unknown
  try { parsed = JSON.parse(stdout) } catch { return null }
  if (!Array.isArray(parsed)) return null
  return parsed.flatMap((p): OpenPr[] => typeof p?.number === 'number'
    ? [{ number: p.number, title: String(p.title ?? ''), branch: String(p.headRefName ?? ''), draft: p.isDraft === true }]
    : [])
}

export type WorkboardFacts = {
  outline: string
  items: ListedBlock[]
  /** Whether `items` is every one the query matched; a cut read's counts are said to be partial. */
  itemsComplete?: boolean
  /** The build logs, in any order: the newest created is the one shown. */
  logs: ListedBlock[]
  /** Null: `gh` didn't answer (not installed, not a GitHub folder, too slow). */
  prs: OpenPr[] | null
}

/** One line: control characters become spaces, and a long title is cut with an ellipsis. */
function clip(s: string, max: number): string {
  const line = s.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/** An item's label: its title (which leads with its Work ID), else its Work ID, else its id. */
function itemLabel(item: ListedBlock): string {
  return clip(item.title || valueOf(item, 'work-id') || item.id, 90)
}

/** Whether an item waits on the person: `needs::sysop`, or `needs::sysop: <why>`. */
export function waitsOnPerson(item: ListedBlock): boolean {
  return /^sysop\b/i.test(valueOf(item, 'needs') ?? '')
}

function lane<T>(name: string, items: readonly T[], line: (item: T) => string): string[] {
  if (!items.length) return []
  const shown = items.slice(0, LANE_ROWS).map(i => `  - ${line(i)}`)
  const more = items.length > LANE_ROWS ? [`  - and ${items.length - LANE_ROWS} more`] : []
  return [`- ${name} (${items.length}):`, ...shown, ...more]
}

/**
 * The block's text, or null for an outline with no workboard (no roadmap items and no build log). `hasItems` says
 * whether the outline has any roadmap item at all, asked only when none is in flight.
 */
export function workboardText(facts: WorkboardFacts, hasItems: boolean): string | null {
  const latest = [...facts.logs].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0]
  if (!facts.items.length && !hasItems && !latest) return null
  const byStage = (stage: Stage) => facts.items.filter(i => valueOf(i, 'work-stage') === stage)
  const waiting = facts.items.filter(waitsOnPerson)
  const lines = [
    `The ${facts.outline} workboard as this conversation started (read from the outline; it moves, so read an item again before acting on it):`,
    latest ? `- latest build log: ${clip(latest.title, 60)} ((${latest.id}))` : '- no build log yet',
    ...lane('doing', byStage('doing'), itemLabel),
    ...lane('review', byStage('review'), itemLabel),
    ...lane('validate', byStage('validate'), itemLabel),
    ...lane('waiting on the person (needs::sysop)', waiting, i => {
      const why = (valueOf(i, 'needs') ?? '').replace(/^sysop\s*:?\s*/i, '')
      return `${clip(valueOf(i, 'work-id') || i.title || i.id, 60)}${why ? `: ${clip(why, 80)}` : ''}`
    }),
  ]
  if (!STAGES.some(s => byStage(s).length)) lines.push('- nothing in doing, review or validate')
  if (facts.itemsComplete === false) lines.push(`- (the read stopped at ${facts.items.length} items: the counts are partial)`)
  if (facts.prs) {
    lines.push(...(facts.prs.length
      ? lane('open PRs', facts.prs, p => `#${p.number} ${clip(p.title, 70)} (${clip(p.branch, 40)}${p.draft ? ', draft' : ''})`)
      : ['- no open PRs']))
  }
  return lines.join('\n')
}
