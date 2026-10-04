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
import { inLoginShell, isAgentCmd, programName } from "./dock-program";
import { scrolled, wheelRows } from "../scroll";
import xterm from "@xterm/headless";
import { unlink } from "node:fs/promises";
import { basename } from "node:path";
import { C, fg } from "../style";
import type { Key } from "../term";
import type { DeskApi, Pane, PaneView } from "./panes";
import { NvimClient, nvimSocketPath, type NvimView } from "./nvim";
import { controlPath } from "../control";
import { appendNest, doorLayer, doorNest } from "../nest";
import { agentVars, DOOR_START_VARS, withContinue } from "./agent-env";
import { KbdModes, keyBytes, translateReports } from "../kbd";
import { type Clip, Osc52Reader, TILE_COPY_RECENT_MS } from "../surface/selection";
import { localPtys, ptyBackend, type PtyMeta, type PtyProc } from "./pty-backend";

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

/**
 * The pty becomes the program's controlling terminal, so it gets job control (ctrl+z, fg) and SIGWINCH when
 * the tile is resized. Without that, a resize changes the pty's size but nothing tells the program: a shell,
 * claude or nvim goes on drawing at the size it started at.
 * - Linux: util-linux `setsid -c`.
 * - macOS (and the BSDs) have no setsid binary. A tiny perl launcher (perl ships with macOS) does the same: a
 *   new session, then TIOCSCTTY on stdin (the pty), then exec with the arguments as they were.
 *   TIOCSCTTY is _IO('t', 97) = 0x20007461 on Darwin and the BSDs; sys/ioctl.ph isn't reliably installed there.
 * - Neither: the program runs without a controlling terminal (`null`); the door says so once.
 */
export const PERL_CTTY = `use POSIX (); POSIX::setsid(); ioctl(STDIN, 0x20007461, 0) or warn "ep0ch: no controlling terminal: $!\\n"; exec { $ARGV[0] } @ARGV or do { print STDERR "ep0ch: can't run $ARGV[0]: $!\\n"; exit 127 }`;
export function cttyPrefix(which: (b: string) => string | null = Bun.which, platform: string = process.platform): string[] | null {
  if (platform === "linux") { const setsid = which("setsid"); return setsid ? [setsid, "-c"] : null; }
  const perl = which("perl");
  if (perl && platform !== "win32") return [perl, "-e", PERL_CTTY, "--"];
  const setsid = which("setsid");
  return setsid ? [setsid, "-c"] : null;
}
const CTTY = cttyPrefix();
let saidNoCtty = false;
/**
 * Every live pty. The door's exit takes down those it runs itself; a session's terminal host keeps its own running
 * for the next daemon (src/session/pty-host.ts), until the session ends.
 */
const LIVE = new Set<PtyPane>();
process.on("exit", () => { for (const p of LIVE) if (p.ownProcess) p.kill(); });
/**
 * A session's daemon is handing over (src/session/daemon.ts): a program no layout brings back (a ctrl+e editor on a
 * temp file, whose text was copied out) ends, rather than run on in the terminal host with no tile to adopt it.
 */
export function endUnkept(): void { for (const p of [...LIVE]) if (!p.keptAs) p.kill(); }
/** Every program running in a terminal tile (and the dock) right now: what ending a session would stop. */
export const livePrograms = (): readonly PtyPane[] => [...LIVE].filter(p => p.running);

/** The escape chord: ctrl+] leaves the terminal, the keys go back to the door. */
export const ESCAPE_CHORD = "ctrl+]";
export const isEscapeChord = (k: Key) => k.kind === "char" && !!k.ctrl && k.ch === "]";

/**
 * Herdr's variables, the one list: a scratch service or showcase started by tests and scripts runs with all of
 * them unset (test/scratch.ts, scripts/try-it.sh), so nothing it starts reaches a real Herdr.
 */
export const HERDR_VARS = ["HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_PANE_ID", "HERDR_WORKSPACE_ID", "HERDR_TAB_ID"] as const;
/** The ones naming the door's own Herdr pane and tab: a tile's program is in neither, so they never reach it. */
export const HERDR_PANE_VARS = ["HERDR_PANE_ID", "HERDR_TAB_ID"] as const;
/** How this door was opened (src/desk/agent-env.ts): a door started inside a tile mustn't repeat it. */
export { DOOR_START_VARS };

