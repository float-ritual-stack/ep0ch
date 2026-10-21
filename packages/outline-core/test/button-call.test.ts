// `::button` (PIE-957): both spellings compile to one action line; fences hold none.
import { expect, test } from "bun:test";
import { buttonCallAt, buttonCallsOf } from "../src/button-call";
import { BUILTIN_COMPONENT_SCHEMAS } from "../src/component-schema";

test("act= is the line; of= with slots compiles to the same kind of line; a button naming nothing says what to write", () => {
  expect(buttonCallAt(['::button{label="Review" act="layout.load name=review"}'], 0)).toMatchObject({ line: 0, label: "Review", act: "layout.load name=review" });
  expect(buttonCallAt(['::button{label="Fantasia" of=fantasia layout=focus motion=fantasia}'], 0)).toMatchObject({ line: 0, label: "Fantasia", act: 'fantasia layout="focus" motion="fantasia"' });
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

test("alt belongs to the button rather than the script's slots", () => {
  const call = buttonCallAt(['::button{label="Video" of=show-video mode=crt alt="theme.cycle"}'], 0);
  expect(call?.act).toBe('show-video mode="crt"');
  expect(call).toHaveProperty("alt", "theme.cycle");
});


test("a button body and its array sugar preserve the same ordered steps and nested quotes", () => {
  const body = buttonCallAt(['::button{label="Fold"}', "tile.collapse on=true tile='links'", "tile.collapse on=true tile='preview'", '::'], 0)!;
  const sugar = buttonCallAt([`::button{label="Fold" act=["tile.collapse on=true tile='links'", "tile.collapse on=true tile='preview'"]}`], 0)!;
  expect(body.steps).toEqual([
    { kind: "act", source: "tile.collapse on=true tile='links'" },
    { kind: "act", source: "tile.collapse on=true tile='preview'" },
  ]);
  expect(sugar.steps).toEqual(body.steps);
  expect(body.endLine).toBe(3);
  expect(buttonCallAt(['::button{of=[pick, convert, wire]}'], 0)?.steps).toEqual([
    { kind: "script", source: "pick" }, { kind: "script", source: "convert" }, { kind: "script", source: "wire" },
  ]);
});
