// The Kitty keyboard protocol (https://sw.kovidgoyal.net/kitty/keyboard-protocol/), both sides of the door.
//
// Legacy encoding sends Enter and Shift+Enter alike (`\r`), so Shift is lost. A program that asks its terminal
// for the protocol (`CSI > flags u`) is told Shift+Enter as `CSI 13;2u`, Esc as `CSI 27u`, ctrl+c as `CSI 99;5u`.
// - Outward (src/term.ts): the door asks the terminal it runs in for it, reads its reports as keys, and gives
//   it back on every exit and suspend (TERM_RESET).
// - Inward (src/desk/pty.ts): the door is a terminal tile's terminal. `KbdModes` follows what the program asked
//   for (push, pop, set; its `CSI ? u` query is answered), and the person's keys reach it encoded that way:
//   the report as it came when the program asked for the protocol, legacy bytes when it didn't (Shift+Enter
//   as `ESC CR`, as alt+enter: a newline in Claude Code and most line editors).
import type { Key } from "./term";

/** What the door asks for: 1 disambiguate escape codes, 4 report alternate keys (alt+shift+1 says `!`). */
export const KBD_FLAGS = 5;
/** The support query: a terminal with the protocol answers `CSI ? flags u` (before its DA reply). */
export const KBD_QUERY = "\x1b[?u";
export const KBD_PUSH = `\x1b[>${KBD_FLAGS}u`;
/** Pops one entry; harmless when nothing was pushed, and ignored by a terminal without the protocol. */
export const KBD_POP = "\x1b[<u";

/** Whether to ask the terminal for the protocol: `EP0CH_KEYBOARD=legacy` (or off) keeps the old encoding. */
export function kbdWanted(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.EP0CH_KEYBOARD?.trim().toLowerCase();
  return !(v === "legacy" || v === "off" || v === "0" || v === "no");
}

/** One key report. `mods`: the modifier bits (1 shift, 2 alt, 4 ctrl, 8 super, 64 caps lock, 128 num lock); 0 none. */
export interface KeyReport { code: number; shifted?: number; base?: number; mods: number; event: number }

/**
 * A key report: `CSI code[:shifted[:base]] [; mods[:event] [; text]] u`, or xterm's modifyOtherKeys form
 * `CSI 27 ; mods ; code ~` (tmux and Herdr can send it). The query reply (`CSI ? flags u`) isn't one.
 */
const REPORT = String.raw`\x1b\[(?:(\d+)(?::(\d*))?(?::(\d*))?(?:;(\d*)(?::(\d+))?)?(?:;[\d:]*)?u|27;(\d+);(\d+)~)`;
export const REPORT_AT = new RegExp(`^${REPORT}`);
const REPORTS = new RegExp(REPORT, "g");

/** The report `seq` starts with, or null. */
export function parseReport(seq: string): (KeyReport & { length: number }) | null {
  const m = REPORT_AT.exec(seq);
  if (!m) return null;
  if (m[6] !== undefined) return { code: Number(m[7]), mods: Math.max(0, Number(m[6]) - 1), event: 1, length: m[0].length };
  const num = (s: string | undefined) => (s ? Number(s) : undefined);
  return { code: Number(m[1]), shifted: num(m[2]), base: num(m[3]), mods: Math.max(0, (num(m[4]) ?? 1) - 1), event: num(m[5]) ?? 1, length: m[0].length };
}

const SHIFT = 1, ALT = 2, CTRL = 4, SUPER = 8;

/**
 * The keypad's private-use codes (sent under flag 1 for keys that type no text, and some terminals send them
 * for all keypad keys): the key each one stands for, as the codepoint of its text or the key itself.
 */
const KEYPAD: Record<number, number | Key> = {
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [57399 + i, 48 + i])),
  57409: 46, 57410: 47, 57411: 42, 57412: 45, 57413: 43, 57414: 13, 57415: 61, 57416: 44,
  57417: { kind: "left" }, 57418: { kind: "right" }, 57419: { kind: "up" }, 57420: { kind: "down" },
  57421: { kind: "pgup" }, 57422: { kind: "pgdn" }, 57423: { kind: "home" }, 57424: { kind: "end" }, 57426: { kind: "delete" },
};
/** Keypad Insert: no key of the door's, but a program gets its legacy bytes. */
const KP_INSERT = 57425;

/**
 * A report as the door's key. Shift+Enter is Enter with `shift` (Enter wherever nothing binds it; a plain line
 * break in a draft); ctrl+[ i m j h keep their legacy meanings (esc, tab, enter, backspace), which the door has
 * always read them as. Super (cmd) with a printable key is its own kind, whatever else is held: cmd+c is the
 * door's copy, never a `c` typed. A release, a lone modifier or a key the door has no name for is null.
 */
