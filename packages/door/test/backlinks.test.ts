import { visible } from "../src/style";
// PIE-442: backlinks you can use. src/backlinks.ts mirrors Detail's backlink view (pi-herdr-outliner
// src/backlink-view.ts) and its panel's text (src/detail-pi-preview.ts); these tests check it against the
// outliner's own functions over fictional sources and every option, then drive the board's dock against
// a scratch service: the defaults, filter and sort, and the toggles by key, click and act.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { linkAcross } from "../src/links";
import { tileKind } from "../src/desk/tile-kinds";
import type { BacklinksPane } from "../src/desk/backlinks-pane";
import { join } from "node:path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { App } from "../src/app";
import {
  backlinkGroupRows, backlinkOptionsFrom, backlinkRows, backlinkRowSuffix, backlinkGroupHidden, backlinkStageSummary, backlinkStatusParts, backlinkView,
  BACKLINK_SORT_ORDER, BACKLINK_STAGE_FILTERS, DEFAULT_BACKLINK_VIEW_OPTIONS, fitBacklinkRow, nextBacklinkKindFilter, nextBacklinkSort,
  nextBacklinkStageFilter, stagesFrom, type BacklinkCollection, type BacklinkSource, type BacklinkStageBucket, type BacklinkSourceFacets, type BacklinkView, type BacklinkViewOptions,
} from "../src/backlinks";
import { boardScreen } from "./board-view";
import { Desk } from "../src/desk/desk";
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
  groups: v.groups.map(g => ({ kind: g.kind, label: g.label, ids: g.sources.map(s => s.blockId), stageCounts: g.stageCounts, stageValues: g.stageValues, openCount: g.openCount })),
  matching: v.matching.map(s => s.blockId), kinds: v.kinds, stages: v.stages,
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

describe("stages as the notes write them (PIE-819)", () => {
  test("a group names each value it carries; a folded one says how many more; the Stage filter steps through the values present", () => {
    const q = (id: string, value: string, bucket?: BacklinkStageBucket): BacklinkSource => ({ blockId: id, title: `Question ${id}`, parentContext: "", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: `2026-10-0${id}T00:00:00.000Z`, referenceGroups: [], occurrences: [], facets: { kind: "question", kindLabel: "Question", placement: "other", stage: { property: "status", value, ...(bucket ? { bucket } : {}) } } } as unknown as BacklinkSource);
    const c: BacklinkCollection = { targetBlockId: "t", sources: [q("1", "open", "active"), q("2", "answered"), q("3", "answered")], completeness: { kind: "complete" } };
    const v = backlinkView(c, DEFAULT_BACKLINK_VIEW_OPTIONS), g = v.groups[0]!;
    expect(backlinkStageSummary(g)).toBe(" (1 open · 2 answered)");
    expect(backlinkGroupHidden(g, false)).toBe(2);
    expect(backlinkGroupHidden(g, true)).toBe(0);
    expect(v.stages.map(s => s.value)).toEqual(["open", "answered"]);
    expect(nextBacklinkStageFilter("all", v.stages)).toBe("open");
    expect(nextBacklinkStageFilter("open", v.stages)).toBe("value:open");  // the status `open` alone, apart from the open families
    expect(nextBacklinkStageFilter("value:open", v.stages)).toBe("answered");
    const answered = backlinkView(c, { ...DEFAULT_BACKLINK_VIEW_OPTIONS, stage: "ANSWERED" });   // matched however it's spelled
    expect(answered.matching.map(s => s.blockId).sort()).toEqual(["2", "3"]);
    expect(nextBacklinkStageFilter("answered", v.stages)).toBe("all");
    // A value spelled like a keyword (`Open`, `All`) never takes the keyword's place: it's its own choice, `value:Open`.
    expect(nextBacklinkStageFilter("all", [{ value: "Open" }, { value: "All" }])).toBe("open");
    expect(nextBacklinkStageFilter("open", [{ value: "Open" }, { value: "All" }])).toBe("value:Open");
    expect(nextBacklinkStageFilter("value:Open", [{ value: "Open" }, { value: "All" }])).toBe("value:All");
    expect(nextBacklinkStageFilter("value:All", [{ value: "Open" }, { value: "All" }])).toBe("all");
    // A status `open` a rule put in done: `value:open` selects it alone; `open` is the open families.
    const moved: BacklinkCollection = { ...c, sources: [q("4", "open", "done"), q("5", "waiting", "waiting")] };
    expect(backlinkView(moved, { ...DEFAULT_BACKLINK_VIEW_OPTIONS, stage: "value:open" }).matching.map(s => s.blockId)).toEqual(["4"]);
    expect(backlinkView(moved, { ...DEFAULT_BACKLINK_VIEW_OPTIONS, stage: "open" }).matching.map(s => s.blockId)).toEqual(["5"]);
    expect(backlinkView(c, { ...DEFAULT_BACKLINK_VIEW_OPTIONS, stage: "ALL" }).matching).toHaveLength(3);
  });
});

