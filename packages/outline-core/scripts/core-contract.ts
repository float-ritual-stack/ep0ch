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
//   indent     a draft's text, its selection, in or out → the spans to replace and where the selection is after (indentText)
//   keyNames   a word                         → whether it is a key's one name, as a screen's keys name one (isKeyName)
//   resourceRefs  what an answer asks a client to open → whether it is written as a Resource ref, not a block's id (isResourceRef)
//   ways       a refusal, each way's own words → the refusal as it is said: the reason, then the ways joined (whySaid)
//   quoted     a note's text, a quote as a client sends it with a comment → the span of the source it is, or the
//              refusal the service sends (findQuoted, quoteRefusal). `quotedNote` is the made-up note most of them
//              are about, as a page: a stand-in host serves it and answers a comment from these rows, so it refuses
//              what the service refuses.
import { staysMs } from "../src/reading-time";
import { join } from "node:path";
import { actionLine, type ActRequest } from "../src/action-line";
import { isKeyName, MOUSE_KEYS, NAMED_KEYS } from "../src/action-row";
import { sourceLines } from "../src/code-ranges";
import { way, whyNot, whySaid, type Why } from "../src/way-out";
import { indentText } from "../src/draft-indent";
import { mapCursor, type PlacedSpan } from "../src/draft-patch-place";
import { findQuoted, quoteRefusal, spanIn, wholePassage, type QuotedPassage } from "../src/drawn-passage";
import { noteMediaLines } from "../src/media-line";
import { pagePicture, proseMarkdown } from "../src/note-page";
import { isMiss } from "../src/passage";
import { isResourceRef } from "../src/resource-ref";
import { ALL_LINK_GROUPS, LINK_GROUP_LABELS, LINK_GROUPS, linkGroupsNamed } from "../src/link-blocks";
import { actOf, listSections, type ListGroup, type ListRow } from "../src/list-row";
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

/** What an answer may ask a client to open (an extension's `open`): Resource refs in each form, block ids, and words that only look like one. */
const RESOURCE_REFS = ["file:/shed/ledger.md", "web:https://seeds.example/peas", "resource:seed-list", "file:", "north-bed", "8f2c1d7e-0b1a-4c3d-9e5f-a1b2c3d4e5f6", "files", "webcal://beds.example/sowing", "File:/shed/ledger.md", " file:/shed/ledger.md", "https://seeds.example/peas", "resources", ""];

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
 * A draft one level in or out (Tab, Shift+Tab): its text with `|` where the cursor is and `^` at the selection's other
 * end when something is selected. Offsets are UTF-16 units of the text without the two marks.
 */
