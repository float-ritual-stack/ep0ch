// The named contexts Blockdown is drawn in (PIE-1543, Nov 3 review card 3), run as a table: one made-up body through each
// context, what it must keep (the words, the fence, the figure) and where its links go (the sink the caller gives).
// Pure: no host, no outline.
import { describe, expect, test } from "bun:test";
import type { DocEnv } from "../src/doc";
import { drawVariation } from "../src/library/draw";
import { presentLinks, type LinkTarget } from "../src/refs";
import { visible } from "../src/style";
import { drawIn, drawPage, linkSink, type BlockdownContext } from "../src/surface/blockdown-context";

const BODY = [
  "Seed tray notes",
  "",
  "See [the shed](https://example.test/shed) and [[Potting bench]].",
  "",
  "```ts",
  "const bed = 4;",
  "```",
  "",
  "::graph-keys",
  "---",
  "title: Keys",
  "---",
  "- ctrl+k: power bar",
  "::",
].join("\n");

const env = (): DocEnv => ({ width: 60, cellW: 9, cellH: 18, graphics: false, maxImageRows: 0, unfold: true });
const drawnIn = (context: BlockdownContext) => {
  const drawn: LinkTarget[] = [];
  const doc = drawIn(context, presentLinks(BODY, false, null, BODY, drawn), env(), linkSink(drawn));
  return { text: doc.lines.map(visible).join("\n"), drawn };
};

describe("Blockdown contexts", () => {
  const CONTEXTS: BlockdownContext[] = ["note", "snippet", "preview", "page", "embed", "template", "view", "extension-text"];
  for (const context of CONTEXTS) {
    test(`${context} keeps the words, the fence and the figure, and its links are recorded`, () => {
      const { text, drawn } = drawnIn(context);
      for (const k of ["Seed tray notes", "const bed = 4;", "power bar"]) expect(text).toContain(k);
      expect(drawn.length).toBeGreaterThan(0);
    });
  }

  test("the link sink records a figure's row and any other target, in order", () => {
    const drawn: LinkTarget[] = [];
    const sink = linkSink(drawn);
    expect(sink.link("b1", "row", undefined, undefined, undefined, undefined)).toContain("row");
    expect(sink.tag({ block: "b2", role: "row" }, "t")).toContain("t");
    expect(drawn.map(d => d.block)).toEqual(["b1", "b2"]);
  });

  test("the page context draws a screen's own body, recording links only where the caller gives a sink", () => {
    const body = "Go to [the shed](https://example.test/shed)";
    const drawn: LinkTarget[] = [];
    drawPage(presentLinks(body, false, null, body, drawn), 40, {}, drawn);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawPage(body, 40).lines.map(visible).join("\n")).toContain("shed");
  });

  test("a library example's links are recorded in the sink it is given", () => {
    const drawn: LinkTarget[] = [];
    const lines = drawVariation({ use: "See [[Potting bench]] and [the shed](https://example.test/shed)", values: {} }, 50, null, drawn);
    expect(lines.map(visible).join("\n")).toContain("shed");
    expect(drawn.length).toBeGreaterThan(0);
  });

  test("extension-text drops the note's own hooks: its steps and links stay text", () => {
    const own: DocEnv = { ...env(), task: () => "[TASK]", link: () => "[LINK]" };
    const out = drawIn("extension-text", "- [ ] a step", own).lines.map(visible).join("\n");
    expect(out).toContain("a step");
    expect(out).not.toContain("[TASK]");
  });
});
