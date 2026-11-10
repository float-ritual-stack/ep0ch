// PIE-1720: today's plan reads whole on a hub page and scrolls in place. A `::links` preview takes `height:` (rows, or
// `fill` for the previewed note's own length), and the wheel over it scrolls the reader, the keys staying in the note;
// a query embed (`!((query: …))`) draws the newest note its query matches, whole, and follows it as notes change.
// Against a throwaway outliner, at Evan's reading width (44 columns), with made-up plans.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { Desk } from "../src/desk/desk";
import type { ReaderPane } from "../src/desk/panes";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, showIn, until as untilQuick } from "./scratch";

const until = (ok: () => boolean, what: string, ms = 15_000) => untilQuick(ok, what, Math.max(ms, 15_000));
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
/** A made-up plan, `rows` jobs long. */
const planText = (day: string, rows: number) => [`Plan, ${day} [type::plan] [day::${day}]`, "## Jobs", ...Array.from({ length: rows }, (_, i) => `- [ ] job ${i + 1} of ${day}`)].join("\n");

describe.skipIf(!outliner)("a plan read whole on a hub page (PIE-1720)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, desk: Desk;
  let key: (k: Key) => void = () => {};
  const D = () => desk as any;
  const reader = () => desk.pane("reader") as ReaderPane;
  const lines = () => desk.render(D().ctx).lines.map(plain);
  const create = (text: string) => board.createBlock(null, text);
  /** Wheel down over the screen's middle until `ok`, or a hundred reports. */
  const wheelUntil = async (ok: () => boolean, what: string) => {
    for (let i = 0; i < 100 && !ok(); i++) { key({ kind: "mouse", action: "wheel-down", button: 64, x: 10, y: 12 }); lines(); }
    await until(ok, what);
  };
  const open = async (m: Msg, has: string) => {
    showIn(desk, m);
    D().focus = D().idNamed("reader");
    await until(() => reader().msg?.id === m.id && lines().join("\n").includes(has), `${has} drawn`);
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 44, rows: 30, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    desk = new Desk({ name: "one", title: "one reader", layout: { root: { t: "leaf", kind: "reader", name: "reader" }, focus: "reader" } });
    app.push(desk);
    await create(planText("2026-03-02", 3));
    await create(planText("2026-03-03", 60));
  }, 60_000);

  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; }, 20_000);

  test("::links with height: fill previews the plan whole under the list; the wheel scrolls the reader to its last job, the keys staying in the note", async () => {
    const hub = await create("Where we are\n::links\nquery: type=plan\nsort: day desc\npreview: below\nheight: fill\n::\nAfter the plan.");
    await open(hub, "job 1 of 2026-03-03");
    expect(lines().join("\n")).not.toContain("more rows");
    await wheelUntil(() => lines().join("\n").includes("job 60 of 2026-03-03"), "the plan's last job, by the wheel");
    expect(lines().join("\n")).not.toContain("more rows");
    expect(reader().surface.listIn).toBeNull();
    expect(D().nameOf(D().focus)).toBe("reader");
  }, 60_000);

  test("::links with height: 6 draws six rows of the preview and says how many more", async () => {
    const hub = await create("Six rows\n::links{query=\"type=plan day=2026-03-03\" preview=below height=6}\n::");
    await open(hub, "job 1 of 2026-03-03");
    const drawn = lines().join("\n");
    expect(drawn).not.toContain("job 5 of 2026-03-03");
    expect(drawn).toMatch(/5\d more rows · ⏎ opens it/);
  }, 60_000);

  test("a height that isn't rows or fill says so on the frame", async () => {
    const hub = await create("Tall\n::links{query=\"type=plan\" height=tall}\n::");
    await open(hub, "height:");
    // Wrapped at 44 columns, the whole sentence: nothing of it cut.
    expect(lines().join(" ").replace(/[║┊\s]+/g, " ")).toContain("height: is a number of rows or fill, not tall");
  }, 60_000);

  test("!((query: …)) draws the newest plan whole and follows a newer one; a query nothing answers says why", async () => {
    const hub = await create("Today\n!((query: type=plan sort: day desc))\n\n!((query: type=plan colour=teal))");
    await open(hub, "job 1 of 2026-03-03");
    await wheelUntil(() => lines().join("\n").includes("job 60 of 2026-03-03"), "the embedded plan's last job, by the wheel");
    await wheelUntil(() => lines().join("\n").includes("no notes have colour"), "the second embed's why");
    // A newer plan: the embed moves to it, live.
    await create(planText("2026-03-04", 2));
    await until(() => lines().join("\n").includes("job 2 of 2026-03-04") || (reader().surface.scrollBy(-500), lines().join("\n").includes("job 1 of 2026-03-04")), "the newer plan in the embed");
  }, 60_000);
});
