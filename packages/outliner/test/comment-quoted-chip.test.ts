// PIE-1589: a chip written in a comment or a reply is words. Nothing a session reads, routes or lists changes, and the
// words all land, a body that is nothing but a chip or a picture too. Scratch stores only.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractAnnotationBody } from "../src/annotations";
import { OutlinerStore } from "../src/store";

const stores: Array<{ store: OutlinerStore; directory: string }> = [];
afterEach(() => { for (const { store, directory } of stores.splice(0)) { store.close(); rmSync(directory, { recursive: true, force: true }); } });
function makeStore(): OutlinerStore {
  const directory = mkdtempSync(join(tmpdir(), "pie1589-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  stores.push({ store, directory });
  return store;
}

test("a chip quoted in a comment and a reply is no property: orient's query, a page and a type stay as they were", () => {
  const store = makeStore();
  const orientation = store.create("Read this first [orient::all]");
  const note = store.create("Seed order\nAsk about the seeds");
  const words = "the rule note carries [orient::all], and [page::seeds] and [type::day] are chips too";
  const thread = store.create(`Comment on “Ask about the seeds”\n[type::annotation] [annotation-source::agent] [annotation-status::open]\n${words}`, note.id, "agent", { actorId: "marginalia" });
  const reply = store.replyToAnnotation("r1", { annotationId: thread.id, body: words, source: "agent" }).annotations[0]!;
  // The query the mod's orient hook sends (hooks/orient-notes.ts), as the service answers it.
  expect(store.queryBlocks({ where: `orient="all"` }).blocks.map(b => b.id)).toEqual([orientation.id]);
  expect(store.queryBlocks({ where: "type=day" }).blocks).toEqual([]);
  expect(store.resolvePageAddress("seeds").status).toBe("missing");
  expect(store.getAnnotation(reply.block.id).body).toBe(words);
});

test("a comment that is nothing but a chip or a picture keeps its words", () => {
  const head = "Comment on “Seed order”\n[type::annotation] [annotation-source::user] [annotation-status::open]\n";
  expect(extractAnnotationBody(`${head}[orient::all]`)).toBe("[orient::all]");
  expect(extractAnnotationBody(`${head}[img::/media/plot.png]\n\nthe plot`)).toBe("[img::/media/plot.png]\n\nthe plot");
  // A block written some other way still reads as before.
  expect(extractAnnotationBody("[type::annotation] [kind::note]\nthe words")).toBe("the words");
});
