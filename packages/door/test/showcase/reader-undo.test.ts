// PIE-1470: ctrl+z with the keys in a reader tile that the BBS message reader fills (the showcase's exhibit, a
// MessageReader framed in a tile) gives the key on to the desk's layout undo when the reader has no change of its own
// to undo, as it does from any other tile; a step change the reader did make is still what ctrl+z takes back first.
import { describe, expect, test } from "bun:test";
import { SECTIONS } from "../../src/showcase/showcase";
import type { Key } from "../../src/term";
import { USER } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("ctrl+z in the BBS message reader tile", () => {
  const h = useShowcaseScreen();
  const { screen, S } = h;
  const desk = () => S().stage(SECTIONS.findIndex(s => s.key === "note")).top as any;
  const layout = () => desk().layoutGet() as { focus: string; tree: unknown; tiles: { tile: string; name: string }[] };
  // The keys as the desk hears them (the showcase stage, entered, hands each key to its desk).
  const press = (k: Key) => desk().key(k, desk().ctx);
  const ctrl = (c: string) => press({ kind: "char", ch: c, ctrl: true });
  const chord = (c: string) => { ctrl("w"); press({ kind: "char", ch: c }); };

  async function open() {
    (h.app as any).lastInput = 0;
    await h.app.act({ action: "section", args: { name: "note" }, as: "test-agent" });
    screen();
    await until(() => layout().tiles.length === 2, "the note stage's two tiles");
  }
  const exhibit = () => { const t = layout().tiles.find(t => t.name === "exhibit"); if (!t) throw new Error(JSON.stringify(layout().tiles)); return t; };
  const other = () => layout().tiles.find(t => t.tile !== exhibit().tile)!;

  test("^W x closes the other tile, then ctrl+z in the reader brings the layout back", async () => {
    await open();
    const before = layout().tiles.map(t => t.name).sort();
    await h.app.dispatch.act({ action: "tile.focus", args: {}, tile: other().tile }, USER);
    chord("x");
    await until(() => layout().tiles.length === 1, "the tile closed");
    await h.app.dispatch.act({ action: "tile.focus", args: {}, tile: exhibit().tile }, USER);
    expect(layout().focus).toBe("exhibit");
    ctrl("z");
    await until(() => layout().tiles.length === 2, "ctrl+z put the closed tile back");
    expect(layout().tiles.map(t => t.name).sort()).toEqual(before);
  }, 60_000);

  test("with a step change of the reader's own to undo, ctrl+z undoes that and leaves the layout alone", async () => {
    await open();
    // A layout change older than the step change: the step change is still the newest thing the reader did.
    await h.app.dispatch.act({ action: "tile.focus", args: {}, tile: other().tile }, USER);
    chord("x");
    await until(() => layout().tiles.length === 1, "the tile closed");
    const closed = JSON.stringify(layout().tree);
    await h.app.dispatch.act({ action: "tile.focus", args: {}, tile: exhibit().tile }, USER);
    // The exhibit tile isn't one `act` addresses; the step change is made in its reader, as its checkbox key would.
    const reader = [...(desk().panes as Map<unknown, any>).values()].find(p => p.screenShown)?.screenShown;
    const host = reader.host(reader.ctx);
    const done = await reader.surface.runKey("task.status", { n: 1, to: "rejected" }, host, true);
    const mine = () => reader.surface.stepHistory.last("you", reader.surface.msg.id);
    expect(mine()).toBeTruthy();
    ctrl("z");
    await until(() => !mine(), "the step change taken back");
    expect(JSON.stringify(layout().tree)).toBe(closed);
    expect(layout().tiles.length).toBe(1);
    expect(done).toBeDefined();
  }, 60_000);
});
