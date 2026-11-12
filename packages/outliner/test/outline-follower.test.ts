// PIE-1751, ADR 0009: a follower on "float-2" reads an outline whose home is "the laptop", applying the home's change
// log from its cursor. "The laptop" is an outline host in a scratch folder of its own, reached through the fake ssh
// (test/fake-ssh.ts). A change there is here within seconds; the follower catches up after the home was away; a home
// whose log is another (made again, restored) is rebuilt from, never applied over. Fictional notes throughout.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { canonicalDump } from "../src/change-log";
import { OutlinerClient } from "../src/client";
import { forwardFor } from "../src/machine-forward";
import { OutlineFollower } from "../src/outline-follower";
import { OutlineHost } from "../src/outline-host";
import { SCHEMA_VERSION } from "../src/schema";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";
import { scratchDir } from "./scratch-outline";

const FAR = "far-box";
let root = "";
let farHost: OutlineHost;
let follower: OutlineFollower<OutlinerClient>;
let kettle: Block;
const env: NodeJS.ProcessEnv = {};
const logged: string[] = [];
const far = () => outlineLayout(join(root, "far", "outlines"));
const farClient = () => new OutlinerClient(farHost.socketPath, 15_000, "field-notes");
const copyFile = () => join(root, "mirrors", FAR, "field-notes.sqlite");

/** A read of the copy until `ok` holds, for at most `ms`: what a person sees, polled. */
async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, ms = 8_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (ok(value) || Date.now() > end) return value;
    await Bun.sleep(100);
  }
}
const textOf = async (id: string) => {
  const read = await follower.read();
  if ("error" in read) return read.error;
  try { return (await read.board.request<Block>({ action: "get", blockId: id } as never)).text; } catch (e) { return (e as Error).message; }
};
/** Both files, compared by the log's canonical dump (each opened read-only, a test's look). */
const dump = (path: string) => { const db = new Database(path, { readonly: true }); try { return canonicalDump(db); } finally { db.close(); } };

