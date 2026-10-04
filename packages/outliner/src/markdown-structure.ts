import {Marked, Tokenizer, type Token, type Tokens} from 'marked';
import {COMPONENT_OPEN, componentBlockAt} from '@ep0ch/outline-core/component-block';
import type {PreviewSourceSpan} from './detail-preview-regions';

// A component block (`::graph-stat` … `::`) is one opaque token: its `---` lines are YAML fences, not setext
// headings, so sections and folds run through it (outline-core's component-block rule). `start` lets one cut a
// paragraph short; the setext tokenizer runs before that cut, so it stops at a component's first line too.
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+) *$/;
/** A line that starts a block of its own (heading, fence, quote, list item, rule, HTML): the paragraph ends before it. */
const BLOCK_START = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|```|~~~|>|[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|(?:[-*_][ \t]*){3,}$|<[A-Za-z!/?])/;
/** A GFM table's delimiter row: the line above it, with a `|`, starts a table, which ends a paragraph too. */
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
/** The first line of `src` that opens a component block, as an offset, or -1: where a table must stop. */
function componentLineIn(src: string): number {
  for (let at = 0; at < src.length;) {
    const next = src.indexOf('\n', at), end = next < 0 ? src.length : next;
    if (at > 0 && COMPONENT_OPEN.test(src.slice(at, end)) && componentBlockAt(src.slice(at))) return at;
    if (at > 0 && !src.slice(at, end).trim()) return -1;
    at = end + 1;
  }
  return -1;
}
const parser = new Marked({
  extensions: [{
    name: 'component', level: 'block',
    // Where a paragraph must be cut: the first line, before its blank line, that opens a component block. It reads
    // only the paragraph (marked asks before each one) and never cuts at an opener that opens nothing (plain text).
    start: (src: string) => {
      for (let at = src.indexOf('\n'); at >= 0;) {
        const from = at + 1, next = src.indexOf('\n', from), line = src.slice(from, next < 0 ? src.length : next);
        if (!line.trim()) return undefined;
        if (/^[ \t]*::[a-z]/.test(line) && COMPONENT_OPEN.test(line) && componentBlockAt(src.slice(from))) return from;
        at = next;
      }
      return undefined;
    },
    tokenizer: (src: string) => {
      const block = componentBlockAt(src);
      return block ? {type: 'component', raw: block.raw, name: block.name} : undefined;
    },
    renderer: () => '',
  }],
  tokenizer: {
    lheading(src: string) {
      // The paragraph's own lines, read one at a time up to its first blank line: a heading, fence, list, table or
      // rule there is its own block (marked's rules decide); a component's first line ends the paragraph before it.
      // Only a line matching COMPONENT_OPEN is tried as a component, so this stays linear.
      let at = src.indexOf('\n') + 1;
      while (at > 0 && at < src.length) {
        const next = src.indexOf('\n', at), end = next < 0 ? src.length : next, line = src.slice(at, end);
        if (!line.trim() || SETEXT_UNDERLINE.test(line) || BLOCK_START.test(line)) return false;
        if (line.includes('|') && next >= 0 && TABLE_DELIMITER.test(src.slice(next + 1, (src.indexOf('\n', next + 1) + 1 || src.length + 1) - 1))) return false;
        if (COMPONENT_OPEN.test(line) && componentBlockAt(src.slice(at))) {
          const raw = src.slice(0, at), text = raw.trimEnd();
          return {type: 'paragraph', raw, text, tokens: this.lexer.inline(text)} as unknown as false;
        }
        at = end + 1;
      }
      return false;
    },
    table(src: string) {
      // A table's rows end before a component's first line (marked would read `::graph-stat` as a row).
      const cut = componentLineIn(src);
      return (Tokenizer.prototype.table as (s: string) => Tokens.Table | undefined).call(this, cut < 0 ? src : src.slice(0, cut)) as unknown as false;
    },
  },
});

export interface MarkdownSourceToken {
  token: Token;
  span: PreviewSourceSpan;
  children: MarkdownSourceToken[];
}

export interface MarkdownListItem {
  span: PreviewSourceSpan;
  depth: number;
  parentStart?: number;
}

/** Canonical list extents, including continuations and nested lists, in source order. */
export function markdownListItems(source: string): MarkdownListItem[] {
  const items: MarkdownListItem[] = [];
  const visit = (nodes: MarkdownSourceToken[], depth: number, parentStart?: number): void => {
    for (const node of nodes) {
      if (node.token.type === 'list_item') {
        items.push({span: node.span, depth, ...(parentStart === undefined ? {} : {parentStart})});
        visit(node.children, depth + 1, node.span.start);
      } else visit(node.children, depth, parentStart);
    }
  };
  visit(markdownSourceTokens(source), 0);
  return items;
}

/** One block-token tree for document layout and interactions, with original-source ranges. */
export function markdownSourceTokens(source: string): MarkdownSourceToken[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  const lineAt = (offset: number): number => {
    let low = 0, high = starts.length;
    while (low + 1 < high) {const middle = (low + high) >>> 1; if (starts[middle]! <= offset) low = middle; else high = middle;}
    return low;
  };
  let text = '';
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\r') {text += '\n'; if (source[i + 1] === '\n') i++;}
    else text += source[i];
    offsets.push(i + 1);
  }
  // Marked removes quote/list prefixes in child text. Match each child's line
  // only within its corresponding parent line; ambiguous/unmappable children
  // remain non-interactive rather than borrowing another occurrence's range.
  const childOffsets = (raw: string, child: string, map: number[]): number[] | null => {
    const rawLines = raw.split('\n'), childLines = child.split('\n');
    if (childLines.length > rawLines.length) return null;
    const result: number[] = [];
    let rawStart = 0;
    for (let line = 0; line < childLines.length; line++) {
      const value = childLines[line]!, parent = rawLines[line]!;
      const column = parent.lastIndexOf(value);
      if (column < 0 || parent.slice(column + value.length).trim()) return null;
      for (let i = 0; i < value.length; i++) result.push(map[rawStart + column + i]!);
      if (line < childLines.length - 1) result.push(map[rawStart + parent.length]!);
      else result.push(map[rawStart + column + value.length]!);
      rawStart += parent.length + 1;
    }
    return result;
  };
  const visit = (input: string, map: number[], tokens: Token[]): MarkdownSourceToken[] => {
    const result: MarkdownSourceToken[] = [];
    let cursor = 0;
    for (const token of tokens) {
      if (token.type === 'checkbox') continue; // Synthetic token, already present in the list marker.
      let start = input.indexOf(token.raw, cursor), end = start + token.raw.length;
      if (start < 0 && token.raw.endsWith('\n') && input.slice(cursor) === token.raw.slice(0, -1)) {start = cursor; end = input.length;}
      if (start < 0) continue;
      const begin = map[start]!;
      // The next mapped character can be beyond a stripped quote/list prefix.
      // End at the last consumed character, not at the next child's start.
      const last = map[end - 1];
      const finish = last === undefined ? begin : last + (source[last] === '\r' && source[last + 1] === '\n' ? 2 : 1);
      const node: MarkdownSourceToken = {token, span: {start: begin, end: finish, startLine: lineAt(begin), endLine: lineAt(Math.max(begin, finish - 1))}, children: []};
      const localMap = map.slice(start, end + 1);
      if (token.type === 'list') node.children = visit(input.slice(start, end), localMap, token.items);
      else if (token.type === 'list_item' || token.type === 'blockquote') {
        const mapped = childOffsets(input.slice(start, end), token.text, localMap);
        if (mapped) node.children = visit(token.text, mapped, token.tokens ?? []);
      }
      result.push(node);
      cursor = end;
    }
    return result;
  };
  return visit(text, offsets, parser.lexer(text));
}

/** Present a selected list subtree without turning its original nesting into code.
 * Line count stays unchanged so callers can retain canonical source spans. */
export function standaloneListItemText(text: string): string {
  const lines = text.split(/\r?\n/);
  const indent = /^[ \t]*/.exec(lines[0] ?? "")![0];
  return lines.map(line => line.startsWith(indent) ? line.slice(indent.length) : line).join("\n");
}
