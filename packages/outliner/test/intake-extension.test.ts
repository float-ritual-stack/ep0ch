// Intake (PIE-786): a rule note runs intake/prior-art on new requests, batched, capped and skipping handled ones; the
// note it writes asks @prior-art, which finds the earlier notes and says which look like duplicates. A scratch service in
// a temp folder; every note is made up.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
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

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-intake-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outlineFolder = join(root, "outline");
  mkdirSync(join(outlineFolder, "extensions"), { recursive: true });
  cpSync(join(import.meta.dir, "..", "extensions", "intake"), join(outlineFolder, "extensions", "intake"), { recursive: true });
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
  await until("intake", async () => (await list(true)).extensions.some((extension) => extension.id === "intake"));
  return { store, client, create, list };
}

const priorArt = (store: OutlinerStore, id: string) => store.children(id).find((child) => child.text.startsWith("Prior art and related"));

test("a burst of requests is one call; each gets its prior art from @prior-art, a likely duplicate named; a handled one is skipped", async () => {
  const { store, client, create, list } = await setup();
  const earlier = await create("The hose reel jams when it's wound fast [type::idea]\n\nThe guide arm catches on the third turn.");
  await create("Rain barrel overflow: add a diverter [type::note]");
  const inbox = await create("Inbox");
  await create(`Intake prior art [rule-name::intake-prior-art] [rule-match::type=request] [rule-under::((${inbox.id}))] [rule-on::intake/prior-art] [rule-batch::1s] [rule-cap::5/day] [rule-skip::triage=done OR child:via-trigger=intake-prior-art]`);
  await until("the rule", async () => (await list()).rules.some((rule) => rule.name === "intake-prior-art"));
  const hose = await create("The hose reel jams again [type::request]", inbox.id);
  const shed = await create("Paint the shed door green [type::request]", inbox.id);
  const handled = await create("Compost bin lid blows off [type::request] [triage::done]", inbox.id);
  const filled = (id: string) => { const note = priorArt(store, id); return note && !note.text.includes("Looking in ") && note; };
  const hoseNote = await until("the hose request's prior art", () => filled(hose.id));
  const shedNote = await until("the shed request's prior art", () => filled(shed.id));
  expect(hoseNote.text).toContain(`((${earlier.id}|The hose reel jams when it's wound fast))`);
  expect(hoseNote.text).toContain("Likely duplicate");
  expect(hoseNote.text).toContain("[via-trigger::intake-prior-art]");
  expect(shedNote.text).toContain("No likely duplicates");
  expect(priorArt(store, handled.id)).toBeUndefined();
  // One call for the burst; the agent's answer is an edit of the note, asked by the person whose save set it off.
  const rule = (await list()).rules.find((entry) => entry.name === "intake-prior-art")!;
  expect(rule).toMatchObject({ ranToday: 1, lastRun: { when: "start", blocks: 2 } });
  expect(store.agentRequests(hoseNote.id)).toMatchObject([{ agent: "prior-art", status: "applied", requestedBy: "user" }]);
  // Nothing more runs: the notes aren't requests, and a request that has its note is skipped (a person moving one out
  // of the inbox and back starts it matching again).
  const elsewhere = await create("Elsewhere");
  await client.request({ action: "move", blockId: hose.id, parentId: elsewhere.id, mutation: { author: "user" } });
  await Bun.sleep(300);
  await client.request({ action: "move", blockId: hose.id, parentId: inbox.id, mutation: { author: "user" } });
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
