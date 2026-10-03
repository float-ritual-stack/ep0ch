// Raw terminal: alt screen, key decoding, capability replies, line-diffed painting.
import { KITTY_QUERY, kittyHint } from "./kitty";
import { KBD_POP, KBD_PUSH, KBD_QUERY, kbdWanted, parseReport, REPORT_AT, reportKey } from "./kbd";
import { visible } from "./style";
import { paintable } from "./text";

export type Key =
  /** `pasted`: it came inside a paste typed out as keys (App): a draft takes it as it came. */
  | { kind: "char"; ch: string; ctrl?: boolean; pasted?: true }
  /** Alt (Meta) with a printable key: ESC then the character in one read. Its own kind, so no plain-key handler mistakes it for the letter. */
  | { kind: "alt"; ch: string }
  /**
   * Super (cmd on a Mac) with a printable key, as only the Kitty keyboard protocol reports it (src/kbd.ts; Ghostty
   * passes cmd+c on when it has no selection of its own). Its own kind: cmd+c is never the plain `c`.
   */
  | { kind: "super"; ch: string }
  | { kind: "up" | "down" | "left" | "right" | "alt-enter" | "esc" | "backspace" | "tab" | "backtab" | "pgup" | "pgdn" | "home" | "end" | "delete" }
  /**
   * Enter. `shift`, `ctrl`: held with it, as only a terminal speaking the Kitty keyboard protocol can say (src/kbd.ts).
   * It's Enter wherever nothing reads them; in a draft Shift+Enter is a plain line break, as alt+enter.
   */
  | { kind: "enter"; shift?: true; ctrl?: true }
  /**
   * alt+← and alt+→ (CSI 1;3 D/C, CSI 1;9 D/C, or ESC before the arrow); `back` and `forward` are the mouse's
   * side buttons (8 and 9). Readers go back and forward on them (PIE-453); they're keys, acting where the keys go.
   */
  | { kind: "alt-left" | "alt-right" | "back" | "forward" }
  /** `mods`: the SGR modifier bits held (4 shift, 8 alt/meta, 16 ctrl); a mod-click opens elsewhere (PIE-473). */
  | { kind: "mouse"; action: "down" | "up" | "drag" | "wheel-up" | "wheel-down" | "wheel-left" | "wheel-right"; button: number; x: number; y: number; mods?: number }
  /** A paste (bracketed paste, mode 2004): the text as one piece. Screens that don't take it whole get it as keys (App). */
  | { kind: "paste"; text: string }
  /** A line break or tab that came inside a paste typed out as keys: a draft takes it as text, not as a list or indent command. */
  | { kind: "enter" | "tab"; pasted: true };


/** The character a plain key types (not with ctrl), or "": what a list or a reader reads its letters from. */
export const ch = (k: Key): string => (k.kind === "char" && !k.ctrl ? k.ch : "");
/** Up a row: ↑ or k. */
export const isUp = (k: Key): boolean => k.kind === "up" || ch(k) === "k";
/** Down a row: ↓ or j. */
export const isDown = (k: Key): boolean => k.kind === "down" || ch(k) === "j";

/**
 * macOS's Option with a letter or digit, as a US keyboard types it when the terminal doesn't send Option as
 * Alt (kitty's default; Ghostty's too, unless `macos-option-as-alt` is set): alt+l arrives as ¬. Option+e,
 * i, n and u are dead keys (they wait for the next key), so alt+n can't be read this way at all.
 */
export const OPTION_KEYS: Readonly<Record<string, string>> = {
  "å": "a", "∫": "b", "ç": "c", "∂": "d", "ƒ": "f", "©": "g", "˙": "h", "∆": "j", "˚": "k", "¬": "l", "µ": "m",
  "ø": "o", "π": "p", "œ": "q", "®": "r", "ß": "s", "†": "t", "√": "v", "∑": "w", "≈": "x", "¥": "y", "Ω": "z",
  "¡": "1", "™": "2", "£": "3", "¢": "4", "∞": "5", "§": "6", "¶": "7", "•": "8", "ª": "9", "º": "0",
};

