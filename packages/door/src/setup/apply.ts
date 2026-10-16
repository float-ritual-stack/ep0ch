import { fixOutlineFiles, outlineFiles } from "./outline-files";
// `ep0ch doctor` and `ep0ch install [--apply]` (PIE-450). The dry run (the default) prints the plan; --apply runs
// its steps in order, each saying what it did, and stops at the first failure with the recovery. Deploy notes go
// through the host; no outline is created; no unit, Herdr config or plugin link is changed.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { formatDoctor, doctorReport } from "./doctor";
import { databases, depsState, gatherFacts, hostFacts, mcpFacts, type OnLine, outlineSchema, pluginCode, pluginFacts, run, stopRunning, unitState } from "./facts";
import { clauses, Progress, progressMode, size, table, type Task, type Terminal } from "./progress";
import { type Facts, type OutlineSchema, PLUGIN_SOURCE, short, staleness } from "./model";
import { backupDirOf, buildPlan, hostMainOf, hostStep, hostUnitArgv, hostUnitCommand, mcpRestartCommand, mcpStep, type Migration, type Plan, type PlanOptions, repoStep, sessionName, sessionVerdict, type Step, type StepStatus } from "./plan";
import { hostLive } from "../discover";
import type { Handover } from "../session/client";
import { applyLinks, byFolder, LinkFailed, type LinkWork, sh } from "./links";
import { programStatusEmitter, type StatusEmitter } from "@ep0ch/outliner/program-status-emit";
import { writeDialsIn, writeMachineName } from "@ep0ch/outliner/machine-name";
import { isMachineName } from "@ep0ch/outline-core/outline-location";
import { ep0ch } from "../session/place";
import { sshBin } from "../machine";
import { copyName, type CopyUpdate, newsWords } from "@ep0ch/outliner/extension-update";
import { startDeployRecord } from "./deploy-record";

type Env = Record<string, string | undefined>;
export const SETUP_USAGE = "ep0ch doctor [--fix [--move-scripts]] [--backups] [--json] | ep0ch install [--apply] [--json] [--machine-name <name>] [--dials-in | --no-dials-in] [--add-client <ssh-name> | --remove-client <ssh-name>] [--as-client]";

const MARK: Record<StepStatus, string> = { do: "→", skip: "✓", manual: "!" };

export { backupDatabase } from "@ep0ch/outliner/snapshot-database";
import { backupDatabase } from "@ep0ch/outliner/snapshot-database";

export function formatPlan(f: Facts, plan: Plan, apply: boolean): string {
  const lines = [`ep0ch install · ${f.platform} · ${apply ? "applying" : "dry run: nothing changes; ep0ch install --apply runs the → steps"}`, ""];
  plan.steps.forEach((s, i) => lines.push(...stepLines(s, i, f, false)));
  if (plan.notes.length) lines.push("", "not done by install:", ...plan.notes.map(n => `  · ${n}`));
  return lines.join("\n");
}

/**
 * A step as the plan shows it: its title, why (one clause a line), what it covers and its commands. While applying,
 * a step that runs is only its title: its ✓ lines say what it did, not the plan's words again.
 */
function stepLines(s: Step, i: number, f: Facts, applying: boolean): string[] {
  const head = `${i + 1} ${MARK[s.status]} ${s.title}`;
  if (applying && s.status === "do") return [head];
  const out = [head];
  if (s.id === "session" && f.sessions?.length) out.push(...sessionLines(f));
  else out.push(...clauses(s.why).map(l => `    ${l}`));
  // The outlines it copies by name: the folders are in the why, once.
  if (s.backups && s.status !== "skip") out.push(`    ${s.backups.map(b => b.name).join(" · ")}`);
  for (const c of s.commands) if (!(s.backups && c.startsWith("sqlite3"))) out.push(`    $ ${c}`);
  return out;
}

/**
 * The door sessions in the plan: those to hand over as a table (the code they go to said once), and each one left as
 * it is on its own line.
 */
export function sessionLines(f: Facts): string[] {
  const repo = repoStep(f);
  const all = (f.sessions ?? []).map(s => ({ s, v: sessionVerdict(s, f, repo) }));
  const doing = all.filter(x => x.v.status === "do");
  const out: string[] = [];
  if (doing.length) {
    const to = [...new Set(doing.map(x => short(x.v.target ?? null)))].join(", ");
    out.push(`    a new daemon on ${to} takes each over; its programs keep running and its terminals attach again`);
    out.push(...table([["outline", "pid", "runs", "programs", "terminals"],
      ...doing.map(({ s }) => [sessionName(s), `${s.pid}`, short(s.commit), `${s.programs}`, `${s.clients}`])]));
  }
  for (const { v } of all) if (v.status !== "do") out.push(`    ${v.why}`);
  return out;
}

/** Handed-over sessions as a table; the code they moved between said once when they all moved the same way. */
export function handoverLines(hs: readonly Handover[]): string[] {
  const code = (h: Handover) => `${short(h.code[0])} → ${short(h.code[1])}`;
  const same = new Set(hs.map(code)).size === 1;
  const out = same ? [`    ✓ handed over to new daemons, ${code(hs[0]!)}; programs kept running, terminals attaching again`]
    : ["    ✓ handed over to new daemons; programs kept running, terminals attaching again"];
  out.push(...table([["outline", "pid", "programs", "terminals", ...(same ? [] : ["code"])],
    ...hs.map(h => [h.name, `${h.pid[0]}→${h.pid[1] ?? "?"}`, `${h.programs}`, `${h.terminals}`, ...(same ? [] : [code(h)])])], "      "));
  return out;
}

