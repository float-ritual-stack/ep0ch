// What a ::button line says, as the door reads it (PIE-1298, PIE-1312): its parts (attribute names, `=`, values, the action
// in act= and its argument names) for the editor to colour, and what won't run: an act= that ends early or leaves stray words
// (outline-core's button-call reads that), an action this door has no such name for, an argument the action doesn't take, a
// tile= that names no tile now. One reader for the editor's live marks and the save's warning, so they can never disagree.
// Pure over its lookups; a save is never refused by it.

import { buttonCallAt, buttonCallsOf, slotArgs } from "@ep0ch/outline-core/button-call";
import { COMPONENT_OPEN, splitWords } from "@ep0ch/outline-core/component-block";
import { lineWords } from "@ep0ch/outline-core/action-line";
import { closest } from "./cli-words";
import { SELECTOR } from "./bar/form";

/** What the door can be asked about a button's action line. */
export interface ButtonLookups {
  /** The arguments the action takes (from its ActionDef), or null when no such action is here. */
  args(action: string): string[] | null;
  /** The actions there are, for a did-you-mean. */
  actions(): readonly string[];
  /** Why `tile=` names no tile now (the dispatcher's own refusal), or null when it names one. */
  tile(sel: string): Promise<string | null>;
}

/** A part of the line, by code point offsets [from, to). */
export type ButtonPart = { from: number; to: number; is: "name" | "eq" | "value" | "action" | "arg" };
/** What won't run, where: `kind` says which check found it. */
export interface ButtonMarkSpan { from: number; to: number; kind: "misread" | "action" | "arg" | "tile"; message: string }
/** One line's reading: its parts, what won't run (a tile= waits on `tiles`), and what it runs. */
export interface ButtonLook { parts: ButtonPart[]; marks: ButtonMarkSpan[]; tiles: { from: number; to: number; sel: string }[]; runs: string | null; problem?: string }

const OWN = new Set(["label", "act", "of", "alt"]);
const cp = (s: string) => [...s].length;