/** The terminal setting that makes Option send Alt, said once when an Option character stands in for alt. */
export const OPTION_AS_ALT_HINT = "set macos-option-as-alt = true (Ghostty) or macos_option_as_alt left (kitty) · EP0CH_OPTION_KEYS=off if your keyboard types these itself";

/**
 * Whether OPTION_KEYS is read at all. Other keyboards type some of these characters with a key of their own
 * (å ø on a Nordic one, ß § on a German one, £ on a British one, ç º ¡ on a Spanish one) or put them under
 * other Option letters (German Option+k is ∆), so the terminal's bytes can't say which was meant. The locale
 * is the one hint the door gets (ssh passes LANG and LC_* on): an English one outside Britain and Ireland, or
 * none set, reads them; any other doesn't. `EP0CH_OPTION_KEYS=us` reads them always, `off` never.
 */
export function optionKeysOn(env: Record<string, string | undefined> = process.env): boolean {
  const set = env.EP0CH_OPTION_KEYS?.trim().toLowerCase();
  if (set === "off" || set === "0" || set === "no") return false;
  if (set === "us" || set === "1" || set === "on") return true;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  if (!locale || /^(C|POSIX)(\.|$)/i.test(locale)) return true;
  const m = /^([a-z]{2,3})(?:_([A-Za-z]{2}))?/.exec(locale);
  return !!m && m[1] === "en" && !["GB", "IE"].includes((m[2] ?? "").toUpperCase());
}

/** A paste typed out as keys, for a screen that doesn't take it whole (App): CRLF is one break. */
export function pasteKeys(text: string): Key[] {
  return [...text.replace(/\r\n?/g, "\n")].map((ch): Key => (ch === "\n" ? { kind: "enter", pasted: true } : ch === "\t" ? { kind: "tab", pasted: true } : { kind: "char", ch, pasted: true }));
}

/** The terminal's own default text and background again (OSC 110, 111), after a theme's ground (Term.setGround). */
export const GROUND_RESET = "\x1b]110\x1b\\\x1b]111\x1b\\";

/**
 * Everything `start` turns on, turned off: the Kitty keyboard protocol (popped on the alternate screen, where it
 * was pushed), paste, mouse, colours, wrap, the cursor, then the normal screen. A theme's ground is given back
 * apart (Term.stop), only when one was set: a person's own OSC 10/11 colours stay theirs under classic.
 */
export const TERM_RESET = KBD_POP + "\x1b[?2004l\x1b[?1006l\x1b[?1002l\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l";

/**
 * A watcher for the one exit the door can't handle itself (kill -9): a small shell reading a pipe from the
 * door (it never writes to it). The pipe closes when the door ends; the watcher then sends TERM_RESET and `stty sane`, so the
 * terminal is usable again. The door dismisses it (SIGKILL, synchronous) when it restores the terminal itself.
 */
function terminalGuard(): { dismiss(): void } | null {
  try {
    const p = Bun.spawn(["sh", "-c", `trap '' INT QUIT HUP TERM; read -r _; printf '%s' "$EP0CH_TERM_RESET"; stty sane </dev/tty 2>/dev/null`], {
      stdin: "pipe", stdout: "inherit", stderr: "ignore", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", EP0CH_TERM_RESET: TERM_RESET + GROUND_RESET },
    });
    p.unref();
    // Through the Subprocess, which knows when it has exited: never a signal to a pid the OS reused. `read` is
    // the shell's own, so the kill ends the whole watcher (a `cat` would be left behind, one per $EDITOR run);
    // then the pipe is closed, so no descriptor is kept for it.
    return { dismiss() { try { p.kill("SIGKILL"); } catch { /* it's gone */ } try { p.stdin.end(); } catch { /* closed */ } } };
  } catch { return null; }
}

export interface TermInfo { cols: number; rows: number; cellW: number; cellH: number; kitty: boolean }

/** How a program is run in a terminal handed to it: its folder, its environment, a line printed first. */
export interface HandoverOpts { cwd?: string; env?: Record<string, string>; banner?: string }