/** Links made, replaced and taken away, one line per folder and kind: `✓ linked in ~/.claude/skills/: a · b`. */
export function linkSummary(w: LinkWork): string[] {
  const kinds: [string, string[]][] = [["took away (their files are gone) in", w.remove], ["replaced another checkout's in", w.replace.map(l => l.dest)], ["linked in", w.make.map(l => l.dest)]];
  return kinds.flatMap(([what, dests]) => [...byFolder(dests)].map(([dir, names]) => `    ✓ ${what} ${dir}/: ${names.join(" · ")}`));
}

class StepFailed extends Error { constructor(message: string, readonly recover: string) { super(message); } }

async function must(cmd: string[], recover: string, opts: { cwd?: string; env?: Env; timeoutMs?: number; onLine?: OnLine } = {}): Promise<string> {
  const r = await run(cmd, { timeoutMs: 300_000, ...opts });
  if (r.code !== 0) throw new StepFailed(`${cmd.join(" ")} failed: ${withoutProgress(r.err) || r.out || `exit ${r.code}`}`, recover);
  return r.out;
}

/** A child's stderr without the progress lines asked for with --progress (Receiving objects:  45% (90/200)). */
export const withoutProgress = (err: string) =>
  err.split(/\r?\n/).map(l => l.split("\r").at(-1)!).filter(l => l.trim() && !/:\s+\d+% \(/.test(l)).join("\n");

/** Fast-forwards a checkout, then installs its packages when the pull (or anything before) left them stale. */
async function updateCheckout(root: string, name: string, say: (s: string) => void, child: OnLine, env: Env) {
  const before = (await run(["git", "-C", root, "rev-parse", "HEAD"], { env })).out;
  await must(["git", "-C", root, "pull", "--ff-only", "--progress", "origin", "main"], `nothing was merged (--ff-only); see git -C ${root} status, fix it, and rerun ep0ch install`, { env, onLine: child });
  const after = (await run(["git", "-C", root, "rev-parse", "HEAD"], { env })).out;
  say(before === after ? `${name} already at ${short(after)}` : `${name} fast-forwarded ${short(before)} → ${short(after)}`);
  const changed = before === after ? "" : (await run(["git", "-C", root, "diff", "--name-only", before, after], { env })).out;
  const deps = depsState(root);
  if (deps.needed) {
    await must([process.execPath, "install", "--frozen-lockfile"], `the checkout is updated; install its packages by hand: (cd ${root} && bun install --frozen-lockfile)`, { cwd: root, env, onLine: child });
    // The step ran because something was missing; once it succeeds, say what it did, not what was wrong.
    say(`bun install in ${root}: ${deps.done ?? deps.why}`);
  }
  return changed.split("\n").filter(Boolean);
}

async function waitFor(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await Bun.sleep(250); }
  return false;
}

/** How install brings the host up: a restart when its unit's job runs (answering or not), else a start. */
export const hostVerb = (f: Facts): "restart" | "start" => (f.host.running || (f.host.unit?.state?.active && f.host.unit.state.pid) ? "restart" : "start");

/**
 * The host answers at its socket within `ms` after install's `verb`: under launchd a restart (kickstart -k returns
 * before the old process is gone) also needs a new pid than `was`, so the old host still answering isn't taken for the
 * new one (a pid that can't be read isn't a new one); systemd's restart returns once the old one is stopped. Checked
 * once more at the end, then `grace` more times `graceMs` apart with the same test (a host answering late is up, and
 * the steps after it, the MCP gateway's among them, still run). `probe` and `pidOf` are the host's socket and its
 * unit's pid, for tests.
 */
export async function hostReady(f: Facts, verb: "restart" | "start", was: number | undefined, ms: number,
  probe: (socket: string) => Promise<unknown> = hostLive, pidOf: () => Promise<number | undefined> = async () => (await unitState(f.host.unit!)).pid,
  grace = 10, graceMs = 1000): Promise<boolean> {
  const needNewPid = f.host.unit?.kind === "launchd" && verb === "restart" && was !== undefined;
  const ready = async () => { if (needNewPid) { const pid = await pidOf(); if (pid === undefined || pid === was) return false; } return !!(await probe(f.host.socket)); };
  if ((await waitFor(ready, ms)) || (await ready())) return true;
  // A slower grace (a host answering late is up), with the same test.
  for (let i = 0; i < grace; i++) { await Bun.sleep(graceMs); if (await ready()) return true; }
  return false;
}

