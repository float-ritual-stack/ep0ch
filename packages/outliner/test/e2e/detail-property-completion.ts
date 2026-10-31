import type {Block} from '../../src/types';
import {runHerdrScenario} from './herdr-runner';

// Components, properties and callout types complete in Detail (PIE-1344): `::`, `[key`, `[key::` and `> [!` list the
// service's rows, the ones the door lists; a component chosen writes all its lines; a figure's values too (PIE-1366).
const result=await runHerdrScenario({name:'detail-property-completion',async prepare(){},async run(s){
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
  await s.keys(s.panes.detail,'ctrl+s');
  await s.waitFor('the figure written whole',()=>s.client.request<Block>({action:'get',blockId:note.id}),b=>b.text.startsWith('PLANTING NOTES\n\n::graph-stat\n---\n')&&b.text.trimEnd().endsWith('::'));
  await s.checkpoint('02-figure-written');
  await s.keys(s.panes.detail,'e','alt+a');await s.text(s.panes.detail,'PLANTING NOTES [sea');await s.waitVisible(s.panes.detail,'season');
  await s.checkpoint('03-keys');
  await s.keys(s.panes.detail,'tab');await s.waitVisible(s.panes.detail,'⏎ new line · tab inserts');
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
}});console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
