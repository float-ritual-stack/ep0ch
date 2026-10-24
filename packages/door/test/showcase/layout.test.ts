// PIE-439: the showcase screen, layout: spine, move, folds, hyper, mounts and groups. One of the showcase's test files (split from the one file, so a
// section's test is a file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../../src/app";
import { openScreen } from "../../src/desk/screen-specs";
import { type Seeded } from "../../src/showcase/seed";
import { SECTIONS, Showcase } from "../../src/showcase/showcase";
import { USER, SocketBoard } from "../../src/socket";
import { contrast, THEMES } from "../../src/theme";
import { Mirror } from "../../src/mirror";
import { hyperOn, useHyper } from "../../src/hyper";
import { KeyDecoder, type Key } from "../../src/term";
import { outliner, Scratch, until } from "../scratch";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};


const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";
import { prop } from "../../src/props";

describe.skipIf(!outliner)("the showcase screen: layout: spine, move, folds, hyper, mounts and groups", () => {
  const h = useShowcaseScreen();
  const { scratch, written, press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });

  test("lift mouse: the covered Welcome band cannot take a click", async () => {
    await app.dispatch.press("host.toggle", { open: false });
    const d = openScreen("welcome") as any;
    app.push(d);
    try {
      (app as any).paint(true);
      const welcome = d.pane("welcome"), logo = welcome.tabs.find((t: any) => t.logo);
      expect(logo).toBeDefined();
      const before = welcome.logo;
      await d.dispatch.act({ action: "tile.zoom", tile: "preview", args: { reach: "full", on: true } }, USER);
      (app as any).paint(true);
      const decoder = new KeyDecoder((app as any).term.info);
      decoder.keyHandler = press;
      decoder.feed(`\x1b[<0;${logo.from + 1};${logo.y0 + 1}M\x1b[<0;${logo.from + 1};${logo.y0 + 1}m`);
      expect(welcome.logo).toBe(before);
      expect(d.lifted?.reach).toBe("full");
    } finally { d.dropLift(); app.pop(); }
  });

  for (const place of ["screen", "group", "drawer", "drawer group"] as const) {
    const withLift = async (run: (owner: any, mouse: (button: number, x: number, y: number, release?: boolean) => void) => Promise<void>) => {
      await app.dispatch.press("host.toggle", { open: false });
      await sc.dispatch.press("section.leave");
      await sc.dispatch.press("section", { name: "lift" });
      screen();
      const d = sc.tilesHere()!, original = d.layoutSpec();
      (d as any).build({ root: { t: "split", dir: "row", kids: [{ t: "split", dir: "col", kids: ["brief", "peer"].map(name => ({ t: "leaf", kind: "reader", name, note: seeded.notes.hub.id })) }, { t: "leaf", kind: "reader", name: "outside", note: seeded.notes.hub.id }] }, focus: "brief" }, true);
      let target = "brief", transferred: string | undefined, owner: any;
      const grouped = place.includes("group"), inDrawer = place.includes("drawer");
      try {
        if (grouped) target = (await d.dispatch.act({ action: "tile.group", tile: "brief", args: { with: "peer" } }, USER) as { name: string }).name;
        if (inDrawer) {
          await d.dispatch.act({ action: "tile.drawer", tile: target }, USER);
          transferred = target;
          await app.dispatch.press("host.enter");
        } else await sc.dispatch.press("section.try");
        (app as any).paint(true);
        const root = inDrawer ? app.drawer.made! : d;
        owner = grouped ? (root.pane(target) as any).inner : root;
        // Keep a covered header and a divider below the lifted tile's new header.
        if (grouped || inDrawer) {
          const spec = owner.layoutSpec();
          if (grouped) (owner as any).build({ ...spec, root: { ...spec.root, dir: "col" } }, true);
          if (inDrawer && !grouped) await owner.dispatch.act({ action: "tile.open", tile: "brief", args: { kind: "reader", name: "mouse-peer", where: "down" } }, USER);
        }
        if (inDrawer) await root.dispatch.act({ action: "tile.open", tile: target, args: { kind: "reader", name: "mouse-side", where: "left" } }, USER);
        (app as any).paint(true);
        const decoder = new KeyDecoder((app as any).term.info);
        decoder.keyHandler = press;
        const mouse = (button: number, x: number, y: number, release = false) => decoder.feed(`\x1b[<${button};${x + 1};${y + 1}${release ? "m" : "M"}`);
        await run(owner, mouse);
      } finally {
        app.toast = null;
        if (owner?.holdsKeys()) owner.key({ kind: "esc" }, owner.ctx);
        for (const overlay of owner?.overlays.all() ?? []) overlay.close(owner);
        for (const desk of app.drawer.desks()) desk.liftedDesk?.dropLift();
        if (inDrawer && app.drawer.made?.pane("mouse-side")) await app.drawer.made.dispatch.act({ action: "tile.close", tile: "mouse-side" }, USER);
        if (inDrawer && !grouped && app.drawer.made?.pane("mouse-peer")) await app.drawer.made.dispatch.act({ action: "tile.close", tile: "mouse-peer" }, USER);
        if (transferred && app.drawer.made?.pane(transferred)) await app.drawer.made.dispatch.act({ action: "tile.drawer", tile: transferred }, USER);
        for (const pane of (d as any).panes.values()) pane.dispose?.();
        (d as any).build(original, false);
        if (inDrawer) await app.drawer.made!.dispatch.act({ action: "tile.focus", tile: "drawer.agent" }, USER);
        await app.dispatch.press("host.toggle", { open: false });
        await sc.dispatch.press("section.leave");
      }
    };

    for (const covered of ["menu", "divider", "hint"] as const) test(`lift mouse: covered ${covered} in ${place} cannot take input`, () => withLift(async (owner, mouse) => {
      const menu = owner.menuButtons.find((b: any) => b.id === owner.tile(place === "drawer" ? "mouse-peer" : "peer").id);
      expect(menu).toBeDefined();
      const divider = owner.dividers.find((d: any) => d.node.dir === "col");
      expect(divider).toBeDefined();
      const hint = owner.keySpots[0];
      const before = owner.layoutGet().tree;
      await owner.dispatch.act({ action: "tile.zoom", tile: "brief", args: { reach: "full", on: true } }, USER);
      (app as any).paint(true);
      if (covered === "menu") {
        mouse(0, menu.from, menu.row); mouse(0, menu.from, menu.row, true);
        expect(owner.overlaid()).toBe(false);
      } else if (covered === "hint") {
        expect(hint).toBeDefined();
        mouse(0, hint.from, hint.y); mouse(0, hint.from, hint.y, true);
        expect(owner.holdsKeys()).toBe(false);
      } else {
        const x = divider.area.col + 3, y = divider.at;
        mouse(0, x, y); mouse(32, x, y + 3); mouse(0, x, y + 3, true);
      }
      expect(owner.layoutGet().tree).toEqual(before);
      expect(owner.lifted?.reach).toBe("full");
    }), 30_000);

    test(`lift mouse: the hint row outside the column in ${place} receives its click`, () => withLift(async (owner, mouse) => {
      await owner.dispatch.act({ action: "tile.zoom", tile: "brief", args: { reach: "column", on: true } }, USER);
      (app as any).paint(true);
      const hint = owner.keySpots.find((s: any) => s.key.kind === "char" && s.key.ctrl && s.key.ch === "w");
      expect(hint).toBeDefined();
      expect(hint.from).toBeLessThan(owner.liftedRect.col);
      mouse(0, hint.from, hint.y); mouse(0, hint.from, hint.y, true);
      expect(owner.lifted?.reach).toBe("column");
      expect(owner.holdsKeys()).toBe(true);
      press({ kind: "esc" });
      expect(owner.lifted?.reach).toBe("column");
    }), 30_000);

    test(`lift mouse: an overlay outside the column in ${place} owns its clicks`, () => withLift(async (owner, mouse) => {
      await owner.dispatch.act({ action: "tile.zoom", tile: "brief", args: { reach: "column", on: true } }, USER);
      (app as any).paint(true);
      const r = owner.liftedRect;
      const x = r.col > 10 ? 2 : r.col + r.cols + 2;
      expect(x).toBeLessThan(190);
      await owner.dispatch.act({ action: "tile.menu", tile: "brief", args: { at: `${x},8` } }, USER);
      (app as any).paint(true);
      mouse(0, x, 8); mouse(0, x, 8, true);
      expect(owner.overlaid()).toBe(true);
      expect(owner.lifted?.reach).toBe("column");
      mouse(0, x, 58); mouse(0, x, 58, true);
      expect(owner.overlaid()).toBe(false);
      expect(owner.lifted?.reach).toBe("column");
    }), 30_000);
  }


  test("lift: the host draws above the drawer, drops on outside work, and keeps the layout", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "lift" }, as: "test-agent" });
    screen();
    const d = sc.tilesHere()!;
    await app.act({ action: "host.toggle", args: { open: true }, as: "test-agent" });
    (app as any).paint(true);
    const before = await app.act({ action: "layout.get", as: "test-agent" });
    for (let i = 0; i < 10; i++) {
      await app.act({ action: "tile.zoom", tile: "other", args: { reach: "column" }, as: "test-agent" });
      (app as any).paint(true);
      expect(h.painted.map(plain).join("\n")).toContain("⇣");
      expect(d.lifted?.reach).toBe("column");
      await app.act({ action: "tile.zoom", tile: "other", args: { reach: "column", on: false }, as: "test-agent" });
    }
    screen();
    expect(await app.act({ action: "layout.get", as: "test-agent" })).toEqual(before);
    await app.act({ action: "tile.zoom", tile: "other", args: { reach: "column" }, as: "test-agent" });
    (app as any).paint(true);
    press({ kind: "mouse", action: "down", button: 0, x: 170, y: 10 });
    press({ kind: "mouse", action: "up", button: 0, x: 170, y: 10 });
    expect(S().focus).toBe("stage");
    press({ kind: "esc" });
    press({ kind: "char", ch: "w", ctrl: true }); ch("Z");
    (app as any).paint(true);
    expect(d.lifted?.reach).toBe("column");
    press({ kind: "mouse", action: "wheel-up", button: 0, mods: 16, x: 170, y: 0 });
    expect(d.lifted?.reach).toBe("full");
    (app as any).paint(true);
    press({ kind: "mouse", action: "wheel-down", button: 0, mods: 16, x: 170, y: 0 });
    expect(d.lifted?.reach).toBe("column");
    (app as any).paint(true);
    ch("e"); press({ kind: "enter" });
    await until(() => !!d.keys().typingIn, "editing the lifted note");
    ch("x");
    expect(d.lifted?.reach).toBe("column");
    press({ kind: "esc" });
    expect(d.lifted?.reach).toBe("column");
    press({ kind: "esc" });
    expect(d.lifted).toBeNull();
    press({ kind: "char", ch: "w", ctrl: true }); ch("Z");
    (app as any).paint(true);
    press({ kind: "mouse", action: "down", button: 0, x: 5, y: 55 });
    expect(d.lifted).toBeNull();
    await app.act({ action: "tile.zoom", tile: "brief", args: { reach: "column" }, as: "test-agent" });
    expect(d.lifted?.reach).toBe("column");
    (app as any).term.rawSink()("# typing in the drawer\r");
    expect(d.lifted).toBeNull();
    press({ kind: "alt", ch: "a" });
    await sc.dispatch.press("section.leave");
    (app as any).lastInput = 0;
  }, 30_000);

  for (const cover of ["vertical fold", "horizontal fold", "flow"] as const) {
    test(`lift content: ${cover} accepts scrolling and editing while lifted`, async () => {
      await sc.dispatch.press("section.leave");
      await sc.dispatch.press("section", { name: "lift" });
      screen();
      const d = sc.tilesHere()!, original = d.layoutSpec();
      const note = await board.request<any>("create", { parentId: null, text: "Lift log\n" + Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join("\n"), author: "agent" });
      const kids = ["brief", "other"].map(name => ({ t: "leaf" as const, kind: "reader", name, note: note.id }));
      (d as any).build({ root: cover === "flow" ? { t: "flow", kids, policy: { readable: 180 } } : { t: "split", dir: cover === "horizontal fold" ? "col" : "row", kids }, focus: "brief" }, false);
      try {
        await app.dispatch.press("host.toggle", { open: false });
        await sc.dispatch.press("section.try");
        if (cover !== "flow") await d.dispatch.act({ action: "tile.collapse", tile: "brief", args: { on: true, dir: cover === "horizontal fold" ? "h" : "v" } }, USER);
        else await d.dispatch.act({ action: "tile.widen", tile: "other" }, USER);
        await d.dispatch.act({ action: "tile.focus", tile: "brief" }, USER);
        const reader = d.pane("brief") as any;
        await until(() => !!reader.msg, "the folded note loaded");
        if (cover === "flow") expect(d.coverOf(reader)).toMatch(/^(peek|spine)$/);
        await d.dispatch.act({ action: "tile.zoom", tile: "brief", args: { reach: "full", on: true } }, USER);
        (app as any).paint(true);
        const line = reader.surface.readingSourceLine();
        ch("j");
        await until(() => reader.surface.readingSourceLine() > line, "moving the lifted reading line");
        (app as any).lastInput = 0;
        await d.dispatch.act({ action: "edit", tile: "brief" }, cover === "flow" ? { kind: "agent", id: "lift-editor" } : USER);
        await until(() => reader.editing, "editing lifted content");
        press({ kind: "esc" });
        ch("e"); press({ kind: "enter" });
        await until(() => !!d.keys().typingIn, "editing lifted content by key");
        press({ kind: "esc" });
      } finally {
        d.dropLift();
        (d as any).build(original, false);
        await sc.dispatch.press("section.leave");
      }
    }, 30_000);
  }

  test("lift focus: an idle agent focus move preserves the person's lift", async () => {
    await sc.dispatch.press("section.leave");
    await sc.dispatch.press("section", { name: "lift" });
    screen();
    const d = sc.tilesHere()!;
    await d.dispatch.act({ action: "tile.focus", tile: "brief" }, USER);
    await d.dispatch.act({ action: "tile.zoom", tile: "brief", args: { reach: "full", on: true } }, USER);
    try {
      (app as any).lastInput = 0;
      await d.dispatch.act({ action: "tile.focus", tile: "other" }, { kind: "agent", id: "lift-agent" });
      expect(d.layoutGet().focus).toBe("other");
      expect(d.lifted?.reach).toBe("full");
    } finally {
      d.dropLift();
      await sc.dispatch.press("section.leave");
    }
  });

  for (const place of ["group", "drawer", "drawer group", "spines"] as const) {
    test(`lift: a tile in ${place} keeps its column above the drawer`, async () => {
      await app.dispatch.press("host.toggle", { open: false });
      await sc.dispatch.press("section.leave");
      await sc.dispatch.press("section", { name: "lift" });
      screen();
      const d = sc.tilesHere()!;
      const original = d.layoutSpec();
      (d as any).build({ root: { t: "split", dir: "row", kids: ["left", "brief", "peer", "right"].map(name => ({
        t: "leaf" as const, kind: "reader", name, note: seeded.notes.hub.id,
      })) }, focus: "brief" }, false);
      const grouped = place === "group" || place === "drawer group";
      const inDrawer = place === "drawer" || place === "drawer group";
      let transferred: string | undefined;
      try {
        let target = "brief";
        if (grouped) {
          const g = await d.dispatch.act({ action: "tile.group", tile: "brief", args: { with: "peer" } }, USER);
          target = (g as { name: string }).name;
        }
        if (inDrawer) {
          await d.dispatch.act({ action: "tile.drawer", tile: target }, USER);
          transferred = target;
        } else if (place === "spines") {
          for (const tile of ["left", "right"]) await d.dispatch.act({ action: "tile.collapse", tile, args: { on: true } }, USER);
        }
        await app.dispatch.press("host.toggle", { open: true });
        (app as any).paint(true);
        const root = app.drawer.desks().find(desk => inDrawer ? app.drawer.isDrawer(desk) : desk === d)!;
        const owner = grouped ? (root.pane(target) as any).inner : root;
        const home = owner.layoutGet().tiles.find((t: any) => t.name === "brief")!.rect;
        const container = grouped ? root.layoutGet().tiles.find(t => t.name === target)!.rect : null;
        const col = home.col + (container ? root.screenOrigin.col + container.col + 1 : root.screenOrigin.col);
        if (place !== "spines") {
          await sc.dispatch.press("section.try");
          await app.dispatch.press("host.leave", { quiet: true });
          await d.dispatch.press("tile.focus", {}, "left");
        }
        const before = root.layoutSpec().root;
        await owner.dispatch.act({ action: "tile.zoom", tile: "brief", args: { reach: "column", on: true } }, USER);
        (app as any).paint(true);
        const rows = h.painted.map(plain);
        expect(rows[0]!.slice(col, col + home.cols)).toContain("⇣");
        expect(rows[57]![col]).toMatch(/[│║]/);
        expect(rows[57]![col + home.cols - 1]).toMatch(/[│║]/);
        expect(owner.lifted?.reach).toBe("column");
        press({ kind: "mouse", action: "down", button: 0, x: col + 3, y: 10 });
        ch("j");
        expect(owner.lifted?.reach).toBe("column");
        press({ kind: "esc" });
        expect(owner.lifted).toBeNull();
        expect(root.layoutSpec().root).toEqual(before);
        if (grouped) {
          await owner.dispatch.act({ action: "tile.collapse", tile: "brief", args: { on: true } }, USER);
          await owner.dispatch.act({ action: "tile.zoom", tile: "brief", args: { reach: "full", on: true } }, USER);
          await root.dispatch.act({ action: "tile.focus", tile: inDrawer ? "drawer.agent" : "left" }, USER);
          expect(owner.lifted).toBeNull();
        }
      } finally {
        if (transferred && app.drawer.made?.pane(transferred)) await app.drawer.made.dispatch.act({ action: "tile.drawer", tile: transferred }, USER);
        (d as any).build(original, false);
        await app.dispatch.press("host.toggle", { open: false });
        await sc.dispatch.press("section.leave");
      }
    }, 30_000);
  }

  for (const path of ["^W l", "alt+a", "status click", "ctrl+k", "tile.focus"] as const) {
    test(`lift dismissal: ${path} exposes the destination`, async () => {
      (app as any).lastInput = 0;
      await sc.dispatch.press("section.leave");
      await sc.dispatch.press("section", { name: "lift" });
      screen();
      const d = sc.tilesHere()!;
      await app.dispatch.press("host.toggle", { open: false });
      press({ kind: "enter" });
      await d.dispatch.press("tile.focus", {}, "brief");
      await d.dispatch.press("tile.zoom", { reach: "full", on: true }, "brief");
      (app as any).paint(true);
      expect(d.lifted?.reach).toBe("full");
      try {
        if (path === "^W l") { press({ kind: "char", ch: "w", ctrl: true }); ch("l"); }
        else if (path === "alt+a") press({ kind: "alt", ch: "a" });
        else if (path === "status click") {
          const chip = (app as any).statusBoxes.find((h: any) => h.item.id === "theme");
          press({ kind: "mouse", action: "down", button: 0, x: chip.from, y: 59 });
        }
        else if (path === "ctrl+k") press({ kind: "char", ch: "k", ctrl: true });
        else await d.dispatch.act({ action: "tile.focus", tile: "other" }, { kind: "user" });
        expect(d.lifted).toBeNull();
        if (path === "^W l" || path === "tile.focus") expect(d.layoutGet().focus).toBe("other");
        if (path === "alt+a") expect(app.drawer.entered).toBe(true);
        if (path === "ctrl+k") {
          ch("garden");
          expect((app as any).bar.describe().query).toBe("garden");
        }
      } finally {
        d.dropLift();
        await app.dispatch.press("bar.close");
        await app.dispatch.press("host.toggle", { open: false });
        await sc.dispatch.press("section.leave");
      }
    }, 30_000);
  }

  test("focus (PIE-969): the figure with the keys keeps its tint and the row under the cursor is a band with a bar, in every theme", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "focus" }, as: "test-agent" })).toMatchObject({ key: "focus" });
    const els = async () => { screen(); return ((await app.act({ action: "elements", tile: "figures", as: "test-agent" })) as any).elements as { kind: string; label: string; current?: boolean }[]; };
    for (let end = Date.now() + 8000; !(await els()).some(e => e.kind === "row" && e.label.includes("plant out")); await Bun.sleep(50))
      if (Date.now() > end) throw new Error("timed out waiting for the figure block's child rows");
    // The agent switches the theme through act (from the index: the showcase holds an agent off while the person is in a
    // section); the person walks into the stage and [ ] to a row of the figure. Each theme draws both levels from its tokens.
    for (const name of ["calm", "night", "classic"] as const) {
      (app as any).lastInput = 0;
      expect(await app.act({ action: "theme.set", args: { name }, as: "test-agent" })).toMatchObject({ theme: name });
      press({ kind: "enter" });
      expect(S().focus).toBe("stage");
      for (let i = 0; i < 80 && !(await els()).find(e => e.current && e.kind === "row" && e.label === "sow under glass"); i++) ch("]");
      expect((await els()).find(e => e.current)?.label).toBe("sow under glass");
      const t = THEMES[name], rgb = (c: readonly number[]) => `48;2;${c.join(";")}m`;
      const rows = sc.render(app).lines as string[];
      const cursor = rows.find(l => plain(l).includes("sow under glass") && plain(l).includes("┊"))!;
      // The row above it is the figure's own padding: the container's tint, none of the item band.
      const other = rows[rows.indexOf(cursor) - 1]!;
      expect(cursor, name).toBeDefined();
      // Item focus: the row's band and its bar; the figure's other rows wear the container's tint only.
      expect(cursor).toContain(rgb(t.focus.item.bg));
      const mirror = new Mirror(200, 1);
      mirror.write(cursor);
      const bandText = mirror.cells[0]!.filter(c => c.ch.trim() && c.bg?.join() === t.focus.item.bg.join());
      expect(bandText.map(c => c.ch).join(" ")).toContain("s o w");
      for (const c of bandText) expect(contrast([c.fg[0]!, c.fg[1]!, c.fg[2]!], t.focus.item.bg), `${name}: ${c.ch}`).toBeGreaterThanOrEqual(4.5);
      expect(cursor).toContain(`38;2;${t.focus.item.bar.join(";")}m▌`);
      expect(other).not.toContain(rgb(t.focus.item.bg));
      expect(other).toContain(rgb(t.focus.container));
      for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    }
    (app as any).lastInput = 0;
    await app.act({ action: "theme.set", args: { name: "calm" }, as: "test-agent" });
  }, 40_000);

  test("spine: the board's lanes are ordered by hand: card.reorder through act, alt+↓ and a drag", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "spine" }, as: "test-agent" })).toMatchObject({ key: "spine" });
    const desk = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "spine")).top as any; };
    const model = () => desk().modelFor("lanes") as any;
    await until(() => !!model()?.lanes?.length && model().lanes.every((l: any) => l.items), "the board's lanes", 8000);
    const queued = () => model().lanes.find((l: any) => l.name === "Queued");
    const ids = () => queued().items.map((m: any) => m.id);
    const first = ids();
    expect(first.length).toBeGreaterThan(1);
    // An agent puts the last card first.
    expect(await app.act({ action: "card.reorder", args: { card: first.at(-1), to: 0 }, as: "test-agent" })).toMatchObject({ lane: "Queued", position: 0 });
    await until(() => ids()[0] === first.at(-1), "the agent's reorder");
    // The person's alt+↓ on the first card.
    press({ kind: "enter" });
    model().lane = model().lanes.indexOf(queued()); queued().sel = 0;
    press({ kind: "alt-down" });
    await until(() => ids()[1] === first.at(-1), "alt+↓");
    // A drag of the second card onto the first's row.
    // The stage's tiles are placed inside the showcase's stage: a click is offset by where the stage is.
    const r = desk().rectOf(queued()), l = queued(), at = S().stageRect;
    const yOf = (i: number) => { for (let y = r.row + 1; y < r.row + r.rows; y++) if (l.rowAt(y - r.row - 1) === i) return y + at.row; throw new Error(`no row ${i}`); };
    const x = r.col + 4 + at.col, from = yOf(1), to = yOf(0), moving = ids()[1];
    press({ kind: "mouse", action: "down", button: 0, x, y: from });
    press({ kind: "mouse", action: "drag", button: 32, x, y: to });
    press({ kind: "mouse", action: "up", button: 0, x, y: to });
    await until(() => ids()[0] === moving, "the drag");
    press({ kind: "esc" });
  }, 30_000);


  test("move a note (PIE-943): tree.move through act, alt+↓ I O and ctrl+z by keys, the picker asked for by Z", async () => {
    (app as any).lastInput = 0;
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    const n = SECTIONS.findIndex(s => s.key === "move-note") + 1;
    expect(await app.act({ action: "section", args: { name: "move-note" }, as: "test-agent" })).toEqual({ section: n, key: "move-note" });
    const stage = () => { screen(); return S().stages.get(n - 1).top as any; };
    const tree = () => [...stage().panes.values()].find((p: any) => p.kind === "tree") as any;
    const rows = () => tree().describe().rows as { n: number; text: string; depth: number; id?: string; selected?: true }[];
    const parent = seeded.notes.moving.id;
    const kids = async () => (await board.children(parent)).map(m => m.text.split("\n")[0]);
    await until(() => rows().some(r => r.text === "Potting bench"), "the children of Moving notes in the outline", 8000);
    const depthOf = (title: string) => rows().find(r => r.text === title)?.depth ?? -1;
    const id = (title: string) => rows().find(r => r.text === title)!.id!;
    expect(await kids()).toEqual(["Cold frame", "Seed trays", "Potting bench"]);
    // An agent puts Seed trays first: attributed, and the person's selection stays on its row.
    const selected = () => rows().find(r => r.selected)?.text;
    const was = selected();
    expect(await app.act({ action: "tree.move", args: { id: id("Seed trays"), step: "up" }, as: "test-agent" })).toMatchObject({ moved: id("Seed trays"), parent });
    await until(() => rows().filter(r => r.depth === rows().find(x => x.text === "Cold frame")!.depth).map(r => r.text).join().startsWith("Seed trays,Cold frame"), "Seed trays first in the outline");
    expect(await kids()).toEqual(["Seed trays", "Cold frame", "Potting bench"]);
    expect(selected()).toBe(was);
    // A move under a system note is the guard's, as outline_move's: refused, said.
    const trash = (await board.roots()).find(r => prop(r, "system-view") === "trash")!.id;
    await expect(app.act({ action: "tree.move", args: { id: id("Seed trays"), to: trash }, as: "test-agent" })).rejects.toThrow(/which the service fills itself/);
    // The person, by keys: into the stage (the outline has them), onto Cold frame, alt+↓, I (in under the note above), O, ctrl+z.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    tree().selectRow(rows().find(r => r.text === "Cold frame")!.n - 1, stage(), false);
    press({ kind: "alt-down" });
    await until(() => rows().map(r => r.text).join().includes("Seed trays,Potting bench,Cold frame"), "alt+↓");
    expect(await kids()).toEqual(["Seed trays", "Potting bench", "Cold frame"]);
    press({ kind: "char", ch: "I" });
    await until(() => depthOf("Cold frame") > depthOf("Potting bench") && depthOf("Potting bench") >= 0, "alt+→: in under Potting bench");
    expect((await board.get(id("Cold frame")))!.parentId).toBe(id("Potting bench"));
    press({ kind: "char", ch: "O" });
    await until(() => depthOf("Cold frame") === depthOf("Potting bench") && depthOf("Potting bench") >= 0, "alt+←: out again");
    expect(await kids()).toEqual(["Seed trays", "Potting bench", "Cold frame"]);
    press({ kind: "char", ch: "z", ctrl: true });
    await until(() => depthOf("Cold frame") > depthOf("Potting bench") && depthOf("Potting bench") >= 0, "ctrl+z put the outdent back");
    press({ kind: "char", ch: "z", ctrl: true });
    await until(() => depthOf("Cold frame") >= 0 && depthOf("Cold frame") <= depthOf("Potting bench"), "ctrl+z put the indent back");
    // The picker: > (note.move) asks in the power bar where, the note's parent first; esc and nothing moved.
    const reader = [...stage().panes.entries()].find(([, p]: any) => p.kind === "reader")!;
    tree().selectRow(rows().find(r => r.text === "Moving notes")!.n - 1, stage());
    await until(() => (reader[1] as any).msg?.id === parent, "the reader on Moving notes");
    // Z, with the reader's keys (the menu's row and note.move are the same action).
    await stage().dispatch.press("tile.focus", {}, stage().nameOf(reader[0]));
    press({ kind: "char", ch: "Z" });
    const asking = () => (app as any).bar?.describe() as { scope: string; rows: { label: string }[] } | undefined;
    await until(() => asking()?.scope === "ask" && (asking()?.rows.length ?? 0) > 0, "the power bar asking where", 5000).catch(() => { throw new Error(JSON.stringify(asking())); });
    expect(asking()!.rows[0]!.label).toBe("Kitchen sink");
    press({ kind: "esc" });
    await until(() => asking()?.scope !== "ask", "the bar put away");
    // An agent names it: the greenhouse.
    const bench = id("Potting bench");
    expect(await app.act({ action: "note.move", args: { id: bench, to: seeded.notes.greenhouse.id }, as: "test-agent" })).toMatchObject({ parent: seeded.notes.greenhouse.id });
    expect((await board.get(bench))!.parentId).toBe(seeded.notes.greenhouse.id);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 60_000);


  test("book spines: gather by act, keys and the container menu; a clicked outer page joins the spread", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "book-spines" }, as: "test-agent" });
    await until(() => marks["book-spines"]!.every(m => screen().includes(m)), "the book spread");
    const stage = () => S().stages.get(S().sel).top as any;
    const tiles = () => { screen(); return (stage().describe().panes as any[]).slice().sort((a, b) => a.rect.col - b.rect.col); };
    const act = (action: string, args: Record<string, unknown>) => stage().dispatch.act({ action, tile: "cedar", args }, USER);
    const click = (x: number, y: number) => { press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y }); };
    const check = (left: number, right: number) => {
      const order = tiles(), open = order.filter(t => !t.collapsed);
      expect(order.indexOf(open[0])).toBe(left);
      expect(order.length - order.indexOf(open.at(-1)) - 1).toBe(right);
    };
    press({ kind: "enter" });
    for (const [label, side, key, left, right] of [
      ["align left", "right", "{", 0, 14], ["align centre", "centre", "|", 7, 7], ["align right", "left", "}", 14, 0],
    ] as const) {
      await act("layout.gather", { side }); check(left, right);
      await act("layout.gather", { side: "sides" });
      await stage().dispatch.press("tile.focus", {}, "cedar");
      press({ kind: "char", ch: "w", ctrl: true }); press({ kind: "char", ch: key });
      check(left, right);
      await act("layout.gather", { side: "sides" });
      await stage().dispatch.press("tile.menu", { q: label }, "cedar");
      const lines = screen().split("\n"), y = lines.findIndex(l => l.includes(label) && l.includes("^W"));
      expect(y).toBeGreaterThan(0);
      click(lines[y]!.indexOf(label) + 3, y);
      check(left, right);
    }
    // Left gather makes an outer spine with another spine between it and the open pages.
    await act("layout.gather", { side: "left" });
    const outer = tiles()[0], at = S().stageRect;
    click(at.col + outer.rect.col + 1, at.row + outer.rect.row + 3);
    await until(() => !tiles().find(t => t.name === outer.name).collapsed, "the clicked spine opens");
    const order = tiles(), open = order.filter(t => !t.collapsed);
    expect(order.indexOf(open.at(-1)) - order.indexOf(open[0])).toBe(open.length - 1);
    expect(Math.max(...open.map(t => t.rect.cols)) - Math.min(...open.map(t => t.rect.cols))).toBeLessThanOrEqual(1);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);

  test("folds: a tile folds to a spine by the glyph's click, alt+click, alt+h and act, and a click on the spine opens it with a fair share", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "folds" }, as: "test-agent" })).toMatchObject({ key: "folds" });
    await until(() => marks.folds!.every(m => screen().includes(m)), "the folds section");
    const stage = () => S().stages.get(S().sel).top;
    const tiles = () => stage().describe().panes as any[];
    const tile = (name: string) => tiles().find(x => x.name === name);
    const at = () => S().stageRect;
    const click = (x: number, y: number, mods?: number) => { press({ kind: "mouse", action: "down", button: 0, x, y, ...(mods ? { mods } : {}) }); press({ kind: "mouse", action: "up", button: 0, x, y, ...(mods ? { mods } : {}) }); };
    const glyph = (name: string) => { sc.render(app); return (stage().foldButtons as any[]).find(b => stage().nameOf(b.id) === name); };
    const clickGlyph = (name: string, mods?: number) => { const g = glyph(name); expect(g).toBeDefined(); click(at().col + g.from, at().row + g.row, mods); sc.render(app); };
    // By mouse: the outline folds down the side (3 cells), the reader folds into one row with alt+click; each a click on its spine opens it.
    const before = { tree: tile("tree").rect, reader: tile("reader").rect };
    clickGlyph("tree");
    expect(tile("tree").collapsed).toBe(true);
    expect(tile("tree").rect.cols).toBe(3);
    click(at().col + tile("tree").rect.col + 1, at().row + tile("tree").rect.row + 3); sc.render(app);
    expect(tile("tree").collapsed).toBeUndefined();
    expect(tile("tree").rect.cols).toBeGreaterThan(before.tree.cols);
    clickGlyph("reader", 8);
    expect(tile("reader")).toMatchObject({ collapsed: true, collapsedDir: "h" });
    expect(tile("reader").rect.rows).toBe(1);
    expect(sc.render(app).lines.map(plain).join("\n")).toContain("▸ ");
    click(at().col + tile("reader").rect.col + 2, at().row + tile("reader").rect.row); sc.render(app);
    expect(tile("reader").collapsed).toBeUndefined();
    expect(tile("reader").rect.rows).toBe(before.reader.rows);
    // By keys: alt+h on the focused tile and again.
    if (S().focus !== "stage") press({ kind: "enter" });
    const focused = tiles().find(x => x.focused).name;
    press({ kind: "alt", ch: "h" });
    expect(tile(focused).collapsed).toBe(true);
    press({ kind: "alt", ch: "h" });
    expect(tile(focused).collapsed).toBeUndefined();
    // By bare keys (PIE-699): - folds the focused tile, + and = open it, and - on a spine opens it too.
    press({ kind: "char", ch: "-" });
    expect(tile(focused).collapsed).toBe(true);
    press({ kind: "char", ch: "+" });
    expect(tile(focused).collapsed).toBeUndefined();
    press({ kind: "char", ch: "-" });
    press({ kind: "char", ch: "=" });
    expect(tile(focused).collapsed).toBeUndefined();
    press({ kind: "char", ch: "-" });
    press({ kind: "char", ch: "-" });
    expect(tile(focused).collapsed).toBeUndefined();
    // By act: an agent folds a tile the person doesn't have, horizontally, and opens it; the keys stay.
    const other = tiles().find(x => x.name === "activity" && !x.focused)?.name ?? "activity";
    const focus0 = tiles().find(x => x.focused).name;
    expect(await app.act({ action: "tile.collapse", tile: other, args: { dir: "v" }, as: "test-agent" })).toMatchObject({ collapsed: true, dir: "v" });
    expect(tile(other)).toMatchObject({ collapsed: true, collapsedBy: "test-agent" });
    expect(await app.act({ action: "tile.expand", tile: other, args: {}, as: "test-agent" })).toMatchObject({ collapsed: false });
    expect(tiles().find(x => x.focused).name).toBe(focus0);
    await expect(app.act({ action: "tile.collapse", tile: focus0, args: { on: true }, as: "test-agent" })).rejects.toThrow(/has the person's keys/);
    press({ kind: "esc" });
  }, 30_000);


  test("hyper (PIE-699): mods-15 Kitty reports reach the door from a draft and from a terminal tile once the layer is on; keys.probe shows what a chord arrived as", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "hyper" }, as: "test-agent" })).toMatchObject({ key: "hyper" });
    await until(() => marks.hyper!.every(m => screen().includes(m)), "the hyper section");
    if (S().focus !== "stage") press({ kind: "enter" });
    const stage = () => S().stages.get(S().sel).top;
    const tiles = () => stage().describe().panes as any[];
    const tile = (name: string) => tiles().find(x => x.name === name);
    /** A terminal's bytes through the door's own decoder, the keys it makes pressed as the terminal's would be. */
    const sent = (bytes: string) => {
      const seen: Key[] = [], d = new KeyDecoder({ cols: 100, rows: 30, cellW: 9, cellH: 16, kitty: false } as any);
      d.keyHandler = k => seen.push(k);
      d.rawSink = stage().rawKeys?.() ? () => () => {} : null;
      d.feed(bytes);
      (app as any).term.lastSeq = d.lastSeq;
      for (const k of seen) press(k);
      return seen;
    };
    const reader = tiles().find(x => x.kind === "reader").name;
    // Off (the default): the chord is super+K, nothing folds, and the hint row has no chip.
    expect(hyperOn()).toBe(false);
    expect(sent("\x1b[45;16u")).toEqual([{ kind: "super", ch: "-" }]);
    expect(tile(reader).collapsed).toBeUndefined();
    expect(stage().hyperChip).toBeNull();
    // On: ✦- folds the focused tile, ✦= opens it; the chip is on the hint row.
    useHyper(true);
    try {
      app.redraw(); screen(); expect(stage().hyperChip).not.toBeNull();
      const focused = tiles().find(x => x.focused).name;
      expect(sent("\x1b[45;16u")).toEqual([{ kind: "hyper", ch: "-" }]);
      expect(tile(focused).collapsed).toBe(true);
      sent("\x1b[61:43;16u");                                                            // ✦= as the terminal sends it: = with shift, mods 15
      expect(tile(focused).collapsed).toBeUndefined();
      // From a draft: the edit stays on the spine, whole.
      press({ kind: "mouse", action: "down", button: 0, x: S().stageRect.col + tile(reader).rect.col + 4, y: S().stageRect.row + tile(reader).rect.row + 4 });
      press({ kind: "mouse", action: "up", button: 0, x: S().stageRect.col + tile(reader).rect.col + 4, y: S().stageRect.row + tile(reader).rect.row + 4 });
      press({ kind: "char", ch: "e" }); press({ kind: "char", ch: "e" });
      await until(() => !!stage().panes.get(stage().focus)?.draft, "the draft", 8000);
      for (const c of " seeds") press({ kind: "char", ch: c });
      sent("\x1b[45;16u");
      expect(tile(reader).collapsed).toBe(true);
      expect(stage().panes.get(stage().idNamed?.(reader) ?? stage().focus)?.draft).toBeTruthy();
      sent("\x1b[61;16u");
      expect(tile(reader).collapsed).toBeUndefined();
      press({ kind: "esc" }); press({ kind: "esc" });
      // From the terminal tile the person types in: the chord stays the door's (the decoder keeps it from the program).
      const shell = tiles().find(x => x.kind === "pty").name;
      await app.act({ action: "tile.focus", tile: shell, as: "test-agent" }).catch(() => {});
      void stage().dispatch.act({ action: "tile.focus", tile: shell }, { kind: "user" });
      void stage().dispatch.act({ action: "tile.enter", tile: shell }, { kind: "user" });
      await until(() => stage().rawKeys(), "typing in the shell", 5000);
      expect(sent("\x1b[45;16u")).toEqual([{ kind: "hyper", ch: "-" }]);
      expect(tile(shell).collapsed).toBe(true);
      sent("\x1b[61;16u");
      expect(tile(shell).collapsed).toBeUndefined();
      // keys.probe: describes the next chord, runs none; esc ends it.
      await app.dispatch.press("keys.probe");
      expect((app as any).term.rawSink()).toBeNull();                                      // probing in a terminal tile: nothing goes to its program
      sent("\x1b[107;16u");
      const said = (app as any).message as string;
      expect(said).toContain("bytes CSI 107;16u");
      expect(said).toContain("modifiers ⌃⌥⇧⌘");
      expect(said).toContain("hyper+k");
      expect(tile(shell).collapsed).toBeUndefined();
      press({ kind: "esc" });
      expect((app as any).message).toContain("key probe ended");
      // An agent can't probe: it would swallow the person's keys.
      await expect(app.act({ action: "keys.probe", args: {}, as: "test-agent" })).rejects.toThrow(/person/);
    } finally { useHyper(null); press({ kind: "char", ch: "]", ctrl: true }); press({ kind: "esc" }); press({ kind: "esc" }); }
  }, 40_000);


  test("mounts (PIE-651): the board mounted live folds to a spine named for it and opens by click, alt+h and act; it pops out to the full board and back; its lanes alone; a tab holding a group", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "screen" }, as: "test-agent" })).toMatchObject({ key: "screen" });
    await until(() => marks.screen!.every(m => screen().includes(m)), "the screen section");
    const stage = () => S().stages.get(S().sel).top;
    const tiles = () => stage().describe().panes as any[];
    const tile = (name: string) => tiles().find(x => x.name === name);
    const at = () => S().stageRect;
    const click = (x: number, y: number, mods?: number) => { press({ kind: "mouse", action: "down", button: 0, x, y, ...(mods ? { mods } : {}) }); press({ kind: "mouse", action: "up", button: 0, x, y, ...(mods ? { mods } : {}) }); };
    const get = async () => (await app.act({ action: "layout.get", args: {}, as: "test-agent" })) as any;
    // layout.get: each mount says what it mounts, and its own layout under its own ids; the lanes alone are filled, the place holder gone.
    await until(() => { sc.render(app); const m = stage().pane("lanes")?.layoutOf(true).mount; return m?.layout?.tiles.length > 0 && m.layout.tiles.every((t: any) => t.kind === "query"); }, "the lanes mount filled", 8000);
    const l0 = await get();
    const bm = l0.tiles.find((t: any) => t.name === "board");
    expect(bm).toMatchObject({ kind: "screen", mount: { screen: "board", group: false, layout: { focus: expect.any(String) } } });
    expect(bm.mount.layout.tiles.map((t: any) => t.name)).toEqual(expect.arrayContaining(["preview", "tree", "backlinks"]));
    expect(l0.tiles.find((t: any) => t.name === "lanes").mount).toMatchObject({ screen: "board", part: "lanes" });
    await until(() => /^board · /.test(tile("board").title), "the board's title");
    const before = tile("board").rect;
    // By act: the person's folds and opens the board (it has their keys, so an agent's is refused); an agent's folds the lanes mount.
    expect(tiles().find(x => x.focused).name).toBe("board");
    await expect(app.act({ action: "tile.collapse", tile: "board", args: {}, as: "test-agent" })).rejects.toThrow(/has the person's keys/);
    expect(await stage().dispatch.press("tile.collapse", {}, "board")).toMatchObject({ collapsed: true });
    expect(await stage().dispatch.press("tile.expand", {}, "board")).toMatchObject({ collapsed: false });
    expect(await app.act({ action: "tile.collapse", tile: "lanes", args: {}, as: "test-agent" })).toMatchObject({ collapsed: true });
    expect(tile("lanes").title).toMatch(/^board · .* · lanes$/);
    expect(await app.act({ action: "tile.expand", tile: "lanes", args: {}, as: "test-agent" })).toMatchObject({ collapsed: false });
    // A tile inside the mount by its path: the board's own preview folds there, and nothing out here moves.
    expect(await app.act({ action: "tile.collapse", tile: "board/preview", args: { on: true }, as: "test-agent" })).toMatchObject({ name: "preview", collapsed: true });
    expect((await get()).tiles.find((t: any) => t.name === "board").mount.layout.tiles.find((t: any) => t.name === "preview").collapsed).toBe(true);
    await app.act({ action: "tile.expand", tile: "board/preview", args: {}, as: "test-agent" });
    // A tab holding a split: the reader and the thread gathered into a group in the reader's tab.
    const grouped = await app.act({ action: "tile.group", tile: "reader", args: { with: "replies" }, as: "test-agent" }) as any;
    expect(grouped).toMatchObject({ grouped: ["reader", "replies"] });
    const gt = (await get()).tiles.find((t: any) => t.tile === grouped.tile);
    expect(gt.tabs).toEqual([grouped.name, "activity"]);
    expect(gt.mount).toMatchObject({ group: true, layout: { tree: { split: "row" } } });
    expect(gt.mount.layout.tiles.map((t: any) => t.name).sort()).toEqual(["reader", "replies"]);
    await expect(app.act({ action: "tile.group", tile: grouped.tile, args: { on: false }, as: "test-agent" })).rejects.toThrow(/is a tab/);
    // Pop out (the person's): the full board over this screen, its own instance; screen.mount (as q does) comes back to the mount where it was.
    expect(await stage().dispatch.press("mount.out", {}, "board")).toMatchObject({ screen: "board" });
    await until(() => stage().spec?.name === "board", "the full board");
    expect(stage().poppedFrom).toBeTruthy();
    expect(await stage().dispatch.press("screen.mount", {})).toMatchObject({ back: true, name: "board" });
    await until(() => stage().spec?.name === "showcase", "back on the stage");
    expect(tile("board")).toMatchObject({ kind: "screen", rect: before });
    // By mouse: the ▾ on its frame folds it (stacked over the lanes: a horizontal spine named for the screen); a click on the spine opens it at its size.
    sc.render(app);
    const g = (stage().foldButtons as any[]).find(b => stage().nameOf(b.id) === "board");
    click(at().col + g.from, at().row + g.row); sc.render(app);
    expect(tile("board")).toMatchObject({ collapsed: true, collapsedDir: "h", title: expect.stringMatching(/^board · /) });
    expect(sc.render(app).lines.map(plain).join("\n")).toMatch(/▸ board · /);
    click(at().col + tile("board").rect.col + 2, at().row + tile("board").rect.row); sc.render(app);
    expect(tile("board").collapsed).toBeUndefined();
    expect(tile("board").rect).toEqual(before);
    // The group frame/menu acts on the holder; keys belong to its focused tile.
    expect(tiles().find(x => x.focused).name).toBe("board");
    await stage().dispatch.press("tile.collapse", {}, "board");
    expect(tile("board").collapsed).toBe(true);
    await stage().dispatch.press("tile.collapse", {}, "board");
    expect(tile("board").collapsed).toBeUndefined();
    await stage().dispatch.press("mount.enter", {}, "board");
    expect(tile("board").title).toMatch(/· in$/);
    press({ kind: "char", ch: "]", ctrl: true });
    expect(tile("board").title).not.toMatch(/· in$/);
    press({ kind: "esc" });
  }, 40_000);


  test("gathering into a group (PIE-696): shift+click picks tiles and ^W G gathers them, a tile's title dragged onto a group goes in and back out, ^W G in a split asks, and a preview across the group's edge keeps following", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "screen" }, as: "test-agent" })).toMatchObject({ key: "screen" });
    await until(() => marks.screen!.every(m => screen().includes(m)), "the screen section");
    const stage = () => S().stages.get(S().sel).top;
    const at = () => S().stageRect;
    const get = async () => (await app.act({ action: "layout.get", args: {}, as: "test-agent" })) as any;
    const tile = async (name: string) => stage().layoutGet().tiles.find((t: any) => t.name === name);
    const groups = async () => (await get()).tiles.filter((t: any) => t.mount?.group).map((t: any) => t.name) as string[];
    const mouse = (action: "down" | "drag" | "up", x: number, y: number, mods?: number) => { press({ kind: "mouse", action, button: 0, x, y, ...(mods ? { mods } : {}) }); sc.render(app); };
    const drag = (a: [number, number], b: [number, number]) => { mouse("down", ...a); mouse("drag", a[0] + 1, a[1]); mouse("drag", ...b); mouse("up", ...b); };
    const title = async (name: string): Promise<[number, number]> => { const r = (await tile(name)).rect; return [at().col + r.col + 3, at().row + r.row]; };
    sc.render(app);
    // The mounts test above left a group in the reader's tab: it comes out of the tab set (^W T) and spills, so the stage is as laid out.
    for (const g of (await groups()).filter(g => g !== "a" && g !== "b")) { await stage().dispatch.press("layout.move", { to: g, where: "right" }, g); await stage().dispatch.press("tile.group", { on: false }, g); }
    sc.render(app);
    const focus0 = (await get()).focus;
    mouse("down", ...(await title("lanes")), 4); mouse("up", ...(await title("lanes")), 4);
    mouse("down", ...(await title("card")), 4); mouse("up", ...(await title("card")), 4);
    expect((await tile("lanes")).picked).toBe(true);
    expect((await tile("card")).picked).toBe(true);
    expect((await get()).focus).toBe(focus0);                 // picking moves no keys
    // An agent's pick of the same tile is its own, and shows beside the person's.
    expect(await app.act({ action: "tile.select", tile: "card", args: {}, as: "test-agent" })).toMatchObject({ selected: ["card"] });
    expect((await tile("card")).pickedBy).toEqual(["test-agent"]);
    await app.act({ action: "tile.select", args: { clear: true }, as: "test-agent" });
    // ^W G: the picked two, gathered side by side.
    const before = await groups();
    press({ kind: "char", ch: "w", ctrl: true }); press({ kind: "char", ch: "G" }); sc.render(app);
    const made = (await groups()).find(g => !before.includes(g))!;
    expect(made).toBeDefined();
    const gt = await tile(made);
    expect(gt.mount.layout.tiles.map((t: any) => t.name).sort()).toEqual(["card", "lanes"]);
    // A tile's title dragged onto the group goes in where its drop zone says; the preview "card" follows the board across the edge.
    expect(await tile("card")).toBeUndefined();
    const reader = await title("reader"), r = (await tile(made)).rect;
    drag(reader, [at().col + r.col + r.cols - 3, at().row + r.row + Math.floor(r.rows / 2)]);
    expect((await tile(made)).mount.layout.tiles.map((t: any) => t.name)).toContain("reader");
    // Out again by dragging its title past the group, onto the board's lower edge.
    const g2 = (await tile(made)).mount.layout.tiles.find((t: any) => t.name === "reader").rect, g1 = (await tile(made)).rect;
    const b = (await tile("board")).rect;
    drag([at().col + g1.col + 1 + g2.col + 3, at().row + g1.row + 1 + g2.row], [at().col + b.col + b.cols - 2, at().row + b.row + Math.floor(b.rows / 2)]);
    expect(await tile("reader")).toBeDefined();
    // ^W G in a split asks: this tile or the whole split.
    await stage().dispatch.press("tile.focus", {}, "board");
    await stage().dispatch.press("tile.group", { ask: true }, "board"); sc.render(app);
    const ask = stage().overlays.top() as { name: string; items: { label: string }[] } | null;
    expect(ask).toMatchObject({ name: "gather" });
    expect(ask!.items[0]!.label).toMatch(/^this tile · board/);
    expect(ask!.items[1]!.label).toMatch(/^the whole split · /);
    press({ kind: "esc" });
    expect(stage().overlays.top()).toBeFalsy();
    // Spill the gathered group: the tiles are back as they were.
    await stage().dispatch.press("tile.group", { on: false }, made);
    sc.render(app);
    expect(await tile("lanes")).toBeDefined();
    expect(await tile("card")).toBeDefined();
  }, 40_000);


  test("groups (PIE-1073): act and a click choose the same cross-group wire, including a tile outside and in the drawer", async () => {
    (app as any).lastInput = 0;
    await sc.dispatch.press("section.leave");
    await app.act({ action: "section", args: { name: "screen" }, as: "test-agent" });
    screen();
    const d = S().stages.get(S().sel).top;
    const group = (name: string) => d.pane(name).inner;
    const source = () => group("a").layoutGet().tiles.find((t: any) => t.name === "source");
    const act = (action: string, args = {}, tile?: string) => d.dispatch.act({ action, args, tile }, { kind: "user" });
    const click = (x: number, y: number) => press({ kind: "mouse", action: "down", button: 0, x, y });
    expect(source().wires).toContainEqual({ verb: "open", to: group("b").layoutGet().tiles.find((t: any) => t.name === "detail").tile });
    expect(screen()).toContain("◄ ../b/detail");
    await act("tile.link", {}, "a/source");
    await act("tile.link", { ask: true }, "a/source");
    expect(screen()).toContain("click to link here");
    const at = S().stageRect, b = d.layoutGet().tiles.find((t: any) => t.name === "b").rect;
    const detail = group("b").layoutGet().tiles.find((t: any) => t.name === "detail").rect;
    click(at.col + b.col + 1 + detail.col + 3, at.row + b.row + 1 + detail.row + detail.rows - 3);
    expect(source().wires).toContainEqual({ verb: "open", to: group("b").layoutGet().tiles.find((t: any) => t.name === "detail").tile });
    await group("a").dispatch.act({ action: "open", args: { id: seeded.notes.hub.id, from: "source" } }, { kind: "agent", id: "test-agent" });
    expect(group("b").pane("detail").msg.id).toBe(seeded.notes.hub.id);
    expect(await group("a").dispatch.act({ action: "tile.preview", tile: "source" }, { kind: "user" })).toMatchObject({ existing: true, tile: group("b").tileInfo("detail").tile });
    const carried = d.pane("b");
    await act("tile.drawer", {}, "b");
    await app.dispatch.press("host.toggle", { open: false });
    await sc.dispatch.press("section.leave");
    await sc.dispatch.press("section", { name: "drawer" });
    screen();
    expect(app.drawer.desk!.pane("b")).toBe(carried);
    await sc.dispatch.press("section.leave");
    await sc.dispatch.press("section", { name: "screen" });
    screen();
    await app.dispatch.press("tile.drawer", { on: false }, "b");
    expect(d.pane("b")).toBe(carried);
    await act("tile.link", { ask: true }, "a/source");
    screen();
    const outside = d.layoutGet().tiles.find((t: any) => t.name === "outside").rect;
    click(at.col + outside.col + 3, at.row + outside.row + outside.rows - 3);
    expect(source().wires).toContainEqual({ verb: "open", to: d.resolveTile("outside")!.tile.id });
    await act("tile.drawer", { on: true }, "outside");
    await app.dispatch.press("host.toggle", { open: true });
    await app.drawer.desk!.dispatch.press("tab.select", {}, "outside");
    (app as any).paint();
    await act("tile.link", { ask: true }, "a/source");
    (app as any).paint();
    const drawer = app.drawer.desk!.layoutGet().tiles.find(t => t.name === "outside")!.rect!;
    click(drawer.col + 3, app.drawer.rect!.row + 1 + drawer.row + drawer.rows - 3);
    expect(source().wires).toContainEqual({ verb: "open", to: d.resolveTile("@drawer/outside")!.tile.id });
    await app.dispatch.press("host.toggle", { open: false });
  }, 30_000);

  test("on an outline without the showcase it says so and writes nothing", async () => {
    const other = new Scratch();
    const b = new SocketBoard(await other.start());
    await b.info();
    await b.listExtensions(true);
    const before = await b.roots();
    const t = { info: { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    const a = new App(t as any, b, Date.now(), () => {});
    const s = new Showcase();
    a.push(s);
    await until(() => (s as any).problem !== "", "the answer", 5000);
    expect(s.render(a).lines.map(plain).join("\n")).toContain("This outline has no showcase");
    expect(await b.roots()).toEqual(before);
    a.quit(); b.close(); await other.dispose();
  }, 20_000);
});
