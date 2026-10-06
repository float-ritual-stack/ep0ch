// `ep0ch doctor` and `ep0ch install [--apply]` (PIE-450). The dry run (the default) prints the plan; --apply runs
// its steps in order, each saying what it did, and stops at the first failure with the recovery. Outlines are only
// ever copied; no outline is created; no unit, Herdr config or plugin link is changed.
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, rmSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { formatDoctor, doctorReport } from "./doctor";
import { depsState, gatherFacts, hostFacts, type OnLine, pluginCode, pluginFacts, run, stopRunning, unitState } from "./facts";
import { clauses, Progress, progressMode, size, table, type Task, type Terminal } from "./progress";
import { type Facts, PLUGIN_SOURCE, short, staleness } from "./model";
import { backupDirOf, buildPlan, hostMainOf, hostStep, hostUnitArgv, hostUnitCommand, type Plan, type PlanOptions, repoStep, sessionName, sessionVerdict, type Step, type StepStatus } from "./plan";
import { hostLive } from "../discover";
import type { Handover } from "../session/client";
import { applyLinks, byFolder, LinkFailed, type LinkWork } from "./links";

type Env = Record<string, string | undefined>;
export const SETUP_USAGE = "ep0ch doctor [--backups] [--json] | ep0ch install [--apply] [--json]";

const MARK: Record<StepStatus, string> = { do: "→", skip: "✓", manual: "!" };

/** Copies a database consistently (VACUUM INTO, from a read-only connection) and checks the copy. */
export function backupDatabase(path: string, dest: string): { integrity: string } {
  // An existing file is never touched: not overwritten, and not removed when this copy fails.
  if (existsSync(dest)) throw new Error(`${dest} already exists; not overwritten`);
  try {
    const src = new Database(path, { readonly: true });
    try {
      // A reader of a WAL database rarely waits, but a service's checkpoint or recovery can hold it briefly.
      src.run("PRAGMA busy_timeout = 5000");
      src.run("VACUUM INTO ?", [dest]);
    } finally { src.close(); }
    chmodSync(dest, 0o600);
    const copy = new Database(dest, { readonly: true });
    try {
      const rows = copy.query("PRAGMA integrity_check").all() as { integrity_check: string }[];
      const verdict = rows.map(r => r.integrity_check).join("; ");
      if (verdict !== "ok") throw new Error(`the copy of ${path} failed its integrity check: ${verdict}`);
      return { integrity: verdict };
    } finally { copy.close(); }
  } catch (e) {
    // Only this copy (and the journal files SQLite may have left beside it) is removed; never the source.
    for (const f of [dest, `${dest}-journal`, `${dest}-wal`, `${dest}-shm`]) { try { rmSync(f, { force: true }); } catch { /* the report says what failed */ } }
    throw e;
  }
}

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
    say(`bun install in ${root} (${deps.why})`);
  }
  return changed.split("\n").filter(Boolean);
}

async function waitFor(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await Bun.sleep(250); }
  return false;
}