export function reportKey(r: KeyReport): Key | null {
  if (r.event === 3) return null;
  const kp = KEYPAD[r.code];
  if (typeof kp === "object") return kp;
  if (typeof kp === "number") r = { ...r, code: kp, shifted: undefined };
  const m = r.mods & 15, shift = !!(m & SHIFT), alt = !!(m & ALT), ctrl = !!(m & CTRL);
  switch (r.code) {
    case 13: return alt ? { kind: "alt-enter" } : { kind: "enter", ...(shift ? { shift: true as const } : {}), ...(ctrl ? { ctrl: true as const } : {}) };
    case 27: return { kind: "esc" };
    case 9: return shift ? { kind: "backtab" } : { kind: "tab" };
    case 8: case 127: return { kind: "backspace" };
  }
  if (r.code < 32 || (r.code >= 0xe000 && r.code <= 0xf8ff) || r.code > 0x10ffff) return null;   // PUA: keypad and modifier keys
  const plain = String.fromCodePoint(r.code);
  if (m & SUPER) return { kind: "super", ch: shift ? (r.shifted ? String.fromCodePoint(r.shifted) : plain.toUpperCase()) : plain.toLowerCase() };
  if (ctrl) {
    // A letter is its lowercase, as legacy ctrl was; punctuation is what shift made of it (ctrl+_ is ctrl+shift+-).
    const c = /^[a-z]$/i.test(plain) ? plain.toLowerCase() : shift && r.shifted ? String.fromCodePoint(r.shifted) : plain;
    if (!alt) {
      if (c === "[") return { kind: "esc" };
      if (c === "i") return { kind: "tab" };
      if (c === "m" || c === "j") return { kind: "enter" };
      if (c === "h") return { kind: "backspace" };
    }
    return { kind: "char", ch: c, ctrl: true };
  }
  const ch = shift ? (r.shifted ? String.fromCodePoint(r.shifted) : plain.toUpperCase()) : plain;
  return alt ? { kind: "alt", ch } : { kind: "char", ch };
}

/**
 * A raw piece the door holds back in a terminal tile (`Term.feedRaw` sends each key report alone): the key it is,
 * as a report or as legacy ESC-and-a-letter (alt+a), so the dock's alt+a and ctrl+] are seen either way.
 */
export function rawKey(s: string): Key | null {
  const r = parseReport(s);
  if (r) return r.length === s.length ? reportKey(r) : null;
  return s.length === 2 && s[0] === "\x1b" && /^[A-Za-z0-9]$/.test(s[1]!) ? { kind: "alt", ch: s[1]! } : null;
}

/** The report for a program with the protocol on, carrying only what its `flags` asked for. */
export function kittyBytes(r: KeyReport, flags: number): string {
  if (r.event === 3 && !(flags & 2)) return "";
  let s = `\x1b[${r.code}`;
  if (flags & 4 && (r.shifted || r.base)) s += `:${r.shifted ?? ""}${r.base ? `:${r.base}` : ""}`;
  const ev = flags & 2 && r.event > 1 ? `:${r.event}` : "";
  if (r.mods || ev) s += `;${r.mods + 1}${ev}`;
  return `${s}u`;
}

/**
 * The report as a legacy terminal sends it (to a program that didn't ask for the protocol). Super (cmd) keys have
 * no legacy bytes, as a legacy terminal sends none for them: cmd+c never reaches such a program as a typed `c`.
 */
export function legacyBytes(r: KeyReport): string {
  if (r.event === 3) return "";
  if (r.code === KP_INSERT) return "\x1b[2~";
  const alt = !!(r.mods & ALT);
  const k = reportKey({ ...r, mods: r.mods & ~ALT });
  const s = k ? keyBytes(k) : null;
  if (s === null) return "";
  return alt && !s.startsWith("\x1b") ? `\x1b${s}` : s;
}

/** Every report in `s` re-encoded for a program whose protocol flags are `flags` (0: legacy); the rest as it came. */
export function translateReports(s: string, flags: number): string {
  if (!s.includes("\x1b[")) return s;
  return s.replace(REPORTS, seq => { const r = parseReport(seq); return !r ? seq : flags ? kittyBytes(r, flags) : legacyBytes(r); });
}

/** Legacy ctrl with a key that isn't a letter, as xterm sends it (ctrl+/ and ctrl+_ are both 0x1f, ctrl+2 is NUL). */
const CTRL_BYTES: Record<string, string> = {
  "@": "\x00", " ": "\x00", "2": "\x00", "[": "\x1b", "3": "\x1b", "\\": "\x1c", "4": "\x1c", "]": "\x1d", "5": "\x1d",
  "^": "\x1e", "6": "\x1e", "_": "\x1f", "/": "\x1f", "-": "\x1f", "7": "\x1f", "?": "\x7f", "8": "\x7f",
};

/**
 * The bytes a terminal sends for `k` (null: none) to a program whose protocol flags are `flags`. Application
 * cursor mode sends arrows as SS3. Plain Enter is always `\r`. Shift+Enter is `CSI 13;2u` with the protocol,
 * `ESC CR` without (as alt+enter); ctrl+Enter is `CSI 13;5u`, or `\r`.
 */
