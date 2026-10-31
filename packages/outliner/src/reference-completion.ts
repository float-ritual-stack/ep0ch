import {completionTargetAtCursor,type CompletionTarget} from "@ep0ch/outline-core/completion-triggers";
import {insertSelection,insertSlots,insertText,mergeSourceAnswers,pickId,pickKey,triggerOf,type SourceRow} from "@ep0ch/outline-core/completion-source";
import type {SnippetSlot} from "@ep0ch/outline-core/completion-snippet";
import type {CompletionRowsRequest,CompletionRowsResult} from "@ep0ch/outline-core/protocol";
import type {OutlinerRequester} from "./client-target";
import {resolveFragment} from './fragments';
import {blockDisplayTitle} from './references';
import {propertyInspectorAuthoredText} from './property-inspector';
import type {Block, PageAddressCollection, SelectionContext} from './types';
import type {TextBuffer} from './text-buffer';
import {QUERY_WORDS_PAUSE_MS,type QuerySuggestRequest,type QuerySuggestAnswer,type QueryWords} from '@ep0ch/outline-core/query-words';

// Detail's, Tree's and Quick Capture's completion (PIE-1340): the token at the cursor by outline-core's one detector,
// the rows from the service's completion sources and the extensions' (`completion.rows`), merged by outline-core's
// one matcher with the picks every client shares, so these show the rows the door shows for the same token. Each row
// keeps its kind, detail and docs; what Detail draws of them is its own.

