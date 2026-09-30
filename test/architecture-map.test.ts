// The architecture map's data holds together and draws. Its citations are checked by the generator itself
// (`bun scripts/architecture-map.ts --check`), not here: code moving under a citation shouldn't fail an
// unrelated change; it fails the next regeneration, which is when the map is redrawn.
import { describe, expect, test } from "bun:test";
import { counts, loadMap, render, shapeProblems } from "../scripts/architecture-map";

describe("architecture map", () => {
  const d = loadMap();

  test("every id, chapter, group, finding and route it names exists", () => {
    expect(shapeProblems(d)).toEqual([]);
  });

  test("draws one page with every structure, chapter and trace step, and no outside resources", async () => {
    const html = await render(d, { logo: null });
    for (const s of d.structures) expect(html).toContain(`id="s-${s.id.replace(/\./g, "-")}"`);
    for (let i = 1; i <= d.chapters.length; i++) expect(html).toContain(`id="ch-${i}"`);
    expect(html.match(/class="step /g)?.length).toBe(d.trace.steps.length);
    expect(html).not.toMatch(/<(link|img|iframe)\b|src="http/);
    const c = counts(d);
    expect(html).toContain(`structures shown</span> <b>${c.structures}</b>`);
    expect(c.kept + c.built).toBe(c.structures);
  });
});
