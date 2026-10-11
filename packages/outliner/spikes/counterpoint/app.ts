import type { BlockRecord } from '@ep0ch/outline-core/block-record';
import type { QuestionFacet, QuestionGroup } from '@ep0ch/outline-core/protocol';
import { cueFrom, type Cue, type Note, type Score } from './model';
import { Instrument, voicePitch } from './audio';
type Data={notes:Note[];matches:string[];facets:QuestionFacet[];groups:QuestionGroup[];hint?:string;completeness:{kind:string};allCompleteness:{kind:string};score:Score;scoreRevision:number;manifest:{root:string;sources:string;arrangement:string;scenes:string[];originalScore?:Score};scratch:string};
const portableElement=document.getElementById('cp-data');
const portable: (Data & {groupings:Record<string,QuestionGroup[]>})|null=portableElement?JSON.parse(portableElement.textContent!):null;
type View='score'|'loom'|'desk';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const colors=['#a7c6b6','#d4a18e','#9bafcb','#cbbb87','#b8a3c4','#9bbabc','#bbbd9c','#c69eb3'];
const viewNames:View[]=['score','loom','desk'];
let data:Data,score:Score,original:Score,revision=0,selected='',selectedCue='',held='',view:View='score',dirty=false;
let undoStack:Score[]=[],redoStack:Score[]=[],query='type=passage',muted=new Set<string>(),solo='',editing=false;
let editorDraft='',editorRevision=0,editorSource='',captureCues:Cue[]=[];
let playing=false,beat=0,startBeat=0,startTime=0,scheduled=new Set<string>(),sound=false,loop=false,loopStart=0,loopEnd=64,deskSignature='';
const instrument=new Instrument();
let noticeTimer:ReturnType<typeof setTimeout>;
function notice(message:string){$('notice').textContent=message;$('notice').classList.add('visible');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').classList.remove('visible'),6500);}
async function api(path:string,body?:unknown){
 if(portable){
   if(body!==undefined)throw new Error('This is a portable snapshot. Source writes require the connected rehearsal.');
   const url=new URL(path,'http://rehearsal.local'),key=url.searchParams.get('group')??portable.score.group;
   if(url.pathname==='/api/state')return {...structuredClone(portable),groups:portable.groupings[key]??portable.groups};
   throw new Error('This action requires the connected outline.');
 }
 const r=await fetch(path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const value=await r.json();if(!r.ok)throw new Error(value.error||r.statusText);return value;
}
function note(id=selected){return data.notes.find(n=>n.id===id);}
function cue(){return score.cues.find(c=>c.id===selectedCue);}
function groupName(id:string){return data.groups?.find(g=>g.ids.includes(id))?.value??'unassigned';}
function groups(){return (data.groups??[]).map(g=>g.value??'unassigned');}
function groupIndex(id:string){return Math.max(0,groups().indexOf(groupName(id)));}
function color(id:string){return colors[groupIndex(id)%colors.length]!;}
function property(n:BlockRecord,key:string){return n.properties.find(p=>p.key===key)?.values.join(', ')??'';}
function plainBody(n:{body:string;title:string}){const body=n.body.startsWith(n.title)?n.body.slice(n.title.length).trim():n.body;return body.split('\n\nIn conversation with ')[0]!;}
function currentReading(n:Note){
 const doc=new DOMParser().parseFromString(n.html,'text/html');
 const first=doc.body.querySelector('p:first-child');if(first?.textContent?.trim()===n.title)first.remove();
 for(const p of doc.body.querySelectorAll('p'))if(p.textContent?.startsWith('In conversation with '))p.remove();
 return doc.body.innerHTML;
}
function active(){return score.cues.filter(c=>c.start<=beat&&c.start+c.duration>beat&&!muted.has(groupName(c.source))&&(!solo||solo===groupName(c.source)));}
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function mutate(fn:()=>void){undoStack.push(structuredClone(score));if(undoStack.length>80)undoStack.shift();redoStack=[];fn();dirty=true;restartClock();render();}
function now(){return sound?instrument.now:performance.now()/1000;}
function restartClock(){if(!playing)return;instrument.silence();startBeat=beat;startTime=now();scheduled=new Set();schedule();}
function seek(value:number){beat=Math.max(0,Math.min(63.99,value));restartClock();updateClock();if(view==='desk')renderDesk();}
function pause(){if(playing)beat=Math.min(63.99,startBeat+(now()-startTime)*score.bpm/60);playing=false;instrument.silence();$('play').innerHTML='▶ <span>Play reading</span><kbd>Space</kbd>';updateClock();}
function schedule(){
 if(!playing||!sound)return;
 const horizon=beat+.16*score.bpm/60;
 for(const c of score.cues){
  if(scheduled.has(c.id)||c.start>horizon||c.start+c.duration<=beat||muted.has(groupName(c.source))||(solo&&solo!==groupName(c.source)))continue;
  const start=Math.max(beat,c.start),end=Math.min(c.start+c.duration,loop?loopEnd:64);
  if(end<=start)continue;
  scheduled.add(c.id);const names=groups(),i=groupIndex(c.source),pan=names.length<2?0:(i/(names.length-1)-.5)*1.1;
  instrument.play(c,groupName(c.source),pan,instrument.now+Math.max(0,(c.start-beat)*60/score.bpm),(end-start)*60/score.bpm);
 }
}
function updateClock(){
 $('clock').textContent=`${String(Math.floor(beat/4)+1).padStart(2,'0')} : ${Math.floor(beat%4)+1}`;
 $('scene-name').textContent=data?.manifest.scenes[Math.floor(beat/8)]??'';
 document.querySelectorAll<HTMLElement>('.playhead').forEach(el=>el.style.setProperty('--position',String(beat/64)));
 const scrub=document.getElementById('scrubber') as HTMLInputElement|null;if(scrub&&document.activeElement!==scrub)scrub.value=String(beat);
 const live=new Set(active().map(c=>c.id));document.querySelectorAll<HTMLElement>('.cue').forEach(el=>el.classList.toggle('active',live.has(el.dataset.cue!)));
 const signature=active().map(c=>c.id).join(',');if(view==='desk'&&signature!==deskSignature){deskSignature=signature;renderDesk();}
}
setInterval(()=>{if(!playing)return;beat=startBeat+(now()-startTime)*score.bpm/60;
 if(beat>=(loop?loopEnd:64)){if(loop){beat=loopStart;restartClock();}else{pause();beat=0;updateClock();}return;}
 schedule();updateClock();},35);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing){pause();notice('Paused while the instrument is out of view.');}});