/** The reading of `line` when it opens a `::button{…}`, else null. Sync: a tile= is listed for the caller to ask about. */
export function buttonLineLook(line: string, ask: Pick<ButtonLookups, "args" | "actions">): ButtonLook | null {
  const open = COMPONENT_OPEN.exec(line);
  if (!open || open[1] !== "button" || !open[3]) return null;
  const call = buttonCallAt([line], 0);
  if (!call) return null;
  const parts: ButtonPart[] = [], marks: ButtonMarkSpan[] = [], tiles: ButtonLook["tiles"] = [];
  const at = cp(line.slice(0, line.indexOf(open[3]) + 1)), inner = open[3].slice(1, -1);
  const slots = new Set(call.slots.map(s => s.key)), valueOf = new Map<string, { from: number; to: number }>();
  let cursor = 0;
  for (const w of splitWords(inner, false, false).flat()) {
    const off = inner.indexOf(w.raw, cursor);
    if (off < 0) break;
    cursor = off + w.raw.length;
    const from = at + cp(inner.slice(0, off)), to = from + cp(w.raw), eq = w.raw.indexOf("=");
    const key = eq > 0 ? w.raw.slice(0, eq) : w.raw;
    if (eq > 0) {
      parts.push({ from, to: from + cp(key), is: "name" }, { from: from + cp(key), to: from + cp(key) + 1, is: "eq" }, { from: from + cp(key) + 1, to, is: "value" });
      if (!valueOf.has(key)) valueOf.set(key, { from: from + cp(key) + 1, to });
    } else parts.push({ from, to, is: "name" });
    // A word a button doesn't read, when the line misreads: what fell outside act=.
    if (call.problem && call.act === null && !OWN.has(key.toLowerCase()) && !slots.has(key)) marks.push({ from, to, kind: "misread", message: call.problem });
    // act= closed at a quote inside it: what came after that quote is what the button never read.
    if (key.toLowerCase() === "act" && eq > 0 && call.problem && call.act === null) {
      const value = w.raw.slice(eq + 1), q = value[0];
      const end = q === '"' || q === "'" ? value.indexOf(q, 1) : -1;
      if (end > 0 && end < value.length - 1) marks.push({ from: from + cp(key) + 1 + cp(value.slice(0, end + 1)), to, kind: "misread", message: call.problem });
    }
    if (key.toLowerCase() !== "act" || eq < 0 || call.problem && call.act === null) continue;
    // Inside act=: the action and its argument names, read against the action's own ActionDef.
    const value = w.raw.slice(eq + 1), q = /^["']/.test(value) ? 1 : 0, vFrom = from + cp(key) + 1 + q;
    const words = splitWords(value.slice(q, value.length - (q && value.length > 1 ? 1 : 0)), false, false).flat();
    let c2 = 0;
    const body = value.slice(q);
    words.forEach((aw, i) => {
      const o = body.indexOf(aw.raw, c2);
      if (o < 0) return;
      c2 = o + aw.raw.length;
      const s = vFrom + cp(body.slice(0, o)), e = s + cp(aw.raw);
      if (i === 0) {
        parts.push({ from: s, to: e, is: "action" });
        if (!value.startsWith("[") && ask.args(aw.value) === null && /^[a-z][\w-]*\.[\w.-]+$/.test(aw.value)) {
          const near = closest(aw.value, ask.actions());
          marks.push({ from: s, to: e, kind: "action", message: `no action ${aw.value} here${near ? `; did you mean ${near}?` : ""}` });
        }
        return;
      }
      const k = aw.value.indexOf("=");
      if (k <= 0) return;
      const arg = aw.value.slice(0, k), val = aw.value.slice(k + 1);
      parts.push({ from: s, to: s + cp(arg), is: "arg" });
      const action = lineWords(call.steps[0]?.source ?? "")[0] ?? "";
      const takes = ask.args(action);
      if (arg === SELECTOR) { if (val && !val.includes("{")) tiles.push({ from: s, to: e, sel: val }); }
      else if (takes && arg !== "as" && !takes.includes(arg)) marks.push({ from: s, to: s + cp(arg), kind: "arg", message: `${action} takes no ${arg}= (it takes ${takes.length ? takes.join(", ") : "no arguments"})` });
    });
  }
  // A filled slot read as a tile= (`target=t-…` for `tile={target}`): its value is the tile the press names.
  for (const slot of call.slots) {
    if (!slot.value || !slotArgs(call, slot.key).some(u => u.arg === SELECTOR)) continue;
    const v = valueOf.get(slot.key);
    if (v) tiles.push({ ...v, sel: slot.value });
  }
  return { parts, marks, tiles, runs: call.act, ...(call.problem ? { problem: call.problem } : {}) };
}

export interface ButtonMark { line: number; message: string }

/**
 * The marks for every button `text` holds, in line order, for a save's warning: one sentence each, with the way to write it. An
 * act= that misreads is left to the save's syntax warnings (outline-core says it, with the corrected line).
 */
export async function buttonMarks(text: string, ask: ButtonLookups): Promise<ButtonMark[]> {
  const lines = text.split("\n"), out: ButtonMark[] = [];
  for (const call of buttonCallsOf(text)) {
    const look = buttonLineLook(lines[call.line] ?? "", ask);
    if (!look) continue;
    const say = (message: string) => out.push({ line: call.line, message: `the ::button on line ${call.line + 1}: ${message}` });
    for (const m of look.marks) if (m.kind !== "misread") say(m.message);
    for (const t of look.tiles) { const why = await ask.tile(t.sel); if (why) say(why); }
  }
  return out;
}

/** The marks in one line, for a save's status. */
export function describeButtonMarks(marks: readonly ButtonMark[], max = 2): string {
  if (!marks.length) return "";
  return marks.slice(0, max).map(m => m.message).join(" · ") + (marks.length > max ? ` · and ${marks.length - max} more` : "");
}
