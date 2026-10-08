import type { MarkdownProps, RenderElement, RenderSurface, TextProps } from 'claude-code'

import type { ToolRowsPrefs } from '../types'

/**
 * The mod's own outline and workboard tool calls, redrawn in the transcript as
 * one compact row each, so a write reads as what it did and can be spot-checked
 * in place: a verb glyph, the note it touched (pressed, it opens where every
 * reference opens: `openNote`), and the change (`✎ PIE-569 · appended "Inside
 * or outside…" · rev 1→2`). A write's row folds open (`▸`/`▾`) on what it
 * wrote, as Markdown: the appended text, the diff, the new body, the comment.
 * A read is one quiet line.
 *
 * This file is the pure half (what a call's input and output say, and the
 * tree); register.ts holds the folded state and the titles it looked up, and
 * draws it only for these tools. Anything it doesn't recognise is null, and the
 * engine draws its own row.
 */

/** How the mod's tools are named in the transcript: `mcp__<plugin>__<name>`. */
export const TOOL_PREFIX = 'mcp__pi-outliner__'
/** Where the person's choice (on or off) is kept across sessions. */
export const TOOL_ROWS_STORE_KEY = 'tool-rows'
/** The command that turns the rows on and off. */
export const TOOL_ROWS_COMMAND = 'tool-rows'
export const TOOL_ROWS_USAGE = 'Usage: /tool-rows [on | off]. On draws the outline and workboard tool calls as compact rows that fold open on what they wrote; off leaves Claude Code\'s own rows.'

/** An unfolded row shows at most this many lines of what it wrote, then says how many more. */
export const DETAIL_LINES = 40
/** Markdown's own cap is 10,000 characters: kept well under it. */
const DETAIL_CHARS = 8000
/** A quoted first line in the row: at most this many characters. */
const QUOTE_CHARS = 48

export const WRITE_TOOLS = [
  'outline_edit', 'outline_patch', 'outline_set_property', 'outline_assign_id', 'outline_create', 'outline_comment', 'outline_reply', 'outline_resolve_thread',
  'note_section', 'work_create', 'work_set', 'work_stage', 'work_body', 'work_deliver', 'work_complete', 'view_order',
] as const
export const READ_TOOLS = ['outline_read', 'outline_find', 'outline_changes', 'outline_resolve', 'show'] as const
/**
 * Claude Code's own file tools whose rows the mod draws too (PIE-602): the file and the lines added and removed, the
 * file pressed opens it (and `diff` its changes) where a note opens, and the row folds open on the diff.
 */
export const FILE_TOOLS = ['Edit', 'Write'] as const
/** A row target that is a file on this machine, not a note: `file:<absolute path>`; its changes, `file-diff:<path>`. */
export const FILE_REF = 'file:'
export const FILE_DIFF_REF = 'file-diff:'
/** Lines in a file's text: none for an empty one, the last line counted without its newline. */
const lineCount = (text: string) => (text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0)

export const DEFAULT_TOOL_ROWS: ToolRowsPrefs = { enabled: true }

export function toolRowsPrefsOf(stored: unknown): ToolRowsPrefs {
  const enabled = (stored as { enabled?: unknown } | null | undefined)?.enabled
  return { enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_TOOL_ROWS.enabled }
}

/** `/tool-rows on|off`: the new choice, null for anything else (the usage is said). */
export function toolRowsCommandOf(args: string): ToolRowsPrefs | null {
  const word = args.trim().toLowerCase()
  return word === 'on' ? { enabled: true } : word === 'off' ? { enabled: false } : null
}

/** The props of a `ToolUse` row this file reads. */
export type ToolCallView = {
  tool: string
  input: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
  output?: unknown
}

/** The note a row names: what to show, and the reference `openNote` opens. */
export type RowTarget = { label: string; ref: string }

export type ToolRow = {
  kind: 'write' | 'read'
  glyph: string
  /** Words before the target (`comment on`), if any. */
  lead?: string
  target: RowTarget | null
  /** A second thing to open after the target (a file's `diff`), drawn as its own button. */
  also?: RowTarget
  /** What happened, after the target, joined with ` · `. */
  change: string[]
  state: 'running' | 'done' | 'errored' | 'interrupted'
  /** The error the model read, for an errored call. */
  error?: string
  /** A warning beside a done write (`proposed: …`, `dropped [page::x]`). */
  warning?: string
  /** What the row folds open on, as Markdown; absent when there's nothing to show. */
  detail?: string
}

