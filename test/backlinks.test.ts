// PIE-442: backlinks you can use. src/backlinks.ts mirrors Detail's backlink view (pi-herdr-outliner
// src/backlink-view.ts) and its panel's text (src/detail-pi-preview.ts); these tests check it against the
// outliner's own functions over fictional sources and every option, then drive the board's drawer against
// a scratch service: the defaults, filter and sort, the toggles by key, click and act, and an older service.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import {
  backlinkGroupRows, backlinkOptionsFrom, backlinkRows, backlinkRowSuffix, backlinkStageSummary, backlinkStatusParts, backlinkView,
  BACKLINK_SORT_ORDER, BACKLINK_STAGE_FILTERS, DEFAULT_BACKLINK_VIEW_OPTIONS, fitBacklinkRow, nextBacklinkKindFilter, nextBacklinkSort,
  nextBacklinkStageFilter, type BacklinkCollection, type BacklinkSource, type BacklinkSourceFacets, type BacklinkView, type BacklinkViewOptions,
} from "../src/backlinks";
import { DeliveryBoard } from "../src/desk/delivery";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";
import * as BV from "./board-view";

// ── fictional sources ──────────────────────────────────────────────────────────────────────────────

let n = 0;
const src = (title: string, facets: BacklinkSourceFacets | undefined, o: { updated?: string; created?: string; ctx?: string; refs?: BacklinkSource["referenceGroups"]; snippet?: string; trash?: boolean } = {}): BacklinkSource => {
  n += 1;
  return {
    blockId: `b${String(n).padStart(3, "0")}-0000-4000-8000-000000000000`,
    title, parentContext: o.ctx ?? "Garden › Jobs",
    createdAt: o.created ?? `2026-03-${String(10 + (n % 9)).padStart(2, "0")}T09:00:00.000Z`,
    updatedAt: o.updated ?? `2026-04-${String(1 + (n % 7)).padStart(2, "0")}T12:00:00.000Z`,
    occurrenceCount: 1,
    referenceGroups: o.refs ?? [{ kind: "block", count: 1 }],
    occurrences: [{ kind: "block", label: "Seed swap", snippet: o.snippet ?? `${title} mentions the seed swap`, start: 0, end: 9 }],
    occurrencesTruncated: false,
    ...(o.trash ? { deletedRootId: "trash-root" } : {}),
    ...(facets ? { facets } : {}),
  };
};
const outbox = (stage: string, bucket?: BacklinkSourceFacets["stage"] extends infer S ? S extends { bucket?: infer B } ? B : never : never): BacklinkSourceFacets =>
  ({ kind: "outbox-item", kindLabel: "Outbox item", placement: "other", stage: { property: "outbox", value: stage, ...(bucket ? { bucket } : {}) } });
const note = (placement: BacklinkSourceFacets["placement"] = "other"): BacklinkSourceFacets => ({ kind: "note", kindLabel: "Note", placement });
const comment = (resolved: boolean, placement: BacklinkSourceFacets["placement"] = "other"): BacklinkSourceFacets => ({ kind: "comment", kindLabel: "Comment", placement, comment: { resolved } });

function fixture(): BacklinkCollection {
  n = 0;
  const sources = [
    src("Ask Ana about bean seed", outbox("waiting", "waiting"), { refs: [{ kind: "work-id", count: 2 }] }),
    src("ask ana about the tomato tins", outbox("waiting", "waiting"), { updated: "2026-04-03T12:00:00.000Z" }),
    src("Offer spare onion sets", outbox("draft", "draft")),
    src("Thank the swap hosts", outbox("sent", "done"), { updated: "2026-04-03T12:00:00.000Z" }),
    src("Thank the swap hosts", outbox("sent", "done"), { updated: "2026-04-03T12:00:00.000Z" }),
    src("Old tray list", outbox("queued-ish")),                                    // a stage value no bucket names
    src("Seed swap", note("self"), { refs: [{ kind: "page", count: 1 }] }),
    src("Table plan for the swap", note("descendant")),
    src("Bring labels", comment(false, "descendant")),
    src("Gate code note", comment(true)),
    src("Too many courgettes", comment(false), { refs: [{ kind: "property", propertyKey: "related", count: 1 }] }),
    src("Saturday 14 March", { kind: "day-page", kindLabel: "Day page", placement: "other" }),
    src("Rota for the stall", note(), { trash: true }),
    src("Kettle job", { kind: "roadmap-item", kindLabel: "Roadmap item", placement: "other", stage: { property: "work-stage", value: "doing", bucket: "active" } }),
    src("Garden meeting takeaways", { kind: "meeting", kindLabel: "Meeting", placement: "other" }, { updated: "2026-05-01T08:00:00.000Z" }),
  ];
  return { targetBlockId: "target", sources, completeness: { kind: "complete" } };
}
const unfaceted = (): BacklinkCollection => { const c = fixture(); return { ...c, sources: c.sources.map(({ facets: _, ...s }) => s) }; };

