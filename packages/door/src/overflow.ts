import { printable } from "./text";
import { DRAWN_PART, OSC8_ALL, OSC8_CLOSE } from "./hyperlink";
import { C, fg, headOf, pad, RESET, tailFrom, visible, width } from "./style";

// Internal drawing marks, consumed by Canvas and App; the terminal sink removes them too.
export const FULL_END = "\x1b[778m";
export const FULL_MARKERS = /\x1b\[(?:777;[01];[\d;]*|778)m/g;
export function fullValue(sequence: string): { text: string; selected: boolean } | null {
  const match = /^\x1b\[777;([01]);([\d;]*)m$/.exec(sequence);
  return match ? { text: match[2]!.split(";").map(n => String.fromCodePoint(Number(n))).join(""), selected: match[1] === "1" } : null;
}
export function fullPlainText(text: string): string {
  return text.replace(/\x1b\[777;[01];([\d;]*)m[\s\S]*?\x1b\[778m/g,
    (_, value: string) => value.split(";").map(n => String.fromCodePoint(Number(n))).join(""));
}
export function fullText(text: string, drawn: string): string {
  const plain = fullPlainText(text).replace(OSC8_ALL, "").replace(/\x1b\[[\d;]*m/g, "");
  const codes = [...plain].map(c => c.codePointAt(0)).join(";");
  return `\x1b[777;0;${codes}m${drawn.replace(FULL_MARKERS, "")}${FULL_END}`;
}
export const clipText = (text: string, cells: number): string => width(text) > cells ? fullText(text, headOf(text, cells)) : text;
export const selectFullText = (text: string) => text.replaceAll("\x1b[777;0;", "\x1b[777;1;");

interface Cut { text: string; x: number; y: number; end: number; selected: boolean }

/** Clipping travels with the drawn cells, so composing a float also composes its hit targets. */
export class Overflow {
  private cuts: Cut[] = [];
  private pointer: { x: number; y: number } | null = null;
  private chosen: string | null = null;
  private keyboard = false;
  private active = "";
  private since = 0;
  private step = -1;
  private scrolling = false;

  hover(x: number, y: number) { this.pointer = { x, y }; this.chosen = null; }
  clear() { this.pointer = null; this.chosen = null; this.keyboard = false; }
  keys() { this.clear(); this.keyboard = true; }
  reveal() {
    const choices = this.cuts.filter((c, i, all) => all.findIndex(v => v.text === c.text) === i);
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
        open = full ? { ...full, x, y, end: x } : undefined;
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
    const cut = p ? this.cuts.find(c => c.y === p.y && p.x >= c.x && p.x < c.end)
      : this.chosen ? this.cuts.find(c => c.text === this.chosen) : this.keyboard ? [...this.cuts].reverse().find(c => c.selected) : undefined;
    const key = cut ? `${cut.y}:${cut.x}:${cut.text}` : "";
    if (key !== this.active) { this.active = key; this.since = now; this.step = 0; }
    if (!cut) return { lines: clean };
    this.step = Math.max(0, Math.floor((now - this.since - 900) / 100));
    const text = printable(visible(cut.text), " ").replace(/\s+/g, " ").trim();
    const inline = cut.y === clean.length - 1, x = inline ? cut.x : 1;
    const available = inline ? cut.end - cut.x : cols - 2;
    const w = Math.max(1, available - 2), over = Math.max(0, width(text) - w);
    this.scrolling = over > 0;
    // Pause at both ends; even a message wider than the whole terminal can be read.
    const phase = this.step % (over + 20), offset = Math.min(over, phase);
    const shown = headOf(tailFrom(text, offset), w);
    const y = cut.y === clean.length - 1 ? cut.y : cut.y + 1 < clean.length - 1 ? cut.y + 1 : Math.max(0, cut.y - 1);
    const label = fg(C.white) + pad(` ${shown} `, available) + RESET;
    clean[y] = headOf(clean[y] ?? "", x) + OSC8_CLOSE + RESET + label + tailFrom(clean[y] ?? "", x + available);
    return { lines: clean, overlay: { col: x, row: y, cols: available, rows: 1 } };
  }
}
