// What outline-core's own rules answer, written down as data for a client that can't run this package (the native
// window's Rust): each table is made by calling the rule on made-up input and recording what came back. Nothing here
// decides anything. `bun scripts/core-contract.ts` writes fixtures/core-contract.json; test/core-contract.test.ts
// makes it again and compares, and the native window's cargo tests ask every row of its own copy of each rule.
//
//   written    a request                      → the act line it is written as                 (actionLine)
//   sections   a list's rows and groups       → the sections every renderer draws, in order   (listSections)
//   newNote    a screen's rules, a tile kind  → the rule that applies, by its place           (newNoteRule)
//   targets    a screen's spec, an argument   → the spec it opens as                          (targetFilled)
//   terms      a question, the values picked  → the question they narrow it to                (selectionQuery)
//   links      a links list's `linkGroups`    → its groups, in order, or the name none has    (linkGroupsNamed)
//   cursor     an offset, the spans a patch placed → where the offset is once they are replaced   (mapCursor)
//   keyNames   a word                         → whether it is a key's one name, as a screen's keys name one (isKeyName)
import { join } from "node:path";
import { actionLine, type ActRequest } from "../src/action-line";
import { isKeyName, MOUSE_KEYS, NAMED_KEYS } from "../src/action-row";
import { mapCursor, type PlacedSpan } from "../src/draft-patch-place";
import { ALL_LINK_GROUPS, LINK_GROUP_LABELS, LINK_GROUPS, linkGroupsNamed } from "../src/link-blocks";
import { listSections, type ListGroup, type ListRow } from "../src/list-row";
import { selectionQuery, type Clause } from "../src/query-clauses";
import { newNoteRule, readSpec, targetFilled, type ScreenSpec } from "../src/screen-spec";

export const CORE_CONTRACT = join(import.meta.dir, "../fixtures/core-contract.json");
const BY = "packages/outline-core/scripts/core-contract.ts";

/** Requests whose values need care as a line: a space, each kind of quote, a backslash, a line break, nothing at all. */
const WRITTEN: ActRequest[] = [
  { action: "note.trash" },
  { action: "open", args: { id: "north-bed" } },
  { action: "bar.open", args: { scope: "query", query: "type=bed NOT stage=done" } },
  { action: "bar.open", args: { scope: "query", query: "path=beds\\north" } },
  { action: "note.new", args: { text: "Seed swap\nBring the \"late\" peas" } },
  { action: "facets.set", args: { key: "crop", value: "it's garlic" } },
  { action: "facets.set", args: { key: "crop", value: "“runner” beans" } },
  { action: "screen.open", args: { name: "garden-work", target: "" } },
  { action: "list.sort", args: { by: "sown on", order: "desc" }, tile: "seed beds" },
  { action: "open", args: { id: "north-bed" }, tile: "role:reader@garden-work" },
  { action: "note.new", args: { text: "{{ not a slot }} \\{ kept" } },
  { action: "layout.resize", args: { split: "s1", border: 0, share: 0.3 } },
  { action: "tree.fold", args: { id: "plot", open: true } },
];

const row = (id: string, more: Partial<ListRow> = {}): ListRow => ({ id, label: id, do: { open: id }, ...more });
const group = (name: string, more: Partial<ListGroup> = {}): ListGroup => ({ name, label: name, count: 0, ...more });

const SECTIONS: { name: string; rows: ListRow[]; groups?: ListGroup[] }[] = [
  { name: "rows that name no group are one section with no header", rows: [row("north-bed"), row("south-bed")] },
  { name: "the rows that name no group come first, then each declared group, then a group only a row names",
    rows: [row("shed"), row("peas", { group: "sown" }), row("leeks", { group: "planned" }), row("garlic", { group: "lifted" }), row("beans", { group: "sown" })],
    groups: [group("planned", { label: "Planned", count: 1 }), group("sown", { label: "Sown", count: 2, glyph: "·" })] },
  { name: "a declared group with no rows keeps its header and its note", rows: [row("peas", { group: "sown" })], groups: [group("sown", { count: 1 }), group("lifted", { note: "Nothing lifted yet." })] },
  { name: "groups that list their rows by id hold them in that order, a row in two groups twice, and a row no group lists nowhere",
    rows: [row("peas"), row("leeks"), row("garlic"), row("stray", { group: "sown" })],
    groups: [group("spring", { count: 2, ids: ["leeks", "peas"] }), group("autumn", { count: 2, ids: ["garlic", "peas", "gone"] })] },
  { name: "groups inside a group are sections of their own, named by the way to them",
    rows: [row("peas"), row("leeks"), row("garlic")],
    groups: [group("beds", { label: "Beds", count: 3, ids: [], groups: [group("north", { label: "North", count: 2, ids: ["peas", "leeks"] }), group("south", { label: "South", count: 1, ids: ["garlic"] })] })] },
  { name: "a list with no rows and one declared group", rows: [], groups: [group("sown", { note: "Nothing here yet." })] },
];