/** A block id's title, when register.ts has looked it up. */
export type TitleOf = (id: string) => string | undefined

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WORK_ID = /^[A-Z][A-Z0-9]*-\d+$/

/** The tool's short name (`outline_edit`) for one of the mod's rows drawn here, else null. */
export function modToolOf(tool: string): string | null {
  if (!tool.startsWith(TOOL_PREFIX)) return null
  const name = tool.slice(TOOL_PREFIX.length)
  return (WRITE_TOOLS as readonly string[]).includes(name) || (READ_TOOLS as readonly string[]).includes(name) ? name : null
}

/** The block id a reference names (`uuid`, `((uuid))`, `((uuid|label))`), lowercased; null for a Work ID or page. */
export function blockIdOfRef(ref: string): string | null {
  const text = ref.trim()
  const inner = /^\(\(([^|)]+)(?:\|[^)]*)?\)\)$/.exec(text)?.[1] ?? text
  return UUID.test(inner) ? inner.toLowerCase() : null
}

/** A reference as the person reads it: a Work ID, a page's name, a block's title (or its short id until looked up). */
export function targetOf(ref: unknown, titleOf: TitleOf = () => undefined): RowTarget | null {
  if (typeof ref !== 'string' || !ref.trim()) return null
  const text = ref.trim()
  if (WORK_ID.test(text)) return { label: text, ref: text }
  const page = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(text)
  if (page) return { label: (page[2] ?? page[1]!).trim(), ref: text }
  const id = blockIdOfRef(text)
  if (id) {
    const labelled = /^\(\([^|)]+\|([^)]+)\)\)$/.exec(text)?.[1]?.trim()
    return { label: clip(labelled || titleOf(id) || `((${id.slice(0, 8)}…))`, QUOTE_CHARS), ref: id }
  }
  // A page address given bare, as `outlinerUriFor` reads it.
  return { label: clip(text, QUOTE_CHARS), ref: text }
}

/** The block ids a row would show by title: register.ts looks them up off the draw. */
export function idsToTitle(view: ToolCallView): string[] {
  const name = modToolOf(view.tool)
  const input = recordOf(view.input)
  if (!name || !input) return []
  const refs = [input.ref, input.item, input.reference, input.id, input.block, input.parent, input.view]
  return [...new Set(refs.flatMap(ref => (typeof ref === 'string' ? [blockIdOfRef(ref)] : [])).filter((id): id is string => !!id))]
}

/** The tool's answer as a value: the JSON the mod's tools return, as a string or text blocks; null when it isn't JSON. */
export function outputJsonOf(output: unknown): Record<string, unknown> | null {
  if (output && typeof output === 'object' && !Array.isArray(output) && !('content' in output)) return output as Record<string, unknown>
  const text = outputTextOf(output)
  if (!text) return null
  for (const candidate of [text, text.slice(text.lastIndexOf('\n{') + 1)]) {
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      // Not JSON as a whole: the last object line, then nothing.
    }
  }
  return null
}

/** The tool's answer as the model read it: a string, text blocks (bare or under `content`), else its JSON. */
export function outputTextOf(output: unknown): string {
  if (output === undefined || output === null) return ''
  if (typeof output === 'string') return output
  const blocks = Array.isArray(output) ? output : Array.isArray((output as { content?: unknown }).content) ? (output as { content: unknown[] }).content : null
  if (blocks) return blocks.map(b => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : '')).join('\n')
  try { return JSON.stringify(output) } catch { return String(output) }
}

/**
 * The row for one of the mod's tool calls, or null to leave the engine's (not
 * the mod's tool, or an input it can't read). Never throws on any input shape.
 */
export function toolRowOf(view: ToolCallView, titleOf: TitleOf = () => undefined): ToolRow | null {
  const name = modToolOf(view.tool)
  const input = recordOf(view.input)
  if (!name || !input) return null
  const out = view.isErrored || view.isRunning ? null : outputJsonOf(view.output)
  const base = describe(name, input, out, titleOf)
  if (!base) return null
  const state = view.isInterrupted ? 'interrupted' : view.isErrored ? 'errored' : view.isRunning ? 'running' : 'done'
  const row: ToolRow = { ...base, state }
  if (state === 'errored') row.error = clip(firstLine(outputTextOf(view.output)).replace(/^Error:\s*/, ''), 160) || 'the call failed'
  return row
}

