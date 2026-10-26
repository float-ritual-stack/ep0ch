import { actionLine } from "./action-line";
import { COMPONENT_OPEN, componentAttrs, componentBlockAt, lineWords, noteCodeFences, splitWords } from "./component-block";

/** The component's name. */
export const BUTTON_NAME = "button";

/** One step: what it runs (`source`, its {slots} filled from the line) and, for a step with slots, the line as written (`written`). */
export interface ButtonStep { kind: "act" | "script"; source: string; written?: string }

/** One button, including its closed body when present. */
export interface ButtonCall {
  /** The line (from 0) it is written on. */
  line: number;
  endLine: number;
  steps: ButtonStep[];
  sequence: boolean;
  /** Repeated slots of an of= script, in authored order. */
  props: Record<string, string[]>;
  /** What the button says: `label=`, else the script's or action's name. */
  label: string;
  /** The action line a press runs; null when the line names none. */
  act: string | null;
  /** The alternate press, when supplied. */
  alt?: string;
  /** The slots the line fills itself (PIE-1298): `target=` for a `{target}` in act= or in an of= script's values, in the order written. */
  slots: ButtonSlot[];
  /** The slots with no value yet, in the order the button reads them: a press asks for each (never runs with one open). */
  empty: string[];
  /** The line couldn't be read as a button, or reads as something other than what was written: what to write. */
  problem?: string;
}

/** A word on the button's line that a `{key}` elsewhere on it reads. */
export interface ButtonSlot { key: string; value: string }

/** Attributes a button reads itself; every other word is a slot of the script it runs (`of=`). */
export const BUTTON_OWN: ReadonlySet<string> = new Set(["label", "act", "of", "alt"]);
const OWN = BUTTON_OWN;

/** The closing body line, or the opener when this button has no closed body. */
export function buttonBodyEnd(lines: readonly string[], i: number): number {
  const open = COMPONENT_OPEN.exec((lines[i] ?? "").replace(/\r$/, ""));
  if (!open || open[1] !== BUTTON_NAME || !open[3]) return i;
  const pairs = componentAttrs(open[3].slice(1, -1)).pairs;
  if (pairs.some(p => ["act", "of"].includes(p.key.toLowerCase()))) return i;
  const following = lines.slice(i);
  const blank = following.findIndex((line, at) => at > 0 && !line.trim());
  const block = componentBlockAt((blank < 0 ? following : following.slice(0, blank)).join("\n"));
  return block ? i + block.raw.trimEnd().split("\n").length - 1 : i;
}

/** A `{key}` in a button's action or script values: the word of the same name on the line fills it. */
const SLOT_REF = /\{([A-Za-z][\w.-]*)\}/g;
const refsOf = (text: string): string[] => [...text.matchAll(SLOT_REF)].map(m => m[1]!);

