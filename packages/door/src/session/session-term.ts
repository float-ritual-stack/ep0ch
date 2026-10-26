import { AsyncLocalStorage } from "node:async_hooks";
// A session's terminal: the one App draws on and reads keys from in a door session (src/session/daemon.ts), made of
// every client attached to it. Each client is a terminal of its own: its own size, Kitty support and video mode, its
// own rows painted (a Painter over its socket) and its own keys decoded. App renders one frame; each client is sent
// it as its terminal can show it.
//
// Two clients at once (a laptop and a phone, two screens) work as tmux's `window-size latest` and Herdr do:
// - **The person's keys are wherever they last typed.** Input from a client makes it the active one: the session is
//   drawn at its size, in its video mode, and a program the door hands the terminal to (the drop shell, $EDITOR)
//   runs there. There is one person and one focus: both clients show the same screen, the same focus, the same
//   drafts.
// - **Another client of another size sees the same frame cut to its size, or with room to spare**, and its bottom row
//   says whose size it is drawn at. Its first key takes the session over; its first click only does that (it was
//   aimed at the frame drawn for the other size), the next one clicks.
// - **A watcher** (`ep0ch session attach --watch`, an agent or a spare screen) is shown the session and never given
//   the person's keys: q or ctrl+c leaves, anything else is ignored.
import { Painter, type Display, type Video } from "../display";
import type { Placement } from "../kitty";
import { Mirror } from "../mirror";
import { C, bg, fg, pad, RESET, visible, headOf } from "../style";
import { paintable } from "../text";
import { GROUND_RESET, KeyDecoder, Rows, STATUS_OK, STATUS_QUERY, type Key, type TermInfo } from "../term";
import type { ClientInfo, DaemonMsg, Hello } from "./protocol";
import type { StatusInput } from "@ep0ch/outline-core/program-status";

/** How a client is reached: its socket, as the daemon holds it. */
export interface Link {
  send(m: DaemonMsg): void;
  /** Bytes sent but not yet taken by the client: a client that stops reading (a phone asleep) isn't buffered without end. */
  backlog(): number;
  /** Called once what waits has gone out. */
  onDrain(f: () => void): void;
  /** Close the connection, saying `bye` first when given. */
  close(bye?: DaemonMsg): void;
}

/** A client that has this much unread output is skipped until it catches up, then painted whole. */
export const BACKLOG_LIMIT = 4 << 20;

/**
 * How many frames a client may have been sent that its terminal hasn't answered (`CSI 5 n` after each, PIE-1163). The daemon
 * can't see the link: its socket to the client is local, and the slow hop is sshd to the terminal, whose buffers hold
 * megabytes (60 to 250 frames) that then play back at link speed. At this many unanswered a client isn't painted; the
 * rows it missed are remembered by `Rows.paint` (it diffs against what it last wrote), and its next answer is painted
 * with the latest. Two: one on the wire while the next is made, never a queue.
 */
export const FRAMES_IN_FLIGHT = 2;
/** A frame unanswered this long is given up on (a terminal that swallowed the answer): the window opens, and it's counted. */
export const ACK_STALE_MS = 5000;
/**
 * A program given the terminal waits this long for the frames in flight to be answered: an answer arriving after would be
 * typed into it. On a link stalled for longer than this the program still gets a stray `ESC [ 0 n` (the program's own output
 * can't cross that link either, so nobody is looking at it yet).
 */
export const HANDOVER_SETTLE_MS = 2000;

/** One attached client: its terminal, its rows and images, its keys. */
/** How long the client with the keys may go untouched before a terminal attaching takes the session from it. */
export const TAKE_AFTER_IDLE_MS = 30_000;