const INDENT: { name: string; marked: string; dir: 1 | -1 }[] = [
  { name: "a list item goes under the item above it, by that item's marker and gap", marked: "- peas\n- bea|ns", dir: 1 },
  { name: "under a numbered item: its number, its closer and its gap", marked: "12. dig\n- ra|ke", dir: 1 },
  { name: "a marker with two spaces after it: both count", marked: "-  peas\n-  be|ans", dir: 1 },
  { name: "the first item of a list has no item above: two spaces", marked: "Beds\n- pe|as", dir: 1 },
  { name: "an item with nothing after its marker is an item", marked: "- peas\n- |", dir: 1 },
  { name: "an item under an indented item: the item above at its own level", marked: "- beds\n  1. north\n  - so|uth", dir: 1 },
  { name: "a checklist's step is a list item", marked: "- [ ] sow\n- [x] wa|ter", dir: 1 },
  { name: "prose moves two spaces", marked: "Sow the pe|as.", dir: 1 },
  { name: "a line indented with a tab moves one tab", marked: "\t- peas\n\t- be|ans", dir: 1 },
  { name: "prose indented with a tab", marked: "\tSow the pe|as.", dir: 1 },
  { name: "a blank line alone still moves", marked: "- peas\n|", dir: 1 },
  { name: "every line the selection touches moves by the first line's step, and blank lines stay", marked: "- beds\n- no^rth\n\n  - peas\n- sou|th\n- shed", dir: 1 },
  { name: "a selection made upwards is the same lines", marked: "- beds\n- no|rth\n  - peas\n- sou^th", dir: 1 },
  { name: "a selection that ends at a line's start touches that line", marked: "Sow ^the peas.\n|Water them.", dir: 1 },
  { name: "words that are not ASCII before the cursor: offsets are UTF-16", marked: "- café 🌱\n- pêche 🍑|", dir: 1 },
  { name: "out: a nested item goes back to its parent's level", marked: "1. beds\n   - no|rth", dir: -1 },
  { name: "out: under a parent two levels up, by the nearest item indented less", marked: "- beds\n  - north\n    - pe|as", dir: -1 },
  { name: "out: an indented item with no parent above loses two spaces", marked: "Beds\n   - no|rth", dir: -1 },
  { name: "out: at the margin nothing moves", marked: "- no|rth", dir: -1 },
  { name: "out: prose loses two spaces, or what it has", marked: " Sow the pe|as.", dir: -1 },
  { name: "out: a tab goes", marked: "\t\t- pe|as", dir: -1 },
  { name: "out: the cursor inside the indent that goes stays at the line's start", marked: "- beds\n |   - north", dir: -1 },
  { name: "out: a selection keeps its nesting: every line by the first line's step, none past the margin", marked: "- beds\n  - no^rth\n    - peas\n - odd\n\n  - sou|th", dir: -1 },
  { name: "out: prose above an item is no parent", marked: "Beds\n  - no|rth", dir: -1 },
];
function indented(c: { name: string; marked: string; dir: 1 | -1 }) {
  // The marks are taken out last first, so each offset is one of the text without either.
  const marked = c.marked;
  const bar = marked.replace("^", "").indexOf("|"), hat = marked.includes("^") ? marked.replace("|", "").indexOf("^") : bar;
  const text = marked.replace("|", "").replace("^", "");
  const did = indentText(text, c.dir, hat, bar);
  let after = text;
  for (const span of [...did.spans].reverse()) after = after.slice(0, span.start) + span.replacement + after.slice(span.end);
  return { name: c.name, text, dir: c.dir, anchor: hat, cursor: bar, spans: did.spans, after: { text: after, anchor: did.anchor, cursor: did.cursor }, lines: did.lines };
}

/**
 * Words a screen's key map might name a key by: every name a key has (the values of `NAMED_KEYS`), a character each
 * way (a letter, a capital, punctuation), each modifier with a character, and words that are no key's name.
 */
const KEY_NAMES: string[] = [...new Set([...Object.values(NAMED_KEYS).filter(name => !MOUSE_KEYS.has(name) && name !== "hover"), "l", "L", ",", "?", "/", "+", "1", "alt+c", "alt+L", "alt+,", "ctrl+l", "ctrl+,", "ctrl+L", "super+k", "hyper+h", "mod+l", "escape", "pageup", "ctrl+w q", "click", ""])];

/**
 * A refusal and the words a door has for each of its ways (null: the door hasn't the action): how the reason and the
 * ways are joined is one rule. What a way's own words are (a key, an act line) is each door's, so the table gives them.
 */
const WAYS: { name: string; why: Why; said: (string | null)[] }[] = [
  { name: "no way: the reason alone", why: whyNot("almanac can't go there: it's the only tile"), said: [] },
  { name: "one way follows the reason", why: whyNot("log holds work", way("tile.close", "closes it first", { tile: "log" })), said: ["the key that closes it closes it first"] },
  { name: "another way is an or", why: whyNot("sown stays: the lanes container keeps its tiles", way("tile.collapse", "folds it to a spine"), way("layout.policy", "turns closable on", { at: "there" })), said: ["fold folds it to a spine", "policy there turns closable on"] },
  { name: "a way that follows the one before is a then", why: whyNot("the screen is locked", way("host.toggle", "puts the drawer away"), way("layout.lock", "unlocks it", { then: true })), said: ["drawer puts the drawer away", "lock unlocks it"] },
  { name: "a way the door has no action for is left out, and the next is said as the first", why: whyNot("the screen is locked", way("host.toggle", "puts the drawer away"), way("layout.lock", "unlocks it", { then: true })), said: [null, "lock unlocks it"] },
  { name: "no way the door has: the reason alone", why: whyNot("beds stays open: screen doesn't fold", way("layout.policy", "turns collapsible on")), said: [null] },
  { name: "three ways, the middle one left out", why: whyNot("bed is held", way("draft.patch", "lands in it"), way("comment", "gets their attention"), way("block.mark", "marks it", { then: true })), said: ["patch lands in it", null, "mark marks it"] },
];

