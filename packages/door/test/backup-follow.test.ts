// PIE-1751, ADR 0009: `ep0ch backup follow` keeps following on its own. Started while another process owns the copies'
// folder (a gateway), it attaches; when that process exits, the follow takes the folder over at its next look and
// the copy keeps up with its home. Fictional notes, scratch hosts only.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { OutlinerClient } from "../../outliner/src/client";
import { OutlineHost } from "@ep0ch/outliner/outline-host";
import { OutlinerStore } from "../../outliner/src/store";
import { keepFollowing } from "../src/backup/follow";
import { OutlineFollower } from "../src/mcp-mirror";
import { scratchDir } from "./scratch";

const FAR = "far-box";
const OUTLINER = join(import.meta.dir, "../../outliner/src");
let root = "", farHost: OutlineHost, owner: ReturnType<typeof Bun.spawn> | undefined;
let note = "";

beforeAll(async () => {
  root = scratchDir("bfol-");
  mkdirSync(join(root, "far"), { recursive: true, mode: 0o700 });
  const store = new OutlinerStore(outlineLayout(join(root, "far")).database("larder"), { workspaceRoot: root });
  note = store.create("Larder\nThe jam is on the top shelf.", null, "user").id;
  store.close();
  farHost = new OutlineHost({ outlinesFolder: join(root, "far"), log: () => {} });
  await farHost.start();
  const script = join(root, "owner.ts");
  writeFileSync(script, `
const { OutlineFollower } = await import(${JSON.stringify(join(OUTLINER, "outline-follower.ts"))});
const { OutlinerClient } = await import(${JSON.stringify(join(OUTLINER, "client.ts"))});
const { SCHEMA_VERSION } = await import(${JSON.stringify(join(OUTLINER, "schema.ts"))});
const f = new OutlineFollower("larder", ${JSON.stringify(FAR)}, ${JSON.stringify(join(root, "mirrors"))}, {
  schema: () => SCHEMA_VERSION, everyMs: 600000, log: () => {}, reach: async () => ${JSON.stringify(farHost.socketPath)},
  attach: async (socket, name) => ({ board: new OutlinerClient(socket, 5000, name), close() {} }),
});
await f.pull();
console.log("ready");
setInterval(() => {}, 1000);
`);
  owner = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "inherit" });
  const reader = (owner.stdout as ReadableStream<Uint8Array>).getReader();
  expect(new TextDecoder().decode((await reader.read()).value).trim()).toBe("ready");
  reader.releaseLock();
}, 30_000);

afterAll(async () => { owner?.kill(); await farHost?.close(); });

test("a follow that attached takes the folder over when its owner exits, and keeps the copy current", async () => {
  const f = new OutlineFollower("larder", FAR, join(root, "mirrors"), () => {}, Date.now, { reach: async () => farHost.socketPath, everyMs: 600_000 });
  const stop = Promise.withResolvers<void>();
  const lines: string[] = [];
  const running = keepFollowing([f], stop.promise, { everyMs: 300, say: line => lines.push(line) });
  try {
    owner!.kill();
    await owner!.exited;
    const home = new OutlinerClient(farHost.socketPath, 5_000, "larder");
    const now = await home.request<{ text: string; revision: number }>({ action: "get", blockId: note } as never);
    await home.request({ action: "update", blockId: note, text: `${now.text}\nThe honey beside it.`, expectedRevision: now.revision, mutation: { author: "user" } } as never);
    const status = join(root, "mirrors", FAR, ".follow", "larder.json");
    const cursor = () => { try { return (JSON.parse(readFileSync(status, "utf8")) as { cursor: number }).cursor; } catch { return 0; } };
    const before = cursor();
    for (let i = 0; i < 100 && cursor() <= before; i++) await Bun.sleep(150);
    expect(cursor()).toBeGreaterThan(before);
    const read = await f.read();
    if ("error" in read) throw new Error(read.error);
    const copy = new OutlinerClient(outlineLayout(join(root, "mirrors", FAR)).socket, 5_000, "larder");
    expect((await copy.request<{ text: string }>({ action: "get", blockId: note } as never)).text).toContain("The honey beside it.");
  } finally {
    stop.resolve();
    await running;
    await f.close();
  }
}, 45_000);
