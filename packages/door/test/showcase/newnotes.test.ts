// PIE-439: the showcase screen, new notes. One of the showcase's test files (split from the one file, so a
// section's test is a file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../../src/app";
import { type Seeded } from "../../src/showcase/seed";
import { SECTIONS, Showcase } from "../../src/showcase/showcase";
import { SocketBoard } from "../../src/socket";
import { outliner, Scratch, until } from "../scratch";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};


const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

import { useShowcaseScreen } from "./harness";
import { prop } from "../../src/props";

describe.skipIf(!outliner)("the showcase screen: new notes", () => {
  const h = useShowcaseScreen();
  const { scratch, written, press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });


  test("new notes (PIE-544): ctrl+n under the note read, a missing [[page]] offered then made, [page::x] titled; by keys, mouse and act", async () => {
    const guide = seeded.notes.newNotes.id;
    // Out of the stage the test before left the keys in: an agent changes sections only from the index.
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    const inbox = (await board.roots()).find(r => prop(r, "system-view") === "inbox")!.id;
    const reads = async (ok: () => Promise<boolean>, what: string) => { const end = Date.now() + 5000; while (!await ok()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(30); } };
    (app as any).lastInput = 0;
    const n = SECTIONS.findIndex(s => s.key === "newnotes") + 1;
    expect(await app.act({ action: "section", args: { name: "newnotes" }, as: "test-agent" })).toEqual({ section: n, key: "newnotes" });
    await until(() => screen().includes("Seed swap ledger ◌"), "the guide, its link missing", 8000);
    const stage = () => S().stages.get(n - 1).top as any;
    const reader = () => [...stage().panes.values()].find((p: any) => p.kind === "reader") as any;
    // The person, by keys: into the stage, ] to the link, ⏎ offers the page (nothing made yet), ⏎ again makes it.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    reader().surface.selectLink(0);
    press({ kind: "enter" });
    await until(() => screen().includes("no page [[Seed swap ledger]]"), "the offer under the header");
    expect((await board.resolvePage("Seed swap ledger")).status).toBe("missing");
    // By mouse: a click on the link again makes it.
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => l.includes("Seed swap ledger ◌")), x = rows[y]!.indexOf("Seed swap ledger") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    await reads(async () => (await board.resolvePage("Seed swap ledger")).status === "resolved", "the page made");
    const page = (await board.resolvePage("Seed swap ledger")).block!;
    expect(await board.get(page.id)).toMatchObject({ text: "Seed swap ledger [page::Seed swap ledger]", parentId: inbox });
    await until(() => reader().msg?.id === page.id, "the page opened in the reader");
    // Back (alt+←), as the reader's history goes.
    press({ kind: "alt-left" });
    await until(() => reader().msg?.id === guide, "back on the guide");
    // A page link holding another (PIE-592): the next link, one link read without its inner brackets.
    reader().surface.selectLink(1);
    await until(() => screen().includes("link 2026-03-12 - seed swap notes ◌"), "the nested link selected whole, missing");
    // ctrl+n in the reader: a note under the guide, its edit open with the keys; ⏎ on [page::x] titles it, ctrl+s saves.
    press({ kind: "char", ch: "n", ctrl: true });
    // It opens in a detail beside the reader (as O opens one); this stage's reader follows what's current, so it shows it too.
    const writing = () => [...stage().panes.values()].find((p: any) => p.surface?.draft) as any;
    await until(() => !!writing(), "the new note's edit", 8000);
    const id = writing().surface.draft.blockId;
    expect((await board.get(id))!.parentId).toBe(guide);
    expect(writing()).not.toBe(reader());
    // It says where it lands (PIE-883); the person's note.move (a click on that row, in a door) asks in the power bar
    // where to move it; esc there and it stays.
    await until(() => /→ Kitchen sink › New notes from anywhere +\[move ▸\]/.test(screen()), "where it lands");
    expect(await stage().dispatch.press("note.move", {}, writing().surface.draft && stage().nameOf(stage().focus))).toMatchObject({ asking: "to" });
    const asking = () => (app as any).bar?.describe() as { scope: string; rows: { label: string }[] } | undefined;
    await until(() => asking()?.scope === "ask" && asking()!.rows[0]?.label === "New notes from anywhere", "the power bar asking where", 5000);
    press({ kind: "esc" });
    await until(() => asking()?.scope !== "ask", "the bar put away");
    expect((await board.get(id))!.parentId).toBe(guide);
    for (const c of "[page::2026-03-12]") press({ kind: "char", ch: c });
    press({ kind: "enter" });
    expect(writing().surface.draft.text).toBe("2026-03-12 [page::2026-03-12]\n");
    for (const c of "Swapped borlotti for chard.") press({ kind: "char", ch: c });
    press({ kind: "char", ch: "s", ctrl: true });
    await reads(async () => (await board.get(id))!.text === "2026-03-12 [page::2026-03-12]\nSwapped borlotti for chard.", "the new note saved");
    // The day the nested link holds lists the guide among its backlinks.
    expect((await board.backlinks(id)).sources.map(b => b.blockId)).toContain(guide);
    expect((await board.resolvePage("[[2026-03-12]] - seed swap notes")).status).toBe("missing");
    // An agent: note.new and page.create through act, attributed, the person's keys and reader untouched.
    const before = reader().msg?.id;
    const made = await app.act({ action: "note.new", args: { text: "[page::2026-03-13]" }, as: "test-agent" }) as any;
    expect(made).toMatchObject({ rule: "inbox", parentId: inbox, title: "2026-03-13" });
    expect(await board.get(made.id)).toMatchObject({ text: "2026-03-13 [page::2026-03-13]", author: "test-agent" });
    const pg = await app.act({ action: "page.create", args: { address: "Pea trellis" }, as: "test-agent" }) as any;
    expect(pg).toMatchObject({ created: true });
    expect(await board.get(pg.id)).toMatchObject({ text: "Pea trellis [page::Pea trellis]", parentId: inbox, author: "test-agent" });
    expect(reader().msg?.id).toBe(before);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);


  test("new notes float (PIE-591): five rapid ctrl+n make five floating drafts; one docked by its title's drag, one saved, one from an edit; × on an empty one trashes it", async () => {
    const guide = seeded.notes.newNotes.id;
    for (let i = 0; i < 8 && S().focus === "stage"; i++) press({ kind: "esc" });
    (app as any).lastInput = 0;
    const n = SECTIONS.findIndex(s => s.key === "newnotes") + 1;
    await app.act({ action: "section", args: { name: "newnotes" }, as: "test-agent" });
    const stage = () => S().stages.get(n - 1).top as any;
    const reader = () => [...stage().panes.values()].find((p: any) => p.kind === "reader") as any;
    await until(() => reader()?.msg?.id === guide, "the guide in the reader", 8000);
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // Floats left by the test before (its saved new note) aren't this test's.
    const old = new Set((stage().describe().floats as any[]).map(f => f.tile));
    const floats = () => (stage().describe().floats as any[]).filter(f => f.newNote && !old.has(f.tile));
    const before = (await board.children(guide)).length;
    // Five, as fast as the keys go: each a float of its own with its edit open, none waiting on the last.
    for (let i = 0; i < 5; i++) press({ kind: "char", ch: "n", ctrl: true });
    await until(() => floats().length === 5 && floats().every(f => f.writing), `five floating drafts, each in its edit (${JSON.stringify(stage().describe().floats)})`, 10_000);
    const kids = await board.children(guide);
    expect(kids.length).toBe(before + 5);
    // Siblings under the note read, never a chain of one under the next.
    for (const f of floats()) expect((await board.get(f.id))!.parentId).toBe(guide);
    // Cascaded, the newest on top with the keys, and the person in its edit.
    const rects = floats().map(f => f.rect);
    expect(new Set(rects.map(r => `${r.col},${r.row}`)).size).toBe(5);
    const top = floats().at(-1)!;
    expect(stage().describe().focusName).toBe(top.tile);
    await until(() => stage().newNoteWhileTyping(), "the person in the newest float's edit", 5000);
    // Saved: typed in the newest, ctrl+s.
    for (const c of "Chard seed: 2 rows") press({ kind: "char", ch: c });
    press({ kind: "char", ch: "s", ctrl: true });
    const saved = async (id: string, text: string) => { const end = Date.now() + 5000; while ((await board.get(id))?.text !== text) { if (Date.now() > end) throw new Error(`timed out waiting for ${text}`); await Bun.sleep(30); } };
    await saved(top.id, "Chard seed: 2 rows");
    // From an edit: into the fourth (its edit open: the keys going back to it are in it, PIE-812), typed, then ctrl+n:
    // a sixth floats, and the fourth stays open as it was until it's saved.
    const fourth = floats()[3]!;
    await stage().dispatch.press("tile.focus", {}, fourth.tile);
    await until(() => stage().newNoteWhileTyping() && stage().describe().focusName === fourth.tile, "in the fourth's edit", 5000);
    for (const c of "Leek trench") press({ kind: "char", ch: c });
    press({ kind: "char", ch: "n", ctrl: true });
    await until(() => floats().length === 6 && floats().at(-1)!.writing, "a sixth float from the edit", 8000);
    expect((await board.get(floats().at(-1)!.id))!.parentId).toBe(guide);
    expect(floats().find(f => f.id === fourth.id)?.writing).toBeTruthy();
    await stage().dispatch.press("edit.save", {}, fourth.tile);   // saved where it is, the keys staying on the sixth
    await saved(fourth.id, "Leek trench");
    // Docked by mouse: the first float's title dragged onto the reader's header joins its tabs.
    const first = floats()[0]!;
    const rows = () => sc.render(app).lines.map(plain);
    sc.render(app);
    const origin = S().stageRect, target = stage().describe().panes.find((p: any) => p.name === "reader").rect;
    const titleRow = origin.row + first.rect.row, fx = origin.col + first.rect.col + 7;
    const head = origin.row + target.row, hx = origin.col + target.col + 8;
    expect(titleRow).toBeGreaterThan(head);
    press({ kind: "mouse", action: "down", button: 0, x: fx, y: titleRow });
    press({ kind: "mouse", action: "drag", button: 32, x: hx, y: head + 1 });
    press({ kind: "mouse", action: "drag", button: 32, x: hx, y: head });
    expect(plain(sc.render(app).lines.join("\n"))).toContain("A header makes tabs");
    press({ kind: "mouse", action: "up", button: 0, x: hx, y: head });
    await until(() => !floats().some(f => f.id === first.id), "the first float docked", 5000);
    // A tab beside the reader now, in the layout: one tab set holding both.
    expect(((await stage().dispatch.press("layout.get")) as any).tree).toMatchObject({ tabs: ["reader", first.tile], active: first.tile });
    expect(stage().describe().focusName).toBe(first.tile);
    // × (tile.close) on an empty one: nothing typed, so it goes to the trash and its float with it.
    const empty = floats().find(f => f.id !== top.id && f.id !== fourth.id)!;
    await stage().dispatch.press("tile.close", {}, empty.tile);
    await until(() => !floats().some(f => f.id === empty.id), "the empty float closed", 5000);
    const end = Date.now() + 5000;
    while ((await board.children(guide)).some(k => k.id === empty.id)) { if (Date.now() > end) throw new Error("the empty note wasn't trashed"); await Bun.sleep(30); }
    // An agent's: made and shown floating for the person, attributed; their keys stay where they are.
    const keysOn = stage().describe().focusName;
    const made = await app.act({ action: "note.new", args: { text: "Bean poles: 12", opens: "float" }, as: "test-agent" }) as any;
    expect(made.tile).toBeTruthy();
    expect(stage().describe().focusName).toBe(keysOn);
    expect(await board.get(made.id)).toMatchObject({ author: "test-agent" });
    // Put the rest away, so the next test finds the stage as it was: each closed (saved, or trashed when empty).
    for (const f of [...floats(), ...(stage().describe().floats as any[]).filter(f => old.has(f.tile))]) await stage().dispatch.press("tile.close", {}, f.tile);
    await until(() => (stage().describe().floats as any[]).length === 0, "the floats put away", 8000);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);
});
