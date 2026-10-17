import { describe, expect, test } from "bun:test";
import { propValueSource, useCallAt, useCallsOf, withUseProps } from "../src/template-use";

describe("the ::use line", () => {
  test("braces: the template is of=, every other word a prop, reserved words kept apart", () => {
    const call = useCallAt(["::use{of=[[meeting-template]] date=2026-10-14 with=\"Jay Smith\" as=new}"], 0)!;
    expect(call.of).toBe("[[meeting-template]]");
    expect(call.props).toEqual([{ key: "date", value: "2026-10-14" }, { key: "with", value: "Jay Smith" }]);
    expect(call.reserved).toEqual([{ key: "as", value: "new" }]);
    expect(call.problem).toBeUndefined();
  });
  test("the template as the argument, and a call that names none", () => {
    expect(useCallAt(["::use [[meeting-template]] date=2026-10-14"], 0)).toMatchObject({ of: "[[meeting-template]]", props: [{ key: "date", value: "2026-10-14" }] });
    expect(useCallAt(["::use{date=2026-10-14}"], 0)).toMatchObject({ of: null, problem: expect.stringContaining("needs the template") });
    expect(useCallAt(["::use"], 0)?.problem).toContain("needs the template");
    expect(useCallAt(["::links{}"], 0)).toBeNull();
  });
  test("a {{ }} inside the braces is one word; calls in a fence are code", () => {
    const call = useCallAt(["::use{of=((abc12345)) status={{parent.status}} x=1}"], 0)!;
    expect(call.props).toEqual([{ key: "status", value: "{{parent.status}}" }, { key: "x", value: "1" }]);
    expect(useCallsOf("a\n::use{of=[[t]]}\n```\n::use{of=[[u]]}\n```\n").map(c => [c.line, c.of])).toEqual([[1, "[[t]]"]]);
  });
  test("a prop value is text, a template of {{ }}, or a bare path headed by a reference", () => {
    expect(propValueSource("active")).toEqual({ kind: "text" });
    expect(propValueSource("{{parent.status}}")).toEqual({ kind: "template" });
    expect(propValueSource("[[evan schultz]].firstName")).toEqual({ kind: "path", path: "[[evan schultz]].firstName" });
    expect(propValueSource("((abc12345)).status")).toEqual({ kind: "path", path: "((abc12345)).status" });
    expect(propValueSource("[[evan schultz]]")).toEqual({ kind: "text" });
    expect(propValueSource("PIE-12")).toEqual({ kind: "text" });
  });
});

describe("adding props to a call", () => {
  test("inside the braces; a word with spaces is quoted; a prop already written is replaced", () => {
    expect(withUseProps("::use{of=[[t]]}", { owner: "ada" })).toBe("::use{of=[[t]] owner=ada}");
    expect(withUseProps("::use{of=[[t]] owner=jay}", { owner: "two words" })).toBe("::use{of=[[t]] owner=\"two words\"}");
    expect(withUseProps("::use{of=[[t]] owner=\"a b\" mood=meh}", { owner: "ada" })).toBe("::use{of=[[t]] mood=meh owner=ada}");
    expect(withUseProps("::use{of=[[t]] n=1}", { n: "{{parent.n}}" })).toBe("::use{of=[[t]] n={{parent.n}}}");
    expect(withUseProps("::use [[t]] mood=meh", { owner: "ada" })).toBe("::use [[t]] mood=meh owner=ada");
    expect(withUseProps("just text", { owner: "ada" })).toBeNull();
    // A value the line can't hold (a brace, a line break) is refused, not written to break the call.
    expect(withUseProps("::use{of=[[t]]}", { owner: "a}b" })).toBeNull();
    expect(withUseProps("::use{of=[[t]]}", { owner: "a\nb" })).toBeNull();
    expect(withUseProps("::use{of=[[t]]}", {})).toBe("::use{of=[[t]]}");
    // The words read back as what was given.
    expect(useCallAt([withUseProps("::use{of=[[t]]}", { owner: "O'Neil \"Jr\"", n: "3" })!], 0)!.props).toEqual([{ key: "owner", value: "O'Neil \"Jr\"" }, { key: "n", value: "3" }]);
  });
});
