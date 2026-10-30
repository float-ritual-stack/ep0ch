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
import { setup as scriptService, until } from "./script-harness";

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
  expect(value.network).toBe("function"); // an action run's fetch (host-api.ts), recorded as a step
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
  await api.call("outline_create", { parent: "root", text: "Seed count [script::seed-count] [results::keep]\n```js\nreturn await q('type=supply');\n```" });
  await Bun.write(join(root, ".ep0ch", "scripts", "labels.ts"), "// ep0ch-script\nreturn await read('root');");
  const listed = await client.request<{ extensions: { name?: string; state: string }[] }>({ action: "extensions.list", reload: true });
  expect(listed.extensions.find(e => e.name === "seed-count")?.state).toBe("active");
  expect(listed.extensions.find(e => e.name === "labels")?.state).toBe("active");
});

test("a block script writes as the script, and its complete run undoes in one step", async () => {
  const { client, store } = await setup();
  const api = hostApi(client, { actorId: "seed-author" });
  const source = await api.call("outline_create", { parent: "root", text: "Seed report [script::seed-report] [results::keep] [effects::write]\n```js\nconst a = await tools.outline_create({ parent: 'root', text: 'Labels [type::supply]' });\nawait tools.outline_patch({ ref: a.id, revision: a.revision, patches: [{observed: 'Labels', replacement: 'Paper labels'}] });\nreturn 'Ready for planting';\n```" }) as { id: string };
  const listed = await client.request<{ extensions: { id: string; name?: string }[] }>({ action: "extensions.list", reload: true });
  const extension = listed.extensions.find(e => e.name === "seed-report")!;
  const run = await client.request<{ written: string[]; undo: string; message: string; state: string }>({ action: "extensions.act", extension: extension.id, extensionAction: "run" });
  const log = run.written[0]!;
  // The act answers when the run has ended (PIE-1264), with the run's last word.
  expect(run).toMatchObject({ message: "Ready for planting", state: "done" });
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
  await expect(api.tool.outline_move!({ ref: "PIE-1", revision: 1 })).rejects.toThrow("Give exactly one of parent");
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
  await api.call("outline_create", { parent: "root", text: `Seed family [script::seed-family] [results::keep] [effects::write]
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
  while (store.agentRequests(ask.id)[0]?.status !== "replied" && Date.now() < deadline) await Bun.sleep(20);
  expect(store.agentRequests(ask.id)[0]?.reply).toBe("Seeds counted");
  expect(store.get(ask.id)?.text).toContain("@count-seeds");
  const automatic = await client.request<{ id: string }>({ action: "create", text: "Another plan\n@count-seeds", author: "agent", provenance: { actorId: "seed-helper" } });
  while (store.agentRequests(automatic.id)[0]?.status === "running" && Date.now() < deadline) await Bun.sleep(20);
  expect(store.agentRequests(automatic.id)[0]).toMatchObject({ status: "replied", requestedBy: "agent:seed-helper" });
  expect(store.agentRequests(automatic.id)[0]?.reply).toBe("Seeds counted");
  expect(store.children(source.id)).toEqual([]);
}, 10_000);

test("a rule names a script through the existing trigger path", async () => {
  const { client, store } = await setup();
  const source = store.create("Seed alarm [script::seed-alarm] [results::keep]\n```js\nreturn 'Time to sow';\n```", null, "user");
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
  const source = await client.request<{ id: string }>({ action: "create", author: "agent", provenance: { actorId: "seed-helper" }, text: "Repeat count [script::count-again] [results::keep] [effects::write]\n```js\nawait tools.outline_create({ parent: 'root', text: 'Follow-up seeds\\n@count-again' });\nreturn 'Counted once';\n```" });
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
  store.create(`Broken seeds [script::broken-seeds] [results::keep]\n\`\`\`${format}\n${code}\n\`\`\``, null, "user");
  await client.request({ action: "extensions.list", reload: true });
  const ask = await client.request<{ id: string }>({ action: "create", text: "Plan\n@broken-seeds", author: "user" });
  const deadline = Date.now() + 4000;
  while (!["failed", "replied"].includes(store.agentRequests(ask.id)[0]?.status ?? "") && Date.now() < deadline) await Bun.sleep(20);
  expect(store.agentRequests(ask.id)[0]?.status).toBe("failed");
  expect(store.agentRequests(ask.id)[0]?.message).toContain(message);
}, 10_000);


test("only opted-in dotted-folder scripts run, and effects do not restrict writes", async () => {
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
  const completed = new Map<string, import("@ep0ch/outline-core/protocol").ScriptEnded>();
  let connected = false;
  const watcher = client.watch({ client: { clientId: "file-reader", contextId: "files", role: "observer" },
    onConnect: () => { connected = true; }, onEvent: e => { if (e.ended) completed.set(e.ended.run, e.ended); } });
  try {
    const connectBy = Date.now() + 4000;
    while (!connected && Date.now() < connectBy) await Bun.sleep(10);
    expect(connected).toBe(true);
    for (const [index, name] of ["reader", "writer"].entries()) {
      const extension = listed.extensions.find(e => e.name === name)!;
      expect(extension?.state).toBe("active");
      const run = await client.request<{ undo: string; writtenAs: string }>({ action: "extensions.act", extension: extension.id, extensionAction: "run", mutation: { author: "agent", actorId: "seed-requester" } });
      const deadline = Date.now() + 4000;
      while (!completed.has(run.undo) && Date.now() < deadline) await Bun.sleep(10);
      const answer = completed.get(run.undo)!;
      // A run somebody asked for writes as them, the script as how (PIE-1462).
      expect(run.writtenAs).toBe("seed-requester");
      expect(answer.requestedBy).toMatchObject({ author: "agent", actorId: "seed-requester" });
      expect(answer.reason).toBe("done");
      expect(answer.message).toContain(`${name} done`);
      expect(store.queryBlocks({ where: "type=packet" }).blocks.length).toBe(index + 1);
    }
  } finally { await watcher.stop(); }
  const page = store.changes.since(0, 1000);
  const wrote = page.kind === "changes" ? page.changes.find(c => c.action === "script:writer" && c.kind === "create") : undefined;
  expect(store.require(wrote!.blockId!)).toMatchObject({ author: "agent", actorId: "seed-requester" });
  expect(wrote).toMatchObject({
    action: "script:writer", actor: { author: "agent", actorId: "seed-requester", taskId: expect.stringContaining("trigger:script:") }, requestedBy: { author: "agent", actorId: "seed-requester" },
  });
});


test("editing a dotted-folder script reloads its opt-in without an explicit reload", async () => {
  const { client, root } = await setup(async root => {
    await Bun.write(join(root, "scripts", "unused.ts"), "return 'unused';");
    await Bun.write(join(root, ".ep0ch", "scripts", "watched.ts"), "return 'not opted in';");
  });
  const file = join(root, ".ep0ch", "scripts", "watched.ts");
  const connected = Promise.withResolvers<void>();
  const active = Promise.withResolvers<{ name?: string; state: string }>();
  const watcher = client.watch({
    client: { clientId: "script-watcher", contextId: "script-watcher", role: "observer" },
    onConnect: connected.resolve,
    onError: error => { connected.reject(error); active.reject(error); },
    onEvent: async event => {
      if (event.domain !== "extensions") return;
      try {
        const listed = await client.request<{ extensions: { name?: string; state: string }[] }>({ action: "extensions.list" });
        const watched = listed.extensions.find(e => e.name === "watched" && e.state === "active");
        if (watched) active.resolve(watched);
      } catch (error) { active.reject(error); }
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await connected.promise;
    await Bun.write(file, "// ep0ch-script\nreturn 'Ready';");
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out after 5 s waiting for watched script to become active")), 5000);
    });
    expect(await Promise.race([active.promise, deadline])).toMatchObject({ name: "watched", state: "active" });
  } finally { clearTimeout(timer); await watcher.stop(); }
}, 30_000);


test("an unreadable script is listed without hiding other scripts", async () => {
  const { client, root, cliExt } = await setup();
  mkdirSync(join(root, ".ep0ch", "scripts", "unreadable.ts"), { recursive: true });
  await Bun.write(join(root, ".ep0ch", "scripts", "readable.ts"), "// ep0ch-script\nreturn 'Ready';");
  const listed = await client.request<{ extensions: { name?: string; state: string; error?: string }[] }>({ action: "extensions.list", reload: true });
  expect(listed.extensions.find(e => e.name === "readable")?.state).toBe("active");
  expect(listed.extensions.some(e => e.error?.includes("unreadable.ts"))).toBe(true);
  expect(await cliExt()).toContain("unreadable.ts");
});

test("query() answers rows with their props, groups with their rows, facets, and a hint for a key no note has", async () => {
  const { store, client } = await setup();
  const errands = store.create("Errands", null, "user");
  for (const [title, status, owner] of [["Mend the gate", "open", "sam"], ["Wash the shed", "doing", "robin"], ["Oil the hinge", "open", "robin"]])
    store.create(`${title} [type::errand] [status::${status}] [owner::${owner}]`, errands.id, "user");
  const api = hostApi(client, undefined, { kind: "render", thisId: errands.id });
  const result = await runScript(`return {
    grouped: await query({ where: "type=errand parent:this", group: "status", facets: true }),
    sorted: await query({ where: "type=errand", sort: "title", limit: 2 }),
    unknown: await query({ where: "colr=red" }),
  };`, api);
  if (!result.ok) throw new Error(result.error.message);
  const { grouped, sorted, unknown } = result.value as Record<string, import("../src/host-api").ScriptQueryAnswer>;
  expect(grouped.rows).toHaveLength(3);
  expect(grouped.rows.find(r => r.title === "Mend the gate")?.props).toMatchObject({ type: ["errand"], status: ["open"], owner: ["sam"] });
  const open = grouped.groups!.find(g => g.value === "open")!;
  expect(open.count).toBe(2);
  expect(open.rows.map(r => r.title).sort()).toEqual(["Mend the gate", "Oil the hinge"]);
  expect(grouped.facets!.find(f => f.key === "owner")?.values.find(v => v.value === "robin")?.count).toBe(2);
  expect(sorted.rows.map(r => r.title)).toEqual(["Mend the gate", "Oil the hinge"]);
  expect(sorted.complete).toBe(false);
  expect(unknown.rows).toEqual([]);
  expect(unknown.hint).toContain("colr");
});

test("read() takes a list of notes, in order, and at most 200 at once", async () => {
  const { store, client } = await setup();
  const a = store.create("Seed trays [type::supply]", null, "user");
  const b = store.create("Twine [type::supply]", null, "user");
  const api = hostApi(client, undefined, { kind: "render" });
  const both = await api.read([a.id, "no-such-note", b.id]) as { id?: string; title?: string; problem?: string }[];
  expect(both.map(r => r.id ?? r.problem?.slice(0, 0))).toEqual([a.id, "", b.id]);
  expect(both[1]).toMatchObject({ ref: "no-such-note" });
  await expect(api.read(Array.from({ length: 201 }, () => a.id))).rejects.toThrow("at most 200 notes");
});

test("a render that draws query() is drawn again when a new note matches", async () => {
  const { create, output, draw } = await scriptService();
  create("Open errands [script::open-errands] [mode::render]\n```tsx\nconst { groups } = await query({ where: \"type=errand\", group: \"status\" });\nreturn <stack>{groups.map(g => <text>{g.value}: {g.count}</text>)}</stack>\n```");
  create("Mend the gate [type::errand] [status::open]");
  const note = create("Today\nopen-errands::");
  await draw(note.id);
  expect(await until("one open", () => output(note.id)[0])).toContain("open: 1");
  create("Oil the hinge [type::errand] [status::open]");
  await until("two open", () => output(note.id)[0]?.includes("open: 2"));
});

test("sh and fetch hand the script their whole output and record a step with its first lines", async () => {
  const { client } = await setup();
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: request => new Response(`seed ${request.method}\n${Array.from({ length: 30 }, (_, i) => `tray ${i + 1}`).join("\n")}`, { status: 201, headers: { "x-garden": "plot-4" } }) });
  cleanups.push(async () => { await server.stop(true); });
  const steps: import("../src/host-api").HostStep[] = [];
  const api = hostApi(client, { actorId: "seed-script" }, { onStep: s => { if (s.phase !== "start") steps.push(s); } });
  const result = await runScript(`
    const listed = await sh([process_exec, "-e", "for (let i = 1; i <= 30; i++) console.log('row ' + i)"]);
    const failed = await sh([process_exec, "-e", "console.error('no twine'); process.exit(3)"]);
    const piped = await sh([process_exec, "-e", "process.stdin.pipe(process.stdout)"], { stdin: "seed list" });
    const got = await fetch(url, { method: "post", body: "x" });
    return { lines: listed.stdout.split("\\n").length, failed, piped: piped.stdout, got: { status: got.status, garden: got.headers["x-garden"], first: got.text.split("\\n")[0], size: got.text.split("\\n").length } };
  `.replaceAll("process_exec", JSON.stringify(process.execPath)).replace("url,", `${JSON.stringify(server.url.href)},`), api);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.value).toEqual({ lines: 31, failed: { exit: 3, stdout: "", stderr: "no twine\n" }, piped: "seed list", got: { status: 201, garden: "plot-4", first: "seed POST", size: 31 } });
  await Bun.sleep(0);
  const sh = steps.filter(s => s.tool === "sh");
  expect(sh.map(s => s.phase)).toEqual(["done", "done", "done"]);
  expect(sh[0]!.input).toMatchObject({ argv: [process.execPath, "-e", expect.any(String)] });
  const first = sh[0]!.result as { exit: number; bytes: number; lines: string };
  expect(first.exit).toBe(0);
  expect(first.bytes).toBeGreaterThan(150);
  expect(first.lines.split("\n")).toHaveLength(21); // 20 lines and an ellipsis
  expect(first.lines).toEndWith("row 20\n…");
  expect(sh[1]!.result).toMatchObject({ exit: 3, stderr: "no twine\n" });
  expect(sh[2]!.input).toMatchObject({ stdin: "9 chars" });
  const fetched = steps.find(s => s.tool === "fetch")!;
  expect(fetched.input).toMatchObject({ url: server.url.href, method: "POST" });
  expect(fetched.result).toMatchObject({ status: 201 });
  expect((fetched.result as { lines: string }).lines).toStartWith("seed POST\ntray 1");

  // Past 1 MiB a stream is cut and says so; the step never carries more than its first lines.
  const big = await api.sh([process.execPath, "-e", "process.stdout.write('x'.repeat(1536 * 1024))"]);
  expect(big.stdout.length).toBe(1024 * 1024);
  expect(big.truncated).toBe(true);
  await Bun.sleep(0);
  expect(JSON.stringify(steps.at(-1)!.result).length).toBeLessThan(2100);
  await expect(api.sh("gh issue list" as never)).rejects.toThrow("with no shell");
  await expect(api.fetch("file:///etc/hostname")).rejects.toThrow("http or https URL");
}, 30_000);

