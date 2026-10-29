// The keys window's showcase section (PIE-492), its end-to-end test: on the seeded outline, the keys tile lists the ^W
// keys, an agent moves one through `act` (said, saved in the scratch state dir's keybindings.json), the ^W table and the
// tile menu follow, and undo puts it back. The showcase's state dir is a scratch one (harness), never the person's.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { Desk } from "../../src/desk/desk";
import { openScreen } from "../../src/desk/screen-specs";
import { wKey } from "../../src/desk/wkeys";
import { keymapPath } from "../../src/surface/keymap";
import { visible } from "../../src/style";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

const AGENT = { kind: "agent" as const, id: "keys-demo" };

describe.skipIf(!outliner)("the keys section", () => {
  const h = useShowcaseScreen();
  test("the keys tile lists the ^W keys; an agent moves ^W x to ^W q, the table and the menu follow, Conflicts has none, undo puts it back", async () => {
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
    // Conflicts are real fights only: the built-in keys have none, and the tab says so.
    await d.dispatch.act({ action: "keys.filter", args: { text: "" }, tile: "keys" }, AGENT);
    const tab: any = await d.dispatch.act({ action: "keys.tab", args: { tab: "conflicts" }, tile: "keys" }, AGENT);
    expect(tab.rows).toBe(0);
    await until(() => text().includes("Conflicts 0") && text().includes("no two bindings fight over a key"), "the Conflicts tab");
    // Unbound: every action no key reaches, its count on the tab; an agent gives one a key, and it leaves the tab.
    const un: any = await d.dispatch.act({ action: "keys.tab", args: { tab: "unbound" }, tile: "keys" }, AGENT);
    expect(un.rows).toBeGreaterThan(0);
    await until(() => text().includes(`Unbound ${un.rows}`), "the Unbound tab");
    const given: any = await d.dispatch.act({ action: "keys.rebind", args: { id: "share.list", to: "alt+j" }, tile: "keys" }, AGENT);
    expect(given).toMatchObject({ saved: true, id: "share.list", to: "alt+j" });
    const after: any = await d.dispatch.act({ action: "keys.tab", args: { tab: "unbound" }, tile: "keys" }, AGENT);
    expect(after.rows).toBe(un.rows - 1);
    await d.dispatch.act({ action: "keys.undo", args: {}, tile: "keys" }, AGENT);
    // ⏎ runs a row as the person's own key would; an agent runs the action itself.
    await expect(d.dispatch.act({ action: "keys.run", args: { n: 1 }, tile: "keys" }, AGENT)).rejects.toThrow("an agent runs the action itself");
    await d.dispatch.act({ action: "keys.undo", args: {}, tile: "keys" }, AGENT);
    expect(wKey("x")?.action).toBe("tile.close");
    expect(existsSync(keymapPath())).toBe(true);
  });

  test("on the House board, ? opens the keys window where the board can take it; esc gives the keys back to the lanes", async () => {
    const board = openScreen("board", { hub: h.seeded.notes.hub.id, persist: false }) as Desk;
    h.app.push(board as never);
    const kinds = () => [...(board as any).panes.values()].map((p: any) => p.kind) as string[];
    await until(() => kinds().includes("query"), "the board's lanes", 15_000);
    // The lanes have the keys, as the board opens.
    const lane = [...(board as any).panes.entries()].find(([, p]: any) => p.kind === "query")?.[0];
    if (lane !== undefined) await board.dispatch.act({ action: "tile.focus", args: {}, tile: (board as any).nameOf(lane) }, { kind: "user" } as never);
    const from = (board as any).nameOf((board as any).focus);
    h.ch("?");
    await until(() => kinds().includes("keys") && (board as any).panes.get((board as any).focus)?.kind === "keys", "a keys tile on the board", 8000);
    h.press({ kind: "esc" } as never);
    await until(() => !kinds().includes("keys"), "closed");
    expect((board as any).nameOf((board as any).focus)).toBe(from);
  });
});
