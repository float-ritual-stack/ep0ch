import type { OutlinerClient } from '../../src/client';
import type { Block } from '../../src/types';
import type { BlockRecord } from '@ep0ch/outline-core/block-record';
import { cueFrom, scoreText, type Score } from './model';

// Fiction. The disagreement changes over eight scenes; none of these words came from a private archive.
const scenes = ['A room goes quiet','An attractive machine','The missing voice','Evidence arrives','A different question','A night rehearsal','What we keep','An unfinished opening'];
const voices = ['Mara', 'Ivo', 'Sol', 'The room'];
const roles = ['listener', 'builder', 'archivist', 'field-note'];
const entries: [number,number,string,string,string,number[]][] = [
[0,0,'Keep the pauses','The old ferry waiting room is becoming a listening library. Everyone brings a recording. My first contribution is forty seconds in which nobody speaks.\n\nA pause can belong to a conversation without being a failure of it. ^pause','question',[]],
[0,1,'A map that answers back','We could put every recording on a wall. Touch a place, hear what happened there. The wall would make the archive navigable without requiring anyone to learn its catalog.\n\nI have already drawn the wall. I have not asked who gets to touch it.','proposal',[0]],
[0,2,'Do not smooth the tape','The transcript says “I stayed.” The tape says “I—” and then a train, and then “stayed.” These are not interchangeable records.\n\nKeep the hesitation. It is part of the statement.','evidence',[0]],
[0,3,'04:12 / no ferry','A chain knocks against the flagpole. The empty departures board still clicks at twelve minutes past the hour.\n\nThere is a system here, even when it has nothing to announce.','observation',[]],
[1,1,'Automatic company','Prototype: when nobody is talking, the wall plays the most related recording. A room that never leaves you alone with a blank.\n\n> [!question] Is filling the space the same as keeping someone company?','proposal',[1]],
[1,0,'An answer too quickly','I told the prototype about my mother. Before I finished, it offered another person’s grief.\n\nIt found a relationship. It interrupted a person. Both happened.','objection',[4]],
[1,2,'Related according to whom','A similarity score can be an invitation to compare. It cannot establish that two speakers meant the same thing.\n\nWrite the reason beside the connection. Leave room to disagree.','constraint',[2,4]],
[1,3,'A chair in the corridor','There are eleven chairs inside and one outside. Nobody remembers carrying the twelfth chair into the corridor. It is the only chair facing the sea.','observation',[3]],
[2,0,'The voice absent from the map','The night cleaner does not appear in any recording. She knows which chair gets moved, which door sticks, and when the room is actually quiet.\n\nThe archive is full. The account is incomplete.','question',[1,7]],
[2,2,'Silence is not consent','An absent recording may mean no microphone, no permission, a broken machine, or a choice not to speak.\n\nDo not assign one meaning to all the empty cells.','constraint',[8]],
[2,1,'A button labelled wait','I removed automatic playback. The new button says WAIT. It does nothing, visibly.\n\nMara says that is the first honest interface I have made for this room. I am not sure whether she is joking.','revision',[4,5]],
[3,3,'The bench test','At 02:00 the radiator rings at the same pitch as the departures board. The cleaner knows this. She calls it the room tuning itself.\n\nOur equipment called it background noise.','evidence',[8]],
[3,2,'A correction, still attached','The first transcript calls the ringing a phone. We correct the word, keeping the earlier revision and the clip that made us change our minds.\n\nAn archive that cannot show its mistakes cannot show its learning.','revision',[2,11]],
[3,1,'Three renderings, one address','I can show the same passage as words, a point on the map, or a sound in a sequence. Moving between them should not create three separate passages.\n\nThe address is the seam. The rendering is a choice.','proposal',[1,12]],
[3,0,'Play them together','Play the machine’s account beside the cleaner’s account. Not to decide which one wins. To hear where one stops noticing and the other starts.','proposal',[11,13]],
[4,0,'What if listening is an arrangement','An arrangement says: I want to hold these accounts near each other for a while. It need not say: I have merged them into one truth.\n\nLeave their names on them. Leave the disagreement audible.','question',[6,14]],
[4,1,'The knob that admits what it does','One knob controls how much of the other account you hear. It does not say RELEVANCE. It says DISTANCE.\n\nWe can argue about a knob. We cannot argue with an unexplained verdict.','proposal',[6,15]],
[4,2,'A reading is a document too','Keep the sources where they are. Save the order, the excerpts, and the revisions used.\n\nThen someone can replay an argument without pretending that the underlying notes stopped changing.','constraint',[12,15]],
[4,3,'Rain through two doors','From the main door the rain sounds sharp. From the corridor it sounds like a soft hiss.\n\nSame weather. Different opening.','observation',[7,16]],
[5,1,'Rehearsal with an empty track','We made a track for the cleaner before she agreed to record. It stays empty, labelled “not recorded.”\n\nThe empty track changed the discussion more than our best visualization.','experiment',[8,9]],
[5,0,'The room can say no','At the rehearsal, a visitor asks to remove their recording. Their place in the arrangement remains, but the words are gone.\n\nWe must distinguish a remembered source from a right to replay it.','constraint',[17,19]],
[5,2,'The old words still sound','Someone corrected a source during playback. The score kept playing the version we chose yesterday. Good for reproducibility; dangerous if nobody can see it.\n\nA frozen excerpt needs an obvious age.','evidence',[12,17]],
[5,3,'02:06 / a small audience','Six people listen to the radiator. One laughs, two take notes, three do nothing we can measure.\n\nThe recording is forty-three seconds long. The listening lasts longer.','observation',[11,19]],
[6,0,'Leave the ending open','I no longer want the wall to tell the whole story. I want it to help two people stay with different accounts long enough to make a third question.','revision',[5,15]],
[6,1,'The wall comes down','The big wall became a table with a few movable strips of paper. Each strip opens its source. We still need a machine, but it no longer has to look like the answer.','revision',[1,13,16]],
[6,2,'Keep the arrangement, not the verdict','We save three readings of the same material. Chronology. Disagreement. What nobody recorded.\n\nNone is the canonical reading. The archive owns the sources; the reader owns the arrangement.','decision',[17,21]],
[6,3,'The twelfth chair returns','The corridor chair is back inside. It is still facing the sea.','observation',[7,18]],
[7,0,'An invitation with no summary','Come in. Move something. Listen again.\n\nIf the arrangement changes your mind, leave a note about which crossing did it.','invitation',[23,25]],
[7,1,'A machine small enough to disagree with','The useful part was not the synthesis. It was how easy it became to place two things together, and how easy it remained to pull them apart.','decision',[24,25]],
[7,2,'The work left over','We have not solved permission, deletion, or how to carry a reference between archives. This rehearsal proves none of those.\n\nIt proves that a reading can have a shape worth keeping.','question',[20,25]],
[7,3,'06:00 / first ferry','The board clicks. Someone moves a chair. Nobody presses PLAY.','observation',[3,26]],
];
export async function seed(client: OutlinerClient) {
 const create = (text:string,parentId?:string) => client.request<Block>({action:'create',text,parentId,author:'agent',provenance:{actorId:'counterpoint-seed'}});
 const root = await create('Counterpoint rehearsal [type::experiment]\n\nA fictional conversation about a listening library. All demo material is invented. Sources, scores and captured readings live in this private outline.');
 const sources = await create('The room that could listen [type::counterpoint-sources]',root.id);
 const ids:string[]=[];
 for(const [scene,voice,title,body,stance,links] of entries){
   const refs=links.map(i=>`((${ids[i]}|${entries[i]![2]}))`).join(' · ');
   const note=await create(`${title} [type::passage] [voice::${voices[voice]}] [role::${roles[voice]}] [stance::${stance}] [scene::${scene+1}] [place::${voice===3?'harbor':'waiting-room'}]\n\n${body}${refs?'\n\nIn conversation with '+refs:''}`,sources.id);
   ids.push(note.id);
 }
 const {records:notes}=await client.request<{records:BlockRecord[]}>({action:'blocks.records',ids});
 const score:Score={version:1,title:'The room that could listen',bpm:72,beats:64,group:'voice',cues:notes.map((n,i)=>cueFrom(n,entries[i]![0]*8+entries[i]![1]*0.5, entries[i]![1]===3?5:6))};
 const arrangement=await create(scoreText(score),root.id);
 return {root:root.id,sources:sources.id,arrangement:arrangement.id,scenes,originalScore:score};
}
