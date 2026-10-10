import { describe, expect, test } from "bun:test";
import { anchorsOfText, describeReferenceWarnings, referenceSuspects, referenceWarnings, type ReferenceLookups, type ReferenceStatus } from "../src/reference-warnings";

const NOTE = "0d1e5ba9-8560-4091-b0f0-7ddfaf4ee35f";
const GONE = "77777777-7777-4777-8777-777777777777";
const NOTE_TEXT = "Meeting notes, for real\n## Monday ^a10\n- the index ^idx";

// A pretend outline: one live note with two anchors; any other id names nothing.
const lookups: ReferenceLookups = {
  async resolve(text) {
    const out: ReferenceStatus[] = [];
    for (const m of text.matchAll(/\(\(([A-Za-z0-9_-]{8,})(?:\^([A-Za-z0-9_-]+))?(?:\|[^)]*)?\)\)/g)) {
      const [, id, frag] = m;
      if (id !== NOTE) { out.push({ blockId: id!, status: "missing" }); continue; }
      out.push({ blockId: id, ...(frag ? { fragmentId: frag } : {}), status: frag && !["a10", "idx"].includes(frag) ? "stale" : "resolved", title: "Meeting notes, for real" });
    }
    return out;
  },
  async search(query) { return /meeting/i.test(query) ? [{ id: NOTE, title: "Meeting notes, for real" }] : []; },
  async text(id) { return id === NOTE ? NOTE_TEXT : null; },
};

describe("references a save warns about (PIE-761)", () => {
  test("an unclosed (( and a (( round words are suspects; code and real references aren't", () => {
    const text = `see ((${NOTE})) and ((${NOTE}^a10|Monday))\n- typing ((Meeting and more\n- \`((Meeting\` in code\n- ((Meeting notes))`;
    expect(referenceSuspects(text).map(s => [s.kind, s.query])).toEqual([["unclosed", "Meeting and more"], ["not-a-reference", "Meeting notes"]]);
  });

  test("a broken ((id, a missing anchor, a missing note and an unclosed title each warn, with a did-you-mean", async () => {
    const text = [
      `a broken ((${NOTE} here`,
      `an anchor ((${NOTE}^a1))`,
      `a gone note ((${GONE}))`,
      "and ((Meeting",
      `fine ((${NOTE}^a10)) and \`((not this\``,
    ].join("\n");
    const ws = await referenceWarnings(text, lookups);
    expect(ws.map(w => [w.written, w.didYouMean?.reference])).toEqual([
      [`((${NOTE}^a1))`, `((${NOTE}^a10))`],
      [`((${GONE}))`, undefined],
      [`((${NOTE} here`, `((${NOTE}))`],
      ["((Meeting", `((${NOTE}))`],
    ]);
    expect(describeReferenceWarnings(ws)).toStartWith("saved; 4 references lead nowhere: ");
  });

  test("a bare id left unclosed is offered closed", async () => {
    const [w] = await referenceWarnings(`see ((${NOTE}`, lookups);
    expect(w).toEqual({ written: `((${NOTE}`, problem: "isn't closed with ))", didYouMean: { reference: `((${NOTE}))`, title: "Meeting notes, for real" } });
  });

  test("lookups that fail drop the suggestion, never the warning", async () => {
    const failing: ReferenceLookups = { resolve: async () => { throw new Error("no answer"); }, search: async () => { throw new Error("no answer"); } };
    expect((await referenceWarnings("and ((Meeting", failing)).map(w => w.written)).toEqual(["((Meeting"]);
  });

  test("text with no references warns about nothing", async () => {
    expect(await referenceWarnings("plain prose (with parens)", lookups)).toEqual([]);
    expect(describeReferenceWarnings([])).toBe("");
  });

  test("anchors in code, and an anchor a note has twice, are never offered", () => {
    expect(anchorsOfText("Notes\n## Monday ^mon\n```\nexample ^example\n```\n- a ^dup\n- b ^dup")).toEqual(["mon"]);
  });
});
