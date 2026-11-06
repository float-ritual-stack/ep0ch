// PIE-1589: a comment or reply is a heading, the store's metadata line, then the person's words, with no blank line
// between them. Those words are never the mark's front matter: a chip quoted in them stays words.
import { expect, test } from "bun:test";
import { frontMatterLines } from "../src/header-line";
import { parseProperties, parsePropertyRecords } from "../src/property-parse";
import { markBodyLine, markTitleLine } from "../src/annotation-marks";

const reply = (body: string) => `Comment on “Seed order”\n[type::annotation-reply] [annotation-source::agent] [annotation-status::open] [parent-annotation::t1] [kind::note]\n${body}`;
const keys = (text: string) => parseProperties(text).map(p => p.key);

test("a chip in a reply's words, on any line of them, isn't the reply's property", () => {
  for (const body of ["quoting [orient::all] here", "[orient::all]", "first\nthen [page::x] and\n[type::day]"]) {
    expect(keys(reply(body))).toEqual(["type", "annotation-source", "annotation-status", "parent-annotation", "kind"]);
  }
  expect(parsePropertyRecords(reply("quoting [orient::all] here")).find(p => p.key === "orient")?.scope).toBe("inline");
  // A later chip with the same key never overrides the store's own.
  expect(parseProperties(reply("[type::day]")).find(p => p.key === "type")?.value).toBe("annotation-reply");
});

test("a bare key:: line in a comment's words is a line's, not the comment's", () => {
  expect(parsePropertyRecords(reply("orient:: all")).find(p => p.key === "orient")?.scope).toBe("line");
});

test("a mark's front matter is its heading and its metadata line, whatever follows", () => {
  expect([...frontMatterLines(reply("one\ntwo"))]).toEqual([0, 1]);
  expect(markBodyLine(reply("one"))).toBe(2);
  expect(markBodyLine("Comment\n[type::annotation]")).toBe(2);
  expect(markTitleLine(reply("[orient::all]\nthe words"))!.text).toBe("the words");
});

test("a note isn't a mark: its first paragraph keeps its chips, as PIE-684 has it", () => {
  const note = "Seed order [type::errand]\nAsk [who::Sam] first.\n[due::Friday]\n\nLater [not::this]";
  expect(markBodyLine(note)).toBeNull();
  expect(keys(note)).toEqual(["type", "who", "due"]);
  // A heading like a mark's over a line that isn't the store's is a note too.
  expect(keys("Comment on “seeds”\nAsk [who::Sam] first.")).toEqual(["who"]);
});
