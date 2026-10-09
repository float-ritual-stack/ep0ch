import assert from 'node:assert/strict';
import type {Block} from '../../src/types';
import {runHerdrScenario} from './herdr-runner';

// A patch that loses a race is a proposal beside its note (PIE-725): Detail draws it as an embed after
// the note's last line, the note's text and revision stay, a retry is deduped, and a dismissal takes it away.
const result=await runHerdrScenario({name:'proposals-beside',async prepare(){},async run(s){
 const terminal=await s.attachClient();await terminal.resize(200,70);
 const note=await s.client.request<Block>({action:'create',text:'SOWING GUIDE\nhost-marker-line\nSow the beans   in May.\nlast-line-of-guide'});
 const at=note.text.indexOf('beans   in May');
 const patch=(actorId:string,replacement:string)=>s.client.request<{outcome:string;proposalId?:string;deduped?:boolean;beside?:string}>({action:'draft.patch',blockId:note.id,revision:note.revision,
  mutation:{author:'agent',actorId},patches:[{observed:'beans   in May',replacement,range:{start:at,end:at+'beans   in May'.length},unit:'utf16'}]});
 assert.equal((await patch('fern','beans in late May')).outcome,'applied');
 const lost=await patch('moss','beans in May');
 assert.equal(lost.outcome,'proposed');assert.equal(lost.beside,note.id);
 const won=await s.client.request<Block>({action:'get',blockId:note.id});
 assert.ok(!won.text.includes(lost.proposalId!));
 const again=await patch('moss','beans in May');
 assert.equal(again.proposalId,lost.proposalId);assert.equal(again.deduped,true);
 const detail=(await s.registrations()).find(c=>c.runtime?.paneId===s.panes.detail)!;
 const tree=(await s.registrations()).find(c=>c.runtime?.paneId===s.panes.tree)!;
 await s.client.request({action:'navigation.link.set',source:{clientId:detail.clientId,region:'detail'},destination:null});
 await s.client.request({action:'navigation.dispatch',sourceClientId:tree.clientId,sourceRegion:'tree',intent:'open',target:{kind:'block',blockId:note.id},destination:{clientId:detail.clientId,region:'detail'}});
 const shown=await s.waitFor('Detail draws the proposal after the guide',()=>s.visible(s.panes.detail),
  text=>text.includes('host-marker-line')&&text.includes('proposed edit from @moss'));
 const rows=shown.split('\n');
 const last=rows.findIndex(line=>line.includes('last-line-of-guide')),proposal=rows.findIndex(line=>line.includes('proposed edit from @moss'));
 assert.ok(last>=0&&proposal>last,`the proposal is drawn after the note's last line (${last}, ${proposal})`);
 assert.ok(rows.some(line=>line.includes('beans in late May')),'the winner\'s words are in the guide');
 assert.ok(!shown.includes('draft-patch::'),'the hidden patch is never shown');
 await s.checkpoint('proposal-beside');
 await s.client.request({action:'draft.proposal.dismiss',proposalId:lost.proposalId,mutation:{author:'agent',actorId:'moss'}});
 await s.waitFor('the dismissed proposal is gone from Detail',()=>s.visible(s.panes.detail),text=>text.includes('host-marker-line')&&!text.includes('proposed edit from @moss'));
 await s.checkpoint('proposal-dismissed');
 const after=await s.client.request<Block>({action:'get',blockId:note.id});
 assert.equal(after.text,won.text);assert.equal(after.revision,won.revision);
}});console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
