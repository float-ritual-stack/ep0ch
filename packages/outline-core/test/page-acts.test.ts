// A page's presses, said once: every row, text, card and table row that opens a note or runs something carries the act
// line it runs (`act`), written by the one rule (list-row's `actOf`). A client that parses no activation (the native
// window) reads `act` alone, so a row on a page and the same row in a list tile run the same line.
import { expect, test } from "bun:test";
import { actRequestOf, lineWords } from "../src/action-line";
import { actOf } from "../src/list-row";
import { withActs, type PagePart } from "../src/note-page";

test("every press in a part is said as the act line it runs, and nothing else changes", () => {
  const part: PagePart = { type: "part", kind: "view", block: "plan", span: { start: 0, end: 0 }, line: 2, view: { type: "stack", children: [
    { type: "list", rows: [
      { id: "north-bed", label: "North bed", do: { open: "north-bed" }, cells: ["sown", { text: "the shed", link: "shed" }] },
      { id: "sow", label: "Sow the peas", do: { run: { action: "note.new", args: { text: "Peas, a row\\of them" } } } },
      { id: "copy", label: "Copy the seed order", do: { copy: "12 packets" } },
      { id: "head", label: "Later" },
    ] },
    { type: "card", title: "South bed", link: "south-bed", children: [{ type: "text", text: "its plan", link: "plan" }, { type: "text", text: "plain" }] },
    { type: "table", columns: ["bed", "crop"], rows: [["North", { text: "peas", link: "peas" }], ["South", "beans"], ["Herbs", { text: "thyme", act: "facets.set key=crop value=thyme" }]], links: ["north-bed", null, "herbs"], acts: [null, "list.sort by=crop", null] },
    { type: "box", children: [{ type: "row", children: [{ type: "text", text: "a link of its own", link: "shed", act: "bar.open" }] }] },
  ] } };
  const acted = withActs(part);
  const [list, card, table, box] = (acted.view as { children: any[] }).children;
  expect(list.rows.map((r: { act?: string }) => r.act)).toEqual([`open id="north-bed"`, `note.new text="Peas, a row\\\\of them"`, undefined, undefined]);
  // A written line reads back as the request it was written from, backslash and all.
  expect(actRequestOf(lineWords(list.rows[1].act)).args).toEqual({ text: "Peas, a row\\of them" });
  expect(list.rows[0].cells).toEqual(["sown", { text: "the shed", link: "shed", act: `open id="shed"` }]);
  expect([card.act, card.children[0].act, card.children[1].act]).toEqual([actOf({ open: "south-bed" }), actOf({ open: "plan" }), undefined]);
  // A table's row says one press: the act it has, else the note its link opens.
  expect(table.acts).toEqual([`open id="north-bed"`, "list.sort by=crop", `open id="herbs"`]);
  expect(table.rows[0][1]).toEqual({ text: "peas", link: "peas", act: `open id="peas"` });
  expect(table.rows[2][1].act).toBe("facets.set key=crop value=thyme");
  // An act line already there is the press: a link beside it changes nothing.
  expect(box.children[0].children[0].act).toBe("bar.open");
  // What other clients read (`do`, `link`, `links`) is still there, and the part given isn't written to.
  expect(list.rows[0].do).toEqual({ open: "north-bed" });
  expect(table.links).toEqual(["north-bed", null, "herbs"]);
  expect((part.view as { children: any[] }).children[0].rows[0].act).toBeUndefined();
});