const summary = (v: BacklinkView) => ({
  faceted: v.faceted, total: v.total, hiddenRelated: v.hiddenRelated, hiddenResolved: v.hiddenResolved, filtered: v.filtered,
  groups: v.groups.map(g => ({ kind: g.kind, label: g.label, ids: g.sources.map(s => s.blockId), stageCounts: g.stageCounts, openCount: g.openCount })),
  matching: v.matching.map(s => s.blockId), kinds: v.kinds,
});

function* grid(): Generator<BacklinkViewOptions> {
  for (const [sortField, sortDirection] of BACKLINK_SORT_ORDER)
    for (const stage of BACKLINK_STAGE_FILTERS)
      for (const kind of [null, "outbox-item", "comment", "no-such-kind"])
        for (const showRelated of [false, true])
          for (const showResolved of [false, true])
            for (const filter of ["", "ana", "tmt tins", "waiting", "work-id", "Outbox", "related", "zzz"])
              yield { filter, sortField, sortDirection, stage, kind, showRelated, showResolved };
}

describe.skipIf(!outliner)("the view is Detail's: parity with pi-herdr-outliner's backlink-view.ts", () => {
  let theirs: any;
  beforeAll(async () => { theirs = await import(join(outliner!, "src/backlink-view.ts")); });

  test("the constants and defaults are the same", () => {
    expect(DEFAULT_BACKLINK_VIEW_OPTIONS).toEqual(theirs.DEFAULT_BACKLINK_VIEW_OPTIONS);
    expect(BACKLINK_SORT_ORDER).toEqual(theirs.BACKLINK_SORT_ORDER);
    expect(BACKLINK_STAGE_FILTERS).toEqual(theirs.BACKLINK_STAGE_FILTERS);
  });

  test("every sort, stage, kind, filter and hide toggle groups, orders and counts the same, with facets and without", () => {
    let checked = 0;
    for (const collection of [fixture(), unfaceted(), { targetBlockId: "t", sources: [], completeness: { kind: "complete" } } as BacklinkCollection, null]) {
      for (const o of grid()) {
        const mine = backlinkView(collection, o), them = theirs.backlinkView(collection, o);
        expect(summary(mine)).toEqual(summary(them));
        for (const g of mine.groups) for (const open of [false, true]) {
          const tg = them.groups.find((x: any) => x.kind === g.kind);
          expect(backlinkGroupRows(g, open).map(s => s.blockId)).toEqual(theirs.backlinkGroupRows(tg, open).map((s: any) => s.blockId));
        }
        checked++;
      }
    }
    expect(checked).toBe(4 * 6 * 6 * 4 * 2 * 2 * 8);
  });

  test("the sort, stage and kind cycles step the same way", () => {
    for (const [f, d] of BACKLINK_SORT_ORDER) expect(nextBacklinkSort(f, d)).toEqual(theirs.nextBacklinkSort(f, d));
    for (const s of BACKLINK_STAGE_FILTERS) expect(nextBacklinkStageFilter(s)).toBe(theirs.nextBacklinkStageFilter(s));
    const kinds = backlinkView(fixture(), DEFAULT_BACKLINK_VIEW_OPTIONS).kinds;
    for (const k of [null, ...kinds.map(k => k.kind), "gone"]) expect(nextBacklinkKindFilter(k, kinds)).toBe(theirs.nextBacklinkKindFilter(k, kinds));
    expect(nextBacklinkKindFilter("x", [])).toBe(theirs.nextBacklinkKindFilter("x", []));
  });
});

