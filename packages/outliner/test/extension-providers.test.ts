// Resource providers are any extension's (schema 5): an extension with a `kind: "resource"` handler is a provider,
// `ext:<id>`, with Jira's path for its own: its Sources from config.json, its keys read in notes, each entity kept as a
// Resource with its snapshot and history, and as a block the extension owns. Here a made-up board service ("kanboard")
// beside the made-up tickets Jira serves, in one scratch service. Every board, ticket and name is invented.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import type { ExtensionsListResult } from "../src/extension-registry";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const CARDS = {
  "KB-7": { id: "card-7", title: "Repaint the potting shed", lane: "Doing", owner: "R. Gardener", updatedAt: "2026-10-01T09:00:00.000Z" },
  "KB-9": { id: "card-9", title: "Order seed trays", lane: "Next", owner: "S. Sower", updatedAt: "2026-10-02T09:00:00.000Z" },
};

/** A made-up board service's extension: `resolve`, `read` and `changed` answered from CARDS. */
const KANBOARD = `
const cards = ${JSON.stringify(CARDS)};
const say = (value) => process.stdout.write(JSON.stringify({ ok: true, value }));
const { operation, input } = await Bun.stdin.json();
if (operation === "changed") { say({ items: [] }); process.exit(0); }
const entry = operation === "resolve" ? Object.entries(cards).find(([key]) => key === String(input.locator).toUpperCase())
  : Object.entries(cards).find(([, card]) => card.id === input.entityId);
if (!entry) { process.stdout.write(JSON.stringify({ ok: false, code: "not-found" })); process.exit(0); }
const [key, card] = entry;
if (operation === "resolve") { say({ entityId: card.id, locator: key }); process.exit(0); }
say({ entityId: card.id, locator: key, title: card.title, updatedAt: card.updatedAt, sourceContent: JSON.stringify(card),
  markdown: "# " + card.title + "\\n", metadata: { lane: card.lane, owner: card.owner },
  externalUrl: new URL("/cards/" + key, input.source.origin).href,
  record: { title: card.title, fields: [{ key: "lane", value: card.lane }, { key: "owner", value: card.owner }], body: "" } });
`;

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-ext-providers-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outline = join(root, "outline");
  const extensions = join(outline, "extensions");
  mkdirSync(join(extensions, "kanboard"), { recursive: true });
  writeFileSync(join(extensions, "kanboard", "extension.json"), JSON.stringify({
    contract: 2, id: "kanboard", version: 1, name: "Kanboard", run: ["bun", "main.ts"],
    handlers: [{ key: "kanboard", kind: "resource", effects: "read", keyPattern: "^KB-[1-9][0-9]*$", record: true, fields: ["lane", "owner"], link: "cards/{key}" }],
  }));
  writeFileSync(join(extensions, "kanboard", "main.ts"), KANBOARD);
  writeFileSync(join(extensions, "kanboard", "config.json"), JSON.stringify({ sources: [{ origin: "https://boards.example.test", project: "KB" }] }));
  // Jira beside it: the door's made-up tickets extension, the same folder shape as the real one.
  const tickets = join(extensions, "jira");
  cpSync(join(import.meta.dir, "..", "..", "door", "src", "showcase", "tickets"), tickets, { recursive: true });
  const ticketFile = join(tickets, "tickets.json");
  writeFileSync(ticketFile, JSON.stringify({ "ACME-12": { id: "1012", title: "Rollout checklist for the vendor switch", status: "In progress", updatedAt: "2026-09-19T08:30:00.000Z" } }));
  writeFileSync(join(tickets, "config.json"), JSON.stringify({ config: { tickets: ticketFile }, sources: [{ origin: "https://tickets.example.test", project: "ACME" }] }));
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outline });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state"), scheduleTickMs: 3_600_000 });
  server.setOutline({ name: "garden-scratch" });
  await server.start();
  const client = new OutlinerClient(socket, 20_000);
  cleanups.push(async () => {
    await server.close();
    store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  return { root, extensions, store, server, client };
}

async function until<T>(what: string, check: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

type Projection = { provider: string; propertyKey: string; key?: string; status: string; summary?: string; fields: { label: string; value: string }[]; record?: { blockId: string } };

test("a second extension provides Resources as Jira does: listed, its lines read, each entity a Resource and a block it owns", async () => {
  const { store, client } = await setup();
  const listed = await client.request<ExtensionsListResult>({ action: "extensions.list" });
  expect(listed.resourceProviders.map((entry) => [entry.provider, entry.key]).sort()).toEqual([["ext:jira", "jira"], ["ext:kanboard", "kanboard"]]);

  const note = await client.request<Block>({ action: "create", author: "user", text: "Shed weekend\nkanboard:: KB-7\nThe vendor work:\njira:: ACME-12" });
  const read = () => client.request<{ projections: Projection[] }>({ action: "resources.projection.read", blockId: note.id, materialize: true });
  const card = await until("the card fetched", async () => (await read()).projections.find((p) => p.provider === "ext:kanboard" && p.status === "ready"));
  expect(card).toMatchObject({ propertyKey: "kanboard", key: "KB-7", summary: "Repaint the potting shed", fields: [{ label: "Lane", value: "Doing" }, { label: "Owner", value: "R. Gardener" }] });
  // The entity is a Resource of the provider, and a block the extension keeps, attributed to it.
  const record = await until("the card's block", () => store.extensionRecords({ extensionId: "kanboard", role: "record", itemKey: "KB-7" })[0]);
  expect(store.get(record.blockId)).toMatchObject({ actorId: "ext:kanboard" });
  expect(store.get(record.blockId)!.text).toContain("[kanboard.lane::Doing]");
  expect(store.resources.require(record.resourceId!)).toMatchObject({ provider: "ext:kanboard", address: { kind: "ext:kanboard", entityId: "card-7", key: "KB-7" } });
  // Following its key finds that one Resource.
  const described = await client.request<{ resource: { id: string } }>({ action: "resources.follow-authored", reference: { kind: "ext:kanboard", key: "KB-7" } });
  expect(described.resource.id).toBe(record.resourceId!);
  // Jira, in the same note, works as it did: its ticket fetched by its own extension.
  const ticket = await until("the ticket fetched", () => store.extensionRecords({ extensionId: "jira", role: "record", itemKey: "ACME-12" })[0]);
  expect(store.resources.require(ticket.resourceId!)).toMatchObject({ provider: "ext:jira", address: { kind: "ext:jira", key: "ACME-12" } });
  // A key its pattern doesn't take is a warning on the token, not a Resource.
  const links = await client.request<{ kind: string; resources: { diagnostics: { message: string }[] } }>({ action: "blocks.authored-links",
    ownerBlockId: (await client.request<Block>({ action: "create", author: "user", text: "Odd card [kanboard::SHED-1]" })).id });
  expect(JSON.stringify(links)).toContain("Kanboard Resource key SHED-1 doesn't match its key pattern");
}, 30_000);

test("a provider is checked when its folder loads: one resource handler, and no data handler beside it", async () => {
  const { extensions, client } = await setup();
  const install = async (handlers: unknown[]) => {
    mkdirSync(join(extensions, "twoboards"), { recursive: true });
    writeFileSync(join(extensions, "twoboards", "extension.json"), JSON.stringify({ contract: 2, id: "twoboards", version: 1, name: "Two boards", run: ["bun", "main.ts"], handlers }));
    writeFileSync(join(extensions, "twoboards", "main.ts"), "");
    return (await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true })).extensions.find((entry) => entry.id === "twoboards")!;
  };
  expect((await install([{ key: "boarda", kind: "resource", effects: "read" }, { key: "boardb", kind: "resource", effects: "read" }])).error)
    .toContain("is the extension's one resource or data handler");
  expect((await install([{ key: "boarda", kind: "resource", effects: "read" }, { key: "boardnote", kind: "data", effects: "read" }])).error)
    .toContain("is the extension's one resource or data handler");
  expect((await install([{ key: "boarda", kind: "resource", effects: "read" }])).state).toBe("active");
});

test("an outline reads its own providers' lines: another outline in the same process, without the extension, doesn't", async () => {
  const { root, client } = await setup();
  // A second outline in this process, with no extensions of its own.
  const store = new OutlinerStore(join(root, "other.sqlite"), { workspaceRoot: join(root, "other") });
  const other = new OutlinerServer(store, join(root, "other.sock"), undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "other-state") });
  await other.start();
  cleanups.push(async () => { await other.close(); store.close(); });
  const otherClient = new OutlinerClient(join(root, "other.sock"), 20_000);
  const here = await client.request<Block>({ action: "create", author: "user", text: "Shed\nkanboard:: KB-9" });
  const there = await otherClient.request<Block>({ action: "create", author: "user", text: "Shed\nkanboard:: KB-9" });
  const read = (c: OutlinerClient, id: string) => c.request<{ projections: Projection[] }>({ action: "resources.projection.read", blockId: id });
  expect((await read(client, here.id)).projections.map((p) => p.provider)).toEqual(["ext:kanboard"]);
  expect((await read(otherClient, there.id)).projections).toEqual([]);
  expect((await otherClient.request<ExtensionsListResult>({ action: "extensions.list" })).resourceProviders).toEqual([]);
}, 30_000);
