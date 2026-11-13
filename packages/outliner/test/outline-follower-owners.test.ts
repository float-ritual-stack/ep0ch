// PIE-1751, ADR 0009: one process serves a machine's copies, and every other process asks it for the ones it needs.
// Here the owner is another process (a gateway, say) following one outline; this process wants a second one from the
// same machine, gets it from that owner, and takes the folder over when the owner exits. Fictional notes throughout.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { OutlinerClient } from "../src/client";
import { OutlineFollower } from "../src/outline-follower";
import { OutlineHost } from "../src/outline-host";
import { SCHEMA_VERSION } from "../src/schema";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";
import { scratchDir } from "./scratch-outline";

const FAR = "far-box";
let root = "";
let farHost: OutlineHost;
let owner: ReturnType<typeof Bun.spawn> | undefined;
let mine: OutlineFollower<OutlinerClient>;
let bread: Block, butter: Block;
const far = () => outlineLayout(join(root, "far"));

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (ok(value) || Date.now() > end) return value;
    await Bun.sleep(150);
  }
}
const textOf = async (id: string) => {
  const read = await mine.read();
  if ("error" in read) return read.error;
  try { return (await read.board.request<Block>({ action: "get", blockId: id } as never)).text; } catch (e) { return (e as Error).message; }
};

beforeAll(async () => {
  root = scratchDir("fown-");
  mkdirSync(join(root, "far"), { recursive: true, mode: 0o700 });
  for (const [name, text] of [["bakery", "Bread\nThe rye rises slowly."], ["dairy", "Butter\nChurned on Tuesdays."]] as const) {
    const store = new OutlinerStore(far().database(name), { workspaceRoot: root });
    const made = store.create(text, null, "user");
    if (name === "bakery") bread = made; else butter = made;
    store.close();
  }
  farHost = new OutlineHost({ outlinesFolder: far().root, log: () => {} });
  await farHost.start();
  // The other process: it owns the copies' folder first, and follows the bakery only.
  const script = join(root, "owner.ts");
  writeFileSync(script, `
const { OutlineFollower } = await import(${JSON.stringify(join(import.meta.dir, "../src/outline-follower.ts"))});
const { OutlinerClient } = await import(${JSON.stringify(join(import.meta.dir, "../src/client.ts"))});
const f = new OutlineFollower("bakery", ${JSON.stringify(FAR)}, ${JSON.stringify(join(root, "mirrors"))}, {
  schema: () => ${SCHEMA_VERSION}, everyMs: 1000, log: () => {}, reach: async () => ${JSON.stringify(farHost.socketPath)},
  attach: async (socket, name) => ({ board: new OutlinerClient(socket, 5000, name), close() {} }),
});
await f.pull();
const r = await f.read();
console.log("error" in r ? "not ready: " + r.error : "ready");
setInterval(() => {}, 1000);
`);
  owner = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "inherit" });
  const reader = (owner.stdout as ReadableStream<Uint8Array>).getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  reader.releaseLock();
  expect(first.trim()).toBe("ready");
  mine = new OutlineFollower<OutlinerClient>("dairy", FAR, join(root, "mirrors"), {
    schema: () => SCHEMA_VERSION, everyMs: 1_000, log: () => {}, reach: async () => farHost.socketPath,
    attach: async (socket, name) => ({ board: new OutlinerClient(socket, 5_000, name), close() {} }),
  });
}, 30_000);

afterAll(async () => {
  await mine?.close();
  owner?.kill();
  await farHost?.close();
});

test("a process that attaches gets the copy it asks for from the process that owns the folder", async () => {
  expect(await until(() => textOf(butter.id), t => t.startsWith("Butter"))).toBe("Butter\nChurned on Tuesdays.");
}, 30_000);

test("when the owner exits, the next process takes the folder over and keeps following", async () => {
  owner!.kill();
  await owner!.exited;
  const now = await new OutlinerClient(farHost.socketPath, 5_000, "dairy").request<Block>({ action: "get", blockId: butter.id } as never);
  await new OutlinerClient(farHost.socketPath, 5_000, "dairy").request({ action: "update", blockId: butter.id, text: `${now.text}\nAnd salted.`, expectedRevision: now.revision, mutation: { author: "user" } } as never);
  expect(await until(() => textOf(butter.id), t => t.includes("And salted."), 30_000)).toContain("And salted.");
  // The bread the old owner followed is still read here.
  expect(bread.id).toBeTruthy();
}, 45_000);
