// The host API (src/host-api.ts, scripting slice 1, PIE-720): the agent tools as plain functions over the service, as a
// script calls them. Against a private scratch service; fictional notes only.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

async function setup(prepare?: (root: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "outliner-host-api-"));
  await prepare?.(root);
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
  const cliExt = async () => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../../door/src/main.ts"), "ext", "ls", "--json"], {
      cwd: root, env: { PATH: process.env.PATH!, HOME: root, ...env }, stdout: "pipe", stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, err).toBe(0);
    return out;
  };
  return { store, client, cliRead, cliExt, root };
}

test("script blocks and outline script files load through the extension registry", async () => {
  const { client, root } = await setup();
  const api = hostApi(client, { actorId: "seed-author" });
  await api.call("outline_create", { parent: "root", text: "Seed count [script::seed-count]\n```js\nreturn await q('type=supply');\n```" });
  await Bun.write(join(root, ".ep0ch", "scripts", "labels.ts"), "// ep0ch-script\nreturn await read('root');");
  const listed = await client.request<{ extensions: { name?: string; state: string }[] }>({ action: "extensions.list", reload: true });
  expect(listed.extensions.find(e => e.name === "seed-count")?.state).toBe("active");
  expect(listed.extensions.find(e => e.name === "labels")?.state).toBe("active");
});

