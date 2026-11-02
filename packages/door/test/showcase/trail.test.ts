import { describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { connect } from "node:net";
import { Desk } from "../../src/desk/desk";
import type { SavedTree } from "../../src/desk/tiles";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { hostRequest, SocketBoard } from "../../src/socket";
import type { DoorOpen } from "@ep0ch/outline-core/door-open";
import { USER } from "../../src/socket";
import { useShowcaseScreen } from "./harness";
import { Trail } from "../../src/trail";
import { TrailPane } from "../../src/desk/trail-tile";
import { outlineState, readState, writeState } from "../../src/state";

describe.skipIf(!outliner)("showcase: the trail", () => {
  const h = useShowcaseScreen(177);
  const as = "test-agent";

  test("the day's forest retains a closed tile and reopens its visit in place", async () => {
    await h.app.act({ action: "section", args: { name: "trail" }, as });
    const desk = h.S().stages.get(h.S().sel).top;
    await h.app.act({ action: "trail.settings", args: { read: 0.05, held: 0.15, linger: 0.05 }, as });
    await desk.dispatch.act({ action: "open", args: { id: h.seeded.notes.trailGate.id }, tile: "walk" }, USER);
    const seed = await h.board.createBlock(null, "Seed catalogue\n\nSeeds for spring.");
    const opened = await desk.dispatch.act({ action: "tile.open", args: { kind: "reader", name: "seed", note: seed.id, where: "right" }, tile: "walk" }, USER);
    await until(() => h.app.trail.current(opened.tile) !== undefined, "the second tile's visit");
    const visit = h.app.trail.current(opened.tile)!;
    await until(() => h.app.trail.dwell(visit) === "held", "a held visit");
    await desk.dispatch.act({ action: "tile.close", tile: "seed" }, USER);
    expect(h.app.trail.places[opened.tile]?.closed).toBeTruthy();
    h.press({ kind: "enter" } as never);
    await desk.dispatch.act({ action: "trail", tile: "walk" }, USER);
    await until(() => h.screen().includes("Today") && h.screen().includes("tile closed"), "the forest and its closed visit");
    await desk.dispatch.act({ action: "trail.open", args: { visit: visit.open.target.visit }, tile: "trail" }, USER);
    expect(desk.paneNamed("seed")?.msg?.id).toBe(seed.id);
    const recent = await h.app.act({ action: "trail.recent", as }) as { open: { target: { note: string } } }[];
    expect(recent[0]?.open.target.note).toBe(seed.id);
    expect(h.screen()).toContain("●");
    await h.app.act({ action: "trail.settings", args: { read: 60, held: 300, linger: 30 }, as });
    await desk.dispatch.act({ action: "tile.open", args: { kind: "backlinks", source: "tile:walk", name: "links", where: "down" }, tile: "walk" }, USER);
    await desk.dispatch.act({ action: "tile.link", args: { to: "seed", verb: "select" }, tile: "links" }, USER);
    await desk.dispatch.act({ action: "backlinks", args: { id: h.seeded.notes.trailGate.id }, tile: "links" }, USER);

    const links = desk.paneNamed("links");
    const nextRow = () => links.rows().findIndex((r: { kind: string }) => r.kind === "outlink") + 1;
    await until(() => { h.screen(); return nextRow() > 0; }, "the walk's outlink listed");
    await desk.dispatch.act({ action: "list.pick", args: { n: nextRow() }, tile: "links" }, USER);
    await until(() => h.app.trail.current(opened.tile)?.open.method === "select", "a preview visit");
    const preview = h.app.trail.current(opened.tile)!;
    expect(h.app.trail.skim(preview)).toBe(true);
    expect(h.screen()).toContain("skimmed 1 from links");
    await desk.dispatch.act({ action: "tile.focus", tile: "seed" }, USER);
    await until(() => { h.screen(); h.ch("]"); return desk.paneNamed("seed").surface.describeElements().some((e: { current: boolean; kind: string }) => e.current && e.kind === "link"); }, "a link in the preview");
    expect(preview.attention.selections).toBeGreaterThan(0);
    h.press({ kind: "enter" });
    await until(() => h.app.trail.visits.some(v => v.open.source?.visit === preview.open.target.visit), "jumping from the preview makes it the parent");
    expect(h.app.trail.skim(preview)).toBe(false);
    expect(h.app.trail.dwell(preview)).toBe("read");
    const saved = await desk.dispatch.act({ action: "trail.save", args: { visit: preview.open.target.visit }, tile: "trail" }, USER);
    const note = await h.board.get(saved.note);
    expect(note?.text).toContain(preview.open.target.note);
    expect(note?.text).toContain("read");
    expect(note?.parentId).toBe(await h.board.inboxId());
    h.app.trail.flush();
    const restored = new Trail();
    expect(restored.get(preview.open.target.visit)?.attention.opens).toBeGreaterThan(0);
    expect(restored.places[opened.tile]?.name).toBe("seed");
    const focused = desk.focus;
    const children = await h.app.act({ action: "trail.children", args: { visit: preview.open.target.visit }, as });
    expect(children).toBeArray();
    expect(children).not.toEqual([]);
    expect(desk.focus).toBe(focused);
    await desk.dispatch.act({ action: "trail.forget", args: { visit: preview.open.target.visit }, tile: "trail" }, USER);
    expect(await h.app.act({ action: "trail.branch", args: { visit: preview.open.target.visit }, as })).toEqual([]);
  }, 90_000);

  function screen(root?: SavedTree) {
    const desk = new Desk({ name: "trail-regression", title: "Trail regression", layout: { root: root ?? { t: "split", dir: "row", weights: [1, 1], kids: [
      { t: "leaf", kind: "reader", name: "reader" }, { t: "leaf", kind: "trail", name: "trail" },
    ] } } });
    h.app.push(desk);
    desk.render(h.app);
    const act = (action: string, tile = "reader", args: Record<string, unknown> = {}) => desk.dispatch.act({ action, tile, args }, USER) as Promise<any>;
    return { desk, act, visit: (tile = "reader") => h.app.trail.current(desk.tileIdOfPane(desk.paneNamed(tile)!)!)! };
  }

  async function previews(desk: Desk, act: ReturnType<typeof screen>["act"]) {
    const target = await h.board.createBlock(null, "Preview target");
    const notes = [];
    for (let i = 0; i < 20; i++) notes.push(await h.board.createBlock(null, `Preview ${i}\n((${target.id}))`));
    await act("tile.open", "reader", { kind: "reader", name: "source", note: target.id, where: "right" });
    await act("tile.open", "reader", { kind: "backlinks", name: "links", source: "tile:source", where: "down" });
    await act("backlinks", "links", { id: target.id });
    await act("tile.link", "links", { to: "reader", verb: "select" });
    const links = desk.paneNamed("links") as any;
    await until(() => { desk.render(h.app); return links.rows().some((r: any) => r.kind === "kind"); }, "backlink group");
    await act("list.pick", "links", { n: links.rows().findIndex((r: any) => r.kind === "kind") + 1 });
    await act("list.open", "links");
    await until(() => { desk.render(h.app); return links.rows().filter((r: any) => r.kind === "backlink").length === 20; }, "twenty backlinks");
    const indices = links.rows().flatMap((r: any, i: number) => r.kind === "backlink" ? [i + 1] : []);
    return indices;

  }

  test("regression: previews qualify once at the service, while every landing reaches the local feed", async () => {
    const { desk, act, visit } = screen();
    const local: DoorOpen[] = [], remote: DoorOpen[] = [];
    const off = h.app.subscribe(e => { if (e.type === "door.open") local.push(e as unknown as DoorOpen); });
    const observer = connect(h.scratch.sock);
    let buffer = "";
    await new Promise<void>((resolve, reject) => {
      observer.on("error", reject);
      observer.on("data", data => {
        buffer += data;
        for (;;) {
          const n = buffer.indexOf("\n"); if (n < 0) break;
          const message = JSON.parse(buffer.slice(0, n)); buffer = buffer.slice(n + 1);
          if (message.result?.subscribed) resolve();
          if (message.event?.door) remote.push(message.event.door);
        }
      });
      observer.write(JSON.stringify({ id: "subscribe", action: "events.subscribe", client: { clientId: "preview-observer", contextId: "garden", role: "observer" } }) + "\n");
    });
    try {
      h.app.trail.configure({ linger: 60 });
      const indices = await previews(desk, act);
      for (const n of indices) await act("list.pick", "links", { n });
      expect(local.filter(e => e.method === "select")).toHaveLength(20);
      await act("tile.open", "trail", { kind: "reader", name: "barrier", note: h.seeded.notes.trailGate.id, where: "right" });
      const barrier = local.at(-1)!;
      await until(() => remote.some(e => e.target.visit === barrier.target.visit), "service barrier");
      expect(remote.filter(e => e.method === "select")).toHaveLength(0);
      const preview = visit();
      await act("reading.step", "reader", { by: 1 });
      expect(h.app.trail.skim(preview)).toBe(false);
      await until(() => remote.some(e => e.target.visit === preview.open.target.visit), "j/k preview delivered");
      await act("scroll", "reader", { by: 1 });
      await act("list.pick", "links", { n: indices[1] });
      const selected = visit();
      await act("tile.focus"); desk.render(h.app); h.ch("]");
      await until(() => remote.some(e => e.target.visit === selected.open.target.visit), "selected preview delivered");
      await act("list.pick", "links", { n: indices[2] });
      const jumped = visit();
      await act("open", "reader", { id: h.seeded.notes.trailGate.id });
      await until(() => remote.some(e => e.target.visit === jumped.open.target.visit), "jumped-from preview delivered");
      h.app.trail.configure({ linger: 0.05 });
      await act("list.pick", "links", { n: indices[0] });
      const linger = visit();
      await until(() => remote.some(e => e.target.visit === linger.open.target.visit), "lingering preview delivered");
      expect(remote.filter(e => e.target.visit === preview.open.target.visit)).toHaveLength(1);
      expect(remote.filter(e => e.target.visit === selected.open.target.visit)).toHaveLength(1);
      expect(remote.filter(e => e.target.visit === jumped.open.target.visit)).toHaveLength(1);
    } finally { off(); observer.destroy(); h.app.pop(); }
  }, 30_000);

  test("regression: a selected visit stays selected when today's visits push yesterday down", async () => {
    const { desk, act, visit } = screen();
    try {
      h.app.trail.forget({ all: true });
      await act("open", "reader", { id: h.seeded.notes.trailGate.id });
      const yesterday = visit();
      yesterday.open.at -= 86_400_000;
      const other = await h.board.createBlock(null, "Today's seed list");
      await act("tile.open", "trail", { kind: "reader", name: "today", note: other.id, where: "down" });
      await act("trail.fold", "trail", { on: false });
      const trail = desk.paneNamed("trail") as TrailPane;
      const picked = () => trail.describe(desk).rows[trail.describe(desk).at - 1]?.visit;
      await act("trail.pick", "trail", { n: trail.rows(desk).findIndex(r => r.visit === yesterday) + 1 });
      await act("open", "today", { id: h.seeded.notes.trailGate.id });
      desk.render(h.app);
      expect(picked()).toBe(yesterday.open.target.visit);
      const saved = await act("trail.save", "trail");
      expect((await h.board.get(saved.note))?.text).toContain(yesterday.title);
      await act("trail.forget", "trail");
      expect(h.app.trail.get(yesterday.open.target.visit)).toBeUndefined();
      expect(h.app.trail.get(visit("today").open.target.visit)).toBeDefined();
    } finally { h.app.pop(); }
  });

  test("regression: Trail clicks select, double-click reopens, and alt-click uses open here", async () => {
    const { desk, act, visit } = screen();
    try {
      h.app.trail.forget({ all: true });
      await act("open", "reader", { id: h.seeded.notes.trailGate.id });
      const before = visit();
      await act("tile.focus", "trail");
      h.app.flush();
      const trail = desk.paneNamed("trail") as TrailPane;
      const click = (mods = 0) => {
        const r = desk.rectOf(trail)!;
        const lines = h.painted.map(l => l.replace(/\x1b\[[\d;]*[A-Za-z]/g, ""));
        const y = lines.findIndex(line => line.slice(r.col).includes(before.title));
        expect(y).toBeGreaterThan(-1);
        const x = r.col + 3;
        h.press({ kind: "mouse", action: "down", button: 0, mods, x, y });
        h.press({ kind: "mouse", action: "up", button: 0, mods, x, y });
      };
      click();
      await Bun.sleep(100);
      expect(visit()).toBe(before);
      click();
      await until(() => visit() !== before, "double-click reopened the visit");
      h.app.flush();
      click(8);
      await until(() => h.app.doorOpens().at(-1)?.method === "alt", "alt-click used open here");
      expect(h.app.doorOpens().at(-1)?.target.note).toBe(before.open.target.note);
    } finally { h.app.pop(); }
  }, 15_000);

  test("regression: trail.json from an earlier build keeps visits and defaults missing thresholds", async () => {
    h.app.trail.flush();
    const kept = readState<any>("trail.json", outlineState());
    const load = async (visits: unknown) => {
      writeState("trail.json", { ...kept, visits, settings: { days: 7, idle: 60 } }, outlineState());
      const child = Bun.spawn([process.execPath, "-e", `import { Trail } from './packages/door/src/trail'; const t = new Trail(); console.log(JSON.stringify({ settings: t.settings, visits: t.visits }));`], { cwd: new URL("../../../..", import.meta.url).pathname, env: { ...process.env }, stdout: "pipe", stderr: "pipe" });
      const [output, warning, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(exit).toBe(0);
      return { ...JSON.parse(output), warning };
    };
    try {
      const restored = await load([...kept.visits, { open: {} }, { open: {} }]);
      expect(restored.settings).toMatchObject({ held: 300, read: 60, linger: 5, days: 7, idle: 60 });
      expect(restored.visits).toEqual(kept.visits);
      expect(restored.warning.trim().split("\n")).toHaveLength(1);
      expect(restored.warning).toContain("2 visits");
      expect((await load({})).visits).toEqual([]);
    } finally { writeState("trail.json", kept, outlineState()); }
  });

  test("regression: a foreign visit reopens in place, opens here and saves an addressed link", async () => {
    await hostRequest(h.scratch.sock, "outlines.create", { name: "orchard" });
    const other = new SocketBoard(h.scratch.sock, undefined, "orchard");
    const info = await other.info(), note = await other.createBlock(null, "Orchard notebook");
    const uri = formatEp0chBlockUri({ outline: "orchard", machine: info.machine!, blockId: note.id });
    const { desk, act, visit } = screen();
    try {
      await act("open", "reader", { id: uri });
      const v = visit();
      await act("tile.close");
      await act("trail.open", "trail", { visit: v.open.target.visit });
      expect((desk.paneNamed("reader") as any).msg?.address?.outline).toBe("orchard");
      await act("trail.here", "trail", { visit: v.open.target.visit });
      const saved = await act("trail.save", "trail", { visit: v.open.target.visit });
      expect((await h.board.get(saved.note))?.text).toContain(uri);
    } finally { h.app.pop(); other.close(); }
  });

  test("regression: the second group's closed reader returns to that same group", async () => {
    const { desk, act } = screen();
    try {
      for (const name of ["a", "b", "c"]) await act("tile.open", "reader", { kind: "reader", name, where: "right" });
      await act("tile.group", "reader", { with: "a", name: "first" });
      await act("tile.group", "b", { with: "c", name: "second" });
      await until(() => !!(desk.paneNamed("second") as any).inner?.ctx, "second group ready");
      desk.render(h.app);
      await act("open", "second/b", { id: h.seeded.notes.trailGate.id });
      const inner = (desk.paneNamed("second") as any).inner as Desk;
      const tid = inner.tileIdOfPane(inner.paneNamed("b")!)!;
      const v = h.app.trail.current(tid)!;
      await act("tile.close", "second/b");
      await act("trail.open", "trail", { visit: v.open.target.visit });
      expect(inner.paneNamed("b")).toBeTruthy();
      expect(inner.tileIdOfPane(inner.paneNamed("b")!)).toBe(tid);
    } finally { h.app.pop(); }
  });

  test("regression: the last reader rebuilds its named container", async () => {
    const { desk, act, visit } = screen({ t: "split", dir: "row", weights: [1, 1], kids: [
      { t: "leaf", kind: "trail", name: "trail" },
      { t: "split", dir: "col", key: "details", weights: [1], kids: [{ t: "leaf", kind: "reader", name: "reader" }] },
    ] });
    try {
      await act("open", "reader", { id: h.seeded.notes.trailGate.id });
      const v = visit();
      await act("tile.close");
      await act("trail.open", "trail", { visit: v.open.target.visit });
      expect(JSON.stringify(desk.layoutGet().tree)).toContain('"key":"details"');
      expect((desk.paneNamed("reader") as any).msg?.id).toBe(h.seeded.notes.trailGate.id);
    } finally { h.app.pop(); }
  });

  test("regression: a dock's sole reader returns docked on the same edge", async () => {
    const { desk, act, visit } = screen();
    try {
      await act("open", "reader", { id: h.seeded.notes.trailGate.id });
      await act("tile.dock", "reader", { edge: "left" });
      const v = visit();
      await act("tile.close");
      await act("trail.open", "trail", { visit: v.open.target.visit });
      expect(desk.layoutGet().tiles.find(t => t.name === "reader")).toMatchObject({ edge: "left", dock: "open" });
    } finally { h.app.pop(); }
  });

  for (const view of ["forest", "timeline", "tile"]) test(`regression: ${view} folds quick flips and f reveals them`, async () => {
    const { desk, act } = screen();
    try {
      h.app.trail.forget({ all: true }); h.app.trail.configure({ read: 60, held: 300 });
      h.app.trail.configure({ linger: 60 });
      const indices = await previews(desk, act);
      h.app.trail.forget({ all: true });
      for (const n of indices) await act("list.pick", "links", { n });
      await act("trail.view", "trail", { view });
      const trail = desk.paneNamed("trail") as any;
      expect(trail.rows(desk).filter((r: any) => r.visit).length).toBeLessThan(20);
      await act("trail.fold", "trail", { on: false });
      expect(trail.rows(desk).filter((r: any) => r.visit)).toHaveLength(20);
    } finally { h.app.pop(); }
  });

  test("regression: leaving a screen with an empty mount and a retained tile closes only disposed visits", async () => {
    const { desk, act, visit } = screen({ t: "split", dir: "row", weights: [1, 1, 1], kids: [
      { t: "leaf", kind: "reader", name: "reader" },
      { t: "leaf", kind: "pty", name: "trail-retained-program", cmd: ["sh"] },
      { t: "leaf", kind: "screen", name: "empty", inner: { root: { t: "split", dir: "row", key: "empty", kids: [], weights: [] } } },
    ] });
    await act("open", "reader", { id: h.seeded.notes.trailGate.id });
    const v = visit();
    await act("tile.open", "reader", { kind: "reader", name: "carried", note: h.seeded.notes.trailGate.id, where: "right" });
    const carried = visit("carried");
    await act("tile.drawer", "carried");
    const shell = desk.paneNamed("trail-retained-program") as import("../../src/desk/pty").PtyPane;
    await until(() => shell.running, "the terminal that stays running in the drawer");
    await act("tile.open", "reader", { kind: "reader", name: "dropped", note: h.seeded.notes.trailGate.id, where: "down" });
    await act("tile.close", "dropped");
    h.app.pop();
    desk.dispose();
    expect(h.app.drawer.made!.paneNamed("trail-retained-program")).toBe(shell);
    expect(h.app.trail.current(carried.open.target.tile)).toBe(carried);
    expect(h.app.trail.places[carried.open.target.tile]?.closed).toBeUndefined();
    expect(h.app.trail.query("closed").map(v => v.open.target.visit)).toContain(v.open.target.visit);
    expect(v.left).toBeDefined();
    expect(h.app.trail.seconds(v, Date.now() + 60_000)).toBe(h.app.trail.seconds(v));
    shell.dispose();
  });

});
