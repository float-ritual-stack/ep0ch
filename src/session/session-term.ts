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
import { GROUND_RESET, KeyDecoder, Rows, type Key, type TermInfo } from "../term";
import type { ClientInfo, DaemonMsg, Hello } from "./protocol";

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

/** One attached client: its terminal, its rows and images, its keys. */
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
  /** It just took the session at another size: its clicks were aimed at the old frame until it's painted again. */
  fresh = false;
  constructor(readonly id: number, readonly hello: Hello, readonly link: Link) {
    this.info = { cols: clamp(hello.cols, 80), rows: clamp(hello.rows, 25), cellW: clamp(hello.cellW, 9), cellH: clamp(hello.cellH, 18), kitty: !!hello.kitty };
    this.rows = new ClientRows(s => { if (!this.away && !this.behind) this.link.send({ t: "output", text: s }); }, this.info);
    this.painter = new Painter(this.rows);
    this.decoder = new KeyDecoder(this.info);
  }
  get watch() { return !!this.hello.watch; }
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

  constructor() {
    this.mirror = new Mirror(this.info.cols, this.info.rows);
    this.mirrorPainter = new Painter(new Rows(s => this.mirror.write(s), this.info), "cells");
  }

  // ── what App calls (AppTerm) ────────────────────────────────────────────────

  onKey(f: (k: Key) => void) { this.keyHandler = f; }
  onBatch(f: (run: () => void) => void) { this.batch = f; }
  onResize(f: () => void) { this.resizeHandler = f; }
  stop() { /* no terminal of its own: a client's goes back when it detaches */ }
  resume() { /* the same */ }

  /** Raw bytes App writes (the clipboard, OSC 52): the person's terminal, the one with their keys. */
  write(s: string) { if (this.active && !this.active.away) this.active.link.send({ t: "output", text: s }); }

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
      if (this.sameSize(c) && !c.watch) { if (!c.away && !c.behind) c.painter.showRow(r, line); }
      else this.paintClient(c);
    }
    this.mirrorPainter.showRow(r, line);
    return true;
  }
  invalidate(): void { for (const c of this.clients) c.rows.invalidate(); this.mirrorPainter.invalidate(); }
  dispose(): void { for (const c of this.clients) c.painter.dispose(); this.mirrorPainter.dispose(); }

  /** Run a program in the terminal of the client with the person's keys: its exit code (null when it went away first). */
  handOver(argv: string[], o: { cwd?: string; env?: Record<string, string>; banner?: string } = {}): Promise<number | null> {
    const c = this.active;
    if (!c) return Promise.reject(new Error("no terminal is attached to hand over"));
    if (c.away) return Promise.reject(new Error(`the terminal is already handed over (${c.away})`));
    const id = ++this.runs;
    c.painter.dispose();                 // its images go before the program has the screen; it's painted whole after
    c.away = argv[0] ?? "program";
    c.link.send({ t: "run", id, argv, ...(o.cwd ? { cwd: o.cwd } : {}), ...(o.env ? { env: o.env } : {}), ...(o.banner ? { banner: o.banner } : {}) });
    this.onClients();
    return new Promise(done => this.running.set(id, { c, done }));
  }

  /** The person leaves the terminal they're typing on (App.logoff): it detaches; the session goes on. */
  detachActive(): boolean {
    const c = this.active;
    if (!c) return false;
    this.onLogoff(c);
    return true;
  }

  /** The session's terminals, for `peek`. */
  session() { return { pid: process.pid, clients: this.list() }; }

  // ── what the daemon calls, for each client ─────────────────────────────────

  /** A client attached: it becomes the active one when nobody else is (a watcher never). */
  attach(link: Link, hello: Hello): SessionClient {
    const c = new SessionClient(this.nextId++, hello, link);
    c.decoder.keyHandler = k => this.key(c, k);
    c.decoder.rawSink = () => this.rawSink?.() ?? null;
    link.onDrain(() => { if (!c.behind) return; c.behind = false; c.painter.dispose(); c.rows.invalidate(); this.paintClient(c); });
    this.clients.push(c);
    this.sendGround(c);
    if (!c.watch && !this.active) this.activate(c);
    else this.paintClient(c);
    this.onClients();
    return c;
  }

  /** A client went (detached, its terminal closed, the connection dropped). Its program, if it ran one, is let go. */
  detach(c: SessionClient): void {
    this.clients = this.clients.filter(x => x !== c);
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
    c.lastInput = Date.now();
    if (c.watch) { if (/[q\x03]/.test(text)) c.link.close({ t: "bye", reason: "detached", message: "stopped watching · the session goes on" }); return; }
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
    c.painter.dispose();
    c.rows.invalidate();
    this.sendGround(c);
    this.onClients();
    r.done(code);
  }

  /** Every client, as `peek` and `session list` say them. */
  list(): ClientInfo[] {
    const now = Date.now();
    return this.clients.map(c => ({
      id: c.id, pid: c.hello.pid, ...(c.hello.tty ? { tty: c.hello.tty } : {}), ...(c.hello.nest ? { nest: c.hello.nest } : {}),
      cols: c.info.cols, rows: c.info.rows, video: c.painter.video, active: c === this.active, watch: c.watch,
      since: c.since, idle: c.lastInput ? now - c.lastInput : now - c.since, away: c.away,
    }));
  }
  all(): readonly SessionClient[] { return this.clients; }
  get activeClient(): SessionClient | null { return this.active; }

  // ── inside ──────────────────────────────────────────────────────────────────

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
    i.cellW = c.info.cellW; i.cellH = c.info.cellH; i.kitty = c.info.kitty;
    if (i.cols === c.info.cols && i.rows === c.info.rows) return false;
    i.cols = c.info.cols; i.rows = c.info.rows;
    this.mirror.resize(i.cols, i.rows);
    for (const x of this.clients) x.rows.wide = i.cols;
    this.invalidate();
    this.resizeHandler();
    return true;
  }

  private sameSize(c: SessionClient) { return c.info.cols === this.info.cols && c.info.rows === this.info.rows; }

  /** The last frame, as `c` can show it: cut or padded to its size, and its bottom row saying why when it isn't the session's. */
  private paintClient(c: SessionClient): void {
    if (!this.last || c.away) return;
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
