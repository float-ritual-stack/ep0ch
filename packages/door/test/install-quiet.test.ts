// `ep0ch install --apply` restarts the outline host only when the host's own code changed (PIE-1397), and hands a door
// session over only when the door's code did (PIE-1400), end to end on a scratch machine: a copy of this repo as the
// checkout, its scratch origin two commits ahead (the first touches only docs and the Claude mod, the second the
// outliner and the door), a scratch HOME whose systemd user unit runs the outline host from it (a fake `systemctl` on
// PATH starts and stops it) and a door session on it. The journey: an install to the docs commit keeps the host's and
// the session's pids and says "host unchanged: no restart" and "session unchanged: no handover"; the next install, to
// the code commit, restarts the host and hands the session over. Linux only (the fake is
// systemd's). Nothing here touches a real outline, unit, door or checkout: every path is under the scratch folder, and
// the environment is written out whole.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { hostLive } from "../src/discover";
import { hostRequest } from "../src/socket";
import { ownScratch, stopUnder, until, wholeEnv } from "./scratch";

const linux = process.platform === "linux";
const top = resolve(import.meta.dir, "../../..");
const root = mkdtempSync(join(tmpdir(), "ep0ch-iq-"));
// Its host leaves this process's tree (setsid, as systemd's would): this test owns it (PIE-1360).
ownScratch(root);
const repo = join(root, "repo"), origin = join(root, "origin.git"), home = join(root, "home"), outlines = join(root, "outlines");
const state = join(root, "state"), bin = join(root, "bin"), units = join(root, "units");
const bun = process.execPath;
const sock = join(outlines, ".host", "host.sock");
const UNIT = "outliner-host.service";

const env: Record<string, string> = wholeEnv({
  HOME: home, PATH: [bin, dirname(bun), "/usr/bin", "/bin"].join(":"), EP0CH_OUTLINES: outlines, EP0CH_STATE: state,
  EP0CH_WS: "allotment", EP0CH_AGENT: "wren", EP0CH_MACHINE_NAME: "garden-host",
  XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(home, ".local/state"), TMPDIR: tmpdir(), LANG: "C.UTF-8",
  GIT_AUTHOR_NAME: "Wren", GIT_AUTHOR_EMAIL: "wren@example.com", GIT_COMMITTER_NAME: "Wren", GIT_COMMITTER_EMAIL: "wren@example.com",
});