function renderLibrary(){
 const matches=new Set(data.matches),notes=data.notes.filter(n=>matches.has(n.id));
 $('match-count').textContent=String(notes.length);
 $('library-list').innerHTML=notes.map(n=>`<button class="source-card ${selected===n.id?'selected':''}" style="--voice:${color(n.id)}" draggable="true" data-act="select" data-note="${n.id}" aria-label="Read ${escape(n.title)}"><span class="source-meta"><i class="voice-dot"></i>${escape(property(n,'voice')||groupName(n.id))}<span> / ${escape(property(n,'scene'))}</span></span><span class="source-title">${escape(n.title)}</span><span class="source-excerpt">${escape(plainBody(n))}</span></button>`).join('')||'<p class="small">No passages match this query.</p>';
 $('query-result').textContent=data.hint??(data.completeness.kind==='complete'?'':'This result was truncated by the service.');
}
function scoreFooter(){return `<div class="scrub"><span>01</span><input id="scrubber" type="range" min="0" max="63.99" step=".1" value="${beat}" aria-label="Reading position"><span>64 BEATS</span></div>${loop?`<div class="loop-range">REPEAT <label>from <input id="loop-start" type="number" min="1" max="63" value="${loopStart+1}" aria-label="Loop start beat"></label><label>to <input id="loop-end" type="number" min="2" max="64" value="${loopEnd}" aria-label="Loop end beat"></label><span>The loop is a listening window, not a source edit.</span></div>`:''}`;}
function renderScore(){
 const names=groups();
 $('view').innerHTML=`<div class="score-scroll"><div class="score-content"><div class="ruler">${data.manifest.scenes.map((s,i)=>`<button data-act="seek" data-beat="${i*8}" title="Go to ${escape(s)}"><b>${String(i*2+1).padStart(2,'0')}</b><small>${escape(s)}</small></button>`).join('')}</div>${names.map((name,i)=>{
  const cs=score.cues.filter(c=>groupName(c.source)===name),rows:number[]=[];
  const positions=new Map<string,number>();
  for(const c of [...cs].sort((a,b)=>a.start-b.start)){let row=rows.findIndex(end=>end<=c.start);if(row<0)row=rows.length;rows[row]=c.start+c.duration;positions.set(c.id,row);}
  const height=Math.max(98,rows.length*84+14);
  return `<div class="track ${muted.has(name)||(solo&&solo!==name)?'muted':''}" style="--voice:${colors[i%colors.length]};min-height:${height}px"><div class="track-head"><b>${escape(name)}</b><small>${cs.length} passages</small><div class="track-controls"><button data-act="mute" data-group="${escape(name)}" class="${muted.has(name)?'on':''}" aria-label="Mute ${escape(name)}" aria-pressed="${muted.has(name)}">M</button><button data-act="solo" data-group="${escape(name)}" class="${solo===name?'on':''}" aria-label="Solo ${escape(name)}" aria-pressed="${solo===name}">S</button></div></div><div class="track-bed" data-track="${escape(name)}" style="height:${height}px">${cs.map(c=>`<button class="cue ${selectedCue===c.id?'selected':''} ${note(c.source)?.revision!==c.revision?'stale':''}" style="left:${c.start/64*100}%;width:${c.duration/64*100}%;top:${12+positions.get(c.id)!*84}px" data-act="select" data-note="${c.source}" data-cue="${c.id}" title="${escape(c.title)} · beat ${c.start+1} · revision ${c.revision}" aria-label="${escape(c.title)}, beat ${c.start+1}"><b>${escape(c.title)}</b><small>r${c.revision} · ${c.duration} beats</small></button>`).join('')}</div></div>`;
 }).join('')}<div class="playhead" style="--position:${beat/64}"></div></div></div><div class="score-legend"><span>Drag a cue to rearrange</span><span>Click to read its source</span><span>Older source revision</span></div>${scoreFooter()}`;
}
function loomPositions(){const points=new Map<string,{x:number;y:number}>();
 const names=groups();for(const n of data.notes){const c=score.cues.find(c=>c.source===n.id);if(!c)continue;
 const angle=(c.start/64)*Math.PI*2-Math.PI/2,r=105+groupIndex(n.id)*(105/Math.max(1,names.length-1));points.set(n.id,{x:320+Math.cos(angle)*r,y:245+Math.sin(angle)*r});}return points;}
