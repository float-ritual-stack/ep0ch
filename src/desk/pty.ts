// A terminal tile (PIE-417): a program (nvim, claude, a shell) running in a pty the door owns, drawn in
// its tile beside the notes instead of the door suspending for it. The pty is Bun's own (`Bun.Terminal`,
// Bun 1.3.5+: a real /dev/pts, no native module to build). What the program draws goes through a headless
// xterm (@xterm/headless), the same emulator VS Code's terminal uses, so full-screen programs (nvim's
// scroll regions, claude's redraws, the alternate screen, 256 and 24-bit colour) come out right. The
// door's own mirror (src/mirror.ts) stays what it is: it reads only the door's output, which uses a
// handful of sequences, and was never meant to run a program.
//
// Keys go to the program while the person is in the tile (clicking in it, or e / ⏎ on it); ctrl+] hands
// them back to the door, as telnet's escape does. The mouse goes to the program when it asked for it
// (vim's `mouse=a`, claude's), in the encoding it asked for; otherwise the wheel scrolls what went by.
import xterm from "@xterm/headless";
import type { Subprocess } from "bun";
import { unlink } from "node:fs/promises";
import { basename } from "node:path";
import type { Key } from "../term";
import type { DeskApi, Pane, PaneView } from "./panes";
import { NvimClient, nvimSocketPath, type NvimView } from "./nvim";

const { Terminal: XTerm } = xterm as unknown as { Terminal: new (o: Record<string, unknown>) => XTermLike };

interface XCell {
  getChars(): string; getWidth(): number;
  isFgRGB(): boolean; isFgPalette(): boolean; getFgColor(): number;
  isBgRGB(): boolean; isBgPalette(): boolean; getBgColor(): number;
  isBold(): number; isItalic(): number; isUnderline(): number; isInverse(): number; isDim(): number; isInvisible(): number;
}
interface XLine { getCell(x: number, cell?: XCell): XCell | undefined; translateToString(trim?: boolean): string }
interface XTermLike {
  cols: number; rows: number;
  buffer: { active: { baseY: number; cursorX: number; cursorY: number; length: number; type: string; getLine(y: number): XLine | undefined; getNullCell(): XCell } };
  modes: { applicationCursorKeysMode: boolean; mouseTrackingMode: "none" | "x10" | "vt200" | "drag" | "any"; bracketedPasteMode: boolean };
  write(d: string | Uint8Array, cb?: () => void): void;
  resize(cols: number, rows: number): void;
  onTitleChange(f: (t: string) => void): unknown;
  /** What the emulator answers the program (a cursor report, the colours it asked for), to go back to it. */
  onData(f: (d: string) => void): unknown;
  dispose(): void;
}

const SETSID = Bun.which("setsid");
/** Every live pty, so the door's exit takes them down with it. */
const LIVE = new Set<PtyPane>();
process.on("exit", () => { for (const p of LIVE) p.kill(); });

/** The escape chord: ctrl+] leaves the terminal, the keys go back to the door. */
export const ESCAPE_CHORD = "ctrl+]";
export const isEscapeChord = (k: Key) => k.kind === "char" && !!k.ctrl && k.ch === "]";

export interface PtySpec { cmd: string[]; cwd?: string; file?: string; label?: string }

export class PtyPane implements Pane {
  readonly kind = "pty";
  private term: XTermLike | null = null;
  private pty: InstanceType<typeof Bun.Terminal> | null = null;
  private proc: Subprocess | null = null;
  private cols = 0;
  private rows = 0;
  /** The program's exit code once it's gone (null while it runs, or before it starts). */
  exited: number | null = null;
  /** The program's own title (OSC 0/2), if it set one. */
  private programTitle = "";
  /** It asked for SGR mouse reports (mode 1006): clicks and drags are sent that way. */
  private sgr = false;
  /** Lines scrolled back into what went by (0: the live screen). */
  private back = 0;
  private redrawSoon: Timer | null = null;
  private desk: DeskApi | null = null;
  /** Called once when the program exits (an editor opened for a draft reads its file back then). */
  onExit: ((code: number) => void) | null = null;
  /** An nvim tile's socket and the door's connection to it (the cursor, the buffer's file, marks). */
  nvim: NvimClient | null = null;
  socket: string | null = null;
  /** nvim moved its cursor, scrolled, or changed buffer: the desk publishes it, previews follow the file. */
  onView: ((v: NvimView) => void) | null = null;

  constructor(readonly run: PtySpec) {}
  spec() { return { cmd: this.run.cmd, ...(this.run.cwd ? { cwd: this.run.cwd } : {}), ...(this.run.file ? { file: this.run.file } : {}) }; }
  dispose() { this.kill(); this.term?.dispose(); this.term = null; }

