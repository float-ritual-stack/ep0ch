// `::button` (PIE-957): both spellings compile to one action line; fences hold none.
import { expect, test } from "bun:test";
import { buttonCallAt, buttonCallsOf } from "../src/button-call";
import { BUILTIN_COMPONENT_SCHEMAS } from "../src/component-schema";

test("act= is the line; of= with slots compiles to the same kind of line; a button naming nothing says what to write", () => {
  expect(buttonCallAt(['::button{label="Review" act="layout.load name=review"}'], 0)).toEqual({ line: 0, label: "Review", act: "layout.load name=review" });
  expect(buttonCallAt(['::button{label="Fantasia" of=fantasia layout=focus motion=fantasia}'], 0)).toEqual({ line: 0, label: "Fantasia", act: 'fantasia layout="focus" motion="fantasia"' });
  expect(buttonCallAt(["::button{of=ttt-move at=5}"], 0)?.label).toBe("ttt-move");
  expect(buttonCallAt(['::button{label="x"}'], 0)?.problem).toContain("needs what it runs");
  expect(buttonCallAt(["::use{of=[[t]]}"], 0)).toBeNull();
});

test("a button inside a code fence is no button, and the schema is registered", () => {
  expect(buttonCallsOf("a\n```\n::button{act=go}\n```\n::button{act=go}")).toHaveLength(1);
  expect(BUILTIN_COMPONENT_SCHEMAS.some(s => s.id === "button")).toBe(true);
});

test("a ::button is one line: no unclosed-component warning; one that runs nothing says so", async () => {
  const { syntaxWarnings } = await import("../src/syntax-warnings");
  expect(syntaxWarnings('::button{label="Go" act="layout.load name=review"}')).toEqual([]);
  expect(syntaxWarnings('::button{label="Go"}').map(w => w.message).join()).toContain("runs nothing");
});
