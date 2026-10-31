// The bundled Keep extension (extensions/keep): installed as a person does, `keep name=…` turns a `::=` line into a
// named component, a child `[script::…] [mode::render]` note, and the line calls it; the call draws what the line drew,
// and one undo takes back both. Uninstalling leaves the kept notes. A scratch service; every note and name is made up.
import { expect, test } from "bun:test";
import type { ScriptEnded } from "@ep0ch/outline-core/protocol";
import { setup, until } from "./script-harness";

async function kept() {
  const h = await setup();
  const ended = new Map<string, ScriptEnded>();
  let connected = false;
  const watcher = h.client.watch({ client: { clientId: "keep-tester", role: "observer", contextId: "keep" },
    onConnect: () => { connected = true; }, onEvent: e => { if (e.ended) ended.set(e.ended.run, e.ended); } });
  await until("the answer reader", () => connected);
  const installed = await h.client.request<{ state?: string; page?: string }>({ action: "extensions.install", extension: "keep" });
  /** `keep` run on a note with these args, answered when the run ends. */
  const keep = async (blockId: string, args: Record<string, string>, line?: number) => {
    const run = await h.client.request<{ undo: string }>({ action: "extensions.act", extension: "script:keep", extensionAction: "run", blockId, args, clientId: "keep-tester", ...(line !== undefined ? { line } : {}) });
    return { ...await until(`keep ${JSON.stringify(args)}`, () => ended.get(run.undo)), undo: run.undo };
  };
  const drawn = async (blockId: string) => {
    await h.draw(blockId);
    return until(`${blockId} drawn`, () => h.output(blockId).find(text => typeof text === "string" && text.length > 0));
  };
  return { ...h, installed, keep, drawn, stop: () => watcher.stop() };
}

test("keep makes the component note, rewrites the line, draws the same, and one undo takes both back", async () => {
  const { installed, keep, drawn, create, store, client, stop } = await kept();
  try {
    expect(installed.state).toBe("active");
    for (const name of ["Radish", "Chard", "Kale"]) create(`${name} [type::sprout]`);
    const expression = `(await q("type=sprout")).blocks.length + " sprouts"`;
    const host = create(`Greenhouse\nA tally for the bench.\n::= ${expression}`);
    expect(await drawn(host.id)).toContain("3 sprouts");

    const done = await keep(host.id, { name: "sprout-count" });
    expect(done.reason).toBe("done");
    expect(done.message).toContain("kept ::sprout-count");
    expect(store.require(host.id).text).toBe("Greenhouse\nA tally for the bench.\n::sprout-count{}");
    const component = store.children(host.id).find(b => b.text.startsWith("Sprout count [script::sprout-count] [mode::render]"))!;
    expect(component.text).toContain("```tsx\nreturn (" + expression + ");\n```");
    // The kept call draws what the `::=` line drew.
    await until("the component's line draws", async () => {
      await drawn(host.id).catch(() => undefined);
      return store.extensionOutputs(host.id).some(row => row.handlerKey === "sprout-count" && JSON.stringify(row.result ?? "").includes("3 sprouts"));
    });

    await client.request({ action: "extensions.undo", undo: done.undo, mutation: { author: "user" } });
    expect(store.require(host.id).text).toBe(`Greenhouse\nA tally for the bench.\n::= ${expression}`);
    expect(store.get(component.id)?.effectiveDeletedRootId ?? null).not.toBeNull();
    // The registry hears the component go before the service closes (its reload reads the store).
    await until("sprout-count unlisted", async () => !(await client.request<{ extensions: { name?: string }[] }>({ action: "extensions.list", reload: true })).extensions.some(e => e.name === "sprout-count"));
    await drawn(host.id);
  } finally { stop(); }
}, 60_000);

test("an agent runs keep by its extension's page: script_run has no note of the script's to name", async () => {
  const { installed, create, store, client, stop } = await kept();
  try {
    store.configureMcpAccess("full");
    const host = create("Bench\n::= 1 + 1");
    const run = await client.request<{ message?: string; state: string }>({ action: "scripts.run", blockId: installed.page!, this: host.id, slots: { name: "bench-sum" },
      access: "full", mutation: { author: "agent", actorId: "bench-agent" } });
    expect(run.message).toContain("kept ::bench-sum");
    expect(store.require(host.id).text).toBe("Bench\n::bench-sum{}");
    // The page of an extension with no such script says what it holds, as a note without a script does.
    const plain = create("Plain page [ext.page::nothing-here]");
    await expect(client.request({ action: "scripts.run", blockId: plain.id, access: "full", mutation: { author: "agent", actorId: "bench-agent" } })).rejects.toThrow(/no authored script/);
  } finally { stop(); }
}, 60_000);