/**
 * A made-up note with a link, bold, two paragraphs, and the same words in two of its parts; and where its parts are
 * written, as `notes.page` frames them (the outliner's test holds these to what the service answers for this text):
 * a run of prose as the Markdown a client draws, a picture where its line is.
 */
const QUOTED_TEXT = [
  "Sowing plan [type::plan]",
  "Sow the [early peas](https://seeds.example/peas) in March, **before** the last frost.",
  "",
  "Water the beds at dusk.",
  "",
  "[img::pictures/beds.svg]",
  "",
  "Water the beds at dusk, and again at dawn.",
  "",
  "[img::pictures/shed.svg]",
  "",
  "- Net the peas against pigeons.",
  "- Stake the beans before the wind.",
].join("\n");
const QUOTED_PARTS: { kind: "prose" | "picture"; from: number; to: number }[] = [{ kind: "prose", from: 1, to: 3 }, { kind: "picture", from: 5, to: 5 }, { kind: "prose", from: 7, to: 7 }, { kind: "picture", from: 9, to: 9 }, { kind: "prose", from: 11, to: 12 }];
/**
 * A comment thread on words of the note (a made-up one, by the id the stand-in garden lists for it): the end of one
 * paragraph and the whole of the next. Where its words are in each part's own text is `quotedNote.marked` (`spanIn`),
 * which the outliner's test holds to what `notes.page` answers once that comment is there.
 */
