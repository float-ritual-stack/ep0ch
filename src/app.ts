// The door: a stack of screens, one status bar, one paint per change.
import type { Placement } from "./kitty";
import { KittyLayer } from "./kitty";
import type { SocketBoard, OutlineEvent } from "./socket";
import { bg, C, fg, pad, RESET, width } from "./style";
import type { Key, Term, TermInfo } from "./term";
import { crtUnderlay } from "./crt";
import { invalidateLive, setLiveSource } from "./live";

export interface Frame { lines: string[]; placements?: Placement[] }

export type Video = "kitty+crt" | "kitty" | "cells";

export interface Ctx {
  t: TermInfo;
  board: SocketBoard;
  host: string;
  workspace: string;
  video: Video;
  get graphics(): boolean;
  push(s: Screen): void;
  pop(): void;
  replace(s: Screen): void;
  quit(): void;
  redraw(): void;
  flash(msg: string): void;
  cycleVideo(): void;
  /** Hand the terminal to another program ($EDITOR) for the duration of `run`, then repaint. */
  suspend(run: () => void): void;
  lastCall: number;
  events: number;          // outline changes seen since the menu last looked
}

export interface Screen {
  title: string;
  /** Rows available = t.rows - 1 (the last row is the status bar). */
  render(ctx: Ctx): Frame;
  key(k: Key, ctx: Ctx): void;
  enter?(ctx: Ctx): void;
  /** Called ~30×/s while it returns true (modem-speed reveals). */
  tick?(ctx: Ctx): boolean;
  onEvent?(e: OutlineEvent, ctx: Ctx): void;
  /** True while the screen holds a draft that hasn't been saved; closing it or quitting then asks twice. */
  unsaved?(): boolean;
  /** The screen is being closed with unsaved drafts: copy them to disk, return where they went. */
  keepDrafts?(): string[];
  /** What this screen shows, for agents (`ep0ch-door peek`). */
  describe?(): unknown;
  /** Put a block in front of the user (`ep0ch-door open <id>`). */
  openBlock?(m: import("./board").Msg): void;
}

export class App implements Ctx {
  private stack: Screen[] = [];
  private kitty: KittyLayer;
  private message = "";
  private messageUntil = 0;
  private timer: Timer | null = null;
  private started = Date.now();
  private quitArmed = 0;
  host = "";
  workspace = "";
  video: Video;
  events = 0;
  /** The event connection to the service is down; the door is reconnecting. */
  offline = false;

  constructor(private readonly term: Term, readonly board: SocketBoard, public lastCall: number, private readonly done: () => void) {
    this.kitty = new KittyLayer(term.write);
    this.video = term.info.kitty ? "kitty+crt" : "cells";
    term.onKey(k => this.key(k));
    setLiveSource(board, () => this.redraw());
    board.onConnection = (state, detail) => { this.offline = state === "lost"; this.flash(state === "lost" ? detail : `reconnected · ${detail}`); };
    term.onResize(() => this.redraw());
    this.timer = setInterval(() => this.tick(), 33);
  }

  get t() { return this.term.info; }
  get graphics() { return this.video !== "cells"; }

  push(s: Screen) { this.stack.push(s); s.enter?.(this); this.redraw(); }
  pop() { if (!this.leaving([this.stack.at(-1)])) return; this.stack.pop(); if (!this.stack.length) return this.quit(); this.redraw(); }
  replace(s: Screen) { if (!this.leaving([this.stack.at(-1)])) return; this.stack.pop(); this.push(s); }

  /**
   * Closing screens that hold unsaved edits asks twice. The second time goes ahead, but the drafts are
   * copied to disk first, so typed text is never simply dropped.
   */
  private leaving(screens: (Screen | undefined)[]): boolean {
    const dirty = screens.filter((s): s is Screen => !!s?.unsaved?.());
    if (!dirty.length) return true;
    if (Date.now() - this.quitArmed < 3000) { this.quitArmed = 0; dirty.forEach(s => s.keepDrafts?.()); return true; }
    this.quitArmed = Date.now();
    this.flash("an edit isn't saved · ctrl+s saves it · again within 3s leaves (the draft is copied to disk)");
    return false;
  }
  flash(msg: string) { this.message = msg; this.messageUntil = Date.now() + 4000; this.redraw(); }
  cycleVideo() {
    if (!this.term.info.kitty) { this.flash("this terminal did not answer the Kitty graphics query; cells only"); return; }
    this.video = this.video === "kitty+crt" ? "kitty" : this.video === "kitty" ? "cells" : "kitty+crt";
    this.term.invalidate();
    this.flash(`video: ${this.video}`);
  }