describe.skipIf(!outliner)("the text is Detail's panel: status line, group headers and rows, parity with detail-pi-preview.ts", () => {
  let render: (state: any, width: number) => string, createState: () => any;
  beforeAll(async () => {
    render = (await import(join(outliner!, "src/detail-pi-preview.ts"))).renderBacklinksDocument;
    createState = (await import(join(outliner!, "src/detail-controller.ts"))).createDetailBacklinkState;
  });
  /** Detail's Markdown as the words it draws: links, emphasis and strikes taken off. */
  const words = (md: string) => md.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "").replace(/(^|\s)_|_$/g, "$1").trim();

  const cases: [string, () => BacklinkCollection, Partial<BacklinkViewOptions>, string[]][] = [
    ["the defaults", fixture, {}, []],
    ["two groups opened", fixture, {}, ["outbox-item", "comment"]],
    ["everything shown, by title", fixture, { showRelated: true, showResolved: true, sortField: "title", sortDirection: "asc" }, []],
    ["a filter", fixture, { filter: "swap" }, []],
    ["one kind, one stage", fixture, { kind: "outbox-item", stage: "done" }, []],
    ["nothing matches", fixture, { filter: "zzz" }, []],
    ["no facets", unfaceted, {}, []],
  ];
  for (const [name, make, over, open] of cases) for (const width of [400, 60]) {
    test(`${name}, ${width} columns`, () => {
      const collection = make(), o = { ...DEFAULT_BACKLINK_VIEW_OPTIONS, ...over };
      const state = { backlinks: { ...createState(), expanded: true, collection, selectedIndex: -1, filter: o.filter, sortField: o.sortField, sortDirection: o.sortDirection, showRelated: o.showRelated, showResolved: o.showResolved, kindFilter: o.kind, stageFilter: o.stage, expandedKinds: new Set(open) }, previewRegions: { focusedRegionId: null } };
      const detail = render(state, width).split("\n").slice(1).map(words);
      const view = backlinkView(collection, o);
      // The door says why nothing is grouped (Detail says nothing); every other part is Detail's, in order.
      const status = backlinkStatusParts(view, o).filter(p => !p.text.startsWith("not grouped")).map(p => p.text).join(" · ");
      expect(detail[0]).toBe(status);
      const columns = Math.max(8, width - 1) - 2;
      const mine = backlinkRows(view, o, new Set(open)).map(r => {
        if (r.kind === "group") return `${r.expanded ? "−" : "+"} ${fitBacklinkRow(`${r.group.label} ${r.group.sources.length}`, "", columns).title}${backlinkStageSummary(r.group)}`;
        const f = fitBacklinkRow(r.source.title, backlinkRowSuffix(r.source), columns);
        return `+ ${f.title}${f.suffix ? ` — ${f.suffix}` : ""}`;
      });
      const rows = detail.slice(1).filter(l => !l.startsWith("No backlinks"));
      expect(rows).toEqual(mine);
      if (!view.matching.length) expect(detail.at(-1)).toBe(collection.sources.length ? "No backlinks match the current filter." : "No backlinks.");
    });
  }
});

