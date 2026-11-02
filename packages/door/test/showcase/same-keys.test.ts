// PIE-1293: the showcase's same-keys section. PgDn pages the outline the rows shown less one, PgUp comes back, and the
// yes/no a d brings up keeps the note on ⏎ (the safe row first). Driven by the person's keys on the seeded outline.
import { beforeAll, describe, expect, test } from "bun:test";
import type { App } from "../../src/app";
import { pageRows } from "../../src/scroll";
import { SECTIONS } from "../../src/showcase/showcase";
import type { Seeded } from "../../src/showcase/seed";
import type { SocketBoard } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: same keys (PIE-1293)", () => {
  const h = useShowcaseScreen();
  const { press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, seeded!: Seeded;
  beforeAll(() => { ({ board, app, seeded } = h); });

  test("PgDn pages the outline by the rows shown less one, PgUp comes back; ⏎ on the trash's yes/no keeps the note", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "same-keys" }, as: "test-agent" })).toMatchObject({ key: "same-keys" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "same-keys")).top; };
    const tree = () => stage().pane("tree") as any;
    const heap = seeded.notes.heap;
    await until(() => stage().layoutGet().tiles.find((t: any) => t.name === "detail")?.showing?.id === heap.id && tree().rows?.length > 3, "the outline and the heap", 8000);
    press({ kind: "enter" });
    await stage().dispatch.act({ action: "tile.focus", tile: "tree" }, { kind: "user" });
    screen();
    const from = tree().sel, n = tree().rows.length, step = pageRows(tree().view.room);
    press({ kind: "pgdn" });
    await until(() => tree().sel === Math.min(n - 1, from + step), `the pick a page down (${from} + ${step} of ${n}, at ${tree().sel})`);
    press({ kind: "pgup" });
    await until(() => tree().sel === from, "back where it was");
    // The yes/no: keep it first, so ⏎ keeps the heap.
    await stage().dispatch.act({ action: "tile.focus", tile: "detail" }, { kind: "user" });
    ch("d");
    await until(() => screen().includes('trash "Compost heap"?'), "the yes/no");
    const rows = screen().split("\n");
    expect(rows.findIndex(l => l.includes("keep it"))).toBeLessThan(rows.findIndex(l => l.includes("trash it and the 2 notes under it")));
    press({ kind: "enter" });
    await until(() => !screen().includes('trash "Compost heap"?'), "the yes/no put away");
    await Bun.sleep(200);
    expect((await board.get(heap.id))?.deleted).toBeFalsy();
  }, 30_000);
});
