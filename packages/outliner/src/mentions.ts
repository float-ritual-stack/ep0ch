import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import { blockReferenceOccurrences } from '@ep0ch/outline-core/link-syntax';
import { pageAddressReferences } from '@ep0ch/outline-core/link-syntax';
import { offsetInRanges, protectedCodeRanges } from '@ep0ch/outline-core/code-ranges';
import {outlinerReferenceOccurrences} from './reference-occurrences';
import {marked} from 'marked';
import {parseOutlinerLinkUri} from './outliner-links';
import type {OutlinerStore} from './store';
import type {MentionCollection,MentionEntry,MentionMessage,MentionReceipt,MentionScope} from './mentions-types';

export const MENTION_MESSAGE_LIMIT=200;
const MAX_TEXT=65536,MAX_REFERENCES=100;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
interface Reference {bare?:boolean;kind:'block'|'address';value:string;start:number;end:number;}
/** `blockId` is null only in a message kept before unresolved references were dropped. */
interface StoredReference extends Reference {blockId:string|null;excerpt:string;}
interface StoredMessage extends MentionMessage {key:string;receivedAt:string;references:StoredReference[];notChecked:string[];}
function required(value:unknown,name:string,max=512):string{
 if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f]/.test(value))throw Error(`${name} must be nonempty text, at most ${max} characters`);
 return value;
}
export function extractMentionReferences(text:string,prefix?:string):Reference[]{
 const refs:Reference[]=[
  ...blockReferenceOccurrences(text).map(r=>({kind:'block' as const,value:r.blockId,start:r.start,end:r.end})),
  ...pageAddressReferences(text).map(r=>({kind:'address' as const,value:r.displayAddress,start:r.start,end:r.end})),
  ...outlinerReferenceOccurrences(text,prefix).filter(r=>r.kind==='work-id').map(r=>({kind:'address' as const,value:r.address,start:r.start,end:r.end})),
 ];
 marked.walkTokens(marked.lexer(text),token=>{
  if(token.type!=='link'||!token.href.startsWith('pi-outliner:'))return;
  try {
   const target=parseOutlinerLinkUri(token.href),start=text.indexOf(token.raw);
   if(target.kind==='block'||target.kind==='page'||target.kind==='work')refs.push({kind:target.kind==='block'?'block':'address',value:target.value,start,end:start+token.raw.length});
  } catch { /* Malformed destinations are not navigable references. */ }
 });
 // A bare id in code is the code's text, as a reference there is (PIE-764).
 const code=protectedCodeRanges(text);
 for(const match of text.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)){
  if(!refs.some(r=>match.index>=r.start&&match.index<r.end)&&!offsetInRanges(match.index,code))refs.push({bare:true,kind:'block',value:match[0].toLowerCase(),start:match.index,end:match.index+match[0].length});
 }
 const seen=new Set<string>();
 return refs.sort((a,b)=>a.start-b.start).filter(r=>{const key=`${r.kind}:${r.value.toLowerCase()}`;if(seen.has(key))return false;seen.add(key);return true;});
}
function excerpt(text:string,reference:Reference):string{
 const start=Math.max(text.lastIndexOf('\n',reference.start)+1,reference.start-100);
 const end=text.indexOf('\n',reference.end);
 return text.slice(start,Math.min(end<0?text.length:end,reference.end+160)).replace(/\s+/g,' ').trim();
}

