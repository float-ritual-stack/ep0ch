// The links tile's Kind, Stage and Sort apply to all three groups (Outlinks, Resources, Backlinks), its counters
// count across them and say which, and its header keeps every control where it is whatever the values (src/links.ts
// `linkRows`, `linkAcross`; src/desk/backlinks-pane.ts `layoutLinksStatus`). Fictional links; the model and the
// layout without a service, the wire against a throwaway outliner.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AuthoredLinksSnapshot, AuthoredOutlink, AuthoredResourceLink, AuthoredTargetFacets } from "../src/authored";
import { backlinkOptionsFrom, backlinkStatusParts, backlinkView, DEFAULT_BACKLINK_VIEW_OPTIONS, type BacklinkCollection, type BacklinkViewOptions } from "../src/backlinks";
import { layoutLinksStatus } from "../src/desk/backlinks-pane";
import { linkAcross, linkRows, linkWords, readChildren, type ChildLink, type LinkData } from "../src/links";
import type { Msg } from "../src/board";
import { SocketBoard } from "../src/socket";
import { Scratch } from "./scratch";

const span = { start: 0, end: 1 };
const facets = (kind: string, label: string, bucket: string | undefined, updatedAt: string): AuthoredTargetFacets =>
  ({ kind, kindLabel: label, ...(bucket ? { stage: { property: "outbox", value: bucket, bucket: bucket as never } } : {}), createdAt: updatedAt, updatedAt });
const outlink = (label: string, f?: AuthoredTargetFacets): AuthoredOutlink => ({
  kind: "outlink", key: label, label, firstSpan: span, occurrenceCount: 1, referenceKind: "block",
  resolution: f ? { kind: "ready", target: { kind: "block", blockId: `id-${label}` }, title: label, facets: f } : { kind: "missing", reason: "Block not found" },
});
const resource = (label: string, f?: AuthoredTargetFacets): AuthoredResourceLink => ({
  kind: "resource", key: label, label, firstSpan: span, occurrenceCount: 1,
  resolution: { kind: "unregistered", reference: { kind: "web", url: `https://example.test/${label}` }, reason: "not registered" },
  ...(f ? { recordBlockId: `rec-${label}`, facets: f } : {}),
});
const group = <E>(entries: E[]) => ({ entries, completeness: { kind: "complete" as const }, invalidCount: 0, diagnostics: [] });
const source = (title: string, kind: string, label: string, bucket: string | undefined, at: string) => ({
  blockId: `b-${title}`, title, parentContext: "Top level", createdAt: at, updatedAt: at, occurrenceCount: 1, referenceGroups: [{ kind: "block" as const, count: 1 }],
  occurrences: [], occurrencesTruncated: false,
  facets: { kind, kindLabel: label, placement: "other" as const, ...(bucket ? { stage: { property: "outbox", value: bucket, bucket: bucket as never } } : {}) },
});

const data = (): LinkData => ({
  links: { kind: "ready", value: {
    kind: "ready", ownerId: "me", ownerTextDigest: "x",
    outlinks: group([
      outlink("Zinnia letter", facets("outbox-item", "Outbox item", "done", "2026-03-02T00:00:00Z")),
      outlink("Ask Ana", facets("outbox-item", "Outbox item", "waiting", "2026-03-01T00:00:00Z")),
      outlink("Seed shelf", facets("note", "Note", undefined, "2026-03-04T00:00:00Z")),
      outlink("Lost page"),
    ]),
    resources: group([
      resource("Seed ticket", facets("ticket", "Ticket", "active", "2026-03-03T00:00:00Z")),
      resource("Plain file"),
    ]),
  } as AuthoredLinksSnapshot },
  backlinks: { kind: "ready", value: {
    targetBlockId: "me", completeness: { kind: "complete" },
    sources: [
      source("Offer onion sets", "outbox-item", "Outbox item", "draft", "2026-03-05T00:00:00Z"),
      source("Thank the hosts", "outbox-item", "Outbox item", "done", "2026-03-06T00:00:00Z"),
      source("Market morning", "day-page", "Day page", undefined, "2026-03-07T00:00:00Z"),
    ],
  } as BacklinkCollection },
});

const rows = (o: Partial<BacklinkViewOptions>, sortAll = true) =>
  linkRows(data(), { shut: new Set(), kinds: new Set(["outbox-item", "day-page"]), backlinks: { ...DEFAULT_BACKLINK_VIEW_OPTIONS, ...o }, sortAll });
