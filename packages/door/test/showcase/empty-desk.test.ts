// PIE-1641: the showcase's "empty desk" section. A stage with no tiles; the person goes in, opens the power bar, picks
// a note and presses ⏎: a reader opens on the stage showing it, their keys in it. One of the showcase's test files.
import { beforeAll, describe, expect, test } from "bun:test";
import { SECTIONS } from "../../src/showcase/showcase";
import { USER } from "../../src/socket";
import { ReaderPane } from "../../src/desk/panes";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: an empty desk", () => {
  const h = useShowcaseScreen();
  const { press, screen, S } = h;
  let app!: typeof h.app, seeded!: typeof h.seeded;
  beforeAll(() => { ({ app, seeded } = h); });

  test("the power bar's pick on the empty stage opens a reader for the note, the keys in it", async () => {
    (app as any).lastInput = 0;
    const n = SECTIONS.findIndex(s => s.key === "empty-desk") + 1;
    expect(await app.act({ action: "section", args: { name: "empty-desk" }, as: "test-agent" })).toEqual({ section: n, key: "empty-desk" });
    screen();
    const stage = () => S().stages.get(n - 1).top as any;
    expect(stage().layoutGet().tiles).toEqual([]);
    // The person: into the stage, the bar on the note's title, ⏎ on its row.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    await app.dispatch.act({ action: "bar.open", args: { query: "Bike shed", scope: "notes" } }, USER);
    screen();
    await app.dispatch.act({ action: "bar.pick", args: { n: 1 } }, USER);
    await until(() => { screen(); return stage().layoutGet().tiles.length === 1; }, "a reader on the stage");
    const [reader] = stage().layoutGet().tiles;
    expect(reader.kind).toBe("reader");
    const shown = (await stage().dispatch.act({ action: "tile.info", tile: reader.name, args: {} }, USER) as any).showing?.id;
    expect(shown).toBe(seeded.notes.shed.id);
    expect(stage().layoutGet().focus).toBe(reader.name);
    await until(() => screen().includes("Bike shed"), "the note drawn");
  });
  // PIE-1726: the stage empty, the keys in the drawer's reader, `e`: the edit arms, its hint shows on that reader in the
  // drawer, and no paint throws the empty stage's refusal (it crashed the door from finishFrame → syncModeHint).
  test("an empty stage, the keys in the drawer's reader, e: the edit arms there and ⏎ opens it, nothing thrown", async () => {
    // Its own stage and reader, run alone or after the test above: the section, the keys in it, a reader opened by the bar.
    (app as any).lastInput = 0;
    const n = SECTIONS.findIndex(s => s.key === "empty-desk") + 1;
    await app.act({ action: "section", args: { name: "empty-desk" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(empty-desk\)/.test(e.message)) throw e; });
    screen();
    const stage = () => S().stages.get(n - 1).top as any;
    if (S().focus !== "stage") press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    if (!stage().layoutGet().tiles.length) {
      await app.dispatch.act({ action: "bar.open", args: { query: "Bike shed", scope: "notes" } }, USER);
      screen();
      await app.dispatch.act({ action: "bar.pick", args: { n: 1 } }, USER);
      await until(() => { screen(); return stage().layoutGet().tiles.length === 1; }, "a reader on the stage");
    }
    const [reader] = stage().layoutGet().tiles;
    expect(reader?.kind).toBe("reader");
    // The reader into the drawer, the stage's other tile closed (^W x): the stage is empty again; the keys go into the drawer.
    await stage().dispatch.act({ action: "tile.open", tile: reader.name, args: { kind: "reader", name: "spare", where: "right" } }, USER);
    await stage().dispatch.act({ action: "tile.drawer", tile: reader.name, args: { on: true } }, USER);
    await stage().dispatch.act({ action: "tile.close", tile: "spare", args: {} }, USER);
    await app.dispatch.act({ action: "host.enter" }, USER);
    screen();
    expect(stage().layoutGet().tiles).toEqual([]);
    const dd: any = app.drawer.made!;
    const rd = () => dd.all().map((id: unknown) => dd.panes.get(id)).find((p: unknown) => p instanceof ReaderPane) as ReaderPane;
    await until(() => !!rd()?.surface.msg, "the reader in the drawer");
    await dd.dispatch.act({ action: "tile.focus", tile: dd.nameOf(dd.all().find((id: unknown) => dd.panes.get(id) === rd())!) }, USER);
    screen();
    h.ch("e");
    expect(app.armed()?.of).toBe(rd().surface);
    // The door's paint after the arm (the stage and the drawer): the door crashed here.
    const paint = () => (app as any).paint(true);
    expect(paint).not.toThrow();
    // The confirm is the drawer's mode, on the armed reader; the empty stage holds no mode and no card.
    expect(stage().modeHintKey).toBe("");
    expect(stage().hintGet().cards).toEqual([]);
    expect(dd.modeHintKey).toBe("confirm");
    press({ kind: "enter" });
    await until(() => !!rd().surface.draft, "the edit open in the drawer's reader");
    expect(paint).not.toThrow();
    await dd.dispatch.act({ action: "edit.close", tile: dd.tileIdOfPane(rd()), args: {} }, USER);
  });
});