export class SessionClient {
  readonly info: TermInfo;
  readonly rows: ClientRows;
  readonly painter: Painter;
  readonly decoder: KeyDecoder;
  readonly since = Date.now();
  lastInput = 0;
  /** A program has its terminal (the drop shell, $EDITOR): nothing is painted to it meanwhile. */
  away: string | null = null;
  /** It stopped reading: frames are skipped until it drains, then it is painted whole. */
  behind = false;
  /** Its terminal answers `CSI 5 n` (Hello.acks): each frame sent is followed by one, and `inflight` holds when the unanswered ones were sent. */
  readonly acks: boolean;
  inflight: number[] = [];
  /** A frame was skipped because its window was full: the next answer paints the latest. */
  waiting = false;
  /** What the window did, for `peek`: frames skipped, answers given up on, the smoothed round trip of an answer (ms). */
  skipped = 0; ackTimeouts = 0; ackMs: number | null = null;
  staleTimer: Timer | null = null;
  /** Frames given up on whose answers may still come: the next that many answers are theirs, not newer frames'. */
  lost = 0;
  /** Called when `inflight` has emptied (a program waiting to be given the terminal). */
  settled: (() => void)[] = [];
  /** It just took the session at another size: its clicks were aimed at the old frame until it's painted again. */
  fresh = false;
  constructor(readonly id: number, readonly hello: Hello, readonly link: Link) {
    this.info = { cols: clamp(hello.cols, 80), rows: clamp(hello.rows, 25), cellW: clamp(hello.cellW, 9), cellH: clamp(hello.cellH, 18), kitty: !!hello.kitty, pst: !!hello.pst, tree: !!hello.tree, sized: !!hello.sized };
    this.acks = !!hello.acks;
    this.rows = new ClientRows(s => { if (this.sending) this.link.send({ t: "output", text: s }); }, this.info);
    // A frame that goes out is followed by the query its terminal answers once it has taken the frame (never one that doesn't go out).
    if (this.acks) this.rows.afterFrame = () => { if (!this.sending) return ""; this.inflight.push(performance.now()); return STATUS_QUERY; };
    this.painter = new Painter(this.rows);
    this.decoder = new KeyDecoder(this.info);
    // An image its terminal lost (Tern restarted, the client came back): uploaded and placed again (PIE-795).
    this.decoder.kittyError = id => this.painter.imageLost(id);
  }
  get watch() { return !!this.hello.watch; }
  /** Frames reach its terminal: no program has it, and it isn't behind. */
  private get sending() { return !this.away && !this.behind; }
  /** The window is full: its terminal hasn't answered the last FRAMES_IN_FLIGHT frames. */
  get full() { return this.acks && this.inflight.length >= FRAMES_IN_FLIGHT; }
}

const clamp = (n: unknown, d: number) => (Number.isInteger(n) && (n as number) > 0 && (n as number) < 10_000 ? n as number : d);

/** A client's rows: what the session drew, cut to this terminal's width where it's narrower. */
export class ClientRows extends Rows {
  /** The session's width: wider rows than this terminal's are cut, never wrapped or left to overwrite its last cell. */
  wide = 0;
  override paint(lines: string[]): void { super.paint(this.wide > this.info.cols ? lines.map(l => this.cut(l)) : lines); }
  override paintRow(r: number, line: string): void { super.paintRow(r, this.wide > this.info.cols ? this.cut(line) : line); }
  private cut(line: string): string { const l = paintable(line); return Bun.stringWidth(visible(l)) > this.info.cols ? headOf(l, this.info.cols) + RESET : l; }
}

/** The session this process serves (src/session/daemon.ts), for the showcase's section; null in the door's own terminal. */
let serving: SessionTerm | null = null;
export const servingSession = () => serving;
const pressing = new AsyncLocalStorage<SessionClient | null>();
/** An action keeps the terminal that pressed it across service requests and nested dispatch. */
export function fromPress<T>(run: () => T): T {
  const current = pressing.getStore();
  return pressing.run(current === undefined ? serving?.activeClient ?? null : current, run);
}
export const serveAs = (t: SessionTerm | null) => { serving = t; };

export class SessionTerm implements Display {
  /** The session's size and terminal: the active client's (its last), else 80×25 until one attaches. */
  readonly info: TermInfo = { cols: 80, rows: 25, cellW: 9, cellH: 18, kitty: false };
  private clients: SessionClient[] = [];
  private active: SessionClient | null = null;
  private nextId = 1;
  /** The last frame shown: a client that attaches, resizes or catches up is painted from it. */
  private last: { lines: string[]; placements: Placement[] } | null = null;
  /** `peek` and `snap` read the session as drawn at its own size (the active client's video mode). */
  readonly mirror: Mirror;
  private readonly mirrorPainter: Painter;
  private ground = "";
  private keyHandler: (k: Key) => void = () => {};
  private batch: (run: () => void) => void = run => run();
  private resizeHandler: () => void = () => {};
  rawSink: (() => ((bytes: string) => void) | null) | null = null;
  /** Said when a client attaches or goes (the daemon writes its session file). */
  onClients: () => void = () => {};
  /** The person logged off (Goodbye, ctrl+c): the daemon detaches the client they did it from. */
  onLogoff: (c: SessionClient) => void = () => {};
  private runs = 0;
  private running = new Map<number, { c: SessionClient; done: (code: number | null) => void }>();

