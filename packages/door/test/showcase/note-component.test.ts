// The showcase's "note component" section: a render script's note called `::packet-shelf{where="…"}` in another note draws
// under its line, and writes nothing. One of the showcase's test files; the harness (harness.ts) seeds a scratch
// outline and opens the screen on it.
import { beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: note component", () => {
  const h = useShowcaseScreen();
  const { screen } = h;
  let board!: typeof h.board, app!: typeof h.app, seeded!: typeof h.seeded;
  beforeAll(() => { ({ board, app, seeded } = h); });

  test("::packet-shelf{where=…} draws the script's badges under its line, and drawing writes nothing", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "note-component" }, as: "test-agent" });
    const id = seeded.notes.noteComponent.id;
    const first = (await board.get(id))!;
    await until(() => screen().includes("A note component") && screen().includes("Bean packet") && screen().includes("Pea packet"), "the shelf drawn", 15_000);
    const after = (await board.get(id))!;
    expect([after.text, after.revision]).toEqual([first.text, first.revision]);
  }, 40_000);
});
