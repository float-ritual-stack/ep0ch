import {getOsc8LinkAtColumn} from '@earendil-works/pi-tui';
import {PreviewSelection,type PreviewContentRect} from './preview-selection';
import {parseTreePrimaryPointer} from './tree-mouse';

export interface TextViewerFrame {content:PreviewContentRect;identity:unknown;offset:number}

/** A viewer owns its drag through release; only an unmoved Copy click activates. */
export class TextViewerInput {
 private readonly selection=new PreviewSelection();
 private frame:TextViewerFrame|undefined;
 private lines:string[]=[];
 private pressed:{action:string;column:number;row:number}|undefined;
 render(lines:string[],frame:TextViewerFrame|undefined):string[]{
  if(frame?.identity!==this.frame?.identity||frame?.offset!==this.frame?.offset||JSON.stringify(frame?.content)!==JSON.stringify(this.frame?.content)){
   this.selection.clear();this.pressed=undefined;
  }
  this.frame=frame;this.lines=lines;
  return frame?this.selection.highlight(lines,frame.content):lines;
 }
 handle(sequence:string,copy:(text:string)=>void,invoke:(action:string)=>void,redraw:()=>void):boolean{
  const pointer=parseTreePrimaryPointer(sequence);
  if(!pointer)return false;
  if(pointer.phase==='down'){
   this.pressed=undefined;
   if(!this.frame||pointer.meta||pointer.ctrl)return false;
   const uri=getOsc8LinkAtColumn(this.lines[pointer.row]??'',pointer.column);
   if(uri?.startsWith('pi-outliner-action:viewer.copy:'))this.pressed={action:uri.slice('pi-outliner-action:'.length),column:pointer.column,row:pointer.row};
  }else if(this.pressed&&(pointer.column!==this.pressed.column||pointer.row!==this.pressed.row))this.pressed=undefined;
  const result=this.selection.pointer(pointer,this.frame?.content??{x:0,y:0,width:0,height:0},this.lines);
  if(!result.consumed)return false;
  if(result.copy)copy(result.copy);
  else if(pointer.phase==='up'&&this.pressed)invoke(this.pressed.action);
  if(pointer.phase==='up')this.pressed=undefined;
  redraw();return true;
 }
}
