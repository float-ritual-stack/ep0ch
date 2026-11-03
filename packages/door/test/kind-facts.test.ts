// PIE-1523: tile kinds state their own facts. Each kind says what a tile of it is now (an edit, a program running, the
// keys in it, a pin); Desk.facts merges that with what only the desk knows, and the layout reads TileFacts alone.
import { describe, expect, test } from "bun:test";
import "../src/desk/desk";
import { registerBuiltinTiles } from "../src/desk/builtin-tiles";
import { ReaderPane } from "../src/desk/panes";
import { PtyPane } from "../src/desk/pty";
import { declaredFacts, factsOf, registerTileKind, serviceKind, tileKind, tileKinds, unregisterTileKind, type TileKind } from "../src/desk/tile-kinds";
import { briefKind } from "../src/brief/brief";
import { echoKinds } from "../src/echonet/screen";
import { pinnedKind } from "../src/hub/pinned";
import { welcomeKinds } from "../src/hub/welcome";

registerBuiltinTiles();
for (const k of [briefKind(), pinnedKind(), ...welcomeKinds(), ...echoKinds()]) if (!tileKind(k.kind)) registerTileKind(k);

const AGENT = { kind: "agent", id: "wren" } as const;

describe("tile kinds state their own facts (PIE-1523)", () => {
  test("a reader says its trail and its pin; a held reader is holdable; an unpinned one isn't pinned", () => {
    const pinned = tileKind("reader")!.make({ kind: "reader", mode: "pinned", note: "n-1" });
    expect(factsOf(pinned)).toMatchObject({ history: true, lists: false, pinned: true, holdable: true });
    expect(factsOf(pinned).editing).toBeUndefined();
    const free = tileKind("reader")!.make({ kind: "reader" });
    expect(factsOf(free)).toMatchObject({ history: true, pinned: false });
  });

  test("a terminal says the program running in it, and nothing once it has exited", () => {
    const t = tileKind("pty")!.make({ kind: "pty", cmd: ["nvim", "plan.md"] }) as PtyPane;
    expect(factsOf(t)).toEqual({});
    (t as unknown as { proc: object }).proc = {};
    expect(factsOf(t)).toEqual({ running: "nvim" });
    t.exited = 0;
    expect(factsOf(t)).toEqual({});
  });

  test("an extension's program still running after its extension is removed keeps saying so: an agent can't end it by closing its tile", () => {
    const k = serviceKind({ kind: "lantern.glow", about: "a made-up program tile", program: { command: ["lantern"], cwd: "/", env: {}, args: {}, label: "Lantern" }, holds: { keys: true } });
    registerTileKind(k);
    const t = k.make({ kind: "lantern.glow" }) as PtyPane;
    (t as unknown as { proc: object }).proc = {};
    expect(factsOf(t)).toMatchObject({ running: "lantern" });
    // The extension goes: the tile is kept alive with its program (the desk's kindsChanged reads lastKindOf), and so are its facts.
    unregisterTileKind("lantern.glow", "its extension was removed");
    expect(tileKind("lantern.glow")).toBeUndefined();
    expect(factsOf(t)).toMatchObject({ running: "lantern" });
  });

  test("a declared hold (an extension's tiles[].holds) holds the keys only while they're on the tile, and names its edit to an agent alone", () => {
    const f = declaredFacts({ keys: true, edit: "a hand of patience" });
    const p = { kind: "x" } as never;
    expect(f(p, { keys: false, actor: AGENT })).toEqual({});
    expect(f(p, { keys: true, actor: AGENT })).toEqual({ holdsKeys: true, typing: true, holds: true, editing: "a hand of patience" });
    // The person's own close is never refused for an edit only an agent is told of.
    expect(f(p, { keys: true, actor: { kind: "user" } })).toEqual({ holdsKeys: true, typing: true, holds: true });
    expect(declaredFacts(undefined)(p, { keys: true })).toEqual({});
  });

  test("every kind whose tiles are readers answers facts, so no reader is second-class to placement", () => {
    const readers = tileKinds().filter((k: TileKind) => {
      try { return k.make({ kind: k.kind }) instanceof ReaderPane; } catch { return false; }
    });
    expect(readers.map(k => k.kind)).toEqual(expect.arrayContaining(["reader", "preview", "river.column", "settings", "brief", "pinned", "welcome.detail", "echo.reader"]));
    expect(readers.filter(k => !k.facts).map(k => k.kind)).toEqual([]);
  });
});
