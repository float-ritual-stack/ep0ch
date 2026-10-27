import {completionTargetAtCursor,type CompletionTarget} from "@ep0ch/outline-core/completion-triggers";
import {insertSelection,insertText,mergeSourceAnswers,pickKey,triggerOf,type SourceRow} from "@ep0ch/outline-core/completion-source";
import type {CompletionRowsRequest,CompletionRowsResult} from "@ep0ch/outline-core/protocol";
import type {OutlinerRequester} from "./client-target";
import {resolveFragment} from './fragments';
import {blockDisplayTitle} from './references';
import {propertyInspectorAuthoredText} from './property-inspector';
import type {Block, PageAddressCollection, SelectionContext} from './types';
import type {TextBuffer} from './text-buffer';

// Detail's, Tree's and Quick Capture's completion (PIE-1340): the token at the cursor by outline-core's one detector,
// the rows from the service's completion sources and the extensions' (`completion.rows`), merged by outline-core's
// one matcher with the picks every client shares, so these show the rows the door shows for the same token. Each row
// keeps its kind, detail and docs; what Detail draws of them is its own.

/** A row as these editors hold it: the contract's row with its insert as the text it writes. */
export interface ReferenceCompletionItem extends Omit<SourceRow,"insert"> {
  insertion:string;
  selection?:{start:number;end:number};
  /** The lit row's docs once read again from its note (ancestors and how it starts); `docs` until then. */
  context?:string;
  /** Kept for the list's subtitle: the row's detail. */
  subtitle?:string;
}
export interface ReferenceCompletionState {
  start:number;end:number;index:number;items:ReferenceCompletionItem[];
  truncatedLimit?:number|null;
  incompleteness?:string;
  message?:string;
  loading?:boolean;
  generation?:number;
  /** What the list is: `references`, `agents`, `in Greenhouse meeting`. */
  heading?:string;
  /** The key a pick is counted under (`completion.picked`). */
  pickKey?:string;
  /** What was typed: the letters the list lights. */
  query?:string;
  /** Its one row is a new page nobody has chosen yet: ⏎ is the editor's (a new line), ↓ or a click chooses it. */
  lone?:boolean;
}
export interface ReferenceCompletionProvider {
  /** The service's completion sources for the token (`completion.rows`). */
  completionRows(request:CompletionRowsRequest):Promise<CompletionRowsResult>;
  /** Count a pick, so every client ranks it higher next time (`completion.picked`). */
  completionPicked?(key:string,insert:string):Promise<unknown>;
  queryPageAddresses(query:string|undefined,limit:number):Promise<PageAddressCollection>;
  readContext(blockId:string):Promise<SelectionContext>;
  updateBlock(input:{blockId:string;text:string;expectedRevision:number}):Promise<Block>;
  /** The service writes a heading's anchor, revision-checked. */
  ensureFragment?(input:{blockId:string;lineIndex:number;expectedRevision:number}):Promise<{fragmentId:string;created:boolean}>;
  /** Make a page nobody has written yet (`pages.follow`), before it's linked. */
  followPage?(address:string):Promise<{created:boolean;status:string;block?:Block}>;
}
export interface CompletionDraft {blockId:string;text:string}
const LIMIT=20;
function snippet(text:string):string {
  return propertyInspectorAuthoredText(text).split(/\r?\n/).slice(1).join(' ').replace(/\s+/g,' ').trim().slice(0,240);
}