  /** `size`: what the session was drawn at before (a handoff): its tiles start at that size till a terminal attaches. */
  constructor(size?: { cols: number; rows: number }) {
    if (size) { this.info.cols = clamp(size.cols, 80); this.info.rows = clamp(size.rows, 25); }
    this.mirror = new Mirror(this.info.cols, this.info.rows);
    this.mirrorPainter = new Painter(new Rows(s => this.mirror.write(s), this.info), "cells");
  }

  // ── what App calls (AppTerm) ────────────────────────────────────────────────

  onKey(f: (k: Key) => void) { this.keyHandler = f; }
  onBatch(f: (run: () => void) => void) { this.batch = f; }
  /**
   * Everything one socket read held is one batch (PIE-1300): the frames a busy link delivered together are handled, then
   * the screen is painted once, and a burst of hover reports is folded into the newest (App.key). Without it each
   * `input` frame was a batch of its own and painted for its own report. Batches nest: `input` still opens its own.
   */
  readBatch(run: () => void) { this.batch(run); }
  onResize(f: () => void) { this.resizeHandler = f; }
  /** No terminal is attached: the session renders nothing (a busy terminal tile cost a frame per write, seen by nobody). */
  unseen(): boolean { return !this.clients.length; }
  onSeen(f: () => void) { this.seenHandler = f; }
  private seenHandler: () => void = () => {};
  stop() { /* no terminal of its own: a client's goes back when it detaches */ }
  resume() { /* the same */ }

  /** Raw bytes App writes (the clipboard, OSC 52): the person's terminal, the one with their keys. */
  write(s: string, client = this.active): boolean {
    if (!client || !this.clients.includes(client) || client.away) return false;
    client.link.send({ t: "output", text: s });
    return true;
  }

  setGround(seq: string) {
    if (seq === GROUND_RESET && !this.ground) return;
    this.ground = seq === GROUND_RESET ? "" : seq;
    for (const c of this.clients) this.sendGround(c, seq);
    this.mirror.write(seq);
  }
  private sendGround(c: SessionClient, seq = this.ground) {
    if (!seq || c.away) return;
    c.link.send({ t: "output", text: seq });
    c.link.send({ t: "ground", set: seq !== GROUND_RESET });
  }

  /** The video mode frames are drawn in: the active client's. */
  get video(): Video { return this.active?.painter.video ?? this.mirrorPainter.video; }
  set video(v: Video) { if (this.active) this.active.painter.video = v; this.mirrorPainter.video = v; this.invalidate(); }
  cycleVideo(): string | null {
    if (!this.active) return "no terminal is attached";
    const no = this.active.painter.cycleVideo();
    if (!no) this.mirrorPainter.video = this.active.painter.video;
    return no;
  }

  show(lines: string[], placements: Placement[]): void {
    this.last = { lines, placements };
    for (const c of this.clients) this.paintClient(c);
    this.mirrorPainter.show(lines, placements);
  }
  showRow(r: number, line: string): boolean {
    if (!this.last) return false;
    this.last.lines = [...this.last.lines];
    this.last.lines[r] = line;
    for (const c of this.clients) {
      if (this.sameSize(c) && !c.watch) { if (!c.away && !c.behind && !this.windowFull(c)) this.drawing(c, () => c.painter.showRow(r, line)); }
      else this.paintClient(c);
    }
    this.mirrorPainter.showRow(r, line);
    return true;
  }
  invalidate(): void { for (const c of this.clients) c.rows.invalidate(); this.mirrorPainter.invalidate(); }

  /** The door's own program status (OSC 7501): kept, and told to each client whose terminal speaks it, as it can take it. */
  private statusWant: ReadonlyMap<string, StatusInput> | null = null;
  programStatus(want: ReadonlyMap<string, StatusInput> | null): void {
    this.statusWant = want;
    for (const c of this.clients) this.tellStatus(c);
  }
  /** Tell `c` what it missed: on attach, when a program gives its terminal back, when it caught up. */
  private tellStatus(c: SessionClient) { if (!c.away && !c.behind && this.statusWant) c.painter.programStatus(this.statusWant); }
  dispose(): void { for (const c of this.clients) c.painter.dispose(); this.mirrorPainter.dispose(); }