const entries = (o: Partial<BacklinkViewOptions>) => {
  const out: Record<"outlinks" | "resources" | "backlinks" | "children", string[]> = { outlinks: [], resources: [], backlinks: [], children: [] };
  let g: keyof typeof out = "outlinks";
  for (const r of rows(o)) { if (r.kind === "group") g = r.group; else if (r.kind !== "kind") out[g].push(linkWords(r).text.replace(/ →.*/, "")); }
  return out;
};

describe("Kind, Stage and Sort apply to every group", () => {
  test("kind: only the links whose target is that kind stay, in all three groups; a link with no target block drops out", () => {
    const e = entries({ kind: "outbox-item" });
    expect(e.outlinks.sort()).toEqual(["Ask Ana", "Zinnia letter"]);
    expect(e.resources).toEqual([]);
    expect(e.backlinks.sort()).toEqual(["Offer onion sets", "Thank the hosts"]);
  });

  test("stage: open keeps waiting, draft and active ones; done keeps done ones; a link with no stage drops out", () => {
    const open = entries({ stage: "open" });
    expect(open.outlinks).toEqual(["Ask Ana"]);
    expect(open.resources).toEqual(["Seed ticket"]);
    expect(open.backlinks).toEqual(["Offer onion sets"]);
    const done = entries({ stage: "done" });
    expect(done.outlinks).toEqual(["Zinnia letter"]);
    expect(done.resources).toEqual([]);
    expect(done.backlinks).toEqual(["Thank the hosts"]);
  });

  test("nothing narrowing: every link stays, the unavailable ones too", () => {
    const e = entries({});
    expect(e.outlinks.length).toBe(4);
    expect(e.resources.length).toBe(2);
    expect(e.outlinks).toContain("Lost page");
  });

  test("sort: open first, then the chosen field; a link with no target block last whichever way", () => {
    expect(entries({}).outlinks).toEqual(["Ask Ana", "Seed shelf", "Zinnia letter", "Lost page"]);                 // updated ↓
    expect(entries({ sortDirection: "asc" }).outlinks).toEqual(["Ask Ana", "Zinnia letter", "Seed shelf", "Lost page"]);
    expect(entries({ sortField: "title", sortDirection: "asc" }).outlinks).toEqual(["Ask Ana", "Seed shelf", "Zinnia letter", "Lost page"]);
    expect(entries({ sortField: "title", sortDirection: "desc" }).outlinks).toEqual(["Ask Ana", "Zinnia letter", "Seed shelf", "Lost page"]);
    expect(entries({ sortField: "title" }).resources).toEqual(["Seed ticket", "Plain file"]);
    expect(entries({ sortField: "title", sortDirection: "asc" }).backlinks).toEqual(["Offer onion sets", "Thank the hosts", "Market morning"]);
  });

  test("the tree and the inline component keep the note's order unless asked (sortAll)", () => {
    const order = rows({}, false).filter(r => r.kind === "outlink").map(r => linkWords(r).text.replace(/ →.*/, ""));
    expect(order).toEqual(["Zinnia letter", "Ask Ana", "Seed shelf", "Lost page"]);
  });

  test("the text filter also reads a target's kind and stage", () => {
    expect(entries({ filter: "ticket" }).resources).toEqual(["Seed ticket"]);
    expect(entries({ filter: "waiting" }).outlinks).toEqual(["Ask Ana"]);
  });
});

