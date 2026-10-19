import type { RunbookPlan, RunbookStep } from "@ep0ch/outline-core/runbook";
import { readGroupSecrets } from "@ep0ch/outliner/extension-secrets";
import { scrubCredentials } from "@ep0ch/outline-core/secret-scrub";
import { keychainItem } from "@ep0ch/outliner/keychain";
import { clearPrivateForm, askInBar, type BarQuestion } from "./bar/ask";
import type { ExtOn } from "./extensions";
import { sshBin } from "./machine";
import type { Actor } from "./socket";
import { ActionRefused, actionSet, asActor, def } from "./surface/actions";
import type { TileJob, TileProgram } from "./term";

type Context = ExtOn["ctx"] & { inTile?(p: TileProgram, done: (code: number | null) => void): boolean };
interface Walk { key: string; ctx: Context; actor: Actor; steps: RunbookStep[]; at: number; job?: TileJob; stopped: boolean; paused: boolean; pending?: () => Promise<void> }
const walks = new Map<string, Walk>();
/** Plans and private form answers are in this daemon only; a handover would lose them. */
export const runbookActive = () => walks.size > 0;
const keyOf = (actor: Actor) => actor.kind === "user" ? "person" : actor.id;
/** One walk per run: a single step's [run] is its own walk (its own terminal tile), "run all" one walk for the runbook.
 *  The person orchestrates; only the same step (or the same runbook's run-all) running twice is refused. */
const walkKey = (actor: Actor, plan: RunbookPlan) => `${keyOf(actor)}:${plan.steps.length === 1 ? plan.steps[0]!.block : `all:${plan.steps[0]?.root ?? plan.steps[0]?.block}`}`;
/** The actor's walk an action without a step means: the paused one, else the newest. */
const walkOf = (actor: Actor) => { const mine = [...walks.values()].filter(w => keyOf(w.actor) === keyOf(actor)); return mine.find(w => w.paused) ?? mine.at(-1); };
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export async function runBook(ctx: Context, plan: RunbookPlan, actor: Actor) {
  const key = walkKey(actor, plan);
  if (walks.has(key)) throw new ActionRefused(plan.steps.length === 1 ? "this step is already running; runbook.stop stops it" : "this runbook is already running; runbook.stop stops it");
  const walk: Walk = { key, ctx, actor, steps: plan.steps, at: 0, stopped: false, paused: false };
  walks.set(key, walk);
  try { return await next(walk); } catch (e) { walks.delete(key); throw e; }
}

async function record(w: Walk, step: RunbookStep, status: string, output: string, exit?: number) {
  await w.ctx.board.actExtension("runbook", "record", { blockId: step.block, args: { status, output, ...(exit === undefined ? {} : { exit: String(exit) }) } }, w.actor);
}

async function next(w: Walk): Promise<unknown> {
  if (w.stopped) return { stopped: true };
  const step = w.steps[w.at];
  if (!step) { walks.delete(w.key); asActor(w.ctx, w.actor).flash("Runbook: finished"); return { complete: true }; }
  const questions: BarQuestion[] = step.fields.map(f => ({ name: f.name, type: f.choices ? "choice" : "text", required: true, free: !f.choices,
    masked: f.secret, ...(f.file ? { kind: "file" } : {}), ...(f.choices ? { choices: f.choices } : {}), description: f.secret ? "secret, passed only in the environment" : f.name }));
  if (step.confirm) questions.push({ name: "confirm", type: "text", required: true, free: true, description: `type ${step.confirm} to run this step` });
  const given = Object.fromEntries(step.fields.filter(f => f.value !== undefined && !f.secret).map(f => [f.name, f.value!]));
  const check = (answers: Record<string, string>) => questions.find(q => answers[q.name] === undefined) ? "answer each required field" : step.confirm && answers.confirm !== step.confirm ? `type ${step.confirm} to confirm` : null;
  return askInBar(w.ctx, step.title, questions, given, w.actor, async answers => {
    const why = check(answers);
    if (why) throw new ActionRefused(why);
    try { return await execute(w, step, answers); }
    catch (error) { walks.delete(w.key); throw error; }
  }, questions.length ? { action: "ext.runbook.run-step", check, cancel: () => { w.stopped = true; walks.delete(w.key); } } : undefined);
}

