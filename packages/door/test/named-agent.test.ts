import { afterAll, expect, test } from "bun:test";
import { ScratchCore } from "./scratch-hc";
import { mkdirSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { setupCommand } from "../src/setup/apply";

const core = new ScratchCore();
afterAll(() => core.dispose());

test("agent start makes one kept named terminal without a door, with its outline and persona", async () => {
  const started = await core.ep0ch("agent", "start", "fern");
  expect(started.err).toBe("");
  expect(started.code).toBe(0);
  const first = JSON.parse((await core.hc("get", "fern")).out);
  expect(first).toMatchObject({ name: "fern", state: "live", keep: true, parent: null, labels: { "ep0ch.outline": "garden", "ep0ch.persona": "fern" } });
  expect((await core.ep0ch("agent", "start", "fern")).code).toBe(0);
  expect(JSON.parse((await core.hc("get", "fern")).out).address).toBe(first.address);
  await core.hc("send", "fern", "quit");
  await core.hc("wait", "fern");
  expect(JSON.parse((await core.hc("get", "fern")).out).exit_code).toBe(7);
}, 20_000);

test("install brings this machine's finished named agent back through its launch line", async () => {
  const bin = join(core.dir, "bin"), packages = join(core.dir, "packages");
  mkdirSync(bin);
  mkdirSync(join(packages, "door"), { recursive: true });
  symlinkSync(Bun.which("hc")!, join(bin, "hc"));
  symlinkSync(process.execPath, join(bin, "bun"));
  symlinkSync(resolve(import.meta.dir, "../scripts"), join(packages, "door/scripts"));
  symlinkSync(resolve(import.meta.dir, "../../outliner"), join(packages, "outliner"));
  const lines: string[] = [];
  const env = { ...core.env, PATH: `${bin}:/usr/bin:/bin` };
  expect(await setupCommand(["install", "--apply", "--json"], {
    repoRoot: core.dir, cwd: core.dir, env, out: s => lines.push(s), err: s => lines.push(s),
  })).toBe(0);
  expect(JSON.parse((await core.hc("get", "fern")).out)).toMatchObject({ name: "fern", state: "live", keep: true });
}, 60_000);
