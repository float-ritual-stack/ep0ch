import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addressProblems, readScreenNote, screenNoteBlocks, type NoteBlock, type WrittenBlock } from "../src/screen-note";
import { readSpec, specData, type ScreenSpec } from "../src/screen-spec";

let n = 0;
/** A block and the blocks under it, as the service hands a screen note over. */
const block = (text: string, ...children: NoteBlock[]): NoteBlock => ({ id: `b${++n}`, text, revision: 3, children });
const blocksOf = (w: WrittenBlock): NoteBlock => block(w.text, ...w.children.map(blocksOf));

/** The made-up garden screen of DESIGN.md §2, as blocks. */
const garden = () => block("Garden work [type::screen] [screen::garden-work] [lands::reader] [focus::beds]",
  block("split row [ratio::0.3]",
    block("tile query [name::beds] [query::type=bed NOT stage=done] [select::reader]"),
    block("tabs",
      block("tile reader [name::reader]"),
      block("tile backlinks [name::links] [source::tile:reader] [subject::follows]"))),
  block("keys", block("ctrl+l [action::bar.open source=query]")));

/** The same screen as the door writes one: its spec in a ```json fence. */
const GARDEN_SPEC = {
  name: "garden-work", title: "Garden work", lands: "reader", keys: [{ key: "ctrl+l", action: "bar.open", args: { source: "query" } }],
  layout: { focus: "beds", root: { t: "split", dir: "row", weights: [0.3, 0.7], kids: [
    { t: "leaf", kind: "query", name: "beds", query: "type=bed NOT stage=done", wires: [{ verb: "select", to: "reader" }] },
    { t: "tabs", active: 0, tabs: [{ t: "leaf", kind: "reader", name: "reader" }, { t: "leaf", kind: "backlinks", name: "links", source: "tile:reader", subject: "follows" }] }] } },
};
const fenced = (spec: unknown) => block(`Garden work [type::screen] [screen::garden-work]\nA screen.\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\``);

const spec = (r: ReturnType<typeof readScreenNote>): ScreenSpec => { if ("problem" in r) throw new Error(r.problem); return r.spec; };

describe("a screen note", () => {
  test("its two bodies lower to one spec: blocks under it, or the door's json fence", () => {
    const fromBlocks = readScreenNote(garden()), fromFence = readScreenNote(fenced(GARDEN_SPEC));
    expect(spec(fromBlocks)).toEqual(spec(fromFence));
    expect(spec(fromBlocks)).toEqual(readSpec(GARDEN_SPEC));
    expect(["problem" in fromBlocks ? "" : fromBlocks.form, "problem" in fromFence ? "" : fromFence.form]).toEqual(["blocks", "json"]);
    expect("problem" in fromBlocks ? null : [fromBlocks.name, fromBlocks.title, fromBlocks.revision]).toEqual(["garden-work", "Garden work", 3]);
  });

  test("what the block form writes reads back as the spec it was written from, for every screen the door ships", () => {
    const table = JSON.parse(readFileSync(join(import.meta.dir, "../fixtures/screens.json"), "utf8")) as { screens: { name: string; spec: ScreenSpec }[] };
    expect(table.screens.length).toBeGreaterThan(10);
    for (const { name, spec: shipped } of table.screens) {
      // A made screen's title is its note's heading; a built-in's name is its title's slug here.
      const given = readSpec(specData({ ...shipped, title: shipped.name }));
      const back = readScreenNote(blocksOf(screenNoteBlocks(given)));
      expect("problem" in back ? back.problem : back.spec, name).toEqual(given);
    }
  });

  test("a tile's fields a property can't hold are its own json fence", () => {
    const given = readSpec({ name: "seed-list", title: "seed-list", layout: { root: { t: "leaf", kind: "facets", name: "tags", args: { open: ["tag"], calendar: false }, query: "type=seed" } } });
    const written = screenNoteBlocks(given);
    expect(written.children[0]!.text.split("\n")[0]).toBe("tile facets [name::tags] [query::type=seed]");
    expect(written.children[0]!.text).toContain("```json");
    expect(spec(readScreenNote(blocksOf(written)))).toEqual(given);
  });

  test("a toolbar is act lines, one a block, and reads back as written", () => {
    const given = readSpec({ name: "seed-list", title: "seed-list", toolbar: ["bar.open", "bar.open scope=query", "note.new"], layout: { root: { t: "leaf", kind: "reader", name: "reader" } } });
    const written = screenNoteBlocks(given);
    expect(written.children[1]).toEqual({ text: "toolbar", children: [{ text: "bar.open", children: [] }, { text: "bar.open scope=query", children: [] }, { text: "note.new", children: [] }] });
    expect(spec(readScreenNote(blocksOf(written)))).toEqual(given);
  });

  test("a block that isn't part of a layout is said, with the block and what goes there", () => {
    const stray = readScreenNote(block("Beds [type::screen]", block("split row", block("tile reader [name::bed]"), block("compost heap"))));
    expect("problem" in stray && stray.problem).toMatch(/\(Beds\)|beds/);
    expect("problem" in stray && stray.problem).toContain('reads "compost heap": under a split go split, tabs, dock, columns, flow, tile <kind>');
    const none = readScreenNote(block("Beds [type::screen]"));
    expect("problem" in none && none.problem).toContain("has no layout: neither blocks under it");
    const two = readScreenNote(block("Beds [type::screen]", block("tile reader [name::a]"), block("tile reader [name::b]")));
    expect("problem" in two && two.problem).toContain("has 2 layouts under it");
    const keyless = readScreenNote(block("Beds [type::screen]", block("tile reader [name::a]"), block("keys", block("ctrl+l"))));
    expect("problem" in keyless && keyless.problem).toContain("key ctrl+l names no action");
  });

  test("a tile kind nobody has is refused when the caller says which exist, and a name the layout hasn't is said for its tile", () => {
    const broken = block("Beds [type::screen]", block("split row", block("tile raeder [name::bed]"), block("tile query [name::seeds] [select::bde]")));
    const read = readScreenNote(broken, kind => ["reader", "query"].includes(kind));
    expect("problem" in read && read.problem).toContain("no tile kind raeder here");
    const open = readScreenNote(broken);
    expect(addressProblems(spec(open))).toEqual([{ tile: "seeds", said: "seeds sends its select to bde, a tile this screen hasn't" }]);
  });
});