  suspend(run: () => void) {
    this.kitty.dispose();                  // images don't survive the screen switch; the next paint re-uploads
    this.term.stop();
    try { run(); } finally {
      this.term.resume();
      this.redraw();
    }
  }

  event(e: OutlineEvent) {
    if (!forScreens(e)) return;
    if (e.change?.kind !== "draft") invalidateLive();
    if (e.change || e.action !== "reconnected") this.events++;
    this.stack.at(-1)?.onEvent?.(e, this);
    this.redraw();
  }

  describe() {
    const s = this.stack.at(-1);
    const b = this.board;
    const service = { capabilities: b.capabilities ? [...b.capabilities] : null, offline: this.offline, sequence: b.lastSequence,
      uses: (["views.read", "blocks.read", "changes.since", "properties.preview"] as const).map(c => `${c}:${b.supports(c) ?? "untried"}`) };
    return { screen: s?.title, stack: this.stack.map(x => x.title), video: this.video, host: this.host, workspace: this.workspace, service, state: s?.describe?.() ?? null };
  }

  async openBlock(id: string): Promise<string> {
    const m = await this.board.get(id);
    if (!m) throw new Error(`no block ${id}`);
    const s = this.stack.at(-1);
    if (!s?.openBlock) throw new Error(`the ${s?.title ?? "current"} screen can't open blocks; open the board or desk first`);
    s.openBlock(m);
    this.flash(`an agent opened: ${m.text.split("\n")[0]!.slice(0, 60)}`);
    this.redraw();
    return m.id;
  }

  /**
   * SIGTERM or SIGHUP: there is no one to ask. Every screen's unsaved edits and comments are copied to
   * disk first, then the door quits.
   */
  terminate(): string[] {
    const kept: string[] = [];
    for (const s of this.stack) { try { kept.push(...(s.keepDrafts?.() ?? [])); } catch { /* keep going: the rest still get copied */ } }
    this.keptOnExit = kept;
    this.quit();
    return kept;
  }
  /** Where `terminate` copied unsaved text, for the exit message. */
  keptOnExit: string[] = [];

  quit() {
    if (this.timer) clearInterval(this.timer);
    this.kitty.dispose();
    this.done();
  }

  private key(k: Key) {
    if (k.kind === "char" && k.ctrl && k.ch === "c") { if (this.leaving(this.stack)) this.quit(); return; }
    this.stack.at(-1)?.key(k, this);
  }

  private tick() {
    const s = this.stack.at(-1);
    const expired = this.message && Date.now() > this.messageUntil;
    if (expired) this.message = "";
    if (s?.tick?.(this) || expired) this.redraw();
  }

  redraw() {
    const s = this.stack.at(-1);
    if (!s) return;
    const { cols, rows } = this.term.info;
    const frame = s.render(this);
    const lines = frame.lines.slice(0, rows - 1);
    while (lines.length < rows - 1) lines.push("");
    lines.push(this.statusBar(s, cols));
    const placements = this.graphics ? [...(frame.placements ?? [])] : [];
    if (this.video === "kitty+crt") placements.unshift(crtUnderlay(this.term.info));
    this.term.paint(lines);
    this.kitty.sync(placements);
  }

  private statusBar(s: Screen, cols: number): string {
    const mins = Math.floor((Date.now() - this.started) / 60000);
    const clock = new Date().toTimeString().slice(0, 5);
    const left = ` ${fg(C.white)}ep0ch${fg(C.lcyan)} │ ${s.title} │ ${this.host}:${this.workspace}`;
    const right = `${this.offline ? `${fg(C.lred)}offline ${fg(C.lcyan)}│ ` : ""}${this.events ? `${fg(C.yellow)}+${this.events} new ${fg(C.lcyan)}│ ` : ""}${this.video} │ on ${mins}m │ ${clock} `;
    const middle = this.message ? ` ${fg(C.yellow)}${this.message}${fg(C.lcyan)}` : "";
    const room = Math.max(0, cols - [...right.replace(/\x1b\[[\d;]*m/g, "")].length);
    // A message outranks the location: in a narrow pane it replaces it rather than being cut off.
    const body = pad(middle && width(left + middle) > room ? middle : left + middle, room);
    return bg(C.blue) + fg(C.lcyan) + body + right + RESET;
  }
}

/**
 * Which service events the screens see: content changes, and change records in other domains (a
 * lane's reorder arrives with `domain: "view"`). Other view events (clients registering) aren't news.
 */
export function forScreens(e: OutlineEvent): boolean {
  return e.domain === "content" || !!e.change;
}
