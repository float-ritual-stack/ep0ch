// Where a passage a reader drew is in the source (drawn-passage.ts): a quote as drawn, mapped to the span of the
// source it was drawn from. Made-up garden notes.
import { expect, test } from "bun:test";
import { BUILTIN_CALLOUT_REGISTRY } from "../src/callouts";
import { drawnText, findDrawnPassage, findQuoted, quoteRefusal } from "../src/drawn-passage";
import { findPassage, isMiss, missMessage } from "../src/passage";

const PEAS = "6a1d2f30-4b5c-4d6e-8f70-112233445566";
/** The source a drawn quote is found at, or why it isn't. */
const at = (text: string, quote: string, o: Parameters<typeof findDrawnPassage>[2] = {}, reads: Parameters<typeof findDrawnPassage>[3] = {}): string => {
  const found = findDrawnPassage(text, quote, o, reads);
  return isMiss(found) ? `miss: ${found.why}` : text.slice(found.start, found.end);
};

test("a passage across a link is the source it was drawn from, for each form a link is written in", () => {
  // A Markdown link, a labelled reference, a labelled page link, a page link drawn as its address.
  expect(at("Sow the [early peas](https://seeds.example/peas) in March.", "the early peas in")).toBe("the [early peas](https://seeds.example/peas) in");
  expect(at(`Sow the ((${PEAS}|early peas)) in March.`, "the early peas in")).toBe(`the ((${PEAS}|early peas)) in`);
  expect(at("Sow the [[seed list|early peas]] in March.", "the early peas in")).toBe("the [[seed list|early peas]] in");
  expect(at("Sow what the [[seed list]] says.", "the seed list says")).toBe("the [[seed list]] says");
  // A reference with no label is drawn as the title of the note it names: every word of it is the whole reference.
  const title = (id: string) => (id === PEAS ? "Early peas" : undefined);
  expect(at(`Sow the ((${PEAS})) in March.`, "the Early peas in", {}, { title })).toBe(`the ((${PEAS})) in`);
  expect(at(`Sow the ((${PEAS})) in March.`, "Early", {}, { title })).toBe(`((${PEAS}))`);
  // A reader that doesn't know the title has no words for it: a passage across it isn't in this text.
  expect(at(`Sow the ((${PEAS})) in March.`, "the Early peas in")).toStartWith("miss: ");
  // Words inside a label alone are the label's own letters.
  expect(at("Sow the [early peas](https://seeds.example/peas) in March.", "early")).toBe("early");
});

test("bold, emphasis, code and an escaped mark are drawn without their marks; a styled run wholly drawn takes them", () => {
  expect(at("Water **before dusk**, never at noon.", "Water before dusk, never")).toBe("Water **before dusk**, never");
  expect(at("Water **before dusk**, never at noon.", "before dusk")).toBe("**before dusk**");
  expect(at("Water **before dusk**, never at noon.", "before")).toBe("before");
  expect(at("Use the `hoe` and *not* the ~~rake~~ fork.", "the hoe and not the rake fork")).toBe("the `hoe` and *not* the ~~rake~~ fork");
  // A run the passage starts or ends with takes its marks when the passage holds the ones that pair with them.
  expect(at("**Water** the beds at dusk.", "Water the beds")).toBe("**Water** the beds");
  expect(at("Water the **beds** at dusk.", "the beds")).toBe("the **beds**");
  expect(at("Water the **beds** at dusk.", "the be")).toBe("the **be");
  expect(at("Row 3 \\[north\\] is full.", "Row 3 [north] is")).toBe("Row 3 \\[north\\] is");
});

test("a chip is drawn by one reader and not by another: the passage is found either way, and covers it", () => {
  const text = "Mulch the beds [due::friday] before the frost.";
  // A page that hides the token, and a Markdown view that shows it as written.
  expect(at(text, "the beds before the")).toBe("the beds [due::friday] before the");
  expect(at(text, "the beds [due::friday] before the")).toBe("the beds [due::friday] before the");
});

