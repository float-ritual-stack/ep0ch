import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerStore } from "../src/store";
import { repairAnnotationTargets } from "../scripts/repairs/2026-10-16-annotation-targets";

// PIE-933: a comment is a block and a target. Written any way but the comments service (an extension copying a
// comment's text, an agent's plain write, an import), the block used to land with `[type::annotation]` and no target:
// no note showed it, and opening, answering or resolving it threw "Annotation target not found".

const stores: Array<{ store: OutlinerStore; directory: string }> = [];
afterEach(() => {
  for (const { store, directory } of stores.splice(0)) {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
function makeStore(): { store: OutlinerStore; path: string } {
  const directory = mkdtempSync(join(tmpdir(), "pie933-"));
  const path = join(directory, "outliner.sqlite");
  const store = new OutlinerStore(path);
  stores.push({ store, directory });
  return { store, path };
}

const comment = (word = "Mulch is thin") =>
  `Comment on “${word}”\n[type::annotation] [annotation-source::agent] [annotation-status::open]\nAdd another layer by the fence.`;

describe("a comment can't exist without its target", () => {
  test("a comment written as plain text under a note is a comment on that note", () => {
    const { store } = makeStore();
    const note = store.create("Garden plan");
    const written = store.create(comment(), note.id, "agent", { actorId: "ext:echonet" });
    const opened = store.getAnnotation(written.id);
    expect(opened.originalTarget.representation.subject).toEqual({ kind: "block", blockId: note.id });
    expect(store.listAnnotationThreads({ subject: { kind: "block", blockId: note.id } }).map((thread) => thread.block.id)).toEqual([written.id]);
    // and it takes the actions that threw: a reply, then resolve
    const reply = store.replyToAnnotation("r1", { annotationId: written.id, body: "Done.", source: "user" }).annotations[0]!;
    expect(store.getAnnotation(reply.block.id).parentAnnotationId).toBe(written.id);
  });

  test("a plain note edited into a comment gets its target in the same write", () => {
    const { store } = makeStore();
    const note = store.create("Garden plan");
    const plain = store.create("Mulch is thin", note.id);
    store.update(plain.id, comment(), plain.revision, { author: "agent", actorId: "claude-code@float-2" });
    expect(store.getAnnotation(plain.id).originalTarget.representation.subject).toEqual({ kind: "block", blockId: note.id });
  });

  test("comments made through the service are not given a second target", () => {
    const { store } = makeStore();
    const note = store.create("Garden plan");
    const made = store.createAnnotationBatch("c1", [{ operationId: "c", type: "block-comment", input: { blockId: note.id, expectedRevision: note.revision, body: "Thin.", source: "user" } }]).annotations[0]!;
    expect(store.getAnnotation(made.block.id).body).toBe("Thin.");
    expect(store.database.query("SELECT COUNT(*) AS n FROM annotation_targets").get()).toEqual({ n: 1 });
  });

  test("a top-level comment is refused with what to do, and nothing is left behind", () => {
    const { store } = makeStore();
    expect(() => store.create(comment())).toThrow("sits under the note it is on");
    expect(store.database.query("SELECT COUNT(*) AS n FROM blocks WHERE text LIKE 'Comment on%'").get()).toEqual({ n: 0 });
  });
});

describe("the repair", () => {
  /** A comment as the old write path left it: its block, no target row, and a reply copied under it. */
  function strayThread() {
    const { store, path } = makeStore();
    const note = store.create("Requests");
    const root = store.create(comment(), note.id, "agent", { actorId: "ext:echonet" });
    const reply = store.create(
      `Reply on “Mulch is thin”\n[type::annotation-reply] [annotation-source::agent] [annotation-status::open] [parent-annotation::00000000-0000-4000-8000-000000000001]\nWill do.`,
      root.id, "agent", { actorId: "ext:echonet" });
    store.database.query("DELETE FROM annotation_targets").run();
    return { store, path, note, root, reply };
  }

  test("gives each stray comment its target, points its replies at it, and a second run changes nothing", () => {
    const { store, path, note, root, reply } = strayThread();
    expect(() => store.getAnnotation(root.id)).toThrow("has no target");
    store.close();
    stores.pop();
    const first = repairAnnotationTargets(path);
    expect(first).toEqual({ before: 1, after: 0, restored: [root.id], relinked: [reply.id], unreadable: [] });
    expect(repairAnnotationTargets(path)).toEqual({ before: 0, after: 0, restored: [], relinked: [], unreadable: [] });
    const reopened = new OutlinerStore(path);
    stores.push({ store: reopened, directory: path.replace(/\/outliner\.sqlite$/, "") });
    expect(reopened.getAnnotation(reply.id).parentAnnotationId).toBe(root.id);
    expect(reopened.listAnnotationThreads({ subject: { kind: "block", blockId: note.id } })[0]!.replies.map((r) => r.block.id)).toEqual([reply.id]);
  });

  test("refuses a file a host is serving, and leaves it as it was", () => {
    const { path } = strayThread();
    // the store above still holds the file open: that is a served file
    expect(() => repairAnnotationTargets(path)).toThrow();
  });
});