/** A row as these editors hold it: the contract's row with its insert as the text it writes. */
export interface ReferenceCompletionItem extends Omit<SourceRow,"insert"> {
  insertion:string;
  selection?:{start:number;end:number};
  slots?:SnippetSlot[];
  /** The lit row's docs once read again from its note (ancestors and how it starts); `docs` until then. */
  context?:string;
  /** Kept for the list's subtitle: the row's detail. */
  subtitle?:string;
}
export interface ReferenceCompletionState {
  docsTop?:number;
  docsLines?:number;
  docsRect?:{column:number;row:number;width:number;height:number};
  queryWords?:boolean;
  moved?:boolean;
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
export function referenceEnterKeeps(state:ReferenceCompletionState):string|null {
  const item=state.items[state.index];
  return state.moved ? null : state.lone ? "new line" : item?.enter ?? null;
}
export interface ReferenceCompletionProvider {
  querySuggest?(input:QuerySuggestRequest):Promise<QuerySuggestAnswer>;
  /** The service's completion sources for the token (`completion.rows`). */
  completionRows(request:CompletionRowsRequest,signal?:AbortSignal):Promise<CompletionRowsResult>;
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
  return propertyInspectorAuthoredText(text).split(/\r?\n/).slice(1).join("\n");
}

export async function lookupReferenceCompletion(provider:ReferenceCompletionProvider,target:CompletionTarget,draft?:CompletionDraft,semantic=false,signal?:AbortSignal):Promise<ReferenceCompletionState> {
  const {start:_s,end:_e,...asked}=target;
  const r=await provider.completionRows({target:asked,limit:LIMIT,semantic,zone:Intl.DateTimeFormat().resolvedOptions().timeZone,...(draft?{near:draft.blockId,draft}:{})},signal);
  // What a row draws (its example, its variations) is the door's: Detail lists the row's words.
  const items:ReferenceCompletionItem[]=mergeSourceAnswers(r.answers,target.query,{picks:r.picks}).flatMap(row=>[row,...(row.querySuggestion?row.variations?.filter(v=>v.queryCorrections).map(v=>({...v,from:row.from,tier:row.tier}))??[]:[])]).map(({insert,from:_f,tier:_t,example:_e,variations:_v,...row})=>{
    const selection=insertSelection(insert);
    return {...row,insertion:insertText(insert),slots:insertSlots(insert),...(selection?{selection}:{}),...(row.detail?{subtitle:row.detail}:{}),...(row.docs?{context:row.docs}:{})};
  });
  const truncatedLimit=r.answers.find(a=>a.truncated)?.truncated??null;
  const partial=r.answers.map(a=>a.partial).find(Boolean)??'';
  const problems=r.answers.map(a=>a.problem).filter(Boolean).join(' · ');
  const empty=r.answers.map(a=>a.empty).filter(Boolean).join(' · ')||'No matches';
  // What the list is: a source's own words for it (`in Greenhouse meeting`), else the title of the source that answered first.
  const heading=r.answers.map(a=>a.heading).find(Boolean)??r.answers.find(a=>a.rows.length)?.source.title??'completions';
  const message=items.length?[partial||(truncatedLimit?`Showing first ${truncatedLimit} matches`:''),problems].filter(Boolean).join(' · '):[partial&&`Partial search: ${partial}`,empty,problems].filter(Boolean).join(' · ');
  return {start:target.start,end:target.end,index:0,items,queryWords:r.answers.some(a=>a.queryWords),truncatedLimit,incompleteness:partial,message,heading,query:target.query,...(triggerOf(target.kind)?{pickKey:pickKey({trigger:triggerOf(target.kind),kind:target.kind,key:target.key})}:{})};
}

/** Whether a token with nothing to offer still shows its words: a reference does; a property or a component doesn't open. */
const SAYS_EMPTY=new Set(['page','block','file']);

/** One editor-local lookup lane. No canonical text or anchor writes until acceptance. */
export class ReferenceCompletionSession {
  state:ReferenceCompletionState|null=null;
  private generation=0;
  private lookup?:AbortController;
  private accepting=false;
  private wordsTimer?:ReturnType<typeof setTimeout>;
  private offered?:QueryWords;
  private accepted?:{suggestion:QueryWords;text:string};
  private unavailableSaid=false;
  private selectedInsertion?:string;
  private snapshot?:{text:string;row:number;column:number;buffer:TextBuffer};
  constructor(private provider:ReferenceCompletionProvider,private buffer:()=>TextBuffer,private changed:()=>void,private active:()=>boolean,private draft:()=>CompletionDraft|undefined=()=>undefined){}
  dismiss():void {this.lookup?.abort();clearTimeout(this.wordsTimer);if(!this.accepting)this.ignore();this.offered=undefined;this.generation++;this.state=null;this.snapshot=undefined;this.changed();}
  private ignore():void {const suggestion=this.offered;this.offered=undefined;if(suggestion)void this.provider.querySuggest?.({text:suggestion.input,outcome:'ignored',suggestion}).catch(()=>{});}
  private show(state:ReferenceCompletionState):void {
    const suggestion=state.items.find(i=>i.querySuggestion)?.querySuggestion;
    if(!this.accepting&&this.offered&&(this.offered.input!==suggestion?.input||this.offered.where!==suggestion?.where))this.ignore();
    this.offered=suggestion;this.state=state;this.changed();
  }
  private current(generation:number):boolean {
    const b=this.buffer(),s=this.snapshot;
    return this.active()&&generation===this.generation&&!!s&&s.buffer===b&&s.text===b.text&&s.row===b.row&&s.column===b.column;
  }
  async refresh():Promise<void>{
    if(this.accepting)return;
    clearTimeout(this.wordsTimer);
    this.lookup?.abort();
    const lookup=this.lookup=new AbortController();
    const b=this.buffer(),target=completionTargetAtCursor(b.lines[b.row]??'',b.column,b.lines,b.row);
    if(!this.active()||!target){this.dismiss();return;}
    const generation=++this.generation,selected=this.state?.items[this.state.index]?.insertion??this.selectedInsertion;
    if(this.accepted&&this.accepted.text!==b.text){const {suggestion}=this.accepted;this.accepted=undefined;void this.provider.querySuggest?.({text:suggestion.input,outcome:'edited',suggestion,acceptedWhere:target.query}).catch(()=>{});}
    this.snapshot={text:b.text,row:b.row,column:b.column,buffer:b};
    this.state={start:target.start,end:target.end,index:0,items:[],generation,loading:true,message:'Finding references…'};this.changed();
    try{
      const result=await lookupReferenceCompletion(this.provider,target,this.draft(),false,lookup.signal);
      if(!this.current(generation))return;
      if(!result.items.length&&!result.queryWords&&!SAYS_EMPTY.has(target.kind)){this.dismiss();return;}
      result.index=Math.max(0,result.items.findIndex(item=>item.insertion===selected));
      // A new page alone on the list is chosen on purpose (↓, a click, tab): ⏎ stays the editor's until then.
      if(result.items.length===1&&result.items[0]!.newPage)result.lone=true;
      this.selectedInsertion=result.items[result.index]?.insertion;
      result.generation=generation;this.show(result);void this.enrich(generation);
      if(result.queryWords)this.wordsTimer=setTimeout(async()=>{
        const words=await lookupReferenceCompletion(this.provider,target,this.draft(),true,lookup.signal);
        if(!this.current(generation)||this.accepting)return;
        const selected=this.state?.items[this.state.index]?.insertion;
        const index=this.state?.moved?words.items.findIndex(item=>item.insertion===selected):0;
        if(index<0)return;
        if(words.message&&!words.items.length){if(this.unavailableSaid)words.message='';else this.unavailableSaid=true;}
        this.selectedInsertion=words.items[index]?.insertion;
        this.show({...words,index,generation,moved:this.state?.moved});
      },QUERY_WORDS_PAUSE_MS);
    }catch(error){if(this.current(generation))this.show({start:target.start,end:target.end,index:0,items:[],message:`Lookup failed: ${error instanceof Error?error.message:String(error)}`});}
  }
  private async enrich(generation=this.generation):Promise<void>{
    const item=this.state?.items[this.state.index];if(!item?.blockId)return;
    try{
      const context=await this.provider.readContext(item.blockId);
      if(!this.current(generation)||this.state?.items[this.state.index]!==item)return;
      item.context=context.selected?[...context.ancestors.map(blockDisplayTitle),snippet(context.selected.text)].filter(Boolean).join('\n\n'):'Target unavailable';this.changed();
    }catch(error){if(this.current(generation)&&this.state?.items[this.state.index]===item){item.context=`Context unavailable: ${error instanceof Error?error.message:String(error)}`;this.changed();}}
  }
  /** Whether ⏎ inserts the lit row: there is one, and it isn't a lone new page nobody chose on purpose (↓ first, PIE-592). */
  get chooses():boolean{return !!this.state?.items.length&&!referenceEnterKeeps(this.state);}
  move(delta:number):void{if(!this.state)return;this.state.lone=false;this.state.moved=true;this.state.docsTop=0;this.state.index=Math.max(0,Math.min(this.state.items.length-1,this.state.index+delta));this.selectedInsertion=this.state.items[this.state.index]?.insertion;this.changed();void this.enrich();}
  scrollDocs(by:number):void {
    const s=this.state;if(!s)return;
    s.docsTop=Math.max(0,Math.min(Math.max(0,(s.docsLines??0)-(s.docsRect?.height??1)),(s.docsTop??0)+by));this.changed();
  }
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
      const offset=b.lines.slice(0,b.row).join('\n').length+Number(b.row>0)+state.start;
      b.editTogether(()=>{
      if(item.anchor&&item.blockId===this.draft()?.blockId){
        b.replaceLine(item.anchor.lineIndex,item.anchor.line);
      }
      b.replaceCurrentLine(state.start,state.end,item.insertion);
      });
      if(item.slots?.length)b.startSnippet(item.slots,offset);
      if(state.pickKey)void this.provider.completionPicked?.(state.pickKey,pickId(item.insertion)).catch(()=>{});
      if(item.querySuggestion){this.accepted={suggestion:item.querySuggestion,text:b.text};await this.provider.querySuggest?.({text:item.querySuggestion.input,outcome:item.queryOutcome??'accepted',suggestion:item.querySuggestion,corrections:item.queryCorrections}).catch(error=>{state.message=String(error);});}
      this.dismiss();return true;
    }catch(error){if(this.current(generation)){state.message=error instanceof Error?error.message:String(error);this.changed();}return false;}finally{this.accepting=false;if(!this.state&&item.kind==="property")void this.refresh();}
  }
}

