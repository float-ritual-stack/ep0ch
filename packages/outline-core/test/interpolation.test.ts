import { describe, expect, test } from "bun:test";
import { ActionRefused, actionScript, actionSlots } from "../src/action-line";
import { componentAttrs, lineWords, splitWords } from "../src/component-block";
import { blockRecord } from "../src/block-record";
import { scanPropertyLiteralRanges } from "../src/code-ranges";
import { escapeInterpolation, interpolate, interpolateWith, interpolationSpans } from "../src/interpolation";
import { parsePropertyRecords } from "../src/property-parse";
import type { Site } from "../src/site";

const text = "Bean tray [status::sown] [owner::evan]";
const record = blockRecord({
  block: { id: "tray", parentId: null, text, revision: 1, author: "user", createdAt: "2026-10-16T09:00:00Z", updatedAt: "2026-10-16T09:00:00Z" },
  title: "Bean tray", properties: parsePropertyRecords(text), literal: scanPropertyLiteralRanges(text), children: [], tasks: [], links: [], backlinks: [], resources: [],
});
const site: Site = { at: { block: "tray" }, this: record, props: { week: ["41"] }, actor: { id: "t", author: "user" }, match: { text: "sow beans", level: 2, captures: ["!!sow!!", "sow"] } };

describe("the one placeholder grammar", () => {
  test("spans carry the path, the filter, the default and a reference head", () => {
    const spans = interpolationSpans("a {{ this.owner }} b {{ ((9db884d1)).title || none }} c {{PIE-533.status}} d {{this.tasks | status=todo}}");
    expect(spans.map(s => [s.path, s.default, s.filter, s.reference])).toEqual([
      ["this.owner", undefined, undefined, undefined],
      ["((9db884d1)).title", "none", undefined, "((9db884d1))"],
      ["PIE-533.status", undefined, undefined, "PIE-533"],
      ["this.tasks", undefined, "status=todo", undefined],
    ]);
  });

  test("code spans, fences and literal regions stay as written; \\{{ is a literal {{", () => {
    const src = "ok {{this.owner}} `{{this.owner}}` \\{{this.owner}}\n```\n{{this.owner}}\n```\n<!-- literal -->\n{{this.owner}}\n<!-- /literal -->";
    expect(interpolationSpans(src).length).toBe(1);
    expect(interpolateWith(src, site)).toBe("ok evan `{{this.owner}}` {{this.owner}}\n```\n{{this.owner}}\n```\n<!-- literal -->\n{{this.owner}}\n<!-- /literal -->");
    // A producer that owns its fences as templates reads inside them.
    expect(interpolationSpans("```\n{{this.owner}}\n```", { fences: "template" }).length).toBe(1);
    expect(interpolate(escapeInterpolation("a {{b}}"), () => ["x"])).toBe("a {{b}}");
  });

  test("a missing value is the default, else kept or empty as the caller says; a list joins with commas", () => {
    expect(interpolateWith("{{this.nope || none}}|{{this.nope}}|{{props.week}}|{{match.text}}|{{match.level}}|{{match[1]}}|{{this.owner.count}}", site)).toBe("none|{{this.nope}}|41|sow beans|2|sow|1");
    expect(interpolateWith("[{{this.nope}}]", site, {}, { missing: "empty" })).toBe("[]");
    expect(interpolate("{{x}}", () => ["a", "b"])).toBe("a, b");
  });
});

describe("action lines fill a slot per value, after the line is split", () => {
  const run = (source: string, props: Record<string, string>) => actionScript(source, props);
  const callOf = (js: string) => JSON.parse(/act\("[^"]+", (\{.*\})\)/.exec(js)![1]!) as Record<string, string>;

  test("a prop holding another argument or a second action stays one value", () => {
    expect(callOf(run('tile.open kind=query query="{{props.q}}" tile={{ props.where }}', { q: "x tile=other", where: '"; layout.load' }))).toEqual({ kind: "query", query: "x tile=other", tile: '"; layout.load' });
    expect(run("block.mark id={{props.note}}", { note: "a\nlayout.load name=evil" }).split("\n").length).toBe(1);
  });

  test("slots are the props.* names, a default makes one optional, a missing one is refused with its name", () => {
    expect(actionSlots('block.mark id="{{props.note}}" reason={{ props.why || checked }}\nblock.mark id={{props.note}}')).toEqual([{ name: "note" }, { name: "why", default: "checked" }]);
    expect(callOf(run("block.mark id={{props.note}} reason={{props.why || checked}}", { note: "n1" }))).toEqual({ id: "n1", reason: "checked" });
    expect(() => run("block.mark id={{props.note}}", {})).toThrow("give note= to fill {{props.note}}");
    expect(() => run("block.mark id={{this.owner}}", {})).toThrow(ActionRefused);
  });
});

describe("call-site words", () => {
  test("a component's braces and a handler line read quotes as a shell's words do", () => {
    expect(componentAttrs(`query="type=outbox-item" note='a b' path=a\\ b .accent bare pad=1`)).toEqual({
      classes: ["accent"],
      pairs: [{ key: "query", value: "type=outbox-item" }, { key: "note", value: "a b" }, { key: "path", value: "a b" }, { key: "bare", value: "on" }, { key: "pad", value: "1" }],
    });
    expect(componentAttrs("query=\u201ca b\u201d").pairs).toEqual([{ key: "query", value: "a b" }]);
  });

  test("with shell off an apostrophe inside a word is text, and raw keeps what was written", () => {
    const words = splitWords(`Bob's Burgers --days="3 4" --kind='x y'`, false, false).flat();
    expect(words.map(w => w.value)).toEqual(["Bob's", "Burgers", "--days=3 4", "--kind=x y"]);
    expect(words.map(w => w.raw)).toEqual(["Bob's", "Burgers", `--days="3 4"`, "--kind='x y'"]);
    expect(lineWords(`a "b c" d`)).toEqual(["a", "b c", "d"]);
  });
});
