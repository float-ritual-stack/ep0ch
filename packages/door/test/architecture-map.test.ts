// The architecture map's data holds together and draws. Its citations are checked by the generator itself
// (`bun scripts/architecture-map.ts --check`), not here: code moving under a citation shouldn't fail an
// unrelated change; it fails the next regeneration, which is when the map is redrawn.
import { describe, expect, test } from "bun:test";
import { counts, loadMap, payload, render, shapeProblems, type Pins } from "../scripts/architecture-map";
import { depths, isoLayout } from "../scripts/architecture-map/iso";

// Made-up commits: the page never needs the checkouts to draw.
const PINS: Pins = {
  now: { door: "a".repeat(40), outliner: "b".repeat(40) },
  reviews: { A: { door: "c".repeat(40), outliner: "d".repeat(40) }, B: { door: "c".repeat(40), outliner: "d".repeat(40) }, C: { door: "c".repeat(40), outliner: "d".repeat(40) } },
  dirty: [],
};

describe("architecture map", () => {
  const d = loadMap();

  test("every id, chapter, group, finding, route and hand-set cell it names exists", () => {
    expect(shapeProblems(d)).toEqual([]);
  });

  test("draws one page with every structure, chapter and trace step, and no outside resources", async () => {
    const html = await render(d, { logo: null, pins: PINS });
    for (const s of d.structures) expect(html).toContain(`id="s-${s.id.replace(/\./g, "-")}"`);
    for (let i = 1; i <= d.chapters.length; i++) expect(html).toContain(`id="ch-${i}"`);
    expect(html.match(/class="step /g)?.length).toBe(d.trace.steps.length);
    expect(html).not.toMatch(/<(link|img|iframe)\b|src="http/);
    const c = counts(d);
    expect(html).toContain(`structures shown</span> <b>${c.structures}</b>`);
    expect(c.kept + c.built).toBe(c.structures);
    // The map is the page when script runs; the text above is its fallback.
    expect(html).toContain(`<div id="app" class="app"></div>`);
    expect(html).toContain(`<script type="application/json" id="map-data">`);
  });

  test("every GitHub link is pinned to a full commit, never a branch", async () => {
    const html = await render(d, { logo: null, pins: PINS });
    const data = JSON.stringify(payload(d, PINS));
    const links = [...html.matchAll(/https:\/\/github\.com\/[^"\s<>\\]+/g)].map(m => m[0]);
    expect(links.length).toBeGreaterThan(d.structures.length);
    for (const url of links) {
      expect(url).toMatch(/\/(blob|tree)\/[0-9a-f]{40}(\/|$|#)/);
      expect(url).not.toMatch(/\/(blob|tree)\/main\b/);
    }
    // Then and now: a finding's review commits and the current ones are both there.
    expect(data).toContain(`/tree/${"c".repeat(40)}`);
    expect(data).toContain(`/blob/${"a".repeat(40)}/packages/door/docs/review/`);
  });

  test("a dirty checkout is stamped on the page", async () => {
    const html = await render(d, { logo: null, pins: { ...PINS, dirty: ["door src/imaginary.ts"] } });
    expect(html).toContain("dirty: 1 uncommitted file (door src/imaginary.ts)");
  });

  test("the isometric places are stable, one block per cell, and nothing stands in front of what it rests on", () => {
    const a = isoLayout(d), b = isoLayout(loadMap());
    expect(b).toEqual(a);
    expect(a.placed.length).toBe(d.structures.length);
    const cells = new Set(a.placed.map(p => `${p.col},${p.row}`));
    expect(cells.size).toBe(a.placed.length);
    const at = new Map(a.placed.map(p => [p.id, p]));
    for (const s of d.structures) {
      const p = at.get(s.id)!;
      if (p.hand) continue;
      for (const dep of s.dependsOn) if (!at.get(dep)!.hand) expect(at.get(dep)!.col).toBeLessThanOrEqual(p.col);
    }
    for (const [id, [col, row]] of Object.entries(d.iso?.place ?? {})) {
      const p = at.get(id)!, lane = a.lanes.find(l => l.group === d.structures.find(s => s.id === id)!.group)!;
      expect([p.col, p.row]).toEqual([col, lane.row + row]);
    }
  });

  test("depth counts the longest chain beneath a structure", () => {
    const dd = depths([
      { id: "x", group: "g", chapter: "c", dependsOn: [] },
      { id: "y", group: "g", chapter: "c", dependsOn: ["x"] },
      { id: "z", group: "g", chapter: "c", dependsOn: ["x", "y"] },
    ]);
    expect([dd.get("x"), dd.get("y"), dd.get("z")]).toEqual([0, 1, 2]);
  });
});
