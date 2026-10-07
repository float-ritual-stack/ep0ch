// A test file that leaves its App running (no quit), as many did (test/app-leak.test.ts runs it, then another file).
// Its screen throws if it's painted once another file runs, the way a stub board missing a method did.
import { expect, test } from "bun:test";
import { App } from "../../../src/app";

const mine = Bun.main;
test("an App left running", () => {
  const term = { info: { cols: 80, rows: 24, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
  const app = new App(term as never, {} as never, Date.now(), () => {});
  app.push({ title: "left running", tick: () => true, render: () => { if (Bun.main !== mine) throw new Error("an App from an earlier file painted"); return { lines: [] }; } } as never);
  expect(app).toBeDefined();
});
