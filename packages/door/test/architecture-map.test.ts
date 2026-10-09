// The architecture map's data holds together, draws, and still points at the code it names. A citation is a file, a
// marker (a snippet of the cited code) and a line; the marker is the identity and the line its address, so code that
// moves is the push-review round's to fix (`--check` is line-exact; `--sync` moves the lines), not every PR's: this test
// fails only on rot that misleads, a cited file that is gone or one that no longer holds its marker (PIE-711).
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { citationProblems, counts, loadMap, payload, render, shapeProblems, syncCitations, type Pins } from "../scripts/architecture-map";
import { depths, isoLayout } from "../scripts/architecture-map/iso";

// Made-up commits: the page never needs the checkouts to draw.
const PINS: Pins = {
  now: { door: "a".repeat(40), outliner: "b".repeat(40) },
  reviews: Object.fromEntries(Object.keys(loadMap().reviews).map(k => [k, { door: "c".repeat(40), outliner: "d".repeat(40) }])),
  dirty: [],
};

describe("architecture map", () => {
  const d = loadMap();

  test("every id, chapter, group, finding, route and hand-set cell it names exists", () => {
    expect(shapeProblems(d)).toEqual([]);
  });

  test("every cited file exists and still holds the code its citation names", () => {
    const problems = citationProblems(d, undefined, { exactLine: false });
    expect(problems.length ? `${problems.length} citation(s) lost their code; rewrite them (\`bun scripts/architecture-map.ts --sync\` lists them)\n${problems.slice(0, 20).join("\n")}` : "").toBe("");
  });

  test("the stamp names a commit", () => {
    expect(d.verified.door).toMatch(/^[0-9a-f]{7,40}$/);
    expect(d.verified.outliner).toMatch(/^[0-9a-f]{7,40}$/);
  });

  test("--sync moves a citation to its marker, keeps the nearest of a repeated one, and lists what no marker finds", () => {
    const root = mkdtempSync(join(tmpdir(), "archmap-"));
    try {
      mkdirSync(join(root, "door"), { recursive: true });
      mkdirSync(join(root, "outliner"));
      writeFileSync(join(root, "door/a.ts"), ["// new first line", "// and another", "export const A = 1;", "x();", "x();", "x();"].join("\n"));
      const checkout = { door: join(root, "door"), outliner: join(root, "outliner") };
      const ref = (p: string, l: number, m: string) => ({ r: "door" as const, p, l, m });
      const base = loadMap();
      const map = {
        ...base, findings: [], structures: [{ ...base.structures[0]!, refs: [ref("a.ts", 1, "export const A"), ref("a.ts", 6, "x();"), ref("a.ts", 3, "gone()"), ref("b.ts", 1, "x")] }],
        trace: { ...base.trace, steps: [] },
      };
      const { moved, lost } = syncCitations(map, checkout);
      expect(map.structures[0]!.refs.map(r => r.l)).toEqual([3, 6, 3, 1]);
      expect(moved).toBe(1);
      expect(lost.length).toBe(2);
      expect(citationProblems(map, checkout).length).toBe(2);
      expect(citationProblems({ ...map, structures: [{ ...map.structures[0]!, refs: [ref("a.ts", 5, "export const A")] }] }, checkout, { exactLine: false })).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
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
    expect(data).toContain(`/blob/${d.reviews.A!.kept ?? "a".repeat(40)}/packages/door/docs/review/`);
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
