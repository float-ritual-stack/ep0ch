// PIE-1523: the kind-facts section. A tile kind declared as an extension's manifest declares one (`tiles[].holds`,
// passed to serviceKind as kindEntry passes it) holds the person's keys while they're on it: the typing rule treats it
// as it treats a terminal they're in or a reader's edit. Its demo is this test: the section opened on the seeded
// scratch outline, driven through act.
import { beforeAll, describe, expect, test } from "bun:test";
import type { App } from "../../src/app";
import type { Desk } from "../../src/desk/desk";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

const USER = { kind: "user" } as const;

describe.skipIf(!outliner)("the showcase screen: kind facts (PIE-1523)", () => {
  const h = useShowcaseScreen();
  const { screen, S } = h;
  let app!: App;
  beforeAll(() => { ({ app } = h); });

  test("an extension-declared tile that holds the keys: the person's keys on it make it the typing rule's tile; an agent's float, close and resize around it are refused, and go through once the keys move", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "kind-facts" }, as: "test-agent" });
    await until(() => screen().includes("hand of patience"), "the patience tile");
    const stage = () => S().stages.get(S().sel).top as Desk;

    // Into the stage, so the person's keys reach its tiles.
    h.press({ kind: "enter" } as never);
    expect(S().focus).toBe("stage");
    await stage().dispatch.act({ action: "tile.focus", tile: "patience" }, USER);
    // Its kind says it holds the keys while they're on it: they type in it, as in a terminal they're in.
    expect(stage().keys().typingIn).toBe("patience");
    const agent = (action: string, tile: string, args: Record<string, unknown> = {}) => app.act({ action, tile, args, as: "test-agent" });
    await expect(agent("tile.float", "patience")).rejects.toThrow(/the person is typing in patience/);
    // Resizing the reader beside it would move the patience tile's edge under their keys: the typing rule's own refusal,
    // which a service-drawn tile never got before its kind could say it holds them.
    await expect(agent("tile.resize", "reader", { by: 5 })).rejects.toThrow(/the person is typing in patience/);
    await expect(agent("tile.close", "patience")).rejects.toThrow(/patience/);

    // The keys on the reader: the patience tile holds nothing, and an agent's float of it goes through.
    await stage().dispatch.act({ action: "tile.focus", tile: "reader" }, USER);
    expect(stage().keys().typingIn).toBeNull();
    await agent("tile.float", "patience");
    expect(stage().layoutGet().tiles.find(t => t.name === "patience")).toMatchObject({ float: true });
    for (let i = 0; i < 4 && S().focus === "stage"; i++) h.press({ kind: "esc" } as never);
  }, 30_000);
});