test("the run's deadline kills sh, and timeoutMs stops one command", async () => {
  const { client, root } = await setup();
  const api = hostApi(client, { actorId: "seed-script" });
  const pidFile = join(root, "sleeper.pid");
  const sleeper = `await Bun.write(${JSON.stringify(pidFile)}, String(process.pid)); await Bun.sleep(60000)`;
  const run = new AbortController();
  setTimeout(() => run.abort(new Error("The script ran past its deadline (1s)")), 1000);
  const started = Date.now();
  const result = await runScript(`return await sh(${JSON.stringify([process.execPath, "-e", sleeper])});`, api, run.signal);
  expect(result.ok).toBe(false);
  expect(Date.now() - started).toBeLessThan(10_000);
  const pid = Number(await Bun.file(pidFile).text());
  await until("the sleeper is gone", () => { try { process.kill(pid, 0); return false; } catch { return true; } });
  await expect(api.sh([process.execPath, "-e", "await Bun.sleep(60000)"], { timeoutMs: 200 })).rejects.toThrow("ran past its timeoutMs (200 ms)");
}, 30_000);

test("a render has no sh or fetch, and below full MCP access they are refused in act's words", async () => {
  const { client } = await setup();
  const render = hostApi(client, undefined, { kind: "render" });
  const drawn = await runScript(`return [typeof sh, typeof fetch];`, render);
  if (!drawn.ok) throw new Error(drawn.error.message);
  expect(drawn.value).toEqual(["undefined", "undefined"]);
  expect("sh" in render).toBe(false);

  const refusals: string[] = [];
  const proposing = hostApi(client, { actorId: "mcp:seed-agent" }, { mcpAccess: "propose", onStep: s => { if (s.phase === "refused") refusals.push(`${s.tool}: ${s.error}`); } });
  await expect(proposing.act("tile.open")).rejects.toThrow("MCP access is propose: a run may not dispatch door actions (act); ep0ch mcp access full lets it");
  await expect(proposing.sh(["true"])).rejects.toThrow("MCP access is propose: a run may not run commands (sh); ep0ch mcp access full lets it");
  await expect(proposing.fetch("http://127.0.0.1:9/")).rejects.toThrow("MCP access is propose: a run may not fetch URLs (fetch); ep0ch mcp access full lets it");
  await Bun.sleep(0);
  expect(refusals).toEqual([
    "sh: MCP access is propose: a run may not run commands (sh); ep0ch mcp access full lets it",
    "fetch: MCP access is propose: a run may not fetch URLs (fetch); ep0ch mcp access full lets it",
  ]);
  const full = hostApi(client, { actorId: "mcp:seed-agent" }, { mcpAccess: "full" });
  expect((await full.sh(["true"])).exit).toBe(0);
});

test("a block script's sh is a step on its run note", async () => {
  const { client, store } = await setup();
  const api = hostApi(client, { actorId: "seed-author" });
  await api.call("outline_create", { parent: "root", text: `Seed echo [script::seed-echo] [results::keep]\n\`\`\`js\nconst out = await sh(${JSON.stringify([process.execPath, "-e", "console.log('two trays')"])});\nreturn out.stdout.trim();\n\`\`\`` });
  const listed = await client.request<{ extensions: { id: string; name?: string }[] }>({ action: "extensions.list", reload: true });
  const extension = listed.extensions.find(e => e.name === "seed-echo")!;
  const run = await client.request<{ written: string[]; message: string; state: string }>({ action: "extensions.act", extension: extension.id, extensionAction: "run" });
  expect(run).toMatchObject({ message: "two trays", state: "done" });
  const log = store.get(run.written[0]!)!.text;
  expect(log).toContain('1. sh: {"exit":0');
  expect(log).toContain('"lines":"two trays\\n"');
});
