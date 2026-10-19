import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { startControl } from "../../src/control";
import { Mirror } from "../../src/mirror";
import { KeyDecoder } from "../../src/term";
import { declaredKeys, traceActions } from "../../src/surface/actions";
import { Desk } from "../../src/desk/desk";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("x-ray and hint cards", () => {
  const h = useShowcaseScreen();
  test("linking explains the wire without taking keys; pin keeps the card and outside clicks still link", async () => {
    await h.app.act({ action: "section", args: { name: "hints" }, as: "test-agent" });
    await until(() => !!h.S().stages.get(h.S().sel), "the panes section");
    const d = h.S().stages.get(h.S().sel).top as Desk;
    const get = () => d.dispatch.act({ action: "hint.get" }, { kind: "agent", id: "test-agent" }) as Promise<any>;
    await d.dispatch.press("tile.link", { ask: true, verb: "select" }, "source");
    expect((await get()).cards[0].lines.join(" ")).toContain("select wire");
    const focus = d.layoutGet().focus;
    await d.dispatch.press("hint.pin");
    await d.dispatch.press("tile.title", { text: "Garden notes" }, "reader");
    expect((await get()).cards[0].pinned).toBe(true);
    expect(d.layoutGet().focus).toBe(focus);
    await d.dispatch.press("hint.dismiss");
    expect((await get()).cards).toEqual([]);
    await d.dispatch.press("tile.link", { ask: true, verb: "select" }, "source");
    h.screen();
    const tile = d.layoutGet().tiles.find(t => t.name === "reader")!;
    const r = tile.rect!;
    d.key({ kind: "mouse", action: "down", button: 0, x: r.col + 2, y: r.row + r.rows - 3 }, h.app);
    await until(() => !h.screen().includes("Linking from"), "the hint ending with linking");
    expect((await get()).cards).toEqual([]);
    const wires = d.layoutGet().tiles.find(t => t.name === "source")!;
    expect(JSON.stringify(wires)).toContain("reader");
  });
  test("Ctrl reports, a tap and the leader toggle the same menu rows without moving focus; peek reads them through the CLI", async () => {
    const d = h.S().stages.get(h.S().sel).top as Desk;
    await d.dispatch.press("hint.dismiss");
    h.screen();
    h.press({ kind: "enter" });
    const focus = d.layoutGet().focus;
    const info = { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false };
    const decoder = new KeyDecoder(info);
    decoder.keyHandler = h.press;
    const actions: string[] = [];
    const off = traceActions(a => actions.push(a.name));
    try {
      decoder.feed("\x1b[?15u\x1b[57442;5u");
      expect(d.hintGet().xray).toBe(true);
      const card = d.hintGet().cards.find(c => c.tile === "reader")!;
      expect(card.choices?.find(c => c.act.action === "tile.collapse")?.key).toBe("ctrl+w c");
      expect(card.choices?.find(c => c.act.action === "tile.link" && c.act.args?.verb === "select")).toBeDefined();
      expect(d.layoutGet().focus).toBe(focus);
      decoder.feed("\x1b[57442;1:3u");
      expect(d.hintGet().xray).toBe(false);
      decoder.feed("\x1b[?1u\x1b[57442u");
      expect(d.hintGet().xray).toBe(true);
      decoder.feed("\x1b[57442u");
      expect(d.hintGet().xray).toBe(false);
      h.press({ kind: "char", ch: "]", ctrl: true }); h.ch("?");
      expect(d.hintGet().xray).toBe(true);
      h.press({ kind: "esc" });
      expect(d.hintGet().xray).toBe(false);
      expect(actions.filter(a => a === "xray").length).toBe(5);
      expect(actions).toContain("hint.dismiss");
      h.screen();
      const r = d.layoutGet().tiles.find(t => t.name === "reader")!.rect!;
      const stage = h.S().stageRect;
      h.press({ kind: "mouse", action: "drag", button: 3, x: stage.col + r.col + 4, y: stage.row + r.row });
      h.ch("?");
      expect(d.hintGet().cards[0]?.tile).toBe("reader");
      expect(actions.at(-1)).toBe("hint.show");
      expect(declaredKeys(d.dispatch.defOf("hint.show")?.keys)).toContain("?");
      h.press({ kind: "esc" });
      h.press({ kind: "mouse", action: "drag", button: 3, x: h.screen().split("\n")[stage.row + r.row]!.indexOf("⋯", stage.col + r.col), y: stage.row + r.row });
      expect(d.hintGet().cards[0]?.tile).toBe("reader");
      expect(actions.at(-1)).toBe("hint.show");
      expect(declaredKeys(d.dispatch.defOf("hint.show")?.keys)).toContain("hover");
      h.press({ kind: "esc" });
      expect(declaredKeys(d.dispatch.defOf("xray")?.keys)).toContain("ctrl");
    } finally { off(); }
    const control = await startControl({ app: h.app, mirror: new Mirror(200, 60), info: () => info }, join(h.scratch.root, "door", "xray.sock"));
    try {
      const proc = Bun.spawn(["bun", resolve(import.meta.dir, "../../src/main.ts"), "peek", "--xray"], { env: { ...process.env, EP0CH_CONTROL: control.path, EP0CH_STATE: join(h.scratch.root, "door"), EP0CH_OUTLINES: join(h.scratch.root, "outlines") }, stdout: "pipe", stderr: "pipe" });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      expect(await proc.exited, stderr).toBe(0);
      expect(stdout).toContain('select wire:');
      expect(d.hintGet().xray).toBe(false);
      expect(d.layoutGet().focus).toBe(focus);
    } finally { control.close(); }
  });

  test("the tune inspector changes hint detail without changing the mode", async () => {
    const d = h.S().stages.get(h.S().sel).top as Desk;
    await d.dispatch.press("tile.open", { kind: "tune", name: "hint-tune", source: "tile:source" }, "reader");
    for (const [value, detailed] of [["brief", false], ["full", true], ["off", false]] as const) {
      await d.dispatch.press("tune.set", { row: "hints", value, level: "global" }, "hint-tune");
      await d.dispatch.press("tile.link", { ask: true, verb: "select" }, "source");
      const text = h.screen();
      expect(text.includes("Click this tile again")).toBe(detailed);
      expect(text.includes("Linking from source")).toBe(value !== "off");
    }
    await d.dispatch.press("tune.set", { row: "hints", value: "full", level: "global" }, "hint-tune");
    await d.dispatch.press("tile.link", { ask: false }, "source");
  });

});
