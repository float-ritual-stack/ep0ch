import assert from 'node:assert/strict';
import type {Block} from '../../src/types';
import {runHerdrScenario} from './herdr-runner';

// Components, properties and callout types complete in Detail (PIE-1344): `::`, `[key`, `[key::` and `> [!` list the
// service's rows, the ones the door lists; a component chosen writes all its lines; a figure's values too (PIE-1366).
const nvim=Bun.which('nvim');if(!nvim)throw Error('Neovim is required for the snippet undo journey');
const result=await runHerdrScenario({name:'detail-property-completion',editor:`${nvim} --clean`,async prepare(){},async run(s){
  const terminal=await s.attachClient();
  await terminal.resize(600,100);
  await s.client.request<Block>({action:'create',text:'Greenhouse log [season::spring] [crop::beans]'});
  const note=await s.client.request<Block>({action:'create',text:'PLANTING NOTES\n\nWhat goes where.'});
  await s.revealTree(s.panes.tree,note.id);await s.keys(s.panes.tree,'enter');await s.waitVisible(s.panes.detail,'PLANTING NOTES');
  await s.keys(s.panes.detail,'e','alt+a');await s.text(s.panes.detail,'PLANTING NOTES\n\n::graph-st');
  await s.waitVisible(s.panes.detail,'Components');await s.waitVisible(s.panes.detail,'Stat');
  await s.waitVisible(s.panes.detail,'insert');
  await s.checkpoint('01-components-wide');
  await s.keys(s.panes.detail,'ctrl+n');await s.waitVisible(s.panes.detail,'Components 2/');
  await s.keys(s.panes.detail,'ctrl+p');await s.waitVisible(s.panes.detail,'Components 1/');
  await terminal.resize(180,60);
  await s.waitFor('the narrow docs panel',()=>s.visible(s.panes.detail),text=>text.includes('Components 1/')&&Math.max(...text.split('\n').map(line=>line.length))<100);
  await s.checkpoint('01-components-narrow');
  const before=await s.visible(s.panes.detail);
  await s.keys(s.panes.detail,'shift+down');await s.focus(s.panes.detail);await terminal.write('\x1b[6~');
  await s.waitFor('the docs scroll without changing the row',()=>s.visible(s.panes.detail),text=>text!==before&&text.includes('Components 1/'));
  await s.checkpoint('01-docs-scrolled');
  await s.keys(s.panes.detail,'enter');await s.waitVisible(s.panes.detail,'items:');
  await s.text(s.panes.detail,'Raised beds');
  await s.keys(s.panes.detail,'tab','shift+tab');
  await s.text(s.panes.detail,'Harvest');
  await s.waitFor('the first slot is replaced after backtab',()=>s.visible(s.panes.detail),text=>text.includes('title: Harvest')&&!text.includes('Raised beds'));
  await s.keys(s.panes.detail,'ctrl+e');await s.waitVisible(s.panes.detail,'draft.md');
  await terminal.write('ggccHARVEST NOTES\x1b:wq\r');
  await s.waitFor('the editor changed text outside the slot',()=>s.visible(s.panes.detail),text=>text.includes('HARVEST NOTES')&&text.includes('title: Harvest'));
  await s.checkpoint('01-editor-import');
  await s.keys(s.panes.detail,'ctrl+z');
  await s.waitFor('undo restores the draft before the editor import',()=>s.visible(s.panes.detail),text=>text.includes('PLANTING NOTES')&&text.includes('title: Harvest')&&!text.includes('HARVEST NOTES'));
  await s.checkpoint('01-editor-import-undone');
  await s.keys(s.panes.detail,'ctrl+z');
  await s.waitFor('one undo removes the filled snippet',()=>s.visible(s.panes.detail),text=>text.includes('::graph-st')&&!text.includes('items:'));
  await s.checkpoint('01-snippet-undone');
  await s.keys(s.panes.detail,'tab');await s.waitVisible(s.panes.detail,'Components');
  await s.keys(s.panes.detail,'enter');await s.waitVisible(s.panes.detail,'items:');
  await s.keys(s.panes.detail,'ctrl+s');
  await s.waitFor('the figure written whole',()=>s.client.request<Block>({action:'get',blockId:note.id}),b=>b.text.startsWith('PLANTING NOTES\n\n::graph-stat\n---\n')&&b.text.trimEnd().endsWith('::'));
  await s.checkpoint('02-figure-written');
  await s.keys(s.panes.detail,'e','alt+a');await s.text(s.panes.detail,'PLANTING NOTES [sea');await s.waitVisible(s.panes.detail,'season');
  await s.checkpoint('03-keys');
  await s.keys(s.panes.detail,'tab');await s.waitVisible(s.panes.detail,'new line');
  await s.checkpoint('04-bare-property');
  await s.text(s.panes.detail,'s');await s.waitFor('the typed property value',()=>s.visible(s.panes.detail),text=>text.includes('[season::s')&&text.includes('spring'));
  await s.checkpoint('04-values');
  await s.keys(s.panes.detail,'escape');await s.text(s.panes.detail,'\n> [!ti');await s.waitVisible(s.panes.detail,'Callout types');
  await s.checkpoint('05-callouts');
  // A figure's values (PIE-1366): the service answers them, so Detail offers what the door does.
  await s.keys(s.panes.detail,'escape');await s.text(s.panes.detail,'\n::graph-tabs');await s.keys(s.panes.detail,'escape');
  await s.text(s.panes.detail,'\n---\ndensity: c');await s.waitVisible(s.panes.detail,'comfortable');
  await s.checkpoint('06-figure-values');
  await s.keys(s.panes.detail,'escape','escape');

  const findings:string[]=[];
  await terminal.resize(180,26);
  await s.keys(s.panes.detail,'e','alt+a');await s.text(s.panes.detail,'SELECTION\nkeep\n[sea');
  const small=await s.waitFor('the resized selection completion',()=>s.visible(s.panes.detail),text=>text.includes('[sea▏')&&text.includes('Properties 1/')&&text.split('\n').length<=12);
  assert.ok(!small.includes('1 note with season'),'The selection case must have no visible docs pane');
  await s.checkpoint('07-selection-without-docs');
  await s.keys(s.panes.detail,'shift+up','backspace','ctrl+s');
  const selected=await s.waitFor('selection edit saved',()=>s.client.request<Block>({action:'get',blockId:note.id}),b=>b.text.startsWith('SELECTION'));
  if(selected.text!=='SELECTION\nkeep')findings.push(`4432838092: Shift+Up did not select the preceding line: ${JSON.stringify(selected.text)}`);

  await terminal.resize(600,100);
  await s.setKeybindings({
    'detail.completion.accept':['Enter','Alt+I'],
    'detail.completion.dismiss':['Alt+X'],
    'detail.completion.next':['Alt+J'],
    'detail.completion.previous':['Alt+K'],
    'detail.completion.docs.down':['Alt+D'],
  });
  await s.keys(s.panes.detail,'ctrl+r');await s.waitVisible(s.panes.detail,'Keymap and bars reloaded');
  await s.keys(s.panes.detail,'e','alt+a');await s.text(s.panes.detail,'PLANTING NOTES\n::graph-st');
  const help=await s.waitVisible(s.panes.detail,'Components 1/');
  if(!['⌥I insert','⌥X dismiss','⌥J next','⌥K previous','⌥D scroll docs'].every(label=>help.includes(label)))findings.push('4432838086: popup help does not show the active keymap');
  await s.checkpoint('08-remapped-help');
  await s.keys(s.panes.detail,'alt+j');await s.waitVisible(s.panes.detail,'Components 2/');
  await s.keys(s.panes.detail,'alt+k');await s.waitVisible(s.panes.detail,'Components 1/');
  await s.keys(s.panes.detail,'alt+x','alt+a');await s.text(s.panes.detail,'PLANTING NOTES [season::');
  const enterHelp=await s.waitVisible(s.panes.detail,'new line');
  if(!enterHelp.includes('⌥I insert')||!enterHelp.includes('⌥X dismiss')||enterHelp.includes('tab inserts'))findings.push('4432838086: Enter-policy help advertises stale insert/dismiss keys');
  await s.checkpoint('09-remapped-enter-policy');
  await s.keys(s.panes.detail,'alt+i','ctrl+s');
  await s.waitFor('the advertised insert key writes the value',()=>s.client.request<Block>({action:'get',blockId:note.id}),b=>b.text==='PLANTING NOTES [season::spring]');
  assert.deepEqual(findings,[]);
}});console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
