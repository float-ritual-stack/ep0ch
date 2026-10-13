// PIE-800: a `#tag` the service reads as a tag is a link in a note (presentLinks), and only where the tag stands:
// never the head of a longer tag, never in code. The tokens are the service's answer (here a fake board's), never re-parsed.
import { expect, test } from "bun:test";
import { presentLinks, type LinkTarget } from "../src/refs";
import { tokensFor } from "../src/props";

test("a tag the service reads is a link where it stands; #bike in #bikes and a tag in code are text", async () => {
  const text = "Shed jobs #bike\nOil the #bikes and the #bike chain; `#bike` is code; #bike/locks are nested";
  const tokens = [{ key: "tag", value: "bike", syntax: "hashtag" }, { key: "tag", value: "bikes", syntax: "hashtag" }, { key: "tag", value: "bike/locks", syntax: "hashtag" }];
  const board = { propertyRecords: async () => tokens.map((t, i) => ({ ...t, raw: `#${t.value}`, start: 0, end: 0, line: 0, column: 0, placement: "inline", ordinal: i, scope: "block" })) };
  const src = { board: board as never, redraw() {} };
  await tokensFor(text, src);
  const sink: LinkTarget[] = [];
  presentLinks(text, false, src, text, sink);
  expect(sink.map(l => l.tag)).toEqual(["bike", "bikes", "bike", "bike/locks"]);
});
