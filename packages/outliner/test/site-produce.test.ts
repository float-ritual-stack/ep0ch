// PIE-533 S3: what a producer in a note asks of its Site. A figure copied onto two pages lists each page's own (also
// drawn through a nesting, with call-site args); `::fields` lists a key's occurrences with the line each is on and
// gains a row when a line is saved; `::if` holds or doesn't; a figure's answer is watched against every change, since a
// query depends on notes it can't name. Fictional notes; a scratch store per test, a service where the wire matters.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SiteAnswer, SiteProduced } from "@ep0ch/outline-core/site";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { answerSite } from "../src/site-answer";
import { queryRequestProblem } from "../src/block-query";
import { siteBudget, StillCounting } from "../src/site-budget";
import { OutlinerStore } from "../src/store";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "site-produce-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  cleanups.push(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return store;
}

const figure = (store: OutlinerStore, blockId: string, props: Record<string, unknown>, extra: Partial<Parameters<typeof answerSite>[1]> = {}, kind = "table") =>
  answerSite(store, { blockId, produce: { kind: "figure", figure: kind, props }, ...extra }).produced as Extract<SiteProduced, { kind: "figure" }>;
const titles = (p: Extract<SiteProduced, { kind: "figure" }>) => (p.blocks as { text: string }[]).map(b => b.text.split("\n")[0]!.split(" [")[0]).sort();

/** Two project pages, and tickets that belong to each (made up). */
function projects(store: OutlinerStore) {
  const lego = store.create("Lego night [project::lego-night]");
  const garden = store.create("Garden [project::garden]");
  store.create("Sort the bricks [type::ticket] [project::lego-night]");
  store.create("Build the tower [type::ticket] [project::lego-night]");
  store.create("Water the beans [type::ticket] [project::garden]");
  return { lego, garden };
}

describe("a figure over this", () => {
  test("one figure copied onto two pages lists each page's own: {{this.project}} is a value operand of the host", () => {
    const store = scratch();
    const { lego, garden } = projects(store);
    const props = { query: "type=ticket project={{this.project}}" };
    expect(titles(figure(store, lego.id, props))).toEqual(["Build the tower", "Sort the bricks"]);
    expect(titles(figure(store, garden.id, props))).toEqual(["Water the beans"]);
  });

  test("drawn through a nesting (a ::use on a host), `this` is the host and not the template", () => {
    const store = scratch();
    const { lego, garden } = projects(store);
    // The template holds the figure; it has no project of its own.
    const template = store.create("Project template [type::template]\n\n::graph-table\n---\nquery: type=ticket project={{this.project}}\n---\n::");
    const props = { query: "type=ticket project={{this.project}}" };
    const through = (host: string) => figure(store, template.id, props, { chain: [{ kind: "use", block: host, line: 3 }] });
    expect(titles(through(lego.id))).toEqual(["Build the tower", "Sort the bricks"]);
    expect(titles(through(garden.id))).toEqual(["Water the beans"]);
    // The template read on its own has no project: said, not an empty list.
    expect(figure(store, template.id, props).error).toMatch(/project/);
  });

  test("an embed starts a fresh Site: the figure in the embedded note reads the embedded note's value", () => {
    const store = scratch();
    const { lego, garden } = projects(store);
    expect(titles(figure(store, garden.id, { query: "type=ticket project={{this.project}}" }, { chain: [{ kind: "embed", block: lego.id }] }))).toEqual(["Water the beans"]);
  });

  test("call-site args are props: ::graph-table{project=lego-night} reads {{props.project}} in its query", () => {
    const store = scratch();
    const { garden } = projects(store);
    const props = { query: "type=ticket project={{props.project}}" };
    expect(titles(figure(store, garden.id, props, { props: { project: ["lego-night"] } }))).toEqual(["Build the tower", "Sort the bricks"]);
    // A value that holds a query clause stays a value.
    expect(figure(store, garden.id, props, { props: { project: ["x OR type=ticket"] } }).blocks).toEqual([]);
    expect(figure(store, garden.id, props).error).toMatch(/props/);
  });

  test("done: and now: say which rows hold; a stat's items count for themselves; a bad sort says whose line it is", () => {
    const store = scratch();
    const { lego } = projects(store);
    store.create("Pour the tea [type::ticket] [project::lego-night] [status::done]");
    const answer = figure(store, lego.id, { query: "type=ticket project={{this.project}}", done: "status=done" }, {}, "check");
    expect(answer.blocks).toHaveLength(3);
    expect(answer.done).toHaveLength(1);
    const stat = figure(store, lego.id, { items: [{ label: "mine", query: "type=ticket project={{this.project}}" }, { label: "all", query: "type=ticket" }] }, {}, "stat");
    expect(stat.counts!.map(c => c.ids.length)).toEqual([3, 4]);
    expect(figure(store, lego.id, { query: "type=ticket", direction: "sideways" }).error).toMatch(/^direction: sideways/);
  });

  test("a clock read in a question (now.time) makes the answer a minute-clock one", () => {
    const store = scratch();
    const { lego } = projects(store);
    const answer = answerSite(store, { blockId: lego.id, produce: { kind: "figure", figure: "table", props: { query: "type=ticket project={{now.time}}" } } });
    expect(answer.clock).toBe("minute");
    expect(answerSite(store, { blockId: lego.id, produce: { kind: "figure", figure: "table", props: { query: "type=ticket project={{this.project}}" } } }).clock).toBeUndefined();
  });

  test("a figure's answer can't name its notes: it is evaluated after any change (a new match elsewhere redraws it)", async () => {
    const directory = mkdtempSync(join(tmpdir(), "site-produce-wire-"));
    const store = new OutlinerStore(join(directory, "outliner.sqlite"));
    const socket = join(directory, "outliner.sock");
    const server = new OutlinerServer(store, socket);
    await server.start();
    cleanups.push(async () => { await server.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
    const { lego } = projects(store);
    const { connect } = await import("node:net");
    const events: any[] = [];
    const lines: ((m: any) => void)[] = [];
    const conn = connect(socket);
    let buffer = "";
    conn.on("data", chunk => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1); const m = JSON.parse(line); if (m.event) events.push(m.event); else lines.shift()?.(m); }
    });
    cleanups.unshift(() => { conn.destroy(); });
    const ask = (request: object) => new Promise<any>(resolve => { lines.push(resolve); conn.write(`${JSON.stringify({ id: crypto.randomUUID(), ...request })}\n`); });
    const request = { action: "site.answer", blockId: lego.id, produce: { kind: "figure", figure: "table", props: { query: "type=ticket project={{this.project}}" } }, watch: "fig" };
    const first = await ask(request);
    expect(first.result.anyChange).toBe(true);
    expect(first.result.produced.blocks).toHaveLength(2);
    // A matching note written somewhere else in the outline: the figure is told.
    store.create("Paint the lid [type::ticket] [project::lego-night]");
    await Bun.sleep(900);
    expect(events.filter(e => e.action === "queries.changed").flatMap(e => e.changes)).toEqual([{ key: "fig", generation: 1 }]);
    const again = await ask({ ...request, generation: 1 });
    expect(again.result.produced.blocks).toHaveLength(3);
    conn.destroy();
    void OutlinerClient;
  });
});

