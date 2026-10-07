import {afterEach,expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OutlinerStore} from '../src/store';
import {captureHistoryResource} from '../src/capture-history';
import {OutlinerServer} from '../src/server';
import {OutlinerClient} from '../src/client';
import {TUI_RESOURCE_PRESENTATION_CONTEXT} from '../src/resource-presentation';
import {authoredResourceReferenceOccurrences} from '../src/resource-references';
import {DocumentPreview} from '../src/document-preview';
import {documentPreviewLinks,documentPreviewLines} from '../src/document-preview-renderer';
import {initTheme} from '@earendil-works/pi-coding-agent';
import {preserveCapture,rewriteWithOriginal} from './preserved-captures';
const fixtures:Array<{root:string,store:OutlinerStore}>=[];
function fixture(){const root=mkdtempSync(join(tmpdir(),'capture-history-')),store=new OutlinerStore(join(root,'db.sqlite'),{workspaceRoot:root});const f={root,store};fixtures.push(f);return f;}
afterEach(()=>{for(const f of fixtures.splice(0)){f.store.close();rmSync(f.root,{recursive:true,force:true});}});
const refs=(b:{properties:Array<{key:string;value:string}>},key='raw-capture')=>b.properties.filter(p=>p.key===key).map(p=>p.value);
async function original(store:OutlinerStore,id:string){await store.resources.executeComputedResource(id,true);return store.resources.describe(id,true).computed?.markdown;}

test('a preserved capture resolves to its exact original bytes, after edits and a restart',async()=>{
 const f=fixture();
 const raw='Original ramble [tag::example]\n\n'+('Some long original wording 日本語\n'.repeat(400));
 const source=f.store.capture('capture',raw,'cli').block;
 preserveCapture(f.store,'first',[source]);
 const {block:cleaned,resourceId:id}=rewriteWithOriginal(f.store,source,'first','Clean note\n\nUseful content');
 expect(refs(cleaned)).toEqual([id]);
 expect(await original(f.store,id)).toBe(source.text);
 expect(captureHistoryResource(f.store.database,f.store.resources,'first',source.id)).toBe(id);
 f.store.close();f.store=new OutlinerStore(join(f.root,'db.sqlite'),{workspaceRoot:f.root});
 expect(await original(f.store,id)).toBe(source.text);
 expect(f.store.require(source.id).text).toStartWith('Clean note');
});

test('an applied attempt without a before-image never relabels current text as the original',async()=>{
 const {store}=fixture();
 const source=store.capture('capture','Actual old wording','cli').block;
 preserveCapture(store,'legacy',[source],'missing');
 const {resourceId:id}=rewriteWithOriginal(store,source,'legacy','Clean note');
 expect(await original(store,id)).toBeUndefined();
 expect(store.resources.describe(id,true).computedFailure?.message).toContain('No preserved capture');
});

test('missing evidence stays visibly unavailable; preserved Resource addresses cannot be retargeted',async()=>{
 const {store}=fixture();
 const id=captureHistoryResource(store.database,store.resources,'missing','unknown-block');
 await store.resources.executeComputedResource(id,true);
 expect(store.resources.describe(id,true).computedFailure?.message).toContain('No preserved capture');
 const resource=store.resources.get(id)!;expect(resource.provider).toBe('computed');
 if(resource.provider!=='computed')throw Error('Unexpected provider');
 expect(()=>store.resources.reviseComputedInvocation({invocationId:resource.address.invocationId,expectedVersion:1,inputs:{attemptId:'other',blockId:'other'},dependencies:[]})).toThrow('immutable');
});

test('registered Preview follows Original capture through the service, preserves metadata, and returns to clean text',async()=>{
 initTheme(undefined,false);
 const {root,store}=fixture(),server=new OutlinerServer(store,join(root,'rpc.sock'));
 const source=store.capture('capture','Raw wording [tag::original]\n\nUntidy body','cli').block;
 preserveCapture(store,'first',[source]);
 const linked=rewriteWithOriginal(store,source,'first','Clean note\n\nUseful content').block;
 const cleaned=rewriteWithOriginal(store,linked,'first',linked.text,'before-rewrite').block;
 const occurrences=authoredResourceReferenceOccurrences(cleaned.text);
 expect(occurrences.flatMap(o=>o.kind==='authored-resource'&&o.reference.kind==='resource'?[o.label]:[])).toEqual(['Original capture','Before this rewrite']);
 await server.start();const client=new OutlinerClient(join(root,'rpc.sock')),ready=Promise.withResolvers<void>();
 const watcher=client.watch({client:{clientId:'history-reader',role:'detail',contextId:'history',resourcePresentation:TUI_RESOURCE_PRESENTATION_CONTEXT},onConnect:ready.resolve,onEvent(){},onError:ready.reject});
 try {
  await ready.promise;const reader=new DocumentPreview(client,()=>{},'history-reader');
  await reader.load({kind:'block',blockId:source.id});
  const link=documentPreviewLinks(reader.state!.document,100).find(link=>link.label==='Original capture');
  expect(link).toBeDefined();
  await reader.action('preview.link:'+link!.uri,async()=>{});
  expect(reader.state?.document.canonicalText).toBe(source.text);
  expect(documentPreviewLines(reader.state!.document,100).join('\n')).toContain('tag::original');
  await reader.action('preview.back',async()=>{});
  expect(reader.state?.document.canonicalText).toBe(cleaned.text);
 }finally{watcher.stop();await server.close();}
});
