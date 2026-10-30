// The `neat` probe's red loop (Oct 22 root-cause analysis): Evan's status-bar button arranges two readers, folds the
// rest and wires the drawer's links tile to them. Each test is one seam it hit, asserting what should happen; on main
// they go red, each for its own reason. Scratch outline, made-up notes. A red case is `test.failing` until its slice of
// the one-desk wave (pie b567bc2a) makes it pass; that slice turns it into a plain `test`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
import { extensionList } from "../../src/extensions";
import { BacklinksPane } from "../../src/desk/backlinks-pane";
import { ReaderPane } from "../../src/desk/panes";
import { QueryPane } from "../../src/desk/query";
import { registerTileKind, tileKind, unregisterTileKind } from "../../src/desk/tile-kinds";
import { Desk } from "../../src/desk/desk";
import { savedNodes } from "../../src/desk/screen-spec";
import { USER, type Actor } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};

describe.skipIf(!outliner)("neat probe: the seams one button hit", () => {
  const h = useShowcaseScreen();
  const { press } = h;
  let board!: typeof h.board, app!: typeof h.app, seeded!: typeof h.seeded;
  beforeAll(() => { ({ board, app, seeded } = h); });

  let n = 0;
  /** Run `body` as a script on the person's press of its button; its answer, or the error it threw. */
  const pressed = async (body: string, actor: Actor = USER, via: "button" | "rule" | "ask" | "ask-source" | "mcp" = "button"): Promise<string> => {
    const name = `probe-${++n}`;
    let script = await board.createBlock(seeded.notes.scripts.id, [
      `Probe ${n} [script::${name}] [results::keep]`, `::button{label="Probe ${n}" of=${name}}`,
      "```js", "try {", body, "} catch (e) { return 'threw: ' + String(e); }", "```",
    ].join("\n"));
    await app.loadExtensions(true);
    await until(() => !!extensionList()?.extensions.find(e => e.name === name), `script ${name} loaded`);
    if (via === "button") await app.dispatch.act({ action: "button.press", args: { note: script.id, label: `Probe ${n}` } }, actor);
    else if (via === "rule") {
      await board.createBlock(null, `Probe rule [rule-name::${name}] [rule-match::#${name}] [rule-on::script:${name}]`);
      await untilAsync(async () => (await board.request<{ rules: { name: string }[] }>("extensions.list", {})).rules.some(r => r.name === name), "probe rule loaded");
      await board.createBlock(null, `Water the beans #${name}`);
    } else if (via === "mcp") {
      await board.request("mcp.access.configure", { level: "full" });
      await board.request("scripts.run", { blockId: script.id, access: "full", mutation: { author: "agent", actorId: "garden-helper" }, door: board.clientId });
    } else if (via === "ask-source") {
      const responder = `answer-${name}`;
      const folder = join(h.scratch.root, "config", "pi-herdr-outliner", "extensions", responder);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "extension.json"), JSON.stringify({ contract: 2, id: responder, version: 1, name: responder, run: ["bun", "respond.ts"], agents: [{ name: responder, effects: "write" }] }));
      const reply = script.text.replace(`[script::${name}]`, `[script::${name}-source]`);
      writeFileSync(join(folder, "respond.ts"), `await Bun.stdin.json(); console.log(JSON.stringify({ok: true, value: {reply: ${JSON.stringify(reply)}}}));`);
      await app.loadExtensions(true);
      await board.createBlock(null, `Ask for a script\n@${responder} arrange the readers\n`);
      await untilAsync(async () => {
        const found = (await board.queryNotes(`script=${name}-source`, 10)).notes[0];
        if (found) script = found;
        return !!found;
      }, "the answer's authored script");
    } else {
      await board.createBlock(null, `Ask the probe\n@${name}\n`);
    }
    let answer = "";
    await untilAsync(async () => { const c = (await board.children(script.id)).at(-1); answer = c?.text ?? ""; return !!c && !/ · working /.test(answer); }, `script ${name} answered`);
    return answer;
  };

  /** Two readers side by side, the person's keys in `briefing`. */
  const twoReaders = async () => {
    const briefing = await board.createBlock(null, "Garden briefing\nWater the seedlings.");
    const testing = await board.createBlock(null, "Testing the shed\nThe latch sticks.");
    const d = new Desk({ name: "probe", title: "Probe", layout: { root: { t: "split", dir: "row", ratio: 0.5,
      a: { t: "leaf", kind: "reader", name: "briefing" }, b: { t: "leaf", kind: "reader", name: "other" } } } });
    app.push(d);
    await app.dispatch.act({ action: "open", tile: "briefing", args: { id: briefing.id } }, USER);
    await app.dispatch.act({ action: "open", tile: "other", args: { id: testing.id } }, USER);
    await app.dispatch.act({ action: "tile.focus", tile: "briefing" }, USER);
    return { d, briefing, testing, done: () => { app.pop(); d.dispose(); } };
  };
  const shows = (d: Desk, name: string) => ((d as any).layoutGet().tiles.find((t: any) => t.name === name)?.showing?.id) as string | undefined;

  test("opening a query still lets the person pick its view", async () => {
    const s = await twoReaders();
    try {
      const answer = await app.dispatch.act({ action: "tile.open", args: { kind: "query" } }, USER);
      expect(answer).toMatchObject({ picking: "query" });
      expect(s.d.overlaid()).toBe(true);
    } finally { s.done(); }
  });

  test("tile kinds keep their requested options and refuse unused fields", async () => {
    const s = await twoReaders();
    try {
      const answer = await app.dispatch.act({ action: "tile.open", args: { kind: "reader", note: s.testing.id, label: "Seeds" } }, USER) as { tile: string };
      expect((s.d.pane(answer.tile) as ReaderPane).label).toBe("Seeds");
      const query = await app.dispatch.act({ action: "tile.open", args: { kind: "query", query: "#seeds", source: "tile:other", mode: "held" } }, USER) as { tile: string };
      expect((s.d.pane(query.tile) as QueryPane).held).toBe(true);
      expect((s.d.pane(query.tile) as QueryPane).home).toBe("other");
      for (const request of [
        { action: "tile.open", args: { kind: "brief", note: s.testing.id } },
        { action: "tile.open", args: { kind: "echo.reader", note: s.testing.id } },
        { action: "tile.open", args: { kind: "reader", machine: "garden-host" } },
        { action: "tile.open", args: { kind: "preview", source: "file:/tmp/seeds.md", file: "/tmp/beans.md" } },
        { action: "reader.pin", tile: "other", args: { page: "no-such-garden-page" } },
      ]) await expect(app.dispatch.act(request, USER)).rejects.toThrow();
    } finally { s.done(); }
  });

  test("a pinned tile opens its page without a reader mode argument", async () => {
    const s = await twoReaders();
    try {
      const page = await board.createBlock(null, "Seeds [page::garden-pinned]");
      const answer = await app.dispatch.act({ action: "tile.open", args: { kind: "pinned", page: "garden-pinned" } }, USER) as { tile: string };
      await until(() => (s.d.pane(answer.tile) as ReaderPane).msg?.id === page.id, "the pinned example page");
      expect(s.d.tileInfo(answer.tile).showing?.id).toBe(page.id);
    } finally { s.done(); }
  });

  test("placement: a kind refusal says why and one undo restores the layout", async () => {
    class SeedReader extends ReaderPane { readonly kind = "seed-reader"; }
    const reader = tileKind("reader")!;
    registerTileKind({ ...reader, kind: "seed-reader", make: () => new SeedReader(true),
      take: (p, m, d, by) => m.text.startsWith("Refused seed") ? "takes only accepted seeds" : reader.take!(p, m, d, by) });
    const s = await twoReaders();
    try {
      await app.dispatch.act({ action: "tile.open", tile: "other", args: { kind: "seed-reader", name: "seeds" } }, USER);
      await app.dispatch.act({ action: "open", tile: "seeds", args: { id: s.testing.id } }, USER);
      await app.dispatch.act({ action: "tile.focus", tile: "briefing" }, USER);
      const before = s.d.layoutAll();
      const note = await board.createBlock(null, "Refused seed\nKeep the desk as it was.");
      await expect(app.dispatch.act({ action: "open", tile: "seeds", args: { id: note.id } }, USER)).rejects.toThrow("takes only accepted seeds");
      await app.dispatch.act({ action: "layout.undo" }, USER);
      const after = s.d.layoutAll();
      expect(after.tree).toMatchObject({ ...before.tree, id: after.tree.id });
      const contents = (layout: typeof before) => layout.tiles.map(({ tile, showing, collapsed }) => ({ tile, showing, collapsed }));
      expect(contents(after)).toEqual(contents(before));
    } finally { s.done(); unregisterTileKind("seed-reader"); }
  });

  test("placement: a note opened beside an edit keeps its margin setting", async () => {
    const s = await twoReaders();
    try {
      await app.dispatch.act({ action: "margin", tile: "briefing", args: { mode: "off" } }, USER);
      await app.dispatch.act({ action: "edit", tile: "briefing" }, USER);
      await app.dispatch.act({ action: "tile.link", tile: "other", args: { to: "briefing", verb: "open" } }, USER);
      const opened = await app.dispatch.act({ action: "open", args: { from: "other", id: s.testing.id } }, USER) as { tile: string };
      const destination = s.d.pane(opened.tile) as ReaderPane;
      expect(destination.surface.marginMode).toBe("off");
    } finally { s.done(); }
  });

  test("placement: an explicit river-column open keeps the replaced note for Back", async () => {
    const s = await twoReaders();
    try {
      await app.dispatch.act({ action: "tile.open", tile: "other", args: { kind: "river.column", name: "river", source: `block:${s.testing.id}` } }, USER);
      const river = s.d.pane("river") as ReaderPane;
      await until(() => river.surface.msg?.id === s.testing.id, "river reads the old note");
      await app.dispatch.act({ action: "tile.focus", tile: "briefing" }, USER);
      await app.dispatch.act({ action: "open", tile: "river", args: { id: s.briefing.id } }, { kind: "agent", id: "garden-helper" });
      await until(() => river.surface.msg?.id === s.briefing.id, "river reads the replacement");
      await app.dispatch.act({ action: "back", tile: "river" }, USER);
      await until(() => river.surface.msg?.id === s.testing.id, "Back restores the river's replaced note", 1000);
      expect(shows(s.d, "river")).toBe(s.testing.id);
      await app.dispatch.act({ action: "forward", tile: "river" }, USER);
      await until(() => shows(s.d, "river") === s.briefing.id, "Forward restores the river's replacement");
      const saved = join(h.scratch.root, "river-placement.json");
      writeFileSync(saved, JSON.stringify(s.d.savedState()));
      const restored = new Desk(s.d.spec, { saved: JSON.parse(readFileSync(saved, "utf8")) });
      app.push(restored);
      try {
        await until(() => shows(restored, "river") === s.briefing.id, "the saved river reopens");
        // An idle door paints synchronously: Back must update the column's kept root before that paint.
        (app as any).lastPaint = 0;
        await restored.dispatch.act({ action: "back", tile: "river" }, USER);
        await until(() => shows(restored, "river") === s.testing.id, "Back survives reopening the river", 1000);
      } finally { app.pop(); restored.dispose(); }
    } finally { s.done(); }
  });

  for (const shape of ["float", "tabs", "dock", "locked", "no-drop"] as const) test(`placement: ${shape} swaps without a spine and back returns the replaced note`, async () => {
    const s = await twoReaders();
    try {
      if (shape === "float") await app.dispatch.act({ action: "tile.float", tile: "other" }, USER);
      else if (shape === "dock") await app.dispatch.act({ action: "tile.dock", tile: "other", args: { edge: "right" } }, USER);
      else if (shape === "tabs") await app.dispatch.act({ action: "tile.open", tile: "other", args: { kind: "reader", name: "tabmate", where: "tabs" } }, USER);
      else await app.dispatch.act({ action: "layout.policy", args: shape === "locked" ? { locked: true } : { droppable: false } }, USER);
      const floats = (s.d as any).layoutGet().floats;
      const before = s.d.layoutAll();
      const original = before.tiles.find(t => t.name === "other")!;
      const note = await board.createBlock(null, "New seed order\nPlant in spring.");
      await app.dispatch.act({ action: "open", tile: "other", args: { id: note.id } }, USER);
      const after = s.d.layoutAll();
      expect(after.tiles.map(t => t.tile)).toEqual(before.tiles.map(t => t.tile));
      expect(after.tiles.find(t => t.tile === original.tile)?.showing?.id).toBe(note.id);
      expect((s.d as any).layoutGet().floats).toEqual(floats);
      await app.dispatch.act({ action: "back", tile: "other" }, USER);
      await until(() => (s.d.pane("other") as ReaderPane)?.msg?.id === s.testing.id, "back restores the replaced note");
    } finally { s.done(); }
  });

  for (const placement of ["screen", "group", "drawer"] as const) {
    const placed = async () => {
      const s = await twoReaders();
      let owner = s.d, tile = "briefing";
      if (placement !== "screen") {
        await app.dispatch.act({ action: "tile.open", tile: "other", args: { kind: "reader", name: "anchor" } }, USER);
        await app.dispatch.act({ action: "tile.group", tile, args: { name: "nest", with: "other" } }, USER);
        tile = "nest/briefing";
        if (placement === "drawer") {
          await app.dispatch.act({ action: "tile.drawer", tile: "nest" }, USER);
          owner = app.drawer.desk!;
        }
      }
      s.d.render(app);
      if (placement === "drawer") app.drawer.render(200, 60, "Probe");

      if (placement !== "screen") await owner.dispatch.act({ action: "tile.focus", tile: "nest" }, USER);
      await owner.dispatch.act({ action: "tile.focus", tile }, USER);
      return { ...s, owner, tile, cleanup: async () => {
        if (placement === "drawer") await owner.dispatch.act({ action: "tile.close", tile: "nest" }, USER);
        s.done();
      } };
    };

    test(`PIE-1206 round 2: saved reader wires keep select independent of open (${placement})`, async () => {
      const s = await placed();
      const inner = s.owner.resolveTile(s.tile)!.desk;
      try {
        await inner.dispatch.act({ action: "tile.open", tile: "other", args: { kind: "reader", name: "preview" } }, USER);
        await inner.dispatch.act({ action: "tile.link", tile: "briefing", args: { to: "preview", verb: "select" } }, USER);
        await inner.dispatch.act({ action: "tile.link", tile: "briefing", args: { to: "other", verb: "open" } }, USER);
        const saved = join(h.scratch.root, `reader-wires-${placement}.json`);
        writeFileSync(saved, JSON.stringify(inner.savedState()));
        (inner as any).build(JSON.parse(readFileSync(saved, "utf8")), true);
        const tiles = inner.layoutAll().tiles;
        const source = tiles.find(t => t.name === "briefing")!;
        expect(source.wires.find(w => w.verb === "select")?.to).toBe(tiles.find(t => t.name === "preview")!.tile);
        expect(source.wires.find(w => w.verb === "open")?.to).toBe(tiles.find(t => t.name === "other")!.tile);
      } finally { await s.cleanup(); }
    });

    test(`PIE-1206 round 2: wired opens replace held notes and Back restores them (${placement})`, async () => {
      const s = await placed();
      try {
        const inner = s.owner.resolveTile(s.tile)!.desk;
        const other = "other";
        await inner.dispatch.act({ action: "tile.link", tile: "briefing", args: { to: other, verb: "open" } }, USER);
        await inner.dispatch.act({ action: "tile.link", tile: "briefing", args: { to: other, verb: "alt" } }, USER);
        const before = s.owner.layoutAll().tiles.map(t => t.tile);
        for (const fresh of [false, true]) {
          await inner.dispatch.act({ action: "open", args: { from: "briefing", id: s.briefing.id, fresh } }, USER);
          expect(s.owner.layoutAll().tiles.map(t => t.tile)).toEqual(before);
          await inner.dispatch.act({ action: "back", tile: other }, USER);
          await until(() => shows(inner, "other") === s.testing.id, "Back restores the replaced held note", 1000);
        }
      } finally { await s.cleanup(); }
    });

    test(`PIE-1206 round 2: tile.open delivers to an existing name of the same kind (${placement})`, async () => {
      const s = await placed();
      const inner = s.owner.resolveTile(s.tile)!.desk;
      try {
        const before = s.owner.layoutAll().tiles.map(t => t.tile);
        const original = inner.layoutAll().tiles.find(t => t.name === "other")!;
        const result = await inner.dispatch.act({ action: "tile.open", args: { kind: "reader", name: "other", mode: "held", note: s.briefing.id } }, USER) as { tile: string };
        expect(result.tile).toBe(original.tile);
        expect(s.owner.layoutAll().tiles.map(t => t.tile)).toEqual(before);
        await until(() => shows(inner, "other") === s.briefing.id, "the named house takes its note");
        await expect(inner.dispatch.act({ action: "tile.open", args: { kind: "tree", name: "other" } }, USER)).rejects.toThrow(/tile.open.*kind=reader|tile.close.*other/);
      } finally { await s.cleanup(); }
    });

    test(`placement: an unpressed open changes only its named reader (${placement})`, async () => {
      const s = await placed();
      try {
        const other = placement === "screen" ? "other" : "nest/other";
        const before = JSON.stringify(await s.owner.dispatch.act({ action: "tile.info", tile: s.tile }, USER));
        const note = await board.createBlock(null, "Fresh seedlings\nPlant these tomorrow.");
        await s.owner.dispatch.act({ action: "open", tile: other, args: { id: note.id } }, { kind: "agent", id: "garden-helper" });
        const after = JSON.stringify(await s.owner.dispatch.act({ action: "tile.info", tile: s.tile }, USER));
        expect(after).not.toContain(note.id);
        expect(before).not.toContain(note.id);
        expect(JSON.stringify(await s.owner.dispatch.act({ action: "tile.info", tile: other }, USER))).toContain(note.id);
        const scripted = await board.createBlock(null, "Script's seedlings\nLeave the briefing alone.");
        const path = placement === "drawer" ? `@drawer/${other}` : other;
        const answer = await pressed(`await act('open', {tile: '${path}', id: '${scripted.id}'}); return 'opened';`, USER, "mcp");
        expect(answer).toContain("opened");
        expect(JSON.stringify(await s.owner.dispatch.act({ action: "tile.info", tile: s.tile }, USER))).not.toContain(scripted.id);
        expect(JSON.stringify(await s.owner.dispatch.act({ action: "tile.info", tile: other }, USER))).toContain(scripted.id);
      } finally { await s.cleanup(); }
    }, 30_000);

    test(`placement: a named busy reader never redirects an agent into its neighbour (${placement})`, async () => {
      const s = await placed();
      try {
        const other = placement === "screen" ? "other" : "nest/other";
        await s.owner.dispatch.act({ action: "edit", tile: s.tile }, USER);
        await s.owner.dispatch.act({ action: "draft.paste", tile: s.tile, args: { text: "Keep this draft" } }, USER);
        const opened = await s.owner.dispatch.act({ action: "open", tile: s.tile, args: { id: s.testing.id } }, USER) as { tile: string };
        await s.owner.dispatch.act({ action: "tile.focus", tile: opened.tile }, USER);
        const before = s.owner.layoutAll();
        const note = await board.createBlock(null, "Uninvited seed order\nLeave the neighbours alone.");
        await expect(s.owner.dispatch.act({ action: "open", tile: s.tile, args: { id: note.id } }, { kind: "agent", id: "garden-helper" })).rejects.toThrow(/holds.*edit|holds.*draft/);
        expect(s.owner.layoutAll().tiles.map(t => ({ id: t.tile, showing: t.showing }))).toEqual(before.tiles.map(t => ({ id: t.tile, showing: t.showing })));
        expect(JSON.stringify(await s.owner.dispatch.act({ action: "tile.info", tile: opened.tile }, USER))).not.toContain(note.id);
      } finally {
        await s.owner.dispatch.act({ action: "edit.close", tile: s.tile, args: { discard: true } }, USER);
        await s.cleanup();
      }
    });

    test(`placement: ten opens keep the destination and accumulate inner spines (${placement})`, async () => {
      const s = await placed();
      try {
        const other = placement === "screen" ? "other" : "nest/other";
        const initial = s.owner.layoutAll().tiles.find(t => t.name === "other")!;
        let old = s.testing.id;
        for (let i = 0; i < 10; i++) {
          const note = await board.createBlock(null, `Seed tray ${i}\nReady to plant.`);
          await s.owner.dispatch.act({ action: "open", tile: other, args: { id: note.id } }, USER);
          const tiles = s.owner.layoutAll().tiles;
          const destination = tiles.find(t => t.tile === initial.tile)!;
          expect(destination.name).toBe("other");
          expect(JSON.stringify(destination)).toContain(note.id);
          const kept = tiles.find(t => t.tile !== initial.tile && t.kind === "reader" && t.collapsed && JSON.stringify(t.showing ?? null).includes(old));
          expect(kept).toBeDefined();
          expect(kept!.collapsed).toBeTruthy();
          old = note.id;
        }
      } finally { await s.cleanup(); }
    }, 30_000);

    test(`1 standing: a pressed script folds the focused reader (${placement})`, async () => {
      const s = await placed();
      try {
        const answer = await pressed(`await act('tile.collapse', { tile: '${placement === "drawer" ? "@drawer/nest/briefing" : s.tile}', on: true }); return 'folded';`);
        expect(answer).toContain("folded");
        const unfolded = await s.owner.dispatch.act({ action: "tile.collapse", tile: s.tile, args: { on: false } }, USER) as { collapsed: boolean };
        expect(unfolded.collapsed).toBe(false);
      } finally { await s.cleanup(); }
    }, 30_000);

    test(`standing: a press follows, aims and wires a reader's links (${placement})`, async () => {
      const s = await placed();
      try {
        const tile = placement === "drawer" ? "@drawer/nest/briefing" : s.tile;
        const other = "other";
        const answer = await pressed(`
          await act('reader.follow', { tile: '${tile}', source: 'none' });
          const links = await act('links', { tile: '${tile}' });
          await act('tile.link', { tile: links.tile, to: '${other}', verb: 'open' });
          return JSON.stringify({ aimed: links.of, tile: links.tile });
        `);
        expect(answer).toContain(`"aimed":"${s.briefing.id}"`);
        expect(answer).not.toContain("threw:");
        const reader = await s.owner.dispatch.act({ action: "tile.info", tile: s.tile }, USER);
        expect(JSON.stringify(reader)).toContain(s.briefing.id);
      } finally { await s.cleanup(); }
    }, 30_000);

    test(`standing: an agent's button has no invitation (${placement})`, async () => {
      const s = await placed();
      try {
        const answer = await pressed(`await act('tile.collapse', { tile: '${placement === "drawer" ? "@drawer/nest/briefing" : s.tile}', on: true }); return 'folded';`, { kind: "agent", id: "garden-helper" });
        expect(answer).toContain("person's keys");
        expect(answer).not.toContain("\nfolded");
      } finally { await s.cleanup(); }
    }, 30_000);

    for (const via of ["rule", "ask", "ask-source", "mcp"] as const) {
      test(`standing: ${via} has no press invitation (${placement})`, async () => {
        const s = await placed();
        try {
          const tile = placement === "drawer" ? "@drawer/nest/briefing" : s.tile;
          const answer = await pressed(`await act('tile.collapse', { tile: '${tile}', on: true }); return 'folded';`, USER, via);
          expect(answer).toContain("person's keys");
        } finally { await s.cleanup(); }
      }, 30_000);
    }

    if (placement !== "drawer") for (const via of ["button", "rule", "ask", "ask-source", "mcp"] as const) {
      test(`standing: ${via} cannot move focus while the person types (${placement})`, async () => {
        const s = await placed();
        try {
          await s.owner.dispatch.act({ action: "edit", tile: s.tile }, USER);
          press({ kind: "char", ch: "e" });
          press({ kind: "enter" });
          await until(() => s.owner.dispatch.where().busy, "person typing in the editor");
          const before = s.owner.dispatch.where().focus;
          const other = placement === "group" ? "nest/other" : "other";
          const answer = await pressed(`await act('tile.focus', { tile: '${other}' }); return 'moved';`, { kind: "agent", id: "garden-helper" }, via);
          expect(answer).toMatch(/typing|edit/);
          expect(s.owner.dispatch.where().focus).toBe(before);
        } finally {
          await s.owner.dispatch.act({ action: "edit.close", tile: s.tile, args: { discard: true } }, USER);
          await s.cleanup();
        }
      }, 30_000);
    }

    test(`standing: a press moves focus out of the person's typing tile (${placement})`, async () => {
      const s = await placed();
      try {
        await s.owner.dispatch.act({ action: "edit", tile: s.tile }, USER);
        await s.owner.dispatch.act({ action: "draft.paste", tile: s.tile, args: { text: "Keep these seedlings" } }, USER);
        press({ kind: "char", ch: "e" });
        press({ kind: "enter" });
        await until(() => s.owner.dispatch.where().busy, "person typing in the editor");
        const before = s.owner.dispatch.where();
        expect(before.busy).toBe(true);
        const answer = await pressed(`await act('tile.focus', { tile: '${placement === "drawer" ? "@drawer/nest/other" : placement === "group" ? "nest/other" : "other"}' }); return 'moved';`);
        expect(answer).toContain("\nmoved");
        const focused = await s.owner.dispatch.act({ action: "tile.info", tile: placement === "screen" ? "other" : "nest/other" }, USER);
        expect(JSON.stringify(focused)).toContain('"focused":true');
        const menu = await pressed(`await act('tile.menu', { tile: '${placement === "drawer" ? "@drawer/nest/other" : placement === "group" ? "nest/other" : "other"}' }); return 'opened';`);
        expect(menu).toContain("opened");
        const close = await pressed(`await act('edit.close', { tile: '${placement === "drawer" ? "@drawer/nest/briefing" : s.tile}', discard: true }); return 'closed';`);
        expect(close).toContain("closed");
      } finally {
        await s.owner.dispatch.act({ action: "edit.close", tile: s.tile, args: { discard: true } }, USER);
        if (placement === "drawer") app.drawer.leave(s.d, false);
        await s.cleanup();
      }
    }, 30_000);
  }

  test("standing: a press opens the links group's choices and filter", async () => {
    const s = await twoReaders();
    try {
      await app.dispatch.act({ action: "tile.open", args: { kind: "backlinks", name: "garden-links" } }, USER);
      const answer = await pressed(`
        const groups = await act('backlinks.groups', { tile: 'garden-links', choose: true });
        await act('backlinks.view', { tile: 'garden-links', step: 'filter' });
        return 'filter opened';
      `);
      expect(answer).toContain("\nfilter opened");
      expect(s.d.dispatch.where().busy).toBe(true);
    } finally { s.done(); }
  }, 30_000);

  test("standing: a press clears the person's power bar while it holds typing keys", async () => {
    const s = await twoReaders();
    try {
      await app.dispatch.act({ action: "bar.open", args: { query: "seedlings", scope: "notes" } }, USER);
      const edit = await pressed("await act('bar.edit', { op: 'clear' }); return 'cleared';");
      expect(edit).toContain("cleared");
      const read = await app.dispatch.act({ action: "bar.edit", args: { op: "select", from: 0, to: 0 } }, USER) as { query: string };
      expect(read.query).toBe("");
    } finally {
      await app.dispatch.act({ action: "bar.close" }, USER);
      s.done();
    }
  }, 30_000);

  test("2 standing: a script the person pressed opens a note in the reader the person is in", async () => {
    const s = await twoReaders();
    try {
      await pressed(`await act('open', { id: '${s.testing.id}', tile: 'briefing' }); return 'ok';`);
      expect(shows(s.d, "briefing")).toBe(s.testing.id);
    } finally { s.done(); }
  }, 30_000);

  test("3 open: tile.open note= opens that note (no mode= needed)", async () => {
    const s = await twoReaders();
    try {
      await app.dispatch.act({ action: "tile.open", tile: "other", args: { kind: "reader", note: s.briefing.id, name: "third" } }, USER);
      await until(() => shows(s.d, "third") === s.briefing.id, "the held reader reads its note");
      expect(shows(s.d, "third")).toBe(s.briefing.id);
    } finally { s.done(); }
  }, 30_000);

  test("contract: wrong arguments explain the call without changing the desk", async () => {
    const s = await twoReaders();
    try {
      for (const [action, args, reason] of [
        ["layout.move", { where: "rigth" }, "right"],
        ["layout.move", { beside: "briefing" }, "into="],
        ["layout.move", { out: true, to: "briefing" }, "conflicts"],
        ["layout.move", { index: 1, where: "left" }, "where=tabs"],
        ["tile.open", { kind: "reader", id: s.testing.id, note: s.briefing.id }, "conflicts"],
        ["open", { id: s.testing.id, diff: true }, "file="],
        ["open", { id: s.testing.id, against: "/tmp/before.md" }, "file="],
        ["open", { id: s.testing.id, resource: "file:/tmp/unused.md" }, "conflicts"],
        ["open", { file: "/tmp/unused.md", fragment: "heading" }, "conflicts"],
        ["tile.link", { ask: false, to: "briefing" }, "conflicts"],
        ["open", { file: "/tmp/unused.md", from: "other" }, "conflicts"],
        ["open", { file: "/tmp/unused.md", fresh: true }, "conflicts"],
        ["tile.open", { kind: "tree", note: s.testing.id }, "kind=tree"],
      ] as const) {
        await expect(app.dispatch.act({ action, tile: "other", args }, USER)).rejects.toThrow(reason);
      }
      expect(shows(s.d, "briefing")).toBe(s.briefing.id);
      expect(shows(s.d, "other")).toBe(s.testing.id);
    } finally { s.done(); }
  });

  test("contract: layout.get still answers under the message log", async () => {
    const s = await twoReaders();
    try {
      await app.dispatch.act({ action: "status.log" }, USER);
      try {
        const layout = await app.dispatch.act({ action: "layout.get" }, USER) as ReturnType<Desk["layoutAll"]>;
        expect(layout.tiles.some(t => t.name === "briefing")).toBe(true);
      } finally { app.pop(); }
    } finally { s.done(); }
  });

  /** The briefing's links tile, moved into the drawer the way Evan has it. */
  const linksInDrawer = async (s: Awaited<ReturnType<typeof twoReaders>>) => {
    await app.dispatch.act({ action: "tile.open", tile: "other", args: { kind: "backlinks", name: "backlinks" } }, USER);
    await app.dispatch.act({ action: "backlinks", tile: "backlinks", args: { id: s.briefing.id } }, USER);
    await app.dispatch.act({ action: "tile.group", tile: "backlinks", args: { name: "screen" } }, USER);
    await app.dispatch.act({ action: "tile.drawer", tile: "screen" }, USER);
    return () => app.drawer.desk?.dispatch.act({ action: "tile.close", tile: "screen" }, USER);
  };

  for (const place of ["screen", "group", "drawer group"] as const) {
    test(`PIE-1206: each verb replaces its destination in the ${place}`, async () => {
      const s = await twoReaders();
      const act = (action: string, tile?: string, args?: Record<string, unknown>) => app.dispatch.act({ action, tile, args }, USER);
      let group: string | undefined;
      try {
        const made = await act("tile.open", "other", { kind: "backlinks", name: "links" }) as { tile: string };
        const id = made.tile;
        if (place !== "screen") {
          group = (await act("tile.group", id, { name: "parcel" }) as { tile: string }).tile;
          if (place === "drawer group") await act("tile.drawer", group);
        }
        s.d.render(app); app.drawer.render(200, 60, "Probe");
        const first = s.d.layoutAll().tiles.find(t => t.name === "briefing")!.tile;
        const target = s.d.layoutAll().tiles.find(t => t.name === "other")!.tile;
        for (const verb of ["select", "open", "alt"] as const) {
          await act("tile.link", id, { to: first, verb });
          await act("tile.link", id, { to: target, verb });
          const tile = s.d.layoutAll().tiles.find(t => t.tile === id)!;
          expect(tile.wires.filter(w => w.verb === verb)).toEqual([{ verb, to: target }]);
        }
      } finally {
        if (group && app.drawer.made?.resolveTile(group)) await act("tile.close", group);
        s.done();
      }
    }, 30_000);

    test(`PIE-1206: a group refuses wires and names its inner tile in the ${place}`, async () => {
      const s = await twoReaders();
      const act = (action: string, tile?: string, args?: Record<string, unknown>) => app.dispatch.act({ action, tile, args }, USER);
      let outer: string | undefined;
      try {
        const inner = s.d.layoutAll().tiles.find(t => t.name === "other")!.tile;
        const group = (await act("tile.group", inner, { name: "parcel" }) as { tile: string }).tile;
        if (place !== "screen") {
          outer = (await act("tile.group", group, { name: "yard", on: true }) as { tile: string }).tile;
          if (place === "drawer group") await act("tile.drawer", outer);
        }
        s.d.render(app); app.drawer.render(200, 60, "Probe");
        const target = s.d.layoutAll().tiles.find(t => t.name === "briefing")!.tile;
        await expect(act("tile.link", group, { to: target, verb: "select" })).rejects.toThrow(/tile.link tile=.*other|tile.link tile=t-/);
        expect(s.d.layoutAll().tiles.find(t => t.tile === group)!.wires).toEqual([]);
      } finally {
        if (outer && app.drawer.made?.resolveTile(outer)) await act("tile.close", outer);
        s.done();
      }
    }, 30_000);
  }

  for (const kind of ["board", "river"] as const) {
    test(`PIE-1218: a mounted ${kind}'s preview wire survives saving and reopening`, async () => {
      const spec = { name: `mounted-${kind}`, title: "Mounted screen", saves: `mounted-${kind}.json`, layout: {
        root: { t: "leaf" as const, kind, name: "mounted" },
      } };
      const d = new Desk(spec);
      app.push(d);
      try {
        d.render(app);
        await app.dispatch.act({ action: "tile.preview", tile: "mounted" }, USER);
        const tiles = d.layoutAll().tiles;
        expect(tiles.find(t => t.name === "mounted")!.wires).toEqual([{ verb: "select", to: tiles.find(t => t.name === "mounted-preview")!.tile }]);
        const saved = readFileSync(join(process.env.EP0CH_STATE!, spec.saves), "utf8");
        expect(savedNodes(JSON.parse(saved).root).find(t => t.name === "mounted")!.wires).toEqual(tiles.find(t => t.name === "mounted")!.wires);
        const again = new Desk(spec);
        app.push(again);
        try {
          again.render(app);
          const restored = again.layoutAll().tiles;
          expect(restored.find(t => t.name === "mounted")!.wires).toEqual([{ verb: "select", to: restored.find(t => t.name === "mounted-preview")!.tile }]);
          if (kind === "board") expect(again.pane("mounted")!.spec!()).toMatchObject({ preview: false });
        } finally { app.pop(); again.dispose(); }
      } finally { app.pop(); d.dispose(); }
    });
  }

  test("PIE-1218: tile.link on a mounted board lets the person click its preview destination", async () => {
    const d = new Desk({ name: "board-link", title: "Board link", layout: { root: { t: "split", dir: "row", kids: [
      { t: "leaf", kind: "board", name: "mounted" },
      { t: "leaf", kind: "reader", name: "destination" },
    ], weights: [1, 1] } } });
    app.push(d);
    try {
      d.render(app);
      expect(await app.dispatch.act({ action: "tile.link", tile: "mounted", args: { verb: "select", ask: true } }, USER)).toMatchObject({ picking: "select" });
      const target = d.layoutAll().tiles.find(t => t.name === "destination")!;
      press({ kind: "mouse", action: "down", button: 0, x: target.rect!.col + 3, y: target.rect!.row + 3 });
      expect(d.layoutAll().tiles.find(t => t.name === "mounted")!.wires).toEqual([{ verb: "select", to: target.tile }]);
    } finally { app.pop(); d.dispose(); }
  });

  test("PIE-1206: saved duplicate destinations and group wires are repaired on load", async () => {
    const d = new Desk({ name: "wire-load", title: "Wire load", layout: { root: { t: "split", dir: "row", kids: [
      { t: "leaf", kind: "reader", name: "first" },
      { t: "leaf", kind: "reader", name: "last" },
      { t: "leaf", kind: "backlinks", name: "links", wires: [{ verb: "select", to: "first" }, { verb: "select", to: "last" }] },
      { t: "leaf", kind: "backlinks", name: "followed" },
      { t: "leaf", kind: "preview", name: "preview1", source: "tile:followed" },
      { t: "leaf", kind: "preview", name: "preview2", source: "tile:followed" },
      { t: "leaf", kind: "screen", name: "parcel", wires: [{ verb: "select", to: "first" }], inner: { root: { t: "leaf", kind: "reader", name: "inside" } } },
    ], weights: [1, 1, 1, 1] } } });
    app.push(d);
    try {
      const tiles = d.layoutAll().tiles;
      expect(tiles.find(t => t.name === "links")!.wires).toEqual([{ verb: "select", to: tiles.find(t => t.name === "last")!.tile }]);
      expect(tiles.find(t => t.name === "parcel")!.wires).toEqual([]);
      expect(tiles.find(t => t.name === "followed")!.wires).toEqual([{ verb: "select", to: tiles.find(t => t.name === "preview2")!.tile }]);
    } finally { app.pop(); d.dispose(); }
  });

  test("PIE-1206: links pins a following list until b re-aims it", async () => {
    const s = await twoReaders();
    const act = (action: string, tile?: string, args?: Record<string, unknown>) => app.dispatch.act({ action, tile, args }, USER);
    const d = new Desk({ name: "pin-links", title: "Pin links", layout: { root: { t: "split", dir: "row", kids: [
      { t: "leaf", kind: "reader", name: "brief", mode: "held", note: s.briefing.id },
      { t: "leaf", kind: "backlinks", name: "links", source: "tile:brief", subject: "follows" },
    ], weights: [1, 1] } } });
    app.push(d);
    try {
      await until(() => shows(d, "brief") === s.briefing.id, "brief loaded");
      const shown = await act("links", "brief") as { tile: string };
      const list = d.pane(shown.tile) as BacklinksPane;
      await act("open", "brief", { id: s.testing.id });
      d.render(app);
      expect(list.target?.id).toBe(s.briefing.id);
      await act("tile.focus", shown.tile);
      press({ kind: "char", ch: "b" });
      await until(() => list.target?.id === s.testing.id, "b re-aims the pinned list");
    } finally { app.pop(); d.dispose(); s.done(); }
  });

  test("PIE-1206: the links hint names the destinations that open and alt use", async () => {
    const s = await twoReaders(); const off = await linksInDrawer(s);
    try {
      s.d.render(app); app.drawer.render(200, 60, "Probe");
      const shown = await app.dispatch.act({ action: "links", tile: "briefing" }, USER) as { tile: string };
      const tiles = s.d.layoutAll().tiles;
      const a = tiles.find(t => t.name === "briefing")!.tile, b = tiles.find(t => t.name === "other")!.tile;
      await app.dispatch.act({ action: "tile.link", tile: shown.tile, args: { to: b, verb: "open" } }, USER);
      await app.dispatch.act({ action: "tile.link", tile: shown.tile, args: { to: a, verb: "alt" } }, USER);
      const owner = s.d.resolveTile(shown.tile)!.desk, list = owner.pane(shown.tile) as BacklinksPane;
      expect(list.hint()).toContain("open in other");
      expect(list.hint()).toContain("alt+⏎ briefing");
      await app.dispatch.act({ action: "open", args: { from: shown.tile, id: s.briefing.id } }, USER);
      expect(shows(s.d, "other")).toBe(s.briefing.id);
      await app.dispatch.act({ action: "open", args: { from: shown.tile, id: s.testing.id, fresh: true } }, USER);
      expect(shows(s.d, "briefing")).toBe(s.testing.id);
      app.drawer.render(200, 60, "Probe");
      expect(list.target?.id).toBe(s.briefing.id);
    } finally { await off(); s.done(); }
  });

  test("PIE-1206: layout.get reports saved spines and the painted widths", async () => {
    const d = new Desk({ name: "spines", title: "Spines", layout: { root: { t: "split", dir: "row", kids: [
      ...Array.from({ length: 5 }, (_, i) => ({ t: "leaf" as const, kind: "reader", name: `spine${i}` })),
      { t: "leaf", kind: "reader", name: "brief" }, { t: "leaf", kind: "reader", name: "terrible" },
    ], weights: Array(7).fill(1) } } });
    app.push(d);
    try {
      d.render(app);
      for (let i = 0; i < 5; i++) await app.dispatch.act({ action: "tile.collapse", tile: `spine${i}`, args: { on: true } }, USER);
      const layout = await app.dispatch.act({ action: "layout.get" }, USER) as ReturnType<Desk["layoutAll"]>;
      for (const tile of layout.tiles.filter(t => t.name.startsWith("spine"))) {
        expect(tile.collapsed).toBe(true);
        expect(tile.rect?.cols).toBeLessThanOrEqual(3);
      }
      const a = layout.tiles.find(t => t.name === "brief")!, b = layout.tiles.find(t => t.name === "terrible")!;
      expect(Math.abs(a.rect!.cols - b.rect!.cols)).toBeLessThanOrEqual(1);
      expect(a.rect!.cols).toBeGreaterThan(70);
    } finally { app.pop(); d.dispose(); }
  });

  test("PIE-1206: neat twice keeps two equal readers, spines and one destination per verb", async () => {
    const s = await twoReaders();
    const act = (action: string, tile?: string, args?: Record<string, unknown>) => app.dispatch.act({ action, tile, args }, USER);
    const leaf = await board.createBlock(null, "Seed catalogue\nPeas and beans.");
    const tool = await board.createBlock(null, "Tool cupboard\nA copper watering can.");
    await board.update(s.briefing.id, `Garden briefing\n((${leaf.id}|Seed catalogue))\n((${tool.id}|Tool cupboard))`, s.briefing.revision!);
    const off = await linksInDrawer(s);
    await act("tile.open", "@drawer/screen/backlinks", { kind: "preview", name: "preview", source: "tile:backlinks" });
    await act("tile.open", "@drawer/screen/backlinks", { kind: "reader", name: "companion", mode: "held", note: leaf.id });
    try {
      for (let i = 0; i < 5; i++) await act("tile.open", "other", { kind: "reader", name: `spine${i}`, mode: "held", note: leaf.id });
      s.d.render(app); app.drawer.render(200, 60, "Probe");
      const script = `const BRIEF = ${JSON.stringify(s.briefing.id)};
const TERRIBLE = ${JSON.stringify(s.testing.id)};
const failed = [];
const step = async (name, args) => { try { return await act(name, args); } catch (e) { failed.push(\`\${name}: \${String(e).slice(0, 140)}\`); return null; } };
const tiles = async () => (await act('layout.get')).tiles;

// A reader holding a note: one showing it already, else a new held one.
async function readerFor(id, name) {
  const t = (await tiles()).find(x => x.kind === 'reader' && x.showing?.id === id);
  if (t) return t.name;
  const r = await step('tile.open', { kind: 'reader', mode: 'held', note: id, name });
  return r?.tile ?? name;
}
const A = await readerFor(BRIEF, 'brief');
const B = await readerFor(TERRIBLE, 'terrible');
await step('reader.follow', { tile: A, source: 'none' });
await step('reader.follow', { tile: B, source: 'none' });

// side by side, 50/50; every other tile a spine
await step('tile.collapse', { tile: A, on: false });
await step('tile.collapse', { tile: B, on: false });
await step('layout.move', { tile: B, to: A, where: 'right' });
for (const t of await tiles()) if (t.name !== A && t.name !== B && !t.collapsed && t.shown !== false) await step('tile.collapse', { tile: t.name, on: true });
await step('layout.even', {});

// the briefing's links in the drawer, wired: select and open → B, alt → A
const shown = await step('links', { tile: A });
const L = shown?.tile;
if (L) {
  await step('tile.link', { tile: L, to: B, verb: 'select' });
  await step('tile.link', { tile: L, to: B, verb: 'open' });
  await step('tile.link', { tile: L, to: A, verb: 'alt' });
}
return failed.length ? \`neat: \${failed.length} steps failed · \${failed.join(' · ')}\` : \`neat: \${A} | \${B}, links wired\`;
`;
      for (let i = 0; i < 2; i++) {
        const answer = await pressed(script);
        expect(answer).toContain("neat: briefing | other, links wired");
        expect(answer).not.toContain("steps failed");
      }
      const layout = s.d.layoutAll(), a = layout.tiles.find(t => t.name === "briefing")!, b = layout.tiles.find(t => t.name === "other")!;
      expect(Math.abs(a.rect!.cols - b.rect!.cols)).toBeLessThanOrEqual(1);
      for (const tile of layout.tiles.filter(t => t.name.startsWith("spine"))) { expect(tile.collapsed).toBe(true); expect(tile.rect!.cols).toBeLessThanOrEqual(3); }
      const links = layout.tiles.find(t => t.name === "backlinks")!;
      expect(links.wires).toEqual(expect.arrayContaining([{ verb: "select", to: b.tile }, { verb: "open", to: b.tile }, { verb: "alt", to: a.tile }]));
      expect(links.wires).toHaveLength(3);
      expect(layout.tiles.find(t => t.name === "screen")!.wires).toEqual([]);
      for (const how of [{}, { open: true }, { fresh: true }]) {
        const id = how.fresh ? tool.id : leaf.id;
        // A pick shows (the wired select); ⏎ and alt+⏎ are list.open (home, new).
        if (how.open || how.fresh) await act("list.open", links.tile, { id, ...(how.fresh ? { where: "new" } : {}) });
        else await act("list.pick", links.tile, { id });
        expect(shows(s.d, "other")).toBe(leaf.id);
        expect(shows(s.d, "briefing")).toBe(how.fresh ? tool.id : s.briefing.id);
      }
      app.drawer.render(200, 60, "Probe");
      const list = s.d.resolveTile(links.tile)!.desk.pane(links.tile) as BacklinksPane;
      expect(list.target?.id).toBe(s.briefing.id);
      expect(list.hint()).toContain("open in other");
      expect(list.hint()).toContain("alt+⏎ briefing");
    } finally { await off(); s.done(); }
  }, 30_000);

  test("4 address: tile= takes the drawer path that links itself answers", async () => {
    const s = await twoReaders(); const off = await linksInDrawer(s);
    try {
      const shown = await app.dispatch.act({ action: "links", tile: "briefing" }, USER) as { tile?: string };
      expect(shown.tile).toBeTruthy();
      await app.dispatch.act({ action: "tile.link", tile: shown.tile!, args: { to: "other", verb: "open" } }, USER);
    } finally { await off(); s.done(); }
  }, 30_000);

  test("5 layers: layout.get from a script lists the drawer's tiles", async () => {
    const s = await twoReaders(); const off = await linksInDrawer(s);
    try {
      const answer = await pressed("const t = (await act('layout.get')).tiles; return t.map(x => x.name).join(',');");
      expect(answer).toMatch(/backlinks/);
    } finally { await off(); s.done(); }
  }, 30_000);

  test("6a keys (working sibling): alt+l with the keys on a top-level drawer tile links that tile", async () => {
    const s = await twoReaders();
    await app.dispatch.act({ action: "tile.open", tile: "other", args: { kind: "backlinks", name: "loose" } }, USER);
    await app.dispatch.act({ action: "tile.drawer", tile: "loose" }, USER);
    try {
      app.drawer.enter();
      await app.drawer.desk!.dispatch.act({ action: "tile.focus", tile: "loose" }, USER);
      press({ kind: "alt", ch: "l" });
      expect(app.drawer.desk!.linkingFrom()?.constructor.name).toBe("BacklinksPane");
    } finally { press({ kind: "esc" } as any); await app.drawer.desk?.dispatch.act({ action: "tile.close", tile: "loose" }, USER); s.done(); }
  }, 30_000);

  test("6b keys: alt+l with the keys on a drawer tile inside a group links that tile, not the screen's", async () => {
    const s = await twoReaders(); const off = await linksInDrawer(s);
    try {
      app.drawer.enter();
      await app.drawer.desk!.dispatch.act({ action: "tile.focus", tile: "screen/backlinks" }, USER);
      press({ kind: "alt", ch: "l" });
      // the tile the keys are on (the links list), not the group tile that holds it
      expect(app.drawer.desk!.linkingFrom()?.constructor.name).toBe("BacklinksPane");
    } finally { press({ kind: "esc" } as any); await off(); s.done(); }
  }, 30_000);
  test("a wire keeps the target id through the drawer and grouping, then ends when the target closes", async () => {
    const s = await twoReaders();
    const act = (action: string, tile?: string, args?: Record<string, unknown>) => app.dispatch.act({ action, tile, args }, USER);
    const target = s.d.layoutAll().tiles.find(t => t.name === "other")!.tile as string;
    const source = s.d.layoutAll().tiles.find(t => t.name === "briefing")!.tile as string;
    const wire = () => s.d.layoutAll().tiles.find(t => t.tile === source) as any;
    try {
      await act("tile.drawer", target);
      await act("tile.link", source, { to: target, verb: "open" });
      expect(wire().wires).toContainEqual({ verb: "open", to: target });
      await app.dispatch.act({ action: "open", args: { from: source, id: s.briefing.id, fresh: true } }, USER);
      expect(s.d.layoutAll().tiles.find(t => t.tile === target)?.showing?.id).toBe(s.briefing.id);
      await act("back", target);
      expect(s.d.layoutAll().tiles.find(t => t.tile === target)?.showing?.id).toBe(s.testing.id);
      await act("tile.title", target, { text: "Potting bench" });
      await act("tile.group", target, { name: "garden" });
      expect(s.d.layoutAll().tiles.find(t => t.tile === target)?.name).toBe("other");
      expect(wire().wires).toContainEqual({ verb: "open", to: target });
      await act("tile.group", "@drawer/garden", { on: false });
      await act("tile.drawer", target, { on: false });
      expect(wire().wires).toContainEqual({ verb: "open", to: target });
      await act("open", source, { id: s.testing.id });
      await act("tile.close", target);
      expect(wire().wires).not.toContainEqual({ verb: "open", to: target });
      expect(app.describe().messages.some(m => m.message.includes("wire dropped") && m.message.includes(target))).toBe(true);
    } finally {
      const left = app.drawer.made?.resolveTile(target);
      if (left) await left.dispatch.act({ action: "tile.close", tile: target }, USER);
      s.done();
    }
  }, 30_000);

  for (const place of ["screen", "group", "drawer group"]) test(`keys and default actions use the reader in the ${place}`, async () => {
    const s = await twoReaders();
    const act = (action: string, tile?: string, args?: Record<string, unknown>) => app.dispatch.act({ action, tile, args }, USER);
    const id = s.d.layoutAll().tiles.find(t => t.name === "other")!.tile as string;
    let group: string | undefined;
    try {
      if (place !== "screen") {
        await act("tile.open", id, { kind: "reader", name: "companion" });
        const made = await act("tile.group", id, { name: "garden", with: "companion" }) as { tile: string };
        group = made.tile;
        if (place === "drawer group") { await act("tile.drawer", group); app.drawer.enter(); }
      }
      await act("tile.focus", id);
      const tile = () => s.d.layoutAll().tiles.find(t => t.tile === id)!;
      expect(app.person().address).toBe(id);
      press({ kind: "char", ctrl: true, ch: "w" }); press({ kind: "char", ch: "c" });
      expect(tile().collapsed).toBe(true);
      await act("tile.collapse", undefined, { on: false });
      expect(tile().collapsed).toBeFalsy();
      press({ kind: "alt", ch: "h" });
      expect(tile().collapsed).toBe(true);
      await act("tile.collapse", id, { on: false });
      press({ kind: "char", ctrl: true, ch: "w" }); press({ kind: "char", ch: "z" });
      expect(s.d.layoutAll().layers.find(l => l.tiles.some(t => t.tile === id))?.zoom).toBe(id);
      await act("tile.zoom", id, { on: false });
      press({ kind: "char", ctrl: true, ch: "w" }); press({ kind: "char", ch: " " });
      expect((tile() as any).picked).toBe(true);
      await act("tile.select", id, { on: false });
      press({ kind: "char", ch: "b" });
      await until(() => s.d.layoutAll().tiles.some(t => t.kind === "backlinks" && (s.d.resolveTile(t.tile!)!.desk.pane(t.tile!) as BacklinksPane).target?.id === s.testing.id), "b lists the focused reader's links");
      await act("tile.focus", id);
      const target = s.d.layoutAll().tiles.find(t => t.name === "briefing")!.tile;
      for (const [key, verb] of [["s", "select"], ["o", "open"], ["a", "alt"]] as const) {
        await act("tile.focus", id);
        press({ kind: "alt", ch: "l" }); press({ kind: "char", ch: key });
        app.flush();
        const r = s.d.layoutAll().tiles.find(t => t.tile === target)!.rect!;
        press({ kind: "mouse", action: "down", button: 0, x: r.col + 3, y: r.row + 2 });
        press({ kind: "mouse", action: "up", button: 0, x: r.col + 3, y: r.row + 2 });
        expect((tile() as any).wires).toContainEqual({ verb, to: target });
      }
      await act("tile.focus", id);
      const rows = s.d.resolveTile(id)!.dispatch.menu(id, USER);
      for (const row of rows) expect(row.tile).toBe(id);
      const fold = rows.find(r => r.action === "tile.collapse")!;
      expect(fold.tile).toBe(id);
      await app.dispatch.act(fold, USER);
      expect(tile().collapsed).toBe(true);
      await act("tile.collapse", id, { on: false });
      await act("hyper.set", undefined, { on: true });
      press({ kind: "hyper", ch: "-" });
      expect(tile().collapsed).toBe(true);
      press({ kind: "hyper", ch: "=" });
      expect(tile().collapsed).toBeFalsy();
      press({ kind: "hyper", ch: "z" });
      expect(s.d.layoutAll().layers.find(l => l.tiles.some(t => t.tile === id))?.zoom).toBe(id);
      await act("tile.zoom", id, { on: false });
      await act("hyper.set", undefined, { on: false });
      const status = await act("status.bar.pin", undefined, { line: '::button{label="Fold here" act="tile.collapse on=true"}' }) as { note: string };
      try {
        await app.loadExtensions(true);
        await until(() => { app.flush(); return h.painted.at(-1)?.includes("Fold here") ?? false; }, "the address status button");
        const items = await act("status.bar.items") as any;
        const button = items.items.find((i: any) => i.text.includes("Fold here"));
        press({ kind: "mouse", action: "down", button: 0, x: button.from, y: 59 });
        await until(() => tile().collapsed === true, "the button folds the focused tile");
      } finally { await board.trash(status.note); }
    } finally {
      if (group && app.drawer.made?.resolveTile(group)) await act("tile.close", group);
      s.done();
    }
  }, 30_000);

  for (const place of ["screen", "group", "drawer group"]) {
    for (const locked of [false, true]) for (const fixed of locked ? [false, true] : [false]) test(`book repair: ${locked ? `locked sibling keeps its width${fixed ? " beside a fixed container" : ""}` : "stacked children leave an eligible spine"} in the ${place}`, async () => {
      const d = new Desk({ name: "stacked-book", title: "Stacked book", layout: { root: { t: "split", dir: "row", key: "spread", policy: { "min-width": locked ? 0 : 80 }, kids: [
        { t: "split", dir: "col", key: "stack", kids: [
          { t: "leaf", kind: "reader", name: "birch" }, { t: "leaf", kind: "reader", name: "cedar" },
        ], weights: [1, 1] },
        { t: "leaf", kind: "reader", name: "fir" }, { t: "leaf", kind: "reader", name: "elm" },
        ...(fixed ? [{ t: "split" as const, dir: "col" as const, policy: { fixed: 40 }, kids: [{ t: "leaf" as const, kind: "reader", name: "sprig" }], weights: [1] }] : []),
      ], weights: fixed ? [2, 1, 1, 1] : [2, 1, 1] } } });
      app.push(d);
      const act = (action: string, tile?: string, args?: Record<string, unknown>) => app.dispatch.act({ action, tile, args }, USER);
      const ids = Object.fromEntries(d.layoutAll().tiles.map(t => [t.name, t.tile!]));
      let group: string | undefined;
      try {
        if (place !== "screen") {
          group = (await act("tile.group", ids.fir, { node: "spread", name: "woodland" }) as { tile: string }).tile;
          if (place === "drawer group") { await act("tile.open", group, { kind: "reader", name: "landing" }); await act("tile.drawer", group); app.drawer.enter(); }
        }
        const owner = d.resolveTile(ids.fir!)!.desk;
        const tiles = () => { app.flush(); return owner.layoutGet().tiles; };
        d.render(app); app.drawer.render(200, 60, "Probe");
        if (locked) await act("layout.policy", ids.birch, { locked: true });
        await act("tile.collapse", ids.elm, { on: true });
        const before = tiles().find(t => t.tile === ids.birch)!.rect!.cols;
        await act("tile.focus", ids.fir);
        await act("tile.expand", ids.elm);
        const after = tiles();
        expect(after.find(t => t.tile === ids.elm)!.collapsed).toBeFalsy();
        if (locked) expect(after.find(t => t.tile === ids.birch)!.rect!.cols).toBe(before);
        else {
          expect(after.find(t => t.tile === ids.fir)!.collapsed).toBe(true);
          expect(after.filter(t => !t.collapsed).every(t => t.rect!.cols >= 80)).toBe(true);
        }
      } finally {
        if (group && app.drawer.made?.resolveTile(group)) await act("tile.close", group);
        app.pop(); d.dispose();
      }
    }, 30_000);
  }

  for (const place of ["screen", "group", "drawer group"]) for (const count of [14, 15]) test(`align centre: ${count} spines in the ${place}, including a later open`, async () => {
    const names = ["cedar", "fir", ...Array.from({ length: count }, (_, i) => `page-${i}`)];
    const spread = { t: "split" as const, dir: "row" as const, key: "spread", policy: { opensInto: "spread" },
      kids: names.map(name => ({ t: "leaf" as const, kind: "reader", name, mode: "held" as const })), weights: names.map(() => 1) };
    const d = new Desk({ name: "alignment", title: "Alignment", layout: { root: place === "screen"
      ? { t: "split", dir: "col", kids: [
        { t: "split", dir: "row", key: "spread", kids: [{ t: "leaf", kind: "reader", name: "decoy" }], weights: [1] }, spread,
      ], weights: [0.1, 0.9] } : spread } });
    app.push(d);
    const act = (action: string, tile?: string, args?: Record<string, unknown>) => app.dispatch.act({ action, tile, args }, USER);
    const ids = Object.fromEntries(d.layoutAll().tiles.map(t => [t.name, t.tile!]));
    let group: string | undefined;
    try {
      const note = await board.createBlock(null, "Woodland page\nA made-up page for the spread.");
      await act("open", ids.cedar, { id: note.id });
      if (place !== "screen") {
        group = (await act("tile.group", ids.cedar, { node: "spread", name: "woodland" }) as { tile: string }).tile;
        if (place === "drawer group") { await act("tile.open", group, { kind: "reader", name: "landing" }); await act("tile.drawer", group); app.drawer.enter(); }
      }
      app.flush();
      for (const name of names.slice(2)) await act("tile.collapse", ids[name], { on: true });
      await act("layout.gather", ids.cedar, { side: "centre" });
      const owner = d.resolveTile(ids.cedar!)!.desk;
      const check = (n: number) => {
        app.flush();
        const rows = owner.layoutGet().tiles.filter(t => t.rect && t.name !== "decoy").sort((a, b) => a.rect!.col - b.rect!.col);
        const open = rows.filter(t => !t.collapsed);
        expect(open.map(t => t.name)).toEqual(["cedar", "fir"]);
        expect(rows.indexOf(open[0]!)).toBe(Math.floor(n / 2));
        expect(rows.length - rows.indexOf(open[1]!) - 1).toBe(Math.ceil(n / 2));
        expect(rows.filter(t => t.collapsed).map(t => t.name)).toEqual(names.slice(2));
      };
      check(count);
      const next = await board.createBlock(null, "Next woodland page\nThe prior page becomes a spine.");
      await act("open", ids.cedar, { id: next.id });
      app.flush();
      const rows = owner.layoutGet().tiles.filter(t => t.rect && t.name !== "decoy").sort((a, b) => a.rect!.col - b.rect!.col);
      const open = rows.filter(t => !t.collapsed);
      expect(rows.indexOf(open[0]!)).toBe(Math.floor((count + 1) / 2));
      expect(rows.length - rows.indexOf(open.at(-1)!) - 1).toBe(Math.ceil((count + 1) / 2));
      const all = owner.layoutGet().tiles;
      expect(new Set(all.map(t => t.tile)).size).toBe(all.length);
      if (place !== "screen") {
        await act("comment.note", ids.cedar);
        const fresh = await board.createBlock(null, "Third woodland page\nAn open while the first reader has a comment draft.");
        await act("open", undefined, { id: fresh.id, from: ids.cedar });
        app.flush();
        const after = owner.layoutGet().tiles.filter(t => t.rect && t.name !== "decoy").sort((a, b) => a.rect!.col - b.rect!.col);
        const pages = after.filter(t => !t.collapsed);
        expect(pages).toHaveLength(3);
        expect(after.indexOf(pages[0]!)).toBe(Math.floor((count + 1) / 2));
        expect(after.length - after.indexOf(pages.at(-1)!) - 1).toBe(Math.ceil((count + 1) / 2));
        await act("comment.close", ids.cedar);
      }
      expect((await act("layout.policy", ids.cedar) as any).effective.spines).toBe("centre");
    } finally {
      if (group && app.drawer.made?.resolveTile(group)) await act("tile.close", group);
      app.pop(); d.dispose();
    }
  }, 30_000);

  for (const place of ["screen", "group", "drawer group"]) {
    for (const row of ["manual fold", "pushed left", "pushed right", "gather left", "gather right", "gather sides", "fair share", "outer page", "minimum boundary", "non-resizable", "oldest folds"]) test(`book spines: ${row} in the ${place}`, async () => {
      const names = ["birch", "cedar", "elm", "fir", "oak"];
      const d = new Desk({ name: "book", title: "Book", layout: { root: { t: "split", dir: "row", key: "spread",
        kids: names.map(name => ({ t: "leaf", kind: "reader", name, mode: "held" })), weights: [1, 4, 0.1, 2, 1] } } });
      app.push(d);
      const act = (action: string, tile?: string, args?: Record<string, unknown>) => app.dispatch.act({ action, tile, args }, USER);
      const ids = Object.fromEntries(d.layoutAll().tiles.map(t => [t.name, t.tile!]));
      let group: string | undefined;
      try {
        for (const name of names) {
          const m = await board.createBlock(null, `${name} page\nA made-up woodland page.`);
          await act("open", ids[name], { id: m.id });
        }
        if (place !== "screen") {
          const made = await act("tile.group", ids.cedar, { node: "spread", name: "woodland" }) as { tile: string };
          group = made.tile;
          if (place === "drawer group") {
            await act("tile.open", group, { kind: "reader", name: "landing" });
            await act("tile.drawer", group); app.drawer.enter();
          }
        }
        app.flush();
        const owner = d.resolveTile(ids.cedar!)!.desk;
        const tiles = () => { app.flush(); return owner.layoutGet().tiles; };
        const tile = (name: string) => tiles().find(t => t.tile === ids[name])!;
        const ordered = () => tiles().slice().sort((a, b) => a.rect!.col - b.rect!.col);
        await act("tile.collapse", ids.birch, { on: true });
        await act("tile.collapse", row === "outer page" ? ids.cedar : ids.elm, { on: true });
        await act("tile.collapse", ids.oak, { on: true });
        if (row === "manual fold") {
          expect(ordered().map(t => t.name)).toEqual(names);
        } else if (row.startsWith("pushed")) {
          const target = row === "pushed left" ? "cedar" : "fir";
          const fresh = await board.createBlock(null, "New page\nThe next woodland page.");
          await act("open", ids[target], { id: fresh.id });
          const order = ordered();
          const kept = order.filter(t => t.collapsed && !names.includes(t.name!));
          expect(kept).toHaveLength(1);
          const i = order.indexOf(kept[0]!);
          expect(row === "pushed left" ? i < order.findIndex(t => t.name === "cedar") : i > order.findIndex(t => t.name === "fir")).toBe(true);
          expect(row === "pushed left" ? order[i - 1]!.name : order[i + 1]!.name).toBe(row === "pushed left" ? "birch" : "oak");
        } else if (row.startsWith("gather")) {
          const side = row.split(" ")[1]!;
          await act("layout.gather", ids.cedar, { side });
          const order = ordered(), open = order.filter(t => !t.collapsed);
          expect(order.indexOf(open[1]!) - order.indexOf(open[0]!)).toBe(1);
          if (side === "left") expect(order.slice(0, 3).every(t => t.collapsed)).toBe(true);
          if (side === "right") expect(order.slice(-3).every(t => t.collapsed)).toBe(true);
          if (side === "sides") { expect(order[0]!.collapsed).toBe(true); expect(order.at(-1)!.collapsed).toBe(true); }
          expect((await act("layout.policy", ids.cedar) as any).effective.spines).toBe(side === "left" ? "start" : side === "right" ? "end" : "book");
        } else if (row === "non-resizable") {
          await act("layout.policy", ids.cedar, { resizable: false, locked: true });
          await expect(act("tile.expand", ids.elm)).rejects.toThrow(/locked/);
          await act("layout.policy", ids.cedar, { locked: false });
          await act("tile.expand", ids.elm);
          expect(tile("elm").collapsed).toBeFalsy();
          expect(tile("elm").rect!.cols).toBeGreaterThan(3);
        } else if (row === "outer page") {
          await act("tile.expand", ids.birch);
          const order = ordered(), open = order.filter(t => !t.collapsed);
          expect(order.indexOf(open.at(-1)!) - order.indexOf(open[0]!), JSON.stringify(order.map(t => [t.name, t.collapsed]))).toBe(open.length - 1);
          expect(Math.max(...open.map(t => t.rect!.cols)) - Math.min(...open.map(t => t.rect!.cols))).toBeLessThanOrEqual(1);
        } else {
          if (row === "minimum boundary") await act("layout.policy", ids.cedar, { "min-width": Math.floor((tiles().reduce((sum, t) => sum + t.rect!.cols, 0) - 6) / 3) });
          if (row === "oldest folds") await act("layout.policy", ids.cedar, { "min-width": Math.floor((tile("cedar").rect!.cols + tile("fir").rect!.cols - 10) / 2) });
          await act("tile.focus", ids.cedar);
          await act("tile.focus", ids.fir);
          await act("tile.expand", ids.elm);
          expect(tile("elm").collapsed).toBeFalsy();
          const open = tiles().filter(t => !t.collapsed);
          if (row === "minimum boundary") expect(open).toHaveLength(3);
          else if (row === "fair share") expect(Math.max(...open.map(t => t.rect!.cols)) - Math.min(...open.map(t => t.rect!.cols))).toBeLessThanOrEqual(1);
          else { expect(tile("cedar").collapsed).toBe(true); expect(tile("fir").collapsed).toBeFalsy(); }
        }
      } finally {
        if (group && app.drawer.made?.resolveTile(group)) await act("tile.close", group);
        app.pop(); d.dispose();
      }
    }, 30_000);
  }

  for (const place of ["screen", "group", "drawer group"]) test(`book flow: gathers actual squeezed spines and shares open columns in the ${place}`, async () => {
    const names = ["ash", "beech", "birch", "cedar", "elm", "fir", "oak"];
    const d = new Desk({ name: "flow-book", title: "Flow book", layout: { root: { t: "flow", key: "pages",
      kids: names.map(name => ({ t: "leaf", kind: "reader", name, mode: "held" })), policy: { "min-width": 70 } } } });
    app.push(d);
    const act = (action: string, tile?: string, args?: Record<string, unknown>) => app.dispatch.act({ action, tile, args }, USER);
    const ids = Object.fromEntries(d.layoutAll().tiles.map(t => [t.name, t.tile!]));
    let group: string | undefined;
    try {
      if (place !== "screen") {
        group = (await act("tile.group", ids.cedar, { node: "pages", name: "leaves" }) as { tile: string }).tile;
        if (place === "drawer group") { await act("tile.open", group, { kind: "reader", name: "landing" }); await act("tile.drawer", group); app.drawer.enter(); }
      }
      app.flush();
      const owner = d.resolveTile(ids.cedar!)!.desk;
      const tiles = () => { app.flush(); return owner.layoutGet().tiles.filter(t => t.rect).sort((a, b) => a.rect!.col - b.rect!.col); };
      await act("tile.focus", ids.ash);
      await act("tile.focus", ids.fir);
      await act("tile.widen", ids.cedar);
      expect(tiles().find(t => t.name === "fir")!.cover).toBe("full");
      expect(tiles().find(t => t.name === "ash")!.cover).not.toBe("full");
      const beforeFocus = tiles().map(t => [t.tile, t.rect]);
      await act("tile.focus", ids.ash);
      expect(tiles().map(t => [t.tile, t.rect])).toEqual(beforeFocus);
      for (const side of ["left", "right", "sides"] as const) {
        await act("layout.gather", ids.cedar, { side });
        const order = tiles(), spines = order.filter(t => t.cover === "spine"), open = order.filter(t => t.cover !== "spine");
        expect(spines.length).toBeGreaterThan(0);
        expect(order.indexOf(open.at(-1)!) - order.indexOf(open[0]!), JSON.stringify(order.map(t => [t.name, t.collapsed]))).toBe(open.length - 1);
        if (side === "left") expect(order.slice(0, spines.length).every(t => t.cover === "spine")).toBe(true);
        if (side === "right" || side === "sides") expect(order.slice(-spines.length).every(t => t.cover === "spine")).toBe(true);
        const full = order.filter(t => t.cover === "full");
        expect(full.length).toBeGreaterThan(1);
        expect(Math.max(...full.map(t => t.rect!.cols)) - Math.min(...full.map(t => t.rect!.cols))).toBeLessThanOrEqual(1);
      }
      const width = tiles().reduce((sum, t) => sum + t.rect!.cols, 0);
      await act("layout.policy", ids.cedar, { "min-width": Math.floor((width - (names.length - 2) * 3) / 2) });
      await act("layout.gather", ids.cedar, { side: "left" });
      const before = tiles(), full = before.filter(t => t.cover === "full");
      const arriving = before.find(t => t.cover === "spine")!;
      await act("tile.focus", full.at(-1)!.tile!);
      await act("tile.widen", arriving.tile!);
      const after = tiles(), folded = after.find(t => full.some(f => f.tile === t.tile) && t.cover === "spine")!;
      expect(folded).toBeDefined();
      const stack = after.filter(t => t.cover === "spine" && t.rect!.col < after.find(t => t.cover === "full")!.rect!.col);
      expect(stack.at(-1)!.tile).toBe(folded.tile);
      await act("layout.policy", ids.cedar, { clear: "min-width" });
      const defaultWidth = tiles().map(t => [t.tile, t.cover, t.rect]);
      await act("layout.policy", ids.cedar, { "min-width": 40 });
      expect(tiles().map(t => [t.tile, t.cover, t.rect])).toEqual(defaultWidth);
      await act("layout.policy", ids.cedar, { "min-width": 0 });
      expect(tiles().every(t => t.cover === "full")).toBe(true);
      await act("layout.policy", ids.cedar, { "min-width": 70 });
      await act("tile.hold", ids.beech, { on: true });
      expect(tiles().find(t => t.name === "beech")!.cover).toBe("full");
    } finally {
      if (group && app.drawer.made?.resolveTile(group)) await act("tile.close", group);
      app.pop(); d.dispose();
    }
  }, 30_000);

  test("two grouped tiles named kettle require an id or a path", async () => {
    const s = await twoReaders();
    try {
      for (const name of ["west", "east"]) {
        const tile = await app.dispatch.act({ action: "tile.open", tile: "briefing", args: { kind: "reader", name: "kettle" } }, USER) as { tile: string };
        await app.dispatch.act({ action: "tile.group", tile: tile.tile, args: { name } }, USER);
      }
      await expect(app.dispatch.act({ action: "tile.info", tile: "kettle" }, USER)).rejects.toThrow(/several tiles named kettle/);
      const west = await app.dispatch.act({ action: "tile.info", tile: "west/kettle" }, USER) as { tile: string };
      const east = await app.dispatch.act({ action: "tile.info", tile: "east/kettle" }, USER) as { tile: string };
      expect(west.tile).not.toBe(east.tile);
      await app.dispatch.act({ action: "tile.title", tile: west.tile, args: { text: "Copper kettle" } }, USER);
      const tiles = s.d.layoutAll().tiles;
      expect(tiles.find(t => t.tile === west.tile)?.title).toBe("Copper kettle");
      expect(tiles.find(t => t.tile === east.tile)?.collapsed).toBeFalsy();
    } finally { s.done(); }
  }, 30_000);

});