/**
 * A terminal tile's environment: the person's own (a shell in a tile is their shell, keys and all), without
 * the door's Herdr pane and tab and without how this door was started; with the terminal it runs in and
 * the agent variables (`agentVars`, src/desk/agent-env.ts: the one place they're made, for the Herdr
 * launcher's pane too): EP0CH_CONTROL, EP0CH_TILE, EP0CH_TILE_ID, EP0CH_NEST, EP0CH_IN_DOOR=1. Everything else passes through on
 * purpose, EP0CH_STATE and EP0CH_SOCKET included, so a door opened in a tile uses the same state and outline.
 * An inherited EP0CH_TILE_ID is always dropped: a door run in a tile mustn't hand its own tiles the outer
 * tile's id.
 *
 * EP0CH_NEST (src/nest.ts) gets this door's layer, `door:<pid>/<place>/<tile id>:<tile name>`, after the ssh
 * session and Herdr pane the door inherited (recorded here, before the pane's variables are dropped), so the
 * program can say where it runs (`ep0ch where`).
 */
export function tileEnv(env: Record<string, string | undefined>, tile: string, control: string | null, tileId?: string | null, place?: string | null, pid = process.pid): Record<string, string> {
  const out: Record<string, string> = {};
  const drop = new Set<string>([...HERDR_PANE_VARS, ...DOOR_START_VARS, "EP0CH_TILE_ID"]);
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !drop.has(k)) out[k] = v;
  // EP0CH_IN_DOOR: a shell in a tile is already in the door, so a login shell's landing guard (float-2's
  // ~/.bashrc starts the door on an interactive ssh login) doesn't open a second door in it.
  Object.assign(out, { TERM: "xterm-256color", COLORTERM: "truecolor", COLORFGBG: "15;0" });
  Object.assign(out, agentVars(env, { tile, control, tileId, nest: appendNest(doorNest(env), doorLayer(pid, place, tileId, tile)) }));
  return out;
}

/** `temp`: a ctrl+e edit on a temp file, never saved in a layout. */
/** What inLoginShell's wrapper prints when the agent exits (latin1, as a tile reads its output): the title, then the line. */
const EXITED = /\x1b\]2;[^\x07]* exited \xc2\xb7 shell\x07\r?\n[^\n]* exited \((\d+)\) \xc2\xb7 this is your shell/;

/** `agent`: the host layer's agent (the dock's one tile, PIE-513), which reads its program from EP0CH_DAILY_AGENT. */
export interface PtySpec {
  cmd: string[]; cwd?: string; file?: string; label?: string; temp?: boolean; agent?: boolean;
  /** Variables the program gets on top of a terminal tile's own (an extension's tile: its outline and socket, PIE-512). */
  env?: Record<string, string>;
  /**
   * The door's own settings for a program it starts itself (`Ctx.inTile`: ctrl+t's picker on the draft's outline), last
   * and EP0CH_* included, unlike `env`'s; null unsets one. Never from a service or a saved layout.
   */
  own?: Record<string, string | null>;
  /** It starts inside the person's login shell, which it leaves them in when it exits (left out: when `cmd` is an agent's). */
  inShell?: boolean;
  /** What its title calls the program, when the first word of `cmd` isn't it (a picker sh runs: `tv ep0ch`). */
  shows?: string;
}