test("keep refuses a taken name and a note with no ::= line, writing nothing; props become form fields", async () => {
  const { keep, create, store, stop } = await kept();
  try {
    create("Seed tally [script::seed-tally] [mode::render]\n```js\nreturn 'old';\n```");
    const host = create("Potting shed\n::= 'pots: ' + props.pots?.[0]\n::= 'trays'");
    const taken = await keep(host.id, { name: "seed-tally" });
    expect(taken.reason).not.toBe("done");
    expect(taken.message).toContain("seed-tally is taken");
    // A built-in component's id and a folder script's name are taken too, and refused before anything is written.
    const builtIn = await keep(host.id, { name: "table" });
    expect(builtIn.reason).not.toBe("done");
    expect(builtIn.message).toContain("table is taken");
    const own = await keep(host.id, { name: "keep" });
    expect(own.reason).not.toBe("done");
    expect(own.message).toContain("keep is taken");
    expect(store.require(host.id).text).toBe("Potting shed\n::= 'pots: ' + props.pots?.[0]\n::= 'trays'");
    expect(store.children(host.id)).toHaveLength(0);
    const plain = create("Watering rota");
    const none = await keep(plain.id, { name: "rota" });
    expect(none.message).toContain("has no ::= line to keep");
    expect(store.children(plain.id)).toHaveLength(0);

    // The second line, named by its text; its `props.pots` is a field the component takes.
    const second = await keep(host.id, { name: "tray-label", line: "::= 'trays'" });
    expect(second.reason).toBe("done");
    expect(store.require(host.id).text).toBe("Potting shed\n::= 'pots: ' + props.pots?.[0]\n::tray-label{}");
    const first = await keep(host.id, { name: "pot-label" });
    expect(first.reason).toBe("done");
    expect(store.children(host.id).find(b => b.text.startsWith("Pot label"))!.text.split("\n")[0]).toBe("Pot label [script::pot-label] [mode::render] [form-field::pots text]");
  } finally { stop(); }
}, 60_000);

test("keep installs and uninstalls through act; what it kept stays", async () => {
  const { keep, create, store, client, stop } = await kept();
  try {
    const host = create("Compost\n::= 'turned'");
    expect((await keep(host.id, { name: "compost-state" })).reason).toBe("done");
    const removed = await client.request<{ removed: boolean; lines: string[] }>({ action: "extensions.uninstall", extension: "keep", demo: "remove" });
    expect(removed.removed).toBe(true);
    expect(store.queryBlocks({ where: "script=compost-state" }).blocks).toHaveLength(1);
    expect(store.queryBlocks({ where: "type=seedling" }).blocks).toHaveLength(0);
    const again = await client.request<{ state?: string }>({ action: "extensions.install", extension: "keep" });
    expect(again.state).toBe("active");
    expect(store.queryBlocks({ where: "type=seedling" }).blocks.length).toBe(3);
  } finally { stop(); }
}, 60_000);

test("keep's errand board demo draws: the board imports ui-kit's Lane and draws a lane per status", async () => {
  const { drawn, store, stop } = await kept();
  try {
    const demo = store.queryBlocks({ where: "page=keep-errands" }).blocks;
    expect(demo).toHaveLength(1);
    const page = store.queryBlocks({ where: "page=ext-keep" }).blocks[0]!;
    const hubId = store.children(page.id).find(b => b.text.startsWith("Errand board: a component from notes"))?.id;
    expect(hubId).toBeDefined();
    const hub = store.require(hubId!);
    await until("the board's lanes", async () => {
      await drawn(hub.id).catch(() => undefined);
      const result = JSON.stringify(store.extensionOutputs(hub.id).find(row => row.handlerKey === "board")?.result ?? "");
      return ["open · 2", "doing · 2", "done · 1", "Repot the fig", "errand-done note="].every(part => result.includes(part));
    });
  } finally { stop(); }
}, 60_000);
