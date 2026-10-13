import { useState } from "react";
import * as Tone from "tone";

// A fictional desk toy for the showcase (PIE-793): a pad of eight notes, written as claude.ai writes a React artifact
// (one file, a default export, Tailwind classes, Tone for the sound). Nothing plays until a pad is pressed.
const NOTES = ["C4", "D4", "E4", "G4", "A4", "C5", "D5", "E5"];

export default function PulsePad() {
  const [synth, setSynth] = useState(null);
  const [lit, setLit] = useState(null);
  const [count, setCount] = useState(0);

  async function play(note, i) {
    let s = synth;
    if (!s) {
      await Tone.start();
      s = new Tone.PolySynth(Tone.Synth, { envelope: { attack: 0.01, release: 0.6 } }).toDestination();
      s.volume.value = -12;
      setSynth(s);
    }
    s.triggerAttackRelease(note, "8n");
    setLit(i);
    setCount((n) => n + 1);
    setTimeout(() => setLit((x) => (x === i ? null : x)), 180);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-xl font-semibold tracking-wide text-teal-300">Pulse pad</h1>
      <div className="grid grid-cols-4 gap-3">
        {NOTES.map((note, i) => (
          <button
            key={note}
            onClick={() => play(note, i)}
            className={`h-16 w-16 rounded-lg border border-slate-700 font-mono text-sm transition ${lit === i ? "bg-teal-500 text-slate-950 scale-95" : "bg-slate-800 hover:bg-slate-700"}`}
          >
            {note}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">{count === 0 ? "press a pad: sound starts on the first press" : `${count} notes played`}</p>
    </div>
  );
}
