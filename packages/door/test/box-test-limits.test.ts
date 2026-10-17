// scripts/box-test enforces its own limits on float-box (PIE-998): one run per worktree, a cap on concurrent runs, and
// nothing a run started outlives it. The "other machine" is this one, behind a stand-in for ssh; the origin and the
// worktrees are a made-up repository whose one package's `test` script is a stub (a long sleep, plus a daemon that
// leaves the run's process group), so nothing of the real suites runs and nothing of float-box is touched.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { codexPreToolUse } from "../../../.claude/skills/ep0ch-repo/hooks/whole-suite";

const real = join(import.meta.dir, "../../../scripts");
const root = mkdtempSync(join(tmpdir(), "box-limits-"));
const out = join(root, "out"), locks = join(root, "locks");
const sh = (cwd: string, ...argv: string[]) => {
  const r = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${argv.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (what: string, ok: () => boolean, ms = 120_000) => {
  for (const end = Date.now() + ms; Date.now() < end;) { if (ok()) return; await Bun.sleep(100); }
  throw new Error(`timed out waiting for ${what}${"\n" + [...texts].map(t => t.err).join("\n")}`);
};
const lines = (file: string) => existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
const pids = (file: string) => lines(file).map(Number);

let origin = "";
const worktrees: string[] = [];
const runs: ReturnType<typeof Bun.spawn>[] = [];
const texts = new Set<{ err: string }>();
/** The run dir a process of a run carries (its BOX_TEST_RUN_DIR), read while it lives. */
const runDirOf = (pid: number) => readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").find(kv => kv.startsWith("BOX_TEST_RUN_DIR="))?.slice(17) ?? "";

/** A worktree of the fixture repo, with the real scripts copied in (box-test finds its guard next to itself). */
function worktree(name: string) {
  const dir = join(root, name);
  sh(root, "git", "clone", "-q", origin, dir);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  for (const f of ["box-test", "box-test-guard"]) { writeFileSync(join(dir, "scripts", f), readFileSync(join(real, f))); chmodSync(join(dir, "scripts", f), 0o755); }
  worktrees.push(dir);
  return dir;
}

/** `box-test` from `dir`; the stub's marks go to out/<tag>.*, and it finishes when out/<tag>.go exists. */
function box(dir: string, tag: string, flags: string[] = [], env: Record<string, string> = {}) {
  const p = Bun.spawn([join(dir, "scripts/box-test"), "--on", "float-box", ...flags, "outline-core"], {
    cwd: dir, stdout: "pipe", stderr: "pipe",
    env: {
      ...process.env, EP0CH_BOX_SSH: join(root, "ssh"), EP0CH_BOX_REPO: origin, EP0CH_BOX_LOCKS: locks, EP0CH_BOX_SLOTS: "2",
      XDG_STATE_HOME: join(root, "state"), FIX_OUT: out, FIX_TAG: tag, FAKE_SSHD: join(root, "sshd-session"), ...env,
    },
  });
  runs.push(p);
  const text = { err: "" };
  texts.add(text);
  (async () => { for await (const c of p.stderr as unknown as AsyncIterable<Uint8Array>) text.err += new TextDecoder().decode(c); })();
  (async () => { for await (const _ of p.stdout as unknown as AsyncIterable<Uint8Array>) { /* drained */ } })();
  return { p, text, started: () => lines(join(out, `${tag}.started`)).length > 0, daemons: () => pids(join(out, `${tag}.daemons`)), go: () => writeFileSync(join(out, `${tag}.go`), "") };
}

beforeAll(() => {
  mkdirSync(out, { recursive: true });
  // The stand-in for ssh: skip its options and the host, run the command here (stdin and stderr pass through).
  writeFileSync(join(root, "ssh"), `#!/usr/bin/env bash\nwhile [ $# -gt 0 ]; do case $1 in -o) shift 2;; -*) shift;; *) break;; esac; done\nshift\nexec setsid -w "$FAKE_SSHD" -c "$*; exit \\$?"\n`);
  // The connection's process on the "server": a bash named like OpenSSH 9.8's session process, so the guard's watcher finds it.
  symlinkSync(Bun.which("bash")!, join(root, "sshd-session"));
  chmodSync(join(root, "ssh"), 0o755);
  const seed = join(root, "seed");
  mkdirSync(join(seed, "packages/outline-core"), { recursive: true });
  writeFileSync(join(seed, "package.json"), JSON.stringify({ name: "fixture", private: true, workspaces: ["packages/*"] }));
  writeFileSync(join(seed, "packages/outline-core/package.json"), JSON.stringify({ name: "fixture-core", version: "0.0.0", scripts: { check: "true", test: "sh ./t.sh" } }));
  // A run that has started: marks itself, leaves a daemon outside its process group, waits for its go file.
  writeFileSync(join(seed, "packages/outline-core/t.sh"), [
    "#!/bin/sh",
    'echo $$ >> "$FIX_OUT/$FIX_TAG.started"',
    `setsid sh -c 'echo $$ >> "$FIX_OUT/$FIX_TAG.daemons"; exec sleep 600' </dev/null >/dev/null 2>&1 &`,
    'while [ ! -e "$FIX_OUT/$FIX_TAG.go" ]; do sleep 0.2; done',
    '[ -z "$FIX_FAIL" ] || exit 1',
    "",
  ].join("\n"));
  sh(seed, "git", "init", "-q", "-b", "main");
  sh(seed, "bun", "install");
  sh(seed, "git", "add", "-A");
  sh(seed, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "fixture");
  origin = join(root, "origin.git");
  sh(root, "git", "clone", "-q", "--bare", seed, origin);
});

afterAll(() => {
  for (const p of runs) { try { p.kill("SIGTERM"); } catch { /* already gone */ } }
  Bun.spawnSync(["sh", "-c", `for f in ${out}/*.daemons; do [ -e "$f" ] && kill $(cat "$f") 2>/dev/null; done; true`]);
});

describe("scripts/box-test limits", () => {
  test("a second run from one worktree is refused with the running pid and how to stop it; --replace stops the first and takes over", async () => {
    const wt = worktree("wt-a");
    const first = box(wt, "a1");
    await until("the first run to start", first.started);
    const firstDir = runDirOf(first.daemons()[0]!);
    expect(existsSync(firstDir)).toBe(true);
    const second = box(wt, "a2");
    expect(await second.p.exited).toBe(3);
    expect(second.text.err).toContain("REFUSED");
    expect(second.text.err).toMatch(/already has a run: pid \d+, commit [0-9a-f]{12}, running for/);
    expect(second.text.err).toContain("scripts/box-test --replace");
    expect(first.p.exitCode).toBeNull();

    const third = box(wt, "a3", ["--replace"]);
    await until("the replacing run to start", third.started, 120_000);
    expect(await first.p.exited).not.toBe(0);
    expect(third.text.err).toContain("--replace: stopping the run");
    // The first run's daemon went with it, and its run dir.
    await until("the first run's daemon to die", () => first.daemons().every(pid => !alive(pid)), 120_000);
    await until("the first run dir to go", () => !existsSync(firstDir), 120_000);
    third.go();
    expect(await third.p.exited).toBe(0);
    await until("the last daemon to die", () => third.daemons().every(pid => !alive(pid)), 120_000);
  }, 360_000);

  test("three worktrees with two slots: the third waits, says so, and starts when one finishes", async () => {
    const a = box(worktree("wt-b1"), "b1"), b = box(worktree("wt-b2"), "b2");
    await until("two runs to start", () => a.started() && b.started());
    const c = box(worktree("wt-b3"), "b3");
    await until("the third to say it waits", () => c.text.err.includes("waiting for a slot: 2 run(s) ahead"), 120_000);
    expect(c.started()).toBe(false);
    a.go();
    expect(await a.p.exited).toBe(0);
    await until("the third to start", c.started, 120_000);
    expect(c.text.err).toContain("got slot");
    b.go(); c.go();
    expect(await b.p.exited).toBe(0);
    expect(await c.p.exited).toBe(0);
  }, 360_000);

  test("a killed run leaves nothing: its group, its daemon outside the group and its dir are gone", async () => {
    const r = box(worktree("wt-c"), "c1");
    await until("the run to start", r.started);
    await until("its daemon", () => r.daemons().length > 0);
    const dir = runDirOf(r.daemons()[0]!);
    r.p.kill("SIGTERM");
    await r.p.exited;
    await until("the daemon to die", () => r.daemons().every(pid => !alive(pid)), 90_000);
    await until("the run dir to go", () => !existsSync(dir), 90_000);
    expect(r.text.err).not.toContain("LEAK");
  }, 360_000);

  test("the ssh dying (its session process killed) stops the run, its daemon and its dir", async () => {
    const r = box(worktree("wt-e"), "e1");
    await until("the run to start", r.started);
    await until("its daemon", () => r.daemons().length > 0);
    const dir = runDirOf(r.daemons()[0]!);
    // The stand-in's session process is the one named sshd-session of this run; killing it is the connection dropping.
    const session = Number(Bun.spawnSync(["pgrep", "sshd-session"]).stdout.toString().split("\n").find(pid => pid && readFileSync(`/proc/${pid}/environ`, "utf8").includes("FIX_TAG=e1")));
    expect(session).toBeGreaterThan(1);
    process.kill(session, "SIGKILL");
    await until("the daemon to die", () => r.daemons().every(pid => !alive(pid)), 120_000);
    await until("the run dir to go", () => !existsSync(dir), 120_000);
    await r.p.exited;
  }, 360_000);

  test("the timeout stops the run, exit 124, nothing left", async () => {
    const r = box(worktree("wt-f"), "f1", [], { EP0CH_BOX_MAX: "90" });
    await until("the run to start", r.started);
    await until("its daemon", () => r.daemons().length > 0);
    const dir = runDirOf(r.daemons()[0]!);
    expect(await r.p.exited).toBe(124);
    expect(r.text.err).toContain("passed EP0CH_BOX_MAX");
    await until("the daemon to die", () => r.daemons().every(pid => !alive(pid)), 90_000);
    expect(existsSync(dir)).toBe(false);
  }, 360_000);

  test("a failing suite's exit code comes through, and a process that only names the run dir is left alone", async () => {
    const r = box(worktree("wt-g"), "g1", [], { FIX_FAIL: "1" });
    await until("the run to start", r.started);
    await until("its daemon", () => r.daemons().length > 0);
    // What `ssh` is to this machine when box-test runs on float-box itself: a process of the caller's with the dir in its command line.
    const decoy = Bun.spawn(["sh", "-c", "exec sleep 300", `${runDirOf(r.daemons()[0]!)}/guard.sh`]);
    r.go();
    expect(await r.p.exited).toBe(1);
    expect(r.text.err).not.toContain("LEAK");
    expect(alive(decoy.pid)).toBe(true);
    decoy.kill();
  }, 360_000);

  test("a sweep kills orphans of runs whose dir is gone, and says how many", async () => {
    const gone = `/tmp/ep0ch-box-${userInfo().username}-ZZZZZZZZ`;
    const pidFile = join(out, "orphan.pid");
    Bun.spawnSync(["sh", "-c", `(BOX_TEST_RUN_DIR=${gone} setsid sh -c 'echo $$ > ${pidFile}; exec sleep 600' </dev/null >/dev/null 2>&1 &) ; sleep 0.5`]);
    const [orphan] = pids(pidFile);
    expect(alive(orphan!)).toBe(true);
    const ppid = Number(readFileSync(`/proc/${orphan}/stat`, "utf8").replace(/^.*\) /, "").split(" ")[1]);
    const r = box(worktree("wt-d"), "d1");
    await until("the run to start", r.started);
    r.go();
    expect(await r.p.exited).toBe(0);
    // Orphans are those reparented to init or a systemd; under another subreaper there is nothing to sweep.
    if (ppid === 1 || readFileSync(`/proc/${ppid}/comm`, "utf8").trim() === "systemd") {
      expect(r.text.err).toMatch(/sweep: killed [1-9]\d* orphan/);
      await until("the orphan to die", () => !alive(orphan!), 5000);
    } else process.kill(orphan!, "SIGKILL");
  }, 360_000);
});

describe("the Codex hook", () => {
  const event = (command: string) => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });

  test("refuses a whole-suite bun test on the test machines with a Codex deny, and lets focused runs, other machines and junk through", () => {
    const deny = JSON.parse(codexPreToolUse(event("cd packages/door && bun --cwd . test --bail"), { hostname: "float-box" })!);
    expect(deny.hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
    expect(deny.hookSpecificOutput.permissionDecisionReason).toContain("scripts/box-test <package>");
    expect(codexPreToolUse(event("bun test --bail test/a.test.ts"), { hostname: "float-box" })).toBeNull();
    expect(codexPreToolUse(event("scripts/agent-env x --test -- bun test"), { hostname: "float-2" })).toBeNull();
    expect(codexPreToolUse(event("bun test"), { hostname: "laptop" })).toBeNull();
    expect(codexPreToolUse("not json", { hostname: "float-box" })).toBeNull();
  });

  test("the hook script itself prints the deny for the machine it runs on", async () => {
    const hook = join(import.meta.dir, "../../../.codex/hooks/box-test-only.ts");
    const p = Bun.spawn(["bun", hook], { stdin: new TextEncoder().encode(event("bun test")), stdout: "pipe" });
    const text = await new Response(p.stdout).text();
    expect(await p.exited).toBe(0);
    const shared = ["float-box", "float-2"].includes(require("node:os").hostname());
    expect(text.includes("permissionDecision")).toBe(shared);
  });
});
