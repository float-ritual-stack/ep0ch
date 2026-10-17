import {readFile,writeFile,copyFile,rename,mkdir,readdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve,join,dirname,isAbsolute,delimiter} from 'node:path';
import {boundFolderOf} from '../src/paths';

// Loads packages/claude-mod in every Claude Code session. Each session then follows its
// folder: the nearest folder whose .ep0ch names an outline feeds that outline;
// a folder that names none feeds nothing.
//
//   install-claude-mod.ts                        load the mod; the folder list and mode are kept
//   install-claude-mod.ts --exclude FOLDER…      and opt these folders out
//   install-claude-mod.ts --project FOLDER…     also rename the mod in FOLDER/.claude/settings*.json (~/projects/ep0ch and ~/float-hub always)
//   install-claude-mod.ts --folder               folder mode, dropping an allowlist (strict
//                                                mode's, or a list from before folder mode)
//   install-claude-mod.ts [--allowlist] FOLDER…  strict mode: only these folders feed
//
// A list with no PI_OUTLINER_MENTIONS_MODE (one written before folder mode was
// the allowlist) makes the mod feed nothing anywhere until the mode is set; the
// installer says so, and --folder drops it, naming the listed folders bound to
// no outline.
const usage='Usage: install-claude-mod.ts [--no-allow] [--project FOLDER]... [--exclude FOLDER]... | --folder | [--allowlist] FOLDER...';
const excluded:string[]=[];
const projectsArg:string[]=[];
const allowed:string[]=[];
let toFolderMode=false;
let allowlistFlag=false;
let allowTools=true;
for(let i=2;i<process.argv.length;i++){
 const argument=process.argv[i]!;
 if(argument==='--exclude'){
  const folder=process.argv[++i];
  if(!folder)throw Error(`--exclude needs a folder. ${usage}`);
  excluded.push(folder);
 }else if(argument==='--project'){
  const folder=process.argv[++i];
  if(!folder||!isAbsolute(folder))throw Error(`--project needs an absolute folder. ${usage}`);
  projectsArg.push(folder);
 }else if(argument==='--no-allow')allowTools=false;
 else if(argument==='--folder')toFolderMode=true;
 else if(argument==='--allowlist')allowlistFlag=true;
 else if(argument.startsWith('-'))throw Error(`Unknown option ${argument}. ${usage}`);
 else allowed.push(argument);
}
if(allowlistFlag&&!allowed.length)throw Error(`--allowlist needs at least one folder. ${usage}`);
if((excluded.length||toFolderMode)&&allowed.length)throw Error(`Opting folders out (folder mode) and an allowlist (strict mode) don't mix. ${usage}`);
for(const folder of [...excluded,...allowed])if(!isAbsolute(folder))throw Error(`Folder must be absolute: ${folder}`);

// The mod is its own package beside this one (packages/claude-mod).
const modDir=resolve(import.meta.dir,'../../claude-mod');
const settingsPath=join(process.env.CLAUDE_CONFIG_DIR??join(homedir(),'.claude'),'settings.json');
let settingsExist=true;
const source=await readFile(settingsPath,'utf8').catch((error:NodeJS.ErrnoException)=>{
 if(error.code!=='ENOENT')throw error;
 settingsExist=false;
 return '{}';
});
let settings:{env?:Record<string,string>;permissions?:{allow?:string[]}};
try{settings=JSON.parse(source);}catch(error){throw Error(`${settingsPath} is not valid JSON (${(error as Error).message}); no configuration was changed. Fix or remove it, then run: bun ${import.meta.path}`);}
if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error(`${settingsPath} is not a JSON object; no configuration was changed.`);

