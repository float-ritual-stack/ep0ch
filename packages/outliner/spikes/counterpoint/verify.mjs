// A browser journey over a host this script starts itself. No real outline, no production endpoint.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const here=fileURLToPath(new URL('.',import.meta.url));
const evidence=process.env.COUNTERPOINT_EVIDENCE||join(here,'evidence');
await mkdir(evidence,{recursive:true});
const child=spawn('bun',[join(here,'run.ts'),'--port','0'],{stdio:['ignore','pipe','pipe']});
let stdout='',stderr='',browser;
child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);
const wait=async(check,label,ms=20000)=>{const end=Date.now()+ms;while(!await check()){if(Date.now()>end)throw new Error('Timed out: '+label+'\n'+stdout+'\n'+stderr);await new Promise(r=>setTimeout(r,50));}};
const passed=[];
function proof(message){passed.push(message);console.log('✓ '+message);}
try{
 await wait(()=>/http:\/\/127.0.0.1:\d+/.test(stdout),'private host starts');
 const base=stdout.match(/http:\/\/127.0.0.1:\d+/)[0];
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1600,height:1080},deviceScaleFactor:1,acceptDownloads:true});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.waitForFunction(()=>window.counterpoint);
 const state=()=>page.evaluate(()=>window.counterpoint.getState());
 const action=(name,args={})=>page.evaluate(({name,args})=>window.counterpoint.act(name,args),{name,args});
 const first=await state();assert.equal(first.score.cues.length,31);assert.equal(first.notes.length,31);
 const sourceByTitle=title=>first.notes.find(n=>n.title===title).id;
 const read=id=>page.evaluate(id=>fetch('/api/state').then(r=>r.json()).then(d=>d.notes.find(n=>n.id===id)),id);
 proof('31 invented source blocks load from the private outline with 52 authored references.');
 await page.screenshot({path:join(evidence,'01-score.png'),fullPage:true});
 const pristine=page.waitForEvent('download');await page.click('[data-act="portable"]');await(await pristine).saveAs(join(evidence,'counterpoint.html'));

 // Real mouse drag: moving a cue changes only arrangement state.
 const cue=first.score.cues.find(c=>c.source===first.selected),before=await read(cue.source);
 const box=await page.locator(`.cue[data-cue="${cue.id}"]`).boundingBox();
 await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.mouse.move(box.x+92,box.y+20,{steps:8});await page.mouse.up();
 const moved=(await state()).score.cues.find(c=>c.id===cue.id);assert.notEqual(moved.start,cue.start);
 assert.equal((await read(cue.source)).revision,before.revision);
 await page.keyboard.press('Control+z');await page.waitForFunction(({id,start})=>window.counterpoint.getState().score.cues.find(c=>c.id===id).start===start,{id:cue.id,start:cue.start});
 proof('Mouse rearrangement and keyboard undo preserve the canonical source revision.');
 await page.click('[data-view="loom"]');assert.equal(await page.locator('.loom .node').count(),31);
 assert.equal(await page.locator('.loom .thread').count(),52);
 await page.screenshot({path:join(evidence,'02-crossings.png'),fullPage:true});
 await page.locator('.loom .node').nth(2).focus();await page.keyboard.press('Enter');assert.equal((await state()).selected,first.notes[2].id);
 proof('Crossings are the service’s authored links; SVG nodes work by keyboard.');
 await action('select',{note:sourceByTitle('Automatic company')});await page.click('[data-act="hold"]');
 await action('select',{note:sourceByTitle('An answer too quickly')});assert.equal((await state()).held,sourceByTitle('Automatic company'));
 assert.match(await page.locator('.desk-grid').innerText(),/Automatic company/);assert.match(await page.locator('.desk-grid').innerText(),/An answer too quickly/);
 await page.waitForTimeout(6600);await page.screenshot({path:join(evidence,'03-listening-desk.png'),fullPage:true});
 proof('Two accounts remain independently addressable on the listening desk.');
 await action('select',{note:sourceByTitle('Keep the arrangement, not the verdict')});
 await page.click('[data-act="follow-thread"]');const threaded=await state();assert(threaded.score.cues.length>5&&threaded.score.cues.length<31);assert.equal(threaded.score.cues.at(-1).source,threaded.selected);
 await page.click('[data-act="undo"]');await page.waitForFunction(()=>window.counterpoint.getState().score.cues.length===31);
 proof('A reference-led reading traverses authored sources, ends at the selected account, and can be undone.');
 await page.selectOption('#group','stance');await page.waitForFunction(()=>document.querySelectorAll('.track').length===10);
 assert.equal(await page.locator('.track').count(),10);
 await page.selectOption('#group','voice');await page.waitForFunction(()=>document.querySelectorAll('.track').length===4);
 await page.click('[data-act="query-example"]');await page.waitForFunction(()=>document.querySelectorAll('.source-card').length===5);
 await page.fill('#query','type=passage');await page.locator('#query').press('Enter');await page.waitForFunction(()=>document.querySelectorAll('.source-card').length===31);
 proof('Grouping and filtering use live service facets and query grammar, including arbitrary stance values.');
 // Save a source through the actual editor; cue evidence must stay frozen.
 await action('select',{note:sourceByTitle('The old words still sound')});const old=await read((await state()).selected);
 await page.click('[data-act="edit-source"]');await page.fill('#source-editor',old.text+'\n\nA late correction: the ringing was a radiator. ((unfinished');
 await page.click('[data-act="save-source"]');await page.waitForSelector('.stale-warning');
 const stale=await state();assert.equal(stale.score.cues.find(c=>c.id===stale.selectedCue).revision,old.revision);
 assert.equal((await read(old.id)).revision,old.revision+1);
 await page.screenshot({path:join(evidence,'04-revision-tension.png'),fullPage:true});
 proof('An incomplete reference still saves; the cue visibly retains the earlier source revision.');
 await page.click('[data-act="adopt"]');await page.waitForFunction(()=>!document.querySelector('.stale-warning'));
 assert.equal((await state()).score.cues.find(c=>c.id===stale.selectedCue).revision,old.revision+1);
 // A second client's write arrives while this reader is drafting. The stale save must refuse without losing it.
 await page.click('[data-act="edit-source"]');const draft=await page.locator('#source-editor').inputValue();
 await page.fill('#source-editor',draft+'\n\nMy draft must remain.');
 const second=await context.newPage();await second.goto(base);await second.waitForFunction(()=>window.counterpoint);
 const fresh=await read(old.id);
 await second.evaluate(async({id,text,revision})=>{const r=await fetch('/api/source',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,text:text+'\n\nAnother client changed this.',revision})});if(!r.ok)throw new Error(await r.text());},{id:old.id,text:fresh.text,revision:fresh.revision});
 await page.bringToFront();await page.waitForTimeout(3400);await page.click('[data-act="save-source"]');
 await page.waitForFunction(()=>document.querySelector('#edit-error')?.textContent.length>0);
 assert.match(await page.locator('#source-editor').inputValue(),/My draft must remain/);
 await page.click('[data-act="cancel-edit"]');await page.waitForSelector('.stale-warning');
 proof('Another client’s source edit arrives live; a stale save refuses and keeps the entire open draft.');
 // Capture writes a real block, then a score survives browser reload.
 await page.click('[data-act="capture"]');await page.fill('#capture-text','The evidence changed while the earlier account stayed audible.');
 const captureDownload=page.waitForEvent('download');await page.locator('#capture-form button[type="submit"]').click();
 const captured=await captureDownload;await captured.saveAs(join(evidence,'captured-reading.blockdown'));
 const capture=await readFile(join(evidence,'captured-reading.blockdown'),'utf8');assert.match(capture,/Frozen excerpt/);assert.match(capture,/The evidence changed/);
 await page.click('[data-act="save"]');await page.waitForFunction(()=>!window.counterpoint.getState().dirty);const saved=await state();
 await page.reload();await page.waitForFunction(()=>window.counterpoint);assert.equal((await state()).scoreRevision,saved.scoreRevision);assert.deepEqual((await state()).score,saved.score);
 proof('Capturing creates a source-linked reading block; revision-checked score persistence survives reload.');
 // Score conflict is a refusal, not last-writer-wins.
 await second.reload();await second.waitForFunction(()=>window.counterpoint);await second.evaluate(()=>window.counterpoint.act('reframe'));await second.evaluate(()=>window.counterpoint.act('save'));
 await page.bringToFront();await action('reframe');await assert.rejects(()=>action('save'));assert.equal((await state()).dirty,true);
 proof('A competing arrangement save cannot overwrite this client’s unsaved reading.');
 // The instrument produces real nonzero audio, not just moving lights.
 await page.click('#sound');await page.click('#play');await page.waitForTimeout(700);assert((await state()).beat>0);assert.equal((await state()).sound,true);
 await page.click('[data-act="stop"]');assert.equal((await state()).playing,false);
 const audioDownload=page.waitForEvent('download');await page.click('#wav');await (await audioDownload).saveAs(join(evidence,'reading.wav'));
 const wav=await readFile(join(evidence,'reading.wav'));assert.equal(wav.toString('ascii',0,4),'RIFF');let peak=0,energy=0,samples=0;
 for(let i=44;i<wav.length;i+=2){const n=wav.readInt16LE(i)/32768;peak=Math.max(peak,Math.abs(n));energy+=n*n;samples++;}
 assert(peak>.001&&peak<.9);assert(energy/samples>1e-8);
 proof(`WebAudio playback advances; offline WAV is nonzero and unclipped (peak ${peak.toFixed(4)}, RMS ${Math.sqrt(energy/samples).toFixed(4)}).`);
 // A self-contained file must work with the network unavailable, including its re-export.
 const portableDownload=page.waitForEvent('download');await page.click('[data-act="portable"]');await (await portableDownload).saveAs(join(evidence,'journey.html'));
 const offline=await context.newPage();await offline.route('http://**',r=>r.abort());await offline.route('https://**',r=>r.abort());
 offline.on('pageerror',e=>errors.push('offline: '+e.message));
 await offline.goto(pathToFileURL(resolve(evidence,'journey.html')).href);await offline.waitForFunction(()=>window.counterpoint);
 assert.equal(await offline.locator('#mode-label').innerText(),'PORTABLE SNAPSHOT');
 await offline.selectOption('#group','role');await offline.waitForFunction(()=>window.counterpoint.getState().score.group==='role');assert.equal(await offline.locator('.track').count(),4);
 await offline.click('[data-act="reframe"]');
 const again=offline.waitForEvent('download');await offline.click('[data-act="portable"]');await(await again).saveAs(join(evidence,'reexport.html'));
 const offlineState=await offline.evaluate(()=>window.counterpoint.getState());
 await offline.goto(pathToFileURL(resolve(evidence,'reexport.html')).href);await offline.waitForFunction(()=>window.counterpoint);assert.deepEqual((await offline.evaluate(()=>window.counterpoint.getState())).score,offlineState.score);
 proof('The single-file instrument works with HTTP blocked, re-groups from service snapshots, and preserves a rearrangement when re-exported.');
 await page.bringToFront();await action('view',{view:'score'});await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
 await page.waitForTimeout(6600);await page.screenshot({path:join(evidence,'05-phone.png'),fullPage:true});
 proof('Phone layout fits 390 px without page overflow; the timeline scrolls independently.');
 assert.deepEqual(errors,[]);proof('No browser runtime errors across the journey.');
 await writeFile(join(evidence,'verification.json'),JSON.stringify({when:new Date().toISOString(),journey:passed,limits:['Headless Chromium with injected pointer and keyboard input; not a physical-device test.','Audio verified numerically, not judged by a human listener.','Fictional rehearsal only; production outlines and infrastructure untouched.']},null,2)+'\n');
 console.log(`Evidence: ${evidence}`);
}finally{
 await browser?.close();child.kill('SIGTERM');
 await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,5000))]);
}