/** What a step runs, reported through its task: what it did (`say`), its children's output, its items. */
async function execute(step: Step, f: Facts, env: Env, task: Task, said: string[], clientOutcome?: (name: string, line: string) => Promise<void>): Promise<void> {
  // `said` is what --json reports, whole; the person sees the same as a ✓ line, or (record, then show) tidied up.
  const record = (s: string) => { said.push(s); };
  const show = (line: string) => task.say(line);
  const say = (s: string) => { record(s); show(`    ✓ ${s}`); };
  const child = task.child;
  switch (step.id) {
    case "client-list": {
      for (const w of step.writes!) { mkdirSync(dirname(w.path), { recursive: true }); writeFileSync(w.path, w.text); }
      say(step.why);
      return;
    }
    case "clients": {
      for (const [i, name] of f.installClients!.names.entries()) {
        const command = step.commands[i]!;
        const r = await run([sshBin(env), "-o", "BatchMode=yes", "--", name, "ep0ch install --apply --as-client"], { env, timeoutMs: 900_000, onLine: child });
        const line = r.code === 0 ? `✓ ${name}: installed; sessions were handed over or their recovery commands were reported`
          : `! ${name}: ${r.err || r.out || `exit ${r.code}`}\n      run by hand: ${command}`;
        record(line); show(`    ${line}`);
        await clientOutcome?.(name, line);
        if (r.out) { record(r.out); show(r.out); }
      }
      return;
    }
    case "outline-files": {
      for (const line of fixOutlineFiles(f.outlineFiles ?? [], { retireBackups: true })) say(line);
      return;
    }
    case "backup": {
      const backups = step.backups ?? [];
      const sizes = backups.map(b => { try { return statSync(b.path).size; } catch { return 0; } });
      const total = sizes.reduce((a, b) => a + b, 0);
      let copied = 0;
      // The folders once; then a short line per outline, in columns.
      if (backups.length) show(`    ${f.host.folder}/*.sqlite → ${dirname(backups[0]!.dest)}/ (VACUUM INTO, integrity-checked)`);
      const nameWidth = Math.max(...backups.map(b => b.name.length)), sizeWidth = Math.max(...sizes.map(n => size(n).length));
      for (const [i, b] of backups.entries()) {
        task.count(i, backups.length, `${b.name} ${size(sizes[i]!)}`, total ? { done: copied, total } : undefined);
        // The copy holds the event loop: draw what it's copying first.
        task.flush();
        try {
          mkdirSync(dirname(b.dest), { recursive: true, mode: 0o700 });
          const { integrity } = backupDatabase(b.path, b.dest);
          record(`${b.name}: ${b.path} → ${b.dest} (integrity ${integrity})`);
          show(`    ✓ ${b.name.padEnd(nameWidth)}  ${size(sizes[i]!).padStart(sizeWidth)}  integrity ${integrity}`);
          copied += sizes[i]!;
        } catch (e) {
          throw new StepFailed(`backing up ${b.name} failed: ${(e as Error).message}`, `nothing was changed; check the disk and ${b.path}, then rerun ep0ch install --apply`);
        }
      }
      return;
    }
    case "plugin": {
      // Only a managed install is ever a step to run: a link to this checkout is updated by the repo step.
      const p = f.plugin!;
      const source = PLUGIN_SOURCE;
      const ref = "main";
      await must([f.herdr.path!, "plugin", "install", source, "--ref", ref, "--yes"],
        `Herdr keeps the previously installed copy registered; retry: herdr plugin install ${source} --ref ${ref} --yes (herdr plugin log shows the build)`, { env, onLine: child });
      const now = await pluginFacts({ ...env, HERDR_BIN_PATH: f.herdr.path! }, false);
      say(`reinstalled ${source}@${ref}${now?.source?.commit ? ` at ${short(now.source.commit)}` : ""}${now && now.root !== p.root ? ` (its root moved to ${now.root})` : ""}`);
      return;
    }
    case "repo": {
      const changed = await updateCheckout(f.repo.root, "the ep0ch checkout", say, child, env);
      if (changed.includes("packages/outliner/herdr-plugin.toml") && f.plugin?.kind === "local") say(`the plugin's manifest changed: herdr plugin link ${f.repo.outliner} --enabled refreshes Herdr's copy of it`);
      return;
    }
    case "session": {
      // The daemon starts its successor from its checkout, now on the new code.
      const { upgradeAll } = await import("../session/client");
      const rs = await upgradeAll({ handoff: true });
      const handed = rs.filter(r => r.ok && r.handover);
      for (const r of rs) if (r.ok) { record(r.message); if (!r.handover) show(`    ✓ ${r.message}`); }
      if (handed.length) handoverLines(handed.map(r => r.handover!)).forEach(show);
      // A door left on its old code needs attention, but must not strand the extensions and skills after it.
      for (const r of rs.filter(r => !r.ok)) { record(r.message); show(`    ✗ ${r.message}`); }
      return;
    }
    case "name": {
      const name = step.machineName!;
      try { writeMachineName(name, { ...env, EP0CH_OUTLINES: f.host.folder }); }
      catch (e) { throw new StepFailed(`naming this machine failed: ${(e as Error).message}`, `write it by hand: echo ${name} > ${f.machineName?.file}`); }
      say(`this machine is ${name} (${f.machineName?.file})`);
      return;
    }
    case "dials": {
      try { writeDialsIn(step.dialsIn === true, { ...env, EP0CH_OUTLINES: f.host.folder }); }
      catch (e) { throw new StepFailed(`setting whether this machine dials in failed: ${(e as Error).message}`, step.dialsIn ? `touch ${f.dialsIn?.file}` : `rm ${f.dialsIn?.file}`); }
      say(step.dialsIn ? `this machine dials in (${f.dialsIn?.file})` : "this machine is called like any other");
      return;
    }
    case "link": {
      const dir = f.linkDirs.find(d => step.commands[0]?.endsWith(`${d.dir}/ep0ch`))?.dir;
      if (!dir) throw new StepFailed("no link directory chosen", "rerun ep0ch install to see the plan");
      const link = join(dir, "ep0ch");
      try {
        // A broken link, or one to another checkout's door (the plan said so): replaced.
        const existing = f.linkDirs.find(d => d.dir === dir)?.existing;
        if (existing === "broken-link" || existing === "link") unlinkSync(link);
        symlinkSync(f.repo.entry, link);
      } catch (e) { throw new StepFailed(`linking ${link} failed: ${(e as Error).message}`, `link it by hand: ln -s ${f.repo.entry} ${link}`); }
      say(`${link} → ${f.repo.entry}`);
      return;
    }
    case "builtins": {
      // The new checkout's own command (one implementation), so it reads the built-ins the update brought.
      const cli = join(f.repo.outliner, "src", "cli.ts");
      const out = await must([process.execPath, cli, "ext", "update", "--all", "--keep-forked", "--json"],
        `the checkout is updated; refresh them by hand: ${ep0ch()}ext update --all`, { env: { ...env, EP0CH_OUTLINES: f.host.folder }, timeoutMs: 120_000 });
      let copies: CopyUpdate[];
      try { copies = JSON.parse(out.trim().split("\n").at(-1) ?? "[]"); }
      catch { throw new StepFailed(`ext update said what this step can't read: ${out.slice(0, 200)}`, `run ${ep0ch()}ext update --all to see it`); }
      for (const c of copies.filter(c => c.done === "updated")) say(`refreshed ${copyName(c)}${c.news.length ? `: ${c.news.length} change${c.news.length === 1 ? "" : "s"} (${newsWords(c.news)})` : ""}`);
      for (const c of copies.filter(c => c.done === "kept")) {
        record(`${copyName(c)} was changed here: left as it is`);
        show(`    ! ${copyName(c)} was changed here, so it's left as it is: \`${ep0ch()}ext update ${c.id}\` shows what's new and asks`);
      }
      const current = copies.filter(c => c.done === "current").length;
      if (current) say(`${current} already current`);
      return;
    }
    case "ext":
    case "skills": {
      if (!step.links) return;
      const done: string[] = [];
      try { applyLinks(step.links, s => { record(s); done.push(s); }); }
      catch (e) { done.forEach(s => show(`    ✓ ${s}`)); throw e; }
      linkSummary(step.links).forEach(show);
      return;
    }
    case "backups": {
      const r = f.restic!;
      for (const w of step.writes ?? []) {
        try { mkdirSync(dirname(w.path), { recursive: true, mode: 0o700 }); writeFileSync(w.path, w.text, { mode: 0o600 }); }
        catch (e) { throw new StepFailed(`writing ${w.path} failed: ${(e as Error).message}`, `nothing was loaded; rerun ep0ch install --apply`); }
        say(`wrote ${w.path}`);
      }
      const { loadArgv } = await import("../backup/setup");
      const uid = process.getuid?.() ?? 0;
      for (const argv of loadArgv(r, uid)) {
        // launchd's bootout of an agent that isn't loaded fails, and is nothing to stop for.
        if (argv[1] === "bootout") { await run(argv, { env, timeoutMs: 15_000 }); continue; }
        await must(argv, `the units are written; load them by hand: ${argv.join(" ")}`, { env, timeoutMs: 30_000, onLine: child });
      }
      say(r.platform === "linux" ? "ep0ch-backup.timer enabled: the first run is within 3 minutes (journalctl --user -u ep0ch-backup)" : "io.ep0ch.backup loaded: it runs now and every 15 minutes (~/Library/Logs/ep0ch-backup.log)");
      return;
    }
    case "mcp": {
      const m = f.mcp!, u = { ...m.unit, outlines: "", stale: [] };
      const logs = u.kind === "launchd" ? `launchctl print gui/${process.getuid?.() ?? 0}/${u.name}` : `journalctl --user -u ${u.name}`;
      // Its process now, just before the restart: the one a new process replaces.
      const was = (await unitState(u)).pid;
      await must(hostUnitArgv(u, "restart", process.getuid?.() ?? 0), `the MCP gateway wasn't restarted; ${mcpRestartCommand(m)} by hand, and see ${logs}`, { env, timeoutMs: 30_000, onLine: child });
      // A new process, running, and still running a few seconds on (one that dies on start is restarted by its unit
      // with another pid, and is no success).
      const fresh = async () => { const st = await unitState(u); return st.active === true && !!st.pid && st.pid !== was ? st.pid : null; };
      const pid = await waitFor(async () => !!(await fresh()), 30_000) ? await fresh() : null;
      if (!pid) throw new StepFailed(`${u.kind} restarted ${u.name}, but no new gateway process runs after 30s`, `see ${logs}`);
      await Bun.sleep(3000);
      if ((await unitState(u)).pid !== pid) throw new StepFailed(`${u.kind} restarted ${u.name}, but the new gateway (pid ${pid}) didn't stay up`, `see ${logs}`);
      say(`restarted the MCP gateway (${u.kind} ${u.name}) on the new code`);
      return;
    }
    case "schema": {
      const m = step.migrate!, u = f.host.unit, uid = process.getuid?.() ?? 0;
      const logs = u?.kind === "launchd" ? `launchctl print gui/${uid}/${u.name}` : `journalctl --user -u ${u?.name}`;
      if (m.stopsHost && u) {
        await must(hostUnitArgv(u, "stop", uid), `nothing was migrated, and the host runs on; ${hostUnitCommand(u, "stop")} by hand, and see ${logs}`, { env, timeoutMs: 30_000, onLine: child });
        // Gone: its unit's job stopped and nothing answering, so the migration's ownership check finds the file free.
        const gone = async () => (await unitState(u)).active !== true && !(await hostLive(f.host.socket));
        if (!(await waitFor(gone, 30_000))) throw new StepFailed(`${u.kind} stopped ${u.name}, but the host still runs after 30s`, `nothing was migrated; see ${logs}, then rerun ep0ch install --apply`);
        say(`stopped the outline host (${u.kind} ${u.name}) to migrate`);
      }
      // Found again now that nothing serves them: an outline made while the backup and the update ran is migrated too,
      // and one that can't take the step stops it before any is changed.
      const found = outlinesToMigrate(m, f.host.folder);
      if (found.blocked.length) {
        throw new StepFailed(`not migrating: ${found.blocked.map(o => o.version === null ? `${o.name}'s schema version can't be read (${o.error})` : `${o.name} is schema ${o.version}, too old for ${m.from} → ${m.to}`).join("; ")}`,
          `nothing was migrated; the outline host is left stopped. Move ${found.blocked.length === 1 ? "it" : "each"} aside and import it once the rest is migrated: ${found.blocked.map(o => { const old = `${o.path}.schema-${o.version ?? "old"}`; return `mv ${sh(o.path)} ${sh(old)}; ep0ch install --apply; ep0ch outline import ${sh(old)} ${o.name}`; }).join("; ")}`);
      }
      const added = found.outlines.filter(o => !m.outlines.some(p => p.path === o.path));
      if (added.length) say(`${added.map(o => o.name).join(", ")} appeared since the plan: migrated too`);
      const todo = found.outlines;
      const done: typeof m.outlines = [];
      for (const [i, o] of todo.entries()) {
        task.count(i, todo.length, o.name);
        task.flush();
        // An exact copy first: the host is stopped, so it holds every write (the backup step's may have missed the last).
        if (o.copy) {
          try { mkdirSync(dirname(o.copy), { recursive: true, mode: 0o700 }); backupDatabase(o.path, o.copy); }
          catch (e) { throw new StepFailed(`copying ${o.name} before its migration failed: ${(e as Error).message}`, `${o.name} wasn't migrated; ${migrationRecovery(f, m, null, done)}`); }
        }
        const r = await run([process.execPath, m.script, o.path], { cwd: f.repo.outliner, env, timeoutMs: 600_000, onLine: child });
        const now = outlineSchema(o).version;
        if (r.code !== 0 || now !== m.to) {
          const said = r.code !== 0 ? withoutProgress(r.err) || r.out || `exit ${r.code}` : `the script ended, but ${o.name} is schema ${now ?? "unreadable"}, not ${m.to}`;
          throw new StepFailed(`migrating ${o.name} (schema ${m.from} → ${m.to}) failed: ${said}`, migrationRecovery(f, m, { ...o, now }, done));
        }
        done.push(o);
        say(`${o.name}: schema ${m.from} → ${m.to}`);
      }
      return;
    }
    case "host": {
      const u = f.host.unit!;
      // A unit whose job runs is restarted, answering or not: starting it would do nothing.
      const verb = hostVerb(f);
      const logs = u.kind === "launchd" ? `launchctl print gui/${process.getuid?.() ?? 0}/${u.name} (and its StandardErrorPath)` : `journalctl --user -u ${u.name}`;
      // Its process now, just before the command: the one a new process replaces.
      const was = (await unitState(u)).pid;
      await must(hostUnitArgv(u, verb, process.getuid?.() ?? 0), `the host wasn't ${verb}ed; ${hostUnitCommand(u, verb)} by hand, and see ${logs}`, { env, timeoutMs: 30_000, onLine: child });
      // The host answering (hostReady, with a slower grace after 30s before it's called a failure).
      if (!(await hostReady(f, verb, was, 30_000))) throw new StepFailed(`${u.kind} ${verb}ed ${u.name}, but nothing answers at ${f.host.socket} after 40s`, `see ${logs}; the doors on it wait and reconnect once it answers`);
      const now = await hostFacts(f.host.folder, f.platform, f.home);
      const missing = now.running ? staleness(now, f.repo.protocol) : ["no answer"];
      if (missing.length) throw new StepFailed(`the host ${verb}ed but still runs ${missing.join(", ")}`, `check that ${u.path} runs ${hostMainOf(f)}, then ${hostUnitCommand(u, "restart")}`);
      say(`${verb}ed the outline host (${u.kind} ${u.name}${now.protocol ? `, protocol ${now.protocol}` : ""}); doors and panes on it reconnect`);
      return;
    }
  }
}

