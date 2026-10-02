// `ep0ch doctor` and `ep0ch install [--apply] [--restart-services]` (PIE-450). The dry run (the default)
// prints the plan; --apply runs its steps in order, each saying what it did, and stops at the first failure
// with the recovery. Databases are only ever copied; no outline is created or started; no unit is changed.
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, rmSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { formatDoctor, doctorReport } from "./doctor";
import { depsState, gatherFacts, hostFacts, type OnLine, pluginFacts, run, serviceFacts, stopRunning, unitState } from "./facts";
import { Progress, progressMode, size, type Task, type Terminal } from "./progress";
import { type Facts, PLUGIN_SOURCE, short, staleness } from "./model";
import { backupDirOf, buildPlan, hostStep, hostUnitArgv, hostUnitCommand, type Plan, type PlanOptions, restartStep, serviceLabel, type Step, type StepStatus } from "./plan";
import { hostRequest } from "../socket";
import { hostLive } from "../discover";

type Env = Record<string, string | undefined>;
export const SETUP_USAGE = "ep0ch doctor [--json] | ep0ch install [--apply] [--restart-services] [--json]";

const MARK: Record<StepStatus, string> = { do: "→", skip: "✓", manual: "!", offer: "?" };

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

/**
 * The Herdr pane running a folder service, confirmed by the Outliner's own `resolveServicePaneId`
 * (pane-control.ts): the recorded pane id is trusted only when that pane is still the service's terminal
 * on this Herdr (ids are reused after a Herdr restart), else the moved pane is found by its identity.
 * Null when it can't be confirmed; a pane that isn't confirmed is never closed.
 */
export async function confirmServicePane(pluginRoot: string, stateDir: string, herdr: string, env: Env): Promise<{ paneId: string | null; error?: string }> {
  const module = join(pluginRoot, "src/pane-control.ts");
  if (!existsSync(module)) return { paneId: null, error: `${module} is missing` };
  const r = await run([process.execPath, "-e",
    `const m = await import(${JSON.stringify(module)}); console.log(JSON.stringify(typeof m.resolveServicePaneId === "function" ? { paneId: m.resolveServicePaneId(${JSON.stringify(stateDir)}, ${JSON.stringify(herdr)}) } : { error: "the plugin has no resolveServicePaneId" }))`],
  { env, timeoutMs: 30_000 });
  try {
    const v = JSON.parse(r.out.split("\n").pop() ?? "");
    if (typeof v?.paneId === "string" && v.paneId) return { paneId: v.paneId };
    return { paneId: null, error: v?.error ?? "no Herdr pane on this Herdr is that service's" };
  } catch { return { paneId: null, error: r.err.split("\n").find(l => l.trim()) || `exit ${r.code}` }; }
}

export function formatPlan(f: Facts, plan: Plan, apply: boolean): string {
  const lines = [`ep0ch install · ${f.platform} · ${apply ? "applying" : "dry run: nothing changes; ep0ch install --apply runs the → steps"}`, ""];
  plan.steps.forEach((s, i) => lines.push(...stepLines(s, i, false)));
  if (plan.notes.length) lines.push("", "not done by install:", ...plan.notes.map(n => `  · ${n}`));
  return lines.join("\n");
}

