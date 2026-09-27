import {createHash} from 'node:crypto';
import {marked, type Token} from 'marked';
import {markdownSourceTokens, type MarkdownSourceToken} from './markdown-structure';
import {fragmentAnchors} from './fragments';
import {previewRegionActionUri, type PreviewRegion, type PreviewRegionState} from './detail-preview-regions';
import type {DetailCalloutRegion} from './detail-callouts';

export interface DocumentFold extends PreviewRegion {
  kind: 'document-fold';
  structure: 'heading' | 'list-item';
  headerEndLine: number;
  contentStartLine: number;
}

/** Ranges belong to the supplied document occurrence, never to a different embedded note. */
export function documentFolds(source: string, boundaries: readonly {startLine: number; endLine: number}[] = []): DocumentFold[] {
  const nodes = markdownSourceTokens(source);
  const lines = source.split(/\r?\n/);
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  const anchors = fragmentAnchors(source);
  // A source edit retires anonymous identities rather than moving a fold onto
  // a similarly named/reordered heading. Resizes do not change this identity.
  const revision = createHash('sha256').update(source).digest('hex').slice(0, 16);
  const folds: DocumentFold[] = [];
  const occurrenceAt = (line: number) => boundaries.filter(range => range.startLine <= line && range.endLine >= line).sort((a,b) => b.startLine - a.startLine)[0];
  const add = (node: MarkdownSourceToken, endLine: number, headerEndLine: number, structure: DocumentFold['structure']) => {
    const containing = occurrenceAt(node.span.startLine);
    if (containing) endLine = Math.min(endLine, containing.endLine);
    const contentStartLine = headerEndLine + 1;
    if (!lines.slice(contentStartLine, endLine + 1).some(line => line.trim())) return;
    const explicit = anchors.find(anchor => anchor.lineIndex >= node.span.startLine && anchor.lineIndex <= headerEndLine);
    const identity = explicit && anchors.filter(anchor => anchor.id === explicit.id).length === 1 ? `^${explicit.id}` : String(node.span.startLine);
    const id = `fold:${identity.startsWith('^') ? 'explicit' : revision}:${structure}:${identity}`;
    folds.push({id, kind: 'document-fold', structure, headerEndLine, contentStartLine,
      sourceSpan: {...node.span, end: lineStarts[endLine + 1] ?? source.length, endLine}, parentId: null, childIds: [], focusable: true,
      disclosure: {defaultExpanded: true, expanded: true}, activation: {type: 'document.disclosure.toggle', regionId: id}});
  };
  const visit = (siblings: MarkdownSourceToken[], boundary: number) => {
    for (const [index, node] of siblings.entries()) {
      if (node.token.type === 'heading') {
        const depth = node.token.depth;
        const occurrence = occurrenceAt(node.span.startLine);
        const next = siblings.slice(index + 1).find(other => other.token.type === 'heading' && other.token.depth <= depth && occurrenceAt(other.span.startLine) === occurrence);
        add(node, next ? next.span.startLine - 1 : boundary, node.span.endLine, 'heading');
      }
      if (node.token.type === 'list_item') {
        const lead = node.children.find(child => child.token.type !== 'space');
        if (lead && lead.token.type !== 'list') add(node, node.span.endLine, lead.span.endLine, 'list-item');
      }
      if (node.children.length) visit(node.children, node.span.endLine);
    }
  };
  visit(nodes, lines.length - 1);
  folds.sort((a, b) => a.sourceSpan!.startLine - b.sourceSpan!.startLine || b.sourceSpan!.endLine - a.sourceSpan!.endLine);
  for (const fold of folds) {
    const parent = folds.filter(other => other !== fold && other.contentStartLine <= fold.sourceSpan!.startLine && other.sourceSpan!.endLine >= fold.sourceSpan!.endLine)
      .sort((a,b) => b.contentStartLine - a.contentStartLine)[0];
    fold.parentId = parent?.id ?? null;
    parent?.childIds.push(fold.id);
  }
  return folds;
}

export interface FoldedDocument {
  text: string;
  /** Each source line maps to its visible line, or the disclosure hiding it. */
  lineMap: number[];
  visibleSourceLines: number[];
}

function headingLabel(tokens: Token[], uri: string): string {
  return tokens.map(token => {
    if (token.type === 'link' || token.type === 'image') return token.raw;
    if ('tokens' in token && token.tokens?.some((child: Token) => child.type === 'link')) {
      const delimiter = token.type === 'strong' ? '**' : token.type === 'em' ? '*' : token.type === 'del' ? '~~' : '';
      return delimiter + headingLabel(token.tokens, uri) + delimiter;
    }
    return token.raw.trim() ? `[${token.raw}](${uri})` : token.raw;
  }).join('');
}

/** Visibility is applied to source lines before Markdown layout and link measurement. */
export function foldDocument(source: string, folds: readonly DocumentFold[], state: Readonly<PreviewRegionState>): FoldedDocument {
  const lines = source.split(/(?<=\n)/), output: string[] = [], lineMap: number[] = [], visibleSourceLines: number[] = [];
  const expanded = (fold: DocumentFold) => state.disclosureOverrides.get(fold.id) ?? true;
  for (let line = 0; line < lines.length; line++) {
    const hidden = folds.find(fold => !expanded(fold) && line >= fold.contentStartLine && line <= fold.sourceSpan!.endLine);
    if (hidden) {lineMap.push(lineMap[hidden.sourceSpan!.startLine] ?? 0); continue;}
    lineMap.push(output.length);visibleSourceLines.push(line);
    let text = lines[line]!;
    const fold = folds.find(fold => fold.sourceSpan!.startLine === line);
    if (fold) {
      const uri = previewRegionActionUri(fold.activation!);
      // Distinct presentation target lets copy omit the generated glyph only,
      // including when the author used the same glyph in the heading itself.
      const controlUri = uri.replace('//document-toggle/', '//document-control/');
      const control = `[${expanded(fold) ? '▾' : '▸'} ](${controlUri})`;
      if (fold.structure === 'heading') {
        const heading = /^((?:[ \t]*>[ \t]?)*[ \t]*#{1,6}[ \t]+)(.*?)(\r?\n)?$/.exec(text);
        if (heading) text = heading[1] + control + headingLabel(marked.Lexer.lexInline(heading[2]!), uri) + (heading[3] ?? '');
        else {
          const label = /^((?:[ \t]*>[ \t]?)*[ \t]*)(.*?)(\r?\n)?$/.exec(text)!;
          text = label[1] + control + headingLabel(marked.Lexer.lexInline(label[2]!), uri) + (label[3] ?? '');
        }
      } else {
        const marker = /^((?:[ \t]*>[ \t]?)*[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX~!]\][ \t]+)?)/.exec(text);
        if (marker) text = marker[1] + control + text.slice(marker[1].length);
      }
    }
    output.push(text);
  }
  return {text: output.join(''), lineMap, visibleSourceLines};
}

export function revealFoldedLine(state: PreviewRegionState, folds: readonly (DocumentFold | DetailCalloutRegion)[], line: number): void {
  for (const fold of folds) if (line >= ('contentStartLine' in fold ? fold.contentStartLine : fold.headerLine + 1) && line <= fold.sourceSpan!.endLine) {
    state.disclosureOverrides.set(fold.id, true);
    const live = state.regions.find(region => region.id === fold.id);
    if (live?.disclosure) live.disclosure.expanded = true;
  }
}
