// PIE-1314: the one-off script that rewrites an outline's old note mover rules, on a scratch outline: a dry run writes
// nothing, --apply rewrites through the service, attributed, and the rule still moves notes afterwards. Made-up notes.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";
import { scratchOutline } from "./scratch-outline";

const SCRIPT = join(import.meta.dir, "../scripts/rename-route-to-note-mover.ts");
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function start() {
  const root = mkdtempSync(join(tmpdir(), "outliner-rename-"));
  const scratch = scratchOutline(root);
  const store = new OutlinerStore(scratch.database);
  const server = new OutlinerServer(store, scratch.socket, undefined, undefined, { extensionPollMs: 0, routeQuietMs: 50 });
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const client = new OutlinerClient(scratch.socket);
  const create = (text: string, parentId?: string) => client.request<Block>({ action: "create", text, ...(parentId ? { parentId } : {}), author: "user" });
  const run = async (...args: string[]) => {
    const proc = Bun.spawn([process.execPath, SCRIPT, "--ws", scratch.name, ...args], { env: { ...process.env, ...scratch.env }, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code: await proc.exited, out, err };
  };
  return { store, client, create, run };
}

test("a dry run lists every note and writes nothing; --apply rewrites them, attributed; a second run has nothing to do", async () => {
  const { store, client, create, run } = await start();
  const jars = await create("Jars");
  const rule = await create(`Jars go up [type::route] [query::type=jar] [route-to::((${jars.id}))] [route-at::end] [route-when::command]\nFiled by hand since spring.`);
  const half = await create("Half a rule [type::route] [query::type=tin]");
  const view = await create("Rules in the kitchen [type::virtual-branch] [query::type=route AND #kitchen]");
  const words = await create("Notes on the rename: type=route is the old way to ask");
  const moved = await create("Damson jar [type::jar]");
  const history = await create(`Routing history [type::route-history] [machine::route]\n\n- 2026-03-02 10:00Z ((${moved.id})) to ((${jars.id}))`, rule.id);
  const hub = store.liveBlocks().find(b => b.properties.some(p => p.key === "system-view" && p.value === "note-mover"))!;
  // An outline seeded before the rename, as pie and gurgle are.
  await client.request({ action: "update", blockId: hub.id, expectedRevision: hub.revision, mutation: { author: "agent", actorId: "test" },
    text: "Routing [page::routing] [type::virtual-branch] [system-view::routing] [query::type=route] [limit::200]\n\nNotes route themselves by the rules listed here, and a rule is a note." });
  const before = new Map(store.liveBlocks().map(b => [b.id, b.revision]));

  const dry = await run();
  expect(dry.code).toBe(0);
  for (const b of [rule, view, history, hub]) expect(dry.out).toContain(b.id.slice(0, 8));
  expect(dry.out).toContain("4 would change, 2 left as written");
  expect(dry.out).toContain(`${half.id.slice(0, 8)} left as written`);
  expect(dry.out).toContain(`${words.id.slice(0, 8)} left as written`);
  expect(new Map(store.liveBlocks().map(b => [b.id, b.revision]))).toEqual(before);

  const applied = await run("--apply");
  expect(applied.err).toBe("");
  expect(applied.code).toBe(0);
  expect(applied.out.trim().split("\n").at(-1)).toBe("4 changed, 0 failed, 2 left as written");
  const after = store.get(rule.id)!;
  expect(after.text).toBe(`Jars go up [query::type=jar] [note-mover::((${jars.id}))] [note-mover-at::end] [note-mover-when::command]\nFiled by hand since spring.`);
  const record = await client.request<{ revisions: Array<{ revision: number; author?: string; actorId?: string }> }>({ action: "block.revisions", blockId: rule.id });
  expect(record.revisions[0]).toMatchObject({ revision: after.revision, author: "agent", actorId: "loki" });
  expect(store.get(view.id)!.text).toBe("Rules in the kitchen [type::virtual-branch] [query::note-mover AND #kitchen]");
  expect(store.get(history.id)!.text.split("\n")[0]).toBe("Moves [type::note-mover-history] [machine::note-mover]");
  const seeded = store.get(hub.id)!.text;
  expect(seeded.split("\n")[0]).toBe("Note mover [page::note-mover] [type::virtual-branch] [system-view::note-mover] [query::note-mover OR type=route] [limit::200]");
  expect(seeded).toContain("Notes move themselves by the rules listed here");
  expect(seeded).not.toContain("route themselves");
  expect(store.get(half.id)!.revision).toBe(half.revision);
  expect(store.get(words.id)!.revision).toBe(words.revision);

  // The rewritten rule still moves notes, and adds to the history it already had.
  const quince = await create("Quince jar [type::jar]");
  const routed = await client.request<{ results: Array<{ outcome: string }> }>({ action: "notes.route", ref: quince.id });
  expect(routed.results[0]!.outcome).toBe("moved");
  expect(store.get(quince.id)!.parentId).toBe(jars.id);
  expect(store.children(rule.id).map(b => b.id)).toEqual([history.id]);

  const revisions = new Map(store.liveBlocks().map(b => [b.id, b.revision]));
  const again = await run("--apply");
  expect(again.out).toContain("0 changed, 0 failed");
  expect(new Map(store.liveBlocks().map(b => [b.id, b.revision]))).toEqual(revisions);
});

test("it asks which outline, and never guesses", async () => {
  const proc = Bun.spawn([process.execPath, SCRIPT], { stdout: "pipe", stderr: "pipe" });
  const err = await new Response(proc.stderr).text();
  expect(await proc.exited).toBe(2);
  expect(err).toContain("--ws <outline>");
});
