import { connect, type Socket } from "node:net";
import { ACK, CLOSE, DATA, OPEN, frame, readFrame } from "./link-frame";

/** Each direction has one chunk in flight per stream. ACK follows the destination's drain. */
export class LinkStreams {
  private streams = new Map<number, { socket: Socket }>();
  private next = 1;
  private closed = false;
  constructor(private send: (bytes: Buffer) => void, private host?: string) {}
  open(socket: Socket) {
    const id = this.next++;
    this.attach(id, socket);
    this.send(frame(OPEN, id));
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
      if (!this.host || this.streams.has(id)) throw new Error("unexpected link stream");
      this.attach(id, connect(this.host));
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