beforeAll(async () => {
  root = scratchDir("fol-");
  for (const d of ["outlines", "bin", "mirrors", "far/home", "far/outlines"]) mkdirSync(join(root, d), { recursive: true, mode: 0o700 });
  const notes = new OutlinerStore(far().database("field-notes"), { workspaceRoot: root });
  kettle = notes.create("Kettle log\nThe kettle sang at seven.", null, "user");
  notes.configureMcpAccess("read");
  notes.close();
  farHost = new OutlineHost({ outlinesFolder: far().root, log: () => {} });
  await farHost.start();
  writeFileSync(join(root, "bin", "ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(import.meta.dir, "fake-ssh.ts")} "$@"\n`);
  writeFileSync(join(root, "bin", "ep0ch"), `#!/bin/sh\necho '${JSON.stringify({ socket: farHost.socketPath, outlines: [{ name: "field-notes" }] })}'\n`);
  for (const f of ["ssh", "ep0ch"]) chmodSync(join(root, "bin", f), 0o755);
  Object.assign(env, {
    PATH: process.env.PATH, HOME: join(root, "home"), EP0CH_SSH: join(root, "bin", "ssh"), FAKE_SSH_LOG: join(root, "ssh.log"),
    FAKE_SSH_OWNER_FILE: process.env.FAKE_SSH_OWNER_FILE!, FAKE_SSH_HOME: join(root, "far", "home"), FAKE_SSH_OUTLINES: far().root, FAKE_SSH_BIN: join(root, "bin"),
  });
  follower = new OutlineFollower<OutlinerClient>("field-notes", FAR, join(root, "mirrors"), {
    label: "test follow", log: line => logged.push(line), schema: () => SCHEMA_VERSION,
    // No timer within a test: only the home's events (and a reconnect to them) wake the follower.
    everyMs: 600_000,
    reach: async machine => (await forwardFor(machine, join(root, "outlines"), env)).socket,
    attach: async (socket, name) => ({ board: new OutlinerClient(socket, 5_000, name), close() {} }),
  });
});

afterAll(async () => {
  await follower?.close();
  try { process.kill(Number(readFileSync(join(root, "outlines", ".remote", `${FAR}.ctl`), "utf8"))); } catch { /* not running */ }
  await farHost?.close();
  rmSync(root, { recursive: true, force: true });
});

test("the first read makes the copy from the home's log: the notes, the access setting and the home's instance", async () => {
  const read = await until(() => follower.read(), r => !("error" in r));
  if ("error" in read) throw new Error(`${read.error}\n${logged.join("\n")}`);
  expect(await textOf(kettle.id)).toBe("Kettle log\nThe kettle sang at seven.");
  expect(read.stale).toBeUndefined();
  expect(read.copy.file).toBe(`${FAR}/field-notes.sqlite`);
  expect(read.copy.cursor).toBeGreaterThan(0);
  expect(read.homeInstanceId).toBe((await farClient().request<{ outlineInstanceId: string }>({ action: "ping" } as never)).outlineInstanceId);
  // A read-only copy: a write is refused here, and made on the home.
  expect(read.board.request({ action: "create", text: "Not here" } as never)).rejects.toThrow(/read-only/);
}, 30_000);

test("a change on the home is in the copy within seconds, woken by the home's events", async () => {
  const now = await farClient().request<Block>({ action: "get", blockId: kettle.id } as never);
  const started = Date.now();
  await farClient().request({ action: "update", blockId: kettle.id, text: `${now.text}\nIt sang again at nine.`, expectedRevision: now.revision, mutation: { author: "user" } } as never);
  const text = await until(() => textOf(kettle.id), t => t.includes("nine"), 5_000);
  expect(text).toContain("It sang again at nine.");
  expect(Date.now() - started).toBeLessThan(5_000);
}, 30_000);

test("while the home is away the copy is served, stale, and it catches up from its cursor when the home is back", async () => {
  await farHost.close();
  await follower.pull();
  const away = await follower.read();
  if ("error" in away) throw new Error(away.error);
  expect(away.stale?.why).toContain(FAR);
  expect(await textOf(kettle.id)).toContain("nine");
  // Written on the home while the follower couldn't reach it.
  const notes = new OutlinerStore(far().database("field-notes"), { workspaceRoot: root });
  const shelf = notes.create("Shelf of mugs", null, "user");
  notes.close();
  farHost = new OutlineHost({ outlinesFolder: far().root, log: () => {} });
  await farHost.start();
  const back = await until(() => textOf(shelf.id), t => t === "Shelf of mugs");
  expect(back).toBe("Shelf of mugs");
  const read = await follower.read();
  expect("error" in read ? read.error : read.stale).toBeUndefined();
  // Entry for entry the home's: the two files hold the same rows. (Some of what a host writes as it opens an outline
  // raises no event; the follower's timer, asked here, takes it.)
  await follower.pull();
  await farHost.close();
  expect(dump(copyFile())).toBe(dump(far().database("field-notes")));
  farHost = new OutlineHost({ outlinesFolder: far().root, log: () => {} });
  await farHost.start();
}, 30_000);

test("a home whose log is another (the outline made again) is rebuilt from, never applied over", async () => {
  await farHost.close();
  const file = far().database("field-notes");
  for (const s of ["", "-wal", "-shm"]) if (existsSync(file + s)) renameSync(file + s, `${file}.old${s}`);
  const fresh = new OutlinerStore(file, { workspaceRoot: root });
  const teapot = fresh.create("Teapot log\nA new pot, a new book.", null, "user");
  fresh.close();
  farHost = new OutlineHost({ outlinesFolder: far().root, log: () => {} });
  await farHost.start();
  expect(await until(() => textOf(teapot.id), t => t.startsWith("Teapot log"))).toBe("Teapot log\nA new pot, a new book.");
  // The old notes went with the old log.
  expect(await textOf(kettle.id)).not.toContain("Kettle log");
  expect(logged.join("\n")).toContain("copy made from");
}, 30_000);