describe("a list that names its stages (stages=, PIE-819)", () => {
  test("its values in its order, the rest said as other and never hidden; Stage steps through them and other", () => {
    const q = (id: string, value: string, bucket?: BacklinkStageBucket): BacklinkSource => ({ blockId: id, title: `Question ${id}`, parentContext: "", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: `2026-10-0${id}T00:00:00.000Z`, referenceGroups: [], occurrences: [], facets: { kind: "question", kindLabel: "Question", placement: "other", stage: { property: "status", value, ...(bucket ? { bucket } : {}) } } } as unknown as BacklinkSource);
    const c: BacklinkCollection = { targetBlockId: "t", sources: [q("1", "doing", "active"), q("2", "next", "waiting"), q("3", "doing", "active"), q("4", "parked", "waiting")], completeness: { kind: "complete" } };
    const o = { ...DEFAULT_BACKLINK_VIEW_OPTIONS, stages: stagesFrom("[next, doing, waiting]") };
    const v = backlinkView(c, o), g = v.groups[0]!;
    expect(backlinkStageSummary(g)).toBe(" (1 next · 2 doing · other: parked 1)");
    expect(g.sources).toHaveLength(4);                                     // parked is listed, not hidden
    expect(nextBacklinkStageFilter("open", v.stages)).toBe("next");
    expect(nextBacklinkStageFilter("doing", v.stages)).toBe("other");
    expect(nextBacklinkStageFilter("other", v.stages)).toBe("all");
    expect(backlinkView(c, { ...o, stage: "other" }).matching.map(s => s.blockId)).toEqual(["4"]);
    // Without the list: the values the rows carry, as written, and nothing used elsewhere.
    expect(backlinkStageSummary(backlinkView(c, DEFAULT_BACKLINK_VIEW_OPTIONS).groups[0]!)).toBe(" (1 next · 1 parked · 2 doing)");
    // A status literally named `other`, named by the list, is its own choice beside the aggregate.
    const lit = backlinkView({ ...c, sources: [...c.sources, q("5", "other")] }, { ...o, stages: ["other", "next"] });
    expect(nextBacklinkStageFilter("open", lit.stages)).toBe("value:other");
    expect(backlinkView({ ...c, sources: [...c.sources, q("5", "other")] }, { ...o, stages: ["other", "next"], stage: "value:other" }).matching.map(s => s.blockId)).toEqual(["5"]);
    // The links tile's choices (across every group) take the list too: parked is other there as well.
    const across = linkAcross({ links: { kind: "loading" }, backlinks: { kind: "ready", value: c } }, o);
    expect(nextBacklinkStageFilter("doing", across.stages)).toBe("other");
    // An empty list names nothing: every value, as no list.
    expect(backlinkStageSummary(backlinkView(c, { ...o, stages: [] }).groups[0]!)).toBe(" (1 next · 1 parked · 2 doing)");
    expect(stagesFrom("all")).toBeNull();
    expect(backlinkOptionsFrom(DEFAULT_BACKLINK_VIEW_OPTIONS, { stages: "next, doing" }, []).stages).toEqual(["next", "doing"]);
  });
  test("a links tile's stages= is made into its options and saved back with its spec", () => {
    new Desk();   // the desk registers the built-in tile kinds
    const p = tileKind("backlinks")!.make({ kind: "backlinks", name: "links", source: "tile:reader", stages: "next,doing,waiting" } as any) as BacklinksPane;
    expect(p.options.stages).toEqual(["next", "doing", "waiting"]);
    expect(p.spec()).toMatchObject({ stages: "next,doing,waiting" });
    expect((tileKind("backlinks")!.make({ kind: "backlinks", name: "l2", source: "tile:reader" } as any) as BacklinksPane).spec()).not.toHaveProperty("stages");
  });
  test("describing a links tile lists its rows once, however many there are (a layout.get with one open stayed seconds long, PIE-1303)", () => {
    new Desk();
    const described = (copies: number) => {
      const p = tileKind("backlinks")!.make({ kind: "backlinks", name: "links", source: "tile:reader" } as any) as BacklinksPane;
      p.target = { id: "target", text: "Target note" } as any;
      const c = fixture();
      p.data = { ...c, sources: Array.from({ length: copies }, () => c.sources).flat() };
      p.sel = 2;   // a row picked, as it is once anything has been selected: `sel` finds it among the rows
      const rows = p.rows.bind(p);
      let listed = 0;
      p.rows = () => { listed += 1; return rows(); };
      const d = p.describe() as { rows: unknown[] };
      return { listed, shown: d.rows.length };
    };
    const few = described(1), many = described(8);
    expect(many.shown).toBeGreaterThan(few.shown);
    expect(many.listed).toBe(few.listed);
  });
});

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
        if (r.kind === "group") { const more = backlinkGroupHidden(r.group, r.expanded); return `${r.expanded ? "−" : "+"} ${fitBacklinkRow(`${r.group.label} ${r.group.sources.length}`, "", columns).title}${backlinkStageSummary(r.group)}${more ? ` · ${more} more` : ""}`; }
        const f = fitBacklinkRow(r.source.title, backlinkRowSuffix(r.source), columns);
        return `+ ${f.title}${f.suffix ? ` — ${f.suffix}` : ""}`;
      });
      const rows = detail.slice(1).filter(l => !l.startsWith("No backlinks"));
      expect(rows).toEqual(mine.map(visible));
      if (!view.matching.length) expect(detail.at(-1)).toBe(collection.sources.length ? "No backlinks match the current filter." : "No backlinks.");
    });
  }
});

