import { FILE_TOOLS } from './tool-rows'

/**
 * The comment threads open on a file an agent is about to rewrite (PIE-650). Someone commented on the file in the
 * outline (a Resource: the door's C in a file reader, an agent's outline_comment); the thread is stored beside it,
 * not in it, so an Edit would never meet it. Before the first Edit or Write of a file in a session, the installed
 * CLI's `agent read` of the file's `[file::path]` says which threads are open, and the call is held once with them
 * (register.ts). This file is the pure half: the file a call is about, the ref that reads it, and the words.
 */

/** The absolute file an Edit or Write is about, or null (another tool, no path, a path a `[file::]` token can't hold). */
export function threadedPathOf(tool: string, input: unknown): string | null {
  if (!(FILE_TOOLS as readonly string[]).includes(tool)) return null
  const path = (input as { file_path?: unknown } | null)?.file_path
  return typeof path === 'string' && path.startsWith('/') && !/[\]\n\r]/.test(path) ? path : null
}

/** The `agent read` ref of a file: the authored token the outline's notes write. */
export const fileRefOf = (path: string): string => `[file::${path}]`

type Thread = { thread?: unknown; anchored?: unknown; quote?: unknown; body?: unknown; author?: unknown; actorId?: unknown; replies?: unknown }

const oneLine = (text: unknown, max: number): string => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * What to tell the agent about a file's open threads, from `agent read`'s answer, or null when there are none (or the
 * answer isn't a Resource's). The call is held once with this text; the same edit, repeated, goes through.
 */
export function threadsHeldNote(path: string, read: unknown): string | null {
  const r = read && typeof read === 'object' ? read as { kind?: unknown; id?: unknown; threads?: unknown } : null
  if (r?.kind !== 'resource' || !Array.isArray(r.threads) || r.threads.length === 0) return null
  const lines = (r.threads as Thread[]).slice(0, 8).map(t => {
    const who = typeof t.actorId === 'string' ? t.actorId : String(t.author ?? 'someone')
    const where = t.anchored === false ? ' (the passage has changed or gone; this is what it said)' : ''
    const replies = Array.isArray(t.replies) && t.replies.length ? ` [${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}]` : ''
    return `- ${who} on “${oneLine(t.quote, 80)}”${where}: ${oneLine(t.body, 240)}${replies} (thread ${String(t.thread)})`
  })
  const more = r.threads.length > lines.length ? [`- … and ${r.threads.length - lines.length} more`] : []
  return [
    `${path} has ${r.threads.length} open comment thread${r.threads.length === 1 ? '' : 's'} in the outline. Read them before you change the file:`,
    ...lines, ...more,
    `outline_read ${String(r.id)} gives the file and the threads in full; outline_reply answers one, outline_resolve_thread closes it. This edit was held once so you see them; make it again to go ahead.`,
  ].join('\n')
}