describe("the counters count across the groups, and say which", () => {
  test("matching of all, per group; the kinds present in any group", () => {
    const all = linkAcross(data(), DEFAULT_BACKLINK_VIEW_OPTIONS);
    expect(all).toMatchObject({ matching: 9, total: 9, filtered: 0, by: { outlinks: { matching: 4, total: 4 }, resources: { matching: 2, total: 2 }, backlinks: { matching: 3, total: 3 } } });
    expect(all.kinds.map(k => k.kind).sort()).toEqual(["day-page", "note", "outbox-item", "ticket"]);
    const open = linkAcross(data(), { ...DEFAULT_BACKLINK_VIEW_OPTIONS, stage: "open" });
    expect(open).toMatchObject({ matching: 3, total: 9, filtered: 6, by: { outlinks: { matching: 1, filtered: 3 }, resources: { matching: 1, filtered: 1 }, backlinks: { matching: 1, filtered: 2 } } });
  });

  test("the status says '3 of 9 match', then →1/4 ♦1/2 ←1/3, and 6 filtered", () => {
    const o = { ...DEFAULT_BACKLINK_VIEW_OPTIONS, stage: "open" as const };
    const a = linkAcross(data(), o);
    const text = backlinkStatusParts(backlinkView((data().backlinks as { value: BacklinkCollection }).value, o), o, o.filter, a).map(p => p.text);
    expect(text).toEqual(expect.arrayContaining(["3 of 9 match", "→1/4 ♦1/2 ←1/3", "6 filtered", "Stage: open"]));
  });

  test("kind names from outlinks and resources are accepted by the view's kind option", () => {
    const kinds = linkAcross(data(), DEFAULT_BACKLINK_VIEW_OPTIONS).kinds;
    expect(backlinkOptionsFrom(DEFAULT_BACKLINK_VIEW_OPTIONS, { kind: "Ticket" }, kinds).kind).toBe("ticket");
    expect(() => backlinkOptionsFrom(DEFAULT_BACKLINK_VIEW_OPTIONS, { kind: "recipe" }, kinds)).toThrow("no recipe among");
  });
});

describe("the header keeps its controls where they are", () => {
  const states: Partial<BacklinkViewOptions>[] = [
    {}, { kind: "outbox-item" }, { kind: "day-page", stage: "waiting" }, { stage: "open", sortField: "title", sortDirection: "asc" },
    { kind: "ticket", stage: "done", sortField: "created" }, { filter: "an", showRelated: true, showResolved: true },
  ];
  const at = (cols: number, o: Partial<BacklinkViewOptions>) => {
    const opts = { ...DEFAULT_BACKLINK_VIEW_OPTIONS, ...o };
    const parts = backlinkStatusParts(backlinkView((data().backlinks as { value: BacklinkCollection }).value, opts), opts, opts.filter, linkAcross(data(), opts));
    return layoutLinksStatus(parts, cols, 6, () => "").segs;
  };
  const slotOf = (segs: ReturnType<typeof at>, label: string) => segs.find(s => s.text.startsWith(label));

  test.each([60, 90, 120])("at %i columns the counters, Kind, Stage and Sort sit at the same cell whatever the values", cols => {
    const base = at(cols, {});
    const where = (segs: ReturnType<typeof at>) => ["", "", "Kind:", "Stage:", "Sort:"].map((l, i) => i < 2 ? null : (s => s && [s.x, s.y])(slotOf(segs, l)));
    for (const o of states) {
      const segs = at(cols, o);
      expect(where(segs)).toEqual(where(base));
      // The counters: first on line 1, the group counts after them.
      expect(segs.find(s => / of \d+ match/.test(s.text))).toMatchObject({ x: 0, y: 0 });
      expect(segs.find(s => s.text.startsWith("→"))).toMatchObject({ x: 20, y: 0 });
      // Nothing is wider than its slot or off the edge.
      for (const s of segs) expect(s.x + s.cols).toBeLessThanOrEqual(cols);
    }
  });

  test("a long kind is cut with … inside its slot; the Stage and Sort beside it don't move", () => {
    const long = at(90, { kind: "outbox-item" });
    const kinds = linkAcross(data(), DEFAULT_BACKLINK_VIEW_OPTIONS).kinds;
    const parts = backlinkStatusParts(backlinkView((data().backlinks as { value: BacklinkCollection }).value, DEFAULT_BACKLINK_VIEW_OPTIONS), DEFAULT_BACKLINK_VIEW_OPTIONS, "", { ...linkAcross(data(), DEFAULT_BACKLINK_VIEW_OPTIONS), kinds: [{ kind: "outbox-item", label: "A very long kind label indeed, longer than any slot" }] });
    parts.find(p => p.slot === "kind")!.text = "Kind: A very long kind label indeed, longer than any slot";
    const cut = layoutLinksStatus(parts, 90, 6, () => "").segs;
    expect(slotOf(cut, "Kind:")!.text.endsWith("…")).toBe(true);
    expect(slotOf(cut, "Stage:")).toMatchObject({ x: slotOf(long, "Stage:")!.x, y: slotOf(long, "Stage:")!.y });
    expect(slotOf(cut, "Sort:")).toMatchObject({ x: slotOf(long, "Sort:")!.x, y: slotOf(long, "Sort:")!.y });
    expect(kinds.length).toBeGreaterThan(0);
  });

  test("the filter and the notes come after the controls, so they move nothing above them", () => {
    const segs = at(90, { filter: "an", showRelated: true });
    const kind = slotOf(segs, "Kind:")!, filter = slotOf(segs, "Filter:")!;
    expect(filter.y).toBeGreaterThan(kind.y);
    expect(filter.x).toBe(0);
  });
});