/** A status line's parts, whatever order the tile places them in. */
const parts = (s: string) => s.split("·").map(x => x.trim()).filter(Boolean).sort();

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
    // Values as the notes write them (PIE-819): `sent` and `queued-ish` are named, never lumped as "no stage".
    expect(backlinkStageSummary(backlinkView(fixture(), o).groups[0]!)).toBe(" (2 waiting · 1 draft · 2 sent · 1 queued-ish)");
  });

  test("an agent's or the person's options from the wire: kinds by key or label, sorts by field or field-direction, the rest refused", () => {
    const kinds = backlinkView(fixture(), DEFAULT_BACKLINK_VIEW_OPTIONS).kinds;
    const base = DEFAULT_BACKLINK_VIEW_OPTIONS;
    expect(backlinkOptionsFrom(base, { kind: "Outbox item", stage: "open", resolved: true, sort: "title" }, kinds))
      .toEqual({ ...base, kind: "outbox-item", stage: "open", showResolved: true, sortField: "title", sortDirection: "asc" });
    expect(backlinkOptionsFrom(base, { kind: "all", sort: "created-asc", related: true, filter: " beans " }, kinds))
      .toEqual({ ...base, sortField: "created", sortDirection: "asc", showRelated: true, filter: "beans" });
    expect(() => backlinkOptionsFrom(base, { kind: "tractor" }, kinds)).toThrow("no tractor among these backlinks");
    // A stage value as written is a stage (PIE-819: properties are open); only an empty one is refused.
    expect(backlinkOptionsFrom(base, { stage: " Answered " }, kinds).stage).toBe("Answered");
    expect(() => backlinkOptionsFrom(base, { stage: " " }, kinds)).toThrow("stage is all, open, waiting, draft, active, done or a stage value");
    expect(() => backlinkOptionsFrom(base, { sort: "size" }, kinds)).toThrow("sort is updated, created or title");
  });
});

