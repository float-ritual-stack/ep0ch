// What a picture is (PIE-1594), given only a note's text: which one it is across an insert above it, which is the header,
// how big it draws from its words and pixels, and one step for every kind. Made-up notes.
import { describe, expect, test } from "bun:test";
import { HERO_ROWS, imageBox, locatePicture, pictureStep, pictureWidthCss, picturesIn, rewritePicture, svgOwnSize } from "../src/picture";
import { parseMediaLine, parsePictureFence } from "../src/media-line";

const fence = (body: string, words = "") => `\`\`\`svg${words}\n${body}\n\`\`\``;
const A = "<svg width='10' height='10'/>", B = "<svg width='20' height='10'/>";
const cells = { cellW: 9, cellH: 18, maxImageRows: 48 };

describe("which picture it is", () => {
  test("an insert above leaves each twin who it is, a different picture or text", () => {
    const twins = `Beds\n\n${fence(A)}\n\n${fence(A)}`;
    const [first, second] = picturesIn(twins);
    const moved = `Beds\n\nA line\n\n${fence(B)}\n\n${fence(A)}\n\n${fence(A)}`;
    const [, there1, there2] = picturesIn(moved);
    expect(locatePicture(moved, first!.id)!.line).toBe(there1!.line);
    expect(locatePicture(moved, second!.id)!.line).toBe(there2!.line);
  });

  test("a resize doesn't change who it is, so the other twin is still found", () => {
    const twins = `Beds\n\n${fence(A)}\n\n${fence(A)}`;
    const [first, second] = picturesIn(twins);
    const resized = twins.replace("```svg\n", "```svg height=12\n");
    expect(locatePicture(resized, first!.id)!.source).toBe("```svg height=12");
    expect(locatePicture(resized, second!.id)!.source).toBe("```svg");
  });

  test("another twin, or one gone: it can't be told which it was, so nothing is found", () => {
    const twins = `Beds\n\n${fence(A)}\n\n${fence(A)}`;
    const second = picturesIn(twins)[1]!;
    expect(locatePicture(`${twins}\n\n${fence(A)}`, second.id)).toBeNull();
    expect(locatePicture(`Beds\n\n${fence(A)}`, second.id)).toBeNull();
  });

  test("media lines by their file, whatever their words; two of one file are twins", () => {
    const text = "Beds\n\n[img::a.png] [size::50%]\n\n[img::a.png]\n\n[img::b.png]";
    const [one, two, other] = picturesIn(text);
    expect([one!.kind, two!.kind, other!.kind]).toEqual(["line", "line", "line"]);
    const moved = `Beds\n\n[img::c.png]\n\n${text.replace("[size::50%]", "[size::full]").slice(6)}`;
    expect(locatePicture(moved, one!.id)!.source).toContain("[size::full]");
    expect(locatePicture(moved, two!.id)!.source).toBe("[img::a.png]");
    expect(locatePicture(moved, other!.id)!.source).toBe("[img::b.png]");
  });

  test("a fence's language and indent don't confuse it: a list item's fence and its twin in a list", () => {
    const text = `Beds\n\n- \`\`\`svg\n  ${A}\n  \`\`\`\n\n${fence(A)}`;
    const pictures = picturesIn(text);
    expect(pictures.map(p => p.line)).toEqual([2, 6]);
    expect(pictures[0]!.id).not.toBe(pictures[1]!.id);
  });
});

describe("which is the header", () => {
  test("the first [layout::hero] line; a later one is an image, said on its line", () => {
    const pictures = picturesIn("Beds\n\n[img::a.png] [layout::hero]\n\n[img::b.png] [layout::hero]");
    expect(pictures.map(p => p.header)).toEqual([true, false]);
    expect(pictures[1]!.spec.problems).toContain("another image is the header already");
  });

  test("two render lines with one drawing: only the one its line says is the header", () => {
    const text = "Beds\nbanner:: [layout::hero]\n\nbanner::";
    const pictures = picturesIn(text, [{ line: 1, svg: A }, { line: 3, svg: A }]);
    expect(pictures.map(p => [p.kind, p.line, p.header])).toEqual([["drawing", 1, true], ["drawing", 3, false]]);
    expect(pictures[0]!.id).not.toBe(pictures[1]!.id);
  });

  test("a media line's header wins over a drawing's, and a drawing that hasn't answered is no picture yet", () => {
    expect(picturesIn("Beds\nbanner:: [layout::hero]\n\n[img::a.png] [layout::hero]", [{ line: 1, svg: A }]).find(p => p.header)!.kind).toBe("line");
    expect(picturesIn("Beds\nbanner:: [layout::hero]")).toEqual([]);
  });
});