/** What a step runs, reported through its task: what it did (`say`), its children's output, its items. */
async function execute(step: Step, f: Facts, env: Env, task: Task, said: string[]): Promise<void> {
  // `said` is what --json reports, whole; the person sees the same as a ✓ line, or (record, then show) tidied up.
  const record = (s: string) => { said.push(s); };
  const show = (line: string) => task.say(line);
  const say = (s: string) => { record(s); show(`    ✓ ${s}`); };
  const child = task.child;
  switch (step.id) {
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
      const { ep0ch } = await import("../session/place");
      const rs = await upgradeAll();
      const handed = rs.filter(r => r.ok && r.handover);
      for (const r of rs) if (r.ok) { record(r.message); if (!r.handover) show(`    ✓ ${r.message}`); }
      if (handed.length) handoverLines(handed.map(r => r.handover!)).forEach(show);
      const failed = rs.filter(r => !r.ok);
      for (const r of failed) show(`    ✗ ${r.message}`);
      // One cause shared by every failure (a missing package after a pull, say) is said once, in the step's line.
      const causes = new Set(failed.map(r => / · ((?:error\b|.*Error\b|Cannot\b).*?)(?: · |$)/.exec(r.message)?.[1] ?? r.message));
      if (failed.length) throw new StepFailed(`handing ${failed.length === 1 ? "a door session" : `${failed.length} door sessions`} over failed${causes.size === 1 ? `: ${[...causes][0]}` : " (each above)"}`, `the sessions run on as they were; \`${ep0ch()}session upgrade --all\` tries again, and \`${ep0ch()}session list\` says what runs`);
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
    case "ext":
    case "skills": {
      if (!step.links) return;
      const done: string[] = [];
      try { applyLinks(step.links, s => { record(s); done.push(s); }); }
      catch (e) { done.forEach(s => show(`    ✓ ${s}`)); throw e; }
      linkSummary(step.links).forEach(show);
      return;
    }
    case "host": {
      const u = f.host.unit!;
      const verb = f.host.running ? "restart" : "start";
      const logs = u.kind === "launchd" ? `launchctl print gui/${process.getuid?.() ?? 0}/${u.name} (and its StandardErrorPath)` : `journalctl --user -u ${u.name}`;
      await must(hostUnitArgv(u, verb, process.getuid?.() ?? 0), `the host wasn't ${verb}ed; ${hostUnitCommand(u, verb)} by hand, and see ${logs}`, { env, timeoutMs: 30_000, onLine: child });
      // A new process answering: not the old one still shutting down (launchd's kickstart -k starts the new one after).
      const was = u.state?.pid;
      const back = await waitFor(async () => (was === undefined || (await unitState(u)).pid !== was) && !!(await hostLive(f.host.socket)), 30_000);
      if (!back) throw new StepFailed(`${u.kind} ${verb}ed ${u.name}, but nothing answers at ${f.host.socket} after 30s`, `see ${logs}; the doors on it wait and reconnect once it answers`);
      const now = await hostFacts(f.host.folder, f.platform, f.home);
      const missing = now.running ? staleness(now, f.repo.protocol) : ["no answer"];
      if (missing.length) throw new StepFailed(`the host ${verb}ed but still runs ${missing.join(", ")}`, `check that ${u.path} runs ${hostMainOf(f)}, then ${hostUnitCommand(u, "restart")}`);
      say(`${verb}ed the outline host (${u.kind} ${u.name}${now.protocol ? `, protocol ${now.protocol}` : ""}); doors and panes on it reconnect`);
      return;
    }
  }
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
}

export async function setupCommand(args: readonly string[], io: SetupIO = { out: console.log, err: console.error }): Promise<number> {
  const json = args.includes("--json");
  const env = io.env ?? process.env;
  const unknown = args.slice(1).filter(a => !["--json", "--apply", "--backups"].includes(a));
  if (unknown.length || (args[0] === "doctor" && args.includes("--apply")) || (args[0] !== "doctor" && args.includes("--backups"))) { io.err(`ep0ch: ${SETUP_USAGE}`); return 2; }
  const home = resolve(env.HOME || homedir());
  if (!json) { const { out, err } = io; io = { ...io, out: s => out(tilde(s, home)), err: s => err(tilde(s, home)) }; }
  const progress = io.progress ?? new Progress({ mode: progressMode({ json, terminal: io.terminal, env }), out: io.out, terminal: io.terminal, env, tidy: s => tilde(s, home) });
  // Ctrl+C: the running step's line says it was interrupted, the cursor comes back, and which step it was.
  const interrupted = () => {
    const head = progress.interrupt();
    io.err(head?.lead ? `interrupted at step ${head.lead} (${head.title}): it may not have finished; ep0ch install shows where things stand`
      : head ? `interrupted while ${head.title.toLowerCase()}` : "interrupted");
    stopRunning();   // the running step's command is in its own process group: the terminal's SIGINT didn't reach it
    process.exit(130);
  };
  if (io.terminal) process.on("SIGINT", interrupted);
  try { return await setup(args, io, env, json, progress); }
  finally {
    progress.close();
    if (io.terminal) process.off("SIGINT", interrupted);
  }
}