type Described = Omit<ToolRow, 'state' | 'error'>

function describe(name: string, input: Record<string, unknown>, out: Record<string, unknown> | null, titleOf: TitleOf): Described | null {
  const rev = revisionChange(out)
  switch (name) {
    case 'outline_edit': {
      const target = targetOf(input.ref, titleOf)
      if (!target) return null
      const dropped = Array.isArray(out?.dropped) && out.dropped.length ? `dropped ${out.dropped.join(', ')}` : undefined
      const diff = typeof out?.diff === 'string' && out.diff ? fenced(out.diff, 'diff') : undefined
      const section = recordOf(input.replaceSection)
      let change: string
      let detail: string | undefined
      if (typeof input.append === 'string') {
        change = `appended ${quoted(input.append)}`
        detail = input.append.replace(/^\n+/, '')
      } else if (section && typeof section.heading === 'string') {
        change = `replaced § ${clip(section.heading.replace(/^#+\s*/, ''), QUOTE_CHARS)}`
        detail = diff ?? (typeof section.body === 'string' ? section.body : undefined)
      } else if (typeof input.text === 'string') {
        change = 'rewrote the note'
        detail = diff ?? input.text
      } else return null
      if (typeof out?.revision === 'number' && out.revision === out.previousRevision) change += ' (no change)'
      return { kind: 'write', glyph: '✎', target, change: [change, ...rev], ...(dropped ? { warning: dropped } : {}), ...(detail ? { detail } : {}) }
    }
    case 'outline_patch': {
      const target = targetOf(input.ref, titleOf)
      const patches = Array.isArray(input.patches) ? input.patches.map(recordOf).filter((p): p is Record<string, unknown> => !!p) : []
      if (!target || !patches.length) return null
      const change = [`patched ${patches.length === 1 ? quoted(String(patches[0]!.observed ?? '')) : `${patches.length} spans`}`]
      let warning: string | undefined
      if (out?.outcome === 'applied') change.push(Array.isArray(out.edits) && recordOf(out.edits[0])?.route === 'draft' ? 'applied to the live draft' : 'applied')
      if (out?.outcome === 'proposed') warning = `proposed, not applied: ${clip(String(out.reason ?? ''), 80)}`
      const detail = fenced(patches.map(p => [...lines(String(p.observed ?? '')).map(l => `-${l}`), ...lines(String(p.replacement ?? '')).map(l => `+${l}`)].join('\n')).join('\n'), 'diff')
      return { kind: 'write', glyph: '✎', target, change, ...(warning ? { warning } : {}), detail }
    }
    case 'outline_set_property': {
      const target = targetOf(input.ref, titleOf)
      if (!target || typeof input.key !== 'string' || typeof input.value !== 'string') return null
      const change = [`set [${input.key}::${clip(input.value, QUOTE_CHARS)}]`]
      let warning: string | undefined
      if (out?.outcome === 'unchanged') change.push('(no change)')
      if (out?.outcome === 'applied') change.push(Array.isArray(out.edits) && recordOf(out.edits[0])?.route === 'draft' ? 'applied to the live draft' : 'applied')
      if (out?.outcome === 'proposed') warning = `proposed, not applied: ${clip(String(out.reason ?? ''), 80)}`
      return { kind: 'write', glyph: '✎', target, change, ...(warning ? { warning } : {}) }
    }
    case 'outline_assign_id': {
      const target = targetOf(input.ref, titleOf)
      if (!target) return null
      const id = typeof out?.workId === 'string' ? out.workId : null
      const change = [id ? `id ${id}` : 'assign an id']
      if (out?.outcome === 'unchanged') change.push('(already had it)')
      return { kind: 'write', glyph: '✎', target, change }
    }
    case 'outline_create': {
      if (typeof input.text !== 'string') return null
      const parent = targetOf(input.parent === 'root' ? undefined : input.parent, titleOf)
      // Once made, the new block is the target (pressed, it opens); until then its first line is quoted.
      const created = typeof out?.id === 'string' ? { label: quoted(input.text), ref: out.id } : null
      return {
        kind: 'write', glyph: '+', target: created,
        ...(created ? {} : { lead: quoted(input.text) }),
        change: ['created', parent ? `under ${parent.label}` : input.parent === 'root' ? 'at the top' : ''].filter(Boolean),
        detail: input.text,
      }
    }
    case 'outline_comment': {
      const target = targetOf(input.ref, titleOf)
      if (!target || typeof input.body !== 'string') return null
      const on = typeof input.quote === 'string' ? `on ${quoted(input.quote)}` : 'on the whole note'
      const quote = typeof input.quote === 'string' ? `${input.quote.split('\n').map(l => `> ${l}`).join('\n')}\n\n` : ''
      return { kind: 'write', glyph: '💬', lead: 'comment on', target, change: [on, quoted(input.body)], detail: `${quote}${input.body}` }
    }
    case 'outline_reply': {
      if (typeof input.thread !== 'string' || typeof input.body !== 'string') return null
      return { kind: 'write', glyph: '💬', lead: 'reply in', target: threadTarget(input.thread), change: [quoted(input.body)], detail: input.body }
    }
    case 'outline_resolve_thread': {
      if (typeof input.thread !== 'string' || typeof input.resolved !== 'boolean') return null
      return { kind: 'write', glyph: input.resolved ? '✓' : '↺', lead: input.resolved ? 'resolved' : 'reopened', target: threadTarget(input.thread), change: [] }
    }
    case 'note_section': {
      const target = targetOf(input.ref ?? input.block, titleOf)
      if (!target || typeof input.heading !== 'string' || typeof input.body !== 'string') return null
      const previous = typeof out?.previous === 'string' ? out.previous : undefined
      return {
        kind: 'write', glyph: '✎', target, change: [`replaced § ${clip(input.heading.replace(/^#+\s*/, ''), QUOTE_CHARS)}`, ...rev],
        detail: previous === undefined ? input.body : fenced(lineDiff(previous, input.body), 'diff'),
      }
    }
    case 'work_create': {
      if (typeof input.title !== 'string') return null
      const workId = typeof out?.workId === 'string' ? out.workId : null
      const body = typeof input.body === 'string' && input.body.trim() ? `\n\n${input.body}` : ''
      return {
        kind: 'write', glyph: '+', target: workId ? { label: workId, ref: workId } : null,
        ...(workId ? {} : { lead: 'new item' }),
        change: [...(workId ? ['created'] : []), quoted(input.title), ...[input.stage, input.priority].filter((v): v is string => typeof v === 'string')],
        detail: `**${input.title}**${body}`,
      }
    }
    case 'work_stage': {
      const target = itemTarget(input.ref ?? input.item, out, titleOf)
      if (!target || typeof input.stage !== 'string') return null
      const previous = typeof out?.previous === 'string' && out.previous !== input.stage ? `${out.previous} ` : ''
      return { kind: 'write', glyph: '⇄', target, change: [`stage ${previous}→ ${input.stage}`] }
    }
    case 'work_set': {
      const target = itemTarget(input.ref ?? input.item, out, titleOf)
      if (!target || typeof input.key !== 'string' || typeof input.value !== 'string') return null
      const previous = typeof out?.previous === 'string' && out.previous !== input.value ? `${clip(out.previous, 24)} ` : ''
      return { kind: 'write', glyph: '⇄', target, change: [`${input.key} ${previous}→ ${clip(input.value, QUOTE_CHARS)}`] }
    }
    case 'work_body': {
      const target = itemTarget(input.ref ?? input.item, out, titleOf)
      if (!target || typeof input.body !== 'string') return null
      const previous = typeof out?.previous === 'string' ? out.previous : undefined
      return {
        kind: 'write', glyph: '✎', target, change: ['replaced the body', ...rev],
        detail: previous === undefined ? input.body : fenced(lineDiff(previous, input.body), 'diff'),
      }
    }
    case 'work_deliver': {
      const target = itemTarget(input.ref ?? input.item, out, titleOf)
      if (!target || typeof input.repo !== 'string' || typeof input.pr !== 'number') return null
      const pr = recordOf(out?.pullRequest)
      const delivery = recordOf(out?.delivery)
      return {
        kind: 'write', glyph: '⇡', target,
        change: [`delivered ${input.repo}#${input.pr}`, ...(typeof pr?.state === 'string' ? [pr.state.toLowerCase()] : []), ...(typeof delivery?.deliveryKey === 'string' ? [String(delivery.deliveryKey)] : [])],
      }
    }
    case 'work_complete': {
      const target = itemTarget(input.ref ?? input.item, out, titleOf)
      if (!target) return null
      const proof = typeof input.proof === 'string' ? input.proof : undefined
      return {
        kind: 'write', glyph: '✓', target, change: ['completed', proof ? `proof ${quoted(proof)}` : 'with its proof block'],
        ...(proof ? { detail: proof } : {}),
      }
    }
    case 'view_order': {
      const target = targetOf(input.ref ?? input.view, titleOf)
      if (!target) return null
      const order = Array.isArray(out?.order) ? out.order.map(recordOf).filter((o): o is Record<string, unknown> => !!o) : []
      const listed = order.length ? order.slice(0, DETAIL_LINES).map((o, i) => `${i + 1}. ${escapeMarkdown(String(o.workId ?? o.title ?? o.id ?? ''))}${o.workId && o.title ? ` ${escapeMarkdown(String(o.title))}` : ''}`).join('\n') : undefined
      if (!Array.isArray(input.ids) || !input.ids.length) {
        return { kind: 'read', glyph: '⌕', lead: 'order of', target, change: order.length ? [`${order.length} members`] : [], ...(listed ? { detail: listed } : {}) }
      }
      return { kind: 'write', glyph: '⇅', lead: 'reordered', target, change: [`${input.ids.length} first`], ...(listed ? { detail: listed } : {}) }
    }
    case 'outline_read': {
      const target = targetOf(input.ref, titleOf)
      if (!target) return null
      if (typeof out?.title === 'string' && out.title && blockIdOfRef(target.ref)) target.label = clip(out.title, QUOTE_CHARS)
      const props = recordOf(out?.properties)
      const children = Array.isArray(out?.children) ? out.children.length : null
      return {
        kind: 'read', glyph: '⌕', lead: 'read', target,
        change: [
          ...(props && Object.keys(props).length ? [plural(Object.keys(props).length, 'property', 'properties')] : []),
          ...(children ? [plural(children, 'child', 'children')] : []),
          ...(typeof out?.revision === 'number' ? [`rev ${out.revision}`] : []),
        ],
      }
    }
    case 'outline_find': {
      const what = findWhat(input)
      if (!what) return null
      const blocks = Array.isArray(out?.blocks) ? out.blocks.map(recordOf).filter((b): b is Record<string, unknown> => !!b) : null
      const hits = blocks ? `${plural(blocks.length, 'hit', 'hits')}${out?.complete === false ? '+' : ''}` : null
      return {
        kind: 'read', glyph: '⌕', lead: `find ${what}`, target: null, change: hits ? [hits] : [],
        ...(blocks?.length ? { detail: blocks.slice(0, DETAIL_LINES).map(b => `- ${escapeMarkdown(String(b.workId ? `${b.workId} ` : ''))}${escapeMarkdown(String(b.title ?? b.id ?? ''))}`).join('\n') } : {}),
      }
    }
    case 'outline_changes': {
      if (typeof input.since !== 'string' && typeof input.since !== 'number') return null
      const entries = Array.isArray(out?.entries) ? out.entries.map(recordOf).filter((b): b is Record<string, unknown> => !!b) : null
      const who = [input.author, input.actor].filter((v): v is string => typeof v === 'string' && !!v)
      return {
        kind: 'read', glyph: '⌕', lead: `changes since ${clip(String(input.since), 24)}${who.length ? ` by ${who.join(' ')}` : ''}`, target: null,
        change: entries ? [`${plural(entries.length, 'block', 'blocks')}${out?.complete === false ? '+' : ''}`] : [],
        ...(entries?.length ? { detail: entries.slice(0, DETAIL_LINES).map(b => `- ${escapeMarkdown(String(b.title ?? b.id ?? ''))} · ${escapeMarkdown(String(b.kind ?? ''))} by ${escapeMarkdown(String(b.actorId ?? b.author ?? '?'))}`).join('\n') } : {}),
      }
    }
    case 'outline_resolve': {
      const target = targetOf(input.ref, titleOf)
      if (!target) return null
      return { kind: 'read', glyph: '⌕', lead: 'resolve', target, change: typeof out?.title === 'string' ? [`→ ${clip(out.title, QUOTE_CHARS)}`] : [] }
    }
    case 'show': {
      const target = targetOf(input.ref ?? input.reference, titleOf)
      if (!target) return null
      return { kind: 'read', glyph: '⌕', lead: 'show', target, change: [] }
    }
  }
  return null
}

