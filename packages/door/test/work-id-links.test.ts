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
import { outliner, Scratch, showIn, until } from "./scratch";

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
    showIn(desk, note);
    const r = () => desk.pane("reader") as ReaderPane;
    // What `[ ]` steps and ⏎ opens: the reader's elements, in reading order.
    const els = () => { desk.render((desk as any).ctx); return (r().surface.describeElements() as any[]).filter(e => e.kind === "link"); };
    await until(() => els().length >= 3, "three links drawn", 8000);
    expect(els().map(e => e.label)).toEqual([expect.stringContaining("SHED-001"), expect.stringContaining("Mend the gate latch"), expect.stringContaining("potting-bench")]);
    expect(els().some(e => /TR-808/.test(e.label))).toBe(false);
    await desk.dispatch.act({ action: "element.open", tile: "reader", args: { n: els()[0].n } }, { kind: "user" });
    await until(() => r().msg?.id === latch.id, "⏎: the Work ID's item opened", 5000);
  }, 30_000);

  test.each([80, 140])("a reply card at %i columns exposes its link to keys and opens it", async cols => {
    const target = await board.createBlock(null, `Repair the hinge [work-id::SHED-${cols}]\nBring a screwdriver.`);
    const note = await board.createBlock(null, "Workshop plan\nInspect the door.");
    const thread = await board.comment(crypto.randomUUID(), note.id, note.revision!, "Check the hardware.", null);
    await board.reply(crypto.randomUUID(), thread.id, `Try ((${target.id}|SHED-${cols})) next.`);
    const desk = new Desk({ name: "cards", title: "cards", layout: { root: { t: "leaf", kind: "reader", name: "reader" }, focus: "reader" } });
    app.push(desk); showIn(desk, note);
    const reader = desk.pane("reader") as ReaderPane;
    reader.surface.marginMode = "full";
    const links = () => { reader.render(cols, 40, true, desk); return reader.surface.describeElements() as { n: number; kind: string; label: string }[]; };
    await until(() => !!reader.surface.comments?.length, "comment loaded");
    const link = links().find(e => e.kind === "link" && e.label.includes(`SHED-${cols}`));
    expect(link).toBeDefined();
    if (cols === 80) {
      for (let i = 0; i < links().length; i++) {
        reader.key({ kind: "char", ch: "]" }, desk);
        if (reader.surface.describeElements().some(e => e.current && e.label.includes(`SHED-${cols}`))) break;
      }
      reader.key({ kind: "enter" }, desk);
    } else {
      const rows = reader.render(cols, 40, true, desk).lines.map(l => l.replace(/\x1b\[[\d;]*m/g, ""));
      const y = rows.findIndex(l => l.includes(`SHED-${cols}`)), x = rows[y]!.indexOf(`SHED-${cols}`);
      reader.surface.click(x + 1, y, reader.host(desk));
    }
    await until(() => reader.msg?.id === target.id, "reply link opened");
    app.pop();
  });

  test("a standalone reply labels its title and links back to the note it comments on", async () => {
    const target = await board.createBlock(null, "Paint the hinge [work-id::SHED-003]");
    const note = await board.createBlock(null, "Workshop discussion\nChoose the colour.");
    const thread = await board.comment(crypto.randomUUID(), note.id, note.revision!, "Which paint?", null);
    const reply = await board.reply(crypto.randomUUID(), thread.id, `Try ((${target.id}|SHED-003)) next.\nUse blue.`);
    const desk = new Desk({ name: "reply", title: "reply", layout: { root: { t: "leaf", kind: "reader", name: "reader" }, focus: "reader" } });
    app.push(desk); showIn(desk, (await board.get(reply.id))!);
    const reader = desk.pane("reader") as ReaderPane;
    const paint = () => reader.render(100, 40, true, desk).lines.join("\n").replace(/\x1b\[[\d;]*m/g, "");
    await until(() => !reader.msg?.partial, "reply read");
    expect(paint()).toContain("Try SHED-003 next.");
    expect(paint()).not.toContain(target.id);
    await until(() => paint().includes("on Workshop discussion"), "comment subject link");
    await until(() => { paint(); return (reader.surface.describeElements() as { label: string }[]).some(e => e.label.includes("SHED-003")); }, "reply outlinks");
    const links = reader.surface.describeElements() as { n: number; kind: string; label: string }[];
    const back = links.find(e => e.kind === "link" && e.label.includes("Workshop discussion"));
    expect(back).toBeDefined();
    await desk.dispatch.act({ action: "element.open", tile: "reader", args: { n: back!.n } }, { kind: "user" });
    await until(() => reader.msg?.id === note.id, "back on the commented note");
    app.pop();
  });

});
