// keys.probe (PIE-699): what a key arrived as. A terminal, Herdr or ssh in between may change or swallow a chord, and
// the only way to know is to look at the bytes that got here. The probe line shows them, the modifiers they carry, the
// key the door reads them as and whether the hyper layer is on, so a chord that never shows up here never reached the door.
import { hyperOn } from "./hyper";
import { parseReport } from "./kbd";
import { keyName } from "./surface/actions";
import type { Key } from "./term";

const MODS: [number, string][] = [[4, "⌃"], [2, "⌥"], [1, "⇧"], [8, "⌘"]];
/** The bytes shown readably: ESC as `ESC`, CSI as `CSI`, control bytes as `^X`. */
export function showBytes(seq: string): string {
  if (!seq) return "(bytes not available)";
  return seq.replace(/^\x1b\[/, "CSI ").replace(/^\x1b(?=.)/, "ESC ").replace(/^\x1b$/, "ESC").replace(/[\x00-\x1f\x7f]/g, c => (c === "\x7f" ? "DEL" : `^${String.fromCharCode(c.charCodeAt(0) + 64)}`));
}
/** The modifiers a key report carries as symbols (`⌃⌥⇧⌘`), "none", or null when the bytes are no key report. */
export function modsOf(seq: string): string | null {
  const r = parseReport(seq);
  if (!r) return null;
  const m = MODS.filter(([bit]) => r.mods & bit).map(([, s]) => s).join("");
  return m || "none";
}

/** The probe line for the key `k` that came as `seq`. */
export function describeKey(k: Key, seq: string): string {
  const mods = modsOf(seq);
  const name = keyName(k) ?? k.kind;
  const hyperSent = mods === "⌃⌥⇧⌘";
  const say = hyperSent && k.kind !== "hyper"
    ? `${name} (a hyper chord, read as ${name} because the layer is off: EP0CH_HYPER=1 or hyper.set on=true)`
    : k.kind === "hyper" ? `${name} (✦${k.ch}, the hyper layer${hyperOn() ? "" : " is off"})` : name;
  // What the door read comes first: that is the answer the person asked for. The bytes follow only when the door saw them;
  // a key handed on by a tile program (a terminal tile has the keys) arrives without them, and that says nothing about the
  // terminal's keyboard protocol (Nov 2: "read as hyper+a" sat after "no key report", read as a failure).
  if (!seq) return `✦ probe · ${say} reached the door · esc ends the probe`;
  const how = mods ? `modifiers ${mods}` : "a plain key (no Kitty key report for it)";
  return `✦ probe · ${say} reached the door · bytes ${showBytes(seq)} · ${how} · esc ends the probe`;
}
