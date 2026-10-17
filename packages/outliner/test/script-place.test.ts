// place() from a script (PIE-956, S6): output lands as a region the script owns, at an address, as one attributed write;
// a second run replaces only its own unedited region; a person's edit makes it theirs; a door's draft takes the write
// (or declines it and the output waits as a proposal). Scratch services, made-up notes.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import type { ExtensionsListResult } from "../src/extension-registry";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { findOutputRegions } from "@ep0ch/outline-core/output-region";
import { applyLocated, locateSpans } from "@ep0ch/outline-core/draft-patch-compare";
import type { DraftHolderRequest } from "../src/draft-patch";
import type { Block, OutlinerEvent } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function until<T>(what: string, check: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-script-place-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: join(root, "outline") });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, agentRequestQuietMs: 80, ruleQuietMs: 20 });
  await server.start();
  const client = new OutlinerClient(socket, 15_000);
  cleanups.push(async () => {
    await server.close();
    store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const create = (text: string, parent: string | null = null) => store.create(text, parent, "user");
  const extensionOf = async (name: string) => (await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true })).extensions.find(e => e.name === name)!;
  /** Runs a script by name, as a person would, with the note it is about and its slots. */
  const run = async (name: string, options: { blockId?: string; args?: Record<string, string>; line?: number } = {}) => {
    const extension = await extensionOf(name);
    const started = await client.request<{ written: string[]; undo: string }>({ action: "extensions.act", extension: extension.id, extensionAction: "run", ...options });
    const note = () => store.get(started.written[0]!)!.text;
    await until(`${name} to finish`, () => !note().split("\n")[0]!.includes("· working"));
    return { text: note(), undo: started.undo, extension };
  };
  const output = (blockId: string) => store.extensionOutputs(blockId).map(row => (row.result as { markdown?: string } | null)?.markdown ?? row.error);
  return { store, client, create, extensionOf, run, output };
}


const WEEKLY = (mode: string, body = "v1") => `Weekly [script::weekly] [effects::write]
\`\`\`js
return await place(${JSON.stringify(body)}, { at: "^week", mode: ${JSON.stringify(mode)} });
\`\`\``;
const NOTE = "Plan\n\n## This week ^week\n\nmy own paragraph\n\n## Later ^later";

test("place appends a region under the anchor as the script; a rerun with upsert replaces only that region", async () => {
  const { store, create, run } = await setup();
  create(WEEKLY("upsert"));
  const note = create(NOTE);
  const first = await run("weekly", { blockId: note.id });
  expect(first.text).toContain("· done");
  const once = findOutputRegions(store.get(note.id)!.text);
  expect(once).toHaveLength(1);
  expect(once[0]).toMatchObject({ body: "v1", label: "weekly", edited: false });
  expect(store.get(note.id)!.text).toContain("my own paragraph");
  const edit = store.changes.since(0, 1000);
  const change = edit.kind === "changes" ? edit.changes.find(c => c.kind === "edit" && c.blockId === note.id) : undefined;
  expect(change?.actor).toMatchObject({ author: "agent", actorId: "script:weekly" });

  // Same script, new output, same anchor: still one region.
  const script = store.queryBlocks({ where: "script=weekly" }).blocks[0]!;
  store.update(script.id, script.text.replace('"v1"', '"v2"'), script.revision, { author: "user" });
  await run("weekly", { blockId: note.id });
  const twice = findOutputRegions(store.get(note.id)!.text);
  expect(twice).toHaveLength(1);
  expect(twice[0]).toMatchObject({ body: "v2", anchor: once[0]!.anchor });
});

test("a person's edit inside the region makes it theirs: the new output waits as a proposal and their text stays", async () => {
  const { store, create, run } = await setup();
  const script = create(WEEKLY("upsert"));
  const note = create(NOTE);
  await run("weekly", { blockId: note.id });
  const written = store.get(note.id)!;
  store.update(note.id, written.text.replace("v1", "v1 plus my words"), written.revision, { author: "user" });
  store.update(script.id, store.get(script.id)!.text.replace('"v1"', '"v2"'), store.get(script.id)!.revision, { author: "user" });
  const ran = await run("weekly", { blockId: note.id });
  expect(ran.text).toContain("proposed instead");
  expect(store.get(note.id)!.text).toContain("v1 plus my words");
  expect(store.get(note.id)!.text).not.toContain("v2");
  expect(store.children(note.id).some(c => c.text.includes("draft-patch"))).toBe(true);
});

