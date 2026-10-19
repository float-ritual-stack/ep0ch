/** One WebSocket message is one frame: operation byte, big-endian stream id, payload. */
export const OPEN = 1, DATA = 2, CLOSE = 3, ACK = 4;
export function frame(op: number, id: number, data: Buffer = Buffer.alloc(0)): Buffer {
  const bytes = Buffer.allocUnsafe(5 + data.length);
  bytes[0] = op; bytes.writeUInt32BE(id, 1); data.copy(bytes, 5);
  return bytes;
}
export function readFrame(bytes: Buffer): { op: number; id: number; data: Buffer } {
  if (bytes.length < 5 || bytes[0]! < OPEN || bytes[0]! > ACK || bytes.readUInt32BE(1) === 0 || (bytes[0] !== DATA && bytes.length !== 5)) throw new Error("invalid link frame");
  return { op: bytes[0]!, id: bytes.readUInt32BE(1), data: bytes.subarray(5) };
}