const sh = (cmd: string[], cwd = root, ms = 120_000) => {
  const r = Bun.spawnSync(cmd, { cwd, env, stdout: "pipe", stderr: "pipe", timeout: ms });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: exit ${r.exitCode}\n${r.stderr}`);
  return r.stdout.toString().trim();
};
const git = (...args: string[]) => sh(["git", "-C", repo, ...args]);
const ep0ch = async (...args: string[]) => {
  const p = Bun.spawn([bun, join(repo, "packages/door/src/main.ts"), ...args], { cwd: home, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
};
const hostPid = () => Number(readFileSync(join(units, `${UNIT}.pid`), "utf8"));
type Report = { ok: boolean; steps: { id: string; status: string; why?: string; done?: string[]; error?: string }[] };
const install = async (...args: string[]): Promise<Report> => {
  const r = await ep0ch("install", "--apply", "--json", ...args);
  const report = JSON.parse(r.out) as Report;
  expect({ code: r.code, ok: report.ok, err: report.steps.find(s => s.error)?.error }).toEqual({ code: 0, ok: true, err: undefined });
  return report;
};

let oldHead = "", docsHead = "", codeHead = "";

beforeAll(async () => {
  if (!linux) return;
  for (const d of [home, outlines, state, bin, units, join(home, ".config/systemd/user")]) mkdirSync(d, { recursive: true, mode: 0o700 });
  // The checkout: this repo's files as they are now (committed or not), one commit; its origin two ahead.
  const files = sh(["git", "-C", top, "ls-files", "-co", "--exclude-standard", "--deduplicate"]).split("\n").filter(f => f && existsSync(join(top, f)));
  writeFileSync(join(root, "files"), files.join("\n"));
  mkdirSync(repo);
  sh(["tar", "-C", top, "-cf", join(root, "repo.tar"), "-T", join(root, "files")]);
  sh(["tar", "-C", repo, "-xf", join(root, "repo.tar")]);
  sh(["git", "init", "-q", "-b", "main", repo]);
  git("add", "-A"); git("commit", "-qm", "the garden as it was");
  oldHead = git("rev-parse", "HEAD");
  sh(["git", "clone", "-q", "--bare", repo, origin]);
  git("remote", "add", "origin", origin); git("fetch", "-q", "origin"); git("branch", "-q", "--set-upstream-to=origin/main", "main");
  // A merge the host doesn't run: the readme, an agent's runbook, the Claude mod, an outliner test.
  appendFileSync(join(repo, "README.md"), "\nThe allotment opens at dawn.\n");
  appendFileSync(join(repo, "AGENTS.md"), "\nWater the seed trays first.\n");
  for (const f of files.filter(f => /^packages\/claude-mod\/.+\.ts$/.test(f)).slice(0, 1)) appendFileSync(join(repo, f), "\n// trellis\n");
  appendFileSync(join(repo, "packages/outliner/test/scratch-outline.ts"), "\n// trellis\n");
  git("add", "-A"); git("commit", "-qm", "docs: dawn");
  docsHead = git("rev-parse", "HEAD");
  // One it does: the outliner's own code, and the door's.
  appendFileSync(join(repo, "packages/outliner/src/host-main.ts"), "\n// the gate is oiled\n");
  appendFileSync(join(repo, "packages/door/src/session/start.ts"), "\n// the gate is oiled\n");
  git("add", "-A"); git("commit", "-qm", "outliner: the gate");
  codeHead = git("rev-parse", "HEAD");
  git("push", "-q", "origin", "main"); git("reset", "-q", "--hard", oldHead);
  sh([bun, "install", "--frozen-lockfile"], repo, 300_000);

  // The host's unit, and a systemctl that runs it: start, stop (waiting for it to go), restart, show.
  writeFileSync(join(home, `.config/systemd/user/${UNIT}`),
    `[Service]\nWorkingDirectory=${repo}/packages/outliner\nEnvironment=EP0CH_OUTLINES=${outlines}\nExecStart=${bun} ${repo}/packages/outliner/src/host-main.ts\nRestart=always\n`);
  writeFileSync(join(bin, "systemctl"), `#!/bin/sh
[ "$1" = --user ] && shift
verb=$1; name=$2; pidf='${units}'/$name.pid
alive() { [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null; }
case "$verb" in
  daemon-reload|enable|is-enabled) exit 0 ;;
  is-active) alive && exit 0; exit 3 ;;
  start) [ "$name" = ${UNIT} ] || exit 1
    alive || { cd '${repo}/packages/outliner' && EP0CH_OUTLINES='${outlines}' setsid '${bun}' src/host-main.ts >>'${units}'/host.log 2>&1 </dev/null & echo $! >"$pidf"; } ;;
  stop) if alive; then p=$(cat "$pidf"); kill "$p"; while kill -0 "$p" 2>/dev/null; do sleep 0.1; done; fi; rm -f "$pidf" ;;
  restart) "$0" --user stop "$name" && "$0" --user start "$name" ;;
  show) if alive; then printf 'ActiveState=active\\nSubState=running\\nMainPID=%s\\n' "$(cat "$pidf")"; else printf 'ActiveState=inactive\\nSubState=dead\\nMainPID=0\\n'; fi; echo ExecMainStatus=0 ;;
  *) exit 1 ;;
esac
`);
  chmodSync(join(bin, "systemctl"), 0o755);
  // The host starts after the checkout's last move (the reflog's times are whole seconds): it runs oldHead.
  await Bun.sleep(1100);
  sh([join(bin, "systemctl"), "--user", "start", UNIT]);
  await until(() => existsSync(sock), "the scratch host's socket", 20_000);
  for (let i = 0; !(await hostLive(sock, 1000)); i++) { if (i > 100) throw new Error("the scratch host didn't answer"); await Bun.sleep(100); }
  await hostRequest(sock, "outlines.create", { name: "allotment" });

  // A door session on allotment, on the old code: started the way `ep0ch` starts one, from the checkout's own modules.
  const starter = join(root, "start-session.ts");
  writeFileSync(starter, `import { startSession } from "${repo}/packages/door/src/session/start";
