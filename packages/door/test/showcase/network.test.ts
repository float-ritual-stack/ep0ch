// PIE-439: the showcase screen, echonet, modes, files, links and resource comments. One of the showcase's test files (split from the one file, so a
// section's test is a file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../../src/app";
import { RECENT_FILES, SEED, type Seeded } from "../../src/showcase/seed";
import { SECTIONS, Showcase } from "../../src/showcase/showcase";
import { SocketBoard } from "../../src/socket";
import { subject } from "../../src/board";
import { C, fg } from "../../src/style";
import { outliner, Scratch, until } from "../scratch";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};


const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";
import { prop } from "../../src/props";

describe.skipIf(!outliner)("the showcase screen: echonet, modes, files, links and resource comments", () => {
  const h = useShowcaseScreen();
  const { scratch, written, press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });


  test("the echonet section: an agent reads the mini network through act; the person's read marks stay theirs", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "echonet" }, as: "test-agent" })).toMatchObject({ key: "echonet" });
    const desk = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "echonet")).top; };
    await until(() => (desk().describe().areas?.length ?? 0) === 2 && desk().describe().areas.every((a: any) => a.messages !== null), "both areas counted", 8000);
    // Plot chat: the view's two posts and the note posted to it by its tag; Seed swap: the society's board, two more waiting.
    expect(desk().describe().areas.map((a: any) => [a.tag, a.kind, a.from, a.messages, a.new, a.waiting])).toEqual([["plot.chat", "local", expect.stringMatching(/@/), 3, 3, undefined], ["seed.swap", "sub", "society@box-a", 3, 3, 2]]);
    expect(await app.act({ action: "echo.area", args: { tag: "SEED.SWAP" }, as: "test-agent" })).toMatchObject({ n: 2, messages: 3, new: 3 });
    await until(() => desk().describe().list?.messages?.length === 3, "Seed swap's copies listed", 5000);
    (app as any).lastInput = 0;
    expect(await app.act({ action: "echo.message", args: { n: 2, read: true }, as: "test-agent" })).toMatchObject({ n: 2, of: 3, subject: "Tomato seed, saved last year", read: true });
    await until(() => screen().includes("a newer version is upstream") && /SEEN-BY: society@box-a \S+@/.test(screen()), "the copy, upstream newer, its SEEN-BY", 8000);
    expect(screen()).toContain(" * Origin: society@box-a (Seed swap)");
    expect(screen()).toContain("take it: ext.echonet.take-newer");
    (app as any).lastInput = 0;
    expect(await app.act({ action: "echo.step", args: { by: 1 }, as: "test-agent" })).toMatchObject({ n: 3, subject: "Swap table on Saturday" });
    await until(() => screen().includes("gone upstream since 2026-03-04"), "the copy whose original is gone", 8000);
    // Plot chat starts here: its posts' SEEN-BY names the nodes whose seen-by marks are on them.
    (app as any).lastInput = 0;
    await app.act({ action: "echo.area", args: { tag: "plot.chat" }, as: "test-agent" });
    await until(() => desk().describe().list?.area?.tag === "plot.chat" && desk().describe().list?.messages?.length === 3, "Plot chat's posts", 5000);
    (app as any).lastInput = 0;
    expect(await app.act({ action: "echo.message", args: { n: 1, read: true }, as: "test-agent" })).toMatchObject({ subject: "Hosepipe ban from Monday" });
    await until(() => /SEEN-BY: \S+@\S+ attic@box-c society@box-a/.test(screen()), "the post's SEEN-BY from its marks", 8000);
    expect(screen()).toContain("From : ana @ ");
    // The agent read them: the person hasn't, so the copies stay new for them.
    const society = (await board.queryNotes(`parent:((${seeded.notes.echoSub.id})) echo-source`)).notes[0]!;
    expect((await board.queryNotes(`parent:((${society.id})) from unread:me`)).notes).toHaveLength(3);
    const agentUnread = async () => (await board.queryNotes(`parent:((${society.id})) from unread:test-agent`)).notes.map(m => subject(m));
    for (let i = 0; i < 100 && (await agentUnread()).length !== 1; i++) await Bun.sleep(25);
    expect(await agentUnread()).toEqual(["Runner beans to swap"]);
  }, 20_000);


  test("the actions section's registry list: the wheel and keys pick through registry.pick; an agent's pick leaves the person's selection", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "actions" }, as: "test-agent" })).toMatchObject({ key: "actions" });
    const list = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "actions")).top.pane("registry"); };
    await until(() => !!list(), "the registry list", 5000);
    const before = list().picked;
    const r = await app.act({ action: "registry.pick", args: { n: 3 }, as: "test-agent" }) as any;
    expect(r).toMatchObject({ name: "registry", n: 3, ran: false });
    expect(typeof r.action).toBe("string");
    expect(list().picked).toBe(before);
    // The person's wheel over the list moves their selection, through the same action.
    const at = S().stageRect, t = (S().stage(SECTIONS.findIndex(s => s.key === "actions")).top.describe().panes as any[]).find(x => x.name === "registry");
    press({ kind: "mouse", action: "wheel-down", button: 0, x: at.col + t.rect.col + 3, y: at.row + t.rect.row + 3 });
    await until(() => list().picked === before + 1, "the wheel's pick", 3000);
    // Under the list, the picked action's page (PIE-1032): its name and lead, its keys as keycaps when it has some.
    const shown = list().pick(list().picked, false);
    await until(() => screen().includes(`${shown.name} · `), "the picked action's page under the list", 3000);
    if (shown.keys) expect(screen()).toMatch(/\[[^\]\s]+\]/);
    expect(S().focus).toBe("index");
  }, 20_000);


  test("tile.preview, driven by an agent: the reader's opens land in a detail opened beside it, the reader keeps its note", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "preview" }, as: "test-agent" })).toMatchObject({ key: "preview" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "preview")).top; };
    await until(() => stage().layoutGet().tiles.find((t: any) => t.name === "reader")?.showing?.id === seeded.notes.notebook.id, "the notebook in the reader", 5000);
    const r = await app.act({ action: "tile.preview", tile: "reader", as: "test-agent" }) as any;
    expect(r).toMatchObject({ name: "reader-preview", kind: "reader", from: stage().layoutGet().tiles.find((t: any) => t.name === "reader").tile, fromName: "reader" });
    const tiles = () => stage().layoutGet().tiles as any[];
    expect(tiles().find(t => t.name === "reader").link).toBe("reader-preview");
    // A link followed in the reader lands in the preview; the reader still shows the notebook.
    const f = await app.act({ action: "link.follow", tile: "reader", args: { n: 1 }, as: "test-agent" }) as any;
    expect(f.opened).toBeTruthy();
    await until(() => tiles().find(t => t.name === "reader-preview")?.showing?.id === f.opened, "the link in the preview", 5000);
    expect(tiles().find(t => t.name === "reader").showing.id).toBe(seeded.notes.notebook.id);
    // Again: that preview, not a second one.
    expect(await app.act({ action: "tile.preview", tile: "reader", as: "test-agent" })).toMatchObject({ name: "reader-preview", existing: true });
    expect(tiles().filter(t => t.name.startsWith("reader-preview")).length).toBe(1);
    expect(S().focus).toBe("index");
  }, 20_000);


  test("reader pins (PIE-1207): the tree is wired to its reader; pinned, the reader keeps its note, an open lands beside it and the hint row says where; an agent pins by reader.pin, attributed, never taking the person's keys", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "reader-pins" }, as: "test-agent" })).toMatchObject({ key: "reader-pins" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "reader-pins")).top; };
    const tiles = () => stage().layoutGet().tiles as any[];
    const tile = (name: string) => tiles().find(t => t.name === name);
    await until(() => tile("now")?.showing?.id === seeded.notes.notebook.id && tile("detail")?.showing?.id === seeded.notes.shed.id && !!tile("reader")?.showing, "the readers on their notes", 5000);
    expect(tile("now")).toMatchObject({ kind: "reader", pinned: true, page: prop(seeded.notes.notebook, "page") });
    expect(tile("detail")).toMatchObject({ kind: "reader", pinned: true });
    expect(tile("reader").pinned).toBeUndefined();
    expect(tile("tree").wires).toContainEqual({ verb: "select", to: tile("reader").tile });
    // The tree's pick shows in the reader alone: no hidden current note moves the pinned ones.
    await until(() => (tile("tree")?.rows?.length ?? 0) > 1 || ((stage().pane("tree") as any)?.list().length ?? 0) > 1, "the tree's rows", 5000);
    await app.act({ action: "tree.pick", tile: "tree", args: { n: 2 }, as: "test-agent" });
    await Bun.sleep(200);                                        // the tree's pick settles (its 90ms read)
    expect(tile("detail").showing.id).toBe(seeded.notes.shed.id);
    expect(tile("now").showing.id).toBe(seeded.notes.notebook.id);
    // An agent pins the reader: said with its name; the person's keys stay where they were.
    expect(await app.act({ action: "reader.pin", tile: "reader", args: { on: true }, as: "test-agent" })).toMatchObject({ name: "reader", pinned: true });
    expect((app as any).message).toContain("test-agent");
    const kept = tile("reader").showing.id, before = tiles().length;
    // The tree's ⏎ aimed at the pinned reader: a new reader beside it takes the note, said once; the hint row names it.
    const opened = await app.act({ action: "open", args: { id: seeded.notes.whiteboard.id, from: "tree" }, as: "test-agent" }) as any;
    expect(tiles().length).toBe(before + 1);
    expect(opened.name).not.toBe("reader");
    expect(tile("reader").showing.id).toBe(kept);
    const reader = [...stage().panes.entries()].find(([id]: any) => stage().nameOf(id) === "reader")![1] as any;
    screen();
    expect(reader.hint()).toContain(`pinned: opens land in ${opened.name}`);
    expect(reader.headControls(40, stage())[0].text).toBe("▣ pinned");
    // Let go: the next ⏎ lands in it again.
    await app.act({ action: "reader.pin", tile: "reader", args: { on: false }, as: "test-agent" });
    await app.act({ action: "open", args: { id: seeded.notes.whiteboard.id, from: "tree" }, as: "test-agent" });
    expect(tile("reader").showing.id).toBe(seeded.notes.whiteboard.id);
    await app.act({ action: "tile.close", tile: opened.name, as: "test-agent" }).catch(() => null);
    expect(S().focus).toBe("index");
  }, 20_000);


  test("a session's files (PIE-602): an agent's open file= lands the Markdown file drawn as the preview draws it, any other through the file Resource reader, diff=true its changes", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "preview" }, as: "test-agent" })).toMatchObject({ key: "preview" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "preview")).top; };
    const showing = () => (stage().layoutGet().tiles as any[]).map(t => t.showing?.id).filter(Boolean) as string[];
    const [md, txt] = RECENT_FILES();
    const opened = await app.act({ action: "open", args: { file: md!.file }, as: "test-agent" }) as any;
    expect(opened.id).toBe(`file:${md!.file}`);
    await until(() => showing().includes(`file:${md!.file}`), "the bed plan where opens land", 5000);
    await until(() => screen().includes("Net the brassicas before the pigeons find them."), "the Markdown drawn", 5000);
    const other = await app.act({ action: "open", args: { file: txt!.file }, as: "test-agent" }) as any;
    expect(other.id).toStartWith("resource:");
    await until(() => screen().includes("Scarlet Emperor"), "the seed list through the Resource reader", 8000);
    const diff = await app.act({ action: "open", args: { file: md!.file, diff: true }, as: "test-agent" }) as any;
    expect(diff.id).toBe(`file-diff:${md!.file}`);
    await expect(app.act({ action: "open", args: { file: "beds/plan.md" }, as: "test-agent" })).rejects.toThrow(/absolute path/);
    await expect(app.act({ action: "open", args: {}, as: "test-agent" })).rejects.toThrow(/id=<block id> or file=/);
    expect(S().focus).toBe("index");
  }, 20_000);


  test("links (PIE-541): a labelled ref inside italics is drawn in its link colour, italic, with every escape whole; an agent follows it", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "entity" }, as: "test-agent" })).toMatchObject({ key: "entity" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "entity")).top; };
    const tiles = () => stage().layoutGet().tiles as any[];
    await until(() => tiles().find(t => t.name === "reader")?.showing?.id === seeded.notes.shed.id, "the shed in the reader", 5000);
    await until(() => screen().includes("The pump's spare valves are on the kitchen whiteboard."), "the italic line drawn", 5000);
    const raw = sc.render(app).lines;
    expect(raw.join("\n").match(/(?<!\x1b)\[[\d;]*m/g)).toBeNull();
    const row = raw.find(l => plain(l).includes("The pump's spare valves"))!;
    const at = row.indexOf("the kitchen whiteboard");
    expect(row.slice(0, at)).toContain("\x1b[3m");
    // (The reader here is joined to the tree, PIE-886: its ground's escape may come after the colour's.)
    expect(row.slice(0, at).match(/\x1b\[38;[\d;]*m/g)!.at(-1)).toBe(fg(C.lcyan));
    // The note's first link is the one in italics.
    expect(JSON.stringify(await app.act({ action: "link.select", tile: "reader", args: { n: 1 }, as: "test-agent" }))).toContain("the kitchen whiteboard");
    const f = await app.act({ action: "link.follow", tile: "reader", args: { n: 1 }, as: "test-agent" }) as any;
    expect(f.opened).toBe(seeded.notes.whiteboard.id);
    // A link in a property's value is a backlink too (PIE-874), labelled by the property: the swap meets at the shed.
    const swap = (await board.backlinks(seeded.notes.shed.id)).sources.find(s => s.blockId === seeded.notes.swap.id);
    expect(swap?.referenceGroups).toEqual([{ kind: "property", propertyKey: "meets-at", count: 1 }]);
    expect(S().focus).toBe("index");
  }, 20_000);


  test("resource comments (PIE-650): a Resource's text takes a comment from an agent's act, quoting the file's source, the file untouched; its seeded thread is placed in the text and is a backlink of the block whose link opened it", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "resource-comments" }, as: "test-agent" })).toMatchObject({ key: "resource-comments" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "resource-comments")).top; };
    const tiles = () => stage().layoutGet().tiles as any[];
    const resTile = () => tiles().find(t => String(t.showing?.id ?? "").startsWith("resource:"));
    await until(() => !!resTile() && screen().includes("Net the brassicas before the pigeons find them."), "the bed plan as a Resource", 8000);
    const tile = resTile().name as string;
    const plan = RECENT_FILES()[0]!;
    const before = readFileSync(plan.file, "utf8");
    // The seeded thread is read for the Resource and placed in its text (the note has a header before the file's own text).
    await until(() => /1(?: comments?)? · short cards \(M\)/.test(screen()), "the seeded thread counted", 8000);
    const threads = await app.act({ action: "threads", tile, as: "test-agent" }) as any;
    expect(threads.threads).toHaveLength(1);
    // An agent comments on a passage of the rendered Markdown: the quote is the source's own (`**Bed 2:**` keeps its asterisks).
    const quote = "**Bed 2:** runner beans up the wigwam";
    const sent = await app.act({ action: "comment", tile, args: { quote, body: "Is the wigwam tall enough this year?" }, as: "test-agent" }) as any;
    expect(sent).toBeDefined();
    const after = await app.act({ action: "threads", tile, as: "test-agent" }) as any;
    expect(after.threads).toHaveLength(2);
    expect(after.threads.some((t: any) => t.quote === quote)).toBe(true);
    // Stored in the outline against the Resource, with the block that opened it as its reference context; never in the file.
    const touch = (await board.byProp("file", plan.file, 1, "show"))[0]!;
    const resourceId = String(resTile().showing.id).slice("resource:".length);
    const stored = await board.request<any[]>("annotations.list", { query: { subject: { kind: "resource", resourceId }, includeResolved: true } });
    expect(stored).toHaveLength(2);
    expect(stored.every(t => t.originalTarget.referenceContext?.representation.subject.blockId === touch.id)).toBe(true);
    expect(stored.find(t => t.originalTarget.anchor.exact === quote)).toBeDefined();
    expect(readFileSync(plan.file, "utf8")).toBe(before);
    // A ticket-like or unreadable Resource says why instead (the reader's refusal), and a note that is not a block still can't be edited.
    await expect(app.act({ action: "edit", tile, as: "test-agent" })).rejects.toThrow();
    expect(S().focus).toBe("index");
  }, 30_000);
});
