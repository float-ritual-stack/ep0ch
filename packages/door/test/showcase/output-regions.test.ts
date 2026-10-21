// PIE-956: the showcase's "Regions in prose" section. A render script's table, a ::= sentence and a written output region read
// like the page around them, each behind one dim mark in the margin that shows its name, when it ran and its controls
// while the cursor is on it. One of the showcase's test files; the harness (harness.ts) seeds a scratch outline and opens the screen.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { Desk } from "../../src/desk/desk";
import { USER } from "../../src/socket";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: regions in prose", () => {
  const h = useShowcaseScreen();
  const { screen } = h;
  let board!: typeof h.board, app!: typeof h.app, seeded!: typeof h.seeded;
  beforeAll(() => { ({ board, app, seeded } = h); });

  test("a floating comment stays drawn while sources are open", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    await app.dispatch.act({ action: "comment.note", tile: "notes" }, USER);
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    for (const ch of "Keep these words visible") stage.pane("notes")!.key({ kind: "char", ch }, stage);
    await app.dispatch.act({ action: "sources.open", tile: "notes" }, USER);
    await app.dispatch.act({ action: "comment.place", tile: "notes", args: { place: "floating" } }, USER);
    expect(screen()).toContain("Keep these words visible");
    expect(screen()).toContain("Sources");
    await app.dispatch.act({ action: "sources.place", tile: "notes", args: { place: "floating" } }, USER);
    screen();
    await app.dispatch.act({ action: "sources.move", tile: "notes", args: { row: 0, col: 0, cols: 36, rows: 16 } }, USER);
    await app.dispatch.act({ action: "comment.place", tile: "notes", args: { place: "floating" } }, USER);
    const commentRow = screen().split("\n").findIndex(l => l.includes("Keep these words visible"));
    expect(commentRow).toBeGreaterThan(0);
    expect(screen()).toContain("3 generated regions");
    await app.dispatch.act({ action: "sources.close", tile: "notes" }, USER);
    expect(screen().split("\n").findIndex(l => l.includes("Keep these words visible"))).toBe(commentRow);
    await app.dispatch.act({ action: "sources.open", tile: "notes" }, USER);
    screen();
    await app.dispatch.act({ action: "sources.move", tile: "notes", args: { row: 0, col: 0, cols: 36, rows: 16 } }, USER);
    const sourceRow = screen().split("\n").findIndex(l => l.includes("3 generated regions"));
    await app.dispatch.act({ action: "comment.close", tile: "notes", args: { discard: true } }, USER);
    expect(screen().split("\n").findIndex(l => l.includes("3 generated regions"))).toBe(sourceRow);
    await app.dispatch.act({ action: "sources.place", tile: "notes", args: { place: "split" } }, USER);
    await app.dispatch.act({ action: "sources.close", tile: "notes" }, USER);
  });

  test("sources moves through the placement menu and its tile spreads Query, Transform and Result across the width", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    await app.dispatch.act({ action: "sources.open", tile: "notes" }, USER);
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes")!;
    for (const place of ["inline", "floating", "split", "popup", "tile"]) {
      await app.dispatch.act({ action: "placement.menu", tile: "notes", args: { target: "sources" } }, USER);
      expect(screen()).toContain("Placement");
      await app.dispatch.act({ action: "placement.choose", tile: "notes", args: { place } }, USER);
      await until(() => screen().includes(`[${place} ▸]`), `sources drawn ${place}`);
      if (place === "inline") {
        const before = screen().split("\n").findIndex(l => l.includes("[inline ▸]"));
        await app.dispatch.act({ action: "scroll", tile: "notes", args: { by: 1 } }, USER);
        expect(screen().split("\n").findIndex(l => l.includes("[inline ▸]"))).toBe(before - 1);
      }
    }
    await app.dispatch.act({ action: "sources.enter", tile: "notes", args: { n: 1 } }, USER);
    await app.dispatch.act({ action: "tile.zoom", tile: "sources" }, USER);
    const lines = screen().split("\n");
    expect(lines.some(l => l.includes("Query") && l.includes("Transform") && l.includes("Result"))).toBe(true);
    await app.dispatch.act({ action: "tile.zoom", tile: "sources" }, USER);
    await app.dispatch.act({ action: "sources.place", tile: "notes", args: { place: "split" } }, USER);
    await app.dispatch.act({ action: "sources.close", tile: "notes" }, USER);
    await app.dispatch.act({ action: "sources.open", tile: "notes" }, USER);
    expect(screen()).toContain("[split ▸]");
    await app.dispatch.act({ action: "placement.menu", tile: "notes", args: { target: "sources" } }, USER);
    screen();
    pane.key({ kind: "down" }, stage);
    pane.key({ kind: "enter" }, stage);
    await until(() => screen().includes("[popup ▸]"), "arrow and Enter choose popup");
    await app.dispatch.act({ action: "sources.place", tile: "notes", args: { place: "split" } }, USER);
    await app.dispatch.act({ action: "sources.close", tile: "notes" }, USER);
  });

  test.each([false, true])("PIE-1065: an attributed output lands with its note open (editing=%s)", async editing => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    const book = await board.createBlock(null, "Check the garden");
    const step = await board.createBlock(book.id, "Check seeds\n\nCurrent notes\n");
    await app.dispatch.act({ action: "open", tile: "notes", args: { id: step.id } }, USER);
    if (editing) {
      await app.dispatch.act({ action: "edit", tile: "notes" }, USER);
      await app.dispatch.act({ action: "edit", tile: "notes" }, USER);
      await until(() => !!board.heldDraft(step.id)?.holdId, "the step's draft held");
      await app.dispatch.act({ action: "draft.place", tile: "notes", args: { line: 2, col: 1 } }, USER);
    }
    await board.request("outputs.place", { blockId: step.id, producer: { id: step.id, name: "Seed check" }, here: "end", content: "seeds-ready",
      mutation: { author: "agent", actorId: "seed-check" } });
    const read = await board.readDraft(step.id);
    expect(read.text).toContain("[!output]");
    expect(read.text).toContain("seeds-ready");
    expect((await board.children(step.id)).filter(b => b.text.includes("[type::draft-proposal]"))).toEqual([]);
    if (editing) {
      expect(read.route).toBe("draft");
      expect((await board.get(step.id))!.text).toBe(step.text);
      await board.request("outputs.place", { blockId: step.id, producer: { id: step.id, name: "Render" }, here: "end", content: "Rendered result",
        mutation: { author: "agent", actorId: "render-script" } });
      expect((await board.readDraft(step.id)).text).toContain("Rendered result");
      expect(screen()).toContain("render-script");
      await app.dispatch.act({ action: "draft.undo", tile: "notes" }, USER);
      expect((await board.readDraft(step.id)).text).toBe(read.text);
      await app.dispatch.act({ action: "edit.close", tile: "notes", args: { discard: true } }, USER);
    }
    await app.dispatch.act({ action: "open", tile: "notes", args: { id: seeded.notes.outputRegions.id } }, USER);
  }, 30_000);

  test("three generated regions read like the prose around them: no box, no header, no buttons; no mark until the cursor is in one", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "output-regions" }, as: "test-agent" });
    screen();
    const id = seeded.notes.outputRegions.id;
    const first = (await board.get(id))!;
    await until(() => screen().includes("Sam sows beans") && /Owner\s.*Week/.test(screen()) && screen().includes("Sam waters the beans"), "the three regions drawn", 15_000);
    // Zero chrome until the cursor is in a region (PIE-956 S6b): no mark is drawn yet.
    const d = h.S().stages.get(h.S().sel).top as Desk;
    const r = d.layoutGet().tiles.find(t => t.name === "notes")!.rect!, stage = h.S().stageRect;
    const body = screen().split("\n").slice(stage.row + r.row + 1, stage.row + r.row + r.rows - 1)
      .map(line => line.slice(stage.col + r.col + 1, stage.col + r.col + r.cols - 1)).join("\n");
    expect(body).not.toContain("\u2261");
    expect(screen()).not.toMatch(/ran (just now|\d+ min ago)|\[keep\]|run again|\[!output\]|╭─ ▾ .*output/);
    // The way in: the header's [sources], S, or a selection's "Where from" opens the Sources inspector beside the note.
    expect(screen()).toContain("[sources]");
    const opened = await app.act({ action: "sources.open", args: {}, tile: "notes", as: "test-agent" }) as { opened?: boolean; sources?: { name: string }[] };
    // An agent reads the note's sources without opening the person's panel: the three regions are listed.
    expect(opened.opened).toBe(false);
    expect(opened.sources?.length).toBeGreaterThanOrEqual(3);
    const csv = await app.act({ action: "sources.download", args: { source: "1", format: "csv" }, tile: "notes", as: "test-agent" }) as { path: string };
    expect(readFileSync(csv.path, "utf8")).toContain('"Owner","Week"');
    expect(readFileSync(csv.path, "utf8")).toContain('"Sam","42"');
    const json = await app.act({ action: "sources.download", args: { source: "1", format: "json" }, tile: "notes", as: "test-agent" }) as { path: string };
    expect(JSON.parse(readFileSync(json.path, "utf8"))).toEqual([{ Owner: "Sam", Week: "42", Crop: "Regions in prose" }]);
    h.press({ kind: "tab" });
    h.ch("S");
    await until(() => screen().includes("Sources · 3 generated regions"), "Sources opened by key");
    h.press({ kind: "enter" });
    h.press({ kind: "enter" });
    await until(() => screen().includes("download CSV"), "Enter opens the source's download controls", 1000);
    // Drawing wrote nothing.
    const after = (await board.get(id))!;
    expect([after.text, after.revision]).toEqual([first.text, first.revision]);
    expect(await board.children(id)).toHaveLength(0);
  }, 40_000);

  test("an image written inside an output region reaches the terminal with its caption", async () => {
    h.press({ kind: "esc" });
    (app as any).lastInput = 0;
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    const video = app.video;
    app.video = "kitty";
    try {
      await until(() => screen().includes("seed-packet.webp") && !screen().includes("loading…"), "the output image decoded", 8000);
      const frame = h.sc.render(app);
      expect(frame.placements?.length ?? 0).toBeGreaterThan(0);
      const caption = frame.lines.findIndex(line => line.includes("seed-packet.webp"));
      expect(frame.placements!.some(p => p.row < caption && p.row + p.rows <= caption)).toBe(true);
      expect(screen()).toContain("Sam waters the beans");
    } finally {
      app.video = video;
    }
  }, 20_000);

});
