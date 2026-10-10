import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlockQueryError, BlockQuerySyntaxError, parseQueryExpression, parseSearchExpression, queryRequestProblem } from "../src/block-query";
import { OutlinerStore } from "../src/store";

let root: string;
let store: OutlinerStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "query-atoms-"));
  store = new OutlinerStore(join(root, "outline.sqlite"));
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

const titles = (expression: string, extra: object = {}) =>
  store.queryBlocks({ where: expression, limit: 100, ...extra }).blocks.map(block => block.text.split("\n")[0]!.replace(/\s*\[[\w.-]+::[^\]]*\]/g, ""));

/** A small fictional outline: two pages, a subtree, links, tags and a view. */
function seed() {
  const garden = store.create("Garden beds [page::garden]");
  const projects = store.create("Projects [page::projects]");
  const sub = store.create("Spring plan", projects.id);
  const deep = store.create("Order seeds #jazz/hands [status::open]", sub.id);
  const linked = store.create("Water the [[garden]] weekly #jazz", projects.id);
  const byId = store.create(`Mulch note ((${garden.id}))`);
  const loose = store.create("Weekly review of nothing [status::open]");
  const ticket = store.create("Ticket [page::PIE-9]");
  const mentions = store.create("See PIE-9 and [[PIE-9]]");
  return { garden, projects, sub, deep, linked, byId, loose, ticket, mentions };
}

describe("relation atoms in the query grammar", () => {
  test("#tag matches the tag and its nested tags", () => {
    seed();
    expect(titles("#jazz")).toEqual(["Order seeds #jazz/hands", "Water the [[garden]] weekly #jazz"]);
    expect(titles("#jazz/hands")).toEqual(["Order seeds #jazz/hands"]);
    expect(titles("#jaz")).toEqual([]);
  });

  test("links: follows the reference index for a page, an id and a Work ID", () => {
    const s = seed();
    expect(titles("links:[[garden]]")).toEqual(["Water the [[garden]] weekly #jazz", `Mulch note ((${s.garden.id}))`].map(t => t));
    expect(titles(`links:((${s.garden.id}))`)).toEqual(titles("links:[[garden]]"));
    expect(titles("links:[[ GARDEN ]]").length).toBe(2);
    expect(titles("links:PIE-9")).toContain("See PIE-9 and [[PIE-9]]");
  });

  test("under: is the target's subtree, target included", () => {
    const s = seed();
    expect(titles("under:[[projects]]")).toEqual(["Projects", "Spring plan", "Order seeds #jazz/hands", "Water the [[garden]] weekly #jazz"]);
    expect(titles(`under:((${s.sub.id}))`)).toEqual(["Spring plan", "Order seeds #jazz/hands"]);
  });

  test("title~ and text~ are case-insensitive substrings", () => {
    seed();
    expect(titles("title~WEEKLY")).toEqual(["Water the [[garden]] weekly #jazz", "Weekly review of nothing"]);
    expect(titles('title~"review of"')).toEqual(["Weekly review of nothing"]);
    // The title is the first line without property tokens; text~ reads the whole text.
    expect(titles("title~status")).toEqual([]);
    expect(titles("text~\"ORDER SEEDS\"")).toEqual(["Order seeds #jazz/hands"]);
    expect(titles("text~[status::open] title~order")).toEqual(["Order seeds #jazz/hands"]);
  });

  test("atoms combine with AND, OR, NOT, parentheses and property clauses", () => {
    seed();
    expect(titles("under:[[projects]] NOT links:[[garden]]")).toEqual(["Projects", "Spring plan", "Order seeds #jazz/hands"]);
    expect(titles("#jazz AND status=open")).toEqual(["Order seeds #jazz/hands"]);
    expect(titles("(links:[[garden]] OR title~weekly) NOT #jazz")).toHaveLength(2);
    expect(titles("(links:[[garden]] OR title~weekly) NOT #jazz")).toContain("Weekly review of nothing");
    expect(titles("NOT under:[[projects]] title~garden")).toEqual(["Garden beds"]);
    // The expression survives a request's own filters and text.
    expect(titles("under:[[projects]]", { filters: [{ key: "status" }] })).toEqual(["Order seeds #jazz/hands"]);
  });

  test("a page name with spaces survives groups, and a quoted needle keeps its spaces", () => {
    store.create("Seed shelf [page::seed shelf]");
    store.create("Count the tins on the [[seed shelf]]");
    store.create("The cat sat");
    store.create("Concatenate strings");
    expect(titles("(links:[[seed shelf]] OR #nothing) AND NOT (title~zzz)")).toEqual(["Count the tins on the [[seed shelf]]"]);
    expect(titles('title~" cat "')).toEqual(["The cat sat"]);
    expect(titles("title~cat")).toEqual(["The cat sat", "Concatenate strings"]);
  });

  test("query.matches evaluates the same atoms for given blocks", () => {
    const s = seed();
    const ids = [s.deep.id, s.loose.id, s.linked.id];
    expect(store.matchQuery("under:[[projects]] #jazz", ids).blockIds).toEqual([s.deep.id, s.linked.id]);
    expect(store.matchQuery("links:[[garden]]", ids).blockIds).toEqual([s.linked.id]);
  });

  test("a saved view using under: and links: lists its members, and refines them", () => {
    const s = seed();
    const underView = store.create("Projects view [type::virtual-branch] [query::under:[[projects]] NOT links:[[garden]]]");
    const linksView = store.create("Garden pointers [type::virtual-branch] [query::links:[[garden]]]");
    const members = (id: string) => store.readSavedView(id).blocks.map(b => b.id);
    expect(members(underView.id)).toEqual([s.projects.id, s.sub.id, s.deep.id]);
    expect(members(linksView.id)).toEqual([s.linked.id, s.byId.id]);
  });

  test("a move into a view with under: is already satisfied by a block that is under it", () => {
    const s = seed();
    const view = store.create("Projects view [type::virtual-branch] [query::under:[[projects]]]");
    expect(store.planViewWrites({ viewIds: [view.id], blockId: s.deep.id }).plans[0]!.plan).toEqual({ kind: "already" });
    expect(store.planViewWrites({ viewIds: [view.id], blockId: s.loose.id }).plans[0]!.plan.kind).toBe("refused");
  });

  test("an unresolvable target is a corrective error naming the atom", () => {
    seed();
    let error: unknown;
    try { store.queryBlocks({ where: "links:[[nowhere]]", limit: 5 }); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(BlockQueryError);
    expect(queryRequestProblem(error)).toEqual({ code: "query-invalid", message: expect.stringContaining("links:[[nowhere]] names no block") });
  });
});

describe("atom syntax errors", () => {
  const message = (input: string) => {
    try { parseSearchExpression(input); } catch (error) {
      expect(error).toBeInstanceOf(BlockQuerySyntaxError);
      return (error as Error).message;
    }
    throw new Error(`Expected a syntax error: ${input}`);
  };

  test("each malformed atom names itself and shows a working example", () => {
    expect(message("status=open links:")).toMatch(/links: needs a target.*links:\[\[garden\]\]/);
    expect(message("under:[[x")).toMatch(/unclosed \[\[.*under:\[\[projects\]\]/);
    expect(message("title~")).toMatch(/title~ needs text.*title~roadmap/);
    expect(message("#")).toMatch(/# needs a tag.*#jazz/);
    expect(message("links:garden")).toMatch(/not a target.*Work ID/);
    expect(message('text~"open"x')).toMatch(/after its closing quote/);
  });

  test("an atom's position is reported", () => {
    expect(() => parseQueryExpression("status=open AND links:")).toThrow(/at character 17/);
  });
});
