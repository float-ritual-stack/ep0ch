import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bindExtensions } from "../../src/extensions";
import { Desk } from "../../src/desk/desk";
import { afterEach, describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { FacetsPane } from "../../src/desk/facets";
import { facetSource, facetSources } from "../../src/facet-sources";
import { USER } from "../../src/socket";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("showcase: facets over sources", () => {
  const h = useShowcaseScreen(177);

  const catalogues: string[] = [];
  afterEach(async () => {
    for (const id of catalogues.splice(0)) {
      await h.app.dispatch.act({ action: "extensions.uninstall", args: { id, demo: "remove" } }, USER);
      await h.app.loadExtensions(true);
    }
  });

  async function catalogue(id: string, answer: string) {
    const folder = join(h.scratch.workspace, "extensions", id);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "extension.json"), JSON.stringify({ contract: 2, id, version: 1, name: id, run: ["bun", "rows.ts"],
      actions: [{ id: "rows", label: "Read rows", on: "outline", effects: "read" }], facetSources: [{ id: "seeds", title: id, read: "rows" }] }));
    writeFileSync(join(folder, "rows.ts"), `await Bun.stdin.json(); console.log(JSON.stringify({ok:true,value:{answer:${JSON.stringify(answer)}}}));`);
    catalogues.push(id);
    await h.app.loadExtensions(true);
    return `ext.${id}.seeds`;
  }

  test("switching to a broken source clears the previous notes and pins", async () => {
    const source = await catalogue("broken-seeds", "not JSON");
    await h.app.act({ action: "section", args: { name: "facets" }, as: "facet-builder" });
    const desk = h.S().stages.get(h.S().sel).top;
    const act = (action: string, args: Record<string, unknown> = {}) => desk.dispatch.act({ action, args, tile: "tags" }, USER);
    const pane: FacetsPane = desk.paneNamed("tags");
    await act("facets.source", { source: "notes" });
    const old = pane.notes()[0]!;
    await act("facets.pin", { id: old.id, on: true });
    try {
      await act("facets.source", { source });
      expect(pane.describe().error).toBeTruthy();
      expect(pane.describe().notes).toEqual([]);
      expect(pane.describe().matches.groups).toEqual([]);
      expect([...pane.pinnedIds()]).toEqual([]);
      await expect(pane.openRow(old, desk, USER)).rejects.toThrow(/no longer.*source/);
    } finally { await act("facets.source", { source: "notes" }); }
  }, 60_000);

  test("a restored facets tile recovers when its extension sources bind", async () => {
    bindExtensions(null);
    const desk = new Desk({ name: "restored-facets", title: "Restored facets", layout: { root: { t: "leaf", kind: "facets", name: "seeds", source: "ext.facet-garden.seeds" } } });
    h.app.push(desk); desk.render(h.app);
    try {
      const pane = desk.paneNamed("seeds") as FacetsPane;
      await until(() => !!pane.describe().error, "source unavailable before registration");
      await h.app.loadExtensions(true);
      await until(() => pane.notes().some(n => n.id === "bean-runner"), "restored extension rows without a manual refresh");
      expect(pane.describe().error).toBeUndefined();
    } finally { h.app.pop(); }
  }, 60_000);

  test("extension rows keep the repeated-value message contract", async () => {
    await h.app.act({ action: "section", args: { name: "facets" }, as: "facet-builder" });
    const desk = h.S().stages.get(h.S().sel).top;
    await desk.dispatch.act({ action: "facets.source", args: { source: "ext.facet-garden.seeds" }, tile: "tags" }, USER);
    const pane: FacetsPane = desk.paneNamed("tags");
    expect(pane.notes().find(n => n.id === "bean-runner")!.properties.filter(p => p.key === "colour")).toEqual([{ key: "colour", value: "red" }, { key: "colour", value: "green" }]);
  }, 60_000);

  test("extension property names follow the query grammar", async () => {
    const at = new Date().toISOString();
    const source = await catalogue("mixed-keys", JSON.stringify([{ id: "seed", title: "Seed", createdAt: at, updatedAt: at, properties: { Status: ["open"], status: ["ready"] } }]));
    await h.app.act({ action: "section", args: { name: "facets" }, as: "facet-builder" });
    const desk = h.S().stages.get(h.S().sel).top;
    const act = (action: string, args: Record<string, unknown> = {}) => desk.dispatch.act({ action, args, tile: "tags" }, USER);
    await act("facets.source", { source });
    await act("facets.query", { text: "Status=open status=ready" });
    expect((await act("facets.list")).notes.map((n: { id: string }) => n.id)).toEqual(["seed"]);
    await act("facets.source", { source: "notes" });
  }, 60_000);

  test("invalid extension dates omit the bad rows with one visible explanation", async () => {
    const at = new Date().toISOString();
    const source = await catalogue("dated-seeds", JSON.stringify([
      { id: "good", title: "Good seed", createdAt: at, updatedAt: at, properties: { status: ["open"] } },
      { id: "bad", title: "Bad seed", createdAt: at, updatedAt: "yesterday", properties: { status: ["open"] } },
      { id: "bad-created", title: "Bad creation", createdAt: "yesterday", updatedAt: at, properties: { status: ["open"] } },
    ]));
    await h.app.act({ action: "section", args: { name: "facets" }, as: "facet-builder" });
    const desk = h.S().stages.get(h.S().sel).top;
    const act = (action: string, args: Record<string, unknown> = {}) => desk.dispatch.act({ action, args, tile: "tags" }, USER);
    await act("facets.source", { source });
    await act("facets.set", { key: "status", value: "open" });
    await act("facets.query", { text: "status=open" });
    expect((await act("facets.list")).notes.map((n: { id: string }) => n.id)).toEqual(["good"]);
    const pane: FacetsPane = desk.paneNamed("tags");
    expect(pane.render(120, 40, true, desk).lines.join("\n")).toContain("invalid dates");
    await act("facets.source", { source: "notes" });
  }, 60_000);

  test("text comparisons agree for multi-value notes and extension rows", async () => {
    await h.app.act({ action: "section", args: { name: "facets" }, as: "facet-builder" });
    const desk = h.S().stages.get(h.S().sel).top;
    const note = await h.board.createBlock(null, 'Runner beans [family::beans/runner] [colour::["red","green"]]');
    for (const [comparison, matches] of [["colour > blue", true], ["NOT colour > blue", false], ["colour < blue", false], ["NOT colour < blue", true]] as const) {
      const where = `family=beans/runner ${comparison}`;
      for (const [source, id] of [["ext.facet-garden.seeds", "bean-runner"], ["notes", note.id]]) {
        const answer = await facetSource(source!).query({ where, limit: 200 }, desk);
        expect(answer.rows.some(row => row.id === id), `${source}: ${where}`).toBe(matches);
      }
    }
  }, 60_000);

  test("an unbound operand says it needs context on every source", async () => {
    await h.app.act({ action: "section", args: { name: "facets" }, as: "facet-builder" });
    const desk = h.S().stages.get(h.S().sel).top;
    for (const source of ["notes", "ext.facet-garden.seeds", "trail"]) {
      await expect(facetSource(source).query({ where: "family={{this.family}}", limit: 200 }, desk))
        .rejects.toThrow("{{this.family}} reads the note this query sits in; this query has none (pass this=<block id>)");
    }
  }, 60_000);

  test("a saved view restores its source as well as its query", async () => {
    await h.app.act({ action: "section", args: { name: "facets" }, as: "facet-builder" });
    const desk = h.S().stages.get(h.S().sel).top;
    const act = (action: string, args: Record<string, unknown> = {}) => desk.dispatch.act({ action, args, tile: "tags" }, USER);
    const pane: FacetsPane = desk.paneNamed("tags");
    await act("facets.source", { source: "ext.facet-garden.seeds" });
    await act("facets.query", { text: "family=beans/runner" });
    const saved = await act("facets.save", { name: "Runner seed search" });
    await act("facets.source", { source: "notes" });
    await act("facets.view", { id: saved.id });
    expect(pane.sourceId).toBe("ext.facet-garden.seeds");
    expect(pane.notes().map(n => n.id)).toEqual(["bean-runner"]);
    const notesView = await h.board.createBlock(null, 'Notebook search [type::virtual-branch] [query::title~"Allotment notebook"]');
    await act("facets.view", { id: notesView.id });
    expect(pane.sourceId).toBe("notes");
    expect(pane.notes().some(n => n.id === h.seeded.notes.notebook.id)).toBe(true);
  }, 60_000);

  test("trail facets beside a reader refresh when a new visit lands", async () => {
    await h.app.act({ action: "section", args: { name: "facets" }, as: "facet-builder" });
    const desk = h.S().stages.get(h.S().sel).top;
    const act = (action: string, args: Record<string, unknown> = {}, tile = "tags") => desk.dispatch.act({ action, args, tile }, USER);
    await act("facets.source", { source: "trail" });
    await act("facets.query", { text: "" });
    await act("open", { id: h.seeded.notes.trailGate.id }, "reader");
    const visit = h.app.trail.current(desk.tileIdOfPane(desk.paneNamed("reader")))!;
    const pane: FacetsPane = desk.paneNamed("tags");
    await until(() => pane.notes().some(n => n.id === visit.open.target.visit), "new visit in the open facets tile", 3000);
    await act("tile.open", { kind: "trail", name: "visit-history", where: "down" });
    await act("trail.forget", { visit: visit.open.target.visit }, "visit-history");
    await until(() => !pane.notes().some(n => n.id === visit.open.target.visit), "forgotten visit removed from facets", 3000);
  }, 60_000);

  test("trail facets keep visits distinct and reopen a held visit where it was", async () => {
    await h.app.act({ action: "section", args: { name: "facets" }, as: "facet-builder" });
    const desk = h.S().stages.get(h.S().sel).top;
    const act = (action: string, args: Record<string, unknown> = {}, tile = "tags") => desk.dispatch.act({ action, args, tile }, USER);
    await act("open", { id: h.seeded.notes.notebook.id }, "reader");
    await act("open", { id: h.seeded.notes.trailGate.id }, "reader");
    await act("open", { id: h.seeded.notes.notebook.id }, "reader");
    const catalogue = await h.board.createBlock(null, "Catalogued beans");
    const gate = await h.board.createBlock(null, `Catalogue gate\n((${catalogue.id}|Beans))`);
    await act("tile.open", { kind: "backlinks", name: "links", source: "tile:reader", where: "down" });
    await act("tile.link", { to: "reader", verb: "select" }, "links");
    await act("backlinks", { id: gate.id }, "links");
    const links = desk.paneNamed("links");
    await until(() => { h.screen(); return links.rows().some((r: { kind: string }) => r.kind === "outlink"); }, "the catalogue link");
    await act("list.pick", { n: links.rows().findIndex((r: { kind: string }) => r.kind === "outlink") + 1 }, "links");
    await until(() => h.app.trail.current(desk.tileIdOfPane(desk.paneNamed("reader")))?.open.source?.tile === desk.tileIdOfPane(links), "link preview landing");
    const visit = h.app.trail.current(desk.tileIdOfPane(desk.paneNamed("reader")))!;
    h.app.trail.configure({ held: 0.01 });
    await until(() => h.app.trail.dwell(visit) === "held", "held visit");
    await act("tile.open", { kind: "facets", name: "history-facets", source: "trail", where: "down" });
    // Yesterday's timestamp is a fixture fact; the visit itself arrived through the real link path.
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    visit.open.at = +yesterday;
    await act("facets.set", { key: "dwell", value: "held", mode: "include" }, "history-facets");
    await act("facets.set", { key: "day", value: "yesterday", mode: "include" }, "history-facets");
    await act("facets.set", { key: "from-tile", value: "links", mode: "include" }, "history-facets");
    const listed = await act("facets.list", {}, "history-facets");
    expect(listed.notes.map((n: { id: string }) => n.id)).toEqual([visit.open.target.visit]);
    await act("facets.open", { id: visit.open.target.visit }, "history-facets");
    expect(desk.paneNamed("reader").msg.id).toBe(catalogue.id);
  }, 60_000);
  test("the showcase switches sources by key, click and act, and saves an extension search", async () => {
    await h.app.act({ action: "section", args: { name: "facets" }, as: "facet-builder" });
    const desk = h.S().stages.get(h.S().sel).top;
    const act = (action: string, args: Record<string, unknown> = {}) => desk.dispatch.act({ action, args, tile: "tags" }, USER);
    const pane: FacetsPane = desk.paneNamed("tags");
    await act("tile.focus");
    h.press({ kind: "enter" });
    await act("facets.source", { source: "notes" });
    await act("facets.query", { text: 'title~"Allotment notebook"' });
    expect(pane.notes().some(n => n.id === h.seeded.notes.notebook.id)).toBe(true);
    h.ch("S");
    await until(() => pane.sourceId === "trail" && pane.describe().matched > 0, "S switches to the trail");
    // The source header is drawn by the tile; the click goes through its normal mouse path.
    const frame = pane.render(72, 32, true, desk);
    const y = frame.lines.findIndex(line => line.includes("source:"));
    expect(y).toBeGreaterThanOrEqual(0);
    pane.mouse({ kind: "mouse", action: "down", button: 0, x: 10, y }, 10, y, desk);
    await until(() => pane.sourceId === "ext.facet-garden.seeds" && pane.notes().some(n => n.id === "bean-runner"), "click switches to the installed extension");
    await act("facets.set", { key: "family", value: "beans", mode: "include" });
    await act("facets.set", { key: "colour", value: "red", mode: "include" });
    expect(pane.notes().map(n => n.id)).toEqual(["bean-runner"]);
    await act("facets.set", { key: "colour", value: "red", mode: "exclude" });
    expect(pane.notes().map(n => n.id)).toEqual(["bean-dwarf"]);
    await act("facets.query", { text: 'family=beans/* NOT colour=red' });
    const saved = await act("facets.save", { name: "Green beans" });
    const note = await h.board.get(saved.id);
    expect(note?.text).toContain("[facet-source::ext.facet-garden.seeds]");
    expect(note?.text).toContain("Open facets");
    await act("facets.source", { source: "notes" });
    await h.app.dispatch.act({ action: "button.press", args: { note: saved.id, label: "Open facets" } }, USER);
    const opened = () => desk.describe().panes.find((p: { source?: string; query?: string }) => p.source === "ext.facet-garden.seeds" && p.query === "family=beans/* NOT colour=red");
    await until(() => !!opened(), "saved facets opened").catch(e => { throw new Error(`${e.message}: ${JSON.stringify({ panes: desk.describe().panes.map((p: any) => ({ name: p.name, kind: p.kind, source: p.source, query: p.query })), messages: h.app.describe().messages.slice(-3) })}`); });
    expect(opened()).toBeDefined();
    await act("facets.source", { source: "trail" });
    await act("facets.query", { text: "day=today" });
    expect(pane.notes().length).toBeGreaterThan(0);
    await act("facets.source", { source: "notes" });
    await act("facets.query", { text: 'title~"Allotment notebook"' });
    expect(pane.notes().some(n => n.id === h.seeded.notes.notebook.id)).toBe(true);
  }, 60_000);

  test("the example installs by act and the power bar click, then removal unbinds its source", async () => {
    const run = (action: string, args: Record<string, unknown>) => h.app.dispatch.act({ action, args }, USER);
    await run("extensions.uninstall", { id: "facet-garden", demo: "remove" });
    await h.app.loadExtensions(true);
    await until(() => !facetSources().some(s => s.id === "ext.facet-garden.seeds"), "extension source unbound");
    const installed = await run("extensions.install", { id: "facet-garden" });
    expect(installed).toMatchObject({ state: "active" });
    await h.app.loadExtensions(true);
    await until(() => facetSources().some(s => s.id === "ext.facet-garden.seeds"), "installed source bound");
    await run("extensions.uninstall", { id: "facet-garden", demo: "remove" });
    await h.app.loadExtensions(true);
    await until(() => !facetSources().some(s => s.id === "ext.facet-garden.seeds"), "source removed before install picker");
    await h.app.dispatch.press("bar.open", { scope: "&", query: "Garden seed facets" });
    await until(() => !!h.app.bar?.items.some(i => i.row.key === "install:facet-garden"), "the install row");
    (h.app as any).paint();
    const plain = (s: string) => s.replace(/\x1b\[[\d;:]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
    const y = h.painted.findIndex(line => plain(line).includes("install Garden seed facets"));
    expect(y).toBeGreaterThanOrEqual(0);
    const x = plain(h.painted[y]!).indexOf("install Garden seed facets") + 2;
    for (let i = 0; i < 2; i++) {
      h.press({ kind: "mouse", action: "down", button: 0, x, y });
      h.press({ kind: "mouse", action: "up", button: 0, x, y });
    }
    await until(() => !h.app.bar || h.app.bar.ended(), "the install click");
    await h.app.loadExtensions(true);
    const desk = h.S().stages.get(h.S().sel).top;
    await until(() => facetSources().some(s => s.id === "ext.facet-garden.seeds"), "click installed source bound");
    await desk.dispatch.act({ action: "facets.source", args: { source: "ext.facet-garden.seeds" }, tile: "tags" }, USER);
    await desk.dispatch.act({ action: "facets.query", args: { text: 'season=autumn' }, tile: "tags" }, USER);
    expect((desk.paneNamed("tags") as FacetsPane).notes().map(n => n.id)).toEqual(["lettuce-red"]);
    await run("extensions.uninstall", { id: "facet-garden", demo: "remove" });
    await h.app.loadExtensions(true);
    await until(() => !facetSources().some(s => s.id === "ext.facet-garden.seeds"), "removed source unbound");
    await desk.dispatch.act({ action: "facets.reload", tile: "tags" }, USER);
    expect((desk.paneNamed("tags") as FacetsPane).describe().error).toContain("unavailable");
    expect(h.screen()).toContain("unavailable");
  }, 60_000);

});
