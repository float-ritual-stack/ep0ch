import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, spyOn } from "bun:test";
import { OutlinerStore } from "../src/store";
import { answerSite } from "../src/site-answer";
import { readAuthoredLinks } from "../src/authored-links";
import { readBlockRecords } from "../src/block-records";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function store(): OutlinerStore {
  const directory = mkdtempSync(join(tmpdir(), "pi-outliner-backlinks-"));
  const result = new OutlinerStore(join(directory, "outliner.sqlite"));
  cleanups.push(() => {
    result.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return result;
}

describe("semantic backlink relation", () => {
  test("backlinks group by the anchor aimed at (PIE-1247): ((id^a)), [[page^a]] and ![[page^a]] say which part of the note", () => {
    const workspace = store();
    const plan = workspace.create("Spring plan [page::Spring plan]\n\n::graph-timeline ^sowing\n::\n\n> [!tip] Water early ^water");
    const pad = workspace.create(`Sticky pad\n![[Spring plan^sowing]]\n[[Spring plan^water]] and [[spring plan^water]]\n((${plan.id}^sowing)) and [[Spring plan]]`);
    const [source] = workspace.queryBacklinks({ targetBlockId: plan.id, limit: 10 }).sources;
    expect(source?.blockId).toBe(pad.id);
    expect(source!.referenceGroups).toEqual([
      { kind: "page", fragmentId: "sowing", count: 1 },
      { kind: "page", fragmentId: "water", count: 2 },
      { kind: "block", fragmentId: "sowing", count: 1 },
      { kind: "page", count: 1 },
    ]);
    expect(source!.occurrences[0]).toMatchObject({ kind: "page", fragmentId: "sowing" });
  });

  test("value-built links that read backlinks report a cycle instead of crashing", () => {
    const workspace = store();
    const source = workspace.create("Loop\n[[{{this.children | links:this .count}}]]");
    workspace.create("Child", source.id);
    expect(answerSite(workspace, { blockId: source.id }).values[0]?.problem?.message).toContain("cycle");
    const values = workspace.referenceValues(source.id);
    expect(values[0]?.problem?.message).toContain("cycle");
    expect(values[0]?.values).toBeUndefined();
    expect(workspace.referenceValues(source.id)[0]?.problem?.message).toContain("cycle");
  });

  test("a value-built link in a note in Trash never breaks reading the rest of the outline", () => {
    const workspace = store();
    const template = workspace.create("Envelope [ticket::PC-1]\nFor [[{{this.ticket}}]]");
    const item = workspace.create("Reply to the shed committee");
    workspace.delete(template.id);
    expect(() => workspace.referenceValues(item.id)).not.toThrow();
    expect(workspace.referenceValues(template.id)).toEqual([]);
    expect(() => workspace.queryBacklinks({ targetBlockId: item.id, limit: 50 } as never)).not.toThrow();
    // The read that failed for Evan's float-hub (Oct 22): every block record after a trashed value-link template.
    expect(readBlockRecords(workspace as never, [item.id]).records.map(r => r.id)).toEqual([item.id]);
  });

  test("value-built date and week links roll their backlinks over with the clock", () => {
    const workspace = store();
    const previous = workspace.create("Previous [page::2030-01-06]");
    const next = workspace.create("Next [page::2030-01-07]");
    const previousWeek = workspace.create("Previous week [page::2030-W01]");
    const nextWeek = workspace.create("Next week [page::2030-W02]");
    const source = workspace.create("Today\n[[{{now.date}}]] and [[{{now.week}}]]");
    const clock = spyOn(Date, "now").mockReturnValue(new Date(2030, 0, 6, 12).getTime());
    const sources = (id: string) => workspace.queryBacklinks({ targetBlockId: id, limit: 10 }).sources.map(s => s.blockId);
    try {
      expect(sources(previous.id)).toContain(source.id);
      expect(sources(previousWeek.id)).toContain(source.id);
      clock.mockReturnValue(new Date(2030, 0, 7, 12).getTime());
      expect(sources(previous.id)).not.toContain(source.id);
      expect(sources(next.id)).toContain(source.id);
      expect(sources(previousWeek.id)).not.toContain(source.id);
      expect(sources(nextWeek.id)).toContain(source.id);
    } finally { clock.mockRestore(); }
  });

  test("value-built addresses with empty parts never link to a partial address", () => {
    const workspace = store();
    const target = workspace.create("Archive [page::Archive]");
    const source = workspace.create("Plan\n[[Archive{{this.children.title}}]]");
    expect(workspace.queryBacklinks({ targetBlockId: target.id, limit: 10 }).sources.map(s => s.blockId)).not.toContain(source.id);
    const links = readAuthoredLinks(workspace, source.id);
    expect(links.kind).toBe("ready");
    if (links.kind === "ready") expect(links.outlinks.entries).toHaveLength(0);
  });

  test("value-built backlinks follow parent moves and children membership without text edits", () => {
    const workspace = store();
    const first = workspace.create("First [page::First]");
    const second = workspace.create("Second [page::Second]");
    const firstParent = workspace.create("Settings [destination::First]");
    const secondParent = workspace.create("Settings [destination::Second]");
    const source = workspace.create("Plan\n[[{{parent.destination}}]]", firstParent.id);
    const sources = (id: string) => workspace.queryBacklinks({ targetBlockId: id, limit: 10 }).sources.map(s => s.blockId);
    expect(sources(first.id)).toContain(source.id);
    workspace.move(source.id, secondParent.id);
    expect(sources(first.id)).not.toContain(source.id);
    expect(sources(second.id)).toContain(source.id);
    expect(workspace.get(source.id)!.revision).toBe(source.revision);
  });

  test("value-built backlinks follow child additions, moves, and ordering", () => {
    const workspace = store();
    const first = workspace.create("First [page::First]");
    const second = workspace.create("Second [page::Second]");
    const source = workspace.create("Plan\n[[{{this.children[0].title || First}}]]");
    const sources = (id: string) => workspace.queryBacklinks({ targetBlockId: id, limit: 10 }).sources.map(s => s.blockId);
    expect(sources(first.id)).toContain(source.id);
    const child = workspace.create("Second", source.id);
    expect(sources(first.id)).not.toContain(source.id);
    expect(sources(second.id)).toContain(source.id);
    const other = workspace.create("First", source.id);
    workspace.move(other.id, source.id, 0);
    expect(sources(first.id)).toContain(source.id);
    expect(sources(second.id)).not.toContain(source.id);
    workspace.move(other.id, null);
    expect(sources(second.id)).toContain(source.id);
    workspace.move(child.id, null);
    expect(sources(first.id)).toContain(source.id);
  });

  test("a value-built page link moves its backlink when the value changes", () => {
    const workspace = store();
    const first = workspace.create("First ticket [page::PC-1245]");
    const second = workspace.create("Second ticket [page::PC-1246]");
    const source = workspace.create("Plan [ticket::PC-1245]\nSee [[{{this.ticket}}]].");
    const sources = (id: string) => workspace.queryBacklinks({ targetBlockId: id, limit: 10 }).sources.filter(s => s.occurrences.some(o => o.kind === "page")).map(s => s.blockId);
    expect(sources(first.id)).toContain(source.id);
    workspace.update(source.id, "Plan [ticket::PC-1246]\nSee [[{{this.ticket}}]].", source.revision);
    expect(sources(first.id)).not.toContain(source.id);
    expect(sources(second.id)).toContain(source.id);
  });

  test("a parent's value moves page, reference and embed backlinks without editing their source", () => {
    const workspace = store();
    const first = workspace.create("First page [page::PC-1245]");
    const second = workspace.create("Second page [page::PC-1246]");
    const parent = workspace.create(`Settings [ticket::PC-1245] [destination::${first.id}]`);
    const source = workspace.create(`Plan\n[[{{((${parent.id})).ticket}}]] and (({{((${parent.id})).destination}}))\n!(({{parent.destination}}))`, parent.id);
    const links = (id: string) => workspace.queryBacklinks({ targetBlockId: id, limit: 10 }).sources.find(s => s.blockId === source.id);
    expect(links(first.id)?.occurrenceCount).toBe(3);
    workspace.update(parent.id, `Settings [ticket::PC-1246] [destination::${second.id}]`, parent.revision);
    expect(links(first.id)).toBeUndefined();
    expect(links(second.id)?.occurrenceCount).toBe(3);
    expect(workspace.get(source.id)!.revision).toBe(source.revision);
  });

  test("groups exact, page, and Work-ID references while excluding protected and unresolved text", () => {
    const workspace = store();
    let target = workspace.create("Target decision [page::Target Page]");
    workspace.configureWorkIdPrefix("PIE");
    target = workspace.allocateWorkId(target.id, target.revision).block;

    const source = workspace.create([
      "Grouped source",
      `((${target.id})) and [[Target Page]] and PIE-001`,
      `\`((${target.id})) [[Target Page]] PIE-001\``,
      "```text",
      `((${target.id})) [[Target Page]] PIE-001`,
      "```",
    ].join("\n"));
    workspace.create("Unresolved source\n[[Missing Page]] and PIE-999");

    const result = workspace.queryBacklinks({ targetBlockId: target.id, limit: 10 });

    expect(result).toMatchObject({
      targetBlockId: target.id,
      completeness: { kind: "complete" },
    });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      blockId: source.id,
      title: "Grouped source",
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      occurrenceCount: 3,
      occurrencesTruncated: false,
    });
    expect(result.sources[0]!.occurrences.map((occurrence) => occurrence.kind)).toEqual([
      "block",
      "page",
      "work-id",
    ]);
    expect(result.sources[0]!.occurrences.every((occurrence) =>
      occurrence.snippet.includes("and")
    )).toBe(true);
    expect(result.sources[0]!.occurrences[0]!.snippet).toContain("((Target decision))");
    expect(result.sources[0]!.occurrences[0]!.snippet).not.toContain(target.id);
  });
  test("a page link holding another links both pages, counted by brackets (PIE-592)", () => {
    const workspace = store();
    const day = workspace.create("2026-10-06 [page::2026-10-06]");
    const thoughts = workspace.create("[[2026-10-06]] - editor thoughts [page::[[2026-10-06]] - editor thoughts]");
    const source = workspace.create("Morning\nSee [[[[2026-10-06]] - editor thoughts]] before PIE-002.");

    const toThoughts = workspace.queryBacklinks({ targetBlockId: thoughts.id, limit: 10 });
    expect(toThoughts.sources.map((s) => s.blockId)).toEqual([source.id]);
    // The day is linked from the note that holds it nested, and from the thoughts page's own title.
    const toDay = workspace.queryBacklinks({ targetBlockId: day.id, limit: 10 });
    expect(toDay.sources.map((s) => s.blockId).sort()).toEqual([source.id, thoughts.id].sort());
    expect(workspace.resolvePageAddress("[[2026-10-06]] - editor thoughts")).toMatchObject({ status: "resolved", block: { id: thoughts.id } });
  });

  test("keeps duplicate titled labels attached to their canonical targets", () => {
    const workspace = store();
    const first = workspace.create("First target");
    const second = workspace.create("Second target");
    workspace.configureWorkIdPrefix("PIE");
    const source = workspace.create(
      `Source ((${first.id}|same **label** PIE-999)) and ((${second.id}|same **label** PIE-999))`,
    );

    const firstBacklinks = workspace.queryBacklinks({ targetBlockId: first.id, limit: 10 });
    const secondBacklinks = workspace.queryBacklinks({ targetBlockId: second.id, limit: 10 });
    expect(firstBacklinks.sources).toHaveLength(1);
    expect(secondBacklinks.sources).toHaveLength(1);
    expect(firstBacklinks.sources[0]).toEqual(expect.objectContaining({
      blockId: source.id,
      occurrenceCount: 1,
    }));
    expect(secondBacklinks.sources[0]).toEqual(expect.objectContaining({
      blockId: source.id,
      occurrenceCount: 1,
    }));
    expect(firstBacklinks.sources[0]!.occurrences[0]!.snippet).toContain(
      "((same **label** PIE-999))",
    );
  });

  test("keeps fragment backlinks attached to canonical targets across heading renames", () => {
    const workspace = store();
    const target = workspace.create("Target\n\n## Original heading ^durable-heading");
    const source = workspace.create(`Source\n((${target.id}^durable-heading))`);

    const before = workspace.queryBacklinks({ targetBlockId: target.id, limit: 10 });
    expect(before.sources).toMatchObject([{
      blockId: source.id,
      occurrenceCount: 1,
      referenceGroups: [{ kind: "block", count: 1 }],
    }]);
    expect(before.sources[0]!.occurrences[0]!.snippet).toContain(
      "((Target^durable-heading))",
    );

    workspace.update(
      target.id,
      "Target\n\n## Renamed heading ^durable-heading",
      target.revision,
    );
    const after = workspace.queryBacklinks({ targetBlockId: target.id, limit: 10 });
    expect(after.sources.map((candidate) => candidate.blockId)).toEqual([source.id]);
    expect(after.sources[0]!.occurrences[0]!.snippet).toContain(
      "((Target^durable-heading))",
    );
  });

  test("groups block-valued property backlinks by property key", () => {
    const workspace = store();
    const target = workspace.create("Source document");
    const source = workspace.create([
      "Annotation",
      `[source-block::${target.id}] [source-block::${target.id}]`,
      `[derived-from::${target.id}] [status::open]`,
      `\`[source-block::${target.id}]\``,
    ].join("\n"));

    const result = workspace.queryBacklinks({ targetBlockId: target.id, limit: 10 });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      blockId: source.id,
      occurrenceCount: 3,
      referenceGroups: [
        { kind: "property", propertyKey: "source-block", count: 2 },
        { kind: "property", propertyKey: "derived-from", count: 1 },
      ],
    });
    expect(result.sources[0]!.occurrences).toEqual([
      expect.objectContaining({ kind: "property", propertyKey: "source-block" }),
      expect.objectContaining({ kind: "property", propertyKey: "source-block" }),
      expect.objectContaining({ kind: "property", propertyKey: "derived-from" }),
    ]);
    expect(result.sources[0]!.occurrences.every((occurrence) =>
      occurrence.snippet.includes("Source document") &&
      !occurrence.snippet.includes(target.id)
    )).toBe(true);
  });

  test("links inside property values are edges labelled by the property; a value that is exactly a ticket key links (PIE-874)", () => {
    const workspace = store();
    const external = workspace.create("Printer jam [page::PC-1]");
    const hub = workspace.create("Hub two [page::X-2]");
    workspace.configureWorkIdPrefix("PIE");
    let item = workspace.create("Order seed trays");
    item = workspace.allocateWorkId(item.id, item.revision).block;
    const done = workspace.create("done [page::done]");
    const todo = workspace.create("Fix the printer [ticket::PC-1] [status::done]");
    const walk = workspace.create(["Graph walk", "[via::[[X-2]]]", "[waiting-on::review of PIE-001]"].join("\n"));
    const list = workspace.create("Bench [blocks::PIE-001, notes]");
    // A Work ID in a reference's label is the label's words, not a link of its own.
    const labelled = workspace.create(`Shelf [related::((${hub.id}|after PIE-001))]`);

    const of = (id: string) => workspace.queryBacklinks({ targetBlockId: id, limit: 10 }).sources;
    expect(of(external.id).map((s) => [s.blockId, s.referenceGroups])).toEqual([[todo.id, [{ kind: "property", propertyKey: "ticket", count: 1 }]]]);
    expect(of(hub.id).find((s) => s.blockId === walk.id)!.referenceGroups).toEqual([{ kind: "property", propertyKey: "via", count: 1 }]);
    expect(of(item.id).map((s) => s.blockId).sort()).toEqual([walk.id, list.id].sort());
    expect(of(hub.id).map((s) => s.blockId)).toContain(labelled.id);
    expect(of(item.id).find((s) => s.blockId === walk.id)!.occurrences[0]).toMatchObject({ kind: "property", propertyKey: "waiting-on", label: "PIE-001" });
    // A plain word that happens to be a page's address stays text; a note's own [work-id::…] is no link to itself.
    expect(of(done.id)).toEqual([]);
    expect(of(item.id).map((s) => s.blockId)).not.toContain(item.id);
    // The same edges are the source's links out.
    const out = readAuthoredLinks(workspace, todo.id);
    expect(out.kind === "ready" && out.outlinks.entries.map((e) => e.resolution.kind === "ready" ? e.resolution.target.blockId : null)).toEqual([external.id]);
  });

  test("includes nested-list references while excluding multiline indented code", () => {
    const workspace = store();
    const target = workspace.create("Nested target");
    const source = workspace.create([
      "Nested source",
      "- Parent item",
      `    - Nested item ((${target.id}))`,
      `    continuation ((${target.id}))`,
      "Outside paragraph",
      "",
      "    literal code",
      `    ((${target.id}))`,
      "    literal tail",
    ].join("\n"));

    const result = workspace.queryBacklinks({ targetBlockId: target.id, limit: 10 });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      blockId: source.id,
      occurrenceCount: 2,
      referenceGroups: [{ kind: "block", count: 2 }],
    });
  });

  test("disambiguates duplicate titles by parent context and truncates source rows", () => {
    const workspace = store();
    const target = workspace.create("Target");
    const parentA = workspace.create("Area A");
    const parentB = workspace.create("Area B");
    workspace.create(`Duplicate\n((${target.id}))`, parentA.id);
    workspace.create(`Duplicate\n((${target.id}))`, parentB.id);
    workspace.create(`Third\n((${target.id}))`);

    const result = workspace.queryBacklinks({ targetBlockId: target.id, limit: 2 });

    expect(result.completeness).toEqual({ kind: "truncated", limit: 2 });
    expect(result.sources).toHaveLength(2);
    expect(result.sources.map((source) => source.title)).toEqual(["Duplicate", "Duplicate"]);
    expect(result.sources.map((source) => source.parentContext)).toEqual(["Area A", "Area B"]);
  });

  test("excludes deleted sources by default and identifies deleted targets without vague missing rows", () => {
    const workspace = store();
    const target = workspace.create("Target");
    const activeSource = workspace.create(`Active source\n((${target.id}))`);
    const deletedSource = workspace.create(`Deleted source\n((${target.id}))`);
    workspace.delete(deletedSource.id);

    const activeOnly = workspace.queryBacklinks({ targetBlockId: target.id, limit: 10 });
    expect(activeOnly.sources.map((source) => source.blockId)).toEqual([activeSource.id]);

    const withDeleted = workspace.queryBacklinks({
      targetBlockId: target.id,
      includeDeleted: true,
      limit: 10,
    });
    expect(withDeleted.sources.map((source) => source.blockId)).toEqual([
      activeSource.id,
      deletedSource.id,
    ]);
    expect(withDeleted.sources[1]!.deletedRootId).toBe(deletedSource.id);

    workspace.delete(target.id);
    const deletedTarget = workspace.queryBacklinks({ targetBlockId: target.id, limit: 10 });
    expect(deletedTarget.targetDeletedRootId).toBe(target.id);
    expect(deletedTarget.sources.map((source) => source.blockId)).toEqual([activeSource.id]);
    expect(() => workspace.queryBacklinks({ targetBlockId: "missing-target", limit: 10 }))
      .toThrow("Block not found: missing-target");
  });
});
