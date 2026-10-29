// `::button` (PIE-957): both spellings compile to one action line; fences hold none.
import { expect, test } from "bun:test";
import { buttonCallAt, buttonCallsOf, slotArgs, withButtonSlot } from "../src/button-call";
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


test("one-line buttons and blank-separated prose never become a button body", () => {
  for (const attrs of ['act="tile.collapse tile=links"', 'of=fold', 'label=Empty']) {
    const call = buttonCallAt([`::button{${attrs}}`, "", "Following prose", "::"], 0)!;
    expect(call.endLine).toBe(0);
    expect(call.sequence).toBe(false);
    expect(call.steps.map(s => s.source)).not.toContain("Following prose");
  }
  for (const attrs of ['act="tile.collapse tile=links"', 'of=fold']) {
    expect(buttonCallAt([`::button{${attrs}}`, "Following prose", "::"], 0)?.endLine).toBe(0);
  }
});

test("slots repeat into lists, and a slot named like an Object method (constructor=, toString=) is a key like page=", () => {
  expect(buttonCallAt(["::button{of=neat page=[[a]] page=[[b]]}"], 0)?.props).toEqual({ page: ["[[a]]", "[[b]]"] });
  const odd = buttonCallAt(["::button{of=probe constructor=x toString=y __proto__=z}"], 0);
  expect(odd?.problem).toBeUndefined();
  expect(odd?.props?.["constructor"] as unknown).toEqual(["x"]);
  expect(odd?.props?.["toString"] as unknown).toEqual(["y"]);
  expect(({} as Record<string, unknown>).z).toBeUndefined();
});

// PIE-1298: a slot is a `{word}` in act= (or in an of= script's values) that the line itself fills.
test("a {slot} in act= is filled from the line's own word; an empty one is listed and left in the line", () => {
  const empty = buttonCallAt(['::button{label="pop it" act="tile.zoom tile={target} reach=column" target=}'], 0)!;
  expect(empty).toMatchObject({ label: "pop it", empty: ["target"], slots: [{ key: "target", value: "" }], act: "tile.zoom tile={target} reach=column" });
  expect(empty.problem).toBeUndefined();
  const full = buttonCallAt(['::button{label="pop it" act="tile.zoom tile={target} reach=column" target=drawer.agent}'], 0)!;
  expect(full).toMatchObject({ empty: [], slots: [{ key: "target", value: "drawer.agent" }], act: "tile.zoom tile=drawer.agent reach=column" });
  // The exact tile and a role with a slash are one word; a value with spaces is quoted so it stays one argument.
  expect(buttonCallAt(['::button{act="tile.zoom tile={t}" t=@library/reader}'], 0)!.act).toBe("tile.zoom tile=@library/reader");
  expect(buttonCallAt(['::button{act="note.open id={n}" n="two words"}'], 0)!.act).toBe('note.open id="two words"');
  // Every step of a sequence reads the same slot.
  expect(buttonCallAt(['::button{label="two" act=["tile.zoom tile={t}", "tile.focus tile={t}"] t=reader}'], 0)!.steps.map(s => s.source)).toEqual(["tile.zoom tile=reader", "tile.focus tile=reader"]);
});

test("which argument of which action a slot fills (slotArgs): what the picker reads the kind from", () => {
  const call = buttonCallAt(['::button{act="layout.swap to={other} tile={target}" other= target=}'], 0)!;
  expect(call.empty).toEqual(["other", "target"]);
  expect(slotArgs(call, "target")).toEqual([{ step: 0, action: "layout.swap", arg: "tile" }]);
  expect(slotArgs(call, "other")).toEqual([{ step: 0, action: "layout.swap", arg: "to" }]);
});

test("of= scripts: {slot} values fill from the line, the slots are not forwarded to the script", () => {
  const call = buttonCallAt(['::button{label="two up" of="neat" page={page1} page={page2} page1= page2=[[b]]}'], 0)!;
  expect(call.empty).toEqual(["page1"]);
  expect(call.slots).toEqual([{ key: "page1", value: "" }, { key: "page2", value: "[[b]]" }]);
  expect(call.props).toEqual({ page: ["{page1}", "[[b]]"] });
  const filled = buttonCallAt(['::button{of="neat" page={page1} page={page2} page1=[[a]] page2=[[b]]}'], 0)!;
  expect(filled.empty).toEqual([]);
  expect(filled.props).toEqual({ page: ["[[a]]", "[[b]]"] });
});

// The validate sweep's repro (Oct 28): both slots empty asked page2 first, and slotArgs found no argument for a script step.
test("of= scripts: empty slots are asked in the order written, each read by the script's own slot", () => {
  const call = buttonCallAt(['::button{label="two up" of="neat" page={page1} page={page2} page1= page2=}'], 0)!;
  expect(call.empty).toEqual(["page1", "page2"]);
  expect(slotArgs(call, "page1")).toEqual([{ step: 0, action: "neat", arg: "page", script: true }]);
  expect(slotArgs(call, "page2")).toEqual([{ step: 0, action: "neat", arg: "page", script: true }]);
  // Each script of a list reads it by its own name.
  expect(slotArgs(buttonCallAt(["::button{of=[neat,other] page={p} p=}"], 0)!, "p").map(u => u.action)).toEqual(["neat", "other"]);
  // A body's ((script)) step reads its slot through the slot of that name.
  const body = buttonCallAt(['::button{label="f" t=}', "((fold tile={t}))", "::"], 0)!;
  expect(slotArgs(body, "t")).toEqual([{ step: 0, action: "fold", arg: "tile", script: true }]);
});

