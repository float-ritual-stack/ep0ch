import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resourceTextRevision } from "@ep0ch/outline-core/protocol";
import { OutlinerStore } from "../src/store";

// PIE-650: a comment on a Resource's stored text, quoted from the source and kept beside it, never written to it.
function scratch() {
  const root = mkdtempSync("/tmp/resource-comments-");
  const file = join(root, "pr-body.md");
  const first = "# Rollout notes\n\nThe **cache** warms [on boot](https://example.test/boot).\n\n- step one\n- step two\n";
  writeFileSync(file, first);
  const store = new OutlinerStore(join(root, "outliner.sqlite"));
  const host = store.create("Reading [file::pr-body.md] before the rollout.");
  const resource = store.resources.internFilesystem({ path: file }).resource;
  const revision = () => resourceTextRevision(store.resources.describe(resource.id, true).filesystem!.contentHash);
  return { root, file, first, store, host, resource, revision, done: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("a comment on a Resource quotes the source, keeps the note whose link opened it and never writes the file", () => {
  const s = scratch();
  try {
    const receipt = s.store.createAnnotationBatch("c1", [{ operationId: "c", type: "resource-comment", input: {
      resourceId: s.resource.id, expectedRevision: s.revision(), body: "Is boot the right moment?", source: "user",
      passage: { quote: "warms [on boot](https://example.test/boot)" }, referenceBlockId: s.host.id } }]);
    const thread = receipt.annotations[0]!;
    expect(thread.originalTarget.representation.subject).toEqual({ kind: "resource", resourceId: s.resource.id });
    expect(thread.originalTarget.anchor).toMatchObject({ kind: "text-quote", exact: "warms [on boot](https://example.test/boot)" });
    expect(thread.originalTarget.referenceContext?.representation.subject).toEqual({ kind: "block", blockId: s.host.id });
    expect(readFileSync(s.file, "utf8")).toBe(s.first);
    expect(s.store.listAnnotationThreads({ subject: { kind: "resource", resourceId: s.resource.id }, includeResolved: true })).toHaveLength(1);
  } finally { s.done(); }
});

test("a comment refuses a stale text, an ambiguous quote, a reference note that doesn't link the Resource, and a Resource with no text", () => {
  const s = scratch();
  try {
    const op = (input: Record<string, unknown>) => [{ operationId: "c", type: "resource-comment" as const, input: {
      resourceId: s.resource.id, expectedRevision: s.revision(), body: "x", source: "user" as const, ...input } as any }];
    expect(() => s.store.createAnnotationBatch("a", op({ expectedRevision: s.revision() + 1, passage: { quote: "cache" } }))).toThrow("stale");
    expect(() => s.store.createAnnotationBatch("b", op({ passage: { quote: "step" } }))).toThrow("ambiguous");
    expect(() => s.store.createAnnotationBatch("c", op({ passage: { quote: "cache" }, referenceBlockId: s.store.create("nothing here").id }))).toThrow("no link to this Resource");
    const bare = s.store.createAnnotationBatch("d", op({ passage: { quote: "step", start: s.first.indexOf("step two") } }));
    expect(bare.annotations[0]!.originalTarget.anchor).toMatchObject({ exact: "step" });
  } finally { s.done(); }
});

test("a rewritten file re-anchors a thread whose quote survives, and keeps one whose quote is gone, then a missing file keeps both", () => {
  const s = scratch();
  try {
    const [kept, lost] = ["The **cache**", "- step two"].map((quote, i) => s.store.createAnnotationBatch(`r${i}`, [{ operationId: "c", type: "resource-comment", input: {
      resourceId: s.resource.id, expectedRevision: s.revision(), body: `about ${quote}`, source: "agent", passage: { quote } } }]).annotations[0]!);
    const subject = { kind: "resource" as const, resourceId: s.resource.id };
    writeFileSync(s.file, "# Rollout notes (v2)\n\nA new paragraph first.\n\nThe **cache** warms [on boot](https://example.test/boot).\n\n- step one\n");
    const after = s.store.reconcileAnnotationThreads({ subject });
    expect(after.changed).toBe(true);
    expect(after.revision).toBe(s.revision());
    const keptNow = after.threads.find(t => t.block.id === kept.block.id)!;
    const lostNow = after.threads.find(t => t.block.id === lost.block.id)!;
    expect(keptNow.resolvedTarget?.anchor).toMatchObject({ kind: "text-quote", exact: "The **cache**" });
    expect((keptNow.resolvedTarget!.anchor as any).start).toBeGreaterThan(kept.originalTarget.anchor.kind === "text-quote" ? (kept.originalTarget.anchor.start ?? 0) : 0);
    expect(lostNow.resolvedTarget).toBeNull();
    expect(lostNow.originalTarget.anchor).toMatchObject({ exact: "- step two" });
    rmSync(s.file);
    const gone = s.store.reconcileAnnotationThreads({ subject });
    expect(gone.unavailable).toContain("can't be read");
    expect(gone.threads).toHaveLength(2);
  } finally { s.done(); }
});
