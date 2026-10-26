import {expect,test} from 'bun:test';
import {ReferenceCompletionSession,type ReferenceCompletionProvider} from '../src/reference-completion';
import {renderReferenceCompletion} from '../src/reference-completion-renderer';
import {TextBuffer} from '../src/text-buffer';
import {pageAddressCompletion} from '@ep0ch/outline-core/completion-triggers';
import type {SourceRow} from '@ep0ch/outline-core/completion-source';
import type {CompletionRowsRequest,CompletionRowsResult} from '@ep0ch/outline-core/protocol';
import type {Block,PageAddressCollection} from '../src/types';
const block=(id:string,text=id):Block=>({id,text,revision:1,parentId:null,position:0,author:'user',createdAt:'2026-09-23T00:00:00Z',updatedAt:'2026-09-23T00:00:00Z',properties:[]});
const pages=(address:string):PageAddressCollection=>({addresses:[{address,normalizedAddress:address,blockId:address,kind:'page',title:address}],completeness:{kind:'complete'}});
/** What the service's sources answer, faked per trigger: `[[` from the page addresses, `[file::` and `((` from rows. */
type Fake=ReferenceCompletionProvider&{files:(q:string)=>Promise<SourceRow[]>;blocks:(q:string)=>Promise<SourceRow[]>;empty?:string};
function setup(text:string){
 const buffer=new TextBuffer(text);buffer.moveEnd();let active=true;
 const provider:Fake={
  files:async()=>[],blocks:async()=>[],
  async completionRows(r:CompletionRowsRequest):Promise<CompletionRowsResult>{
   const t=r.target;
   const rows=t.kind==='page'?(await provider.queryPageAddresses(t.query||undefined,20)).addresses.map(a=>({label:a.title,insert:`[[${a.address}]]`,blockId:a.blockId,address:a.address,kind:a.kind}))
    :t.kind==='file'?await provider.files(t.query):await provider.blocks(t.query);
   return {answers:[{source:{id:t.kind,title:t.kind,ranked:true,by:'service'},rows,empty:t.kind==='block'?'no matching blocks':'no matches'}],picks:{}};
  },
  queryPageAddresses:async q=>pages(q||'home'),readContext:async id=>({selected:block(id,'Shared title\nImportant context'),ancestors:[block('parent','Project Alpha')],children:[]}),updateBlock:async input=>block(input.blockId,input.text)};
 const session=new ReferenceCompletionSession(provider,()=>buffer,()=>{},()=>active);
 return {buffer,provider,session,deactivate:()=>{active=false;}};
}
test('latest typed query wins, Escape prevents a late list from reopening',async()=>{
 const h=setup('[[a'),first=Promise.withResolvers<PageAddressCollection>();
 h.provider.queryPageAddresses=q=>q==='a'?first.promise:Promise.resolve(pages(q!));
 const pending=h.session.refresh();h.buffer.insert('b');await h.session.refresh();
 first.resolve(pages('a'));await pending;expect(h.session.state?.items[0]?.insertion).toBe('[[ab]]');
 const delayed=Promise.withResolvers<PageAddressCollection>();h.provider.queryPageAddresses=()=>delayed.promise;
 const next=h.session.refresh();h.session.dismiss();delayed.resolve(pages('stale'));await next;expect(h.session.state).toBeNull();
});
test('accept replaces a whole existing token, retains suffix and is one undo step',async()=>{
 const h=setup('Before [[ho]] after');h.buffer.placeCursor(0,11);h.provider.queryPageAddresses=async()=>pages('home');
 await h.session.refresh();expect(await h.session.accept()).toBe(true);expect(h.buffer.text).toBe('Before [[home]] after');
 expect(h.buffer.undo()).toBe(true);expect(h.buffer.text).toBe('Before [[ho]] after');
});
test('file acceptance preserves unrelated references after the cursor',async()=>{
 const h=setup('See [file::sr and ((blk)) [[page]]');h.buffer.placeCursor(0,'See [file::sr'.length);
 h.provider.files=async()=>[{label:'src/main.ts',kind:'file',insert:'[file::src/main.ts]'}];
 await h.session.refresh();expect(await h.session.accept()).toBe(true);
 expect(h.buffer.text).toBe('See [file::src/main.ts] and ((blk)) [[page]]');
});
test('page and block acceptance stop before intervening reference delimiters',async()=>{
 for(const [prefix,suffix,insertion] of [
  ['[[ho',' see ((x)) text ]]','[[home]]'],
  ['((ho',' see [[x]] text ))','((home))'],
 ] as const){
  const h=setup(prefix+suffix);h.buffer.placeCursor(0,prefix.length);
  h.provider.queryPageAddresses=async()=>pages('home');
  h.provider.blocks=async()=>[{label:'Home',kind:'block',blockId:'home',insert:'((home))'}];
  await h.session.refresh();expect(await h.session.accept()).toBe(true);expect(h.buffer.text).toBe(insertion+suffix);
 }
});
test('whole-token replacement still includes an existing page label',async()=>{
 const h=setup('Before [[ho|my label]] after');h.buffer.placeCursor(0,'Before [[ho'.length);
 h.provider.queryPageAddresses=async()=>pages('home');
 await h.session.refresh();expect(await h.session.accept()).toBe(true);expect(h.buffer.text).toBe('Before [[home]] after');
});
test('deleted or reassigned targets cannot insert an obsolete suggestion',async()=>{
 const h=setup('[[home');await h.session.refresh();h.provider.readContext=async()=>({selected:null,ancestors:[],children:[]});
 expect(await h.session.accept()).toBe(false);expect(h.buffer.text).toBe('[[home');expect(h.session.state?.message).toContain('no longer available');
 h.provider.queryPageAddresses=async()=>pages('replacement');expect(await h.session.accept()).toBe(false);expect(h.session.state?.message).toContain('Address changed');
});
test('typing can continue during acceptance without replacing its new text',async()=>{
 const h=setup('[[home');await h.session.refresh();const pending=Promise.withResolvers<PageAddressCollection>();h.provider.queryPageAddresses=()=>pending.promise;
 const accepted=h.session.accept();h.buffer.insert(' suffix');pending.resolve(pages('home'));
 expect(await accepted).toBe(false);expect(h.buffer.text).toBe('[[home suffix');
});
test('selection remains stable when a late query changes candidate order',async()=>{
 const h=setup('[[h');const result=pages('home');result.addresses.push({...pages('help').addresses[0]!});h.provider.queryPageAddresses=async()=>result;
 await h.session.refresh();h.session.move(1);h.buffer.insert('e');h.provider.queryPageAddresses=async()=>({...result,addresses:[...result.addresses].reverse()});await h.session.refresh();expect(h.session.state?.items[h.session.state.index]?.insertion).toBe('[[help]]');
});
test('page labels never contain nested block or page syntax',()=>{
 const address={...pages('PIE-139').addresses[0]!,kind:'work-id' as const,title:'PIE-139 — about ((source-block))'};
 expect(pageAddressCompletion(address,'PIE-139','PIE').insertion).toBe('[[PIE-139]]');
});
test('bounded/empty/failed lookups stay visible and no result creates a target',async()=>{
 const h=setup('((none');let writes=0;h.provider.updateBlock=async input=>{writes++;return block(input.blockId);};
 await h.session.refresh();expect(h.session.state?.message).toBe('no matching blocks');expect(await h.session.accept()).toBe(false);
 h.provider.blocks=async()=>{throw Error('offline');};await h.session.refresh();expect(h.session.state?.message).toContain('offline');expect(writes).toBe(0);
});