  get running() { return !!this.proc && this.exited === null; }
  get pid() { return this.proc?.pid; }
  /** The file the program edits: nvim's current buffer when it has told us, else the file it was started on. */
  get file() { return this.nvim?.view?.file || this.run.file; }
  /** It's nvim: it listens on a socket the door and agents can reach. */
  get isNvim() { return basename(this.run.cmd[0] ?? "") === "nvim"; }

  title() {
    const name = basename(this.run.cmd[0] ?? "shell");
    const what = this.file ? `${name} ${basename(this.file)}` : this.programTitle && this.programTitle !== name ? `${name} · ${this.programTitle}` : name;
    return this.exited !== null ? `${what} · exited ${this.exited}` : this.back ? `${what} · ${this.back} lines back` : what;
  }
  hint() { return this.exited !== null ? "⏎ runs it again" : `click or ⏎ types here · ${ESCAPE_CHORD} back to the door`; }

  init(desk: DeskApi) { this.desk = desk; }

  /** Start the program at this size (the first time it's drawn: the tile's size is known then). */
  private start(cols: number, rows: number) {
    this.cols = cols; this.rows = rows; this.exited = null; this.back = 0;
    this.term?.dispose();
    const term = new XTerm({ cols, rows, scrollback: 1000, allowProposedApi: true });
    this.term = term;
    term.onTitleChange(t => { this.programTitle = t.slice(0, 60); });
    // A program asks its terminal things (where the cursor is, its colours): the emulator answers, and the
    // answer goes back to the program as a terminal's would. Without it nvim waits, then complains.
    term.onData(d => { if (this.running) this.pty?.write(d); });
    this.pty = new Bun.Terminal({
      cols, rows, name: "xterm-256color",
      data: (_t, d) => {
        const s = Buffer.from(d).toString("latin1");
        // Which mouse encoding it asked for isn't in xterm's public modes; the request is in the bytes.
        if (s.includes("\x1b[?1006h")) this.sgr = true;
        if (s.includes("\x1b[?1006l")) this.sgr = false;
        // The terminal's colours (OSC 10 foreground, 11 background): the headless emulator doesn't answer, and
        // nvim asks at startup and complains when no answer comes. The door's ground is black, its text grey.
        for (const m of s.matchAll(/\x1b\](1[01]);\?(\x07|\x1b\\)/g)) this.pty?.write(`\x1b]${m[1]};rgb:${m[1] === "11" ? "0000/0000/0000" : "cccc/cccc/cccc"}${m[2]}`);
        term.write(d, () => this.soon());
      },
    });
    // The program's pane isn't the door's Herdr pane: an agent in it mustn't report itself as the door.
    const env: Record<string, string> = { ...(process.env as Record<string, string>), TERM: "xterm-256color", COLORTERM: "truecolor", COLORFGBG: "15;0", EP0CH_TILE: this.run.label ?? "" };
    for (const k of ["HERDR_PANE_ID", "HERDR_TAB_ID"]) delete env[k];
    try {
      // The pty becomes the program's controlling terminal (setsid -c), so it gets job control and SIGWINCH
      // when the tile is resized. Where there's no setsid (macOS), it runs without; resizes still reach it.
      // nvim listens on a socket in the door's state (`tile.info` names it): the door watches its cursor and
      // buffer, and an agent edits other lines through it without moving the person's cursor.
      const cmd = [...this.run.cmd];
      if (this.isNvim && !cmd.includes("--listen")) { this.socket = nvimSocketPath(this.run.label ?? "nvim"); cmd.splice(1, 0, "--listen", this.socket); }
      this.proc = Bun.spawn(SETSID ? [SETSID, "-c", ...cmd] : cmd, { terminal: this.pty, cwd: this.run.cwd, env });
      if (this.socket) this.attach(this.socket);
    } catch (e) {
      if (this.socket) { void unlink(this.socket).catch(() => {}); this.socket = null; }
      this.exited = 127;
      term.write(`\r\ncan't start ${this.run.cmd.join(" ")}: ${(e as Error).message}\r\n`);
      return;
    }
    LIVE.add(this);
    const proc = this.proc;
    const socket = this.socket;
    proc.exited.then(code => {
      // nvim can leave its socket behind when it's killed: the one the door made for it goes with it.
      if (socket) void unlink(socket).catch(() => {});
      if (this.proc !== proc) return;
      this.exited = code ?? 0;
      LIVE.delete(this);
      try { this.pty?.close(); } catch { /* already closed */ }
      this.soon();
      const f = this.onExit; this.onExit = null;
      f?.(this.exited);
    });
  }

  /** Connect to nvim's socket and ask it to report its view. A failure leaves the tile a plain terminal. */
  private attach(path: string) {
    const c = new NvimClient(path);
    c.onView = v => { this.onView?.(v); this.soon(); };
    c.connect().then(() => c.watch()).then(() => { this.nvim = c; }, () => c.close());
  }

  /** A repaint a moment from now: a program writing fast is drawn at most ~60 times a second. */
  private soon() {
    if (this.redrawSoon) return;
    this.redrawSoon = setTimeout(() => { this.redrawSoon = null; this.desk?.redraw(); }, 16);
  }

  /** Run it again after it exited (⏎ on the tile, or `tile.restart`). */
  restart() { this.kill(); this.proc = null; this.start(this.cols || 80, this.rows || 24); this.desk?.redraw(); }

  kill() {
    LIVE.delete(this);
    this.socket = null;
    this.nvim?.close(); this.nvim = null;
    try { this.proc?.kill(); } catch { /* gone */ }
    try { this.pty?.close(); } catch { /* gone */ }
  }

  /** Keys or text straight to the program (an agent's `tile.type`, a paste). */
  input(s: string) { if (this.running) { this.back = 0; this.pty?.write(s); } }

  render(w: number, h: number, focused: boolean, _desk: DeskApi, cursor = focused): PaneView {
    if (w < 2 || h < 1) return { lines: [] };
    if (!this.term) this.start(w, h);
    else if (w !== this.cols || h !== this.rows) {
      this.cols = w; this.rows = h;
      this.term.resize(w, h);
      if (this.running) try { this.pty?.resize(w, h); } catch { /* exiting */ }
    }
    const t = this.term!, b = t.buffer.active;
    const top = Math.max(0, b.baseY - this.back);
    const lines: string[] = [];
    const cell = b.getNullCell();
    const hidden = !!(t as any)._core?.coreService?.isCursorHidden;
    for (let y = 0; y < h; y++) {
      const line = b.getLine(top + y);
      const cy = !this.back && cursor && !hidden && this.exited === null && y === b.cursorY ? b.cursorX : -1;
      lines.push(line ? rowOf(line, cell, w, cy) : "");
    }
    if (this.exited !== null) lines[h - 1] = `\x1b[38;2;255;255;85m[${this.run.cmd[0]} exited ${this.exited}] ⏎ runs it again · ^W x closes the tile\x1b[0m`;
    return { lines, scroll: b.baseY > 0 ? { top, room: h, total: b.baseY + h } : undefined };
  }

  /** What the tile shows as text (for `peek` and tests). */
  text(): string[] {
    const b = this.term?.buffer.active;
    if (!b) return [];
    return Array.from({ length: this.rows }, (_, y) => b.getLine(b.baseY + y)?.translateToString(true) ?? "");
  }

  /** Door keys that aren't the program's: none while the person is in it but the escape chord (the desk checks that). */
  key(k: Key, _desk: DeskApi): boolean {
    if (this.exited !== null && k.kind === "enter") { this.restart(); return true; }
    const s = this.running ? keyBytes(k, this.term?.modes.applicationCursorKeysMode ?? false) : null;
    if (s === null) return false;
    this.input(s);
    return true;
  }

  /** The program asked for the mouse. */
  wantsMouse() { return this.running && !this.back && (this.term?.modes.mouseTrackingMode ?? "none") !== "none"; }

  /** A mouse event at x, y in the tile: to the program when it asked, else the wheel scrolls back. */
  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number): boolean {
    const mode = this.term?.modes.mouseTrackingMode ?? "none";
    if (this.wantsMouse()) {
      if (k.action === "drag" && mode !== "drag" && mode !== "any") return true;
      if (k.action === "up" && mode === "x10") return true;
      const s = mouseBytes(k, x, y, this.sgr);
      if (s) this.pty?.write(s);
      return true;
    }
    if (k.action === "wheel-up" || k.action === "wheel-down") {
      const max = this.term?.buffer.active.baseY ?? 0;
      this.back = Math.max(0, Math.min(max, this.back + (k.action === "wheel-up" ? 3 : -3)));
      this.desk?.redraw();
      return true;
    }
    return false;
  }

  /** The emulator's cursor (0-based column and row in the tile), where the program left it. */
  cursor(): { x: number; y: number } | null { const b = this.term?.buffer.active; return b ? { x: b.cursorX, y: b.cursorY } : null; }
  describe() {
    return {
      cmd: this.run.cmd, file: this.file, running: this.running, exited: this.exited, pid: this.pid, mouse: this.term?.modes.mouseTrackingMode ?? "none",
      ...(this.socket ? { nvim: { socket: this.socket, connected: !!this.nvim, view: this.nvim?.view ?? null } } : {}),
      cursor: this.cursor(), text: this.text(),
    };
  }
}