export class PtyPane implements Pane {
  /** `pty`, or a kind of its own for a program the service names (an extension's tile, ProgramTile). */
  readonly kind: string = "pty";
  private term: XTermLike | null = null;
  private proc: PtyProc | null = null;
  /** Its program runs in this process (it ends with the door); false under a session's terminal host. */
  ownProcess = true;
  private cols = 0;
  private rows = 0;
  /** The program's exit code once it's gone (null while it runs, or before it starts). */
  exited: number | null = null;
  /** The agent's exit code once it has left the person in their shell (an agent started inside it), else null. */
  agentExit: number | null = null;
  private exitTail = "";
  /**
   * Its program starts inside the person's login shell (inLoginShell), so its exit line is read: from what the tile
   * runs, so a program adopted after a session handover (never spawned here) is read the same.
   */
  private get wrapped(): boolean { return this.run.inShell ?? isAgentCmd(this.run.cmd); }
  /** The program's own title (OSC 0/2), if it set one (the Herdr launcher says it's only watching with it). */
  programTitle = "";
  /**
   * It shows an agent that lives in this Herdr pane: quitting the door ends only the attach, not the agent.
   * Set by `tile.herdr`, which scripts/door-agent-herdr.ts calls over the control socket as it attaches (PIE-491:
   * a typed field, not what the program puts in its title); cleared when the program starts again or exits.
   */
  get herdr(): { pane: string; name?: string } | null { return this.herdrPane; }
  set herdr(h: { pane: string; name?: string } | null) { this.herdrPane = h; this.remember(); }
  private herdrPane: { pane: string; name?: string } | null = null;
  /** The tile's id on the desk (`t<n>`): the program gets it as EP0CH_TILE_ID. */
  tileId: string | null = null;
  /** The tile's name on the desk, for a tile opened without one (`^W o s`: the desk names it): EP0CH_TILE. */
  tileName: string | null = null;
  /** The layout (or view) the tile was started in, for its EP0CH_NEST layer. */
  place: string | null = null;
  /** The state file its screen's layout is saved in (desk.json, the dock's): with its id, what it's known by across daemons. */
  home: string | null = null;
  /**
   * Which tile it is across session daemons (`<home>:<tile id>`): a new daemon adopts the program kept under it. Null
   * for a tile no layout restores (a ctrl+e editor on a temp file, a showcase's exhibit).
   */
  get keptAs(): string | null { return this.run.temp ? null : this.keptKey ?? this.ownKey; }
  /** `<home>:<tile id>` as the tile's place says it now. */
  private get ownKey(): string | null { return !this.home || !this.tileId ? null : `${this.home}:${this.tileId}`; }
  /**
   * The key its program was started (or adopted) under, kept for the program's life: a tile moved to another screen or
   * into the dock (PIE-498) gets a new id there, but its program is still the one the terminal host keeps under this.
   */
  keptKey: string | null = null;
  /** What a save adds so a moved tile adopts its program after a restart: the key it runs under, when not its own. */
  get movedKey(): string | null { return this.keptKey && this.keptKey !== this.ownKey ? this.keptKey : null; }
  /** When the program last wrote anything (Date.now()): the dock's chip calls an agent working while it does (PIE-498). */
  lastOutput = 0;
  /** When the person last typed or pasted into it (an agent's `tile.type` doesn't count): `agent.restart` waits for them. */
  personKeyAt = 0;
  /** When the person last clicked in it or went into it (a click, e or ⏎: tile.enter; the drawer's host.enter). */
  personClickAt = 0;
  /** The next start only: a restart that keeps the conversation (`withContinue`, and the Herdr launcher told so). */
  private continueNext = false;
  /** It asked for SGR mouse reports (mode 1006): clicks and drags are sent that way. */
  private sgr = false;
  private modeTail = "";
  /** The Kitty keyboard protocol as the program asked for it (src/kbd.ts): how the person's keys reach it. */
  readonly kbd = new KbdModes();
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
  spec(): Record<string, unknown> { return { cmd: this.run.cmd, ...(this.run.cwd ? { cwd: this.run.cwd } : {}), ...(this.run.file ? { file: this.run.file } : {}), ...(this.run.agent ? { agent: true as const } : {}), ...(this.movedKey ? { kept: this.movedKey } : {}) }; }
  dispose() { this.kill(); this.term?.dispose(); this.term = null; }

  get running() { return !!this.proc && this.exited === null; }
  get pid() { return this.proc?.pid; }
  /** The file the program edits: nvim's current buffer when it has told us, else the file it was started on. */
  get file() { return this.nvim?.view?.file || this.run.file; }
  /** It's nvim: it listens on a socket the door and agents can reach. */
  get isNvim() { return basename(this.run.cmd[0] ?? "") === "nvim"; }

  title() {
    const name = this.run.shows ?? basename(this.run.cmd[0] ?? "shell");
    const what = this.file ? `${name} ${basename(this.file)}` : this.programTitle && this.programTitle !== name ? `${name} · ${this.programTitle}` : name;
    return this.exited !== null ? `${what} · exited ${this.exited}` : this.back ? `${what} · ${this.back} lines back` : what;
  }
  hint(): string { return this.exited !== null ? "⏎ runs it again" : `click or ⏎ types here · ${ESCAPE_CHORD} back to the door`; }

