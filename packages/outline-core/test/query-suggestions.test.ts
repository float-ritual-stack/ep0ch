import { describe, expect, test } from "bun:test";
import { querySuggestions, type PropertyCatalog } from "../src/query-suggestions";
import { QUERY_ATOM_HELP } from "../src/query-atoms";
import { QUERY_DATE_HELP, readDateBound } from "../src/dates";

const rows = [
  { key: "type", value: "meeting", count: 4 }, { key: "type", value: "request", count: 2 },
  { key: "owner", value: "ada", count: 3 }, { key: "when", value: "2031-03-02", count: 1 },
];
const catalog: PropertyCatalog = async (key, prefix) => rows.filter(r => (key ? r.key === key && r.value.startsWith(prefix) : r.key.startsWith(prefix)));
const ask = async (typed: string) => querySuggestions(typed, catalog);
const values = async (typed: string) => (await ask(typed)).map(r => r.value);

describe("query completion says what the grammar can say", () => {
  test("an empty query offers the atoms, NOT and the outline's keys, each described by the grammar", async () => {
    const got = await ask("");
    const v = got.map(r => r.value);
    for (const head of ["#", "links:", "linkedfrom:", "under:", "parent:", "child:", "title~", "text~", "by:", "call:", "NOT"]) expect(v).toContain(head);
    expect(v).toContain("type=meeting");
    expect(v).not.toContain("AND");
    expect(got.find(r => r.value === "under:")!.detail).toBe(QUERY_ATOM_HELP.find(h => h.atom === "under:<target>")!.gist);
  });
  test("an atom's target is this, a reader is me, by: takes an author", async () => {
    expect(await values("type=meeting AND under:t")).toEqual(["type=meeting AND under:this"]);
    expect(await values("links:")).toEqual(["links:this"]);
    expect(await values("by:ag")).toEqual(["by:agent"]);
    expect(await values("unread:")).toEqual(["unread:me"]);
  });
  test("AND and OR follow a clause; only NOT or a clause follows AND", async () => {
    expect(await values("type=meeting O")).toEqual(["type=meeting OR"]);
    expect(await values("type=meeting N")).toEqual(["type=meeting NOT"]);
    expect(await values("type=meeting AND O")).toEqual([]);
  });
  test("a comparison offers relative dates, apart or together; a counted child: is no comparison", async () => {
    expect(await values("updated >= ")).toEqual(QUERY_DATE_HELP.map(d => `updated >= ${d.word}`));
    expect(await values("created>=-")).toEqual(QUERY_DATE_HELP.filter(d => d.word.startsWith("-")).map(d => `created>=${d.word}`));
    expect(await values("due <= to")).toEqual(["due <= today", "due <= tomorrow"]);
    expect(await values("child>=2:ty")).toEqual(["child>=2:type=meeting", "child>=2:type=request"]);
    for (const d of QUERY_DATE_HELP) expect(readDateBound(d.word, 0)).not.toBeNull();
  });
  test("a value may read this note; a range key offers a ready range", async () => {
    expect(await values("owner={{")).toEqual(["owner={{this.owner}}", "owner={{this.page}}"]);
    expect(await values("when=")).toContain("when={{this.page}}");
    expect(await values("upd")).toEqual(["updated >= -7d"]);
  });
  test("inside an open quote nothing is offered", async () => {
    expect(await ask('title~"weekly rev')).toEqual([]);
  });
});
