import assert from 'node:assert/strict';
import type {Block} from '../../src/types';
import {runHerdrScenario} from './herdr-runner';

// PIE-533 S2: Detail's read preview shows a note's {{ }} as the service reads them, line for line; a typo is shown as
// typed with the nearest key; the editor shows the source as written; and the property inspector lists the values read.
const result=await runHerdrScenario({name:'values',async prepare(){},async run(s){
 const terminal=await s.attachClient();await terminal.resize(200,70);
 const note=await s.client.request<Block>({action:'create',text:[
  'VENT RAIL [owner::sam] [target::https://example.test/vent]','host-marker-line',
  'Owner {{this.owner}} plays at {{this.target}}; typo {{this.ownr}}.','last-line-of-note'].join('\n')});
 const detail=(await s.registrations()).find(c=>c.runtime?.paneId===s.panes.detail)!;
 const tree=(await s.registrations()).find(c=>c.runtime?.paneId===s.panes.tree)!;
 await s.client.request({action:'navigation.link.set',source:{clientId:detail.clientId,region:'detail'},destination:null});
 await s.client.request({action:'navigation.dispatch',sourceClientId:tree.clientId,sourceRegion:'tree',intent:'open',target:{kind:'block',blockId:note.id},destination:{clientId:detail.clientId,region:'detail'}});
 const shown=await s.waitFor('Detail draws the values',()=>s.visible(s.panes.detail),
  // The nearest-key hint can land a frame after the values: wait for both.
  text=>text.includes('host-marker-line')&&text.replace(/\s+/g,' ').includes('Owner sam plays at https://example.test/vent')&&text.replace(/\s+/g,' ').includes('did you mean owner'));
 const flat=shown.replace(/\s+/g,' '); // the line wraps where the pane's width puts it
 assert.ok(flat.includes('typo {{this.ownr}}')&&flat.includes('did you mean'),'the typo is shown as typed, with the nearest key');
 assert.ok(!shown.includes('{{this.owner}}'),'a resolved placeholder shows its value, not its braces');
 await s.checkpoint('values-preview');
 // The editor shows the source as written.
 await s.focus(s.panes.detail);
 await s.keys(s.panes.detail,'e');
 await s.waitFor('the editor shows the source',()=>s.visible(s.panes.detail),text=>text.includes('{{this.owner}}')&&text.includes('{{this.ownr}}'));
 await s.checkpoint('values-source');
 await s.keys(s.panes.detail,'escape');
 const after=await s.client.request<Block>({action:'get',blockId:note.id});
 assert.equal(after.text,note.text);assert.equal(after.revision,note.revision);
}});console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