test("a callout's line is drawn as its icon and title, a list's and a heading's without their markers", () => {
  const text = "> [!tip] Before the rain\n> Net the **brassicas** first.\n\n## Jobs\n\n- [ ] Stake the beans\n- Lift the garlic ^lift\n1. Sow";
  const tip = BUILTIN_CALLOUT_REGISTRY.style("tip"), warning = BUILTIN_CALLOUT_REGISTRY.style("warning");
  expect(at(text, `${tip.icon} Before the rain\nNet the brassicas first.`)).toBe("[!tip] Before the rain\n> Net the **brassicas** first.");
  // With no title of its own, the line is drawn as its type's.
  expect(at("> [!warning]\n> Slugs after rain.", `${warning.icon} ${warning.title}\nSlugs after`)).toBe("[!warning]\n> Slugs after");
  expect(at("> [!warning]\n> Slugs after rain.", warning.title)).toBe("[!warning]");
  // As a Markdown view copies a list: each item with its marker; as a page selects it: without.
  expect(at(text, "- [ ] Stake the beans\n- Lift the garlic")).toBe("Stake the beans\n- Lift the garlic");
  expect(at(text, "Stake the beans Lift the garlic")).toBe("Stake the beans\n- Lift the garlic");
  expect(at(text, "Jobs\n\nStake the")).toBe("Jobs\n\n- [ ] Stake the");
});

test("two paragraphs are one passage, whatever stands between them as drawn", () => {
  const text = "Peas go in first.\n\nThe beans go in May.";
  expect(at(text, "go in first.\n\nThe beans")).toBe("go in first.\n\nThe beans");
  expect(at(text, "go in first.\nThe beans")).toBe("go in first.\n\nThe beans");
  expect(at(text, "go in first. The beans")).toBe("go in first.\n\nThe beans");
  // The words in order with nothing drawn left out between them: a word skipped is no passage.
  expect(at(text, "go in first. beans")).toStartWith("miss: ");
});

test("a table's cells and a code fence's lines are drawn without the pipes and the ticks", () => {
  const table = "| Bed | Crop |\n| --- | --- |\n| North | Peas |\n| South | Leeks |";
  expect(at(table, "North\tPeas\nSouth")).toBe("North | Peas |\n| South");
  expect(at(table, "Crop\nNorth")).toBe("Crop |\n| --- | --- |\n| North");
  const code = "Run it:\n\n```sh\nseed --bed north_bed\n```\n\nThen water.";
  expect(at(code, "Run it:\n\nseed --bed north_bed\n\nThen")).toBe("Run it:\n\n```sh\nseed --bed north_bed\n```\n\nThen");
});

test("the same words drawn twice are answered as a source quote's repeats are: refused, or the nearest, or within a span", () => {
  const text = "**Water** the beds at dusk.\n\nWater the beds at dawn too.";
  const twice = findDrawnPassage(text, "Water the beds");
  expect(isMiss(twice) && twice.count).toBe(2);
  // In findPassage's own words, the nearest named where it is in the source.
  expect(isMiss(twice) && missMessage(twice)).toBe('"Water the beds" is there 2 times: give start, near, prefix or suffix to say which (nearest: "**Water** the beds" at 0)');
  expect(at(text, "Water the beds", { near: text.indexOf("at dawn") })).toBe("Water the beds");
  expect(findDrawnPassage(text, "Water the beds", { near: text.indexOf("at dawn") })).toEqual({ start: 29, end: 43 });
  expect(findDrawnPassage(text, "Water the beds", { near: 0 })).toEqual({ start: 0, end: 18 });
  expect(findDrawnPassage(text, "Water the beds", { lower: 0, upper: 27 })).toEqual({ start: 0, end: 18 });
  expect(findDrawnPassage(text, "Water the beds", { lower: 29, upper: text.length })).toEqual({ start: 29, end: 43 });
  // The words drawn around it tell repeats apart, as a page sends them.
  expect(findDrawnPassage(text, "the beds", { suffix: " at dawn" })).toEqual({ start: 35, end: 43 });
  expect(findDrawnPassage(text, "the beds", { prefix: "Water ", suffix: "at dusk." })).toEqual({ start: 10, end: 18 });
  // A place the caller rules out is no place (a checklist item's children, for a comment on the item).
  expect(findDrawnPassage(text, "Water the beds", { exclude: (start) => start === 0 })).toEqual({ start: 29, end: 43 });
});

