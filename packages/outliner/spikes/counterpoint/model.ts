import type { BlockRecord } from '@ep0ch/outline-core/block-record';
export type Cue = { id: string; source: string; revision: number; title: string; body: string; start: number; duration: number; gain: number };
export type Score = { version: 1; title: string; bpm: number; beats: number; group: string; cues: Cue[] };
export type Note = BlockRecord & { html: string };
export function cueFrom(note: BlockRecord, start: number, duration = 6): Cue {
  return { id: crypto.randomUUID(), source:note.id, revision:note.revision, title:note.title, body:note.body, start, duration, gain:0.7 };
}
export function validateScore(value: unknown): Score {
  const s = value as Score;
  if (!s || s.version !== 1 || typeof s.title !== 'string' || s.title.length > 160 || typeof s.group !== 'string' || s.group.length > 80 || !Number.isFinite(s.bpm) || s.bpm < 35 || s.bpm > 180 || s.beats !== 64 || !Array.isArray(s.cues) || s.cues.length > 160) throw new Error('A score needs version 1, a title, a grouping property, 35–180 BPM, 64 beats and at most 160 cues.');
  const ids = new Set<string>();
  for (const c of s.cues) {
    if (!c || typeof c.id !== 'string' || ids.has(c.id) || typeof c.source !== 'string' || !Number.isInteger(c.revision) || c.revision < 1 || typeof c.title !== 'string' || typeof c.body !== 'string' || c.body.length > 64000 || !Number.isFinite(c.start) || !Number.isFinite(c.duration) || c.start < 0 || c.duration < 1 || c.start+c.duration > 64 || !Number.isFinite(c.gain) || c.gain < 0 || c.gain > 1) throw new Error('A cue needs a unique id, source revision, frozen text, and a duration inside the 64-beat score.');
    ids.add(c.id);
  }
  return s;
}
export function scoreText(score: Score) { return 'Counterpoint arrangement [type::counterpoint-score]\n\nThe text inside this fence is the performance. Source notes remain independent.\n\n```json\n'+JSON.stringify(score,null,2)+'\n```'; }
export function readScore(text: string): Score {
  const fence = text.indexOf('```json\n');
  if(fence < 0) throw new Error('This arrangement has no JSON score.');
  return validateScore(JSON.parse(text.slice(fence+8, text.lastIndexOf('\n```'))));
}
