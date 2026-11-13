import { connect, type Socket } from "node:net";
import { ACK, CLOSE, DATA, OPEN, frame, readFrame } from "./link-frame";

/**
 * What a stream the other end opens reaches here: the empty target is the outline host, `door:<key>` a door session's
 * control socket (PIE-1242). Null: nothing here by that name, and the stream is closed at once.
 */
export type LinkTarget = (target: string) => string | null;

/**
 * How much a link keeps in flight, unacknowledged (PIE-1779): per stream, and over all its streams. One chunk a round
 * trip carried a laptop's pages at 30 KB/s; a window carries them at the line's speed. The whole link's stays under
 * the WebSocket's 4 MB, past which either end closes it.
 */
export const STREAM_WINDOW = 1024 * 1024, LINK_WINDOW = 3 * 1024 * 1024;
/** The most one DATA frame carries: a read bigger than this goes as several, each counted against the windows. */
const FRAME_BYTES = 64 * 1024;

/** `ended`: its socket closed here; its CLOSE follows the last of its reads, once they are all acknowledged. */
type Stream = { socket: Socket; sent: number[]; inFlight: number; pending: Buffer[]; held: boolean; ended: boolean; owed: number };

/**
 * Each direction keeps up to STREAM_WINDOW in flight per stream, and LINK_WINDOW over all of them. Each chunk is
 * acknowledged after the destination drains it (one ACK a chunk, as before: an end on the older one-chunk rule
 * still answers every chunk, so the two interwork).
 */
export class LinkStreams {
  private streams = new Map<number, Stream>();
  private next = 1;
  private closed = false;
  private inFlight = 0;
  private resolve: LinkTarget | undefined;
  /** `host`: the outline host's socket here (the connector's side), or a resolver for every target it serves. */
  constructor(private send: (bytes: Buffer) => void, host?: string | LinkTarget) {
    this.resolve = typeof host === "string" ? (t => (t === "" ? host : null)) : host;
  }
  /** A local connection carried to the other end, to its outline host or to `target` there. */
  open(socket: Socket, target = "") {
    const id = this.next++;
    this.attach(id, socket);
    this.send(frame(OPEN, id, Buffer.from(target)));
  }
  private full(stream: Stream) { return stream.inFlight >= STREAM_WINDOW || this.inFlight >= LINK_WINDOW; }
  private attach(id: number, socket: Socket) {
    const stream: Stream = { socket, sent: [], inFlight: 0, pending: [], held: false, ended: false, owed: 0 };
    this.streams.set(id, stream);
    socket.on("data", (data: Buffer) => { stream.pending.push(data); this.pump(id, stream); });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      // Closed here (not by the other end's CLOSE, which already forgot it): said to the other end once what it read
      // has all gone out.
      if (this.streams.get(id) !== stream) return;
      stream.ended = true;
      this.pump(id, stream);
    });
  }
  /** A stream gone: what it had in flight no longer counts against the link's window. */
  private forget(id: number, stream: Stream) {
    this.streams.delete(id);
    this.inFlight -= stream.inFlight;
    stream.inFlight = 0;
    this.release();
  }
  /** What a stream has read goes out in frames while the windows have room; the rest waits, its socket paused. */
  private pump(id: number, stream: Stream) {
    while (stream.pending.length && !this.full(stream) && !this.closed) {
      const head = stream.pending[0]!, part = head.subarray(0, FRAME_BYTES);
      if (part.length === head.length) stream.pending.shift(); else stream.pending[0] = head.subarray(FRAME_BYTES);
      stream.sent.push(part.length); stream.inFlight += part.length; this.inFlight += part.length;
      this.send(frame(DATA, id, part));
    }
    const held = stream.pending.length > 0;
    if (stream.ended) {
      stream.held = held;
      // Its CLOSE once every chunk is acknowledged: what it has in flight counts against the link's window till then.
      if (held || stream.inFlight > 0 || this.streams.get(id) !== stream) return;
      this.forget(id, stream);
      if (!this.closed) this.send(frame(CLOSE, id));
      return;
    }
    if (held && !stream.held) stream.socket.pause();
    if (!held && stream.held) stream.socket.resume();
    stream.held = held;
  }
  /** Streams waiting on the windows carry on once they have room. */
  private release() {
    for (const [id, s] of this.streams) if (s.held && !this.full(s)) this.pump(id, s);
  }
  receive(bytes: Buffer) {
    const { op, id, data } = readFrame(bytes);
    if (op === OPEN) {
      if (!this.resolve || this.streams.has(id)) throw new Error("unexpected link stream");
      const path = this.resolve(data.toString());
      if (!path) { this.send(frame(CLOSE, id)); return; }
      this.attach(id, connect(path));
      return;
    }
    const stream = this.streams.get(id);
    // A close can cross the other direction's last chunk or acknowledgement.
    if (!stream) return;
    // Ended, not destroyed: what it was written (a window of chunks, now) reaches it before its end.
    if (op === CLOSE) { this.forget(id, stream); stream.socket.end(); }
    else if (op === ACK) {
      const size = stream.sent.shift() ?? 0;
      stream.inFlight -= size; this.inFlight -= size;
      if (stream.ended) this.pump(id, stream);
      this.release();
    }
    else if (op === DATA) {
      const ack = (n: number) => { for (let i = 0; i < n && !this.closed && this.streams.has(id); i++) this.send(frame(ACK, id)); };
      // Each chunk acknowledged once the destination has taken it: at once, or at its next drain with the others owed.
      if (stream.socket.write(data) && !stream.owed) { ack(1); return; }
      if (stream.owed++ === 0) stream.socket.once("drain", () => { const n = stream.owed; stream.owed = 0; ack(n); });
    }
  }
  close() {
    this.closed = true;
    for (const { socket } of this.streams.values()) socket.destroy();
    this.streams.clear();
    this.inFlight = 0;
  }
}
