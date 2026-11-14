// An anchor on a part's drawn words (part-anchor.ts): where a span of a note's source is in the text a renderer was
// handed for it (drawn-passage.ts's `spanIn`), and a passage picked by hand as whole words (`wholePassage`). Made-up
// garden notes.
import { expect, test } from "bun:test";
import { spanIn, wholePassage } from "../src/drawn-passage";
import { proseMarkdown } from "../src/note-page";

const PEAS = "0b6f2c1e-7a34-4d59-9e21-3c5d8f4a1b07";
const titles = new Map([[PEAS, "Early `peas`"]]);
const reads = { title: (id: string) => titles.get(id) };

/** The words of `source` named `exact`, as the Markdown written from it has them. */
function marked(source: string, exact: string): string | null {
  const start = source.indexOf(exact), rendered = proseMarkdown(source, titles);
  const found = spanIn(source, { start, end: start + exact.length }, rendered, reads);
  return found && rendered.slice(found.start, found.end);
}

test("a span of the source is the same drawn words in the Markdown written from it", () => {
  const source = [`Sow the ((${PEAS})) in March, then the ((${PEAS}|maincrop)) and what the [[seed list]] says.`, "Water **before dusk**, never at *noon*.", "", "- Net the peas.", "- Stake the beans."].join("\n");
  // Words drawn as written: the same words, wherever the links before them moved them to.
  expect(marked(source, "in March")).toBe("in March");
  expect(marked(source, "never at *noon*")).toBe("never at *noon*");
  // A reference is the link it was written as: its title or its label, with the link's own text.
  expect(marked(source, `the ((${PEAS})) in`)).toBe("the [Early `peas`](ep0ch:b/0b6f2c1e-7a34-4d59-9e21-3c5d8f4a1b07) in");
  expect(marked(source, `the ((${PEAS}|maincrop)) and`)).toBe("the [maincrop](ep0ch:b/0b6f2c1e-7a34-4d59-9e21-3c5d8f4a1b07) and");
  expect(marked(source, "the [[seed list]] says")).toBe("the [seed list](ep0ch:p/seed%20list) says");
  // Across two lines (the hard break a written line ends with is between them) and across two list items.
  expect(marked(source, "says.\nWater **before dusk**")).toBe("says.  \nWater **before dusk**");
  expect(marked(source, "Net the peas.\n- Stake")).toBe("Net the peas.  \n- Stake");
  // Nothing a reader draws (a marker alone), and words the rendered text hasn't: no place.
  expect(spanIn(source, { start: source.indexOf("- Net"), end: source.indexOf("- Net") + 2 }, proseMarkdown(source, titles), reads)).toBeNull();
  expect(spanIn("Dig the bed.", { start: 0, end: 3 }, "Rake the bed.")).toBeNull();
});

test("where the two readings differ before a span, its own words are looked for, nearest where they stood", () => {
  // A reference nobody knows the title of is drawn as its id's start in the Markdown and as nothing in the source.
  const source = `See ((${PEAS})) first. Water at dusk, and water at dawn.`;
  const rendered = proseMarkdown(source, new Map());
  const at = source.lastIndexOf("ater at dawn") - 1, found = spanIn(source, { start: at, end: at + "water at dawn".length }, rendered)!;
  expect(rendered.slice(found.start, found.end)).toBe("water at dawn");
  const first = source.indexOf("Water at dusk"), dusk = spanIn(source, { start: first, end: first + 13 }, rendered)!;
  expect(rendered.slice(dusk.start, dusk.end)).toBe("Water at dusk");
});

test("a passage that starts or ends inside a word is the whole words, read as a reader draws them", () => {
  const text = ["Action Define looks the words up.", "", "- PDF and web pages.", "- **Pe**as and beans, 12 trays."].join("\n");
  const whole = (exact: string) => { const start = text.indexOf(exact), found = wholePassage(text, { start, end: start + exact.length }); return [text.slice(found.span.start, found.span.end), found.words, found.widened]; };
  expect(whole("ction Define")).toEqual(["Action Define", "Action Define", true]);
  expect(whole("DF and web pag")).toEqual(["PDF and web pages", "PDF and web pages", true]);
  // A word cut at a mark is one word; numbers are words; punctuation ends one.
  expect(whole("as and beans, 1")).toEqual(["**Pe**as and beans, 12", "Peas and beans, 12", true]);
  expect(whole("Define looks")).toEqual(["Define looks", "Define looks", false]);
  expect(whole("words up.")).toEqual(["words up.", "words up.", false]);
  // A span that holds nothing a reader draws is answered as it came.
  expect(wholePassage(text, { start: text.indexOf("- PDF"), end: text.indexOf("- PDF") + 2 })).toEqual({ span: { start: text.indexOf("- PDF"), end: text.indexOf("- PDF") + 2 }, words: "", widened: false });
});
