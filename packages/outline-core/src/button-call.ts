// `::button{label="Review" act="layout.load name=review"}` and `::button{label="Fantasia" of=fantasia layout=focus}`
// (PIE-957, S7 of the self-reference wave): a button written into a note. Its line is a one-line component whose braces
// `componentAttrs` reads, so this module only says what the attributes mean. The press is an action line, as the power bar
// and `ep0ch act` take one: `act=` is that line, or `of=` names a script and every other word is its slot (`k=v`), so the
// two spellings compile to the same line. Pure: no I/O; the door draws the button and runs the line as the person.
import { actionLine } from "./action-line";
import { COMPONENT_OPEN, componentAttrs, noteCodeFences } from "./component-block";

/** The component's name. */
export const BUTTON_NAME = "button";

/** One `::button` line of a note. */
export interface ButtonCall {
  /** The line (from 0) it is written on. */
  line: number;
  /** What the button says: `label=`, else the script's or action's name. */
  label: string;
  /** The action line a press runs; null when the line names none. */
  act: string | null;
  /** The line couldn't be read as a button: what to write. */
  problem?: string;
}

/** Attributes a button reads itself; every other word is a slot of the script it runs (`of=`). */
const OWN = new Set(["label", "act", "of"]);

/** The `::button` starting at line `i`, or null. Only a one-line call with attributes. */
export function buttonCallAt(lines: readonly string[], i: number): ButtonCall | null {
  const open = COMPONENT_OPEN.exec((lines[i] ?? "").replace(/\r$/, ""));
  if (!open || open[1] !== BUTTON_NAME) return null;
  const pairs = open[3] ? componentAttrs(open[3].slice(1, -1)).pairs : open[2] ? componentAttrs(open[2]).pairs : [];
  const get = (key: string) => pairs.find(p => p.key.toLowerCase() === key)?.value;
  const act = get("act")?.trim(), of = get("of")?.trim(), label = get("label")?.trim();
  const slots = pairs.filter(p => !OWN.has(p.key.toLowerCase()));
  const line = act || (of ? actionLine({ action: of, args: Object.fromEntries(slots.map(p => [p.key, p.value])) }) : null);
  if (!line) return { line: i, label: label ?? "button", act: null, problem: "::button needs what it runs: ::button{label=\"Review\" act=\"layout.load name=review\"}, or of=<script> with its slots" };
  return { line: i, label: label || (act ? act.split(/\s+/)[0]! : of!), act: line };
}

/** Every `::button` a note's text holds, in order (outside code fences). */
export function buttonCallsOf(text: string): ButtonCall[] {
  if (!text.includes("::button")) return [];
  const lines = text.split("\n");
  const fenced = new Set<number>();
  for (const f of noteCodeFences(lines)) for (let j = f.start; j <= f.end; j++) fenced.add(j);
  const out: ButtonCall[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i)) continue;
    const call = buttonCallAt(lines, i);
    if (call) out.push(call);
  }
  return out;
}
