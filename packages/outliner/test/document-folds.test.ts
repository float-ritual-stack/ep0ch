import {expect, test} from 'bun:test';
import {stripTerminalSequences, type MarkdownTheme} from '@earendil-works/pi-tui';
import {documentFolds, revealFoldedLine} from '../src/document-folds';
import {replaceSectionText} from '../src/work-tools';
import {markdownSourceTokens} from '../src/markdown-structure';
import {SourceSpannedMarkdown} from '../src/source-spanned-markdown';
import {parseDetailCallouts} from '../src/detail-callouts';
import {reconcilePreviewRegions, togglePreviewRegionDisclosure, movePreviewRegionFocus, type PreviewRegionState} from '../src/detail-preview-regions';

const theme = Object.fromEntries(['heading','link','linkUrl','code','codeBlock','codeBlockBorder','quote','quoteBorder','hr','listBullet','bold','italic','strikethrough','underline'].map(key => [key, (text: string) => key === 'linkUrl' ? '' : text])) as unknown as MarkdownTheme;
const state = (): PreviewRegionState => ({regions: [], focusedRegionId: null, disclosureOverrides: new Map()});
const source = `# Plan
Intro
## Repeat
- [ ] Parent on
  another source line

  Extra paragraph

  - Nested [destination](https://example.test/hidden)
    continuation
- Sibling

### Inside
Body

\`\`\`md
# Fenced heading
- Fenced item
\`\`\`
## Repeat
Other body
`;

test.each(['\n', '\r\n'])('folds Markdown structure while retaining nested choices and exact visible links (%j)', newline => {
  const text = source.replaceAll('\n', newline), regions = documentFolds(text), view = state();
  reconcilePreviewRegions(view, regions);
  const renderer = new SourceSpannedMarkdown(theme, text => text, view, true, undefined, true);
  renderer.setContent(text, [], false, [], regions);
  const render = (width = 70) => renderer.render(width).map(stripTerminalSequences).join('\n');
  const list = regions.find(region => region.structure === 'list-item')!;
  const section = regions.find(region => region.sourceSpan!.startLine === 2)!;
  expect(render()).toContain('Fenced heading');
  expect(regions.some(region => region.sourceSpan!.startLine === 16)).toBe(false);
  togglePreviewRegionDisclosure(view, list.id);
  expect(render()).toContain('another source line');
  expect(render()).not.toContain('Extra paragraph');
  expect(render()).toContain('Sibling');
  expect(renderer.renderedLinks.some(link => link.uri === 'https://example.test/hidden')).toBe(false);
  view.focusedRegionId = list.id;
  togglePreviewRegionDisclosure(view, section.id);
  expect(view.focusedRegionId).toBe(section.id);
  expect(render()).not.toContain('Parent on');
  expect(render()).toContain('Other body');
  togglePreviewRegionDisclosure(view, section.id);
  expect(render(24)).toContain('Parent on');
  expect(render(24)).not.toContain('Extra paragraph');
  revealFoldedLine(view, regions, 8);
  const visible = render();
  expect(visible).toContain('Extra paragraph');
  expect(renderer.renderedLinks.some(link => link.uri === 'https://example.test/hidden')).toBe(true);
  expect(renderer.sourceLineRow(70, 20)).toBe(renderer.render(70).findIndex(line => stripTerminalSequences(line).includes('Other body')));
  const other = state();
  reconcilePreviewRegions(other, regions);
  expect(other.disclosureOverrides.size).toBe(0);
});

test('source edits retire anonymous fold identity; hidden descendants leave keyboard traversal', () => {
  const view = state(), folds = documentFolds(source);
  reconcilePreviewRegions(view, folds);
  togglePreviewRegionDisclosure(view, folds[0]!.id);
  view.focusedRegionId = folds[0]!.id;
  expect(movePreviewRegionFocus(view, 1)?.id).toBe(folds[0]!.id);
  const edited = documentFolds(source.replace('Intro', 'New section\nIntro'));
  reconcilePreviewRegions(view, edited);
  expect(view.disclosureOverrides.size).toBe(0);
  expect(view.regions.every(region => region.disclosure?.expanded)).toBe(true);
});

