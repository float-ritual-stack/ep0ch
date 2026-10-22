// PIE-721: the figure-fit eval: its labelled set from an outline's own notes, its scores at any thresholds from one set
// of answers, its report as a note that draws, and the script end to end on a scratch outline's copy with a fake Jev
// (never the real one, never a live outline). Fictional notes only.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_COMPONENT_SCHEMAS } from "@ep0ch/outline-core/component-schema";
import { componentReading } from "@ep0ch/outline-core/component-warnings";
import type { FigureFitReading } from "../src/figure-fit";
import { defigure, evalSet, reportNote, scoreReadings, sweepThresholds } from "../src/figure-fit-eval";
import { OutlinerStore } from "../src/store";
import { main } from "../scripts/evals/figure-fit";

const TIMELINE_NOTE = ["Garden year", "::graph-timeline", "---", "title: the year", "---", "- 2026-03: seeds sown", "- 2026-05: first flowers", "- 2026-08: open garden", "::", "After the frost."].join("\n");
const STAT_NOTE = ["Beds", "::graph-stat", "---", "items: [{ value: \"4\", label: raised }]", "---", "::"].join("\n");
const SHAPED = ["Seed order", "- tomato", "- bean", "- leek"].join("\n");
const PROSE = "Why the beds face south\n\nThe light lands there first.";

const reading = (choice: string, confidence: number, gate: number): FigureFitReading =>
  ({ choice, probabilities: { [choice]: confidence }, confidence, structured: gate, prose: 1 - gate, gate, model: "jev-1.13.0", prompt: [] });

describe("the labelled set", () => {
  test("a figure with rows of its own is taken back to them: the note as it would read had nobody known the figure", () => {
    expect(defigure(TIMELINE_NOTE)).toEqual({ text: ["Garden year", "- 2026-03: seeds sown", "- 2026-05: first flowers", "- 2026-08: open garden", "After the frost."].join("\n"), figure: "graph-timeline" });
    expect(defigure(STAT_NOTE)).toBeNull();
    expect(defigure(SHAPED)).toBeNull();
  });

  test("positives from figures, shaped notes unlabelled, hand labels over both, prose left out unless labelled", () => {
    const set = evalSet([
      { id: "t", text: TIMELINE_NOTE }, { id: "s", text: SHAPED }, { id: "p", text: PROSE }, { id: "q", text: STAT_NOTE }, { id: "h", text: "Plot\n- a: 1\n- b: 2\n- c: 3" }, { id: "n", text: PROSE },
    ], { h: "graph-rank", n: "none" });
    expect(set.map(i => [i.id, i.label, i.source])).toEqual([["t", "graph-timeline", "figure"], ["s", null, "shaped"], ["h", "graph-rank", "hand"], ["n", "none", "hand"]]);
    expect(set[0]!.text).not.toContain("::graph-timeline");
  });
});

describe("the scores", () => {
  const items = [
    { id: "a", title: "A", text: SHAPED, label: "graph-timeline", source: "figure" as const, reading: reading("graph-timeline", 0.8, 0.9) },
    { id: "b", title: "B", text: SHAPED, label: "graph-check", source: "figure" as const, reading: reading("graph-timeline", 0.5, 0.8) },
    { id: "c", title: "C", text: SHAPED, label: null, source: "shaped" as const, reading: reading("graph-table", 0.45, 0.7) },
    { id: "d", title: "D", text: SHAPED, label: "none", source: "hand" as const, reading: reading("graph-check", 0.9, 0.3) },
    { id: "e", title: "E", text: SHAPED, label: "graph-rank", source: "figure" as const },
  ];

  test("first choice, suggested and right, per figure, the mix-ups, how chatty: at the thresholds given; no reading is left out", () => {
    const s = scoreReadings(items, BUILTIN_COMPONENT_SCHEMAS, { gate: 0.6, confidence: 0.4 });
    expect(s.positives).toEqual({ n: 2, top1: 1, suggested: 2, correct: 1 });
    expect(s.perKind["graph-check"]).toEqual({ n: 1, top1: 0, correct: 0 });
    expect(s.confusion).toEqual([{ label: "graph-check", choice: "graph-timeline", n: 1 }]);
    expect(s.shaped).toMatchObject({ n: 1, suggested: 1, examples: [{ id: "c", component: "graph-table" }] });
    expect(s.none).toEqual({ n: 1, suggested: 0 });
  });

  test("every threshold from the same answers: stricter is quieter", () => {
    const sweep = sweepThresholds(items, BUILTIN_COMPONENT_SCHEMAS);
    const loose = sweep.find(r => r.gate === 0.5 && r.confidence === 0.3)!, strict = sweep.find(r => r.gate === 0.7 && r.confidence === 0.6)!;
    expect(loose.shapedRate).toBe(1);
    expect(strict.shapedRate).toBe(0);
    expect(strict.recall).toBe(0.5);
  });

  test("precision counts a suggestion on a note labelled none as a wrong one; a note without the shape is never told", () => {
    const told = [
      { id: "a", title: "A", text: SHAPED, label: "graph-timeline", source: "figure" as const, reading: reading("graph-timeline", 0.8, 0.9) },
      { id: "n", title: "N", text: SHAPED, label: "none", source: "hand" as const, reading: reading("graph-check", 0.9, 0.9) },
      // Prose labelled as a checklist: the live path never asks about it, so neither does the eval.
      { id: "p", title: "P", text: PROSE, label: "graph-check", source: "hand" as const },
    ];
    const s = scoreReadings(told, BUILTIN_COMPONENT_SCHEMAS, { gate: 0.6, confidence: 0.4 });
    expect(s.positives).toEqual({ n: 2, top1: 1, suggested: 1, correct: 1 });
    expect(s.none).toEqual({ n: 1, suggested: 1 });
    expect(sweepThresholds(told, BUILTIN_COMPONENT_SCHEMAS).find(r => r.gate === 0.6 && r.confidence === 0.4)).toMatchObject({ recall: 0.5, precision: 0.5 });
  });

  test("the report is a note that draws: its figures read without a warning", () => {
    const s = scoreReadings(items, BUILTIN_COMPONENT_SCHEMAS, { gate: 0.6, confidence: 0.4 });
    const note = reportNote(s, sweepThresholds(items, BUILTIN_COMPONENT_SCHEMAS), { outline: "garden.sqlite", model: "jev-1.13.0", prompt: "abc123", asked: 4, cached: 0, unavailable: 0 });
    expect(note).toStartWith("Figure-fit eval: garden.sqlite [type::eval]");
    expect(componentReading(note, BUILTIN_COMPONENT_SCHEMAS)).toEqual({ components: ["graph-stat", "graph-table"], warnings: [] });
    expect(note).toContain("- graph-check read as graph-timeline: 1");
    expect(note).toContain("((c|C)) → graph-table (0.45)");
  });
});