function renderLoom(){
 const points=loomPositions();let edges='';let count=0;
 for(const n of data.notes){for(const link of n.links){if(!link.target)continue;const a=points.get(n.id),b=points.get(link.target);if(!a||!b)continue;count++;const highlight=selected===n.id||selected===link.target;
 edges+=`<path class="thread ${highlight?'highlight':''}" d="M ${a.x} ${a.y} Q 320 245 ${b.x} ${b.y}"/>`;}}
 const chosen=note();
 $('view').innerHTML=`<div class="loom"><svg viewBox="0 0 640 490" role="img" aria-label="Authored reference crossings arranged by time and voice"><title>References between source passages; no inferred similarity</title>${groups().map((_,i)=>`<circle class="orbit" cx="320" cy="245" r="${105+i*105/Math.max(1,groups().length-1)}"/>`).join('')}${edges}<circle cx="320" cy="245" r="67" fill="#151f20"/><text class="center-title" x="320" y="239">${count} crossings</text><text class="center-sub" x="320" y="260">NO SINGLE READING</text>${data.manifest.scenes.map((_,i)=>{const a=i/8*Math.PI*2-Math.PI/2;return `<text class="scene-label" x="${320+Math.cos(a)*233}" y="${248+Math.sin(a)*233}">${String(i+1).padStart(2,'0')}</text>`;}).join('')}${data.notes.map((n,i)=>{const p=points.get(n.id);return p?`<g class="node ${selected===n.id?'selected':''}" style="--voice:${color(n.id)}" role="button" tabindex="0" data-act="select" data-note="${n.id}" aria-label="${escape(n.title)}"><title>${escape(n.title)}</title><circle cx="${p.x}" cy="${p.y}" r="${selected===n.id?8:5}"/><text x="${p.x+11}" y="${p.y+3}">${String(i+1).padStart(2,'0')}</text></g>`:'';}).join('')}</svg></div><div class="loom-key">${groups().map((g,i)=>`<span style="--voice:${colors[i%colors.length]}"><i class="voice-dot"></i> ${escape(g)}</span>`).join('')}</div><div class="crossing-detail"><span>${chosen?escape(chosen.title):'Select a node'}${chosen?' is in conversation with:':'. A crossing means a reference was written.'}</span><br>${chosen?.links.filter(l=>l.target).map(l=>`<button data-act="select" data-note="${l.target}">${escape(l.label)} ↗</button>`).join('')||'<span>No outgoing references in this passage.</span>'}</div>${scoreFooter()}`;
}
function renderDesk(){
 const heldNote=held?note(held):undefined,chosen=note();
 const sounding=active(),chosenCue=cue();
 const items:{n:Note;c?:Cue;label:string}[]=[];
 if(heldNote)items.push({n:heldNote,c:score.cues.find(c=>c.source===held),label:'HELD IN VIEW'});
 if(chosen&&chosen.id!==held)items.push({n:chosen,c:chosenCue,label:playing?'YOUR SELECTED PASSAGE':'SELECTED PASSAGE'});
 for(const c of sounding)if(!items.some(x=>x.n.id===c.source)){const n=note(c.source);if(n)items.push({n,c,label:'AT THIS MOMENT'});}
 $('view').innerHTML=`<div class="desk-heading"><span>${held?'Two accounts, held apart.':'A place to stay with the words.'}</span>${held?'<button data-act="unhold">Release held passage ×</button>':''}</div><div class="desk-grid">${items.slice(0,4).map(({n,c,label})=>`<article class="desk-note ${n.id===held?'held':''}" style="--voice:${color(n.id)}"><span class="eyebrow">${label} / ${escape(groupName(n.id))}</span><h3>${escape(c?.title??n.title)}</h3><div class="passage ${!c||c.revision===n.revision?'formatted':''}">${!c||c.revision===n.revision?currentReading(n):escape(plainBody(c))}</div><button data-act="select" data-note="${n.id}">Open source · r${c?.revision??n.revision} ↗</button>${c&&c.revision!==n.revision?'<p class="small">An older revision is playing.</p>':''}</article>`).join('')}${items.length<2?'<div class="desk-empty">Hold a passage beside another.<br><br>Try “Automatic company” with “An answer too quickly.”<br><br>Neither has to become a summary of the other.</div>':''}</div>${scoreFooter()}`;
}
function renderInspector(){
 if(editing)return;
 const n=note(),c=cue();if(!n){$('inspector').innerHTML='<div class="empty-reader">Choose a passage to hear its part.</div>';return;}
 const old=c&&c.revision!==n.revision;
 $('inspector').innerHTML=`<div class="reader-top"><span class="eyebrow">THE SOURCE / ${String(data.notes.indexOf(n)+1).padStart(2,'0')}</span><button data-act="hold">${held===n.id?'Held beside ✓':'Hold beside ↗'}</button></div><div class="source-meta" style="--voice:${color(n.id)}"><i class="voice-dot"></i>${escape(property(n,'voice'))} / ${escape(property(n,'role'))}</div><h2 class="reader-title">${escape(n.title)}</h2><div class="reader-meta"><span>${escape(property(n,'stance'))}</span><span>scene ${escape(property(n,'scene'))}</span><span>source r${n.revision}</span></div>${old?`<div class="stale-warning">The score plays revision ${c.revision}. This source is now revision ${n.revision}. The performance has kept its earlier words.<br><button data-act="adopt">Take current revision →</button><details><summary>Read the frozen words</summary><div class="frozen-body">${escape(c.body)}</div></details></div>`:''}<div class="reader-body">${n.html}</div><div class="reader-controls"><button data-act="edit-source">Edit source</button><button data-act="follow-thread">Read this thread ↝</button><button data-act="add-cue">＋ Cue at playhead</button></div>${c?`<div class="cue-controls"><label>START BEAT<input id="cue-start" type="number" min="1" max="64" step=".5" value="${c.start+1}"></label><label>DURATION<input id="cue-duration" type="number" min="1" max="64" step=".5" value="${c.duration}"></label><label>CUE LEVEL<input id="cue-gain" type="range" min="0" max="1" step=".05" value="${c.gain}"></label><button data-act="remove-cue">Remove this cue</button></div>`:''}<div class="reader-foot">${n.id.slice(0,8)} · ${escape(n.author)}${n.actor?' / '+escape(n.actor):''}<br>${portable?'Frozen source in this portable snapshot.':'Live source from the rehearsal outline.'}<br>${c?`Cue ${c.id.slice(0,8)} holds revision ${c.revision}.`:'This passage is not in the score.'}</div>`;
 // The title has its own typography above; the renderer's first paragraph repeats the source title.
 const first=$('inspector').querySelector('.reader-body > p:first-child');if(first?.textContent?.trim()===n.title)first.remove();
}
function renderState(){
 $('state').textContent=JSON.stringify({outline:'counterpoint',arrangement:data.manifest.arrangement,revision,unsaved:dirty,view,group:score.group,cues:score.cues.length,selectedSource:selected,selectedCue:cue()??null,held:held||null,muted:[...muted],solo:solo||null},null,2);
 $('save').classList.toggle('dirty',dirty);$('save').textContent=portable?'Save as HTML ↓':dirty?'Save reading •':'Reading saved';
 $('score-status').title=score.title;
 $('undo').toggleAttribute('disabled',!undoStack.length);$('redo').toggleAttribute('disabled',!redoStack.length);
 $('score-status').textContent=portable?'Portable snapshot · save a new HTML file to keep your arrangement.':dirty?'Arrangement changed. Sources stayed put.':`Saved as outline block · revision ${revision}`;
}
function render(){
 renderLibrary();const labels={score:['01 / THE SCORE','A conversation in four voices'],loom:['02 / AUTHORED CROSSINGS','Every line has a reason'],desk:['03 / THE LISTENING DESK','Stay with the disagreement']};
 $('group-caption').textContent=portable?'Groups captured with this file.':'Groups follow live source properties.';
 $('view-kicker').textContent=labels[view][0]!;$('view-title').textContent=view==='score'?`A conversation in ${groups().length} voices`:labels[view][1]!;
 document.querySelectorAll<HTMLButtonElement>('[data-act="view"]').forEach(b=>b.classList.toggle('selected',b.dataset.view===view));
 const select=$<HTMLSelectElement>('group');select.innerHTML=data.facets.map(f=>`<option value="${escape(f.key)}" ${score.group===f.key?'selected':''}>${escape(f.key)}</option>`).join('');
 $<HTMLInputElement>('tempo').value=String(score.bpm);$('tempo-value').textContent=String(score.bpm);
 if(view==='score')renderScore();else if(view==='loom')renderLoom();else renderDesk();
 renderInspector();renderState();updateClock();
}
async function reload(){
 const fresh:Data=await api('/api/state?where='+encodeURIComponent(query)+'&group='+encodeURIComponent(score.group));data=fresh;
 render();
}
async function setView(next:View){view=next;const u=new URL(location.href);u.searchParams.set('variant',view);history.replaceState(null,'',u);render();}
async function select(id:string,cueId?:string){
 if(editing&&id!==selected){notice('Save or cancel the source draft before choosing another passage.');return;}
 if(!note(id)){notice('That source is outside this rehearsal.');return;}
 selected=id;selectedCue=cueId??score.cues.find(c=>c.source===id)?.id??'';render();
}
// One action path for buttons, keys and the in-page agent API. None of these focuses an editor for an agent.
async function act(name:string,args:Record<string,string>={}){
 try{switch(name){
 case 'select':await select(args.note!,args.cue);break;
 case 'play':if(playing)pause();else{if(sound)await instrument.enable();if(loop&&(beat<loopStart||beat>=loopEnd))beat=loopStart;playing=true;restartClock();$('play').innerHTML='Ⅱ <span>Pause reading</span><kbd>Space</kbd>';}break;
 case 'stop':pause();beat=0;updateClock();break;
 case 'seek':seek(Number(args.beat));break;
 case 'sound':if(sound){pause();sound=false;instrument.silence();}else{await instrument.enable();sound=true;restartClock();}$('sound').textContent=sound?'◉ Sound on':'◌ Sound off';$('sound').classList.toggle('enabled',sound);break;
 case 'loop':loop=!loop;$('loop').textContent=loop?'↻ Loop on':'↻ Loop off';$('loop').classList.toggle('enabled',loop);if(loop&&(beat<loopStart||beat>=loopEnd))seek(loopStart);render();break;
 case 'mute':muted.has(args.group!)?muted.delete(args.group!):muted.add(args.group!);restartClock();render();break;
 case 'solo':solo=solo===args.group?'':args.group!;restartClock();render();break;
 case 'view':await setView(viewNames.includes(args.view as View)?args.view as View:'score');break;
 case 'previous-view':await setView(viewNames[(viewNames.indexOf(view)+2)%3]!);break;
 case 'next-view':await setView(viewNames[(viewNames.indexOf(view)+1)%3]!);break;
 case 'help':$<HTMLDialogElement>('help-dialog').showModal();break;
 case 'close-help':$<HTMLDialogElement>('help-dialog').close();break;
 case 'hold':held=selected;await setView('desk');notice('Held in view. Choose another passage to put beside it.');break;
 case 'unhold':held='';render();break;
 case 'undo':if(undoStack.length){redoStack.push(structuredClone(score));score=undoStack.pop()!;dirty=true;await reload();restartClock();}break;
 case 'redo':if(redoStack.length){undoStack.push(structuredClone(score));score=redoStack.pop()!;dirty=true;await reload();restartClock();}break;
 case 'follow-thread':{
 const seen=new Set<string>(),ordered:Note[]=[];
 const visit=(id:string)=>{if(seen.has(id))return;seen.add(id);const n=note(id);if(!n)return;for(const l of n.links)if(l.target)visit(l.target);ordered.push(n);};
 visit(selected);if(!ordered.length)break;
 mutate(()=>{const step=64/ordered.length;score.cues=ordered.map((n,i)=>cueFrom(n,i*step,Math.min(step,6)));score.title='A reading toward '+note()!.title;selectedCue=score.cues.at(-1)!.id;});
 await setView('score');notice(`Arranged ${ordered.length} passages by authored references, ending at your selection. Cycles are visited once. Undo returns to the previous reading.`);break;}
 case 'reframe':mutate(()=>{for(const c of score.cues)c.start=64-c.start-c.duration;});notice('The chronology is reversed. References and sources have not changed.');break;
 case 'reset':mutate(()=>{score=structuredClone(original);});muted.clear();solo='';await reload();notice('Original arrangement restored. Source edits remain.');break;
 case 'save':{if(portable){await act('portable');break;}const saved=await api('/api/score',{score,revision});revision=saved.revision;dirty=false;renderState();notice('Reading saved to the private outline.');break;}
 case 'add-cue':{const n=note();if(n)mutate(()=>{const c=cueFrom(n,Math.min(63,Math.round(beat*2)/2),Math.min(6,64-Math.min(63,Math.round(beat*2)/2)));score.cues.push(c);selectedCue=c.id;});break;}
 case 'remove-cue':mutate(()=>{score.cues=score.cues.filter(c=>c.id!==selectedCue);selectedCue='';});break;
 case 'adopt':{const n=note(),c=cue();if(n&&c)mutate(()=>{c.body=n.body;c.title=n.title;c.revision=n.revision;});notice('This cue now holds the current words. Other cues keep their revisions.');break;}
 case 'edit-source':{if(portable){notice('This file is a frozen rehearsal. Open the connected instrument to edit sources.');break;}const n=note();if(!n)break;pause();editing=true;editorDraft=n.text;editorSource=n.id;editorRevision=n.revision;
 $('inspector').innerHTML=`<div class="eyebrow">EDIT A REAL SOURCE / r${n.revision}</div><h2 class="reader-title">The source can change.</h2><p class="small">The score keeps its earlier words until you take this revision. Your draft stays here if a save is refused.</p><textarea id="source-editor" class="source-editor" aria-label="Source Blockdown">${escape(editorDraft)}</textarea><div class="reader-controls"><button data-act="save-source" class="primary">Save source</button><button data-act="cancel-edit">Cancel</button></div><div id="edit-error" class="error" role="status"></div>`;break;}
 case 'save-source':try{await api('/api/source',{id:editorSource,revision:editorRevision,text:editorDraft});editing=false;await reload();notice('Source saved. The score still holds its earlier revision.');}catch(e){$('edit-error').textContent=String(e);throw e;}break;
 case 'cancel-edit':editing=false;renderInspector();break;
 case 'query-example':$<HTMLInputElement>('query').value='type=passage (stance=objection OR stance=constraint)';query=$<HTMLInputElement>('query').value;await reload();break;
 case 'capture':{captureCues=structuredClone(active());const chosen=cue();if(chosen&&!captureCues.some(c=>c.id===chosen.id))captureCues.push(structuredClone(chosen));const h=score.cues.find(c=>c.source===held);if(h&&!captureCues.some(c=>c.id===h.id))captureCues.push(structuredClone(h));
 $('capture-context').textContent=`Keep ${captureCues.length} frozen passages with their source revisions and your observation. ${portable?'This downloads a reading; it does not write to an outline.':'This creates a reading note in the private outline.'}`;$<HTMLDialogElement>('capture-dialog').showModal();break;}
 case 'close-capture':$<HTMLDialogElement>('capture-dialog').close();break;
 case 'portable':{
 let blob:Blob;
 if(portable){
  const doc=document.documentElement.cloneNode(true) as HTMLElement;
  const payload={...portable,score:structuredClone(score),groups:data.groups};
  doc.querySelector('#cp-data')!.textContent=JSON.stringify(payload).replace(/</g,'\\u003c');
  doc.querySelectorAll('dialog').forEach(d=>d.removeAttribute('open'));
  blob=new Blob(['<!doctype html>\n'+doc.outerHTML],{type:'text/html'});
 }else{
  const response=await fetch('/api/portable',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({score})});
  if(!response.ok)throw new Error((await response.json()).error);blob=await response.blob();
 }
 download(blob,'counterpoint.html');notice('A whole instrument in one file. Open it offline; sources are frozen, arrangements remain playable.');break;}
 case 'export':download(new Blob([JSON.stringify({score,outline:'counterpoint',arrangement:data.manifest.arrangement,revision},null,2)],{type:'application/json'}),'counterpoint-score.json');notice('Exported the score and its frozen excerpts.');break;
 case 'wav':{pause();$('wav').textContent='Rendering…';const voices=new Map<string,{name:string;pan:number}>();const names=groups();for(const n of data.notes){const i=groupIndex(n.id);if(!muted.has(groupName(n.id))&&(!solo||solo===groupName(n.id)))voices.set(n.id,{name:groupName(n.id),pan:names.length<2?0:(i/(names.length-1)-.5)*1.1});}
 const rendered=await instrument.wav(score.cues,score.bpm,voices,64);download(rendered.blob,'counterpoint-reading.wav');$('wav').textContent='Render audio ↓';notice(`Rendered ${rendered.seconds.toFixed(1)} seconds. Peak ${rendered.peak.toFixed(3)}. Sound maps placement, not meaning.`);break;}
 default:throw new Error(`Unknown action: ${name}`);
 }}catch(error){notice(error instanceof Error?error.message:String(error));throw error;}
}
// Catch UI action errors after showing the refusal; the API still rejects for an agent caller.
const invoke=(name:string,args:Record<string,string>={})=>void act(name,args).catch(()=>{});
document.addEventListener('click',e=>{const target=(e.target as Element).closest<HTMLElement>('[data-act]');if(target){if(suppressClick===target.dataset.cue){suppressClick=null;return;}invoke(target.dataset.act!,target.dataset as Record<string,string>);return;}
 const a=(e.target as Element).closest<HTMLAnchorElement>('a[href^="#note="]');if(a){e.preventDefault();invoke('select',{note:a.hash.slice(6)});}});
