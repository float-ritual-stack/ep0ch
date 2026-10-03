// Live progress for `ep0ch install` and `ep0ch doctor`, for a person at a terminal: the one reporter every
// step and phase goes through. At a terminal, a running step's line spins with its elapsed time, the child's
// latest output line sits dimmed under it, a step of several items counts them (a bar when sizes are known),
// and the step's line becomes its timed ✓ or ✗ when it ends. Piped, in CI, on a dumb terminal: the plain
// lines as before, no escapes. With --json: nothing (the JSON is the output).
import { kittyHint } from "../kitty";
import { C, fg, headOf, RESET, width } from "../style";
import { paintable, printable } from "../text";

type Env = Record<string, string | undefined>;

/** Where the live lines go: process.stdout, or a test's recorder. */
export interface Terminal { isTTY?: boolean; columns?: number; write(s: string): unknown }

/** live: redrawn in place at a terminal. plain: line by line, no escapes. quiet: nothing (--json). */
export type ProgressMode = "live" | "plain" | "quiet";

export function progressMode(o: { json: boolean; terminal?: Terminal; env: Env }): ProgressMode {
  if (o.json) return "quiet";
  // A dumb terminal can't move the cursor; CI logs keep every byte.
  if (!o.terminal?.isTTY || o.env.TERM === "dumb" || (o.env.CI && !/^(false|0)$/i.test(o.env.CI))) return "plain";
  return "live";
}

/** Braille dots where the font has them; | / - \ on a dumb terminal or where the door would draw in cells. */
export const SPINNER = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
export const ASCII_SPINNER = ["|", "/", "-", "\\"];
export const spinnerFor = (env: Env) => (env.TERM === "dumb" || kittyHint(env) === false ? ASCII_SPINNER : SPINNER);

/** How often a live line is redrawn, at most: a chatty child can't flood the terminal. */
export const FRAME_MS = 100;

/** 0.4s, 14s, 2m 05s */
export function elapsed(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** 41 MB */
export function size(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes, u = 0;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return `${u && n < 10 ? n.toFixed(1) : Math.round(n)} ${units[u]}`;
}

/** [████████░░░░] */
export const bar = (done: number, total: number, cells = 12) => {
  const full = total > 0 ? Math.min(cells, Math.round((done / total) * cells)) : 0;
  return `[${"█".repeat(full)}${"░".repeat(cells - full)}]`;
};

/** Rows as aligned columns (two spaces between), each line after `indent`; the last column isn't padded. */
export function table(rows: readonly (readonly string[])[], indent = "    "): string[] {
  const widths: number[] = [];
  for (const r of rows) r.forEach((c, i) => { widths[i] = Math.max(widths[i] ?? 0, width(c)); });
  return rows.map(r => `${indent}${r.map((c, i) => (i < r.length - 1 ? c + " ".repeat(widths[i]! - width(c)) : c)).join("  ")}`.trimEnd());
}

/**
 * A sentence's parts joined with "; " at the top level, one per line (a "; " inside parentheses stays): a
 * semicolon-joined paragraph made scannable.
 */
export function clauses(s: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && s[i + 1] === " " && depth === 0) { out.push(s.slice(start, i)); start = i + 2; }
  }
  out.push(s.slice(start));
  return out.filter(Boolean);
}

/** A running step (or a phase like checking the stack) as the reporter shows it. */
export interface TaskHead {
  /** "2": the step's number; none for a phase. */
  lead?: string;
  /** Its mark while it waits, as the plan prints it (→). */
  mark: string;
  title: string;
  /** Lines under its title: why it runs. */
  body?: string[];
  /** A phase leaves nothing behind: its lines go when it ends (the output that follows says what it found). */
  transient?: boolean;
}

