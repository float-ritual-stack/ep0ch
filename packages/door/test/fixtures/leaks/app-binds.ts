// A test file whose App read the outline's extensions and was never quit, as test/power-bar.test.ts's was: its
// `ext.*` actions stayed bound into every later file (test/test-leaks.test.ts runs it, then reads-actions.ts).
import { expect, test } from "bun:test";
import { App } from "../../../src/app";
import { EXT_ACTIONS } from "../../../src/extensions";
import { list } from "./list";

test("an App binds an extension's actions and is left running", async () => {
  const term = { info: { cols: 80, rows: 24, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
  const board = { listExtensions: async () => list, subscribe() {}, close() {} };
  const app = new App(term as never, board as never, Date.now(), () => {});
  await app.loadExtensions();
  expect(EXT_ACTIONS.names()).toContain("ext.tarot.draw");
});