const NEW_NOTE: { name: string; newNote?: ScreenSpec["newNote"]; kind: string | null }[] = [
  { name: "no rules: a float", kind: "screens.reader" },
  { name: "a rule with no only and no unless fits every kind", newNote: [{ opens: "lands" }], kind: "screens.tree" },
  { name: "the first rule that fits wins: only names the kind", newNote: [{ opens: "tab", only: ["screens.reader"] }, { opens: "lands" }], kind: "screens.reader" },
  { name: "a rule whose only names another kind is passed over", newNote: [{ opens: "tab", only: ["screens.reader"] }, { opens: "lands" }], kind: "screens.tree" },
  { name: "unless keeps a rule from the kinds it names", newNote: [{ opens: "tab", unless: ["screens.tree"] }, { opens: "float" }], kind: "screens.tree" },
  { name: "unless lets every other kind through", newNote: [{ opens: "tab", unless: ["screens.tree"] }, { opens: "float" }], kind: "screens.query" },
  { name: "no tile has the keys: an only rule never fits, an unless rule does", newNote: [{ opens: "tab", only: ["screens.reader"] }, { opens: "drawer", unless: ["screens.tree"] }], kind: null },
  { name: "a rule may run another action altogether", newNote: [{ only: ["screens.query"], action: "card.new", args: { stage: "planned" } }, { opens: "lands" }], kind: "screens.query" },
  { name: "nothing fits: a float", newNote: [{ opens: "tab", only: ["screens.reader"] }], kind: "screens.who" },
];

const leaf = (kind: string, name: string, more: Record<string, unknown> = {}) => ({ t: "leaf", kind, name, ...more });
const screen = (more: Record<string, unknown>): ScreenSpec => readSpec({ name: "garden-work", title: "Garden work", ...more });
/** A spec the validator refuses (its target names a float's tile, or none): what the rule answers is still the rule's. */
const unchecked = (more: Record<string, unknown>) => ({ name: "garden-work", title: "Garden work", ...more }) as unknown as ScreenSpec;
const BEDS = { focus: "beds", root: { t: "split", dir: "row", weights: [0.3, 0.7], kids: [leaf("facets", "beds"), { t: "tabs", active: 0, tabs: [leaf("reader", "reader"), leaf("matches", "found", { query: "type=bed" })] }] } };

const TARGETS: { name: string; spec: ScreenSpec; args?: Record<string, unknown> }[] = [
  { name: "the tile the target names carries the argument's words in that field", spec: screen({ target: { arg: "query", fills: "beds.query" }, layout: BEDS }), args: { query: "type=bed stage=sown" } },
  { name: "a tile in a tab set is found", spec: screen({ target: { arg: "query", fills: "found.query" }, layout: BEDS }), args: { query: " crop=leek " } },
  { name: "a float's tile is found", spec: unchecked({ target: { arg: "note", fills: "almanac.note" }, layout: { ...BEDS, floats: [{ tile: leaf("reader", "almanac"), rect: { col: 4, row: 2, cols: 60, rows: 20 } }] } }), args: { note: "north-bed" } },
  { name: "a blank argument fills nothing", spec: screen({ target: { arg: "query", fills: "beds.query" }, layout: BEDS }), args: { query: "  " } },
  { name: "an argument by another name fills nothing", spec: screen({ target: { arg: "query", fills: "beds.query" }, layout: BEDS }), args: { target: "type=bed" } },
  { name: "a tile the layout hasn't fills nothing", spec: unchecked({ target: { arg: "query", fills: "lanes.query" }, layout: BEDS }), args: { query: "type=bed" } },
  { name: "a screen that takes no target is as it is", spec: screen({ layout: BEDS }), args: { query: "type=bed" } },
];

const pick = (key: string, value: string): Clause => ({ key, value, mode: "include" });
const TERMS: { raw: string; picks: [string, string][] }[] = [
  { raw: "", picks: [["stage", "sown"]] },
  { raw: "type=bed", picks: [["stage", "sown"]] },
  { raw: "type=bed", picks: [["stage", "sown"], ["stage", "planned"]] },
  { raw: "type=bed", picks: [["stage", "sown"], ["crop", "runner beans"], ["stage", "planned"]] },
  { raw: "type=bed OR type=row", picks: [["stage", "sown"]] },
  { raw: "type=bed NOT stage=done", picks: [] },
  { raw: "type=border", picks: [["crop", "it's garlic"], ["path", "beds\\north"], ["said", "the \"late\" peas"]] },
  { raw: "  type=bed  ", picks: [["tag", "frost"], ["owner", "ada@plot"], ["sown", "2026-03-01"], ["crop", ""]] },
  { raw: "candor", picks: [["stage", "sown"]] },
];

const LINKS: string[][] = [[], ["all"], ["backlinks"], ["children", "outlinks"], ["Resources", " backlinks "], ["all", "children"], ["cousins"], ["backlinks", "matches"]];

