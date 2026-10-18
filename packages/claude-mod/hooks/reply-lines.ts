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
  | { text: string; style?: 'bold' | 'italic' | 'code' }
  | { ref: string; label: string }

export type ReplyBlock =
  | { kind: 'markdown'; text: string }
  | { kind: 'line'; parts: LinePart[] }

/** `[label](stand-in)` as `linkifyReferences` writes it (labels have `[`, `]` and `\` escaped). */
const LINK = /\[((?:[^\]\\\n]|\\.)*)\]\((https:\/\/pi-outliner\.invalid\/[^)\s]*)\)/g

/** Prose between references: `**bold**`, `*italic*` and `` `code` `` as styles, the markers dropped. */
function styled(prose: string): LinePart[] {
  const parts: LinePart[] = []
  let last = 0
  for (const match of prose.matchAll(/\*\*([^*\n]+)\*\*|`([^`\n]+)`|(?<![\w*])\*([^*\n]+)\*(?![\w*])/g)) {
    if (match.index > last) parts.push({ text: prose.slice(last, match.index) })
    parts.push(match[1] !== undefined ? { text: match[1], style: 'bold' } : match[2] !== undefined ? { text: match[2], style: 'code' } : { text: match[3]!, style: 'italic' })
    last = match.index + match[0].length
  }
  if (last < prose.length) parts.push({ text: prose.slice(last) })
  return parts
}

/** One line holding references as its parts, or null when it holds none the mod can open. */
function lineOf(line: string): LinePart[] | null {
  const heading = /^#{1,6}\s+/.exec(line)
  const bullet = heading ? null : /^(\s*)[-*+]\s+/.exec(line)
  const prefix = bullet ? `${bullet[1]}• ` : ''
  // Emphasis around a reference alone is dropped: the label is underlined already.
  const body = line.slice((heading ?? bullet)?.[0].length ?? 0).replace(/(\*\*|\*|__)(\[(?:[^\]\\\n]|\\.)*\]\(https:\/\/pi-outliner\.invalid\/[^)\s]*\))\1/g, '$2')
  const parts: LinePart[] = prefix ? [{ text: prefix }] : []
  let last = 0
  let refs = 0
  for (const match of body.matchAll(LINK)) {
    if (!outlinerUriOf(match[2]!)) continue
    parts.push(...styled(body.slice(last, match.index)))
    parts.push({ ref: match[2]!, label: match[1]!.replace(/\\(.)/g, '$1') })
    last = match.index + match[0].length
    refs++
  }
  if (!refs) return null
  parts.push(...styled(body.slice(last)))
  return heading ? parts.map(part => 'ref' in part ? part : { ...part, style: 'bold' as const }) : parts
}

/**
 * The linkified reply cut into runs of Markdown and lines of parts, in order. A line in a code block is never a line of
 * parts. Joined, the Markdown runs and the lines read as the reply did, minus the addresses.
 */
export function replyBlocks(linkified: string): ReplyBlock[] {
  const lines = linkified.split('\n')
  const { fences, indented } = codeBlocks(lines)
  const code = new Set(indented)
  for (const fence of fences) for (let i = fence.start; i <= fence.end; i++) code.add(i)
  const blocks: ReplyBlock[] = []
  lines.forEach((line, i) => {
    const parts = code.has(i) ? null : lineOf(line)
    const last = blocks.at(-1)
    if (parts) blocks.push({ kind: 'line', parts })
    else if (last?.kind === 'markdown') last.text += `\n${line}`
    else blocks.push({ kind: 'markdown', text: line })
  })
  return blocks
}
