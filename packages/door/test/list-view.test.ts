// The door's one ListView (PIE-747): each actor's own pick and filter, the person's typed filter, the rows an agent's
// say-so line leaves in a tile, and a `list` view drawn without a reader. Made-up rows; no service, no App.
import { describe, expect, test } from "bun:test";
import { primitiveLines } from "../src/components";
import { ListView, listRowLines, listRowsOf, PERSON, type ListViewRow } from "../src/surface/list-view";
import { visible as plain } from "../src/style";

const rows = (): ListViewRow[] => [
  { id: "g", label: "Sow now", mark: "▾", group: "sow", pick: false },
  { id: "pea", label: "Pea trellis", detail: "next", group: "sow", do: { open: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34" } },
  { id: "bean", label: "Bean poles", group: "sow", do: { copy: "poles" } },
  { id: "h", label: "Later", mark: "▾", group: "later", pick: false },
  { id: "spade", label: "Spade", detail: "shed", group: "later", do: { run: { action: "note.copy" } } },
];

describe("ListView", () => {
  test("an agent's pick and filter are its own: the person's selection and rows stay, and the agent's rows narrow for it", () => {
    const v = new ListView("^orders", false);
    v.set(rows());
    // The person's selection starts on the first row that can be picked; a header never is.
    expect(v.picked()?.id).toBe("pea");
    v.pick("rhea", "spade");
    v.setFilter("rhea", "bean");
    expect(v.picked()?.id).toBe("pea");
    expect(v.picked("rhea")).toBeNull();      // its pick is on a row its own filter leaves out
    expect(v.visible().length).toBe(5);       // the host narrows the person's rows (narrows=false)
    expect(v.visible("rhea").map(r => r.id)).toEqual(["g", "bean"]);
    expect(v.pickable("rhea").map(r => r.id)).toEqual(["bean"]);
    expect(v.others()).toEqual([{ who: "rhea", row: null, filter: "bean" }]);
    // list.blocks numbers what can be picked, and says who else has picked what.
    v.setFilter("rhea", "");
    expect(v.describe(PERSON).map(r => [r.n, r.id, r.selected ?? false, r.pickedBy ?? []])).toEqual([[1, "pea", true, []], [2, "bean", false, []], [3, "spade", false, ["rhea"]]]);
    // Stepping skips headers and stops at the ends.
    expect(v.step(PERSON, 1)?.id).toBe("bean");
    expect(v.step(PERSON, 1)?.id).toBe("spade");
    expect(v.step(PERSON, 1)).toBeNull();
    expect(() => v.pick(PERSON, "g")).toThrow("header");
  });

  test("a view that narrows its own rows keeps a header while a row of its group matches; ⏎ keeps what was typed, esc goes back", () => {
    const v = new ListView("#1");
    v.set(rows());
    v.startTyping();
    for (const k of "spad") v.typing!.key({ kind: "char", ch: k });
    expect(v.visible().map(r => r.id)).toEqual(["h", "spade"]);
    v.stopTyping(true);
    expect(v.filter()).toBe("spad");
    v.startTyping();
    for (const k of " zzqq") v.typing!.key({ kind: "char", ch: k });
    expect(v.visible()).toHaveLength(0);
    v.stopTyping(false);
    expect(v.filter()).toBe("spad");
  });

  test("it draws the person's selection lit, the filter line, and an agent's say-so line inside the room a tile gives it", () => {
    const v = new ListView("links", false);
    v.set(rows());
    v.pick("rhea", "bean");
    const drawn = v.draw({ cols: 40, focused: true, selection: true, room: 4, filterLine: false });
    const text = drawn.lines.map(plain);
    expect(drawn.lines).toHaveLength(4);                       // the say-so line took one of the four
    expect(text.at(-1)).toContain("rhea: ◆ Bean poles");
    expect(drawn.rowAt.at(-1)).toBeNull();
    expect(drawn.rowAt.slice(0, 3)).toEqual([0, 1, 2]);
    expect(text[1]).toContain("Pea trellis");
    v.setFilter(PERSON, "pea");
    const kept = v.draw({ cols: 40, focused: false, selection: false }).lines.map(plain);
    expect(kept[0]).toBe("/ pea".padEnd(40));
  });

  test("a list view the reader doesn't draw is its rows as text, a section's header over them; a view with none says so", () => {
    const view = { type: "list", groups: [{ name: "sow", label: "Sow now", count: 1 }], rows: [{ id: "pea", label: "Pea trellis", detail: "next", group: "sow", do: { open: "x" } }, { id: "tip", label: "Dig first" }] };
    expect(primitiveLines(view, 40).map(plain).map(l => l.trimEnd())).toEqual(["■ Dig first", "▾ Sow now (1)", "  · Pea trellis · next"]);
    expect(primitiveLines({ type: "list", rows: [], empty: "no seeds yet" }, 40).map(plain)).toEqual(["no seeds yet"]);
    expect(listRowsOf(view as never).map(r => r.id)).toEqual(["tip", "§group:sow", "pea"]);
    expect(listRowLines({ id: "a", label: "A long label that wraps over the width of a narrow tile", detail: "and more", mark: "→" }, { cols: 20, lines: 2 }).length).toBe(2);
  });
});
