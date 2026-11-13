// PIE-1751, ADR 0009: one process serves a machine's copies, and every other process asks it for the ones it needs.
// Here the owner is another process (a gateway, say) following one outline; this process wants a second one from the
// same machine, gets it from that owner, and takes the folder over when the owner exits. Fictional notes throughout.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

test("an ask left by a process that has gone, or by an earlier build, isn't followed (PIE-1779)", async () => {
  // float-2, Nov 12: asks for eight copies nobody listed any more stayed in the folder, and the gateway followed them
  // all, each asking the laptop for its log through the one forward.
  const follow = join(root, "mirrors", FAR, ".follow");
  const store = new OutlinerStore(far().database("pantry"), { workspaceRoot: root });
  store.create("Pantry\nLentils on the top shelf.", null, "user");
  store.close();
  writeFileSync(join(follow, "pantry.want"), "");
  const gone = Bun.spawn(["true"]);
  await gone.exited;
  writeFileSync(join(follow, "larder.want"), String(gone.pid));
  // The owner looks every second (everyMs 1000): three looks.
  await Bun.sleep(3_000);
  expect(["pantry", "larder"].filter(name => existsSync(join(follow, `${name}.json`)))).toEqual([]);
});

test("each reader's ask is its own: a copy stays followed while any reader runs, and stops once the last has let go (PIE-1779)", async () => {
  // Codex on #1481: one ask file held only its first reader's id, so that reader's exit hid the copy from another still
  // reading it; and a loop started for an ask kept polling the home after the ask had gone.
  const { followedCopies } = await import("../src/outline-follower");
  const { readFileSync } = await import("node:fs");
  const store = new OutlinerStore(far().database("cellar"), { workspaceRoot: root });
  store.create("Cellar\nPotatoes in the dark.", null, "user");
  store.close();
  const cursor = () => { try { return (JSON.parse(readFileSync(join(root, "mirrors", FAR, ".follow", "cellar.json"), "utf8")) as { cursor: number }).cursor; } catch { return -1; } };
  const write = (text: string) => new OutlinerClient(farHost.socketPath, 5_000, "cellar").request<Block>({ action: "create", text, mutation: { author: "user" } } as never);
  // A reader in a process of its own: it asks for the cellar, reads it once, and then keeps running (or lets go first).
  const reader = async (then: "stay" | "close") => {
    const script = join(root, `reader-${then}-${Math.random().toString(36).slice(2, 8)}.ts`);
    writeFileSync(script, `
const { OutlineFollower } = await import(${JSON.stringify(join(import.meta.dir, "../src/outline-follower.ts"))});
const { OutlinerClient } = await import(${JSON.stringify(join(import.meta.dir, "../src/client.ts"))});
const f = new OutlineFollower("cellar", ${JSON.stringify(FAR)}, ${JSON.stringify(join(root, "mirrors"))}, {
  schema: () => ${SCHEMA_VERSION}, everyMs: 1000, log: () => {}, reach: async () => ${JSON.stringify(farHost.socketPath)},
  attach: async (socket, name) => ({ board: new OutlinerClient(socket, 5000, name), close() {} }),
});
for (let i = 0; i < 100; i++) { const r = await f.read(); if (!("error" in r)) break; await Bun.sleep(100); }
${then === "close" ? "await f.close();" : ""}
console.log("ready");
setInterval(() => {}, 1000);
`);
    const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "inherit" });
    const out = (child.stdout as ReadableStream<Uint8Array>).getReader();
    expect(new TextDecoder().decode((await out.read()).value).trim()).toBe("ready");
    out.releaseLock();
    return child;
  };
  const a = await reader("stay"), b = await reader("stay");
  let c: Awaited<ReturnType<typeof reader>> | undefined;
  try {
    a.kill(); await a.exited;
    expect(followedCopies(join(root, "mirrors"), FAR)).toContain("cellar");
    const before = cursor();
    await write("Onions hung by the door.");
    expect(await until(async () => cursor(), n => n > before)).toBeGreaterThan(before);
    b.kill(); await b.exited;
    expect(followedCopies(join(root, "mirrors"), FAR)).not.toContain("cellar");
    // A reader that asks, then lets go while it still runs: nobody asks any more, so the owner stops following it.
    c = await reader("close");
    expect(followedCopies(join(root, "mirrors"), FAR)).not.toContain("cellar");
    await Bun.sleep(2_500);
    const stopped = cursor();
    await write("Apples on the slatted shelf.");
    await Bun.sleep(3_000);
    expect(cursor()).toBe(stopped);
  } finally { for (const p of [a, b, c]) p?.kill(); }
}, 60_000);