// ── the board's dock, against a scratch service ───────────────────────────────────────────────────

describe.skipIf(!outliner)("the board's backlinks dock: Detail's facets and defaults, by keys, mouse and act", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, b: Desk, hub: any, target: any;
  const ids: Record<string, string> = {};
  let key: (k: Key) => void = () => {};
  const B = () => BV.view(b);
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
  /** The dock's list as drawn: its status line (wrapped over `linkHead` lines) joined into one, then one line per row. */
  const dock = () => {
    const r = rect("backlinks"), lines = frame().slice(r.row + 1, r.row + r.rows - 1).map(l => l.slice(r.col + 1, r.col + r.cols - 1).trimEnd());
    const head = B().linksTile.head as number;
    // A wrapped line ends with its separator, or had no room for one.
    const status = lines.slice(0, head).map(l => l.trim()).reduce((all, l) => !all ? l : all.endsWith("·") ? `${all} ${l}` : `${all} · ${l}`, "");
    return [status, ...lines.slice(head)];
  };

  const openDock = async () => {
    if ((app as any).stack.at(-1) instanceof Desk) app.pop();
    b = boardScreen(hub.id, false);
    app.push(b);
    await until(() => B().lanes[0]?.items?.length === 1 && B().preview.msg?.id === target.id, "the card in the preview", 10_000);
    ch("b");
    // The note's children (PIE-693) come in their own read, beside the backlinks.
    await until(() => !!B().linksTile.data && B().linksTile.children.kind === "ready" && !!B().describe().backlinks, "the backlinks and the children");
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

  test("an away machine leaves local backlinks and an away line in the links tile", async () => {
    const remote = join(scratch.outlines, ".remote");
    mkdirSync(remote, { recursive: true });
    const socket = join(remote, "laptop.sock"), ctl = join(remote, "laptop.ctl");
    const ssh = join(scratch.root, "ssh");
    writeFileSync(ssh, `#!/bin/sh\nexec "${process.execPath}" "${join(outliner!, "test/fake-ssh.ts")}" "$@"\n`, { mode: 0o700 });
    let figure: { id: string } | undefined;
    const forward = Bun.spawn([ssh, "--serve", socket, scratch.sock, ctl], {
      env: { ...process.env, EP0CH_OUTLINES: scratch.outlines, EP0CH_SSH: ssh, FAKE_SSH_HOME: scratch.root, FAKE_SSH_OUTLINES: scratch.outlines },
      stdout: "ignore", stderr: "inherit",
    });
    try {
      await until(() => existsSync(ctl), "the fake ssh forward");
      forward.kill("SIGKILL");
      await forward.exited;
      await openDock().catch(error => { throw new Error(B().linksTile.problem || error.message); });
      const lines = dock().join("\n");
      expect(lines).toContain("Offer spare onion sets");
      expect(lines).toContain("laptop: away, not asked");
      const figureNote = await create(null, `Chores and their links\n::backlinks ((${target.id}))`);
      figure = figureNote;
      const shown = Bun.spawn([process.execPath, join(import.meta.dir, "../src/main.ts"), "show", figureNote.id, "--width", "160"], {
        env: { ...process.env, ...scratch.env, EP0CH_SOCKET: scratch.sock }, stdout: "pipe", stderr: "pipe",
      });
      const [output, errors, code] = await Promise.all([new Response(shown.stdout).text(), new Response(shown.stderr).text(), shown.exited]);
      expect({ code, errors }).toEqual({ code: 0, errors: "" });
      expect(output).toContain("Offer spare onion sets");
      expect(output).toContain("laptop: away, not asked");

    } finally {
      if (figure) await board.trash(figure.id);
      if (forward.exitCode === null) { forward.kill(); await forward.exited; }
      rmSync(socket, { force: true });
      rmSync(ctl, { force: true });
    }
  }, 20_000);

  test("it opens as Detail's panel does: this note and resolved comments hidden, groups with stage counts, open items first, one line each", async () => {
    await openDock();
    const p = peek();
    expect(p.faceted).toBe(true);
    expect(p.status).toBe("8 of 10 match · →0/0 ♦0/0 ←7/9 ↓1/1 · 1 this note hidden · 1 resolved hidden · Kind: all · Stage: all · Sort: Updated ↓");
    // The links model's groups: no outlinks or resources here, so Backlinks alone, Detail's kind groups under it.
    expect(p.rows.map((r: any) => r.text)).toEqual([
      "← backlinks (7)", "Outbox item 4", "Offer spare onion sets", "Ask Ana about bean seed",   // open first, then updated ↓
      ...p.rows.slice(4).map((r: any) => r.text),
    ]);
    expect(p.rows[1].context).toBe("(1 waiting · 1 draft · 2 done) · 2 more");    // folded to its open rows: how many more, said
    // the other kinds, folded (nothing open in them); then the note's children (PIE-693)
    const kids = p.rows.findIndex((r: any) => r.kind === "group" && r.group === "children");
    expect(p.rows.slice(4, kids).every((r: any) => r.kind === "kind" && r.open === false)).toBe(true);
    expect(p.rows.slice(kids + 1).every((r: any) => r.kind === "child")).toBe(true);
    expect(p.rows.find((r: any) => r.selected).id).toBe(ids.draft);               // the first source, not a header
    const lines = dock();
    expect(parts(lines[0]!)).toEqual(parts(p.status));
    // One line per row, the breadcrumb and reference suffix on the same line.
    expect(lines[1]).toContain("▾ ← backlinks (7)");
    expect(lines[2]).toContain("  + Outbox item 4 (1 waiting · 1 draft · 2 done)");
    expect(lines[3]).toMatch(/^▌ {3}← Offer spare onion sets — draft · .*block reference ×1/);
    expect(lines[4]).toMatch(/^ {4}← Ask Ana about bean seed — waiting/);
    await until(() => B().linksPreview.msg?.id === ids.draft, "the preview on the selected source");
  }, 20_000);

  test("a narrow dock wraps the status line between parts: no blank line, and every control stays drawn and clickable", async () => {
    await openDock();
    const info = (app as any).term.info, cols = info.cols;
    try {
      for (const w of [200, 150, 120, 100, 90]) {
        info.cols = w;
        for (const typing of [false, true]) {
          if (typing) { ch("/"); for (const c of "poster") ch(c); }
          const lines = dock(), r = rect("backlinks"), head = B().linksTile.head as number;
          const raw = frame().slice(r.row + 1, r.row + 1 + head).map(l => l.slice(r.col + 1, r.col + r.cols - 1).trim());
          expect(raw.every(l => l.length > 0)).toBe(true);
          expect(parts(lines[0]!)).toEqual(parts(typing ? peek().status.replace("Filter: poster", "Filter: poster▌") : peek().status));
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
    await openDock();
    ch("h");
    expect(peek().status).toBe("9 of 10 match · →0/0 ♦0/0 ←8/9 ↓1/1 · 1 this note hidden · resolved shown · Kind: all · Stage: all · Sort: Updated ↓");
    ch("n");
    expect(peek().status).toBe("10 of 10 match · →0/0 ♦0/0 ←9/9 ↓1/1 · this note shown · resolved shown · Kind: all · Stage: all · Sort: Updated ↓");
    ch("h"); ch("n");
    ch("K");
    expect(peek().options.kind).toBe("outbox-item");
    expect(peek().status).toBe("4 of 10 match · →0/0 ♦0/0 ←4/9 ↓0/1 · 4 filtered · 1 this note hidden · 1 resolved hidden · Kind: Outbox item · Stage: all · Sort: Updated ↓");
    expect(peek().rows.filter((r: any) => r.id).length).toBe(4);                     // narrowing opens the group
    ch("w"); ch("w");
    expect(peek().options.stage).toBe("waiting");
    expect(peek().rows.filter((r: any) => r.id).map((r: any) => r.id)).toEqual([ids.waiting]);
    ch("w"); ch("w"); ch("w");                                                       // the values the rows have (PIE-819): draft, done, all
    for (let i = 0; i < 20 && peek().options.kind !== null; i++) ch("K");           // every kind again
    expect(peek().options.kind).toBeNull();
    ch("s"); ch("s"); ch("s"); ch("s");
    expect(peek().options).toMatchObject({ sortField: "title", sortDirection: "asc" });
    expect(peek().status.endsWith("Sort: Title ↑")).toBe(true);
    // . on a source folds or opens its group; the selection stays on what it was on.
    ch("."); expect(peek().groups.find((g: any) => g.kind === "outbox-item").expanded).toBe(true);
    expect(peek().rows.filter((r: any) => r.id && r.kind === "backlink").length).toBe(4);   // all four outbox items, done ones too
    ch("."); expect(peek().groups.find((g: any) => g.kind === "outbox-item").expanded).toBe(false);
  }, 20_000);

  test("/ filters as it's typed; board keys are letters in it (t doesn't open the outline); ⏎ keeps it, esc undoes it", async () => {
    await openDock();
    ch("/");
    for (const c of "rota") ch(c);
    expect(B().treeOpen).toBe(false);
    expect(peek().typing).toBe("rota");
    expect(peek().rows.map((r: any) => r.id).filter(Boolean)).toEqual([ids.rota]);
    expect(parts(dock()[0]!)).toEqual(expect.arrayContaining(["Filter: rota▌", "1 of 10 match", "→0/0 ♦0/0 ←1/9 ↓0/1", "7 filtered"]));
    key({ kind: "esc" });
    expect(peek()).not.toBeNull();                                                 // esc undid the filter, not the dock
    expect(peek().options.filter).toBe("");
    ch("/"); for (const c of "bgt") ch(c);                                           // the board's b, g and t: letters here
    expect(B().hubPicker).toBeNull();
    expect(B().treeOpen).toBe(false);
    key({ kind: "backspace" }); key({ kind: "backspace" }); key({ kind: "backspace" });
    for (const c of "ana") ch(c);
    key({ kind: "enter" });
    expect(peek().options.filter).toBe("ana");
    expect(peek().status).toStartWith("Filter: ana · 1 of 10 match");
  }, 20_000);

  test("mouse: the status line's controls, a group's header, and a row (a detail); alt+⏎ opens a new detail", async () => {
    await openDock();
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
    for (let i = 0; i < 3; i++) clickText("backlinks", "Stage: ");                // draft, done, all: the values the rows have
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
    // A click on a row selects it and shows it (as j k); a double click opens it (⏎).
    clickText("backlinks", "Offer spare onion sets");
    await until(() => B().linksPreview.msg?.id === ids.draft, "the clicked row in the preview");
    expect(B().details.length).toBe(0);
    clickText("backlinks", "Offer spare onion sets");
    await until(() => B().details[0]?.msg?.id === ids.draft, "the source in a detail");
    expect(BV.where(b)).toBe("detail0");
    // Back in the dock, ⏎ replaces that detail and alt+⏎ opens a second one.
    BV.at(b, "backlinks");
    ch("j");
    await until(() => B().linksPreview.msg?.id === ids.waiting, "the preview");
    key({ kind: "alt-enter" });
    await until(() => B().details.length === 2 && B().details.some((d: any) => d.msg?.id === ids.waiting), "a second detail");
  }, 20_000);

  test("a click into the dock while the lanes have the keys only focuses it and selects the row: it never opens one; a modifier or middle click opens a new detail", async () => {
    await openDock();
    BV.at(b, "lanes");
    expect(BV.where(b)).toBe("lanes");
    const press = (text: string, more: Record<string, unknown> = {}) => {
      const r = rect("backlinks"), lines = frame();
      for (let y = r.row; y < r.row + r.rows; y++) { const x = lines[y]!.indexOf(text, r.col); if (x >= 0 && x < r.col + r.cols) { key({ kind: "mouse", action: "down", button: 0, x: x + 1, y, ...more } as Key); key({ kind: "mouse", action: "up", button: 0, x: x + 1, y, ...more } as Key); return; } }
      throw new Error(`"${text}" isn't drawn`);
    };
    press("Ask Ana about bean seed");
    expect(BV.where(b)).toBe("backlinks");
    await until(() => B().linksPreview.msg?.id === ids.waiting, "the row shown in the dock's preview");
    await Bun.sleep(150);
    expect(B().details.length).toBe(0);                                       // the bug: a first click opened a detail
    await Bun.sleep(450);                                                     // apart: two single clicks, not a double
    press("Offer spare onion sets", { mods: 8 });                             // alt-click: alt+⏎, a new detail
    await until(() => B().details.some((d: any) => d.msg?.id === ids.draft), "a detail from an alt-click");
    BV.at(b, "backlinks");
    await Bun.sleep(450);
    press("Ask Ana about bean seed", { button: 1 });                          // middle click: the same
    await until(() => B().details.some((d: any) => d.msg?.id === ids.waiting), "a detail from a middle click");
  }, 20_000);

  test("an agent reads the same view with its own options and changes none of the person's; the person's act sets theirs", async () => {
    await openDock();
    ch("s");                                                                          // the person's sort: updated ↑
    // What the person sees, less the rows' ages ("agent · 3s"), which tick on by themselves between two looks.
    const seen = () => JSON.stringify(peek()).replace(/(?<![\d.:])\d+[smhd]"/g, '#age"');
    const before = seen();
    const agent = { kind: "agent" as const, id: "gardener" };
    const r: any = await b.dispatch.act({ action: "backlinks", args: { resolved: true, kind: "comment" } }, agent);
    expect(r.backlinks.status).toBe("2 of 9 match · →0/0 ♦0/0 ←2/9 · 6 filtered · 1 this note hidden · resolved shown · Kind: Comment · Stage: all · Sort: Updated ↑");
    expect(r.backlinks.rows.filter((x: any) => x.id).length).toBe(2);
    expect(seen()).toBe(before);                                      // nothing of the person's moved
    expect((app as any).message).toContain("gardener");
    const other: any = await b.dispatch.act({ action: "backlinks", args: { id: ids.rota } }, agent);
    expect(other.backlinks.total).toBe(1);                                              // the rota links out to the note: an outlink, no backlinks
    expect(other.backlinks.rows.filter((x: any) => x.kind === "outlink").map((x: any) => x.id)).toEqual([target.id]);   // the rows are the ones the counts count
    expect(other.backlinks.across).toMatchObject({ outlinks: { matching: 1, total: 1 }, backlinks: { total: 0 } });
    expect(seen()).toBe(before);
    await expect(b.dispatch.act({ action: "backlinks", args: { stage: " " } }, agent)).rejects.toThrow("stage is all, open");
    const mine: any = await b.dispatch.act({ action: "backlinks", args: { stage: "done", sort: "title" } }, USER);
    expect(mine.backlinks.options).toMatchObject({ stage: "done", sortField: "title", sortDirection: "asc" });
    expect(peek().options).toMatchObject({ stage: "done", sortField: "title" });
    expect(parts(dock()[0]!)).toEqual(parts(peek().status));
  }, 20_000);
});
