import {wrapTextWithAnsi} from '@earendil-works/pi-tui';
import {outlinerActionLink} from './outliner-actions';
import {sanitizeDynamicText} from './terminal';
import type {WorkspaceReportEntry} from './workspace-diagnostics';

/** Layout only: complete copy values remain on the typed report entries. */
export function layoutWorkspaceReport(entries:readonly WorkspaceReportEntry[],width:number,focusedField:number):{lines:string[];fieldRows:number[]} {
 const lines:string[]=[],fieldRows:number[]=[];
 let fieldIndex=0;
 const wrap=(text:string)=>wrapTextWithAnsi(text,Math.max(1,width));
 for(const entry of entries){
  if(entry.kind==='section'){
   if(lines.length)lines.push('');
   lines.push(...wrap(`\x1b[1m${sanitizeDynamicText(entry.title)}\x1b[0m`));
  }else if(entry.kind==='note')lines.push(...wrap(sanitizeDynamicText(entry.text)));
  else{
   fieldRows.push(lines.length);
   lines.push(...wrap(`${fieldIndex===focusedField?'›':' '} ${sanitizeDynamicText(entry.label)}: ${outlinerActionLink(`viewer.copy:${fieldIndex}`,'[Copy]')}`));
   lines.push(...wrapTextWithAnsi(sanitizeDynamicText(entry.value),Math.max(1,width-2)).map(line=>`  ${line}`));
   if(entry.note)lines.push(...wrap(`  (${sanitizeDynamicText(entry.note)})`));
   fieldIndex++;
  }
 }
 return {lines,fieldRows};
}