/**
 * The row for Claude Code's Edit or Write (PIE-602), or null to leave the engine's: the file (pressed, it opens), the
 * lines added and removed, a `diff` to open, and the diff folded under it. Never throws on any input shape.
 */
export function fileRowOf(view: ToolCallView, cwd?: string): ToolRow | null {
  if (!(FILE_TOOLS as readonly string[]).includes(view.tool)) return null
  const input = recordOf(view.input)
  const path = typeof input?.file_path === 'string' && input.file_path.startsWith('/') ? input.file_path : null
  if (!input || !path) return null
  const state = view.isInterrupted ? 'interrupted' : view.isErrored ? 'errored' : view.isRunning ? 'running' : 'done'
  const out = state === 'done' ? recordOf(view.output) : null
  const counted = out ? lineCounts(out) : null
  const created = out?.type === 'create'
  const target = { label: shortPath(path, cwd), ref: `${FILE_REF}${path}` }
  const row: ToolRow = {
    kind: 'write', glyph: created ? '+' : '✎', target, state,
    change: [
      ...(view.tool === 'Write' ? [created ? 'created' : 'rewrote'] : []),
      ...(counted ? [`+${counted.added} −${counted.removed}`] : []),
    ],
    ...(counted && !created ? { also: { label: 'diff', ref: `${FILE_DIFF_REF}${path}` } } : {}),
  }
  const patch = out ? patchText(out) : ''
  if (patch) row.detail = fenced(patch, 'diff')
  else if (created && typeof out?.content === 'string') row.detail = fenced(out.content, '')
  if (state === 'errored') row.error = clip(firstLine(outputTextOf(view.output)).replace(/^Error:\s*/, ''), 160) || 'the call failed'
  return row
}

