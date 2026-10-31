import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { startControl } from "../../src/control";
import { Mirror } from "../../src/mirror";
import { SECTIONS } from "../../src/showcase/showcase";
import { ITEM_BG, RULER_BG } from "../../src/surface/selection";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe("showcase: collection peeks (PIE-849)", () => {
  const h = useShowcaseScreen(177);
  const stage = () => { h.screen(); return h.S().stage(SECTIONS.findIndex(s => s.key === "peek")).top; };
  const act = (action: string, args: Record<string, unknown> = {}, tile = "garden") => stage().dispatch.act({ action, tile, args }, { kind: "user" }) as Promise<any>;
  const agent = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, tile: "garden", args }, { kind: "agent", id: "gardener" }) as Promise<any>;
  const list = () => stage().pane("garden").surface.listsDrawn[0];
  const floats = () => stage().layoutGet().tiles.filter((t: any) => t.float);
  const agentSourceChange = async (action: "open" | "tile.close") => {
    const control = await startControl({ app: h.app, mirror: new Mirror(177, 60), info: () => h.app.t }, join(h.scratch.root, "door", "peek.sock"));
    try {
      const proc = Bun.spawn([process.execPath, resolve(import.meta.dir, "../../src/main.ts"), "act", action, "tile=garden", ...(action === "open" ? [`id=${h.seeded.notes.shed.id}`] : []), "--as", "walkbot"], {
        env: { ...process.env, ...h.scratch.env, EP0CH_CONTROL: control.path, EP0CH_STATE: join(h.scratch.root, "door"), EP0CH_SOCKET: h.scratch.sock }, stdout: "pipe", stderr: "pipe",
      });
      const out = await new Response(proc.stdout).text(), err = await new Response(proc.stderr).text();
      expect(await proc.exited, out + err).toBe(0);
    } finally { control.close(); }
  };
  const setup = async () => {
    (h.app as any).term.info.cols = 177;
    await h.app.dispatch.act({ action: "section.try", args: { name: "peek" } }, { kind: "user" });
    for (const tile of stage().layoutGet().tiles) if (tile.name !== "garden") await act("tile.close", {}, tile.name);
    await act("tile.focus");
    await act("open", { id: h.seeded.notes.collection.id });
    await act("open", { id: h.seeded.notes.peek.id });
    for (const tile of stage().layoutGet().tiles) if (tile.name !== "garden") await act("tile.close", {}, tile.name);
    await until(() => list()?.view.pickable().length === 4, "garden cards", 8000);
  };

  test("one pick creates a follower without taking keys, and Enter enters that same peek", async () => {
    await setup();
    const lines = h.screen().split("\n"), label = list().view.pickable()[0].label;
    const y = lines.findIndex(line => line.includes(label)), x = lines[y]!.indexOf(label) + 2;
    h.press({ kind: "mouse", action: "down", button: 0, x, y });
    h.press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => floats().length === 1, "a picked card's float", 1500);
    const peek = floats()[0].name;
    expect(stage().focusedName()).toBe("garden");
    h.ch("j");
    await until(() => list().view.picked().id === list().view.pickable()[2].id, "j reaches the next page's column", 1500);
    await until(() => floats()[0]?.showing?.id === list().view.picked().id, "the float follows", 1500);
    expect(floats()).toHaveLength(1);
    expect(floats()[0].name).toBe(peek);
    h.press({ kind: "enter" });
    await until(() => stage().focusedName() === peek, "Enter gives the peek the keys", 1500);
    expect(floats()).toHaveLength(1);
    expect(stage().pane("garden").surface.msg.id).toBe(h.seeded.notes.peek.id);
  }, 15_000);

  test.each(["entered peek", "gallery"])("Esc closes the peek from the %s and returns keys to its gallery", async from => {
    await setup();
    if (from === "entered peek") await act("list.open", { n: 2 });
    else {
      const lines = h.screen().split("\n"), label = list().view.pickable()[1].label;
      const y = lines.findIndex(line => line.includes(label)), x = lines[y]!.indexOf(label) + 2;
      h.press({ kind: "mouse", action: "down", button: 0, x, y });
      h.press({ kind: "mouse", action: "up", button: 0, x, y });
      await until(() => floats().length === 1, "a picked card's float", 1500);
      expect(stage().focusedName()).toBe("garden");
    }
    expect(floats()).toHaveLength(1);
    h.press({ kind: "esc" });
    await until(() => floats().length === 0, "Esc closes the peek", 1500);
    expect(stage().focusedName()).toBe("garden");
  }, 15_000);

  test("a person's floated select reader survives Esc and is not reused as the gallery's peek", async () => {
    await setup();
    await act("tile.open", { kind: "reader", name: "my-reader" });
    await act("tile.link", { to: "my-reader", verb: "select" });
    await act("tile.float", { on: true }, "my-reader");
    await act("tile.focus", {}, "my-reader");
    h.press({ kind: "esc" });
    expect((await act("layout.get")).tiles.some((t: any) => t.name === "my-reader" && t.float)).toBe(true);
    await act("tile.focus");
    await act("list.open", { n: 2 });
    expect(floats().map((t: any) => t.name)).toContain("my-reader");
    expect(floats()).toHaveLength(2);
    await act("tile.focus");
    await act("list.pick", { n: 2 });
    await until(() => stage().pane("my-reader").surface.msg?.id === list().view.picked().id, "the person's select wire delivers beside the peek", 1500);
  }, 15_000);

  test("an explicit right landing refuses a container that takes no drops and keeps the following wire", async () => {
    await setup();
    await act("tile.open", { kind: "reader", name: "outside", where: "right" });
    await act("tile.open", { kind: "reader", name: "companion", where: "down" });
    await act("layout.policy", { droppable: false });
    try {
      await act("list.open", { n: 2 });
      const peek = floats()[0], before = stage().layoutGet();
      await expect(act("tile.float", { on: false, where: "right" }, peek.name)).rejects.toThrow(/takes no drops.*tile.float on=false/);
      expect(stage().layoutGet().tree).toEqual(before.tree);
      expect(floats()[0].name).toBe(peek.name);
      await act("tile.focus");
      await act("list.pick", { n: 1 });
      await until(() => floats()[0]?.showing?.id === list().view.picked().id, "refused float still follows", 1500);
      await act("tile.float", { on: false }, peek.name);
      expect(floats()).toHaveLength(0);
      expect(stage().layoutGet().tiles.find((t: any) => t.name === "garden").wires).toContainEqual({ verb: "select", to: peek.tile });
      await act("tile.focus");
      await act("list.pick", { n: 2 });
      await until(() => stage().pane(peek.name).surface.msg?.id === list().view.picked().id, "the put-back reader keeps following", 1500);
      expect(floats()).toHaveLength(0);
      await act("list.enter", { on: true });
      h.press({ kind: "enter" });
      await until(() => stage().focusedName() === peek.name, "Enter enters the put-back reader", 1500);
      expect(floats()).toHaveLength(0);
    } finally { await act("layout.policy", { clear: "droppable" }); }
  }, 15_000);

  test.each(["note", "close"])("a source %s change retires its peek and leaves a person's float alone", async change => {
    await setup();
    await act("tile.open", { kind: "reader", name: "my-reader" });
    await act("tile.float", { on: true }, "my-reader");
    await act("tile.link", { to: "my-reader", verb: "select" });
    await act("tile.open", { kind: "reader", name: "outside" });
    await act("list.open", { n: 2 });
    const peek = floats().find((t: any) => t.name !== "my-reader");
    expect(peek).toBeDefined();
    expect(stage().layoutGet().tiles.find((t: any) => t.name === "garden").wires).toContainEqual({ verb: "select", to: peek.tile });
    try {
      if (change === "note") await act("open", { id: h.seeded.notes.shed.id });
      else await act("tile.close");
      expect(floats().map((t: any) => t.name)).toEqual(["my-reader"]);
      expect(stage().layoutGet().tiles.flatMap((t: any) => t.wires ?? []).some((w: any) => w.to === peek.tile)).toBe(false);
      if (change === "close") {
        await act("tile.focus", {}, "outside");
        h.press({ kind: "char", ch: "z", ctrl: true });
        await until(() => stage().layoutGet().tiles.some((t: any) => t.name === "garden"), "Ctrl+Z restores the source", 1500);
        expect(stage().layoutGet().tiles.some((t: any) => t.name === "garden")).toBe(true);
        expect(floats()).toHaveLength(2);
        const restored = stage().layoutGet(), source = restored.tiles.find((t: any) => t.name === "garden");
        for (const reader of restored.tiles.filter((t: any) => t.float)) expect(source.wires).toContainEqual({ verb: "select", to: reader.tile });
        await until(() => list()?.view.pickable().length === 4, "the restored gallery's cards", 4000);
        await act("tile.focus");
        await act("list.pick", { n: 1 });
        await until(() => floats().every((t: any) => t.showing?.id === list().view.picked().id), "both restored readers follow the pick", 1500);
        await act("tile.close");
        expect(floats().map((t: any) => t.name)).toEqual(["my-reader"]);
      }
    } finally {
      if (change === "close") await act("tile.open", { kind: "reader", name: "garden", note: h.seeded.notes.peek.id }, "outside");
    }
  }, 15_000);

  test.each([
    ["open", false], ["tile.close", false], ["open", true], ["tile.close", true],
  ] as const)("an agent's %s leaves the person's peek and keys alone (editing=%s)", async (action, editing) => {
    await setup();
    await act("tile.open", { kind: "reader", name: "outside" });
    await act("list.open", { n: 2 });
    const peek = floats()[0], reader = stage().pane(peek.name).surface;
    if (editing) {
      h.ch("e");
      h.press({ kind: "enter" });
      await until(() => h.app.person().typingIn === peek.name, "the person's keys in the peek's editor");
      for (const ch of "Unsaved garden words") h.ch(ch);
      expect(reader.draft.text).toContain("Unsaved garden words");
    }
    const before = h.app.person(), text = reader.draft?.text;
    expect(before.focus).toBe(peek.name);
    expect(before.typingIn).toBe(editing ? peek.name : null);
    try {
      await agentSourceChange(action);
      const after = h.app.person();
      expect({ focus: after.focus, typingIn: after.typingIn }).toEqual({ focus: before.focus, typingIn: before.typingIn });
      expect(floats().find((t: any) => t.name === peek.name)?.showing?.id).toBe(peek.showing.id);
      if (editing) {
        expect(reader.draft.text).toBe(text);
        h.ch("!");
        expect(reader.draft.text).toContain("Unsaved garden words!");
      }
      h.press({ kind: "esc" });
      if (editing) { h.press({ kind: "esc" }); await until(() => !reader.draft, "discard the scratch edit"); h.press({ kind: "esc" }); }
      expect(floats().some((t: any) => t.name === peek.name)).toBe(true);
    } finally {
      if (reader.draft) { h.press({ kind: "esc" }); h.press({ kind: "esc" }); }
      if (action === "tile.close") await act("tile.open", { kind: "reader", name: "garden", note: h.seeded.notes.peek.id }, "outside");
    }
  }, 20_000);

  test.each(["open", "tile.close"] as const)("drawer focus: an agent's %s retires the abandoned peek without taking the drawer's keys", async action => {
    await setup();
    await act("tile.open", { kind: "reader", name: "outside" });
    await act("tile.focus");
    await act("list.enter", { on: true });
    await act("list.pick", { n: 1 });
    await until(() => floats().length === 1, "a picked card's float");
    const peek = floats()[0];
    h.press({ kind: "enter" });
    await until(() => h.app.person().focus === peek.name, "Enter reads the peek");
    h.press({ kind: "alt", ch: "a" });
    try {
      await until(() => h.app.person().keys === "host" && !!h.app.person().typingIn, "Alt+A enters the drawer");
      const before = h.app.person();
      await agentSourceChange(action);
      const after = h.app.person();
      expect({ address: after.address, keys: after.keys, typingIn: after.typingIn }).toEqual({ address: before.address, keys: before.keys, typingIn: before.typingIn });
      const source = stage().layoutGet().tiles.find((t: any) => t.name === "garden");
      if (action === "open") expect(source?.showing?.id).toBe(h.seeded.notes.shed.id);
      else expect(source).toBeUndefined();
      expect(stage().layoutGet().tiles.some((t: any) => t.tile === peek.tile)).toBe(false);
      h.press({ kind: "alt", ch: "a" });
      await until(() => h.app.person().keys === "screen", "Alt+A returns to the screen");
      expect(floats()).toHaveLength(0);
    } finally {
      await h.app.dispatch.press("host.toggle", { open: false });
      if (action === "tile.close") await act("tile.open", { kind: "reader", name: "garden", note: h.seeded.notes.peek.id }, "outside");
    }
  }, 20_000);

  test("a peek lands to the right of its source and keeps its note after another pick", async () => {
    await setup();
    await act("list.open", { n: 2 });
    const peek = floats()[0], kept = peek.showing.id;
    await act("tile.float", { on: false, where: "right" }, peek.name);
    const layout = stage().layoutGet();
    expect(floats()).toHaveLength(0);
    expect(layout.tree.split).toBe("row");
    expect(layout.tree.kids.map((t: any) => t.name)).toEqual(["garden", peek.name]);
    expect(layout.tiles.find((t: any) => t.name === peek.name).rect.col).toBeGreaterThan(layout.tiles.find((t: any) => t.name === "garden").rect.col);
    await act("tile.focus");
    await act("list.pick", { n: 1 });
    await until(() => floats().length === 1, "a fresh peek after landing", 1500);
    expect(stage().pane(peek.name).surface.msg.id).toBe(kept);
  }, 15_000);

  test("clickable pages are each actor's reading state and never edit the saved view", async () => {
    await setup();
    const before = await h.board.get(h.seeded.notes.peek.id);
    await agent("list.page", { by: 1 });
    expect((await act("list.blocks")).lists[0].page).toBe(1);
    expect((await agent("list.blocks")).lists[0].yours.page).toBe(2);
    expect(floats()).toHaveLength(0);
    expect(stage().focusedName()).toBe("garden");
    expect(h.screen()).toContain("gardener: page 2/2");
    const next = (await act("elements")).elements.find((e: any) => e.label === "▶");
    expect(next).toBeDefined();
    await act("button.press", { n: next.n });
    expect((await act("list.blocks")).lists[0].page).toBe(2);
    expect(h.screen()).toContain("2/2");
    await until(() => floats()[0]?.showing?.id === list().view.picked().id, "page previews its first card", 1500);
    await act("tile.close", {}, floats()[0].name);
    const lines = h.screen().split("\n"), y = lines.findIndex(line => line.includes("◀ 2/2 ▶")), x = lines[y]!.indexOf("◀");
    h.press({ kind: "mouse", action: "down", button: 0, x, y });
    h.press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => list().view.page === 0 && floats().length === 1, "clicking back previews page one", 1500);
    await act("tile.close", {}, floats()[0].name);
    const pickedLine = h.sc.render(h.app).lines.find(line => line.includes(list().view.picked().label))!;
    expect(pickedLine).not.toContain(RULER_BG);
    expect(pickedLine).not.toContain(ITEM_BG);
    const after = await h.board.get(h.seeded.notes.peek.id);
    expect(after?.revision).toBe(before?.revision);
    expect(after?.text).toBe(before?.text);
  }, 15_000);

  test("h l step across gallery columns and board lanes; H L step across groups", async () => {
    await setup();
    await act("list.enter", { on: true });
    await act("list.pick", { n: 1 });
    h.ch("l");
    await until(() => list().view.picked().id === list().view.pickable()[1].id, "l crosses a column", 1500);
    h.ch("h");
    await until(() => list().view.picked().id === list().view.pickable()[0].id, "h returns a column", 1500);
    const firstCard = list().view.picked().id;
    h.ch("H");
    await until(() => list().view.picked().id !== firstCard, "H crosses a gallery group", 1500);
    h.ch("L");
    await until(() => list().view.picked().id === firstCard, "L returns a gallery group", 1500);
    await act("list.layout", { layout: "board" });
    await until(() => list().detail.layout === "board", "board lanes", 4000);
    await act("list.pick", { n: 1 });
    const first = list().view.picked().group;
    h.ch("l");
    await until(() => list().view.picked().group !== first, "l crosses a lane", 1500);
    h.ch("H");
    await until(() => list().view.picked().group === first, "H returns a group", 1500);
    await agent("list.step", { by: 1, axis: "group" });
    expect(list().view.picked().group).toBe(first);
  }, 20_000);

  test.each(["gallery", "table", "feed"])("H/L keeps separate occurrences of a note in two %s groups", async layout => {
    await setup();
    const aster = await h.board.createBlock(null, `Aster [collection::step-${layout}] [bed::A] [bed::B]`);
    await h.board.createBlock(null, `Bluebell [collection::step-${layout}] [bed::B]`);
    const note = await h.board.createBlock(null, `Flower beds\n::view{query=collection=step-${layout} layout=${layout} group=bed sort="title asc"}`);
    await act("open", { id: note.id });
    await until(() => list()?.view.pickable()[0]?.id === aster.id, `${layout} flower beds`, 4000);
    await act("list.enter", { on: true });
    await act("list.pick", { n: 1 });
    const first = list().view.picked().group;
    h.ch("L");
    await until(() => list().view.picked().group !== first, `L reaches Aster's second ${layout} occurrence`, 1500);
    expect(list().view.picked().id).toBe(aster.id);
    h.ch("H");
    await until(() => list().view.picked().group === first, `H returns to Aster's first ${layout} occurrence`, 1500);
    expect(list().view.picked().id).toBe(aster.id);
  }, 15_000);

  test("container float and full rules apply after a tile's wire", async () => {
    await setup();
    const note = await h.board.createBlock(null, "Plain garden\n::view{query=collection=garden layout=gallery} ^plain");
    await act("open", { id: note.id });
    await until(() => list()?.key === "^plain", "plain collection", 4000);
    await act("layout.policy", { node: "screen", opens: "float" });
    await act("list.open", { n: 1 });
    expect(floats()).toHaveLength(1);
    await act("tile.close", {}, floats()[0].name);
    await act("layout.policy", { node: "screen", opens: "full" });
    const opened = list().view.pickable()[0].id;
    await act("list.open", { n: 1 });
    expect(stage().pane("garden").surface.msg.id).toBe(opened);
    expect(stage().layoutGet().zoom).toBe("garden");
    await act("tile.zoom", { on: false });
    await act("open", { id: note.id });
    await until(() => list()?.key === "^plain", "plain collection again", 4000);
    await act("tile.open", { kind: "reader", name: "wired" });
    await act("tile.link", { to: "wired", verb: "open" });
    await act("list.open", { n: 2 });
    expect(floats()).toHaveLength(0);
    expect(stage().pane("wired").surface.msg.id).toBe(list().view.pickable()[1].id);
  }, 15_000);
});