/**
 * The outlines to migrate, read again once the host is stopped (PIE-617): every `<name>.sqlite` in the folder at the
 * step's `from` (one the plan didn't see too, copied into the same folder as the rest), and `blocked`, any below the
 * step or unreadable, which stop the step before anything is changed. One already at `to` or newer is left alone.
 */
export function outlinesToMigrate(m: Migration, folder: string): { outlines: Migration["outlines"]; blocked: OutlineSchema[] } {
  const all = databases(folder).map(outlineSchema);
  const outlines = all.filter(o => o.version === m.from).map(o => ({ name: o.name, path: o.path,
    ...(m.outlines.find(p => p.path === o.path)?.copy ? { copy: m.outlines.find(p => p.path === o.path)!.copy } : m.copyDir ? { copy: join(m.copyDir, `${o.name}.schema-${m.from}.sqlite`) } : {}) }));
  return { outlines, blocked: all.filter(o => o.version === null || o.version < m.from) };
}

/**
 * What to do when an outline's migration fails (PIE-617). The host is left stopped: started on the new code it would
 * serve the outlines already migrated and refuse this one (half the outlines, and every door on this one erroring);
 * started on the code before, it would need the live checkout moved back and the migrated outlines restored from their
 * backups, two changes install never makes on its own. Stopped, the doors wait and reconnect, and one rerun of install
 * after the fix migrates what's left and starts it; going back is said too, with the exact commands.
 */
