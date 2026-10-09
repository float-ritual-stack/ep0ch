// scripts/agent-env (PIE-597): an agent's own door settings, and its runs go first when memory runs out. float-2's
// outline host was once killed by the kernel during an agent's whole-suite run: every run started through agent-env
// has oom_score_adj 1000, inherited by what it starts, and a --test run is capped (MemoryMax) in a systemd user scope.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "../../../scripts/agent-env");
const root = mkdtempSync(join(tmpdir(), "agent-env-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const run = (...args: string[]) => {
  const r = Bun.spawnSync([script, "probe", ...args], { env: { ...process.env, EP0CH_AGENT_ROOT: root, EP0CH_LANDING: "welcome" }, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};
// Only a process with a lower score can show the raise: under agent-env (or box-test's fork, at 0, it can) the test
// process may already be at 1000, and the probe would pass without the script doing anything.
const procs = existsSync("/proc/self/oom_score_adj") && Number(readFileSync("/proc/self/oom_score_adj", "utf8")) < 1000;
const scopes = Bun.spawnSync(["sh", "-c", "command -v systemd-run >/dev/null && systemctl --user is-system-running"], { stdout: "pipe", stderr: "pipe" }).exitCode === 0;

describe("scripts/agent-env", () => {
  test("its own settings, none of the person's, the command's arguments, stdin and exit code", () => {
    const echo = Bun.spawnSync([script, "probe", "--test", "--", "sh", "-c", 'printf "%s|" "$@"; cat', "sh", "a b", "", "$HOME", "*"],
      { env: { ...process.env, EP0CH_AGENT_ROOT: root }, stdin: Buffer.from("typed"), stdout: "pipe" });
    expect(echo.stdout.toString()).toBe("a b||$HOME|*|typed");
    const r = run("--", "sh", "-c", 'echo "$EP0CH_STATE|$EP0CH_CONTROL|$EP0CH_OUTLINES|$TMPDIR|${EP0CH_LANDING-unset}|$EP0CH_DAEMON"; exit 7');
    expect(r.code).toBe(7);
    const d = join(root, "probe");
    const uid = process.getuid?.() ?? 0;
    expect(r.out.trim()).toBe(`${d}/state|${d}/control.sock|${d}/outlines|/tmp/ep0ch-agent-${uid}/probe|unset|0`);
  });

  test("its XDG folders are its own: the backup settings file is not the person's, and their restic and Litestream settings are gone (PIE-634)", () => {
    const home = join(root, "owner");
    mkdirSync(join(home, ".config/ep0ch"), { recursive: true });
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local/share"), XDG_STATE_HOME: join(home, ".local/state"), XDG_CACHE_HOME: join(home, ".cache"),
      RESTIC_PASSWORD: "owner-secret", RESTIC_REPOSITORY: "s3:owner", LITESTREAM_ACCESS_KEY_ID: "owner-key", AWS_SECRET_ACCESS_KEY: "owner-aws", EP0CH_AGENT_ROOT: root };
    const r = Bun.spawnSync([script, "xdg", "--", "sh", "-c", 'echo "$XDG_CONFIG_HOME $XDG_DATA_HOME $XDG_STATE_HOME $XDG_CACHE_HOME"; echo "[${RESTIC_PASSWORD-}${RESTIC_REPOSITORY-}${LITESTREAM_ACCESS_KEY_ID-}${AWS_SECRET_ACCESS_KEY-}]"; echo "$AWS_SHARED_CREDENTIALS_FILE $AWS_CONFIG_FILE"'], { env, stdout: "pipe", stderr: "pipe" });
    const [dirs, secrets, aws] = r.stdout.toString().trim().split("\n");
    const d = join(root, "xdg");
    expect(dirs).toBe(`${d}/xdg/config ${d}/xdg/data ${d}/xdg/state ${d}/xdg/cache`);
    expect(secrets).toBe("[]");
    // AWS tools read ~/.aws whatever XDG says: they're pointed at files of its own.
    expect(aws).toBe(`${d}/xdg/config/aws-credentials ${d}/xdg/config/aws-config`);
    // The same settings an agent's printed export lines give: nothing of the person's, the private folders.
    const printed = Bun.spawnSync([script, "xdg", "--print"], { env, stdout: "pipe" }).stdout.toString();
    expect(printed).toContain(`export XDG_CONFIG_HOME=${d}/xdg/config`);
    for (const v of ["RESTIC_PASSWORD", "RESTIC_REPOSITORY", "LITESTREAM_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) expect(printed).toContain(`unset ${v}`);
    expect(printed).not.toContain(home);
  });

  // PIE-736: a --test run once printed the person's real XDG folders and so read their ~/.config/ep0ch/mcp.env and backup.env.
  // Both forms are built from one settings list in the script; this holds them to the same environment and shows the
  // person's config file out of sight of the --test one.
  test("a --test run sees the same private XDG folders as the plain form, and none of the person's ~/.config/ep0ch", () => {
    const home = join(root, "owner-test");
    mkdirSync(join(home, ".config/ep0ch"), { recursive: true });
    writeFileSync(join(home, ".config/ep0ch/mcp.env"), "EP0CH_MCP_PERSONAS=claude-code@float-2=loki\n");
    writeFileSync(join(home, ".config/ep0ch/backup.env"), "RESTIC_REPOSITORY=s3:owner\n");
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local/share"), XDG_STATE_HOME: join(home, ".local/state"), XDG_CACHE_HOME: join(home, ".cache"),
      RESTIC_PASSWORD: "owner-secret", EP0CH_AGENT_ROOT: root };
    const probe = ['env | grep -E "^(XDG_(CONFIG|DATA|STATE|CACHE)_HOME|AWS_[A-Z_]*FILE|RESTIC_[A-Z_]*|EP0CH_[A-Z_]*)=" | sort',
      'ls "$XDG_CONFIG_HOME/ep0ch" 2>&1 | head -1; echo "config:$XDG_CONFIG_HOME"'].join("; ");
    const seen = (...flags: string[]) => Bun.spawnSync([script, "xdgtest", ...flags, "--", "sh", "-c", probe], { env, stdout: "pipe", stderr: "pipe" }).stdout.toString();
    const plain = seen(), tested = seen("--test");
    expect(tested).toBe(plain);
    const d = join(root, "xdgtest", "xdg");
    expect(tested).toContain(`XDG_CONFIG_HOME=${d}/config`);
    expect(tested).toContain(`XDG_STATE_HOME=${d}/state`);
    expect(tested).not.toContain(home);
    expect(tested).not.toContain("RESTIC");
    // The person's files are not where this run looks.
    expect(existsSync(join(d, "config/ep0ch/mcp.env"))).toBe(false);
    expect(existsSync(join(d, "config/ep0ch/backup.env"))).toBe(false);
  });

  test("its temp folder is outside the home folder: a scratch folder there has no ~/.ep0ch above it", () => {
    const home = join(root, "home");
    const r = Bun.spawnSync([script, "probe", "--", "sh", "-c", 'echo "$TMPDIR"'], { env: { ...process.env, HOME: home, EP0CH_AGENT_ROOT: join(home, ".agent-env"), EP0CH_AGENT_TMP: join(root, "tmp") }, stdout: "pipe" });
    const tmp = r.stdout.toString().trim();
    expect(tmp).toBe(join(root, "tmp", `ep0ch-agent-${process.getuid?.() ?? 0}`, "probe"));
    expect(tmp.startsWith(`${home}/`)).toBe(false);
    // A folder planted in its place (a symlink to somewhere of the person's) is refused, and nothing is run.
    const planted = join(root, "planted");
    mkdirSync(join(planted, "target"), { recursive: true });
    symlinkSync(join(planted, "target"), join(planted, `ep0ch-agent-${process.getuid?.() ?? 0}`));
    const refused = Bun.spawnSync([script, "probe", "--", "sh", "-c", "echo ran"], { env: { ...process.env, EP0CH_AGENT_ROOT: root, EP0CH_AGENT_TMP: planted }, stdout: "pipe", stderr: "pipe" });
    expect(refused.exitCode).toBe(2);
    expect(refused.stdout.toString()).not.toContain("ran");
    expect(refused.stderr.toString()).toContain("is a symlink");
  });

  // Test files that once passed alone but failed under agent-env: the outliner's (scratch folders under $HOME found the
  // person's ~/.ep0ch, #260) and the agent interface's (its deeper TMPDIR wrapped a terminal tile's echo of the control
  // socket's path). Run through it here, each must pass as it does alone.
  test("test files that once failed only under agent-env pass under it", () => {
    const repo = join(import.meta.dir, "../../..");
    for (const [pkg, file] of [["door", "test/agent-interface.test.ts"], ["outliner", "test/outline-host-clients.test.ts"]] as const) {
      const r = Bun.spawnSync([script, "regress", "--", process.execPath, "test", `./${file}`],
        { cwd: join(repo, "packages", pkg), env: { ...process.env, EP0CH_AGENT_ROOT: root }, stdout: "pipe", stderr: "pipe", timeout: 240_000 });
      const out = r.stderr.toString().replace(/\x1b\[[0-9;]*m/g, "");
      // Ran, not skipped: some passed, none skipped or failed (but the door's nvim tile test, on a machine with no nvim).
      const count = (what: string) => Number(new RegExp(`^\\s*(\\d+) ${what}$`, "m").exec(out)?.[1] ?? 0);
      expect({ file, code: r.exitCode, passed: count("pass") > 0, skipped: count("skip"), failed: out.split("\n").filter(l => /^(✗|\(fail\))/.test(l)) })
        .toEqual({ file, code: 0, passed: true, skipped: pkg === "door" && !(process.env.EP0CH_TEST_NVIM || Bun.which("nvim")) ? 1 : 0, failed: [] });
    }
  }, 300_000);

  test.skipIf(!procs)("a run, and what it starts, are the first the kernel kills: oom_score_adj 1000", () => {
    expect(run("--", "sh", "-c", "cat /proc/self/oom_score_adj; sh -c 'cat /proc/self/oom_score_adj'").out.trim().split("\n")).toEqual(["1000", "1000"]);
    expect(run("--test", "--", "cat", "/proc/self/oom_score_adj").out.trim()).toBe("1000");
  });

  test.skipIf(!scopes)("a --test run is in a scope of its own, capped at EP0CH_TEST_MEM", () => {
    const r = Bun.spawnSync([script, "probe", "--test", "--", "sh", "-c", 'cat "/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)/memory.max"; cut -d: -f3 /proc/self/cgroup'],
      { env: { ...process.env, EP0CH_AGENT_ROOT: root, EP0CH_TEST_MEM: "512M" }, stdout: "pipe" });
    const [max, cgroup] = r.stdout.toString().trim().split("\n");
    expect(max).toBe(String(512 * 1024 * 1024));
    expect(cgroup).toMatch(/agent-env-probe-\d+\.scope$/);
  });
});
