// PIE-1298 / PIE-1297: the showcase's "Pick a tile" section. An empty-slot button asks for its value (the wire picker), the choice
// is written on its line, and a later press runs bound. One of the showcase's test files.
import { beforeAll, describe, expect, test } from "bun:test";
import { USER } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: pick a tile", () => {
  const h = useShowcaseScreen();
  const { screen } = h;
  let board!: typeof h.board, app!: typeof h.app, seeded!: typeof h.seeded;
  beforeAll(() => { ({ board, app, seeded } = h); });
  const text = async () => (await board.get(seeded.notes.pickATile.id))!.text;
  const buttonLine = async () => (await text()).split("\n").find(l => l.includes('label="pop it"'))!;

  test("explore", async () => {
    await app.dispatch.act({ action: "section", args: { name: "pick-a-tile" } }, USER);
    await until(() => screen().includes("[pop it]"), "the button");
    console.log(screen().split("\n").filter(l => /pop it|misread|ends early/.test(l)).join("\n"));
    const agent = await app.dispatch.act({ action: "button.press", args: { label: "pop it" } }, { kind: "agent", id: "tester" } as never).then(() => "ran", (e: Error) => e.message);
    console.log("AGENT:", agent);
    const r = await app.dispatch.act({ action: "button.press", args: { label: "pop it" } }, USER);
    console.log("USER:", JSON.stringify(r));
    console.log(JSON.stringify((await app.dispatch.act({ action: "layout.get" }, USER) as any).linking));
    console.log(screen());
  });
});
