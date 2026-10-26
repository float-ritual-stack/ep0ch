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
import { ownScratch, stopUnder, until, wholeEnv } from "./scratch";

const linux = process.platform === "linux";
const top = resolve(import.meta.dir, "../../..");
/** The checkout's schema version (the outliner's schema.ts, read as text: the door imports nothing else of it), and the bump the scratch origin makes. */
const N = Number(/^export const SCHEMA_VERSION = (\d+);/m.exec(readFileSync(join(top, "packages/outliner/src/schema.ts"), "utf8"))![1]);
const M = N + 1, STEP_FILE = `${String(M).padStart(4, "0")}-seed-trays.ts`;
const root = mkdtempSync(join(tmpdir(), "ep0ch-im-"));
// Its host, link and sessions leave this process's tree (setsid, as systemd's would): this test owns them (PIE-1360).
ownScratch(root);
const repo = join(root, "repo"), origin = join(root, "origin.git"), home = join(root, "home"), outlines = join(root, "outlines");
const state = join(root, "state"), bin = join(root, "bin"), units = join(root, "units");
const clientRepo = join(root, "client-repo"), clientHome = join(root, "client-home"), clientOutlines = join(root, "client-outlines"), clientBin = join(root, "client-bin");
const sshLog = join(root, "ssh.jsonl");
const bun = process.execPath;
const sock = join(outlines, ".host", "host.sock");