describe("how big it draws", () => {
  const big = { width: 2844, height: 1600 };
  test("no words: a drawing its own width, capped at the body, a file half its pixels and at least 24", () => {
    const fence = parsePictureFence("```svg")!;
    expect(imageBox({ width: 720, height: 180 }, fence, 90, cells).cols).toBe(40);
    expect(imageBox(big, fence, 87, cells).cols).toBe(87);
    expect(imageBox({ width: 18, height: 18 }, fence, 87, cells).cols).toBe(1);
    expect(imageBox({ width: 720, height: 180 }, parseMediaLine("[img::a.png]")!, 90, cells).cols).toBe(40);
    expect(imageBox({ width: 18, height: 18 }, parseMediaLine("[img::a.png]")!, 90, cells).cols).toBe(24);
  });

  test("a page reads the same words: its own width capped, a share, cells, all of it", () => {
    const own = svgOwnSize("<svg viewBox='0 0 90 30'/>")!;
    expect(own).toEqual({ width: 90, height: 30 });
    expect(svgOwnSize("<svg width='360' height='90' viewBox='0 0 1 1'/>")).toEqual({ width: 360, height: 90 });
    expect(svgOwnSize("<svg/>")).toBeNull();
    const fence = parsePictureFence("```svg")!;
    expect(pictureWidthCss({ ...fence, own })).toBe("min(100%,90px)");
    expect(pictureWidthCss({ ...parsePictureFence("```svg height=6")!, own })).toBe("min(100%,22.50rem)");
    expect(pictureWidthCss(parsePictureFence("```svg size=50%")!)).toBe("50%");
    expect(pictureWidthCss(parsePictureFence("```svg size=40")!)).toBe("min(100%,40ch)");
    expect(pictureWidthCss(parsePictureFence("```svg size=full")!)).toBe("100%");
    expect(pictureWidthCss(parseMediaLine("[img::a.png]")!)).toBeUndefined();
  });
});

describe("one step, for every kind", () => {
  const room = { ...cells, body: 87 }, px = { width: 2844, height: 1600 };
  const of = (kind: "line" | "fence" | "drawing", spec: Parameters<typeof pictureStep>[0]["spec"], header = false) => ({ kind, spec, header });

  test("a fence at its full fit stops and writes nothing; below it steps; [-] from what's drawn", () => {
    const at24 = parsePictureFence("```svg height=24")!;
    expect(pictureStep(of("fence", at24), 1, { ...room, px, drawn: { cols: 85, rows: 24 } })).toEqual({ stop: expect.stringContaining("as big as it gets") });
    expect(pictureStep(of("fence", parsePictureFence("```svg height=12")!), 1, { ...room, px, drawn: { cols: 43, rows: 12 } })).toEqual({ set: { height: "14" } });
    expect(pictureStep(of("fence", at24), -1, { ...room, px, drawn: { cols: 85, rows: 24 } })).toEqual({ set: { height: "22" } });
    // Written past its fit, it steps down from what's drawn.
    expect(pictureStep(of("fence", parsePictureFence("```svg height=30")!), -1, { ...room, px, drawn: { cols: 87, rows: 24 } })).toEqual({ set: { height: "22" } });
  });

  test("a drawing steps as a fence does, not drawn yet from its pixels", () => {
    const spec = { kind: "img" as const, path: "x.svg", problems: [], drawn: true };
    expect(pictureStep(of("drawing", spec), 1, { ...room, px })).toEqual({ stop: expect.stringContaining("as big as it gets") });
    expect(pictureStep(of("drawing", spec), -1, { ...room, px })).toEqual({ set: { height: "22" } });
    expect(pictureStep(of("drawing", { ...spec, height: 6 }), 1, room)).toEqual({ set: { height: "8" } });
  });

  test("a media line by shares, stopping at the full width and where a share would draw the same", () => {
    const img = (w: string) => parseMediaLine(`[img::a.png] ${w}`)!;
    expect(pictureStep(of("line", img("[size::50%]")), 1, { ...room, px })).toEqual({ set: { size: "66%" } });
    expect(pictureStep(of("line", img("[size::full]")), 1, { ...room, px })).toEqual({ stop: "it's the full width already" });
    expect(pictureStep(of("line", img("[size::25%]")), -1, { ...room, px })).toEqual({ stop: expect.stringContaining("smallest") });
    const tall = { width: 400, height: 4000 }, narrow = { width: 400, height: 800 };
    expect(pictureStep(of("line", img("[size::50%]")), 1, { ...room, px: tall })).toEqual({ stop: expect.stringContaining("as big as it gets") });
    // Down from a share the rows' cap holds, past the ones that draw the same.
    expect(pictureStep(of("line", img("[size::full]")), -1, { ...room, px: narrow })).toEqual({ set: { size: "50%" } });
  });

  test("the header by rows, stopping where the reader's cap is", () => {
    const hero = parseMediaLine("[img::a.png] [layout::hero]")!;
    expect(pictureStep(of("line", hero, true), 1, { ...room, header: { rows: null, most: 30 } })).toEqual({ set: { height: "12" } });
    expect(HERO_ROWS).toBe(10);
    expect(pictureStep(of("line", hero, true), 1, { ...room, header: { rows: 30, most: 30 } })).toEqual({ stop: expect.stringContaining("as big as it gets") });
    expect(pictureStep(of("line", { ...hero, height: 12 }, true), -1, { ...room, header: { rows: 12, most: 30 } })).toEqual({ set: { height: "10" } });
  });
});

describe("writing it", () => {
  test("a render line takes its words like a media line, and loses them", () => {
    expect(rewritePicture("drawing", "banner::", { height: "6" })).toBe("banner:: [height::6]");
    expect(rewritePicture("drawing", "banner:: [layout::hero]", { height: "6" })).toBe("banner:: [layout::hero] [height::6]");
    expect(rewritePicture("drawing", "banner:: [height::6] [layout::hero]", { height: "8" })).toBe("banner:: [height::8] [layout::hero]");
    expect(rewritePicture("drawing", "banner:: [height::6]", { height: null })).toBe("banner::");
  });
  test("a fence and a media line go through the grammar's own rewrite", () => {
    expect(rewritePicture("fence", "```svg", { height: "6" })).toBe("```svg height=6");
    expect(rewritePicture("line", "[img::a.png]", { size: "50%" })).toBe("[img::a.png] [size::50%]");
    expect(rewritePicture("fence", "not a fence", { height: "6" })).toBeNull();
  });
});