test("a missing anchor is one proposal at the caller with a did-you-mean, and the note is unchanged", async () => {
  const { store, create, run } = await setup();
  create(WEEKLY("append").replace("^week", "^weak"));
  const note = create(NOTE);
  const ran = await run("weekly", { blockId: note.id, line: 2 });
  expect(ran.text).toContain("^weak isn't in this note; did you mean ^week?");
  expect(store.get(note.id)!.text).toBe(NOTE);
});

test("replace aimed at a heading is refused at the call and writes nothing", async () => {
  const { store, create, run } = await setup();
  create(WEEKLY("replace"));
  const note = create(NOTE);
  const ran = await run("weekly", { blockId: note.id });
  expect(ran.text).toContain("^week is a heading section; replace needs an output region; use upsert or append");
  expect(store.get(note.id)!.text).toBe(NOTE);
});

test("a read-only script (the default, and render mode) can't place and writes nothing", async () => {
  const { create, run } = await setup();
  create(`Drawer [script::drawer-placer] [effects::write]\n\`\`\`js\nreturn await place("x", { at: "^week" });\n\`\`\``.replace("[effects::write]", ""));
  const note = create(NOTE);
  const ran = await run("drawer-placer", { blockId: note.id });
  expect(ran.text).toContain("read-only");
});

/** A stand-in for a door holding a live draft: it answers the service's reads and patches against its own buffer. */
async function fakeDoor(client: OutlinerClient, clientId: string, block: Block, accept: boolean) {
  const door = { text: block.text, requests: [] as DraftHolderRequest[] };
  const connected = Promise.withResolvers<void>();
  const watcher = client.watch({
    client: { clientId, role: "observer", contextId: clientId },
    onConnect: connected.resolve,
    onEvent: async (event: OutlinerEvent) => {
      if (event.domain !== "draft" || !event.draft) return;
      const request = event.draft;
      door.requests.push(request);
      let answer: unknown = { applied: false, reason: "not in this stand-in" };
      if (request.kind === "read") answer = { text: door.text, revision: block.revision };
      else if (request.kind === "patch") {
        const located = locateSpans(door.text, request.patches, request.force);
        if (!accept) answer = { applied: false, reason: "the cursor is in that passage" };
        else if (!located.ok) answer = { applied: false, reason: located.reason };
        else { door.text = applyLocated(door.text, located.spans); answer = { applied: true }; }
      }
      await client.request({ action: "drafts.answer", requestId: request.requestId, clientId, answer: answer as never }).catch(() => undefined);
    },
  });
  cleanups.push(() => watcher.stop());
  await connected.promise;
  await client.request({ action: "drafts.hold", blockId: block.id, clientId, revision: block.revision });
  return door;
}

test("a door holding the note takes the write in its draft as one patch; the saved note waits for its save", async () => {
  const { store, client, create, run } = await setup();
  create(WEEKLY("append"));
  const note = create(NOTE);
  const door = await fakeDoor(client, "door-a", note, true);
  door.text = `${NOTE}\n\ntyping here`;
  await run("weekly", { blockId: note.id });
  expect(findOutputRegions(door.text)).toHaveLength(1);
  expect(door.text).toContain("typing here");
  expect(store.get(note.id)!.text).toBe(NOTE);
});

test("a door that declines the patch (its cursor is there) leaves one proposal, never a write", async () => {
  const { store, client, create, run } = await setup();
  create(WEEKLY("append"));
  const note = create(NOTE);
  const door = await fakeDoor(client, "door-b", note, false);
  const ran = await run("weekly", { blockId: note.id });
  expect(ran.text).toContain("proposed instead");
  expect(findOutputRegions(door.text)).toHaveLength(0);
  expect(store.get(note.id)!.text).toBe(NOTE);
});
