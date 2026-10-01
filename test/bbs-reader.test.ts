// PIE-426: the BBS message reader hosts the shared note surface. Under its BBS header (Date, To, From,
// Subj, Conf, Stat) the message reads as every reader reads a note: `[ ]` and a click step to and open its
// links (the target opens as the next reader on the screen stack), `i` opens the property panel, folds,
// comments (`m`, and a comment mark's thread inline), `e` edits, a drag or `v` selects and `y` copies, and
// an agent drives it through `act`. The BBS keys still work: n p ⏎ next and previous, t thread, U up, q back.
// Fictional notes, against a throwaway outliner service only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { subject } from "../src/board";
import { MainMenu, MessageList, MessageReader } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { RULER_BG } from "../src/surface/selection";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe("a host's own header over the surface, without a service", () => {
  const ID = "11111111-2222-4333-8444-555555555555", TARGET = "99999999-2222-4333-8444-555555555555";
  const note = { id: ID, text: `Seed swap [related::((${TARGET}))]\nSaturday by the compost bays.`, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 2, props: { related: `((${TARGET}))` }, properties: [{ key: "related", value: `((${TARGET}))` }] };
  const opened: string[] = [];
  const host = (): SurfaceHost => ({
    ctx: { board: { ancestors: async () => [], comments: async () => [], get: async (id: string) => ({ ...note, id, text: "Compost bays", props: {}, properties: [] }) }, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any,
    redraw() {}, navigate: m => { opened.push(m.id); }, summaryKeys: () => ["related"],
    header: (m, w) => ["Date: today", "From: you", `Subj: ${subject(m)}`].map(l => l.padEnd(w)),
  });

  test("the summary line follows the host's rows: [ ] and a click find its link there, not on row 1", async () => {
    const s = new NoteSurface(), h = host();
    s.show(note as any, h);
    const lines = s.render(80, 20, h).lines.map(plain);
    expect(lines.slice(0, 3).map(l => l.trim())).toEqual(["Date: today", "From: you", "Subj: Seed swap"]);
    const row = lines.findIndex(l => l.startsWith("related"));
    expect(row).toBe(3);
    s.key(char("]"), h);
    expect(s.describeElements()[0]).toMatchObject({ kind: "link", current: true });
    expect((s as any).elems[0].row).toBe(row);
    s.key({ kind: "esc" }, h);
    const x = lines[row]!.indexOf("((") >= 0 ? lines[row]!.indexOf("((") : lines[row]!.indexOf(" ") + 1;
    expect(s.click(x, row, h)).toBe(true);
    await until(() => opened.includes(TARGET), "the summary value's note");
  });
});

describe.skipIf(!outliner)("the BBS message reader on the note surface, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  let key: (k: Key) => void = () => {};
  const written: string[] = [];
  const n: Record<string, any> = {};
  const AS = "test-agent-426";
  const create = async (parentId: string | null, text: string) => (await board.get((await board.request<any>("create", { parentId, text, author: "agent" })).id))!;
  const top = () => (app as any).stack.at(-1);
  const stack = () => (app as any).stack.length as number;
  const frame = () => top().render(app).lines as string[];
  const text = () => frame().map(plain).join("\n");
  const shows = (s: string) => until(() => text().includes(s), `"${s}" on screen:\n${text()}`);
  const current = (r: MessageReader) => r.surface.describe().elements?.current ?? null;
  const at = (s: string) => {
    const lines = frame().map(plain);
    for (let y = 0; y < lines.length; y++) { const x = lines[y]!.indexOf(s); if (x >= 0) return { x, y }; }
    throw new Error(`"${s}" isn't drawn:\n${lines.join("\n")}`);
  };
  const mouse = (action: "down" | "up" | "drag", x: number, y: number) => key({ kind: "mouse", action, button: 0, x, y });

  /** A reader on the list [first, second], on message `i`, with the whole note drawn and its comments read. */
  const open = async (i = 0) => {
    while (stack() > 1) app.pop();
    const r = new MessageReader([n.first, n.second], i);
    app.push(r);
    await until(() => !!r.surface.msg && !r.surface.msg.partial && r.surface.comments !== null, "the whole message and its comments");
    await shows(i === 0 ? "Bring the kettle" : "Seed swap");
    return r;
  };
  const stepTo = (r: MessageReader, label: string) => {
    for (let i = 0; i < 20; i++) { key(char("]")); frame(); if (current(r)?.label.startsWith(label)) return; }
    throw new Error(`[ ] never reached ${label}: ${r.surface.describeElements().map(e => e.label).join(" | ")}`);
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    n.conf = await create(null, "Allotment society");
    n.kettle = await create(null, "Descale the kettle\nVinegar, then rinse twice.");
    n.first = await create(n.conf.id, `Committee meeting [to::the plot committee] [season::autumn]\nBring ((${n.kettle.id}|the kettle)) to the hut.\n\n## Agenda\n- the water butts\n  - who empties them\n\n## Notes\nThe gate code changed.`);
    n.second = await create(n.conf.id, "Seed swap\nSaturday by the compost bays.");
    n.reply = await create(n.first.id, "Re: Committee meeting\nI'll bring biscuits.");
    const quote = "The gate code changed.";
    await board.comment(`seed-${crypto.randomUUID()}`, n.first.id, n.first.revision, "Ask the warden for it.", { quote, start: n.first.text.indexOf(quote) });
    const term = { info: { cols: 110, rows: 40, cellW: 9, cellH: 16, kitty: false }, write(s: string) { written.push(s); }, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("the BBS header stands in for the surface's title rows: To from to::, From, Subj once, Conf, Stat with properties and comments", async () => {
    await open();
    await shows("Conf: Allotment society");
    await shows("Reply: 1");
    const t = text();
    expect(t).toMatch(/To: the plot committee\s+Refer#: /);
    expect(t).toContain("From: agent");
    expect(t).toContain("Number: ");
    expect(t).toContain("(1 of 2)");
    expect(t).toMatch(/Stat: PUBLIC MESSAGE · i \d+ propert(y|ies) · ■ 1 open comment \(m\)/);
    // The subject is drawn once (the header's Subj), not again as the surface's own title row.
    expect(t.split("Committee meeting").length - 1).toBe(1);
    expect(t).toContain("Bring the kettle to the hut.");
    expect(t).not.toContain("[season::autumn]");
    expect(t).toContain("n next · p prev · t thread");
  }, 20_000);

  test("links: [ ] steps to one (the ruler under its block), ⏎ opens it as the next reader, q comes back", async () => {
    const r = await open();
    stepTo(r, "the kettle");
    expect(frame().some(l => l.includes(RULER_BG) && plain(l).includes("Bring the kettle"))).toBe(true);
    expect(text()).toContain("link the kettle · ⏎ follow");
    key({ kind: "enter" });
    await until(() => top() !== r && top() instanceof MessageReader, "the linked note in a new reader");
    await shows("Subj: Descale the kettle");
    key(char("q"));
    expect(top()).toBe(r);
    expect(r.surface.msg!.id).toBe(n.first.id);
  }, 20_000);

  test("links: a click on a link's cells opens it too", async () => {
    const r = await open();
    const p = at("the kettle");
    mouse("down", p.x + 1, p.y); mouse("up", p.x + 1, p.y);
    await until(() => top() !== r, "the clicked link's note");
    expect(top().surface.msg?.id).toBe(n.kettle.id);
  }, 20_000);

  test("the property panel: i opens it, and q is the panel's while it's open, not back", async () => {
    const r = await open();
    key(char("i"));
    expect(r.surface.describe().properties?.open).toBe("inline");
    expect(text()).toContain("season");
    key(char("q"));
    expect(top()).toBe(r);
    key({ kind: "esc" });
    expect(r.surface.panel).toBeNull();
  }, 20_000);

  test("folds: ( picks a heading, f folds it, F unfolds everything", async () => {
    const r = await open();
    key(char(")"));
    key(char("f"));
    expect(r.surface.describe().folds!.folded).toEqual(["## Agenda"]);
    expect(text()).not.toContain("the water butts");
    key(char("F"));
    expect(r.surface.describe().folds!.folded).toEqual([]);
    expect(text()).toContain("the water butts");
  }, 20_000);

  test("comments: a comment mark's thread expands inline with ⏎, and m opens the thread list", async () => {
    const r = await open();
    stepTo(r, "\"The gate code");
    expect(current(r)?.kind).toBe("comment");
    key({ kind: "enter" });
    await shows("Ask the warden for it.");
    expect(r.surface.expanded.size).toBe(1);
    key({ kind: "esc" });
    key(char("m"));
    await until(() => r.surface.session?.mode === "threads", "the thread list");
    key({ kind: "esc" });
    await until(() => r.surface.session === null, "the thread list closed");
    expect(top()).toBe(r);
  }, 20_000);

  test("selection: a drag selects without copying, y copies with OSC 52", async () => {
    const r = await open();
    const p = at("The gate code changed.");
    written.length = 0;
    mouse("down", p.x, p.y); mouse("drag", p.x + 8, p.y); mouse("up", p.x + 8, p.y);
    expect(r.surface.selection).not.toBeNull();
    expect(written.join("")).not.toContain("\x1b]52;");
    key(char("y"));
    expect(written.join("")).toContain(`\x1b]52;c;${Buffer.from("The gate", "utf8").toString("base64")}`);
    key({ kind: "esc" });
    expect(r.surface.selection).toBeNull();
    expect(top()).toBe(r);
  }, 20_000);

  test("editing: e opens the edit control, typed q and n are text, ctrl+s saves to the outline", async () => {
    const r = await open(1);
    key(char("e"));
    await until(() => r.surface.draft !== null, "the draft");
    key({ kind: "end" });
    for (const c of " quinces") key(char(c));
    expect(top()).toBe(r);
    key({ kind: "char", ch: "s", ctrl: true });
    await until(() => r.surface.draft === null, "the save");
    expect((await board.get(n.second.id))!.text).toContain("quinces");
    n.second = await board.get(n.second.id);
  }, 20_000);

  test("the BBS keys: n and ⏎ next, p previous, t the thread, U up, esc back", async () => {
    const r = await open();
    key(char("n"));
    await until(() => r.surface.msg?.id === n.second.id, "the next message");
    expect(text()).toContain("(2 of 2)");
    key(char("n"));
    expect(r.surface.msg?.id).toBe(n.second.id);           // the end: it stays
    key(char("p"));
    await until(() => r.surface.msg?.id === n.first.id, "the previous message");
    key({ kind: "enter" });                                 // no element current: ⏎ is next, as it was
    await until(() => r.surface.msg?.id === n.second.id, "⏎ next");
    key({ kind: "left" });
    await until(() => r.surface.msg?.id === n.first.id, "← previous");
    key(char("t"));
    await until(() => top() instanceof MessageList, "the thread list");
    await shows("Re: Committee meeting");
    key(char("q"));
    expect(top()).toBe(r);
    key(char("U"));
    await until(() => top() !== r, "the conference above");
    expect(top().surface.msg?.id).toBe(n.conf.id);
    key({ kind: "esc" });
    expect(top()).toBe(r);
    key({ kind: "esc" });
    expect(top()).toBeInstanceOf(MainMenu);
  }, 20_000);

  test("agents: actions lists the note's actions and the reader's; act folds, selects and moves on, attributed", async () => {
    const r = await open();
    const listed = app.actions() as { actions: { name: string }[]; readers: string[] };
    expect(listed.readers).toEqual(["message"]);
    const names = listed.actions.map(a => a.name);
    for (const a of ["message.next", "message.previous", "message.thread", "fold", "select", "link.follow", "edit", "props"]) expect(names).toContain(a);
    const folded = await app.act({ action: "fold", args: { all: true }, as: AS }) as any;
    expect(folded.reader).toBe("message");
    expect(r.surface.describe().folds!.folded.length).toBeGreaterThan(0);
    expect(r.surface.agent?.id).toBe(AS);
    await app.act({ action: "unfold", args: { all: true }, as: AS });
    const sel = await app.act({ action: "select", args: { text: "The gate code" }, as: AS }) as any;
    expect(sel.chars).toBe(13);
    expect(r.surface.selection).toBeNull();                 // the agent's own, never the person's
    expect(r.surface.agentSelection?.id).toBe(AS);
    await expect(app.act({ action: "fold", reader: "2", as: AS })).rejects.toThrow(/one reader, "message"/);
    const moved = await app.act({ action: "message.next", as: AS }) as any;
    expect(moved).toMatchObject({ index: 2, of: 2, id: n.second.id });
    expect(text()).toContain(`an agent (${AS})`);
  }, 20_000);

  test("agents: an agent's link never opens over the person's open panel; open <id> is refused there too", async () => {
    const r = await open();
    key(char("i"));
    const depth = stack();
    await app.act({ action: "link.follow", args: { n: 1 }, as: AS }).catch(() => {});
    expect(stack()).toBe(depth);
    await expect(app.openBlock(n.kettle.id)).rejects.toThrow(/property panel/);
    key({ kind: "esc" });
    // A message reader's open pushes a screen: like any agent's screen change, it waits until the person is idle.
    await expect(app.openBlock(n.kettle.id)).rejects.toThrow(/at the keys/);
    (app as any).lastInput = 0;
    await app.openBlock(n.kettle.id);
    expect(top()).toBeInstanceOf(MessageReader);
    expect(top().surface.msg.id).toBe(n.kettle.id);
  }, 20_000);

  test("the lists open the shared reader: a message list's ⏎ lands in the message reader", async () => {
    while (stack() > 1) app.pop();
    const list = new MessageList("conference", () => board.children(n.conf.id), "", false);
    app.push(list);
    await shows("Committee meeting");
    key({ kind: "enter" });
    expect(top()).toBeInstanceOf(MessageReader);
    await until(() => !!top().surface.msg, "the message in the surface");
  }, 20_000);
});
