// The screens and tile kinds every door ships are one extension's (packages/outliner/extensions/screens): the door
// holds no literal for the ones that are data alone, and takes each kind's description from its row. What the door
// still makes from its own state is listed here, so the list only ever gets shorter.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "../src/desk/screen-specs";
import { App } from "../src/app";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";
import { builtinScreen, extensionScreen, readSpec, screenNames, screenSpec, screenTargetArg } from "../src/desk/screen-spec";
import { SHIPPED_EXTENSION, shippedAbout, shippedKinds, shippedScreens } from "../src/desk/shipped";
import { holdShippedScreens } from "../src/desk/shipped-screens";
import { registerBuiltinTiles } from "../src/desk/builtin-tiles";
import { resolveKind, tileKind } from "../src/desk/tile-kinds";

const MANIFEST = JSON.parse(readFileSync(join(import.meta.dir, "../../outliner/extensions/screens/extension.json"), "utf8")) as {
  id: string; tiles: { kind: string; description: string; replaces: string[] }[]; screens: ({ name: string } & Record<string, unknown>)[];
};

test("the screens that are data alone are the screens extension's, read from its manifest until the host serves them", () => {
  expect(SHIPPED_EXTENSION).toBe("screens");
  holdShippedScreens();
  const theirs = screenNames().filter(name => extensionScreen(name) === SHIPPED_EXTENSION);
  expect(theirs.sort()).toEqual(["kitchen", "lastcall", "navigator", "who"]);
  for (const name of theirs) expect(screenSpec(name), name).toEqual(readSpec(MANIFEST.screens.find(s => s.name === name)));
  // Opened on a target, the tile its spec says carries it: the navigator's query is data, not a function here.
  expect(screenTargetArg("navigator")).toBe("query");
  const opened = screenSpec("navigator", { query: "type=bed" })!;
  expect((opened.layout.root as { kids: { name: string; query?: string }[] }).kids.find(k => k.name === "facets")!.query).toBe("type=bed");
  expect((screenSpec("navigator")!.layout.root as { kids: { name: string; query?: string }[] }).kids.find(k => k.name === "facets")!.query).toBeUndefined();
});

test("the door literals left: the screens it makes from its own state or its own tile kinds", () => {
  // Each is a function of the door's state (the desk's named layouts, the board's hub, the page pinned, where home
  // was opened) or is built of kinds only the door has. One that becomes data moves to the extension and leaves here.
  // (As the door lists them in a process of its own: the contract table of its built-in screens, outline-core's fixtures/screens.json.)
  const table = JSON.parse(readFileSync(join(import.meta.dir, "../../outline-core/fixtures/screens.json"), "utf8")) as { screens: { name: string }[] };
  const left = ["desk", "welcome", "brief", "pinned", "board", "river", "echonet", "blank", "library", "keys", "settings", "detail", "home"];
  expect(table.screens.map(s => s.name)).toEqual(left);
  for (const name of left) expect(builtinScreen(name), name).toBe(true);
  // Four of them share a name with a screen the extension ships for a door with none of its own: the door's stands
  // (its desk and board are made from its own state, and its keys window and library are kinds only it has).
  expect(shippedScreens().map(s => s.name).filter(builtinScreen)).toEqual(["desk", "board", "keys", "library"]);
});

test("a kind's description is its row's, and its served name is the door's own kind", () => {
  registerBuiltinTiles();
  for (const row of MANIFEST.tiles) {
    const own = row.replaces[0]!;
    const kind = tileKind(own);
    // A kind the door has no drawer for (the properties list; a note's comments, proposals and revisions, the keys
    // and the components as lists; the extensions and the outlines as lists) isn't one of its kinds: a tile of it says so.
    if (!kind) { expect(["props", "threads", "proposals", "revisions", "keymap", "components", "extensions", "outlines"]).toContain(own); continue; }
    expect(kind.about, own).toBe(row.description);
    expect(shippedAbout(own)).toBe(row.description);
    expect(resolveKind(`${MANIFEST.id}.${row.kind}`), row.kind).toBe(own);
    expect(tileKind(`${MANIFEST.id}.${row.kind}`)).toBe(kind);
  }
  expect(shippedKinds().map(k => k.served)).toEqual(MANIFEST.tiles.map(t => `screens.${t.kind}`));
  expect(() => shippedAbout("wheelbarrow")).toThrow("the screens extension has no row for the tile kind wheelbarrow");
});

