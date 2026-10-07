// The session protocol: what goes between a door session (the daemon, src/session/daemon.ts) and the clients
// attached to it (src/session/client.ts) over the session socket. The daemon sends what to draw as the bytes a
// terminal takes (rows, Kitty images), already painted for that client's size and video mode; the client sends the
// bytes its terminal typed, its size, and what came of a program it ran for the session. Every message is a frame:
// one byte of type, four of length (big-endian), then the payload, UTF-8: raw text for `input` and `output`, JSON
// for the rest.

/** Bumped when a message changes shape: a client and a daemon of different protocols say so instead of guessing. 3: clients can name their host pane (`clientHost`). 2: sessions are per outline (SessionInfo.place and .dir; Hello.target gone). */
export const PROTOCOL = 3;

/** The largest frame either side takes: well above a screen of Kitty uploads, small enough to bound memory. */
export const FRAME_LIMIT = 64 << 20;

/** What a client says when it attaches: its terminal (from its own probe), what it asked for, who it is. */
export interface Hello {
  proto: number;
  cols: number; rows: number; cellW: number; cellH: number;
  /** The terminal answered the Kitty graphics query (or EP0CH_KITTY says so). */
  kitty: boolean;
  /** The terminal answered the Program Status Protocol's query (OSC 7501): the session reports its status to it. Left out by an older client: none. */
  pst?: boolean;
  /** The client's process, and where it runs (its tty, `EP0CH_NEST`): `session list` and `peek` say which is which. */
  pid: number; tty?: string; nest?: string;
  /** The client application's own host pane, when there is one (for example Tern), independent of the terminal/daemon. */
  clientHost?: { kind: string; pane: string };
  /** The door's arguments as typed (`--screen board`, `--ws pie`): the session says what it didn't apply. */
  args?: string[];
  /** Read-only: shown the session, never given the person's keys (an agent watching, a second screen). */
  watch?: boolean;
}

/** What the daemon says about itself: answered to `query`, and in `session list`. */
export interface SessionInfo {
  pid: number; started: number; proto: number;
  /** The checkout the daemon runs from, and its commit: an upgrade compares it. */
  code: { dir: string; commit: string | null };
  state: string; socket: string; control: string | null;
  /** Which outline's session this is, and where that outline is (src/session/place.ts): its folder is `dir`. */
  place: { outline: string; machine?: string; socket?: string };
  dir: string;
  outline: { host: string; workspace: string; outline?: string; socket: string };
  screen: string | null;
  clients: ClientInfo[];
  /** Programs running in terminal tiles (and the drawer), by tile. */
  terminals: { tile: string; cmd: string; pid?: number }[];
  /** Programs the terminal host keeps that no tile has adopted (yet): a tile not drawn since a handoff, or one gone. */
  kept?: { key: string | null; cmd: string; pid?: number }[];
  /** The terminal host's process: where the programs run (src/session/pty-host.ts). */
  host?: number;
}

export interface ClientInfo { id: number; pid: number; tty?: string; nest?: string; clientHost?: { kind: string; pane: string }; cols: number; rows: number; video: string; active: boolean; watch: boolean; since: number; idle: number; away: string | null }

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

/** A frame: its type letter, an id (the terminal host's frames have one), the body's length, the body. */
export function frameBytes(t: string, body: Buffer, id?: number): Buffer {
  const head = Buffer.alloc(id === undefined ? 5 : 9);
  head.write(t, 0, "latin1");
  if (id !== undefined) head.writeUInt32BE(id >>> 0, 1);
  head.writeUInt32BE(body.length, head.length - 4);
  return Buffer.concat([head, body]);
}

/** One message as a frame. */
export function encode(m: ClientMsg | DaemonMsg): Buffer {
  const { t, ...rest } = m as { t: string; text?: string };
  return frameBytes(TYPE[t as keyof typeof TYPE], Buffer.from(RAW.has(t) ? (rest.text ?? "") : JSON.stringify(rest), "utf8"));
}

/** Whole frames (frameBytes) from a stream that arrives in pieces (views of it: copy what you keep); one over FRAME_LIMIT closes it. */
export class FrameSplitter {
  private buf: Buffer = Buffer.alloc(0);
  constructor(private readonly head: number) {}
  push(chunk: Buffer): { head: Buffer; body: Buffer }[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: { head: Buffer; body: Buffer }[] = [];
    while (this.buf.length >= this.head) {
      const len = this.buf.readUInt32BE(this.head - 4);
      if (len > FRAME_LIMIT) throw new Error(`a frame of ${len} bytes is over the limit (${FRAME_LIMIT})`);
      if (this.buf.length < this.head + len) break;
      out.push({ head: this.buf.subarray(0, this.head), body: this.buf.subarray(this.head, this.head + len) });
      this.buf = this.buf.subarray(this.head + len);
    }
    return out;
  }
}

/** A session's messages from a stream (FrameSplitter); a frame of a type nobody knows is an error too. */
export class Frames<M extends ClientMsg | DaemonMsg> {
  private readonly split = new FrameSplitter(5);
  push(chunk: Buffer): M[] {
    return this.split.push(chunk).map(({ head, body }) => {
      const t = NAME[String.fromCharCode(head[0]!)], text = body.toString("utf8");
      if (!t) throw new Error(`unknown frame type ${JSON.stringify(String.fromCharCode(head[0]!))}`);
      return (RAW.has(t) ? { t, text } : { t, ...JSON.parse(text || "{}") }) as M;
    });
  }
}