document.addEventListener('keydown',e=>{
 const editingInput=(e.target as Element).closest('input,textarea,select,[contenteditable]');
 if(editingInput)return;if(e.key==='Escape'){if(playing)pause();return;}
 if(document.querySelector('dialog[open]'))return;
 if(e.key==='Enter'&&(e.target as Element).matches('.node')){const t=e.target as HTMLElement;invoke('select',t.dataset as Record<string,string>);return;}
 if(e.code==='Space'){e.preventDefault();invoke('play');}
 else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();invoke(e.shiftKey?'redo':'undo');}
 else if(['1','2','3'].includes(e.key))invoke('view',{view:viewNames[Number(e.key)-1]!});
 else if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();if(playing)seek(beat+(e.key==='ArrowRight'?1:-1));else invoke(e.key==='ArrowRight'?'next-view':'previous-view');}
 else if(e.key==='?')invoke('help');
});
document.addEventListener('input',e=>{const input=e.target as HTMLInputElement;
 if(input.id==='scrubber')seek(Number(input.value));
 if(input.id==='volume')instrument.setLevel(Number(input.value)/100);
 if(input.id==='source-editor')editorDraft=input.value;
 if(input.id==='tempo')$('tempo-value').textContent=input.value;
});
document.addEventListener('change',async e=>{const input=e.target as HTMLInputElement;
 try{
 if(input.id==='tempo')mutate(()=>{score.bpm=Number(input.value);});
 if(input.id==='group'){const previous=score.group;undoStack.push(structuredClone(score));score.group=input.value;try{await reload();dirty=true;redoStack=[];muted.clear();solo='';restartClock();renderState();}catch(error){score.group=previous;undoStack.pop();throw error;}}
 if(input.id.startsWith('cue-')){const c=cue();if(!c)return;const v=Number(input.value);if(!Number.isFinite(v))return;mutate(()=>{if(input.id==='cue-start')c.start=Math.max(0,Math.min(64-c.duration,v-1));if(input.id==='cue-duration')c.duration=Math.max(1,Math.min(64-c.start,v));if(input.id==='cue-gain')c.gain=Math.max(0,Math.min(1,v));});}
 if(input.id==='loop-start'){loopStart=Math.max(0,Math.min(loopEnd-1,Number(input.value)-1));if(loop)seek(loopStart);render();}
 if(input.id==='loop-end'){loopEnd=Math.max(loopStart+1,Math.min(64,Number(input.value)));if(loop)seek(loopStart);render();}
 }catch(error){notice(String(error));}
});
$('query-form').addEventListener('submit',e=>{e.preventDefault();query=$<HTMLInputElement>('query').value;void reload().catch(error=>{$('query-result').textContent=String(error);notice('The query was refused; the previous reading is still here.');});});
$('capture-form').addEventListener('submit',async e=>{e.preventDefault();const text=$<HTMLTextAreaElement>('capture-text').value;try{if(portable){
 const reading=text+'\n\n'+captureCues.map(c=>c.title+'\n'+c.body+'\nSource '+c.source+' revision '+c.revision).join('\n\n');
 download(new Blob([reading],{type:'text/plain'}),'counterpoint-captured-reading.txt');$<HTMLDialogElement>('capture-dialog').close();notice('Downloaded this reading. Portable snapshots do not write to an outline.');return;}
 const saved=await api('/api/capture',{text,cues:captureCues,score});$<HTMLDialogElement>('capture-dialog').close();$<HTMLTextAreaElement>('capture-text').value='';download(new Blob([saved.text],{type:'text/plain'}),'counterpoint-captured-reading.blockdown');notice(`Captured reading ${saved.id.slice(0,8)} saved in the outline and downloaded.`);}catch(error){notice(String(error));}});
