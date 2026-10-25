import { listArgs, listedOf } from './workboard-now'
import { MACHINE_NAME, OUTLINE_NAME } from './mention-message'

/**
 * The settle check (PIE-1268, "Settle, then shape"): ideas gather while they are warm, and the deployer's session is
 * woken once a thread has gone quiet, so the backlog drains because a thread settled, not because the person said go.
 * Per `[thread::…]` value across the outlines it reads: how many notes, how many of them the person's own, when it was
 * last touched, and whether roadmap items carry it. All of that is counts and a max over what the service already
 * answers for `list --facets thread` (outline-core's QuestionFacet: `count` over every match, `last` the newest
 * update), so no service code decides it; this file only joins three answers and applies the thresholds.
 *
 * Pure: register.ts runs the commands and the clock, since only it is handed `$`.
 */

/** The property a thread is named by. The only one the check knows. */
export const THREAD_KEY = 'thread'

/** The session that runs the check unless the option says otherwise: the deployer's. */
export const SETTLE_PERSONA = 'loki'

export type SettleState =
  /** Touched within the quiet window: hold and collect. */
  | 'warming'
  /** Enough notes, the person's among them, quiet for the window (and not for longer than `within`): wake the deployer. */
  | 'settled'
  /** Roadmap items carry the thread: stop watching. */
  | 'shaped'
  /** Quiet, but too thin to shape, or dormant for weeks: nothing to say. */
  | 'quiet'

export type SettleConfig = {
  /** Minutes between checks. */
  every: number
  /** Notes a thread needs to settle. */
  chirps: number
  /** How many of them must be the person's own. */
  evan: number
  /** Minutes without a touch before a thread is quiet. */
  quiet: number
  /** Minutes after which a quiet thread is dormant, not settling (so the first check isn't a flood of old threads). */
  within: number
  /** The notes a thread is counted over. Roadmap items are the tickets, not the conversation. */
  base: string
  /** The person's own notes among them: an author, an actor, or the quoted "Evan, …" form. */
  evanQuery: string
  /** Roadmap items carrying a thread. */
  shapedQuery: string
  /** Threads one wake names, the newest first; the rest wait for the next check, which names the next ones. */
  wakeMax: number
}

/** Guesses (the capability note says so); tune them from a week of real threads with `settleTuning`. */
export const SETTLE_DEFAULTS: SettleConfig = {
  every: 30,
  chirps: 3,
  evan: 1,
  quiet: 60,
  within: 3 * 24 * 60,
  base: `${THREAD_KEY} AND NOT type=roadmap-item`,
  evanQuery: 'by:user OR actor=evan OR text~"Evan, "',
  shapedQuery: `type=roadmap-item AND ${THREAD_KEY}`,
  wakeMax: 5,
}

const NUMBERS = ['every', 'chirps', 'evan', 'quiet', 'within', 'wakeMax'] as const
const TEXTS: Record<string, 'base' | 'evanQuery' | 'shapedQuery'> = { base: 'base', 'evan-query': 'evanQuery', 'shaped-query': 'shapedQuery' }
const NUMBER_KEYS: Record<string, (typeof NUMBERS)[number]> = { every: 'every', chirps: 'chirps', evan: 'evan', quiet: 'quiet', within: 'within', 'wake-max': 'wakeMax' }
export const TUNING_FORM = 'chirps=3; evan=1; quiet=60; within=4320; every=30; wake-max=5; base=<query>; evan-query=<query>; shaped-query=<query>'

/**
 * The `settleTuning` option or EP0CH_SETTLE_TUNING: `key=value` pairs separated by `;`. Minutes for quiet, within and
 * every. An unknown key or a value that isn't a positive whole number is a problem named with the form, never skipped.
 */
export function tuningOf(text: string | undefined): { config: SettleConfig; problems: string[] } {
  const config = { ...SETTLE_DEFAULTS }
  const problems: string[] = []
  for (const pair of (text ?? '').split(/[;\n]/).map(p => p.trim()).filter(Boolean)) {
    const at = pair.indexOf('=')
    const key = (at < 0 ? pair : pair.slice(0, at)).trim().toLowerCase()
    const value = at < 0 ? '' : pair.slice(at + 1).trim()
    if (key in NUMBER_KEYS) {
      const n = Number(value)
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < 1) problems.push(`${key} wants a positive whole number, not "${value}"`)
      else config[NUMBER_KEYS[key]!] = n
    } else if (key in TEXTS) {
      if (!value) problems.push(`${key} wants a query in the views' grammar`)
      else config[TEXTS[key]!] = value
    } else problems.push(`unknown key "${key}"`)
  }
  if (problems.length) problems.push(`write it like: ${TUNING_FORM}`)
  return { config, problems }
}

