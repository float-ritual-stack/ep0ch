// PIE-721: which of the outline's figures a note would read best as. Jev is never asked here: a fake fetch answers, so
// the request built, the answer read and the thresholds are what's tested. Fictional notes only.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_COMPONENT_SCHEMAS, mergeComponentSchemas, type ComponentSchema } from "@ep0ch/outline-core/component-schema";
import { loadFigureFitPrompt } from "../src/ai-prompts";
import { figureFitRequest, figureOptions, figureShape, fitOf, readFigureFit, suggestFigure } from "../src/figure-fit";
import { resetJevKey } from "../src/search-ranking";

const SEASON = ["Garden year", "- 2026-03: seeds sown", "- 2026-05: first flowers", "- 2026-08: open garden", "- 2026-10: seed collecting"].join("\n");
const MUSING = ["Why the beds face south", "", "The light lands there first, and the wall keeps the warmth into the evening. It is the one choice I would make again."].join("\n");

/** A fake Jev: the answers it is given, and the bodies it was sent. */
function jev(answers: Record<string, unknown>, status = 200) {
  const sent: any[] = [];
  const fetch = async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers }), { status });
  };
  return { fetch, sent };
}
const TIMELINE = {
  which: { type: "choice", choice: "graph-timeline", confidence: 0.82, probabilities: { "graph-timeline": 0.9, "graph-check": 0.05 } },
  "gate::structured": { type: "noul", noul: 0.93 },
  "gate::prose": { type: "noul", noul: 0.08 },
};

describe("a note's shape", () => {
  test("three dated lines, list items or table rows are a shape; prose isn't; a note with its own figure chose already", () => {
    expect(figureShape(SEASON)).toBe("shaped");
    expect(figureShape("Seeds\n- tomato\n- bean\n- leek")).toBe("shaped");
    expect(figureShape("Costs\n| item | cost |\n| --- | --- |\n| bolts | 12 |")).toBe("shaped");
    expect(figureShape(MUSING)).toBe("no-shape");
    expect(figureShape(`${SEASON}\n::graph-timeline\n---\n---\n- 2026-11: frost\n::`)).toBe("has-figure");
  });

  test("lines inside a code fence are the code's, not the note's", () => {
    expect(figureShape("How\n```\n- a\n- b\n- c\n```")).toBe("no-shape");
    expect(figureShape("> [!note] Example\n> ```\n> - a\n> - b\n> - c\n> ```")).toBe("no-shape");
    expect(figureShape("```\n> [!note] Example\n> - a\n> - b\n> - c\n```")).toBe("no-shape");
  });

  test("an extension's figure, by the name it is written with, is a figure the note chose", () => {
    const rainfall: ComponentSchema = { ...BUILTIN_COMPONENT_SCHEMAS.find(s => s.id === "graph-spark")!, id: "ext-almanac-rainfall", title: "Rainfall (::rainfall)", source: { use: "::rainfall\n---\n{{props.yaml}}\n---\n::" }, origin: undefined };
    const { schemas } = mergeComponentSchemas({ extensions: [{ id: "almanac", components: [rainfall] }] });
    const drawn = `${SEASON}\n::rainfall\n---\n---\n- 2026-09: 40\n::`;
    expect(figureShape(drawn, schemas)).toBe("has-figure");
    expect(figureShape(drawn)).toBe("shaped");
    // Suggested as it is written, looked up by its id.
    const options = figureOptions(schemas);
    const reading = readFigureFit({ answers: { ...TIMELINE, which: { ...TIMELINE.which, choice: "ext-almanac-rainfall" } } }, options, []);
    if ("error" in reading) throw new Error(reading.error);
    const said = (fitOf(reading, schemas) as { fit: { said: string } }).fit.said;
    expect(said).toContain("::rainfall would draw it");
    expect(said).toContain("outline_components ext-almanac-rainfall");
  });
});

