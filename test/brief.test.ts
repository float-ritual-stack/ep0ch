// PIE-435: the daily brief. Which note is the brief (newest by brief-date), `,` / `.` and act stepping days,
// the empty state, `--brief` and EP0CH_LANDING=brief, links opening beside the brief, the menu key, live
// figures whose `view: ((…))` sits in the YAML, and the daily-brief skill. Scratch services only; fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App, type Screen } from "../src/app";
import type { Msg } from "../src/board";
import { briefDate, findBriefs, orderBriefs, type BriefReader } from "../src/brief/brief";
import type { Desk } from "../src/desk/desk";
import { presentLinks } from "../src/refs";
import { Logon, MainMenu } from "../src/screens";
import { skillCommand, skillsIn } from "../src/skills";
import { SocketBoard } from "../src/socket";
import { landingOf, startScreens } from "../src/start";
import { DeliveryBoard } from "../src/desk/delivery";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const row = (id: string, date: string | null, updatedAt: number, createdAt = updatedAt): Msg =>
  ({ id, text: id, parentId: null, childIds: [], createdAt, updatedAt, author: null, props: date ? { type: "daily-brief", "brief-date": date } : { type: "daily-brief" } });

describe("which brief is which", () => {
  test("oldest first by brief-date, a redraft of the same day after the first; no brief-date: the day it was made", () => {
    const made = new Date(2026, 0, 6, 9).getTime();
    const list = [row("b", "2026-01-07", 1), row("a", "2026-01-05", 9), row("c-late", "2026-01-06", 8), row("c", "2026-01-06", 2), row("undated", null, made)];
    expect(orderBriefs(list).map(m => m.id)).toEqual(["a", "c", "c-late", "undated", "b"]);
    expect(briefDate(row("x", "2026-01-07 (a Wednesday)", 0))).toBe("2026-01-07");
    expect(briefDate(row("y", "someday", 0, made))).toBe("2026-01-06");
  });
});

describe("a live figure's YAML is left as typed", () => {
  test("view: ((id)) in a ::graph-* block keeps its id; links outside it are still drawn as links", () => {
    const id = "0b5c2a9e-1111-4222-8333-944455556666";
    const text = ["See ((" + id + "|the view)).", "::graph-stat", "---", "items:", `  - { label: a, view: ((${id})) }`, "---", "::", "::graph-check", "---", `view: ((${id}))`, "---", "::", "after ((" + id + "))"].join("\n");
    const out = presentLinks(text, true, null).split("\n");
    expect(out.length).toBe(text.split("\n").length);
    expect(out[4]).toBe(`  - { label: a, view: ((${id})) }`);
    expect(out[9]).toBe(`view: ((${id}))`);
    expect(out[0]).not.toContain(`((${id}`);
    expect(out[12]).not.toContain(`((${id}`);
  });
});

describe("where the door opens", () => {
  const logon = (then?: () => Screen) => ({ title: then ? `logon, then ${then().title}` : "logon" }) as Screen;
  test("--brief opens the newest brief over the main menu; the other flags as before", () => {
    const s = startScreens(["--brief"], {}, logon);
    expect(s.map(x => x.name ?? x.constructor)).toEqual([MainMenu, "brief"]);
    expect(startScreens(["--board", "--brief"], {}, logon)[1]).toBeInstanceOf(DeliveryBoard);
  });
  test("EP0CH_LANDING=brief lands on the brief after the logon; unset or anything else, the logon then the menu", () => {
    expect(startScreens([], { EP0CH_LANDING: "brief" }, logon).map(x => x.title)).toEqual(["logon, then daily brief"]);
    expect(startScreens([], {}, logon).map(x => x.title)).toEqual(["logon"]);
    expect(landingOf({ EP0CH_LANDING: " Brief " })).toBe("brief");
    expect(landingOf({ EP0CH_LANDING: "board" })).toBe("menu");
  });
});