test('repeated embed occurrences fold independently and explicit identities survive an unambiguous edit', () => {
  const text = '# Host\nIntro\n## Shared\nFirst body\nHost continuation\n## Shared\nSecond body\n# End\nLast';
  const regions = documentFolds(text, [{startLine:2,endLine:3}, {startLine:5,endLine:6}]);
  const view = state();
  reconcilePreviewRegions(view, regions);
  const first = regions.find(region => region.sourceSpan!.startLine === 2)!;
  togglePreviewRegionDisclosure(view, first.id);
  const renderer = new SourceSpannedMarkdown(theme, text => text, view);
  renderer.setContent(text, [], false, [], regions);
  const visible = renderer.render(50).map(stripTerminalSequences).join('\n');
  expect(visible).not.toContain('First body');
  expect(visible).toContain('Host continuation');
  expect(visible).toContain('Second body');
  const original = documentFolds('# Named ^stable\nBody');
  reconcilePreviewRegions(view, original);
  togglePreviewRegionDisclosure(view, original[0]!.id);
  reconcilePreviewRegions(view, documentFolds('Intro\n\n# Renamed ^stable\nEdited body'));
  expect(view.regions[0]!.disclosure!.expanded).toBe(false);
});

test('a folded heading keeps authored callout defaults and quoted nested-list structure intact', () => {
  const text = '# Head\n\n> [!note]- Saved\n> Hidden callout\n\n> - Outer\n>   - Inner\n\n# Tail\nVisible tail';
  const folds = documentFolds(text), callouts = parseDetailCallouts(text), view = state();
  reconcilePreviewRegions(view, [...folds, ...callouts]);
  const renderer = new SourceSpannedMarkdown(theme, text => text, view);
  renderer.setContent(text, [], false, callouts, folds);
  const render = () => renderer.render(70).map(stripTerminalSequences).join('\n');
  expect(folds.some(fold => fold.structure === 'list-item' && fold.sourceSpan!.startLine === 5)).toBe(true);
  expect(render()).not.toContain('Hidden callout');
  togglePreviewRegionDisclosure(view, folds[0]!.id);
  expect(render()).not.toContain('Inner');
  expect(render()).toContain('Visible tail');
  togglePreviewRegionDisclosure(view, folds[0]!.id);
  expect(render()).toContain('Inner');
  expect(render()).not.toContain('Hidden callout');
});

test('a heading used as a list lead retains heading structure and reachable disclosures',()=>{
 const text='- # Heading\n\n  Body\n\n  ## Inner\n\n  Inner body\n\n- Sibling';
 const view=state(),folds=documentFolds(text);
 reconcilePreviewRegions(view,folds);
 const renderer=new SourceSpannedMarkdown({...theme,heading:text=>`HEADING(${text})`},text=>text,view,true,undefined,true);
 renderer.setContent(text,[],false,[],folds);
 const paint=()=>renderer.render(60).map(stripTerminalSequences).join('\n');
 expect(paint()).toContain('HEADING(');
 expect(paint()).not.toContain('# Heading');
 for(const region of folds)expect(renderer.renderedLinks.some(link=>link.uri.includes(encodeURIComponent(region.id)))).toBe(true);
 const list=folds.find(region=>region.structure==='list-item');
 const owner=list??folds.find(region=>region.sourceSpan!.startLine===0)!;
 togglePreviewRegionDisclosure(view,owner.id);
 expect(paint()).not.toContain('Inner body');
 expect(paint()).toContain('Sibling');
});

test.each([
 {text:'# Heading ###\nBody',labels:['Heading']},
 {text:'Multiline\nheading\n---\nBody',labels:['Multiline','heading']},
])('heading labels preserve delimiter semantics and full interaction: $text',({text,labels})=>{
 const view=state(),folds=documentFolds(text);
 reconcilePreviewRegions(view,folds);
 const renderer=new SourceSpannedMarkdown(theme,text=>text,view,true,undefined,true);
 renderer.setContent(text,[],false,[],folds);
 const visible=renderer.render(60).map(stripTerminalSequences).join('\n');
 expect(visible).not.toContain('###');
 for(const label of labels)expect(renderer.renderedLinks.some(link=>link.label===label&&link.uri.includes('document-toggle'))).toBe(true);
});

