// The keys window's showcase section (PIE-492), its end-to-end test: on the seeded outline, the keys tile lists the ^W
// keys, an agent moves one through `act` (said, saved in the scratch state dir's keybindings.json), the ^W table and the
// tile menu follow, and undo puts it back. The showcase's state dir is a scratch one (harness), never the person's.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { Desk } from "../../src/desk/desk";
import { wKey } from "../../src/desk/wkeys";
import { keymapPath } from "../../src/surface/keymap";
import { visible } from "../../src/style";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

const AGENT = { kind: "agent" as const, id: "keys-demo" };

describe.skipIf(!outliner)("the keys section", () => {
  const h = useShowcaseScreen();
  test("the keys tile lists the ^W keys; an agent moves ^W x to ^W q, the table and the menu follow, undo puts it back", async () => {
    await h.app.act({ action: "section", args: { name: "keys" }, as: "keys-demo" });
    await until(() => !!h.S().stages.get(h.S().sel), "the keys section");
    const d = h.S().stages.get(h.S().sel).top as Desk;
    const text = () => d.render(h.app).lines.map(visible).join("\n");
    await until(() => text().includes("Bindings"), "the keys tile drawn");
    const found: any = await d.dispatch.act({ action: "keys.find", args: { text: "tile.close" }, tile: "keys" }, AGENT);
    expect(found.bindings.some((b: any) => b.key === "ctrl+w x" && b.scope === "^W")).toBe(true);
    const r: any = await d.dispatch.act({ action: "keys.rebind", args: { id: "tile.close", key: "^W x", to: "ctrl+w q" }, tile: "keys" }, AGENT);
    expect(r).toMatchObject({ saved: true, id: "tile.close", to: "^W q" });
    expect(JSON.parse(readFileSync(keymapPath(), "utf8"))["tile.close"]).toContain("ctrl+w q");
    expect(wKey("q")?.action).toBe("tile.close");
    const menu: any = await d.dispatch.act({ action: "tile.menu", args: {}, tile: "reader" }, AGENT);
    expect(menu.rows.find((x: any) => x.action === "tile.close")?.key).toBe("ctrl+w q");
    await d.dispatch.act({ action: "keys.undo", args: {}, tile: "keys" }, AGENT);
    expect(wKey("x")?.action).toBe("tile.close");
    expect(existsSync(keymapPath())).toBe(true);
  });
});
