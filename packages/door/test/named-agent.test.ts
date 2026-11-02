import { afterAll, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { setupCommand } from "../src/setup/apply";
import { join, resolve } from "node:path";
import { seeNamed } from "../src/desk/named-agent";
import { ScratchCore } from "./scratch-hc";

const cores: ScratchCore[] = [];
afterAll(async () => { for (const core of cores) await core.dispose(); });
const scratch = () => { const core = new ScratchCore(); cores.push(core); return core; };

test("the named CLI keeps its configured program and outline when --cwd overrides its row", async () => {
  const core = scratch();
  const r = await core.ep0ch("agent", "start", "fern", "--cwd", join(core.dir, "plot"));
  expect(r.code, r.err).toBe(0);
  const t = JSON.parse((await core.hc("get", "fern")).out);
  expect(t.cwd).toBe(join(core.dir, "plot"));
  expect(t.labels).toMatchObject({ "ep0ch.outline": "garden", "ep0ch.persona": "fern" });
  expect(t.keep).toBe(true);
  expect(t.parent).toBeNull();
  expect((await core.hc("wait", "fern", "--timeout", "5")).code).toBe(0);
  const read = await core.hc("read", "fern");
  expect(read.out).toContain("Fern ready: garden / fern / fern");
  expect(read.out).toContain("Door binding: unbound");
  expect((await core.ep0ch("agent", "start", "fern")).code).toBe(0);
  expect(JSON.parse((await core.hc("get", "fern")).out).address).toBe(t.address);
  await core.hc("send", "fern", "quit");
  await core.hc("wait", "fern", "--timeout", "5");
  const look = await seeNamed({ persona: "fern", folder: core.dir, machine: "", program: `/bin/sh ${join(core.dir, "fern.sh")}`, outline: "garden" }, core.env);
  expect(look.kind).toBe("ended");
  if (look.kind === "ended") {
    expect(look.exit).toBe(7);
    expect(look.lines.join("\n")).toContain("Fern finished the garden plan");
  }
}, 30_000);

test("install brings back declared local agents through the same launch owner", async () => {
  const core = scratch();
  mkdirSync(join(core.dir, "packages/door/scripts"), { recursive: true });
  copyFileSync(resolve(import.meta.dir, "../scripts/with-secrets"), join(core.dir, "packages/door/scripts/with-secrets"));
  const mod = join(core.dir, "packages/outliner/scripts");
  mkdirSync(mod, { recursive: true });
  writeFileSync(join(mod, "install-claude-mod.ts"), "process.exit(0);\n");
  const lines: string[] = [];
  const code = await setupCommand(["install", "--apply", "--json"], { repoRoot: core.dir, cwd: core.dir, env: core.env, out: s => lines.push(s), err: s => lines.push(s) });
  expect(code, lines.join("\n")).toBe(0);
  expect(lines.join("\n")).toContain("started fern");
  const r = await core.hc("get", "fern");
  expect(r.code, r.err).toBe(0);
  expect(JSON.parse(r.out).labels["ep0ch.outline"]).toBe("garden");
  await core.hc("wait", "fern", "--timeout", "5");
  await core.hc("send", "fern", "quit");
  await core.hc("wait", "fern", "--timeout", "5");
}, 30_000);
