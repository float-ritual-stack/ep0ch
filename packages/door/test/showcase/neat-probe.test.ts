// The `neat` probe's red loop (Oct 22 root-cause analysis): Evan's status-bar button arranges two readers, folds the
// rest and wires the drawer's links tile to them. Each test is one seam it hit, asserting what should happen; on main
// they go red, each for its own reason. Scratch outline, made-up notes. A red case is `test.failing` until its slice of
// the one-desk wave (pie b567bc2a) makes it pass; that slice turns it into a plain `test`.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
import { extensionList } from "../../src/extensions";
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

    // turns green with slice 1 (one-desk-address)
    const standingTest = placement === "drawer" ? test.failing : test;
    standingTest(`1 standing: a pressed script folds the focused reader (${placement})`, async () => {
      const s = await placed();
      try {
        const answer = await pressed(`await act('tile.collapse', { tile: '${placement === "drawer" ? "@drawer/nest/briefing" : s.tile}', on: true }); return 'folded';`);
        expect(answer).toContain("folded");
        const unfolded = await s.owner.dispatch.act({ action: "tile.collapse", tile: s.tile, args: { on: false } }, USER) as { collapsed: boolean };
        expect(unfolded.collapsed).toBe(false);
      } finally { await s.cleanup(); }
    }, 30_000);

    standingTest(`standing: a press follows, aims and wires a reader's links (${placement})`, async () => {
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

    standingTest(`standing: an agent's button has no invitation (${placement})`, async () => {
      const s = await placed();
      try {
        const answer = await pressed(`await act('tile.collapse', { tile: '${placement === "drawer" ? "@drawer/nest/briefing" : s.tile}', on: true }); return 'folded';`, { kind: "agent", id: "garden-helper" });
        expect(answer).toContain("person's keys");
        expect(answer).not.toContain("\nfolded");
      } finally { await s.cleanup(); }
    }, 30_000);

    for (const via of ["rule", "ask", "ask-source", "mcp"] as const) {
      standingTest(`standing: ${via} has no press invitation (${placement})`, async () => {
        const s = await placed();
        try {
          const tile = placement === "drawer" ? "@drawer/nest/briefing" : s.tile;
          const answer = await pressed(`await act('tile.collapse', { tile: '${tile}', on: true }); return 'folded';`, USER, via);
          expect(answer).toContain("person's keys");
        } finally { await s.cleanup(); }
      }, 30_000);
    }

    standingTest(`standing: a press leaves the person's typing and keys in place (${placement})`, async () => {
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
        expect(answer).toMatch(/typing|edit/);
        expect(s.owner.dispatch.where().focus).toBe(before.focus);
        const menu = await pressed(`await act('tile.menu', { tile: '${placement === "drawer" ? "@drawer/nest/other" : placement === "group" ? "nest/other" : "other"}' }); return 'opened';`);
        expect(menu).toMatch(/typing|edit/);
        const close = await pressed(`await act('edit.close', { tile: '${placement === "drawer" ? "@drawer/nest/briefing" : s.tile}', discard: true }); return 'closed';`);
        expect(close).toMatch(/typing/);
      } finally {
        await s.owner.dispatch.act({ action: "edit.close", tile: s.tile, args: { discard: true } }, USER);
        if (placement === "drawer") app.drawer.leave(s.d, false);
        await s.cleanup();
      }
    }, 30_000);
  }

  test("standing: a press cannot clear or pick the person's power bar while it holds typing keys", async () => {
    const s = await twoReaders();
    try {
      await app.dispatch.act({ action: "bar.open", args: { query: "seedlings", scope: "notes" } }, USER);
      const edit = await pressed("await act('bar.edit', { op: 'clear' }); return 'cleared';");
      expect(edit).toMatch(/typing|power bar/);
      const pick = await pressed("await act('bar.pick', { n: 1 }); return 'picked';");
      expect(pick).toMatch(/typing|power bar/);
      const read = await app.dispatch.act({ action: "bar.edit", args: { op: "select", from: 0, to: 0 } }, USER) as { query: string };
      expect(read.query).toBe("seedlings");
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

  test.failing("4 address: tile= takes the drawer path that links itself answers", async () => {
    const s = await twoReaders(); const off = await linksInDrawer(s);
    try {
      const shown = await app.dispatch.act({ action: "links", tile: "briefing" }, USER) as { tile?: string };
      expect(shown.tile).toBeTruthy();
      await app.dispatch.act({ action: "tile.link", tile: shown.tile!, args: { to: "other", verb: "open" } }, USER);
    } finally { await off(); s.done(); }
  }, 30_000);

  test.failing("5 layers: layout.get from a script lists the drawer's tiles", async () => {
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

  test.failing("6b keys: alt+l with the keys on a drawer tile inside a group links that tile, not the screen's", async () => {
    const s = await twoReaders(); const off = await linksInDrawer(s);
    try {
      app.drawer.enter();
      await app.drawer.desk!.dispatch.act({ action: "tile.focus", tile: "screen/backlinks" }, USER);
      press({ kind: "alt", ch: "l" });
      // the tile the keys are on (the links list), not the group tile that holds it
      expect(app.drawer.desk!.linkingFrom()?.constructor.name).toBe("BacklinksPane");
    } finally { press({ kind: "esc" } as any); await off(); s.done(); }
  }, 30_000);
});
