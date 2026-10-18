/**
 * A reply's references, drawn as their labels only (PIE-1042). Claude Code's `Markdown` and `Link` print the address
 * beside the text in a terminal that has no hyperlinks (`PIE-1008 (https://pi-outliner.invalid/work/PIE-1008)`), and
 * neither can be told not to. So in a terminal the lines that hold a reference are drawn by the mod, one pressable
 * label per reference; every other line stays the engine's Markdown, in runs. Pure: the elements come from register.ts.
 */
import { codeBlocks } from './code-fence'
import { outlinerUriOf } from './references'

/** One drawn piece of a line: prose with its inline style, or a reference to press. */
export type LinePart =
  | { text: string; style?: 'bold' | 'italic' | 'bold-italic' | 'code' | 'dim' }
  | { ref: string; label: string; external?: true }

export type ReplyBlock =
  | { kind: 'markdown'; text: string }
  | { kind: 'line'; parts: LinePart[] }
  | { kind: 'table'; header: LinePart[][]; rows: LinePart[][][] }

/** `[label](stand-in)` as `linkifyReferences` writes it (labels have `[`, `]` and `\` escaped). */
const LINK = /\[((?:[^\]\\\n]|\\.)*)\]\((https?:\/\/[^)\s]*)\)|`[^`\n]*`|\bhttps?:\/\/[^\s<>()[\]`]+/gi

/** A reference stands in the text as `OPEN n CLOSE` while emphasis is found around it (private-use characters). */
const OPEN = '\uE000'
const CLOSE = '\uE001'
const SLOT = /\uE000(\d+)\uE001/g

type Ref = { ref: string; label: string; external?: true; bare?: true }
type Style = 'bold' | 'italic' | 'bold-italic' | 'code' | 'dim'

const EMPHASIS = /`([^`\n]+)`|(\*\*\*|\*\*|__)(?=\S)(.+?)(?<=\S)\2|(?<![\w*])([*_])(?=[^\s*_])([^\n]*?[^\s*_])\4(?![\w*])/g

function withStyle(base: Style | undefined, add: 'bold' | 'italic'): Style {
  if (!base || base === add) return add
  return base === 'code' ? base : 'bold-italic'
}

/** A run of text holding reference slots, as parts: each slot a reference, the rest in `style`. */
function slots(text: string, refs: Ref[], style: Style | undefined): LinePart[] {
  const parts: LinePart[] = []
  let last = 0
  for (const match of text.matchAll(SLOT)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), ...(style ? { style } : {}) })
    const ref = refs[Number(match[1])]!
    // Link's no-hyperlink fallback repeats its address beside its children. A bare URL is already the address.
    parts.push(ref.bare ? { text: `${ref.label} »`, style: 'dim' } : { ...ref })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), ...(style ? { style } : {}) })
  return parts
}

/**
 * Prose and reference slots as parts: `**bold**`, `*italic*`, `***both***` and `` `code` `` as styles with the markers
 * dropped, around references and other text alike (PIE-1043); the references themselves carry no style (underlined already).
 */
function styled(text: string, refs: Ref[], style?: Style): LinePart[] {
  const parts: LinePart[] = []
  let last = 0
  for (const match of text.matchAll(EMPHASIS)) {
    if (match.index > last) parts.push(...slots(text.slice(last, match.index), refs, style))
    if (match[1] !== undefined) {
      parts.push({ text: match[1].replace(SLOT, (_, n) => refs[Number(n)]!.label), style: 'code' })
    } else if (match[2] !== undefined) {
      const add = match[2] === '***' ? 'bold-italic' : 'bold'
      parts.push(...styled(match[3]!, refs, add === 'bold-italic' ? 'bold-italic' : withStyle(style, 'bold')))
    } else {
      parts.push(...styled(match[5]!, refs, withStyle(style, 'italic')))
    }
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(...slots(text.slice(last), refs, style))
  return parts
}

/** Inline parts of some text holding references, or null when it holds none the mod can open. */
function inlineOf(text: string): LinePart[] | null {
  const refs: Ref[] = []
  const slotted = text.replace(LINK, (whole, label: string | undefined, href: string | undefined) => {
    if (whole.startsWith('`')) return whole
    if (label !== undefined && href !== undefined) {
      // `[label](address)`: a reference when the address is a stand-in, else a link out (PIE-1043).
      refs.push(outlinerUriOf(href) ? { ref: href, label: label.replace(/\\(.)/g, '$1') } : { ref: href, label: label.replace(/\\(.)/g, '$1'), external: true })
      return `${OPEN}${refs.length - 1}${CLOSE}`
    }
    // A bare address: the text stays as written, trailing punctuation outside it.
    const [, url, tail] = /^(.*?)([.,;:!?]*)$/s.exec(whole)!
    refs.push({ ref: url!, label: url!, external: true, bare: true })
    return `${OPEN}${refs.length - 1}${CLOSE}${tail}`
  })
  return refs.length ? styled(slotted, refs) : null
}