const MARKED = { id: "thread-sowing", exact: "the last frost.\n\nWater the beds at dusk." };
function quotedNote() {
  const lines = QUOTED_TEXT.split("\n"), offsets = sourceLines(QUOTED_TEXT), media = noteMediaLines(QUOTED_TEXT);
  const parts = QUOTED_PARTS.map(p => ({
    type: "part", kind: p.kind, block: "sowing", span: { start: offsets[p.from]!.start, end: offsets[p.to]!.contentEnd }, line: p.from,
    view: p.kind === "prose" ? { type: "markdown", text: proseMarkdown(lines.slice(p.from, p.to + 1).join("\n"), new Map()) } : { type: "picture", ...pagePicture(media.get(p.from)!) },
  }));
  // The made-up thread's passage, as each part it reaches into is marked (the service's `marks`, a part by its line).
  const at = QUOTED_TEXT.indexOf(MARKED.exact), thread = { id: MARKED.id, start: at, end: at + MARKED.exact.length };
  const marked = parts.flatMap(p => {
    const start = Math.max(thread.start, p.span.start), end = Math.min(thread.end, p.span.end);
    const rendered = p.view.type === "markdown" ? (p.view as { text: string }).text : undefined;
    if (end <= start || rendered === undefined) return [];
    const found = spanIn(QUOTED_TEXT.slice(p.span.start, p.span.end), { start: start - p.span.start, end: end - p.span.start }, rendered);
    return [{ line: p.line, marks: [{ kind: "thread", id: thread.id, ...(found ?? {}), act: actOf({ run: { action: "thread.toggle", args: { thread: thread.id } } }), from: "threads" }] }];
  });
  return { id: "sowing", title: "Sowing plan", revision: 3, text: QUOTED_TEXT, chips: [{ key: "type", value: "plan" }], parts, thread, marked };
}
/** The text every other note of the stand-in garden has, by its title. */
const PLOT_TEXT = "Plot [type::chore]\nBefore the rain.";
const within = (part: number) => quotedNote().parts[part]!.span;
/** Quotes as clients send them: a selection as a Markdown view copies it (said as drawn, within the part it was made in), an act's `quote=`. */
const QUOTED: { name: string; text: string; passage: QuotedPassage }[] = [
  { name: "a part selected whole, across a link, bold and two paragraphs: the source it was drawn from", text: QUOTED_TEXT,
    passage: { quote: "Sow the early peas in March, before the last frost.\n\nWater the beds at dusk.", drawn: true, within: within(0) } },
  { name: "words drawn in two parts, selected in the second: the part's span says which", text: QUOTED_TEXT, passage: { quote: "Water the beds at dusk, and again at dawn.", drawn: true, within: within(2) } },
  { name: "words drawn in two parts, selected in the first", text: QUOTED_TEXT, passage: { quote: "Water the beds at dusk", drawn: true, within: within(0) } },
  { name: "the same words with no part said: drawn twice, refused as a source quote's repeats are", text: QUOTED_TEXT, passage: { quote: "Water the beds at dusk", drawn: true } },
  { name: "the same words as an act's quote=: in the source twice", text: QUOTED_TEXT, passage: { quote: "Water the beds at dusk" } },
  { name: "and nearest an offset among them", text: QUOTED_TEXT, passage: { quote: "Water the beds at dusk", near: QUOTED_TEXT.length } },
  { name: "an act's quote= of words as they read: not in the source as written, found as drawn", text: QUOTED_TEXT, passage: { quote: "Sow the early peas in March" } },
  { name: "a quote of the source as written", text: QUOTED_TEXT, passage: { quote: "**before** the last frost." } },
  { name: "a selection that starts inside a word and ends inside one (a press past the middle of a first letter): found as it came, and whole it is the words", text: QUOTED_TEXT,
    passage: { quote: "ow the early peas in Marc", drawn: true, within: within(0) } },
  { name: "the same from the first letter of a list item, across the next item's marker, as a Markdown view copies two items", text: QUOTED_TEXT,
    passage: { quote: "et the peas against pigeons.\n- Stake the bea", drawn: true, within: within(4) } },
  { name: "a list item selected from its first letter to its last: whole as it came", text: QUOTED_TEXT, passage: { quote: "Net the peas against pigeons.", drawn: true, within: within(4) } },
  { name: "those whole words, sent as the quote of a comment: the first", text: QUOTED_TEXT, passage: { quote: "Sow the early peas in March", drawn: true, within: within(0) } },
  { name: "and the second, across the two items", text: QUOTED_TEXT, passage: { quote: "Net the peas against pigeons. Stake the beans", drawn: true, within: within(4) } },
  { name: "a list selected whole, as a Markdown view copies it: each item after its marker", text: QUOTED_TEXT, passage: { quote: "- Net the peas against pigeons.\n- Stake the beans before the wind.", drawn: true, within: within(4) } },
  { name: "words that are not in the note: refused with the nearest there are", text: QUOTED_TEXT, passage: { quote: "Sow the late peas in May", drawn: true, within: within(0) } },
  { name: "the garden's other notes: words of the note", text: PLOT_TEXT, passage: { quote: "Before the rain." } },
  { name: "the same words, picked as a reader drew them (an act's passage.select)", text: PLOT_TEXT, passage: { quote: "Before the rain.", drawn: true } },
  { name: "words nobody wrote", text: PLOT_TEXT, passage: { quote: "words nobody wrote" } },
  { name: "and picked as drawn", text: PLOT_TEXT, passage: { quote: "Peas go in last.", drawn: true } },
  { name: "a stand-in page that draws more than its note's text holds: the words are not in the note", text: PLOT_TEXT,
    passage: { quote: "Before the rain. See the shed and seeds.", drawn: true, within: { start: 19, end: 35 } } },
  { name: "a selection that starts on a year and its full stop, mid-sentence: the whole of it, once (no list's number is read into it)", text: "The frost came late in 2026. Then it rained for a week.\n\nThen it rained again in May.",
    passage: { quote: "2026. Then it rained", drawn: true } },
];

/** A table as text: its head, then each list one row a line, so a changed rule is a changed line. */
function table(head: Record<string, unknown>, lists: Record<string, readonly unknown[]>): string {
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const rows = Object.entries(lists).map(([k, list]) => `  ${JSON.stringify(k)}: [\n${list.map(r => `    ${JSON.stringify(r)}`).join(",\n")}\n  ]`);
  return `{\n${[...lines, ...rows].join(",\n")}\n}\n`;
}