describe("::fields", () => {
  const fixture = (store: OutlinerStore) => store.create([
    "# Vent rail demo [status::active]",
    "",
    "- first pass [connectTo::demonstrating by doing]",
    "- second pass [connectTo::shacks not cathedrals]",
    "storyTime:: remember when",
  ].join("\n"));

  test("one row per occurrence, with its line, the line's text and where it starts", () => {
    const store = scratch();
    const note = fixture(store);
    const answer = answerSite(store, { blockId: note.id, produce: { kind: "fields", key: "connectTo" } });
    const produced = answer.produced as Extract<SiteProduced, { kind: "fields" }>;
    expect(produced.rows.map(r => r.value)).toEqual(["demonstrating by doing", "shacks not cathedrals"]);
    expect(produced.rows.map(r => r.line)).toEqual([2, 3]);
    expect(produced.rows[0]!.mark).toBe("- first pass [connectTo::demonstrating by doing]");
    const text = store.get(note.id)!.text;
    expect(text.slice(produced.rows[1]!.offset!, produced.rows[1]!.offset! + "[connectTo::shacks".length)).toBe("[connectTo::shacks");
    expect(produced.rows.map(r => r.token)).toEqual(["[connectTo::demonstrating by doing]", "[connectTo::shacks not cathedrals]"]);
    expect(produced.revision).toBe(store.get(note.id)!.revision);
    expect(answer.deps).toEqual([note.id]);
  });

  test("a line saved with another occurrence adds a row (the answer follows the text), and a draft is read as typed", () => {
    const store = scratch();
    const note = fixture(store);
    store.update(note.id, `${store.get(note.id)!.text}\n- third pass [connectTo::trust the drift]`, store.get(note.id)!.revision);
    const rows = (answerSite(store, { blockId: note.id, produce: { kind: "fields", key: "connectTo" } }).produced as Extract<SiteProduced, { kind: "fields" }>).rows;
    expect(rows.map(r => r.value)).toEqual(["demonstrating by doing", "shacks not cathedrals", "trust the drift"]);
    const draft = (answerSite(store, { blockId: note.id, draft: { text: "Typed\n\n- only [connectTo::typed, not saved]" }, produce: { kind: "fields", key: "connectTo" } }).produced as Extract<SiteProduced, { kind: "fields" }>).rows;
    expect(draft.map(r => r.value)).toEqual(["typed, not saved"]);
  });

  test("a draft's fields come with the draft's own offsets, tokens and no saved revision to anchor against", () => {
    const store = scratch();
    const note = fixture(store);
    const draft = "Typed\n\n- moved up [connectTo::now first]\n- first pass [connectTo::demonstrating by doing]";
    const produced = answerSite(store, { blockId: note.id, draft: { text: draft }, produce: { kind: "fields", key: "connectTo" } }).produced as Extract<SiteProduced, { kind: "fields" }>;
    expect(produced.rows.map(r => draft.slice(r.offset!, r.offset! + r.token!.length))).toEqual(produced.rows.map(r => r.token!));
    expect(produced.rows[0]!.token).toBe("[connectTo::now first]");
    expect(produced.revision).toBe(0);
  });

  test("of another note, a key nobody wrote, and the values that are links", () => {
    const store = scratch();
    const note = fixture(store);
    const other = store.create("Other\n\nsee [connectTo::[[Vent rail]]]");
    store.create("Vent rail [page::Vent rail]");
    const of = answerSite(store, { blockId: other.id, produce: { kind: "fields", key: "connectTo", of: note.id } }).produced as Extract<SiteProduced, { kind: "fields" }>;
    expect(of.rows).toHaveLength(2);
    expect(of.from).toBe(note.id);
    const own = answerSite(store, { blockId: other.id, produce: { kind: "fields", key: "connectTo" } }).produced as Extract<SiteProduced, { kind: "fields" }>;
    expect(own.rows[0]!.link?.title).toBe("Vent rail");
    expect(own.rows[0]!.token).toBe("[connectTo::[[Vent rail]]]");
    const none = answerSite(store, { blockId: note.id, produce: { kind: "fields", key: "nope" } }).produced as Extract<SiteProduced, { kind: "fields" }>;
    expect(none.rows).toEqual([]);
  });
});

