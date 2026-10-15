// The host API (src/host-api.ts, scripting slice 1, PIE-720): the agent tools as plain functions over the service, as a
// script calls them. Against a private scratch service; fictional notes only.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_TOOL_DEFINITIONS } from "@ep0ch/outline-core/agent-tool-definitions";
import { OutlinerClient } from "../src/client";
import { hostApi } from "../src/host-api";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { scratchOutline } from "./scratch-outline";

const cleanups: Array<() => Promise<void>> = [];
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
  return { store, client, cliRead };
}

test("every agent tool is a function, and a script's writes are the agent's, checked against the revision it read", async () => {
  const { store, client } = await setup();
  const api = hostApi(client, { actorId: "garden-script", sessionId: "run-1" });
  expect([...api.tools].sort()).toEqual(AGENT_TOOL_DEFINITIONS.map(d => d.name).sort());

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
  await expect(api.call("outline_trash", { ref: made[1]!.id })).rejects.toThrow();
  expect(steps.slice(-4).map(s => [s.seq, s.tool, s.phase])).toEqual([[4, "outline_read", "start"], [4, "outline_read", "done"], [5, "outline_trash", "start"], [5, "outline_trash", "refused"]]);
});