export async function lookupReferenceCompletion(provider:ReferenceCompletionProvider,target:CompletionTarget,draft?:CompletionDraft):Promise<ReferenceCompletionState> {
  const r=await provider.completionRows({target:{kind:target.kind,query:target.query,...(target.key?{key:target.key}:{}),...(target.component?{component:target.component}:{}),...(target.headingShort?{headingShort:true}:{})},limit:LIMIT,...(draft?{near:draft.blockId,draft}:{})});
  // What a row draws (its example, its variations) is the door's: Detail lists the row's words.
  const items:ReferenceCompletionItem[]=mergeSourceAnswers(r.answers,target.query,{picks:r.picks}).map(({insert,from:_f,tier:_t,example:_e,variations:_v,...row})=>{
    const selection=insertSelection(insert);
    return {...row,insertion:insertText(insert),...(selection?{selection}:{}),...(row.detail?{subtitle:row.detail}:{}),...(row.docs?{context:row.docs}:{})};
  });
  const truncatedLimit=r.answers.find(a=>a.truncated)?.truncated??null;
  const partial=r.answers.map(a=>a.partial).find(Boolean)??'';
  const problems=r.answers.map(a=>a.problem).filter(Boolean).join(' · ');
  const empty=r.answers.map(a=>a.empty).filter(Boolean).join(' · ')||'No matches';
  // What the list is: a source's own words for it (`in Greenhouse meeting`), else the title of the source that answered first.
  const heading=r.answers.map(a=>a.heading).find(Boolean)??r.answers.find(a=>a.rows.length)?.source.title??'completions';
  const message=items.length?[partial||(truncatedLimit?`Showing first ${truncatedLimit} matches`:''),problems].filter(Boolean).join(' · '):[partial&&`Partial search: ${partial}`,empty,problems].filter(Boolean).join(' · ');
  return {start:target.start,end:target.end,index:0,items,truncatedLimit,incompleteness:partial,message,heading,query:target.query,...(triggerOf(target.kind)?{pickKey:pickKey({trigger:triggerOf(target.kind),kind:target.kind,key:target.key})}:{})};
}

/** Whether a token with nothing to offer still shows its words: a reference does; a property or a component doesn't open. */
const SAYS_EMPTY=new Set(['page','block','file']);

