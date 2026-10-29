// Note grammar copies folded into outline-core (PIE-1292): each input the hydra hunt found answered differently is run
// through every site that once carried its own copy, so a regex that creeps back into one of them fails here.
import { describe, expect, test } from "bun:test";
import { referencedBlock } from "@ep0ch/outline-core/link-syntax";
import { outputHeader } from "@ep0ch/outline-core/output-region";
import { linkTokenOf, parsePath } from "@ep0ch/outline-core/resolve-path";
import { rulesFromBlocks } from "@ep0ch/outline-core/rules";
import { sameReference } from "@ep0ch/outline-core/tool-args";
import { sentenceCount } from "@ep0ch/outline-core/write-shape";
import { noteTitleLine, firstLineWithoutPropertyTokens } from "@ep0ch/outline-core/property-parse";
import { titleLine } from "../src/board";
import { viewIdOf } from "../src/mcp-query";

// The outliner's and the mod's sites, loaded by path: the door's type check holds its own sources, so these are typed
// here by what the test calls.
const PI = "../../outliner/src/pi-tool-args", ROWS = "../../claude-mod/hooks/tool-rows", MOD_ARGS = "../../claude-mod/hooks/tool-args";
const { bareBlockRef } = await import(PI) as { bareBlockRef(ref: string): string };
const mod = await import(ROWS) as {
  blockIdOfRef(ref: string): string | null;
  targetOf(ref: unknown): { label: string; ref: string } | null;
};
const modArgs = await import(MOD_ARGS) as { sameReference(a: unknown, b: unknown): boolean };
const ECHONET = "../../outliner/extensions/echonet/shapes";
const echonet = await import(ECHONET) as { firstLine(text: string): string };

const ID = "3b8e6c21-5f4a-4d7b-9c02-a1e8d4f7b650";

describe("block-reference unwrapping: one answer, referencedBlock's", () => {
  const cases = [
    { input: `((${ID}|Rough edges (x)))`, id: ID, label: "Rough edges (x)" },
    { input: `((${ID}^intro))`, id: ID, fragment: "intro" },
    { input: ` ((${ID})) `, id: ID },
    { input: ID, id: ID },
  ];

  test.each(cases)("$input names $id at every former site", ({ input, id, label }) => {
    expect(referencedBlock(input)?.blockId).toBe(id);
    expect(bareBlockRef(input)).toBe(id);
    expect(viewIdOf(input)).toBe(id);
    expect(mod.blockIdOfRef(input)).toBe(id);
    if (label) expect(mod.targetOf(input)?.label).toBe(label);
    for (const same of [sameReference, modArgs.sameReference]) expect(same(input, ID)).toBe(true);
    const { rules, problems } = rulesFromBlocks([{ id: "r", properties: [{ key: "rule-name", value: "x" }, { key: "rule-view", value: input }, { key: "rule-decorate", value: "band" }] }]);
    expect(problems).toEqual([]);
    expect(rules[0]?.match.view).toBe(id);
    expect(outputHeader(`> [!output]- weekly [output-of::${input.trim()}] ^out-a`)?.producer).toBe(id);
    if (input.startsWith("((")) {
      expect(linkTokenOf(input)).toEqual({ token: input.trim(), written: true });
      expect(parsePath(`${input.trim()}.title`)?.head).toBe(input.trim());
      expect(sentenceCount(`See ${input.trim()} first. Then go.`)).toBe(2);
    }
  });

  test("a reference into another outline is passed on whole, never read as a block here", () => {
    const other = `((garden:${ID}))`;
    expect(referencedBlock(other)).toEqual({ blockId: ID, outline: "garden" });
    expect(bareBlockRef(other)).toBe(other);
    expect(viewIdOf(other)).toBe(other);
    expect(mod.blockIdOfRef(other)).toBeNull();
    for (const same of [sameReference, modArgs.sameReference]) expect(same(other, ID)).toBe(false);
  });

  test("a short id in a reference is a block for the tools, and no full id for the mod's title lookup", () => {
    expect(bareBlockRef("((dddddddd))")).toBe("dddddddd");
    expect(viewIdOf("((dddddddd))")).toBe("dddddddd");
    expect(mod.blockIdOfRef("((dddddddd))")).toBeNull();
  });

  test("a page link holding another is one link token, as the grammar counts brackets", () => {
    expect(linkTokenOf("[[[[2026-10-06]] - notes]]")).toEqual({ token: "[[[[2026-10-06]] - notes]]", written: true });
  });

  test("the mod reads a labelled page link by the bracket count", () => {
    expect(mod.targetOf("[[PIE-12|the plan]]")?.label).toBe("the plan");
    expect(mod.targetOf("[[[[2026-10-06]] - notes]]")?.label).toBe("2026-10-06 - notes");
  });
});

// The extensions that read a title from raw text (intake, structure) call the same bundled function as EchoNet's
// `firstLine`; their modules read stdin when loaded, so they are held by construction, not imported here.
describe("a note's title: one answer, noteTitleLine's", () => {
  const cases = [
    { text: "status:: draft\nTitle line", title: "Title line", line: 1 },
    { text: "Seed order - [a::1] - [b::2]\nbody", title: "Seed order", line: 0 },
    { text: "Use `[k::v]` here [type::note]", title: "Use `[k::v]` here", line: 0 },
    { text: "[type::note]\nbody", title: "body", line: 1 },
  ];

  test.each(cases)("$text is titled $title everywhere", ({ text, title, line }) => {
    expect(noteTitleLine(text)).toEqual({ line, text: title });
    expect(firstLineWithoutPropertyTokens(text)).toBe(title);
    expect(titleLine(text)).toEqual({ line, text: title });
    expect(echonet.firstLine(text)).toBe(title);
  });
});