test("a block script starts at once, writes as the script, and its complete run undoes in one step", async () => {
  const { client, store } = await setup();
  const api = hostApi(client, { actorId: "seed-author" });
  const source = await api.call("outline_create", { parent: "root", text: "Seed report [script::seed-report] [effects::write]\n```js\nconst a = await tools.outline_create({ parent: 'root', text: 'Labels [type::supply]' });\nawait tools.outline_patch({ ref: a.id, revision: a.revision, patches: [{observed: 'Labels', replacement: 'Paper labels'}] });\nreturn 'Ready for planting';\n```" }) as { id: string };
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
  expect(store.get(made.id)?.actorId).toBe("script:seed-report");
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

test("undo never trashes somebody else's child added while a script is running", async () => {
  const { client, store } = await setup();
  const api = hostApi(client, { actorId: "seed-author" });
  await api.call("outline_create", { parent: "root", text: `Seed family [script::seed-family] [effects::write]
\`\`\`js
const parent = await tools.outline_create({ parent: 'root', text: 'Seed tray [type::tray]' });
while (!(await q('signal=ready')).blocks.length) {}
await tools.outline_create({ parent: parent.id, text: 'Own label' });
\`\`\`` });
  const listed = await client.request<{ extensions: { id: string; name?: string }[] }>({ action: "extensions.list", reload: true });
  const run = await client.request<{ written: string[]; undo: string }>({ action: "extensions.act", extension: listed.extensions.find(e => e.name === "seed-family")!.id, extensionAction: "run" });
  const deadline = Date.now() + 5000;
  while (!store.queryBlocks({ where: "type=tray" }).blocks.length && Date.now() < deadline) await Bun.sleep(10);
  const tray = store.queryBlocks({ where: "type=tray" }).blocks[0]!;
  const foreign = store.create("Someone else's label", tray.id, "user");
  store.create("Continue [signal::ready]", null, "user");
  while (store.get(run.written[0]!)?.text.includes("· working") && Date.now() < deadline) await Bun.sleep(10);
  expect(store.get(run.written[0]!)?.text).toContain("· done");
  await expect(client.request({ action: "extensions.undo", undo: run.undo })).rejects.toThrow(/changed|another/);
  expect(store.get(foreign.id)?.effectiveDeletedRootId).toBeUndefined();
});

test("script asks run from a person's line and an agent's line by default", async () => {
  const { client, store } = await setup();
  const source = store.create("Count seeds [script::count-seeds]\n```js\nreturn 'Seeds counted';\n```", null, "user");
  await client.request({ action: "extensions.list", reload: true });
  const ask = await client.request<{ id: string }>({ action: "create", text: "Seed plan\n@count-seeds", author: "user" });
  const deadline = Date.now() + 4000;
  while (!store.children(source.id).some(n => n.text.includes("· done")) && Date.now() < deadline) await Bun.sleep(20);
  expect(store.children(source.id).map(n => n.text).join("\n")).toContain("Seeds counted");
  expect(store.get(ask.id)?.text).toContain("@count-seeds");
  const automatic = await client.request<{ id: string }>({ action: "create", text: "Another plan\n@count-seeds", author: "agent", provenance: { actorId: "seed-helper" } });
  while (store.agentRequests(automatic.id)[0]?.status === "running" && Date.now() < deadline) await Bun.sleep(20);
  expect(store.agentRequests(automatic.id)[0]).toMatchObject({ status: "replied", requestedBy: "agent:seed-helper" });
  expect(store.children(source.id).filter(n => n.text.includes("· done") && n.text.includes("Seeds counted"))).toHaveLength(2);
}, 10_000);

test("a rule names a script through the existing trigger path", async () => {
  const { client, store } = await setup();
  const source = store.create("Seed alarm [script::seed-alarm]\n```js\nreturn 'Time to sow';\n```", null, "user");
  await client.request({ action: "extensions.list", reload: true });
  await client.request({ action: "create", text: "Sowing rule [rule-name::sowing] [rule-match::planting=ready] [rule-on::script:seed-alarm] [rule-quiet::1s]", author: "user" });
  await client.request({ action: "create", text: "Peas [planting::ready]", author: "user" });
  const deadline = Date.now() + 4000;
  while (!store.children(source.id).some(n => n.text.includes("· done")) && Date.now() < deadline) await Bun.sleep(20);
  expect(store.children(source.id).map(n => n.text).join("\n")).toContain("Time to sow");
}, 10_000);

test("a granted script ask keeps the invocation chain while its writes arrive", async () => {
  const { client, store } = await setup();
  store.create("Seed permission [invoke-from::seed-helper] [invoke-to::count-again] [max-hops::2]", null, "user");
  const source = await client.request<{ id: string }>({ action: "create", author: "agent", provenance: { actorId: "seed-helper" }, text: "Repeat count [script::count-again] [effects::write]\n```js\nawait tools.outline_create({ parent: 'root', text: 'Follow-up seeds\\n@count-again' });\nreturn 'Counted once';\n```" });
  await client.request({ action: "extensions.list", reload: true });
  await client.request({ action: "create", author: "agent", provenance: { actorId: "seed-helper" }, text: "Seed plan\n@count-again" });
  const deadline = Date.now() + 4000;
  while (!store.children(source.id).some(n => n.text.includes("· done")) && Date.now() < deadline) await Bun.sleep(20);
  expect(store.children(source.id).map(n => n.text).join("\n")).toContain("Counted once");
  const followup = store.queryBlocks({ text: "Follow-up seeds" }).blocks.find(n => n.text.startsWith("Follow-up seeds"))!;
  expect(store.agentRequests(followup.id)[0]?.status).toBe("waiting");
  expect(store.agentRequests(followup.id)[0]?.message).toContain("already in this chain");
}, 10_000);

test.each([
  ["js", "throw new Error('No seed tray');", "No seed tray"],
  ["actions", 'open id="{{props.note}}"', "note"],
  ["js", "throw new Error('');", ""],
])("a failed inline %s script says failed on its ask: %s", async (format, code, message) => {
  const { client, store } = await setup();
  store.create(`Broken seeds [script::broken-seeds]\n\`\`\`${format}\n${code}\n\`\`\``, null, "user");
  await client.request({ action: "extensions.list", reload: true });
  const ask = await client.request<{ id: string }>({ action: "create", text: "Plan\n@broken-seeds", author: "user" });
  const deadline = Date.now() + 4000;
  while (!["failed", "replied"].includes(store.agentRequests(ask.id)[0]?.status ?? "") && Date.now() < deadline) await Bun.sleep(20);
  expect(store.agentRequests(ask.id)[0]?.status).toBe("failed");
  expect(store.agentRequests(ask.id)[0]?.message).toContain(message);
}, 10_000);


test("only opted-in dotted-folder scripts run, read-only unless they declare write", async () => {
  const { client, store, root, cliExt } = await setup();
  await Bun.write(join(root, "scripts", "stray.ts"), "throw new Error('must not execute');");
  await Bun.write(join(root, ".ep0ch", "scripts", "helper.ts"), "throw new Error('must not execute');");
  const code = "await tools.outline_create({ parent: 'root', text: 'Seed packet [type::packet]' });";
  await Bun.write(join(root, ".ep0ch", "scripts", "reader.ts"), "// ep0ch-script\n" + code);
  await Bun.write(join(root, ".ep0ch", "scripts", "writer.ts"), "// ep0ch-script effects=write\n" + code);
  const listed = await client.request<{ extensions: { id: string; name?: string; state: string; error?: string }[] }>({ action: "extensions.list", reload: true });
  expect(listed.extensions.find(e => e.name === "stray")?.state).not.toBe("active");
  expect(listed.extensions.some(e => e.error?.includes("scripts/stray.ts"))).toBe(true);
  expect(listed.extensions.some(e => e.error?.includes("helper.ts") && e.error.includes("opt in"))).toBe(true);
  expect(await cliExt()).toContain("opt in");
  for (const name of ["reader", "writer"]) {
    const extension = listed.extensions.find(e => e.name === name)!;
    expect(extension?.state).toBe("active");
    const run = await client.request<{ written: string[] }>({ action: "extensions.act", extension: extension.id, extensionAction: "run", mutation: { author: "agent", actorId: "seed-requester" } });
    const deadline = Date.now() + 4000;
    while (store.get(run.written[0]!)?.text.includes("· working") && Date.now() < deadline) await Bun.sleep(10);
    const log = store.require(run.written[0]!);
    expect(log.actorId).toBe(`script:${name}`);
    expect(log.text).toContain("onBehalfOf: seed-requester");
    expect(log.text).toContain(name === "reader" ? "read-only" : "· done");
    expect(store.queryBlocks({ where: "type=packet" }).blocks.length).toBe(name === "reader" ? 0 : 1);
  }
  const made = store.queryBlocks({ where: "type=packet" }).blocks[0]!;
  expect(store.require(made.id).actorId).toBe("script:writer");
  const page = store.changes.since(0, 1000);
  expect(page.kind === "changes" && page.changes.find(c => c.blockId === made.id)).toMatchObject({
    actor: { author: "agent", actorId: "script:writer" }, requestedBy: { author: "agent", actorId: "seed-requester" },
  });
});


test("editing a dotted-folder script reloads its opt-in without an explicit reload", async () => {
  const { client, root } = await setup(async root => {
    await Bun.write(join(root, "scripts", "unused.ts"), "return 'unused';");
    await Bun.write(join(root, ".ep0ch", "scripts", "watched.ts"), "return 'not opted in';");
  });
  const file = join(root, ".ep0ch", "scripts", "watched.ts");
  await Bun.write(file, "// ep0ch-script\nreturn 'Ready';");
  let active = false;
  const deadline = Date.now() + 2500;
  do {
    const listed = await client.request<{ extensions: { name?: string; state: string }[] }>({ action: "extensions.list" });
    active = listed.extensions.some(e => e.name === "watched" && e.state === "active");
    if (!active) await Bun.sleep(20);
  } while (!active && Date.now() < deadline);
  expect(active).toBe(true);
});


test("an unreadable script is listed without hiding other scripts", async () => {
  const { client, root, cliExt } = await setup();
  mkdirSync(join(root, ".ep0ch", "scripts", "unreadable.ts"), { recursive: true });
  await Bun.write(join(root, ".ep0ch", "scripts", "readable.ts"), "// ep0ch-script\nreturn 'Ready';");
  const listed = await client.request<{ extensions: { name?: string; state: string; error?: string }[] }>({ action: "extensions.list", reload: true });
  expect(listed.extensions.find(e => e.name === "readable")?.state).toBe("active");
  expect(listed.extensions.some(e => e.error?.includes("unreadable.ts"))).toBe(true);
  expect(await cliExt()).toContain("unreadable.ts");
});