/** One editor-local lookup lane. No canonical text or anchor writes until acceptance. */
export class ReferenceCompletionSession {
  state:ReferenceCompletionState|null=null;
  private generation=0;
  private accepting=false;
  private selectedInsertion?:string;
  private snapshot?:{text:string;row:number;column:number;buffer:TextBuffer};
  constructor(private provider:ReferenceCompletionProvider,private buffer:()=>TextBuffer,private changed:()=>void,private active:()=>boolean,private draft:()=>CompletionDraft|undefined=()=>undefined){}
  dismiss():void {this.generation++;this.state=null;this.snapshot=undefined;this.changed();}
  private current(generation:number):boolean {
    const b=this.buffer(),s=this.snapshot;
    return this.active()&&generation===this.generation&&!!s&&s.buffer===b&&s.text===b.text&&s.row===b.row&&s.column===b.column;
  }
  async refresh():Promise<void>{
    const b=this.buffer(),target=completionTargetAtCursor(b.lines[b.row]??'',b.column,b.lines,b.row);
    if(!this.active()||!target){this.dismiss();return;}
    const generation=++this.generation,selected=this.state?.items[this.state.index]?.insertion??this.selectedInsertion;
    this.snapshot={text:b.text,row:b.row,column:b.column,buffer:b};
    this.state={start:target.start,end:target.end,index:0,items:[],generation,loading:true,message:'Finding references…'};this.changed();
    try{
      const result=await lookupReferenceCompletion(this.provider,target,this.draft());
      if(!this.current(generation))return;
      if(!result.items.length&&!SAYS_EMPTY.has(target.kind)){this.dismiss();return;}
      result.index=Math.max(0,result.items.findIndex(item=>item.insertion===selected));
      // A new page alone on the list is chosen on purpose (↓, a click, tab): ⏎ stays the editor's until then.
      if(result.items.length===1&&result.items[0]!.newPage)result.lone=true;
      this.selectedInsertion=result.items[result.index]?.insertion;
      result.generation=generation;this.state=result;this.changed();void this.enrich(generation);
    }catch(error){if(this.current(generation)){this.state={start:target.start,end:target.end,index:0,items:[],message:`Lookup failed: ${error instanceof Error?error.message:String(error)}`};this.changed();}}
  }
  private async enrich(generation=this.generation):Promise<void>{
    const item=this.state?.items[this.state.index];if(!item?.blockId)return;
    try{
      const context=await this.provider.readContext(item.blockId);
      if(!this.current(generation)||this.state?.items[this.state.index]!==item)return;
      item.context=context.selected?[...context.ancestors.map(blockDisplayTitle),snippet(context.selected.text)].filter(Boolean).join(' › '):'Target unavailable';this.changed();
    }catch(error){if(this.current(generation)&&this.state?.items[this.state.index]===item){item.context=`Context unavailable: ${error instanceof Error?error.message:String(error)}`;this.changed();}}
  }
  /** Whether ⏎ inserts the lit row: there is one, and it isn't a lone new page nobody chose on purpose (↓ first, PIE-592). */
  get chooses():boolean{return !!this.state?.items.length&&!this.state.lone;}
  move(delta:number):void{if(!this.state)return;this.state.lone=false;this.state.index=Math.max(0,Math.min(this.state.items.length-1,this.state.index+delta));this.selectedInsertion=this.state.items[this.state.index]?.insertion;this.changed();void this.enrich();}
  async accept(index=this.state?.index??0,renderedGeneration?:number):Promise<boolean>{
    const state=this.state,item=state?.items[index],generation=this.generation;
    if(this.accepting||!state||!item||(renderedGeneration!==undefined&&renderedGeneration!==generation)||!this.current(generation))return false;
    this.accepting=true;
    try{
      if(item.blockId){
        if(item.address){
          const addresses=await this.provider.queryPageAddresses(item.address,LIMIT);
          if(!this.current(generation))return false;
          if(!addresses.addresses.some(address=>address.address===item.address&&address.blockId===item.blockId))throw Error("Address changed; search again");
        }
        const context=await this.provider.readContext(item.blockId);
        if(!this.current(generation))return false;
        if(!context.selected||context.selected.id!==item.blockId||context.selected.deletedAt||context.selected.effectiveDeletedRootId)throw Error('Target is no longer available; search again');
        if(item.fragmentId&&!item.anchor){
          const draft=this.draft();
          const source=draft?.blockId===item.blockId?draft.text:context.selected.text;
          if(resolveFragment(source,item.fragmentId).status!=='resolved')throw Error('Fragment changed or is ambiguous; search again');
        }
        if(item.anchor&&item.blockId!==this.draft()?.blockId){
          if(!this.provider.ensureFragment)throw Error('This service cannot add the anchor; search again');
          // The service writes the anchor, revision-checked; a different id than offered means the note moved on.
          const written=await this.provider.ensureFragment({blockId:item.blockId,lineIndex:item.anchor.lineIndex,expectedRevision:item.anchor.revision});
          if(written.fragmentId!==item.fragmentId)throw Error('Fragment changed; search again');
          if(!this.current(generation))return false;
        }
      }
      // A new page (PIE-592): made before it's linked, so the link never names nothing.
      if(item.newPage){
        if(!this.provider.followPage)throw Error('This editor cannot make a page; write it as [[name]] and follow it');
        const made=await this.provider.followPage(item.newPage);
        if(!this.current(generation))return false;
        if(!made.block)throw Error(made.status==='deleted'?`[[${item.newPage}]] is a page in the trash: restore it there`:`The page wasn't made (${made.status})`);
      }
      const b=this.buffer();
      b.editTogether(()=>{
      if(item.anchor&&item.blockId===this.draft()?.blockId){
        b.replaceLine(item.anchor.lineIndex,item.anchor.line);
      }
      b.replaceCurrentLine(state.start,state.end,item.insertion);
      });
      // A snippet's span is selected once it's in (its placeholder), so the next keys replace it.
      // The insert may be several lines (a component's YAML): its offsets are placed by row.
      if(item.selection){
        const first=b.row-(item.insertion.match(/\n/g)?.length??0),at=Math.min(state.start,(b.lines[first]??'').length);
        const place=(offset:number,extend:boolean)=>{const before=item.insertion.slice(0,offset).split('\n');b.placeCursor(first+before.length-1,(before.length===1?at:0)+before.at(-1)!.length,extend);};
        place(item.selection.start,false);place(item.selection.end,true);
      }
      if(state.pickKey)void this.provider.completionPicked?.(state.pickKey,item.insertion).catch(()=>{});
      this.dismiss();return true;
    }catch(error){if(this.current(generation)){state.message=error instanceof Error?error.message:String(error);this.changed();}return false;}finally{this.accepting=false;}
  }
}

export function referenceCompletionProvider(client:OutlinerRequester,actorId:string):ReferenceCompletionProvider {
  return {
    completionRows:request=>client.request({action:"completion.rows",...request}),
    completionPicked:(key,insert)=>client.request({action:"completion.picked",key,insert}),
    ensureFragment:input=>client.request({action:"fragments.ensure",...input,mutation:{author:"user",actorId}}),
    queryPageAddresses:(query,limit)=>client.request({action:"pages.complete",query,limit}),
    readContext:blockId=>client.request({action:"blocks.context",blockId}),
    updateBlock:input=>client.request({action:"update",...input,mutation:{author:"user",actorId}}),
    followPage:address=>client.request({action:"pages.follow",address,author:"user"}),
  };
}
