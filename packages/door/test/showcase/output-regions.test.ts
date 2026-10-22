// PIE-956: the showcase's "Regions in prose" section. A render script's table, a ::= sentence and a written output region read
// like the page around them, each behind one dim mark in the margin that shows its name, when it ran and its controls
// while the cursor is on it. One of the showcase's test files; the harness (harness.ts) seeds a scratch outline and opens the screen.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { hintKeys, declaredKeys } from "../../src/surface/actions";
import { COMMENT_KEYS, EDIT_PREVIEW_KEYS } from "../../src/surface/attached-keys";
import { Canvas } from "../../src/canvas";
import { BacklinksPane } from "../../src/desk/backlinks-pane";
import { ListPicker } from "../../src/surface/picker";
import { LineInput } from "../../src/surface/line";
import { modeHint } from "../../src/surface/modes";
import { screenSpec, specData, readSpec, savedNodes } from "../../src/desk/screen-spec";
import { boardSpec } from "../../src/desk/delivery";
import { HomePane } from "../../src/home";
import { WelcomeList } from "../../src/hub/welcome";
import { completionOf } from "../../src/surface/completer";
import { ReaderPane } from "../../src/desk/panes";
import { Desk } from "../../src/desk/desk";
import { USER } from "../../src/socket";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: regions in prose", () => {
  const h = useShowcaseScreen(300);
  const { screen } = h;
  let board!: typeof h.board, app!: typeof h.app, seeded!: typeof h.seeded;
  beforeAll(() => { ({ board, app, seeded } = h); });

  test("PIE-1171: Sources says its keys once and Esc closes it from either side", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes") as ReaderPane;
    const act = (action: string, args = {}) => stage.dispatch.press(action, args, "notes");
    for (const focused of [true, false]) {
      await act("sources.open");
      await act("sources.place", { place: "inline" });
      await act("sources.focus", { on: focused });
      const drawn = screen();
      expect(drawn).toContain("Sources");
      const mode = pane.surface.sourcesMode!;
      for (const key of hintKeys(mode.hint())) expect(mode.keys!.some(row => row.key === key)).toBe(true);
      expect(drawn.split("\n").filter(line => /close sources/.test(line))).toHaveLength(1);
      expect(declaredKeys(stage.dispatch.defOf("sources.close")!.keys).has("esc")).toBe(true);
      expect(declaredKeys(stage.dispatch.defOf("sources.back")!.keys).has("esc")).toBe(false);
      if (focused) {
        await act("sources.enter", { n: 1 });
        for (const key of hintKeys(mode.hint())) expect(mode.keys!.some(row => row.key === key)).toBe(true);
        pane.key({ kind: "left" }, stage);
        await until(() => (mode.describe() as { view: string }).view === "list", "Left returns to the source list");
      }
      pane.key({ kind: "esc" }, stage);
      await until(() => !pane.surface.sourcesMode, "Esc closes Sources from either side");
      await until(() => app.messages.rows.at(-1)?.message === "closed the sources", "Esc says what it closed");
    }
  });

  test.each([{ kind: "enter" as const }, { kind: "enter" as const, shift: true as const }, { kind: "enter" as const, ctrl: true as const }])("PIE-1171: every Enter that worked before still opens Sources (%j)", async key => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes") as ReaderPane;
    await stage.dispatch.press("sources.open", {}, "notes");
    await until(() => !(pane.surface.sourcesMode!.describe() as { loading: boolean }).loading, "Sources loaded");
    try {
      pane.key(key, stage);
      await until(() => (pane.surface.sourcesMode!.describe() as { view: string }).view === "source", "modified Enter opens the source", 2000);
    } finally { await stage.dispatch.press("sources.close", {}, "notes"); }
  });

  test.each(["comment", "preview"])("PIE-1171: completion owns the hint over the %s", async target => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes") as ReaderPane;
    const act = (action: string, args = {}) => stage.dispatch.press(action, args, "notes");
    await act(target === "comment" ? "comment.note" : "edit");
    if (target === "preview") {
      pane.key({ kind: "enter" }, stage);
      await until(() => !!pane.draft, "the edit opens");
      await act("draft.preview", { on: true });
    }
    const draft = target === "comment" ? pane.surface.session!.composer! : pane.draft!;
    const original = draft.text;
    try {
      for (const ch of " ((Gree") pane.key({ kind: "char", ch }, stage);
      await until(() => !!completionOf(draft)?.items.length, "reference completion opens");
      expect(pane.surface.hint()).toContain("esc dismiss");
      expect(pane.surface.hint()).not.toMatch(/close comment|close preview/);
      pane.key({ kind: "esc" }, stage);
      await until(() => !completionOf(draft), "Esc dismisses completion");
      expect(target === "comment" ? pane.surface.session!.composer : pane.draft).toBe(draft);
      expect(pane.surface.hint()).toContain(target === "comment" ? "puts comment aside" : "close preview");
    } finally {
      if (target === "comment") await act("comment.write", { body: original });
      else draft.replace(original);
      await act(target === "comment" ? "comment.close" : "edit.close", { discard: true });
    }
  });

  test("PIE-1171: comment and preview hints name bound keys and Esc keeps the draft", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes") as ReaderPane;
    const act = (action: string, args = {}) => stage.dispatch.press(action, args, "notes");
    await act("comment.note");
    for (const key of hintKeys(pane.surface.attachmentHint("comment"))) expect(COMMENT_KEYS.some(row => row.key === key)).toBe(true);
    pane.key({ kind: "paste", text: "Keep this unsent comment." }, stage);
    pane.key({ kind: "esc" }, stage);
    await Bun.sleep(30);
    expect(pane.surface.session?.composer?.text).toBe("Keep this unsent comment.");
    pane.key({ kind: "esc" }, stage);
    await until(() => !pane.surface.session, "second Esc puts the comment aside");
    await act("edit");
    pane.key({ kind: "enter" }, stage);
    await until(() => !!pane.draft, "the note edit");
    const draft = pane.draft!;
    for (const side of ["reader", "preview"]) {
      await act("draft.preview", { on: true });
      for (const key of hintKeys(pane.surface.attachmentHint("edit-preview"))) expect(EDIT_PREVIEW_KEYS.some(row => row.key === key)).toBe(true);
      if (side === "reader") pane.key({ kind: "esc" }, stage);
      else pane.surface.editPreviewKey({ kind: "esc" }, pane.host(stage));
      await until(() => !draft.preview, "Esc closes the preview from either side");
      expect(pane.draft).toBe(draft);
    }
    await act("edit.close", { discard: true });
    await act("note.thread");
    const replies = pane.surface.replyLinks!;
    for (const key of hintKeys(replies.hint())) expect(replies.keys!.some(row => row.key === key)).toBe(true);
    expect(screen()).not.toContain("THREAD · T full list");
    pane.key({ kind: "esc" }, stage);
    await until(() => !pane.surface.replyLinks, "Esc closes replies");
  });

  test("PIE-1173: action help keeps keys from the tile and host, including move directions", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    for (const actions of [stage.dispatch, app.dispatch]) {
      for (const help of [actions.defOf("tile.focus"), actions.list().actions.find(a => a.name === "tile.focus")]) {
        for (const key of ["Tab", "shift+tab", "1-9", "hyper", "^W"]) expect(help?.keys).toContain(key);
      }
      for (const help of [actions.defOf("layout.move"), actions.list().actions.find(a => a.name === "layout.move")]) {
        expect(help?.keys).toContain("^W m then h j k l beside");
        expect(help?.keys).toContain("^W t then h j k l into tabs");
      }
    }
  });

  test("PIE-1173: a screen's unknown action draws its label and refuses when pressed", async () => {
    const stage = new Desk({ name: "garden-keys", title: "Garden keys",
      layout: { root: { t: "leaf", kind: "reader", name: "reader" } },
      keys: [{ key: "X", action: "garden.missing", label: "visit garden" }, { key: "Y", action: "garden.absent" }] });
    app.push(stage);
    try {
      expect(stage.render(app).lines.join("\n")).toContain("visit garden");
      stage.key({ kind: "char", ch: "X" }, app);
      await until(() => app.messages.rows.some(r => r.message.includes("nothing here answers to garden.missing")), "unknown binding refuses");
    } finally { app.pop(); }
  });

  test("PIE-1173: picker footers expose working actions at their real widths", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const picker = () => (stage as any).overlays.top() as ListPicker<{ name: string }, Desk>;
    const footer = (cols: number) => {
      const p = picker();
      const canvas = new Canvas(100, 30);
      p.draw(canvas, { col: 0, row: 0, cols: 100, rows: 30 });
      const line = canvas.lines().map(line => line.replace(/\x1b\[[\d;]*m/g, "")).find(line => line.includes("└"))!;
      expect(line.trim().length).toBe(cols);
      return line;
    };
    await stage.dispatch.press("screen.save", { name: "Garden picker test" });
    stage.screenPicker();
    expect(footer(60)).toContain("x delete made screen");
    expect(footer(60)).toContain("⏎ choose");
    expect(footer(60)).toContain("↑/↓ pick");
    stage.key({ kind: "down" }, app);
    expect(picker().sel).toBe(1);
    stage.key({ kind: "up" }, app);
    expect(picker().sel).toBe(0);
    const saved = picker().items.findIndex(it => it.name === "garden-picker-test");
    expect(saved).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < saved; i++) stage.key({ kind: "down" }, app);
    stage.key({ kind: "char", ch: "x" }, app);
    await until(() => app.messages.rows.some(r => r.message.includes("again") && r.message.includes("garden-picker-test")), "delete asks for its second press");
    stage.key({ kind: "char", ch: "x" }, app);
    await until(() => !picker().items.some(it => it.name === "garden-picker-test"), "x deletes the made screen");
    stage.key({ kind: "esc" }, app);
    expect(picker()).toBeNull();
    await stage.openTile({ kind: "backlinks", source: "tile:notes", name: "picker-links" }, "notes", "right", USER);
    const links = stage.layoutGet().tiles.find(t => t.kind === "backlinks")!;
    await stage.dispatch.press("backlinks.groups", { choose: true }, links.name);
    expect(footer(44)).toContain("⏎ change");
    expect(footer(44)).toContain("↑/↓ pick");
    stage.key({ kind: "down" }, app);
    expect(picker().sel).toBe(1);
    const pane = stage.pane(links.name) as BacklinksPane;
    const group = picker().items[1];
    const before = [...pane.groups];
    stage.key({ kind: "enter" }, app);
    await until(() => pane.groups.length === before.length - 1, "Enter toggles the selected group");
    expect(pane.groups).not.toContain(group);
    stage.key({ kind: "enter" }, app);
    await until(() => pane.groups.length === before.length, "Enter restores the group");
    stage.key({ kind: "esc" }, app);
    expect(picker()).toBeNull();
  });

  test("PIE-1171/1173: migrated surfaces never carry a prose key list", () => {
    for (const path of ["home.ts", "drawer.ts", "note-trash.ts", "desk/desk.ts", "desk/lanes.ts", "desk/backlinks-pane.ts", "desk/tile-menu.ts", "surface/picker.ts", "surface/note.ts"]) {
      const source = readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
      expect(source, path).not.toMatch(/foot:.*(?:⏎|esc|Enter|↑↓|j k)/);
    }
    for (const path of ["home.ts", "hub/welcome.ts", "desk/delivery.ts"]) {
      const source = readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
      expect(source.match(/(?:hint:|hint\(\).*return|const \w*HINT =).*?(?:⏎|\|15|j k|alt\+↑)/g) ?? [], path).toEqual([]);
    }
    // Every migrated picker uses ListPicker; cover its independent hint states, including custom rows.
    for (const input of [undefined, new LineInput(), new LineInput("garden")]) {
      for (const stays of [false, true]) for (const clickChooses of [undefined, false, true]) for (const escClears of [false, true]) {
        const picker = new ListPicker({ name: "guard", input, stays, clickChooses, escClears, closers: "qs",
          items: () => ["Garden"], row: it => [it], choose() {},
          bindings: [{ key: "space", action: "garden.toggle", label: "toggle" }], dispatch() {} });
        for (const key of hintKeys(picker.hint())) expect(picker.bindings.some(row => row.key === key), picker.hint()).toBe(true);
      }
    }
    for (const spec of [screenSpec("home")!, screenSpec("welcome")!, boardSpec()]) {
      const stored = readSpec(specData(spec));
      const kinds = new Set<string>([
        ...savedNodes(stored.layout.root).filter(node => node.t === "leaf").map(node => node.kind),
        ...(stored.keys ?? []).flatMap(row => [...row.only ?? [], ...row.unless ?? []]),
      ]);
      for (const kind of kinds) {
        const active = stored.keys?.filter(row => !row.unless?.includes(kind) && (!row.only || row.only.includes(kind))) ?? [];
        for (const row of active) expect(row.label, `${spec.name}/${kind}/${row.key}`).toBeTruthy();
        for (const key of hintKeys(modeHint(active, () => undefined))) expect(active.some(row => row.key === key), `${spec.name}/${kind}/${key}`).toBe(true);
      }
    }
    for (const tile of [new HomePane({ folder: "/fictional" }), new WelcomeList()]) {
      for (const key of hintKeys(tile.hint())) expect(tile.bindings.some(row => row.key === key), key).toBe(true);
    }
    for (const path of ["surface/note.ts", "screens.ts", "desk/lanes.ts"]) {
      const source = readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
      expect(source, path).not.toMatch(/(?:finish.*first|open for editing|open for commenting|is open already).*?surface\.hint\(|finish.*first.*?this\.hint\(/);
      expect(source.match(/(?:finish.*first|open for editing|open for commenting|is open already).*?(?:ctrl\+s|close \(esc\))/g) ?? [], path).toEqual([]);
    }
    for (const path of ["desk/tree.ts", "river/column.ts", "screens.ts", "surface/note.ts"]) {
      const source = readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
      expect(source.match(/(?:return |keys: |hotLine).*?(?:K[ /]J|K\/J|I\/O)/g) ?? [], path).toEqual([]);
    }
    const sources = readFileSync(new URL("../../src/surface/sources.ts", import.meta.url), "utf8");
    expect(/j k (?:select|move) ·/.test(sources)).toBe(false);
    const note = readFileSync(new URL("../../src/surface/note.ts", import.meta.url), "utf8");
    expect(note).not.toMatch(/THREAD · T full list|sources has keys · Esc reader|reader has keys · click panel or S enter/);
    const comment = readFileSync(new URL("../../src/comment.ts", import.meta.url), "utf8");
    expect(comment).not.toMatch(/title:.*ctrl\+s saves/);
    const editor = readFileSync(new URL("../../src/surface/editor.ts", import.meta.url), "utf8");
    expect(editor).not.toContain("preview · ctrl+p hides");
    const inspector = readFileSync(new URL("../../src/surface/inspector.ts", import.meta.url), "utf8");
    expect(inspector).not.toMatch(/space toggle · Enter save · Esc keeps|Enter save · Esc keeps/);
    expect(note).not.toMatch(/keys: "Z \(move to|keys: "ctrl\+z \(when a move/);
    const tile = readFileSync(new URL("../../src/desk/attached-tile.ts", import.meta.url), "utf8");
    expect(tile).not.toMatch(/Esc reader|ctrl\+s send · esc twice/);
  });

  test("PIE-1155 continued: floating edit preview moves and receives input outside the centred text", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes") as ReaderPane;
    const act = (action: string, args = {}) => stage.dispatch.press(action, args, "notes");
    await act("tile.zoom");
    await act("edit");
    pane.key({ kind: "enter" }, stage);
    await until(() => !!pane.draft, "the note edit");
    const d = pane.draft!, original = d.text;
    try {
      d.replace("Margin preview\n" + Array.from({ length: 50 }, (_, i) => `preview line ${i}`).join("\n"));
      d.place(0, 0);
      await act("draft.preview", { on: true });
      await act("edit.preview.place", { place: "floating" });
      screen();
      const frame = pane.innerFrame!;
      const tile = stage.layoutGet().tiles.find(t => t.name === "notes")!.rect!;
      const origin = { x: tile.col + 1 - frame.col, y: tile.row + 1 - frame.row };
      await act("edit.preview.move", { col: frame.col + 2, row: 10, cols: 38, rows: 12 });
      const rows = screen().split("\n");
      expect(pane.surface.editPreview.frame!.col).toBe(frame.col + 2);
      const label = rows.find(l => l.includes("Margin preview") && l.indexOf("Margin preview") < origin.x)!;
      expect(label).toBeDefined();
      const mouse = (action: "down" | "drag" | "up", x: number, y: number) =>
        stage.key({ kind: "mouse", action, button: 0, x: origin.x + x, y: origin.y + y }, stage.ctx!);
      const left = { ...pane.surface.editPreview.frame! }, dx = frame.cols - left.cols - 4;
      mouse("down", left.col + 4, left.row);
      mouse("drag", left.col + 4 + dx, left.row);
      mouse("up", left.col + 4 + dx, left.row);
      await until(() => { screen(); return pane.surface.editPreview.frame!.col === left.col + dx; }, "preview dragged into the right margin");
      const r = pane.surface.editPreview.rect!, top = d.frame!.preview!.top;
      stage.key({ kind: "mouse", action: "wheel-down", button: 0, x: origin.x + r.col + 2, y: origin.y + r.row + 3 }, stage.ctx!);
      await until(() => { screen(); return d.frame!.preview!.top > top; }, "wheel scrolls the margin preview");
      mouse("down", r.col + r.cols - 4, r.row);
      mouse("up", r.col + r.cols - 4, r.row);
      await until(() => screen().includes("Placement"), "preview placement chip opens in the margin");
      pane.key({ kind: "esc" }, stage);
      expect(d.text).toContain("preview line 49");
    } finally {
      await act("edit.preview.place", { place: "inline" });
      d.replace(original);
      d.place(0, 0);
      await act("edit.close", { discard: true });
      await act("scroll", { to: "top" });
      await act("tile.zoom");
    }
  });

  test.each(["sources", "comment"])("Round 3: uncovered gutter folds still draw and respond beside a %s float", async target => {
    await app.dispatch.act({ action: "section", args: { name: "list-folds" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("reader") as ReaderPane;
    const act = (action: string, args = {}) => stage.dispatch.press(action, args, "reader");
    await act("tile.zoom");
    try {
      const rows = screen().split("\n");
      const y = rows.findIndex(l => l.includes("▾"));
      const x = rows[y]!.indexOf("▾");
      expect(y).toBeGreaterThan(0);
      await act(target === "sources" ? "sources.open" : "comment.note");
      await act(`${target}.place`, { place: "floating" });
      screen();
      await act(`${target}.move`, { col: 30, row: 20, cols: 30, rows: 10 });
      expect(screen().split("\n")[y]![x]).toBe("▾");
      const folded = pane.surface.describe().folds?.folded ?? [];
      h.press({ kind: "mouse", action: "down", button: 0, x, y });
      h.press({ kind: "mouse", action: "up", button: 0, x, y });
      await until(() => (pane.surface.describe().folds?.folded.length ?? 0) > folded.length, "uncovered gutter folds by mouse");
      expect(screen().split("\n")[y]![x]).toBe("▸");
      await act("unfold", { all: true });
    } finally {
      await act(`${target}.close`, target === "comment" ? { discard: true } : {});
      await act("tile.zoom");
    }
  });

  test("Round 3: split Sources keeps the floating comment in frame coordinates", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes") as ReaderPane;
    const act = (action: string, args = {}) => stage.dispatch.press(action, args, "notes");
    await act("tile.zoom");
    try {
      await act("comment.note");
      pane.key({ kind: "paste", text: "A comment across the split" }, stage);
      await act("comment.place", { place: "floating" });
      screen();
      await act("comment.move", { col: 20, row: 3, cols: 60, rows: 12 });
      const before = screen().split("\n");
      const row = before.findIndex(l => l.includes("A comment across the split"));
      const col = before[row]!.indexOf("A comment across the split");
      await act("sources.open");
      await act("sources.place", { place: "split" });
      const after = screen().split("\n");
      expect(after[row]!.indexOf("A comment across the split")).toBe(col);
      expect(after.some(l => l.includes("3 generated regions"))).toBe(true);
      const sourcesCol = after.find(l => l.includes("[split ▸]"))!.indexOf("[split ▸]");
      await act("comment.write", { body: "" });
      await act("comment.close", { discard: true });
      expect(screen().split("\n").find(l => l.includes("[split ▸]"))!.indexOf("[split ▸]")).toBe(sourcesCol);
    } finally {
      if (pane.surface.session) await act("comment.close", { discard: true });
      await act("sources.close");
      await act("tile.zoom");
    }
  });

  test("Round 3: a preview picture stays in a comment moved above the hero", async () => {
    await app.dispatch.act({ action: "section", args: { name: "hero" } }, USER);
    const video = app.video;
    app.video = "kitty";
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane(stage.readerPanes()[0]!.name) as ReaderPane;
    const act = (action: string, args = {}) => stage.dispatch.press(action, args, stage.readerPanes()[0]!.name);
    try {
      await until(() => h.sc.render(app).placements?.some(p => p.key.includes("hero:img:")) === true, "hero loaded");
      await act("comment.note");
      const image = pane.msg!.text.match(/\[img::([^\]]+)\]/)![1]!;
      pane.key({ kind: "paste", text: `[img::${image}] [height::3]` }, stage);
      pane.key({ kind: "char", ch: "p", ctrl: true }, stage);
      await act("comment.place", { place: "floating" });
      screen();
      await act("comment.move", { col: 2, row: pane.innerFrame!.row - 16, cols: 60, rows: 12 });
      await until(() => { screen(); return !!pane.surface.session!.composer!.frame?.preview?.placements?.length; }, "preview picture loaded");
      const view = h.sc.render(app);
      const picture = pane.surface.session!.composer!.frame!.preview!.placements![0]!;
      expect(view.placements?.some(p => p.key.endsWith(picture.key))).toBe(true);
    } finally {
      await act("comment.write", { body: "" });
      await act("comment.close", { discard: true });
      app.video = video;
    }
  });

  test("Round 3: source details take the width their content needs", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes") as ReaderPane;
    const act = (action: string, args = {}) => stage.dispatch.press(action, args, "notes");
    await act("tile.zoom");
    try {
      await act("sources.open");
      await act("sources.place", { place: "floating" });
      await act("sources.enter", { n: 1 });
      const rows = screen().split("\n");
      expect(rows.some(l => l.includes("Query") && l.includes("Transform") && l.includes("Result"))).toBe(true);
      expect(pane.surface.sourcesMode!.frame!.cols).toBeLessThan(pane.innerFrame!.cols * .85);
    } finally {
      await act("sources.close");
      await act("tile.zoom");
    }
  });

  test.each(["default width", "sizing past the measure", "shadow inside the rect"])("PIE-1155: %s", async symptom => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes");
    if (!(pane instanceof ReaderPane)) throw new Error("notes must be a reader");
    const act = (action: string, args = {}) => stage.dispatch.press(action, args, "notes");
    await act("tile.zoom");
    try {
      screen();
      await act("sources.open");
      await act("sources.place", { place: "floating" });
      screen();
      const sm = pane.surface.sourcesMode!;
      if (symptom === "default width") {
        expect(sm.frame!.cols).toBeGreaterThan(108);
        expect(sm.frame!.cols).toBeLessThan(pane.innerFrame!.cols);
        await act("sources.enter", { n: 1 });
        const rows = screen().split("\n");
        expect(rows.some(l => l.includes("Query") && l.includes("Transform") && l.includes("Result"))).toBe(true);
        expect(rows.some(l => l.includes("Owner: Sam") && l.includes("Week: 42") && l.includes("Crop: Regions in prose"))).toBe(true);
      }
      if (symptom === "sizing past the measure") {
        await act("sources.move", { col: pane.innerFrame!.col, row: 2, cols: 130, rows: 16 });
        screen();
        expect(sm.frame!.cols).toBe(130);
      }
      if (symptom === "shadow inside the rect") expect(screen()).not.toContain("▒");
    } finally {
      await act("sources.close");
      await act("tile.zoom");
    }
  });

  test.each(["sources", "comment"])("PIE-1155: %s takes mouse drags past both sides without changing the note", async target => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes");
    if (!(pane instanceof ReaderPane)) throw new Error("notes must be a reader");
    const act = (action: string, args = {}) => stage.dispatch.press(action, args, "notes");
    await act("tile.zoom");
    screen();
    const before = screen();
    const original = (await board.get(pane.msg!.id))!;
    try {
      await act(target === "sources" ? "sources.open" : "comment.note");
      if (target === "comment") pane.key({ kind: "paste", text: "Keep this floating draft" }, stage);
      await act(`${target}.place`, { place: "floating" });
      screen();
      const frame = pane.innerFrame!;
      const tile = stage.layoutGet().tiles.find(t => t.name === "notes")!.rect!;
      const origin = { x: tile.col + 1 - frame.col, y: tile.row + 1 - frame.row };
      const current = () => target === "sources" ? pane.surface.sourcesMode!.frame! : pane.surface.session!.float!;
      await act(`${target}.move`, { col: frame.col + 2, row: 20, cols: 24, rows: 8 });
      screen();
      expect(current().col).toBeLessThan(0);
      const mouse = (action: "down" | "drag" | "up", x: number, y: number) => stage.key({ kind: "mouse", action, button: 0, x: origin.x + x, y: origin.y + y }, stage.ctx!);
      const left = { ...current() }, x = left.col + 4;
      const dx = frame.cols - left.cols - 4;
      mouse("down", x, left.row);
      mouse("drag", x + dx, left.row);
      mouse("up", x + dx, left.row);
      await until(() => { screen(); return current().col === left.col + dx; }, "the grip drags across the text column");
      expect(current().col + current().cols).toBeGreaterThan(pane.surface.renderedWidth());
      mouse("down", current().col + 4, current().row);
      mouse("drag", x, left.row);
      mouse("up", x, left.row);
      await until(() => { screen(); return current().col === left.col; }, "the grip returns to the left margin");
      await act(`${target}.grip`);
      pane.key({ kind: "char", ch: "L" }, stage);
      await until(() => { screen(); return current().cols === 26; }, "the keyboard grip sizes in the margin");
      pane.key({ kind: "enter" }, stage);
      await act(`${target}.move`, { col: frame.col, row: 20, cols: frame.cols, rows: 8 });
      screen();
      expect(current().cols).toBe(frame.cols);
      expect(current().col).toBe(frame.col);
      if (target === "comment") expect(pane.surface.session!.composer!.text).toBe("Keep this floating draft");
      const after = (await board.get(original.id))!;
      expect([after.text, after.revision]).toEqual([original.text, original.revision]);
    } finally {
      await act(`${target}.close`, target === "comment" ? { discard: true } : {});
      const after = screen();
      expect(after.split("\n").find(l => l.includes("beds-table:: week=42"))!.indexOf("beds-table:: week=42"))
        .toBe(before.split("\n").find(l => l.includes("beds-table:: week=42"))!.indexOf("beds-table:: week=42"));
      await act("tile.zoom");
    }
  });

  test("a Sources tile leaves the reader's presses, clicks and wheel with the note", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes");
    if (!(pane instanceof ReaderPane)) throw new Error("notes must be a reader");
    const act = (action: string, args = {}) => app.dispatch.act({ action, tile: "notes", args }, USER);
    await act("sources.open");
    await act("sources.place", { place: "tile" });
    screen();
    await act("sources.focus", { on: false });
    const sm = pane.surface.sourcesMode!;
    const top = sm.view.top;
    const scroll = pane.surface.scroll;
    pane.wheel(1, stage, { x: 8, y: 8 });
    expect(pane.surface.scroll).toBeGreaterThan(scroll);
    expect(sm.view.top).toBe(top);
    pane.press(8, 8, stage);
    expect(sm.view.pressed).toBeFalsy();
    pane.release(8, 8, stage);
    await Bun.sleep(20);
    expect(sm.describe()).toMatchObject({ keys: "reader" });
    await act("sources.place", { place: "split" });
    await act("sources.close");
  });

  test("a top floating comment keeps its painted row under a hero when Sources opens", async () => {
    await app.dispatch.act({ action: "section", args: { name: "hero" } }, USER);
    const video = app.video;
    app.video = "kitty";
    await until(() => h.sc.render(app).placements?.some(p => p.key.includes("hero:img:")) === true, "the hero loaded");
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane(stage.readerPanes()[0]!.name);
    if (!(pane instanceof ReaderPane)) throw new Error("hero must be a reader");
    const act = (action: string, args = {}) => stage.dispatch.press(action, args, stage.readerPanes()[0]!.name);
    await act("comment.note");
    pane.key({ kind: "paste", text: "Keep my hero comment here" }, stage);
    await act("comment.place", { place: "floating" });
    screen();
    await act("comment.move", { row: 10, col: 2, cols: 60, rows: 12 });
    const before = screen().split("\n").findIndex(l => l.includes("Keep my hero comment here"));
    expect(h.sc.render(app).placements?.some(p => p.key.includes("hero:img:"))).toBe(true);
    expect(before).toBeGreaterThan(10);
    await act("sources.open");
    await act("sources.place", { place: "floating" });
    await act("sources.move", { row: 0, col: 65, cols: 30, rows: 10 });
    await act("sources.focus", { on: false });
    expect(screen().split("\n").findIndex(l => l.includes("Keep my hero comment here"))).toBe(before);
    await act("comment.close", { discard: true });
    await act("sources.close");
    app.video = video;
  });

  test("the placement menu opens below its moved chip by mouse and by key", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes");
    if (!(pane instanceof ReaderPane)) throw new Error("notes must be a reader");
    const act = (action: string, args = {}) => app.dispatch.act({ action, tile: "notes", args }, USER);
    await act("sources.open");
    await act("sources.place", { place: "floating" });
    screen();
    await act("sources.move", { row: 12, col: 4, cols: 44, rows: 14 });
    const rows = screen().split("\n");
    const chipRow = rows.findIndex(l => l.includes("[floating ▸]"));
    const chipCol = rows[chipRow]!.indexOf("[floating ▸]");
    for (const mouse of [true, false]) {
      if (mouse) {
        const r = pane.surface.sourcesMode!.rect;
        pane.click(r.x + r.w - "[floating ▸]".length, r.y, stage);
      } else await act("placement.menu", { target: "sources" });
      await until(() => screen().includes("Placement"), "placement menu open");
      const menu = screen().split("\n");
      const row = menu.findIndex(l => l.includes("Placement"));
      expect(row).toBe(chipRow + 1);
      expect(menu[row]!.indexOf("Placement") - 3).toBe(chipCol);
      await act("placement.close");
    }
    await act("sources.place", { place: "split" });
    await act("sources.close");
  });

  test("overlapping attachments give the top float the wheel and restore keys after closing it", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes");
    if (!(pane instanceof ReaderPane)) throw new Error("notes must be a reader");
    const act = (action: string, args = {}) => app.dispatch.act({ action, tile: "notes", args }, USER);
    await act("comment.note");
    pane.key({ kind: "paste", text: Array.from({ length: 30 }, (_, n) => `Comment row ${n}`).join("\n") }, stage);
    await act("sources.open");
    await act("sources.place", { place: "floating" });
    await act("comment.place", { place: "floating" });
    screen();
    await act("sources.move", { row: 0, col: 0, cols: 60, rows: 20 });
    await act("comment.move", { row: 0, col: 0, cols: 60, rows: 20 });
    screen();
    const draft = pane.surface.session!.composer!;
    pane.wheel(-1, stage, { x: 8, y: 8 });
    expect(draft.follow).toBe(false);
    await act("comment.close", { discard: true });
    expect(screen()).toContain("sources has keys");
    pane.key({ kind: "char", ch: "q" }, stage);
    await until(() => !pane.surface.sourcesMode, "q closes the remaining Sources float");
  });

  test("a comment covering the note's Sources chip consumes its click", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes");
    if (!(pane instanceof ReaderPane)) throw new Error("notes must be a reader");
    const act = (action: string, args = {}) => app.dispatch.act({ action, tile: "notes", args }, USER);
    await act("comment.note");
    await act("sources.open");
    await act("sources.place", { place: "floating" });
    await act("comment.place", { place: "floating" });
    screen();
    await act("comment.move", { row: 0, col: 0, cols: pane.surface.renderedWidth(), rows: 20 });
    screen();
    const chip = (pane.surface as any).hits.find((hit: any) => hit.sources);
    expect(chip).toBeTruthy();
    pane.click(chip.from, chip.row, stage);
    await Bun.sleep(20);
    expect(pane.surface.sourcesMode!.describe()).toMatchObject({ keys: "reader" });
    await act("comment.close", { discard: true });
    await act("sources.close");
  });

  test("closing the comment returns keys to the Sources float", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes");
    if (!(pane instanceof ReaderPane)) throw new Error("notes must be a reader");
    const act = (action: string, args = {}) => app.dispatch.act({ action, tile: "notes", args }, USER);
    await act("comment.note");
    await act("sources.open");
    await act("sources.place", { place: "floating" });
    await act("comment.place", { place: "floating" });
    await act("comment.close", { discard: true });
    expect(screen()).toContain("sources has keys");
    pane.key({ kind: "char", ch: "q" }, stage);
    await until(() => !pane.surface.sourcesMode, "q reaches Sources after closing the comment");
  });

  test("the Sources grip keeps floating placement when Sources opens again", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const act = (action: string, args = {}) => app.dispatch.act({ action, tile: "notes", args }, USER);
    await act("sources.open");
    await act("sources.place", { place: "split" });
    await act("sources.grip");
    await act("sources.close");
    await act("sources.open");
    expect(screen()).toContain("[floating ▸]");
    await act("sources.place", { place: "split" });
    await act("sources.close");
  });

  test("the Sources grip survives closing the comment", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes");
    if (!(pane instanceof ReaderPane)) throw new Error("notes must be a reader");
    const act = (action: string, args = {}) => app.dispatch.act({ action, tile: "notes", args }, USER);
    await act("comment.note");
    await act("sources.open");
    await act("sources.place", { place: "split" });
    await act("sources.grip");
    screen();
    await act("comment.close", { discard: true });
    pane.key({ kind: "right" }, stage);
    expect(screen()).toContain("moving the attachment");
    pane.key({ kind: "enter" }, stage);
    await act("sources.place", { place: "split" });
    await act("sources.close");
  });

  test("a floating comment stays drawn while sources are open", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    await app.dispatch.act({ action: "comment.note", tile: "notes" }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    for (const ch of "Keep these words visible") stage.pane("notes")!.key({ kind: "char", ch }, stage);
    await app.dispatch.act({ action: "sources.open", tile: "notes" }, USER);
    await app.dispatch.act({ action: "comment.place", tile: "notes", args: { place: "floating" } }, USER);
    expect(screen()).toContain("Keep these words visible");
    expect(screen()).toContain("Sources");
    await app.dispatch.act({ action: "sources.place", tile: "notes", args: { place: "floating" } }, USER);
    screen();
    await app.dispatch.act({ action: "sources.move", tile: "notes", args: { row: 0, col: 0, cols: 36, rows: 16 } }, USER);
    await app.dispatch.act({ action: "comment.place", tile: "notes", args: { place: "floating" } }, USER);
    const commentRow = screen().split("\n").findIndex(l => l.includes("Keep these words visible"));
    expect(commentRow).toBeGreaterThan(0);
    expect(screen()).toContain("3 generated regions");
    await app.dispatch.act({ action: "sources.close", tile: "notes" }, USER);
    expect(screen().split("\n").findIndex(l => l.includes("Keep these words visible"))).toBe(commentRow);
    await app.dispatch.act({ action: "sources.open", tile: "notes" }, USER);
    screen();
    await app.dispatch.act({ action: "sources.move", tile: "notes", args: { row: 0, col: 0, cols: 36, rows: 16 } }, USER);
    const sourceRow = screen().split("\n").findIndex(l => l.includes("3 generated regions"));
    await app.dispatch.act({ action: "comment.close", tile: "notes", args: { discard: true } }, USER);
    expect(screen().split("\n").findIndex(l => l.includes("3 generated regions"))).toBe(sourceRow);
    await app.dispatch.act({ action: "sources.place", tile: "notes", args: { place: "split" } }, USER);
    await app.dispatch.act({ action: "sources.close", tile: "notes" }, USER);
  });

  test("sources moves through the placement menu and its tile spreads Query, Transform and Result across the width", async () => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    await app.dispatch.act({ action: "sources.open", tile: "notes" }, USER);
    screen();
    const stage = h.S().stages.get(h.S().sel).top as Desk;
    const pane = stage.pane("notes");
    if (!(pane instanceof ReaderPane)) throw new Error("notes must be a reader");
    for (const place of ["inline", "floating", "split", "popup", "tile"]) {
      await app.dispatch.act({ action: "placement.menu", tile: "notes", args: { target: "sources" } }, USER);
      expect(screen()).toContain("Placement");
      await app.dispatch.act({ action: "placement.choose", tile: "notes", args: { place } }, USER);
      await until(() => screen().includes(`[${place} ▸]`), `sources drawn ${place}`);
      if (place === "inline") {
        const before = screen().split("\n").findIndex(l => l.includes("[inline ▸]"));
        await app.dispatch.act({ action: "scroll", tile: "notes", args: { by: 1 } }, USER);
        expect(screen().split("\n").findIndex(l => l.includes("[inline ▸]"))).toBe(before - 1);
      }
    }
    await app.dispatch.act({ action: "sources.enter", tile: "notes", args: { n: 1 } }, USER);
    await app.dispatch.act({ action: "tile.zoom", tile: "sources" }, USER);
    const lines = screen().split("\n");
    expect(lines.some(l => l.includes("Query") && l.includes("Transform") && l.includes("Result"))).toBe(true);
    await app.dispatch.act({ action: "tile.zoom", tile: "sources" }, USER);
    await app.dispatch.act({ action: "sources.place", tile: "notes", args: { place: "split" } }, USER);
    await app.dispatch.act({ action: "sources.close", tile: "notes" }, USER);
    await app.dispatch.act({ action: "sources.open", tile: "notes" }, USER);
    expect(screen()).toContain("[split ▸]");
    await app.dispatch.act({ action: "placement.menu", tile: "notes", args: { target: "sources" } }, USER);
    screen();
    pane.key({ kind: "down" }, stage);
    pane.key({ kind: "enter" }, stage);
    await until(() => screen().includes("[popup ▸]"), "arrow and Enter choose popup");
    await app.dispatch.act({ action: "sources.place", tile: "notes", args: { place: "split" } }, USER);
    await app.dispatch.act({ action: "sources.close", tile: "notes" }, USER);
  });

  test.each([false, true])("PIE-1065: an attributed output lands with its note open (editing=%s)", async editing => {
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    const book = await board.createBlock(null, "Check the garden");
    const step = await board.createBlock(book.id, "Check seeds\n\nCurrent notes\n");
    await app.dispatch.act({ action: "open", tile: "notes", args: { id: step.id } }, USER);
    if (editing) {
      await app.dispatch.act({ action: "edit", tile: "notes" }, USER);
      await app.dispatch.act({ action: "edit", tile: "notes" }, USER);
      await until(() => !!board.heldDraft(step.id)?.holdId, "the step's draft held");
      await app.dispatch.act({ action: "draft.place", tile: "notes", args: { line: 2, col: 1 } }, USER);
    }
    await board.request("outputs.place", { blockId: step.id, producer: { id: step.id, name: "Seed check" }, here: "end", content: "seeds-ready",
      mutation: { author: "agent", actorId: "seed-check" } });
    const read = await board.readDraft(step.id);
    expect(read.text).toContain("[!output]");
    expect(read.text).toContain("seeds-ready");
    expect((await board.children(step.id)).filter(b => b.text.includes("[type::draft-proposal]"))).toEqual([]);
    if (editing) {
      expect(read.route).toBe("draft");
      expect((await board.get(step.id))!.text).toBe(step.text);
      await board.request("outputs.place", { blockId: step.id, producer: { id: step.id, name: "Render" }, here: "end", content: "Rendered result",
        mutation: { author: "agent", actorId: "render-script" } });
      expect((await board.readDraft(step.id)).text).toContain("Rendered result");
      expect(screen()).toContain("render-script");
      await app.dispatch.act({ action: "draft.undo", tile: "notes" }, USER);
      expect((await board.readDraft(step.id)).text).toBe(read.text);
      await app.dispatch.act({ action: "edit.close", tile: "notes", args: { discard: true } }, USER);
    }
    await app.dispatch.act({ action: "open", tile: "notes", args: { id: seeded.notes.outputRegions.id } }, USER);
  }, 30_000);

  test("three generated regions read like the prose around them: no box, no header, no buttons; no mark until the cursor is in one", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "output-regions" }, as: "test-agent" });
    screen();
    const id = seeded.notes.outputRegions.id;
    const first = (await board.get(id))!;
    await until(() => screen().includes("Sam sows beans") && /Owner\s.*Week/.test(screen()) && screen().includes("Sam waters the beans"), "the three regions drawn", 15_000);
    // Zero chrome until the cursor is in a region (PIE-956 S6b): no mark is drawn yet.
    const d = h.S().stages.get(h.S().sel).top as Desk;
    const r = d.layoutGet().tiles.find(t => t.name === "notes")!.rect!, stage = h.S().stageRect;
    const body = screen().split("\n").slice(stage.row + r.row + 1, stage.row + r.row + r.rows - 1)
      .map(line => line.slice(stage.col + r.col + 1, stage.col + r.col + r.cols - 1)).join("\n");
    expect(body).not.toContain("\u2261");
    expect(body).not.toMatch(/ran (just now|\d+ min ago)|\[keep\]|run again|\[!output\]|╭─ ▾ .*output/);
    // The way in: the header's [sources], S, or a selection's "Where from" opens the Sources inspector beside the note.
    expect(screen()).toContain("[sources]");
    const opened = await app.act({ action: "sources.open", args: {}, tile: "notes", as: "test-agent" }) as { opened?: boolean; sources?: { name: string }[] };
    // An agent reads the note's sources without opening the person's panel: the three regions are listed.
    expect(opened.opened).toBe(false);
    expect(opened.sources?.length).toBeGreaterThanOrEqual(3);
    const csv = await app.act({ action: "sources.download", args: { source: "1", format: "csv" }, tile: "notes", as: "test-agent" }) as { path: string };
    expect(readFileSync(csv.path, "utf8")).toContain('"Owner","Week"');
    expect(readFileSync(csv.path, "utf8")).toContain('"Sam","42"');
    const json = await app.act({ action: "sources.download", args: { source: "1", format: "json" }, tile: "notes", as: "test-agent" }) as { path: string };
    expect(JSON.parse(readFileSync(json.path, "utf8"))).toEqual([{ Owner: "Sam", Week: "42", Crop: "Regions in prose" }]);
    h.press({ kind: "tab" });
    h.ch("S");
    await until(() => screen().includes("Sources · 3 generated regions"), "Sources opened by key");
    h.press({ kind: "enter" });
    h.press({ kind: "enter" });
    await until(() => screen().includes("download CSV"), "Enter opens the source's download controls", 1000);
    // Drawing wrote nothing.
    const after = (await board.get(id))!;
    expect([after.text, after.revision]).toEqual([first.text, first.revision]);
    expect(await board.children(id)).toHaveLength(0);
  }, 40_000);

  test("an image written inside an output region reaches the terminal with its caption", async () => {
    h.press({ kind: "esc" });
    (app as any).lastInput = 0;
    await app.dispatch.act({ action: "section", args: { name: "output-regions" } }, USER);
    const video = app.video;
    app.video = "kitty";
    try {
      await until(() => screen().includes("seed-packet.webp") && !screen().includes("loading…"), "the output image decoded", 8000);
      const frame = h.sc.render(app);
      expect(frame.placements?.length ?? 0).toBeGreaterThan(0);
      const caption = frame.lines.findIndex(line => line.includes("seed-packet.webp"));
      expect(frame.placements!.some(p => p.row < caption && p.row + p.rows <= caption)).toBe(true);
      expect(screen()).toContain("Sam waters the beans");
    } finally {
      app.video = video;
    }
  }, 20_000);

});
