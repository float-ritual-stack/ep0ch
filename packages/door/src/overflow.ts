import { printable } from "./text";
import { DRAWN_PART, OSC8_ALL, OSC8_CLOSE } from "./hyperlink";
import { headOf, pad, RESET, selected, tailFrom, visible, width } from "./style";

// Marks carry only a reference; hidden values never travel through composed drawing strings.
/** A cut-short value's or a button's mark opens with FULL_START (`\x1b[777;<selected>;<id>m`) and ends with FULL_END. */
export const FULL_START = "\x1b[777;";
export const FULL_END = "\x1b[778m";
export const FULL_MARKERS = /\x1b\[(?:777;[01];\d+|778)m/g;
interface Full { id: number; source: string; reveal?: string; lit?: string }
const values = new Map<string, Full>();
const byId = new Map<number, Full>();
let nextId = 0;

function revealText(value: Full): string {
  if (value.reveal !== undefined) return value.reveal;
  const plain = fullPlainText(value.source).replace(OSC8_ALL, "").replace(/\x1b\[[\d;]*m/g, "");
  let prefix = "", bytes = 0;
  for (const ch of plain) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > 4096) break;
    prefix += ch; bytes += n;
  }
  return value.reveal = prefix.length < plain.length ? `${prefix}… (${plain.length - prefix.length} more characters)` : plain;
}