  /** Run a program in the terminal of the client with the person's keys: its exit code (null when it went away first). */
  handOver(argv: string[], o: { cwd?: string; env?: Record<string, string>; banner?: string } = {}): Promise<number | null> {
    const c = this.active;
    if (!c) return Promise.reject(new Error("no terminal is attached to hand over"));
    if (c.away) return Promise.reject(new Error(`the terminal is already handed over (${c.away})`));
    const id = ++this.runs;
    c.painter.dispose();                 // its images go before the program has the screen; it's painted whole after
    c.away = argv[0] ?? "program";
    const run = () => c.link.send({ t: "run", id, argv, ...(o.cwd ? { cwd: o.cwd } : {}), ...(o.env ? { env: o.env } : {}), ...(o.banner ? { banner: o.banner } : {}) });
    // The frames in flight are answered before the program has the terminal, else the answers are typed into it (an
    // editor would see `ESC [ 0 n`): none are sent from now on, so this is the round trip of the last ones.
    if (c.inflight.length) this.untilAnswered(c, HANDOVER_SETTLE_MS).then(() => { if (this.running.has(id)) run(); });
    else run();
    this.onClients();
    return new Promise(done => this.running.set(id, { c, done }));
  }

  /** The person leaves the terminal they're typing on, or the one they logged off from (`from`): it detaches; the session goes on. */
  detachActive(from?: unknown): boolean {
    const c = from instanceof SessionClient && this.clients.includes(from) ? from : this.active;
    if (!c) return false;
    this.onLogoff(c);
    return true;
  }
  /** The client the person is typing on. */
  typingOn(): SessionClient | null { return pressing.getStore() ?? this.active; }

  /** The session's terminals, for `peek`. */
  session() { return { pid: process.pid, clients: this.list() }; }

  // ── what the daemon calls, for each client ─────────────────────────────────

  /** A client attached: it becomes the active one when nobody else is (a watcher never). */
  attach(link: Link, hello: Hello): SessionClient {
    const c = new SessionClient(this.nextId++, hello, link);
    // A watcher's keys are decoded too (a Kitty keyboard terminal sends ctrl+c as a report), only to leave by.
    c.decoder.keyHandler = c.watch ? k => this.watcherKey(c, k) : k => this.key(c, k);
    if (!c.watch) c.decoder.rawSink = () => this.rawSink?.() ?? null;
    // It caught up: every row is drawn again. Its images stay: the frames skipped meanwhile were never sent, so the terminal
    // still has what it was last sent (one it lost is asked for again, imageLost), and uploading each again over the link
    // that just recovered is what a stall costs most (PIE-1163).
    link.onDrain(() => { if (!c.behind) return; c.behind = false; c.rows.invalidate(); this.paintClient(c); this.tellStatus(c); });
    c.decoder.onStatus = () => this.answered(c);
    const first = !this.clients.length;
    this.clients.push(c);
    this.sendGround(c);
    // The person is where they just attached. A terminal that has the keys but hasn't been typed on for a while is
    // likely one left behind (a terminal app restarted, an ssh not yet dropped): the new one takes the session, at its
    // size, so the frame and its images aren't drawn for a terminal nobody looks at (PIE-795). One typed on in the last
    // 30 s keeps the keys, and so does one running a program the session handed it (what's typed there goes to the
    // program, not here, so its quiet says nothing).
    const idle = this.active ? Date.now() - (this.active.lastInput || this.active.since) : 0;
    if (!c.watch && (!this.active || (!this.active.away && idle >= TAKE_AFTER_IDLE_MS))) this.activate(c);
    else this.paintClient(c);
    this.tellStatus(c);
    // Nobody saw the frames before this one attached: the one App skipped is drawn now, for every client.
    if (first) this.seenHandler();
    this.onClients();
    return c;
  }

  /** A client went (detached, its terminal closed, the connection dropped). Its program, if it ran one, is let go. */
  detach(c: SessionClient): void {
    this.clients = this.clients.filter(x => x !== c);
    if (c.staleTimer) { clearTimeout(c.staleTimer); c.staleTimer = null; }
    for (const [id, r] of this.running) if (r.c === c) { this.running.delete(id); r.done(null); }
    if (this.active === c) {
      this.active = null;
      // The session keeps its size until someone takes it: the one who typed last, if any is left.
      const next = this.clients.filter(x => !x.watch).sort((a, b) => b.lastInput - a.lastInput || b.since - a.since)[0];
      if (next) this.activate(next);
    }
    this.onClients();
  }

