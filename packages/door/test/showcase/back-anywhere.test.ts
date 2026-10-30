// The back-anywhere section (PIE-1426): Evan's layout, a detail whose opens and picks go to a preview below, a links tile
// beside it whose pick shows there too. The preview changed from the links tile, from a link up top and after b steps
// back through each in order; the links tile's own subject, changed by b, steps back with alt+←. Scratch service, made-up notes.
import { describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { USER } from "../../src/socket";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("showcase: back anywhere (PIE-1426)", () => {
  const h = useShowcaseScreen(177);

  test("a preview changed by a pick, a link and b goes back through each; the links tile goes back from b", async () => {
    await h.app.act({ action: "section", args: { name: "back-anywhere" }, as: "test-agent" });
    await until(() => marks["back-anywhere"]!.every(m => h.screen().includes(m)), "the back-anywhere section", 15_000);
    const stage = () => h.S().stages.get(h.S().sel).top;
    const n = h.S().notes;
    const pane = (name: string) => stage().pane(name);
    const shows = (name: string, id: string) => until(() => pane(name).msg?.id === id && !pane(name).msg?.partial, `${name} shows ${id.slice(0, 8)}`, 10_000);
    const mine = (action: string, args: Record<string, unknown>, tile: string) => stage().dispatch.act({ action, args, tile }, USER);
    const L = () => pane("links");
    const rowOf = (id: string) => L().rows().findIndex((r: any) => (r.kind === "backlink" && r.source.blockId === id) || (r.kind === "outlink" && r.link.target?.blockId === id)) + 1;
    await until(() => L().target?.id === n.backHub.id && rowOf(n.backRain.id) > 0, "the links tile lists the hub's links", 10_000);
    // Into the stage, so the person's keys reach its tiles.
    h.press({ kind: "enter" } as never);
    expect(h.S().focus).toBe("stage");
    // Two picks in the links tile.
    await mine("tile.focus", {}, "links");
    await mine("list.pick", { n: rowOf(n.backSeeds.id) }, "links");
    await shows("preview", n.backSeeds.id);
    await Bun.sleep(1200);                                              // two picks, not one walk
    await mine("list.pick", { n: rowOf(n.backRain.id) }, "links");
    await shows("preview", n.backRain.id);
    // A link opened up top: it lands in the preview.
    await mine("tile.focus", {}, "detail");
    for (let i = 0; i < 20 && !String(pane("detail").surface.describe().elements?.current?.label ?? "").includes("beans"); i++) { h.ch("]"); h.screen(); }
    h.press({ kind: "enter" } as never);
    await shows("preview", n.backBeans.id);
    expect(pane("detail").msg?.id).toBe(n.backHub.id);
    // b in the preview: the links tile lists the beans' links; its pick shows in the preview.
    await mine("tile.focus", {}, "preview");
    h.ch("b");
    await until(() => L().target?.id === n.backBeans.id && rowOf(n.backCanes.id) > 0, "the links tile lists the beans' links", 10_000);
    await mine("tile.focus", {}, "links");
    await mine("list.pick", { n: rowOf(n.backCanes.id) }, "links");
    await shows("preview", n.backCanes.id);
    // The links tile's hint says where back goes (its bottom row, cut short on a narrow tile).
    expect(L().hint()).toContain("alt+← back to Back anywhere: weekend jobs");
    // alt+← in the preview: each in turn.
    await mine("tile.focus", {}, "preview");
    for (const id of [n.backBeans.id, n.backRain.id, n.backSeeds.id]) { h.press({ kind: "alt-left" } as never); await shows("preview", id); }
    // alt+← in the links tile: the hub's links again.
    await mine("tile.focus", {}, "links");
    h.press({ kind: "alt-left" } as never);
    await until(() => L().target?.id === n.backHub.id, "the links tile lists the hub's links again", 10_000);
    // b in the preview on the shed: the links tile's pick shows the hub, the detail's own note; back, then forward onto
    // it again, and the preview stays a preview: three tiles, the detail's wires as they were (PIE-1426).
    const wires = () => JSON.stringify(stage().layout.wires);
    const wired = wires();
    await mine("tile.focus", {}, "detail");
    for (let i = 0; i < 20 && !String(pane("detail").surface.describe().elements?.current?.label ?? "").includes("shed"); i++) { h.ch("]"); h.screen(); }
    h.press({ kind: "enter" } as never);
    await shows("preview", n.backShed.id);
    await mine("tile.focus", {}, "preview");
    h.ch("b");
    await shows("preview", n.backHub.id);
    await mine("tile.focus", {}, "preview");
    h.press({ kind: "alt-left" } as never); await shows("preview", n.backShed.id);
    h.press({ kind: "alt-right" } as never); await shows("preview", n.backHub.id);
    h.screen();
    expect(["detail", "links", "preview"].every(t => !!pane(t))).toBe(true);
    expect(wires()).toBe(wired);
    for (let i = 0; i < 4 && h.S().focus === "stage"; i++) h.press({ kind: "esc" } as never);
  }, 90_000);
});
