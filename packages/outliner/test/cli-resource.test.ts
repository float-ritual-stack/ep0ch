// PIE-853: a file link whose folder now leads elsewhere is refused with a command, and that command, run as the refusal
// says it, makes the link read again. A scratch host and made-up files.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scratchOutline } from "./scratch-outline";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test("the command a moved folder's refusal names re-binds it, and its file reads again", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-cli-resource-"));
  const { env, ...paths } = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  cleanups.push(async () => {
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const inbox = join(root, "inbox"), synced = join(root, "synced");
  mkdirSync(inbox);
  mkdirSync(synced);
  writeFileSync(join(inbox, "seed-list.md"), "# Seeds\n");
  writeFileSync(join(synced, "seed-list.md"), "# Seeds, synced\n");
  store.resources.internFilesystem({ path: join(inbox, "seed-list.md") });
  rmSync(inbox, { recursive: true });
  symlinkSync(synced, inbox);

  let refusal = "";
  try { store.resources.readFilesystemReference(join(inbox, "seed-list.md")); } catch (error) { refusal = (error as Error).message; }
  const command = refusal.match(/ep0ch (resource rebind .*)$/)?.[1];
  expect(command).toBe(`resource rebind ${inbox} --ws scratch`);

  const child = Bun.spawn(["bun", "src/cli.ts", ...command!.split(" ")], {
    cwd: join(import.meta.dir, ".."), env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
  expect(stdout).toContain("its files are read from where it leads now");
  expect(store.resources.readFilesystemReference(join(inbox, "seed-list.md")).text).toBe("# Seeds, synced\n");
});