// Only Claude's plugin maps and permission rules contain identities we own. Plugin payloads,
// hooks and arbitrary settings are kept verbatim.
const OLD_SERVER='mcp__pi-outliner';
const renameRule=(rule:string)=>rule===OLD_SERVER||rule.startsWith(`${OLD_SERVER}__`)?`mcp__ep0ch${rule.slice(OLD_SERVER.length)}`:rule;
const renamePluginId=(id:string)=>id.startsWith('pi-outliner@')?`ep0ch@${id.slice('pi-outliner@'.length)}`:id;
// Rename in place, dropping an entry only when the rename made it a copy of one already there; other duplicates stay.
const renameList=(items:string[],rename:(s:string)=>string)=>items.flatMap(item=>{const to=rename(item);return to!==item&&items.includes(to)?[]:[to];});
const renameModIn=(value:Record<string,any>)=>{
 const out={...value};
 for(const key of ['enabledPlugins','pluginConfigs','plugins']){
  const map=value[key];
  if(!map)continue;
  if(Array.isArray(map)){out[key]=renameList(map,renamePluginId);continue;}
  out[key]=Object.fromEntries(Object.entries(map).filter(([id])=>renamePluginId(id)===id||!(renamePluginId(id) in map)).map(([id,payload])=>[renamePluginId(id),payload]));
 }
 if(value.permissions){
  out.permissions={...value.permissions};
  for(const key of ['allow','deny','ask']){
   const rules=value.permissions[key];
   if(rules)out.permissions[key]=renameList(rules,renameRule);
  }
 }
 return out;
};
/** Every Claude config file that may name the mod: parsed before anything is written, so a malformed one stops the whole step. */
settings=renameModIn(settings) as typeof settings;
const settingsRenamed=JSON.stringify(settings)!==JSON.stringify(JSON.parse(source));
const claudeDir=dirname(settingsPath);
const projectDirs=[...new Set([...projectsArg,join(homedir(),'projects/ep0ch'),join(homedir(),'float-hub')].map(dir=>resolve(dir)))];
const otherFiles=[
 join(claudeDir,'settings.local.json'),join(claudeDir,'plugins/installed_plugins.json'),
 ...projectDirs.flatMap(dir=>[join(dir,'.claude/settings.local.json'),join(dir,'.claude/settings.json')]),
];
const parseConfig=(path:string,text:string)=>{
 try{return JSON.parse(text);}catch(error){throw Error(`${path} is not valid JSON (${(error as Error).message}); no configuration was changed. Fix or remove it, then run: bun ${import.meta.path}`);}
};
const renamePlans:{path:string;text:string}[]=[];
for(const path of otherFiles){
 const text=await readFile(path,'utf8').catch((error:NodeJS.ErrnoException)=>{
  if(error.code==='ENOENT')return null;
  throw error;
 });
 if(text===null)continue;
 const before=parseConfig(path,text);
 const after=renameModIn(before);
 if(JSON.stringify(before)!==JSON.stringify(after))renamePlans.push({path,text:`${JSON.stringify(after,null,2)}\n`});
}
async function applyRenamePlan({path,text}:{path:string;text:string}){
 const saved=`${path}.before-claude-mod-${Date.now()}`;
 await copyFile(path,saved);
 const tmp=`${path}.claude-mod-${process.pid}`;
 await writeFile(tmp,text,{mode:0o600});
 await rename(tmp,path);
 return `Renamed the mod from pi-outliner to ep0ch in ${path}. Backup: ${saved}`;
}
const env={...settings.env};

/** Another checkout or worktree of this mod (under the name it had before PIE-971 too): replaced, so only one copy loads. */
async function isOutlinerMod(dir:string){
 const manifest=await readFile(join(dir,'.claude-plugin/plugin.json'),'utf8').catch(()=>null);
 try{return manifest!==null&&['pi-outliner','ep0ch'].includes(JSON.parse(manifest).name);}catch{return false;}
}
const split=(value:string|undefined,separator:RegExp|string)=>(value??'').split(separator).map(part=>part.trim()).filter(Boolean);
const pluginDirs:string[]=[];
for(const dir of split(env.CLAUDE_CODE_PLUGIN_DIRS,delimiter))
 if(resolve(dir)!==modDir&&!await isOutlinerMod(dir))pluginDirs.push(dir);
env.CLAUDE_CODE_PLUGIN_DIRS=[...pluginDirs,modDir].join(delimiter);
env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS='1';

// The folder list and its mode, as the mod reads them (mentionsModeOf in claude-mod/hooks/mention-message.ts).
const listed=split(env.PI_OUTLINER_MENTIONS_WORKSPACES,/[:,]/);
const setMode=(env.PI_OUTLINER_MENTIONS_MODE??'').trim();
const notes:string[]=[];
if(allowTools){
 const permissions=settings.permissions??{};
 if(!permissions.allow?.includes('mcp__ep0ch')){
  settings.permissions={...permissions,allow:[...(permissions.allow??[]),'mcp__ep0ch']};
  notes.push(`Added mcp__ep0ch to permissions.allow in ${settingsPath}; ep0ch's own access gates decide tool writes. Use --no-allow to skip adding it.`);
 }else notes.push(`mcp__ep0ch is already in permissions.allow in ${settingsPath}.`);
}