import { placeFor, type Place } from "${repo}/packages/door/src/session/place";
const r = await startSession((placeFor([]) as Place).dir, []);
console.log(JSON.stringify(r));
process.exit(r.ok ? 0 : 1);
`);
  const started = Bun.spawnSync([bun, starter], { cwd: home, env: { ...env, EP0CH_DAILY_AGENT: "sh" }, stdout: "pipe", stderr: "pipe", timeout: 60_000 });
  if (started.exitCode !== 0) throw new Error(`the session didn't start: ${started.stdout}${started.stderr}`);
}, 600_000);

const sessionPid = async () => (JSON.parse((await ep0ch("session", "list", "--json")).out) as { pid: number }[])[0]?.pid ?? 0;

afterAll(async () => {
  if (linux) { await ep0ch("session", "end", "--all", "--yes").catch(() => undefined); try { sh([join(bin, "systemctl"), "--user", "stop", UNIT]); } catch { /* gone */ } stopUnder(root); }
  rmSync(root, { recursive: true, force: true });
}, 60_000);

describe.skipIf(!linux)("ep0ch install restarts the host and hands a session over only when their code changed (PIE-1397, PIE-1400)", () => {
  test("a docs-only update keeps the host's and the session's pids and says so; a code change restarts and hands over", async () => {
    const pid = hostPid(), session = await sessionPid();
    expect(session).toBeGreaterThan(0);

    // The dry run already says it.
    const plan = await ep0ch("install", "--sha", docsHead);
    expect(plan.code).toBe(0);
    expect(plan.out).toContain("host unchanged: no restart");
    expect(plan.out).toContain("session unchanged: no handover");

    // Docs, the Claude mod and an outliner test: the checkout moves, the host keeps running on the same process.
    const docs = await install("--sha", docsHead);
    expect(docs.steps.find(s => s.id === "repo")!.done!.join(" ")).toContain(`→ ${docsHead.slice(0, 7)}`);
    expect(docs.steps.find(s => s.id === "host")).toMatchObject({ status: "skip", why: expect.stringContaining(`host unchanged: no restart (${oldHead.slice(0, 7)} → ${docsHead.slice(0, 7)}`) });
    expect(git("rev-parse", "HEAD")).toBe(docsHead);
    expect(hostPid()).toBe(pid);
    expect(await hostRequest(sock, "ping", { outline: "allotment" })).toMatchObject({ protocolVersion: expect.any(Number) });
    expect(docs.steps.find(s => s.id === "session")).toMatchObject({ status: "skip", why: expect.stringContaining(`session unchanged: no handover (${oldHead.slice(0, 7)} → ${docsHead.slice(0, 7)}`) });
    expect(await sessionPid()).toBe(session);

    // The outliner's own code: restarted, from the commit the host still runs, naming the file. Backups are named to
    // the second, so the second install waits for the next one (on a fast box both landed in one second and the backup
    // refused to overwrite).
    await Bun.sleep(1100);
    const code = await install();
    const host = code.steps.find(s => s.id === "host")!;
    expect(host.status).toBe("do");
    expect(host.why).toContain(`1 file it runs changed from ${oldHead.slice(0, 7)} to ${codeHead.slice(0, 7)} (packages/outliner/src/host-main.ts)`);
    expect(hostPid()).not.toBe(pid);
    expect(await hostRequest(sock, "ping", { outline: "allotment" })).toMatchObject({ protocolVersion: expect.any(Number) });
    // The door's code moved under the session (start.ts, host-main.ts): a new daemon takes it over.
    const handed = code.steps.find(s => s.id === "session")!;
    expect(handed.status).toBe("do");
    expect(await sessionPid()).not.toBe(session);
  }, 600_000);
});