async function execute(w: Walk, step: RunbookStep, answers: Record<string, string>) {
  if (w.stopped) return { stopped: true };
  const env: Record<string, string> = {};
  const secrets: string[] = [];
  for (const f of step.fields) {
    const value = answers[f.name]!;
    env[`RUNBOOK_${f.secret ? "SECRET" : "ASK"}_${f.name}`] = value;
    if (f.secret) secrets.push(value);
  }
  for (const group of step.mode === "terminal" ? step.secrets : []) {
    const values = await readGroupSecrets(group, "runbook", undefined, keychainItem);
    Object.assign(env, values); secrets.push(...Object.values(values));
  }
  if (step.keep && step.root) {
    for (const field of step.fields.filter(f => !f.secret)) {
      const { revision, tokens } = await w.ctx.board.propertyTokens(step.root, field.name);
      const token = tokens.find(t => t.scope === "block");
      await w.ctx.board.patchProperties(step.root, revision, [token ? { op: "replace", ordinal: token.ordinal, value: answers[field.name]! } : { op: "append", key: field.name, value: answers[field.name]! }], w.actor);
    }
  }
  let output = "";
  const decoder = new TextDecoder();
  const collect = (data: Uint8Array) => { output += decoder.decode(data, { stream: true }); };
  const cmd = step.on
    ? Object.keys(env).length ? [process.execPath, new URL("./runbook-ssh.ts", import.meta.url).pathname, step.on] : [sshBin(), "-tt", "--", step.on, step.command]
    : [process.env.SHELL || "/bin/sh", "-c", step.command];
  if (step.on) { env.RUNBOOK_COMMAND = step.command; env.RUNBOOK_ENV = JSON.stringify(env); }
  const finish = async (code: number | null) => {
    const clean = scrubCredentials(output + decoder.decode(), secrets) as string;
    output = ""; secrets.length = 0;
    w.pending = async () => {
      if (step.on && code === 255) {
        const shown = step.command.replace(/"\$\{RUNBOOK_(ASK|SECRET)_([A-Za-z_][A-Za-z0-9_]*)\}"/g, (_, kind: string, name: string) => kind === "SECRET" ? `'<enter ${name} in the terminal>'` : quote(answers[name]!));
        await record(w, step, "waiting", `Shown to paste on ${step.on}:\n${shown}\n${clean}`);
        w.pending = undefined;
        await pause(w, `Waiting for ${step.on}; the command is under the step. Continue tries it there again.`, false);
        return;
      }
      await record(w, step, code === 0 ? "ok" : "failed", clean, code ?? 130);
      w.pending = undefined;
      if (w.stopped) return;
      if (code !== 0) { await pause(w, `${step.title}: exit ${code ?? 130}`, true); return; }
      w.at++;
      if (step.close && w.at === w.steps.length) w.job?.dismiss();
      await next(w);
    };
    await savePending(w);
  };
  const ended = (code: number | null) => { void finish(code).catch(e => { asActor(w.ctx, w.actor).flash(`Runbook: ${e.message}; runbook.stop ends the walk`); }); };
  if (step.mode === "host") {
    const result = await w.ctx.board.actExtension("runbook", "host-step", { blockId: step.block, args: { ...answers, environment: JSON.stringify(env) } }, w.actor);
    output = result.runbookResult!.output;
    await finish(result.runbookResult!.exit);
    return { ran: step.block };
  }
  if (w.job) w.job.start(cmd, env, collect, ended);
  else if (!w.ctx.inTile?.({ cmd, name: "Runbook", own: env, retain: true, actor: w.actor, output: collect, ready: job => { w.job = job; } }, ended)) {
    throw new ActionRefused("open the runbook in a desk reader with room for a terminal tile, then run the step again");
  }
  return { running: step.block };
}

async function savePending(w: Walk) {
  try { await w.pending?.(); }
  catch (error) { if (!w.pending) throw error; await pause(w, `The command ended, but its record could not be saved: ${(error as Error).message}. Continue saves the record without running it again`, false); }
}

async function pause(w: Walk, message: string, advance: boolean) {
  if (w.stopped) return { stopped: true };
  w.paused = true;
  if (advance) w.at++;
  asActor(w.ctx, w.actor).flash(`${message}; runbook.continue or runbook.stop`);
  if (w.actor.kind !== "user") return { paused: true, message };
  return askInBar(w.ctx, message, [{ name: "next", type: "choice", choices: ["continue", "stop"], required: true }], {}, w.actor,
    answers => w.ctx.dispatch!.act({ action: `runbook.${answers.next}`, args: {} }, w.actor));
}

export const RUNBOOK_ACTIONS = actionSet<ExtOn>()("runbook", {
  "runbook.continue": def({ summary: "continue a runbook after a failed or waiting step", keys: "enter or a click on continue in the runbook form", touches: "nothing", replay: "ask", args: {},
    async run(_, _on, actor) { const w = walkOf(actor); if (!w?.paused) throw new ActionRefused("no runbook is paused"); w.paused = false; return w.pending ? savePending(w) : next(w); } }),
  "runbook.stop": def({ summary: "stop this actor's runbook walk and its running command", keys: "enter or a click on stop in the runbook form", touches: "nothing", replay: "ask", args: {},
    run(_, _on, actor) { const w = walkOf(actor); if (!w) throw new ActionRefused("no runbook is running"); w.stopped = true; if (actor.kind === "user") clearPrivateForm(); w.job?.stop(); walks.delete(w.key); return { stopped: true }; } }),
});
