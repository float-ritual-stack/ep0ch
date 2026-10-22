// The `neat` probe's red loop (Oct 22 root-cause analysis): Evan's status-bar button arranges two readers, folds the
// rest and wires the drawer's links tile to them. Each test is one seam it hit, asserting what should happen; on main
// they go red, each for its own reason. Scratch outline, made-up notes. A red case is `test.failing` until its slice of
// the one-desk wave (pie b567bc2a) makes it pass; that slice turns it into a plain `test`.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
import { extensionList } from "../../src/extensions";
import { BacklinksPane } from "../../src/desk/backlinks-pane";
import { ReaderPane } from "../../src/desk/panes";
import { registerTileKind, tileKind, unregisterTileKind } from "../../src/desk/tile-kinds";
import { Desk } from "../../src/desk/desk";
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
    await app.dispatch.act({ action: "reader.mode", tile: "briefing", args: { mode: "held" } }, USER);
    await app.dispatch.act({ action: "reader.mode", tile: "other", args: { mode: "held" } }, USER);
    await app.dispatch.act({ action: "open", tile: "briefing", args: { id: briefing.id } }, USER);
    await app.dispatch.act({ action: "open", tile: "other", args: { id: testing.id } }, USER);
    await app.dispatch.act({ action: "tile.focus", tile: "briefing" }, USER);
    return { d, briefing, testing, done: () => { app.pop(); d.dispose(); } };
  };
  const shows = (d: Desk, name: string) => ((d as any).layoutGet().tiles.find((t: any) => t.name === name)?.showing?.id) as string | undefined;

  test("placement: a kind refusal says why and one undo restores the layout", async () => {
    class SeedReader extends ReaderPane { readonly kind = "seed-reader"; }
    const reader = tileKind("reader")!;
    registerTileKind({ ...reader, kind: "seed-reader", make: () => new SeedReader(true),
      take: (p, m, d, by) => m.text.startsWith("Refused seed") ? "takes only accepted seeds" : reader.take!(p, m, d, by) });
    const s = await twoReaders();
    try {
      await app.dispatch.act({ action: "tile.open", tile: "other", args: { kind: "seed-reader", name: "seeds" } }, USER);
      await app.dispatch.act({ action: "reader.mode", tile: "seeds", args: { mode: "held" } }, USER);
      await app.dispatch.act({ action: "open", tile: "seeds", args: { id: s.testing.id } }, USER);
      await app.dispatch.act({ action: "tile.focus", tile: "briefing" }, USER);
      const before = s.d.layoutAll();
      const note = await board.createBlock(null, "Refused seed\nKeep the desk as it was.");
      await expect(app.dispatch.act({ action: "open", tile: "seeds", args: { id: note.id } }, USER)).rejects.toThrow("takes only accepted seeds");
      await app.dispatch.act({ action: "layout.undo" }, USER);
      const after = s.d.layoutAll();
      expect(after.tree).toMatchObject({ ...before.tree, id: after.tree.id });
      const contents = (layout: typeof before) => layout.tiles.map(({ id, showing, collapsed }) => ({ id, showing, collapsed }));
      expect(contents(after)).toEqual(contents(before));
    } finally { s.done(); unregisterTileKind("seed-reader"); }
  });

  test("placement: a note opened beside an edit keeps its margin setting", async () => {
    const s = await twoReaders();
    try {
      await app.dispatch.act({ action: "margin", tile: "briefing", args: { mode: "off" } }, USER);
      await app.dispatch.act({ action: "edit", tile: "briefing" }, USER);
      await app.dispatch.act({ action: "tile.link", tile: "other", args: { to: "briefing", verb: "open" } }, USER);
      const opened = await app.dispatch.act({ action: "open", args: { from: "other", id: s.testing.id } }, USER) as { reader: string };
      const destination = s.d.pane(opened.reader) as ReaderPane;
      expect(destination.surface.marginMode).toBe("off");
    } finally { s.done(); }
  });

  for (const shape of ["float", "tabs", "dock"] as const) test(`placement: ${shape} swaps without a spine and back returns the replaced note`, async () => {
    const s = await twoReaders();
    try {
      if (shape === "float") await app.dispatch.act({ action: "tile.float", tile: "other" }, USER);
      else if (shape === "dock") await app.dispatch.act({ action: "tile.dock", tile: "other", args: { edge: "right" } }, USER);
      else await app.dispatch.act({ action: "tile.open", tile: "other", args: { kind: "reader", name: "tabmate", where: "tabs" } }, USER);
      const floats = (s.d as any).layoutGet().floats;
      const before = s.d.layoutAll();
      const original = before.tiles.find(t => t.name === "other")!;
      const note = await board.createBlock(null, "New seed order\nPlant in spring.");
      await app.dispatch.act({ action: "open", tile: "other", args: { id: note.id } }, USER);
      const after = s.d.layoutAll();
      expect(after.tiles.map(t => t.id)).toEqual(before.tiles.map(t => t.id));
      expect(after.tiles.find(t => t.id === original.id)?.showing?.id).toBe(note.id);
      expect((s.d as any).layoutGet().floats).toEqual(floats);
      await app.dispatch.act({ action: "back", tile: "other" }, USER);
      await until(() => shows(s.d, "other") === s.testing.id, "back restores the replaced note");
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

    test(`placement: an unpressed open changes only its named reader (${placement})`, async () => {
      const s = await placed();
      try {
        const other = placement === "screen" ? "other" : "nest/other";
        await s.owner.dispatch.act({ action: "reader.mode", tile: s.tile, args: { mode: "follows" } }, USER);
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
          const destination = tiles.find(t => t.id === initial.id)!;
          expect(destination.name).toBe("other");
          expect(JSON.stringify(destination)).toContain(note.id);
          const kept = tiles.find(t => t.id !== initial.id && t.kind === "reader" && t.collapsed && JSON.stringify(t.showing ?? null).includes(old));
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

  test.failing("3 open: tile.open note= opens that note (no mode= needed)", async () => {
    const s = await twoReaders();
    try {
      await app.dispatch.act({ action: "tile.open", tile: "other", args: { kind: "reader", note: s.briefing.id, name: "third" } }, USER);
      expect(shows(s.d, "third")).toBe(s.briefing.id);
    } finally { s.done(); }
  }, 30_000);

  /** The briefing's links tile, moved into the drawer the way Evan has it. */
  const linksInDrawer = async (s: Awaited<ReturnType<typeof twoReaders>>) => {
    await app.dispatch.act({ action: "tile.open", tile: "other", args: { kind: "backlinks", name: "backlinks" } }, USER);
    await app.dispatch.act({ action: "backlinks", tile: "backlinks", args: { id: s.briefing.id } }, USER);
    await app.dispatch.act({ action: "tile.group", tile: "backlinks", args: { name: "screen" } }, USER);
    await app.dispatch.act({ action: "tile.drawer", tile: "screen" }, USER);
    return () => app.drawer.desk?.dispatch.act({ action: "tile.close", tile: "screen" }, USER);
  };

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
    const target = s.d.layoutAll().tiles.find(t => t.name === "other")!.id as string;
    const source = s.d.layoutAll().tiles.find(t => t.name === "briefing")!.id as string;
    const wire = () => s.d.layoutAll().tiles.find(t => t.id === source) as any;
    try {
      await act("tile.drawer", target);
      await act("tile.link", source, { to: target, verb: "open" });
      expect(wire().wires).toContainEqual({ verb: "open", to: target });
      await app.dispatch.act({ action: "open", args: { from: source, id: s.briefing.id, fresh: true } }, USER);
      expect(s.d.layoutAll().tiles.find(t => t.id === target)?.showing?.id).toBe(s.briefing.id);
      await act("back", target);
      expect(s.d.layoutAll().tiles.find(t => t.id === target)?.showing?.id).toBe(s.testing.id);
      await act("tile.title", target, { text: "Potting bench" });
      await act("tile.group", target, { name: "garden" });
      expect(s.d.layoutAll().tiles.find(t => t.id === target)?.name).toBe("other");
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
    const id = s.d.layoutAll().tiles.find(t => t.name === "other")!.id as string;
    let group: string | undefined;
    try {
      if (place !== "screen") {
        await act("tile.open", id, { kind: "reader", name: "companion" });
        const made = await act("tile.group", id, { name: "garden", with: "companion" }) as { id: string };
        group = made.id;
        if (place === "drawer group") { await act("tile.drawer", group); app.drawer.enter(); }
      }
      await act("tile.focus", id);
      const tile = () => s.d.layoutAll().tiles.find(t => t.id === id)!;
      expect(app.person().address).toBe(id);
      press({ kind: "char", ctrl: true, ch: "w" }); press({ kind: "char", ch: "c" });
      expect(tile().collapsed).toBe(true);
      await act("tile.collapse", undefined, { on: false });
      expect(tile().collapsed).toBeFalsy();
      press({ kind: "alt", ch: "h" });
      expect(tile().collapsed).toBe(true);
      await act("tile.collapse", id, { on: false });
      press({ kind: "char", ctrl: true, ch: "w" }); press({ kind: "char", ch: "z" });
      expect(s.d.layoutAll().layers.find(l => l.tiles.some(t => t.id === id))?.zoom).toBe(id);
      await act("tile.zoom", id, { on: false });
      press({ kind: "char", ctrl: true, ch: "w" }); press({ kind: "char", ch: " " });
      expect((tile() as any).picked).toBe(true);
      await act("tile.select", id, { on: false });
      press({ kind: "char", ch: "b" });
      await until(() => s.d.layoutAll().tiles.some(t => t.kind === "backlinks" && (s.d.resolveTile(t.id!)!.desk.pane(t.id!) as BacklinksPane).target?.id === s.testing.id), "b lists the focused reader's links");
      await act("tile.focus", id);
      const target = s.d.layoutAll().tiles.find(t => t.name === "briefing")!.id;
      for (const [key, verb] of [["s", "select"], ["o", "open"], ["a", "alt"]] as const) {
        await act("tile.focus", id);
        press({ kind: "alt", ch: "l" }); press({ kind: "char", ch: key });
        app.flush();
        const r = s.d.layoutAll().tiles.find(t => t.id === target)!.rect!;
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
      expect(s.d.layoutAll().layers.find(l => l.tiles.some(t => t.id === id))?.zoom).toBe(id);
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

  test("two grouped tiles named kettle require an id or a path", async () => {
    const s = await twoReaders();
    try {
      for (const name of ["west", "east"]) {
        const tile = await app.dispatch.act({ action: "tile.open", tile: "briefing", args: { kind: "reader", name: "kettle" } }, USER) as { id: string };
        await app.dispatch.act({ action: "tile.group", tile: tile.id, args: { name } }, USER);
      }
      await expect(app.dispatch.act({ action: "tile.info", tile: "kettle" }, USER)).rejects.toThrow(/several tiles named kettle/);
      const west = await app.dispatch.act({ action: "tile.info", tile: "west/kettle" }, USER) as { id: string };
      const east = await app.dispatch.act({ action: "tile.info", tile: "east/kettle" }, USER) as { id: string };
      expect(west.id).not.toBe(east.id);
      await app.dispatch.act({ action: "tile.title", tile: west.id, args: { text: "Copper kettle" } }, USER);
      const tiles = s.d.layoutAll().tiles;
      expect(tiles.find(t => t.id === west.id)?.title).toBe("Copper kettle");
      expect(tiles.find(t => t.id === east.id)?.collapsed).toBeFalsy();
    } finally { s.done(); }
  }, 30_000);

});
