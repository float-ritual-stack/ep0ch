import { describe, expect, test } from "bun:test";
import { checkPassage, citePassage, findPassage, isMiss, missMessage, passageAt, passageReference } from "../src/passage";
import { annotationKind, annotationProperties, annotationPropertyProblem, annotationTone } from "../src/annotation-marks";

const NOTE = "Greenhouse plan\nWater the tomatoes at dawn.\nWater the beans at dusk. ^beds\nThe tomatoes need stakes.";

describe("passageAt", () => {
  test("takes the quote and up to 32 characters either side", () => {
    const at = NOTE.indexOf("tomatoes");
    const p = passageAt(NOTE, at, at + 8, "b1", 3);
    expect(p).toMatchObject({ subject: "b1", revision: 3, quote: "tomatoes", start: at, end: at + 8 });
    expect(p.prefix).toBe(NOTE.slice(Math.max(0, at - 32), at));
    expect(p.suffix).toBe(NOTE.slice(at + 8, at + 40));
  });
  test("refuses a span that selects nothing", () => {
    expect(() => passageAt(NOTE, 4, 4, "b1", 1)).toThrow(/selects some of the text/);
    expect(() => passageAt(NOTE, 0, NOTE.length + 1, "b1", 1)).toThrow();
  });
});

describe("findPassage", () => {
  test("a quote there once is found", () => {
    expect(findPassage(NOTE, "at dusk")).toEqual({ start: NOTE.indexOf("at dusk"), end: NOTE.indexOf("at dusk") + 7 });
  });
  test("a repeated quote is refused, saying how often, unless start, near or context says which", () => {
    const miss = findPassage(NOTE, "tomatoes");
    expect(isMiss(miss) && miss.count).toBe(2);
    expect(isMiss(miss) && miss.why).toMatch(/2 times/);
    const second = NOTE.lastIndexOf("tomatoes");
    expect(findPassage(NOTE, "tomatoes", { near: second - 3 })).toEqual({ start: second, end: second + 8 });
    expect(findPassage(NOTE, "tomatoes", { start: second })).toEqual({ start: second, end: second + 8 });
    expect(findPassage(NOTE, "tomatoes", { suffix: " need" })).toEqual({ start: second, end: second + 8 });
  });
  test("words that aren't there name the nearest that are", () => {
    const miss = findPassage(NOTE, "Water the beans at noon");
    expect(isMiss(miss)).toBe(true);
    if (!isMiss(miss)) return;
    expect(miss.nearest?.text).toBe("Water the beans at");
    expect(missMessage(miss)).toMatch(/nearest: "Water the beans at"/);
  });
  test("an empty quote is refused", () => {
    expect(isMiss(findPassage(NOTE, "  "))).toBe(true);
  });
});

describe("checkPassage", () => {
  const at = NOTE.indexOf("at dawn");
  const read = passageAt(NOTE, at, at + 7, "b1", 4);
  test("at the revision it was read at, the quote must be at start", () => {
    expect(checkPassage(NOTE, 4, read)).toEqual({ passage: read, moved: false });
    const wrong = { ...read, start: read.start + 1, end: read.end + 1 };
    const miss = checkPassage(NOTE, 4, wrong);
    expect(isMiss(miss) && miss.why).toMatch(/isn't at/);
  });
  test("at a newer revision it moves when found once with its context", () => {
    const now = "A new first line.\n" + NOTE;
    const r = checkPassage(now, 5, read);
    expect(isMiss(r)).toBe(false);
    if (isMiss(r)) return;
    expect(r.moved).toBe(true);
    expect(r.passage.start).toBe(read.start + 18);
    expect(r.passage.revision).toBe(5);
    expect(now.slice(r.passage.start, r.passage.end)).toBe("at dawn");
  });
  test("gone or found twice at a newer revision: refused, never guessed", () => {
    expect(isMiss(checkPassage(NOTE.replace("at dawn", "at noon"), 5, read))).toBe(true);
    const twice = NOTE + "\n" + NOTE;
    const r = checkPassage(twice, 5, read);
    expect(isMiss(r) && r.count).toBe(2);
  });
});

describe("citing", () => {
  test("a line with a fragment anchor is cited at it, else the block", () => {
    expect(passageReference("b1", NOTE, NOTE.indexOf("beans"))).toBe("((b1^beds))");
    expect(passageReference("b1", NOTE, NOTE.indexOf("dawn"))).toBe("((b1))");
    expect(passageReference("resource:r9", "x", 0)).toBe("resource:r9");
  });
  test("the quote as a Blockdown quote, then where it's from", () => {
    expect(citePassage({ quote: "Water the beans\nat dusk" }, "((b1^beds))")).toBe("> Water the beans\n> at dusk\n> — ((b1^beds))");
  });
});

describe("annotation marks", () => {
  test("properties leave out the store's own keys; tone from color, else kind", () => {
    const props = annotationProperties([{ key: "type", value: "annotation" }, { key: "kind", value: "highlight" }, { key: "tags", value: "soil" }, { key: "tags", value: "water" }]);
    expect(props).toEqual({ kind: ["highlight"], tags: ["soil", "water"] });
    expect(annotationTone(props)).toBe("warn");
    expect(annotationTone({ ...props, color: ["good"] })).toBe("good");
    expect(annotationTone({ color: ["#ff0"] })).toBe("default");
    expect(annotationKind({}, "")).toBe("highlight");
    expect(annotationKind({}, "a thought")).toBe("comment");
  });
  test("written properties are checked: open keys, one-line values, color a tone", () => {
    expect(annotationPropertyProblem({ kind: "highlight", tags: ["a", "b"], "reading-list": "autumn" })).toBeNull();
    expect(annotationPropertyProblem({ color: "#ffee00" })).toMatch(/theme tone/);
    expect(annotationPropertyProblem({ type: "x" })).toMatch(/store's own/);
    expect(annotationPropertyProblem({ kind: "a]b" })).toMatch(/no \[ or \]/);
  });
});