export interface Task {
  /** A line of what it did (`✓ …` under the step); kept. */
  say(line: string): void;
  /** The child's latest output line: shown dimmed under the step while it runs, then gone. */
  child(line: string): void;
  /** Items done of a total (3/9), what runs now, and bytes when sizes are known (a bar). */
  count(done: number, total: number, label?: string, bytes?: { done: number; total: number }): void;
  /** Draw now: before work that holds the event loop (a database copy), so the screen says what runs. */
  flush(): void;
  /** Its line becomes ✓ (or ✗), timed. */
  end(ok: boolean): void;
}

export interface ProgressOptions {
  mode: ProgressMode;
  /** A finished line, in plain mode (and before or after a live region). */
  out: (line: string) => void;
  terminal?: Terminal;
  env?: Env;
  /** Paths as ~/…, applied to what the live region draws. */
  tidy?: (s: string) => string;
  now?: () => number;
  /** The redraw timer; tests drive it by hand. */
  every?: (fn: () => void, ms: number) => () => void;
}

const HIDE = "\x1b[?25l", SHOW = "\x1b[?25h";

export class Progress {
  readonly mode: ProgressMode;
  private readonly o: ProgressOptions;
  private readonly color: boolean;
  private readonly spinner: string[];
  private live: LiveTask | null = null;
  /** What runs now, for an interrupt's message. */
  private current: TaskHead | null = null;
  private drawn = 0;
  private hidden = false;
  private frame = 0;
  private stop: (() => void) | null = null;

  constructor(o: ProgressOptions) {
    this.o = o;
    this.mode = o.mode;
    const env = o.env ?? process.env;
    this.color = !env.NO_COLOR;
    this.spinner = spinnerFor(env);
  }

  /** A finished line. */
  line(s: string): void {
    if (this.mode === "quiet") return;
    if (this.mode === "plain" || !this.o.terminal) { this.o.out(s); return; }
    this.o.terminal.write(`${this.tidy(s)}\n`);
  }

  /** Starts a step or phase; one at a time. */
  task(head: TaskHead): Task {
    this.current = head;
    if (this.mode !== "live") {
      if (this.mode === "plain" && !head.transient) {
        this.o.out(`${head.lead ? `${head.lead} ` : ""}${head.mark} ${head.title}`);
        head.body?.forEach(l => this.o.out(l));
      }
      const plain = this.mode === "plain" && !head.transient;
      return {
        say: l => { if (plain) this.o.out(l); },
        child: () => {}, count: () => {}, flush: () => {},
        end: () => { this.current = null; },
      };
    }
    const t: LiveTask = { head, started: this.now(), says: [], childLine: "", counted: null };
    this.live = t;
    this.draw();
    const every = this.o.every ?? ((fn, ms) => { const h = setInterval(fn, ms); return () => clearInterval(h); });
    this.stop = every(() => { this.frame++; this.draw(); }, FRAME_MS);
    return {
      say: l => { t.says.push(l); },
      child: l => { const c = printable(l, " ").trim(); if (c) t.childLine = c; },
      count: (done, total, label, bytes) => { t.counted = { done, total, label, bytes }; },
      flush: () => this.draw(),
      end: ok => this.finish(t, ok ? "ok" : "failed"),
    };
  }

  /**
   * Ctrl+C: the running step's line becomes ✗ interrupted, the cursor comes back, and what was interrupted is
   * returned for the message (null when nothing ran).
   */
  interrupt(): TaskHead | null {
    const head = this.current;
    if (this.live) this.finish(this.live, "interrupted");
    this.showCursor();
    this.current = null;
    return head;
  }

  /** After the command, whatever happened: a step left running (an exception out of it) ends as ✗, the cursor shown. */
  close(): void {
    if (this.live) this.finish(this.live, "failed");
    this.showCursor();
    this.current = null;
  }

