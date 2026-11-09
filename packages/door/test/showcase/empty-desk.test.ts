// PIE-1641: the showcase's "empty desk" section. A stage with no tiles; the person goes in, opens the power bar, picks
// a note and presses ⏎: a reader opens on the stage showing it, their keys in it. One of the showcase's test files.
import { beforeAll, describe, expect, test } from "bun:test";
import { SECTIONS } from "../../src/showcase/showcase";
import { USER } from "../../src/socket";
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
});