  /** What a client's terminal typed. */
  input(c: SessionClient, text: string): void {
    // A terminal's answers to the status queries (`CSI 0 n`) are counted by the decoder and are not the person: they
    // don't make this the client with the keys, nor reset its idle time (a quiet terminal answers every frame it is sent).
    if (text.length && text.replaceAll(STATUS_OK, "") === "") { c.decoder.feed(text); return; }
    c.lastInput = Date.now();
    if (c.watch) { c.decoder.feed(text); return; }
    this.activate(c);
    try { this.batch(() => c.decoder.feed(text)); }
    finally { c.fresh = false; }     // what it types next was aimed at the frame it has been sent since
  }

  /** A client's terminal changed size. */
  resize(c: SessionClient, cols: number, rows: number): void {
    c.info.cols = clamp(cols, c.info.cols); c.info.rows = clamp(rows, c.info.rows);
    c.rows.invalidate();
    if (c === this.active) this.fit(c);
    else this.paintClient(c);
  }

  /** A program this client ran for the session ended. */
  ran(c: SessionClient, id: number, code: number | null): void {
    const r = this.running.get(id);
    if (!r || r.c !== c) return;
    this.running.delete(id);
    c.away = null;
    this.forgetWindow(c);                 // what it was sent before the program had its terminal went to the program, or was answered before
    c.painter.dispose();
    c.rows.invalidate();
    c.decoder.reset();
    this.sendGround(c);
    // The program had that terminal: what the session reports there is said again, whole.
    c.painter.retell();
    this.tellStatus(c);
    this.onClients();
    r.done(code);
  }

  /** Every client, as `peek` and `session list` say them. */
  list(): ClientInfo[] {
    const now = Date.now();
    return this.clients.map(c => ({
      id: c.id, pid: c.hello.pid, ...(c.hello.tty ? { tty: c.hello.tty } : {}), ...(c.hello.nest ? { nest: c.hello.nest } : {}),
      ...(c.hello.clientHost ? { clientHost: c.hello.clientHost } : {}),
      cols: c.info.cols, rows: c.info.rows, video: c.painter.video, active: c === this.active, watch: c.watch,
      since: c.since, idle: c.lastInput ? now - c.lastInput : now - c.since, away: c.away,
    }));
  }
  all(): readonly SessionClient[] { return this.clients; }
  get activeClient(): SessionClient | null { return this.active; }

  // ── inside ──────────────────────────────────────────────────────────────────

  /** A watcher's key: q or ctrl+c stops watching; nothing else is anyone's. */
  private watcherKey(c: SessionClient, k: Key) {
    if (k.kind === "char" && ((k.ch === "q" && !k.ctrl && !k.pasted) || (k.ch === "c" && k.ctrl))) c.link.close({ t: "bye", reason: "detached", message: "stopped watching · the session goes on" });
  }

  private key(c: SessionClient, k: Key) {
    // A click aimed at a frame drawn for another size: it took the session, and that's all it did.
    if (k.kind === "mouse" && c.fresh) return;
    this.keyHandler(k);
  }

  /** `c` has the person's keys from now: the session is drawn at its size and in its video mode. */
  private activate(c: SessionClient): void {
    if (this.active === c || c.watch) return;
    const was = this.active;
    this.active = c;
    this.mirrorPainter.video = c.painter.video;
    c.fresh = this.fit(c);
    if (!c.fresh && was) this.resizeHandler();       // same size, maybe another video mode: drawn again
    this.onClients();
  }

  /** The session takes `c`'s size and terminal; true when its size changed (everything is painted whole). */
  private fit(c: SessionClient): boolean {
    const i = this.info;
    i.cellW = c.info.cellW; i.cellH = c.info.cellH; i.kitty = c.info.kitty; i.sized = c.info.sized;
    if (i.cols === c.info.cols && i.rows === c.info.rows) return false;
    i.cols = c.info.cols; i.rows = c.info.rows;
    this.mirror.resize(i.cols, i.rows);
    for (const x of this.clients) x.rows.wide = i.cols;
    this.invalidate();
    this.resizeHandler();
    return true;
  }

  private sameSize(c: SessionClient) { return c.info.cols === this.info.cols && c.info.rows === this.info.rows; }

  private drawing(c: SessionClient, run: () => void): void {
    try { run(); }
    catch (e) {
      console.error(`${new Date().toISOString()} session client ${c.id} (pid ${c.hello.pid}): exception drawing: ${e instanceof Error ? e.stack : String(e)}`);
      throw e;
    }
  }

  // ── the frames in flight (PIE-1163) ─────────────────────────────────────────