  private finish(t: LiveTask, how: "ok" | "failed" | "interrupted") {
    if (this.live !== t) return;
    this.stop?.(); this.stop = null;
    this.live = null;
    this.current = null;
    const took = elapsed(this.now() - t.started);
    if (t.head.transient && how !== "interrupted") {
      this.erase();
    } else {
      const mark = how === "ok" ? this.paint(C.lgreen, "✓") : this.paint(C.lred, "✗");
      const time = this.paint(C.dark, how === "interrupted" ? `· interrupted after ${took}` : `· ${took}`);
      // The finished lines are kept whole: only a running region is cut to the screen's width.
      this.o.terminal!.write(this.over([`${this.lead(t.head)}${mark} ${t.head.title} ${time}`, ...(t.head.body ?? []), ...t.says].map(l => this.tidy(l)), "\n"));
      this.drawn = 0;
    }
    this.showCursor();
  }

  private draw() {
    const t = this.live;
    if (!t) return;
    // Room at the end of each line: the terminal echoes ^C after the last one, and a wrap there would leave a
    // stray line above the interrupted step.
    const cols = Math.max(20, (this.o.terminal!.columns ?? 80) - 3);
    const fit = (s: string) => (width(s) > cols ? `${headOf(s, cols - 1)}…` : s);
    const spin = this.paint(C.lcyan, this.spinner[this.frame % this.spinner.length]!);
    const lines = [`${this.lead(t.head)}${spin} ${t.head.title} ${this.paint(C.dark, `· ${elapsed(this.now() - t.started)}`)}`, ...(t.head.body ?? []), ...t.says];
    const n = t.counted;
    if (n) lines.push(`    ${n.bytes ? `${bar(n.bytes.done, n.bytes.total)} ` : ""}${n.done}/${n.total}${n.label ? ` · ${n.label}` : ""}`);
    if (t.childLine) lines.push(this.paint(C.dark, `    ${t.childLine}`));
    const s = this.over(lines.map(l => this.colourEnd(fit(this.tidy(l)))), "");
    this.o.terminal!.write(this.hidden ? s : HIDE + s);
    this.hidden = true;
    this.drawn = lines.length;
  }

  /**
   * `lines` over the region drawn before: back to its first line, each line written and the rest of its row
   * cleared, and the rows below cleared when there are fewer now. Never a clear from the screen's top-left
   * corner: tmux (scroll-on-clear) and some terminals push a cleared screen into the scrollback.
   */
  private over(lines: string[], end: "" | "\n"): string {
    const up = this.drawn > 1 ? `\x1b[${this.drawn - 1}A` : "";
    // Only the reporter's own colours reach the terminal: a why or a said line can carry a child's error text.
    return `${this.drawn ? `${up}\r` : ""}${lines.map(l => `${paintable(l)}\x1b[K`).join("\n")}${end}${lines.length < this.drawn ? "\x1b[J" : ""}`;
  }

  /** The region's rows emptied, the cursor back on its first: what's printed next takes its place. */
  private erase() {
    if (!this.drawn) return;
    const up = this.drawn > 1 ? `\x1b[${this.drawn - 1}A` : "";
    this.o.terminal!.write(`${up}\r${Array(this.drawn).fill("\x1b[2K").join("\x1b[1B")}${up}`);
    this.drawn = 0;
  }

  private showCursor() {
    if (this.hidden) { this.o.terminal?.write(SHOW); this.hidden = false; }
  }

  private lead = (h: TaskHead) => (h.lead ? `${h.lead} ` : "");
  private paint = (c: number, s: string) => (this.color ? `${fg(c)}${s}${RESET}` : s);
  /** A cut line can lose its RESET: end every coloured line with one. */
  private colourEnd = (s: string) => (this.color && s.includes("\x1b[") && !s.endsWith(RESET) ? s + RESET : s);
  private tidy = (s: string) => (this.o.tidy ? this.o.tidy(s) : s);
  private now = () => (this.o.now ? this.o.now() : Date.now());
}

interface LiveTask {
  head: TaskHead;
  started: number;
  says: string[];
  childLine: string;
  counted: { done: number; total: number; label?: string; bytes?: { done: number; total: number } } | null;
}