test('theme invalidation reaches the visible folded document',()=>{
 let accent='FIRST';const view=state(),text='# Heading\nBody',folds=documentFolds(text);
 reconcilePreviewRegions(view,folds);
 const renderer=new SourceSpannedMarkdown({...theme,heading:text=>`${accent}:${text}`},text=>text,view,true);
 renderer.setContent(text,[],false,[],folds);
 expect(renderer.render(50).join('\n')).toContain('FIRST:');
 accent='SECOND';renderer.invalidate();
 expect(renderer.render(50).join('\n')).toContain('SECOND:');
});

// A component block's `---` lines are its YAML fence, not setext underlines: `::graph-stat` then `---` once
// lexed as a level-2 heading, which ended the section above it (and replaceSection kept the old figure).
const figureNote = `Review note

## Since last review

::graph-stat
---
title: Open
items:
  - { label: open, query: "status=open" }
---
::

## Rounds

round one`;

test('a component block is part of the section it sits in, never a heading', () => {
  const folds = documentFolds(figureNote).filter(fold => fold.structure === 'heading');
  expect(folds.map(fold => [fold.sourceSpan!.startLine, fold.sourceSpan!.endLine])).toEqual([[2, 11], [12, 14]]);
});

test('replaceSection replaces a section that holds a component block, figure included', () => {
  const replaced = replaceSectionText(figureNote, '## Since last review', 'new body', 'note');
  expect(replaced.previous).toBe(figureNote.split('\n').slice(4, 11).join('\n'));
  expect(replaced.text).toBe('Review note\n\n## Since last review\n\nnew body\n\n## Rounds\n\nround one');
});

test('an unclosed component line stays plain markdown', () => {
  expect(documentFolds('# Top\n\n::graph-stat\n---\n\ntext').filter(fold => fold.structure === 'heading').length).toBe(2);
});

test('a component block ends a paragraph or list item it follows without a blank line', () => {
  const tight = '## A\nintro line\n::graph-stat\n---\ntitle: Open\n---\n::\n\n## B\nb';
  const replaced = replaceSectionText(tight, '## A', 'new', 'note');
  expect(replaced.previous).toBe('intro line\n::graph-stat\n---\ntitle: Open\n---\n::');
  expect(replaced.text).toBe('## A\n\nnew\n\n## B\nb');
  const listed = '## A\n- item\n  ::graph-stat\n  ---\n  title: Open\n  ---\n  ::\n\n## B\nb';
  expect(documentFolds(listed).filter(fold => fold.structure === 'heading').map(fold => fold.sourceSpan!.startLine)).toEqual([0, 8]);
  // A setext heading above a figure is still a heading.
  expect(documentFolds('Title\n---\n::graph-stat\n---\n::\n\nend').filter(fold => fold.structure === 'heading').length).toBe(1);
});

test('a "::" mid-line keeps every source span', () => {
  for (const text of ['a::b c\nmore', ' ::foo bar\ntext', 'x\n::graph-stat\n::']) {
    expect(markdownSourceTokens(text).length).toBeGreaterThan(0);
  }
  // Four spaces is code, not a component.
  expect(markdownSourceTokens('    ::graph-stat\n    ---\n    ::').map(node => node.token.type)).toEqual(['code']);
});

test('a block-starting line between a paragraph and a figure keeps its own meaning', () => {
  const heading = 'intro line\n## Stats\n::graph-stat\n---\nquery: x\n---\n::\n';
  expect(markdownSourceTokens(heading).map(node => node.token.type)).toEqual(['paragraph', 'heading', 'component']);
  const fence = 'intro line\n```\ncode\n```\n::graph-stat\n---\n::\n\nafter';
  expect(markdownSourceTokens(fence).map(node => node.token.type)).toEqual(['paragraph', 'code', 'component', 'paragraph']);
  // An unindented figure line right under a list item is that item's lazy continuation (marked's list rule); the
  // list and the paragraph stay, and nothing there becomes a heading.
  const listed = 'intro line\n- item\n::graph-stat\n---\n::\n';
  expect(markdownSourceTokens(listed).map(node => node.token.type).slice(0, 2)).toEqual(['paragraph', 'list']);
  expect(markdownSourceTokens(listed).map(node => node.token.type)).not.toContain('heading');
  const section = replaceSectionText('## A\nintro line\n## Stats\n::graph-stat\n---\n::\n', '## Stats', 'new', 'note');
  expect(section.previous).toBe('::graph-stat\n---\n::');
});
