// `ep0ch doctor` and `ep0ch install [--apply] [--restart-services]` (PIE-450). The dry run (the default)
// prints the plan; --apply runs its steps in order, each saying what it did, and stops at the first failure
// with the recovery. Databases are only ever copied; no outline is created or started; no unit is changed.
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { formatDoctor, doctorReport } from "./doctor";
import { depsState, gatherFacts, pluginFacts, run, serviceFacts } from "./facts";
import { type Facts, PLUGIN_SOURCE, short, staleness } from "./model";
import { backupDirOf, buildPlan, type Plan, type PlanOptions, restartStep, serviceLabel, type Step, type StepStatus } from "./plan";
import { hostRequest } from "../socket";

type Env = Record<string, string | undefined>;
export const SETUP_USAGE = "ep0ch doctor [--json] | ep0ch install [--apply] [--restart-services] [--json]";

const MARK: Record<StepStatus, string> = { do: "→", skip: "✓", manual: "!", offer: "?" };

/** Copies a database consistently (VACUUM INTO, from a read-only connection) and checks the copy. */
export function backupDatabase(path: string, dest: string): { integrity: string } {
  if (existsSync(dest)) throw new Error(`${dest} already exists; not overwritten`);
  const src = new Database(path, { readonly: true });
  try { src.run("VACUUM INTO ?", [dest]); } finally { src.close(); }
  chmodSync(dest, 0o600);
  const copy = new Database(dest, { readonly: true });
  try {
    const rows = copy.query("PRAGMA integrity_check").all() as { integrity_check: string }[];
    const verdict = rows.map(r => r.integrity_check).join("; ");
    if (verdict !== "ok") throw new Error(`the copy of ${path} failed its integrity check: ${verdict}`);
    return { integrity: verdict };
  } finally { copy.close(); }
}

export function formatPlan(f: Facts, plan: Plan, apply: boolean): string {
  const lines = [`ep0ch install · ${f.platform} · ${apply ? "applying" : "dry run: nothing changes; ep0ch install --apply runs the → steps"}`, ""];
  plan.steps.forEach((s, i) => lines.push(...stepLines(s, i)));
  if (plan.notes.length) lines.push("", "not done by install:", ...plan.notes.map(n => `  · ${n}`));
  return lines.join("\n");
}

function stepLines(s: Step, i: number): string[] {
  const out = [`${i + 1} ${MARK[s.status]} ${s.title}`, `    ${s.why}`];
  if (s.backups && s.status !== "skip") for (const b of s.backups) out.push(`    ${b.name}: ${b.path} → ${b.dest}`);
  for (const c of s.commands) if (!(s.backups && c.startsWith("sqlite3"))) out.push(`    $ ${c}`);
  return out;
}

class StepFailed extends Error { constructor(message: string, readonly recover: string) { super(message); } }

async function must(cmd: string[], recover: string, opts: { cwd?: string; env?: Env; timeoutMs?: number } = {}): Promise<string> {
  const r = await run(cmd, { timeoutMs: 300_000, ...opts });
  if (r.code !== 0) throw new StepFailed(`${cmd.join(" ")} failed: ${r.err || r.out || `exit ${r.code}`}`, recover);
  return r.out;
}

/** Fast-forwards a checkout, then installs its packages when the pull (or anything before) left them stale. */
async function updateCheckout(root: string, name: string, say: (s: string) => void, env: Env) {
  const before = (await run(["git", "-C", root, "rev-parse", "HEAD"], { env })).out;
  await must(["git", "-C", root, "pull", "--ff-only", "origin", "main"], `nothing was merged (--ff-only); see git -C ${root} status, fix it, and rerun ep0ch install`, { env });
  const after = (await run(["git", "-C", root, "rev-parse", "HEAD"], { env })).out;
  say(before === after ? `${name} already at ${short(after)}` : `${name} fast-forwarded ${short(before)} → ${short(after)}`);
  const changed = before === after ? "" : (await run(["git", "-C", root, "diff", "--name-only", before, after], { env })).out;
  const deps = depsState(root);
  if (deps.needed) {
    await must([process.execPath, "install", "--frozen-lockfile"], `the checkout is updated; install its packages by hand: (cd ${root} && bun install --frozen-lockfile)`, { cwd: root, env });
    say(`bun install in ${root} (${deps.why})`);
  }
  return changed.split("\n").filter(Boolean);
}

async function waitFor(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await Bun.sleep(250); }
  return false;
}

