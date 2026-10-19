import type { RunbookStep, RunbookField } from "@ep0ch/outline-core/runbook";
// Runbooks as an extension (PIE-732). A note with [type::runbook] is the runbook; each step is a block with a
// `run::` line and a command in its first code fence:
//
//   Check the widget
//   run:: --mode=dry --secrets=widget-demo
//   ```sh
//   widget check --env {{self.env}}
//   ```
//
// {{self.name}} is the runbook note's own [name::value] (its author's: trusted); {{props.name}} is a value the run is given
// (`env=staging`, or the runbook's own [form-field::env text] asked for in the door): checked, since it lands in a shell. The
// service fills them (`site.answer`'s `interpolate`, the one `{{ }}` grammar, with this runbook as `self`); a step with a value
// missing, or one from anywhere else that could build a command, does not run. `--secrets` names with-secrets groups, never
// a value: the service reads each group when the step runs (`secrets.group`, allowed by the manifest's secretGroups),
// the command gets the values in its environment (wrap.ts runs it), and the service scrubs them from everything this
// extension writes or answers. Each step run is an output region after the command (status, exit code, when, who, an output tail).
// An apply step is the person's: an agent's request is recorded as refused. Every command and name here is made up.
import { join } from "node:path";
import { outline } from "./outline";

/** A property as the service sends it: a wire block's `{ key, value }`, or a record's `{ key, values }` (`context.block`, outline-core's record). */
interface Prop { key: string; value?: string; values?: string[] }
interface Block { id: string; text: string; revision: number; properties?: Prop[] }
/** One `{{ }}` of a command, as the service read it (`site.answer`'s `interpolate`). */
interface Placeholder { expression: string; head?: string; values?: string[]; from?: string; problem?: { message: string; didYouMean: string[]; example?: string }; usedDefault?: true }
interface Filled { interpolated?: { text: string; values: Placeholder[] } }
/** An ancestor as the call's context sends it: its `properties` are the record's, so a list or a repeat is already read. */
interface Ancestor { id: string; title: string; properties?: Prop[] }
interface Context { block: Block; line?: { index: number; text: string }; children: Block[]; ancestors: Ancestor[]; now: string }
type Config = { timeoutSeconds?: number };
type Asker = { author: string; actorId?: string };
type Request =
  | { operation: "decorate"; input: { context: Context } }
  | { operation: "run"; input: { options: Record<string, string>; context: Context } }
  | { operation: "act"; input: { action: "run-step" | "run-all" | "record" | "host-step"; args?: Record<string, string>; target?: { blockId: string; line?: number }; context: Context; requestedBy?: Asker }; config: Config };

const say = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));
const fail = (message: string) => say({ message });

// ── Reading a step ───────────────────────────────────────────────────────

