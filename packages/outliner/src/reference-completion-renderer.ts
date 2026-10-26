import {hyperlink,truncateToWidth,visibleWidth} from '@earendil-works/pi-tui';
import {searchMatchSpans} from '@ep0ch/outline-core/search-match';
import {completionWindow} from './completion';
import {sanitizeDynamicText} from './terminal';
import type {ReferenceCompletionState} from './reference-completion';

export const COMPLETION_ROWS=8;
/** The typed letters the matcher matched, lit (bold) in a label: outline-core's spans, as the door lights them. */
function lit(label:string,query:string|undefined):string{
  if(!query)return label;
  const on=new Set(searchMatchSpans(label,query));
  return [...label].map((c,i)=>on.has(i)?`\x1b[1m${c}\x1b[22m`:c).join('');
}
/**
 * Shared compact list (PIE-1340): each row its marker, label (matched letters lit), detail dim and kind at the right;
 * under the lit row (when there's room) its docs, the same words the door's docs panel wraps. Canonical choice actions,
 * bounded geometry.
 */
export function renderReferenceCompletion(state:ReferenceCompletionState,width:number,height=COMPLETION_ROWS,action='completion.choose',help='↑↓ select · Enter/Tab insert · Esc dismiss'):string[]{
  const fit=(text:string)=>truncateToWidth(sanitizeDynamicText(text),Math.max(1,width),'…');
  if(height<=0)return [];
  if(!state.items.length)return [fit(state.message??'No matches')];
  const showHeader=height>=3,showFooter=height>=2,showContext=height>=6;
  const capacity=Math.max(1,height-Number(showHeader)-Number(showFooter)-(showContext?1:0));
  const window=completionWindow(state.items.length,state.index,capacity);
  const heading=(state.heading??'References').replace(/^./,c=>c.toUpperCase());
  const rows=showHeader?[fit(`${heading} ${state.index+1}/${state.items.length}${state.incompleteness?` · Partial search`:state.truncatedLimit?` · Showing first ${state.truncatedLimit} matches`:''}`)]:[];
  for(let index=window.start;index<window.end;index++){
    const item=state.items[index]!;
    const kind=item.kind?` ${sanitizeDynamicText(item.kind)}`:'';
    const room=Math.max(4,width-visibleWidth(kind));
    const title=truncateToWidth(`${index===state.index?'›':' '} ${sanitizeDynamicText(item.label)}`,room,'…');
    const left=room-visibleWidth(title);
    const detail=item.detail&&left>3?`\x1b[2m · ${truncateToWidth(sanitizeDynamicText(item.detail),left-3,'…')}\x1b[22m`:'';
    const pad=' '.repeat(Math.max(0,room-visibleWidth(title)-visibleWidth(detail)));
    const label=lit(title,state.query)+detail+pad+(kind?`\x1b[2m${kind}\x1b[22m`:'');
    rows.push(`${index===state.index?'\x1b[7m':''}${hyperlink(label,`pi-outliner-action:${action}:${index}:${state.generation??0}`)}\x1b[0m`);
  }
  const selected=state.items[state.index];
  if(showContext&&selected)rows.push(`\x1b[2m${fit(`  ${(selected.context||selected.docs||'Select to inspect context').split('\n').map(l=>l.trim()).filter(Boolean).join(' · ')}`)}\x1b[0m`);
  if(showFooter)rows.push(fit(state.message||help));
  return rows.slice(0,Math.max(0,height));
}
