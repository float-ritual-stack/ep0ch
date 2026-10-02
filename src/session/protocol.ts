// The session protocol: what goes between a door session (the daemon, src/session/daemon.ts) and the clients
// attached to it (src/session/client.ts) over the session socket. The daemon sends what to draw as the bytes a
// terminal takes (rows, Kitty images), already painted for that client's size and video mode; the client sends the
// bytes its terminal typed, its size, and what came of a program it ran for the session. Every message is a frame:
// one byte of type, four of length (big-endian), then the payload, UTF-8: raw text for `input` and `output`, JSON
// for the rest.

/** Bumped when a message changes shape: a client and a daemon of different protocols say so instead of guessing. */
export const PROTOCOL = 1;

/** The largest frame either side takes: well above a screen of Kitty uploads, small enough to bound memory. */
export const FRAME_LIMIT = 64 << 20;

/** What a client says when it attaches: its terminal (from its own probe), what it asked for, who it is. */
export interface Hello {
  proto: number;
  cols: number; rows: number; cellW: number; cellH: number;
  /** The terminal answered the Kitty graphics query (or EP0CH_KITTY says so). */
  kitty: boolean;
  /** The client's process, and where it runs (its tty, `EP0CH_NEST`): `session list` and `peek` say which is which. */
  pid: number; tty?: string; nest?: string;
  /** The door's arguments as typed (`--board`, `--ws pie`): the session says what it didn't apply. */
  args?: string[];
  /** Read-only: shown the session, never given the person's keys (an agent watching, a second screen). */
  watch?: boolean;
  /**
   * The outline the client named (`--ws`, a socket, EP0CH_SOCKET): its service's socket and the outline on it, as
   * resolveTarget names them. A session on another one refuses it. Absent: it named none, and attaches to whichever
   * this state dir's session is on.
   */
  target?: { socket: string; outline?: string };
}

/** What the daemon says about itself: answered to `query`, and in `session list`. */
export interface SessionInfo {
  pid: number; started: number; proto: number;
  /** The checkout the daemon runs from, and its commit: an upgrade compares it. */
  code: { dir: string; commit: string | null };
  state: string; socket: string; control: string | null;
  outline: { host: string; workspace: string; outline?: string; socket: string };
  screen: string | null;
  clients: ClientInfo[];
  /** Programs running in terminal tiles (and the agent drawer), by tile. */
  terminals: { tile: string; cmd: string; pid?: number }[];
  /** Programs the terminal host keeps that no tile has adopted (yet): a tile not drawn since a handoff, or one gone. */
  kept?: { key: string | null; cmd: string; pid?: number }[];
  /** The terminal host's process: where the programs run (src/session/pty-host.ts). */
  host?: number;
}

export interface ClientInfo { id: number; pid: number; tty?: string; nest?: string; cols: number; rows: number; video: string; active: boolean; watch: boolean; since: number; idle: number; away: string | null }

/** Client → daemon. */
export type ClientMsg =
  | { t: "hello"; hello: Hello }
  | { t: "input"; text: string }
  | { t: "resize"; cols: number; rows: number }
  /** The program the daemon asked this client to run (`run`) ended. */
  | { t: "ran"; id: number; code: number | null }
  /** Leave the session running and go (as the menu's Goodbye does). */
  | { t: "detach" }
  /** What the session is (`session list`), without attaching. */
  | { t: "query" }
  /** End the session (`session end`); `force`: even with programs running in its tiles. */
  | { t: "end"; force?: boolean }
  /** Hand the session to a new daemon on the code in the checkout (`session upgrade`). */
  | { t: "upgrade" }
  /** Every attached terminal starts again on the code in the checkout; the daemon goes on (`session upgrade --clients`). */
  | { t: "reload" };

/** Daemon → client. */
export type DaemonMsg =
  | { t: "output"; text: string }
  /** The session set (or gave back) a theme's ground on this terminal: give it back on the way out too. */
  | { t: "ground"; set: boolean }
  /** Hand this terminal to a program (the drop shell, $EDITOR) and say when it ends (`ran`). */
  | { t: "run"; id: number; argv: string[]; cwd?: string; env?: Record<string, string>; banner?: string }
  | { t: "info"; info: SessionInfo }
  /** The end of this attach: why, and what to print once the terminal is back. `code`: the client's exit code. */
  | { t: "bye"; reason: "detached" | "ended" | "refused" | "upgrade" | "restart"; message: string; code?: number }
  /** An answer to `end` that ended nothing: why (programs running), and what would. */
  | { t: "ask"; message: string };

// Frame types: one letter each.
const TYPE: Record<ClientMsg["t"] | DaemonMsg["t"], string> = {
  hello: "h", input: "i", resize: "r", ran: "x", detach: "d", query: "q", end: "e", upgrade: "u", reload: "l",
  output: "o", ground: "g", run: "p", info: "n", bye: "b", ask: "a",
};
const NAME = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [v, k])) as Record<string, ClientMsg["t"] | DaemonMsg["t"]>;
/** Messages whose payload is raw text, not JSON. */
const RAW = new Set(["input", "output"]);

/** One message as a frame. */
export function encode(m: ClientMsg | DaemonMsg): Buffer {
  const { t, ...rest } = m as { t: string; text?: string };
  const body = Buffer.from(RAW.has(t) ? (rest.text ?? "") : JSON.stringify(rest), "utf8");
  const head = Buffer.alloc(5);
  head.write(TYPE[t as keyof typeof TYPE], 0, "latin1");
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
}

/**
 * Frames from a stream, as they arrive in pieces: `push` each chunk, get the whole messages in it. A frame over
 * FRAME_LIMIT, or of a type nobody knows, is an error: the connection is closed, never guessed at.
 */
export class Frames<M extends ClientMsg | DaemonMsg> {
  private buf: Buffer = Buffer.alloc(0);
  push(chunk: Buffer): M[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: M[] = [];
    while (this.buf.length >= 5) {
      const len = this.buf.readUInt32BE(1);
      if (len > FRAME_LIMIT) throw new Error(`a frame of ${len} bytes is over the limit (${FRAME_LIMIT})`);
      if (this.buf.length < 5 + len) break;
      const t = NAME[String.fromCharCode(this.buf[0]!)];
      if (!t) throw new Error(`unknown frame type ${JSON.stringify(String.fromCharCode(this.buf[0]!))}`);
      const body = this.buf.subarray(5, 5 + len).toString("utf8");
      this.buf = this.buf.subarray(5 + len);
      out.push((RAW.has(t) ? { t, text: body } : { t, ...JSON.parse(body || "{}") }) as M);
    }
    return out;
  }
}
