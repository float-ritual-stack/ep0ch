// Raw terminal: alt screen, key decoding, capability replies, line-diffed painting.
import { KITTY_QUERY, kittyHint } from "./kitty";

export type Key =
  | { kind: "char"; ch: string; ctrl?: boolean }
  | { kind: "up" | "down" | "left" | "right" | "enter" | "alt-enter" | "esc" | "backspace" | "tab" | "backtab" | "pgup" | "pgdn" | "home" | "end" | "delete" }
  | { kind: "mouse"; action: "down" | "up" | "drag" | "wheel-up" | "wheel-down"; button: number; x: number; y: number };

export interface TermInfo { cols: number; rows: number; cellW: number; cellH: number; kitty: boolean }

export class Term {
  info: TermInfo = { cols: 80, rows: 25, cellW: 9, cellH: 18, kitty: false };
  private last: string[] = [];
  private keyHandler: (k: Key) => void = () => {};
  private resizeHandler: () => void = () => {};
  private pending = "";
  private decoder = new TextDecoder("utf-8");
  private probing: { kitty: boolean | null; done: () => void } | null = null;

  write = (s: string) => { process.stdout.write(s); };

  async start(): Promise<void> {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", (d: Buffer) => this.feed(this.decoder.decode(d, { stream: true })));
    process.stdout.on("resize", () => { this.measure(); this.last = []; this.resizeHandler(); });
    this.write("\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J\x1b[?1002h\x1b[?1006h");
    this.measure();
    const hint = kittyHint();
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.probing = null; resolve(); }, 400);
      this.probing = { kitty: null, done: () => { clearTimeout(timer); this.probing = null; resolve(); } };
      this.write(`\x1b[16t${hint === null ? KITTY_QUERY : "\x1b[c"}`);
    });
    if (hint !== null) this.info.kitty = hint;
  }

  stop(): void {
    this.write("\x1b[?1006l\x1b[?1002l\x1b[0m\x1b[2J\x1b[?7h\x1b[?25h\x1b[?1049l");
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
  }

  /** Take the terminal back after another program ($EDITOR) had it: alt screen, mouse, a full repaint. */
  resume(): void {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    this.pending = "";
    this.write("\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J\x1b[?1002h\x1b[?1006h");
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
      out += `\x1b[${r + 1};1H\x1b[0m\x1b[2K${line}\x1b[0m`;
    }
    this.last = lines.slice(0, this.info.rows);
    if (out) this.write(out);
  }

  invalidate() { this.last = []; }

  private feed(s: string) {
    this.pending += s;
    while (this.pending.length) {
      const p = this.pending;
      // Replies to our own queries.
      let m = p.match(/^\x1b_G([^\x1b]*)\x1b\\/);
      if (m) { if (this.probing && /i=31/.test(m[1]!)) { this.probing.kitty = /OK/.test(m[1]!); this.info.kitty = this.probing.kitty; } this.pending = p.slice(m[0].length); continue; }
      m = p.match(/^\x1b\[6;(\d+);(\d+)t/);
      if (m) { this.info.cellH = Number(m[1]); this.info.cellW = Number(m[2]); this.pending = p.slice(m[0].length); continue; }
      m = p.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (m) {
        const b = Number(m[1]), x = Number(m[2]) - 1, y = Number(m[3]) - 1;
        const action = b & 64 ? (b & 1 ? "wheel-down" : "wheel-up") : b & 32 ? "drag" : m[4] === "M" ? "down" : "up";
        this.pending = p.slice(m[0].length);
        this.keyHandler({ kind: "mouse", action, button: b & 3, x, y });
        continue;
      }
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
      ];
      let hit = false;
      for (const [re, key] of keys) {
        const k = p.match(re);
        if (k) { this.pending = p.slice(k[0].length); this.keyHandler(key); hit = true; break; }
      }
      if (hit) continue;
      if (p[0] === "\x1b" && (p[1] === "\r" || p[1] === "\n")) { this.pending = p.slice(2); this.keyHandler({ kind: "alt-enter" }); continue; }
      if (p[0] === "\x1b") { // unknown sequence: drop it
        const k = p.match(/^\x1b\[[\d;?]*[ -\/]*[@-~]/);
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
      else if (code < 32) this.keyHandler({ kind: "char", ch: String.fromCharCode(code + 96), ctrl: true });
      else this.keyHandler({ kind: "char", ch: c });
    }
  }
}