/** The lines an Edit or Write added and removed: git's count when it gave one, else its patch's `+` and `-` lines. */
export function lineCounts(out: Record<string, unknown>): { added: number; removed: number } | null {
  const git = recordOf(out.gitDiff)
  if (typeof git?.additions === 'number' && typeof git.deletions === 'number') return { added: git.additions, removed: git.deletions }
  const hunks = Array.isArray(out.structuredPatch) ? out.structuredPatch.map(recordOf).filter((h): h is Record<string, unknown> => !!h) : null
  if (!hunks) return out.type === 'create' && typeof out.content === 'string' ? { added: lineCount(out.content), removed: 0 } : null
  let added = 0, removed = 0
  for (const h of hunks) for (const l of Array.isArray(h.lines) ? h.lines : []) {
    if (typeof l !== 'string') continue
    if (l.startsWith('+')) added++
    else if (l.startsWith('-')) removed++
  }
  if (!hunks.length && out.type === 'create' && typeof out.content === 'string') added = lineCount(out.content)
  return { added, removed }
}

/** An Edit's or Write's patch as unified-diff text (its hunks), '' with none. */
function patchText(out: Record<string, unknown>): string {
  const hunks = Array.isArray(out.structuredPatch) ? out.structuredPatch.map(recordOf).filter((h): h is Record<string, unknown> => !!h) : []
  return hunks.map(h => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...(Array.isArray(h.lines) ? h.lines.filter((l): l is string => typeof l === 'string') : [])].join('\n')).join('\n')
}

