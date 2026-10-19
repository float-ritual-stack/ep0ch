import { expect, test } from "bun:test";
import { frame, readFrame, DATA, OPEN } from "../src/link-frame";

test("link frames keep binary payload and stream identity separate and reject malformed messages", () => {
  expect([...frame(OPEN, 0x01020304)]).toEqual([1, 1, 2, 3, 4]);
  expect(readFrame(Buffer.from([2, 0, 0, 0, 7, 0, 255, 10]))).toEqual({ op: DATA, id: 7, data: Buffer.from([0, 255, 10]) });
  for (const bytes of [[], [1, 0, 0], [9, 0, 0, 0, 1], [1, 0, 0, 0, 0], [1, 0, 0, 0, 1, 99]]) expect(() => readFrame(Buffer.from(bytes))).toThrow();
});