/** A slot's value as a word of an action line: as written when it is one word, else quoted. */
const wordOf = (value: string) => (/^[^\s"'\\]+$/.test(value) ? value : '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"');

/** The quote open at offset `at` of `text` ("" when none): the same reading as `balanced`. */
function quoteAt(text: string, at: number): string {
  let quote = "", escaped = false;
  for (const c of text.slice(0, at)) {
    if (escaped) { escaped = false; continue; }
    if (c === "\\" && quote !== "'") { escaped = true; continue; }
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") quote = c;
  }
  return quote;
}

/** Whether `text` closes every quote it opens (a quote inside the other kind, or escaped, is text). */
function balanced(text: string): boolean {
  let quote = "", escaped = false;
  for (const c of text) {
    if (escaped) { escaped = false; continue; }
    if (c === "\\" && quote !== "'") { escaped = true; continue; }
    if (quote) { if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") quote = c;
  }
  return !quote;
}

/** An attribute written back: `key="value"`, in the quote the value allows. */
const written = (key: string, value: string) => (/^[^\s"'{}\\]+$/.test(value) ? `${key}=${value}` : !value.includes('"') ? `${key}="${value}"` : !value.includes("'") ? `${key}='${value}'` : `${key}="${value.replace(/(["\\])/g, "\\$1")}"`);

/**
 * What the line says that no button reads (PIE-1298, Evan, Oct 25: `act="tile.zoom reach="column" tile="t-a6125371"` ended
 * act= at the second quote and zoomed the focused tile): null when it reads as written, else the reason and the line to
 * write. `strays` are words the button doesn't read (not label, act, of, alt, nor a slot some `{key}` names).
 */
function misread(label: string | undefined, act: string, strays: readonly { key: string; value: string }[]): string | null {
  const open = !balanced(act);
  if (!open && !strays.length) return null;
  const read = open ? act.replace(/["']/g, "").trim() : act;
  const word = (p: { key: string; value: string }) => (p.value === "on" ? p.key : `${p.key}=${p.value}`);
  const joined = [read, ...strays.map(word)].join(" ").trim();
  // After an early end the whole action goes inside single quotes (its own words are rarely quoted that way).
  const act1 = open && !joined.includes("'") ? `act='${joined}'` : written("act", joined);
  const fixed = `::button{${label ? `label="${label.replace(/"/g, "'")}" ` : ""}${act1}}`;
  const what = open ? `act= ends early, at a quote inside it (it read ${read})${strays.length ? `, and ${strays.map(word).join(" ")} fell outside it` : ""}` : `${strays.map(word).join(" ")} ${strays.length === 1 ? "isn't" : "aren't"} read by a button (it runs ${read})`;
  return `${what}: write ${fixed}`;
}

/** The `::button` starting at line `i`, or null. The body uses the shared component closing rule. */
export function buttonCallAt(lines: readonly string[], i: number): ButtonCall | null {
  const open = COMPONENT_OPEN.exec((lines[i] ?? "").replace(/\r$/, ""));
  if (!open || open[1] !== BUTTON_NAME) return null;
  const pairs = open[3] ? componentAttrs(open[3].slice(1, -1)).pairs : open[2] ? componentAttrs(open[2]).pairs : [];
  const get = (key: string) => pairs.find(p => p.key.toLowerCase() === key)?.value;
  const act = get("act")?.trim(), of = get("of")?.trim(), label = get("label")?.trim();
  const own = pairs.filter(p => !OWN.has(p.key.toLowerCase()));
  const endLine = buttonBodyEnd(lines, i);
  // Slots (PIE-1298): a word on the line that a `{key}` in the action (or in another word's value) names. The first word of a name is
  // the slot; it is read by the press, not forwarded to the script.
  const body = endLine > i ? lines.slice(i + 1, endLine).join("\n") : "";
  const named = new Set([...refsOf(act ?? ""), ...refsOf(body), ...refsOf(get("alt") ?? ""), ...own.flatMap(p => refsOf(p.value))]);
  const slots: ButtonSlot[] = [], rest: { key: string; value: string }[] = [];
  for (const p of own) {
    if (named.has(p.key) && !slots.some(s => s.key === p.key)) slots.push({ key: p.key, value: p.value });
    else rest.push(p);
  }
  // In an action line a value is one word (quoted when it needs it); in a script's value it is the value itself.
  // Inside a quoted value of the action line (`text="it is {who}"`) it goes in as text, its quotes escaped for that quote.
  const slotted = (text: string, raw = false) => text.replace(SLOT_REF, (whole, key: string, at: number) => {
    const s = slots.find(x => x.key === key);
    if (!s || !s.value) return whole;
    if (raw) return s.value;
    const q = quoteAt(text, at);
    return q === '"' ? s.value.replace(/(["\\])/g, "\\$1") : q === "'" ? s.value.replace(/'/g, "") : wordOf(s.value);
  });
  const props: Record<string, string[]> = {};
  // Own keys only: a slot may be any word, `constructor` or `__proto__` included, and none reaches Object.prototype.
  if (of) for (const { key, value } of rest) {
    const v = slotted(value, true);
    if (Object.hasOwn(props, key)) props[key]!.push(v);
    else Object.defineProperty(props, key, { value: [v], enumerable: true, writable: true, configurable: true });
  }
  let steps: ButtonStep[] = [], problem: string | undefined;
  try {
    if (endLine > i) {
      steps = lines.slice(i + 1, endLine).map(l => l.trim()).filter(Boolean).map(source => {
        const script = /^\(\((.+)\)\)$/.exec(source);
        return script ? { kind: "script", source: script[1]! } : { kind: "act", source: slotted(source), ...(refsOf(source).length ? { written: source } : {}) };
      });
    } else if (act || of) {
      const value = (act || of)!;
      const values = value.startsWith("[") ? buttonList(value) : [value];
      steps = values.map(source => ({ kind: act ? "act" : "script", ...(act && refsOf(source).length ? { written: source } : {}), source: act ? slotted(source) : actionLine({ action: source, args: Object.fromEntries(rest.map(p => [p.key, slotted(p.value, true)])) }) }));
    }
  } catch (error) { problem = (error as Error).message; }
  if (!steps.length) problem ??= '::button needs what it runs: write one action or ((script)) per line, then ::, or use act= / of=';
  // A button that reads differently than it was written runs nothing: it never acts on what its words didn't say.
  if (!problem && act && !act.startsWith("[")) {
    const said = misread(label, act, rest);
    if (said) problem = said;
  }
  // A `{key}` the line has no word for: the word to add.
  const lost = [...new Set([...refsOf(act ?? ""), ...refsOf(body), ...refsOf(get("alt") ?? ""), ...(of ? rest.flatMap(p => refsOf(p.value)) : [])])].filter(k => !slots.some(s => s.key === k) && !OWN.has(k));
  if (!problem && lost.length) problem = `{${lost[0]}} has no word on the line to fill it; add ${lost[0]}= (left empty, a press asks for it)`;
  const empty = [...new Set([...steps.flatMap(s => refsOf(s.source)), ...Object.values(props).flat().flatMap(refsOf)])].filter(k => slots.some(s => s.key === k && !s.value));
  const line = problem && !steps.length ? null : steps.map(s => s.source).join("\n") || null;
  return { line: i, endLine, steps, props, slots, empty, sequence: endLine > i || !!(act || of)?.startsWith("["), label: label || steps[0]?.source.split(/\s+/)[0] || "button", act: problem && misreadOnly(problem) ? null : line,
    ...(get("alt") ? { alt: slotted(get("alt")!) } : {}), ...(problem ? { problem } : {}) };
}

/** A problem that is the line reading differently than written (not a missing action, which already draws as a dead chip). */
const misreadOnly = (problem: string) => !problem.startsWith("::button needs");

/** The list is authored syntax: a comma outside a quoted item separates steps. */
function buttonList(value: string): string[] {
  if (!value.endsWith("]")) throw new Error("close the button's step list with ]");
  const items: string[] = [];
  let item = "", quote = "", escaped = false;
  for (const c of value.slice(1, -1)) {
    if (escaped) { item += c; escaped = false; continue; }
    if (c === "\\" && quote !== "'") { item += c; escaped = true; continue; }
    if (quote) { item += c; if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'") { quote = c; item += c; continue; }
    if (c === ",") { items.push(item.trim()); item = ""; } else item += c;
  }
  if (quote) throw new Error("close the quoted step in the button's list");
  items.push(item.trim());
  return items.map(raw => {
    if (!raw) throw new Error("write a step between the button list's commas");
    return /^["']/.test(raw) ? componentAttrs(`step=${raw}`).pairs[0]!.value : raw;
  });
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
    if (call) { out.push(call); i = call.endLine; }
  }
  return out;
}

/**
 * Where slot `key` is read (PIE-1298): each step's action and the argument whose whole value is `{key}`, so a press asks for it
 * in the kind that argument takes (the action's own schema: `tile=` a tile). A script step reads it through the script's slot
 * of that name. `tile=` is an argument here as in any action line.
 */
export function slotArgs(call: ButtonCall, key: string): { step: number; action: string; arg: string }[] {
  const out: { step: number; action: string; arg: string }[] = [];
  call.steps.forEach((s, step) => {
    if (s.kind !== "act") return;
    const [action, ...words] = lineWords(s.written ?? s.source);
    for (const w of words) {
      const eq = w.indexOf("=");
      if (eq > 0 && w.slice(eq + 1) === `{${key}}`) out.push({ step, action: action!, arg: w.slice(0, eq) });
    }
  });
  return out;
}

/**
 * The button on `line` with slot `key` written: the word of that name takes `value` (quoted when it needs it), else `key=value`
 * is added before the closing brace; the rest of the line is as written. Null when the line is no `::button{…}`, or the value
 * can't be written on one line.
 */
export function withButtonSlot(line: string, key: string, value: string): string | null {
  const open = COMPONENT_OPEN.exec(line.replace(/\r$/, ""));
  if (!open || open[1] !== BUTTON_NAME || !open[3] || value.includes("\n")) return null;
  const inner = open[3].slice(1, -1), at = line.indexOf(open[3]) + 1;
  const say = written(key, value);
  let cursor = 0;
  for (const w of splitWords(inner, false, false).flat()) {
    const from = inner.indexOf(w.raw, cursor);
    if (from < 0) break;
    cursor = from + w.raw.length;
    const eq = w.raw.indexOf("=");
    // `key=…`, or a bare `key` (read as `key=on`): the first is the slot, as buttonCallAt reads it.
    if (eq > 0 ? w.raw.slice(0, eq) === key : w.raw === key) return line.slice(0, at + from) + say + line.slice(at + cursor);
  }
  const tail = inner.endsWith(" ") ? "" : " ";
  return line.slice(0, at + inner.length) + (inner.trim() ? tail : "") + say + line.slice(at + inner.length);
}
