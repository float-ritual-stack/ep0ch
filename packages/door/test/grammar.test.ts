// The door finds `[key::value]` tokens with the outliner's own grammar (PIE-490): what is a property in
// Detail is hidden from the door's titles and digests, and what is text there stays text here.
//
// The grammar is outline-core's property-grammar.ts, which the service parses with and the door imports
// to find tokens while it paints. One file, so these tests check the door uses it the way the service does.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { bodyLinesOf, titleLine } from "../src/board";
import { metadataLines } from "../src/props";
import { C, fg, RESET } from "../src/style";
import { checkValue } from "../src/surface/props-panel";
import { colourBody } from "../src/text";
import { outliner } from "./scratch";

// Fictional titles on the edges of the key rule: a key starts with a letter and may hold dots.
const PROBES = [
  "Plan [2nd-pass::yes] beans",
  "Plan [plot.row::3] beans",
  "Plan [empty::] beans",
  "Water the [bed_2::east] rows [kind::herb]",
  "Escaped \\[kind::herb] stays",
  "[type::task] [work-stage::doing]\nThe real title [plot.row::3]",
  // The header line (outline-core's header-line.ts): ` - ` between the chips goes with them.
  "Seed order [type::errand] - [area::garden]",
  "[type::list] - [area::kitchen]\nTea and oats",
  "Shed jobs [type::list] #bikes - [area::shed]",
  "Ask [who::Sam] - about the gate",
];
const strip = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");

describe("paint-time helpers use it", () => {
  test("titles, digests, metadata lines and coloured tokens follow the key and value rules", () => {
    expect(titleLine("Plan [plot.row::3] beans").text).toBe("Plan  beans");
    expect(titleLine("Plan [2nd-pass::yes] beans").text).toBe("Plan [2nd-pass::yes] beans");
    expect(bodyLinesOf("Title\n[bed.2::east]\nBody").map(l => l.text)).toEqual(["[bed.2::east]", "Body"]);
    expect([...metadataLines("Title\n[plot.row::3] [kind::herb]\n[2nd-pass::yes]\nBody", null)]).toEqual([1]);
    expect(strip(colourBody("Beans [plot.row::3] and [2nd-pass::yes]"))).toBe("Beans [plot.row::3] and [2nd-pass::yes]");
    expect(colourBody("Beans [2nd-pass::3]")).toBe(`${fg(C.grey)}Beans [2nd-pass::3]${RESET}`);           // text: not coloured
    expect(colourBody("Beans [plot.row::3]")).toContain(`${fg(C.brown)}plot.row`);                        // a property: its key coloured
  });
});

describe("a value holding links is one value (PIE-663)", () => {
  const ID = "0f3c8a21-5b7d-4e69-8a10-2c4d6e8f0a1b";
  const line = `Plan the plot [related::[[PC-967]], ((${ID}|daytime plan step 6))] [type::task]`;
  test("titles, metadata lines, painting and the editor's check read the whole value", () => {
    expect(titleLine(line).text).toBe("Plan the plot");
    expect([...metadataLines(`Title\n[related::[[PC-967]], ((${ID}|a, b))] [kind::herb]\nBody`, null)]).toEqual([1]);
    const painted = colourBody(`Beans [related::[[PC-967]], [[Shed|the shed]]] tail`);
    expect(strip(painted)).toBe("Beans [related::[[PC-967]], [[Shed|the shed]]] tail");
    expect(painted).toContain(`${fg(C.brown)}related`);
    expect(painted).not.toContain("[[PC-967]]] tail"); // the value is painted inside its brackets, not left as prose
    expect(checkValue({ syntax: "bracket" } as never, "[[PC-967]], [[Shed]]")).toBeNull();
    expect(checkValue({ syntax: "bracket" } as never, "a]b")).toContain("balanced");
  });
});

describe.skipIf(!outliner)("the property grammar is the service's", () => {
  test("titles hide exactly the tokens the service parses as properties", async () => {
    const theirs = await import(join(outliner!, "src/properties.ts"));
    for (const text of PROBES) expect({ text, title: titleLine(text).text }).toEqual({ text, title: (theirs.firstLineWithoutPropertyTokens(text) ?? "").trim() });
  });
});
