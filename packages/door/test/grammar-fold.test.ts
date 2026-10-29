// Note grammar copies folded into outline-core (PIE-1292): each input the hydra hunt found answered differently is run
// through every site that once carried its own copy, so a regex that creeps back into one of them fails here.
import { describe, expect, test } from "bun:test";
import { referencedBlock } from "@ep0ch/outline-core/link-syntax";
import { outputHeader } from "@ep0ch/outline-core/output-region";
import { age, ageSince } from "@ep0ch/outline-core/age";
import { codeFenceLines } from "@ep0ch/outline-core/code-fence";
import { linkTokenOf, parsePath } from "@ep0ch/outline-core/resolve-path";
import { rulesFromBlocks } from "@ep0ch/outline-core/rules";
import { sameReference } from "@ep0ch/outline-core/tool-args";
import { sentenceCount } from "@ep0ch/outline-core/write-shape";
import { noteTitleLine, firstLineWithoutPropertyTokens } from "@ep0ch/outline-core/property-parse";
import { titleLine } from "../src/board";
import { age as backupAge } from "../src/backup/alert";
import { viewIdOf } from "../src/mcp-query";
import { readerLine } from "../src/share-cli";
import { ago } from "../src/text";

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
const TIDY = "../../outliner/extensions/tidy/tidy-line", LISTS = "../../outliner/extensions/structure/lists", FRAGMENTS = "../../outliner/src/fragments";
const tidy = await import(TIDY) as { tidyPassage(lines: string[]): { replacement: string } };
const lists = await import(LISTS) as { ownLines(item: { lines: string[]; marker: string }): string[] };
const fragments = await import(FRAGMENTS) as { codeLineSet(text: string): Set<number> };
const DEVICES = "../../outliner/src/device-cli", WEB = "../../outliner/src/web-cli";
const devices = await import(DEVICES) as { deviceLine(device: Record<string, string>, now: number): string };
const web = await import(WEB) as { webSessionLine(session: Record<string, string>, now: number): string };
const rows = mod as unknown as { capped(markdown: string): string };

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

// structure.ts's anchors and tidy.ts's list start read the same bundled `codeFenceLines`; their modules read stdin.
describe("fenced code: one answer, codeBlocks'", () => {
  test("a `js` line inside a fence is code, not a closing fence: tidy leaves the code's trailing blanks", () => {
    const lines = ["```", "a", "```js", "b   ", "```", "c  "];
    expect(codeFenceLines(lines)).toEqual([0, 0, 0, 0, 0, -1]);
    expect(tidy.tidyPassage(lines).replacement.split("\n")).toEqual(["```", "a", "```js", "b   ", "```", "c"]);
  });

  test("four spaces before a fence is indented code, never a fence that swallows what follows", () => {
    const lines = ["text", "", "    ```", "after  "];
    expect(codeFenceLines(lines)).toEqual([-1, -1, -1, -1]);
    expect(tidy.tidyPassage(lines).replacement.split("\n").at(-1)).toBe("after");
  });

  test("a fence in a list item is code at every site", () => {
    const text = "- item\n  ```\n  # not a heading ^not-an-anchor\n  ```\n- next";
    expect(codeFenceLines(text.split("\n"))).toEqual([-1, 1, 1, 1, -1]);
    expect(fragments.codeLineSet(text).has(2)).toBe(true);
    expect(lists.ownLines({ lines: ["- item", "  ```", "  - inside code", "  ```", "  after"], marker: "-" })).toEqual(["- item", "  after"]);
  });

  test("the mod closes only a fence the cut leaves open", () => {
    const open = ["```ts", ...Array.from({ length: 60 }, (_, i) => `line ${i}`)].join("\n");
    expect(rows.capped(open).split("\n").slice(-3)[0]).toBe("```");
    const closed = ["```", "x", "```", ...Array.from({ length: 60 }, (_, i) => `prose ${i}`)].join("\n");
    expect(rows.capped(closed).split("\n").slice(-3)[0]).toMatch(/^prose/);
  });
});

// mcp-live, backup/setup, the projection's and Detail's fetched age, echo-health and the publisher's sessions page call
// `age`/`ageSince` inline with their style; the sites below are the ones with an exported line to read.
describe("how old something is: one unit and rounding, age's", () => {
  const now = Date.parse("2026-10-06T12:00:00.000Z");
  const cases = [
    { ms: 29_000, short: "29s", words: "29 s", ago: "29 s ago" },
    { ms: 100 * 60_000, short: "2h", words: "2 h", ago: "2 h ago" },
    { ms: 47.5 * 3_600_000, short: "2d", words: "2 days", ago: "2 days ago" },
  ];

  test.each(cases)("$ms ms is $short at every site", ({ ms, short, words, ago: said }) => {
    expect([age(ms), age(ms, "words"), age(ms, "ago")]).toEqual([short, words, said]);
    const at = new Date(now - ms).toISOString();
    expect(ago(now - ms, now)).toBe(short);
    expect(backupAge(ms)).toBe(short);
    expect(readerLine({ reader: "tailnet", title: "Beds", url: "https://example.test/b", at } as never, now)).toContain(` · ${said}`);
    expect(devices.deviceLine({ id: "d1", name: "phone", outline: "garden", createdAt: at, lastUsedAt: at }, now)).toContain(`last sent ${said}`);
    expect(web.webSessionLine({ id: "w1", subject: "u", device: "Firefox", createdAt: at, lastSeenAt: at, expiresAt: at }, now)).toContain(`last seen ${said}`);
  });

  test("a moment a few seconds back is just now; a time that isn't one is no age", () => {
    expect(age(4_000, "ago")).toBe("just now");
    expect(ageSince("not a date", now, "ago")).toBe("");
  });
});