/** Whether this session runs the check: `on`/`off` (the option, else EP0CH_SETTLE) decides outright, else the deployer's persona. */
export function settlesFor(setting: string | undefined, persona: string | undefined): boolean {
  const s = setting?.trim().toLowerCase()
  if (s === 'on' || s === '1' || s === 'true') return true
  if (s === 'off' || s === '0' || s === 'false') return false
  return persona === SETTLE_PERSONA
}

export type SettleOutline = { outline: string; machine?: string }

/**
 * The outlines the check reads: `name[@machine]` separated by commas or spaces (`gurgle@float-2, pie@float-2`), else
 * pie and gurgle on the bound outline's machine. A name that isn't an outline's or a machine that isn't an ssh config name is a problem.
 */
export function outlinesOf(text: string | undefined, bound: SettleOutline | null): { outlines: SettleOutline[]; problems: string[] } {
  const words = (text ?? '').split(/[,\s]+/).filter(Boolean)
  if (!words.length) return { outlines: bound ? DEFAULT_OUTLINES.map(outline => ({ outline, ...(bound.machine ? { machine: bound.machine } : {}) })) : [], problems: [] }
  const outlines: SettleOutline[] = []
  const problems: string[] = []
  for (const word of words) {
    const [outline, machine, ...rest] = word.split('@')
    if (!OUTLINE_NAME.test(outline ?? '') || rest.length || (machine !== undefined && !MACHINE_NAME.test(machine))) problems.push(`"${word}" is not name or name@ssh-name`)
    else outlines.push({ outline: outline!, ...(machine ? { machine } : {}) })
  }
  if (problems.length) problems.push('write it like: gurgle@float-2, pie@float-2')
  return { outlines, problems }
}

/** The outlines a session reads when nothing names them: the ones the person works in, on the bound outline's machine. */
export const DEFAULT_OUTLINES = ['pie', 'gurgle'] as const

/** `settle-outlines = "gurgle@float-2, pie"` in a folder's `.ep0ch/config.toml` (or an old `.ep0ch` file), or undefined. */
export function settleOutlinesOfConfig(text: string | null | undefined): string | undefined {
  const m = /^\s*settle-outlines\s*=\s*(?:"([^"\n]*)"|'([^'\n]*)')\s*(?:#.*)?$/m.exec(text ?? '')
  return (m?.[1] ?? m?.[2])?.trim() || undefined
}

/** The property the settle capability note carries its tuning on: the `settleTuning` form (TUNING_FORM), edited in the outline. */
export const TUNING_KEY = 'settle-tuning'

/** `list`'s argv for the notes carrying the tuning: any outline's capability notes with the property, rows with their update time. */
export function tuningNoteArgs(): string[] {
  return listArgs(`type=capability AND ${TUNING_KEY}`, 20, 'id,title,properties,timestamps')
}

export type TuningNote = { id: string; tuning: string; updatedAt: number }

/** The tuning notes in one `list` answer, or null when it isn't one. A note with an empty property or no update time is no tuning. */
export function tuningNotesOf(stdout: string): TuningNote[] | null {
  const listed = listedOf(stdout)
  if (!listed) return null
  return listed.blocks.flatMap(b => {
    const tuning = b.properties.find(p => p.key === TUNING_KEY)?.value.trim()
    const updatedAt = Date.parse(b.updatedAt ?? '')
    return tuning && Number.isFinite(updatedAt) ? [{ id: b.id, tuning, updatedAt }] : []
  })
}

/** The newest tuning note across the outlines read: the one edited last wins, wherever it lives. */
export function newestTuning(notes: readonly TuningNote[]): TuningNote | null {
  return notes.reduce<TuningNote | null>((best, n) => (!best || n.updatedAt > best.updatedAt ? n : best), null)
}

/** The outline as the store and the wake name it: `gurgle@float-2`, or `pie` here. */
export const outlineLabel = (o: SettleOutline): string => (o.machine ? `${o.outline}@${o.machine}` : o.outline)

// ─── The three questions ───────────────────────────────────────────────────