async function setup(args: readonly string[], io: SetupIO, env: Env, json: boolean, progress: Progress): Promise<number> {
  // Checking the stack (git fetches among it) can take a while on a slow link: a phase, gone once it's done.
  const checking = progress.task({ mark: "·", title: "Checking the stack", transient: true });
  const facts = await gatherFacts({ env, repoRoot: io.repoRoot, platform: io.platform, cwd: io.cwd,
    ...(args[0] === "doctor" ? { backups: args.includes("--backups") ? "restore" as const : "check" as const } : {}),
    onProgress: p => checking.count(p.done, p.total, p.waiting.length ? `waiting on ${p.waiting.join(", ")}` : undefined), onLine: checking.child });
  checking.end(true);
  if (args[0] === "doctor") {
    const report = doctorReport(facts);
    io.out(json ? JSON.stringify(report, null, 2) : formatDoctor(facts, report.checks));
    return report.ok ? 0 : 1;
  }
  const apply = args.includes("--apply");
  const options: PlanOptions = { now: io.now ?? new Date(), backupDir: backupDirOf(facts.home) };
  const plan = buildPlan(facts, options);
  if (!apply) {
    io.out(json ? JSON.stringify({ platform: facts.platform, apply: false, steps: plan.steps, notes: plan.notes }, null, 2) : formatPlan(facts, plan, false));
    return 0;
  }
  const say = (s: string) => progress.line(s);
  say(`ep0ch install · ${facts.platform} · applying`);
  const results: (Step & { done?: string[]; error?: string; recover?: string })[] = [];
  let current = facts;
  for (const [i, planned] of plan.steps.entries()) {
    let step = planned;
    // The host: asked again after the checkout updated (its code may speak a new protocol), and restarted because of it.
    if (step.id === "host" && plan.steps.some(s => s.id === "repo" && s.status === "do")) {
      const code = await pluginCode(current.repo.outliner);
      const host = await hostFacts(current.host.folder, current.platform, current.home);
      current = { ...current, repo: { ...current.repo, protocol: code.protocol }, host };
      step = hostStep(current, current.repo.checkout.behind > 0);
    }
    if (step.status !== "do") { stepLines(step, i, current, true).forEach(l => say(l)); results.push(step); continue; }
    const task = progress.task({ lead: `${i + 1}`, mark: MARK.do, title: step.title });
    const done: string[] = [];
    try {
      await execute(step, current, env, task, done);
      task.end(true);
      results.push({ ...step, done });
    } catch (e) {
      task.end(false);
      const error = (e as Error).message, recover = e instanceof StepFailed || e instanceof LinkFailed ? e.recover : "rerun ep0ch install to see the plan";
      results.push({ ...step, done, error, recover });
      if (json) io.out(JSON.stringify({ platform: facts.platform, apply: true, ok: false, steps: results, notes: plan.notes }, null, 2));
      else io.err(`    ✗ ${error}\n    recover: ${recover}\n    stopped: nothing after step ${i + 1} ran`);
      return 1;
    }
  }
  const waiting = results.filter(s => s.status === "manual");
  if (json) io.out(JSON.stringify({ platform: facts.platform, apply: true, ok: true, steps: results, notes: plan.notes }, null, 2));
  else {
    if (plan.notes.length) { say(""); say("not done by install:"); plan.notes.forEach(n => say(`  · ${n}`)); }
    say("");
    say(results.some(s => s.done) ? `done${waiting.length ? `; ${waiting.length} step${waiting.length === 1 ? "" : "s"} left for you (! above)` : ""}` : `nothing to do${waiting.length ? `; ${waiting.length} step${waiting.length === 1 ? "" : "s"} left for you (! above)` : ""}`);
  }
  return 0;
}
