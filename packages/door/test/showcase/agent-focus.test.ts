import { describe, expect, test } from "bun:test";
import { Desk } from "../../src/desk/desk";
import { OPEN_READS } from "../../src/desk/screen-layout";
import { USER } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("explicit agent focus in the showcase", () => {
  const h = useShowcaseScreen();

  test("setting and clearing an agent's pointer leaves the person's keys alone", async () => {
    await h.app.act({ action: "section", args: { name: "press" }, as: "fern" });
    await until(() => h.screen().includes("New game"), "the press reader");
    const before = h.app.person().focus;
    await h.app.act({ action: "agent.focus", tile: "notes", args: { line: 3 }, as: "fern" });
    expect(h.app.describe()).toMatchObject({ pointers: [{ agent: "fern", name: "notes", line: 3 }] });
    expect(h.app.person().focus).toBe(before);
    await h.app.act({ action: "agent.focus", as: "fern" });
    expect(h.app.describe()).toMatchObject({ pointers: [] });
  }, 30_000);

  test("two pointers target buttons and edits, prefer their own reader, and offer a mouse path to their line", async () => {
    await h.app.act({ action: "section", args: { name: "agent-focus" }, as: "tester" });
    await until(() => h.screen().includes("@fern") && h.screen().includes("New game"), "both pointer readers");
    const act = (action: string, args = {}, tile?: string, as = "fern") => h.app.act({ action, args, tile, as });
    const person = (action: string, args = {}, tile?: string) => h.app.dispatch.act({ action, args, tile }, USER);
    const focus = async () => (await act("layout.get") as { focus: string }).focus;
    await person("section.try");
    const initial = await focus();
    const note = h.seeded.notes.press.id;
    expect(h.app.describe().pointers).toEqual(expect.arrayContaining([
      expect.objectContaining({ agent: "fern", name: "game" }),
      expect.objectContaining({ agent: "moss", name: "copy" }),
    ]));
    await expect(person("agent.focus", {}, "game")).rejects.toThrow("for agents");
    await act("agent.focus", { line: 3 }, "game", "moss");
    expect(h.screen().split("\n").some(row => row.includes("ttt-board::") && row.includes("@fern") && row.includes("@moss"))).toBe(true);
    await act("agent.focus", { line: 5 }, "copy", "moss");
    expect(await act("tile.open", { kind: "reader", name: "landing" })).toMatchObject({ beside: "person" });
    await act("tile.close", {}, "landing");
    await act("agent.focus", { note }, "person");
    expect(await act("button.press", { label: "New game" })).toMatchObject({ name: "person", note });
    await act("agent.focus", { line: 3 }, "game");
    const button = await act("button.press", { label: "New game" });
    expect(button).toMatchObject({ name: "game" });
    expect(await focus()).toBe(initial);
    const original = (await h.board.get(note))!.text;
    const changed = original.replace("In prose", "In plain prose");
    expect(changed).not.toBe(original);
    await act("edit.text", { text: changed });
    await act("edit.save");
    expect((await h.board.get(note))!.text).toBe(changed);
    expect(await focus()).toBe(initial);
    await act("edit.close");
    h.screen();
    // A block-id target used to choose the first equal reader. The pointer wins only for its agent.
    expect(await act("elements", {}, note, "moss")).toMatchObject({ name: "copy" });
    await act("agent.focus", { clear: true }, undefined, "moss");
    expect(await act("elements", {}, note, "moss")).toMatchObject({ name: "game" });
    // No pointer: the existing default follows the person's focus.
    await person("tile.focus", {}, "copy");
    h.screen();
    expect(await act("elements", {}, undefined, "visitor")).toMatchObject({ name: "copy" });
    await person("tile.focus", {}, "person");
    // The footer is visible even when the source line has scrolled out of view.
    const rows = h.screen().split("\n"), y = rows.findIndex(row => row.includes("@fern:3"));
    expect(y).toBeGreaterThanOrEqual(0);
    const x = rows[y]!.indexOf("@fern:3") + 1;
    h.press({ kind: "mouse", action: "down", button: 0, x, y });
    h.press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => h.app.person().focus === "game", "the marker click takes the keys");
    expect(await act("who.refresh", {}, "who")).toMatchObject({ pointers: [expect.objectContaining({ agent: "fern" })] });
    // Closing a pointer's tile drops it immediately; subsequent actions use today's default again.
    await person("tile.focus", {}, "person");
    await act("tile.close");
    expect(h.app.describe().pointers).toEqual([]);
    h.screen();
    expect(await act("elements")).toMatchObject({ name: "person" });
    await act("agent.focus", {}, "copy");
    expect(h.app.describe().pointers).toHaveLength(1);
    h.app.pop();
    expect(h.app.describe().pointers).toEqual([]);
  }, 60_000);


  test("without a pointer tile.focus keeps main's idle and typing behavior", async () => {
    const d = new Desk({ name: "focus-check", title: "Focus check", layout: { root: {
      t: "split", dir: "row", ratio: 0.5,
      a: { t: "leaf", kind: "reader", name: "left" }, b: { t: "leaf", kind: "reader", name: "right" },
    }, focus: "left" } });
    h.app.push(d);
    await h.app.dispatch.act({ action: "open", tile: "right", args: { id: h.seeded.notes.press.id } }, USER);
    (h.app as any).lastInput = 0;
    await h.app.act({ action: "tile.focus", tile: "right", as: "visitor" });
    expect(h.app.person().focus).toBe("right");
    await h.app.act({ action: "folds", tile: "right", as: "visitor" });
    d.render(h.app);
    expect(await h.app.act({ action: "elements", as: "visitor" })).toMatchObject({ name: "right" });
    h.ch("e"); h.press({ kind: "enter" });
    await until(() => h.app.person().typingIn === "right", "the person typing in the right reader");
    await expect(h.app.act({ action: "tile.focus", tile: "left", as: "visitor" })).rejects.toThrow("typing");
    await h.app.dispatch.act({ action: "edit.close", tile: "right" }, USER);
    await h.app.act({ action: "tile.open", args: { kind: "screen", screen: "detail", name: "nested", target: h.seeded.notes.press.id }, as: "visitor" });
    d.render(h.app);
    await h.app.dispatch.act({ action: "open", tile: "nested/detail", args: { id: h.seeded.notes.press.id } }, USER);
    d.render(h.app);
    await h.app.act({ action: "agent.focus", tile: "nested/detail", as: "visitor" });
    expect(await h.app.act({ action: "button.press", args: { label: "New game" }, as: "visitor" })).toMatchObject({ name: "detail" });
    expect(h.app.person().focus).toBe("right");
    await h.app.act({ action: "tile.close", tile: "nested", as: "visitor" });
    expect(h.app.describe().pointers).toEqual([]);
    h.app.pop();
  }, 30_000);

  test("in yolo too, an agent's tile.open leaves the person's keys, and one too narrow beside its tile floats, said (PIE-1444)", async () => {
    await h.app.act({ action: "section", args: { name: "agent-focus" }, as: "tester" });
    await until(() => h.screen().includes("@fern"), "the pointer readers");
    await h.app.dispatch.act({ action: "section.try", args: {} }, USER);
    await h.app.dispatch.act({ action: "tile.focus", args: {}, tile: "person" }, USER);
    h.app.event({ domain: "agents", action: "agents.yolo", yolo: true, sequence: 1 } as any);
    try {
      expect(h.app.person().yolo).toBe(true);
      const before = h.app.person().focus;
      const layout = await h.app.act({ action: "layout.get", as: "fern" }) as { tiles: { name: string; rect?: { cols: number } }[] };
      const narrow = Math.floor(layout.tiles.find(t => t.name === "copy")!.rect!.cols / 2) < OPEN_READS.cols;
      const r = await h.app.act({ action: "tile.open", tile: "copy", args: { kind: "reader", name: "aside" }, as: "fern" }) as { where: string; why?: string };
      expect(r.where).toBe(narrow ? "float" : "right");
      if (narrow) expect(r.why).toContain("beside copy it would be");
      expect(h.app.person().focus).toBe(before);
      await h.app.act({ action: "tile.close", tile: "aside", as: "fern" });
    } finally { h.app.event({ domain: "agents", action: "agents.yolo", yolo: false, sequence: 2 } as any); }
  }, 30_000);
});