export function migrationRecovery(f: Facts, m: Migration, failed: (Migration["outlines"][number] & { now: number | null }) | null, done: readonly Migration["outlines"][number][]): string {
  const u = f.host.unit;
  const start = u ? hostUnitCommand(u.kind === "launchd" ? { ...u, state: { active: false, detail: "not loaded in launchd" } } : u, "start") : `bun ${sh(hostMainOf(f))}`;
  // Going back puts every outline its script ran on back from its copy (the failed one too: a script that failed
  // should have changed nothing, but that isn't proof), each step only after the one before it worked.
  const restore = [...done, ...(failed ? [failed] : [])].filter(o => o.copy).map(o => `cp ${sh(o.copy!)} ${sh(o.path)}`);
  const back = m.before ? [`git -C ${sh(f.repo.root)} reset --hard ${m.before}`, ...restore, start].join(" && ") : null;
  return [
    ...(failed ? [`${failed.name}'s script failed; it runs in one transaction, so the file should be as it was (it reads schema ${failed.now ?? "unreadable"})${failed.copy ? `, and its copy from just before is ${failed.copy}` : ""}`] : []),
    ...(done.length ? [`${done.map(o => o.name).join(", ")} ${done.length === 1 ? "is" : "are"} at schema ${m.to}`] : []),
    `the outline host is left stopped, so no outline is served half-migrated; the doors on it wait and reconnect`,
    `fix it, then ep0ch install --apply migrates what's left and starts the host`,
    ...(back ? [`or go back to the code before: ${back}`] : []),
  ].join("; ");
}