export function fullValue(sequence: string): { readonly text: string; selected: boolean; lit?: string } | null {
  const match = /^\x1b\[777;([01]);(\d+)m$/.exec(sequence);
  const value = match && byId.get(Number(match[2]));
  return value ? { get text() { return revealText(value); }, selected: match![1] === "1", ...(value.lit !== undefined ? { lit: value.lit } : {}) } : null;
}
export function fullPlainText(text: string): string {
  return text.replace(/\x1b\[777;[01];(\d+)m[\s\S]*?\x1b\[778m/g,
    (drawn, id: string) => {
      const value = byId.get(Number(id));
      return value && value.lit === undefined ? fullPlainText(value.source) : drawn.replace(FULL_MARKERS, "");
    });
}
export function fullText(text: string, drawn: string, lit?: string): string {
  const key = lit === undefined ? text : `\0lit\0${lit}`;
  let value = values.get(key);
  if (!value) {
    value = { id: ++nextId, source: text, ...(lit !== undefined ? { lit } : {}) };
    values.set(key, value); byId.set(value.id, value);
    // Bound retained source references as screens and completions come and go.
    if (values.size > 1024) {
      const [oldKey, oldest] = values.entries().next().value!;
      values.delete(oldKey); byId.delete(oldest.id);
    }
  } else { values.delete(key); values.set(key, value); }
  return `\x1b[777;0;${value.id}m${drawn.replace(FULL_MARKERS, "")}${FULL_END}`;
}
/**
 * `drawn` brightened under the pointer (PIE-1287): the one hover rule for anything pressable (a button in a note, on the status
 * bar, in a float). `lit` is the style its cells take then; the frame is composed first, so only the cells still showing it
 * (not those a float covers) are restyled, wherever the drawing lands.
 */
export const litText = (drawn: string, lit: string): string => fullText("", drawn, lit);
export const clipText = (text: string, cells: number): string => width(text) > cells ? fullText(text, headOf(text, cells)) : text;
export const selectFullText = (text: string) => text.replaceAll("\x1b[777;0;", "\x1b[777;1;");

interface Cut { text: string; x: number; y: number; end: number; selected: boolean; lit?: string }

/** Clipping travels with the drawn cells, so composing a float also composes its hit targets. */
export class Overflow {
  private cuts: Cut[] = [];
  private pointer: { x: number; y: number } | null = null;
  private chosen: string | null = null;
  private keyboard = false;
  private active = "";
  private shown: Cut | undefined;
  private since = 0;
  private step = -1;
  private scrolling = false;

  /** The cut-short value at a cell, if any, as `draw` keys it: one answer for what the pointer reveals and whether that changed. */
  private cutAt(x: number, y: number): Cut | undefined { return this.cuts.find(c => c.y === y && x >= c.x && x < c.end); }
  targetAt(x: number, y: number): { text: string; rect: { col: number; row: number; cols: number; rows: number } } | null {
    const cut = this.cutAt(x, y);
    return cut && cut.lit === undefined ? { text: cut.text, rect: { col: cut.x, row: cut.y, cols: cut.end - cut.x, rows: 1 } } : null;
  }
  private static keyOf(cut: Cut | undefined): string { return cut ? `${cut.y}:${cut.x}:${cut.lit ?? cut.text}` : ""; }

  /**
   * The pointer moved to a cell. True when what it reveals is not what the last draw showed (a value came under it, or
   * it left one): the only time a redraw has anything new. A move inside the value already read, or across plain
   * cells, is false.
   */
  hover(x: number, y: number): boolean {
    this.pointer = { x, y }; this.chosen = null;
    return Overflow.keyOf(this.cutAt(x, y)) !== this.active;
  }
  /** Where the pointer rests and the value the last draw read in full, for `peek`. */
  describe(): { pointer: { x: number; y: number } | null; reading: { x: number; y: number } | null } {
    return { pointer: this.pointer ? { ...this.pointer } : null, reading: this.shown ? { x: this.shown.x, y: this.shown.y } : null };
  }
  clear() { this.pointer = null; this.chosen = null; this.keyboard = false; }
  keys() { this.clear(); this.keyboard = true; }
  reveal() {
    const choices = this.cuts.filter(c => c.lit === undefined).filter((c, i, all) => all.findIndex(v => v.text === c.text) === i);
    const at = choices.findIndex(c => c.text === this.chosen);
    const cut = choices[(at + 1) % choices.length];
    this.pointer = null; this.chosen = cut?.text ?? null;
    return { text: cut?.text ?? null };
  }
  tick(now: number): boolean {
    if (!this.active || !this.scrolling) return false;
    const step = Math.max(0, Math.floor((now - this.since - 900) / 100));
    return step !== this.step;
  }
  updateRow(line: string, y: number): { line: string; reading: boolean } {
    this.cuts = this.cuts.filter(c => c.y !== y);
    return { line: this.readRow(line, y), reading: this.active.startsWith(`${y}:`) };
  }
  private readRow(line: string, y: number): string {
    if (!line.includes("\x1b[777;")) return line;
    let x = 0, open: Cut | undefined;
    return line.split(DRAWN_PART).map(part => {
      const full = fullValue(part);
      if (full || part === FULL_END) {
        if (open) open.end = x;
        open = full ? { get text() { return full.text; }, selected: full.selected, ...(full.lit !== undefined ? { lit: full.lit } : {}), x, y, end: x } : undefined;
        if (open) this.cuts.push(open);
        return "";
      }
      if (!part.startsWith("\x1b")) x += width(part);
      if (open) open.end = x;
      return part;
    }).join("");
  }
  draw(lines: string[], cols: number, now: number): { lines: string[]; overlay?: { col: number; row: number; cols: number; rows: number } } {
    this.cuts = [];
    const clean = lines.map((line, y) => this.readRow(line, y));
    const p = this.pointer;
    const cut = p ? this.cutAt(p.x, p.y)
      : this.chosen ? this.cuts.find(c => c.text === this.chosen) : this.keyboard ? [...this.cuts].reverse().find(c => c.selected) : undefined;
    this.shown = cut;
    const key = Overflow.keyOf(cut);
    if (key !== this.active) { this.active = key; this.since = now; this.step = 0; }
    if (!cut) return { lines: clean };
    if (cut.lit !== undefined) {
      this.scrolling = false;
      const row = clean[cut.y] ?? "", cells = visible(headOf(tailFrom(row, cut.x), cut.end - cut.x));
      clean[cut.y] = headOf(row, cut.x) + OSC8_CLOSE + RESET + cut.lit + cells + RESET + tailFrom(row, cut.end);
      return { lines: clean };
    }
    this.step = Math.max(0, Math.floor((now - this.since - 900) / 100));
    const text = printable(visible(cut.text), " ").replace(/\s+/g, " ").trim();
    // In place: the value scrolls inside the cells it was cut to, on its own row, in the selection's colours (PIE-1140).
    const x = cut.x, y = cut.y, available = Math.max(1, cut.end - cut.x);
    const over = Math.max(0, width(text) - available);
    this.scrolling = over > 0;
    // Pause at both ends; even a message wider than the whole terminal can be read.
    const phase = this.step % (over + 20), offset = Math.min(over, phase);
    const label = selected() + pad(headOf(tailFrom(text, offset), available), available) + RESET;
    clean[y] = headOf(clean[y] ?? "", x) + OSC8_CLOSE + RESET + label + tailFrom(clean[y] ?? "", x + available);
    return { lines: clean, overlay: { col: x, row: y, cols: available, rows: 1 } };
  }
}
