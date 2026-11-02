// PIE-1521: the row containers the reader's walk asks (row-container.ts), the inline list's rows and viewport, and the
// list keys, on a drawn layout made by hand: no service, no App. Made-up rows.
import { describe, expect, test } from "bun:test";
import { InlineList, inlineRowKey } from "../src/surface/inline-list";
import { ListView, PERSON, type ListHandle } from "../src/surface/list-view";
import { listBinding } from "../src/surface/list-keys";
import { collectionAtCursor, loneCollection, rowContainerAt, rowContainerOn, type RowElement, type RowWorld } from "../src/surface/row-container";
import { LINK_END, linkTag } from "../src/style";
import type { LinkTarget } from "../src/refs";

type E = RowElement & { key: string };
/**
 * A note as drawn: line 1 holds a live figure (a control and three inline rows), line 3 a ::links list (two inline
 * rows), line 5 a collection (three rows), line 6 an embed's line. Each element's `row` is its note line.
 */
function drawn(opts: { lone?: boolean } = {}) {
  const inline = new Map<number, InlineList>();
  const fake = (labels: string[]) => Object.assign(new InlineList(), { rows: labels.map((label, i) => ({ target: { role: "row", label } as LinkTarget, label, first: i, last: i, from: 0 })) });
  inline.set(0, fake(["Crate 1", "Crate 2", "Crate 3"]));
  inline.set(1, fake(["Letter 1", "Letter 2"]));
  const seeds = new ListView("^seeds");
  seeds.set(["Seed 1", "Seed 2", "Seed 3"].map(label => ({ id: label, label, do: { open: label } })));
  const list: ListHandle<any> = { n: 1, key: "^seeds", title: "Seeds", view: seeds, entered: false, collection: {} as any };
  const line = (n: number) => opts.lone ? -1 : n;
  const elems: E[] = [
    { key: "tab", kind: "figure", row: 1, link: { figure: { figure: "f1" } } },
    { key: "crate", kind: "row", row: 1, link: { figure: { figure: "f1" }, inlineList: { key: 0, row: 0 } } },
    { key: "letter", kind: "row", row: 3, link: { listRow: { key: "#1", row: "a" }, inlineList: { key: 1, row: 0 } } },
    ...["Seed 1", "Seed 2", "Seed 3"].map(id => ({ key: id, kind: "row", row: line(5), link: { listRow: { key: "^seeds", row: id } } })),
  ];
  let cursor: E | undefined;
  const at: string[] = [];
  const world = (): RowWorld<E> => ({
    elems, inline, lists: [list], cursor, wanted: null,
    lineOf: e => e.row < 0 ? undefined : e.row,
    text: n => ["Row walk", "::graph-table", "", "::links", "", "::view{of=((seeds))}", "!((seeds))"][n] ?? "",
    pick: (l, row) => { l.view.pick(PERSON, row.id, row.group); cursor = elems.find(e => e.link?.listRow?.row === row.id); at.push(row.label); },
    selectInline: (place, row) => { const r = inline.get(place.link!.inlineList!.key)!.rows[row]!; cursor = { ...place, key: r.label, link: { ...place.link, inlineList: { key: place.link!.inlineList!.key, row } } }; at.push(r.label); },
  });
  return { world, at, set: (key: string) => { cursor = elems.find(e => e.key === key); }, clear: () => { cursor = undefined; }, seeds };
}