async function execute(step: Step, f: Facts, env: Env, say: (s: string) => void): Promise<void> {
  switch (step.id) {
    case "backup": {
      const dir = backupDirOf(f.home);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      for (const b of step.backups ?? []) {
        try { const { integrity } = backupDatabase(b.path, b.dest); say(`${b.name}: ${b.path} → ${b.dest} (integrity ${integrity})`); }
        catch (e) {
          try { rmSync(b.dest, { force: true }); } catch { /* keep going to the report */ }
          throw new StepFailed(`backing up ${b.name} failed: ${(e as Error).message}`, `nothing was changed; check the disk and ${b.path}, then rerun ep0ch install --apply`);
        }
      }
      return;
    }
    case "plugin": {
      const p = f.plugin!;
      if (p.kind === "local") {
        const changed = await updateCheckout(p.root, "the plugin checkout", say, env);
        if (changed.includes("herdr-plugin.toml")) say(`its manifest changed: herdr plugin link ${p.root} --enabled refreshes Herdr's copy of it`);
        return;
      }
      const source = p.source?.owner && p.source.repo ? `${p.source.owner}/${p.source.repo}` : PLUGIN_SOURCE;
      const ref = p.source?.ref ?? "main";
      await must([f.herdr.path!, "plugin", "install", source, "--ref", ref, "--yes"],
        `Herdr keeps the previously installed copy registered; retry: herdr plugin install ${source} --ref ${ref} --yes (herdr plugin log shows the build)`, { env });
      const now = await pluginFacts({ ...env, HERDR_BIN_PATH: f.herdr.path! }, false);
      say(`reinstalled ${source}@${ref}${now?.source?.commit ? ` at ${short(now.source.commit)}` : ""}${now && now.root !== p.root ? ` (its root moved to ${now.root})` : ""}`);
      return;
    }
    case "door": {
      await updateCheckout(f.door.checkout.root, "the door checkout", say, env);
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
      for (const s of step.services ?? []) {
        if (!s.paneId || !s.root) continue;
        const label = serviceLabel(s);
        await must([f.herdr.path!, "pane", "close", s.paneId], `the service for ${label} still runs; stop it in its pane (${s.paneId}) and reopen the Outliner in ${s.root}`, { env });
        const stopped = await waitFor(async () => !(await hostRequest(s.socket, "ping", {}, 500).then(() => true, () => false)), 15_000);
        if (!stopped) throw new StepFailed(`the service for ${label} still answers after its pane closed`, `stop it by hand, then reopen the Outliner in ${s.root}`);
        const launchEnv: Env = { ...env, HERDR_ENV: "1", OUTLINER_OPEN_WORKSPACE_ROOT: s.root, HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_cwd: s.root }) };
        delete launchEnv.HERDR_PANE_ID;
        await must([process.execPath, "run", join(pluginRoot, "src/herdr-open.ts"), "--mode", "service-only"],
          `the old service stopped but the new one didn't start; reopen the Outliner in ${s.root} (its open key) to start it`, { env: launchEnv, timeoutMs: 90_000 });
        const answer = await hostRequest<{ protocolVersion?: number; capabilities?: string[] }>(s.socket, "ping", {}, 3000).catch(() => null);
        const missing = answer ? staleness({ protocol: answer.protocolVersion, capabilities: answer.capabilities ?? null }, f.expected, f.plugin!.protocol) : ["no answer"];
        if (missing.length) throw new StepFailed(`${label} restarted but still lacks ${missing.join(", ")}`, `check ${s.stateDir}/service-startup-error.log, then reopen the Outliner in ${s.root}`);
        say(`restarted ${label} (protocol ${answer!.protocolVersion}); reopen its Tree and Detail panes`);
      }
      return;
    }
  }
}

export interface SetupIO { out: (s: string) => void; err: (s: string) => void; env?: Env; now?: Date; doorRoot?: string; platform?: string }

export async function setupCommand(args: readonly string[], io: SetupIO = { out: console.log, err: console.error }): Promise<number> {
  const json = args.includes("--json");
  const env = io.env ?? process.env;
  const unknown = args.slice(1).filter(a => !["--json", "--apply", "--restart-services"].includes(a));
  if (unknown.length || (args[0] === "doctor" && args.some(a => a === "--apply" || a === "--restart-services"))) { io.err(`ep0ch: ${SETUP_USAGE}`); return 2; }
  const facts = await gatherFacts({ env, doorRoot: io.doorRoot, platform: io.platform });
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
  const say = (s: string) => { if (!json) io.out(s); };
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
    stepLines(step, i).forEach(l => say(l));
    const done: string[] = [];
    if (step.status !== "do") { results.push(step); continue; }
    try {
      await execute(step, current, env, s => { done.push(s); say(`    ✓ ${s}`); });
      results.push({ ...step, done });
    } catch (e) {
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
