/**
 * Outliner references in a Claude reply, made clickable. `Markdown` only draws
 * `https:`, `http:` and `file:` links as links, so each reference becomes an
 * https stand-in on the reserved `.invalid` domain, which never resolves: a
 * click the plugin does not take goes nowhere. The plugin maps it back to the
 * `pi-outliner://` URI the Outliner's own link navigation takes.
 */
import { codeBlocks } from './code-fence'
import { linkOccurrences, qualifiedReference } from './link-grammar.js'

const STAND_IN = 'https://pi-outliner.invalid/'

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

/** A fragment id, as outline-core's link grammar has it (`((id^fragment))`). */
const FRAGMENT = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}'

/**
 * Inline code, existing links and URLs: never rewritten. Code blocks (fenced and indented) are found by the one fence
 * rule, `code-fence.ts`, so a four-backtick fence isn't closed by three.
 */
const PROTECTED = /`[^`\n]*`|!?\[[^\]\n]*\]\([^)\n]*\)|<[a-z][a-z0-9+.-]*:[^>\s]*>|\b[a-z][a-z0-9+.-]*:\/\/[^\s<>()]+/gi

/** `text` cut into runs of prose and of code-block lines (each run whole lines, newlines kept), in order. */
function codeRuns(text: string): { code: boolean; text: string }[] {
  const lines = text.split('\n')
  const { fences, indented } = codeBlocks(lines)
  const code = new Set(indented)
  for (const fence of fences) for (let line = fence.start; line <= fence.end; line++) code.add(line)
  const runs: { code: boolean; text: string }[] = []
  lines.forEach((line, i) => {
    const piece = i < lines.length - 1 ? `${line}\n` : line
    const last = runs.at(-1)
    if (last && last.code === code.has(i)) last.text += piece
    else runs.push({ code: code.has(i), text: piece })
  })
  return runs
}

/** A `my.ep0ch.sh/pub/p/<PIE-n|page|id>` address: the web form of a reference (the tailnet's published notes). */
const WEB = 'https://my\\.ep0ch\\.sh/pub/p/([^\\s<>()\\[\\]?#]+)(?:[?#][^\\s<>()]*)?'
const WEB_LINK = new RegExp(`^\\[([^\\]\\n]*)\\]\\(${WEB}\\)$`, 'i')
const WEB_BARE = new RegExp(`^${WEB}$`, 'i')

/**
 * A `my.ep0ch.sh` address Claude wrote, bare or as `[label](url)`, as the same stand-in link a reference gets (labelled
 * by its label, else the Work ID, the page name or the note's title); null for any other link or URL, left as written.
 */
function mirrored(piece: string, hrefs: Set<string>, titleOf: (id: string) => string | undefined): string | null {
  const trimmed = /^(.*?)([.,;:!?]*)$/s.exec(piece)!
  const given = WEB_LINK.exec(piece)
  const bare = given ? null : WEB_BARE.exec(trimmed[1]!)
  const target = given?.[2] ?? bare?.[1]
  if (!target) return null
  let value: string
  try { value = decodeURIComponent(target) } catch { return null }
  const [kind, id] = /^[A-Z][A-Z0-9]*-\d+$/.test(value) ? ['work', value]
    : new RegExp(`^${UUID}$`).test(value) ? ['block', value.toLowerCase()]
      : ['page', value]
  const href = `${STAND_IN}${kind}/${encodeURIComponent(id)}`
  hrefs.add(href)
  const label = (given?.[1]?.trim() || (kind === 'block' ? blockLabel(id, undefined, titleOf) : id)).replace(/[[\]\\]/g, '\\$&')
  return `[${label}](${href})${given ? '' : trimmed[2]}`
}

/** The longest a note's title is drawn in a reply before it is cut with `…`. */
const TITLE_WIDTH = 48

/**
 * What an unaliased block reference shows (PIE-1043): the note's title (cut to fit, then ` › anchor` when the reference
 * names a fragment), and until the title is known, or when there is none, the id's first eight characters and `…`.
 */
function blockLabel(id: string, fragment: string | undefined, titleOf: (id: string) => string | undefined): string {
  const title = titleOf(id)?.replace(/\s+/g, ' ').trim()
  if (!title) return `${id.slice(0, 8)}…`
  const cut = title.length > TITLE_WIDTH ? `${title.slice(0, TITLE_WIDTH - 1).trimEnd()}…` : title
  return fragment ? `${cut} › ${fragment}` : cut
}

/** The block ids a reply names without a label (`((id))`, `((id^anchor))`, a `my.ep0ch.sh` address), lowercased: the titles to look up before it is drawn. */
export function unlabelledBlockIds(text: string): string[] {
  const ids = new Set<string>()
  for (const m of text.matchAll(new RegExp(`\\(\\((${UUID})(?:\\^${FRAGMENT})?\\)\\)|(?<=my\\.ep0ch\\.sh/pub/p/)(${UUID})`, 'g'))) ids.add((m[1] ?? m[2]!).toLowerCase())
  return [...ids]
}

/** Every block address a reply needs to resolve, including labelled references whose outline is not written. */
export function replyBlockTargets(text: string): string[] {
  return [...new Set(linkOccurrences(text).flatMap(r => r.kind === 'block' ? [`${r.outline ? r.outline + ':' : ''}${r.blockId.toLowerCase()}`] : []))];
}

export type Linkified = {
  /** The markdown to draw, references as stand-in links. */
  text: string
  /** Every stand-in href in `text`, once each: what `pressableLinks` takes. */
  hrefs: string[]
}

/**
 * `[[page]]`, `[[target|label]]`, `((uuid))`, `((uuid|label))` and bare Work
 * IDs with one of `prefixes`, rewritten as links outside protected ranges.
 */
export function linkifyReferences(text: string, prefixes: readonly string[], titleOf: (id: string) => string | undefined = () => undefined, outlineOf: (id: string) => string | undefined = () => undefined): Linkified {
  const hrefs = new Set<string>()
  const workIds = prefixes
    .filter(prefix => /^[A-Z][A-Z0-9]*$/.test(prefix))
    .map(prefix => `${prefix}-\\d+`)
  const rewrite = (plain: string) => {
    const links = linkOccurrences(plain);
    const work = workIds.length ? [...plain.matchAll(new RegExp(`(?<![\\w/#-])(${workIds.join('|')})(?![\\w-])`, 'g'))]
      .filter(m => !links.some(l => l.start <= m.index! && m.index! < l.end))
      .map(m => ({ kind: 'work' as const, start: m.index!, end: m.index! + m[0].length, value: m[0] })) : [];
    let out = '', at = 0;
    for (const ref of [...links, ...work].sort((a, b) => a.start - b.start)) {
      if (ref.kind === 'markdown') continue;
      const kind = ref.kind === 'block' ? 'block' : ref.kind === 'page' ? 'page' : 'work';
      const authoredOutline = ref.kind === 'work' ? undefined : ref.outline;
      const address = ref.kind === 'block' ? `${authoredOutline ? authoredOutline + ':' : ''}${ref.blockId.toLowerCase()}` : '';
      const outline = authoredOutline ?? (ref.kind === 'block' ? outlineOf(address) : undefined);
      const value = ref.kind === 'block' ? `${authoredOutline ? authoredOutline + ':' : ''}${ref.blockId.toLowerCase()}${ref.fragmentId ? '^' + ref.fragmentId : ''}`
        : ref.kind === 'page' ? ref.displayAddress : ref.value;
      const label = (outline ? `${outline} · ` : '') + (ref.kind === 'block' ? ref.label ?? blockLabel(ref.blockId, ref.fragmentId, () => titleOf(address))
        : ref.kind === 'page' ? ref.label ?? qualifiedReference(ref.displayAddress).target : ref.value);
      const href = `${STAND_IN}${kind}/${encodeURIComponent(value)}`;
      hrefs.add(href);
      out += plain.slice(at, ref.start) + `[${label.replace(/[[\]\\]/g, '\\$&')}](${href})`;
      at = ref.end;
    }
    return out + plain.slice(at);
  };

  let out = ''
  for (const run of codeRuns(text)) {
    if (run.code) { out += run.text; continue }
    let last = 0
    for (const match of run.text.matchAll(PROTECTED)) {
      out += rewrite(run.text.slice(last, match.index)) + (mirrored(match[0], hrefs, titleOf) ?? match[0])
      last = match.index + match[0].length
    }
    out += rewrite(run.text.slice(last))
  }
  return { text: out, hrefs: [...hrefs] }
}

