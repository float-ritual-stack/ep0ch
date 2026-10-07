// `ep0ch install --apply` across a schema bump (PIE-617), end to end on a scratch machine: a copy of this repo as the
// checkout (one commit behind its scratch origin, whose commit bumps SCHEMA_VERSION and adds a migration script), a
// scratch HOME whose systemd user unit runs the outline host from it (a fake `systemctl` on PATH starts and stops the
// host itself), two outlines at the old schema and a door session on the old code. The journey: the plan shows the
// migration; apply backs up, fast-forwards, stops the host and migrates, and one outline's migration fails, so it
// stops with the outline, its backup and the recovery, and leaves the host stopped; once fixed, a rerun migrates what's
// left, starts the host and hands the session to the new code. Linux only (the fake is systemd's). Nothing here
// touches a real outline, unit, door or checkout: every path is under the scratch folder, and the environment is
// written out whole.
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { hostLive } from "../src/discover";
import { hostRequest } from "../src/socket";
import { until } from "./scratch";

const linux = process.platform === "linux";
const top = resolve(import.meta.dir, "../../..");
/** The checkout's schema version (the outliner's schema.ts, read as text: the door imports nothing else of it), and the bump the scratch origin makes. */
const N = Number(/^export const SCHEMA_VERSION = (\d+);/m.exec(readFileSync(join(top, "packages/outliner/src/schema.ts"), "utf8"))![1]);
const M = N + 1, STEP_FILE = `${String(M).padStart(4, "0")}-seed-trays.ts`;
const root = mkdtempSync(join(tmpdir(), "ep0ch-im-"));
const repo = join(root, "repo"), origin = join(root, "origin.git"), home = join(root, "home"), outlines = join(root, "outlines");
const state = join(root, "state"), bin = join(root, "bin"), units = join(root, "units");
const bun = process.execPath;
const sock = join(outlines, ".host", "host.sock");

/** The whole environment every command here runs with: nothing inherited, so nothing reaches the person's stack. */
const env: Record<string, string> = {
  HOME: home, PATH: [bin, dirname(bun), "/usr/bin", "/bin"].join(":"), EP0CH_OUTLINES: outlines, EP0CH_STATE: state,
  XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(home, ".local/state"), TMPDIR: join(root, "tmp"), LANG: "C.UTF-8",
  GIT_AUTHOR_NAME: "Wren", GIT_AUTHOR_EMAIL: "wren@example.com", GIT_COMMITTER_NAME: "Wren", GIT_COMMITTER_EMAIL: "wren@example.com",
};

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
const version = (name: string) => { const db = new Database(join(outlines, `${name}.sqlite`), { readonly: true }); try { return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version; } finally { db.close(); } };
const fakeSystemctl = (...args: string[]) => sh([join(bin, "systemctl"), "--user", ...args]);

/** A step N → N+1 the way a real one-off is written: refuses a served file, one transaction, and refuses what it can't take. */
const STEP = `import { Database } from "bun:sqlite";
import { acquireWorkspaceOwnership } from "../../src/workspace-ownership";
const path = process.argv[2]!;
const release = acquireWorkspaceOwnership(path);
const db = new Database(path, { readwrite: true, create: false });
try {
  const { user_version: v } = db.query("PRAGMA user_version").get() as { user_version: number };
  if (v !== ${N}) throw new Error(\`\${path} is schema \${v}, not ${N}\`);
  db.transaction(() => {
    db.exec("CREATE TABLE seed_trays (id TEXT PRIMARY KEY)");
    if (db.query("SELECT 1 FROM sqlite_master WHERE name = 'compost_heap'").get()) throw new Error(\`\${path} has a compost_heap table this step doesn't know\`);
    db.exec("PRAGMA user_version = ${M}");
  })();
} catch (e) { console.error((e as Error).message); process.exitCode = 1; }
finally { db.close(); release(); }
`;

let sessionPid = 0, oldHead = "", newHead = "";

