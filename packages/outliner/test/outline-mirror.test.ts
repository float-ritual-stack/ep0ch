import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlineMirror } from "../src/outline-mirror";
import { SCHEMA_VERSION } from "../src/schema";
import { OutlinerStore } from "../src/store";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** A scratch mirrors folder holding a laptop copy of each made-up outline named. */
function copies(...names: string[]): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outline-mirror-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "mirrors", "laptop"), { recursive: true });
  for (const name of names) {
    const seed = new OutlinerStore(join(root, `${name}.sqlite`));
    seed.create(`The ${name} list`);
    seed.close();
    const file = new Database(join(root, `${name}.sqlite`));
    file.run("VACUUM INTO ?", [join(root, "mirrors", "laptop", `${name}.sqlite`)]);
    file.close();
  }
  return join(root, "mirrors");
}

test("a copy that can't be snapshotted is tried again on the check's clock, not on every read (PIE-1546)", async () => {
  const folder = copies("orchard");
  let clock = 1_000_000, attaches = 0;
  const mirror = new OutlineMirror("orchard", "laptop", folder, {
    schema: () => SCHEMA_VERSION, now: () => clock, log: () => {},
    attach: async () => { attaches++; throw new Error("the copy's host didn't answer"); },
  });
  cleanups.push(() => mirror.close());
  expect(await mirror.read()).toMatchObject({ error: "can't be read: the copy's host didn't answer" });
  expect(await mirror.read()).toMatchObject({ error: "can't be read: the copy's host didn't answer" });
  expect(attaches).toBe(1);
  clock += 15_000;
  await mirror.read();
  expect(attaches).toBe(2);
});

test("an away machine's copies are snapshotted one at a time, and each says its newest change itself (PIE-1546)", async () => {
  const names = ["attic", "cellar", "shed"];
  const folder = copies(...names);
  let building = 0, most = 0;
  const mirrors = names.map(name => new OutlineMirror(name, "laptop", folder, {
    schema: () => SCHEMA_VERSION, log: () => {},
    attach: async () => {
      most = Math.max(most, ++building);
      await Bun.sleep(30);
      building--;
      return { board: name, close() {} };
    },
  }));
  cleanups.push(() => Promise.all(mirrors.map(m => m.close())).then(() => {}));
  const reads = await Promise.all(mirrors.map(m => m.read()));
  expect(most).toBe(1);
  for (const read of reads) {
    if ("error" in read) throw new Error(read.error);
    expect(Date.parse(read.asOf)).toBeGreaterThan(Date.now() - 60_000);
  }
});