describe("the door's own parts of the view", () => {
  test("the status line counts add up: matching + filtered + hidden = total, and says nothing is grouped without facets", () => {
    const v = backlinkView(fixture(), DEFAULT_BACKLINK_VIEW_OPTIONS);
    expect(v.matching.length + v.filtered + v.hiddenRelated + v.hiddenResolved).toBe(v.total);
    expect(backlinkStatusParts(v, DEFAULT_BACKLINK_VIEW_OPTIONS).map(p => p.text).join(" · "))
      .toBe("11 of 15 match · 3 this note hidden · 1 resolved hidden · Kind: all · Stage: all · Sort: Updated ↓");
    const flat = backlinkView(unfaceted(), DEFAULT_BACKLINK_VIEW_OPTIONS);
    expect(backlinkStatusParts(flat, DEFAULT_BACKLINK_VIEW_OPTIONS).map(p => p.text))
      .toEqual(["15 of 15 match", "not grouped: this service sends no facets", "Sort: Updated ↓"]);
    expect(backlinkRows(flat, DEFAULT_BACKLINK_VIEW_OPTIONS, new Set()).every(r => r.kind === "source")).toBe(true);
  });

  test("by default the groups are collapsed to their open rows, open groups first; a filter opens every group", () => {
    const o = DEFAULT_BACKLINK_VIEW_OPTIONS;
    const rows = backlinkRows(backlinkView(fixture(), o), o, new Set());
    expect(rows.map(r => r.kind === "group" ? `[${r.group.label}]` : r.source.title)).toEqual([
      "[Outbox item]", "Offer spare onion sets", "ask ana about the tomato tins", "Ask Ana about bean seed",
      "[Roadmap item]", "Kettle job",
      "[Meeting]", "[Note]", "[Day page]", "[Comment]",
    ]);
    const filtered = { ...o, filter: "swap" };
    expect(backlinkRows(backlinkView(fixture(), filtered), filtered, new Set()).filter(r => r.kind === "group").every(r => r.kind === "group" && r.expanded)).toBe(true);
    expect(backlinkStageSummary(backlinkView(fixture(), o).groups[0]!)).toBe(" (2 waiting · 1 draft · 2 done · 1 no stage)");
  });

  test("an agent's or the person's options from the wire: kinds by key or label, sorts by field or field-direction, the rest refused", () => {
    const kinds = backlinkView(fixture(), DEFAULT_BACKLINK_VIEW_OPTIONS).kinds;
    const base = DEFAULT_BACKLINK_VIEW_OPTIONS;
    expect(backlinkOptionsFrom(base, { kind: "Outbox item", stage: "open", resolved: true, sort: "title" }, kinds))
      .toEqual({ ...base, kind: "outbox-item", stage: "open", showResolved: true, sortField: "title", sortDirection: "asc" });
    expect(backlinkOptionsFrom(base, { kind: "all", sort: "created-asc", related: true, filter: " beans " }, kinds))
      .toEqual({ ...base, sortField: "created", sortDirection: "asc", showRelated: true, filter: "beans" });
    expect(() => backlinkOptionsFrom(base, { kind: "tractor" }, kinds)).toThrow("no tractor among these backlinks");
    expect(() => backlinkOptionsFrom(base, { stage: "later" }, kinds)).toThrow("stage is one of all, open, waiting, draft, active, done");
    expect(() => backlinkOptionsFrom(base, { sort: "size" }, kinds)).toThrow("sort is updated, created or title");
  });
});

// ── the board's drawer, against a scratch service ───────────────────────────────────────────────────

