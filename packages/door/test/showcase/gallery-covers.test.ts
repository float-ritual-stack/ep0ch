// A gallery card shows its note's header picture as its cover, a feed row as a thumbnail, and `body=0` keeps the card to
// its title and summary (PIE-1595). Driven through act on the gallery section's made-up shelf, with Kitty graphics on.
import { describe, expect, test } from "bun:test";
import type { Desk } from "../../src/desk/desk";
import { ReaderPane } from "../../src/desk/panes";
import { SHOWCASE_ASSETS } from "../../src/showcase/seed/media";
import { SECTIONS } from "../../src/showcase/showcase";
import { PERSON } from "../../src/surface/list-view";
import { visible } from "../../src/style";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe("showcase: a card's cover", () => {
  const h = useShowcaseScreen(160);
  const stage = () => h.S().stage(SECTIONS.findIndex(s => s.key === "gallery")).top as Desk;
  const reader = () => [...(stage() as any).panes.values()].find(p => p instanceof ReaderPane) as ReaderPane;
  const act = (action: string, args: Record<string, unknown> = {}) => h.app.dispatch.act({ action, args, tile: "reader" }, { kind: "user" }) as Promise<any>;
  const draw = (cols: number) => reader().render(cols, 400, false, stage());
  const images = () => reader().surface.drawn!.doc.images;
  /** The shelf's rows of text, and its pictures: those drawn from its heading on (the gallery extension's come above it). */
  const shelf = (cols: number) => {
    draw(cols);
    const doc = reader().surface.drawn!.doc, lines = doc.lines.map(visible);
    const from = Math.max(0, lines.findIndex(l => l.includes("Covers from the shelf")));
    return { lines: lines.slice(from), pictures: doc.images.filter(i => i.line >= from) };
  };
  const covers = (cols: number, wanted = 3) => until(() => {
    const got = shelf(cols);
    return got.pictures.filter(p => p.crop).length >= wanted && got.lines.some(l => l.includes("Beetroot on the bench"));
  }, `${wanted} covers at ${cols} columns`, 20_000);

  test.each([160, 80])("a gallery card crops its header picture to the card, a feed row is a thumbnail, at %s columns", async cols => {
    h.app.video = "kitty";
    await h.app.dispatch.act({ action: "section.try", args: { name: "gallery" } }, { kind: "user" });
    await until(() => !!reader()?.msg, "the gallery note in the reader");
    await covers(cols);
    let { lines, pictures } = shelf(cols);
    const text = lines.join("\n");
    expect(text).not.toContain("header ");
    expect(text).not.toContain("[img::");
    // body=0: the title and its chips, none of the note's bullets.
    expect(text).not.toContain("Thin to a hand apart");
    expect(text).toContain("bed: north");
    // Each picture fills its card's width and is cut to the card's box.
    expect(pictures.every(p => p.cols >= 20 && p.rows >= 4 && !!p.crop)).toBe(true);
    // Two cards side by side where they fit: two pictures start on one row.
    if (cols === 160) expect(new Set(pictures.map(p => p.line)).size).toBeLessThan(pictures.length);

    await act("list.layout", { list: "^covers", layout: "feed" });
    await until(() => { const got = shelf(cols); return got.pictures.length >= 3 && got.pictures.every(p => p.cols <= 20); }, "the feed's thumbnails", 20_000);
    ({ lines, pictures } = shelf(cols));
    const row = lines.findIndex(l => l.includes("Beetroot on the bench"));
    expect(row).toBeGreaterThan(0);
    // The thumbnail sits beside its title: the title starts past the picture's own columns.
    const first = pictures[0]!;
    expect(lines[row]!.indexOf("Beetroot on the bench")).toBeGreaterThan(first.col + first.cols - 1);
    expect(lines.join("\n")).not.toContain("Thin to a hand apart");
    await act("list.layout", { list: "^covers", layout: "gallery" });
  }, 60_000);

  test("cover= names the property to read; a value that isn't a picture stays words; body>0 draws the words without the picture's line", async () => {
    h.app.video = "kitty";
    await h.app.dispatch.act({ action: "section.try", args: { name: "gallery" } }, { kind: "user" });
    const { root } = h.seeded.notes;
    const dir = SHOWCASE_ASSETS;
    await h.board.createBlock(root.id, `Named cover [shelf-b::one] [photo::${dir}/seed-packet.webp]\n\n[img::${dir}/allotment-dusk.jpg] [layout::hero]\n\n- A line of words`);
    await h.board.createBlock(root.id, `Words for a cover [shelf-b::one] [photo::the bench at sunrise]\n\n[img::${dir}/evening-beds.jpg] [layout::hero]\n\n- A line of words`);
    await h.board.createBlock(root.id, `Nothing named [shelf-b::one]\n\n[img::${dir}/allotment-dusk.jpg] [layout::hero]\n\n- A line of words`);
    await h.board.createBlock(root.id, `Words alone [shelf-b::one] [photo::the bench at noon]\n\n- A line of words`);
    const note = await h.board.createBlock(root.id, `Second shelf\n\n::view{query="shelf-b=one" layout="gallery, feed" cover=photo body=4 sort="title asc"} ^second\n::`);
    await act("open", { id: note.id });
    await until(() => { draw(160); return images().some(i => i.media.path.endsWith("seed-packet.webp")) && images().some(i => i.media.path.endsWith("allotment-dusk.jpg")); }, "both pictures", 20_000);
    await until(() => shelf(160).lines.join("\n").includes("A line of words"), "the cards' words", 20_000);
    const drawn = shelf(160).lines.join("\n");
    expect(drawn).toContain("the bench at noon");
    // What cover= names comes first: the note with words and a hero shows its words; only the note it names nothing on falls back on its hero.
    expect(images().map(i => i.media.path.split("/").pop()).sort()).toEqual(["allotment-dusk.jpg", "seed-packet.webp"]);
    expect(drawn).toContain("the bench at sunrise");
    expect(drawn).toContain("A line of words");
    expect(drawn).not.toContain("header ");
    expect(drawn).not.toContain("[layout::hero]");
  }, 60_000);

  test("a view written in YAML with body: 0 shows no bullets, in the gallery or the feed", async () => {
    h.app.video = "kitty";
    await h.app.dispatch.act({ action: "section.try", args: { name: "gallery" } }, { kind: "user" });
    const note = await h.board.createBlock(h.seeded.notes.root.id, ["Yaml shelf", "", "::view", "---", 'query: "shelf=seed-cards"', "layout: gallery, feed", "card: small", "body: 0", "summary-properties: [title, bed]", "sort: title", "direction: asc", "---", "::"].join("\n"));
    await act("open", { id: note.id });
    for (const layout of ["gallery", "feed"]) {
      if (layout === "feed") await act("list.layout", { layout });
      await until(() => { draw(160); return images().length >= 3 && (reader().surface.listsDrawn as any[])[0]?.detail.layout === layout; }, `the ${layout}`, 20_000);
      const text = draw(160).lines.map(visible).join("\n");
      expect(text).toContain("Beetroot on the bench");
      expect(text).not.toContain("Thin to a hand apart");
    }
  }, 60_000);

  test("a click on a cover picks its card", async () => {
    h.app.video = "kitty";
    await h.app.dispatch.act({ action: "section.try", args: { name: "gallery" } }, { kind: "user" });
    await until(() => !!reader()?.msg, "the gallery note");
    const note = await h.board.createBlock(h.seeded.notes.root.id, `Click shelf\n\n::view{query="shelf=seed-cards" layout=gallery body=0 sort="title asc"} ^clicks\n::`);
    await act("open", { id: note.id });
    await until(() => { draw(160); return images().filter(i => i.crop).length >= 3; }, "the covers", 20_000);
    const lists = () => reader().surface.listsDrawn as any[];
    const picked = () => lists().find(l => l.key === "^clicks")?.view.hasPick(PERSON) ? lists().find(l => l.key === "^clicks").view.picked().label : null;
    const titleAt = (title: string) => { const rows = h.sc.render(h.app).lines.map(visible), y = rows.findIndex(l => l.includes(title)); return { x: rows[y]!.indexOf(title), y }; };
    const { rows } = images().find(i => i.media.path.endsWith("evening-beds.jpg"))!;
    // A picture's last row, then another's first (where its own tag sits): the card is picked, nothing opens.
    for (const [title, up] of [["The beds, evening", 1], ["Beetroot on the bench", rows]] as const) {
      const at = titleAt(title), y = at.y - up;
      h.press({ kind: "mouse", action: "down", button: 0, x: at.x, y });
      h.press({ kind: "mouse", action: "up", button: 0, x: at.x, y });
      await until(() => picked() === title, `${title} picked ${up} rows above its title`);
      expect(reader().msg?.id).toBe(note.id);
    }
  }, 60_000);

  test("without graphics a card names its picture on one row", async () => {
    h.app.video = "cells";
    await h.app.dispatch.act({ action: "section.try", args: { name: "gallery" } }, { kind: "user" });
    await until(() => shelf(160).lines.some(l => l.includes("Beetroot on the bench")), "the shelf", 20_000);
    const { lines } = shelf(160);
    expect(lines.join("\n")).not.toContain("Thin to a hand apart");
    expect(lines.join("\n")).toContain("▣ allotment-notice.png");
    expect(lines.join("\n")).not.toContain("header ");
    h.app.video = "kitty";
  }, 60_000);
});
