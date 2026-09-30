// Raw terminal: alt screen, key decoding, capability replies, line-diffed painting.
import { KITTY_QUERY, kittyHint } from "./kitty";
import { visible } from "./style";

export type Key =
  | { kind: "char"; ch: string; ctrl?: boolean }
  /** Alt (Meta) with a printable key: ESC then the character in one read. Its own kind, so no plain-key handler mistakes it for the letter. */
  | { kind: "alt"; ch: string }
  | { kind: "up" | "down" | "left" | "right" | "enter" | "alt-enter" | "esc" | "backspace" | "tab" | "backtab" | "pgup" | "pgdn" | "home" | "end" | "delete" }
  /**
   * alt+← and alt+→ (CSI 1;3 D/C, CSI 1;9 D/C, or ESC before the arrow); `back` and `forward` are the mouse's
   * side buttons (8 and 9). Readers go back and forward on them (PIE-453); they're keys, acting where the keys go.
   */
  | { kind: "alt-left" | "alt-right" | "back" | "forward" }
  /** `mods`: the SGR modifier bits held (4 shift, 8 alt/meta, 16 ctrl); a mod-click opens elsewhere (PIE-473). */
  | { kind: "mouse"; action: "down" | "up" | "drag" | "wheel-up" | "wheel-down"; button: number; x: number; y: number; mods?: number }
  /** A paste (bracketed paste, mode 2004): the text as one piece. Screens that don't take it whole get it as keys (App). */
  | { kind: "paste"; text: string };

/** Everything `start` turns on, turned off: paste, mouse, colours, wrap, the cursor, then the normal screen. */
export const TERM_RESET = "\x1b[?2004l\x1b[?1006l\x1b[?1002l\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l";

/**
 * A watcher for the one exit the door can't handle itself (kill -9): a small shell reading a pipe from the
 * door (it never writes to it). The pipe closes when the door ends; the watcher then sends TERM_RESET and `stty sane`, so the
 * terminal is usable again. The door dismisses it (SIGKILL, synchronous) when it restores the terminal itself.
 */
function terminalGuard(): { dismiss(): void } | null {
  try {
    const p = Bun.spawn(["sh", "-c", `trap '' INT QUIT HUP TERM; read -r _; printf '%s' "$EP0CH_TERM_RESET"; stty sane </dev/tty 2>/dev/null`], {
      stdin: "pipe", stdout: "inherit", stderr: "ignore", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", EP0CH_TERM_RESET: TERM_RESET },
    });
    p.unref();
    // Through the Subprocess, which knows when it has exited: never a signal to a pid the OS reused. `read` is
    // the shell's own, so the kill ends the whole watcher (a `cat` would be left behind, one per $EDITOR run);
    // then the pipe is closed, so no descriptor is kept for it.
    return { dismiss() { try { p.kill("SIGKILL"); } catch { /* it's gone */ } try { p.stdin.end(); } catch { /* closed */ } } };
  } catch { return null; }
}

export interface TermInfo { cols: number; rows: number; cellW: number; cellH: number; kitty: boolean }

export class Term {
  info: TermInfo = { cols: 80, rows: 25, cellW: 9, cellH: 18, kitty: false };
  private last: string[] = [];
  private keyHandler: (k: Key) => void = () => {};
  private resizeHandler: () => void = () => {};
  private pending = "";
  private decoder = new TextDecoder("utf-8");
  private probing: { kitty: boolean | null; done: () => void } | null = null;

  /** What a frame in progress has written so far (null outside `frame`); sent as one chunk when it ends. */
  private frameOut: string | null = null;
  write = (s: string) => { if (this.frameOut !== null) this.frameOut += s; else process.stdout.write(s); };

  /**
   * Everything `draw` writes goes out as one synchronized update (DEC mode 2026), in one write: the terminal,
   * and Herdr in between, show the frame whole or not at all, never half painted (PIE-462). Nested frames
   * join the outer one. `draw` must be synchronous: the frame is sent when it returns.
   */
  frame(draw: () => void): void {
    if (this.frameOut !== null) return draw();
    this.frameOut = "";
    try {
      draw();
    } finally {
      const out = this.frameOut;
      this.frameOut = null;
      if (out) process.stdout.write(`\x1b[?2026h${out}\x1b[?2026l`);
    }
  }

  private guard: { dismiss(): void } | null = null;