/** One line holding references as its parts, or null when it holds none the mod can open. */
function lineOf(line: string): LinePart[] | null {
  const heading = /^#{1,6}\s+/.exec(line)
  const bullet = heading ? null : /^(\s*)[-*+]\s+/.exec(line)
  const body = inlineOf(line.slice((heading ?? bullet)?.[0].length ?? 0))
  if (!body) return null
  const parts: LinePart[] = bullet ? [{ text: `${bullet[1]}• ` }, ...body] : body
  return heading ? parts.map(part => 'ref' in part || part.style === 'dim' ? part : { ...part, style: part.style === 'italic' || part.style === 'bold-italic' ? 'bold-italic' as const : 'bold' as const }) : parts
}

const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

function cellsOf(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split(/(?<!\\)\|/).map(cell => cell.replace(/\\\|/g, '|').trim())
}

/** The text a part shows, for a column's width. */
const shown = (parts: LinePart[]) => parts.reduce((n, part) => n + ('ref' in part ? part.label.length + (part.external ? 2 : 0) : part.text.length), 0)

/** Each column's width: its longest cell. */
export function tableWidths(table: { header: LinePart[][]; rows: LinePart[][][] }): number[] {
  return table.header.map((_, c) => Math.max(1, shown(table.header[c]!), ...table.rows.map(row => shown(row[c] ?? []))))
}

/**
 * The linkified reply cut into runs of Markdown, lines of parts and whole tables, in order. A line in a code block is
 * never a line of parts. A table with a reference in any cell is drawn whole by the mod (the engine would print the
 * address beside its links); one with none stays the engine's. Joined, the Markdown runs, lines and tables read as the
 * reply did, minus the addresses.
 */
export function replyBlocks(linkified: string): ReplyBlock[] {
  const lines = linkified.split('\n')
  const { fences, indented } = codeBlocks(lines)
  const code = new Set(indented)
  for (const fence of fences) for (let i = fence.start; i <= fence.end; i++) code.add(i)
  const blocks: ReplyBlock[] = []
  const markdown = (line: string) => {
    const last = blocks.at(-1)
    if (last?.kind === 'markdown') last.text += `\n${line}`
    else blocks.push({ kind: 'markdown', text: line })
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!code.has(i) && TABLE_ROW.test(line) && i + 1 < lines.length && !code.has(i + 1) && TABLE_RULE.test(lines[i + 1]!) && lines[i + 1]!.includes('-')) {
      let end = i + 2
      while (end < lines.length && !code.has(end) && TABLE_ROW.test(lines[end]!)) end++
      const header = cellsOf(line)
      const body = lines.slice(i + 2, end).map(row => cellsOf(row))
      const drawn = [header, ...body].map(row => row.map(cell => ({ cell, parts: inlineOf(cell) })))
      if (drawn.some(row => row.some(({ parts }) => parts))) {
        const columns = header.length
        const asParts = (row: { cell: string; parts: LinePart[] | null }[]) =>
          Array.from({ length: columns }, (_, c) => row[c]?.parts ?? (row[c] ? styled(row[c]!.cell, []) : []))
        blocks.push({ kind: 'table', header: asParts(drawn[0]!), rows: drawn.slice(1).map(asParts) })
        i = end - 1
        continue
      }
      for (let j = i; j < end; j++) markdown(lines[j]!)
      i = end - 1
      continue
    }
    const parts = code.has(i) ? null : lineOf(line)
    if (parts) blocks.push({ kind: 'line', parts })
    else markdown(line)
  }
  return blocks
}
