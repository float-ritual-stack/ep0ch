// PIE-1298 / PIE-1312: one reader of a ::button line for the editor's live marks and the save's warning.
import { expect, test } from "bun:test";
import { buttonLineLook, buttonMarks } from "../src/button-check";

const ACTIONS: Record<string, string[]> = { "tile.zoom": ["on", "reach", "tile"], "agent.lift": ["reach", "on"] };
const ask = {
  args: (a: string) => ACTIONS[a] ?? null,
  actions: () => Object.keys(ACTIONS),
  tile: async (sel: string) => (sel === "t-a6125371" || sel === "links" ? null : `no tile has the id ${sel}; tile.list shows the ids`),
};
const text = (line: string, from: number, to: number) => [...line].slice(from, to).join("");

test("the parts a line is drawn in: names, =, values, the action and its arguments", () => {
  const line = '::button{label="pop it" act="tile.zoom tile={target} reach=column" target=}';
  const look = buttonLineLook([line], 0, ask)!;
  const of = (is: string) => look.parts.filter(p => p.is === is).map(p => text(line, p.from, p.to));
  expect(of("name")).toEqual(["label", "act", "target"]);
  expect(of("action")).toEqual(["tile.zoom"]);
  expect(of("arg")).toEqual(["tile", "reach"]);
  expect(look.marks).toEqual([]);
  expect(look.runs).toBe("tile.zoom tile={target} reach=column");
  expect(buttonLineLook(["not a button"], 0, ask)).toBeNull();
});

test("what won't run: nested quotes, an unknown action with a did-you-mean, an argument the action doesn't take", () => {
  const nested = '::button{label="zoom" act="tile.zoom reach="column" tile="t-a6125371"}';
  const m = buttonLineLook([nested], 0, ask)!.marks;
  expect(m.every(x => x.kind === "misread")).toBe(true);
  expect(m.map(x => text(nested, x.from, x.to))).toEqual(['column"', 'tile="t-a6125371"']);
  expect(m[0]!.message).toContain("act='tile.zoom reach=column tile=t-a6125371'");
  const typo = '::button{act="tile.zom tile=links"}';
  expect(buttonLineLook([typo], 0, ask)!.marks).toMatchObject([{ kind: "action", message: "no action tile.zom here; did you mean tile.zoom?" }]);
  const stray = '::button{act="tile.zoom colum=1"}';
  const s = buttonLineLook([stray], 0, ask)!.marks;
  expect(s).toMatchObject([{ kind: "arg" }]);
  expect(text(stray, s[0]!.from, s[0]!.to)).toBe("colum");
});

test("a tile= and a filled slot are listed for the resolver; the save says the ones that name nothing", async () => {
  const line = '::button{label="pop it" act="tile.zoom tile={target} reach=column" target=t-0123abcd}';
  const look = buttonLineLook([line], 0, ask)!;
  expect(look.tiles.map(t => [t.sel, text(line, t.from, t.to)])).toEqual([["t-0123abcd", "t-0123abcd"]]);
  const saved = await buttonMarks(`Title\n${line}\n::button{act="tile.zoom tile=links"}`, ask);
  expect(saved).toEqual([{ line: 1, message: "the ::button on line 2: no tile has the id t-0123abcd; tile.list shows the ids" }]);
  // A button with a body is read with it: its steps' tile= and actions are checked too.
  const body = await buttonMarks('Title\n::button{label="Zoom"}\ntile.zoom tile=t-0123abcd\ntile.zom\n::', ask);
  expect(body.map(m => m.message)).toEqual(["the ::button on line 2: no action tile.zom here; did you mean tile.zoom?", "the ::button on line 2: no tile has the id t-0123abcd; tile.list shows the ids"]);
  expect(buttonLineLook(['::button{label="Zoom"}', "tile.zoom tile=links", "::"], 0, ask)!.runs).toBe("tile.zoom tile=links");
  // A list's steps are each read against their own action; a slot filled into a body is asked about once.
  expect(buttonLineLook(['::button{act="[tile.zoom reach=column, agent.lift on=true]"}'], 0, ask)!.marks).toEqual([]);
  expect(buttonLineLook(['::button{act="[tile.zoom reach=column, tile.zom]"}'], 0, ask)!.marks.map(m => m.message)).toEqual(["no action tile.zom here; did you mean tile.zoom?"]);
  expect(await buttonMarks('T\n::button{label="b" target=bad}\ntile.zoom tile={target}\n::', ask)).toHaveLength(1);
});
