/**
 * How a Herdr client (Tree, Detail, goto, capture, backlink peek, choose-outline, the branch navigator) starts,
 * queues its work, holds the terminal and leaves it. A new popup is a controller and a draw handed to
 * `startHerdrClient` and `createHerdrSession`, not a copy of another main file.
 *
 * - `startHerdrClient`: the theme, the paths, the client and its compatibility check, the keymap.
 * - `createHerdrSession`: the work queue, the screen (alternate screen, cursor, mouse, bracketed paste), the input
 *   (keys, clicks and pastes, split), resize, the signals and one ordered leave.
 */
import { StdinBuffer, type ProcessTerminal } from "@earendil-works/pi-tui";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { emitKeypressEvents } from "node:readline";
import { PassThrough, type Readable } from "node:stream";
import { createOutlinerClient, type OutlinerClient } from "./client";
import { reexecClient } from "./client-code";
import { OutlinerActionKeymap } from "./outliner-actions";
import { reportCurrentPaneWorkspace } from "./pane-control";
import { resolveClientPaths, type OutlinerClientPaths } from "./paths";
import { reportWhile } from "./program-status-emit";
import { waitForCompatibleService } from "./service-compatibility";
import {
  BRACKETED_PASTE_DISABLE,
  BRACKETED_PASTE_ENABLE,
  TerminalInputDecoder,
  type TerminalInputAction,
  type TerminalKey,
} from "./terminal";
import { isTreeMouseSequence } from "./tree-mouse";

/** Refuses outside Herdr: `<what> requires Herdr`. */
export function requireHerdr(what: string): void {
  if (process.env.HERDR_ENV !== "1") throw new Error(`${what} requires Herdr`);
}

export interface HerdrClientStart {
  readonly paths: OutlinerClientPaths;
  readonly client: OutlinerClient;
  /** The person's keymap, read on first use. */
  readonly keymap: OutlinerActionKeymap;
}

/**
 * The theme, the paths (the pane told which folder it acts for), the client, and, with `compatible`, the service's
 * protocol checked before anything is drawn or written (it throws, naming the side to update).
 */
export async function startHerdrClient(options: { herdr?: string; compatible?: boolean } = {}): Promise<HerdrClientStart> {
  if (options.herdr) requireHerdr(options.herdr);
  initTheme(undefined, false);
  const paths = resolveClientPaths();
  reportCurrentPaneWorkspace(paths.workspaceRoot);
  const client = createOutlinerClient(paths);
  if (options.compatible) await client.requireCompatibleService();
  let keymap: OutlinerActionKeymap | undefined;
  return { paths, client, get keymap() { return keymap ??= OutlinerActionKeymap.load(); } };
}

/**
 * Waits for a compatible outline host, saying so to a terminal that speaks the Program Status Protocol (OSC 7501).
 * Tree and Detail start before the host may be up; a popup checks once (`startHerdrClient`'s `compatible`).
 */