test("words that are not in the note are refused with why and the nearest words there are", () => {
  const text = "The [beans](https://seeds.example/beans) go in **May**.";
  const miss = findDrawnPassage(text, "The beans go in March.");
  expect(isMiss(miss) && missMessage(miss)).toBe('"The beans go in March." isn\'t in the text now (nearest: "The [beans](https://seeds.example/beans…" at 0)');
  expect(isMiss(findDrawnPassage(text, "**")) && (findDrawnPassage(text, "**") as { why: string }).why).toBe("the quote has no words a reader draws");
});

test("each drawn character keeps the source it was drawn from", () => {
  const drawn = drawnText("A [b](x) **c**");
  expect(drawn.text).toBe("A b c");
  expect(drawn.at).toEqual([0, 1, 3, 8, 11]);
  expect(drawn.end).toEqual([1, 2, 4, 9, 12]);
  const titled = drawnText(`((${PEAS}))!`, { title: () => "Peas" });
  expect(titled.text).toBe("Peas!");
  expect(titled.at.slice(0, 4)).toEqual([0, 0, 0, 0]);
  expect(titled.end.slice(0, 4)).toEqual([40, 40, 40, 40]);
});

test("a quote is source text unless it says it was drawn, and each reading is asked when the other has none of it", () => {
  const text = "**Water** the beds at dusk. Water the beds at dawn. Net the [peas](https://seeds.example/peas) too.";
  const exact = text.indexOf("Water the beds at dawn");
  // As written, it is the one place the source has those words: as it always was.
  expect(findQuoted(text, { quote: "Water the beds" })).toEqual(findPassage(text, "Water the beds") as { start: number; end: number });
  expect(findQuoted(text, { quote: "Water the beds" })).toEqual({ start: exact, end: exact + 14 });
  // As drawn, the same words are there twice, and the reader says so; a span of the source it was drawn in picks one.
  const drawn = findQuoted(text, { quote: "Water the beds", drawn: true });
  expect(isMiss(drawn) && drawn.count).toBe(2);
  expect(findQuoted(text, { quote: "Water the beds", drawn: true, within: { start: 0, end: 27 } })).toEqual({ start: 0, end: 18 });
  // A quote that says nothing of how it was read, and isn't in the source as written, is read as drawn.
  expect(findQuoted(text, { quote: "Net the peas too." })).toEqual({ start: text.indexOf("Net"), end: text.length });
  // One that names a place in the source is source text, and is never read as drawn.
  expect(isMiss(findQuoted(text, { quote: "Net the peas too.", start: text.indexOf("Net") }))).toBe(true);
  expect(isMiss(findQuoted(text, { quote: "Net the peas too.", prefix: "dawn. " }))).toBe(true);
  // A drawn quote of something a reader shows as written (a token alone) is found as written.
  expect(findQuoted("Mulch [due::friday] now.", { quote: "[due::friday]", drawn: true })).toEqual({ start: 6, end: 19 });
  // Words in neither reading: the refusal of the reading the quote asked for.
  const gone = findQuoted(text, { quote: "Net the leeks", drawn: true });
  expect(isMiss(gone) && gone.why).toBe('"Net the leeks" isn\'t in the text now');
});

test("a comment's refusal says its kind and the nearest words", () => {
  const twice = findDrawnPassage("the bed, the bed", "the bed"), none = findDrawnPassage("the bed", "the shed roof");
  const a = isMiss(twice) ? quoteRefusal(twice) : null, b = isMiss(none) ? quoteRefusal(none) : null;
  expect([a?.kind, b?.kind]).toEqual(["ambiguous", "not-found"]);
  expect(a?.message).toStartWith("Comment quote is ambiguous; supply start, prefix/suffix or a unique checklist itemId (");
  expect(b?.message).toStartWith("Comment quote or context was not found; read the current source and select it again (");
});
