// An outline on another machine, from the outliner's side: a `.ep0ch` with `machine = "<ssh-name>"` (or EP0CH_MACHINE)
// resolves to the forward's local socket, and a client starts the forward through ssh before it connects, and again
// when it dropped. "The other machine" is an outline host in a scratch folder of its own, reached through a fake ssh
// (test/fake-ssh.ts as EP0CH_SSH); this machine's sshd isn't used.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOutlinerClient } from "../src/client";
import { OutlineHost } from "../src/outline-host";
import { boundFolderOf, resolveClientPaths, writeDotEp0ch } from "../src/paths";
import type { OutlinerServiceStatus } from "../src/types";

const root = mkdtempSync(join(tmpdir(), "outliner-machine-"));
const far = join(root, "far");
let host: OutlineHost;
const saved: Record<string, string | undefined> = {};
const VARS = ["EP0CH_SSH", "FAKE_SSH_LOG", "FAKE_SSH_HOME", "FAKE_SSH_OUTLINES", "FAKE_SSH_BIN"];
const sshCalls = () => readFileSync(join(root, "ssh.log"), "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as string[]);
const envFor = (folder: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  ({ HOME: join(root, "home"), EP0CH_OUTLINES: join(root, "outlines"), XDG_CONFIG_HOME: join(root, "config"), OUTLINER_WORKSPACE_ROOT: folder, ...extra });

beforeAll(async () => {
  for (const d of ["home", "outlines", "bin", join("far", "home"), join("far", "outlines")]) mkdirSync(join(root, d), { recursive: true, mode: 0o700 });
  host = new OutlineHost({ outlinesFolder: join(far, "outlines"), log: () => {} });
  await host.start();
  await host.create("pie");
  writeFileSync(join(root, "bin", "ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(import.meta.dir, "fake-ssh.ts")} "$@"\n`);
  // The other machine's `ep0ch status --json`: where its host is.
  writeFileSync(join(root, "bin", "ep0ch"), `#!/bin/sh\necho '${JSON.stringify({ socket: host.socketPath, outlines: [{ name: "pie" }] })}'\n`);
  for (const f of ["ssh", "ep0ch"]) chmodSync(join(root, "bin", f), 0o755);
  writeFileSync(join(root, "ssh.log"), "");
  for (const k of VARS) saved[k] = process.env[k];
  Object.assign(process.env, {
    EP0CH_SSH: join(root, "bin", "ssh"), FAKE_SSH_LOG: join(root, "ssh.log"), FAKE_SSH_HOME: join(far, "home"),
    FAKE_SSH_OUTLINES: join(far, "outlines"), FAKE_SSH_BIN: join(root, "bin"),
  });
});

afterAll(async () => {
  try { process.kill(Number(readFileSync(join(root, "outlines", ".remote", "box-a.ctl"), "utf8"))); } catch { /* not running */ }
  for (const k of VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await host.close();
  rmSync(root, { recursive: true, force: true });
});

test("a .ep0ch's machine: the forward's socket, and a client that starts the forward, shares it and starts it again", async () => {
  const notes = join(root, "work", "far-notes");
  mkdirSync(join(notes, "deep"), { recursive: true });
  writeDotEp0ch(notes, "pie", { machine: "box-a" });
  expect(readFileSync(join(notes, ".ep0ch"), "utf8")).toBe('ws = "pie"\nmachine = "box-a"\n');
  expect(boundFolderOf(join(notes, "deep"))).toEqual({ folder: notes, configPath: join(notes, ".ep0ch"), outline: "pie", machine: "box-a" });
  const paths = resolveClientPaths(envFor(join(notes, "deep")));
  const forward = join(root, "outlines", ".remote", "box-a.sock");
  expect(paths).toMatchObject({ mode: "remote", machine: "box-a", socket: forward, outline: "pie", database: "" });
  // EP0CH_WS names an outline here; EP0CH_MACHINE puts it on a machine; EP0CH_SOCKET names a socket outright.
  expect(resolveClientPaths(envFor(notes, { EP0CH_WS: "garden" }))).toMatchObject({ mode: "host", outline: "garden" });
  expect(resolveClientPaths(envFor(notes, { EP0CH_WS: "garden", EP0CH_MACHINE: "box-a" }))).toMatchObject({ mode: "remote", machine: "box-a", socket: forward });
  const named = resolveClientPaths(envFor(notes, { EP0CH_SOCKET: "/fictional/elsewhere.sock" }));
  expect(named.socket).toBe("/fictional/elsewhere.sock");
  expect(named.machine).toBeUndefined();

  const client = createOutlinerClient(paths);
  expect((await client.request<OutlinerServiceStatus>({ action: "ping" })).outline?.name).toBe("pie");
  expect(sshCalls().filter(a => a.includes("-L"))).toHaveLength(1);
  // A second client finds it up.
  await createOutlinerClient(resolveClientPaths(envFor(notes))).request({ action: "ping" });
  expect(sshCalls().filter(a => a.includes("-L"))).toHaveLength(1);
  // The forward drops: the next request starts it again.
  process.kill(Number(readFileSync(join(root, "outlines", ".remote", "box-a.ctl"), "utf8")));
  await Bun.sleep(200);
  expect((await client.request<OutlinerServiceStatus>({ action: "ping" })).outline?.name).toBe("pie");
  expect(sshCalls().filter(a => a.includes("-L"))).toHaveLength(2);
}, 30_000);
