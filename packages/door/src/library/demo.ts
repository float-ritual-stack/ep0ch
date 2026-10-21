import type { FigureAnswer } from "@ep0ch/outline-core/figure-live";
import type { LinkData } from "../links";
import type { SiteProduced } from "@ep0ch/outline-core/protocol";

const day = Date.UTC(2026, 2, 2);
const items = ["Order seeds", "Paint the shelf", "Water the beds"].map((title, n) => ({
  id: `library-example-${n}`, title, properties: [{ key: "status", values: [n ? "open" : "done"] }], createdAt: day, updatedAt: day, author: "user",
}));

export const figureDemo: FigureAnswer = {
  items, truncated: false,
  groups: [
    { value: "open", count: 2, ids: items.slice(1).map(i => i.id) },
    { value: "done", count: 1, ids: [items[0]!.id] },
  ],
};

export const linksDemo: LinkData = {
  links: { kind: "ready", value: {
    kind: "ready", ownerId: "library-example", ownerTextDigest: "library-demo",
    outlinks: { entries: [{ key: "seed-list", kind: "outlink", referenceKind: "block", label: "Seed list", firstSpan: { start: 0, end: 9 }, occurrenceCount: 1,
      resolution: { kind: "ready", target: { kind: "block", blockId: "library-seed-list" }, title: "Seed list" } }], completeness: { kind: "complete" }, invalidCount: 0, diagnostics: [] },
    resources: { entries: [{ key: "garden-guide", kind: "resource", label: "Garden guide", firstSpan: { start: 0, end: 12 }, occurrenceCount: 1,
      resolution: { kind: "ready", target: { kind: "resource", resourceId: "library-guide" }, sourceName: "Garden guide", provider: "web", addressLabel: "https://example.org/garden" } }], completeness: { kind: "complete" }, invalidCount: 0, diagnostics: [] },
  } },
  backlinks: { kind: "ready", value: { targetBlockId: "library-example", sources: [{ blockId: "library-garden-plan", title: "Garden plan", parentContext: "Allotment", createdAt: new Date(day).toISOString(), updatedAt: new Date(day).toISOString(), occurrenceCount: 1,
    referenceGroups: [{ kind: "block", count: 1 }], occurrences: [], occurrencesTruncated: false,
    facets: { kind: "note", kindLabel: "Notes", placement: "other" },
  }], completeness: { kind: "complete" } } },
  children: { kind: "ready", value: items.map(item => ({ block: { ...item, properties: item.properties.flatMap(p => p.values.map(value => ({ key: p.key, value }))), text: item.title, parentId: "library-example", childIds: [] } })) },
};
linksDemo.matches = linksDemo.children;

export const fieldsDemo: Extract<SiteProduced, { kind: "fields" }> = {
  kind: "fields", key: "connectTo", from: "library-example", revision: 1,
  rows: [
    { value: "Seed list", line: 2, mark: "connectTo:1" },
    { value: "Garden plan", line: 5, mark: "connectTo:2" },
  ],
};
