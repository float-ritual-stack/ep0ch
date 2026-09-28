// float-hub's views: Waiting on others (outbox items still waiting, by who) and Claude · now (a pinned page).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { groupWaiting, sentAt, Waiting, waitingOn } from "../src/hub/waiting";
import { PinnedPage } from "../src/hub/pinned";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const item = (id: string, props: Record<string, string>, createdAt = 0): Msg =>
  ({ id, text: id, parentId: null, childIds: [], createdAt, updatedAt: createdAt, author: null, props: { type: "outbox-item", outbox: "waiting", ...props } });

describe("what an outbox item waits on", () => {
  test("sent is local time, 12-hour or 24-hour; without it, when the item was written", () => {
    expect(sentAt(item("a", { sent: "2026-09-25 4:23 PM" }))).toBe(new Date(2026, 8, 25, 16, 23).getTime());
    expect(sentAt(item("b", { sent: "2026-09-25 12:05 AM" }))).toBe(new Date(2026, 8, 25, 0, 5).getTime());
    expect(sentAt(item("c", { sent: "2026-09-25 09:30" }))).toBe(new Date(2026, 8, 25, 9, 30).getTime());
    expect(sentAt(item("d", { sent: "2026-09-25" }))).toBe(new Date(2026, 8, 25).getTime());
    expect(sentAt(item("e", { sent: "last week" }, 42))).toBe(42);
  });
  test("waiting-on's name before the colon is who; the rest is what. Without one: to, and the title", () => {
    expect(waitingOn(item("a", { "waiting-on": "Felipe: does QA have staging CMS logins?" }))).toEqual({ who: "Felipe", what: "does QA have staging CMS logins?" });
    expect(waitingOn(item("b", { to: "Jay, Oleg" }))).toEqual({ who: "Jay, Oleg", what: "b" });
    expect(waitingOn(item("c", {}))).toEqual({ who: "someone", what: "c" });
  });
  test("grouped by who (any case), oldest first in a group, the longest wait first", () => {
    const g = groupWaiting([
      item("tej-new", { "waiting-on": "Tej: b", sent: "2026-09-27 9:00 AM" }),
      item("milind", { "waiting-on": "Milind: a", sent: "2026-09-28 6:35 PM" }),
      item("tej-old", { "waiting-on": "tej: c", sent: "2026-09-20 9:00 AM" }),
    ]);
    expect(g.map(x => [x.who, x.items.map(m => m.id)])).toEqual([["tej", ["tej-old", "tej-new"]], ["Milind", ["milind"]]]);
  });
});

describe.skipIf(!outliner)("the float-hub views", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  let key: (k: Key) => void = () => {};
  const ch = (c: string) => key({ kind: "char", ch: c });
  const top = () => (app as any).stack.at(-1);
  const screen = () => top().render(app).lines.map(plain).join("\n");
  let outbox: Msg;

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

  test("the main menu names Waiting and Claude·now at 80 columns without running off the edge", () => {
    app.push(new MainMenu());
    const lines = top().render(app).lines.map(plain) as string[];
    const at = lines.findIndex(l => l.includes("O Waiting"));
    expect(at).toBeGreaterThan(0);
    expect(lines[at]).toContain("C Claude·now");
    for (const l of lines) expect(l.trimEnd().length).toBeLessThanOrEqual(80);
  });

  test("with nothing waiting it says so; an item filed elsewhere shows up, grouped, and the reader shows it", async () => {
    ch("O");
    expect(top()).toBeInstanceOf(Waiting);
    await until(() => (top() as Waiting).list.items !== null, "the waiting items asked for");
    expect(screen()).toContain("Nobody owes you an answer.");
    await board.createBlock(outbox.id, "Done already [type::outbox-item] [outbox::done] [to::Ann]");
    const felipe = await board.createBlock(outbox.id, "Reply to Felipe [type::outbox-item] [outbox::waiting] [ticket::PC-985] [sent::2026-09-25 5:36 PM] [waiting-on::Felipe: does QA have staging CMS logins?]");
    await board.createBlock(outbox.id, "Ask Milind [type::outbox-item] [outbox::waiting] [ticket::PC-762] [sent::2026-09-28 6:35 PM] [waiting-on::Milind: where the note prints]\nThe body of the ask.");
    await until(() => (top() as Waiting).list.items?.length === 2, "two waiting items, read again after the change", 5000);
    const s = screen();
    expect(s).toContain("outbox · 2 waiting on 2 people");
    expect(s).not.toContain("Done already");
    expect(s.indexOf("Felipe · 1 waiting")).toBeLessThan(s.indexOf("Milind · 1 waiting"));
    expect(s).toMatch(/PC-985 +does QA have staging/);
    await until(() => top().current?.id === felipe.id, "the longest wait selected and read");
    ch("j");
    await until(() => screen().includes("The body of the ask."), "the reader follows the selection");
    expect((app.describe() as any).state.waiting.map((g: any) => g.who)).toEqual(["Felipe", "Milind"]);
    ch("q");
  });

  test("Claude · now waits for its page, then pins it; a change to the page shows live", async () => {
    ch("C");
    expect(top()).toBeInstanceOf(PinnedPage);
    await until(() => (top() as PinnedPage).asked, "the page asked for");
    expect(screen()).toContain("No [[claude-now]] page on this outline yet.");
    const page = await board.createBlock(null, "Claude · now [page::claude-now] [type::agent-status]\nStart here: the fax template.");
    await until(() => screen().includes("Start here: the fax template."), "the page, once it exists", 5000);
    expect(screen()).toContain("Claude · now · pinned [[claude-now]]");
    const fresh = (await board.get(page.id))!;
    await board.update(page.id, fresh.text.replace("the fax template", "the SFMC question"), fresh.revision!);
    await until(() => screen().includes("Start here: the SFMC question."), "the edit, live");
    ch("q");
  });
});
