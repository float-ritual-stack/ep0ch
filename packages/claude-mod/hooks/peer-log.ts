// Messages between Claude sessions (SendMessage, `$.session.send`, the /msg prompt command in commands/msg.md): each one sent or received is copied as a note
// under the bound outline's [[peer-messages]] page, so a cross-machine nudge leaves a record outside the chat. Pure: the
// hooks in register.ts run these argvs.

export const PEER_PAGE = 'peer-messages'
const MAX_CHARS = 4000

/** A peer's delivery reads `<cross-session-message from="…" from-name="loki-sr" …>body</cross-session-message>`. */
export function unwrapPeer(text: string): { from: string; body: string } {
  const from = /from-name="([^"]+)"/.exec(text)?.[1] ?? /from="([^"]+)"/.exec(text)?.[1] ?? 'a peer'
  const body = /<cross-session-message[^>]*>([\s\S]*?)<\/cross-session-message>/.exec(text)?.[1] ?? text
  return { from, body: body.trim() }
}

/** The local time a note is titled with, to the minute: `2026-10-16 14:02`. */
export function stampOf(ms: number): string {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/**
 * One message as a note: its first line says which way, with whom and when; the text under it, cut past 4000 characters.
 * Stamped `[machine::peer-log]` (outline-core machinery.ts): a copy the mod keeps, so a list of what people and agents
 * chose to write (the navigator's Today) leaves it out unless it asks for machinery (PIE-1448).
 */
export function entryOf(direction: 'to' | 'from', peer: string, ms: number, body: string): string {
  const cut = body.length > MAX_CHARS ? `${body.slice(0, MAX_CHARS)}\n… cut at ${MAX_CHARS} characters` : body
  return `${direction === 'to' ? '→ to' : '← from'} ${peer} · ${stampOf(ms)} [type::peer-message] [peer::${peer}] [machine::peer-log]\n\n${cut}`
}

export const findPageArgv = (): string[] => ['ep0ch', 'find', '--query', `page = "${PEER_PAGE}"`, '--ids']
export const createPageArgv = (actor: string): string[] =>
  ['ep0ch', 'new', `[page::${PEER_PAGE}]\nMessages between Claude sessions (SendMessage, /msg), one note each, newest last.`, '--as', actor, '--json']
export const entryArgv = (pageId: string, text: string, actor: string): string[] => ['ep0ch', 'new', text, '--near', pageId, '--as', actor]

/** The page's id from `find --ids` (`((id))` a line, the first one) or `new --json` (`{ id }`); undefined when neither has one. */
export function pageIdOf(stdout: string): string | undefined {
  const ref = /\(\(([0-9a-f-]{8,})\)\)/.exec(stdout)?.[1]
  if (ref) return ref
  try {
    const id = (JSON.parse(stdout) as { id?: unknown }).id
    return typeof id === 'string' && id ? id : undefined
  } catch {
    return undefined
  }
}