/** Paths under the home directory as ~/…, for people (--json keeps them whole). */
export const tilde = (text: string, home: string) => (home.length > 1 ? text.split(`${home}/`).join("~/").replace(new RegExp(`${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|\\s|\\))`, "gm"), "~") : text);

export interface SetupIO {
  out: (s: string) => void; err: (s: string) => void; env?: Env; now?: Date; platform?: string;
  /** The ep0ch checkout (default: the one this door runs from); `cwd`, the folder doctor's "this folder" is about. */
  repoRoot?: string; cwd?: string;
  /** The terminal the person watches (process.stdout): live progress when it's a TTY. */
  terminal?: Terminal;
  /** The reporter, made by a test; otherwise made from the terminal. */
  progress?: Progress;
  /** Program status (OSC 7501) for the terminal, made by a test; otherwise found for this terminal when it applies. */
  status?: StatusEmitter;
  /** Asks the person this machine's name (the suggestion is the default): only at a terminal. Answers a valid name, or undefined. */
  ask?: (suggested: string) => Promise<string | undefined>;
}

export async function setupCommand(args: readonly string[], io: SetupIO = { out: console.log, err: console.error }): Promise<number> {
  const json = args.includes("--json");
  const env = io.env ?? process.env;
  // `--machine-name <name>` (or `=<name>`): this machine's own name, written by the name step.
  const at = args.findIndex(a => a === "--machine-name" || a.startsWith("--machine-name="));
  const machineName = at < 0 ? undefined : args[at]!.includes("=") ? args[at]!.slice("--machine-name=".length) : args[at + 1];
  let rest = at < 0 ? args : args.filter((_, i) => i !== at && !(i === at + 1 && !args[at]!.includes("=")));
  if (at >= 0 && !isMachineName(machineName)) { io.err(`ep0ch: --machine-name takes a machine name, the ssh name other machines reach this one by (letters, digits, . _ -; up to 32); got ${JSON.stringify(machineName ?? "")}`); return 2; }
  let clientChange: { name: string; add: boolean } | undefined;
  for (const flag of ["--add-client", "--remove-client"]) {
    const i = rest.findIndex(a => a === flag || a.startsWith(flag + "="));
    if (i < 0) continue;
    const name = rest[i]!.includes("=") ? rest[i]!.slice(flag.length + 1) : rest[i + 1];
    if (clientChange || !isMachineName(name) || args[0] !== "install" || args.includes("--as-client")) { io.err(`ep0ch: ${flag} takes one ssh name; ${SETUP_USAGE}`); return 2; }
    clientChange = { name, add: flag === "--add-client" };
    rest = rest.filter((_, n) => n !== i && !(n === i + 1 && !rest[i]!.includes("=")));
  }
  // `--dials-in`: this machine calls the others for EchoNet and is never called; `--no-dials-in` undoes it.
  const dials = rest.includes("--dials-in") ? true : rest.includes("--no-dials-in") ? false : undefined;
  const unknown = rest.slice(1).filter(a => !["--json", "--apply", "--fix", "--move-scripts", "--backups", "--dials-in", "--no-dials-in", "--as-client"].includes(a));
  if ((args.includes("--move-scripts") && !args.includes("--fix")) || (args[0] !== "doctor" && args.includes("--fix")) || unknown.length || (rest.includes("--dials-in") && rest.includes("--no-dials-in")) || (args[0] === "doctor" && (args.includes("--apply") || args.includes("--as-client") || at >= 0 || dials !== undefined)) || (args[0] !== "doctor" && args.includes("--backups"))) { io.err(`ep0ch: ${SETUP_USAGE}`); return 2; }
  const home = resolve(env.HOME || homedir());
  if (!json) { const { out, err } = io; io = { ...io, out: s => out(tilde(s, home)), err: s => err(tilde(s, home)) }; }
  const progress = io.progress ?? new Progress({ mode: progressMode({ json, terminal: io.terminal, env }), out: io.out, terminal: io.terminal, env, tidy: s => tilde(s, home) });
  // Ctrl+C: the running step's line says it was interrupted, the cursor comes back, and which step it was.
  // What --apply is doing, to a terminal that speaks the Program Status Protocol (OSC 7501): a door's tile, Ghostty.
  const status = io.status ?? (args.includes("--apply") && progress.mode === "live" ? await programStatusEmitter("ep0ch-install", { env }) : null);
  const interrupted = () => {
    status?.report({ state: "idle", msg: "install interrupted" });
    const head = progress.interrupt();
    io.err(head?.lead ? `interrupted at step ${head.lead} (${head.title}): it may not have finished; ep0ch install shows where things stand`
      : head ? `interrupted while ${head.title.toLowerCase()}` : "interrupted");
    stopRunning();   // the running step's command is in its own process group: the terminal's SIGINT didn't reach it
    process.exit(130);
  };
  if (io.terminal) process.on("SIGINT", interrupted);
  try { return await setup(rest, io, env, json, progress, status, machineName, dials, clientChange); }
  finally {
    progress.close();
    if (io.terminal) process.off("SIGINT", interrupted);
  }
}