// Horizontal pointer motion changes time only. It never reparents a source or overwrites its voice property.
let drag:{id:string;x:number;start:number;width:number;el:HTMLElement;moved:boolean}|null=null,suppressClick:string|null=null;
document.addEventListener('pointerdown',e=>{const el=(e.target as Element).closest<HTMLElement>('.cue');if(!el||e.button!==0)return;const c=score.cues.find(c=>c.id===el.dataset.cue);if(!c)return;drag={id:c.id,x:e.clientX,start:c.start,width:el.parentElement!.getBoundingClientRect().width,el,moved:false};el.setPointerCapture(e.pointerId);});
document.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x;if(Math.abs(dx)<5&&!drag.moved)return;drag.moved=true;const c=score.cues.find(c=>c.id===drag!.id)!;const start=Math.max(0,Math.min(64-c.duration,Math.round((drag.start+dx/drag.width*64)*2)/2));drag.el.style.left=`${start/64*100}%`;});
document.addEventListener('pointerup',e=>{if(!drag)return;const d=drag;drag=null;if(!d.moved)return;suppressClick=d.id;const c=score.cues.find(c=>c.id===d.id)!;const start=Math.max(0,Math.min(64-c.duration,Math.round((d.start+(e.clientX-d.x)/d.width*64)*2)/2));mutate(()=>{c.start=start;selected=c.source;selectedCue=c.id;});setTimeout(()=>suppressClick=null,100);});
document.addEventListener('pointercancel',()=>{drag=null;render();});
document.addEventListener('dragstart',e=>{const source=(e.target as Element).closest<HTMLElement>('.source-card');if(source)e.dataTransfer?.setData('text/counterpoint',source.dataset.note!);});
document.addEventListener('dragover',e=>{if((e.target as Element).closest('.track-bed'))e.preventDefault();});
document.addEventListener('drop',e=>{const bed=(e.target as Element).closest<HTMLElement>('.track-bed'),id=e.dataTransfer?.getData('text/counterpoint');if(!bed||!id)return;e.preventDefault();const n=note(id);if(!n)return;const r=bed.getBoundingClientRect(),start=Math.min(63,Math.max(0,Math.round((e.clientX-r.left)/r.width*64*2)/2));mutate(()=>{const c=cueFrom(n,start,Math.min(6,64-start));score.cues.push(c);selected=n.id;selectedCue=c.id;});notice('Cue added to its source’s voice. The drop chooses time, not authorship.');});
window.addEventListener('beforeunload',e=>{if(dirty||editing){e.preventDefault();e.returnValue='';}});
async function init(){
 data=await api('/api/state');score=structuredClone(data.score);original=structuredClone(score);revision=data.scoreRevision;
 original=structuredClone(data.manifest.originalScore??score);
 const variant=new URL(location.href).searchParams.get('variant') as View;view=viewNames.includes(variant)?variant:'score';
 selected=data.notes[5]?.id??data.notes[0]!.id;selectedCue=score.cues.find(c=>c.source===selected)?.id??'';
 $('source-count').textContent=String(data.notes.length);$('crossing-count').textContent=String(data.notes.reduce((sum,n)=>sum+n.links.filter(l=>l.target).length,0));
 $('sound').textContent='◌ Sound off';$('sound').classList.remove('enabled');$('loop').textContent='↻ Loop off';$('loop').classList.remove('enabled');$('play').innerHTML='▶ <span>Play reading</span><kbd>Space</kbd>';
 if(portable){
 $('mode-label').textContent='PORTABLE SNAPSHOT';
 $<HTMLInputElement>('query').disabled=true;
 $('query-form').querySelectorAll('button').forEach(b=>b.disabled=true);
 $('query-form').title='Querying needs the connected outline; this snapshot includes all source passages.';
 $('capture-form').querySelector('button[type="submit"]')!.textContent='Download reading';
 }
 render();
 let refreshing=false,connectionLost=false;
 setInterval(async()=>{
  if(portable||document.hidden||refreshing)return;refreshing=true;
  try{
   const fresh:Data=await api('/api/state?where='+encodeURIComponent(query)+'&group='+encodeURIComponent(score.group));
   if(connectionLost){connectionLost=false;renderState();notice('The outline connection is back. Your local reading was retained.');}
   const stamp=(d:Data)=>d.notes.map(n=>n.id+'@'+n.revision).join(',');
   if(stamp(fresh)!==stamp(data)){data=fresh;render();notice(editing?'A source changed elsewhere. Your draft is still here; its save remains revision-checked.':'Source changes arrived. Frozen cues keep the versions you chose.');}
   if(fresh.scoreRevision!==revision){$('score-status').textContent=`Another client saved revision ${fresh.scoreRevision}. Your reading is retained; reload to take theirs after exporting yours.`;}
  }catch{connectionLost=true;$('score-status').textContent='Outline connection unavailable. Keep this page open; restart the rehearsal with its printed --resume command. Your local reading and draft remain here.';}
  finally{refreshing=false;}
 },3000);
 (window as any).counterpoint={act,getState:()=>({score:structuredClone(score),scoreRevision:revision,selected,selectedCue,held,view,beat,playing,sound,dirty,editing,notes:data.notes.map(n=>({id:n.id,title:n.title,revision:n.revision,voice:groupName(n.id),pitch:voicePitch(groupName(n.id))})),scratch:data.scratch}),refresh:reload};
}
void init().catch(error=>{$('view').innerHTML=`<p class="error">The rehearsal could not load: ${escape(error)}. Restart with bun run spike:counterpoint.</p>`;notice(String(error));});