export function referenceCompletionProvider(client:OutlinerRequester,actorId:string):ReferenceCompletionProvider {
  return {
    querySuggest:input=>client.request({action:'query.suggest',...input,mutation:{author:'user'}}),
    completionRows:(request,signal)=>requestCompletionRows(client,request,signal),
    completionPicked:(key,insert)=>client.request({action:"completion.picked",key,insert}),
    ensureFragment:input=>client.request({action:"fragments.ensure",...input,mutation:{author:"user",actorId}}),
    queryPageAddresses:(query,limit)=>client.request({action:"pages.complete",query,limit}),
    readContext:blockId=>client.request({action:"blocks.context",blockId}),
    updateBlock:input=>client.request({action:"update",...input,mutation:{author:"user",actorId}}),
    followPage:address=>client.request({action:"pages.follow",address,author:"user"}),
  };
}

/** Dismissing a list stops its source processes as well as dropping their eventual answer. */
export async function requestCompletionRows(client:OutlinerRequester,request:CompletionRowsRequest,signal?:AbortSignal):Promise<CompletionRowsResult> {
  signal?.throwIfAborted();
  const turn=crypto.randomUUID();
  const cancel=()=>{void client.request({action:"completion.cancel",turn}).catch(()=>{});};
  signal?.addEventListener("abort",cancel,{once:true});
  try {return await client.request({action:"completion.rows",...request,turn});}
  finally {signal?.removeEventListener("abort",cancel);}
}
