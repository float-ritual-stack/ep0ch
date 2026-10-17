// scripts/box-test enforces its own limits on float-box (PIE-998): one run per worktree, a cap on concurrent runs, and
// nothing a run started outlives it. The "other machine" is this one, behind a stand-in for ssh; the origin and the
// worktrees are a made-up repository whose one package's `test` script is a stub (a long sleep, plus a daemon that
// leaves the run's process group), so nothing of the real suites runs and nothing of float-box is touched.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

const real = join(import.meta.dir, "../../../scripts");
const root = mkdtempSync(join(tmpdir(), "box-limits-"));
const out = join(root, "out"), locks = join(root, "locks");
const sh = (cwd: string, ...argv: string[]) => {
  const r = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${argv.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (what: string, ok: () => boolean, ms = 30_000) => {
  for (const end = Date.now() + ms; Date.now() < end;) { if (ok()) return; await Bun.sleep(100); }
  throw new Error(`timed out waiting for ${what}`);
};
const lines = (file: string) => existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
const pids = (file: string) => lines(file).map(Number);

let origin = "";
const worktrees: string[] = [];
const runs: ReturnType<typeof Bun.spawn>[] = [];
const runDirs = () => Bun.spawnSync(["sh", "-c", `ls -d /tmp/ep0ch-box-${userInfo().username}-???????? 2>/dev/null`]).stdout.toString().split("\n").filter(Boolean);

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
function box(dir: string, tag: string, ...flags: string[]) {
  const p = Bun.spawn([join(dir, "scripts/box-test"), "--on", "float-box", ...flags, "outline-core"], {
    cwd: dir, stdout: "pipe", stderr: "pipe",
    env: {
      ...process.env, EP0CH_BOX_SSH: join(root, "ssh"), EP0CH_BOX_REPO: origin, EP0CH_BOX_LOCKS: locks, EP0CH_BOX_SLOTS: "2",
      XDG_STATE_HOME: join(root, "state"), FIX_OUT: out, FIX_TAG: tag,
    },
  });
  runs.push(p);
  const text = { err: "" };
  (async () => { for await (const c of p.stderr as unknown as AsyncIterable<Uint8Array>) text.err += new TextDecoder().decode(c); })();
  (async () => { for await (const _ of p.stdout as unknown as AsyncIterable<Uint8Array>) { /* drained */ } })();
  return { p, text, started: () => lines(join(out, `${tag}.started`)).length > 0, daemons: () => pids(join(out, `${tag}.daemons`)), go: () => writeFileSync(join(out, `${tag}.go`), "") };
}

beforeAll(() => {
  mkdirSync(out, { recursive: true });
  // The stand-in for ssh: skip its options and the host, run the command here (stdin and stderr pass through).
  writeFileSync(join(root, "ssh"), `#!/usr/bin/env bash\nwhile [ $# -gt 0 ]; do case $1 in -o) shift 2;; -*) shift;; *) break;; esac; done\nshift\nexec bash -c "$*"\n`);
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
    const dirsWhileRunning = runDirs().length;
    const second = box(wt, "a2");
    expect(await second.p.exited).toBe(3);
    expect(second.text.err).toContain("REFUSED");
    expect(second.text.err).toMatch(/already has a run: pid \d+, commit [0-9a-f]{12}, running for/);
    expect(second.text.err).toContain("scripts/box-test --replace");
    expect(first.p.exitCode).toBeNull();

    const third = box(wt, "a3", "--replace");
    await until("the replacing run to start", third.started, 60_000);
    expect(await first.p.exited).not.toBe(0);
    expect(third.text.err).toContain("--replace: stopping the run");
    // The first run's daemon went with it, and its run dir.
    await until("the first run's daemon to die", () => first.daemons().every(pid => !alive(pid)), 10_000);
    expect(runDirs().length).toBe(dirsWhileRunning);
    third.go();
    expect(await third.p.exited).toBe(0);
    await until("the last daemon to die", () => third.daemons().every(pid => !alive(pid)), 10_000);
  }, 120_000);

  test("three worktrees with two slots: the third waits, says so, and starts when one finishes", async () => {
    const a = box(worktree("wt-b1"), "b1"), b = box(worktree("wt-b2"), "b2");
    await until("two runs to start", () => a.started() && b.started());
    const c = box(worktree("wt-b3"), "b3");
    await until("the third to say it waits", () => c.text.err.includes("waiting for a slot: 2 run(s) ahead"), 30_000);
    expect(c.started()).toBe(false);
    a.go();
    expect(await a.p.exited).toBe(0);
    await until("the third to start", c.started, 30_000);
    expect(c.text.err).toContain("got slot");
    b.go(); c.go();
    expect(await b.p.exited).toBe(0);
    expect(await c.p.exited).toBe(0);
  }, 120_000);

  test("a killed run leaves nothing: its group, its daemon outside the group and its dir are gone", async () => {
    const r = box(worktree("wt-c"), "c1");
    await until("the run to start", r.started);
    await until("its daemon", () => r.daemons().length > 0);
    const mine = new Set(runDirs());
    r.p.kill("SIGTERM");
    await r.p.exited;
    await until("the daemon to die", () => r.daemons().every(pid => !alive(pid)), 20_000);
    await until("the run dir to go", () => runDirs().length < mine.size, 20_000);
    expect(r.text.err).not.toContain("LEAK");
  }, 90_000);

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
  }, 90_000);
});