/** A step as the plan shows it; while applying, its ✓ lines say what it did instead of the commands. */
function stepLines(s: Step, i: number, applying: boolean): string[] {
  const out = [`${i + 1} ${MARK[s.status]} ${s.title}`, `    ${s.why}`];
  if (applying && s.status === "do") return out;
  if (s.backups && s.status !== "skip") for (const b of s.backups) out.push(`    ${b.name}: ${b.path} → ${b.dest}`);
  for (const c of s.commands) if (!(s.backups && c.startsWith("sqlite3"))) out.push(`    $ ${c}`);
  return out;
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
  const say = (s: string) => { said.push(s); task.say(`    ✓ ${s}`); };
  const child = task.child;
  switch (step.id) {
    case "backup": {
      const backups = step.backups ?? [];
      const sizes = backups.map(b => { try { return statSync(b.path).size; } catch { return 0; } });
      const total = sizes.reduce((a, b) => a + b, 0);
      let copied = 0;
      for (const [i, b] of backups.entries()) {
        task.count(i, backups.length, `${b.name} ${size(sizes[i]!)}`, total ? { done: copied, total } : undefined);
        // The copy holds the event loop: draw what it's copying first.
        task.flush();
        try {
          mkdirSync(dirname(b.dest), { recursive: true, mode: 0o700 });
          const { integrity } = backupDatabase(b.path, b.dest);
          say(`${b.name}: ${b.path} → ${b.dest} (integrity ${integrity})`);
          copied += sizes[i]!;
        } catch (e) {
          throw new StepFailed(`backing up ${b.name} failed: ${(e as Error).message}`, `nothing was changed; check the disk and ${b.path}, then rerun ep0ch install --apply`);
        }
      }
      return;
    }
    case "plugin": {
      const p = f.plugin!;
      if (p.kind === "local") {
        const changed = await updateCheckout(p.root, "the plugin checkout", say, child, env);
        if (changed.includes("herdr-plugin.toml")) say(`its manifest changed: herdr plugin link ${p.root} --enabled refreshes Herdr's copy of it`);
        return;
      }
      const source = p.source?.owner && p.source.repo ? `${p.source.owner}/${p.source.repo}` : PLUGIN_SOURCE;
      const ref = "main";
      await must([f.herdr.path!, "plugin", "install", source, "--ref", ref, "--yes"],
        `Herdr keeps the previously installed copy registered; retry: herdr plugin install ${source} --ref ${ref} --yes (herdr plugin log shows the build)`, { env, onLine: child });
      const now = await pluginFacts({ ...env, HERDR_BIN_PATH: f.herdr.path! }, false);
      say(`reinstalled ${source}@${ref}${now?.source?.commit ? ` at ${short(now.source.commit)}` : ""}${now && now.root !== p.root ? ` (its root moved to ${now.root})` : ""}`);
      return;
    }
    case "door": {
      await updateCheckout(f.door.checkout.root, "the door checkout", say, child, env);
      return;
    }
    case "session": {
      // The daemon starts its successor from its checkout, now on the new code.
      const { upgradeSession } = await import("../session/client");
      const r = await upgradeSession();
      if (!r.ok) throw new StepFailed(`handing the door session over failed: ${r.message}`, "the session runs on as it was; `ep0ch session upgrade` tries again, and `ep0ch session list` says what runs");
      say(r.message);
      return;
    }
    case "link": {
      const dir = f.linkDirs.find(d => step.commands[0]?.endsWith(`${d.dir}/ep0ch`))?.dir;
      if (!dir) throw new StepFailed("no link directory chosen", "rerun ep0ch install to see the plan");
      const link = join(dir, "ep0ch");
      try {
        if (f.linkDirs.find(d => d.dir === dir)?.existing === "broken-link") unlinkSync(link);
        symlinkSync(f.door.entry, link);
      } catch (e) { throw new StepFailed(`linking ${link} failed: ${(e as Error).message}`, `link it by hand: ln -s ${f.door.entry} ${link}`); }
      say(`${link} → ${f.door.entry}`);
      return;
    }
    case "restart": {
      const pluginRoot = f.plugin!.root;
      const services = (step.services ?? []).filter(s => s.paneId && s.root);
      for (const [i, s] of services.entries()) {
        const label = serviceLabel(s);
        if (services.length > 1) task.count(i, services.length, label);
        // Only a pane the Outliner confirms is this service's is closed: a recorded id can name another pane now.
        const pane = await confirmServicePane(pluginRoot, s.stateDir, f.herdr.path!, env);
        if (!pane.paneId) throw new StepFailed(`couldn't confirm which Herdr pane runs the service for ${label} (${pane.error}); no pane was closed`, `stop the service by hand and reopen the Outliner in ${s.root}`);
        await must([f.herdr.path!, "pane", "close", pane.paneId], `the service for ${label} still runs; stop it in its pane (${pane.paneId}) and reopen the Outliner in ${s.root}`, { env });
        const stopped = await waitFor(async () => !(await hostRequest(s.socket, "ping", {}, 500).then(() => true, () => false)), 15_000);
        if (!stopped) throw new StepFailed(`the service for ${label} still answers after its pane closed`, `stop it by hand, then reopen the Outliner in ${s.root}`);
        const launchEnv: Env = { ...env, HERDR_ENV: "1", OUTLINER_OPEN_WORKSPACE_ROOT: s.root, HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_cwd: s.root }) };
        delete launchEnv.HERDR_PANE_ID;
        await must([process.execPath, "run", join(pluginRoot, "src/herdr-open.ts"), "--mode", "service-only"],
          `the old service stopped but the new one didn't start; reopen the Outliner in ${s.root} (its open key) to start it`, { env: launchEnv, timeoutMs: 90_000, onLine: child });
        const answer = await hostRequest<{ protocolVersion?: number; capabilities?: string[] }>(s.socket, "ping", {}, 3000).catch(() => null);
        const missing = answer ? staleness({ protocol: answer.protocolVersion, capabilities: answer.capabilities ?? null }, f.expected, f.plugin!.protocol) : ["no answer"];
        if (missing.length) throw new StepFailed(`${label} restarted but still lacks ${missing.join(", ")}`, `check ${s.stateDir}/service-startup-error.log, then reopen the Outliner in ${s.root}`);
        say(`restarted ${label} (protocol ${answer!.protocolVersion}); reopen its Tree and Detail panes`);
      }
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
      const now = await hostFacts(dirname(f.host.socket), f.platform, f.home);
      const missing = now.running ? staleness(now, f.expected, f.plugin?.protocol ?? null) : ["no answer"];
      if (missing.length) throw new StepFailed(`the host ${verb}ed but still lacks ${missing.join(", ")}`, `check that ${u.path} runs the installed plugin's src/host-main.ts, then ${hostUnitCommand(u, "restart")}`);
      say(`${verb}ed the outline host (${u.kind} ${u.name}${now.protocol ? `, protocol ${now.protocol}` : ""}); doors and panes on it reconnect`);
      return;
    }
  }
}

