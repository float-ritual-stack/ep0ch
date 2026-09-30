// The door finds `[key::value]` tokens with the outliner's own grammar (PIE-490): what is a property in
// Detail is hidden from the door's titles and digests, and what is text there stays text here.
//
// The grammar is pi-herdr-outliner's src/property-grammar.ts. The door can't call the service on every
// paint, so it keeps that file byte for byte in src/vendor/property-grammar.ts: the service's `ping`
// reports its version (a different one is said at start), and these tests check the copy.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bodyLinesOf, titleLine } from "../src/board";
import { metadataLines } from "../src/props";
import { C, fg, RESET } from "../src/style";
import { colourBody } from "../src/text";
import { PROPERTY_GRAMMAR_VERSION } from "../src/vendor/property-grammar";
import { outliner, Scratch } from "./scratch";

const VENDORED = join(import.meta.dir, "../src/vendor/property-grammar.ts");
/**
 * The copy's checksum. When pi-herdr-outliner changes its grammar: copy its src/property-grammar.ts over
 * src/vendor/property-grammar.ts and put the new checksum here, in the same PR.
 */
const PINNED_SHA256 = "67f6d0fc1ce59cd8cf134baa2d51d6ed8a5b1ad84e64340676abe5464ca4a00f";

// Fictional titles on the edges of the key rule: a key starts with a letter and may hold dots.
const PROBES = [
  "Plan [2nd-pass::yes] beans",
  "Plan [plot.row::3] beans",
  "Plan [empty::] beans",
  "Water the [bed_2::east] rows [kind::herb]",
  "Escaped \\[kind::herb] stays",
  "[type::task] [work-stage::doing]\nThe real title [plot.row::3]",
];
const strip = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");

describe("the vendored grammar", () => {
  test("is the file whose checksum is pinned (an edit to the copy is an edit to the outliner's file first)", () => {
    expect(createHash("sha256").update(readFileSync(VENDORED)).digest("hex")).toBe(PINNED_SHA256);
  });

  test.skipIf(!outliner)("is byte for byte the outliner checkout's src/property-grammar.ts", () => {
    const theirs = join(outliner!, "src/property-grammar.ts");
    expect(readFileSync(VENDORED, "utf8"), `copy ${theirs} over src/vendor/property-grammar.ts and update PINNED_SHA256`).toBe(readFileSync(theirs, "utf8"));
  });
});

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

describe.skipIf(!outliner)("the property grammar is the service's", () => {
  test("titles hide exactly the tokens the service parses as properties", async () => {
    const theirs = await import(join(outliner!, "src/properties.ts"));
    for (const text of PROBES) expect({ text, title: titleLine(text).text }).toEqual({ text, title: (theirs.firstLineWithoutPropertyTokens(text) ?? "").trim() });
  });

  test("a running service reports the version the door copied, and the door says nothing about it", async () => {
    const scratch = new Scratch();
    try {
      const { SocketBoard } = await import("../src/socket");
      const board = new SocketBoard(await scratch.start());
      const info = await board.info();
      board.close();
      if (!board.capabilities?.has("ping.propertyGrammar")) return;   // an older checkout: nothing reported
      expect(info.warning).toBeUndefined();
      const reported = await (async () => { const b = new SocketBoard(scratch.sock); try { return (await b.request("ping")).propertyGrammar; } finally { b.close(); } })();
      expect(reported).toEqual({ version: PROPERTY_GRAMMAR_VERSION });
    } finally { await scratch.dispose(); }
  }, 30_000);
});