/** A path as the row shows it: relative to the session's folder when inside it, else its last three parts. */
export function shortPath(path: string, cwd?: string): string {
  const base = cwd?.replace(/\/+$/, '')
  if (base && path.startsWith(`${base}/`)) return path.slice(base.length + 1)
  const parts = path.split('/').filter(Boolean)
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : path
}

/** One line of the tool's result under the row: null leaves the engine's (errors, in full), '' draws nothing. */
export function toolResultLineOf(tool: string, output: unknown, isErrored: boolean): string | null {
  // The file's row says what changed, and folds open on the diff: nothing under it but an error.
  if ((FILE_TOOLS as readonly string[]).includes(tool)) return isErrored ? null : ''
  const name = modToolOf(tool)
  if (!name || isErrored) return null
  if ((READ_TOOLS as readonly string[]).includes(name)) return ''
  const out = outputJsonOf(output)
  if (!out) return null
  if (out.outcome === 'proposed') return `proposed: ${clip(String(out.reason ?? ''), 80)}`
  if (out.outcome === 'applied') return '✓ applied'
  if (typeof out.revision === 'number') return `✓ rev ${out.revision}`
  if (typeof out.reply === 'string') return '✓ replied'
  if (typeof out.thread === 'string') return `✓ thread ${typeof out.lifecycle === 'string' ? out.lifecycle : 'open'}`
  if (Array.isArray(out.order)) return '✓ ordered'
  return '✓'
}

