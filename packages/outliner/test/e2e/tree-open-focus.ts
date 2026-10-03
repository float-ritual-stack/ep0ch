import assert from 'node:assert/strict';
import {runHerdrScenario} from './herdr-runner';
import type {Block} from '../../src/types';
const composed=process.argv.includes('--composed');
const ansi=process.argv.includes('--ansi');
const result=await runHerdrScenario({
 name:`tree-open-focus${composed?'-composed':ansi?'-ansi':''}`,
 layout:composed?'composed':'separate',detailRenderer:ansi?'ansi':'pi-tui',
 async prepare(){},
 async run(s){
  const terminal=await s.attachClient();
  const initial=await s.registrations();
  const tree=initial.find(c=>c.runtime?.paneId===s.panes.tree)!;
  const detail=initial.find(c=>c.runtime?.paneId===s.panes.detail)!;
  const a=await s.client.request<Block>({action:'create',text:'FOCUS FIRST NOTE\n\nFirst reading body.'});
  const b=await s.client.request<Block>({action:'create',text:'FOCUS SECOND NOTE\n\nSecond reading body.'});
  const reg=async(id:string)=>(await s.registrations()).find(c=>c.clientId===id)!;
  const assertFocus=async(region:'tree'|'detail')=>{
   assert.equal(await s.focusedPane(),s.panes[region]);
   if(composed)assert.equal((await reg(tree.clientId)).focusedRegion,region);
  };
  const waitFocus=async(region:'tree'|'detail')=>{
   await s.waitFor('native '+region+' focus',s.focusedPane,p=>p===s.panes[region]);
   if(composed)await s.waitFor('region '+region+' focus',()=>reg(tree.clientId),c=>c.focusedRegion===region);
  };
  await s.revealTree(s.panes.tree,a.id);await s.focus(s.panes.tree);
  await terminal.write('\r');
  await s.waitFor('Current loads first note',()=>reg(detail.clientId),c=>c.currentTarget?.kind==='block'&&c.currentTarget.blockId===a.id);
  await s.waitVisible(s.panes.detail,'Opened here');
  await assertFocus('tree');
  await terminal.write('\x1b[B');
  await s.waitFor('next arrow stays in Tree',()=>reg(tree.clientId),c=>{ const target=c.treeSelection?.target??c.previewTarget; return target?.kind==='block'&&target.blockId===b.id; });
  assert.deepEqual((await reg(detail.clientId)).currentTarget,{kind:'block',blockId:a.id});
  await s.checkpoint('01-enter-keeps-tree');
  await s.revealTree(s.panes.tree,b.id);await s.focus(s.panes.tree);
  await terminal.write('\r\r');
  await waitFocus('detail');
  await s.waitFor('double Enter loads selected note',()=>reg(detail.clientId),c=>c.currentTarget?.kind==='block'&&c.currentTarget.blockId===b.id);
  await s.checkpoint('02-double-enter-focuses');
  await s.revealTree(s.panes.tree,a.id);await s.focus(s.panes.tree);
  await terminal.write('\x1b\r');
  await waitFocus('detail');
  await s.waitFor('Alt Enter loads selected note',()=>reg(detail.clientId),c=>c.currentTarget?.kind==='block'&&c.currentTarget.blockId===a.id);
  await s.keys(s.panes.detail,'e');await s.waitVisible(s.panes.detail,'Editing');
  await s.text(s.panes.detail,'DRAFT MUST SURVIVE');
  await s.revealTree(s.panes.tree,b.id);await s.focus(s.panes.tree);await terminal.write('\r');
  await s.waitVisible(s.panes.tree,'protected');
  await s.waitVisible(s.panes.detail,'DRAFT MUST SURVIVE');
  await assertFocus('tree');
  await s.checkpoint('03-protected-draft');
  await s.keys(s.panes.detail,'escape');
 }
});
console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
