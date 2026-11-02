import { connect, type Socket } from "node:net";
import { ACK, CLOSE, DATA, OPEN, frame, readFrame } from "./link-frame";

/**
 * What a stream the other end opens reaches here: the empty target is the outline host, `door:<key>` a door session's
 * control socket (PIE-1242). Null: nothing here by that name, and the stream is closed at once.
 */
export type LinkTarget = (target: string) => string | null;

/** Each direction has one chunk in flight per stream. ACK follows the destination's drain. */
export class LinkStreams {
  private streams = new Map<number, { socket: Socket }>();
  private next = 1;
  private closed = false;
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
  private attach(id: number, socket: Socket) {
    const stream = { socket };
    this.streams.set(id, stream);
    socket.on("data", (data: Buffer) => {
      socket.pause();
      this.send(frame(DATA, id, data));
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      if (this.streams.delete(id) && !this.closed) this.send(frame(CLOSE, id));
    });
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
    if (op === CLOSE) { this.streams.delete(id); stream.socket.destroy(); }
    else if (op === ACK) { stream.socket.resume(); }
    else if (op === DATA) {
      const ack = () => { if (!this.closed && this.streams.has(id)) this.send(frame(ACK, id)); };
      if (stream.socket.write(data)) ack(); else stream.socket.once("drain", ack);
    }
  }
  close() {
    this.closed = true;
    for (const { socket } of this.streams.values()) socket.destroy();
    this.streams.clear();
  }
}
