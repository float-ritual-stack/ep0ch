// PIE-510 (F6/F9): a note trashed with an ancestor. The service's event names only the root of what went to the
// Trash and moves no revision, so every reader asks NoteSurface.staleOn: on any trash, restore or purge it reads
// its note again, and a child whose parent was trashed says "in the Trash" in a desk reader, a river column and
// the BBS message reader alike. Scratch services and fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { River } from "../src/river/river";
import { MessageReader } from "../src/screens";
import { MainMenu } from "../src/screens";
import { SocketBoard, type Actor } from "../src/socket";
import { visible } from "../src/style";
import { NoteSurface } from "../src/surface/note";
import { outliner, Scratch, until } from "./scratch";

const SWEEP: Actor = { kind: "agent", id: "sweep" };

test("staleOn: a change to the note it hasn't seen, a reset, and any trash, restore or purge", () => {
  const s = new NoteSurface();
  (s as any).msg = { id: "child-1", text: "Jars", props: {}, revision: 4, childIds: [] };
  const change = (kind: string, blockId: string, revision?: number) => ({ domain: "outline", action: "changed", blockId, sequence: 1, change: { sequence: 1, changeId: 1, action: kind, kind, blockId, revision, recordedAt: "" } }) as any;
  expect(s.staleOn(change("edit", "child-1", 5))).toBe(true);
  expect(s.staleOn(change("edit", "child-1", 4))).toBe(false);          // its own save coming back
  expect(s.staleOn(change("edit", "other-1", 9))).toBe(false);
  expect(s.staleOn(change("delete", "parent-1", 2))).toBe(true);        // an ancestor went to the Trash
  expect(s.staleOn(change("restore", "parent-1", 2))).toBe(true);
  expect(s.staleOn(change("purge", "parent-1"))).toBe(true);
  expect(s.staleOn({ domain: "outline", action: "reset", sequence: 1 } as any)).toBe(true);
  expect(new NoteSurface().staleOn(change("delete", "parent-1"))).toBe(false);   // nothing shown
});

describe.skipIf(!outliner)("a child shown while its parent goes to the Trash, on a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, agent: SocketBoard, app: App;
  const make = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "user" });
  const screen = () => (app as any).stack.at(-1) as any;
  const lines = () => (screen().render((screen() as any).ctx ?? app).lines as string[]).map(visible).join("\n");
  /** A parent and its child, fictional: the child is what the reader shows. */
  const family = async (n: string) => {
    const parent = await make(null, `Pantry shelf ${n}`);
    const child = await make(parent.id, `Jars of ${n} on the top shelf\nLabel them by month.`);
    return { parent, child };
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    agent = new SocketBoard(scratch.sock);
    await agent.info();
    const term = { info: { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 30_000);

  afterAll(async () => {
    for (const s of (app as any).stack) s.dispose?.();
    board?.close(); agent?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  }, 20_000);

  test("a desk reader says the child is in the Trash, and stops saying it once the parent is restored", async () => {
    const { parent, child } = await family("plums");
    const desk = new Desk();
    app.push(desk);
    try {
      await app.act({ action: "open", args: { id: child.id }, as: "walker-510" });
      await until(() => lines().includes("Jars of plums"), "the child in a reader", 10_000);
      expect(lines()).not.toContain("in the Trash");
      await agent.trash(parent.id, SWEEP);
      await until(() => lines().includes("in the Trash"), "the reader saying the child is in the Trash", 10_000);
      await agent.restore(parent.id);
      await until(() => !lines().includes("in the Trash"), "the reader no longer saying so once restored", 10_000);
    } finally { app.pop(); }
  }, 30_000);

  test("a river column says the child is in the Trash", async () => {
    const { parent, child } = await family("quinces");
    const river = new River(), R = river as any;
    app.push(river);
    try {
      await app.act({ action: "open", args: { id: child.id }, as: "walker-510" });
      const col = () => R.cols.find((c: any) => c.panes[0].source.kind === "block" && c.panes[0].source.id === child.id);
      await until(() => !!col() && lines().includes("Jars of quinces") && col().panes[0].surface.msg?.id === child.id, "the child's column", 10_000);
      expect(lines()).not.toContain("in the Trash");
      await agent.trash(parent.id, SWEEP);
      await until(() => lines().includes("in the Trash"), "the column saying the child is in the Trash", 10_000);
    } finally { app.pop(); }
  }, 30_000);

  test("the BBS message reader says the child is in the Trash", async () => {
    const { parent, child } = await family("damsons");
    const reader = new MessageReader([(await board.get(child.id))!], 0);
    app.push(reader);
    try {
      await until(() => lines().includes("Jars of damsons") && !reader.surface.msg?.partial, "the message", 10_000);
      expect(lines()).not.toContain("in the Trash");
      await agent.trash(parent.id, SWEEP);
      await until(() => lines().includes("in the Trash"), "the message reader saying the child is in the Trash", 10_000);
    } finally { app.pop(); }
  }, 30_000);
});