  /** Whether `c` isn't painted now because its terminal hasn't answered the last frames; the next answer paints it (the latest). */
  private windowFull(c: SessionClient): boolean {
    if (!c.full) return false;
    c.waiting = true; c.skipped++;
    this.watchStale(c);
    return true;
  }

  /** `c`'s terminal answered a status query: the oldest frame in flight has been taken. */
  private answered(c: SessionClient): void {
    if (c.lost) { c.lost--; return; }         // the answer to a frame given up on
    const sent = c.inflight.shift();
    if (sent === undefined) return;           // none was asked (an old answer after a handoff, or one given up on)
    const ms = performance.now() - sent;
    c.ackMs = c.ackMs === null ? ms : c.ackMs * 0.7 + ms * 0.3;
    if (!c.inflight.length) { const w = c.settled; c.settled = []; for (const f of w) f(); }
    if (c.waiting && !c.full) { c.waiting = false; this.paintClient(c); }
  }

  /** The unanswered frames of `c` are forgotten: it starts again with an open window (a program had its terminal; an answer never came). */
  private forgetWindow(c: SessionClient): void {
    c.inflight = []; c.waiting = false;
    const w = c.settled; c.settled = []; for (const f of w) f();
  }

  /** Resolves when `c` has answered everything it was sent, or after `ms`: what is then unanswered is forgotten. */
  private untilAnswered(c: SessionClient, ms: number): Promise<void> {
    return new Promise(res => {
      const timer = setTimeout(() => { c.settled = c.settled.filter(f => f !== done); this.forgetWindow(c); res(); }, ms);
      const done = () => { clearTimeout(timer); res(); };
      c.settled.push(done);
    });
  }

  /** Ack time (ms) after which a frame unanswered is given up on: settable for a test. */
  ackStaleMs = ACK_STALE_MS;
  /** A client waiting on an answer that never comes is painted again after ACK_STALE_MS, once, and it is counted. */
  private watchStale(c: SessionClient): void {
    if (c.staleTimer || !c.inflight.length) return;
    const wait = Math.max(1, this.ackStaleMs - (performance.now() - c.inflight[0]!));
    c.staleTimer = setTimeout(() => {
      c.staleTimer = null;
      if (!this.clients.includes(c) || !c.inflight.length) return;
      if (performance.now() - c.inflight[0]! < this.ackStaleMs) return this.watchStale(c);
      c.ackTimeouts++;
      const skipped = c.waiting;
      c.lost += c.inflight.length;
      this.forgetWindow(c);
      if (skipped) this.paintClient(c);
    }, wait);
    c.staleTimer.unref?.();
  }

  /** How each client's window stands, for `peek`'s `speed` (the daemon sees its socket; the terminal's answers say the link): frames unanswered, skipped, the round trip. */
  speed(): { id: number; acks: boolean; unacked: number; skipped: number; ackMs: number | null; ackTimeouts: number }[] {
    return this.clients.map(c => ({ id: c.id, acks: c.acks, unacked: c.inflight.length, skipped: c.skipped, ackMs: c.ackMs === null ? null : Math.round(c.ackMs * 10) / 10, ackTimeouts: c.ackTimeouts }));
  }

  private paintClient(c: SessionClient): void {
    this.drawing(c, () => this.drawClient(c));
  }

  /** The last frame, as `c` can show it: cut or padded to its size, and its bottom row saying why when it isn't the session's. */
  private drawClient(c: SessionClient): void {
    if (!this.last || c.away) return;
    if (this.windowFull(c)) return;
    if (c.link.backlog() > BACKLOG_LIMIT) { c.behind = true; return; }
    if (c.behind) return;
    c.rows.wide = this.info.cols;
    const { lines, placements } = this.last;
    const note = c.watch ? `watching ${this.info.cols}×${this.info.rows} · read-only · q stops watching`
      : !this.sameSize(c) ? `drawn at ${this.info.cols}×${this.info.rows} for another terminal · a key here draws it at ${c.info.cols}×${c.info.rows}` : null;
    if (!note) { c.painter.show(lines, placements); return; }
    const rows = c.info.rows, out = lines.slice(0, rows);
    while (out.length < rows) out.push("");
    out[rows - 1] = bg(C.blue) + fg(C.yellow) + pad(` ${note}`, c.info.cols) + RESET;
    // An image that doesn't fit whole, or lies under the note, isn't placed.
    const fits = placements.filter(p => p.row + p.rows <= rows - 1 && p.col + p.cols <= c.info.cols);
    c.painter.show(out, fits);
  }
}
