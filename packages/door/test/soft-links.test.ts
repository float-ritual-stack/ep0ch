// PIE-408: what Evan writes by convention clicks through. A property's value, `ctx:: <date>`, a ticket key and `PR#n`
// under a project are links in the reader, by mouse and keys; each lands where it means, or offers, or asks; and the
// target lists the note as a soft mention. Scratch outline, made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { backlinkView, DEFAULT_BACKLINK_VIEW_OPTIONS } from "../src/backlinks";
import { Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe("soft links in the reader", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk, key: (k: Key) => void;
  const n: Record<string, any> = {};
  const create = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const lines = () => desk.render((desk as any).ctx).lines.map(plain);
  const at = (text: string) => {
    const all = lines();
    for (let y = 0; y < all.length; y++) { const x = all[y]!.indexOf(text); if (x >= 0) return { x: x + 1, y }; }
    throw new Error(`"${text}" isn't drawn:\n${all.join("\n")}`);
  };
  const click = (text: string) => {
    const { x, y } = at(text);
    key({ kind: "mouse", action: "down", button: 0, x, y });
    key({ kind: "mouse", action: "up", button: 0, x, y });
  };
  const reader = () => ([...(desk as any).panes.entries()].find(([, p]: any) => p.kind === "reader") as any)?.[1];
  const shown = () => reader()?.msg?.id as string | undefined;
  const open = async (id: string, words: string) => {
    if ((app as any).stack.at(-1) instanceof Desk) app.pop();
    desk = new Desk();
    app.push(desk);
    await app.act({ action: "open", args: { id }, as: "soft-links-test" });
    await until(() => shown() === id, "the note");
    await until(() => { try { at(words); return true; } catch { return false; } }, `"${words}" drawn`, 10_000);
  };
  const message = () => (app as any).message as string;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    await board.request("work-ids.configure", { prefix: "SHED" });
    n.thread = await create(null, "Agent labour [page::agent-labour]");
    n.day = await create(null, "Build log [day::2026-11-06]");
    n.floatty = await create(null, "Floatty [type::project] [page::floatty]");
    n.club = await create(null, "Garden club [type::project] [page::garden-club]");
    n.fp = await create(n.floatty.id, "PR#125 ribbon fix");
    n.cp = await create(n.club.id, "PR#125 kettle fix");
    n.gate = await create(null, "Fix the gate");
    n.ticket = (await board.request("work-ids.allocate", { blockId: n.gate.id, expectedRevision: n.gate.revision })).workId;
    n.note = await create(null, `Morning\nIn passing [thread::agent-labour] and [zone::no-page-yet].\n\nctx:: 2026-11-06 @ 4:31 AM\nSee ${n.ticket} too.\n[project::floatty] for PR#125 here.`);
    n.both = await create(null, "Both\n[project::floatty] and [project::garden-club] on PR#125.");
    n.none = await create(null, "Lonely\nunder [project::floatty]\nPR#404 not written.");
    const term = { info: { cols: 160, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  }, 20_000);

  test("a click lands: the value's page, that day's note, the ticket, that project's PR", async () => {
    for (const [words, target] of [["agent-labour", n.thread], ["2026-11-06", n.day], [n.ticket, n.gate], ["PR#125", n.fp]] as const) {
      await open(n.note.id, words);
      click(words);
      await until(() => shown() === target.id, `${words} to open its note`);
    }
  }, 30_000);

  test("by keys: the links are [ ] stops, and ⏎ follows one", async () => {
    await open(n.note.id, "agent-labour");
    key({ kind: "char", ch: "]" });
    await until(() => reader().surface.describeElements().some((e: any) => e.current && /agent-labour/.test(e.label ?? e.text ?? JSON.stringify(e))), "the [ ] position on it");
    key({ kind: "enter" } as Key);
    await until(() => shown() === n.thread.id, "⏎ to follow it");
  }, 20_000);

  test("a property in the note's metadata follows from the property panel: its row's value, by act and by a click", async () => {
    n.meta = await create(null, "Evening [thread::agent-labour]\nctx:: 2026-11-06 @ 4:31 AM\n\nBody.");
    await open(n.meta.id, "Body.");
    key({ kind: "char", ch: "i" });
    await until(() => { try { at("2026-11-06"); return true; } catch { return false; } }, "the panel");
    click("2026-11-06");
    await until(() => [...(desk as any).panes.values()].some((p: any) => p.kind === "reader" && p.msg?.id === n.day.id), "that day's note");
    await open(n.meta.id, "Body.");
  }, 20_000);

  test("a value with no page offers a stub; the second click makes it", async () => {
    await open(n.note.id, "no-page-yet].");
    click("no-page-yet].");
    await until(() => /doesn't exist yet/.test(message() ?? ""), "the offer");
    expect((await board.resolvePage("no-page-yet")).status).toBe("missing");
    click("no-page-yet].");
    await until(() => (reader()?.msg?.text ?? "").startsWith("no-page-yet"), "the stub, opened");
    expect((await board.resolvePage("no-page-yet")).status).toBe("resolved");
  }, 20_000);

  test("a hidden metadata line doesn't move the walk: PR#125 under a body's project: line is that project's, not the title's", async () => {
    n.hidden = await create(null, "Plans [project::floatty]\n[zone::x]\n\nproject:: garden-club\nthen PR#125 last.");
    await open(n.hidden.id, "then PR#125");
    click("PR#125 last");
    await until(() => shown() === n.cp.id, "the nearer project's PR");
  }, 20_000);

  test("two projects in one scope ask, never guess: the chooser opens the one picked, by mouse", async () => {
    await open(n.both.id, "PR#125");
    click("PR#125");
    await until(() => { try { at("more than one PR#125"); return true; } catch { return false; } }, "the chooser");
    expect(shown()).toBe(n.both.id);
    click("kettle fix");
    await until(() => shown() === n.cp.id, "the picked note");
  }, 20_000);

  test("the chooser by keys", async () => {
    await open(n.both.id, "PR#125");
    click("PR#125");
    await until(() => { try { at("more than one PR#125"); return true; } catch { return false; } }, "the chooser");
    key({ kind: "enter" } as Key);
    await until(() => shown() === n.fp.id, "the first note");
  }, 20_000);

  test("a project's missing PR offers to make it there, under the project", async () => {
    await open(n.none.id, "PR#404");
    click("PR#404 not");
    await until(() => /PR#404 under \[\[floatty\]\] doesn't exist yet/.test(message() ?? ""), "the offer");
    click("PR#404 not");
    await until(() => (reader()?.msg?.text ?? "").startsWith("PR#404"), "the note it made");
    expect(reader().msg.parentId).toBe(n.floatty.id);
  }, 20_000);

  test("the target lists it as a soft mention, in its own group", async () => {
    const backlinks = await board.request("references.backlinks", { query: { targetBlockId: n.thread.id, limit: 50 } });
    const view = backlinkView(backlinks, DEFAULT_BACKLINK_VIEW_OPTIONS);
    expect(view.groups.map(g => g.label)).toEqual(["Soft mentions"]);
    expect(view.groups[0]!.sources.map(s => s.blockId)).toContain(n.note.id);
    const ticket = backlinkView(await board.request("references.backlinks", { query: { targetBlockId: n.gate.id, limit: 50 } }), DEFAULT_BACKLINK_VIEW_OPTIONS);
    expect(ticket.groups.map(g => g.label)).toEqual(["Soft mentions"]);
  }, 20_000);
});
