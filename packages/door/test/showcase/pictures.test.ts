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
  const panes = () => [...stage().panes.values()];
  const reader = () => panes().find(p => p instanceof ReaderPane) as ReaderPane;
  const icat = () => panes().find(p => p instanceof PtyPane) as PtyPane;

  test("the note's five pictures draw in the reader, ~ shows their source, and icat's picture is its tile's", async () => {
    h.app.video = "kitty";
    await act("section.try", { name: "pictures" });
    const d = stage();
    await until(() => !!reader()?.msg, "the pictures note in the reader");
    // Tall enough for the whole note: every picture in view.
    const draw = (w = 96) => reader().render(w, 300, false, d);
    await until(() => (draw().placements ?? []).length >= 5, "five pictures placed", 20_000);
    const text = draw().lines.map(visible);
    for (const said of ["mermaid diagram: flowchart, 5 nodes", "mermaid diagram: sequence, 3 participants", "mermaid diagram: state, 3 states", "svg picture: 360×90"]) {
      expect(text.some(l => l.includes(`▣ ${said}`)), `${said}\n${text.join("\n")}`).toBe(true);
    }
    // At 44 columns every picture is laid out again for the narrower body, none past it.
    await until(() => { const ps = draw(44).placements ?? []; return ps.length >= 5 && ps.every(p => p.col + p.cols <= 44); }, "the pictures at 44 columns", 20_000);

    // ~: the note as written, the fences' text; again, the pictures.
    await act("decor.raw", { on: true }, reader().name);
    const raw = draw();
    expect(raw.lines.map(visible).some(l => l.includes("Frost tonight?"))).toBe(true);
    expect((raw.placements ?? []).filter(p => !p.key.startsWith("hero"))).toHaveLength(1);
    await act("decor.raw", { on: false }, reader().name);
    expect((draw().placements ?? []).length).toBeGreaterThanOrEqual(5);

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