  init(desk: DeskApi) { this.desk = desk; }

  /**
   * Start the program at this size (the first time it's drawn: the tile's size is known then). In a session whose
   * daemon was handed over (or restarted), the program its terminal host kept for this tile is adopted instead: what it
   * wrote meanwhile is replayed into a fresh emulator, and it's asked to draw itself again at the tile's size.
   */
  protected start(cols: number, rows: number) {
    this.cols = cols; this.rows = rows; this.exited = null; this.back = 0; this.herdrPane = null; this.agentExit = null; this.exitTail = "";
    this.term?.dispose();
    this.kbd.reset();
    const term = new XTerm({ cols, rows, scrollback: 1000, allowProposedApi: true });
    this.term = term;
    term.onTitleChange(t => { this.programTitle = t.slice(0, 60); });
    // A program asks its terminal things (where the cursor is, its colours): the emulator answers, and the
    // answer goes back to the program as a terminal's would. Without it nvim waits, then complains.
    // Not while what a kept program wrote is replayed (an adopted one): its old queries were answered then.
    let replaying = false;
    term.onData(d => { if (this.running && !replaying) this.proc?.write(d); });
    /** The modes a program asks of its terminal, followed; `answer`: its queries answered (not in a replay). */
    const modes = (s: string, answer: boolean) => {
      // Which mouse encoding it asked for isn't in xterm's public modes; the request is in the bytes, maybe
      // with other modes (ESC [ ? 1000 ; 1006 h) and maybe split across reads (the tail is kept).
      const seen = this.modeTail + s;
      this.modeTail = seen.slice(-32);
      for (const m of seen.matchAll(/\x1b\[\?([\d;]+)([hl])/g)) if (m[1]!.split(";").includes("1006")) this.sgr = m[2] === "h";
      // The terminal's colours (OSC 10 foreground, 11 background): the headless emulator doesn't answer, and
      // nvim asks at startup and complains when no answer comes. The door's ground is black, its text grey.
      if (answer) for (const m of s.matchAll(/\x1b\](1[01]);\?(\x07|\x1b\\)/g)) this.proc?.write(`\x1b]${m[1]};rgb:${m[1] === "11" ? "0000/0000/0000" : "cccc/cccc/cccc"}${m[2]}`);
      // The Kitty keyboard protocol: xterm ignores it, so the door follows the program's push and pop and
      // answers its query here (before xterm's DA reply, as a terminal with the protocol does).
      const kbdReply = this.kbd.observe(s);
      if (kbdReply && answer) this.proc?.write(kbdReply);
    };
    // Its clipboard writes (OSC 52), which the emulator would swallow, go on to the person's terminal through the
    // door's own copy (App.copy: the client with the keys, a "copied from <tile>" toast). Never in a replay: what a
    // kept program wrote before was copied then.
    const clip = new Osc52Reader();
    const data = (d: Uint8Array) => {
      this.lastOutput = Date.now();
      const text = Buffer.from(d).toString("latin1");
      modes(text, true);
      for (const c of clip.feed(text)) this.copied(c);
      // The agent inside the login shell exited: its wrapper says so (inLoginShell: the title, then the line), and the
      // tile is that shell now. Only a wrapped tile reads it, and only both together. Only the tile's own start (a restart,
      // ⏎ on it) clears it: a prompt that titles the terminal is no sign the agent is back.
      if (this.wrapped) {
        const seen = this.exitTail + text;
        this.exitTail = seen.slice(-320);
        const gone = EXITED.exec(seen);
        if (gone && this.agentExit === null) { this.agentExit = Number(gone[1]); this.exitTail = ""; }
      }
      term.write(d, () => this.soon());
    };
    // The host had to drop some of its output (this daemon fell behind): the emulator starts over from all it kept.
    this.resync = replay => {
      replaying = true;
      clip.reset();
      (term as unknown as { reset(): void }).reset();
      modes(Buffer.from(replay).toString("latin1"), false);
      term.write(replay, () => { replaying = false; this.soon(); });
    };
    // A program no layout brings back (a ctrl+e editor, a showcase's exhibit) runs here, and ends with this process.
    const backend = this.keptAs ? ptyBackend() : localPtys;
    this.ownProcess = backend.kind === "local";
    const keep = this.continueNext;
    this.continueNext = false;
    // The program a session kept for this tile, when there is one (a run again, `keep`, starts a new one).
    const key = this.keptAs, kept = key && !keep ? backend.adopt(key, this.run.cmd, data) : null;
    // Its program is known by this key from now on, wherever the tile goes.
    if (key) this.keptKey = key;
    if (kept) {
      this.proc = kept.proc;
      // What it wrote, at the size it wrote it, its modes followed (its mouse encoding, its keyboard protocol) and its
      // queries left unanswered; then the tile's size, and a redraw asked for: a resize (twice, a moment apart, when
      // the size is the same: a full-screen program redraws on SIGWINCH).
      replaying = true;
      term.resize(kept.cols, kept.rows);
      const replayed = Buffer.from(kept.replay).toString("latin1");
      modes(replayed, false);
      // The agent had exited before the handover: its exit line is in what the host kept.
      if (this.wrapped && this.agentExit === null) { const all = [...replayed.matchAll(new RegExp(EXITED.source, "g"))]; if (all.length) this.agentExit = Number(all.at(-1)![1]); }
      const proc = kept.proc;
      term.write(kept.replay, () => {
        replaying = false;
        const c = this.cols, r = this.rows;
        if (term.cols !== c || term.rows !== r) term.resize(c, r);
        const same = kept.cols === c && kept.rows === r;
        try { proc.resize(c, same && r > 2 ? r - 1 : r); } catch { /* exiting */ }
        if (same && r > 2) setTimeout(() => { try { proc.resize(this.cols, this.rows); } catch { /* exiting */ } }, 60);
        this.soon();
      });
      this.socket = kept.meta.socket ?? null;
      this.herdrPane = kept.meta.herdr ?? null;
      if (this.socket) this.attach(this.socket);
      if (kept.exited !== null) { this.ended(kept.proc, kept.exited, this.socket); return; }
      this.watch(this.proc);
      return;
    }
    // The program's pane isn't the door's Herdr pane: an agent in it mustn't report itself as the door. This
    // door's control socket: `ep0ch act` from the program reaches the door it runs in.
    const env = tileEnv(process.env, this.run.label || this.tileName || basename(this.run.cmd[0] ?? "") || "tile", controlPath, this.tileId, this.place);
    if (keep) env.EP0CH_AGENT_CONTINUE = "1";
    // The service's variables for its program (an extension's tile); the door's own (EP0CH_*) stay the door's.
    for (const [k, v] of Object.entries(this.run.env ?? {})) if (!k.startsWith("EP0CH_")) env[k] = v;
    for (const [k, v] of Object.entries(this.run.own ?? {})) { if (v === null) delete env[k]; else env[k] = v; }
    try {
      // The pty becomes the program's controlling terminal (CTTY above), so resizes reach it as SIGWINCH.
      // nvim listens on a socket in the door's state (`tile.info` names it): the door watches its cursor and
      // buffer, and an agent edits other lines through it without moving the person's cursor.
      const cmd = keep ? withContinue(this.run.cmd) : [...this.run.cmd];
      if (this.isNvim && !cmd.includes("--listen")) { this.socket = nvimSocketPath(this.run.label ?? "nvim"); if (this.socket) cmd.splice(1, 0, "--listen", this.socket); }
      // An agent starts inside the person's login shell: when it exits (or crashes) the tile is that shell, in the same
      // folder with the same environment, and says so. Nothing starts it again by itself (no dead panes).
      const argv = this.wrapped ? inLoginShell(cmd, process.env.SHELL || "sh", programName(this.run.cmd)) : cmd;
      this.proc = backend.spawn({ key, argv: CTTY ? [...CTTY, ...argv] : argv, cwd: this.run.cwd, env, cols, rows, meta: this.meta() }, data);
      if (!CTTY && !saidNoCtty) { saidNoCtty = true; this.desk?.ctx.flash("no setsid or perl here: terminal tiles won't hear resizes, and ctrl+z doesn't stop a job", 8000); }
      if (this.socket) this.attach(this.socket);
    } catch (e) {
      if (this.socket) { void unlink(this.socket).catch(() => {}); this.socket = null; }
      this.exited = 127;
      term.write(`\r\ncan't start ${this.run.cmd.join(" ")}: ${(e as Error).message}\r\n`);
      return;
    }
    this.watch(this.proc);
  }