test('existing fragment identity is rechecked against fresh text before insertion',async()=>{
 for(const changed of ['Target\n\n## Renamed ^other','Target\n\n## First ^keep\n\n## Second ^keep']){
  const h=setup('((Target^keep');
  h.provider.blocks=async()=>[{label:'^keep  # Heading',kind:'anchor',blockId:'target',fragmentId:'keep',insert:'((target^keep))'}];
  await h.session.refresh();expect(h.session.state?.items[0]?.fragmentId).toBe('keep');
  h.provider.readContext=async()=>({selected:block('target',changed),ancestors:[],children:[]});
  expect(await h.session.accept()).toBe(false);expect(h.buffer.text).toBe('((Target^keep');expect(h.session.state?.message).toContain('Fragment changed');
 }
});
test('shared list accepts effective host bindings rather than advertising stale defaults',()=>{
 const output=renderReferenceCompletion({start:0,end:4,index:0,items:[{label:'Home',insertion:'[[home]]'}]},100,8,'completion.choose','Alt+J next · Alt+I insert');
 expect(output.at(-1)).toBe('Alt+J next · Alt+I insert');
});

test('file completion never consumes a following different reference',async()=>{
 const h=setup('See [file::READ and [[home]] after');h.buffer.placeCursor(0,15);
 h.provider.files=async()=>[{label:'README.md',kind:'file',insert:'[file::README.md]'}];
 await h.session.refresh();expect(await h.session.accept()).toBe(true);expect(h.buffer.text).toBe('See [file::README.md] and [[home]] after');
});
