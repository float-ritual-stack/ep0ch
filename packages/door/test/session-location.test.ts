// PIE-1498: the status line says which machine's session this is when the outline lives on another machine. Two
// sessions on one outline can run on two machines (float-box's `--machine float-2` and float-2's own), and until this
// line nothing on screen said which the person was in.
import { describe, expect, test } from "bun:test";
import { hostname } from "node:os";
import { App } from "../src/app";
import { doorLocation } from "../src/session/place";

const app = () => {
  const term = { info: { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
  const a = new App(term as any, { subscribe() {}, onGrammar: null } as any, Date.now(), () => {});
  a.host = "float-2-host"; a.workspace = "pie"; a.outline = "pie";
  return a;
};

describe("the status line's place (PIE-1498)", () => {
  test("an outline on this machine: host · outline, as before", () => {
    const a = app();
    expect(a.location).toBe("float-2-host · pie");
    expect(doorLocation(a).short).toBe(a.location);
    a.retire();
  });
  test("an outline on another machine: the outline on its machine, and the machine this session runs on", () => {
    const a = app();
    a.machine = "float-2";
    expect(a.location).toBe(`pie on float-2 · session on ${hostname()}`);
    expect(doorLocation(a).short).toBe("pie on float-2");
    expect(doorLocation({ host: "h", workspace: "pie", outline: "pie", machine: "float-2" }, "float-box")).toEqual({ text: "pie on float-2 · session on float-box", short: "pie on float-2" });
    a.retire();
  });
});
