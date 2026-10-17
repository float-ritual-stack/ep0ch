// PIE-958: the showcase's "Tiles that move" section. A button runs a script whose layout changes glide (its tiles float, wander and
// settle); the layout, a snapshot and peek read the settled state, a key snaps what moves, and it all ends where the layout is.
// One of the showcase's test files; the harness seeds a scratch outline and opens the screen on it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extensionList } from "../../src/extensions";
import { SECTIONS } from "../../src/showcase/showcase";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: tiles that move", () => {
  const h = useShowcaseScreen();
  const { screen, press, S } = h;
  let app!: typeof h.app;
  beforeAll(() => { ({ app } = h); process.env.EP0CH_MOTION = "full"; });
  afterAll(() => { process.env.EP0CH_MOTION = "off"; });
  const click = (x: number, y: number) => { press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y }); };

  test("a pressed button's script floats and settles tiles with motion; the settled layout is the truth, and a key snaps it", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "motion" }, as: "test-agent" });
    screen();
    const desk = () => S().stage(SECTIONS.findIndex(s => s.key === "motion")).top as any;
    await until(() => screen().includes("[✦ Shuffle the tiles]"), "the button drawn", 15_000);
    await until(() => !!extensionList()?.extensions.find(e => e.name === "shuffle-tiles"), "the script loaded");
    const tiles = () => (desk().layoutGet() as { tiles: { name: string; float?: boolean }[] }).tiles;
    const names = tiles().map(t => t.name).sort();
    const rows = screen().split("\n"), y = rows.findIndex(r => r.includes("[✦ Shuffle the tiles]"));
    click(rows[y]!.indexOf("[✦ Shuffle the tiles]") + 3, y);
    // The script floats the two tiles: while they glide the desk is moving, and what peek reads is the settled layout.
    await until(() => desk().moving, "a transition in flight", 15_000);
    screen();
    expect(tiles().length).toBe(names.length);
    // A key snaps what moves, and the run goes on to its end.
    press({ kind: "char", ch: "x", ctrl: true });
    expect(desk().moving).toBe(false);
    await until(() => tiles().length === names.length && tiles().every(t => !t.float), "the tiles are back in the layout", 20_000);
    expect(tiles().map(t => t.name).sort()).toEqual(names);
  }, 60_000);
});
