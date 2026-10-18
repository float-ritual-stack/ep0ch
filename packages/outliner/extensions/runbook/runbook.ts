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
  | { operation: "run"; input: { options: Record<string, string>; context: Context } }
  | { operation: "act"; input: { action: "run-step" | "run-all"; args?: Record<string, string>; target?: { blockId: string; line?: number }; context: Context; requestedBy?: Asker }; config: Config };

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
interface RunLine { mode: "dry" | "apply"; secrets: string[]; confirm?: string }
const RUN_LINE = /^\s*(?:[-*]\s+)?run::/;
function runLine(text: string): RunLine | null {
  const line = outsideFences(text).find((candidate) => RUN_LINE.test(candidate));
  if (line === undefined) return null;
  const options = new Map<string, string>();
  for (const [, key, value] of line.replace(RUN_LINE, "").matchAll(/--([a-z]+)=(\S+)/g)) options.set(key!, value!);
  return { mode: options.get("mode") === "apply" ? "apply" : "dry", secrets: (options.get("secrets") ?? "").split(",").filter(Boolean), ...(options.get("confirm") ? { confirm: options.get("confirm")! } : {}) };
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

// ── The record of a run ──────────────────────────────────────────────────

interface Outcome { status: "ok" | "failed" | "refused"; exit?: number; by: string; at: string; ms?: number; excerpt: string; why?: string }
const tail = (output: string) => { const kept = output.trimEnd().split("\n").slice(-15).join("\n"); return kept.length > 1200 ? `…${kept.slice(-1200)}` : kept; };
const inertFence = (text: string) => text.replaceAll("```", "'''");
function recordText(title: string, outcome: Outcome): string {
  const head = outcome.status === "ok" ? `Ran ${title}: ok, exit 0` : outcome.status === "failed" ? `Ran ${title}: FAILED, exit ${outcome.exit}` : `Did not run ${title}: ${(outcome.why ?? "").replace(/\n/g, " ")}`;
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

interface StepResult { title: string; outcome: Outcome }
async function runStep(step: Block, context: Context, args: Record<string, string>, config: Config, by: string): Promise<StepResult> {
  const title = titleOf(step.text);
  const line = runLine(step.text);
  const at = new Date().toISOString();
  const place = async (content: string, anchor?: string) => {
    const result = await outline<{ outcome: string; anchor: string; message: string }>({ action: "outputs.place", blockId: step.id,
      producer: { id: step.id, name: title }, content, ...(anchor ? { at: anchor, mode: "replace" } : { here: "end" }) });
    if (result.outcome !== "applied") throw new Error(result.message);
    return result.anchor;
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

  if (line.mode === "apply") {
    if (by !== "person") return refuse(`apply steps are the person's to run${by === "unknown" ? " (who asked isn't known)" : ` (${by} asked)`}. The command: ${command}`);
    const word = line.confirm ?? "apply";
    if (args.confirm !== word) return refuse(`an apply step needs its confirmation: run it again with confirm=${word}. The command: ${command}`);
  }
  // A started record first, so a run that is cut off still shows it began.
  const started = await place(`Running ${title} [run.status::running] [run.at::${at}]`);
  const settle = async (outcome: Outcome): Promise<StepResult> => { await place(recordText(title, outcome), started); await mark(step.id, outcome.status); return { title, outcome }; };

  // Each group by name, read by the service now; the service scrubs its values from all this run writes and answers.
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const group of line.secrets) {
    try {
      Object.assign(env, (await outline<{ values: Record<string, string> }>({ action: "secrets.group", group })).values);
    } catch (error) {
      return settle({ status: "refused", by, at, excerpt: "", why: (error as Error).message });
    }
  }
  const timeout = String((config.timeoutSeconds ?? 120) * 1000);
  const began = Date.now();
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "wrap.ts"), timeout, command], { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const ms = Date.now() - began;
  let result: { exit: number; output: string };
  try { result = JSON.parse(stdout); } catch { result = { exit: code || 1, output: stderr.trim() || "(the runner gave no output)" }; }
  return settle({ status: result.exit === 0 ? "ok" : "failed", exit: result.exit, by, at, ms, excerpt: tail(result.output) });
}

// ── The two operations ───────────────────────────────────────────────────

const request = (await Bun.stdin.json()) as Request;
try {
if (request.operation === "run") {
  const { context } = request.input;
  const line = runLine(context.block.text);
  const template = commandOf(context.block.text);
  const root = runbookOf(context.block, context.ancestors);
  const status = valuesOf(context.block, "run.last")[0];
  const ok = status === "ok";
  const filled = template ? await fillCommand(template, context.block, root, {}) : null;
  say({
    title: titleOf(context.block.text),
    data: { mode: line?.mode ?? "dry", secrets: line?.secrets ?? [], status: status ?? "not-run" },
    view: {
      type: "card", title: titleOf(context.block.text),
      subtitle: `${line?.mode ?? "dry"} step${line?.secrets.length ? ` · secrets from ${line.secrets.join(", ")} (by name)` : ""}`,
      badge: { label: status ?? "not run", tone: ok ? "good" : status ? "bad" : "dim" },
      children: [
        { type: "text", text: !template ? "No command: put one in a code fence." : filled!.missing.length ? `${filled!.command}\nStill needs: ${filled!.missing.join("; ")}` : filled!.unsafe ? `${filled!.command}\nWill not run: ${filled!.unsafe}` : filled!.command },
        { type: "checklist", items: [{ label: ok ? "ran ok" : "run it", done: ok }] },
      ],
    },
  });
} else {
  const { input, config } = request;
  if (input.action === "run-step") {
    const step = input.target?.blockId && input.target.blockId !== input.context.block.id ? await outline<Block>({ action: "get", blockId: input.target.blockId }) : input.context.block;
    const result = await runStep(step, input.context, input.args ?? {}, config, askedBy(input.requestedBy));
    fail(`${result.title}: ${result.outcome.status}${result.outcome.exit !== undefined ? ` (exit ${result.outcome.exit})` : ""}${result.outcome.why ? `: ${result.outcome.why}` : ""}`);
  } else {
    const root = input.context.block;
    if (!valuesOf(root, "type").includes("runbook")) fail("this note is not a runbook: write [type::runbook] on it");
    else {
      const steps: Array<{ block: Block; ancestors: Context["ancestors"] }> = [];
      const walk = async (parentId: string, ancestors: Context["ancestors"]) => {
        for (const child of await outline<Block[]>({ action: "children", parentId })) { if (runLine(child.text)) steps.push({ block: child, ancestors }); await walk(child.id, [...ancestors, { id: child.id, title: "", ...(child.properties ? { properties: child.properties } : {}) }]); }
      };
      await walk(root.id, [...input.context.ancestors, { id: root.id, title: "", ...(root.properties ? { properties: root.properties } : {}) }]);
      const done: string[] = [];
      let stopped = "";
      const began = Date.now(), budget = 280_000;   // the call's deadline is 5 m: settle before it, never leave a record "running"
      for (const { block: step, ancestors } of steps) {
        if (Date.now() - began + (config.timeoutSeconds ?? 120) * 1000 > budget) { stopped = `stopped before ${titleOf(step.text)}: not enough of this call's time left; run it again to continue`; break; }
        const result = await runStep(step, { ...input.context, ancestors }, input.args ?? {}, config, askedBy(input.requestedBy));
        done.push(`${result.title}: ${result.outcome.status}`);
        if (result.outcome.status !== "ok") { stopped = `stopped at ${result.title}: ${result.outcome.why ?? `exit ${result.outcome.exit}`}`; break; }
      }
      const summary = stopped || `all ${steps.length} steps ran ok`;
      if (steps.length) await outline({ action: "create", parentId: root.id, text: `Run of this runbook: ${summary.replace(/\n/g, " ")} [machine::runbook] [run.status::${stopped ? "failed" : "ok"}] [run.at::${new Date().toISOString()}]\n${done.map((item) => `- ${item}`).join("\n")}` });
      fail(steps.length ? summary : "no steps: a step is a block with a run:: line");
    }
  }
}
} catch (error) {
  // A crash gives the service only a non-zero exit, and it shows the person nothing of why: say it.
  if (request.operation === "act") fail(`the runbook extension failed: ${(error as Error).message}`);
  else process.stdout.write(JSON.stringify({ ok: false, code: "invalid-config" }));
}
