import { describe, expect, test } from "bun:test";
import { blockRecord, recordJson, recordTime } from "../src/block-record";

// Fictional notes.
const input = {
  block: {
    id: "1111", parentId: "2222", revision: 3, author: "agent", actorId: "planner",
    text: "Seed order [type::errand] - [tag::seeds] [tag::spring]\nAsk [who::Sam] first.\nwhen:: Friday",
    createdAt: "2026-03-09T09:00:00Z", updatedAt: "2026-03-09T09:30:00.5+00:00",
  },
  title: "Seed order",
  properties: [
    { key: "type", value: "errand", scope: "block" as const, line: 0 },
    { key: "tag", value: "seeds", scope: "block" as const, line: 0 },
    { key: "tag", value: "spring", scope: "block" as const, line: 0 },
    { key: "who", value: "Sam", scope: "inline" as const, line: 1 },
    { key: "when", value: "Friday", scope: "line" as const, line: 2 },
  ],
  literal: [],
  children: ["c2", "c1"],
  tasks: [],
  links: [],
  backlinks: ["z9", "a1", "z9"],
  resources: [],
};

describe("a block as a record", () => {
  test("properties as ordered lists, the header and body from the header line, one timestamp format", () => {
    const r = blockRecord(input);
    expect(r.properties).toEqual([{ key: "type", values: ["errand"] }, { key: "tag", values: ["seeds", "spring"] }]);
    expect(r.fields).toEqual([{ key: "who", value: "Sam", scope: "inline", line: 1 }, { key: "when", value: "Friday", scope: "line", line: 2 }]);
    expect(r.header.map(h => h.key)).toEqual(["type", "tag", "tag"]);
    expect(r.body).toBe("Seed order\nAsk [who::Sam] first.\nwhen:: Friday");
    expect([r.created, r.updated]).toEqual(["2026-03-09T09:00:00.000Z", "2026-03-09T09:30:00.500Z"]);
    expect(r.children).toEqual(["c2", "c1"]);              // outline order, as given
    expect(r.backlinks).toEqual(["a1", "z9"]);             // sorted, once each
    expect(r.actor).toBe("planner");
    expect("truncated" in r).toBe(false);
    expect(recordTime(0)).toBe("1970-01-01T00:00:00.000Z");
  });

  test("recordJson: keys sorted at every level, arrays kept in order, the same bytes for the same record", () => {
    const json = recordJson({ b: 1, a: [{ d: 1, c: 2 }] });
    expect(json).toBe('{\n  "a": [\n    {\n      "c": 2,\n      "d": 1\n    }\n  ],\n  "b": 1\n}\n');
    expect(recordJson(blockRecord(input))).toBe(recordJson(blockRecord({ ...input })));
  });
});