beforeAll(async () => {
  if (!linux) return;
  for (const d of [home, outlines, state, bin, units, join(root, "tmp"), join(home, ".config/systemd/user")]) mkdirSync(d, { recursive: true, mode: 0o700 });
  // The checkout: this repo's files as they are now (committed or not), one commit; its origin one commit ahead.
  const files = sh(["git", "-C", top, "ls-files", "-co", "--exclude-standard", "--deduplicate"]).split("\n").filter(f => f && existsSync(join(top, f)));
  writeFileSync(join(root, "files"), files.join("\n"));
  mkdirSync(repo);
  sh(["sh", "-c", `tar -C '${top}' -cf - -T '${join(root, "files")}' | tar -C '${repo}' -xf -`]);
  sh(["git", "init", "-q", "-b", "main", repo]);
  git("add", "-A"); git("commit", "-qm", "the garden as it was");
  oldHead = git("rev-parse", "HEAD");
  sh(["git", "clone", "-q", "--bare", repo, origin]);
  git("remote", "add", "origin", origin); git("fetch", "-q", "origin"); git("branch", "-q", "--set-upstream-to=origin/main", "main");
  const schema = join(repo, "packages/outliner/src/schema.ts");
  writeFileSync(schema, readFileSync(schema, "utf8").replace(/^export const SCHEMA_VERSION = \d+;/m, `export const SCHEMA_VERSION = ${M};`));
  writeFileSync(join(repo, "packages/outliner/scripts/migrations", STEP_FILE), STEP);
  // An earlier step's script is deleted once used (AGENTS.md): what's left is this step's.
  for (const f of readdirSync(join(repo, "packages/outliner/scripts/migrations"))) if (f.startsWith(`${String(N).padStart(4, "0")}-`)) rmSync(join(repo, "packages/outliner/scripts/migrations", f));
  git("add", "-A"); git("commit", "-qm", `seed trays: schema ${M}`);
  newHead = git("rev-parse", "HEAD");
  git("push", "-q", "origin", "main"); git("reset", "-q", "--hard", oldHead);
  sh([bun, "install", "--frozen-lockfile"], repo, 300_000);

  // The host's unit, and a systemctl that runs it: start, stop (waiting for it to go), restart, show.
  writeFileSync(join(home, ".config/systemd/user/outliner-host.service"),
    `[Service]\nWorkingDirectory=${repo}/packages/outliner\nEnvironment=EP0CH_OUTLINES=${outlines}\nExecStart=${bun} ${repo}/packages/outliner/src/host-main.ts\nRestart=always\n`);
  writeFileSync(join(bin, "systemctl"), `#!/bin/sh
[ "$1" = --user ] && shift
verb=$1; name=$2; pidf='${units}'/$name.pid
alive() { [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null; }
case "$verb" in
  start) [ "$name" = outliner-host.service ] || exit 1
    alive || { cd '${repo}/packages/outliner' && EP0CH_OUTLINES='${outlines}' setsid '${bun}' src/host-main.ts >>'${units}'/host.log 2>&1 </dev/null & echo $! >"$pidf"; } ;;
  stop) if alive; then p=$(cat "$pidf"); kill "$p"; while kill -0 "$p" 2>/dev/null; do sleep 0.1; done; fi; rm -f "$pidf" ;;
  restart) "$0" --user stop "$name" && "$0" --user start "$name" ;;
  show) if alive; then printf 'ActiveState=active\\nSubState=running\\nMainPID=%s\\n' "$(cat "$pidf")"; else printf 'ActiveState=inactive\\nSubState=dead\\nMainPID=0\\n'; fi; echo ExecMainStatus=0 ;;
  *) exit 1 ;;
esac
`);
  chmodSync(join(bin, "systemctl"), 0o755);
  fakeSystemctl("start", "outliner-host.service");
  await until(() => existsSync(sock), "the scratch host's socket", 20_000);
  for (let i = 0; !(await hostLive(sock, 1000)); i++) { if (i > 100) throw new Error("the scratch host didn't answer"); await Bun.sleep(100); }
  // Two outlines at schema N; compost holds a table the step refuses (the failure, fixed by hand later).
  for (const name of ["allotment", "compost"]) await hostRequest(sock, "outlines.create", { name });
  fakeSystemctl("stop", "outliner-host.service");
  const compost = new Database(join(outlines, "compost.sqlite"));
  compost.exec("CREATE TABLE compost_heap (layer TEXT)");
  compost.close();
  fakeSystemctl("start", "outliner-host.service");
  for (let i = 0; !(await hostLive(sock, 1000)); i++) { if (i > 100) throw new Error("the scratch host didn't come back"); await Bun.sleep(100); }

  // A door session on allotment, on the old code: started the way `ep0ch` starts one, from the checkout's own modules.
  const starter = join(root, "start-session.ts");
  writeFileSync(starter, `import { startSession } from "${repo}/packages/door/src/session/start";
import { placeFor, type Place } from "${repo}/packages/door/src/session/place";
const r = await startSession((placeFor([]) as Place).dir, []);
console.log(JSON.stringify(r));
process.exit(r.ok ? 0 : 1);
`);
  const started = Bun.spawnSync([bun, starter], { cwd: home, env: { ...env, EP0CH_WS: "allotment", EP0CH_DAILY_AGENT: "sh" }, stdout: "pipe", stderr: "pipe", timeout: 60_000 });
  if (started.exitCode !== 0) throw new Error(`the session didn't start: ${started.stdout}${started.stderr}`);
  sessionPid = (JSON.parse((await ep0ch("session", "list", "--json")).out) as { pid: number }[])[0]?.pid ?? 0;
}, 600_000);

