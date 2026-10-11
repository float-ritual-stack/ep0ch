import type { Cue } from './model';
// Mapping is intentionally literal: voice -> pitch/pan; position -> onset; duration -> sustain.
// It makes no inference about sentiment, importance, truth, or similarity.
export function voicePitch(name: string) {
 let hash=0;for(const c of name)hash=(hash*31+c.charCodeAt(0))>>>0;
 return [48,51,53,55,58,60,63,65][hash%8]!;
}
function tone(ctx: BaseAudioContext, destination: AudioNode, cue: Cue, voice: string, pan:number, when:number, duration:number) {
 const pitch=voicePitch(voice), frequency=440*2**((pitch-69)/12);
 const envelope=ctx.createGain(), stereo=ctx.createStereoPanner(), filter=ctx.createBiquadFilter();
 stereo.pan.value=pan;filter.type='lowpass';filter.frequency.value=1400;filter.Q.value=.4;
 envelope.gain.setValueAtTime(0,when);envelope.gain.linearRampToValueAtTime(cue.gain*.10,when+.04);
 envelope.gain.exponentialRampToValueAtTime(Math.max(.001,cue.gain*.025),when+Math.max(.06,duration*.55));
 envelope.gain.linearRampToValueAtTime(0,when+duration+.25);
 envelope.connect(filter);filter.connect(stereo);stereo.connect(destination);
 const nodes:OscillatorNode[]=[];
 for(const [ratio,volume,type] of [[1,.85,'triangle'],[2,.13,'sine'],[1.003,.15,'sine']] as const){
  const osc=ctx.createOscillator(), gain=ctx.createGain();osc.type=type;osc.frequency.value=frequency*ratio;gain.gain.value=volume;
  osc.connect(gain);gain.connect(envelope);osc.start(when);osc.stop(when+duration+.3);nodes.push(osc);
  osc.onended=()=>{osc.disconnect();gain.disconnect();};
 }
 nodes[0]!.addEventListener('ended',()=>{envelope.disconnect();filter.disconnect();stereo.disconnect();});
 return nodes;
}
export class Instrument {
 context:AudioContext|null=null;
 master:GainNode|null=null;
 level=.22;
 private nodes=new Set<OscillatorNode>();
 async enable(){
  if(!this.context){this.context=new AudioContext();this.master=this.context.createGain();this.master.gain.value=this.level;this.master.connect(this.context.destination);}
  await this.context.resume();
 }
 get now(){return this.context?.currentTime??0;}
 setLevel(level:number){this.level=level;if(this.master&&this.context)this.master.gain.setTargetAtTime(level,this.now,.04);}
 play(cue:Cue,voice:string,pan:number,when:number,duration:number){
  if(!this.context||!this.master)return;
  for(const node of tone(this.context,this.master,cue,voice,pan,Math.max(this.now,when),duration)){
    this.nodes.add(node);node.addEventListener('ended',()=>this.nodes.delete(node));
  }
 }
 silence(){for(const n of this.nodes){try{n.stop();}catch{}}this.nodes.clear();}
 async wav(cues:Cue[],bpm:number,voices:Map<string,{name:string;pan:number}>,beats:number){
  const seconds=beats*60/bpm+1,ctx=new OfflineAudioContext(2,Math.ceil(seconds*44100),44100),master=ctx.createGain();
  master.gain.value=this.level;master.connect(ctx.destination);
  for(const c of cues){const v=voices.get(c.source);if(v)tone(ctx,master,c,v.name,v.pan,c.start*60/bpm+.05,c.duration*60/bpm);}
  const buffer=await ctx.startRendering();
  const wav=new ArrayBuffer(44+buffer.length*4),view=new DataView(wav);
  const str=(offset:number,text:string)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
  str(0,'RIFF');view.setUint32(4,36+buffer.length*4,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,44100,true);view.setUint32(28,176400,true);view.setUint16(32,4,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,buffer.length*4,true);
  const left=buffer.getChannelData(0),right=buffer.getChannelData(1);let peak=0,energy=0;
  for(let i=0;i<buffer.length;i++){for(let channel=0;channel<2;channel++){const sample=channel===0?left[i]!:right[i]!;peak=Math.max(peak,Math.abs(sample));energy+=sample*sample;view.setInt16(44+(i*2+channel)*2,Math.round(Math.max(-1,Math.min(1,sample))*32767),true);}}
  return {blob:new Blob([wav],{type:'audio/wav'}),seconds,peak,rms:Math.sqrt(energy/(buffer.length*2))};
 }
}