/** The whole environment every command here runs with: nothing inherited, so nothing reaches the person's stack (box-test's run mark aside). */
const env: Record<string, string> = wholeEnv({
  HOME: home, PATH: [bin, dirname(bun), "/usr/bin", "/bin"].join(":"), EP0CH_OUTLINES: outlines, EP0CH_STATE: state,
  EP0CH_WS: "allotment", EP0CH_AGENT: "wren", CLAUDE_CODE_SESSION_ID: "garden-session", EP0CH_MACHINE_NAME: "garden-host",
  EP0CH_SSH: join(bin, "ssh"), FAKE_SSH_OWNER_FILE: process.env.FAKE_SSH_OWNER_FILE!, FAKE_SSH_HOME: clientHome, FAKE_SSH_OUTLINES: clientOutlines,
  FAKE_SSH_STATE: join(root, "client-state"), FAKE_SSH_BIN: clientBin, FAKE_SSH_LOG: sshLog, FAKE_SSH_REFUSE: "away",
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
const version = (name: string) => { const db = new Database(join(outlines, `${name}.sqlite`), { readonly: true }); try { return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version; } finally { db.close(); } };
const ruleNote = () => { const db = new Database(join(outlines, "allotment.sqlite"), { readonly: true }); try { return (db.query("SELECT text FROM blocks WHERE text LIKE 'Bay badges%'").get() as { text: string }).text; } finally { db.close(); } };
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
  sh(["tar", "-C", top, "-cf", join(root, "repo.tar"), "-T", join(root, "files")]);
  sh(["tar", "-C", repo, "-xf", join(root, "repo.tar")]);
  sh(["git", "init", "-q", "-b", "main", repo]);
  git("add", "-A"); git("commit", "-qm", "the garden as it was");
  oldHead = git("rev-parse", "HEAD");
  sh(["git", "clone", "-q", "--bare", repo, origin]);
  git("remote", "add", "origin", origin); git("fetch", "-q", "origin"); git("branch", "-q", "--set-upstream-to=origin/main", "main");
  const schema = join(repo, "packages/outliner/src/schema.ts");
  writeFileSync(schema, readFileSync(schema, "utf8").replace(/^export const SCHEMA_VERSION = \d+;/m, `export const SCHEMA_VERSION = ${M};`));
  writeFileSync(join(repo, "packages/outliner/scripts/migrations", STEP_FILE), STEP);
  // Keep 0006 and 0007: an outline still at 5 must take both before the new step.
  git("add", "-A"); git("commit", "-qm", `seed trays: schema ${M}`);
  newHead = git("rev-parse", "HEAD");
  git("push", "-q", "origin", "main"); git("reset", "-q", "--hard", oldHead);
  sh([bun, "install", "--frozen-lockfile"], repo, 300_000);
  git("worktree", "add", "-qb", "inspect", join(root, "inspect"));
  mkdirSync(join(root, "inspect/.claude"), {recursive: true});
  writeFileSync(join(root, "inspect/.claude/settings.local.json"), JSON.stringify({permissions: {allow: ["mcp__pi-outliner"]}}));
  for (const d of [clientHome, clientOutlines, clientBin, join(clientOutlines, ".host")]) mkdirSync(d, { recursive: true, mode: 0o700 });
  sh(["git", "clone", "-q", origin, clientRepo]);
  sh(["git", "-C", clientRepo, "reset", "--hard", oldHead]);
  sh([bun, "install", "--frozen-lockfile"], clientRepo, 300_000);
  writeFileSync(join(bin, "ssh"), `#!/bin/sh\nexec '${bun}' '${top}/packages/outliner/test/fake-ssh.ts' "$@"\n`);
  chmodSync(join(bin, "ssh"), 0o755);
  // A remote install must see the restarted host before it touches the client checkout.
  writeFileSync(join(root, "client-install.ts"), `import { hostRequest } from "${repo}/packages/door/src/socket";
await hostRequest("${sock}", "ping", { outline: "allotment" });
const p = Bun.spawn(["${bun}", "${clientRepo}/packages/door/src/main.ts", ...process.argv.slice(2)], {
  cwd: "${clientHome}", env: { ...process.env, XDG_CONFIG_HOME: "${clientHome}/.config", XDG_STATE_HOME: "${clientHome}/.local/state", EP0CH_DAILY_AGENT: "sh" }, stdio: ["ignore", "inherit", "inherit"] });
process.exit(await p.exited);
`);
  writeFileSync(join(clientBin, "ep0ch"), `#!/bin/sh\nexec '${bun}' '${root}/client-install.ts' "$@"\n`);
  chmodSync(join(clientBin, "ep0ch"), 0o755);
  writeFileSync(join(clientOutlines, ".host/clients"), "must-not-recurse\n");

  // The host's unit, and a systemctl that runs it: start, stop (waiting for it to go), restart, show.
  writeFileSync(join(home, ".config/systemd/user/outliner-host.service"),
    `[Service]\nWorkingDirectory=${repo}/packages/outliner\nEnvironment=EP0CH_OUTLINES=${outlines}\nExecStart=${bun} ${repo}/packages/outliner/src/host-main.ts\nRestart=always\n`);
  writeFileSync(join(bin, "systemctl"), `#!/bin/sh
[ "$1" = --user ] && shift
verb=$1; name=$2; pidf='${units}'/$name.pid
alive() { [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null; }
case "$verb" in
  daemon-reload|enable) exit 0 ;;
  is-enabled) exit 0 ;;
  is-active) alive && exit 0; exit 3 ;;
  start) if [ "$name" = ep0ch-link ]; then
      alive || { setsid '${bun}' '${repo}/packages/door/src/main.ts' link serve >>'${units}'/link.log 2>&1 </dev/null & echo $! >"$pidf"; }
      exit 0
    fi
    [ "$name" = outliner-host.service ] || exit 1
    alive || { cd '${repo}/packages/outliner' && EP0CH_OUTLINES='${outlines}' setsid '${bun}' src/host-main.ts >>'${units}'/host.log 2>&1 </dev/null & echo $! >"$pidf"; } ;;
  stop) if alive; then p=$(cat "$pidf"); kill "$p"; while kill -0 "$p" 2>/dev/null; do sleep 0.1; done; fi; rm -f "$pidf" ;;
  restart) if [ "$name" = ep0ch-link ] && [ -f '${root}/away-on-restart.pid' ]; then
      kill "$(cat '${root}/away-on-restart.pid')"; rm -f '${root}/away-on-restart.pid'
    fi
    "$0" --user stop "$name" && "$0" --user start "$name" ;;
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
  // A rule note in the old brace form, for the sweep step (PIE-533): the new grammar reads `append`, not `below`.
  writeFileSync(join(root, "seed-rule.ts"), `import { OutlinerStore } from "${repo}/packages/outliner/src/store";
const store = new OutlinerStore("${outlines}/allotment.sqlite");
store.create("Bay badges [rule-name::bay-badges] [rule-match::type=bay-job] [rule-decorate::badge] [rule-place::below]", null, "user");
store.close();
`);
  sh([bun, join(root, "seed-rule.ts")], repo);
  const source = new Database(join(outlines, "allotment.sqlite"), { readonly: true });
  source.run("VACUUM INTO ?", [join(outlines, "seed-bank.sqlite")]);
  source.close();
  const old = new Database(join(outlines, "seed-bank.sqlite"));
  old.exec("DROP TABLE block_reference_candidates; ALTER TABLE block_revisions DROP COLUMN task_id; PRAGMA user_version = 5");
  old.close();
  // Compost needs only a settings rewrite: install must not decide from note changes alone.
  mkdirSync(join(outlines, "compost/extensions/readwise"), { recursive: true });
  writeFileSync(join(outlines, "compost/extensions/readwise/config.json"), JSON.stringify({ config: { link: "https://notes.example/{outline}/b/{id}" } }));
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
  try { fakeSystemctl("stop", "ep0ch-link"); } catch {}
  try { fakeSystemctl("stop", "outliner-host.service"); } catch { /* gone */ }
  // Whatever the steps above missed (a session of the client's, a host a failed restart started again).
  stopUnder(root);
  rmSync(root, { recursive: true, force: true });
}, 60_000);

describe.skipIf(!linux)("ep0ch install across a schema bump (PIE-617)", () => {
  test("the plan, a migration that fails and leaves the host stopped, then a rerun that migrates the rest and hands the session over", async () => {
    expect(sessionPid).toBeGreaterThan(0);
    expect([version("allotment"), version("compost")]).toEqual([N, N]);

    writeFileSync(join(outlines, ".host/clients"), "away\n");
    // The dry run says what will happen, changes nothing.
    const plan = await ep0ch("install", "--add-client", "workstation");
    expect(plan.code).toBe(0);
    expect(plan.out).toContain("away, workstation");
    expect(existsSync(sshLog)).toBe(false);
    expect(readFileSync(join(outlines, ".host/clients"), "utf8")).toBe("away\n");
    expect(plan.out).toContain(`schema 5 → ${M}: will migrate 3 outlines (allotment, compost, seed-bank) with 0006-reference-index.ts, 0007-revision-tasks.ts, ${STEP_FILE}`);
    expect(plan.out).toContain("systemctl --user stop outliner-host.service");
    expect(git("rev-parse", "HEAD")).toBe(oldHead);

    // Apply: backed up, fast-forwarded, the host stopped, allotment migrated, compost refused by its script.
    const first = await ep0ch("install", "--apply", "--add-client", "workstation", "--json");
    expect(first.code).toBe(1);
    const r1 = JSON.parse(first.out) as { ok: boolean; steps: { id: string; status: string; done?: string[]; error?: string; recover?: string }[] };
    expect(r1.ok).toBe(false);
    expect(readFileSync(join(outlines, ".host/clients"), "utf8")).toBe("away\nworkstation\n");
    expect(r1.steps.find(s => s.id === "repo")!.done!.join(" ")).toContain(`fast-forwarded ${oldHead.slice(0, 7)} → ${newHead.slice(0, 7)}`);
    expect(r1.steps.find(s => s.id === "repo")!.done!.join(" ")).toContain("RUN AGAIN: ep0ch install --apply");
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
    expect(existsSync(sshLog)).toBe(false);
    expect(sh(["git", "-C", clientRepo, "rev-parse", "HEAD"])).toBe(oldHead);
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
    const unfinished = await hostRequest(sock, "blocks.query", { outline: "allotment", query: { where: "type=deploy machine=install" } });
    expect(unfinished.blocks[0].text).toContain(`From: ${oldHead}`);
    expect(unfinished.blocks[0].text).toContain("Local: running");
    expect(first.out).toContain("deploy record could not be saved");
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
    env.EP0CH_WS = "compost";
    const second = await ep0ch("install", "--apply", "--json");
    const r2 = JSON.parse(second.out) as typeof r1;
    expect({ code: second.code, ok: r2.ok, err: r2.steps.find(s => s.error)?.error }).toEqual({ code: 0, ok: true, err: undefined });
    expect(r2.steps.find(s => s.id === "repo")!.status).toBe("skip");
    for (const directory of [home, clientHome]) {
      expect(JSON.parse(readFileSync(join(directory, ".claude/settings.json"), "utf8")).permissions.allow).toContain("mcp__ep0ch");
    }
    expect(JSON.parse(readFileSync(join(root, "inspect/.claude/settings.local.json"), "utf8")).permissions.allow).toEqual(["mcp__ep0ch"]);
    // The host started by hand is stopped through its unit first.
    expect(r2.steps.find(s => s.id === "schema")!.done).toEqual(["stopped the outline host (systemd outliner-host.service) to migrate", `compost: schema ${N} → ${M}`, `seed-bank: schema 5 → ${M}`]);
    // The sweep: the host was already down for the migration, so it stops nothing more; the old form is in the new grammar.
    expect(r2.steps.find(s => s.id === "sweep")!.done![0]).toMatch(/^allotment: rewrote 1 note \(1 rule-place\)/);
    expect(ruleNote()).toContain("[rule-place::append]");
    expect(JSON.parse(readFileSync(join(outlines, "compost/extensions/readwise/config.json"), "utf8")).config.link).toBe("https://notes.example/{{props.outline}}/b/{{props.id}}");
    expect(r2.steps.find(s => s.id === "sweep")!.done!.some(line => line.includes("--undo"))).toBe(true);
    expect(r2.steps.find(s => s.id === "host")!.done!.join(" ")).toContain("started the outline host (systemd outliner-host.service");
    expect(r2.steps.find(s => s.id === "session")!.status).toBe("do");
    expect([version("allotment"), version("compost")]).toEqual([M, M]);
    expect(version("seed-bank")).toBe(M);
    const seeds = await hostRequest(sock, "blocks.query", { outline: "seed-bank", query: { where: "rule-name=bay-badges" } });
    expect(seeds.blocks[0].text).toContain("Bay badges");
    // The host opens both on the new code (a ping opens the outline it names, and it refuses one at another schema).
    for (const outline of ["allotment", "compost"]) expect(await hostRequest(sock, "ping", { outline })).toMatchObject({ protocolVersion: expect.any(Number) });
    const repaired = await hostRequest(sock, "blocks.query", { outline: "compost", query: { where: "type=deploy machine=install" } });
    expect(repaired.blocks.some((b: { text: string }) => b.text.includes("✓ workstation"))).toBe(true);
    env.EP0CH_WS = "allotment";
    // A second install has nothing to rewrite, and leaves the host serving.
    const again = await ep0ch("install", "--apply", "--json");
    expect(again.code).toBe(0);
    expect(JSON.parse(again.out).steps.find((s: { id: string }) => s.id === "sweep").done).toEqual(["nothing to rewrite"]);
    const records = await hostRequest(sock, "blocks.query", { outline: "allotment", query: { where: "type=deploy machine=install", sort: { field: "created", direction: "desc" } } });
    const savedStart = await hostRequest(sock, "get", { outline: "allotment", blockId: unfinished.blocks[0].id });
    expect(savedStart.text).toBe(unfinished.blocks[0].text);
    const record = records.blocks[0];
    expect(record.author).toBe("agent");
    expect(record.text).toContain("wren");
    expect(record.text).toContain("garden-session");
    expect(record.text).toContain("Machine: garden-host");
    expect(record.text).toContain("When: 20");
    expect(record.text).toContain(`From: ${newHead}`);
    expect(record.text).toContain(`To: ${newHead}`);
    expect(record.text).toContain("Protocol:");
    expect(record.text).toContain("! away");
    expect(record.text).toContain("✓ workstation");
    const revisions = await hostRequest(sock, "block.revisions", { outline: "allotment", blockId: record.id });
    expect(revisions.revisions[0]).toMatchObject({ author: "agent", actorId: "wren" });
    const recordsPage = await hostRequest(sock, "get", { outline: "allotment", blockId: record.parentId });
    expect(recordsPage.text).toContain("[system-view::deploys]");
    const everyday = await ep0ch("find", "--query", "type=deploy", "--json");
    expect(everyday.code).toBe(0);
    expect(everyday.out).not.toContain(record.id);
    // An unreachable leg is reported, then the next client really installs the new checkout.
    const clients = r2.steps.find(s => s.id === "clients")!;
    expect(clients.done!.join("\n")).toContain("! away");
    expect(clients.done!.join("\n")).toContain("ssh -- away 'ep0ch install --apply --as-client'");
    expect(clients.done!.join("\n")).toContain("✓ workstation");
    expect(sh(["git", "-C", clientRepo, "rev-parse", "HEAD"])).toBe(newHead);
    const calls = readFileSync(sshLog, "utf8").trim().split("\n").map(l => JSON.parse(l));
    expect(calls.map(a => a[a.indexOf("--") + 1])).toEqual(["away", "workstation", "away", "workstation"]);
    // The session: a new daemon on the new commit.
    const list = JSON.parse((await ep0ch("session", "list", "--json")).out) as { pid: number; code: { commit: string } }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.pid).not.toBe(sessionPid);
    expect(list[0]!.code.commit).toBe(newHead);
    sh(["git", "-C", clientRepo, "switch", "-c", "client-work"]);
    const blocked = await ep0ch("install", "--apply", "--json");
    expect(blocked.code).toBe(0);
    expect(JSON.parse(blocked.out).steps.find((s: { id: string }) => s.id === "clients").done.join("\n")).toContain("! workstation");
    sh(["git", "-C", clientRepo, "switch", "main"]);
    for (const name of ["away", "workstation"]) {
      const removed = await ep0ch("install", "--apply", "--remove-client", name, "--json");
      expect(removed.code).toBe(0);
      expect(readFileSync(join(outlines, ".host/clients"), "utf8").split("\n")).not.toContain(name);
    }
    expect(readFileSync(join(outlines, ".host/clients"), "utf8")).toBe("");

    // A protocol update still hands an old daemon over; no idle-only request can strand it.
    const protocol = join(repo, "packages/door/src/session/protocol.ts");
    writeFileSync(protocol, readFileSync(protocol, "utf8").replace(/export const PROTOCOL = (\d+);/, (_, n) => `export const PROTOCOL = ${Number(n) + 1};`));
    git("add", "packages/door/src/session/protocol.ts"); git("commit", "-qm", "the next session protocol"); git("push", "-q", "origin", "main");
    const oldPid = JSON.parse((await ep0ch("session", "list", "--json")).out)[0].pid;
    expect((await ep0ch("install", "--apply", "--json")).code).toBe(0);
    expect(JSON.parse((await ep0ch("session", "list", "--json")).out)[0].pid).not.toBe(oldPid);

    // A successor that cannot start must not prevent the steps after handover from running.
    const daemon = join(repo, "packages/door/src/session/daemon.ts"), working = readFileSync(daemon, "utf8");
    writeFileSync(daemon, working.replace('export async function serve(args: string[]): Promise<never> {', 'export async function serve(args: string[]): Promise<never> {\nthrow new Error("the scratch successor cannot start");'));
    git("add", "packages/door/src/session/daemon.ts"); git("commit", "-qm", "a successor that cannot start"); git("push", "-q", "origin", "main");
    const incomplete = await ep0ch("install", "--apply", "--json");
    expect(incomplete.code).toBe(0);
    const continued = JSON.parse(incomplete.out).steps;
    expect(continued.find((s: { id: string }) => s.id === "session").done.join("\n")).toContain("session upgrade --ws allotment");
    expect(continued.find((s: { id: string }) => s.id === "session").done.join("\n")).toContain("the scratch successor cannot start");
    expect(continued.find((s: { id: string }) => s.id === "skills")).toBeDefined();
    expect(continued.some((s: { error?: string }) => s.error)).toBe(false);
    writeFileSync(daemon, working);
    git("add", "packages/door/src/session/daemon.ts"); git("commit", "-qm", "the successor can start again"); git("push", "-q", "origin", "main");
    expect((await ep0ch("install", "--apply", "--json")).code).toBe(0);
    expect(sh([bun, join(root, "start-session.ts")], home)).toContain('"ok":true');

    delete env.EP0CH_AGENT;
    delete env.CLAUDE_CODE_SESSION_ID;
    mkdirSync(join(home, ".ep0ch"));
    writeFileSync(join(home, ".ep0ch/config.toml"), 'ws = "allotment"\nagent = "robin"\n');
    expect((await ep0ch("install", "--apply", "--json")).code).toBe(0);
    let latest = await hostRequest(sock, "blocks.query", { outline: "allotment", query: { where: "type=deploy machine=install", sort: { field: "created", direction: "desc" }, limit: 1 } });
    expect(latest.blocks[0].text).toContain("Who: robin");
    writeFileSync(join(home, ".ep0ch/config.toml"), 'ws = "allotment"\n');
    expect((await ep0ch("install", "--apply", "--json")).code).toBe(0);
    latest = await hostRequest(sock, "blocks.query", { outline: "allotment", query: { where: "type=deploy machine=install", sort: { field: "created", direction: "desc" }, limit: 1 } });
    expect(latest.blocks[0].author).toBe("user");
    expect(latest.blocks[0].text).toContain("Who: person");

    // A newer host protocol reaches a laptop that can only dial out; the real installer hands over its remote session.
    const { createServer } = await import("node:net");
    const reservation = createServer();
    await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
    const port = (reservation.address() as import("node:net").AddressInfo).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    const clientEnv = { ...env, HOME: clientHome, PATH: [clientBin, dirname(bun), "/usr/bin", "/bin"].join(":"), EP0CH_OUTLINES: clientOutlines, EP0CH_STATE: join(root, "linked-client-state"), EP0CH_SOCKET: sock, EP0CH_WS: "allotment", EP0CH_DAILY_AGENT: "sh", XDG_CONFIG_HOME: join(clientHome, ".config"), XDG_STATE_HOME: join(clientHome, ".local/state") };
    writeFileSync(join(root, "start-linked-session.ts"), readFileSync(join(root, "start-session.ts"), "utf8").replaceAll(repo, clientRepo));
    const started = Bun.spawnSync([bun, join(root, "start-linked-session.ts")], { cwd: clientHome, env: clientEnv, stdout: "pipe", stderr: "pipe", timeout: 60_000 });
    expect({ code: started.exitCode, error: started.stderr.toString(), out: started.stdout.toString() }).toMatchObject({ code: 0 });
    const wire = join(repo, "packages/outline-core/src/protocol.ts");
    writeFileSync(wire, readFileSync(wire, "utf8").replace(/export const PROTOCOL = (\d+);/, (_, n) => `export const PROTOCOL = ${Number(n) + 1};`));
    const installer = join(repo, "packages/door/src/setup/apply.ts");
    writeFileSync(installer, readFileSync(installer, "utf8").replace("  const plan = buildPlan(facts, options);", '  if (args.includes("--as-client")) writeFileSync(join(facts.home, "new-garden-support"), "installed by the target code");\n  const plan = buildPlan(facts, options);'));
    git("add", "packages/outline-core/src/protocol.ts", "packages/door/src/setup/apply.ts"); git("commit", "-qm", "the garden host speaks the next protocol"); git("push", "-q", "origin", "main");
    const linkedHead = git("rev-parse", "HEAD");
    writeFileSync(join(outlines, ".host/link.json"), JSON.stringify({ mode: "serve", port, machines: ["travel", "roam"] }));
    mkdirSync(join(home, ".config/secrets"), { recursive: true });
    writeFileSync(join(home, ".config/secrets/link-travel.env"), "LINK_KEY=fictional-key\n", { mode: 0o600 });
    writeFileSync(join(home, ".config/secrets/link-roam.env"), "LINK_KEY=fictional-roam-key\n", { mode: 0o600 });
    // The helper is the connector's production assembly, using its own checkout and installer, without a public TLS endpoint.
    writeFileSync(join(root, "linked-client.ts"), `import { connectLink } from "${clientRepo}/packages/outliner/src/link";
import { installLinkedSha } from "${clientRepo}/packages/door/src/link";
const commit = Bun.spawnSync(["git", "-C", "${clientRepo}", "rev-parse", "HEAD"]).stdout.toString().trim();
const connector = connectLink({server: "http://127.0.0.1:${port}", machine: "travel", key: "fictional-key", host: "${sock}", statusPath: "${clientOutlines}/.host/link-state.json", commit, install: installLinkedSha, log: console.error, onInstalled: () => {connector.stop();process.exit(0);}});
process.once("SIGTERM",()=>{connector.stop();process.exit(0)});
`);
    fakeSystemctl("start", "ep0ch-link");
    let linkedClient = Bun.spawn([bun, join(root, "linked-client.ts")], { cwd: clientHome, env: clientEnv, stdout: "ignore", stderr: Bun.file(join(root, "linked-client.log")) });
    writeFileSync(join(root, "roaming-client.ts"), readFileSync(join(root, "linked-client.ts"), "utf8").replace('machine: "travel"', 'machine: "roam"').replace("fictional-key", "fictional-roam-key").replace("link-state.json", "roam-link-state.json"));
    const roamingClient = Bun.spawn([bun, join(root, "roaming-client.ts")], { cwd: clientHome, env: clientEnv, stdout: "ignore", stderr: Bun.file(join(root, "roaming-client.log")) });
    try {
      await until(() => { try { return JSON.parse(readFileSync(join(outlines, ".remote/travel.link.json"), "utf8")).up; } catch { return false; } }, "laptop linked before the deploy", 20_000);
      await until(() => { try { return JSON.parse(readFileSync(join(outlines, ".remote/roam.link.json"), "utf8")).up; } catch { return false; } }, "roaming laptop linked before the deploy", 20_000);
      // This laptop leaves during the restart; only travel can receive this deploy now.
      writeFileSync(join(root, "away-on-restart.pid"), String(roamingClient.pid));
      const delivered = await ep0ch("install", "--apply", "--json");
      const report = JSON.parse(delivered.out);
      expect({ code: delivered.code, err: delivered.err, step: report.steps.find((s: {error?:string}) => s.error) }).toMatchObject({ code: 0, step: undefined });
      expect(report.linked.join("\n")).toContain(`travel: installed ${linkedHead}`);
      expect(report.linked.join("\n")).toContain("roam: away; install queued for its next connection");
      expect(await roamingClient.exited).toBe(0);
      expect(report.linked.join("\n")).toContain("session was handed over");
      expect(sh(["git", "-C", clientRepo, "rev-parse", "HEAD"])).toBe(linkedHead);
      expect(readFileSync(join(clientHome, "new-garden-support"), "utf8")).toBe("installed by the target code");
      expect(await linkedClient.exited).toBe(0);
      linkedClient = Bun.spawn([bun, join(root, "linked-client.ts")], { cwd: clientHome, env: clientEnv, stdout: "ignore", stderr: Bun.file(join(root, "linked-client-again.log")) });
      await until(() => { try { return JSON.parse(readFileSync(join(outlines, ".remote/travel.link.json"), "utf8")).up; } catch { return false; } }, "updated connector comes back");
      const record = await hostRequest(sock, "blocks.query", { outline: "allotment", query: { where: "type=deploy machine=install host=travel", sort: { field: "created", direction: "desc" }, limit: 1 } });
      expect(record.blocks[0].text).toContain(`travel: installed ${linkedHead}`);
      expect(record.blocks[0].text).toContain("session was handed over");
      const repeated = await ep0ch("install", "--apply", "--json");
      expect(repeated.code).toBe(0);
      const repeatedRecord = await hostRequest(sock, "blocks.query", { outline: "allotment", query: { where: "type=deploy machine=install host=travel", sort: { field: "created", direction: "desc" }, limit: 1 } });
      expect(repeatedRecord.blocks[0].id).not.toBe(record.blocks[0].id);
      expect(repeatedRecord.blocks[0].text).toContain(`travel: installed ${linkedHead}`);
      expect(repeatedRecord.blocks[0].text).not.toContain("install pending");
    } finally {
      roamingClient.kill(); await roamingClient.exited;
      linkedClient.kill(); await linkedClient.exited;
      const end = Bun.spawn([bun, join(clientRepo, "packages/door/src/main.ts"), "session", "end", "--all", "--yes"], { env: clientEnv, cwd: clientHome, stdout: "ignore", stderr: "ignore" });
      await end.exited;
    }

  }, 600_000);
});
