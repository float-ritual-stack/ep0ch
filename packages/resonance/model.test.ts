import { describe, expect, test } from "bun:test";
import { edgesFor, shortestRoute, arrange, type BlockRecord } from "./model";

function record(id: string, targets: string[] = [], parent: string | null = null): BlockRecord {
  return { id, parent, title: id, text: id, body: id, header: [], properties: [], fields: [], children: [], tasks: [],
    links: targets.map(target => ({ kind: "block", text: target, label: target, target, status: "resolved", spans: [], bodySpans: [] })),
    backlinks: [], resources: [], created: "2041-01-01T00:00:00Z", updated: "2041-01-01T00:00:00Z", author: "user", actor: null, revision: 1 };
}

describe("reading routes through authored evidence", () => {
  test("chooses the shorter reference route, can navigate backwards, and never shortcuts through a common notebook", () => {
    const notes = [record("book"), record("a", ["b"], "book"), record("b", ["c"]), record("c", ["d"]), record("d", ["e"], "book"), record("e", ["a"])];
    const edges = edgesFor(notes);
    expect(shortestRoute(notes, edges, "a", "d")).toEqual(["a", "e", "d"]);
    expect(shortestRoute(notes, edges, "d", "a")).toEqual(["d", "e", "a"]);
    expect(shortestRoute(notes, edges, "book", "a")).toEqual([]);
  });
  test("refuses to invent a bridge through a note outside the visible answer or a shared folder", () => {
    const notes = [record("book"), record("a", ["missing"], "book"), record("b", ["missing"], "book")];
    expect(shortestRoute(notes, edgesFor(notes), "a", "b")).toEqual([]);
    expect(shortestRoute(notes, edgesFor(notes), "a", "missing")).toEqual([]);
    expect(shortestRoute(notes, edgesFor(notes), "a", "a")).toEqual(["a"]);
  });
  test("chronology displays authored event time, not when the demo inserted the records", () => {
    const later = record("later"), earlier = record("earlier");
    later.properties = [{ key: "when", values: ["2041-06-27"] }];
    earlier.properties = [{ key: "when", values: ["2041-06-01"] }];
    const points = arrange([later, earlier], [], "chronology", []);
    expect(points.get("earlier")!.x).toBeLessThan(points.get("later")!.x);
  });
  test("missing and invalid dates stay outside the event chronology rather than borrowing ingestion time", () => {
    const dated = record("dated"), missing = record("missing"), invalid = record("invalid");
    dated.properties = [{ key: "when", values: ["2041-06-12"] }];
    invalid.properties = [{ key: "when", values: ["unknown"] }];
    const points = arrange([dated, missing, invalid], [], "chronology", []);
    expect(points.get("missing")!.y).toBeGreaterThan(points.get("dated")!.y);
    expect(points.get("invalid")!.y).toEqual(points.get("missing")!.y);
    expect(points.get("missing")!.x).not.toEqual(points.get("invalid")!.x);
  });
});