describe("the request and its answer", () => {
  test("the options are the outline's figures, each described by its schema, an extension's figure among them", () => {
    const extra: ComponentSchema = { ...BUILTIN_COMPONENT_SCHEMAS.find(s => s.id === "graph-spark")!, id: "ext-almanac-rainfall", title: "Rainfall (::rainfall)", origin: undefined };
    const { schemas } = mergeComponentSchemas({ extensions: [{ id: "almanac", components: [extra] }] });
    const options = figureOptions(schemas);
    expect(options["graph-timeline"]).toStartWith("Timeline: Events down a spine");
    expect(options["ext-almanac-rainfall"]).toStartWith("Rainfall: ");
    expect(options["callout"]).toBeUndefined();
    expect(options["links"]).toBeUndefined();
  });

  test("one Choice over the figures and two Noul gates, the note as state", async () => {
    const prompt = await loadFigureFitPrompt();
    const body = figureFitRequest(SEASON, figureOptions(BUILTIN_COMPONENT_SCHEMAS), prompt);
    expect(body.state).toEqual({ title: "Garden year", text: SEASON });
    expect(body.questions.which.type).toBe("choice");
    expect(Object.keys(body.questions.which.criteria)).toContain("graph-compare");
    expect(body.questions["gate::structured"]).toEqual({ type: "noul", instructions: prompt.structured });
    expect(body.questions["gate::prose"]).toEqual({ type: "noul", instructions: prompt.prose });
  });

  test("an answer reads only whole: a choice that isn't an option, or a number out of range, isn't one", () => {
    const options = figureOptions(BUILTIN_COMPONENT_SCHEMAS);
    const ok = readFigureFit({ answers: TIMELINE }, options, []);
    expect(ok).toMatchObject({ choice: "graph-timeline", confidence: 0.82, gate: (0.93 + 0.92) / 2 });
    expect(readFigureFit({ answers: { ...TIMELINE, which: { ...TIMELINE.which, choice: "graph-nonsense" } } }, options, [])).toEqual({ error: "Jev's figure-fit answer didn't read" });
    expect(readFigureFit({ answers: { ...TIMELINE, "gate::prose": { type: "noul", noul: 1.4 } } }, options, [])).toEqual({ error: "Jev's figure-fit answer didn't read" });
  });

  test("a suggestion needs the gate and the confidence over their thresholds", () => {
    const options = figureOptions(BUILTIN_COMPONENT_SCHEMAS);
    const reading = readFigureFit({ answers: TIMELINE }, options, []);
    if ("error" in reading) throw new Error(reading.error);
    const fit = fitOf(reading, BUILTIN_COMPONENT_SCHEMAS);
    expect(fit).toMatchObject({ fit: { component: "graph-timeline", confidence: 0.82 } });
    expect("fit" in fit && fit.fit?.said).toStartWith("this reads as a timeline: ::graph-timeline would draw it (Events down a spine");
    expect(fitOf({ ...reading, gate: 0.4 }, BUILTIN_COMPONENT_SCHEMAS)).toMatchObject({ fit: null, why: "below-gate" });
    expect(fitOf({ ...reading, confidence: 0.2 }, BUILTIN_COMPONENT_SCHEMAS)).toMatchObject({ fit: null, why: "unsure" });
    expect(fitOf({ ...reading, confidence: 0.2 }, BUILTIN_COMPONENT_SCHEMAS, { gate: 0.6, confidence: 0.1 })).toMatchObject({ fit: { component: "graph-timeline" } });
    // A kept reading that names a figure the outline no longer has (the eval's cache) suggests nothing.
    expect(fitOf({ ...reading, choice: "graph-retired" }, BUILTIN_COMPONENT_SCHEMAS)).toMatchObject({ fit: null, why: "not-a-figure" });
  });
});

describe("suggestFigure", () => {
  const schemas = BUILTIN_COMPONENT_SCHEMAS;

  test("a shaped note: one request, the suggestion", async () => {
    const j = jev(TIMELINE);
    const answer = await suggestFigure(SEASON, schemas, { apiKey: "fake", fetch: j.fetch });
    expect(answer).toMatchObject({ fit: { component: "graph-timeline" } });
    expect(j.sent).toHaveLength(1);
  });

  test("a nested callout names its enclosing callout and respects its own figure", async () => {
    const j = jev(TIMELINE);
    const text = "> [!summary] Garden\n> One season.\n> > [!note]+ Dates\n> > - 2026-03: seeds\n> > - 2026-05: flowers\n> > - 2026-08: harvest";
    const answer = await suggestFigure(text, schemas, { apiKey: "fake", fetch: j.fetch });
    expect(answer).toMatchObject({ fit: { component: "graph-timeline", said: expect.stringContaining('the callout "Garden" with "Dates" reads as a timeline') } });
    expect(j.sent[0].state.text).toBe("- 2026-03: seeds\n- 2026-05: flowers\n- 2026-08: harvest");
    expect(figureShape(`${text}\n> > ::graph-timeline\n> > ---\n> > ---\n> > ::`)).toBe("has-figure");
  });

  test("prose and a note with its own figure ask nothing", async () => {
    const j = jev(TIMELINE);
    expect(await suggestFigure(MUSING, schemas, { apiKey: "fake", fetch: j.fetch })).toEqual({ fit: null, why: "no-shape" });
    expect(await suggestFigure(`${SEASON}\n::graph-check\n---\n---\n::`, schemas, { apiKey: "fake", fetch: j.fetch })).toEqual({ fit: null, why: "has-figure" });
    expect(j.sent).toHaveLength(0);
  });

  test("Jev that can't be asked says why and never throws: no key, an HTTP error, a timeout, an answer that doesn't read", async () => {
    // A key found earlier in this process is forgotten, and no request could leave it anyway.
    resetJevKey();
    const offline = async () => { throw new Error("no network in tests"); };
    expect(await suggestFigure(SEASON, schemas, { env: { WITH_SECRETS_DIR: mkdtempSync(join(tmpdir(), "no-secrets-")) }, fetch: offline })).toMatchObject({ unavailable: expect.stringContaining("Jev is not configured") });
    expect(await suggestFigure(SEASON, schemas, { apiKey: "fake", fetch: jev(TIMELINE, 503).fetch })).toEqual({ unavailable: "Jev HTTP 503" });
    const slow = async (_u: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" }))));
    expect(await suggestFigure(SEASON, schemas, { apiKey: "fake", fetch: slow, timeoutMs: 20 })).toEqual({ unavailable: "Jev didn't answer in time" });
    expect(await suggestFigure(SEASON, schemas, { apiKey: "fake", fetch: jev({}).fetch })).toEqual({ unavailable: "Jev's figure-fit answer didn't read" });
  });
});

describe("the prompt file", () => {
  test("a prompt folder made before figure-fit.json existed reads the shipped one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prompts-"));
    try {
      writeFileSync(join(dir, "goto-ranking.json"), "{}");
      const prompt = await loadFigureFitPrompt(dir);
      expect(prompt.structured).toContain("structured data");
      expect(prompt.revisions[0]!.path).not.toStartWith(dir);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