/** `list`'s argv for a query's value counts of the thread key over every match (one row asked for, none needed). */
export function facetArgs(query: string): string[] {
  return [...listArgs(query, 1, 'id'), '--facets', THREAD_KEY, '--facet-values', '1000']
}

export type SettleAsks = { all: string[]; evan: string[]; shaped: string[] }

export function settleAsks(config: SettleConfig): SettleAsks {
  return {
    all: facetArgs(config.base),
    evan: facetArgs(`(${config.base}) AND (${config.evanQuery})`),
    shaped: facetArgs(config.shapedQuery),
  }
}

/** The capability note a thread names itself on: `type=capability` carrying the same `thread`. */
export function capabilityArgs(thread: string): string[] {
  return listArgs(`type=capability AND ${THREAD_KEY}=${JSON.stringify(thread)}`, 1, 'id,title')
}

/** The first note of a `list` answer: its id, or null. */
export function firstIdOf(stdout: string): string | null {
  try {
    const id = (JSON.parse(stdout) as { blocks?: { id?: unknown }[] }).blocks?.[0]?.id
    return typeof id === 'string' && id ? id : null
  } catch {
    return null
  }
}

export type ThreadCount = { count: number; last: number }

/** The counts and last update per thread value in `list --facets thread`'s JSON, or null when it isn't an answer with that facet. */
export function facetCountsOf(stdout: string): Map<string, ThreadCount> | null {
  let parsed: unknown
  try { parsed = JSON.parse(stdout) } catch { return null }
  const facets = (parsed as { facets?: unknown } | null)?.facets
  if (!Array.isArray(facets)) return null
  // A key nobody carries has no facet at all: that is an empty answer, not a failed one.
  const facet = facets.find(f => f?.key === THREAD_KEY)
  const out = new Map<string, ThreadCount>()
  for (const v of Array.isArray(facet?.values) ? facet.values : []) {
    const last = Date.parse(String(v?.last))
    if (typeof v?.value === 'string' && typeof v.count === 'number' && Number.isFinite(last)) out.set(v.value, { count: v.count, last })
  }
  return out
}

// ─── Joining them ──────────────────────────────────────────────────────────

/** The same question answered by several outlines, as one: a thread is one thread wherever its notes are (counts add, the last touch is the newest). */
export function mergedCounts(parts: readonly Map<string, ThreadCount>[]): Map<string, ThreadCount> {
  const out = new Map<string, ThreadCount>()
  for (const part of parts) {
    for (const [thread, c] of part) {
      const seen = out.get(thread)
      out.set(thread, seen ? { count: seen.count + c.count, last: Math.max(seen.last, c.last) } : { ...c })
    }
  }
  return out
}

export type Thread = {
  thread: string
  /** Notes in the thread, roadmap items excluded. */
  chirps: number
  /** How many of them are the person's own. */
  evan: number
  /** When the thread was last touched (ms). */
  last: number
  /** Roadmap items carry it. */
  shaped: boolean
  state: SettleState
}

const MINUTE = 60_000

export function stateOf(t: Omit<Thread, 'state'>, now: number, config: SettleConfig): SettleState {
  if (t.shaped) return 'shaped'
  const quietFor = now - t.last
  if (quietFor < config.quiet * MINUTE) return 'warming'
  if (t.chirps >= config.chirps && t.evan >= config.evan && quietFor <= config.within * MINUTE) return 'settled'
  return 'quiet'
}

/**
 * Every thread of the base query, with its state. A thread only the shaped query names (tickets and no notes of its
 * own) is shaped with no notes: it appears so a shaped thread never vanishes from the view.
 */
export function threadsOf(all: Map<string, ThreadCount>, evan: Map<string, ThreadCount>, shaped: Map<string, ThreadCount>, now: number, config: SettleConfig): Thread[] {
  const names = new Set([...all.keys(), ...shaped.keys()])
  return [...names].map(thread => {
    const base = all.get(thread)
    const ticket = shaped.get(thread)
    const t = { thread, chirps: base?.count ?? 0, evan: evan.get(thread)?.count ?? 0, last: Math.max(base?.last ?? 0, ticket?.last ?? 0), shaped: !!ticket }
    return { ...t, state: stateOf(t, now, config) }
  }).sort((a, b) => b.last - a.last)
}

// ─── What changed since the last check ─────────────────────────────────────

