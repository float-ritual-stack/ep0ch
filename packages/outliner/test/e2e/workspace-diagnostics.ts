import assert from 'node:assert/strict';
import {runHerdrScenario} from './herdr-runner';
/** A report field's value: the row under `Label: [Copy]` (PIE-355, 8adf4ac1c, put each value on its own row). */
const value=(frame:string,label:string)=>{const lines=frame.split('\n');const at=lines.findIndex(line=>line.includes(`${label}: [Copy]`));return at<0?undefined:lines[at+1]?.trim();};
const result=await runHerdrScenario({name:'workspace-diagnostics',async prepare(){},async run(s){
 const terminal=await s.attachClient();await terminal.resize(180,48);
 await s.keys(s.panes.tree,'?');await s.text(s.panes.tree,'Workspace and connection');await s.waitVisible(s.panes.tree,'Workspace and connection');
 await s.keys(s.panes.tree,'enter');await s.waitVisible(s.panes.tree,'Client host:');
 // A client on this machine's host reports `host` (PIE-457, cfe63edbc, one outline server for every outline).
 assert.equal(value(await s.visible(s.panes.tree),'Connection'),'host');await s.checkpoint('01-discover-workspace-report');
 await s.keys(s.panes.tree,'shift+g');await s.waitVisible(s.panes.tree,'Service database:');
 assert.match(value(await s.visible(s.panes.tree),'Service')??'',/^ready; protocol \d+; grammar \d+$/);
 await terminal.resize(100,42);await s.keys(s.panes.tree,'shift+g');// Storage and backup notes left the report with outlines by name (PIE-530, d65c7af78); the service's outline folder is last.
 await s.waitVisible(s.panes.tree,'Outline folder: [Copy]');await s.checkpoint('02-narrow-report');await s.keys(s.panes.tree,'escape');await s.waitFor('report closed',()=>s.visible(s.panes.tree),frame=>frame.includes('● Tree')&&!frame.includes('Workspace and connection'));
}});console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