export function coreContract(): string {
  return table({
    about: "What outline-core's own rules answer, for a client that can't run it: a request written as an act line (actionLine), a list's sections (listSections), which new-note rule of a screen applies (newNoteRule), a screen opened on a target (targetFilled), a question narrowed by picked values (selectionQuery), a links list's groups (linkGroupsNamed, with each group's glyph and label), where an offset of a draft is once a patch's placed spans are replaced (mapCursor), a draft's lines one level in or out and where its selection is after (indentText), whether a word is a key's one name, as a screen's keys name one (isKeyName), whether what an answer asks a client to open is written as a Resource ref and not a block's id (isResourceRef), how long something said to a person stays up, by how many columns it is (staysMs), a refusal said from its reason and each way's own words (whySaid: said gives a door's words for each way, null where it hasn't the action), and where a quote sent with a comment is in a note's text, as written or as a reader drew it, or what it is refused with (findQuoted, quoteRefusal; quotedNote is the note most are about, as a page), with that passage as whole words (wholePassage: what passages.find answers; at is where it is in the text of the part it ends in, spanIn) and where a thread's passage is in each part's own text (spanIn: quotedNote.marked). Made by calling each; never edited by hand.",
    by: BY,
    linkGroups: { all: ALL_LINK_GROUPS, groups: LINK_GROUPS.map(g => ({ ...g, label: LINK_GROUP_LABELS[g.group] })) },
    quotedNote: quotedNote(),
  }, {
    written: WRITTEN.map(request => ({ request, line: actionLine(request) })),
    sections: SECTIONS.map(c => ({ name: c.name, list: { rows: c.rows, ...(c.groups ? { groups: c.groups } : {}) }, sections: listSections({ rows: c.rows, ...(c.groups ? { groups: c.groups } : {}) }).map(s => ({ head: s.head, rows: s.rows.map(r => r.id) })) })),
    newNote: NEW_NOTE.map(c => { const rule = newNoteRule({ ...(c.newNote ? { newNote: c.newNote } : {}) }, c.kind ?? undefined); return { name: c.name, newNote: c.newNote ?? null, kind: c.kind, rule: rule ? c.newNote!.indexOf(rule) : null }; }),
    targets: TARGETS.map(c => ({ name: c.name, spec: c.spec, args: c.args ?? null, filled: targetFilled(c.spec, c.args) })),
    terms: TERMS.map(c => ({ ...c, query: selectionQuery(c.picks.map(([key, value]) => pick(key, value)), c.raw) })),
    links: LINKS.map(names => ({ names, groups: linkGroupsNamed(names) })),
    cursor: CURSOR.map(c => ({ name: c.name, spans: c.spans, at: OFFSETS.map(offset => [offset, mapCursor(offset, c.spans)]) })),
    indent: INDENT.map(indented),
    keyNames: KEY_NAMES.map(key => ({ key, named: isKeyName(key) })),
    resourceRefs: RESOURCE_REFS.map(value => ({ value, resource: isResourceRef(value) })),
    stays: [0, 1, 20, 35, 36, 80, 200, 407, 408, 2000].map(columns => ({ columns, ms: staysMs(columns) })),
    ways: WAYS.map(c => ({ ...c, whole: whySaid(c.why, each => c.said[c.why.ways.indexOf(each)] ?? null) })),
    // (A row about `quotedNote` leaves its text out: it is the note's.)
    quoted: QUOTED.map(c => {
      const found = findQuoted(c.text, c.passage), row = { name: c.name, ...(c.text === QUOTED_TEXT ? {} : { text: c.text }), passage: c.passage };
      if (isMiss(found)) { const refusal = quoteRefusal(found); return { ...row, refused: { kind: refusal.kind, error: refusal.message } }; }
      // The same passage as whole words (`passages.find whole=words`): its span, and the quote to send in the asker's place.
      const whole = wholePassage(c.text, found);
      // Asked with the part its words end in (the part whose span a selection said it was `within`): where the
      // passage is in the text that part's view is drawn from (`passages.find part=`, answered `at`).
      const part = c.text === QUOTED_TEXT ? quotedNote().parts.find(p => p.span.end === c.passage.within?.end && p.view.type === "markdown") : undefined;
      const at = part && spanIn(c.text.slice(part.span.start, part.span.end), { start: Math.max(whole.span.start, part.span.start) - part.span.start, end: Math.min(whole.span.end, part.span.end) - part.span.start }, (part.view as { text: string }).text);
      return { ...row, found: { ...found, exact: c.text.slice(found.start, found.end) },
        whole: { start: whole.span.start, end: whole.span.end, exact: c.text.slice(whole.span.start, whole.span.end), quote: whole.widened ? whole.words : c.passage.quote, widened: whole.widened, ...(at ? { at } : {}) } };
    }),
  });
}

if (import.meta.main) { await Bun.write(CORE_CONTRACT, coreContract()); console.log(`wrote ${CORE_CONTRACT}`); }
