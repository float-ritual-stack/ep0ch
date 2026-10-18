// Intake (PIE-786): a rule note runs intake/prior-art on new requests, batched, capped and skipping handled ones; the
// note it writes asks @prior-art, which finds the earlier notes and says which look like duplicates. A scratch service in
// a temp folder; every note is made up.
import { afterEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { RuleListEntry } from "../src/extension-rules";
import type { ExtensionsListResult } from "../src/extension-registry";
import type { Block } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function until<T>(what: string, check: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

async function setup(config?: (root: string) => Record<string, unknown>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-intake-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outlineFolder = join(root, "outline");
  mkdirSync(join(outlineFolder, "extensions"), { recursive: true });
  cpSync(join(import.meta.dir, "..", "extensions", "intake"), join(outlineFolder, "extensions", "intake"), { recursive: true });
  if (config) writeFileSync(join(outlineFolder, "extensions", "intake", "config.json"), JSON.stringify({ config: config(root) }));
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outlineFolder });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, ruleQuietMs: 100, agentRequestQuietMs: 100 });
  await server.start();
  const client = new OutlinerClient(socket);
  cleanups.push(async () => {
    await server.close();
    store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const create = (text: string, parentId?: string) => client.request<Block>({ action: "create", text, ...(parentId ? { parentId } : {}), author: "user" });
  const list = (reload = false) => client.request<ExtensionsListResult & { rules: RuleListEntry[]; ruleProblems: string[] }>({ action: "extensions.list", ...(reload ? { reload: true } : {}) });
  const listed = await until("intake", async () => (await list(true)).extensions.find((extension) => extension.id === "intake"));
  if ((listed as { state?: string }).state !== "active") throw new Error(`intake isn't active: ${JSON.stringify(listed).slice(0, 600)}`);
  return { root, store, client, create, list };
}

const priorArt = (store: OutlinerStore, id: string) => store.children(id).find((child) => child.text.startsWith("Prior art and related"));

test("a burst of requests is one call; each gets its prior art from @prior-art, a likely duplicate named; a handled one is skipped", async () => {
  const { store, client, create, list } = await setup();
  const earlier = await create("The hose reel jams when it's wound fast [type::idea]\n\nThe guide arm catches on the third turn.");
  await create("Rain barrel overflow: add a diverter [type::note]");
  const inbox = await create("Inbox");
  await create(`Intake prior art [rule-name::intake-prior-art] [rule-match::type=request] [rule-under::((${inbox.id}))] [rule-on::intake/prior-art] [rule-batch::1s] [rule-cap::5/day] [rule-skip::triage=done OR child:type=prior-art]`);
  await until("the rule", async () => (await list()).rules.some((rule) => rule.name === "intake-prior-art"));
  const hose = await create("The hose reel jams again [type::request]", inbox.id);
  const shed = await create("Paint the shed door green [type::request]", inbox.id);
  const handled = await create("Compost bin lid blows off [type::request] [triage::done]", inbox.id);
  const filled = (id: string) => { const note = priorArt(store, id); return note && !note.text.includes("Looking in ") && note; };
  const hoseNote = await until("the hose request's prior art", () => filled(hose.id));
  const shedNote = await until("the shed request's prior art", () => filled(shed.id));
  expect(hoseNote.text).toContain(`((${earlier.id}|The hose reel jams when it's wound fast))`);
  expect(hoseNote.text).toContain("Likely duplicate");
  expect(hoseNote.text).toStartWith("Prior art and related [type::prior-art] [machine::intake] [via-trigger::intake-prior-art]");
  // Its properties are live, as anyone's: a query finds the notes, and the rule's skip below does.
  const found = await client.request<{ blocks: { id: string }[] }>({ action: "blocks.query", query: { where: "type=prior-art", machinery: "show" } });
  expect(found.blocks.map((block) => block.id).sort()).toEqual([hoseNote.id, shedNote.id].sort());
  // Stamped [machine::intake], they are left out of a question that doesn't ask (PIE-867).
  expect((await client.request<{ blocks: unknown[] }>({ action: "blocks.query", query: { where: "type=prior-art" } })).blocks).toEqual([]);
  expect(shedNote.text).toContain("No likely duplicates");
  expect(priorArt(store, handled.id)).toBeUndefined();
  // One call for the burst; the agent's answer is an edit of the note, asked by the person whose save set it off.
  const rule = (await list()).rules.find((entry) => entry.name === "intake-prior-art")!;
  expect(rule).toMatchObject({ ranToday: 1, lastRun: { when: "start", blocks: 2 } });
  expect(store.agentRequests(hoseNote.id)).toMatchObject([{ agent: "prior-art", status: "applied", requestedBy: "user" }]);
  // Nothing more runs: the notes aren't requests, and a request that has its note is skipped (a person moving one out
  // of the inbox and back starts it matching again).
  const elsewhere = await create("Elsewhere");
  await client.request({ action: "move", blockId: hose.id, expectedRevision: hose.revision, parentId: elsewhere.id, mutation: { author: "user" } });
  await Bun.sleep(300);
  await client.request({ action: "move", blockId: hose.id, expectedRevision: hose.revision, parentId: inbox.id, mutation: { author: "user" } });
  await Bun.sleep(1_500);
  expect((await list()).rules.find((entry) => entry.name === "intake-prior-art")!.ranToday).toBe(1);
  expect(store.children(hose.id)).toHaveLength(1);
}, 30_000);

test("run by hand, prior-art looks at once and asks no agent", async () => {
  const { store, client, create } = await setup();
  const earlier = await create("Seed trays crack in frost [type::note]");
  const ask = await create("Seed trays cracked again [type::request]");
  const result = await client.request<{ message?: string }>({ action: "extensions.act", extension: "intake", extensionAction: "prior-art", blockId: ask.id, mutation: { author: "user" } });
  expect(result.message).toBe("looked for prior art for 1 request");
  const note = priorArt(store, ask.id)!;
  expect(note.text).toContain(`((${earlier.id}|Seed trays crack in frost))`);
  expect(note.text).not.toContain("@prior-art");
  // Again: it has its prior art already.
  expect((await client.request<{ message?: string }>({ action: "extensions.act", extension: "intake", extensionAction: "prior-art", blockId: ask.id, mutation: { author: "user" } })).message)
    .toBe("every request here has its prior art already");
});

test("the archive is searched by its command with one word, a failing one is said, and by hand the model is never asked", async () => {
  const { root, store, client, create } = await setup((dir) => {
    writeFileSync(join(dir, "archive.ts"), `const word = process.argv[2]; const all = await Bun.stdin.text();
if (word === "trellis") { console.error("archive offline"); process.exit(2); }
if (!all.includes("cracked")) process.exit(1);
console.log("notes/" + word + ".md");`);
    writeFileSync(join(dir, "answer.ts"), `await Bun.write(${JSON.stringify(join(dir, "asked"))}, "yes"); console.log("a model's words");`);
    return { archive: ["bun", join(dir, "archive.ts"), "%word%"], answer: ["bun", join(dir, "answer.ts")] };
  });
  const act = (blockId: string) => client.request({ action: "extensions.act", extension: "intake", extensionAction: "prior-art", blockId, mutation: { author: "user" } });
  const trays = await create("Seed trays cracked again [type::request]");
  await act(trays.id);
  expect(priorArt(store, trays.id)!.text).toContain("**In the archive**\n- `notes/cracked.md`");
  const trellis = await create("Trellis wobbles [type::request]");
  await act(trellis.id);
  expect(priorArt(store, trellis.id)!.text).toContain("- couldn't search: the archive command exited 2: archive offline");
  expect(existsSync(join(root, "asked"))).toBe(false);
});


test("ref-less prior art searches the ask and its note, and quoted answers never ask again", async () => {
  const { store, client, create } = await setup();
  const earlier = await create("Greenhouse irrigation timer wiring");
  const ask = await create("Greenhouse irrigation timer\n\n@prior-art find wiring\n");
  await until("the inline answer", () => store.agentRequests(ask.id).some(row => row.status === "replied"));
  const answered = store.get(ask.id)!;
  expect(answered.text).toContain(`((${earlier.id}|Greenhouse irrigation timer wiring))`);
  expect(answered.text).not.toContain("Name the request");
  expect(store.agentRequests(ask.id)).toHaveLength(1);
  const empty = await create("Zyzzyva quux\n\n@prior-art find zyzzyva quux\n");
  await until("no related notes", () => store.agentRequests(empty.id).some(row => row.status === "replied"));
  expect(store.get(empty.id)!.text.toLowerCase()).toContain("nothing like this yet");
  const question = await create("An unrelated question\n\n@prior-art when did this trigger\n");
  await until("the capability answer", () => store.agentRequests(question.id).some(row => row.status === "replied"));
  expect(store.get(question.id)!.text).toContain("I find earlier related notes");
  expect(store.get(question.id)!.text).not.toContain("Name the request");
  const quoted = await create("> [!note]- @prior-art answered\n> @prior-art find wiring\n");
  expect((await client.request<{ projections: unknown[] }>({ action: "resources.projection.read", blockId: quoted.id })).projections).toEqual([]);
  expect(store.agentRequests(quoted.id)).toHaveLength(0);
});
