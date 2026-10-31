import { describe, expect, test } from "bun:test";
import { visible } from "../../src/style";
import { BacklinksPane } from "../../src/desk/backlinks-pane";
import { USER } from "../../src/socket";
import { ReaderPane, TreePane } from "../../src/desk/panes";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the strip exhibit", () => {
  const h = useShowcaseScreen(177);

  test("seven tabs keep the current name when the tile narrows", async () => {
    await h.sc.dispatch.press("section", { name: "strip" });
    h.screen();
    const desk = h.sc.tilesHere()!;
    const reader = desk.pane("Build logs") as ReaderPane;
    await until(() => !!reader.msg, "the strip reader");
    await desk.dispatch.press("tile.title", { text: "Build logs" }, "Build logs");
    await desk.dispatch.press("tab.select", {}, "Build logs");
    const frame = () => desk.render({ ...h.app, t: { ...h.app.t, cols: 80, rows: 35 } } as any).lines.map(visible);
    expect(frame()[0]).toContain("Build logs");
  });
  test("dock choices swap, open beside, and leave the reader's rectangle alone", async () => {
    await h.sc.dispatch.press("section", { name: "strip" }); h.screen();
    const desk = h.sc.tilesHere()!;
    const tiles = () => { h.screen(); return desk.layoutGet().tiles; };
    const tile = (name: string) => tiles().find(t => t.name === name)!;
    const before = tile("Build logs").rect;
    await desk.dispatch.press("tile.slide", { open: true }, "Garden plan");
    await desk.dispatch.press("tile.slide", { open: true }, "Seed stock");
    expect(tile("Garden plan").rect).toBeUndefined();
    expect(tile("Seed stock").rect).toBeDefined();
    await desk.dispatch.press("tile.slide", { beside: true }, "Weekend jobs");
    const a = tile("Seed stock").rect!, b = tile("Weekend jobs").rect!;
    expect(a.col + a.cols).toBeLessThanOrEqual(b.col);
    expect(tile("Build logs").rect).toEqual(before);
    await desk.dispatch.press("tile.focus", {}, "Build logs");
    expect(tile("Seed stock").rect).toBeUndefined();
    expect(tile("Weekend jobs").rect).toBeUndefined();
  });

  test("the composed +N, breadcrumb and dock strips work by mouse, keys and act", async () => {
    await h.sc.dispatch.press("section", { name: "strip" }); h.screen();
    await h.sc.dispatch.press("section.try");
    const desk = h.sc.tilesHere()!, reader = desk.pane("Build logs") as ReaderPane;
    const links = desk.pane("links") as BacklinksPane, tree = desk.pane("tree") as TreePane;
    await desk.dispatch.press("tile.focus", {}, "Build logs");
    const paint = () => { (h.app as any).paint(true); return h.painted.map(visible).join("\n"); };
    await until(() => { paint(); return reader.msg?.id === h.seeded.notes.stripLog.id && (h.app.strips.state.get("breadcrumb", desk.keys().address!)?.tabs.length ?? 0) > 6; }, "the deep breadcrumb");
    const at = (strip: string, n: number) => {
      paint();
      for (let y = 0; y < h.app.t.rows; y++) for (let x = 0; x < h.app.t.cols; x++) {
        const hit = h.app.overflow.stripAt(x, y);
        if (hit?.id.endsWith(`/` + strip) && hit.n === n) return { x, y };
      }
      throw new Error(`no drawn ${strip} segment ${n}\n${paint()}`);
    };
    const click = (p: { x: number; y: number }, alt = false) => {
      h.press({ kind: "mouse", action: "down", button: 0, mods: alt ? 8 : 0, ...p });
      h.press({ kind: "mouse", action: "up", button: 0, mods: alt ? 8 : 0, ...p });
    };
    // A narrow header offers all seven full titles, and choosing still uses the tab's own action.
    (h.app as any).term.info.cols = 60;
    click(at("tabs", -1));
    expect(paint()).toContain("all choices");
    expect(paint()).toContain("Weather");
    h.press({ kind: "right" }); h.press({ kind: "enter" });
    await until(() => desk.layoutGet().tiles.find(t => t.name === "Planting")?.shown === true, "the picked tab");
    (h.app as any).term.info.cols = 177;
    await desk.dispatch.press("tab.select", {}, "Build logs");
    const before = desk.keys().address, note = reader.msg!.id;
    const path = await h.board.ancestors(note);
    h.press({ kind: "mouse", action: "drag", button: 3, ...at("breadcrumb", 0) });
    await until(() => paint().includes("breadcrumb: show its links"), "the breadcrumb's hover hint");
    click(at("breadcrumb", 0));
    await until(() => links.target?.id === path[0]!.id, "the clicked ancestor's links");
    expect(reader.msg!.id).toBe(note); expect(desk.keys().address).toBe(before);
    await until(() => tree.subject() === path[0]!.id, "the following tree highlights the ancestor");
    h.press({ kind: "mouse", action: "wheel-up", button: 0, ...at("breadcrumb", 0) });
    h.press({ kind: "enter" });
    await until(() => links.target?.id === path.at(-2)!.id, "the wheel and Enter choose the previous ancestor");
    expect(reader.msg!.id).toBe(note); expect(desk.keys().address).toBe(before);
    const crumb = reader.surface.describeElements().find(e => e.label === "Kitchen sink")!;
    await desk.dispatch.press("element.select", { n: crumb.n - 1 }, "Build logs");
    h.ch("]"); h.press({ kind: "enter" });
    await until(() => links.target?.id === path[0]!.id, "brackets and Enter choose a breadcrumb");
    expect(links.groups).not.toContain("parents");
    await desk.dispatch.press("reader.crumb", { id: note }, "Build logs");
    await desk.dispatch.press("backlinks.groups", { toggle: "parents" }, "links");
    await until(() => links.parents.kind === "ready", "the Parents group");
    expect(paint()).toContain("parents");
    // Agent selection uses the same action and leaves the person's note and keys alone.
    (h.app as any).lastInput = 0;
    await h.app.act({ action: "strip.pick", args: { strip: "breadcrumb", n: 2 }, tile: "Build logs", as: "strip-test" });
    expect(links.target?.id).toBe(path[1]!.id);
    expect(reader.msg!.id).toBe(note); expect(desk.keys().address).toBe(before);
    click(at(`${desk.name}:docks-down`, 0));
    await until(() => desk.layoutGet().tiles.find(t => t.name === "Garden plan")?.shown === true, "the first dock");
    click(at(`${desk.name}:docks-down`, 1), true);
    await until(() => desk.layoutGet().tiles.find(t => t.name === "Seed stock")?.shown === true, "the second dock beside it");
    expect(desk.layoutGet().tiles.find(t => t.name === "Garden plan")?.shown).toBe(true);
    await desk.dispatch.press("tile.title", { text: "Seed cupboard" }, "Seed stock");
    expect(paint()).toContain("Seed cupboard");
    await h.app.dispatch.act({ action: "host.toggle", args: { open: true } }, USER);
    await h.app.dispatch.act({ action: "host.size", args: { share: 0.9 } }, USER);
    expect(paint()).toContain("Seed cupboard");
    click(at(`${desk.name}:docks-down`, 1));
    await until(() => desk.layoutGet().tiles.find(t => t.name === "Seed stock")?.shown === false, "the lit dock closes through the expanded drawer");
    await h.app.dispatch.act({ action: "host.toggle", args: { open: false } }, USER);
    h.press({ kind: "char", ch: "k", ctrl: true });
    await until(() => !!h.app.bar, "the power bar");
    h.press({ kind: "mouse", action: "wheel-down", button: 0, ...at("scopes", 0) });
    h.ch("g");
    expect(h.app.bar!.query).toBe("g");
    h.press({ kind: "esc" });
  }, 30_000);

  test("tabs inside one dock stay selectable and agents leave the current one visible", async () => {
    await h.sc.dispatch.press("section", { name: "strip" }); h.screen();
    await h.sc.dispatch.press("section.try");
    const desk = h.sc.tilesHere()!;
    await desk.dispatch.press("layout.move", { to: "Garden plan", where: "tabs" }, "Seed stock");
    await desk.dispatch.press("tile.slide", { open: true }, "Garden plan");
    await desk.dispatch.press("tile.focus", {}, "Garden plan");
    await desk.dispatch.press("tab.select", {}, "Seed stock");
    h.screen();
    expect(desk.layoutGet().tiles.find(t => t.name === "Seed stock")?.rect).toBeDefined();
    await expect(desk.dispatch.act({ action: "tile.slide", tile: "Garden plan", args: { open: true } }, { kind: "agent", id: "strip-test" })).rejects.toThrow(/person|keys/);
    expect(desk.keys().focus).toBe("Seed stock");
    await desk.dispatch.press("tile.focus", {}, "Build logs");
    await desk.dispatch.press("tile.focus", {}, "Garden plan");
    h.screen();
    expect(desk.layoutGet().tiles.find(t => t.name === "Garden plan")?.rect).toBeDefined();
  });

});