export async function waitForService(client: OutlinerClient, paths: OutlinerClientPaths, app: string): Promise<void> {
  try {
    await reportWhile(app, "waiting for the outline host", () => waitForCompatibleService(client, {
      timeoutMs: paths.mode === "remote" ? 30_000 : 5_000,
      pingTimeoutMs: paths.mode === "remote" ? 3_000 : 300,
    }));
  } catch (error) {
    throw new Error(`Compatible outliner service is not available: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Mouse reporting: clicks and the wheel (SGR), or with button motion for drags. */
export type MouseMode = "click" | "drag";
export interface ScreenModes {
  mouse?: MouseMode | false;
  /** Bracketed paste, so a paste arrives as one piece and never as keys. */
  paste?: boolean;
}

function mouseModes(mouse: MouseMode | false | undefined): number[] {
  return !mouse ? [] : mouse === "drag" ? [1000, 1002, 1006] : [1000, 1006];
}

/** The alternate screen, the cursor hidden, then the modes asked for. */
export function screenEnter(modes: ScreenModes): string {
  return `\x1b[?1049h\x1b[?25l${mouseModes(modes.mouse).map(mode => `\x1b[?${mode}h`).join("")}${modes.paste ? BRACKETED_PASTE_ENABLE : ""}`;
}

/** Every mode `screenEnter` turned on, off in reverse, then the cursor and the main screen back. */
export function screenLeave(modes: ScreenModes): string {
  return `${modes.paste ? BRACKETED_PASTE_DISABLE : ""}${mouseModes(modes.mouse).reverse().map(mode => `\x1b[?${mode}l`).join("")}\x1b[?25h\x1b[?1049l`;
}

export interface KeypressHandlers {
  keypress(text: string, key: TerminalKey, action: TerminalInputAction): void;
  /** A bracketed paste, whole. Without it a paste is dropped, never typed as keys. */
  paste?(text: string): void;
  /** A complete SGR mouse report. Without it clicks are dropped. */
  mouse?(sequence: string): void;
  /** Sees each raw chunk first; true consumes it (Tree's key inspector). */
  raw?(data: string): boolean;
}

/**
 * Keys, pastes and mouse reports from a terminal, split before readline sees them: UTF-8 decoded before framing (so
 * a character split across chunks survives), a complete mouse report never becomes keys, a paste arrives whole, and
 * a lone Escape (already timed by StdinBuffer) is a key at once instead of waiting on readline's escape timer.
 */
export function attachKeypressInput(input: Readable, handlers: KeypressHandlers): () => void {
  const frames = new StdinBuffer(), keys = new PassThrough({ objectMode: true });
  const decoder = new TerminalInputDecoder(handlers.paste);
  input.setEncoding("utf8");
  emitKeypressEvents(keys);
  frames.on("data", sequence => {
    if (isTreeMouseSequence(sequence)) handlers.mouse?.(sequence);
    else if (sequence === "\x1b") keys.emit("keypress", sequence, { name: "escape", sequence });
    else keys.write(sequence);
  });
  frames.on("paste", text => handlers.paste?.(text));
  keys.on("keypress", (str: string | undefined, key: TerminalKey) => {
    const text = str ?? "";
    if (!key.sequence && !text && !key.name) return;
    handlers.keypress(text, key, decoder.consume(text, key));
  });
  const onData = (data: string) => { if (!handlers.raw?.(data)) frames.process(data); };
  input.on("data", onData);
  return () => { input.off("data", onData); frames.destroy(); keys.destroy(); };
}

/** Where a session's input comes from. */
export type HerdrSessionInput =
  /** Keys, pastes and clicks through `attachKeypressInput`; the session sets raw mode and writes the modes. */
  | { kind: "keypress"; handlers: KeypressHandlers }
  /** Pi's ProcessTerminal: it sets raw mode and bracketed paste itself, and its input is drained before leaving. */
  | { kind: "pi"; terminal: ProcessTerminal; onData(data: string): void }
  /** A TUI that owns the terminal itself (Detail's): the session leaves its screen alone. */
  | { kind: "own" };

export interface HerdrSessionOptions {
  input: HerdrSessionInput;
  /** Mouse reporting and bracketed paste. A Pi terminal brings its own paste; an own TUI, everything. */
  modes?: ScreenModes;
  /** Runs on resize (a Pi terminal's goes through the terminal). */
  draw?: () => void;
  /** A queued task's failure; the session keeps running. */
  onError(error: unknown): void;
  /**
   * Before the session counts as stopping: false refuses this stop (Detail, when its writing can't be kept).
   * The pane's right-click, presence and the like go back here, while the client still draws.
   */
  prepare?(): boolean | void | Promise<boolean | void>;
  /** The client's own teardown (watchers, inspectors) once stopping, before input and screen are put back. */
  leave?(): void | Promise<void>;
  /** An own TUI's last word, after the session's teardown (Detail's `tui.stop`). */
  restoreScreen?(): void;
  /**
   * A signal (SIGINT, SIGTERM, SIGHUP) arrived. Left out: stop with 128 + its number (130, 143, 129), as a shell
   * reports it.
   */
  onSignal?(signal: HerdrSignal, exitCode: number): void;
  /** For tests: where the screen is written and how the process ends. */
  io?: {
    write(data: string): void; exit(code: number): never; stdin?: NodeJS.ReadStream; stdout?: NodeJS.WriteStream;
    onSignal?(signal: HerdrSignal, handler: () => void): void;
  };
}

export type HerdrSignal = "SIGINT" | "SIGTERM" | "SIGHUP";
const SIGNAL_EXIT: Record<HerdrSignal, number> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

export interface HerdrSession {
  /** True from the moment a stop goes ahead: queued work is skipped and draws should stop. */
  readonly stopping: boolean;
  /** Enters the screen, attaches the input, listens for resize and the signals. */
  start(): void;
  /** One task at a time, in order; a failure goes to `onError` and the queue goes on. Skipped once stopping. */
  enqueue(task: () => void | Promise<void>): void;
  /** Waits for what is queued (a choice being written, a draft being kept), then stops. */
  stopAfterQueue(exitCode?: number, before?: () => void | Promise<void>): void;
  /** Leaves once: the client's teardown, the input drained and detached, the screen put back, then exit or re-exec. */
  stop(exitCode?: number, restart?: boolean): Promise<void>;
  /** Hands the terminal to another program (an external editor) and takes it back. */
  suspend(): void;
  resume(): void;
}

export function createHerdrSession(options: HerdrSessionOptions): HerdrSession {
  const stdin = options.io?.stdin ?? process.stdin;
  const stdout = options.io?.stdout ?? process.stdout;
  const write = options.io?.write ?? ((data: string) => { stdout.write(data); });
  const exit = options.io?.exit ?? ((code: number) => process.exit(code));
  const input = options.input;
  // A Pi terminal turns bracketed paste on and off itself; an own TUI writes all of its modes.
  const modes: ScreenModes = input.kind === "own" ? {} : input.kind === "pi" ? { ...options.modes, paste: false } : options.modes ?? {};
  let stopping = false, stopRequested = false, started = false;
  let stopInFlight: Promise<void> | undefined;
  let queue: Promise<void> = Promise.resolve();
  let detachInput: (() => void) | undefined;
  const resize = () => options.draw?.();

  function attach(): void {
    if (input.kind !== "keypress") return;
    if (stdin.isTTY) stdin.setRawMode(true);
    write(screenEnter(modes));
    detachInput = attachKeypressInput(stdin, input.handlers);
    stdin.resume();
    if (options.draw) stdout.on("resize", resize);
  }
  function detach(): void {
    if (input.kind !== "keypress") return;
    detachInput?.();
    detachInput = undefined;
    if (stdin.isTTY) stdin.setRawMode(false);
    stdout.off("resize", resize);
  }

  async function leaveOnce(exitCode: number, restart: boolean): Promise<void> {
    if (stopping) return;
    if ((await options.prepare?.()) === false) return;
    stopping = true;
    await options.leave?.();
    if (input.kind === "pi") {
      await input.terminal.drainInput();
      input.terminal.stop();
      write(screenLeave(modes));
    } else if (input.kind === "keypress") {
      detach();
      write(screenLeave(modes));
    } else stdout.off("resize", resize);
    options.restoreScreen?.();
    if (restart) reexecClient();
    exit(exitCode);
  }

  const session: HerdrSession = {
    get stopping() { return stopping; },
    start() {
      if (started) return;
      started = true;
      if (input.kind === "pi") {
        write(screenEnter(modes));
        input.terminal.start(input.onData, () => options.draw?.());
      } else if (input.kind === "keypress") attach();
      else if (options.draw) stdout.on("resize", resize);
      const listen = options.io?.onSignal ?? ((signal: HerdrSignal, handler: () => void) => { process.on(signal, handler); });
      for (const signal of Object.keys(SIGNAL_EXIT) as HerdrSignal[]) {
        listen(signal, () => options.onSignal
          ? options.onSignal(signal, SIGNAL_EXIT[signal])
          : void session.stop(SIGNAL_EXIT[signal]));
      }
    },
    enqueue(task) {
      queue = queue.then(async () => { if (!stopping) await task(); }).catch(error => options.onError(error));
    },
    stopAfterQueue(exitCode = 0, before) {
      if (stopRequested || stopping) return;
      stopRequested = true;
      queue = queue.then(() => before?.()).catch(error => options.onError(error)).finally(() => session.stop(exitCode));
    },
    stop(exitCode = 0, restart = false) {
      // A second stop while one is deciding (a signal during Esc) joins it.
      return stopInFlight ??= leaveOnce(exitCode, restart).finally(() => { stopInFlight = undefined; });
    },
    suspend() {
      detach();
      stdin.pause();
      write(screenLeave(modes));
    },
    resume() {
      attach();
      options.draw?.();
    },
  };
  return session;
}
