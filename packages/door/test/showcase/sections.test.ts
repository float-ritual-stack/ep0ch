// PIE-439: the showcase screen, the sections: index, note, gallery, reading. One of the showcase's test files (split from the one file, so a
// section's test is a file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../../src/app";
import type { Desk } from "../../src/desk/desk";
import { SHOWCASE_ASSETS, SEED, type Seeded } from "../../src/showcase/seed";
import { SECTIONS, Showcase } from "../../src/showcase/showcase";
import { SocketBoard } from "../../src/socket";
import type { ReaderPane } from "../../src/desk/panes";
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

describe.skipIf(!outliner)("the showcase screen: the sections: index, note, gallery, reading", () => {
  const h = useShowcaseScreen();
  const { scratch, written, press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });


  test("the snapshot exhibit downloads the showcase through its power-bar action and queries SQLite", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "snapshot" }, as: "test-agent" });
    await until(() => screen().includes("A SQLite copy for analysis"), "snapshot exhibit");
    const { Publisher } = await import(`${outliner}/src/publish.ts`);
    const { OutlinerClient } = await import(`${outliner}/src/client.ts`);
    let publisher: InstanceType<typeof Publisher>;
    const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => publisher.handle(request, "public") });
    publisher = new Publisher({ client: new OutlinerClient(scratch.sock), publicUrl: `http://127.0.0.1:${http.port}` });
    await publisher.start();
    try {
      const snapshot = await app.act({ action: "outline.snapshot", as: "test-agent" }) as { url: string };
      const file = join(scratch.root, "showcase-copy.sqlite");
      const curl = Bun.spawn(["curl", "--fail", "--silent", snapshot.url, "--output", file], { stdout: "pipe", stderr: "pipe" });
      expect(await curl.exited).toBe(0);
      const sqlite = Bun.spawn(["sqlite3", "-readonly", file, "select text from blocks where text like 'A SQLite copy for analysis%';"], { stdout: "pipe", stderr: "pipe" });
      expect(await new Response(sqlite.stdout).text()).toContain("one-time snapshot link");
      expect(await sqlite.exited).toBe(0);
    } finally { http.stop(true); await publisher.stop(); }
  });


  test("front matter: the properties panel separates scopes and draws list chips", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "front-matter" }, as: "test-agent" });
    await until(() => screen().includes("Early sowing notes"), "front matter reader");
    press({ kind: "enter" });
    ch("I");
    await until(() => screen().includes("[ beans ]"), "list chips");
    await until(() => screen().includes("Inline and line properties"), "property scopes");
    const drawn = screen();
    expect(drawn).toContain("[ frost ]");
    expect(drawn).toContain("Block properties");
    expect(drawn).toContain("Inline and line properties");
    expect(drawn).not.toContain("A plan for the seed bed, #epic");
    press({ kind: "esc" });
    press({ kind: "esc" });
  });


  test("one section per reuse-map row, in the map's order, each labelled with its part and file, drawn by the part", async () => {
    expect(SECTIONS.map(s => s.key)).toEqual(Object.keys(marks));
    for (let i = 0; i < SECTIONS.length; i++) {
      if (i < 10) ch(i === 9 ? "0" : String(i + 1)); else ch("j");   // past ten: the next one down
      const s = SECTIONS[i]!;
      await until(() => marks[s.key]!.every(m => screen().includes(m)), `section ${s.key}: ${marks[s.key]!.filter(m => !screen().includes(m)).join(" | ")}`, 8000);
      const text = screen();
      expect(text).toContain(`${i + 1} · ${s.need} · ${s.part}`.slice(0, 120));
      expect(text).toContain(s.files.slice(0, 60));
      expect(S().focus).toBe("index");
    }
  }, 60_000);


  test("the note section shows one reader (PIE-426): the BBS message reader is the same surface, not a parallel version", async () => {
    ch("1");
    await until(() => marks.note!.every(m => screen().includes(m)), "the note section");
    const stage = screen();
    expect(stage).not.toContain("parallel version");
    expect(stage).not.toContain("BBS Reader");
    // The notebook's tags are written with its properties, which the reader hides, and they still show: one row of tags
    // under the byline, before the text (PIE-880).
    await until(() => /i \d+ properties · \[comment\]\s*█?│?[^\n]*\n[^\n]*\n[^\n]*│ +#allotment #beds +█/.test(screen()), "the tag row under the byline", 5000);
  });


  test("the note section keeps home paths and approximations literal, and strikes only double tildes (PIE-899)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "note" }, as: "test-agent" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "note")).top; };
    const reader = () => (stage().layoutGet().tiles as any[]).find(t => t.showing?.id === seeded.notes.notebook.id);
    await until(() => !!reader(), "the notebook in the reader", 5000);
    await app.act({ action: "scroll", args: { to: "top" }, tile: reader().name, as: "test-agent" });
    for (let n = 0; n < 12 && !screen().includes("copies of ~/.claude/~/projects/x at the same paths"); n++) {
      await app.act({ action: "scroll", args: { by: 4 }, tile: reader().name, as: "test-agent" });
    }
    expect(screen()).toContain("copies of ~/.claude/~/projects/x at the same paths");
    expect(screen()).toContain("~178 orphaned … ~ stays as written; only this is struck through.");
    expect(sc.render(app).lines.join("\n")).toContain("\x1b[9mthis");
  });


  test("the note section quotes the syntax (PIE-764): the reader's links skip what backticks and a fence hold; an agent following one by number reaches only real ones", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "note" }, as: "test-agent" })).toMatchObject({ key: "note" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "note")).top; };
    const reader = () => (stage().layoutGet().tiles as any[]).find(t => t.showing?.id === seeded.notes.notebook.id);
    await until(() => !!reader(), "the notebook in the reader", 5000);
    const links = (stage().pane(reader().name) as any).describe().links as { n: number; block?: string; page?: string; label?: string }[];
    expect(links.length).toBeGreaterThan(2);
    expect(links.filter(l => l.label === "at 08:17" || l.page === "Compost heap" || l.block === "transcript")).toEqual([]);
    expect(links.some(l => l.page === SEED.shed)).toBe(true);
    // The block-level tags drawn under the byline (PIE-880) are tag links like any other: ⏎ or a click lists the notes carrying one.
    const tagRow = async () => ((await app.act({ action: "elements", tile: reader().name, as: "test-agent" })) as any).elements.slice(0, 2).map((e: any) => e.label);
    for (let i = 0; i < 100 && (await tagRow()).join() !== "#allotment,#beds"; i++) { screen(); await Bun.sleep(50); }
    expect(await tagRow()).toEqual(["#allotment", "#beds"]);
    // Past the last real link there is none: the quoted ones aren't counted.
    await expect(app.act({ action: "link.follow", tile: reader().name, args: { n: links.length + 1 }, as: "test-agent" }))
      .rejects.toThrow(`the note has ${links.length}`);
    expect(S().focus).toBe("index");
  }, 20_000);


  test("the gallery section (PIE-827): an extension's cards draw their covers as a note's images are; [ ] stops on a cover's caption, by act and by keys", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "gallery" }, as: "test-agent" })).toMatchObject({ key: "gallery" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "gallery")).top; };
    const reader = () => (stage().layoutGet().tiles as any[]).find(t => t.showing?.id === seeded.notes.gallery.id);
    await until(() => !!reader() && marks.gallery!.every(m => screen().includes(m)), "the gallery's cards and picture", 15_000);
    const cover = join(SHOWCASE_ASSETS, "seed-packet.webp");
    const { elements } = await app.act({ action: "elements", tile: reader().name, as: "test-agent" }) as { elements: { n: number; kind: string; target?: string }[] };
    // Each cover's caption is a link to its file; each card's title opens its note.
    expect(elements.filter(e => e.target === cover)).toEqual([expect.objectContaining({ kind: "link" })]);
    expect(elements.some(e => e.target === join(SHOWCASE_ASSETS, "evening-beds.jpg"))).toBe(true);
    expect(elements.filter(e => e.kind === "row").length).toBeGreaterThanOrEqual(3);
    // The person's ] reaches it.
    press({ kind: "enter" });
    const current = () => (stage().pane(reader().name) as any).describe().elements?.current?.target;
    for (let i = 0; i < 30 && current() !== cover; i++) ch("]");
    expect(current()).toBe(cover);
    for (let i = 0; i < 4 && S().focus !== "index"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
    ch("1");   // the index back at its top, for the tests after
    // Nothing was written to draw them.
    expect((await board.get(seeded.notes.gallery.id))!.text).toBe(seeded.notes.gallery.text);
  }, 30_000);


  test("the machinery section (PIE-867): one query asked twice, the people's view leaves out what tools stamped, the other holds only that", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "machinery" }, as: "test-agent" })).toMatchObject({ key: "machinery" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "machinery")).top; };
    const reader = (id: string) => (stage().layoutGet().tiles as any[]).find(t => t.showing?.id === id);
    await until(() => !!reader(seeded.notes.machineryPeople.id) && !!reader(seeded.notes.machineryTools.id), "both views", 10_000);
    const listed = async (view: string) => (await board.readSavedView(view)).blocks.map(b => b.text.split(" [")[0]!);
    const peopleRows = await listed(seeded.notes.machineryPeople.id), toolRows = await listed(seeded.notes.machineryTools.id);
    expect(peopleRows.length).toBeGreaterThan(0);
    expect(peopleRows.filter(t => /^Toss |backup/.test(t))).toEqual([]);
    expect(toolRows.some(t => /^Toss /.test(t))).toBe(true);
    expect(toolRows.some(t => /backup/.test(t))).toBe(true);
    expect(toolRows.filter(t => peopleRows.includes(t))).toEqual([]);
    for (let i = 0; i < 4 && S().focus !== "index"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
    ch("1");   // the index back at its top, for the tests after
    screen();
  }, 30_000);


  test("the index works by mouse: a click picks a section; a click in the part gives it the keys, esc gives them back", async () => {
    const spine = SECTIONS.findIndex(s => s.key === "spine");
    press({ kind: "mouse", action: "down", button: 0, x: 3, y: 2 + spine * 2 }); press({ kind: "mouse", action: "up", button: 0, x: 3, y: 2 + spine * 2 });
    expect(S().sel).toBe(spine);
    const r = S().stageRect;
    press({ kind: "mouse", action: "down", button: 0, x: r.col + 5, y: r.row + 5 }); press({ kind: "mouse", action: "up", button: 0, x: r.col + 5, y: r.row + 5 });
    expect(S().focus).toBe("stage");
    press({ kind: "esc" });
    expect(S().focus).toBe("index");
  });


  test("replies: act creates an attributed reply while the person's source stays put", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "replies" }, as: "reply-check" });
    await until(() => screen().includes("Replies at the orchard"), "reply demo");
    const desk = S().stage(SECTIONS.findIndex(s => s.key === "replies")).top as Desk;
    const rd = desk.pane("reader") as ReaderPane;
    const out = await desk.dispatch.act({ action: "note.reply", tile: "reader", args: { text: "re:: Replies at the orchard\n\nLeave the windfalls." } }, { kind: "agent", id: "orchard-helper" }) as { id: string };
    const saved = await board.get(out.id);
    expect(saved!.parentId).toBe(seeded.notes.replies.id);
    expect(prop(saved!, "replyto")).toBe(seeded.notes.replies.id);
    expect(prop(saved!, "thread")).toBe("orchard");
    expect(rd.surface.draft).toBeNull();
    expect(rd.surface.msg!.id).toBe(seeded.notes.replies.id);
    await desk.dispatch.press("note.reply", {}, "reader");
    await desk.dispatch.press("edit.text", { text: "re:: Replies at the orchard\n\nBring baskets." }, "reader");
    expect(screen()).toContain("Orchard row 1");
    await desk.dispatch.press("edit.save", {}, "reader");
    expect((await board.children(seeded.notes.replies.id)).some(m => m.text.includes("Bring baskets."))).toBe(true);
  });


  test("reading line stays on its bullet while scrolling and steps without skipping bullets", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "reading-line" }, as: "place-check" });
    const desk = S().stage(SECTIONS.findIndex(s => s.key === "reading-line")).top as Desk;
    const reader = desk.pane("reader") as ReaderPane;
    await until(() => reader.msg?.id === seeded.notes.overscroll.id, "the long note");
    screen();
    const source = reader.msg!.text.split("\n");
    const line = source.findIndex(l => l.startsWith("- Cane 1:"));
    await desk.dispatch.press("reading.place", { line: line + 1 }, "reader");
    const position = reader.surface.position.reading;
    await desk.dispatch.press("scroll", { by: 30 }, "reader");
    expect(reader.surface.position.reading).toBe(position);
    expect(screen()).toContain(`reading line ↑ ${line + 1}`);
    await desk.dispatch.press("scroll", { to: "top" }, "reader");
    screen();
    await desk.dispatch.press("reading.place", { line: line + 1 }, "reader");
    for (let i = 2; i <= 5; i++) {
      await desk.dispatch.press("reading.step", { by: 1 }, "reader");
      screen();
      expect(reader.msg!.text.slice(reader.surface.position.reading)).toStartWith(`- Cane ${i}:`);
    }
    const structure = desk.pane("structure") as ReaderPane;
    await until(() => structure.msg?.id === seeded.notes.notebook.id, "the notebook");
    screen();
    const callout = structure.surface.describeElements().find(e => e.kind === "callout")!;
    await desk.dispatch.press("element.select", { n: callout.n }, "structure");
    screen();
    const at = structure.surface.position.reading;
    await desk.dispatch.press("fold.select", { by: 1 }, "structure");
    screen();
    expect(structure.surface.position.reading).toBeGreaterThan(at);
    await desk.dispatch.press("element.select", { n: callout.n }, "structure");
    await desk.dispatch.press("element.select", { by: 1 }, "structure");
    expect(structure.surface.describeElements().find(e => e.current)?.label).not.toBe(callout.label);
    await desk.dispatch.press("scroll", { to: "top" }, "structure");
    let rows = sc.render(app).lines.map(plain);
    let y = rows.findIndex(l => l.includes("Gate code"));
    const x = rows[y]!.indexOf("▾", S().stageRect.col);
    const click = (x: number, y: number) => {
      press({ kind: "mouse", action: "down", button: 0, x, y });
      press({ kind: "mouse", action: "up", button: 0, x, y });
    };
    click(x, y);
    expect(structure.surface.describe().folds?.folded).toContain("> Gate code");
    rows = sc.render(app).lines.map(plain);
    y = rows.findIndex(l => l.includes("Gate code"));
    const end = rows[y]!.indexOf("…", x);
    expect(end).toBeGreaterThan(x);
    click(end, y);
    expect(structure.surface.describe().folds?.folded).not.toContain("> Gate code");
    for (let i = 0; i < 4 && S().focus === "stage"; i++) press({ kind: "esc" });
  });


  test("list preview keeps five calls still while keys and mouse change the children", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "list-folds" }, as: "fold-check" });
    const desk = S().stage(SECTIONS.findIndex(s => s.key === "list-folds")).top as Desk;
    const reader = desk.pane("reader") as ReaderPane;
    await until(() => !!reader && screen().includes("Keep the beans"), "garden calls");
    const before = (await board.get(seeded.notes.listFolds.id))!;
    const rows = () => screen().split("\n");
    const at = () => rows().findIndex(l => l.includes("Share the apples"));
    const bottom = at();
    expect(screen()).toContain("Save seeds from the strongest plants.");
    expect(screen()).not.toContain("Give the vines the sunny bed.");
    await desk.dispatch.press("reading.place", { line: 4 }, "reader");
    await desk.dispatch.press("reading.step", { by: 1 }, "reader");
    expect(screen()).toContain("Give the vines the sunny bed.");
    expect(screen()).not.toContain("Save seeds from the strongest plants.");
    expect(at()).toBe(bottom);
    const clickCall = () => {
      const ls = rows(), y = ls.findIndex(l => l.includes("[ ] Mend the gate")), x = ls[y]!.indexOf("Mend the gate");
      press({ kind: "mouse", action: "down", button: 0, x, y });
      press({ kind: "mouse", action: "up", button: 0, x, y });
    };
    clickCall();
    await until(() => screen().includes("Replace the loose hinge."), "mouse selection preview");
    expect(screen()).toContain("Replace the loose hinge.");
    expect(screen()).not.toContain("Give the vines the sunny bed.");
    expect(at()).toBe(bottom);
    expect((await board.get(before.id))!.revision).toBe(before.revision);
    expect((await board.get(before.id))!.text).toBe(before.text);
    clickCall();
    await until(() => at() > bottom, "second click unfolds in place");
    expect(at()).toBeGreaterThan(bottom);
    await desk.dispatch.press("list.preview", { on: false, text: "Mend the gate" }, "reader");
    expect(screen()).toContain("Give the vines the sunny bed.");
    for (let i = 0; i < 4 && S().focus === "stage"; i++) press({ kind: "esc" });
  });

  test("plain-list previews patch their own lines, keep reader state and use the shared placements and select wire", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "list-folds" }, as: "preview-check" });
    const desk = S().stage(SECTIONS.findIndex(s => s.key === "list-folds")).top as Desk;
    const reader = desk.pane("reader") as ReaderPane;
    await until(() => reader.msg?.id === seeded.notes.listFolds.id && !reader.msg.partial && screen().includes("Keep the beans"), "the showcase reader ready");
    const text = "Orchard plans\n[children::preview]\n- First call\n  - [ ] First detail\n- Second call\n  - Second detail\n\n## Other list\n- Third call\n  - Third detail";
    const made = await board.createBlock(null, text);
    await desk.dispatch.press("open", { id: made.id }, "reader");
    await until(() => reader.msg?.id === made.id && !reader.msg.partial && screen().includes("First detail"), "the plain preview");
    expect(screen()).not.toContain("Second detail");
    expect(screen()).toContain("Third detail");
    const narrow = () => reader.render(70, 35, true, desk).lines.map(plain);
    expect(narrow().findIndex(l => l.includes("Children"))).toBeGreaterThan(narrow().findIndex(l => l.includes("Third call")));
    const wide = reader.render(150, 35, true, desk).lines.map(plain);
    expect(wide.findIndex(l => l.includes("Children"))).toBeLessThan(wide.findIndex(l => l.includes("Third call")));
    screen();
    press({ kind: "tab" });
    await desk.dispatch.press("tile.focus", {}, "reader");
    await until(() => { screen(); return reader.surface.describeElements().some(e => e.kind === "task"); }, "the service reading the child step");
    const lines = screen().split("\n"), y = lines.findIndex(l => l.includes("First detail")), x = lines[y]!.indexOf("[ ]");
    press({ kind: "mouse", action: "down", button: 0, x, y });
    press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => screen().includes("Mark done"), "the child task's shared status choice");
    press({ kind: "esc" });
    await desk.dispatch.press("list.preview.edit", {}, "reader");
    press({ kind: "paste", text: "  - Rewritten first detail" });
    const editor = screen().split("\n"), saveRow = editor.findIndex(l => l.includes("[save]")), saveCol = editor[saveRow]!.indexOf("[save]");
    press({ kind: "mouse", action: "down", button: 0, x: saveCol + 20, y: saveRow });
    press({ kind: "mouse", action: "up", button: 0, x: saveCol + 1, y: saveRow });
    await Bun.sleep(100);
    expect(reader.surface.editing).toBe(true);
    press({ kind: "mouse", action: "down", button: 0, x: saveCol + 1, y: saveRow });
    press({ kind: "mouse", action: "up", button: 0, x: saveCol + 1, y: saveRow });
    await until(() => screen().includes("Rewritten first detail") && !reader.surface.editing, "children typed by keys and saved by mouse");
    expect((await board.get(made.id))!.text).toBe(text.replace("  - [ ] First detail", "  - Rewritten first detail"));
    expect(screen()).toContain("Rewritten first detail");
    await desk.dispatch.press("list.preview", { text: "First call", on: false }, "reader");
    expect(screen()).toContain("Second detail");
    await desk.dispatch.press("open", { id: seeded.notes.listFolds.id }, "reader");
    await desk.dispatch.press("back", {}, "reader");
    await until(() => reader.msg?.id === made.id && screen().includes("Second detail"), "the reader's preview override after back");
    await desk.dispatch.press("list.preview", { text: "First call", on: true }, "reader");
    for (const place of ["inline", "floating", "popup", "split"]) {
      await desk.dispatch.press("list.preview.place", { place }, "reader");
      expect(screen()).toContain("Rewritten first detail");
    }
    await desk.dispatch.press("placement.menu", { target: "list-preview" }, "reader");
    await desk.dispatch.press("placement.choose", { place: "tile" }, "reader");
    await until(() => screen().includes("list children") && desk.layoutGet().tiles.some(t => t.kind === "list-preview"), "the shared attached tile");
    expect(screen()).toContain("Rewritten first detail");
    await desk.dispatch.press("list.preview.place", { side: "down" }, "reader");
    expect(screen()).toContain("Rewritten first detail");
    await desk.dispatch.press("list.preview.place", { place: "split" }, "reader");
    await until(() => !desk.layoutGet().tiles.some(t => t.kind === "list-preview"), "the preview back inside its reader");
    await desk.dispatch.press("tile.open", { kind: "preview", name: "children", source: "tile:reader" }, "reader");
    await desk.dispatch.press("tile.link", { to: "children", verb: "select" }, "reader");
    await until(() => screen().includes("Rewritten first detail"), "the wired preview");
    expect(screen().match(/Rewritten first detail/g)?.length).toBe(1);
    const preview = desk.layoutGet().tiles.find(t => t.kind === "preview")!;
    await desk.dispatch.press("tile.focus", {}, preview.name);
    await desk.dispatch.press("list.preview.edit", {}, preview.name);
    press({ kind: "paste", text: "  - Edited from the wire" });
    press({ kind: "char", ch: "s", ctrl: true });
    await until(() => screen().includes("Edited from the wire") && !reader.surface.editing, "typing in the wired preview");
    expect((await board.get(made.id))!.text).toContain("  - Edited from the wire\n- Second call");

    await desk.dispatch.press("reading.place", { line: 3 }, "reader");
    await desk.dispatch.press("reading.step", { by: 1 }, "reader");
    expect(screen()).toContain("Second detail");
    expect(screen()).not.toContain("Edited from the wire");
    for (let i = 0; i < 4 && S().focus === "stage"; i++) press({ kind: "esc" });
  });

  test("reading a tall paragraph upward starts at its last page and keeps the same block while paging", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "reading-line" }, as: "place-check" });
    const desk = S().stage(SECTIONS.findIndex(s => s.key === "reading-line")).top as Desk;
    const reader = desk.pane("reader") as ReaderPane;
    const text = `Tall bean diary\nBefore the long paragraph.\n\n${"runner beans ".repeat(800)}finalpod\n\nAfter the long paragraph.`;
    await until(() => reader.msg?.id === seeded.notes.overscroll.id && !reader.msg.partial, "the initial reader");
    screen();
    const made = await board.request<{ id: string }>("create", { author: "user", text });
    await desk.dispatch.press("open", { id: made.id }, "reader");
    await until(() => reader.msg?.id === made.id && !reader.msg.partial, "the tall paragraph");
    screen();
    await desk.dispatch.press("scroll", { to: "end" }, "reader");
    screen();
    await desk.dispatch.press("reading.place", { line: 6 }, "reader");
    await desk.dispatch.press("reading.step", { by: -1 }, "reader");
    expect(screen()).toContain("finalpod");
    const place = reader.surface.position.reading, top = reader.surface.viewport()!.top;
    expect(text.slice(place)).toStartWith("runner beans");
    await desk.dispatch.press("reading.step", { by: -1 }, "reader");
    screen();
    expect(reader.surface.position.reading).toBe(place);
    expect(reader.surface.viewport()!.top).toBeLessThan(top);
    await desk.dispatch.press("reading.place", { line: 6 }, "reader");
    await desk.dispatch.press("scroll", { to: "top" }, "reader");
    expect(screen()).toContain("reading line ↓ 6");
    await desk.dispatch.press("reading.place", { line: 2 }, "reader");
    await desk.dispatch.press("reading.step", { by: 1 }, "reader");
    screen();
    const firstPage = reader.surface.viewport()!.top;
    await desk.dispatch.press("reading.step", { by: 1 }, "reader");
    screen();
    expect(reader.surface.position.reading).toBe(place);
    expect(reader.surface.viewport()!.top).toBeGreaterThan(firstPage);
    await desk.dispatch.press("open", { id: seeded.notes.overscroll.id }, "reader");
    for (let i = 0; i < 4 && S().focus === "stage"; i++) press({ kind: "esc" });
  });


  test("an embed growing above the reading line keeps the same source and screen row", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "reading-line" }, as: "place-check" });
    const desk = S().stage(SECTIONS.findIndex(s => s.key === "reading-line")).top as Desk;
    const reader = desk.pane("reader") as ReaderPane;
    await until(() => reader.msg?.id === seeded.notes.overscroll.id && !reader.msg.partial, "the initial reader");
    screen();
    const embedded = await board.createBlock(null, "Seed ledger\nTwo seeds.");
    const note = await board.createBlock(null, `The ledger below\n!((${embedded.id}))\n\nReading here after the ledger.\n${"A later row.\n".repeat(50)}`);
    await desk.dispatch.press("open", { id: note.id }, "reader");
    await until(() => screen().includes("Two seeds."), "the embed read");
    await desk.dispatch.press("reading.place", { line: 4 }, "reader");
    reader.surface.scrollToLine(4);
    const row = () => sc.render(app).lines.map(plain).findIndex(l => l.includes("Reading here after the ledger."));
    const y = row(), place = reader.surface.position.reading, total = reader.surface.viewport()!.total;
    expect(y).toBeGreaterThan(0);
    await board.update(embedded.id, `Seed ledger\n${"A newly loaded seed row.\n".repeat(30)}`, embedded.revision!);
    await until(() => { screen(); return reader.surface.viewport()!.total > total; }, "the embed's new height");
    expect(reader.surface.position.reading).toBe(place);
    expect(row()).toBe(y);
    await desk.dispatch.press("open", { id: seeded.notes.overscroll.id }, "reader");
    for (let i = 0; i < 4 && S().focus === "stage"; i++) press({ kind: "esc" });
  });


  test("offscreen reading keeps selection controls visible and brackets start in the visible note", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "reading-line" }, as: "place-check" });
    const desk = S().stage(SECTIONS.findIndex(s => s.key === "reading-line")).top as Desk;
    const reader = desk.pane("reader") as ReaderPane;
    await until(() => reader.msg?.id === seeded.notes.overscroll.id && !reader.msg.partial, "the initial reader");
    screen();
    const note = await board.createBlock(null, `Bean journal\n[Early link](https://early.example.test)\n${"A row of beans.\n".repeat(45)}[Later link](https://later.example.test)\n${"Another row of beans.\n".repeat(45)}`);
    await desk.dispatch.press("open", { id: note.id }, "reader");
    await until(() => reader.msg?.id === note.id && !reader.msg.partial, "the journal");
    screen();
    await desk.dispatch.press("reading.place", { line: 2 }, "reader");
    await desk.dispatch.press("select", { text: "Early link" }, "reader");
    await desk.dispatch.press("scroll", { by: 40 }, "reader");
    expect(screen()).toContain("[y copy]");
    await desk.dispatch.press("select.clear", {}, "reader");
    screen();
    await desk.dispatch.press("element.select", { by: 1 }, "reader");
    expect(reader.surface.describeElements().find(e => e.current)?.label).toBe("Later link");
    await desk.dispatch.press("open", { id: seeded.notes.overscroll.id }, "reader");
    for (let i = 0; i < 4 && S().focus === "stage"; i++) press({ kind: "esc" });
  });


  test("one-place: act keeps the source line across view and edit and exposes the edit scroll bar", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "one-place" }, as: "place-check" });
    screen();
    const desk = S().stage(SECTIONS.findIndex(s => s.key === "one-place")).top as Desk;
    await until(() => (desk.pane("reader") as ReaderPane).msg?.id === seeded.notes.overscroll.id, "the long note");
    screen();
    await desk.dispatch.press("scroll", { by: 20 }, "reader");
    const rows = () => sc.render(app).lines.map(plain);
    const before = rows(), y = before.findIndex(l => /Cane \d+:/.test(l));
    const label = before[y]!.match(/Cane \d+:/)![0];
    await desk.dispatch.press("edit", {}, "reader");
    expect(rows().findIndex(l => l.includes(label))).toBe(y);
    const rd = desk.pane("reader") as ReaderPane;
    expect(rd.surface.draft!.scrollFigure.total).toBeGreaterThan(rd.surface.draft!.scrollFigure.room);
    await desk.dispatch.press("draft.scroll", { by: 8 }, "reader");
    const edited = rows(), ey = edited.findIndex(l => /Cane \d+:/.test(l));
    const next = edited[ey]!.match(/Cane \d+:/)![0];
    await desk.dispatch.press("edit.close", {}, "reader");
    expect(rows().findIndex(l => l.includes(next))).toBe(ey);
  });
});
