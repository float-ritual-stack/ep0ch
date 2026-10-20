import { errorDetails } from "./status-log";
import { hostname } from "node:os";
import { stat } from "node:fs/promises";
import type { RunbookPlan, RunbookStep, RunbookStatus } from "@ep0ch/outline-core/runbook";
import { plainText, scrubCredentials } from "@ep0ch/outline-core/secret-scrub";
import { askInBar, type BarQuestion } from "./bar/ask";
import { alive } from "./state";
import { prop } from "./props";
import type { ExtOn } from "./extensions";
import type { Actor } from "./socket";
import { ActionRefused, actionSet, asActor, def } from "./surface/actions";
import type { TileJob, TileProgram } from "./term";

type Context = ExtOn["ctx"] & { inTile?(p: TileProgram, done: (code: number | null) => void): boolean };
interface Run { key: string; ctx: Context; actor: Actor; step: RunbookStep; record: string; at: string; cwd: string; state: RunbookStatus; secrets: string[]; writes: Promise<void>; job?: TileJob }
const runs = new Map<string, Run>();
let closing = false;
const keyOf = (step: RunbookStep) => `${step.root}:${step.anchor}`;

export async function runBook(ctx: Context, plan: RunbookPlan, actor: Actor, given: Record<string, string> = {}) {
  if (closing) throw new ActionRefused("The door is restarting; run this step again after it reconnects.");
  const step = plan.steps[0]!;
  const running = runs.get(keyOf(step));
  if (running) return askInBar(ctx, `${step.title} is running`, [{ name: "run", label: "", type: "choice", choices: ["focus its tile", "stop it"], required: true }], {}, actor, async answers => {
    if (answers.run === "stop it") return stop(running);
    return running.job?.focus(actor);
  });
  const questions: BarQuestion[] = step.fields.map(f => ({ name: f.name, label: f.name.replace(/^(ask|secret)\./, ""), type: f.choices ? "choice" : "text", required: true, free: !f.choices, masked: f.secret,
    ...(f.choices ? { choices: f.choices } : {}), description: f.secret ? "secret, passed only in the environment" : f.name }));
  if (actor.kind === "agent" && questions.some(q => given[q.name] === undefined)) throw new ActionRefused(`Supply ${questions.filter(q => given[q.name] === undefined).map(q => q.name).join(", ")} in with= before running this step.`);
  return askInBar(ctx, `${step.title} needs`, questions, given, actor, answers => execute(ctx, step, actor, answers));
}

function record(run: Run, status: RunbookStatus, output = "", exit?: number): Promise<void> {
  run.state = status;
  const cwd = scrubCredentials(run.cwd, run.secrets) as string;
  run.writes = run.writes.then(async () => {
    const { step } = run;
    const result = await run.ctx.board.actExtension("runbook", "record", { blockId: step.block, args: {
      step: JSON.stringify({ root: step.root, block: step.block, anchor: step.anchor, title: step.title, variables: step.variables.filter(name => Object.hasOwn(step.env, name)) }),
      status, owner: `${hostname()}:${process.pid}`, at: run.at, cwd, ...(run.record ? { record: run.record } : {}), output,
      ...(!["starting", "running", "stopping"].includes(status) ? { end: new Date().toISOString() } : {}), ...(exit !== undefined ? { exit: String(exit) } : {}),
    } }, run.actor);
    if (result.proposalId) throw new ActionRefused("The run record was proposed because its note is being edited; finish that edit before running the step.");
    if (!run.record) run.record = result.written.find(id => id !== step.root)!;
  });
  return run.writes;
}

