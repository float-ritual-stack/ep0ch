import {hyperlink,truncateToWidth,visibleWidth,wrapTextWithAnsi} from '@earendil-works/pi-tui';
import {searchMatchSpans} from '@ep0ch/outline-core/search-match';
import {completionWindow} from './completion';
import {sanitizeDynamicText,renderMarkdownLine} from './terminal';
import {DEFAULT_OUTLINER_ACTION_KEYMAP as keymap,displayActionChord} from './outliner-actions';
import {referenceEnterKeeps,type ReferenceCompletionState} from './reference-completion';

export const COMPLETION_ROWS=26;
const popupHelp=['accept','dismiss','previous','next','docs.down'].map(name=>{
  const id=`detail.completion.${name}`;
  return `${keymap.bindings(id).map(displayActionChord).join('/')} ${keymap.action(id).label}`;
}).join(' · ');
function lit(label:string,query:string|undefined):string{
  if(!query)return label;
  const on=new Set(searchMatchSpans(label,query));
  return [...label].map((c,i)=>on.has(i)?`\x1b[1m${c}\x1b[22m`:c).join('');
}

/** Detail's drawing of the shared rows; the list and docs keep separate scroll positions. */
export function renderReferenceCompletion(state:ReferenceCompletionState,width:number,height=COMPLETION_ROWS,action='completion.choose',help=popupHelp):string[]{
  const fit=(text:string,w=width)=>truncateToWidth(sanitizeDynamicText(text),Math.max(1,w),'…');
  const pad=(text:string,w:number)=>text+' '.repeat(Math.max(0,w-visibleWidth(text)));
  state.docsRect=undefined;
  if(height<=0)return [];
  if(!state.items.length)return [fit(state.message??'No matches')];
  const listWidth=Math.min(width,60),beside=width-listWidth-3>=30;
  const bodyHeight=Math.max(1,height-2),hasDocs=height>=6;
  const listHeight=hasDocs&&!beside?Math.max(2,Math.floor((bodyHeight-1)/2)):bodyHeight;
  // Two lines per choice reserve its signature even when a neighbouring label is long.
  let capacity=Math.min(10,Math.max(1,Math.floor(listHeight/2)));
  let window=completionWindow(state.items.length,state.index,capacity);
  const headings=()=>state.items.slice(window.start,window.end).filter((item,i)=>item.group&&(!i||item.group!==state.items[window.start+i-1]?.group)).length;
  while(capacity>1&&capacity*2+headings()>listHeight){capacity--;window=completionWindow(state.items.length,state.index,capacity);}
  const heading=(state.heading??'References').replace(/^./,c=>c.toUpperCase());
  const rows=height>=3?[fit(`${heading} ${state.index+1}/${state.items.length}${state.query?` · ${state.query}▌`:''}${state.incompleteness?' · Partial search':state.truncatedLimit?` · Showing first ${state.truncatedLimit} matches`:''}`)]:[];
  const list:string[]=[];
  for(let index=window.start;index<window.end;index++){
    const item=state.items[index]!,w=beside?listWidth:width;
    if(item.group&&(index===window.start||item.group!==state.items[index-1]?.group)&&list.length+2<listHeight)list.push(`\x1b[2m${fit(item.group,w)}\x1b[0m`);
    const kind=item.kind?` ${sanitizeDynamicText(item.kind)} `:'';
    const room=Math.max(1,w-visibleWidth(kind)-1);
    const label=lit(fit(`${index===state.index?'›':' '} ${item.label}`,room),state.query);
    const text=pad(label,room)+`\x1b[2m${kind}\x1b[22m`;
    const link=(s:string)=>hyperlink(s,`pi-outliner-action:${action}:${index}:${state.generation??0}`);
    list.push(`${index===state.index?'\x1b[7m':''}${link(text)}\x1b[0m`);
    if(list.length<listHeight)list.push(`\x1b[2m${link(fit(`    ${item.detail??''}`,w-1))}\x1b[0m`);
  }
  const selected=state.items[state.index]!;
  const docWidth=beside?width-listWidth-3:width;
  const docs=(selected.context||selected.docs||selected.insertion).split('\n').flatMap(line=>wrapTextWithAnsi(renderMarkdownLine(sanitizeDynamicText(line)),docWidth));
  state.docsLines=docs.length;
  const docHeight=beside?bodyHeight:Math.max(0,bodyHeight-list.length-1);
  const top=state.docsTop=Math.min(state.docsTop??0,Math.max(0,docs.length-docHeight));
  const shown=docs.slice(top,top+docHeight);
  const thumbSize=Math.max(1,Math.round(list.length*capacity/state.items.length));
  const thumbAt=Math.round((list.length-thumbSize)*window.start/Math.max(1,state.items.length-capacity));
  const marked=list.map((line,i)=>pad(line,(beside?listWidth:width)-1)+(state.items.length>capacity&&i>=thumbAt&&i<thumbAt+thumbSize?'█':' '));
  if(hasDocs&&beside){
    state.docsRect={column:listWidth+3,row:rows.length,width:docWidth,height:docHeight};
    rows.push(...Array.from({length:Math.max(marked.length,shown.length)},(_,i)=>pad(marked[i]??'',listWidth)+' │ '+(shown[i]??'')));
  }else{
    rows.push(...marked);
    if(hasDocs&&shown.length){rows.push('─'.repeat(width));state.docsRect={column:0,row:rows.length,width:docWidth,height:docHeight};rows.push(...shown);}
  }
  if(height>=2){const enter=referenceEnterKeeps(state);rows.push(fit(enter?`⏎ ${enter} · tab inserts · esc dismiss`:state.message?`${help} · ${state.message}`:help));}
  return rows.slice(0,height);
}