const unbound=(folders:string[])=>folders.filter(folder=>{
 try{return !boundFolderOf(folder);}catch{return true;}
});
const write=(nextMode:'folder'|'allowlist',folders:string[])=>{
 if(folders.length)env.PI_OUTLINER_MENTIONS_WORKSPACES=folders.join(':');
 else delete env.PI_OUTLINER_MENTIONS_WORKSPACES;
 // Folder mode with nothing opted out needs no setting; a list the installer writes always says its mode.
 if(nextMode==='folder'&&!folders.length)delete env.PI_OUTLINER_MENTIONS_MODE;
 else env.PI_OUTLINER_MENTIONS_MODE=nextMode;
};
if(allowed.length){
 const kept=setMode==='allowlist'?listed:[];
 if(setMode!=='allowlist'&&listed.length)notes.push(`Dropped the listed folders (${listed.join(', ')}): strict mode lists the folders that feed instead.`);
 write('allowlist',[...new Set([...kept,...allowed.map(folder=>resolve(folder))])]);
 notes.push(`Strict mode: only ${env.PI_OUTLINER_MENTIONS_WORKSPACES} feed an outline, bound or not.`);
}else if(setMode==='allowlist'&&!toFolderMode){
 if(excluded.length)throw Error('PI_OUTLINER_MENTIONS_MODE=allowlist is set (strict mode); pass --folder to leave it, then opt folders out.');
 notes.push(`Strict mode kept (PI_OUTLINER_MENTIONS_MODE=allowlist): only ${listed.join(', ')||'the listed folders'} feed. Pass --folder for folder mode.`);
}else if(toFolderMode&&setMode!=='folder'&&listed.length){
 // An allowlist (strict mode's, or a list from before folder mode) is dropped, never kept as opt-outs.
 notes.push(`Folder mode: each session feeds the outline its folder is bound to. Dropped the allowlist (${listed.join(', ')}).`);
 const loose=unbound(listed);
 if(loose.length)notes.push(`Bound to no outline, so these feed nothing: ${loose.join(', ')}. Bind each with the choose-outline action, or keep strict mode with --allowlist.`);
 write('folder',excluded.map(folder=>resolve(folder)));
}else if(excluded.length||toFolderMode){
 write('folder',[...new Set([...listed,...excluded.map(folder=>resolve(folder))])]);
 if(env.PI_OUTLINER_MENTIONS_WORKSPACES)notes.push(`Opted out: ${env.PI_OUTLINER_MENTIONS_WORKSPACES}.`);
}else if(listed.length&&!setMode){
 notes.push(`PI_OUTLINER_MENTIONS_WORKSPACES lists ${listed.join(', ')} with no mode, so the mod feeds nothing anywhere. If it was your allowlist from before folder mode, run again with --folder to drop it (every bound folder then feeds its outline), or with --allowlist <folder> to keep strict mode; to opt them out, set PI_OUTLINER_MENTIONS_MODE=folder.`);
}else if(listed.length){
 notes.push(`Opted out: ${listed.join(', ')}.`);
}

// These are launch commands, not Claude settings: report the exact file for the owner to fix.
for(const root of [join(process.env.XDG_CONFIG_HOME??join(homedir(),'.config'),'systemd/user'),join(homedir(),'Library/LaunchAgents')]){
 const walk=async(dir:string):Promise<void>=>{
  const entries=await readdir(dir,{withFileTypes:true}).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')notes.push(`Couldn't list ${dir} to check for old tool names (${error.code}); skipped.`);return [];});
  for(const entry of entries){
   const path=join(dir,entry.name);
   if(entry.isDirectory()){await walk(path);continue;}
   if(!/\.(service|socket|timer|conf|plist)$/.test(entry.name))continue;
   const text=await readFile(path,'utf8').catch(()=>null);
   if(text===null){notes.push(`Couldn't read ${path} to check it for old tool names; skipped.`);continue;}
   if(/mcp__pi-outliner(?=__|[^a-zA-Z0-9_-]|$)/.test(text))
    notes.push(`Old tool names in ${path}: replace mcp__pi-outliner with mcp__ep0ch (including --allowedTools), then ${path.endsWith('.plist')?'reload this launchd plist':'run systemctl --user daemon-reload and restart the affected unit'}. Running Claude sessions need a restart.`);
  }
 };
 await walk(root);
}
for(const plan of renamePlans)notes.push(await applyRenamePlan(plan));
if(settingsRenamed)notes.push(`Renamed the mod from pi-outliner to ep0ch in ${settingsPath}.`);
const next=`${JSON.stringify({...settings,env},null,2)}\n`;
if(settingsExist&&JSON.stringify(JSON.parse(source))===JSON.stringify(JSON.parse(next))){
 console.log([`Claude Code mod already installed from ${modDir}.`,...notes].join('\n'));
 process.exit(0);
}
const backup=`${settingsPath}.before-claude-mod-${Date.now()}`;
if(settingsExist)await copyFile(settingsPath,backup);
else await mkdir(dirname(settingsPath),{recursive:true});
const temporary=`${settingsPath}.claude-mod-${process.pid}`;
await writeFile(temporary,next,{mode:0o600});
await rename(temporary,settingsPath);
console.log([`Installed the Claude Code mod from ${modDir}. New Claude Code sessions load it.${settingsExist?` Backup: ${backup}`:''}`,...notes].join('\n'));
