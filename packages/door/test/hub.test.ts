// float-hub's views: Waiting on others (outbox items still waiting, by who) and Claude · now (a pinned page).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { groupWaiting, sentAt, waitingOn, type WaitingPane } from "../src/hub/waiting";
import { nowPage, type PinnedReader } from "../src/hub/pinned";
import { openScreen } from "../src/desk/screen-specs";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const item = (id: string, props: Record<string, string>, createdAt = 0): Msg =>
  ({ id, text: id, parentId: null, childIds: [], createdAt, updatedAt: createdAt, author: null, props: { type: "outbox-item", outbox: "waiting", ...props } });

describe("what an outbox item waits on", () => {
  test("sent is local time, 12-hour or 24-hour; without it, when the item was written", () => {
    expect(sentAt(item("a", { sent: "2026-01-05 4:23 PM" }))).toBe(new Date(2026, 0, 5, 16, 23).getTime());
    expect(sentAt(item("b", { sent: "2026-01-05 12:05 AM" }))).toBe(new Date(2026, 0, 5, 0, 5).getTime());
    expect(sentAt(item("c", { sent: "2026-01-05 09:30" }))).toBe(new Date(2026, 0, 5, 9, 30).getTime());
    expect(sentAt(item("d", { sent: "2026-01-05" }))).toBe(new Date(2026, 0, 5).getTime());
    expect(sentAt(item("e", { sent: "last week" }, 42))).toBe(42);
  });
  test("waiting-on's name before the colon is who; the rest is what. Without one: to, and the title", () => {
    expect(waitingOn(item("a", { "waiting-on": "Ada: which shelf do the jars go on?" }))).toEqual({ who: "Ada", what: "which shelf do the jars go on?" });
    expect(waitingOn(item("b", { to: "Brook, Cyd" }))).toEqual({ who: "Brook, Cyd", what: "b" });
    expect(waitingOn(item("c", {}))).toEqual({ who: "someone", what: "c" });
  });
  test("grouped by who (any case), oldest first in a group, the longest wait first", () => {
    const g = groupWaiting([
      item("cyd-new", { "waiting-on": "Cyd: b", sent: "2026-01-07 9:00 AM" }),
      item("brook", { "waiting-on": "Brook: a", sent: "2026-01-08 6:35 PM" }),
      item("cyd-old", { "waiting-on": "cyd: c", sent: "2026-01-02 9:00 AM" }),
    ]);
    expect(g.map(x => [x.who, x.items.map(m => m.id)])).toEqual([["cyd", ["cyd-old", "cyd-new"]], ["Brook", ["brook"]]]);
  });
});

