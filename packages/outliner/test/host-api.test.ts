// The host API (src/host-api.ts, scripting slice 1, PIE-720): the agent tools as plain functions over the service, as a
// script calls them. Against a private scratch service; fictional notes only.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { hostApi } from "../src/host-api";
import { runScript } from "../src/script-runtime";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { scratchOutline } from "./scratch-outline";

const cleanups: Array<() => Promise<void>> = [];

test("QuickJS calls the real host API and streams completed writes before the run ends", async () => {
  const { store, client } = await setup();
  const seen: string[] = [];
  const api = hostApi(client, { actorId: "seed-script", sessionId: "seed-run" }, {
    onStep: step => { if (step.phase === "done") seen.push(step.tool); },
  });
  const result = await runScript(`
    const made = await tools.outline_create({ parent: "root", text: "Seed labels [type::supply]" });
    const note = await read(made.id);
    return { id: made.id, text: note.text, network: typeof fetch, disk: typeof process };
  `, api);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  const value = result.value as { id: string; text: string; network: string; disk: string };
  expect(store.get(value.id)?.actorId).toBe("seed-script");
  expect(value.text).toContain("Seed labels");
  expect(value.network).toBe("undefined");
  expect(value.disk).toBe("undefined");
  expect(seen).toContain("outline_create");
});
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "outliner-host-api-"));
  const { env, ...paths } = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  cleanups.push(async () => {
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const client = new OutlinerClient(paths.socket, 15_000);
  /** The same read as the Claude mod makes it: the CLI's `agent` operation, spawned. */
  const cliRead = async (ref: string) => {
    const child = Bun.spawn(["bun", "src/cli.ts", "agent", "read", "--json", JSON.stringify({ ref })], {
      cwd: join(import.meta.dir, ".."), env: { PATH: process.env.PATH ?? "", HOME: root, ...env }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    expect(exitCode).toBe(0);
    return JSON.parse(stdout) as Record<string, unknown>;
  };
  return { store, client, cliRead, root };
}

test("script blocks and outline script files load through the extension registry", async () => {
  const { client, root } = await setup();
  const api = hostApi(client, { actorId: "seed-author" });
  await api.call("outline_create", { parent: "root", text: "Seed count [script::seed-count]\n```js\nreturn await q('type=supply');\n```" });
  await Bun.write(join(root, "scripts", "labels.ts"), "return await read('root');");
  const listed = await client.request<{ extensions: { name?: string; state: string }[] }>({ action: "extensions.list", reload: true });
  expect(listed.extensions.find(e => e.name === "seed-count")?.state).toBe("active");
  expect(listed.extensions.find(e => e.name === "labels")?.state).toBe("active");
});

test("a block script starts at once, writes as its author, and its complete run undoes in one step", async () => {
  const { client, store } = await setup();
  const api = hostApi(client, { actorId: "seed-author" });
  const source = await api.call("outline_create", { parent: "root", text: "Seed report [script::seed-report]\n```js\nconst a = await tools.outline_create({ parent: 'root', text: 'Labels [type::supply]' });\nawait tools.outline_patch({ ref: a.id, revision: a.revision, patches: [{observed: 'Labels', replacement: 'Paper labels'}] });\nreturn 'Ready for planting';\n```" }) as { id: string };
  const listed = await client.request<{ extensions: { id: string; name?: string }[] }>({ action: "extensions.list", reload: true });
  const extension = listed.extensions.find(e => e.name === "seed-report")!;
  const run = await client.request<{ written: string[]; undo: string }>({ action: "extensions.act", extension: extension.id, extensionAction: "run" });
  const log = run.written[0]!;
  expect(store.get(log)?.text).toContain("working");
  const deadline = Date.now() + 4000;
  while (store.get(log)?.text.includes("· working") && Date.now() < deadline) await Bun.sleep(10);
  expect(store.get(log)?.text).toContain("· done");
  expect(store.get(log)?.text).toContain("Ready for planting");
  const made = store.queryBlocks({ where: "type=supply" }).blocks[0]!;
  expect(store.get(made.id)?.actorId).toBe("seed-author");
  expect(store.get(made.id)?.text).toContain("Paper labels");
  await client.request({ action: "extensions.undo", undo: run.undo });
  expect(store.get(made.id)?.effectiveDeletedRootId).toBeTruthy();
  expect(store.get(log)?.effectiveDeletedRootId).toBeTruthy();
  expect(store.get(source.id)?.effectiveDeletedRootId).toBeUndefined();
});

test("every agent tool is a function, and a script's writes are the agent's, checked against the revision it read", async () => {
  const { store, client } = await setup();
  const api = hostApi(client, { actorId: "garden-script", sessionId: "run-1" });

  const made = await api.call("outline_create", { parent: "root", text: "Seed swap [type::plan]\nBring labels." }) as { id: string; revision: number };
  const read = await api.tool.outline_read!({ ref: made.id }) as { revision: number; text: string };
  expect(read.text).toContain("Bring labels.");
  await api.tool.outline_patch!({ ref: made.id, revision: read.revision, patches: [{ observed: "Bring labels.", replacement: "Bring labels and twine." }] });

  const saved = store.get(made.id)!;
  expect(saved.text).toContain("Bring labels and twine.");
  expect(saved.author).toBe("agent");
  expect(saved.actorId).toBe("garden-script");

  // A stale revision is refused (an edit rewrites text), never written over the newer one.
  await expect(api.tool.outline_edit!({ ref: made.id, expectedRevision: read.revision, append: "Late line." })).rejects.toThrow();
  expect(store.get(made.id)!.text).not.toContain("Late line.");

  const found = await api.q("type=plan") as { blocks: { id: string }[] };
  expect(found.blocks.map(b => b.id)).toContain(made.id);
});

test("a script's call and the mod's tool reach the same operation: the same read, the same answer", async () => {
  const { client, cliRead } = await setup();
  const api = hostApi(client, { actorId: "garden-script" });
  const made = await api.call("outline_create", { parent: "root", text: "Shed repairs\nRoof first." }) as { id: string };
  const fromScript = await api.tool.outline_read!({ ref: made.id }) as Record<string, unknown>;
  const fromMod = await cliRead(made.id);
  expect(fromScript).toEqual(fromMod);
});

test("a wrong call is answered as the tools answer an agent, and a write needs an actor", async () => {
  const { client } = await setup();
  const api = hostApi(client, { actorId: "garden-script" });
  await expect(api.tool.outline_read!({ title: "Seed swap" })).rejects.toThrow(/outline_read/);
  await expect(api.tool.outline_move!({ ref: "PIE-1" })).rejects.toThrow("Give exactly one of parent");
  await expect(api.call("outline_nope", {})).rejects.toThrow("No tool outline_nope");
  await expect(api.call("toString", {})).rejects.toThrow("No tool toString");

  const nobody = hostApi(client);
  await expect(nobody.call("outline_create", { parent: "root", text: "Unsigned" })).rejects.toThrow("pass --actor");
  expect((await nobody.q("Unsigned") as { blocks: unknown[] }).blocks).toEqual([]);
});

test("a run streams its steps as they happen, and calls side by side don't wait on each other", async () => {
  const { store, client } = await setup();
  const steps: { seq: number; tool: string; phase: string; writes: boolean }[] = [];
  const api = hostApi(client, { actorId: "garden-script", sessionId: "run-2" }, {
    onStep: s => { steps.push({ seq: s.seq, tool: s.tool, phase: s.phase, writes: s.writes }); throw new Error("an observer's error never stops the run"); },
  });
  const made = await Promise.all(["Tomatoes", "Beans", "Squash"].map(text => api.call("outline_create", { parent: "root", text }) as Promise<{ id: string }>));
  expect(made.map(m => store.get(m.id)!.actorId)).toEqual(["garden-script", "garden-script", "garden-script"]);
  // All three started before the first answered: nothing in the API serialises them.
  expect(steps.slice(0, 3).map(s => s.phase)).toEqual(["start", "start", "start"]);
  expect(steps.filter(s => s.phase === "done").map(s => s.seq).sort()).toEqual([1, 2, 3]);
  expect(steps.every(s => s.tool === "outline_create" && s.writes)).toBe(true);

  await api.read(made[0]!.id);
  // An observer that fails later, asynchronously, doesn't reach the script either.
  await hostApi(client, undefined, { onStep: async () => { throw new Error("offline"); } }).read(made[0]!.id);
  await expect(api.call("outline_trash", { ref: made[1]!.id })).rejects.toThrow();
  expect(steps.slice(-4).map(s => [s.seq, s.tool, s.phase])).toEqual([[4, "outline_read", "start"], [4, "outline_read", "done"], [5, "outline_trash", "start"], [5, "outline_trash", "refused"]]);
});

test("step delivery is deferred and unknown calls still report their refusal", async () => {
  const { client } = await setup();
  let dispatched = false;
  const observed: { tool: string; phase: string; dispatched: boolean }[] = [];
  const api = hostApi(client, { actorId: "garden-script" }, {
    onStep: s => { observed.push({ tool: s.tool, phase: s.phase, dispatched }); },
  });
  const pending = api.q("type=plan");
  dispatched = true;
  await pending;
  expect(observed.every(s => s.dispatched)).toBe(true);
  await expect(api.call("outline_nope")).rejects.toThrow("No tool outline_nope");
  expect(observed.slice(-2).map(s => [s.tool, s.phase])).toEqual([["outline_nope", "start"], ["outline_nope", "refused"]]);
});


test("a script can patch whitespace source spans but cannot patch an empty span", async () => {
  const { store, client } = await setup();
  const api = hostApi(client, { actorId: "garden-script" });
  const made = await api.call("outline_create", { parent: "root", text: "Seed spacing\n\nKeep the labels." }) as { id: string; revision: number };
  await expect(api.call("outline_patch", { ref: made.id, revision: made.revision, patches: [{ observed: "", replacement: "lost" }] })).rejects.toThrow("never empty");
  await api.call("outline_patch", { ref: made.id, revision: made.revision, patches: [{ observed: "\n\n", replacement: "\n" }] });
  expect(store.get(made.id)!.text).toBe("Seed spacing\nKeep the labels.");
});
