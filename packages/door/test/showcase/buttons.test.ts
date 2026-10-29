// PIE-1287: the showcase's "buttons" section. Every tone and frame drawn by the one button part, and a press's states: a
// script that waits reads running then done, one that throws keeps failed with its words, and a button whose action would be
// refused now is drawn disabled. Pressed through act, as an agent does; the person's click is press.test.ts's. One of the
// showcase's test files.
import { beforeAll, describe, expect, test } from "bun:test";
import { USER } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: buttons", () => {
  const h = useShowcaseScreen();
  const { screen } = h;
  let app!: typeof h.app;
  beforeAll(async () => {
    ({ app } = h);
    await app.dispatch.act({ action: "section", args: { name: "buttons" } }, USER);
    await until(() => screen().includes("⟳ Sync now"), "the buttons section");
  });

  test("each line's look: a tone, a glyph, the frames and a filled band, and the one that can't run now dim", () => {
    const s = screen();
    for (const drawn of ["[▤ Fold all]", "[▶ Ship it]", "[✕ Delete]", "╭────────────╮", "│ ⟳ Sync now │", "┏━━━━━━━┓", "╔═══════╗", " Lift ", "(Turn the compost)"]) expect(s).toContain(drawn);
  });

  test("a press reads running while its script runs, then done; a failed one keeps ! until it is pressed again", async () => {
    const press = app.dispatch.act({ action: "button.press", args: { label: "Sync now" }, tile: "notes" }, USER);
    await until(() => screen().includes("◐ Sync now…"), "running");
    await press;
    await until(() => screen().includes("✓ Sync now"), "done");
    await until(() => screen().includes("⟳ Sync now"), "a button again", 6000);

    await app.dispatch.act({ action: "button.press", args: { label: "Water" }, tile: "notes" }, USER).catch(() => undefined);
    await until(() => screen().includes("! Water"), "failed");
    await Bun.sleep(3200);
    expect(screen()).toContain("! Water");
  }, 30_000);

  test("a button drawn dim is refused when pressed, with the words the pointer reads", async () => {
    const why = await app.dispatch.act({ action: "button.press", args: { label: "Turn the compost" }, tile: "notes" }, { kind: "agent", id: "test-agent" }).then(() => "", (e: Error) => e.message);
    expect(why).toContain("compost-heap");
  });
});