// Installed and uninstalled on a scratch outline the way a person does: the power bar's row, picked, and `act`. The
// scratch host puts the extension in at start, as a host does after a deploy (it is on wherever the service runs).
describe.skipIf(!outliner)("the screens extension, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  const USER = { kind: "user" } as const;
  const top = () => (app as any).stack.at(-1);
  const bar = () => (app as any).bar as { items: { row: { key: string } }[] };
  const served = async () => (await board.request("screens.list", { kinds: [], drawers: ["list", "page"] })) as { screens: { name: string; extension?: string }[]; kinds: { kind: string; extension: string }[] };
  const theirs = async () => { const list = await served(); return { screens: list.screens.filter(s => s.extension === "screens").map(s => s.name), kinds: list.kinds.filter(k => k.extension === "screens").length }; };
  /** Wait until the service lists this many of the extension's kinds. */
  const serves = async (kinds: number) => { for (let i = 0; i < 300; i++) { if ((await theirs()).kinds === kinds) return; await Bun.sleep(50); } throw new Error(`the service lists ${(await theirs()).kinds} of its kinds, not ${kinds}`); };
  /** As the person does: the power bar's extensions, the extension's row picked. */
  const pick = async (key: string) => {
    await app.dispatch.act({ action: "bar.open", args: { scope: "extensions", query: "screens" } }, USER);
    await until(() => !!bar()?.items?.some(i => i.row.key === key), `the ${key} row`, 8000).catch(e => { throw new Error(`${e.message}: ${bar()?.items?.map(i => i.row.key).join(", ")}`); });
    await app.dispatch.act({ action: "bar.pick", args: { n: bar().items.findIndex(i => i.row.key === key) + 1 } }, USER);
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 100, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    await app.loadExtensions(true);
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("installed, the door opens its screens as the host serves them; removed by the bar's row and by act, the service lists none, and it comes back the same two ways", async () => {
    // On from the start: the service lists its screens and kinds, and the door's three are the served ones.
    expect(await theirs()).toEqual({ screens: ["board", "desk", "keys", "kitchen", "lastcall", "library", "navigator", "who"], kinds: 16 });
    for (const name of ["navigator", "lastcall", "who"]) expect(extensionScreen(name), name).toBe("screens");
    expect(app.describe().messages.filter(m => /screens/.test(m.message) && /isn't registered/.test(m.message))).toEqual([]);
    // Used once: last callers opens from its name, its tiles the door's own kinds under the names the rows serve.
    await app.dispatch.act({ action: "screen.open", args: { name: "lastcall" } }, USER);
    await until(() => top().name === "lastcall", "last callers opened");
    expect((top().layoutGet() as { tiles: { name: string; kind: string; unregistered?: string }[] }).tiles.map(t => [t.name, t.kind, t.unregistered ?? null])).toEqual([["activity", "activity", null], ["reader", "reader", null]]);

    // Removed as a person does, by its row in the power bar's extensions.
    await pick("remove:screens:keep");
    await serves(0);
    await app.loadExtensions(true);
    // What is left: the service lists none of its screens or kinds (a window with no screens of its own has nothing
    // to open on, and says so); the door keeps its own kinds, and still holds the three screens from the manifest.
    expect(await theirs()).toEqual({ screens: [], kinds: 0 });
    expect(tileKind("reader")?.about).toBe(shippedAbout("reader"));
    expect(screenNames()).toEqual(expect.arrayContaining(["navigator", "lastcall", "who", "desk", "board"]));

    // Back by act, as an agent installs it.
    await app.act({ action: "extensions.install", args: { id: "screens" }, as: "test-agent" });
    await serves(16);
    expect((await theirs()).screens).toEqual(["board", "desk", "keys", "kitchen", "lastcall", "library", "navigator", "who"]);

    // And the other way round: removed by act, installed by the bar's row.
    await app.loadExtensions(true);
    await app.act({ action: "extensions.uninstall", args: { id: "screens", demo: "keep" }, as: "test-agent" });
    await serves(0);
    await app.loadExtensions(true);
    await pick("install:screens");
    await serves(16);
    await app.loadExtensions(true);
    for (const name of ["navigator", "lastcall", "who"]) expect(extensionScreen(name), name).toBe("screens");
  }, 120_000);
});