/** A patch's placed spans (offsets in UTF-16 units of the draft), and the offsets asked of each: before, at, inside and after every span. */
const span = (start: number, end: number, replacement: string, caret?: PlacedSpan["caret"]): PlacedSpan => ({ start, end, replacement, ...(caret ? { caret } : {}) });
const CURSOR: { name: string; spans: PlacedSpan[] }[] = [
  { name: "a passage made shorter: before it stays, inside it goes to its end, after it moves by the change", spans: [span(10, 26, "beans go along")] },
  { name: "a passage made longer", spans: [span(4, 8, "sweet peas")] },
  { name: "words put in at a point: an offset there moves past them", spans: [span(12, 12, "late ")] },
  { name: "an answer under its ask: an offset at the ask's end stays on its line", spans: [span(12, 12, "\n> sown in March", "stays")] },
  { name: "an answer that takes the place of an older one: at its start stays, inside goes to its end", spans: [span(12, 30, "\n> sown in April", "stays")] },
  { name: "a paragraph of its own added at the very end moves nothing", spans: [span(40, 42, "\n\nRestored on the first frost.", "apart")] },
  { name: "two spans: each moves what is after it", spans: [span(2, 5, "a"), span(20, 20, "garlic, ")] },
  { name: "a span above and a paragraph added at the end: only the first moves the offsets", spans: [span(2, 5, "leeks and"), span(40, 44, "\nLifted.", "apart")] },
];
const OFFSETS = [0, 2, 3, 4, 5, 8, 10, 12, 13, 20, 21, 26, 30, 31, 40, 41, 42, 44, 60];

/**
 * Words a screen's key map might name a key by: every name a key has (the values of `NAMED_KEYS`), a character each
 * way (a letter, a capital, punctuation), each modifier with a character, and words that are no key's name.
 */
const KEY_NAMES: string[] = [...new Set([...Object.values(NAMED_KEYS).filter(name => !MOUSE_KEYS.has(name) && name !== "hover"), "l", "L", ",", "?", "/", "+", "1", "alt+c", "alt+L", "alt+,", "ctrl+l", "ctrl+,", "ctrl+L", "super+k", "hyper+h", "mod+l", "escape", "pageup", "ctrl+w q", "click", ""])];

/** A table as text: its head, then each list one row a line, so a changed rule is a changed line. */
function table(head: Record<string, unknown>, lists: Record<string, readonly unknown[]>): string {
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const rows = Object.entries(lists).map(([k, list]) => `  ${JSON.stringify(k)}: [\n${list.map(r => `    ${JSON.stringify(r)}`).join(",\n")}\n  ]`);
  return `{\n${[...lines, ...rows].join(",\n")}\n}\n`;
}

export function coreContract(): string {
  return table({
    about: "What outline-core's own rules answer, for a client that can't run it: a request written as an act line (actionLine), a list's sections (listSections), which new-note rule of a screen applies (newNoteRule), a screen opened on a target (targetFilled), a question narrowed by picked values (selectionQuery), a links list's groups (linkGroupsNamed, with each group's glyph and label), where an offset of a draft is once a patch's placed spans are replaced (mapCursor), and whether a word is a key's one name, as a screen's keys name one (isKeyName). Made by calling each; never edited by hand.",
    by: BY,
    linkGroups: { all: ALL_LINK_GROUPS, groups: LINK_GROUPS.map(g => ({ ...g, label: LINK_GROUP_LABELS[g.group] })) },
  }, {
    written: WRITTEN.map(request => ({ request, line: actionLine(request) })),
    sections: SECTIONS.map(c => ({ name: c.name, list: { rows: c.rows, ...(c.groups ? { groups: c.groups } : {}) }, sections: listSections({ rows: c.rows, ...(c.groups ? { groups: c.groups } : {}) }).map(s => ({ head: s.head, rows: s.rows.map(r => r.id) })) })),
    newNote: NEW_NOTE.map(c => { const rule = newNoteRule({ ...(c.newNote ? { newNote: c.newNote } : {}) }, c.kind ?? undefined); return { name: c.name, newNote: c.newNote ?? null, kind: c.kind, rule: rule ? c.newNote!.indexOf(rule) : null }; }),
    targets: TARGETS.map(c => ({ name: c.name, spec: c.spec, args: c.args ?? null, filled: targetFilled(c.spec, c.args) })),
    terms: TERMS.map(c => ({ ...c, query: selectionQuery(c.picks.map(([key, value]) => pick(key, value)), c.raw) })),
    links: LINKS.map(names => ({ names, groups: linkGroupsNamed(names) })),
    cursor: CURSOR.map(c => ({ name: c.name, spans: c.spans, at: OFFSETS.map(offset => [offset, mapCursor(offset, c.spans)]) })),
    keyNames: KEY_NAMES.map(key => ({ key, named: isKeyName(key) })),
  });
}

if (import.meta.main) { await Bun.write(CORE_CONTRACT, coreContract()); console.log(`wrote ${CORE_CONTRACT}`); }