// ── drawing the emulator's cells ─────────────────────────────────────────────

const VGA16 = [[0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0], [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
  [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0], [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255]];
/** xterm's 256 colours as RGB: the door writes 24-bit colour, so `snap` shows the tile as the terminal does. */
export const PALETTE: number[][] = [...VGA16,
  ...Array.from({ length: 216 }, (_, i) => [Math.floor(i / 36), Math.floor(i / 6) % 6, i % 6].map(v => (v ? v * 40 + 55 : 0))),
  ...Array.from({ length: 24 }, (_, i) => [i * 10 + 8, i * 10 + 8, i * 10 + 8])];
const DEFAULT_FG = [204, 204, 204], DEFAULT_BG: number[] | null = null;

function rgb(isRGB: boolean, isPal: boolean, c: number): number[] | null {
  if (isRGB) return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  if (isPal) return PALETTE[c] ?? null;
  return null;
}

/**
 * One row of the emulator as the door's styled text: 24-bit colour, bold, italic, underline, dim; inverse
 * swapped here so a snapshot shows it. A wide character keeps its second cell as a zero-width space, so
 * the tile's right border stays where it is. `cursor`: the column the cursor is drawn at (inverse), or -1.
 */
function rowOf(line: XLine, cell: XCell, w: number, cursor: number): string {
  let out = "", last = "";
  for (let x = 0; x < w; x++) {
    const c = line.getCell(x, cell);
    if (!c) { out += x === cursor ? "\x1b[0m\x1b[7m \x1b[0m" : " "; last = x === cursor ? "" : last; continue; }
    const width = c.getWidth();
    if (width === 0) { out += "​"; continue; }
    let fg = rgb(c.isFgRGB(), c.isFgPalette(), c.getFgColor()), bg = rgb(c.isBgRGB(), c.isBgPalette(), c.getBgColor());
    if (c.isBold() && c.isFgPalette() && c.getFgColor() < 8) fg = PALETTE[c.getFgColor() + 8]!;
    if (c.isInverse() || x === cursor) { const f = fg ?? DEFAULT_FG; fg = bg ?? [0, 0, 0]; bg = f; }
    void DEFAULT_BG;
    const sgr = `\x1b[0m${fg ? `\x1b[38;2;${fg.join(";")}m` : ""}${bg ? `\x1b[48;2;${bg.join(";")}m` : ""}${c.isBold() ? "\x1b[1m" : ""}${c.isItalic() ? "\x1b[3m" : ""}${c.isUnderline() ? "\x1b[4m" : ""}${c.isDim() ? "\x1b[2m" : ""}`;
    if (sgr !== last) { out += sgr; last = sgr; }
    const ch = c.isInvisible() ? " " : c.getChars() || " ";
    out += ch;
  }
  return out + "\x1b[0m";
}

// ── keys and the mouse, as a terminal sends them ─────────────────────────────

/** The bytes a terminal sends for `k` (null: none). Application cursor mode sends arrows as SS3. */
export function keyBytes(k: Key, appCursor = false): string | null {
  const arrow = (c: string) => (appCursor ? `\x1bO${c}` : `\x1b[${c}`);
  switch (k.kind) {
    case "char": {
      if (!k.ctrl) return k.ch;
      const c = k.ch.toLowerCase();
      if (c >= "a" && c <= "z") return String.fromCharCode(c.charCodeAt(0) - 96);
      return ({ "@": "\x00", " ": "\x00", "[": "\x1b", "\\": "\x1c", "]": "\x1d", "^": "\x1e", "_": "\x1f" } as Record<string, string>)[k.ch] ?? null;
    }
    case "alt": return `\x1b${k.ch}`;
    case "enter": return "\r";
    case "alt-enter": return "\x1b\r";
    case "esc": return "\x1b";
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
    default: return null;
  }
}

/** A mouse event at x, y (0-based, in the tile) as the program asked: SGR (1006) or the old X10 bytes. */
export function mouseBytes(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, sgr: boolean): string | null {
  const mods = (k.mods ?? 0) & 28;
  let b = k.action === "wheel-up" ? 64 : k.action === "wheel-down" ? 65 : k.button & 3;
  if (k.action === "drag") b += 32;
  b += mods;
  if (sgr) return `\x1b[<${b};${x + 1};${y + 1}${k.action === "up" ? "m" : "M"}`;
  if (k.action === "up") b = 3 + mods;
  if (x > 222 || y > 222) return null;
  return `\x1b[M${String.fromCharCode(32 + b, 33 + x, 33 + y)}`;
}
