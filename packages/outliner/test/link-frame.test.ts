import { expect, test } from "bun:test";
import { frame, readFrame, DATA, OPEN } from "../src/link-frame";

test("link frames keep binary payload and stream identity separate and reject malformed messages", () => {
  expect([...frame(OPEN, 0x01020304)]).toEqual([1, 1, 2, 3, 4]);
  expect(readFrame(Buffer.from([2, 0, 0, 0, 7, 0, 255, 10]))).toEqual({ op: DATA, id: 7, data: Buffer.from([0, 255, 10]) });
  // An OPEN names its target on the connector (PIE-1242: `door:<key>`), never more than a name's length.
  expect(readFrame(frame(OPEN, 3, Buffer.from("door:garden")))).toEqual({ op: OPEN, id: 3, data: Buffer.from("door:garden") });
  for (const bytes of [[], [1, 0, 0], [9, 0, 0, 0, 1], [1, 0, 0, 0, 0], [3, 0, 0, 0, 1, 99], [1, 0, 0, 0, 1, ...Array(257).fill(97)]]) expect(() => readFrame(Buffer.from(bytes))).toThrow();
});
