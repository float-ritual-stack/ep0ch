import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectWorkspaceConnection} from '../src/workspace-diagnostics';
import {OutlinerServer} from '../src/server';
import {OutlinerStore} from '../src/store';
import {scratchOutline} from './scratch-outline';

test('a folder naming an outline: the outline, its database and the answering service; a missing one is said, not made',async()=>{
 const root=mkdtempSync(join(tmpdir(),'workspace-info-'));
 const project=join(root,'garden');mkdirSync(join(project,'beds'),{recursive:true});writeFileSync(join(project,'.ep0ch'),'ws = "garden"\n');
 const scratch=scratchOutline(root,{name:'garden',folder:join(project,'beds')});
 const env={HOME:root,EP0CH_OUTLINES:scratch.outlines,OUTLINER_WORKSPACE_ROOT:join(project,'beds')};
 try{
  const missing=await inspectWorkspaceConnection(env);const text=missing.lines.join('\n');
  expect(missing.ok).toBe(false);expect(text).toContain(`Outline: garden (${join(project,'.ep0ch')})`);expect(text).toContain(`Database: ${scratch.database} (missing)`);expect(text).toContain('Connection failed');
  expect(existsSync(scratch.database)).toBe(false);
  const store=new OutlinerStore(scratch.database,{workspaceRoot:scratch.stateDir});const server=new OutlinerServer(store,scratch.socket);await server.start();
  try{const working=await inspectWorkspaceConnection(env);expect(working.ok).toBe(true);expect(working.lines.join('\n')).toContain(`Service database: ${scratch.database}`);}
  finally{await server.close();store.close();}
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('a remote socket and a broken .ep0ch are reported without creating anything',async()=>{
 const root=mkdtempSync(join(tmpdir(),'workspace-info-'));
 const env={HOME:root,OUTLINER_WORKSPACE_ROOT:root,EP0CH_OUTLINES:join(root,'outlines'),EP0CH_SOCKET:join(root,'forward.sock'),EP0CH_WS:'garden'};
 try{
  const report=await inspectWorkspaceConnection(env);const text=report.lines.join('\n');expect(report.ok).toBe(false);expect(text).toContain('Check the SSH socket tunnel');expect(text).toContain('Storage belongs to the host at the other end of EP0CH_SOCKET');expect(existsSync(env.EP0CH_OUTLINES)).toBe(false);
  writeFileSync(join(root,'.ep0ch'),'{broken');const broken=await inspectWorkspaceConnection({...env,EP0CH_WS:undefined});expect(broken.lines.join('\n')).toContain(`Folder: ${root}`);expect(broken.lines.join('\n')).toContain(`${join(root,'.ep0ch')} must hold one line`);expect(existsSync(env.EP0CH_OUTLINES)).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('doctor CLI reports a folder that names no outline, nonzero, without making anything',async()=>{
 const root=mkdtempSync(join(tmpdir(),'workspace-doctor-'));
 try{
  const child=Bun.spawn([process.execPath,'src/cli.ts','doctor','--json'],{env:{...process.env,HOME:root,OUTLINER_WORKSPACE_ROOT:join(root,'jam-shelf'),EP0CH_OUTLINES:join(root,'outlines'),EP0CH_SOCKET:undefined,EP0CH_WS:undefined},stdout:'pipe',stderr:'pipe'});
  const text=await new Response(child.stdout).text();expect(await child.exited).toBe(1);const lines=JSON.parse(text).lines.join('\n');
  expect(lines).toContain(`Folder: ${join(root,'jam-shelf')}`);expect(lines).toContain('init offers "jam-shelf"');expect(existsSync(join(root,'outlines'))).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