test("a script's slot value is the value itself, spaces and all; an action line quotes it once", () => {
  const call = buttonCallAt(['::button{of=say message={text} text="hello world"}'], 0)!;
  expect(call.props).toEqual({ message: ["hello world"] });
  expect(call.steps[0]!.source).toBe('say message="hello world"');
});

test("a slot inside a quoted value goes in as text; a bare slot word is the slot withButtonSlot writes; alt= and of= slots need their word", () => {
  expect(buttonCallAt([`::button{act='note.comment text="it is {who}"' who="a b"}`], 0)!.act).toBe('note.comment text="it is a b"');
  expect(withButtonSlot('::button{act="tile.zoom tile={t}" t}', "t", "t-1234abcd")).toBe('::button{act="tile.zoom tile={t}" t=t-1234abcd}');
  expect(buttonCallAt(['::button{act="tile.zoom" alt="tile.close tile={u}"}'], 0)!.problem).toContain("u=");
  expect(buttonCallAt(["::button{of=myscript path={dir}}"], 0)!.problem).toContain("dir=");
});

test("withButtonSlot writes one slot onto the line and leaves the rest as written", () => {
  const line = '::button{label="pop it" act="tile.zoom tile={target} reach=column" target=} ^pop';
  expect(withButtonSlot(line, "target", "drawer.agent")).toBe('::button{label="pop it" act="tile.zoom tile={target} reach=column" target=drawer.agent} ^pop');
  expect(withButtonSlot('::button{act="go {t}" t=old extra=1}', "t", "two words")).toBe('::button{act="go {t}" t="two words" extra=1}');
  // A key inside act="…" is not the slot.
  expect(withButtonSlot('::button{act="go t=1 {t}" t=}', "t", "x")).toBe('::button{act="go t=1 {t}" t=x}');
  expect(withButtonSlot('::button{act="go {t}"}', "t", "x")).toBe('::button{act="go {t}" t=x}');
  expect(withButtonSlot("not a button", "t", "x")).toBeNull();
  expect(withButtonSlot('::button{act="go {t}"}', "t", "a\nb")).toBeNull();
});

test("withButtonSlot writes a backslash so it reads back, and refuses a value that would end the braces", () => {
  for (const value of ["C:\\dir\\", "a\\\\b", "it's C:\\x"]) {
    const line = withButtonSlot('::button{act="go {t}" t=}', "t", value)!;
    expect(buttonCallAt([line], 0)!.slots).toEqual([{ key: "t", value }]);
  }
  expect(withButtonSlot('::button{act="go {t}" t=}', "t", "a } b")).toBeNull();
  expect(withButtonSlot('::button{act="go {t}" t=}', "t", "a { b")).toBeNull();
});

test("a button that misreads says what it read and the corrected line, and runs nothing", () => {
  // Evan, Oct 25: nested double quotes ended act= at reach=, and tile= ran on the focused tile.
  const nested = buttonCallAt(['::button{label="zoom" act="tile.zoom reach="column" tile="t-a6125371"}'], 0)!;
  expect(nested.act).toBeNull();
  expect(nested.problem).toContain("act= ends early");
  expect(nested.problem).toContain(`label="zoom" act='tile.zoom reach=column tile=t-a6125371'`);
  // A stray word, and an attribute the button doesn't read.
  expect(buttonCallAt(['::button{label="x" act="tile.zoom" column}'], 0)!.problem).toContain("column");
  expect(buttonCallAt(['::button{label="x" act="tile.zoom" tile=reader}'], 0)!.problem).toContain(`act="tile.zoom tile=reader"`);
  // A {slot} with no word of its own on the line names the one to add.
  expect(buttonCallAt(['::button{label="x" act="tile.zoom tile={target}"}'], 0)!.problem).toContain("target=");
  // The honest forms stay buttons: alt=, label=, quotes inside the other kind, a filled and an empty slot.
  for (const ok of ['::button{label="x" act="tile.zoom" alt="theme.cycle"}', `::button{act='tile.collapse on=true tile="links"'}`, `::button{act="edit.button line='a b'"}`, '::button{act="go {t}" t=}'])
    expect(buttonCallAt([ok], 0)!.problem).toBeUndefined();
});

test("syntaxWarnings carries a misread button's reason", async () => {
  const { syntaxWarnings } = await import("../src/syntax-warnings");
  expect(syntaxWarnings('::button{label="zoom" act="tile.zoom reach="column" tile="t-a6125371"}').map(w => w.message).join()).toContain("act= ends early");
  expect(syntaxWarnings('::button{label="pop" act="tile.zoom tile={target}" target=}')).toEqual([]);
});

test("a button's look words are its own, and one it can't read is said while the button still runs (PIE-1287)", async () => {
  const b = buttonCallsOf('::button{label="Ship" glyph="▶✦" tone=primary frame=round fill=on act="status.log"}')[0]!;
  expect(b.look).toEqual({ glyph: "▶", tone: "primary", frame: "round", fill: true });
  expect(b.problem).toBeUndefined();
  const bad = buttonCallsOf('::button{label="Go" tone=red act="status.log"}')[0]!;
  expect(bad.act).toBe("status.log");
  expect(bad.problem).toBeUndefined();
  expect(bad.lookProblem).toContain("tone=red");
  const seq = buttonCallsOf('::button{label="Fold" frame=rounded}\ntile.collapse on=true tile=links\n::')[0]!;
  expect(seq.problem).toBeUndefined();
  const { syntaxWarnings } = await import("../src/syntax-warnings");
  expect(syntaxWarnings('::button{label="Go" frame=rounded act="status.log"}').map(w => w.message).join()).toContain("runs but is drawn plain: the button doesn't read frame=rounded");
});
