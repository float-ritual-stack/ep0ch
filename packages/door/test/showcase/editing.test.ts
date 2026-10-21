// PIE-439: the showcase screen, editing: keys, links, pictures, tables, completion. One of the showcase's test files (split from the one file, so a
// section's test is a file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { App } from "../../src/app";
import { SHOWCASE_ASSETS, SEED, type Seeded } from "../../src/showcase/seed";
import { SECTIONS, Showcase } from "../../src/showcase/showcase";
import { completionOf } from "../../src/surface/completer";
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

describe.skipIf(!outliner)("the showcase screen: editing: keys, links, pictures, tables, completion", () => {
  const h = useShowcaseScreen();
  const { scratch, written, press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });


  test("insert uses the note's scoped folder, returns absolute file lines, and stays beside a drawer draft", async () => {
    await app.act({ action: "section", args: { name: "insert" }, as: "test-agent" });
    press({ kind: "enter" });
    const desk = S().stages.get(S().sel).top;
    const folder = join(scratch.root, "picker files");
    mkdirSync(folder);
    writeFileSync(join(folder, "first.md"), "First file");
    writeFileSync(join(folder, "second file.md"), "Second file");
    const parent = await board.createBlock(null, `Picker project [cwd::${folder}]`);
    await board.move(seeded.notes.insert.id, parent.id);
    const note = (await board.get(seeded.notes.insert.id))!;
    const reader = [...desk.panes.values()][0] as ReaderPane;
    reader.show(note, desk);
    await desk.dispatch.act({ action: "edit" }, { kind: "user" });
    await until(() => !!reader.draft, "picker draft");
    press({ kind: "pgdn" }); press({ kind: "end" });
    const picker = join(scratch.root, "picker.ts");
    writeFileSync(picker, `import { readdirSync } from "node:fs"; process.stdin.once("data", () => { console.log(readdirSync(".").sort().join("\\n")); process.exit(0); });`);
    const was = process.env.EP0CH_PICKER;
    process.env.EP0CH_PICKER = `${process.execPath} ${picker}`;
    try {
      for (const drawer of [false, true]) {
        if (drawer) {
          await desk.dispatch.act({ action: "tile.drawer" }, { kind: "user" });
          (app as any).paint();
          await app.dispatch.act({ action: "host.enter" }, { kind: "user" });
        }
        const layer = drawer ? app.drawer.desk! : desk;
        press({ kind: "char", ch: "t", ctrl: true });
        await until(() => !!layer.pane("pick"), "picker beside draft");
        (app as any).paint();
        expect(layer.pane("pick")!.title()).toBe(folder);
        press({ kind: "enter" });
        await until(() => reader.draft!.text.includes(`[file::${folder}/second file.md]`), `absolute file choices (drawer=${drawer})`);
        expect(reader.draft!.text).toContain(`- [file::${folder}/first.md]\n- [file::${folder}/second file.md]`);
        await until(() => !layer.pane("pick"), "picker closes");
        await layer.dispatch.act({ action: "draft.undo" }, { kind: "user" });
      }
    } finally {
      if (was === undefined) delete process.env.EP0CH_PICKER; else process.env.EP0CH_PICKER = was;
      press({ kind: "esc" });
      if (app.drawer.entered) await app.dispatch.act({ action: "host.leave" }, { kind: "user" });
      for (let i = 0; i < 4 && S().focus === "stage"; i++) press({ kind: "esc" });
    }
  }, 20_000);

  test("the library completion card teaches and copies syntax, then shows a script definition (PIE-1164)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "library" }, as: "test-agent" });
    press({ kind: "enter" });
    const desk = S().stages.get(SECTIONS.findIndex(s => s.key === "library")).top;
    const reader = [...desk.panes.values()].find((p: any) => p.surface) as ReaderPane;
    await until(() => !!reader.msg, "library reader note");
    const tile = desk.nameOf(desk.idOf(reader)!);
    await desk.dispatch.press("tile.focus", {}, tile);
    ch("e"); press({ kind: "enter" });
    await until(() => !!reader.draft, "library reader draft");
    const d = reader.draft!, original = d.text;
    d.row = 0; d.col = 0;
    press({ kind: "paste", text: "[status::ready] [owner::Ada] " });
    d.row = d.lines.length - 1; d.col = d.lines[d.row]!.length;
    press({ kind: "enter" });
    for (const c of "::fie") ch(c);
    const pop = () => completionOf(d);
    await until(() => !!pop() && !pop()!.loading, "Fields card");
    expect(screen()).toContain("::fields{key=status}");
    expect(pop()!.previewLines!.map(plain).join("\n")).toContain("the property to list");
    expect(screen()).toContain("Seed list");
    const source = "::fields{key=status}";
    const clipboard = () => written.filter(s => s.includes("\x1b]52;")).at(-1) ?? "";
    press({ kind: "down" }); press({ kind: "up" });
    ch("y");
    expect(clipboard()).toContain(Buffer.from(source).toString("base64"));
    written.length = 0;
    const rows = screen().split("\n"), y = rows.findIndex(l => l.includes("[copy]")), x = rows[y]!.indexOf("[copy]") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y });
    press({ kind: "mouse", action: "up", button: 0, x, y });
    expect(clipboard()).toContain(Buffer.from(source).toString("base64"));
    press({ kind: "right" });
    expect(pop()!.items.some(i => i.label === "::fields{key=owner}")).toBe(true);
    expect(await desk.dispatch.act({ action: "complete.copy", args: {}, tile }, { kind: "agent", id: "test-agent" })).toMatchObject({ result: source });
    press({ kind: "esc" });
    press({ kind: "enter" });
    for (const c of "@seed-count") ch(c);
    await until(() => !!pop() && !pop()!.loading && pop()!.items[0]?.label === "@seed-count", "script completion");
    screen();
    expect(screen()).toContain("» @seed-count");
    const definition = pop()!.previewLines!.map(plain).join("\n");
    expect(definition).toContain("[g] Seed count");
    expect(definition).toContain("```js");
    expect(definition).toContain("return (await q('script')).blocks.length;");
    const jump: any = await desk.dispatch.act({ action: "complete.definition", args: {}, tile }, { kind: "agent", id: "test-agent" });
    expect((await board.get(jump.blockId))!.text).toStartWith("Seed count [script::seed-count]");
    press({ kind: "down" }); press({ kind: "up" });
    ch("g");
    await until(() => [...desk.panes.values()].some((p: any) => p !== reader && p.msg?.id === jump.blockId), "script opened beside the draft");
    expect(reader.draft).toBe(d);
    await desk.dispatch.press("tile.focus", {}, tile);
    press({ kind: "esc" });
    for (let i = 0; d.text !== original && i < 50; i++) press({ kind: "char", ch: "z", ctrl: true });
    expect(d.text).toBe(original);
    for (let i = 0; i < 5 && S().focus === "stage"; i++) press({ kind: "esc" });
  });

  test("the editing demo previews a reference through the same action as shift+arrows (PIE-1104)", async () => {
    ch("5"); press({ kind: "enter" });
    await until(() => !!S().stages.get(4), "editing stage");
    const desk = S().stages.get(4).top;
    ch("e"); press({ kind: "enter" });
    const reader = [...desk.panes.values()][0] as ReaderPane;
    await until(() => !!reader.draft, "edit");
    for (let i = 0; i < 5; i++) press({ kind: "pgdn" });
    press({ kind: "end" }); press({ kind: "enter" });
    for (const c of "((Kitchen") ch(c);
    await until(() => !!completionOf(reader.draft!) && !completionOf(reader.draft!)!.loading, "references");
    await until(() => screen().includes("((Kitchen▌"), "query echo");
    const selected = completionOf(reader.draft!)!.items[completionOf(reader.draft!)!.index]!.insertion;
    await untilAsync(async () => !!(await desk.dispatch.act({ action: "complete.preview", args: { by: 1 } }, { kind: "user" })), "preview action");
    expect(completionOf(reader.draft!)!.items[completionOf(reader.draft!)!.index]!.insertion).toBe(selected);
    press({ kind: "esc" });
    press({ kind: "char", ch: "z", ctrl: true });
    press({ kind: "char", ch: "z", ctrl: true });
    for (let i = 0; i < 4 && S().focus === "stage"; i++) press({ kind: "esc" });
  });

  test("editing works in a section, by keys: e, type, a click away and back keeps it (PIE-812), ctrl+s writes to the showcase outline", async () => {
    ch("5"); press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // e arms the edit (edit.arm): the reader's frame asks, nothing opens until ⏎.
    ch("e");
    const desk = () => S().stages.get(4).top;
    expect(screen()).toContain("✎ edit? ");
    expect(desk().describe().panes[0].editing).toBeFalsy();
    press({ kind: "enter" });
    await until(() => !!desk().describe().panes[0].editing, "the whiteboard in an edit", 5000);
    for (let i = 0; i < 5; i++) press({ kind: "pgdn" });            // to the last line, however it wraps
    press({ kind: "end" });
    for (const c of " Mind the oven.") ch(c);
    // A click on the notebook beside it (PIE-812): the keys go there, the edit stays open as it was, nothing saved; a
    // click back is in it again at the same place, with no e.
    // The stage's tiles where the screen draws them (its hits are in the stage's own cells).
    const tiles = () => { sc.render(app); const o = S().stageRect; return (desk().hits as [number, { col: number; row: number; cols: number; rows: number }][]).map(([id, r]) => [id, { ...r, col: r.col + o.col, row: r.row + o.row }] as const); };
    const [other, or] = tiles().find(([id]) => id !== desk().focus)!;
    press({ kind: "mouse", action: "down", button: 0, x: or.col + 3, y: or.row + 3 }); press({ kind: "mouse", action: "up", button: 0, x: or.col + 3, y: or.row + 3 });
    expect(desk().focus).toBe(other);
    expect(desk().describe().panes[0].editing?.dirty).toBe(true);
    expect(sc.render(app).lines.map(plain).join("\n")).toContain("editing · Kitchen whiteboard");
    const [mine, mr] = tiles().find(([id]) => id !== other)!;
    press({ kind: "mouse", action: "down", button: 0, x: mr.col + 3, y: mr.row + 3 }); press({ kind: "mouse", action: "up", button: 0, x: mr.col + 3, y: mr.row + 3 });
    expect(desk().focus).toBe(mine);
    for (const c of " Lid on.") ch(c);
    press({ kind: "char", ch: "s", ctrl: true });
    await until(() => !desk().describe().panes[0].editing?.dirty, "the save", 5000);
    const wb = await board.get(seeded.notes.whiteboard.id);
    expect(wb!.text.split("\n").at(-1)).toContain("Mind the oven. Lid on.");
    // Esc backs out through the part (a draft first, if still open), then to the index; never past it.
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 20_000);


  test("links from an edit (PIE-592): ctrl+l opens the link beside the edit, which stays open with the keys; a click on a link in its preview reuses that detail", async () => {
    ch("5"); press({ kind: "enter" });
    const desk = () => S().stages.get(4).top;
    ch("e"); press({ kind: "enter" });
    await until(() => !!desk().describe().panes[0].editing, "the whiteboard in an edit", 5000);
    const editor = () => [...desk().panes.values()].find((p: any) => p.editing) as any;
    const d = editor().surface.draft;
    // The cursor on the [[Bike shed]] link, as a click there puts it.
    d.row = d.lines.findIndex((l: string) => l.includes(`[[${SEED.shed}]]`)); d.col = d.lines[d.row].indexOf("[[") + 3;
    const before = desk().all().length, focus = desk().focus;
    press({ kind: "char", ch: "l", ctrl: true });
    const shed = () => [...desk().panes.values()].find((p: any) => !p.editing && p.msg?.id === seeded.notes.shed.id) as any;
    await until(() => !!shed(), "the shed opened beside the edit", 5000);
    expect(desk().all().length).toBe(before + 1);
    expect(desk().focus).toBe(focus);                                     // the keys stayed in the edit
    expect(editor().surface.draft).toBe(d);
    press({ kind: "end" }); ch("x");
    expect(d.lines[d.row].endsWith("x")).toBe(true);                      // still typing in it
    press({ kind: "char", ch: "z", ctrl: true });
    // The preview's link: a click on it opens in the same detail, not one more.
    press({ kind: "char", ch: "p", ctrl: true });
    const rows = sc.render(app).lines.map(plain), rule = rows.findIndex(l => l.includes("preview · ctrl+p hides"));
    const y = rows.findIndex((l, i) => i > rule && l.includes(`open: ${SEED.shed}.`)), x = rows[y]!.indexOf(`open: ${SEED.shed}.`) + 8;
    expect(y).toBeGreaterThan(rule);
    // The detail beside moved on to another note meanwhile: the click brings the shed back into it.
    const beside = shed(), nb = (await board.get(seeded.notes.notebook.id))!;
    beside.hold(nb, desk());
    await until(() => beside.msg?.id === nb.id, "the detail on the notebook");
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => beside.msg?.id === seeded.notes.shed.id, "the preview's link followed into the same detail", 5000);
    expect(desk().all().length).toBe(before + 1);
    expect(desk().focus).toBe(focus);
    press({ kind: "char", ch: "p", ctrl: true });
    for (let i = 0; i < 4 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 20_000);


  test("an embed pasted in an edit is expanded in ctrl+p's preview (PIE-852); a wrong anchor says so there, with a did-you-mean", async () => {
    ch("5"); press({ kind: "enter" });
    const desk = () => S().stages.get(4).top;
    ch("e"); press({ kind: "enter" });
    await until(() => !!desk().describe().panes[0].editing, "the whiteboard in an edit", 5000);
    const d = ([...desk().panes.values()].find((p: any) => p.editing) as any).surface.draft;
    const tap = (await board.get(seeded.notes.notebook.id))!.text.match(/!\(\(([0-9a-f-]{36})\^t-7a9c11\)\)/)![1]!;
    d.row = d.lines.length - 1; press({ kind: "end" });
    press({ kind: "paste", text: `\n!((${tap}^t-7a9c11))\n!((${tap}^t-7a9c1))` });
    press({ kind: "char", ch: "p", ctrl: true });
    // The edit's own preview: its rows under the rule, cut to its tile (the notebook beside has the same embed).
    const preview = () => {
      const rows = sc.render(app).lines.map(plain), rule = rows.findIndex(l => l.includes("preview · ctrl+p hides"));
      if (rule < 0) return "";
      const from = rows[rule]!.indexOf("──( preview"), to = rows[rule]!.indexOf("║", from);
      return rows.slice(rule).map(l => l.slice(from, to)).join("\n");
    };
    // The step itself, framed as the reader frames it, while the text is still unsaved.
    await until(() => preview().includes("» Kitchen tap ^t-7a9c11") && preview().includes("fix the dripping tap"), "the embed expanded in the preview", 10_000);
    expect(preview()).not.toContain("embed not expanded here");
    await until(() => preview().includes("^t-7a9c1)) · MISSING FRAGMENT in “Kitchen tap”") && preview().includes("did you mean ^t-7a9c11?"), "the wrong anchor said in the preview", 10_000);
    // Nothing saved: the paste undone, the edit closes clean.
    press({ kind: "char", ch: "z", ctrl: true });
    expect(d.lines.join("\n")).not.toContain(tap);
    press({ kind: "char", ch: "p", ctrl: true });
    for (let i = 0; i < 4 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 20_000);


  test("pictures into a draft (PIE-592): a file dropped on the terminal, and the clipboard's by ctrl+v, are kept in the outline's folder and written as media lines; ctrl+z takes them out", async () => {
    ch("5"); press({ kind: "enter" });
    const desk = () => S().stages.get(4).top;
    ch("e"); press({ kind: "enter" });
    await until(() => !!desk().describe().panes[0].editing, "the whiteboard in an edit", 5000);
    const d = ([...desk().panes.values()].find((p: any) => p.editing) as any).surface.draft;
    const before = d.text;
    // A file dropped on the terminal arrives as a paste of its path (quoted, as some terminals send it): typed in as
    // text, as every paste is; ctrl+v on it makes it the picture.
    press({ kind: "end" });
    const dropped = `'${join(SHOWCASE_ASSETS, "seed-packet.webp")}'`;
    press({ kind: "paste", text: dropped });
    expect(d.lines[d.row].endsWith(dropped)).toBe(true);
    press({ kind: "char", ch: "v", ctrl: true });
    await until(() => d.text.includes("[img::"), "the dropped picture", 5000);
    expect(d.text).not.toContain(dropped);
    const row = d.lines.findIndex((l: string) => l.startsWith("[img::"));
    expect(row).toBe(d.row);                                              // on its own line, the cursor after it
    const kept = d.lines[row].match(/^\[img::(.+)\]$/)![1]!;
    expect(kept.startsWith(join((await board.info()).workspace, "media") + "/")).toBe(true);
    expect(kept.endsWith(".webp") && existsSync(kept)).toBe(true);
    // The clipboard's picture (read on the door's machine; here a stand-in): ctrl+v, on its own line.
    const { clipboardImageReader } = await import("../../src/paste-image");
    clipboardImageReader.read = async () => readFileSync(join(SHOWCASE_ASSETS, "allotment-dusk.jpg"));
    try {
      // A paste of nothing (the terminal's paste when the clipboard holds only a picture) is ctrl+v.
      press({ kind: "paste", text: "" });
      await until(() => /^\[img::.+\.jpg\]$/.test(d.lines[d.row] ?? ""), "the clipboard's picture", 5000);
      // Nothing on the clipboard: said, and nothing written.
      clipboardImageReader.read = async () => null;
      const was = d.text;
      press({ kind: "char", ch: "v", ctrl: true });
      await until(() => /no picture on the clipboard|without a desktop/.test(d.note), "the clipboard said empty", 5000);
      expect(d.text).toBe(was);
    } finally { clipboardImageReader.read = null; }
    for (let i = 0; i < 3; i++) press({ kind: "char", ch: "z", ctrl: true });
    expect(d.text).toBe(before);
    for (let i = 0; i < 4 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 20_000);


  test("rich-edit: edit both tables through actions, undo, save and read back", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "rich-edit" }, as: "rich-builder" });
    screen();
    await app.act({ action: "rich.toggle", args: { on: true }, as: "rich-builder" });
    expect(screen()).toContain("[+row]");
    await app.act({ action: "rich.move", args: { direction: "down" }, as: "rich-builder" });
    await app.act({ action: "rich.move", args: { direction: "next" }, as: "rich-builder" });
    await app.act({ action: "rich.set", args: { value: "6" }, as: "rich-builder" });
    for (const op of ["row.add", "row.remove", "column.add", "column.remove"]) {
      await app.act({ action: "rich.change", args: { op }, as: "rich-builder" });
    }
    await app.act({ action: "rich.change", args: { op: "column.add" }, as: "rich-builder" });
    await app.act({ action: "draft.undo", as: "rich-builder" });
    await app.act({ action: "rich.toggle", args: { on: false }, as: "rich-builder" });
    await app.act({ action: "rich.toggle", args: { on: true }, as: "rich-builder" });
    const desk = S().stage(SECTIONS.findIndex(s => s.key === "rich-edit")).top;
    const reader = [...desk.panes.values()][0] as ReaderPane;
    const draft = reader.surface.draft!;
    const { elementEdit } = await import("../../src/surface/element-editor");
    const graph = elementEdit(draft).elements()[1]!;
    await app.act({ action: "draft.place", args: { line: graph.fields[1]![1]!.line + 1, col: graph.fields[1]![1]!.start + 1 }, as: "rich-builder" });
    await app.act({ action: "rich.set", args: { value: "5" }, as: "rich-builder" });
    for (const op of ["row.add", "row.remove"]) await app.act({ action: "rich.change", args: { op }, as: "rich-builder" });
    await app.act({ action: "edit.save", as: "rich-builder" });
    const saved = await board.get(seeded.notes.richEdit.id);
    expect(saved?.text).toContain("| Beans | 6 |");
    expect(saved?.text).toContain('  - ["Lettuce", "5"] # keep this row comment\n  - ["Radish", "1"]\n# keep this YAML comment\n---\nrows: keep this prose after the YAML\nheaders: [These, are, prose]\n::');
    expect(reader.surface.draft).toBeNull();
  }, 20_000);


  test("edit (PIE-626): completion on every line: a property's value and a filter's words, through act, from the same completer", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "edit" }, as: "test-agent" })).toEqual({ section: SECTIONS.findIndex(s => s.key === "edit") + 1, key: "edit" });
    screen();
    // The property panel's value for [heading::]: the schemas' values with this outline's own plot style among them.
    const value = await app.act({ action: "complete", args: { text: "pl", key: "heading" }, as: "test-agent" }) as any;
    expect(value).toMatchObject({ kind: "filter-value", query: "pl" });
    expect(value.items.map((i: any) => i.insertion)).toContain("plot");
    const ready = await app.act({ action: "complete", args: { text: "::graph-meter" }, as: "test-agent" }) as any;
    expect(ready.items.find((i: { insertion: string }) => i.insertion.startsWith("::graph-meter")).insertion).toContain("\n---\ntitle: Disk\nvalue: 0.6\n---\n::");
    const short = await app.act({ action: "complete", args: { text: "## Calls ::pl" }, as: "test-agent" }) as any;
    expect(short.items[0].insertion).toBe("[heading::plot]");
    // A key in a draft: the same list [head offers while typing.
    const key = await app.act({ action: "complete", args: { text: "[heading-p" }, as: "test-agent" }) as any;
    expect(key.items.map((i: any) => i.insertion)).toEqual(["[heading-pattern::", "[heading-padding::"]);
  }, 20_000);
});
