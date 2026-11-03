// float-hub's views: Waiting on others (PIE-1525: the waiting extension's list, screen and main-menu row) and Claude · now
// (a pinned page). Waiting is a default-on built-in: the scratch host installs it at start, as the host does after a
// deploy; uninstalling it takes its menu row and screen, installing brings them back. A screen a person made gets a row
// the same way (screen.menu). Scratch services; every note is made up.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { nowPage, type PinnedReader } from "../src/hub/pinned";
import { openScreen } from "../src/desk/screen-specs";
import { screenNames } from "../src/desk/screen-spec";
import { forgetScreenNotes, loadScreenNotes } from "../src/desk/screen-notes";
import { MainMenu, menuItems } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const rows = () => menuItems().map(i => (i.key ? `${i.key} ${i.label}` : i.label));

describe.skipIf(!outliner)("the float-hub views", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  let key: (k: Key) => void = () => {};
  const press = (k: Key) => key(k);
  const ch = (c: string) => press({ kind: "char", ch: c });
  const top = () => (app as any).stack.at(-1);
  const screen = () => top().render(app).lines.map(plain).join("\n");
  const list = () => top().pane("waiting") as any;
  let outbox: Msg, ada: Msg, brook: Msg;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 80, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    await app.loadExtensions(true);
    outbox = await board.createBlock(null, "Outbox");
  }, 30_000);
  afterAll(async () => { forgetScreenNotes(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("after a deploy, the main menu has O Waiting with no install step, at 80 columns without running off the edge", () => {
    expect(screenNames()).toContain("waiting");
    expect(rows()).toEqual(expect.arrayContaining(["O Waiting", "C Welcome"]));
    app.push(new MainMenu());
    const lines = top().render(app).lines.map(plain) as string[];
    const at = lines.findIndex(l => l.includes("O Waiting"));
    expect(at).toBeGreaterThan(0);
    for (const l of lines) expect(l.trimEnd().length).toBeLessThanOrEqual(80);
  });

  test("O opens Waiting: with nothing waiting it says so, and the demo's made-up asks are never listed", async () => {
    ch("O");
    expect(top().name).toBe("waiting");
    await until(() => screen().includes("Nobody owes you an answer."), "the empty list, drawn by the extension");
    expect(screen()).toContain("waiting on others · none");
  });

  test("an item filed elsewhere shows up, grouped, oldest first; the reader shows the one picked; j picks the next", async () => {
    await board.createBlock(outbox.id, "Done already [type::outbox-item] [outbox::done] [to::Dot]");
    ada = await board.createBlock(outbox.id, "Ask Ada about the jars [type::outbox-item] [outbox::waiting] [ticket::JAM-1] [sent::2026-01-05 5:36 PM] [waiting-on::Ada: which shelf do the jars go on?]");
    brook = await board.createBlock(outbox.id, "Ask Brook about the tins [type::outbox-item] [outbox::waiting] [ticket::TIN-2] [sent::2026-01-08 6:35 PM] [waiting-on::Brook: how many bread tins]\nThe body of the ask.");
    await board.createBlock(outbox.id, "Ask ada again [type::outbox-item] [outbox::waiting] [sent::2026-01-09 9:00 AM] [waiting-on::ada: and the lids?]");
    // Written last, waiting longest: its sent date (read by date(), as the views read one) puts Cyd first.
    await board.createBlock(outbox.id, "Ask Cyd about the gate [type::outbox-item] [outbox::waiting] [sent::2025-12-20 8:00 AM] [waiting-on::Cyd: the gate latch]");
    await until(() => screen().includes("outbox · 4 waiting on 3"), "four waiting items, read again after the change", 8000);
    const s = screen();
    expect(list().title()).toBe("outbox · 4 waiting on 3 people");
    expect(s.indexOf("Cyd · 1 waiting")).toBeLessThan(s.indexOf("Ada · 2 waiting"));
    expect(s).toMatch(/\d+d +the gate latch/);
    expect(s).not.toContain("Done already");
    expect(s.indexOf("Ada · 2 waiting")).toBeLessThan(s.indexOf("Brook · 1 waiting"));
    expect(s.indexOf("which shelf")).toBeLessThan(s.indexOf("and the lids?"));
    expect(s).toMatch(/JAM-1 +which shelf/);
    const read = () => (top().pane("reader") as any)?.msg?.id;
    await until(() => !!read(), "the longest wait picked and read");
    ch("j"); ch("j"); ch("j");
    await until(() => screen().includes("The body of the ask."), "j picks the next; the reader follows");
    expect(read()).toBe(brook.id);
  });

  test("an agent picks by list.pick, said on screen; waiting.pick names the action that works", async () => {
    (app as any).lastInput = 0;                                                     // the person is idle
    // The lists' one set: an agent's pick is its own (the person's stays where they left it), answered with the row.
    const picked = await app.act({ action: "list.pick", tile: "waiting", args: { id: ada.id }, as: "test-agent" });
    expect(JSON.stringify(picked)).toContain(ada.id);
    expect((top().pane("reader") as any).msg?.id).toBe(brook.id);
    await expect(app.act({ action: "waiting.pick", args: { n: 1 }, as: "test-agent" })).rejects.toThrow(/list\.pick/);
    ch("q");
  });

  test("uninstalled, its menu row and screen go, and the refusal says how to bring it back; installed, both return with no restart", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "extensions.uninstall", args: { id: "waiting", demo: "keep" } });
    await until(() => !screenNames().includes("waiting"), "the waiting screen gone with its extension", 8000);
    expect(rows()).not.toContain("O Waiting");
    expect(rows()).toContain("C Welcome");
    await expect(app.act({ action: "screen.open", args: { name: "waiting" } })).rejects.toThrow(/extensions\.install id=waiting/);
    await app.act({ action: "extensions.install", args: { id: "waiting" } });
    await until(() => screenNames().includes("waiting"), "the waiting screen back", 8000);
    expect(rows()).toContain("O Waiting");
    await app.act({ action: "screen.open", args: { name: "O" } });
    expect(top().name).toBe("waiting");
    await until(() => screen().includes("outbox · 4 waiting on 3"), "the same list again");
    ch("q");
  });

  test("a screen he made gets a row on the main menu; another door reads the same row; a taken key leaves it keyless, said", async () => {
    app.push(openScreen("blank"));
    await app.act({ action: "screen.save", args: { name: "Potting bench" } });
    expect(top().name === "blank" || top().name === "potting-bench").toBe(true);
    const r = await app.act({ action: "screen.menu", args: { key: "y", label: "Potting" } }) as any;
    expect(r).toMatchObject({ screen: "potting-bench", menu: { key: "Y", label: "Potting" } });
    expect(rows()).toContain("Y Potting");
    // Another door on the outline reads the screen notes afresh: the row is in the note.
    forgetScreenNotes();
    expect(rows()).not.toContain("Y Potting");
    await loadScreenNotes(board);
    expect(rows()).toContain("Y Potting");
    // C is Welcome's: the row stays, with no key, and the answer says who holds it.
    const clash = await app.act({ action: "screen.menu", args: { name: "potting-bench", key: "C", label: "Potting" } }) as any;
    expect(clash.problem).toMatch(/C is Welcome's/);
    expect(rows()).toContain("Potting");
    expect((new MainMenu().describe() as any).problems?.[0]).toMatch(/C is Welcome's/);
    await app.act({ action: "screen.menu", args: { name: "potting-bench", off: true } });
    expect(rows().some(r => r.includes("Potting"))).toBe(false);
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
    expect(screen()).toContain("1 Claude · now");
    expect(screen()).toContain("Claude · now");
    const fresh = (await board.get(page.id))!;
    await board.update(page.id, fresh.text.replace("the jam jars", "the bread tins"), fresh.revision!);
    await until(() => screen().includes("Start here: the bread tins."), "the edit, live");
    // An agent's open lands beside the page (its kind's open rule): the page stays pinned.
    (app as any).lastInput = 0;
    const jar = await board.createBlock(null, "Spare jar\nOn the top shelf.");
    const r = await app.act({ action: "open", args: { id: jar.id }, as: "test-agent" }) as { name: string };
    expect(r.name).not.toBe("pinned");
    await until(() => screen().includes("On the top shelf."), "the note beside the page");
    expect((top().pane("pinned") as PinnedReader).msg?.id).toBe(page.id);
    ch("q");
  });
});