afterAll(async () => {
  if (!linux) return rmSync(root, { recursive: true, force: true });
  await ep0ch("session", "end", "--all", "--yes").catch(() => undefined);
  try { fakeSystemctl("stop", "outliner-host.service"); } catch { /* gone */ }
  rmSync(root, { recursive: true, force: true });
}, 60_000);

describe.skipIf(!linux)("ep0ch install across a schema bump (PIE-617)", () => {
  test("the plan, a migration that fails and leaves the host stopped, then a rerun that migrates the rest and hands the session over", async () => {
    expect(sessionPid).toBeGreaterThan(0);
    expect([version("allotment"), version("compost")]).toEqual([N, N]);

    // The dry run says what will happen, changes nothing.
    const plan = await ep0ch("install");
    expect(plan.code).toBe(0);
    expect(plan.out).toContain(`schema ${N} → ${M}: will migrate 2 outlines (allotment, compost) with ${STEP_FILE}`);
    expect(plan.out).toContain("systemctl --user stop outliner-host.service");
    expect(git("rev-parse", "HEAD")).toBe(oldHead);

    // Apply: backed up, fast-forwarded, the host stopped, allotment migrated, compost refused by its script.
    const first = await ep0ch("install", "--apply", "--json");
    expect(first.code).toBe(1);
    const r1 = JSON.parse(first.out) as { ok: boolean; steps: { id: string; status: string; done?: string[]; error?: string; recover?: string }[] };
    expect(r1.ok).toBe(false);
    expect(r1.steps.find(s => s.id === "repo")!.done!.join(" ")).toContain(`fast-forwarded ${oldHead.slice(0, 7)} → ${newHead.slice(0, 7)}`);
    const schema = r1.steps.find(s => s.id === "schema")!;
    expect(schema.done).toEqual(["stopped the outline host (systemd outliner-host.service) to migrate", `allotment: schema ${N} → ${M}`]);
    expect(schema.error).toContain(`migrating compost (schema ${N} → ${M}) failed`);
    expect(schema.error).toContain("compost_heap");
    const backup = readdirSync(join(home, "backups/ep0ch"))[0]!;
    const copy = (name: string) => join(home, "backups/ep0ch", backup, `${name}.schema-${N}.sqlite`);
    expect(schema.recover).toContain(`compost's script failed; it runs in one transaction, so the file should be as it was (it reads schema ${N}), and its copy from just before is ${copy("compost")}; allotment is at schema ${M}`);
    expect(schema.recover).toContain("the outline host is left stopped");
    expect(schema.recover).toContain(`or go back to the code before: git -C ${repo} reset --hard ${oldHead} && cp ${copy("allotment")} ${join(outlines, "allotment.sqlite")} && cp ${copy("compost")} ${join(outlines, "compost.sqlite")} && systemctl --user start outliner-host.service`);
    // The copies are exact: taken with the host stopped, each at the old schema.
    for (const name of ["allotment", "compost"]) { const db = new Database(copy(name), { readonly: true }); expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(N); db.close(); }
    // Nothing after it ran: the host is down, compost as it was, the session on the old code.
    expect(r1.steps.map(s => s.id)).not.toContain("host");
    expect(await hostLive(sock, 1000)).toBeFalsy();
    expect([version("allotment"), version("compost")]).toEqual([M, N]);
    expect(existsSync(join(home, "backups/ep0ch", backup, "allotment.sqlite"))).toBe(true);

    // Doctor flags compost behind the checkout's schema, with install as the fix.
    const doctor = await ep0ch("doctor");
    expect(doctor.out).toMatch(new RegExp(`! schema +compost is schema ${N}`));
    expect(doctor.out).toMatch(new RegExp(`schema +compost is schema ${N}[^\\n]*\\n(?:.*\\n)*? +fix: ep0ch install --apply\\n`));

    // A host started by hand on the new code refuses compost, and a client says the exact commands, on their own lines.
    fakeSystemctl("start", "outliner-host.service");
    for (let i = 0; !(await hostLive(sock, 1000)); i++) { if (i > 100) throw new Error("the scratch host didn't come back"); await Bun.sleep(100); }
    const refused = await ep0ch("find", "leeks", "--ws", "compost");
    expect(refused.code).not.toBe(0);
    expect(refused.err).toContain(`is schema version ${N}; this build opens only schema version ${M}.`);
    expect(refused.err).toMatch(/\n +ep0ch install --apply\n/);
    expect(refused.err).toContain(`\n    bun ${join(repo, "packages/outliner/scripts/migrations", STEP_FILE)} ${join(outlines, "compost.sqlite")}\n`);
    expect(refused.err).not.toMatch(/<database>|while no service|\x1b\[/);

    // Fixed by hand; the rerun migrates what's left, starts the host and hands the session to the new code.
    const compost = new Database(join(outlines, "compost.sqlite"));
    compost.exec("DROP TABLE compost_heap");
    compost.close();
    const second = await ep0ch("install", "--apply", "--json");
    const r2 = JSON.parse(second.out) as typeof r1;
    expect({ code: second.code, ok: r2.ok, err: r2.steps.find(s => s.error)?.error }).toEqual({ code: 0, ok: true, err: undefined });
    expect(r2.steps.find(s => s.id === "repo")!.status).toBe("skip");
    // The host started by hand is stopped through its unit first.
    expect(r2.steps.find(s => s.id === "schema")!.done).toEqual(["stopped the outline host (systemd outliner-host.service) to migrate", `compost: schema ${N} → ${M}`]);
    expect(r2.steps.find(s => s.id === "host")!.done!.join(" ")).toContain("started the outline host (systemd outliner-host.service");
    expect(r2.steps.find(s => s.id === "session")!.status).toBe("do");
    expect([version("allotment"), version("compost")]).toEqual([M, M]);
    // The host opens both on the new code (a ping opens the outline it names, and it refuses one at another schema).
    for (const outline of ["allotment", "compost"]) expect(await hostRequest(sock, "ping", { outline })).toMatchObject({ protocolVersion: expect.any(Number) });
    // The session: a new daemon on the new commit.
    const list = JSON.parse((await ep0ch("session", "list", "--json")).out) as { pid: number; code: { commit: string } }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.pid).not.toBe(sessionPid);
    expect(list[0]!.code.commit).toBe(newHead);
  }, 600_000);
});