/** Paths under the home directory as ~/…, for people (--json keeps them whole). */
export const tilde = (text: string, home: string) => (home.length > 1 ? text.split(`${home}/`).join("~/").replace(new RegExp(`${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|\\s|\\))`, "gm"), "~") : text);

export interface SetupIO {
  out: (s: string) => void; err: (s: string) => void; env?: Env; now?: Date; doorRoot?: string; platform?: string;
  /** The terminal the person watches (process.stdout): live progress when it's a TTY. */
  terminal?: Terminal;
  /** The reporter, made by a test; otherwise made from the terminal. */
  progress?: Progress;
}

export async function setupCommand(args: readonly string[], io: SetupIO = { out: console.log, err: console.error }): Promise<number> {
  const json = args.includes("--json");
  const env = io.env ?? process.env;
  const unknown = args.slice(1).filter(a => !["--json", "--apply", "--restart-services"].includes(a));
  if (unknown.length || (args[0] === "doctor" && args.some(a => a === "--apply" || a === "--restart-services"))) { io.err(`ep0ch: ${SETUP_USAGE}`); return 2; }
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
  const facts = await gatherFacts({ env, doorRoot: io.doorRoot, platform: io.platform,
    onProgress: p => checking.count(p.done, p.total, p.waiting.length ? `waiting on ${p.waiting.join(", ")}` : undefined), onLine: checking.child });
  checking.end(true);
  if (args[0] === "doctor") {
    const report = doctorReport(facts);
    io.out(json ? JSON.stringify(report, null, 2) : formatDoctor(facts, report.checks));
    return report.ok ? 0 : 1;
  }
  const apply = args.includes("--apply");
  const options: PlanOptions = { restartServices: args.includes("--restart-services"), now: io.now ?? new Date(), backupDir: backupDirOf(facts.home) };
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
    // The plugin may have changed under the services: ask them again before deciding what to restart.
    if (step.id === "restart" && plan.steps.some(s => s.id === "plugin" && s.status === "do")) {
      const plugin = await pluginFacts({ ...env, HERDR_BIN_PATH: current.herdr.path ?? "herdr" }, false);
      const services = await serviceFacts(env.OUTLINER_STATE_DIR ?? join(current.home, ".local/state/pi-herdr-outliner"));
      current = { ...current, plugin, services, expected: plugin?.capabilities ?? current.expected };
      step = restartStep(current, options, false);
    }
    // The host too: asked again after the plugin update, and restarted because of it.
    if (step.id === "host" && plan.steps.some(s => s.id === "plugin" && s.status === "do")) {
      const plugin = current.plugin === facts.plugin ? await pluginFacts({ ...env, HERDR_BIN_PATH: current.herdr.path ?? "herdr" }, false) : current.plugin;
      const host = await hostFacts(dirname(current.host.socket), current.platform, current.home);
      current = { ...current, plugin, host, expected: plugin?.capabilities ?? current.expected };
      step = hostStep(current, true);
    }
    if (step.status !== "do") { stepLines(step, i, true).forEach(l => say(l)); results.push(step); continue; }
    const [head, ...body] = stepLines(step, i, true);
    const task = progress.task({ lead: `${i + 1}`, mark: MARK.do, title: head!.slice(`${i + 1} ${MARK.do} `.length), body });
    const done: string[] = [];
    try {
      await execute(step, current, env, task, done);
      task.end(true);
      results.push({ ...step, done });
    } catch (e) {
      task.end(false);
      const error = (e as Error).message, recover = e instanceof StepFailed ? e.recover : "rerun ep0ch install to see the plan";
      results.push({ ...step, done, error, recover });
      if (json) io.out(JSON.stringify({ platform: facts.platform, apply: true, ok: false, steps: results, notes: plan.notes }, null, 2));
      else io.err(`    ✗ ${error}\n    recover: ${recover}\n    stopped: nothing after step ${i + 1} ran`);
      return 1;
    }
  }
  const waiting = results.filter(s => s.status === "manual" || s.status === "offer");
  if (json) io.out(JSON.stringify({ platform: facts.platform, apply: true, ok: true, steps: results, notes: plan.notes }, null, 2));
  else {
    if (plan.notes.length) { say(""); say("not done by install:"); plan.notes.forEach(n => say(`  · ${n}`)); }
    say("");
    say(results.some(s => s.done) ? `done${waiting.length ? `; ${waiting.length} step${waiting.length === 1 ? "" : "s"} left for you (! and ? above)` : ""}` : `nothing to do${waiting.length ? `; ${waiting.length} step${waiting.length === 1 ? "" : "s"} left for you (! and ? above)` : ""}`);
  }
  return 0;
}