/** What one thread was at the last check, and the newest touch the deployer was already told about. */
export type Seen = { state: SettleState; last: number; announced: number }
export type SettleStore = Record<string, Seen>

export type Change = { thread: Thread; from: SettleState | null }

/**
 * What this check found against what the last one kept:
 * - `wake`: threads settled whose newest touch the deployer was not told about. A thread that stays settled isn't
 *   told again; one that warms and settles again is (its newest touch moved on).
 * - `changes`: the state changes worth a build-log line, those into or out of settled or shaped. A thread first seen
 *   settled counts (it is about to be woken for); one first seen shaped was shaped before the check began.
 * - `next`: the store to keep. It does not mark a wake as told: `told` does, once the wake went.
 */
export function settleDiff(store: SettleStore, threads: readonly Thread[]): { wake: Thread[]; changes: Change[]; next: SettleStore } {
  const next: SettleStore = { ...store }
  const wake: Thread[] = []
  const changes: Change[] = []
  for (const t of threads) {
    const prev = store[t.thread]
    next[t.thread] = { state: t.state, last: t.last, announced: prev?.announced ?? 0 }
    if (t.state === 'settled' && t.last > (prev?.announced ?? 0)) wake.push(t)
    const from = prev?.state ?? null
    const matters = (s: SettleState | null) => s === 'settled' || s === 'shaped'
    if (from !== t.state && (from === null ? t.state === 'settled' : matters(from) || matters(t.state))) changes.push({ thread: t, from })
  }
  return { wake, changes, next }
}

/**
 * The first check's baseline: the store as `settleDiff` left it with every thread already settled marked told, so only
 * a thread that settles from now on wakes, and the one line that says so for the build log. 
 */
export function baselineOf(next: SettleStore, threads: readonly Thread[]): { store: SettleStore; line: string } {
  const settled = threads.filter(t => t.state === 'settled')
  return {
    store: told(next, settled),
    line: `Settle check baseline: ${settled.length} settled ${settled.length === 1 ? 'thread' : 'threads'} at the first run, recorded, not announced (${threads.filter(t => t.state === 'shaped').length} shaped, ${threads.filter(t => t.state === 'warming').length} warming)`,
  }
}

/** The store with these threads marked told, up to their newest touch: only a wake that went marks them, so a failed one is tried again. */
export function told(store: SettleStore, threads: readonly Thread[]): SettleStore {
  const next = { ...store }
  for (const t of threads) next[t.thread] = { state: t.state, last: t.last, announced: t.last }
  return next
}

// ─── Saying it ─────────────────────────────────────────────────────────────

/** Minutes as the wake says them: `74 min`, `3 h`, `2 d`. */
export function agoOf(ms: number): string {
  const min = Math.max(0, Math.round(ms / MINUTE))
  return min < 120 ? `${min} min` : min < 48 * 60 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`
}

/** One thread's wake line: the shape the capability note gives. `capability` is its link text, or null when none names the thread. */
export function wakeLine(t: Thread, now: number, capability: string | null): string {
  return `thread ${t.thread} settled: ${t.chirps} chirps, ${t.evan} Evan's, quiet ${agoOf(now - t.last)}, ${capability ? `capability ${capability}` : `no capability note yet (write [thread::${t.thread}] on the one you shape it on)`}`
}

/** The prompt that wakes the deployer: one line per thread (cut at `max`), and what to do with them. */
export function wakeText(lines: readonly string[], more: number): string {
  return [
    `Settle check: ${lines.length + more} ${lines.length + more === 1 ? 'thread has' : 'threads have'} gone quiet.`,
    ...lines.map(l => `- ${l}`),
    ...(more ? [`- and ${more} more: the next check names them`] : []),
    'Shape each on its capability note (the loki skill, "A settled thread"); cut tickets only for primitives, and put [thread::<name>] on them.',
  ].join('\n')
}

const STATE_WORDS: Record<SettleState, string> = { warming: 'warming', settled: 'settled', shaped: 'shaped', quiet: 'quiet' }

/** The build-log line for a state change: `Thread backlog-groom: warming → settled · 5 chirps, 2 Evan's, quiet 74 min`. */
export function logLine(c: Change, now: number): string {
  const t = c.thread
  return `Thread ${t.thread}: ${c.from ? STATE_WORDS[c.from] : 'new'} → ${STATE_WORDS[t.state]} · ${t.chirps} chirps, ${t.evan} Evan's, quiet ${agoOf(now - t.last)}`
}