  /** It runs: kept with the live ones until it exits. */
  private watch(proc: PtyProc) {
    proc.onResync = replay => this.resync?.(replay);
    LIVE.add(this);
    const socket = this.socket;
    void proc.exited.then(code => this.ended(proc, code, socket));
  }

  /** Its program ended: the tile says so, and an editor opened for a draft reads its file back. */
  private ended(proc: PtyProc, code: number, socket: string | null) {
    // nvim can leave its socket behind when it's killed: the one the door made for it goes with it.
    if (socket) void unlink(socket).catch(() => {});
    if (this.proc !== proc) return;
    this.exited = code;
    this.herdrPane = null;
    LIVE.delete(this);
    try { proc.close(); } catch { /* already closed */ }
    this.soon();
    const f = this.onExit; this.onExit = null;
    f?.(this.exited);
  }

  /**
   * The program put `c` on the clipboard (OSC 52): passed on as the door's own copy, said as this tile's. Only while the
   * person is using the tile (they typed, pasted or clicked in it within TILE_COPY_RECENT_MS, whoever typed since): a
   * program in a tile they haven't used lately (an agent's shell, `tile.type`) can't fill their clipboard; the toast
   * says it didn't, and to click in it and copy again.
   */
  private copied(c: Clip) {
    // Named as its header names it (claude, sh), not by its layout name.
    const from = this.run.shows ?? (basename(this.run.cmd[0] ?? "") || this.tileName || "a terminal tile");
    const theirs = Date.now() - Math.max(this.personKeyAt, this.personClickAt) < TILE_COPY_RECENT_MS;
    this.desk?.ctx.copy?.(!theirs ? { away: true } : "text" in c ? c.text : c, from);
  }