export function keyBytes(k: Key, appCursor = false, flags = 0): string | null {
  const arrow = (c: string) => (appCursor ? `\x1bO${c}` : `\x1b[${c}`);
  const kitty = !!(flags & 1);
  switch (k.kind) {
    case "char": {
      if (!k.ctrl) return k.ch;
      if (kitty) return `\x1b[${k.ch.toLowerCase().codePointAt(0)};5u`;
      const c = k.ch.toLowerCase();
      if (c >= "a" && c <= "z") return String.fromCharCode(c.charCodeAt(0) - 96);
      return CTRL_BYTES[k.ch] ?? null;
    }
    case "alt": {
      if (!kitty) return `\x1b${k.ch}`;
      const lower = k.ch.toLowerCase(), upper = lower !== k.ch;
      return `\x1b[${lower.codePointAt(0)}${upper && flags & 4 ? `:${k.ch.codePointAt(0)}` : ""};${upper ? 4 : 3}u`;
    }
    case "enter": {
      if (!("shift" in k || "ctrl" in k)) return "\r";
      const shift = "shift" in k && k.shift, ctrl = "ctrl" in k && k.ctrl;
      if (kitty) return `\x1b[13;${1 + (shift ? SHIFT : 0) + (ctrl ? CTRL : 0)}u`;
      return shift ? "\x1b\r" : "\r";
    }
    case "super": {
      // A program with the protocol gets cmd+c as the terminal reported it; a legacy one nothing, as from a legacy terminal.
      if (!kitty) return null;
      const lower = k.ch.toLowerCase(), upper = lower !== k.ch;
      return `\x1b[${lower.codePointAt(0)}${upper && flags & 4 ? `:${k.ch.codePointAt(0)}` : ""};${upper ? 10 : 9}u`;
    }
    case "alt-enter": return kitty ? "\x1b[13;3u" : "\x1b\r";
    case "esc": return kitty ? "\x1b[27u" : "\x1b";
    case "backspace": return "\x7f";
    case "tab": return "\t";
    case "backtab": return "\x1b[Z";
    case "up": return arrow("A");
    case "down": return arrow("B");
    case "right": return arrow("C");
    case "left": return arrow("D");
    case "home": return appCursor ? "\x1bOH" : "\x1b[H";
    case "end": return appCursor ? "\x1bOF" : "\x1b[F";
    case "pgup": return "\x1b[5~";
    case "pgdn": return "\x1b[6~";
    case "delete": return "\x1b[3~";
    case "alt-left": return "\x1b[1;3D";
    case "alt-right": return "\x1b[1;3C";
    case "alt-up": return "\x1b[1;3A";
    case "alt-down": return "\x1b[1;3B";
    default: return null;
  }
}

/**
 * The protocol as a terminal tile's program asked for it: a stack per screen (main and alternate are separate),
 * `CSI > f u` push, `CSI < n u` pop, `CSI = f ; mode u` set, `ESC c` resets. @xterm/headless knows none of it,
 * so the program's output is read here as it goes by; a sequence split across reads is kept until it's whole.
 */
export class KbdModes {
  private main: number[] = [];
  private alt: number[] = [];
  private onAlt = false;
  private tail = "";

  /** The flags in effect: 0 is legacy. */
  get flags(): number { return (this.onAlt ? this.alt : this.main).at(-1) ?? 0; }

  reset() { this.main = []; this.alt = []; this.onAlt = false; this.tail = ""; }

  /** Read the program's output; returns what the door answers it (its `CSI ? u` query), or "". */
  observe(s: string): string {
    let text = this.tail + s;
    this.tail = "";
    const cut = /\x1b(\[[<>=?]?[\d;:]*)?$/.exec(text);
    if (cut && cut[0].length < 32) { this.tail = cut[0]; text = text.slice(0, cut.index); }
    let reply = "";
    for (const m of text.matchAll(/\x1b\[([<>=?]?)([\d;]*)([hlu])|\x1bc/g)) {
      if (m[0] === "\x1bc") { this.reset(); continue; }
      const [, mark, params = "", fin] = m;
      const stack = this.onAlt ? this.alt : this.main;
      if (fin !== "u") {
        if (mark === "?" && params.split(";").some(p => p === "1049" || p === "1047" || p === "47")) {
          const on = fin === "h";
          if (on && !this.onAlt) this.alt = [];
          this.onAlt = on;
        }
        continue;
      }
      if (mark === "?" && !params) reply += `\x1b[?${this.flags}u`;
      else if (mark === ">") { stack.push(Number(params.split(";")[0] || 0) & 31); if (stack.length > 32) stack.shift(); }
      else if (mark === "<") stack.splice(Math.max(0, stack.length - Math.max(1, Number(params || 1))));
      else if (mark === "=") {
        const [f = "0", mode = "1"] = params.split(";");
        const v = Number(f || 0) & 31, cur = stack.at(-1) ?? 0;
        const next = mode === "2" ? cur | v : mode === "3" ? cur & ~v : v;
        if (stack.length) stack[stack.length - 1] = next; else stack.push(next);
      }
    }
    return reply;
  }
}
