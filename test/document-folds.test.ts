import {expect, test} from 'bun:test';
import {stripTerminalSequences, type MarkdownTheme} from '@earendil-works/pi-tui';
import {documentFolds, revealFoldedLine} from '../src/document-folds';
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
