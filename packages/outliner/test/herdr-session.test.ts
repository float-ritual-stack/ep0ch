import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { attachCaptureInput } from "../src/capture-input";

test("a lone Escape reaches the popup at once, not after readline's escape wait", async () => {
  const input = new PassThrough();
  const keys: string[] = [];
  const detach = attachCaptureInput(input, {
    keypress: (_text, key) => keys.push(key.name ?? ""), paste() {}, mouse() {},
  });
  input.write("\x1b");
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(keys).toEqual(["escape"]);
  detach();
  input.destroy();
});