  async start(): Promise<void> {
    this.guard = terminalGuard();
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", (d: Buffer) => this.feed(this.decoder.decode(d, { stream: true })));
    process.stdout.on("resize", () => { this.measure(); this.last = []; this.resizeHandler(); });
    this.write("\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J\x1b[?1002h\x1b[?1006h\x1b[?2004h");
    this.measure();
    const hint = kittyHint();
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.probing = null; resolve(); }, 400);
      this.probing = { kitty: null, done: () => { clearTimeout(timer); this.probing = null; resolve(); } };
      this.write(`\x1b[16t${hint === null ? KITTY_QUERY : "\x1b[c"}`);
    });
    if (hint !== null) this.info.kitty = hint;
  }

  /**
   * Put the terminal back. Each step on its own: when the terminal has gone (an ssh connection dropped),
   * the writes fail, and what the door does after stopping (drafts, the socket, the last call) still runs.
   */
  stop(): void {
    try { this.write(`\x1b[2J${TERM_RESET}`); } catch { /* no terminal to reset */ }
    try { process.stdin.setRawMode?.(false); } catch { /* the same */ }
    try { process.stdin.pause(); } catch { /* the same */ }
    this.guard?.dismiss(); this.guard = null;
  }

  /** Take the terminal back after another program ($EDITOR) had it: alt screen, mouse, a full repaint. */
  resume(): void {
    this.guard ??= terminalGuard();
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    this.pending = "";
    this.write("\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J\x1b[?1002h\x1b[?1006h\x1b[?2004h");
    this.measure();
    this.invalidate();
  }

  onKey(fn: (k: Key) => void) { this.keyHandler = fn; }
  onResize(fn: () => void) { this.resizeHandler = fn; }

  private measure() {
    this.info.cols = process.stdout.columns || 80;
    this.info.rows = process.stdout.rows || 25;
  }

  /** Paint full-screen lines; only rows that changed are rewritten. */
  paint(lines: string[]): void {
    let out = "";
    for (let r = 0; r < this.info.rows; r++) {
      const line = lines[r] ?? "";
      if (this.last[r] === line) continue;
      out += this.row(r, line);
    }
    this.last = lines.slice(0, this.info.rows);
    if (out) this.frame(() => this.write(out));
  }

  /**
   * Repaint one row alone (the status bar's clock, PIE-420): nothing else is written, so an edit, a
   * selection, a drag or a Kitty placement elsewhere on screen is untouched, and the next paint's diff
   * knows the row as it is now.
   */
  paintRow(r: number, line: string): void {
    if (r < 0 || r >= this.info.rows || this.last[r] === line) return;
    this.last[r] = line;
    this.frame(() => this.write(this.row(r, line)));
  }

  private row(r: number, line: string): string { return rowBytes(r, line, this.info.cols); }

  invalidate() { this.last = []; }

  /**
   * Where raw input goes while the person types in a terminal tile (PIE-417): every byte as the terminal sent
   * it (F-keys, shift- and ctrl-arrows, Insert, a bracketed paste), but mouse reports and the escape chord
   * (ctrl+], 0x1d), which stay the door's. Null: decode keys as usual.
   */
  rawSink: (() => ((bytes: string) => void) | null) | null = null;

  private mouseKey(m: RegExpMatchArray) {
    const b = Number(m[1]), x = Number(m[2]) - 1, y = Number(m[3]) - 1;
    // The side buttons (8 back, 9 forward) set bit 128; read as a plain button they'd be a left click.
    if (b & 128) { if (m[4] === "M" && !(b & 32)) this.keyHandler({ kind: b & 1 ? "forward" : "back" }); return; }
    const action = b & 64 ? (b & 1 ? "wheel-down" : "wheel-up") : b & 32 ? "drag" : m[4] === "M" ? "down" : "up";
    this.keyHandler({ kind: "mouse", action, button: b & 3, x, y, ...(b & 28 ? { mods: b & 28 } : {}) });
  }

  /** Raw bytes to `sink` up to the next mouse report or escape chord; false when it must wait for more. */
  private feedRaw(sink: (bytes: string) => void): boolean {
    const p = this.pending;
    let i = 0;
    while (i < p.length) {
      if (p[i] === "\x1d") break;
      if (p.startsWith("\x1b[<", i)) {
        if (/^\x1b\[<\d+;\d+;\d+[Mm]/.test(p.slice(i))) break;
        if (/^\x1b\[<[\d;]*$/.test(p.slice(i))) { if (i) sink(p.slice(0, i)); this.pending = p.slice(i); return false; }
      }
      i++;
    }
    if (i) sink(p.slice(0, i));
    this.pending = p.slice(i);
    if (!this.pending) return true;
    if (this.pending[0] === "\x1d") { this.pending = this.pending.slice(1); this.keyHandler({ kind: "char", ch: "]", ctrl: true }); return true; }
    const m = this.pending.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/)!;
    this.pending = this.pending.slice(m[0].length);
    this.mouseKey(m);
    return true;
  }

  private feed(s: string) {
    this.pending += s;
    while (this.pending.length) {
      const sink = this.rawSink?.();
      if (sink) { if (!this.feedRaw(sink)) return; continue; }
      const p = this.pending;
      // A bracketed paste: the text between the markers is one piece (it may still be arriving).
      if (p.startsWith("\x1b[200~")) {
        const end = p.indexOf("\x1b[201~");
        if (end < 0) return;
        this.pending = p.slice(end + 6);
        this.keyHandler({ kind: "paste", text: p.slice(6, end) });
        continue;
      }
      // Replies to our own queries.
      let m = p.match(/^\x1b_G([^\x1b]*)\x1b\\/);
      if (m) { if (this.probing && /i=31/.test(m[1]!)) { this.probing.kitty = /OK/.test(m[1]!); this.info.kitty = this.probing.kitty; } this.pending = p.slice(m[0].length); continue; }
      m = p.match(/^\x1b\[6;(\d+);(\d+)t/);
      if (m) { this.info.cellH = Number(m[1]); this.info.cellW = Number(m[2]); this.pending = p.slice(m[0].length); continue; }
      m = p.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (m) { this.pending = p.slice(m[0].length); this.mouseKey(m); continue; }
      m = p.match(/^\x1b\[\?[\d;]*c/);
      if (m) { this.probing?.done(); this.pending = p.slice(m[0].length); continue; }
      if (/^\x1b(\[[<\d;?]*|_[^\x1b]*|_[^\x1b]*\x1b)?$/.test(p) && p.length < 64) {
        // Incomplete escape: wait briefly for the rest, then treat a lone ESC as Escape.
        setTimeout(() => { if (this.pending === p) { this.pending = ""; if (p === "\x1b") this.keyHandler({ kind: "esc" }); } }, 30);
        return;
      }
      const keys: [RegExp, Key][] = [
        [/^\x1b\[A|^\x1bOA/, { kind: "up" }], [/^\x1b\[B|^\x1bOB/, { kind: "down" }],
        [/^\x1b\[C|^\x1bOC/, { kind: "right" }], [/^\x1b\[D|^\x1bOD/, { kind: "left" }],
        [/^\x1b\[Z/, { kind: "backtab" }], [/^\x1b\[5~/, { kind: "pgup" }], [/^\x1b\[6~/, { kind: "pgdn" }],
        [/^\x1b\[3~/, { kind: "delete" }], [/^\x1b\[H|^\x1b\[1~|^\x1bOH/, { kind: "home" }], [/^\x1b\[F|^\x1b\[4~|^\x1bOF/, { kind: "end" }],
        [/^\x1b\[1;[39]D|^\x1b\x1b\[D/, { kind: "alt-left" }], [/^\x1b\[1;[39]C|^\x1b\x1b\[C/, { kind: "alt-right" }],
      ];
      let hit = false;
      for (const [re, key] of keys) {
        const k = p.match(re);
        if (k) { this.pending = p.slice(k[0].length); this.keyHandler(key); hit = true; break; }
      }
      if (hit) continue;
      if (p[0] === "\x1b" && (p[1] === "\r" || p[1] === "\n")) { this.pending = p.slice(2); this.keyHandler({ kind: "alt-enter" }); continue; }
      // Alt+letter or digit arrives as ESC and the key together. `[ O P _ ]` start CSI, SS3, DCS, APC and OSC
      // sequences, so an ESC before one of them keeps its old meaning.
      if (p[0] === "\x1b" && p.length >= 2 && /^[A-NQ-Za-z0-9]$/.test(p[1]!)) { this.pending = p.slice(2); this.keyHandler({ kind: "alt", ch: p[1]! }); continue; }
      if (p[0] === "\x1b") { // unknown sequence: drop it
        // A CSI's private marker (< = > ?) is part of it: a mouse report the door couldn't read is dropped whole, not read as esc and keys.
        const k = p.match(/^\x1b\[[<=>?]?[\d;:?]*[ -\/]*[@-~]/);
        this.pending = p.slice(k ? k[0].length : 1);
        if (!k) this.keyHandler({ kind: "esc" });
        continue;
      }
      // A character outside the BMP arrives as a surrogate pair; keep the pair together.
      const hi = p.charCodeAt(0) >= 0xd800 && p.charCodeAt(0) <= 0xdbff;
      if (hi && p.length < 2) return;
      const c = hi ? p.slice(0, 2) : p[0]!;
      this.pending = p.slice(c.length);
      const code = c.charCodeAt(0);
      if (c === "\r" || c === "\n") this.keyHandler({ kind: "enter" });
      else if (c === "\t") this.keyHandler({ kind: "tab" });
      else if (code === 127 || code === 8) this.keyHandler({ kind: "backspace" });
      // ctrl+\ ] ^ _ are 28-31: named as the keys pressed (ctrl+] leaves a terminal tile, PIE-417).
      else if (code >= 28 && code < 32) this.keyHandler({ kind: "char", ch: "\\]^_"[code - 28]!, ctrl: true });
      else if (code < 32) this.keyHandler({ kind: "char", ch: String.fromCharCode(code + 96), ctrl: true });
      else this.keyHandler({ kind: "char", ch: c });
    }
  }
}

/**
 * The bytes that paint one row: its text first, then an erase of whatever is left to its right. Erasing the
 * whole row first left it black until the text arrived, and a terminal could show that (PIE-462). Autowrap
 * is off, so an erase from the last column would take the last character: a row that fills the width gets
 * none. Filling is measured in terminal cells (wide and joined characters, combining marks), not characters.
 */
export function rowBytes(r: number, line: string, cols: number): string {
  return `\x1b[${r + 1};1H\x1b[0m${line}\x1b[0m${Bun.stringWidth(visible(line)) >= cols ? "" : "\x1b[K"}`;
}
