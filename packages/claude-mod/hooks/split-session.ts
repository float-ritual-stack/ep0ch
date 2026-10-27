/**
 * A session running twice (PIE-1369): `claude --continue` resumes a folder's latest session even while it is live
 * elsewhere (Remote Control, a reconnect after ssh dropped), and then two processes write one transcript. At session
 * start the mod asks `ep0ch agent splits --json --session <this session>` (the door's one reader of `claude agents` and
 * its one split decision, with the commands) and, when two or more processes hold this session's id, says so: with
 * this process's first prompt, and on the status line. Never a refusal: the fact and the way out.
 *
 * This file is pure: the argv, and the words from what `ep0ch agent splits` answered. register.ts runs it.
 */

export const SPLIT_BLOCK = 'splitSession'
export const splitArgv = (sessionId: string) => ['ep0ch', 'agent', 'splits', '--json', '--session', sessionId]
/** This process's pid: the shell `$.process.run` starts is its child. */
export const OWN_PID_ARGV = ['/bin/sh', '-c', 'echo $PPID'] as const
/** `ep0ch agent splits` answers in under a second; past this the check is left out. */
export const SPLIT_TIMEOUT_MS = 8000

/** One process of the split, as `ep0ch agent splits --json` gives it. */
export type SplitProcess = { pid: number | null; kind?: string; id?: string; status?: string; startedAt?: number | null; place?: string | null; stop: string; attach?: string }
/** This session's processes, oldest first, and which one is this process (null: not known). */
export type SessionSplit = { sessionId: string; name?: string; machine?: string; procs: SplitProcess[]; own: number | null }

/** This session's split in what `ep0ch agent splits --json` printed; null when it runs once (or the answer isn't one). */
export function splitOf(stdout: string, sessionId: string, own: number | null): SessionSplit | null {
  let answer: unknown
  // The last line that is an object: a login shell may print around it.
  try { answer = JSON.parse(stdout.trim().split('\n').reverse().find(l => l.trim().startsWith('{')) ?? '') } catch { return null }
  const splits = (answer as { splits?: unknown } | null)?.splits
  if (!Array.isArray(splits)) return null
  const s = splits.find(x => x && typeof x.sessionId === 'string' && x.sessionId === sessionId && Array.isArray(x.procs) && x.procs.length >= 2)
  return s ? { sessionId, name: s.name, machine: s.machine, procs: s.procs, own: own && s.procs.some((p: SplitProcess) => p.pid === own) ? own : null } : null
}

/** A start time as a clock and how long ago: `started 07:02, 4h ago`. */
function started(at: number | null | undefined, now: number): string {
  if (typeof at !== 'number') return 'start not known'
  const s = Math.max(0, Math.round((now - at) / 1000))
  const ago = s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : s < 129_600 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86_400)}d`
  return `started ${new Date(at).toTimeString().slice(0, 5)}, ${ago} ago`
}

/** The processes that aren't this one: when this one isn't known, all but the newest (the one that just started). */
function others(s: SessionSplit): SplitProcess[] {
  return s.own ? s.procs.filter(p => p.pid !== s.own) : s.procs.slice(0, -1)
}

/**
 * The block for the model: which processes hold this session, which is this one, and the commands. Written so the
 * model tells the person in its first answer.
 */
export function splitText(s: SessionSplit, now: number): string {
  const rest = new Set(others(s))
  const lines = s.procs.map(p => {
    const me = !rest.has(p) ? (s.own ? ' — this process' : ' — the newest, most likely this one') : ''
    const reach = p.attach ? `\`${p.attach}\`` : `its terminal (${p.place ?? 'interactive'})`
    return `- pid ${p.pid ?? '?'} (${p.kind ?? 'interactive'}${p.status ? `, ${p.status}` : ''}): ${started(p.startedAt, now)}${me} · reach it: ${reach} · stop it: \`${p.stop}\``
  })
  return [
    `⚠ This session (${s.sessionId}) is running as ${s.procs.length} processes at once${s.machine ? ` on ${s.machine}` : ''}, all writing one transcript: a \`claude --continue\` resumed it while it was live elsewhere (Remote Control, a reconnect). Tell the person in your first answer, with these commands:`,
    ...lines,
    'Keep one: work in the other (attach to a background job) and stop this one, or stop the other with its command. Nothing was refused; the ep0ch door shows the same as a ⚠ ×2 chip on its status bar.',
  ].join('\n')
}

/** The status line's lead (the engine marks the mod's line with its own ⚠): `running twice: pid 28521 too · ep0ch agent stop 28521 --session fb12351f · `. */
export function splitStatus(s: SessionSplit | null): string {
  if (!s) return ''
  const rest = others(s)
  return `running ${s.procs.length === 2 ? 'twice' : `${s.procs.length}×`}: pid ${rest.map(p => p.pid ?? '?').join(', ')} too · ${rest[0]!.stop} · `
}