/**
 * A terminal handed to another program (App.suspend: the drop shell, $EDITOR): `run` starts the program with the
 * terminal as its stdio and resolves to its exit code. The door's own is `ownTerminal`; in a session, the terminal of
 * the client with the person's keys (its client runs the program there, src/session/client.ts).
 */
export interface Handover { run(argv: string[], o?: HandoverOpts): Promise<number | null> }
/**
 * A program the door runs for a moment in a terminal tile beside what the person is reading (`Ctx.inTile`, PIE-417):
 * ctrl+e's $EDITOR on a draft's file, ctrl+t's picker. `name` is the tile's; `file` the file it edits; the door's
 * own settings for it (`own`: EP0CH_* too; null unsets one); `shows` what its title calls the program; `wide`: it wants width
 * more than height (a picker's list), so it may go below the reader rather than beside it.
 */
export interface TileProgram { cmd: string[]; name: string; cwd?: string; file?: string; own?: Record<string, string | null>; shows?: string; wide?: boolean }

/** `argv` with this process's terminal as its stdio, `banner` printed first: its exit code. */
export async function runProgram(argv: string[], o: HandoverOpts = {}): Promise<number | null> {
  if (o.banner && process.stdout.isTTY) process.stdout.write(`\x1b[2J\x1b[H${o.banner}\n`);
  const p = Bun.spawn(argv, { cwd: o.cwd, env: o.env ?? (process.env as Record<string, string>), stdio: ["inherit", "inherit", "inherit"] });
  return await p.exited;
}

/** This process's own terminal. */
export const ownTerminal: Handover = { run: (argv, o) => runProgram(argv, o) };

/**
 * One terminal's screen as rows, written to `out`: what was painted last, so a paint rewrites only the rows that
 * changed, and a frame goes out as one synchronized update. The door's own terminal (Term) is one; each client
 * attached to a session (src/session/) is another, over its socket.
 */
export class Rows {
  private last: string[] = [];
  /** What a frame in progress has written so far (null outside `frame`); sent as one chunk when it ends. */
  private frameOut: string | null = null;
  constructor(private readonly out: (s: string) => void, public info: TermInfo) {}
  write = (s: string) => { if (this.frameOut !== null) this.frameOut += s; else this.out(s); };

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
      if (out) this.out(`\x1b[?2026h${out}\x1b[?2026l`);
    }
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
}

/**
 * Keys from the bytes a terminal sends: escape sequences, the mouse (SGR), pastes, Kitty keyboard reports, and the
 * terminal's replies to the door's own queries (its cell size, Kitty graphics, the keyboard protocol). One per
 * terminal: the door's own (Term), or each client attached to a session, each with its own half-read sequence.
 */
export class KeyDecoder {
  private pending = "";
  keyHandler: (k: Key) => void = () => {};
  probing: { kitty: boolean | null; done: () => void } | null = null;
  /**
   * The terminal answered the Kitty keyboard protocol's query (src/kbd.ts): the door asks it for the protocol at
   * start and on every resume, and TERM_RESET gives it back. False: legacy keys, as before.
   */
  kbd = false;
  constructor(private readonly info: TermInfo) {}

  /**
   * Where raw input goes while the person types in a terminal tile (PIE-417): every byte as the terminal sent
   * it (F-keys, shift- and ctrl-arrows, Insert, a bracketed paste), but mouse reports and the escape chord
   * (ctrl+], 0x1d), which stay the door's. Null: decode keys as usual.
   */
  rawSink: (() => ((bytes: string) => void) | null) | null = null;

  /** Forget a half-read sequence (the terminal was handed to another program and back). */
  reset() { this.pending = ""; }

  private mouseKey(m: RegExpMatchArray) {
    const b = Number(m[1]), x = Number(m[2]) - 1, y = Number(m[3]) - 1;
    // The side buttons (8 back, 9 forward) set bit 128; read as a plain button they'd be a left click.
    if (b & 128) { if (m[4] === "M" && !(b & 32)) this.keyHandler({ kind: b & 1 ? "forward" : "back" }); return; }
    // The wheel's buttons: 64 up, 65 down, 66 left, 67 right (a trackpad's sideways swipe, a tilting wheel).
    const action = b & 64 ? (["wheel-up", "wheel-down", "wheel-left", "wheel-right"] as const)[b & 3]! : b & 32 ? "drag" : m[4] === "M" ? "down" : "up";
    this.keyHandler({ kind: "mouse", action, button: b & 3, x, y, ...(b & 28 ? { mods: b & 28 } : {}) });
  }

