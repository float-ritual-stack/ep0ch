import { actionLine } from "./action-line";
import { COMPONENT_OPEN, componentAttrs, componentBlockAt, noteCodeFences } from "./component-block";

/** The component's name. */
export const BUTTON_NAME = "button";

export interface ButtonStep { kind: "act" | "script"; source: string }

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
  /** The line couldn't be read as a button: what to write. */
  problem?: string;
}

/** Attributes a button reads itself; every other word is a slot of the script it runs (`of=`). */
const OWN = new Set(["label", "act", "of", "alt"]);

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

/** The `::button` starting at line `i`, or null. The body uses the shared component closing rule. */
export function buttonCallAt(lines: readonly string[], i: number): ButtonCall | null {
  const open = COMPONENT_OPEN.exec((lines[i] ?? "").replace(/\r$/, ""));
  if (!open || open[1] !== BUTTON_NAME) return null;
  const pairs = open[3] ? componentAttrs(open[3].slice(1, -1)).pairs : open[2] ? componentAttrs(open[2]).pairs : [];
  const get = (key: string) => pairs.find(p => p.key.toLowerCase() === key)?.value;
  const act = get("act")?.trim(), of = get("of")?.trim(), label = get("label")?.trim();
  const slots = pairs.filter(p => !OWN.has(p.key.toLowerCase()));
  const props: Record<string, string[]> = {};
  // Own keys only: a slot may be any word, `constructor` or `__proto__` included, and none reaches Object.prototype.
  if (of) for (const { key, value } of slots) {
    if (Object.hasOwn(props, key)) props[key]!.push(value);
    else Object.defineProperty(props, key, { value: [value], enumerable: true, writable: true, configurable: true });
  }
  const endLine = buttonBodyEnd(lines, i);
  let steps: ButtonStep[] = [], problem: string | undefined;
  try {
    if (endLine > i) {
      steps = lines.slice(i + 1, endLine).map(l => l.trim()).filter(Boolean).map(source => {
        const script = /^\(\((.+)\)\)$/.exec(source);
        return script ? { kind: "script", source: script[1]! } : { kind: "act", source };
      });
    } else if (act || of) {
      const value = (act || of)!;
      const values = value.startsWith("[") ? buttonList(value) : [value];
      steps = values.map(source => ({ kind: act ? "act" : "script", source: act ? source : actionLine({ action: source, args: Object.fromEntries(slots.map(p => [p.key, p.value])) }) }));
    }
  } catch (error) { problem = (error as Error).message; }
  if (!steps.length) problem ??= '::button needs what it runs: write one action or ((script)) per line, then ::, or use act= / of=';
  const line = steps.map(s => s.source).join("\n") || null;
  return { line: i, endLine, steps, props, sequence: endLine > i || !!(act || of)?.startsWith("["), label: label || steps[0]?.source.split(/\s+/)[0] || "button", act: line,
    ...(get("alt") ? { alt: get("alt") } : {}), ...(problem ? { problem } : {}) };
}

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