const FENCE = /^(`{3,}|~{3,})/;
/** The text with its code fences taken out, so a `run::` inside one is words. */
function outsideFences(text: string): string[] {
  const lines: string[] = [];
  let open: string | null = null;
  for (const line of text.split("\n")) {
    const fence = FENCE.exec(line.trimStart());
    if (open) { if (fence && fence[1]![0] === open[0] && fence[1]!.length >= open.length) open = null; continue; }
    if (fence) { open = fence[1]!; continue; }
    lines.push(line);
  }
  return lines;
}
/** The first fence's content. */
function commandOf(text: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => FENCE.test(line.trimStart()));
  if (start < 0) return null;
  const mark = FENCE.exec(lines[start]!.trimStart())![1]!;
  const end = lines.findIndex((line, index) => index > start && line.trim().startsWith(mark));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim() || null;
}
interface RunLine { mode: "terminal" | "host" | "dry" | "apply"; secrets: string[]; confirm?: string; on?: string; keep: boolean; close: boolean }
const RUN_LINE = /^\s*(?:[-*]\s+)?run::/;
function runLine(text: string): RunLine | null {
  const line = outsideFences(text).find((candidate) => RUN_LINE.test(candidate));
  if (line === undefined) return null;
  const options = new Map<string, string>();
  for (const [, key, value] of line.replace(RUN_LINE, "").matchAll(/--([a-z]+)=(\S+)/g)) options.set(key!, value!);
  return { mode: (options.get("mode") ?? "terminal") as RunLine["mode"], on: options.get("on") ?? /--on\s+(\S+)/.exec(line)?.[1], keep: /--keep(?:\s|$)/.test(line), close: options.get("close") === "on-success", secrets: (options.get("secrets") ?? "").split(",").filter(Boolean), ...(options.get("confirm") ? { confirm: options.get("confirm")! } : {}) };
}
const titleOf = (text: string) => outsideFences(text).find((line) => line.trim() && !RUN_LINE.test(line))?.replace(/^\s*(?:[-*]\s+(?:\[[ x]\]\s+)?)/, "").replace(/\[[\w.-]+::[^\]]*\]/g, "").trim() || "step";
/** Every value a block has for a property, from the service's parse (never a scan of its text). */
const valuesOf = (block: { properties?: Prop[] }, key: string) => (block.properties ?? []).filter((prop) => prop.key === key).flatMap((prop) => prop.values ?? (prop.value === undefined ? [] : [prop.value]));

/** The runbook a step is in, which is its `self`: the nearest ancestor that is [type::runbook] (or the step itself), read from the properties the call carries. */
function runbookOf(step: Block, ancestors: readonly Ancestor[]): { id: string } | null {
  return [step, ...[...ancestors].reverse()].find((candidate) => valuesOf(candidate, "type").includes("runbook")) ?? null;
}
/**
 * The command with its `{{ }}` filled by the service in this step's Site (`this` the step, `self` the runbook, `props` the
 * run's values), or why not. A value from the runbook note itself is its author's. Every other (a prop, a parent, a
 * `((id))`, a clock) lands in a shell command, so it must be plain characters or the step does not run.
 */
const SAFE = /^[\w.@:\/=+,-]*$/;
async function fillCommand(template: string, step: Block, root: { id: string } | null, args: Record<string, string>): Promise<{ command: string; missing: string[]; unsafe?: string }> {
  const props = Object.fromEntries(Object.entries(args).filter(([key]) => key !== "confirm").map(([key, value]) => [key, [value]]));
  const answer = await outline<Filled>({
    action: "site.answer", blockId: step.id, ...(root ? { self: root.id } : {}), props, interpolate: { text: template, fences: "template" },
  });
  const values = answer.interpolated?.values ?? [];
  const missing = values.filter((v) => (!v.values || v.problem) && !v.usedDefault).map((v) => `{{${v.expression}}}: ${v.problem?.message ?? "no value"}`);
  const unsafe = values.find((v) => !(v.head === "self" && root && v.from === root.id) && (v.values ?? []).some((value) => !SAFE.test(value)));
  const why = unsafe && (unsafe.head === "props"
    ? `{{${unsafe.expression}}} has characters a command could be built from; pass a plain value (letters, digits and . @ : / = + , -), or put the value on the runbook note as [name::value] and write {{self.name}}`
    : `{{${unsafe.expression}}} comes from outside the runbook note and has characters a command could be built from; put the value on the runbook note as [name::value] and write {{self.name}}, or pass it as a prop`);
  return { command: answer.interpolated?.text ?? template, missing, ...(why ? { unsafe: why } : {}) };
}

async function terminalStep(step: Block, context: Context, args: Record<string, string>): Promise<RunbookStep> {
  const line = runLine(step.text);
  if (!line) throw new Error("this block has no run:: line");
  const template = commandOf(step.text);
  if (!template) throw new Error("put the command in a code fence under run::");
  const root = runbookOf(step, context.ancestors);
  const fields: RunbookField[] = [];
  const commandTemplate = template.replace(/\{\{(ask|secret)\.([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_, kind: string, name: string) => {
    const previous = fields.find(f => f.name === name);
    if (previous && previous.secret !== (kind === "secret")) throw new Error(`use different names for ask.${name} and secret.${name}`);
    if (!previous) fields.push({ name, secret: kind === "secret" });
    return '"${RUNBOOK_' + kind.toUpperCase() + '_' + name + '}"';
  });
  const filled = await fillCommand(commandTemplate, step, root, args);
  if (filled.missing.length || filled.unsafe) throw new Error(filled.unsafe ?? filled.missing.join("; "));
  const book = root ? await outline<Block>({ action: "get", blockId: root.id }) : step;
  for (const field of fields) {
    const choices = valuesOf(step, "choices").find(v => v.startsWith(field.name + " "));
    if (choices) field.choices = choices.slice(field.name.length + 1).split(",").map(v => v.trim());
    field.file = valuesOf(step, "form-field").some(v => v.startsWith(field.name + " file"));
    if (!field.secret) field.value = valuesOf(book, field.name)[0];
  }
  return { block: step.id, ...(root ? { root: root.id } : {}), title: titleOf(step.text), mode: line.mode === "terminal" ? "terminal" : "host",
    command: filled.command, fields, secrets: line.secrets, confirm: line.mode === "apply" ? line.confirm ?? "apply" : line.confirm, on: line.on, keep: line.keep, close: line.close };
}

async function recordStep(step: Block, args: Record<string, string>, by: string) {
  const outcome: Outcome = { status: args.status as Outcome["status"], by, at: new Date().toISOString(), excerpt: args.status === "waiting" ? args.output ?? "" : tail(args.output ?? ""),
    ...(args.exit !== undefined ? { exit: Number(args.exit) } : {}), why: args.why };
  await outline({ action: "outputs.place", blockId: step.id, producer: { id: step.id, name: titleOf(step.text) }, content: recordText(titleOf(step.text), outcome), here: "end" });
  await mark(step.id, outcome.status);
  return outcome;
}

// ── The record of a run ──────────────────────────────────────────────────

interface Outcome { status: "ok" | "failed" | "refused" | "waiting"; exit?: number; by: string; at: string; ms?: number; excerpt: string; why?: string }
const tail = (output: string) => { const kept = output.trimEnd().split("\n").slice(-15).join("\n"); return kept.length > 1200 ? `…${kept.slice(-1200)}` : kept; };
const inertFence = (text: string) => text.replaceAll("```", "'''");
function recordText(title: string, outcome: Outcome): string {
  const head = outcome.status === "ok" ? `Ran ${title}: ok, exit 0` : outcome.status === "failed" ? `Ran ${title}: FAILED, exit ${outcome.exit}` : outcome.status === "waiting" ? `Waiting to run ${title}` : `Did not run ${title}: ${(outcome.why ?? "").replace(/\n/g, " ")}`;
  const props = [`run.status::${outcome.status}`, ...(outcome.exit !== undefined ? [`run.exit::${outcome.exit}`] : []), `run.at::${outcome.at}`, `run.by::${outcome.by}`, ...(outcome.ms !== undefined ? [`run.ms::${outcome.ms}`] : [])];
  return `${head} ${props.map((prop) => `[${prop}]`).join(" ")}${outcome.excerpt ? `\n\`\`\`text\n${inertFence(outcome.excerpt)}\n\`\`\`` : ""}`;
}

/** Who asked, from the action's input: the person, an agent by its id, or no one (a scheduled run). */
const askedBy = (asker: Asker | undefined) => !asker ? "unknown" : asker.author === "user" ? "person" : `agent:${asker.actorId ?? "unnamed"}`;

/** [run.last::status] on the step's first line: queryable ("which steps failed", `run.last=failed`). */
async function mark(stepId: string, status: string) {
  const current = await outline<Block>({ action: "get", blockId: stepId });
  const [first = "", ...rest] = current.text.split("\n");
  const next = `${first.replace(/\s*\[run\.last::\w+\]/g, "")} [run.last::${status}]`;
  if (next !== first) await outline({ action: "update", blockId: stepId, expectedRevision: current.revision, text: [next, ...rest].join("\n") });
}

function confirmationWhy(line: RunLine, args: Record<string, string>, by: string, command: string): string | null {
  if (line.mode !== "apply" && !line.confirm) return null;
  if (line.mode === "apply" && by !== "person") return `apply steps are the person's to run${by === "unknown" ? " (who asked isn't known)" : ` (${by} asked)`}. The command: ${command}`;
  const word = line.confirm ?? "apply";
  return args.confirm === word ? null : `an apply step needs its confirmation: run it again with confirm=${word}. The command: ${command}`;
}

interface StepResult { title: string; outcome: Outcome }
async function runStep(step: Block, context: Context, args: Record<string, string>, config: Config, by: string): Promise<StepResult> {
  const title = titleOf(step.text);
  const line = runLine(step.text);
  const at = new Date().toISOString();
  const place = async (content: string, anchor?: string) => {
    const result = await outline<{ outcome: string; anchor: string; message: string }>({ action: "outputs.place", blockId: step.id,
      producer: { id: step.id, name: title }, content, ...(anchor ? { at: anchor, mode: "replace" } : { here: "end" }) });
    if (!anchor && result.outcome !== "applied") throw new Error(result.message);
    return result;
  };
  const refuse = async (why: string): Promise<StepResult> => {
    const outcome: Outcome = { status: "refused", by, at, excerpt: "", why };
    await place(recordText(title, outcome));
    await mark(step.id, "refused");
    return { title, outcome };
  };
  if (!line) return refuse("it has no run:: line");
  const template = commandOf(step.text);
  if (!template) return refuse("it has no command: put one in a code fence under the run:: line");
  const root = runbookOf(step, context.ancestors);
  const { command, missing, unsafe } = await fillCommand(template, step, root, args);
  if (missing.length) return refuse(`${missing.join("; ")}. Write [name::value] on the runbook note and use {{self.name}}, or pass the value (act ext.runbook.run-step … with='{"name":"value"}') and use {{props.name}}`);
  if (unsafe) return refuse(unsafe);

  const denied = confirmationWhy(line, args, by, command);
  if (denied) return refuse(denied);
  // A started record first, so a run that is cut off still shows it began.
  const started = await place(`Running ${title} [run.status::running] [run.at::${at}]`);
  const settle = async (outcome: Outcome): Promise<StepResult> => {
    try {
      const placed = await place(recordText(title, outcome), started.anchor);
      if (placed.outcome === "proposed") {
        outcome.why = [outcome.why, "its output went to a proposal because the region changed"].filter(Boolean).join("; ");
      }
    } finally {
      // The command finished even when its output can no longer replace the person's edited region.
      await mark(step.id, outcome.status);
    }
    return { title, outcome };
  };

  // Each group by name, read by the service now; the service scrubs its values from all this run writes and answers.
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const group of line.secrets) {
    try {
      Object.assign(env, (await outline<{ values: Record<string, string> }>({ action: "secrets.group", group })).values);
    } catch (error) {
      return settle({ status: "refused", by, at, excerpt: "", why: (error as Error).message });
    }
  }
  const began = Date.now();
  const result = await runCommand(command, env, config);
  return settle({ status: result.exit === 0 ? "ok" : "failed", exit: result.exit, by, at, ms: Date.now() - began, excerpt: tail(result.output) });
}

async function runCommand(command: string, env: Record<string, string>, config: Config): Promise<{ exit: number; output: string }> {
  const timeout = String((config.timeoutSeconds ?? 120) * 1000);
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "wrap.ts"), timeout, command], { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  try { return JSON.parse(stdout); } catch { return { exit: code || 1, output: stderr.trim() || "(the runner gave no output)" }; }
}

// ── The two operations ───────────────────────────────────────────────────

const request = (await Bun.stdin.json()) as Request;
try {
if (request.operation === "decorate") {
  say({ view: { type: "button", label: "run all", act: `ext.runbook.run-all block=${request.input.context.block.id}` } });
} else if (request.operation === "run") {
  const { context } = request.input;
  const line = runLine(context.block.text);
  const template = commandOf(context.block.text);
  const root = runbookOf(context.block, context.ancestors);
  const status = valuesOf(context.block, "run.last")[0];
  const ok = status === "ok";
  say({
    title: titleOf(context.block.text),
    data: { mode: line?.mode ?? "terminal", secrets: line?.secrets ?? [], status: status ?? "not-run" },
    placement: "replace",
    view: { type: "row", minWidth: 4, children: [
      { type: "text", text: "run::" },
      { type: "button", label: "run", act: `ext.runbook.run-step block=${context.block.id}` },
      { type: "badge", label: status ?? "not run", tone: ok ? "good" : status ? "bad" : "dim" },
    ] },
  });
} else {
  const { input, config } = request;
  if (input.action === "record") {
    await recordStep(input.context.block, input.args ?? {}, askedBy(input.requestedBy));
    fail("recorded the terminal run");
  } else if (input.action === "run-step" || input.action === "host-step") {
    const step = input.target?.blockId && input.target.blockId !== input.context.block.id ? await outline<Block>({ action: "get", blockId: input.target.blockId }) : input.context.block;
    if (input.action === "host-step") {
      const plan = await terminalStep(step, input.context, input.args ?? {});
      const denied = confirmationWhy(runLine(step.text)!, input.args ?? {}, askedBy(input.requestedBy), plan.command);
      if (denied) throw new Error(denied);
      const env = { ...process.env, ...JSON.parse(input.args?.environment ?? "{}") };
      for (const group of plan.secrets) Object.assign(env, (await outline<{ values: Record<string, string> }>({ action: "secrets.group", group })).values);
      say({ runbookResult: await runCommand(plan.command, env, config) });
    } else if (runLine(step.text)?.mode === "terminal" || runLine(step.text)?.mode === "host") {
      say({ runbook: { steps: [await terminalStep(step, input.context, input.args ?? {})] } });
    } else {
    const result = await runStep(step, input.context, input.args ?? {}, config, askedBy(input.requestedBy));
    fail(`${result.title}: ${result.outcome.status}${result.outcome.exit !== undefined ? ` (exit ${result.outcome.exit})` : ""}${result.outcome.why ? `: ${result.outcome.why}` : ""}`);
    }
  } else {
    const root = input.context.block;
    if (!valuesOf(root, "type").includes("runbook")) fail("this note is not a runbook: write [type::runbook] on it");
    else {
      const steps: Array<{ block: Block; ancestors: Context["ancestors"] }> = [];
      const walk = async (parentId: string, ancestors: Context["ancestors"]) => {
        for (const child of await outline<Block[]>({ action: "children", parentId })) { if (runLine(child.text)) steps.push({ block: child, ancestors }); await walk(child.id, [...ancestors, { id: child.id, title: "", ...(child.properties ? { properties: child.properties } : {}) }]); }
      };
      await walk(root.id, [...input.context.ancestors, { id: root.id, title: "", ...(root.properties ? { properties: root.properties } : {}) }]);
      if (steps.some(({ block }) => (runLine(block.text)?.mode === "terminal" || runLine(block.text)?.mode === "host"))) {
        say({ runbook: { steps: await Promise.all(steps.map(({ block, ancestors }) => terminalStep(block, { ...input.context, ancestors }, input.args ?? {}))) } });
      } else {
      const done: string[] = [];
      let stopped = "";
      const began = Date.now(), budget = 280_000;   // the call's deadline is 5 m: settle before it, never leave a record "running"
      for (const { block: step, ancestors } of steps) {
        if (Date.now() - began + (config.timeoutSeconds ?? 120) * 1000 > budget) { stopped = `stopped before ${titleOf(step.text)}: not enough of this call's time left; run it again to continue`; break; }
        const result = await runStep(step, { ...input.context, ancestors }, input.args ?? {}, config, askedBy(input.requestedBy));
        done.push(`${result.title}: ${result.outcome.status}${result.outcome.why ? `: ${result.outcome.why}` : ""}`);
        if (result.outcome.status !== "ok") { stopped = `stopped at ${result.title}: ${result.outcome.why ?? `exit ${result.outcome.exit}`}`; break; }
      }
      const summary = stopped || `all ${steps.length} steps ran ok`;
      if (steps.length) await outline({ action: "create", parentId: root.id, text: `Run of this runbook: ${summary.replace(/\n/g, " ")} [machine::runbook] [run.status::${stopped ? "failed" : "ok"}] [run.at::${new Date().toISOString()}]\n${done.map((item) => `- ${item}`).join("\n")}` });
      fail(steps.length ? summary : "no steps: a step is a block with a run:: line");
      }
    }
  }
}
} catch (error) {
  // A crash gives the service only a non-zero exit, and it shows the person nothing of why: say it.
  if (request.operation === "act") fail(`the runbook extension failed: ${(error as Error).message}`);
  else process.stdout.write(JSON.stringify({ ok: false, code: "invalid-config" }));
}
