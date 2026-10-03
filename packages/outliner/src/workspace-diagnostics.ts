import {statSync} from 'node:fs';
import {hostname} from 'node:os';
import {createOutlinerClient} from './client';
import {outlinesLayout,resolveClientPaths,resolveOutlinesFolder,invocationFolder} from './paths';
import {checkServiceCompatibility} from './service-compatibility';
import {PROTOCOL} from '@ep0ch/outline-core/protocol';
import type {OutlinerServiceStatus} from './types';
import {sanitizeDynamicText} from './terminal';

export type WorkspaceReportEntry =
 | {kind:'section';title:string}
 | {kind:'field';label:string;value:string;note?:string}
 | {kind:'note';text:string};
export interface WorkspaceReport {ok:boolean;lines:string[];entries:WorkspaceReportEntry[]}

function presence(path:string):string {
 try{const stat=statSync(path);return stat.isSocket()?'socket exists':stat.isDirectory()?'directory exists':'file exists';}
 catch(error){return error instanceof Error&&'code' in error&&error.code==='ENOENT'?'missing':`cannot inspect: ${error instanceof Error?error.message:String(error)}`;}
}
/** Read-only diagnosis: never starts a host, opens SQLite, creates an outline or writes a `.ep0ch`. */
export async function inspectWorkspaceConnection(env:NodeJS.ProcessEnv=process.env):Promise<WorkspaceReport> {
 const entries:WorkspaceReportEntry[]=[];
 const section=(title:string)=>entries.push({kind:'section',title});
 const field=(label:string,value:string,note?:string)=>entries.push({kind:'field',label,value,...(note?{note}:{})});
 const note=(text:string)=>entries.push({kind:'note',text});
 const finish=(ok:boolean):WorkspaceReport=>({ok,entries,lines:entries.map(entry=>sanitizeDynamicText(entry.kind==='section'?`\n${entry.title}`:entry.kind==='note'?entry.text:`${entry.label}: ${entry.value}${entry.note?` (${entry.note})`:''}`))});
 section('Client');
 field('Folder',invocationFolder(env));
 field('Client host',hostname());field('Bun',process.execPath);field('Client protocol',String(PROTOCOL),'needs a host on the same protocol');
 field('Outlines folder',resolveOutlinesFolder(env),env.EP0CH_OUTLINES?'from EP0CH_OUTLINES':'default');
 let paths;
 try{paths=resolveClientPaths(env);}catch(error){note(`Configuration error: ${error instanceof Error?error.message:String(error)}`);note('Fix the named setting or .ep0ch before launching; nothing was created.');return finish(false);}
 section('Connection');
 field('Connection',paths.mode);field('Endpoint',paths.socket,`${presence(paths.socket)}${paths.mode==='remote'?'; EP0CH_SOCKET':''}`);
 const how={env:'EP0CH_WS (or --ws)',file:`${paths.configPath}`,pane:"the invoking pane's outline"} as const;
 field('Outline',paths.outline??'none',paths.outline?how[paths.outlineSource??'env']:`${paths.unnamed}${paths.guess?`; init offers "${paths.guess.name}" for ${paths.guess.folder}`:''}`);
 if(paths.outline&&paths.mode==='host')field('Database',paths.database,presence(paths.database));
 else if(paths.mode==='remote')note('Storage belongs to the host at the other end of EP0CH_SOCKET. The forwarded socket is local; it is not the database.');
 section('Service');
 if(!paths.outline){note('Name an outline first: ep0ch init, ep0ch --ws <name>, or a .ep0ch here.');return finish(false);}
 try{
  const service=await createOutlinerClient(paths).request<OutlinerServiceStatus>({action:'ping'},1500);
  field('Service',`${service.status}; protocol ${service.protocolVersion}`);
  if(service.location){field('Service host',service.location.hostname);field('Service database',service.location.database);field('Outline folder',service.location.stateDirectory);}
  const problem=checkServiceCompatibility(service);
  if(problem){note(`${problem.message} The endpoint is reachable; this is not a tunnel failure.`);return finish(false);}
  return finish(true);
 }catch(error){
  note(`Connection failed: ${error instanceof Error?error.message:String(error)}`);
  note(paths.mode==='host'?`Check that the outline host runs (it is a service; its socket is ${outlinesLayout(env).socket}) and has the outline "${paths.outline}".`:'Check the SSH socket tunnel and the outline host at its other end.');
  return finish(false);
 }
}
