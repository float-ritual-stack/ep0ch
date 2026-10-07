// `agent touch-file` (src/file-touches.ts, PIE-602): the Claude mod's Edit and Write hook records each file a session
// touches, against a private scratch service, as a spawned CLI the way the mod calls it. Fictional files only.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scratchOutline } from "./scratch-outline";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

/** The spawned CLI's environment: this fixture only, never a Herdr session or a real outline. */
function isolatedEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("HERDR_") && !key.startsWith("OUTLINER_") && !key.startsWith("EP0CH_")) env[key] = value;
  }
  return { ...env, ...extra };
}

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "outliner-agent-tools-"));
  const { env, ...paths } = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  cleanups.push(async () => {
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const cliEnv = isolatedEnv(env);
  /** One `agent` operation as the mod runs it: JSON on stdin, as the garden agent. */
  const agent = async (operation: string, input: unknown, actor = "garden-agent") => {
    const child = Bun.spawn(["bun", "src/cli.ts", "agent", operation, "--stdin", "--actor", actor, "--session", "s-9"], {
      cwd: join(import.meta.dir, ".."), env: cliEnv, stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { exitCode, stderr, json: exitCode === 0 ? JSON.parse(stdout) : undefined, stdout };
  };
  const cli = async (args: string[]) => {
    const child = Bun.spawn(["bun", "src/cli.ts", ...args], { cwd: join(import.meta.dir, ".."), env: cliEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { exitCode, stdout, stderr };
  };
  return { store, agent, cli, root };
}


const props = (b: { properties: { key: string; value: string }[] }) => Object.fromEntries(b.properties.map(p => [p.key, p.value]));

test("a session's touches of one file are one block, its count, last time and lines kept up to date, under day › project › session", async () => {
  const { store, agent } = await setup();
  const touch = (at: string, added: number, removed: number, session = "sess-aaaa1111") =>
    agent("touch-file", { path: "/work/allotment/beds/plan.md", project: "allotment", projectRoot: "/work/allotment", session, at, day: "2026-10-06", added, removed });
  const first = await touch("2026-10-06T09:00:00.000Z", 4, 1);
  expect(first.exitCode).toBe(0);
  expect(first.json).toMatchObject({ created: true, touches: 1, added: 4, removed: 1 });
  const second = await touch("2026-10-06T09:05:00.000Z", 2, 3);
  expect(second.json).toMatchObject({ id: first.json.id, created: false, touches: 2, added: 6, removed: 4 });

  const block = store.get(first.json.id)!;
  expect(block.text.split(" [")[0]).toBe("beds/plan.md");
  expect(props(block)).toMatchObject({ file: "/work/allotment/beds/plan.md", type: "file-touch", day: "2026-10-06", project: "allotment", session: "sess-aaaa1111", touches: "2", "last-touch": "2026-10-06T09:05:00.000Z", added: "6", removed: "4" });
  expect(block.author).toBe("agent");
  // Its place: session › project › day › the hub page.
  const session = store.get(block.parentId!)!, project = store.get(session.parentId!)!, day = store.get(project.parentId!)!, hub = store.get(day.parentId!)!;
  expect([session.text, project.text, day.text]).toEqual(["session sess-aaa [file-session::sess-aaaa1111]", "allotment [file-project::allotment]", "2026-10-06 [file-day::2026-10-06]"]);
  expect(hub.text).toStartWith("Recent files [page::recent-files]");

  // Another session's touch of the same file is its own block, in its own session under the same day and project.
  const other = await touch("2026-10-06T10:00:00.000Z", 1, 0, "sess-bbbb2222");
  expect(other.json.id).not.toBe(first.json.id);
  expect(store.get(store.get(other.json.id)!.parentId!)!.parentId).toBe(project.id);

  // Two sessions that made the same day at once: the oldest one is the day, and every touch goes on under it.
  store.create("2026-10-06 [file-day::2026-10-06]", hub.id);
  const third = await touch("2026-10-06T11:00:00.000Z", 1, 0, "sess-dddd4444");
  expect(store.get(store.get(store.get(third.json.id)!.parentId!)!.parentId!)!.parentId).toBe(day.id);

  // The project's view: its touches, newest first, each with its session and day.
  const view = store.queryBlocks({ limit: 1000 }).blocks.find(b => props(b)["file-project-view"] === "allotment")!;
  expect(props(view)).toMatchObject({ type: "virtual-branch", query: 'type=file-touch AND project="allotment"', sort: "last-touch", direction: "desc" });
  const members = await agent("find", { view: view.id });
  expect(members.json.blocks.map((b: { id: string }) => b.id).sort()).toEqual([first.json.id, other.json.id, third.json.id].sort());
});

test("a file outside git: the copy from before its first touch is kept once, in the outline's folder, and named on its block", async () => {
  const { store, agent } = await setup();
  const first = await agent("touch-file", { path: "/notes/seed-list.txt", project: "notes", session: "sess-cccc3333", original: "Borlotti\nChard\n", added: 1 });
  expect(first.exitCode).toBe(0);
  expect(first.json.snapshot).toMatch(/\/file-touches\/[0-9a-f]{16}\/[0-9a-f]{16}-seed-list\.txt$/);
  expect(readFileSync(first.json.snapshot, "utf8")).toBe("Borlotti\nChard\n");
  const again = await agent("touch-file", { path: "/notes/seed-list.txt", project: "notes", session: "sess-cccc3333", original: "changed since", added: 1 });
  expect(again.json.snapshot).toBe(first.json.snapshot);
  expect(readFileSync(first.json.snapshot, "utf8")).toBe("Borlotti\nChard\n");
  expect(props(store.get(first.json.id)!).snapshot).toBe(first.json.snapshot);
});

test("touch-file refuses what it can't file: a relative path, a value with ], no actor", async () => {
  const { agent } = await setup();
  expect((await agent("touch-file", { path: "beds/plan.md", project: "allotment", session: "s" })).stderr).toContain("absolute");
  expect((await agent("touch-file", { path: "/x/a]b", project: "allotment", session: "s" })).stderr).toContain("]");
});