describe("::if", () => {
  test("holds when this matches the query, and not when it doesn't; a value operand reads the Site", () => {
    const store = scratch();
    const note = store.create("Rail [status::active] [owner::evan]");
    const holds = (where: string, id = note.id, extra = {}) => (answerSite(store, { blockId: id, produce: { kind: "if", where }, ...extra }).produced as Extract<SiteProduced, { kind: "if" }>);
    expect(holds("status=active").holds).toBe(true);
    expect(holds("status=paused").holds).toBe(false);
    expect(holds("status=active owner=evan").holds).toBe(true);
    expect(holds("status=active NOT owner=evan").holds).toBe(false);
    expect(holds("owner={{this.owner}}").holds).toBe(true);
    expect(holds("owner={{props.who}}", note.id, { props: { who: ["lee"] } }).holds).toBe(false);
    expect(holds("owner={{props.who}}", note.id, { props: { who: ["evan"] } }).holds).toBe(true);
    // A query the service can't read is said, with an example, and the body stays hidden.
    const bad = holds("deleted=true");
    expect(bad.holds).toBe(false);
    expect(bad.problem?.message).toBeTruthy();
  });

  test("a note with no such key is false (not an error), and it follows the note on save", () => {
    const store = scratch();
    const note = store.create("Rail");
    const holds = () => (answerSite(store, { blockId: note.id, produce: { kind: "if", where: "status=active" } }).produced as Extract<SiteProduced, { kind: "if" }>).holds;
    expect(holds()).toBe(false);
    store.update(note.id, "Rail [status::active]", store.get(note.id)!.revision);
    expect(holds()).toBe(true);
  });
});

describe("children rows", () => {
  test("a note's child bullets, the comments and the proposals beside it left out", () => {
    const store = scratch();
    const note = store.create("Checklist");
    store.create("first step", note.id);
    store.create("second step", note.id);
    store.create("a comment [type::annotation]", note.id);
    store.create("a proposal [type::draft-proposal]", note.id);
    const produced = answerSite(store, { blockId: note.id, produce: { kind: "children" } }).produced as Extract<SiteProduced, { kind: "children" }>;
    expect((produced.blocks as { text: string }[]).map(b => b.text)).toEqual(["first step", "second step"]);
  });
});

void (null as unknown as SiteAnswer);

describe("an answer past its time budget (PIE-1047)", () => {
  test("a per-item figure that runs out of time stops with still counting, which the wire carries as its code", () => {
    const store = scratch();
    const { lego } = projects(store);
    const ask = { blockId: lego.id, produce: { kind: "figure" as const, figure: "stat", props: { items: [{ label: "Tickets", query: "type=ticket" }, { label: "Lego", query: "project=lego-night" }] } } };
    // Within its budget it answers; one already spent stops at the first item, naming it, instead of holding the host.
    expect((answerSite(store, ask, Date.now, siteBudget()).produced as Extract<SiteProduced, { kind: "figure" }>).counts?.map(c => c.ids.length)).toEqual([3, 3]);
    let stopped: unknown;
    try { answerSite(store, ask, Date.now, siteBudget(1, performance.now() - 10)); } catch (error) { stopped = error; }
    expect(stopped).toBeInstanceOf(StillCounting);
    expect((stopped as Error).message).toStartWith("still counting: counting Tickets took more than 0.001 s");
    expect(queryRequestProblem(stopped)).toMatchObject({ code: "still-counting" });
  });
});