describe("row containers", () => {
  test("each kind steps within its rows and says the edge, the same three answers", () => {
    const d = drawn();
    // A figure's rows, from its control (the tab): in at the first row, step, then the edge.
    d.set("tab");
    expect(rowContainerAt(d.world())!.step(1)).toBe("moved");
    expect(rowContainerAt(d.world())!.step(1)).toBe("moved");
    expect(rowContainerAt(d.world())!.step(1)).toBe("moved");
    expect(rowContainerAt(d.world())!.step(1)).toBe("edge");
    expect(rowContainerAt(d.world())!.step(-1)).toBe("moved");
    // A ::links list's inline rows.
    d.set("letter");
    expect(rowContainerAt(d.world())!.step(-1)).toBe("edge");
    expect(rowContainerAt(d.world())!.step(1)).toBe("moved");
    expect(rowContainerAt(d.world())!.step(1)).toBe("edge");
    // A collection: its view steps and the pick lands as a click's does.
    d.set("Seed 1"); d.seeds.pick(PERSON, "Seed 1");
    expect(rowContainerAt(d.world())!.step(1)).toBe("moved");
    expect(d.seeds.picked(PERSON)?.id).toBe("Seed 2");
    d.set("Seed 3"); d.seeds.pick(PERSON, "Seed 3");
    expect(rowContainerAt(d.world())!.step(1)).toBe("edge");
    expect(d.at).toEqual(["Crate 1", "Crate 2", "Crate 3", "Crate 2", "Letter 2", "Seed 2"]);
  });

  test("a walk lands on the first row going down, the last going up, whatever the kind", () => {
    const d = drawn();
    for (const [line, by] of [[1, 1], [1, -1], [3, 1], [3, -1], [5, 1], [5, -1]] as const) rowContainerOn(d.world(), line, by)!.land(by > 0 ? "first" : "last");
    expect(d.at).toEqual(["Crate 1", "Crate 3", "Letter 1", "Letter 2", "Seed 1", "Seed 3"]);
    expect(rowContainerOn(d.world(), 2, 1)).toBeNull();
  });

  test("a block's own text above the rows is a stop; a component's or an embed's line is not", () => {
    const d = drawn();
    expect(rowContainerOn(d.world(), 5, 1)!.lead).toBe(false);
    expect(rowContainerOn(d.world(), 1, 1)!.lead).toBe(false);
    // A collection no line names (a saved view opened as its own note): the note is its block, its subject the stop.
    const lone = drawn({ lone: true });
    lone.set("Seed 1");
    expect(rowContainerAt(lone.world())!.lead).toBe(true);
    expect(collectionAtCursor(lone.world())?.key).toBe("^seeds");
    lone.clear(); lone.seeds.pick(PERSON, "Seed 2");
    expect(loneCollection(lone.world())!.land("first")).toBe(true);
    expect(lone.at).toEqual(["Seed 2"]);
    expect(loneCollection(drawn().world())).toBeNull();
  });

  test("an extension's list view (rows that are no inline list): from its control into its rows, then its view steps them", () => {
    const d = drawn(), w = d.world();
    const tools = new ListView("#2");
    tools.set(["Spade", "Fork"].map(label => ({ id: label, label, do: { copy: label } })));
    const list: ListHandle<any> = { n: 2, key: "#2", title: "list 2", view: tools, entered: false };
    const elems = [...w.elems, { key: "in", kind: "control", row: 7, link: { listRow: { key: "#2" } } }, ...["Spade", "Fork"].map(id => ({ key: id, kind: "row", row: 7, link: { listRow: { key: "#2", row: id } } }))];
    let cursor = elems.find(e => e.key === "in");
    const picked: string[] = [];
    const world = () => ({ ...w, elems, lists: [...w.lists, list], cursor, pick: (l: ListHandle<any>, row: { id: string; label: string; group?: string }) => { l.view.pick(PERSON, row.id, row.group); cursor = elems.find(e => e.key === row.id); picked.push(row.label); } });
    expect(rowContainerAt(world())!.step(1)).toBe("moved");
    expect(rowContainerAt(world())!.step(1)).toBe("moved");
    expect(rowContainerAt(world())!.step(1)).toBe("edge");
    expect(picked).toEqual(["Spade", "Fork"]);
  });

  test("off every container there is none; a figure drawing no rows keeps its control", () => {
    const d = drawn();
    expect(rowContainerAt(d.world())).toBeNull();
    const empty = drawn();
    const w = empty.world();
    const world = { ...w, elems: w.elems.filter(e => e.key !== "crate"), cursor: w.elems.find(e => e.key === "tab") };
    expect(rowContainerAt(world)!.step(1)).toBe("held");
  });
});

describe("InlineList", () => {
  const target = (label: string): LinkTarget => ({ role: "row", label, block: label });
  test("its rows are the row links drawn, each told its place; a tall list shows a window with a thumb", () => {
    const targets = [target("Parcel 1"), { label: "not a row" } as LinkTarget, ...Array.from({ length: 13 }, (_, i) => target(`Parcel ${i + 2}`))];
    const lines = ["Parcels", `${linkTag(0)}Parcel 1${LINK_END}  ${linkTag(1)}see${LINK_END}`, ...Array.from({ length: 13 }, (_, i) => `${linkTag(i + 2)}Parcel ${i + 2}${LINK_END}`), "footer"];
    const list = new InlineList();
    const out = list.draw(4, lines, 30, targets, null);
    expect(list.rows.map(r => r.label)).toEqual(Array.from({ length: 14 }, (_, i) => `Parcel ${i + 1}`));
    expect(targets[0]!.inlineList).toEqual({ key: 4, row: 0 });
    expect(targets[1]!.inlineList).toBeUndefined();
    // Ten of its fourteen rows, the header and footer around them, a scroll thumb on the right.
    expect(out.length).toBe(12);
    expect(out[0]).toBe("Parcels");
    expect(out.at(-1)).toBe("footer");
    // The selected row is brought into the window.
    list.draw(4, lines, 30, targets, inlineRowKey(4, targets[14]!));
    expect(list.view.top).toBeGreaterThan(0);
  });
  test("no rows: the lines as they were", () => {
    expect(new InlineList().draw(0, ["just text"], 20, [], null)).toEqual(["just text"]);
  });
});

describe("listBinding", () => {
  const ch = (c: string) => ({ kind: "char" as const, ch: c });
  test("j k step a list; a collection adds its column and group keys; End picks the last row", () => {
    expect(listBinding(ch("j"), false, 5)).toMatchObject({ action: "list.step", args: { by: 1 } });
    expect(listBinding({ kind: "up" }, false, 5)).toMatchObject({ action: "list.step", args: { by: -1 } });
    expect(listBinding(ch("h"), false, 5)).toBeUndefined();
    expect(listBinding(ch("h"), true, 5)).toMatchObject({ action: "list.step", args: { by: -1, axis: "column" } });
    expect(listBinding({ kind: "end" }, false, 7)).toMatchObject({ action: "list.pick", args: { n: 7 } });
    expect(listBinding({ kind: "home" }, false, 7)).toMatchObject({ action: "list.pick", args: { n: 1 } });
    expect(listBinding(ch("x"), true, 7)).toBeUndefined();
  });
});