// ─── The tree ──────────────────────────────────────────────────────────────

export type ToolRowElements = {
  Box: (props: any) => RenderElement
  Text: (props: TextProps & { children?: unknown }) => RenderElement
  Button: (props: any) => RenderElement
  Markdown: (props: MarkdownProps) => RenderElement
}

export type ToolRowModel = {
  /** The row's tool_use_id: the Buttons' keys carry it, so two rows never share one. */
  id: string
  /** Whether it's folded open. */
  expanded: boolean
  toggle: () => void
  /** The target pressed, on the surface that pressed it. */
  open: (ref: string, surface: RenderSurface) => void
}

const STATE_COLOR = { running: undefined, done: 'green', errored: 'red', interrupted: 'yellow' } as const

/** The row: the fold mark, the glyph, the target as a button, the change; then the error, and the content unfolded. */
export function toolRowTree(ui: ToolRowElements, row: ToolRow, m: ToolRowModel): RenderElement {
  const { Box, Text, Button, Markdown } = ui
  const fixed = (child: RenderElement) => Box({ flexShrink: 0, children: child })
  const dim = row.kind === 'read' || row.state === 'running' || row.state === 'interrupted'
  const foldable = !!row.detail && row.state !== 'errored'
  const tail = [
    ...row.change,
    ...(row.state === 'running' ? ['…'] : []),
    ...(row.state === 'interrupted' ? ['interrupted'] : []),
  ].filter(Boolean)
  const line = Box({
    flexDirection: 'row',
    children: [
      Box({
        width: 2, flexShrink: 0,
        children: foldable
          ? Button({ key: `tool-row-fold-${m.id}`, plain: true, label: m.expanded ? '▾' : '▸', onPress: () => m.toggle() })
          : Text({ children: ' ' }),
      }),
      // Only the change gives way to a narrow row (cut at its end); the glyph, the words before it and the note keep their width.
      fixed(Text({ color: row.state === 'done' && row.kind === 'read' ? undefined : STATE_COLOR[row.state], dimColor: row.kind === 'read', children: `${row.glyph} ` })),
      ...(row.lead ? [fixed(Text({ dimColor: dim, children: row.target ? `${row.lead} ` : row.lead }))] : []),
      ...(row.target?.ref
        ? [fixed(Button({ key: `tool-row-open-${m.id}`, plain: true, label: row.target.label, onPress: (press: { surface: RenderSurface }) => m.open(row.target!.ref, press.surface) }))]
        : row.target ? [fixed(Text({ bold: true, children: row.target.label }))] : []),
      ...(tail.length ? [Box({ flexShrink: 1, children: Text({ dimColor: true, wrap: 'truncate-end', children: `${row.target || row.lead ? ' · ' : ''}${tail.join(' · ')}` }) })] : []),
      // After what changed: a second thing to open (a file's diff).
      ...(row.also?.ref ? [fixed(Text({ dimColor: true, children: ' · ' })), fixed(Button({ key: `tool-row-also-${m.id}`, plain: true, label: row.also.label, onPress: (press: { surface: RenderSurface }) => m.open(row.also!.ref, press.surface) }))] : []),
    ],
  })
  const below: RenderElement[] = []
  if (row.state === 'errored' && row.error) below.push(Box({ paddingLeft: 4, children: Text({ color: 'red', children: `✗ ${row.error}` }) }))
  if (row.state === 'done' && row.warning) below.push(Box({ paddingLeft: 4, children: Text({ color: 'yellow', children: row.warning }) }))
  if (foldable && m.expanded) below.push(Box({ paddingLeft: 4, children: Markdown({ text: capped(row.detail!) }) }))
  return below.length ? Box({ flexDirection: 'column', children: [line, ...below] }) : line
}