describe("the daily-brief skill", () => {
  test("ships with the door, with frontmatter, and ep0ch --skill lists it and prints its path", () => {
    const skills = join(import.meta.dir, "../skills");
    const own = skillsIn([{ source: "ep0ch", dir: skills }]);
    const brief = own.find(s => s.name === "daily-brief");
    expect(brief?.description).toMatch(/^Use when/);
    const door = join(import.meta.dir, "..");
    expect(skillCommand(["--skill"], door, null).out).toMatch(/^daily-brief\s+ep0ch\s+Use when/m);
    expect(skillCommand(["--skill", "daily-brief"], door, null)).toEqual({ out: join(skills, "daily-brief/SKILL.md"), code: 0 });
  });
});

describe.skipIf(!outliner)("the brief screen", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  let key: (k: Key) => void = () => {};
  const press = (k: Key) => key(k);
  const ch = (c: string) => press({ kind: "char", ch: c });
  const top = () => (app as any).stack.at(-1) as Desk;
  /** The brief's reader: its briefs and the one it shows. */
  const brief = () => top().pane("brief") as BriefReader;
  const screen = () => top().render(app).lines.map(plain).join("\n");
  const notes = {} as Record<"root" | "view" | "kettle" | "a" | "b" | "c", Msg>;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 160, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("with no briefs it says so, and how to get one", async () => {
    app.push(new MainMenu());
    ch("T");
    expect(top().name).toBe("brief");
    await until(() => brief().briefs !== null, "the briefs asked for");
    expect(screen()).toContain("No daily brief yet.");
    expect(screen()).toContain("ep0ch --skill daily-brief");
    expect(screen()).toContain("daily brief · none yet");
    (app as any).lastInput = 0;                                                     // the person is idle
    await expect(app.act({ action: "brief.step", args: { by: -1 }, as: "test-agent" })).rejects.toThrow(/no briefs yet/);
    ch("q");
    expect((app as any).stack.at(-1)).toBeInstanceOf(MainMenu);
  });

  test("the newest brief by its day, not by when it was written; its live figures read views named by ((id))", async () => {
    const make = (parent: string | null, text: string) => board.createBlock(parent, text);
    notes.root = await make(null, "Pantry");
    for (const t of ["Jam jars", "Bread tins"]) await make(notes.root.id, `${t} [type::pantry-job] [stage::todo]`);
    notes.view = await make(notes.root.id, "Pantry jobs [type::virtual-branch] [query::type=pantry-job]");
    notes.kettle = await make(notes.root.id, "The kettle\nIt whistles now.");
    notes.b = await make(notes.root.id, [
      "Brief B [type::daily-brief] [brief-date::2026-01-07]", "",
      `> [!summary] First: the jam. See ((${notes.kettle.id}|the kettle)).`, "",
      "::graph-table", "---", "title: earlier", 'query: "type=daily-brief"', "columns: [brief-date, title]", "---", "::", "",
      "::graph-stat", "---", "title: pantry now", "items:", `  - { label: pantry jobs, view: ((${notes.view.id})) }`, "---", "::", "",
      "::graph-check", "---", "title: pantry list", `view: ((${notes.view.id}))`, "---", "::",
    ].join("\n"));
    notes.a = await make(notes.root.id, "Brief A [type::daily-brief] [brief-date::2026-01-05]\nThe first morning.");
    notes.c = await make(notes.root.id, "Brief C [type::daily-brief] [brief-date::2026-01-06]\nThe middle morning.");   // written last
    expect((await findBriefs(board)).map(m => m.id)).toEqual([notes.a.id, notes.c.id, notes.b.id]);
    ch("T");
    await until(() => brief().msg?.id === notes.b.id && !brief().msg?.partial, "brief B, read");
    await until(() => screen().includes("Jam jars") && screen().includes("Bread tins"), "the checklist over the saved view", 8000);
    const s = screen();
    expect(s).toContain("─ 1 daily brief · 2026-01-07 ─");
    expect(s).toMatch(/│Wed 2026-01-07 · 3 of 3 briefs · , earlier · \. later +│\n│Brief B +│/);
    expect(s).not.toContain("needs a ((block-ref))");
    expect(s).toMatch(/PANTRY NOW[^\n]*\n[^\n]*\n[^\n]*┊ 2 [^\n]*\n[^\n]*┊ pantry jobs/);
    expect(app.describe()).toMatchObject({ screen: "daily brief", state: { kind: "brief", brief: { date: "2026-01-07", n: 3, of: 3, id: notes.b.id }, briefs: 3 } });
  });

  test(", and . step a day at a time, and say where the briefs end", async () => {
    ch(",");
    await until(() => brief().msg?.id === notes.c.id, "brief C");
    expect(screen()).toContain("Tue 2026-01-06 · 2 of 3 briefs");
    ch(","); expect(brief().shown?.id).toBe(notes.a.id);
    ch(",");
    expect(brief().shown?.id).toBe(notes.a.id);
    expect((app as any).message).toContain("this is the oldest brief (2026-01-05)");
    ch("."); ch(".");
    expect(brief().shown?.id).toBe(notes.b.id);
    ch(".");
    expect((app as any).message).toContain("this is the newest brief (2026-01-07)");
  });

  test("agents step by act, said on screen; never while the person is typing in the brief", async () => {
    expect((app.actions() as any).actions.map((a: any) => a.name)).toEqual(expect.arrayContaining(["brief.step", "brief.newest", "brief.date", "link.follow", "pane.split"]));
    (app as any).lastInput = 0;                                                     // the person is idle
    expect(await app.act({ action: "brief.date", args: { date: "2026-01-05" }, as: "test-agent" })).toMatchObject({ id: notes.a.id, n: 1 });
    expect((app as any).message).toContain("an agent (test-agent) showed the brief for 2026-01-05");
    expect(await app.act({ action: "brief.step", args: { by: 1 }, as: "test-agent" })).toMatchObject({ id: notes.c.id });
    ch("e");
    await until(() => !!brief().draft, "the person's edit");
    await expect(app.act({ action: "brief.newest", as: "test-agent" })).rejects.toThrow(/the person is typing/);
    ch(".");                                                                        // typed into the edit, not a step
    expect(brief().shown?.id).toBe(notes.c.id);
    expect(brief().draft?.dirty).toBe(true);
    press({ kind: "esc" }); press({ kind: "esc" });                                 // closes it, discarding the stray full stop
    await until(() => !brief().draft, "the edit closed");
    (app as any).lastInput = 0;
    expect(await app.act({ action: "brief.newest", as: "test-agent" })).toMatchObject({ id: notes.b.id });
  });

  test("a link followed from the brief opens in a reader beside it; the brief and the person's keys stay", async () => {
    const r = brief();
    await until(() => !r.msg?.partial && screen().includes("Jam jars"), "brief B drawn again");
    for (let i = 0; i < 20 && r.surface.describe().elements?.current?.label !== "the kettle"; i++) ch("]");
    expect(r.surface.describe().elements?.current?.label).toBe("the kettle");
    press({ kind: "enter" });
    await until(() => top().readerPanes().some(p => p.pane !== r && p.pane.msg?.id === notes.kettle.id), "the kettle beside the brief");
    const d = app.describe() as any;
    expect(d.state.panes.map((p: any) => [p.kind, p.showing?.id, p.focused])).toEqual([["brief", notes.b.id, true], ["reader", notes.kettle.id, false]]);
    expect(screen()).toContain("It whistles now.");
    // The day keys still work with the reader beside, and it keeps the note it shows.
    ch(",");
    expect(brief().shown?.id).toBe(notes.c.id);
    expect(top().readerPanes()[1]!.pane.msg?.id).toBe(notes.kettle.id);
    ch(".");
    // From the reader beside too: the screen's key map (PIE-515), not only the brief tile's own keys.
    press({ kind: "tab" });
    expect((top().describe() as any).focusName).toBe("reader");
    ch(",");
    expect(brief().shown?.id).toBe(notes.c.id);
    ch(".");
    press({ kind: "tab" });
  });

  test("an agent's open of a brief steps to it (refused, and said, while the person types); any other note opens beside", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "open", args: { id: notes.a.id }, as: "test-agent" })).toMatchObject({ id: notes.a.id, reader: "brief" });
    expect(brief().shown?.id).toBe(notes.a.id);
    expect(await app.act({ action: "brief.show", args: { id: notes.b.id }, as: "test-agent" })).toMatchObject({ id: notes.b.id, tile: "brief" });
    ch("e");
    await until(() => !!brief().draft, "the person's edit");
    await expect(app.act({ action: "open", args: { id: notes.a.id }, as: "test-agent" })).rejects.toThrow(/the person is typing/);
    expect(brief().shown?.id).toBe(notes.b.id);
    press({ kind: "esc" });                                                         // nothing typed: one esc closes it
    await until(() => !brief().draft, "the edit closed");
    (app as any).lastInput = 0;
    const r = await app.act({ action: "open", args: { id: notes.kettle.id }, as: "test-agent" }) as { reader: string };
    expect(r.reader).not.toBe("brief");
    expect(brief().shown?.id).toBe(notes.b.id);
  });

  test("a row of the earlier-briefs table, clicked or opened, steps to that day instead of opening beside", async () => {
    const r = brief();
    const panes = () => top().readerPanes().length;
    const before = panes();
    await until(() => screen().includes("Brief A"), "the earlier-briefs table");
    const lines = r.render(150, 45, true, top()).lines.map(plain);
    const y = lines.findIndex(l => l.includes("Brief A")), x = lines[y]!.indexOf("Brief A") + 1;
    r.surface.press(x, y, r.host(top())); r.surface.release(x, y, r.host(top()));
    await until(() => brief().shown?.id === notes.a.id, "brief A, by a click on its row");
    expect(panes()).toBe(before);
    ch("."); ch(".");
    expect(brief().shown?.id).toBe(notes.b.id);
    await until(() => !r.msg?.partial && screen().includes("Brief A"), "brief B drawn again");
    (app as any).lastInput = 0;                                                     // the person is idle: an agent's open may step the brief
    const els = (await app.act({ action: "elements", reader: "1", as: "test-agent" }) as any).elements as { n: number; label: string }[];
    const row = els.find(e => e.label.includes("Brief C"))!;
    await app.act({ action: "element.open", reader: "1", args: { n: row.n }, as: "test-agent" });
    expect(brief().shown?.id).toBe(notes.c.id);
    expect(panes()).toBe(before);
    ch(".");
  });

  test("a new brief written elsewhere updates the count; the one being read stays", async () => {
    const d = await board.createBlock(notes.root.id, "Brief D [type::daily-brief] [brief-date::2026-01-08]\nThe next morning.");
    await until(() => brief().briefs?.length === 4, "the fourth brief counted", 5000);
    expect(brief().shown).toMatchObject({ id: notes.b.id, n: 3, of: 4 });
    ch(".");
    expect(brief().shown?.id).toBe(d.id);
  });

  test("EP0CH_LANDING=brief: the logon opens the main menu, then the brief over it", async () => {
    while ((app as any).stack.length) (app as any).stack.pop();
    const [first] = startScreens([], { EP0CH_LANDING: "brief" }, then => new Logon(app, then));
    app.push(first!);
    press({ kind: "enter" }); press({ kind: "enter" });                            // skip the dialling, then log on
    expect((app.describe() as any).stack).toEqual(["main menu", "daily brief"]);
  });
});
