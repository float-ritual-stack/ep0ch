// Where a terminal tile's program runs: its pty and its process. In the door's own terminal that's this process
// (`localPtys`: Bun.Terminal, Bun.spawn). In a door session it's the session's terminal host
// (src/session/pty-host.ts), a small process of its own that outlives the daemon: when the daemon is upgraded or
// restarted, the new one adopts the programs it left (`adopt`), with what they wrote meanwhile, and nothing a tile
// runs notices. PtyPane (src/desk/pty.ts) draws the program either way; only this seam knows which.

/** A running program in a pty, as the tile drives it. */
export interface PtyProc {
  /** Its process id, once known (a host's spawn says it a moment later). */
  readonly pid: number | undefined;
  /** Resolves with its exit code once it has gone. */
  readonly exited: Promise<number>;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Signal it (SIGTERM by default when no signal is named, SIGHUP for a hangup). */
  kill(signal?: NodeJS.Signals): void;
  /** Let go of it: the pty is closed and, under a host, the program forgotten (killed if it still runs). */
  close(): void;
  /** A host's: its whole kept output again, when the host had to drop some of it (the tile starts over from it). */
  onResync?: ((replay: Uint8Array) => void) | null;
}

/** What a tile remembers of its program across a handoff (the host keeps it beside the pty). */
export interface PtyMeta {
  /** The tile's command as the layout has it: a kept program is adopted only by a tile that runs the same. */
  cmd?: string[];
  /** nvim's socket (`--listen`), which the door reconnects to. */
  socket?: string | null;
  /** The EP0CH_TILE_ID the program was started with: the id it names its tile by, whichever tile holds it now. */
  toldId?: string | null;
  /** The Herdr pane an attach shows (`tile.herdr`). */
  herdr?: { pane: string; name?: string } | null;
}

export interface PtyStart {
  /**
   * Which tile it is, across daemons (`<screen>:<tile id>`): what a new daemon adopts it by. Null: never adopted (a
   * ctrl+e editor on a temp file, a showcase's exhibit).
   */
  key: string | null;
  argv: string[];
  cwd?: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  meta?: PtyMeta;
}

/** A program a session kept (a handoff, a daemon that died): it, its size, and the bytes it wrote, to replay. */
export interface Adopted { proc: PtyProc; replay: Uint8Array; cols: number; rows: number; argv: string[]; meta: PtyMeta; exited: number | null }

export interface PtyBackend {
  /** `local`: programs end with this process. `host`: they live in the session's terminal host. */
  readonly kind: "local" | "host";
  /** Start a program; its output goes to `onData`. Throws when it can't be started. */
  spawn(s: PtyStart, onData: (d: Uint8Array) => void): PtyProc;
  /** The program kept under `key` running `argv`, its output to `onData` from now; null when there's none to adopt. */
  adopt(key: string, argv: string[], onData: (d: Uint8Array) => void): Adopted | null;
  /** Remember `meta` with the program kept under `key` (a tile learnt it's a Herdr attach). */
  meta(key: string, meta: PtyMeta): void;
  /** A program is kept under `key` for a tile to adopt (it runs, and no tile has it yet). */
  holds(key: string): boolean;
}

/** This process's own ptys: a program ends when the door does (PtyPane's exit hook). */
export const localPtys: PtyBackend = {
  kind: "local",
  spawn(s, onData) {
    let drained!: () => void;
    const eof = new Promise<void>(resolve => { drained = resolve; });
    // Let spawn own the slave descriptor so the stream reaches EOF after the child's last write.
    const proc = Bun.spawn(s.argv, { cwd: s.cwd, env: s.env, terminal: {
      cols: s.cols, rows: s.rows, name: "xterm-256color", data: (_t, d) => onData(d), exit: () => drained(),
    } });
    const pty = proc.terminal!;
    return {
      get pid() { return proc.pid; },
      // waitpid can beat the last PTY read; recording or closing on it loses the command's output.
      exited: Promise.all([proc.exited, eof]).then(([code]) => code ?? 0),
      write: d => { pty.write(d); },
      resize: (c, r) => { pty.resize(c, r); },
      kill: sig => { proc.kill(sig); },
      close: () => { try { pty.close(); } catch { /* closed */ } finally { drained(); } },
    };
  },
  adopt: () => null,
  meta: () => {},
  holds: () => false,
};

let backend: PtyBackend = localPtys;
/** Where terminal tiles start their programs now. */
export const ptyBackend = (): PtyBackend => backend;
/** A session's daemon puts its terminal host here before any tile starts (src/session/daemon.ts). */
export function usePtyBackend(b: PtyBackend): void { backend = b; }
