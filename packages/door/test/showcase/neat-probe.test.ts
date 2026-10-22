// The `neat` probe's red loop (Oct 22 root-cause analysis): Evan's status-bar button arranges two readers, folds the
// rest and wires the drawer's links tile to them. Each test is one seam it hit, asserting what should happen; on main
// they go red, each for its own reason. Scratch outline, made-up notes. Not a fix: the evidence the analysis works from.
import { beforeAll, describe, expect, test } from "bun:test";
import { extensionList } from "../../src/extensions";
import { Desk } from "../../src/desk/desk";
import { USER } from "../../src/socket";
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
  const pressed = async (body: string): Promise<string> => {
    const name = `probe-${++n}`;
    const script = await board.createBlock(seeded.notes.scripts.id, [
      `Probe ${n} [script::${name}] [results::keep]`, `::button{label="Probe ${n}" of=${name}}`,
      "```js", "try {", body, "} catch (e) { return 'threw: ' + String(e); }", "```",
    ].join("\n"));
    await app.loadExtensions(true);
    await until(() => !!extensionList()?.extensions.find(e => e.name === name), `script ${name} loaded`);
    await app.dispatch.act({ action: "button.press", args: { note: script.id, label: `Probe ${n}` } }, USER);
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

  test("1 standing: a script the person pressed folds the reader the person is in", async () => {
    const s = await twoReaders();
    try {
      const answer = await pressed("await act('tile.collapse', { tile: 'briefing', on: true }); return 'ok';");
      expect(answer).toContain("ok");
      expect((s.d as any).layout.collapsed.has((s.d as any).tile("briefing").id)).toBe(true);
    } finally { s.done(); }
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
});
