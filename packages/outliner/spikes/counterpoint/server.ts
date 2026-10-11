import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { OutlineHost } from '../../src/outline-host';
import { OutlinerClient } from '../../src/client';
import { renderMarkdownHtml } from '../../src/publish';
import type { Block, VisibleBlockCollection } from '../../src/types';
import type { BlockRecord } from '@ep0ch/outline-core/block-record';
import type { BlockRecordRead } from '../../src/block-records';
import { seed } from './seed';
import { readScore, scoreText, validateScore } from './model';

const root=process.env.COUNTERPOINT_ROOT;
if(!root?.startsWith('/tmp/counterpoint-') || process.env.EP0CH_OUTLINES !== join(root,'outlines') || process.env.XDG_CONFIG_HOME !== join(root,'config')) throw new Error('Start through run.ts so the host is isolated.');
const host=new OutlineHost({outlinesFolder:join(root,'outlines'),log:()=>{}});
await host.start();
const client=new OutlinerClient(host.socketPath,15000,'counterpoint');
let server: ReturnType<typeof Bun.serve> | undefined;
let stopping=false;
async function stop() { if(stopping)return;stopping=true;await server?.stop(true);await host.close();process.exit(0); }
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>void stop());
try {
 await client.request({action:'outlines.attach',name:'counterpoint',create:true});
 await client.requireCompatibleService();
 const manifestPath=join(root,'manifest.json');
 const manifest:Awaited<ReturnType<typeof seed>>=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,'utf8')):await seed(client);
 if(!existsSync(manifestPath))writeFileSync(manifestPath,JSON.stringify(manifest));
 const query=(where:string,group?:string)=>client.request<VisibleBlockCollection>({action:'blocks.query',query:{where,group,sort:'scene asc',limit:200,facets:true}});
 const block=(id:string)=>client.request<Block>({action:'get',blockId:id});
 const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 const render=(n:BlockRecord)=>{
   let body=n.body;
   const spans=n.links.flatMap(l=>l.bodySpans.map(([s,e])=>({s,e,label:l.label.replace(/[\[\]]/g,''),id:l.target})));
   for(const p of spans.sort((a,b)=>b.s-a.s))body=body.slice(0,p.s)+(p.id?`[${p.label}](#note=${p.id})`:p.label)+body.slice(p.e);
   return renderMarkdownHtml(body);
 };
 async function state(where='type=passage',group='voice') {
   const [all,filtered,arrangement]=await Promise.all([query('type=passage',group),query(where),block(manifest.arrangement)]);
   const records=all.blocks.length?(await client.request<BlockRecordRead>({action:'blocks.records',ids:all.blocks.map(b=>b.id)})).records:[];
   return {notes:records.map(n=>({...n,html:render(n)})),matches:filtered.blocks.map(n=>n.id),facets:all.facets,groups:all.groups,hint:filtered.hint,completeness:filtered.completeness,allCompleteness:all.completeness,score:readScore(arrangement.text),scoreRevision:arrangement.revision,manifest,scratch:root};
 }
 const bundled=await Bun.build({entrypoints:[join(import.meta.dir,'app.ts')],target:'browser',minify:false});
 if(!bundled.success)throw new Error(bundled.logs.join('\n'));
 const js=await bundled.outputs[0]!.text();
 const page=readFileSync(join(import.meta.dir,'index.html'),'utf8');
 const css=readFileSync(join(import.meta.dir,'style.css'),'utf8');
 server=Bun.serve({hostname:'127.0.0.1',port:Number(process.env.COUNTERPOINT_PORT),async fetch(req){
   const url=new URL(req.url);
   // A local instrument, not a publisher. No wildcard CORS or arbitrary RPC proxy.
   if(!['127.0.0.1','localhost'].includes(url.hostname))return json({error:'Use localhost.'},403);
   if(req.method==='POST' && req.headers.get('origin')!==url.origin)return json({error:'Writes must come from this instrument’s own origin.'},403);
   try{
     if(req.method==='GET'){
       if(url.pathname==='/')return new Response(page,{headers:{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"}});
       if(url.pathname==='/app.js')return new Response(js,{headers:{'Content-Type':'text/javascript'}});
       if(url.pathname==='/style.css')return new Response(css,{headers:{'Content-Type':'text/css'}});
       if(url.pathname==='/api/state')return json(await state(url.searchParams.get('where')||'type=passage',url.searchParams.get('group')||'voice'));
       if(url.pathname==='/api/arrangement') {const b=await block(manifest.arrangement);return json({score:readScore(b.text),revision:b.revision});}
     }
     if(req.method==='POST'){
       const raw=await req.text();if(raw.length>1024*1024)return json({error:'Keep a rehearsal under 1 MB.'},413);
       const body=JSON.parse(raw);
       if(url.pathname==='/api/portable'){
         const score=validateScore(body.score),snapshot=await state('type=passage',score.group);
         const groupings=Object.fromEntries(await Promise.all((snapshot.facets??[]).map(async f=>[f.key,(await query('type=passage',f.key)).groups])));
         const payload={...snapshot,score,scratch:'portable snapshot',groupings};
         const encoded=JSON.stringify(payload).replace(/</g,'\\u003c');
         const html=page.replace('<link rel="stylesheet" href="/style.css">',`<style>${css}</style>`)
           .replace('<script type="module" src="/app.js"></script>',`<script id="cp-data" type="application/json">${encoded}</script><script type="module">${js.replace(/<\/script/gi,'<\\/script')}</script>`);
         return new Response(html,{headers:{'Content-Type':'text/html','Content-Disposition':'attachment; filename="counterpoint.html"'}});
       }
       if(url.pathname==='/api/score'){
         const score=validateScore(body.score);
         const allowed=new Set((await query('type=passage')).blocks.map(n=>n.id));
         if(score.cues.some(c=>!allowed.has(c.source)))throw new Error('A cue must name a passage in this rehearsal.');
         const saved=await client.request<Block>({action:'update',blockId:manifest.arrangement,text:scoreText(score),expectedRevision:body.revision,mutation:{author:'user'}});
         return json({revision:saved.revision});
       }
       if(url.pathname==='/api/source'){
         const allowed=new Set((await query('type=passage')).blocks.map(n=>n.id));
         if(!allowed.has(body.id)||typeof body.text!=='string'||body.text.length>64000)throw new Error('Edit one of this rehearsal’s passages, up to 64,000 characters.');
         return json(await client.request<Block>({action:'update',blockId:body.id,text:body.text,expectedRevision:body.revision,mutation:{author:'user'}}));
       }
       if(url.pathname==='/api/capture'){
         if(typeof body.text!=='string'||!body.text.trim()||body.text.length>2000||!Array.isArray(body.cues)||body.cues.length>160)throw new Error('A capture needs your observation and up to 160 cues.');
         const valid=validateScore({...body.score,cues:body.cues});
         const allowed=new Set((await query('type=passage')).blocks.map(n=>n.id));
         if(valid.cues.some(c=>!allowed.has(c.source)))throw new Error('A captured cue must belong to this rehearsal.');
         const quoted=valid.cues.map(c=>`## ${c.title}\n\n${c.body.split('\n').map(l=>'> '+l).join('\n')}\n\nSource: ((${c.source}|${c.title})), revision ${c.revision}, beat ${c.start+1}. Frozen excerpt; later edits do not rewrite this reading.`).join('\n\n');
         const saved=await client.request<Block>({action:'create',parentId:manifest.root,text:`Captured reading [type::counterpoint-reading]\n\n${body.text}\n\n${quoted}`,author:'user'});
         return json({id:saved.id,revision:saved.revision,text:saved.text});
       }
     }
     return json({error:'No such instrument route.'},404);
   }catch(error){return json({error:error instanceof Error?error.message:String(error)},409);}
 }});
 console.log(`\nCOUNTERPOINT · a reading instrument\nhttp://127.0.0.1:${server.port}\nPrivate outline: ${root}\nResume: bun run spike:counterpoint --resume ${root}\nCtrl+C stops the web instrument and its outline host.\n`);
}catch(error){await host.close();throw error;}