describe.skipIf(!outliner)("the board's backlinks drawer: Detail's facets and defaults, by keys, mouse and act", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, b: DeliveryBoard, hub: any, target: any;
  const ids: Record<string, string> = {};
  let key: (k: Key) => void = () => {};
  const B = () => b as any;
  const ch = (c: string) => key({ kind: "char", ch: c });
  const create = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
  const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
  const frame = () => b.render(B().ctx).lines.map(plain);
  const rect = (name: string) => { b.render(B().ctx); return BV.rectOf(b, name) as { col: number; row: number; cols: number; rows: number }; };
  const click = (x: number, y: number) => { key({ kind: "mouse", action: "down", button: 0, x, y }); key({ kind: "mouse", action: "up", button: 0, x, y }); };
  const clickText = (region: string, text: string) => {
    const r = rect(region), lines = frame();
    for (let y = r.row; y < r.row + r.rows; y++) { const x = lines[y]!.indexOf(text, r.col); if (x >= 0 && x < r.col + r.cols) return click(x + 1, y); }
    throw new Error(`"${text}" isn't drawn in ${region}:\n${lines.slice(r.row, r.row + r.rows).join("\n")}`);
  };
  const peek = () => B().describe().backlinks;
  /** The drawer's list as drawn: its status line (wrapped over `linkHead` lines) joined into one, then one line per row. */
  const drawer = () => {
    const r = rect("backlinks"), lines = frame().slice(r.row + 1, r.row + r.rows - 1).map(l => l.slice(r.col + 1, r.col + r.cols - 1).trimEnd());
    const head = B().linksTile.head as number;
    // A wrapped line ends with its separator, or had no room for one.
    const status = lines.slice(0, head).map(l => l.trim()).reduce((all, l) => !all ? l : all.endsWith("·") ? `${all} ${l}` : `${all} · ${l}`, "");
    return [status, ...lines.slice(head)];
  };

  const openDrawer = async () => {
    if ((app as any).stack.at(-1) instanceof DeliveryBoard) app.pop();
    b = new DeliveryBoard(hub.id, false);
    app.push(b);
    await until(() => B().lanes[0]?.items?.length === 1 && B().preview.msg?.id === target.id, "the card in the preview", 10_000);
    ch("b");
    await until(() => !!B().linksTile.data && !!B().describe().backlinks, "the backlinks");
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    target = await create(null, "Seed swap [stage::queued]");
    const ref = `((${target.id}))`;
    ids.inside = (await create(target.id, `Table plan\nsee ${ref}`)).id;
    ids.waiting = (await create(null, `Ask Ana about bean seed [type::outbox-item] [outbox::waiting]\n${ref}`)).id;
    await Bun.sleep(5);                                                               // the draft is newer: updated ↓ puts it first
    ids.draft = (await create(null, `Offer spare onion sets [type::outbox-item] [outbox::draft]\n${ref}`)).id;
    for (const t of ["Thank the swap hosts", "Post the swap photos"]) await create(null, `${t} [type::outbox-item] [outbox::done]\n${ref}`);
    ids.rota = (await create(null, `Rota for the stall\nfor ${ref}`)).id;
    const day = (await board.request<any>("pages.follow", { address: "2026-03-14", author: "agent" })).block;
    await create(day.id, `Market morning\n${ref}`);
    const notes = await create(null, "Allotment notes\nMondays and Thursdays.");
    const said = await board.comment("c-open", notes.id, notes.revision, `Bring labels to ${ref}`, { quote: "Mondays", start: notes.text.indexOf("Mondays") });
    const fixed = await board.comment("c-done", notes.id, notes.revision, `Gate code for ${ref}`, { quote: "Thursdays", start: notes.text.indexOf("Thursdays") });
    await board.setLifecycle(fixed.id, "resolved");
    ids.openComment = said.id;
    hub = await create(null, "Swap board");
    await create(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
    const term = { info: { cols: 200, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 30_000);

  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; }, 20_000);

  test("it opens as Detail's panel does: this note and resolved comments hidden, groups with stage counts, open items first, one line each", async () => {
    await openDrawer();
    const p = peek();
    expect(p.faceted).toBe(true);
    expect(p.status).toBe("7 of 9 match · 1 this note hidden · 1 resolved hidden · Kind: all · Stage: all · Sort: Updated ↓");
    expect(p.rows.map((r: any) => r.text.split(" — ")[0])).toEqual([
      "+ Outbox item 4 (1 waiting · 1 draft · 2 done)", "Offer spare onion sets", "Ask Ana about bean seed",   // open first, then updated ↓
      ...p.rows.slice(3).map((r: any) => r.text.split(" — ")[0]),
    ]);
    expect(p.rows.slice(3).every((r: any) => r.group)).toBe(true);                 // the other groups, folded (nothing open in them)
    expect(p.rows.find((r: any) => r.selected).id).toBe(ids.draft);               // the first source, not a header
    const lines = drawer();
    expect(lines[0]).toBe(p.status);
    // One line per row, the breadcrumb and reference suffix on the same line.
    expect(lines[1]).toContain("+ Outbox item 4 (1 waiting · 1 draft · 2 done)");
    expect(lines[2]).toMatch(/^ {3}Offer spare onion sets — draft · .*block reference ×1/);
    expect(lines[3]).toMatch(/^ {3}Ask Ana about bean seed — waiting/);
    await until(() => B().linksPreview.msg?.id === ids.draft, "the preview on the selected source");
  }, 20_000);

  test("a narrow drawer wraps the status line between parts: no blank line, and every control stays drawn and clickable", async () => {
    await openDrawer();
    const info = (app as any).term.info, cols = info.cols;
    try {
      for (const w of [200, 150, 120, 100, 90]) {
        info.cols = w;
        for (const typing of [false, true]) {
          if (typing) { ch("/"); for (const c of "poster") ch(c); }
          const lines = drawer(), r = rect("backlinks"), head = B().linksTile.head as number;
          const raw = frame().slice(r.row + 1, r.row + 1 + head).map(l => l.slice(r.col + 1, r.col + r.cols - 1).trim());
          expect(raw.every(l => l.length > 0)).toBe(true);
          expect(lines[0]).toBe(typing ? peek().status.replace("Filter: poster", "Filter: poster_") : peek().status);
          for (const c of ["kind", "stage", "sort", "resolved", "related"]) {
            const seg = B().linksTile.controls.find((x: any) => x.control === c);
            const at = seg && { col: r.col + 1 + seg.x, row: r.row + 1 + seg.y, cols: seg.cols, rows: 1 };
            expect(at && at.col + at.cols <= r.col + r.cols - 1 && at.row > r.row && at.row < r.row + 1 + head).toBe(true);
          }
          if (typing) key({ kind: "esc" });
        }
      }
    } finally { info.cols = cols; }
  }, 20_000);

  test("the toggles by key: h resolved, n this note, K kind, w stage, s sort; . folds a group; each keeps the counts adding up", async () => {
    await openDrawer();
    ch("h");
    expect(peek().status).toBe("8 of 9 match · 1 this note hidden · resolved shown · Kind: all · Stage: all · Sort: Updated ↓");
    ch("n");
    expect(peek().status).toBe("9 of 9 match · this note shown · resolved shown · Kind: all · Stage: all · Sort: Updated ↓");
    ch("h"); ch("n");
    ch("K");
    expect(peek().options.kind).toBe("outbox-item");
    expect(peek().status).toBe("4 of 9 match · 3 filtered · 1 this note hidden · 1 resolved hidden · Kind: Outbox item · Stage: all · Sort: Updated ↓");
    expect(peek().rows.filter((r: any) => r.id).length).toBe(4);                     // narrowing opens the group
    ch("w"); ch("w");
    expect(peek().options.stage).toBe("waiting");
    expect(peek().rows.filter((r: any) => r.id).map((r: any) => r.id)).toEqual([ids.waiting]);
    ch("w"); ch("w"); ch("w"); ch("w");                                              // draft, active, done, all
    for (let i = 0; i < 20 && peek().options.kind !== null; i++) ch("K");           // every kind again
    expect(peek().options.kind).toBeNull();
    ch("s"); ch("s"); ch("s"); ch("s");
    expect(peek().options).toMatchObject({ sortField: "title", sortDirection: "asc" });
    expect(peek().status.endsWith("Sort: Title ↑")).toBe(true);
    // . on a source folds or opens its group; the selection stays on what it was on.
    ch("."); expect(peek().groups.find((g: any) => g.kind === "outbox-item").expanded).toBe(true);
    expect(peek().rows.filter((r: any) => r.id).length).toBe(4);                     // all four outbox items, done ones too
    ch("."); expect(peek().groups.find((g: any) => g.kind === "outbox-item").expanded).toBe(false);
  }, 20_000);

  test("/ filters as it's typed; board keys are letters in it (t doesn't open the outline); ⏎ keeps it, esc undoes it", async () => {
    await openDrawer();
    ch("/");
    for (const c of "rota") ch(c);
    expect(B().treeOpen).toBe(false);
    expect(peek().typing).toBe("rota");
    expect(peek().rows.map((r: any) => r.id).filter(Boolean)).toEqual([ids.rota]);
    expect(drawer()[0]).toStartWith("Filter: rota_ · 1 of 9 match · 6 filtered");
    key({ kind: "esc" });
    expect(peek()).not.toBeNull();                                                 // esc undid the filter, not the drawer
    expect(peek().options.filter).toBe("");
    ch("/"); for (const c of "bgt") ch(c);                                           // the board's b, g and t: letters here
    expect(B().hubPicker).toBeNull();
    expect(B().treeOpen).toBe(false);
    key({ kind: "backspace" }); key({ kind: "backspace" }); key({ kind: "backspace" });
    for (const c of "ana") ch(c);
    key({ kind: "enter" });
    expect(peek().options.filter).toBe("ana");
    expect(peek().status).toStartWith("Filter: ana · 1 of 9 match");
  }, 20_000);

  test("mouse: the status line's controls, a group's header, and a row (a detail); alt+⏎ opens a new detail", async () => {
    await openDrawer();
    clickText("backlinks", "1 resolved hidden");
    expect(peek().options.showResolved).toBe(true);
    clickText("backlinks", "resolved shown");
    expect(peek().options.showResolved).toBe(false);
    clickText("backlinks", "1 this note hidden");
    expect(peek().options.showRelated).toBe(true);
    clickText("backlinks", "this note shown");
    clickText("backlinks", "Kind: all");
    expect(peek().options.kind).toBe("outbox-item");
    clickText("backlinks", "Kind: Outbox item");
    clickText("backlinks", "Stage: all");
    expect(peek().options.stage).toBe("open");
    clickText("backlinks", "Stage: open");
    for (let i = 0; i < 4; i++) clickText("backlinks", "Stage: ");
    expect(peek().options.stage).toBe("all");
    for (let i = 0; i < 6; i++) clickText("backlinks", "Sort: ");
    expect(peek().options).toMatchObject({ sortField: "updated", sortDirection: "desc" });
    for (let i = 0; i < 20 && peek().options.kind !== null; i++) clickText("backlinks", "Kind: ");
    // The filter is a control too: a click starts it, and a click while typing keeps what's typed.
    ch("/"); ch("r"); ch("o");
    clickText("backlinks", "Filter: ro");
    expect(peek().typing).toBe("ro");
    key({ kind: "esc" });
    expect(peek().typing).toBeNull();
    clickText("backlinks", "+ Comment 1");
    expect(peek().groups.find((g: any) => g.kind === "comment").expanded).toBe(true);
    clickText("backlinks", "− Comment 1");
    expect(peek().groups.find((g: any) => g.kind === "comment").expanded).toBe(false);
    clickText("backlinks", "Offer spare onion sets");
    await until(() => B().details[0]?.msg?.id === ids.draft, "the source in a detail");
    expect(BV.where(b)).toBe("detail0");
    // Back in the drawer, ⏎ replaces that detail and alt+⏎ opens a second one.
    BV.at(b, "backlinks");
    ch("j");
    await until(() => B().linksPreview.msg?.id === ids.waiting, "the preview");
    key({ kind: "alt-enter" });
    await until(() => B().details.length === 2 && B().details.some((d: any) => d.msg?.id === ids.waiting), "a second detail");
  }, 20_000);

  test("an agent reads the same view with its own options and changes none of the person's; the person's act sets theirs", async () => {
    await openDrawer();
    ch("s");                                                                          // the person's sort: updated ↑
    const before = JSON.stringify(peek());
    const agent = { kind: "agent" as const, id: "gardener" };
    const r: any = await b.act({ action: "backlinks", args: { resolved: true, kind: "comment" } }, agent);
    expect(r.backlinks.status).toBe("2 of 9 match · 6 filtered · 1 this note hidden · resolved shown · Kind: Comment · Stage: all · Sort: Updated ↑");
    expect(r.backlinks.rows.filter((x: any) => x.id).length).toBe(2);
    expect(JSON.stringify(peek())).toBe(before);                                      // nothing of the person's moved
    expect((app as any).message).toContain("gardener");
    const other: any = await b.act({ action: "backlinks", args: { id: ids.rota } }, agent);
    expect(other.backlinks.total).toBe(0);
    expect(JSON.stringify(peek())).toBe(before);
    await expect(b.act({ action: "backlinks", args: { stage: "someday" } }, agent)).rejects.toThrow("stage is one of");
    const mine: any = await b.act({ action: "backlinks", args: { stage: "done", sort: "title" } }, USER);
    expect(mine.backlinks.options).toMatchObject({ stage: "done", sortField: "title", sortDirection: "asc" });
    expect(peek().options).toMatchObject({ stage: "done", sortField: "title" });
    expect(drawer()[0]).toBe(peek().status);
  }, 20_000);

  test("an older service without facets: today's flat list without the note itself, and the status line says nothing is grouped", async () => {
    await openDrawer();
    const request = board.request.bind(board);
    (board as any).request = async (action: string, params: any) => {
      const r: any = await request(action, params);
      return action === "references.backlinks" ? { ...r, sources: [...r.sources.map(({ facets: _, ...s }: any) => s), { ...r.sources[0], facets: undefined, blockId: params.query.targetBlockId, title: "Seed swap" }] } : r;
    };
    try {
      const flat = await board.backlinks(target.id);
      expect(flat.sources.some(s => s.blockId === target.id)).toBe(false);          // today's rule: never the note itself
      key({ kind: "esc" }); ch("b");
      await until(() => !!B().linksTile.data && !!B().describe().backlinks, "the backlinks");
      const p = peek();
      expect(p.faceted).toBe(false);
      expect(p.status).toBe("9 of 9 match · not grouped: this service sends no facets · Sort: Updated ↓");
      expect(p.rows.every((r: any) => r.id)).toBe(true);
      expect(drawer()[0]).toBe(p.status);
      ch("K");
      expect((app as any).message).toContain("no backlink kinds");
    } finally { (board as any).request = request; }
  }, 20_000);
});
