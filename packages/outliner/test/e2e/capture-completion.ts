import assert from 'node:assert/strict';
import {propertyInspectorAuthoredText} from '../../src/property-inspector';
import {visibleWidth} from '@earendil-works/pi-tui';
import type {Block,QuickCaptureDraft,VisibleBlockCollection} from '../../src/types';
import {runHerdrScenario} from './herdr-runner';
const result=await runHerdrScenario({name:'capture-completion',commandKeys:[{key:'prefix+shift+c',command:'float.pi-outliner.capture'}],async prepare(){},async run(s){
 const terminal=await s.attachClient();await terminal.resize(200,55);
 const page=await s.client.request<Block>({action:'create',text:'Project Alpha [page::alpha-capture]\n\nCapture context for this project.'});
 const target=await s.client.request<Block>({action:'create',text:'Block destination for capture\n\nRemembered context.'});
 const reader=await s.client.request<Block>({action:'create',text:'READER STAYS\n\nKeep this open while capturing.'});
 await s.revealTree(s.panes.tree,reader.id);await s.keys(s.panes.tree,'enter');await s.waitVisible(s.panes.detail,'READER STAYS');
 const screen=(text:string)=>s.waitFor(text,terminal.visible,f=>f.includes(text));
 const closed=()=>s.waitFor('capture closed',terminal.visible,f=>!f.includes('Quick capture'));
 // A narrow client collapses Herdr's sidebar, which hides the PREFIX cue; with the sidebar shown, wait for the cue
 // (the « at its foot is always drawn, so it proves nothing) before the command key.
 const open=async()=>{await closed();const cue=(f:string)=>f.includes('PREFIX')||(f.trim().length>0&&!f.split('\n')[0]!.includes('spaces'));
  // The attached client can drop a key sent just after a resize: send the prefix again until Herdr shows it took it.
  for(let tries=0;;tries++){await terminal.write('\x02');if(await s.waitFor('PREFIX',terminal.visible,cue,1500).then(()=>true,()=>false))break;if(tries===3)throw new Error('Herdr never showed PREFIX');}await terminal.write('C');await screen('Quick capture');};
 const paste=(text:string)=>terminal.write(`\x1b[200~${text}\x1b[201~`);
 await open();await paste('CAPTURE COMPLETION\n\nPage [[alpha-capture');await screen('Pages 1/1'); // each source heads its own list (PIE-1340)
 await terminal.write('\r');await screen('[[alpha-capture]]');
 // (( is ranked over every note (PIE-1480), seeded docs included: the target leads, others follow.
 await paste('\nBlock ((Block destination');await screen('References 1/');await screen('› Block destination for capture');
 const frame=await screen('Block destination for capture'),lines=frame.split('\n'),popupRow=lines.findIndex(l=>l.includes('Quick capture')),row=lines.findIndex((l,i)=>i>popupRow&&l.includes('› Block destination for capture'));
 const column=visibleWidth(lines[row]!.slice(0,lines[row]!.indexOf('Block destination for capture')))+2;
 await terminal.write(`\x1b[<0;${column+1};${row+1}M\x1b[<0;${column+1};${row+1}m`);
 await screen(`((${target.id}))`);await s.checkpoint('01-capture-keyboard-and-pointer');
 await terminal.write('\x1a');await s.waitFor('capture undo removes canonical reference',terminal.visible,t=>t.includes('Block ((Block destination')&&!t.includes(`((${target.id}))`));await terminal.write('\x19');await screen(`((${target.id}))`);
 // An unknown page offers itself as a new one (PIE-1340); Escape dismisses only the list.
 await paste('\nKeep [[missing');await screen('new page · missing');await terminal.write('\x1b');
 await s.waitFor('completion list dismissed',terminal.visible,f=>f.includes('Keep [[missing')&&!f.includes('new page · missing'));
 assert.ok((await terminal.visible()).includes('Quick capture'),'Escape dismisses list, retains editor');
 await terminal.write('\x1b');await closed();
 const draft=await s.client.request<QuickCaptureDraft>({action:'capture.draft.get'});
 assert.equal(draft.text,`CAPTURE COMPLETION\n\nPage [[alpha-capture]]\nBlock ((${target.id}))\nKeep [[missing`);
 await terminal.resize(110,38);await open();await screen('Resumed retained draft');await s.checkpoint('02-retained-multiline-draft');
 await terminal.write('\x13');await closed();
 const captures=await s.client.request<VisibleBlockCollection>({action:'blocks.query',query:{text:'CAPTURE COMPLETION',limit:20}});
 assert.equal(captures.blocks.length,1);assert.equal(propertyInspectorAuthoredText(captures.blocks[0]!.text).trim(),draft.text);
 assert.equal(await s.client.request({action:'capture.draft.get'}),null);
 assert.equal((await s.client.request<Block>({action:'get',blockId:page.id})).revision,page.revision);
 await s.waitVisible(s.panes.detail,'READER STAYS');await s.checkpoint('03-single-saved-capture-reader-retained');
}});console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
