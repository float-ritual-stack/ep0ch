// PIE-1298 / PIE-1297: the showcase's "Pick a tile" section. An empty-slot button asks for its value (the wire picker), the choice
// is written on its line as an address the tile grammar reads as identity, and a later press runs bound. One of the showcase's
// test files.
import { beforeAll, describe, expect, test } from "bun:test";
import { USER } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};
const AGENT = { kind: "agent", id: "pick-tester" } as never;

describe.skipIf(!outliner)("the showcase screen: pick a tile", () => {
  const h = useShowcaseScreen();
  const { screen } = h;
  let board!: typeof h.board, app!: typeof h.app, seeded!: typeof h.seeded;
  beforeAll(async () => {
    ({ board, app, seeded } = h);
    await app.dispatch.act({ action: "section", args: { name: "pick-a-tile" } }, USER);
    await until(() => screen().includes("[pop it]"), "the button");
  });
  const text = async () => (await board.get(seeded.notes.pickATile.id))!.text;
  const buttonLine = async () => (await text()).split("\n").find(l => l.includes('label="pop it"'))!;
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string, who = USER as never) => app.dispatch.act({ action, args, ...(tile ? { tile } : {}) }, who) as Promise<any>;
  /** The section's desk: what is lifted on it (tile.zoom reach=column). */
  const desk = () => h.S().stages.get(h.S().sel).top;
  const lifted = () => !!desk().lifted;

  test("an agent's press of an empty slot never opens the person's picker: it is told the line to run", async () => {
    await expect(act("button.press", { label: "pop it" }, undefined, AGENT)).rejects.toThrow(/button\.slot .*key=target value=/);
    expect(screen()).not.toContain("choose a tile for target");
  });

  test("the person's press asks for a tile; the choice is written as the tile's id, and the next press lifts it, the one after drops it", async () => {
    const asked = await act("button.press", { label: "pop it" });
    expect(asked.picking).toBe("tile");
    await until(() => screen().includes("pop it: choose a tile for target"), "the picker's card");
    const links = (await act("tile.info", {}, "links")).tile as string;
    expect(links).toMatch(/^t-[0-9a-f-]{36}$/);
    // The card's rows choose by number; `to` is the same choice through act. The links tile fills a slot of this screen, so the
    // card asks: this tile exactly, or whichever fills its place.
    const chose = await act("tile.pick", { to: "links" });
    if (chose.picking === "which") {
      await until(() => screen().includes("this tile exactly"), "the exact-or-place question");
      await act("tile.pick", { value: links });
    }
    await untilAsync(() => buttonLine().then(l => l.includes(`target=${links}`)), "the id written on the line", 10_000);
    expect(await buttonLine()).toBe(`::button{label="pop it" act="tile.zoom tile={target} reach=column" target=${links}}`);
    expect(lifted()).toBe(false);
    await act("button.press", { label: "pop it" });
    await until(lifted, "links lifted");
    expect(desk().lifted.reach).toBe("column");
    expect(desk().liftsPane(desk().pane("links"))).toBe(true);
    await act("button.press", { label: "pop it" });
    await until(() => !lifted(), "links dropped");
  });

  test("a slot never keeps a name or a number: an agent's value is resolved now and kept as the tile's id", async () => {
    const preview = (await act("tile.info", {}, "preview")).tile as string;
    await act("button.slot", { label: "pop it", key: "target", value: "preview" }, undefined, AGENT);
    expect(await buttonLine()).toContain(`target=${preview}`);
    // A role is identity: kept as written.
    await expect(act("button.slot", { label: "pop it", key: "target", value: "t-00000000" }, undefined, AGENT)).rejects.toThrow(/not kept: .*t-00000000/);
    expect(await buttonLine()).toContain(`target=${preview}`);
  });

  test("a target that resolves to nothing refuses the press and never acts on the focused tile", async () => {
    const note = seeded.notes.pickATile.id, before = await text();
    const gone = before.replace(/target=t-[0-9a-f-]+/, "target=t-0123abcd-0000-0000-0000-000000000000");
    const m = (await board.get(note))!;
    await board.update(note, gone, m.revision!);
    await untilAsync(() => text().then(t => t === gone), "the dead target saved");
    await expect(act("button.press", { note, label: "pop it" }, undefined, AGENT)).rejects.toThrow(/no tile has the id t-0123abcd/);
    // The person's press says so on the status line and lifts nothing.
    await act("button.press", { note, label: "pop it" });
    await Bun.sleep(100);
    expect(lifted()).toBe(false);
  });

  test("the misread button runs nothing and says the line to write", async () => {
    await expect(act("button.press", { note: seeded.notes.pickATile.id, label: "misread" }, undefined, AGENT)).rejects.toThrow(/act= ends early.*act='tile\.zoom reach=column tile=t-a6125371'/);
  });
});