describe("the script, on a scratch outline's copy", () => {
  const root = mkdtempSync(join(tmpdir(), "figure-fit-eval-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("asks Jev once per note, answers a second run from the cache, and never opens a file in the outlines folder", async () => {
    const copy = join(root, "garden-copy.sqlite");
    const store = new OutlinerStore(copy, { workspaceRoot: root });
    for (const text of [TIMELINE_NOTE, SHAPED, PROSE]) store.create(text);
    store.close();
    const sent: string[] = [];
    const fake = Bun.serve({
      port: 0, hostname: "127.0.0.1",
      async fetch(request) {
        const body = await request.json() as { state: { text: string } };
        sent.push(body.state.text);
        const dated = /^- \d{4}-\d{2}/m.test(body.state.text);
        return Response.json({ model: "jev-1.13.0", answers: {
          which: { type: "choice", choice: dated ? "graph-timeline" : "graph-check", confidence: dated ? 0.9 : 0.3, probabilities: {} },
          "gate::structured": { type: "noul", noul: dated ? 0.9 : 0.6 }, "gate::prose": { type: "noul", noul: 0.1 },
        } });
      },
    });
    try {
      const env = { XDG_CACHE_HOME: join(root, "cache"), EP0CH_OUTLINES: join(root, "outlines"), TYPESAFE_API_KEY: "fake-key", OUTLINER_JEV_ENDPOINT: `http://127.0.0.1:${fake.port}/v1/systemone` };
      const lines: string[] = [];
      expect(await main([copy, "--out", join(root, "report.json")], env, l => lines.push(l), l => lines.push(l))).toBe(0);
      // A new outline's own guide notes are in the copy too: this test's notes are among what was sent.
      expect(sent).toContain(SHAPED);
      expect(sent).toContain(defigure(TIMELINE_NOTE)!.text);
      expect(sent).not.toContain(PROSE);
      expect(lines[0]).toContain(`(Jev asked ${sent.length}, cached 0, unavailable 0)`);
      const report = JSON.parse(readFileSync(join(root, "report.json"), "utf8"));
      expect(report.score.perKind["graph-timeline"].correct).toBeGreaterThanOrEqual(1);
      const asked = sent.length;
      const again: string[] = [];
      expect(await main([copy, "--note"], env, l => again.push(l), l => again.push(l))).toBe(0);
      expect(sent).toHaveLength(asked);
      expect(again.join("\n")).toStartWith("Figure-fit eval: garden-copy.sqlite [type::eval]");

      mkdirSync(join(root, "outlines"), { recursive: true });
      writeFileSync(join(root, "outlines", "garden.sqlite"), "");
      const refused: string[] = [];
      expect(await main([join(root, "outlines", "garden.sqlite")], env, l => refused.push(l), l => refused.push(l))).toBe(2);
      expect(refused[0]).toContain("is in the outlines folder; take a copy first");
    } finally { fake.stop(true); }
  });
});
