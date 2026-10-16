// A read never creates an outline (PIE-938). `ep0ch show|find|export` on a name this machine doesn't have used to say
// only that the host had no such outline, with "create it with ep0ch init" (which does the opposite of what a reader
// wants); the person's builder, run in a folder with no .ep0ch, read an outline that lives on another machine, saw
// nothing, and left an empty file that held the next install back. Now: the read refuses, nothing is made, and it
// says which machines have that outline (the shared forwards in .remote/, and what `outline list --all` knows) with
// the exact command. Writes and opening a door still create, as the rule says. The other machine is a scratch host
// behind the fake ssh. Fictional outlines only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { outliner, ScratchHost, scratchDir } from "./scratch";

const MAIN = resolve(import.meta.dir, "../src/main.ts");
const far = new ScratchHost();    // the other machine, which has `garden`
const local = new ScratchHost();  // this machine, which doesn't
let dir = "", work = "";

beforeAll(async () => {
  await far.start();
  await local.start();
  await far.create("garden");
  dir = scratchDir("ep0ch-readnc-");
  for (const d of ["bin", "far-home", "state"]) mkdirSync(join(dir, d), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "bin/ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(outliner!, "test/fake-ssh.ts")} "$@"\n`);
  chmodSync(join(dir, "bin/ssh"), 0o755);
  work = local.folder("worktree");  // like a builder's worktree: no .ep0ch above it
  // The forward to the other machine is up, as a person's is once they have opened it.
  const up = await ep0ch(["outline", "list", "--machine", "far-box"]);
  expect(up.code).toBe(0);
}, 60_000);

afterAll(async () => {
  await local.dispose();
  await far.dispose();
  rmSync(dir, { recursive: true, force: true });
});

async function ep0ch(args: string[], extra: Record<string, string> = {}) {
  const env = {
    ...local.env, PATH: process.env.PATH!, EP0CH_CONTROL: join(dir, "no-door.sock"), EP0CH_STATE: join(dir, "state"),
    EP0CH_SSH: join(dir, "bin/ssh"), FAKE_SSH_HOME: join(dir, "far-home"), FAKE_SSH_OUTLINES: far.outlines, FAKE_SSH_BIN: join(dir, "bin"), ...extra,
  };
  const p = Bun.spawn(["bun", MAIN, ...args], { cwd: work, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
}
const made = (name: string) => existsSync(join(local.outlines, `${name}.sqlite`)) || existsSync(join(local.outlines, name));

describe("a read of a name this machine doesn't have", () => {
  for (const args of [["show", "--ws", "garden", "abc12345"], ["find", "--ws", "garden", "beds"], ["export", "--ws", "garden", "abc12345"]]) {
    test(`ep0ch ${args[0]}: nothing is made; it says which machine has it and the command that reads it there`, async () => {
      const r = await ep0ch(args);
      expect(r.code).not.toBe(0);
      expect(made("garden")).toBe(false);
      expect(r.err).toContain("no outline garden");
      expect(r.err).toContain("Nothing was created");
      expect(r.err).toContain("far-box has it");
      expect(r.err).toContain(`ep0ch ${[...args, "--machine", "far-box"].join(" ")}`);
      expect(r.err).not.toContain("ep0ch init");  // init would make the empty outline the reader was told not to
    }, 60_000);
  }

  test("a name no machine has says so, and the command that makes one on purpose", async () => {
    const r = await ep0ch(["show", "--ws", "nowhere", "abc12345"]);
    expect(r.code).not.toBe(0);
    expect(made("nowhere")).toBe(false);
    expect(r.err).toContain("no machine I know of has an outline nowhere");
    expect(r.err).toContain("ep0ch outline create nowhere");
    expect(r.err).toContain("ep0ch outline list --all");
  }, 60_000);

  test("the other way: a read aimed at a machine that lacks it, when this machine has it, offers --here (which reads accept)", async () => {
    await local.create("seedbed");
    const r = await ep0ch(["find", "--ws", "seedbed", "--machine", "far-box", "--lines"]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("this machine has it:");
    expect(r.err).toContain("ep0ch find --ws seedbed --lines --here");
    expect((await ep0ch(["find", "--ws", "seedbed", "--lines", "--here"])).code).toBe(0);
  }, 60_000);

  test("under EP0CH_SOCKET the remote command unsets it (a socket and a machine can't both name the host)", async () => {
    const r = await ep0ch(["show", "--ws", "garden", "abc12345"], { EP0CH_SOCKET: local.sock });
    expect(r.err).toContain("env -u EP0CH_SOCKET ep0ch show --ws garden abc12345 --machine far-box");
  }, 60_000);

  test("with no host answering here, a forward still says where the outline is", async () => {
    await local.stop();
    try {
      const r = await ep0ch(["show", "--ws", "garden", "abc12345"]);
      expect(r.code).not.toBe(0);
      expect(r.err).toContain("far-box has it:");
      expect(r.err).toContain("ep0ch show --ws garden abc12345 --machine far-box");
    } finally { await local.start(); }
  }, 60_000);

  test("and the same read with --machine reads it there", async () => {
    const r = await ep0ch(["find", "--ws", "garden", "--machine", "far-box", "--lines"]);
    expect(r.code).toBe(0);
  }, 60_000);
});

describe("what still creates", () => {
  test("opening by name (outline attach) and outline create make the outline on this machine", async () => {
    expect((await ep0ch(["outline", "attach", "tulips", "--json"])).code).toBe(0);
    expect(made("tulips")).toBe(true);
    expect((await ep0ch(["outline", "create", "bulbs"])).code).toBe(0);
    expect(made("bulbs")).toBe(true);
  }, 60_000);
});
