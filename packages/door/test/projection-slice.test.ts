// A fragment embed (`!((id^frag))`) draws only the projections whose line is inside the slice. Before this,
// every projection above the slice was placed at its top (-1, "above the body") and every one below at its
// last line, so embedding one heading's section of a note with two extension directives drew both: a
// `^replay` embed opened with the deck. Made-up note lines and providers only.
import { describe, expect, test } from "bun:test";
import { regionsByLine, type ResourceProjection } from "../src/projection";

const at = (line: number, provider: string): ResourceProjection => ({
  anchor: { kind: "directive", line, start: 0, end: 0 }, provider, label: provider, propertyKey: provider,
  options: { unknown: [] }, status: "ready", fields: [],
});
// A note: the deck directive on line 4, the replay directive on line 7, a third one on line 11.
const DECK = at(4, "deck"), REPLAY = at(7, "replay"), LATER = at(11, "later");
const all = [DECK, REPLAY, LATER];
const providers = (m: ReturnType<typeof regionsByLine>) => [...m].sort((a, b) => a[0] - b[0]).map(([i, ps]) => `${i}:${ps.map(x => x.p.provider).join(",")}`);

describe("projections by line", () => {
  test("the whole note: each directive's output follows its own line", () => {
    const lines = Array.from({ length: 13 }, (_, i) => i);
    expect(providers(regionsByLine(all, lines))).toEqual(["4:deck", "7:replay", "11:later"]);
  });

  test("a slice keeps only the output whose line is inside it", () => {
    // `## replay ^replay` covers note lines 6 to 8: the replay directive, nothing above or below.
    expect(providers(regionsByLine(all, [6, 7, 8], { slice: true }))).toEqual(["1:replay"]);
  });

  test("a slice with no directive in it draws no output at all", () => {
    expect(providers(regionsByLine(all, [0, 1, 2], { slice: true }))).toEqual([]);
  });

  test("a slice never carries a ticket page's header or comments", () => {
    const page: ResourceProjection = { ...at(0, "jira"), anchor: { kind: "record" } as ResourceProjection["anchor"] };
    expect(providers(regionsByLine([page, REPLAY], [6, 7, 8], { slice: true }))).toEqual(["1:replay"]);
  });
});