describe.skipIf(!outliner)("the float-hub views", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  let key: (k: Key) => void = () => {};
  const press = (k: Key) => key(k);
  const ch = (c: string) => press({ kind: "char", ch: c });
  const top = () => (app as any).stack.at(-1);
  const screen = () => top().render(app).lines.map(plain).join("\n");
  let outbox: Msg, ada: Msg, brook: Msg;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 80, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    outbox = await board.createBlock(null, "Outbox");
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("the main menu names Waiting and Welcome at 80 columns without running off the edge", () => {
    app.push(new MainMenu());
    const lines = top().render(app).lines.map(plain) as string[];
    const at = lines.findIndex(l => l.includes("O Waiting"));
    expect(at).toBeGreaterThan(0);
    expect(lines[at]).toContain("C Welcome");
    for (const l of lines) expect(l.trimEnd().length).toBeLessThanOrEqual(80);
  });

  test("with nothing waiting it says so, and an agent's pick is refused", async () => {
    ch("O");
    expect(top().name).toBe("waiting");
    await until(() => (top().pane("waiting") as WaitingPane).items !== null, "the waiting items asked for");
    expect(screen()).toContain("Nobody owes you an answer.");
    expect(screen()).toContain("+ New note · ctrl+n");
    (app as any).lastInput = 0;                                                     // the person is idle
    await expect(app.act({ action: "waiting.pick", args: { n: 1 }, as: "test-agent" })).rejects.toThrow(/nothing is waiting/);
  });

  test("an item filed elsewhere shows up, grouped; the reader shows the one picked", async () => {
    await board.createBlock(outbox.id, "Done already [type::outbox-item] [outbox::done] [to::Dot]");
    ada = await board.createBlock(outbox.id, "Ask Ada about the jars [type::outbox-item] [outbox::waiting] [ticket::JAM-1] [sent::2026-01-05 5:36 PM] [waiting-on::Ada: which shelf do the jars go on?]");
    brook = await board.createBlock(outbox.id, "Ask Brook about the tins [type::outbox-item] [outbox::waiting] [ticket::TIN-2] [sent::2026-01-08 6:35 PM] [waiting-on::Brook: how many bread tins]\nThe body of the ask.");
    await until(() => (top().pane("waiting") as WaitingPane).items?.length === 2, "two waiting items, read again after the change");
    const s = screen();
    expect(s).toContain("outbox · 2 waiting on 2 people");
    expect(s).not.toContain("Done already");
    expect(s.indexOf("Ada · 1 waiting")).toBeLessThan(s.indexOf("Brook · 1 waiting"));
    expect(s).toMatch(/JAM-1 +which shelf/);
    await until(() => top().current?.id === ada.id, "the longest wait picked and read");
    ch("j");
    await until(() => screen().includes("The body of the ask."), "j picks the next; the reader follows");
    ch("j");                                                                       // the last item: j stays
    expect(top().current?.id).toBe(brook.id);
    expect((app.describe() as any).state).toMatchObject({ kind: "waiting", picked: 2, waiting: [{ who: "Ada" }, { who: "Brook" }] });
  });

  test("agents pick by act, said on screen; never while the person is typing; bad picks are refused", async () => {
    expect((app.actions() as any).actions.map((a: any) => a.name)).toEqual(expect.arrayContaining(["waiting.pick", "waiting.reload", "pane.split"]));
    (app as any).lastInput = 0;                                                     // the person is idle
    expect(await app.act({ action: "waiting.pick", args: { id: ada.id }, as: "test-agent" })).toMatchObject({ n: 1, of: 2, id: ada.id, who: "Ada" });
    expect((app as any).message).toContain("an agent (test-agent) showed what Ada owes (1 of 2)");
    expect(top().current?.id).toBe(ada.id);
    await expect(app.act({ action: "waiting.pick", args: { n: 3 }, as: "test-agent" })).rejects.toThrow(/pick 1 to 2/);
    await expect(app.act({ action: "waiting.pick", args: { id: "nope" }, as: "test-agent" })).rejects.toThrow(/no waiting item nope/);
    await expect(app.act({ action: "waiting.pick", args: {}, as: "test-agent" })).rejects.toThrow(/n or id/);
    // The person edits the note in the reader: an agent's pick would move it out from under them.
    ch("2");
    ch("e");
    await until(() => !!top().readerPanes()[0]?.pane.draft, "the person's edit");
    await expect(app.act({ action: "waiting.pick", args: { n: 2 }, as: "test-agent" })).rejects.toThrow(/the person is typing/);
    press({ kind: "esc" });
    await until(() => !top().readerPanes()[0]?.pane.draft, "the edit closed");
    expect(await app.act({ action: "waiting.reload", as: "test-agent" })).toEqual({ tile: "waiting", waiting: 2 });
    ch("q");
  });

  test("Claude · now waits for its page, then pins it; a change to the page shows live", async () => {
    // C opens the welcome notes now (test/welcome.test.ts); the pinned page is still a screen of its own.
    app.push(openScreen("pinned", nowPage()));
    expect(top().name).toBe("pinned");
    await until(() => (top().pane("pinned") as PinnedReader).asked, "the page asked for");
    expect(screen()).toContain("No [[claude-now]] page on this outline yet.");
    const page = await board.createBlock(null, "Claude · now [page::claude-now] [type::agent-status]\nStart here: the jam jars.");
    await until(() => screen().includes("Start here: the jam jars."), "the page, once it exists");
    expect(screen()).toContain("Claude · now · pinned [[claude-now]]");
    const fresh = (await board.get(page.id))!;
    await board.update(page.id, fresh.text.replace("the jam jars", "the bread tins"), fresh.revision!);
    await until(() => screen().includes("Start here: the bread tins."), "the edit, live");
    // An agent's open lands beside the page (its kind's open rule): the page stays pinned.
    (app as any).lastInput = 0;
    const jar = await board.createBlock(null, "Spare jar\nOn the top shelf.");
    const r = await app.act({ action: "open", args: { id: jar.id }, as: "test-agent" }) as { reader: string };
    expect(r.reader).not.toBe("pinned");
    await until(() => screen().includes("On the top shelf."), "the note beside the page");
    expect((top().pane("pinned") as PinnedReader).msg?.id).toBe(page.id);
    ch("q");
  });
});