async function execute(ctx: Context, step: RunbookStep, actor: Actor, answers: Record<string, string>) {
  if (runs.has(keyOf(step))) throw new ActionRefused("This step started while its prompt was open; press run again to focus or stop it.");
  const own = { ...step.env }, secrets: string[] = [];
  for (const f of step.fields) {
    own[f.variable] = answers[f.name]!;
    if (f.secret) secrets.push(answers[f.name]!);
  }
  const literal = (value: string) => value.replace(/\{\{(RUNBOOK_[A-Za-z0-9_]+)\}\}/g, (_, name: string) => own[name]!);
  // Expand against only the reference bindings; env lines are literal and never shell programs.
  const env = Object.fromEntries(Object.entries(own).map(([k, v]) => [k, literal(v)]));
  const cwd = step.cwd === undefined ? process.cwd() : literal(step.cwd);
  const run: Run = { key: keyOf(step), ctx, step, actor, record: "", at: new Date().toISOString(), cwd, state: "starting", secrets, writes: Promise.resolve() };
  runs.set(run.key, run);
  let output = "";
  const decoder = new TextDecoder();
  const collect = (data: Uint8Array) => { output = (output + decoder.decode(data, { stream: true })).slice(-64000); };
  try {
    if (!(await stat(cwd).catch(() => null))?.isDirectory()) throw new ActionRefused(`Folder ${scrubCredentials(cwd, secrets)} does not exist. Set cwd:: to a folder before this step.`);
    const interrupted = (): boolean => run.state === "stopping" || run.state === "lost";
    const cancelled = async () => {
      if (run.state === "lost") { await run.writes; secrets.length = 0; runs.delete(run.key); return true; }
      if (run.state !== "stopping") return false;
      await record(run, "stopped", "Stopped before the command started.", 130);
      secrets.length = 0; runs.delete(run.key);
      return true;
    };
    if (interrupted()) { await cancelled(); return { stopped: run.record }; }
    await record(run, "starting");
    if (interrupted()) { await cancelled(); return { stopped: run.record }; }
    await record(run, "running");
    if (interrupted()) { await cancelled(); return { stopped: run.record }; }
    const done = (code: number | null) => {
      if (run.state === "lost") { secrets.length = 0; runs.delete(run.key); return; }
      const clean = plainText(scrubCredentials(output + decoder.decode(), secrets) as string);
      output = "";
      void record(run, run.state === "stopping" || code === null ? "stopped" : code === 0 ? "ok" : "failed", clean, code ?? 130)
        .catch(e => asActor(ctx, actor).flash(`Run record could not be saved: ${e.message}`, undefined, errorDetails(e)))
        .finally(() => { secrets.length = 0; runs.delete(run.key); void ctx.board.refreshProjections(step.block, undefined, actor).catch(e => asActor(ctx, actor).flash(e.message, undefined, errorDetails(e))); ctx.redraw(); });
    };
    if (!ctx.inTile?.({ cmd: [process.env.SHELL || "/bin/sh", "-lc", step.command], cwd, own: env,
      name: step.title, shows: step.title, retain: true, actor, output: collect, ready: job => { run.job = job; } }, done)) {
      throw new Error("Open the runbook in a desk reader with room for a terminal tile, then run the step again.");
    }
    asActor(ctx, actor).flash(`Running ${step.title}`);
    return { running: run.record };
  } catch (error) {
    try { if (run.record) await record(run, "failed-to-start", scrubCredentials((error as Error).message, secrets) as string); }
    finally { secrets.length = 0; runs.delete(run.key); }
    throw error;
  }
}

async function stop(run: Run) {
  if (!["starting", "running"].includes(run.state)) return { stopping: run.record };
  const saved = record(run, "stopping");
  run.job?.stop();
  await saved;
  return { stopping: run.record };
}

export const RUNBOOK_ACTIONS = actionSet<ExtOn>()("runbook", {
  "runbook.stop": def({ summary: "stop a running step and record its result", keys: "stop in the running step's form", touches: "nothing", replay: "ask",
    args: { step: { type: "string", optional: true, about: "the step anchor; defaults to this actor's latest run" } },
    examples: [{ act: "runbook.stop step=step-start-the-server", does: "stops that step's terminal and records its result" }],
    run({ step }, _on, actor) {
      const run = [...runs.values()].reverse().find(r => step ? r.step.anchor === step : r.actor.kind === actor.kind && (actor.kind === "user" || r.actor.kind === "agent" && r.actor.id === actor.id));
      if (!run) throw new ActionRefused("No matching step is running.");
      return stop(run);
    } }),
});

export async function recoverRuns(ctx: Context): Promise<void> {
  const { notes } = await ctx.board.queryNotes('type=run (run.status=starting OR run.status=running OR run.status=stopping)', 1000, "show");
  for (const note of notes) {
    const owner = prop(note, "run.owner") ?? "";
    const prefix = `${hostname()}:`;
    if (!owner.startsWith(prefix) || alive(Number(owner.slice(prefix.length)))) continue;
    const current = await ctx.board.get(note.id);
    if (!current) continue;
    await ctx.board.update(note.id, current.text.replace(/\[run.status::(?:starting|running|stopping)\]/, "[run.status::lost]") + `\nEnded: ${new Date().toISOString()}\nThe door restarted and this run's terminal was lost.`, current.revision!, { kind: "agent", id: "runbook" });
  }
}

/** Temporary run tiles must end even when their records cannot be saved. */
export async function loseRuns(): Promise<void> {
  closing = true;
  const pending = [...runs.values()];
  for (const run of pending) {
    const active = ["starting", "running", "stopping"].includes(run.state);
    if (active) run.state = "lost";
    run.job?.stop();
  }
  await Promise.all(pending.map(async run => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        run.state === "lost" ? record(run, "lost", "The door restarted; this run's temporary terminal was closed.") : run.writes,
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("The outline did not save the run record within 2 seconds.")), 2000); }),
      ]);
    } catch (error) {
      const message = `Run record could not be saved: ${scrubCredentials((error as Error).message, run.secrets)}`;
      console.error(message);
      asActor(run.ctx, run.actor).flash(message, undefined, errorDetails(error));
    } finally { clearTimeout(timeout); }
  }));
}
