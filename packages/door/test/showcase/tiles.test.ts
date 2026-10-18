import { startControl } from "../../src/control";
import { Mirror } from "../../src/mirror";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
// PIE-439: the showcase screen, tiles: terminal, menu and made screens. One of the showcase's test files (split from the one file, so a
// section's test is a file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { osc52 } from "../../src/surface/selection";
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
import { marks } from "./marks";
import { prop } from "../../src/props";

describe.skipIf(!outliner)("the showcase screen: tiles: terminal, menu and made screens", () => {
  const h = useShowcaseScreen();
  const { scratch, written, press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });


  test("a foreign outline note opens and saves on this screen", async () => {
    (app as any).lastInput = 0;
    const foreign = new SocketBoard(scratch.sock, undefined, "showcase-orchard");
    try {
      await foreign.info();
      const id = prop(seeded.notes.crossOutline, "foreign-note")!;
      const note = (await foreign.get(id))!;
      await app.act({ action: "section", args: { name: "cross-outline" }, as: "test-agent" });
      screen();
      await until(() => !!S().stages.get(S().sel), "the desk");
      const d = S().stages.get(S().sel).top;
      await until(() => d.pane("orchard-note")?.msg?.id === note.id, "the foreign note", 2000);
      expect(d.pane("orchard-note").msg.text).toContain("Water the pear tree.");
      await app.act({ action: "edit", tile: "orchard-note", as: "test-agent" });
      await app.act({ action: "draft.paste", tile: "orchard-note", args: { text: "Watered today. " }, as: "test-agent" });
      await app.act({ action: "edit.save", tile: "orchard-note", as: "test-agent" });
      expect((await foreign.get(note.id))?.text).toContain("Watered today.");
      expect(await board.get(note.id)).toBeNull();
      expect(d.pane("orchard-note").spec()).toMatchObject({ outline: "showcase-orchard" });
      expect(screen()).toContain("showcase-orchard ·");
      await app.act({ action: "edit.close", tile: "orchard-note", as: "test-agent" });
      await app.act({ action: "passage.select", tile: "orchard-note", args: { quote: "Water the pear tree." }, as: "test-agent" });
      await app.act({ action: "comment.write", tile: "orchard-note", args: { body: "Checked the soil." }, as: "test-agent" });
      await app.act({ action: "comment.send", tile: "orchard-note", as: "test-agent" });
      expect((await foreign.comments(note.id)).some(c => c.body === "Checked the soil.")).toBe(true);
      await app.act({ action: "comment.close", tile: "orchard-note", as: "test-agent" });
      const saved = JSON.parse(JSON.stringify(d.saved()));
      d.build(saved, true);
      await until(() => d.pane("orchard-note")?.msg?.id === note.id, "restored foreign note");
      await app.act({ action: "link.follow", tile: "orchard-note", args: { n: 1 }, as: "test-agent" });
      expect(d.pane("orchard-note").msg.text).toContain("Water deeply");
      await app.act({ action: "back", tile: "orchard-note", as: "test-agent" });
      expect(d.pane("orchard-note").msg.id).toBe(note.id);
      await app.act({ action: "tile.open", args: { kind: "detail", name: "another-orchard", note: note.id, outline: "showcase-orchard" }, as: "test-agent" });
      await until(() => d.pane("another-orchard")?.msg?.id === note.id, "act tile.open in orchard");
      const rows = await app.act({ action: "bar.open", args: { scope: "notes", query: "outline:showcase-orchard pear" }, as: "test-agent" }) as any;
      expect(rows.rows.some((r: any) => r.label.includes("Pear tree"))).toBe(true);
      const ctl = await startControl({ app, mirror: new Mirror(200, 60), info: () => app.t }, join(scratch.root, "foreign.sock"));
      try {
        const uri = formatEp0chBlockUri({ outline: "showcase-orchard", machine: (await foreign.info()).machine!, blockId: note.id });
        const cli = Bun.spawn(["bun", "src/main.ts", "open", uri, "--as", "test-agent"], { cwd: join(import.meta.dir, "../.."), env: { ...process.env, ...scratch.env, EP0CH_CONTROL: ctl.path }, stdout: "pipe", stderr: "pipe" });
        const err = await new Response(cli.stderr).text();
        expect({ exit: await cli.exited, err }).toEqual({ exit: 0, err: "" });
      } finally { ctl.close(); }
      await app.act({ action: "open", tile: "guide", args: { id: seeded.notes.crossOutline.id }, as: "test-agent" });
      await app.act({ action: "link.follow", tile: "guide", args: { n: 1 }, as: "test-agent" });
      expect(d.pane("guide").msg.id).toBe(note.id);
      await app.act({ action: "open", tile: "guide", args: { id: seeded.notes.crossOutline.id }, as: "test-agent" });
      await app.act({ action: "links", tile: "guide", as: "test-agent" });
      const links = () => [...d.panes.values()].find((p: any) => p.kind === "backlinks") as any;
      await until(() => links()?.authored.kind === "ready", "the guide's links loaded");
      await until(() => links()?.rows().some((r: any) => r.kind === "resource"), "the guide's link row");
      const row = links().rows().findIndex((r: any) => r.kind === "resource");
      const linksName = d.nameOfPane(links());
      await app.act({ action: "backlinks.open", tile: linksName, args: { n: row + 1 }, as: "test-agent" });
      expect(d.pane("guide").msg.id).toBe(note.id);
      const latest = (await foreign.get(note.id))!;
      await foreign.update(note.id, latest.text + "\nMulched by another client.", latest.revision!);
      await until(() => d.pane("orchard-note").msg.text.includes("Mulched by another client."), "the foreign change feed");
    } finally { foreign.close(); }
  }, 20_000);

  test("tree, preview, detail from scratch: select stays in the preview, Enter opens, alt opens a new reader", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "select-open" }, as: "test-agent" });
    const index = SECTIONS.findIndex(s => s.key === "select-open");
    screen();
    await until(() => !!S().stages.get(index), "the select/open stage");
    const d = S().stages.get(index).top as any;
    const act = (action: string, args: Record<string, unknown> = {}, tile = "tree") => d.dispatch.act({ action, args, tile }, { kind: "user" });
    await until(() => !!d.pane("tree-preview") && d.layoutGet().tiles.find((t: any) => t.name === "tree")?.link === "detail", "the default preview and open wire");
    await act("tile.link", { verb: "select" });
    await act("tile.link", { ask: true, verb: "select" });
    screen();
    const preview = d.layoutGet().tiles.find((t: any) => t.name === "tree-preview").rect;
    d.key({ kind: "mouse", action: "down", button: 0, x: preview.col + 3, y: preview.row + 3 }, d.ctx);
    const before = d.pane("detail").msg.id;
    await act("tree.pick", { id: seeded.notes.root.id });
    await until(() => d.pane("tree-preview").msg?.id === seeded.notes.root.id, "the tree selection in its preview");
    expect(d.pane("detail").msg.id).toBe(before);
    expect(d.current.id).toBe(before);
    await act("tree.pick", { id: seeded.notes.root.id, open: true });
    await until(() => d.pane("detail").msg?.id === seeded.notes.root.id, "Enter in the linked detail");
    const count = d.layoutGet().tiles.length;
    await act("tree.pick", { id: seeded.notes.shed.id, fresh: true });
    await until(() => d.layoutGet().tiles.length === count + 1, "alt-open's new reader");
    expect(d.pane("detail").msg.id).toBe(seeded.notes.root.id);
    expect(d.layoutGet().tiles.some((t: any) => t.name !== "detail" && t.kind === "reader" && t.showing?.id === seeded.notes.shed.id)).toBe(true);
    const firstAlt = d.layoutGet().tiles.find((t: any) => t.kind === "reader" && t.name !== "detail" && t.name !== "tree-preview").name;
    d.build(d.saved(), true);
    for (const note of [seeded.notes.root, seeded.notes.notebook, seeded.notes.shed, seeded.notes.root]) {
      await act("tree.pick", { id: note.id, fresh: true });
    }
    const pile = d.layoutGet().tiles.filter((t: any) => t.kind === "reader" && t.name !== "detail" && t.name !== "tree-preview");
    expect(pile.length).toBe(5);
    expect(pile.find((t: any) => t.name === firstAlt).collapsed).toBe(true);
    const back = pile.find((t: any) => t.collapsed);
    expect(back.showing.id).toBe(seeded.notes.shed.id);
    await act("tile.collapse", { on: false }, back.name);
    expect(d.pane(back.name).msg.id).toBe(seeded.notes.shed.id);
    screen();
    expect(d.layoutGet().tiles.find((t: any) => t.name === back.name).rect.cols).toBeGreaterThanOrEqual(48);
    await act("reader.mode", { mode: "held" }, back.name);
    await act("tree.pick", { id: seeded.notes.notebook.id, fresh: true });
    expect(d.layoutGet().tiles.find((t: any) => t.name === back.name).collapsed).not.toBe(true);
    await act("tile.link", { verb: "alt", rule: "tab", to: "detail" });
    d.build(d.saved(), true);
    const tabsBefore = d.layoutGet().tiles.length;
    await act("tree.pick", { id: seeded.notes.notebook.id, fresh: true });
    expect(d.layoutGet().tiles.length).toBe(tabsBefore + 1);
    expect(d.tileOutline().find((t: any) => t.name === "detail")).toMatchObject({ tab: true, shown: false });
    await act("tile.link", { verb: "select" });
    await act("tree.pick", { id: seeded.notes.shed.id });
    await until(() => d.pane("detail").msg?.id === seeded.notes.shed.id, "without select targets the current note follows the tree");
  }, 20_000);

  test("terminal: the tile's program copies (OSC 52), and the door passes it on to the person's terminal, said as the tile's", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "terminal" }, as: "test-agent" })).toMatchObject({ key: "terminal" });
    await until(() => screen().includes("copy from it as Claude Code does"), "the shell in the stage", 8000);
    const copying = (what: string, done: string) => `printf '\\033]52;c;?\\007'; printf '\\033]52;c;%s\\007' "$(printf '${what}' | base64)"; echo ${done}-$((6*7))`;
    const before = written.length;
    const copies = () => written.slice(before).filter(w => w.includes("\x1b]52;"));
    // An agent typing it into the shell: the person isn't using the tile, so it isn't passed on, and the toast says so.
    for (let i = 0; ; i++) {
      try { await app.act({ action: "tile.type", tile: "t2", args: { text: copying("Pull the bindweed", "agent") + "\\n" }, as: "test-agent" }); break; }
      catch (e) { if (i > 50 || !/isn't running/.test((e as Error).message)) throw e; await Bun.sleep(100); }
    }
    await until(() => screen().includes("agent-42"), "the agent's command to run", 8000);
    await until(() => (app as any).toast?.text === "not copied from sh · you haven't typed or clicked in it for 2 min · click in it, then copy again", "the toast", 5000);
    app.redraw(); await until(() => h.painted.map(plain).join("\n").includes("✗ not copied from sh · you haven't typed or clicked in it for 2 min · click in it, then copy again"), "the toast drawn", 3000);
    expect(copies()).toEqual([]);
    // The person clicks in the tile and types it.
    const r = S().stageRect, t = (S().stages.get(SECTIONS.findIndex(s => s.key === "terminal")).top.describe().panes as any[]).find(x => x.kind === "pty");
    const at = { x: r.col + t.rect.col + 3, y: r.row + t.rect.row + 3 };
    press({ kind: "mouse", action: "down", button: 0, ...at }); press({ kind: "mouse", action: "up", button: 0, ...at });
    for (const c of copying("Turn the compost", "copied")) ch(c);
    press({ kind: "enter" });
    await until(() => copies().length > 0, "the copy written to the terminal", 8000);
    await Bun.sleep(150);
    expect(copies()).toEqual([osc52("Turn the compost")]);
    expect((app as any).toast?.text).toBe("copied from sh · 16 chars");
    app.redraw(); await until(() => h.painted.map(plain).join("\n").includes("✓ copied from sh · 16 chars"), "the toast drawn", 3000);
    // Back to the door: the click a moment ago still counts, so the same agent's copy now reaches the person.
    press({ kind: "char", ch: "]", ctrl: true });
    await app.act({ action: "tile.type", tile: "t2", args: { text: copying("Mulch the roses", "again") + "\\n" }, as: "test-agent" });
    await until(() => copies().length > 1, "the second copy written to the terminal", 8000);
    expect(copies().at(-1)).toBe(osc52("Mulch the roses"));
    // A drag across the line it printed: the door selects it and copies on release (PIE-716).
    const line = h.painted.map(plain).findIndex(l => l.includes("Plant out the courgettes")), x0 = h.painted.map(plain)[line]!.indexOf("Plant");
    const n = copies().length;
    press({ kind: "mouse", action: "down", button: 0, x: x0, y: line }); press({ kind: "mouse", action: "drag", button: 0, x: x0 + 4, y: line }); press({ kind: "mouse", action: "up", button: 0, x: x0 + 4, y: line });
    await until(() => copies().length > n, "the drag's copy written to the terminal", 5000);
    expect(copies().at(-1)).toBe(osc52("Plant"));
    press({ kind: "char", ch: "]", ctrl: true });                // the press went into the tile, as a click does
    press({ kind: "esc" });
  }, 20_000);


  test("the menu section (PIE-492): an agent's tile.menu answers rows; the ⋯ and a right-click open it; a row runs as the person; the terminal keeps its right-click", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "menu" }, as: "test-agent" });
    await until(() => marks.menu!.every(m => screen().includes(m)), "the menu section");
    const stage = () => S().stages.get(S().sel).top;
    const overlay = () => stage().overlays.top() as { name: string; items: any[] } | null;
    // An agent: the rows as data, nothing drawn.
    const out = await app.act({ action: "tile.menu", tile: "reader", args: {}, as: "test-agent" }) as any;
    expect(out.rows.map((r: any) => r.group)).toEqual(expect.arrayContaining(["Tile", "Note"]));
    expect(out.rows.find((r: any) => r.action === "tile.zoom")).toMatchObject({ label: "zoom", key: "ctrl+w z" });
    expect(overlay()).toBeNull();
    const at = S().stageRect, tiles = () => stage().describe().panes as any[];
    const click = (x: number, y: number, button = 0) => { press({ kind: "mouse", action: "down", button, x, y }); press({ kind: "mouse", action: "up", button, x, y }); };
    // The person: a click on the reader's ⋯ opens it; one click on zoom runs it.
    sc.render(app);
    const b = (stage().menuButtons as any[]).find(x => stage().nameOf(x.id) === "reader");
    click(at.col + b.from, at.row + b.row);
    await until(() => overlay()?.name === "tile menu", "the ⋯ opens the reader's menu");
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => /\bzoom\s+\^W z/.test(l));
    expect(y).toBeGreaterThan(0);
    // The menu's row, not the index's "open, split, zoom" a scrolled index can put on the same row.
    click(rows[y]!.search(/\bzoom\s+\^W z/), y);
    await until(() => stage().zoom !== null, "zoom ran from the menu");
    expect(overlay()).toBeNull();
    await app.act({ action: "tile.zoom", tile: "reader", args: { on: false }, as: "test-agent" }).catch(() => stage().dispatch.press("tile.zoom", { on: false }, "reader"));
    // A right-click in the reader opens it at the pointer; esc puts it away.
    sc.render(app);
    const r = tiles().find(x => x.name === "reader").rect;
    click(at.col + r.col + 4, at.row + r.row + 4, 2);
    await until(() => overlay()?.name === "tile menu", "a right-click opens the reader's menu");
    // Typing filters it (PIE-879): the query shows, the rows left are the matches, esc clears it before it closes.
    const every = overlay()!.items.length;
    for (const c of "zoom") ch(c);
    expect(overlay()!.items.length).toBeLessThan(every);
    expect(overlay()!.items.map((r: any) => r.action)).toContain("tile.zoom");
    expect(sc.render(app).lines.map(plain).join("\n")).toContain("zoom");
    press({ kind: "esc" });
    expect(overlay()!.items.length).toBe(every);
    press({ kind: "esc" });
    expect(overlay()).toBeNull();
    // The terminal's program asked for the mouse: its right-click is the program's, and its ⋯ still opens the menu.
    await until(() => stage().pane("clicks")?.wantsMouse?.() === true, "the program asked for the mouse");
    sc.render(app);
    const t = tiles().find(x => x.name === "clicks").rect;
    click(at.col + t.col + 4, at.row + t.row + 4, 2);
    expect(overlay()).toBeNull();
    sc.render(app);
    const tb = (stage().menuButtons as any[]).find(x => stage().nameOf(x.id) === "clicks");
    click(at.col + tb.from, at.row + tb.row);
    await until(() => overlay()?.name === "tile menu", "the terminal's ⋯ opens its menu");
    expect(overlay()!.items.map(x => x.group)).toContain("Terminal");
    press({ kind: "esc" });
    expect(overlay()).toBeNull();
    // The right-click went into the terminal (a click there types in it): ctrl+] leaves it, then esc to the index.
    press({ kind: "char", ch: "]", ctrl: true });
    for (let i = 0; i < 4 && S().focus !== "index"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 20_000);


  test("made, by the person: a blank screen started from a detail; a click on its + New note runs note.new, as ctrl+n does, and writes in that detail", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "made" }, as: "test-agent" });
    await until(() => marks.made!.every(m => screen().includes(m)), "the blank screen");
    const stage = () => S().stages.get(S().sel).top;
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // d: a detail in the blank's place (its row, as the person picks it).
    press({ kind: "char", ch: "d" });
    await until(() => (stage().layoutGet().tiles as any[]).some(t => t.kind === "reader" && t.mode === "held"), "a detail in the blank's place");
    await until(() => screen().includes("+ New note"), "the empty detail's + New note");
    // A click on + New note, as a mouse event on the screen: the same note.new ctrl+n runs.
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => l.includes("+ New note")), x = rows[y]!.indexOf("+ New note") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    const detail = () => stage().pane((stage().layoutGet().tiles as any[]).find(t => t.kind === "reader" && t.mode === "held").name);
    await until(() => !!detail()?.surface?.draft, "the new note's edit in the detail, by the click", 8000);
    const id = detail().surface.draft.blockId;
    expect(await board.get(id)).toBeTruthy();
    // Nothing typed: esc puts it in the trash, and the detail is empty again.
    press({ kind: "esc" });
    const end = Date.now() + 5000;
    while (!(await board.isTrashed(id))) { if (Date.now() > end) throw new Error("the empty note wasn't trashed"); await Bun.sleep(30); }
    for (let i = 0; i < 6 && S().focus === "stage"; i++) press({ kind: "esc" });
    // Put back as the next test expects it: a fresh blank stage.
    S().stages.delete(S().sel);
  }, 20_000);


  test("made (PIE-565): a blank screen built through act, saved as a screen note, opened again by name, then deleted", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "made" }, as: "test-agent" });
    await until(() => marks.made!.every(m => screen().includes(m)), "the blank screen");
    const stage = () => S().stages.get(S().sel).top;
    const tiles = () => stage().layoutGet().tiles as any[];
    await app.act({ action: "blank.fill", tile: "blank", args: { kind: "tree" }, as: "test-agent" });
    await app.act({ action: "tile.open", tile: "tree", args: { kind: "detail", where: "right" }, as: "test-agent" });
    await app.act({ action: "tile.link", tile: "tree", args: { to: "detail" }, as: "test-agent" });
    expect(tiles().map(t => t.kind)).toEqual(["tree", "reader"])   // kind=detail opens a held reader (PIE-705); the tile keeps the name "detail";
    const saved = await app.act({ action: "screen.save", args: { name: "Allotment work" }, as: "test-agent" }) as any;
    // Named the way it is typed: the title is kept, the answer says the slug it saved under.
    expect(saved).toMatchObject({ screen: "allotment-work", title: "Allotment work", slug: "allotment-work", created: true, tiles: ["tree", "detail"] });
    const note = await board.get(saved.note);
    expect([prop(note, "type"), prop(note, "screen")]).toEqual(["screen", "allotment-work"]);
    expect(note!.author).toBe("test-agent");               // attributed to the agent that saved it
    // Opened again by name, as `ep0ch --screen allotment-work` does: the same tiles, the outline's opens landing in the detail.
    await app.act({ action: "screen.open", args: { name: "allotment work" }, as: "test-agent" });
    const top = () => app.screens().at(-1) as any;
    await until(() => top().name === "allotment-work", "the saved screen opened");
    expect((top().layoutGet().tiles as any[]).map(t => [t.name, t.link ?? null])).toEqual([["tree", "detail"], ["detail", null]]);
    await app.act({ action: "screen.back", args: {}, as: "test-agent" });
    await until(() => top() === sc, "back on the showcase");
    expect(await app.act({ action: "screen.delete", args: { name: "allotment-work" }, as: "test-agent" })).toMatchObject({ trashed: true });
    expect(await board.isTrashed(saved.note)).toBe(true);
  }, 20_000);
});