async function setup(args: readonly string[], io: SetupIO, env: Env, json: boolean, progress: Progress, status: StatusEmitter | null, machineName?: string, dials?: boolean, clientChange?: { name: string; add: boolean }): Promise<number> {
  // Checking the stack (git fetches among it) can take a while on a slow link: a phase, gone once it's done.
  const checking = progress.task({ mark: "·", title: "Checking the stack", transient: true });
  const facts = await gatherFacts({ env, repoRoot: io.repoRoot, platform: io.platform, cwd: io.cwd,
    ...(args[0] === "doctor" ? { backups: args.includes("--backups") ? "restore" as const : "check" as const } : {}),
    onProgress: p => checking.count(p.done, p.total, p.waiting.length ? `waiting on ${p.waiting.join(", ")}` : undefined), onLine: checking.child });
  checking.end(true);
  if (args[0] === "doctor") {
    let repaired: string[] = [];
    if (args.includes("--fix")) {
      repaired = fixOutlineFiles(facts.outlineFiles ?? [], { moveScripts: args.includes("--move-scripts") });
      facts.outlineFiles = outlineFiles(io.cwd ?? process.cwd(), facts.host.folder);
    }
    const report = doctorReport(facts);
    io.out(json ? JSON.stringify({ ...report, repaired }, null, 2) : [...repaired, formatDoctor(facts, report.checks)].join("\n"));
    return report.ok ? 0 : 1;
  }
  const apply = args.includes("--apply");
  if (facts.machineName) {
    // Unnamed and at a terminal: asked once, the short host name offered (Enter takes it). Named, it isn't asked again.
    const asked = !machineName && apply && !json && !facts.machineName.configured && !facts.machineName.env && io.ask ? await io.ask(facts.machineName.suggested) : undefined;
    const chosen = machineName ?? asked;
    if (chosen) facts.machineName.chosen = chosen;
  }
  if (facts.dialsIn && dials !== undefined) facts.dialsIn.chosen = dials;
  if (!args.includes("--as-client")) {
    const file = join(facts.host.folder, ".host", "clients");
    const configured = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
    const invalid = configured.find(name => !isMachineName(name));
    if (invalid) { io.err(`ep0ch: ${file} has an invalid ssh name ${JSON.stringify(invalid)}; edit it to one ssh name per line`); return 2; }
    const names = [...new Set(configured)];
    if (clientChange?.add && !names.includes(clientChange.name)) names.push(clientChange.name);
    if (clientChange && !clientChange.add) names.splice(0, names.length, ...names.filter(n => n !== clientChange.name));
    facts.installClients = { file, names, changed: names.join("\n") !== configured.join("\n") };
  }
  const options: PlanOptions = { now: io.now ?? new Date(), backupDir: backupDirOf(facts.home) };
  const plan = buildPlan(facts, options);
  if (!apply) {
    io.out(json ? JSON.stringify({ platform: facts.platform, apply: false, steps: plan.steps, notes: plan.notes }, null, 2) : formatPlan(facts, plan, false));
    return 0;
  }
  const say = (s: string) => progress.line(s);
  say(`ep0ch install · ${facts.platform} · applying`);
  let deploy: Awaited<ReturnType<typeof startDeployRecord>> | undefined;
  let creatingRecord = false;
  const record = async (write: () => Promise<unknown>) => {
    try { await write(); }
    catch (e) {
      const warning = `deploy record could not be saved through ${facts.host.socket}: ${(e as Error).message}`;
      plan.notes.push(warning);
      say(`    ! ${warning}`);
    }
  };
  const beginRecord = () => record(async () => {
    deploy = await startDeployRecord(facts, env, io.cwd ?? process.cwd(), options.now, () => { creatingRecord = true; });
    say(`    deploy record: ${deploy.id}`);
    if (json) plan.notes.push(`deploy record: ((${deploy.id}))`);
  });
  if (!args.includes("--as-client") && facts.host.running) await beginRecord();
  const results: (Step & { done?: string[]; error?: string; recover?: string })[] = [];
  let current = facts;
  for (const [i, planned] of plan.steps.entries()) {
    let step = planned;
    // The host: asked again after the checkout updated (its code may speak a new protocol), and restarted because of it.
    // After a migration too: the schema step stopped it, and it's started.
    if (step.id === "host" && plan.steps.some(s => (s.id === "repo" || s.id === "schema") && s.status === "do")) {
      const code = await pluginCode(current.repo.outliner);
      const host = await hostFacts(current.host.folder, current.platform, current.home);
      current = { ...current, repo: { ...current.repo, protocol: code.protocol }, host };
      step = hostStep(current, current.repo.checkout.behind > 0);
    }
    // The backup job's units: from the templates the updated checkout has.
    if (step.id === "backups" && plan.steps.some(s => s.id === "repo" && s.status === "do") && current.restic) {
      const { backupSetupFacts } = await import("../backup/setup");
      const { backupsStep } = await import("./plan");
      const pathDirs = current.pathDirs;
      current = { ...current, restic: await backupSetupFacts({ platform: current.platform, home: current.home, env, bun: current.bun.path, main: current.repo.entry, repoRoot: current.repo.root, run, which: n => Bun.which(n, { PATH: pathDirs.join(":") }) }) };
      step = backupsStep(current) ?? step;
    }
    // The MCP gateway: asked again after the checkout updated (its unit and state now), restarted because of it.
    if (step.id === "mcp" && plan.steps.some(s => s.id === "repo" && s.status === "do")) {
      current = { ...current, mcp: await mcpFacts(current.platform, current.home, current.repo.root) };
      step = current.mcp ? mcpStep(current, current.repo.checkout.behind > 0) : { ...step, status: "skip", why: "the MCP gateway's unit is gone" };
    }
    if (step.status !== "do") { stepLines(step, i, current, true).forEach(l => say(l)); results.push(step); continue; }
    status?.report({ state: "working", progress: Math.round((i / plan.steps.length) * 100), msg: `step ${i + 1} of ${plan.steps.length}: ${step.title}` });
    const task = progress.task({ lead: `${i + 1}`, mark: MARK.do, title: step.title });
    const done: string[] = [];
    try {
      if (step.id === "schema" && deploy) await record(() => deploy!.local(`running: ${step.title}; final outcome requires the host to return`));
      if (step.id === "clients" && deploy) await record(() => deploy!.local("local steps complete; installing clients"));
      await execute(step, current, env, task, done, deploy ? (name, line) => record(() => deploy!.client(name, line)) : undefined);
      if (step.id === "host" && !creatingRecord && !args.includes("--as-client")) await beginRecord();
      task.end(true);
      results.push({ ...step, done });
    } catch (e) {
      task.end(false);
      const error = (e as Error).message, recover = e instanceof StepFailed || e instanceof LinkFailed ? e.recover : "rerun ep0ch install to see the plan";
      results.push({ ...step, done, error, recover });
      if (deploy) await record(() => deploy!.local(`failed at ${step.title}: ${error}; ${recover}`));
      if (json) io.out(JSON.stringify({ platform: facts.platform, apply: true, ok: false, steps: results, notes: plan.notes }, null, 2));
      else io.err(`    ✗ ${error}\n    recover: ${recover}\n    stopped: nothing after step ${i + 1} ran`);
      status?.report({ state: "error", msg: `step ${i + 1} (${step.title}) failed: ${error}` });
      return 1;
    }
  }
  const waiting = results.filter(s => s.status === "manual");
  const clientBlocked = args.includes("--as-client") && results.some(s => s.id === "repo" && (s.status === "manual" || s.unchecked));
  if (deploy) await record(() => deploy!.local(waiting.length ? `finished; needs attention: ${waiting.map(s => `${s.title}: ${s.why}`).join("; ")}` : "finished"));
  status?.report({ state: "done", msg: results.some(s => s.done) ? `installed${waiting.length ? `; ${waiting.length} step${waiting.length === 1 ? "" : "s"} left for you` : ""}` : "nothing to do" });
  if (json) io.out(JSON.stringify({ platform: facts.platform, apply: true, ok: !clientBlocked, steps: results, notes: plan.notes }, null, 2));
  else {
    if (plan.notes.length) { say(""); say("not done by install:"); plan.notes.forEach(n => say(`  · ${n}`)); }
    say("");
    say(results.some(s => s.done) ? `done${waiting.length ? `; ${waiting.length} step${waiting.length === 1 ? "" : "s"} left for you (! above)` : ""}` : `nothing to do${waiting.length ? `; ${waiting.length} step${waiting.length === 1 ? "" : "s"} left for you (! above)` : ""}`);
  }
  return clientBlocked ? 1 : 0;
}