// PIE-693: Children is a group in the one model, narrowed and counted as the others are.
const child = (title: string, f?: AuthoredTargetFacets): ChildLink => ({
  block: { id: `c-${title}`, text: title, parentId: "me", childIds: [], createdAt: 0, updatedAt: Date.parse(f?.updatedAt ?? "2026-03-01T00:00:00Z"), author: "ana", props: {} } as Msg,
  ...(f ? { facets: f } : {}),
});
const withChildren = (): LinkData => ({ ...data(), children: { kind: "ready", value: [
  child("Water the seedlings", facets("task", "Task", "waiting", "2026-03-08T00:00:00Z")),
  child("Label the trays", facets("task", "Task", "done", "2026-03-09T00:00:00Z")),
  child("A loose thought"),
] } });
const view = (o: Partial<BacklinkViewOptions> = {}, only?: Set<"outlinks" | "resources" | "backlinks" | "children">) =>
  ({ shut: new Set<never>(), kinds: new Set(["outbox-item", "day-page"]), backlinks: { ...DEFAULT_BACKLINK_VIEW_OPTIONS, ...o }, sortAll: true, ...(only ? { only } : {}) });
const childTexts = (o: Partial<BacklinkViewOptions> = {}, only?: Set<"outlinks" | "resources" | "backlinks" | "children">) =>
  linkRows(withChildren(), view(o, only)).filter(r => r.kind === "child").map(r => linkWords(r).text);

describe("Children: a group in the one links model (PIE-693)", () => {
  test("listed last, under its own header, only where the list reads children (the tree's rows are its children already)", () => {
    const groups = linkRows(withChildren(), view()).filter(r => r.kind === "group").map(r => r.kind === "group" ? r.group : "");
    expect(groups).toEqual(["outlinks", "resources", "backlinks", "children"]);
    expect(linkRows(data(), view()).some(r => r.kind === "group" && r.group === "children")).toBe(false);
  });

  test("Kind, Stage, the filter and Sort narrow and order children as every other group", () => {
    expect(childTexts({ stage: "open" })).toEqual(["Water the seedlings"]);
    expect(childTexts({ stage: "done" })).toEqual(["Label the trays"]);
    expect(childTexts({ kind: "task" }).sort()).toEqual(["Label the trays", "Water the seedlings"]);
    expect(childTexts({ filter: "trays" })).toEqual(["Label the trays"]);
    // open first, then by updated; a child with no facets after the rest
    expect(childTexts()).toEqual(["Water the seedlings", "Label the trays", "A loose thought"]);
  });

  test("the counters count it, and a tile that lists some groups counts only those", () => {
    const all = linkAcross(withChildren(), DEFAULT_BACKLINK_VIEW_OPTIONS);
    expect(all).toMatchObject({ matching: 12, total: 12, by: { children: { matching: 3, total: 3 } } });
    expect(all.kinds.map(k => k.kind)).toContain("task");
    const only = linkAcross(withChildren(), { ...DEFAULT_BACKLINK_VIEW_OPTIONS, stage: "open" }, new Set(["children"]));
    expect(only).toMatchObject({ matching: 1, total: 3, filtered: 2 });
    expect(Object.keys(only.by)).toEqual(["children"]);
    const o = { ...DEFAULT_BACKLINK_VIEW_OPTIONS, stage: "open" as const };
    const text = backlinkStatusParts(backlinkView((data().backlinks as { value: BacklinkCollection }).value, o), o, o.filter, only).map(p => p.text);
    expect(text).toEqual(expect.arrayContaining(["1 of 3 match", "↓1/3"]));
  });

  test("a tile with Children alone lists its group and nothing else", () => {
    const rows = linkRows(withChildren(), view({}, new Set(["children"])));
    expect(rows.filter(r => r.kind === "group").length).toBe(1);
    expect(rows.filter(r => r.kind === "child").length).toBe(3);
    expect(rows.some(r => r.kind === "outlink" || r.kind === "backlink" || r.kind === "resource")).toBe(false);
  });
});

