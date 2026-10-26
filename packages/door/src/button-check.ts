// What a ::button line says that only the door knows (PIE-1298): an argument its action doesn't take, a tile= that names no
// tile now. outline-core reads the line itself (button-call.ts: an act= that ends early, stray words, a {slot} with no word);
// this adds the action registry's and the layout's answers to the same reading, so the save's warning and any live mark of
// the line (the editor's, PIE-1312) are one list. Pure over its lookups; a save is never refused by it.

import { buttonCallsOf } from "@ep0ch/outline-core/button-call";
import { lineWords } from "@ep0ch/outline-core/action-line";
import { SELECTOR } from "./bar/form";

/** What the door can be asked about a button's action line. */
export interface ButtonLookups {
  /** The arguments the action takes, or null when no such action is here (a script, or one that isn't on this screen). */
  args(action: string): string[] | null;
  /** Why `tile=` names no tile now (the dispatcher's own refusal), or null when it names one. */
  tile(sel: string): Promise<string | null>;
}

export interface ButtonMark { line: number; message: string }

/** The marks for every button `text` holds, in line order: one sentence each, with the way to write it. */
export async function buttonMarks(text: string, ask: ButtonLookups): Promise<ButtonMark[]> {
  const out: ButtonMark[] = [];
  for (const call of buttonCallsOf(text)) {
    if (call.problem) continue;
    for (const step of call.steps) {
      if (step.kind !== "act") continue;
      const [action, ...words] = lineWords(step.source);
      const takes = action ? ask.args(action) : null;
      if (!action || !takes) continue;
      for (const w of words) {
        const eq = w.indexOf("=");
        if (eq <= 0) continue;
        const key = w.slice(0, eq), value = w.slice(eq + 1);
        if (key === SELECTOR) {
          const why = value && !value.includes("{") ? await ask.tile(value) : null;
          if (why) out.push({ line: call.line, message: `the ::button on line ${call.line + 1}: ${why}` });
        } else if (key !== "as" && !takes.includes(key)) {
          out.push({ line: call.line, message: `the ::button on line ${call.line + 1}: ${action} takes no ${key}= (it takes ${takes.length ? takes.join(", ") : "no arguments"})` });
        }
      }
    }
  }
  return out;
}

/** The marks in one line, for a save's status. */
export function describeButtonMarks(marks: readonly ButtonMark[], max = 2): string {
  if (!marks.length) return "";
  return marks.slice(0, max).map(m => m.message).join(" · ") + (marks.length > max ? ` · and ${marks.length - max} more` : "");
}
