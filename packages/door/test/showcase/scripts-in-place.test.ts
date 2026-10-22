// PIE-955: the showcase's "Scripts in place" section. A render-mode script (beds-table::) and a ::= line draw under their
// lines in the reader, read the note's owner, and are drawn again when it changes; drawing writes nothing. One of the
// showcase's test files; the harness (harness.ts) seeds a scratch outline and opens the screen on it.
import { beforeAll, describe, expect, test } from "bun:test";
import { completionOf } from "../../src/surface/completer";
import { ReaderPane } from "../../src/desk/panes";
import { traceActions } from "../../src/surface/actions";
import { USER, SocketBoard } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: scripts in place", () => {
  const h = useShowcaseScreen();
  const { screen } = h;
  let board!: typeof h.board, app!: typeof h.app, seeded!: typeof h.seeded;
  beforeAll(() => { ({ board, app, seeded } = h); });

  test("a render script and a ::= line draw under their lines, redraw when the note changes, and write nothing", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "scripts-in-place" }, as: "test-agent" });
    screen();
    const id = seeded.notes.scriptsInPlace.id;
    const first = (await board.get(id))!;
    // The script's table (Owner/Week columns) and the ::= line's sentence, both under their lines.
    await until(() => screen().includes("Sam sows beans") && /Owner\s.*Week/.test(screen()), "both lines drawn", 15_000);
    // Drawing wrote nothing: the note's text and its children are as seeded.
    const after = (await board.get(id))!;
    expect([after.text, after.revision]).toEqual([first.text, first.revision]);
    expect(await board.children(id)).toHaveLength(0);
    // The note they read changes: both redraw.
    await board.update(id, after.text.replace("[owner::Sam]", "[owner::Robin]"), after.revision!, USER);
    await until(() => screen().includes("Robin sows beans") && /Robin\s.*42/.test(screen()) && !screen().includes("Sam sows"), "both lines redrawn", 15_000);
  }, 40_000);

  test("a button beside its named fence runs the fence on a person's press", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "scripts-in-place" }, as: "test-agent" });
    await until(() => screen().includes("[Fold the source]"), "the fence's button");
    const rows = screen().split("\n"), y = rows.findIndex(r => r.includes("[Fold the source]"));
    const x = rows[y]!.indexOf("[Fold the source]") + 1;
    h.press({ kind: "mouse", action: "down", button: 0, x, y });
    h.press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => (app as any).message.includes("Source folded"), "the named fence's answer").catch(async error => { throw new Error(`${error.message}; status: ${(app as any).message}; registry: ${JSON.stringify((await board.listExtensions()).extensions.filter(e => e.name === "fold-source" || e.error?.includes("fold-source")))}`); });
    const layout = JSON.stringify(await app.act({ action: "layout.get", as: "test-agent" }));
    expect(layout).toContain('"collapsed":true');
    expect(screen()).toContain("used by ::button Fold the source");
    await app.dispatch.act({ action: "layout.undo" }, USER);
  }, 20_000);

  test("a button explains a failed local script instead of running an outer name", async () => {
    (app as any).lastInput = 0;
    const outer = await board.createBlock(null, "Outer [script::broken-local] [results::keep]\n```js\nreturn 'wrong outer script';\n```");
    const local = await board.createBlock(null, "Workbench\n```js script=broken-local\n```\n::button{label=Try of=broken-local}");
    try {
      await app.loadExtensions(true);
      await app.dispatch.act({ action: "button.press", args: { note: local.id, label: "Try" } }, USER);
      expect((app as any).message).toContain("empty");
      expect(await board.children(outer.id)).toEqual([]);
    } finally {
      await board.trash(local.id, USER);
      await board.trash(outer.id, USER);
    }
  });

  test("one button press folds both tiles, stops on refusal, and pipes scripts with acts as tap", async () => {
    await app.dispatch.act({ action: "section", args: { name: "button-sequences" } }, USER);
    const note = seeded.notes.buttonSequences;
    const collapsed = async (name: string) => {
      const layout = await app.dispatch.act({ action: "layout.get" }, USER) as { tiles: { name: string; collapsed?: boolean }[] };
      return layout.tiles.find(t => t.name === name)?.collapsed === true;
    };
    const sources = () => board.siteSources(note.id);
    const press = async (label: string, keyboard = false) => {
      const ran: string[] = [];
      let stop = () => {};
      if (keyboard) {
        await app.dispatch.act({ action: "section.try" }, USER);
        h.press({ kind: "enter" });
        const { elements } = await app.dispatch.act({ action: "elements", tile: "notes" }, USER) as { elements: { n: number; label: string }[] };
        await app.dispatch.act({ action: "element.select", tile: "notes", args: { n: elements.find(e => e.label === `[${label}]`)!.n } }, USER);
        stop = traceActions(a => ran.push(a.name));
        h.press({ kind: "enter" });
      } else await app.dispatch.act({ action: "button.press", args: { note: note.id, label } }, USER);
      const end = Date.now() + 10000;
      for (;;) {
        const source = (await sources()).sources.find(s => s.name === label);
        if (source && (source.problem || source.result.text.includes("Finished"))) {
          stop();
          if (keyboard) expect(ran[0]).toBe("button.press");
          return source;
        }
        if (Date.now() > end) { stop(); throw new Error(`Sequence ${label} did not finish: ${JSON.stringify(source)}`); }
        await Bun.sleep(30);
      }
    };
    try {
      await app.loadExtensions(true);
      for (const label of ["Fold the bottom", "Sugar"]) {
        await press(label, label === "Fold the bottom");
        expect([await collapsed("links"), await collapsed("preview")]).toEqual([true, true]);
        await app.dispatch.act({ action: "ext.undo", tile: "notes" }, USER);
        expect([await collapsed("links"), await collapsed("preview")]).toEqual([false, false]);
      }
      const refused = await press("Refused");
      expect(refused.problem).toContain("Step 1");
      expect(refused.result.rows).toBe(1);
      expect(refused.problem).toContain("missing");
      expect(await collapsed("links")).toBe(false);
      const partial = await press("Partial");
      expect(partial.problem).toContain("Step 3");
      expect(partial.result.rows).toBe(3);
      expect(partial.problem).toContain("Finished: 1");
      expect(partial.problem).toContain("Effects that remain:");
      expect([await collapsed("links"), await collapsed("preview")]).toEqual([true, false]);
      expect((await board.children(note.id)).some(n => n.text === "Sequence left this entry")).toBe(true);
      await app.dispatch.act({ action: "ext.undo", tile: "notes" }, USER);
      expect([await collapsed("links"), await collapsed("preview")]).toEqual([false, false]);
      expect((await board.children(note.id)).some(n => n.text === "Sequence left this entry")).toBe(false);
      const piped = await press("Pipe");
      expect(piped.result.table?.map(r => r.slice(1, 4))).toEqual([
        ["((pick))", "undefined", "[2,3]"],
        ["tile.collapse on=true tile=links", "[2,3]", "[2,3]"],
        ["((convert))", "[2,3]", "[4,6]"],
        ["((wire))", "[4,6]", '"4,6"'],
      ]);
      expect(await collapsed("links")).toBe(true);
      const nothing = await press("Nothing");
      expect(nothing.result.text).toContain("returned nothing");
      expect(nothing.result.text).toContain("empty input");
      await app.dispatch.act({ action: "ext.undo", tile: "notes" }, USER);
      await app.dispatch.act({ action: "ext.undo", tile: "notes" }, USER);
      const current = (await board.get(note.id))!;
      await board.update(note.id, current.text + '\n```js script=hold\nawait wait(5000);\n```\n::button{label="Stop"}\ntile.collapse on=true tile=links\n((hold))\ntile.collapse on=true tile=preview\n::', current.revision!, USER);
      await app.dispatch.act({ action: "button.press", args: { note: note.id, label: "Stop" } }, USER);
      const end = Date.now() + 10000;
      while (!await collapsed("links")) { if (Date.now() > end) throw new Error("the sequence did not start"); await Bun.sleep(30); }
      await app.dispatch.act({ action: "layout.stop" }, USER);
      expect([await collapsed("links"), await collapsed("preview")]).toEqual([true, false]);
      while (!(await sources()).sources.find(s => s.name === "Stop")?.problem?.includes("Finished:")) {
        if (Date.now() > end) throw new Error("the stopped sequence did not finish");
        await Bun.sleep(30);
      }
      await app.dispatch.act({ action: "ext.undo", tile: "notes" }, USER);
      expect([await collapsed("links"), await collapsed("preview")]).toEqual([false, false]);
      const observer = new SocketBoard(h.scratch.sock), finished = new Set<string>();
      observer.subscribe(e => { if (e.ended) finished.add(e.ended.run); });
      try {
        await observer.info();
        const first = await app.dispatch.act({ action: "button.press", args: { note: note.id, label: "Stop" } }, USER) as { undo: string };
        const second = await app.dispatch.act({ action: "button.press", args: { note: note.id, label: "Stop" } }, USER) as { undo: string };
        expect(first.undo).not.toBe(second.undo);
        const done = Date.now() + 10000;
        while (!finished.has(first.undo) || !finished.has(second.undo)) {
          if (Date.now() > done) throw new Error("the overlapping presses did not finish");
          await Bun.sleep(30);
        }
        expect((await sources()).sources.find(s => s.name === "Stop")!.result.rows).toBe(3);
      } finally { observer.close(); }
    } finally { await app.dispatch.act({ action: "section", args: { name: "scripts-in-place" } }, USER); }
  }, 45000);

  const untilAsync = async (ok: () => Promise<boolean>, what: string) => {
    const end = Date.now() + 10000;
    while (!await ok()) {
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
      await Bun.sleep(30);
    }
  };

  test.each([
    ["tool", "await tools.outline_comment({ ref: this.id, whole: true, body: 'Forbidden comment' });", "not a function"],
    ["place", "await place('Forbidden output');", "not defined"],
    ["act", "await act('tile.collapse', { tile: 'links', on: true });", "not defined"],
  ])("a render sequence step has no %s write function", async (_name, code, missing) => {
    await app.dispatch.act({ action: "section", args: { name: "button-sequences" } }, USER);
    await app.dispatch.act({ action: "tile.collapse", tile: "links", args: { on: false } }, USER);
    const note = await board.createBlock(null, `Render sequence
\`\`\`js script=draw mode=render
${code}
return 'wrote';
\`\`\`
::button{label=Render}
((draw))
::`);
    try {
      await app.loadExtensions(true);
      await app.dispatch.act({ action: "button.press", args: { note: note.id, label: "Render" } }, USER);
      let source;
      await untilAsync(async () => {
        source = (await board.siteSources(note.id)).sources.find(s => s.name === "Render");
        return !!source && (source.problem !== undefined || source.result.text.includes("Finished"));
      }, "the render step");
      expect(source!.problem).toContain(missing);
      expect(source!.problem).toContain("render scripts draw; use an action script (a button or of=) to change things");
      expect(await board.comments(note.id)).toEqual([]);
      expect((await board.get(note.id))!.text).toBe(note.text);
      const layout = await app.dispatch.act({ action: "layout.get" }, USER) as { tiles: { name: string; collapsed?: boolean }[] };
      expect(layout.tiles.find(t => t.name === "links")?.collapsed).not.toBe(true);
    } finally { await app.dispatch.act({ action: "section", args: { name: "scripts-in-place" } }, USER); }
  });

  test.each(["links", "'links'"])("an actions fence receives its sequence step's arguments: %s", async (slot) => {
    await app.dispatch.act({ action: "section", args: { name: "button-sequences" } }, USER);
    await app.dispatch.act({ action: "tile.collapse", tile: "links", args: { on: false } }, USER);
    const note = await board.createBlock(null, `Step arguments
\`\`\`actions script=fold
tile.collapse on=true tile={{props.tile}}
\`\`\`
::button{label=Slots}
((fold tile=${slot}))
::`);
    try {
      await app.loadExtensions(true);
      await app.dispatch.act({ action: "button.press", args: { note: note.id, label: "Slots" } }, USER);
      await untilAsync(async () => {
        const source = (await board.siteSources(note.id)).sources.find(s => s.name === "Slots");
        if (source?.problem) throw new Error(source.problem);
        return !!source?.result.text.includes("Finished");
      }, "the slotted action");
      const layout = await app.dispatch.act({ action: "layout.get" }, USER) as { tiles: { name: string; collapsed?: boolean }[] };
      expect(layout.tiles.find(t => t.name === "links")?.collapsed).toBe(true);
      await app.dispatch.act({ action: "layout.undo" }, USER);
    } finally { await app.dispatch.act({ action: "section", args: { name: "scripts-in-place" } }, USER); }
  });

  test("undoing the first overlapping press preserves the second press's layout", async () => {
    await app.dispatch.act({ action: "section", args: { name: "button-sequences" } }, USER);
    for (const tile of ["links", "preview"]) await app.dispatch.act({ action: "tile.collapse", tile, args: { on: false } }, USER);
    const note = await board.createBlock(null, `First press
\`\`\`js script=fold
await act('tile.collapse', { tile: this.title === 'First press' ? 'links' : 'preview', on: true });
while (!(await read(this.id)).title.startsWith('Released')) await wait(20);
\`\`\`
::button{label=Overlap}
((fold))
::`);
    const observer = new SocketBoard(h.scratch.sock), finished = new Set<string>();
    observer.subscribe(e => { if (e.ended) finished.add(e.ended.run); });
    const collapsed = async (name: string) => {
      const layout = await app.dispatch.act({ action: "layout.get" }, USER) as { tiles: { name: string; collapsed?: boolean }[] };
      return layout.tiles.find(t => t.name === name)?.collapsed === true;
    };
    try {
      await observer.info();
      await app.loadExtensions(true);
      const first = await app.dispatch.act({ action: "button.press", args: { note: note.id, label: "Overlap" } }, USER) as { undo: string };
      await untilAsync(() => collapsed("links"), "the first press's layout");
      const current = (await board.get(note.id))!;
      await board.update(note.id, current.text.replace("First press", "Second press"), current.revision!, USER);
      const second = await app.dispatch.act({ action: "button.press", args: { note: note.id, label: "Overlap" } }, USER) as { undo: string };
      await untilAsync(() => collapsed("preview"), "the second press's layout");
      const held = (await board.get(note.id))!;
      await board.update(note.id, held.text.replace("Second press", "Released presses"), held.revision!, USER);
      await until(() => finished.has(first.undo) && finished.has(second.undo), "both interleaved presses");
      expect(await collapsed("preview")).toBe(true);
      try { await app.dispatch.act({ action: "layout.undo", args: { txn: first.undo } }, USER); } catch (error) {
        expect(String(error)).toContain("undo that first");
      }
      expect(await collapsed("preview")).toBe(true);
      await app.dispatch.act({ action: "layout.undo", args: { txn: second.undo } }, USER);
      await app.dispatch.act({ action: "layout.undo", args: { txn: first.undo } }, USER);
      expect([await collapsed("links"), await collapsed("preview")]).toEqual([false, false]);
    } finally { observer.close(); await app.dispatch.act({ action: "section", args: { name: "scripts-in-place" } }, USER); }
  });

  test("Enter starts the next button step while action completion is unchosen", async () => {
    await app.dispatch.act({ action: "section.try", args: { name: "button-sequences" } }, USER);
    const note = await board.createBlock(null, 'Typing a button\n::button{label=Fold}\n');
    try {
      await app.dispatch.act({ action: "open", tile: "notes", args: { id: note.id } }, USER);
      await app.dispatch.act({ action: "edit", tile: "notes" }, USER);
      await app.dispatch.act({ action: "draft.place", tile: "notes", args: { line: 3, col: 1 } }, USER);
      const draft = (h.sc.tilesHere()!.pane("notes") as ReaderPane).surface.draft!;
      for (const ch of "tile.collapse on=true tile=links") h.press({ kind: "char", ch });
      await until(() => !!completionOf(draft)?.items.length && !completionOf(draft)!.loading, "the action completions");
      h.press({ kind: "enter" });
      expect(draft.text).toBe('Typing a button\n::button{label=Fold}\ntile.collapse on=true tile=links\n');
      h.press({ kind: "char", ch: ":" }); h.press({ kind: "char", ch: ":" });
      await until(() => !completionOf(draft)?.loading, "the closing delimiter");
      expect(completionOf(draft)).toBeNull();
      h.press({ kind: "enter" });
      await app.dispatch.act({ action: "edit.save", tile: "notes" }, USER);
      expect((await board.get(note.id))!.text).toBe('Typing a button\n::button{label=Fold}\ntile.collapse on=true tile=links\n::\n');
      await app.dispatch.act({ action: "edit.close", tile: "notes", args: { discard: true } }, USER);
    } finally {
      if ((h.sc.tilesHere()!.pane("notes") as ReaderPane).surface.draft) await app.dispatch.act({ action: "edit.close", tile: "notes", args: { discard: true } }, USER);
      await board.trash(note.id);
      await app.dispatch.act({ action: "section", args: { name: "scripts-in-place" } }, USER);
    }
  });

  test("the published showcase draws its visible seed count through both embed forms", async () => {
    const page = await board.resolvePage("showcase-published-script-lines");
    const template = await board.resolvePage("showcase-seed-count");
    expect(page.block?.id).toBeDefined();
    expect(template.block?.id).toBeDefined();
    await board.request("resources.projection.read", { blockId: template.block!.id, materialize: true });
    const deadline = Date.now() + 10_000;
    for (;;) {
      const rendered = await board.request<{ text: string }>("notes.render", { blockId: page.block!.id, format: "html", audience: "public" });
      if ((rendered.text.match(/Seeds shown here: 1/g) ?? []).length >= 3 &&
        (rendered.text.match(/Shelf complete: true; children: 0/g) ?? []).length === 2) {
        expect(rendered.text).not.toContain("Seeds shown here: 2");
        expect(rendered.text).not.toContain("hidden here");
        expect(rendered.text).toContain("not shared");
        expect(rendered.text).not.toContain("PRIVATE_SCRIPT_SECRET");
        break;
      }
      if (Date.now() > deadline) throw new Error(`The published showcase did not draw both counts: ${rendered.text}`);
      await Bun.sleep(25);
    }
  }, 15_000);

});
