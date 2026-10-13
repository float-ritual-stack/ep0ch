// A bare Work ID in a note's body is a link where the outline uses its prefix (#429, the service's `ticketPrefixes`),
// and `[ ]` and ⏎ reach it, as `((id))` and `[[page]]` are; a key with another prefix, or in code, is text. Scratch
// outline, fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import type { ReaderPane } from "../src/desk/panes";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

describe.skipIf(!outliner)("links in a note's body: a bare Work ID, ((id)) and [[page]]", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    await board.request("work-ids.configure", { prefix: "SHED" });
    const term = { info: { cols: 160, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 30_000);
  afterAll(async () => { app?.quit(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("each is a link the reader's elements reach; ⏎ on the Work ID opens its item", async () => {
    const latch = await board.createBlock(null, "Mend the gate latch [work-id::SHED-001]\nThe spring is gone.");
    await board.createBlock(null, "Potting bench [page::potting-bench]\nCedar boards.");
    const note = await board.createBlock(null, `Shed log\nSee SHED-001 before winter, ((${latch.id})) too, and [[potting-bench]]. The TR-808 and \`SHED-001\` are text.`);
    const desk = new Desk({ name: "one", title: "one", layout: { root: { t: "leaf", kind: "reader", name: "reader" }, focus: "reader" } });
    app.push(desk);
    desk.setCurrent(note);
    const r = () => desk.pane("reader") as ReaderPane;
    // What `[ ]` steps and ⏎ opens: the reader's elements, in reading order.
    const els = () => { desk.render((desk as any).ctx); return (r().surface.describeElements() as any[]).filter(e => e.kind === "link"); };
    await until(() => els().length >= 3, "three links drawn", 8000);
    expect(els().map(e => e.label)).toEqual([expect.stringContaining("SHED-001"), expect.stringContaining("Mend the gate latch"), expect.stringContaining("potting-bench")]);
    expect(els().some(e => /TR-808/.test(e.label))).toBe(false);
    await desk.dispatch.act({ action: "element.open", tile: "reader", args: { n: els()[0].n } }, { kind: "user" });
    await until(() => r().msg?.id === latch.id, "⏎: the Work ID's item opened", 5000);
  }, 30_000);
});