  /** Start the emulator over from what the program wrote (a host's resync). */
  private resync: ((replay: Uint8Array) => void) | null = null;
  /** What the terminal host keeps with the program for the next daemon: its command, nvim's socket, a Herdr attach. */
  private meta(): PtyMeta { return { cmd: this.run.cmd, socket: this.socket, herdr: this.herdrPane }; }
  private remember() { const k = this.keptAs; if (k && this.running) ptyBackend().meta(k, this.meta()); }

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

  /**
   * Run it again after it exited (⏎ on the tile, or `tile.restart`). `keep`: the conversation is kept: a bare
   * `claude` gets --continue, and the Herdr launcher is told to do the same in its pane (`agent.restart`).
   */
  restart(keep = false) { this.kill(); this.proc = null; this.continueNext = keep; this.start(this.cols || 80, this.rows || 24); this.desk?.redraw(); }

  /**
   * Ask the program to exit (SIGTERM) and wait for it; SIGKILL after `graceMs`. Only this tile's own program:
   * its pid, nothing else. Resolves once it's gone (or wasn't running).
   */
  async stop(graceMs = 8000): Promise<void> {
    const proc = this.proc;
    if (!proc || this.exited !== null) return;
    try { proc.kill("SIGTERM"); } catch { /* gone */ }
    const done = await Promise.race([proc.exited.then(() => true), Bun.sleep(graceMs).then(() => false)]);
    if (!done) { try { proc.kill("SIGKILL"); } catch { /* gone */ } await proc.exited; }
  }

  kill() {
    LIVE.delete(this);
    this.socket = null;
    this.nvim?.close(); this.nvim = null;
    try { this.proc?.kill(); } catch { /* gone */ }
    try { this.proc?.close(); } catch { /* gone */ }
  }