  /**
   * Raw bytes to `sink` up to the next mouse report, Kitty key report or escape chord; false when it must wait
   * for more. A key report goes on its own (the tile re-encodes it for its program), but ctrl+] as a report
   * (`CSI 93;5u`) is the escape chord. A report cut off at the end of a read waits for the rest; a moment
   * later, it goes as it was.
   */
  private feedRaw(sink: (bytes: string) => void): boolean {
    const p = this.pending;
    let i = 0;
    while (i < p.length) {
      if (p[i] === "\x1d") break;
      if (p.startsWith("\x1b[", i)) {
        const rest = p.slice(i);
        if (/^\x1b\[<\d+;\d+;\d+[Mm]/.test(rest) || REPORT_AT.test(rest)) break;
        if (/^\x1b\[[<\d;:]*$/.test(rest)) {
          if (i) sink(p.slice(0, i));
          this.pending = rest;
          setTimeout(() => { if (this.pending === rest) { this.pending = ""; this.rawSink?.()?.(rest); } }, 30);
          return false;
        }
      }
      i++;
    }
    if (i) sink(p.slice(0, i));
    this.pending = p.slice(i);
    if (!this.pending) return true;
    if (this.pending[0] === "\x1d") { this.pending = this.pending.slice(1); this.keyHandler({ kind: "char", ch: "]", ctrl: true }); return true; }
    const r = parseReport(this.pending);
    if (r) {
      const seq = this.pending.slice(0, r.length);
      this.pending = this.pending.slice(r.length);
      const k = reportKey(r);
      if (k?.kind === "char" && k.ctrl && k.ch === "]") this.keyHandler(k); else sink(seq);
      return true;
    }
    const m = this.pending.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/)!;
    this.pending = this.pending.slice(m[0].length);
    this.mouseKey(m);
    return true;
  }

  feed(s: string) {
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
      // The Kitty keyboard protocol's query answered: the terminal has it (src/kbd.ts).
      m = p.match(/^\x1b\[\?\d*u/);
      if (m) { if (this.probing) this.kbd = true; this.pending = p.slice(m[0].length); continue; }
      // A key report under that protocol: Shift+Enter, Esc (CSI 27u), ctrl and alt keys.
      const report = parseReport(p);
      if (report) { this.pending = p.slice(report.length); const k = reportKey(report); if (k) this.keyHandler(k); continue; }
      if (/^\x1b(\[[<\d;:?]*|_[^\x1b]*|_[^\x1b]*\x1b)?$/.test(p) && p.length < 64) {
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

export class Term extends Rows {
  readonly decoder: KeyDecoder;
  private resizeHandler: () => void = () => {};
  private textDecoder = new TextDecoder("utf-8");
  constructor() {
    super(s => { process.stdout.write(s); }, { cols: 80, rows: 25, cellW: 9, cellH: 18, kitty: false });
    this.decoder = new KeyDecoder(this.info);
  }
  /** See KeyDecoder.kbd. */
  get kbd() { return this.decoder.kbd; }
  /** See KeyDecoder.rawSink. */
  get rawSink() { return this.decoder.rawSink; }
  set rawSink(f) { this.decoder.rawSink = f; }
  /** Bytes as the terminal sent them (a test's). */
  feed(s: string) { this.decoder.feed(s); }

  private guard: { dismiss(): void } | null = null;
  /** The theme's ground (OSC 10 and 11, src/theme.ts groundSeq): set again on every resume, given back by TERM_RESET. */
  private ground = "";
  setGround(seq: string): void {
    // Classic sets no ground: its reset is sent only to undo one this door set.
    if (seq === GROUND_RESET && !this.ground) return;
    this.ground = seq === GROUND_RESET ? "" : seq;
    this.write(seq);
  }
  /** A session this terminal shows set a theme's ground on it (src/session/client.ts): `stop` gives it back too. */
  sessionGround = false;

  async start(): Promise<void> {
    this.guard = terminalGuard();
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", this.onData);
    process.stdout.on("resize", this.onResized);
    this.write("\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J\x1b[?1002h\x1b[?1006h\x1b[?2004h");
    this.measure();
    const hint = kittyHint();
    const decoder = this.decoder;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { decoder.probing = null; resolve(); }, 400);
      decoder.probing = { kitty: null, done: () => { clearTimeout(timer); decoder.probing = null; resolve(); } };
      this.write(`\x1b[16t${kbdWanted() ? KBD_QUERY : ""}${hint === null ? KITTY_QUERY : "\x1b[c"}`);
    });
    if (hint !== null) this.info.kitty = hint;
    if (this.kbd) this.write(KBD_PUSH);
    if (this.ground) this.write(this.ground);
  }

  /**
   * Where stdin's bytes go: decoded into keys (the door's own terminal), or, once a session's client has probed the
   * terminal, `pass`ed on as they came (src/session/client.ts): the session decodes them.
   */
  private input(d: Buffer) {
    const s = this.textDecoder.decode(d, { stream: true });
    if (this.pass) this.pass(s);
    else this.batch(() => this.decoder.feed(s));
  }
  pass: ((s: string) => void) | null = null;

  /**
   * Put the terminal back. Each step on its own: when the terminal has gone (an ssh connection dropped),
   * the writes fail, and what the door does after stopping (drafts, the socket, the last call) still runs.
   */
  stop(): void {
    try { this.write(`\x1b[2J${TERM_RESET}${this.ground || this.sessionGround ? GROUND_RESET : ""}`); } catch { /* no terminal to reset */ }
    try { process.stdin.setRawMode?.(false); } catch { /* the same */ }
    try { process.stdin.pause(); } catch { /* the same */ }
    this.guard?.dismiss(); this.guard = null;
  }

  private readonly onData = (d: Buffer) => this.input(d);
  private readonly onResized = () => { this.measure(); this.invalidate(); this.resizeHandler(); };
  /** Put the terminal back for good: what it reads and listens to let go, so another Term can take it (the home base's, before the door's). */
  close(): void {
    this.stop();
    process.stdin.off("data", this.onData);
    process.stdout.off("resize", this.onResized);
  }

  /** Take the terminal back after another program ($EDITOR) had it: alt screen, mouse, a full repaint. */
  resume(): void {
    this.guard ??= terminalGuard();
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    this.decoder.reset();
    this.write(`\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J\x1b[?1002h\x1b[?1006h\x1b[?2004h${this.kbd ? KBD_PUSH : ""}${this.ground}`);
    this.measure();
    this.invalidate();
  }

  onKey(fn: (k: Key) => void) { this.decoder.keyHandler = fn; }
  /** Wraps the handling of each chunk of input, so the door paints once for all the keys in it (App.batched). */
  onBatch(fn: (run: () => void) => void) { this.batch = fn; }
  private batch: (run: () => void) => void = run => run();
  onResize(fn: () => void) { this.resizeHandler = fn; }

  private measure() {
    this.info.cols = process.stdout.columns || 80;
    this.info.rows = process.stdout.rows || 25;
  }
}

/**
 * The bytes that paint one row: its text first, then an erase of whatever is left to its right. Erasing the
 * whole row first left it black until the text arrived, and a terminal could show that (PIE-462). Autowrap
 * is off, so an erase from the last column would take the last character: a row that fills the width gets
 * none. Filling is measured in terminal cells (wide and joined characters, combining marks), not characters.
 * Every row goes through `paintable`: the door's own SGR styling reaches the terminal, nothing else that acts
 * on it does (an escape in a note title or an error message, PIE-510).
 */
export function rowBytes(r: number, raw: string, cols: number): string {
  const line = paintable(raw);
  return `\x1b[${r + 1};1H\x1b[0m${line}\x1b[0m${Bun.stringWidth(visible(line)) >= cols ? "" : "\x1b[K"}`;
}