/** Bounded disposable conversation history. Only explicit save/bookmark writes canonical notes. */
export class MentionRepository {
 constructor(private store:OutlinerStore,private workspaceRoot:string,private accepts?:(folder:string)=>boolean){}
 ingest(input:MentionMessage):MentionReceipt{
  if(!input||typeof input!=='object')throw Error('Mention message is required');
   // A host's outline also takes mentions from folders bound to it (a project folder that opens this outline).
  const folder=resolve(required(input.workspaceRoot,'workspaceRoot',4096));
  if(folder!==resolve(this.workspaceRoot)&&!this.accepts?.(folder))throw Error('Mention workspace does not match this Outliner service');
  required(input.agent,'agent',64);required(input.sessionId,'sessionId');required(input.messageId,'messageId');
  if(typeof input.text!=='string'||input.text.length>MAX_TEXT)throw Error(`Mention text must be at most ${MAX_TEXT} characters`);
  const key=hash(JSON.stringify([input.agent,input.sessionId,input.messageId]));
  const payloadHash=hash(input.text);
  return this.store.database.transaction(()=>{
   const existing=this.store.database.query('SELECT payload_hash,message_json FROM agent_mention_messages WHERE message_key=?').get(key) as {payload_hash:string;message_json:string}|null;
   if(existing){
    if(existing.payload_hash!==payloadHash)throw Error('Mention message identity already contains different text');
    const saved:StoredMessage=JSON.parse(existing.message_json);
    return{messageKey:key,deduplicated:true,references:saved.references.length,notChecked:saved.notChecked};
   }
   const candidates=extractMentionReferences(input.text,this.store.workIdAllocatorStatus().prefix??undefined)
    .filter(reference=>!reference.bare||!!this.store.get(reference.value));
   // Only what resolves in this outline is a mention: an identifier from another outline or a document
   // (S-87, a Work ID with another prefix, a page nobody made) is dropped here, never shown as gone. Every
   // candidate is checked (the text is bounded), so unresolved ones never use up the references kept.
   const resolved=candidates.flatMap(reference=>{
    const block=reference.kind==='block'?this.store.get(reference.value):this.store.resolvePageAddress(reference.value).block;
    return block&&!block.effectiveDeletedRootId?[{...reference,blockId:block.id,excerpt:excerpt(input.text,reference)}]:[];
   });
   const notChecked=resolved.length>MAX_REFERENCES?[`Only the first ${MAX_REFERENCES} distinct references were kept`]:[];
   const references=resolved.slice(0,MAX_REFERENCES);
   // An unreferenced answer never becomes an automatic saved note or retained message.
   if(references.length){
    const message:StoredMessage={...input,key,receivedAt:new Date().toISOString(),references,notChecked};
    this.store.database.query('INSERT INTO agent_mention_messages(message_key,payload_hash,message_json) VALUES (?,?,?)').run(key,payloadHash,JSON.stringify(message));
    this.store.database.query('DELETE FROM agent_mention_messages WHERE sequence NOT IN (SELECT sequence FROM agent_mention_messages ORDER BY sequence DESC LIMIT ?)').run(MENTION_MESSAGE_LIMIT);
   }
   return{messageKey:key,deduplicated:false,references:references.length,notChecked};
  })();
 }
 private scope(scope?:MentionScope):void{if(scope){required(scope.agent,'agent',64);required(scope.sessionId,'sessionId');}}
 private messages(scope?:MentionScope):StoredMessage[]{
  this.scope(scope);
  const rows=this.store.database.query('SELECT message_json FROM agent_mention_messages ORDER BY sequence DESC').all() as {message_json:string}[];
  return rows.map(r=>JSON.parse(r.message_json) as StoredMessage).filter(m=>!scope||(m.agent===scope.agent&&m.sessionId===scope.sessionId));
 }
 list(scope?:MentionScope,limit=100):MentionCollection{
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Mention limit must be 1–100');
  const messages=this.messages(scope),entries:MentionEntry[]=[],seen=new Set<string>();
  for(const message of messages)for(const reference of message.references){
   // Every kept reference resolved when it was ingested (one kept before that rule, unresolved, is skipped).
   if(!reference.blockId)continue;
   // A page or Work ID is read again (a page can move to another block); one that no longer resolves is dropped.
   // Only a block named by id that was deleted since stays, as gone.
   const found=reference.kind==='address'?this.store.resolvePageAddress(reference.value).block:this.store.get(reference.blockId);
   const active=found&&!found.effectiveDeletedRootId?found:null;
   if(!active&&reference.kind==='address')continue;
   const key=active?.id??reference.blockId;
   if(seen.has(key))continue;seen.add(key);
   entries.push({key,messageKey:message.key,address:reference.value,block:active,...!active?{unavailableReason:found?'Target is in Trash':'Target was deleted'}:{},agent:message.agent,sessionId:message.sessionId,messageId:message.messageId,mentionedAt:message.receivedAt,excerpt:reference.excerpt});
  }
  return{entries:entries.slice(0,limit),completeness:entries.length>limit?{kind:'truncated',limit}:{kind:'complete'},retention:{messages:messages.length,maximum:MENTION_MESSAGE_LIMIT},notChecked:[...new Set(messages.flatMap(m=>m.notChecked))]};
 }
 message(key:string):StoredMessage{
  required(key,'messageKey');
  const row=this.store.database.query('SELECT message_json FROM agent_mention_messages WHERE message_key=?').get(key) as {message_json:string}|null;
  if(!row)throw Error('Mention message expired or was cleared');return JSON.parse(row.message_json) as StoredMessage;
 }
 clear(scope?:MentionScope):{removed:number}{
  const messages=this.messages(scope);
  this.store.database.transaction(()=>{for(const message of messages)this.store.database.query('DELETE FROM agent_mention_messages WHERE message_key=?').run(message.key);})();
  return{removed:messages.length};
 }
 save(key:string){
  const message=this.message(key);
   const body=`${message.text}\n\nFrom ${message.agent}, session ${message.sessionId}, message ${message.messageId}, ${message.receivedAt}.`;
   const fence='`'.repeat(Math.max(3,...Array.from(body.matchAll(/`+/g),match=>match[0].length+1)));
   const content=`Conversation excerpt\n\n${fence}text\n${body}\n${fence}`;
  return this.store.capture(`mention-save:${key}`,content,'cli',undefined,'agent',{actorId:'mention-shelf',sessionId:message.sessionId});
 }
}
