// The pictures section (PIE-1555): its note's mermaid, svg-fence and svg-file pictures draw as kitty placements in the
// reader, ~ shows their source and draws them again, and the made-up icat in the terminal tile beside it draws its picture
// in that tile, which goes when the tile closes. Driven through act on the seeded showcase.
import { describe, expect, test } from "bun:test";
import type { Desk } from "../../src/desk/desk";
import { ReaderPane } from "../../src/desk/panes";
import { PtyPane } from "../../src/desk/pty";
import { SECTIONS } from "../../src/showcase/showcase";
import { visible } from "../../src/style";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe("showcase: pictures", () => {
  const h = useShowcaseScreen(160);
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string) => h.app.dispatch.act({ action, args, tile }, { kind: "user" }) as Promise<any>;
  const stage = () => h.S().stage(SECTIONS.findIndex(s => s.key === "pictures")).top as Desk;
  const panes = () => [...(stage() as any).panes.values()];
  const reader = () => panes().find(p => p instanceof ReaderPane) as ReaderPane;
  const icat = () => panes().find(p => p instanceof PtyPane) as PtyPane;

  test("the script's banner is the note's header with its links, the board draws it on cards, the fences draw, ~ shows their source", async () => {
    h.app.video = "kitty";
    await act("section.try", { name: "pictures" });
    const d = stage();
    await until(() => !!reader()?.msg, "the pictures note in the reader");
    // Tall enough for the whole note: every picture in view.
    const draw = (w = 96) => reader().render(w, 300, false, d);
    const keys = () => (draw().placements ?? []).map(p => p.key);
    // The header (the render line's svg, [layout::hero]), three cards, three mermaid diagrams, the svg fence, the svg file.
    try { await until(() => keys().some(k => k.startsWith("hero")) && keys().length >= 9, "the header and eight pictures placed", 20_000); }
    catch (e) { console.log(keys()); throw e; }
    const text = draw().lines.map(visible);
    for (const said of ["▀ header · banner: Diagrams of the plot", "▣ mermaid diagram: flowchart, 5 nodes", "▣ mermaid diagram: sequence, 3 participants", "▣ mermaid diagram: state, 3 states", "▣ svg picture: 360×90", "Bean row", "Winter cover"]) {
      expect(text.some(l => l.includes(said)), `${said}\n${text.join("\n")}`).toBe(true);
    }
    // At 44 columns every body picture is laid out again for the narrower body, none past it (the header's width is the tile's own).
    await until(() => { const ps = (draw(44).placements ?? []).filter(p => !p.key.startsWith("hero")); return ps.length >= 5 && ps.every(p => p.col + p.cols <= 44); }, "the pictures at 44 columns", 20_000);

    // The header's two links are elements ([ ]), ⏎ on one opens its page; a click on the other opens it too.
    draw();
    const els = (await act("elements", {}, "reader")).elements as { n: number; label: string; target?: string }[];
    const shed = els.find(e => e.target === "Bike shed" && e.label.startsWith("header link"));
    expect(shed, JSON.stringify(els)).toBeDefined();
    expect(els.some(e => e.target === "Allotment notebook" && e.label.startsWith("header link")), JSON.stringify(els)).toBe(true);
    await act("element.select", { n: shed!.n }, "reader");
    expect(await act("element.open", {}, "reader")).toMatchObject({ kind: "link", title: "Bike shed" });
    await act("back", {}, "reader").catch(() => {});
    await act("open", { id: h.seeded.notes.pictures.id }, "reader");
    await until(() => keys().some(k => k.startsWith("hero")), "the pictures note again, its header drawn");
    const hits = (reader().surface as any).heroHits as { row: number; from: number; link: { page?: string } }[];
    const book = hits.find(r => r.link.page === "Allotment notebook")!;
    expect(book, JSON.stringify(hits)).toBeDefined();
    const host = reader().host(d);
    reader().surface.press(book.from, book.row, host);
    const showing = async () => JSON.stringify(await act("layout.get"));
    for (let i = 0; i < 100 && !(await showing()).includes('"title":"Allotment notebook"'); i++) await Bun.sleep(50);
    expect(await showing()).toContain('"title":"Allotment notebook"');
    await act("open", { id: h.seeded.notes.pictures.id }, "reader");
    await until(() => keys().some(k => k.startsWith("hero")), "back on the pictures note");

    // ~: the note as written, the fences' text; the [img::] line, the header and the cards stay pictures (not fences).
    await act("decor.raw", { on: true }, "reader");
    const raw = draw();
    expect(raw.lines.map(visible).some(l => l.includes("Frost tonight?"))).toBe(true);
    expect((raw.placements ?? []).filter(p => !p.key.startsWith("hero")).length).toBeLessThan(keys().length);
    await act("decor.raw", { on: false }, "reader");

    // The made-up icat asked, was answered, and drew: one placement in its tile, under its own key.
    const t = icat();
    t.render(60, 30, false, d);
    await until(() => t.text().some(l => l.includes("the plot plan")), "icat's caption");
    const view = t.render(60, 30, false, d);
    expect(view.placements).toHaveLength(1);
    expect(view.placements![0]).toMatchObject({ col: 0, row: 0 });
    // A tile narrower than the picture cuts it at its edge.
    expect(t.render(20, 30, false, d).placements![0]!.cols).toBeLessThanOrEqual(20);
  }, 60_000);
});
