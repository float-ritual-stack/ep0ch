// The door finds `[key::value]` tokens with the outliner's own grammar (PIE-490): what is a property in
// Detail is hidden from the door's titles and digests, and what is text there stays text here.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { titleLine } from "../src/board";
import { outliner } from "./scratch";

// Fictional titles on the edges of the key rule: a key starts with a letter and may hold dots.
const PROBES = [
  "Plan [2nd-pass::yes] beans",
  "Plan [plot.row::3] beans",
  "Plan [empty::] beans",
  "Water the [bed_2::east] rows [kind::herb]",
  "Escaped \\[kind::herb] stays",
  "[type::task] [work-stage::doing]\nThe real title [plot.row::3]",
];

describe.skipIf(!outliner)("the property grammar is the service's", () => {
  test("titles hide exactly the tokens the service parses as properties", async () => {
    const theirs = await import(join(outliner!, "src/properties.ts"));
    for (const text of PROBES) expect({ text, title: titleLine(text).text }).toEqual({ text, title: (theirs.firstLineWithoutPropertyTokens(text) ?? "").trim() });
  });
});
