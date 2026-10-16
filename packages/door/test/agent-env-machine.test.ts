// An agent's scratch environment never reaches a real machine (PIE-912): under scripts/agent-env, a `.ep0ch`'s
// `machine` and EP0CH_MACHINE are set aside (and said on stderr), so `ep0ch outline create x` from a repo folder that
// names another machine makes x here, in the scratch outlines folder, and nothing goes over ssh. `--machine` still
// reaches one on purpose. "ssh" here is the fake one, found on PATH the way the real one is (EP0CH_SSH is not set:
// agent-env clears it), and "the other machine" is a scratch host.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { outliner, ScratchHost, scratchDir } from "./scratch";

const DOOR = resolve(import.meta.dir, "..");
const AGENT_ENV = resolve(DOOR, "../../scripts/agent-env");
const host = new ScratchHost();   // the other machine
const local = new ScratchHost();  // this one
let here = "";
const log = () => readFileSync(join(here, "ssh.log"), "utf8").trim().split("\n").filter(Boolean);

beforeAll(async () => {
  await host.start();
  await local.start();
  here = scratchDir("ep0ch-aenv-");
  for (const d of ["bin", "repo/.ep0ch", "far-home", "agents", "agent-tmp"]) mkdirSync(join(here, d), { recursive: true, mode: 0o700 });
  writeFileSync(join(here, "bin", "ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(outliner!, "test", "fake-ssh.ts")} "$@"\n`);
  writeFileSync(join(here, "bin", "ep0ch"), `#!/bin/sh\nexec ${process.execPath} ${join(DOOR, "src/main.ts")} "$@"\n`);
  for (const f of ["ssh", "ep0ch"]) chmodSync(join(here, "bin", f), 0o755);
  writeFileSync(join(here, "repo", ".ep0ch", "config.toml"), 'ws = "garden"\nmachine = "box-a"\n');
  writeFileSync(join(here, "ssh.log"), "");
}, 30_000);

afterAll(async () => {
  await local.dispose();
  await host.dispose();
  rmSync(here, { recursive: true, force: true });
});

/** `ep0ch …` under agent-env "tester", from the repo folder whose .ep0ch names box-a, with the fake ssh as the only ssh. */
async function underAgentEnv(args: string[], extra: Record<string, string> = {}) {
  const env: Record<string, string> = {
    PATH: `${join(here, "bin")}:${process.env.PATH}`, HOME: process.env.HOME!, EP0CH_AGENT_ROOT: join(here, "agents"), EP0CH_AGENT_TMP: join(here, "agent-tmp"),
    FAKE_SSH_LOG: join(here, "ssh.log"), FAKE_SSH_HOME: join(here, "far-home"), FAKE_SSH_OUTLINES: host.outlines, FAKE_SSH_BIN: join(here, "bin"), ...extra,
  };
  const p = Bun.spawn([AGENT_ENV, "tester", "--", "env", `EP0CH_OUTLINES=${local.outlines}`, "ep0ch", ...args], { cwd: join(here, "repo"), env, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

describe("agent-env and a folder's machine", () => {
  test("a .ep0ch's machine is set aside: the outline is made here, nothing goes over ssh, and stderr says so", async () => {
    const r = await underAgentEnv(["outline", "create", "fold"]);
    expect(log()).toEqual([]);
    expect(existsSync(join(host.outlines, "fold.sqlite"))).toBe(false);
    expect(r.err).toContain("ignoring machine box-a from this folder's .ep0ch");
    expect(r.err).toContain("--machine box-a");
    expect(r.code).toBe(0);
    expect(existsSync(join(local.outlines, "fold.sqlite"))).toBe(true);
  }, 60_000);

  test("EP0CH_MACHINE in the caller's environment is set aside the same way", async () => {
    const r = await underAgentEnv(["outline", "list"], { EP0CH_MACHINE: "box-a" });
    expect(log()).toEqual([]);
    expect(r.err).not.toContain("box-a:");
  }, 60_000);

  test("--machine still reaches the machine on purpose", async () => {
    await underAgentEnv(["outline", "list", "--machine", "box-a"]);
    expect(log().length).toBeGreaterThan(0);
  }, 60_000);
});