describe("the service sends what an Outlink's target is", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); }, 20_000);

  test("authoredLinks carries each ready Outlink's kind, stage and dates, which the door's filters read", async () => {
    const mk = (text: string) => board.request<any>("create", { parentId: null, text, author: "agent" });
    const waiting = await mk("Ask Ana about bean seed [type::outbox-item] [outbox::waiting]");
    const done = await mk("Thank the swap hosts [type::outbox-item] [outbox::done]");
    const plain = await mk("Seed shelf");
    const owner = await mk(`((${waiting.id}))\n((${done.id}))\n((${plain.id}))`);
    const snap = await board.authoredLinks(owner.id);
    if (snap.kind !== "ready") throw new Error(snap.kind);
    const data: LinkData = { links: { kind: "ready", value: snap }, backlinks: { kind: "loading" } };
    const a = linkAcross(data, { ...DEFAULT_BACKLINK_VIEW_OPTIONS, stage: "open" });
    expect(a.by.outlinks).toMatchObject({ matching: 1, total: 3 });
    expect(a.kinds.map(k => k.kind).sort()).toEqual(["note", "outbox-item"]);
    const only = linkRows(data, { shut: new Set(), kinds: new Set(), backlinks: { ...DEFAULT_BACKLINK_VIEW_OPTIONS, kind: "outbox-item", stage: "done" }, sortAll: true });
    expect(only.filter(r => r.kind === "outlink").map(r => linkWords(r).text)).toEqual([expect.stringContaining("Thank the swap hosts")]);
  }, 20_000);

  test("a note's children come with their kind and stage from blocks.facets; comments under it don't list as children", async () => {
    const mk = (text: string, parentId: string | null = null) => board.request<any>("create", { parentId, text, author: "agent" });
    const plan = await mk("Bean bed plan [type::project]");
    await mk("Ask about netting [type::outbox-item] [outbox::waiting]", plan.id);
    await mk("Dig the trench [work-stage::done]", plan.id);
    await mk("A margin note [type::annotation]", plan.id);
    const kids = await readChildren(board, plan.id);
    expect(kids.map(k => k.block.text.split(" [")[0]).sort()).toEqual(["Ask about netting", "Dig the trench"]);
    const ask = kids.find(k => k.block.text.startsWith("Ask"))!;
    expect(ask.facets).toMatchObject({ kind: "outbox-item", stage: { bucket: "waiting" } });
    const data: LinkData = { links: { kind: "loading" }, backlinks: { kind: "loading" }, children: { kind: "ready", value: kids } };
    expect(linkAcross(data, { ...DEFAULT_BACKLINK_VIEW_OPTIONS, stage: "open" }, new Set(["children"])).by.children).toMatchObject({ matching: 1, total: 2 });
  }, 20_000);
});

describe("a links tile with Children alone (PIE-693)", () => {
  // A desk that answers children at once and backlinks never: the tile mustn't wait on (or ask) what it doesn't list.
  const note = { id: "n1", text: "Swap thread", parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "ana", props: {} } as Msg;
  const kid = { ...note, id: "k1", text: "Ana: beans", parentId: "n1" } as Msg;
  test("lists its replies without asking for backlinks, and says its groups", async () => {
    const { BacklinksPane } = await import("../src/desk/backlinks-pane");
    let backlinksAsked = 0, redraws = 0;
    const board = {
      children: async () => [kid], facets: async () => ({ facets: {}, missing: [] }), authoredLinks: async () => ({ kind: "ready", ownerId: "n1", ownerTextDigest: "x", outlinks: group([]), resources: group([]) }),
      backlinks: () => { backlinksAsked++; return new Promise(() => {}); },
    };
    const desk = { ctx: { board, flash() {} }, redraw() { redraws++; }, tileShowing: () => note } as any;
    const p = new BacklinksPane("reader", false, ["children"]);
    p.render(60, 20, false, desk);
    await Bun.sleep(5);
    expect(backlinksAsked).toBe(0);
    expect(p.rows().filter(r => r.kind === "child").map(r => linkWords(r).text)).toEqual(["Ana: beans"]);
    expect(p.describe()).toMatchObject({ groups: ["children"] });
    expect(p.spec()).toMatchObject({ linkGroups: "children" });
    expect(p.title()).toContain("1 reply");
  });
});