/**
 * The `pi-outliner://` URI a stand-in href names, or null for any other link.
 */
export function outlinerUriOf(href: string): string | null {
  if (!href.startsWith(STAND_IN)) return null
  const [kind, value, ...rest] = href.slice(STAND_IN.length).split('/')
  if (rest.length || !value || !['block', 'page', 'work'].includes(kind!)) return null
  if (kind === 'block') {
    const [id, fragment] = decodeURIComponent(value).split('^');
    return `pi-outliner://block/${encodeURIComponent(id!)}${fragment ? '?fragment=' + encodeURIComponent(fragment) : ''}`;
  }
  return `pi-outliner://${kind}/${value}`
}

/**
 * The `pi-outliner://` URI for a reference as the model writes it: a Work ID,
 * `[[page]]`, `((uuid))`, a bare block UUID, a `pi-outliner://` URI, or else a
 * page address as given. Null for an empty reference.
 */
export function outlinerUriFor(reference: string): string | null {
  const text = reference.trim()
  if (!text) return null
  if (text.startsWith('pi-outliner://')) return text
  if (new RegExp(`^${UUID}$`).test(text)) return `pi-outliner://block/${text.toLowerCase()}`
  if (/^[A-Z][A-Z0-9]*-\d+$/.test(text)) return `pi-outliner://work/${text}`
  const { hrefs } = linkifyReferences(text, [])
  if (hrefs.length === 1 && /^(\[\[[^\]]+\]\]|\(\([^)]+\)\))$/.test(text)) return outlinerUriOf(hrefs[0]!)
  return `pi-outliner://page/${encodeURIComponent(text)}`
}

/** What a `pi-outliner://` URI names, as the person reads it: the Work ID, page name or block id. */
export function outlinerLabelOf(uri: string): string {
  return decodeURIComponent(uri.slice(uri.indexOf('/', 'pi-outliner://'.length) + 1))
}

/** The block id a `pi-outliner://block/…` URI names, lowercased; null for a page, Work ID or anything else. */
export function outlinerBlockIdOf(uri: string): string | null {
  return new RegExp(`^pi-outliner://block/(${UUID})$`).exec(uri)?.[1]?.toLowerCase() ?? null
}

/**
 * The reference the outline writes for a URI, the reverse of `outlinerUriFor`:
 * `((id))` for a block, `[[page]]` for a page, the Work ID itself.
 */
export function outlinerReferenceOf(uri: string): string {
  const block = outlinerBlockIdOf(uri)
  if (block) return `((${block}))`
  return uri.startsWith('pi-outliner://page/') ? `[[${outlinerLabelOf(uri)}]]` : outlinerLabelOf(uri)
}

/**
 * Whether a navigation failed only because its destination is mid-edit (or
 * holding a source selection): the Outliner protects it, and the person
 * finishes there; it is never overridden.
 */
export function isProtectedDestination(reason: string): boolean {
  return reason.startsWith('Destination is protected')
}
