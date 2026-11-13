import { connect, type Socket } from "node:net";
import { ACK, CLOSE, DATA, OPEN, frame, readFrame } from "./link-frame";

/**
 * What a stream the other end opens reaches here: the empty target is the outline host, `door:<key>` a door session's
 * control socket (PIE-1242). Null: nothing here by that name, and the stream is closed at once.
 */
export type LinkTarget = (target: string) => string | null;

/**
 * How much a link keeps in flight, unacknowledged (PIE-1779): per stream, and over all its streams. One chunk a round
 * trip carried a laptop's pages at 30 KB/s; a window carries them at the line's speed (the laptop's line is about
 * 0.65 MB/s with a 240 ms round trip, so about 160 KB in flight fills it).
 */
export const STREAM_WINDOW = 512 * 1024, LINK_WINDOW = 1024 * 1024;
/**
 * What may wait in the WebSocket's own send buffer before nothing more is sent: the window counts what the far end
 * hasn't acknowledged, this what hasn't even left (credit a closed stream gave back is spent only as it drains), well
 * under the 4 MB past which either end closes the link, and short enough that a small answer isn't stuck behind it.
 */
export const SEND_BUFFER = 512 * 1024;
/** The most one DATA frame carries: a read bigger than this goes as several, each its turn. */
const FRAME_BYTES = 64 * 1024;
/** How soon a send held by a full WebSocket buffer looks again, where nothing says it drained. */
const BUFFER_RETRY_MS = 20;

/**
 * `ended`: its socket closed here; its CLOSE follows its last frame, once all are acknowledged. `retired`: gone from the
 * link (closed by either end); nothing it reads afterwards is sent or counted.
 */
type Stream = { id: number; socket: Socket; sent: number[]; inFlight: number; pending: Buffer[]; held: boolean; queued: boolean; ended: boolean; retired: boolean; owed: number };

/**
 * Each direction keeps up to STREAM_WINDOW in flight per stream and LINK_WINDOW over all of them, sends only while the
 * WebSocket holds less than SEND_BUFFER, and takes the streams waiting to send in turn, a frame each. Each frame is
 * acknowledged after the destination drains it (one ACK a frame: an end on the older one-chunk rule still answers
 * every chunk, so the two interwork).
 */
export class LinkStreams {
  private streams = new Map<number, Stream>();
  /** Every socket this end has had, until it closes: `close()` ends them all, a retired stream's too. */
  private sockets = new Set<Socket>();
  private waiting: Stream[] = [];
  private next = 1;
  private closed = false;
  private inFlight = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private resolve: LinkTarget | undefined;
  private buffered: () => number;
  /**
   * `host`: the outline host's socket here (the connector's side), or a resolver for every target it serves.
   * `buffered`: what the WebSocket holds unsent (its bufferedAmount); call `drained()` when it says it drained.
   */
  constructor(private send: (bytes: Buffer) => void, host?: string | LinkTarget, o: { buffered?: () => number } = {}) {
    this.resolve = typeof host === "string" ? (t => (t === "" ? host : null)) : host;
    this.buffered = o.buffered ?? (() => 0);
  }
  /** A local connection carried to the other end, to its outline host or to `target` there. */
  open(socket: Socket, target = "") {
    const id = this.next++;
    this.attach(id, socket);
    this.send(frame(OPEN, id, Buffer.from(target)));
  }
  /** The WebSocket drained: what waits on its buffer goes now. */
  drained() { this.schedule(); }
  /** What this end holds: its streams, and the bytes they have unacknowledged. */
  held() { return { streams: this.streams.size, inFlight: this.inFlight }; }
  private attach(id: number, socket: Socket) {
    const stream: Stream = { id, socket, sent: [], inFlight: 0, pending: [], held: false, queued: false, ended: false, retired: false, owed: 0 };
    this.streams.set(id, stream);
    this.sockets.add(socket);
    socket.on("data", (data: Buffer) => {
      if (stream.retired || this.closed) return;
      stream.pending.push(data);
      if (!stream.held) { stream.held = true; socket.pause(); }
      this.queue(stream);
      this.schedule();
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      this.sockets.delete(socket);
      // Closed here (not by the other end's CLOSE, which retired it): said to the other end once what it read has gone.
      if (stream.retired) return;
      stream.ended = true;
      this.finish(stream);
    });
  }
  private queue(stream: Stream) { if (!stream.queued) { stream.queued = true; this.waiting.push(stream); } }
  private gated() { return this.closed || this.inFlight >= LINK_WINDOW || this.buffered() >= SEND_BUFFER; }
  /** The waiting streams in turn, a frame each, while the windows and the WebSocket's buffer have room. */
  private schedule() {
    while (this.waiting.length && !this.gated()) {
      let sent = false;
      for (let turns = this.waiting.length; turns > 0 && !this.gated(); turns--) {
        const s = this.waiting.shift()!;
        s.queued = false;
        if (s.retired) continue;
        if (s.pending.length && s.inFlight < STREAM_WINDOW) { this.sendFrame(s); sent = true; }
        if (s.pending.length) this.queue(s);
        else this.finish(s);
      }
      if (!sent) break;
    }
    // Held by the WebSocket's buffer (not by the far end, whose ACKs wake it): looked at again shortly.
    if (this.waiting.length && !this.closed && this.buffered() >= SEND_BUFFER && !this.retry) {
      this.retry = setTimeout(() => { this.retry = null; this.schedule(); }, BUFFER_RETRY_MS);
      (this.retry as { unref?: () => void }).unref?.();
    }
  }
  private sendFrame(s: Stream) {
    const head = s.pending[0]!, part = head.subarray(0, FRAME_BYTES);
    if (part.length === head.length) s.pending.shift(); else s.pending[0] = head.subarray(FRAME_BYTES);
    s.sent.push(part.length); s.inFlight += part.length; this.inFlight += part.length;
    this.send(frame(DATA, s.id, part));
    if (!s.pending.length && s.held) { s.held = false; s.socket.resume(); }
  }
  /** An ended stream's CLOSE, once everything it read has gone and been acknowledged. */
  private finish(s: Stream) {
    if (!s.ended || s.retired || s.pending.length || s.inFlight > 0) return;
    this.retire(s);
    if (!this.closed) this.send(frame(CLOSE, s.id));
  }
  /** A stream gone from the link: nothing it reads afterwards is sent, and its credit returns (spent as the buffer drains). */
  private retire(s: Stream) {
    s.retired = true;
    if (this.streams.get(s.id) === s) this.streams.delete(s.id);
    this.inFlight -= s.inFlight;
    s.inFlight = 0; s.pending = []; s.sent = [];
    if (s.held) { s.held = false; s.socket.resume(); }
    this.schedule();
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
    // Retired, and its socket ended once what it was written (a window of frames) has reached it, then destroyed.
    if (op === CLOSE) { this.retire(stream); stream.socket.destroySoon(); }
    else if (op === ACK) {
      const size = stream.sent.shift() ?? 0;
      stream.inFlight -= size; this.inFlight -= size;
      this.finish(stream);
      this.schedule();
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
    if (this.retry) clearTimeout(this.retry);
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.streams.clear();
    this.waiting = [];
    this.inFlight = 0;
  }
}