// ─── Text helpers ──────────────────────────────────────────────────────────

/**
 * Markdown cut to DETAIL_LINES lines and DETAIL_CHARS characters (a long line is cut too), saying how much more there
 * was; a fence left open by the cut is closed with its own delimiter, so the note after it reads as text.
 */
export function capped(markdown: string): string {
  const all = markdown.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').split('\n')
  const kept: string[] = []
  let chars = 0
  let cutLine = false
  for (const line of all) {
    if (kept.length >= DETAIL_LINES) break
    if (chars + line.length > DETAIL_CHARS) {
      kept.push(`${line.slice(0, Math.max(0, DETAIL_CHARS - chars))}…`)
      cutLine = true
      break
    }
    kept.push(line)
    chars += line.length + 1
  }
  const more = all.length - kept.length
  if (!more && !cutLine) return kept.join('\n')
  let open: string | null = null
  for (const line of kept) {
    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (!fence) continue
    if (!open) open = fence[1]!
    else if (fence[1]![0] === open[0] && fence[1]!.length >= open.length && !fence[2]!.trim()) open = null
  }
  const notice = more ? `*… ${more} more ${more === 1 ? 'line' : 'lines'}*` : '*… the rest is cut*'
  return [...kept, ...(open ? [open] : []), '', notice].join('\n')
}

/** A short line diff (the changed lines between the common head and tail), as the outliner's `shortDiff` writes one. */
export function lineDiff(before: string, after: string): string {
  const a = before.split('\n')
  const b = after.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const removed = a.slice(head, a.length - tail).map(l => `-${l}`)
  const added = b.slice(head, b.length - tail).map(l => `+${l}`)
  return removed.length || added.length ? [`@@ line ${head + 1}`, ...removed, ...added].join('\n') : '(no change)'
}

function fenced(text: string, lang: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(m => m[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${lang}\n${text}\n${fence}`
}

function revisionChange(out: Record<string, unknown> | null): string[] {
  if (typeof out?.revision !== 'number') return []
  return [typeof out.previousRevision === 'number' && out.previousRevision !== out.revision ? `rev ${out.previousRevision}→${out.revision}` : `rev ${out.revision}`]
}

function itemTarget(item: unknown, out: Record<string, unknown> | null, titleOf: TitleOf): RowTarget | null {
  const target = targetOf(item, titleOf)
  return target && typeof out?.workId === 'string' && out.workId ? { label: out.workId, ref: out.workId } : target
}

/** A comment thread is a block: its root comment, opened like any other. */
function threadTarget(thread: string): RowTarget {
  const id = blockIdOfRef(thread)
  return id ? { label: `thread ${id.slice(0, 8)}…`, ref: id } : { label: `thread ${clip(thread, 12)}`, ref: '' }
}

function findWhat(input: Record<string, unknown>): string | null {
  const parts: string[] = []
  if (typeof input.text === 'string' && input.text) parts.push(quoted(input.text))
  for (const key of ['property', 'hasKey', 'query', 'view'] as const) {
    if (typeof input[key] === 'string' && input[key]) parts.push(`${key === 'hasKey' ? 'has' : key} ${clip(String(input[key]), QUOTE_CHARS)}`)
  }
  if (!parts.length) return null
  if (typeof input.under === 'string' && input.under) parts.push(`under ${clip(input.under, 24)}`)
  return parts.join(' ')
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function lines(text: string): string[] {
  return text.split('\n')
}

function firstLine(text: string): string {
  return text.split('\n').map(l => l.trim()).find(Boolean) ?? ''
}

/** The first non-blank line, Markdown's heading and list marks taken off, quoted and cut. */
function quoted(text: string): string {
  return `"${clip(firstLine(text).replace(/^(#+|[-*+]|\d+\.)\s+/, ''), QUOTE_CHARS)}"`
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>#|]/g, '\\$&')
}