  /** Keys or text straight to the program (an agent's `tile.type`). */
  input(s: string) { if (this.running) { this.back = 0; this.proc?.write(s); } }
  /**
   * Bytes as the person's terminal sent them. A bracketed paste keeps its markers only for a program that asked for
   * them; a Kitty keyboard report reaches it as it asked (the protocol, or legacy bytes: Shift+Enter as ESC CR).
   */
  inputRaw(s: string) { this.personKeyAt = Date.now(); s = translateReports(s, this.kbd.flags); this.input(this.term?.modes.bracketedPasteMode ? s : s.replace(/\x1b\[20[01]~/g, "")); }
  /** A paste, whole: bracketed (mode 2004) when the program asked for that, so it arrives as one paste, not typed lines. */
  paste(text: string) { this.personKeyAt = Date.now(); this.input(this.term?.modes.bracketedPasteMode ? `\x1b[200~${text}\x1b[201~` : text); }

  render(w: number, h: number, focused: boolean, _desk: DeskApi, cursor = focused): PaneView {
    if (w < 2 || h < 1) return { lines: [] };
    if (!this.term) this.start(w, h);
    else if (w !== this.cols || h !== this.rows) {
      this.cols = w; this.rows = h;
      this.term.resize(w, h);
      if (this.running) try { this.proc?.resize(w, h); } catch { /* exiting */ }
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
    if (this.exited !== null) lines[h - 1] = `${fg(C.yellow)}[${basename(this.run.cmd[0] ?? "")} exited ${this.exited}] ⏎ runs it again · ctrl+] back to the door · ^W x closes the tile\x1b[0m`;
    return { lines, scroll: b.baseY > 0 ? { top, room: h, total: b.baseY + h } : undefined };
  }

  /** What the tile shows as text (for `peek` and tests). */
  text(): string[] {
    const b = this.term?.buffer.active;
    if (!b) return [];
    return Array.from({ length: this.rows }, (_, y) => b.getLine(b.baseY + y)?.translateToString(true) ?? "");
  }

  /**
   * A door key on the tile while the person isn't typing in it: none is its own (⏎, e and a click are its kind's
   * `press`: tile.enter). What they type once in it goes to `typed`.
   */
  key(_k: Key, _desk: DeskApi): boolean { return false; }

  /** A key the person typed in it (the desk's or the dock's typing mode): to the program, or ⏎ runs one that exited again. */
  typed(k: Key): boolean {
    if (this.exited !== null && k.kind === "enter") { this.restart(); return true; }
    const s = this.running ? keyBytes(k, this.term?.modes.applicationCursorKeysMode ?? false, this.kbd.flags) : null;
    if (s === null) return false;
    this.personKeyAt = Date.now();
    this.input(s);
    return true;
  }

  /** The program asked for the mouse. */
  wantsMouse() { return this.running && !this.back && (this.term?.modes.mouseTrackingMode ?? "none") !== "none"; }

  /** A mouse event at x, y in the tile: to the program when it asked, else the wheel scrolls back. */
  mouse(k: Extract<Key, { kind: "mouse" }>, x: number, y: number): boolean {
    // Only the person's mouse comes here (an agent has none): a click in it is them using it, whatever the program asked.
    if (k.action === "down") this.personClickAt = Date.now();
    const mode = this.term?.modes.mouseTrackingMode ?? "none";
    if (this.wantsMouse()) {
      if (k.action === "drag" && mode !== "drag" && mode !== "any") return true;
      if (k.action === "up" && mode === "x10") return true;
      const s = mouseBytes(k, x, y, this.sgr);
      if (s) this.proc?.write(s);
      return true;
    }
    if (k.action === "wheel-up" || k.action === "wheel-down") {
      const max = this.term?.buffer.active.baseY ?? 0;
      this.back = scrolled(this.back, wheelRows(k.action === "wheel-up" ? 1 : -1), max);
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

/** The bytes a terminal sends for a key (src/kbd.ts: the one encoder, Kitty keyboard protocol or legacy). */
export { keyBytes };

/** A mouse event at x, y (0-based, in the tile) as the program asked: SGR (1006) or the old X10 bytes. */
export function mouseBytes(k: Extract<Key, { kind: "mouse" }>, x: number, y: number, sgr: boolean): string | null {
  const mods = (k.mods ?? 0) & 28;
  let b = k.action === "wheel-up" ? 64 : k.action === "wheel-down" ? 65 : k.action === "wheel-left" ? 66 : k.action === "wheel-right" ? 67 : k.button & 3;
  if (k.action === "drag") b += 32;
  b += mods;
  if (sgr) return `\x1b[<${b};${x + 1};${y + 1}${k.action === "up" ? "m" : "M"}`;
  if (k.action === "up") b = 3 + mods;
  if (x > 222 || y > 222) return null;
  return `\x1b[M${String.fromCharCode(32 + b, 33 + x, 33 + y)}`;
}
