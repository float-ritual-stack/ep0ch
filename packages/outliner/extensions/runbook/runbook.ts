// Runbooks as an extension (PIE-732). A note with [type::runbook] is the runbook; each step is a block with a
// `run::` line and a command in its first code fence:
//
//   Check the widget
//   run:: --mode=dry --secrets=widget-demo
//   ```sh
//   widget check --env {{env}}
//   ```
//
// {{name}} is filled from the runbook note's own [name::value] properties. `--secrets` names with-secrets groups, never
// a value: the service reads each group when the step runs (`secrets.group`, allowed by the manifest's secretGroups),
// the command gets the values in its environment (wrap.ts runs it), and the service scrubs them from everything this
// extension writes or answers. Each run is a child block of the step (status, exit code, when, who, an output tail).
// An apply step is the person's: an agent's request is recorded as refused. Every command and name here is made up.
import { join } from "node:path";
import { outline } from "./outline";

interface Prop { key: string; value: string }
interface Block { id: string; text: string; revision: number; properties?: Prop[] }
interface Context { block: { id: string; text: string; revision: number; properties?: Prop[] }; line?: { index: number; text: string }; children: { id: string; text: string }[]; ancestors: { id: string; title: string }[]; now: string }
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
const propsOf = (block: { properties?: Prop[] }) => Object.fromEntries((block.properties ?? []).map((prop) => [prop.key, prop.value]));

/** The runbook a step is in: the nearest ancestor that is [type::runbook] (or the block itself). */
async function runbookOf(context: Context): Promise<Block | null> {
  const chain = [context.block.id, ...[...context.ancestors].reverse().map((ancestor) => ancestor.id)];
  for (const id of chain) {
    const block = await outline<Block>({ action: "get", blockId: id });
    if (propsOf(block).type === "runbook") return block;
  }
  return null;
}
function fill(template: string, params: Record<string, string>): { command: string; missing: string[] } {
  const missing = new Set<string>();
  const command = template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, name: string) => { if (params[name] === undefined) missing.add(name); return params[name] ?? ""; });
  return { command, missing: [...missing] };
}

// ── The record of a run ──────────────────────────────────────────────────

interface Outcome { status: "ok" | "failed" | "refused"; exit?: number; by: string; at: string; ms?: number; excerpt: string; why?: string }
const runs = (children: Context["children"]) => children.map((child) => ({ id: child.id, status: /\[run\.status::(\w+)\]/.exec(child.text)?.[1], text: child.text })).filter((child) => child.status && child.status !== "running");
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
  const refuse = async (why: string): Promise<StepResult> => {
    const outcome: Outcome = { status: "refused", by, at, excerpt: "", why };
    await outline({ action: "create", parentId: step.id, text: recordText(title, outcome) });
    await mark(step.id, "refused");
    return { title, outcome };
  };
  if (!line) return refuse("it has no run:: line");
  const template = commandOf(step.text);
  if (!template) return refuse("it has no command: put one in a code fence under the run:: line");
  const root = await runbookOf({ ...context, block: step });
  // A value passed at run time lands in a shell command: plain characters only. A runbook's own properties are its author's.
  const unsafe = Object.entries(args).find(([key, value]) => key !== "confirm" && !/^[\w.@:\/=+,-]*$/.test(value));
  if (unsafe) return refuse(`${unsafe[0]}=… has characters a command could be built from; put the value on the runbook note as [${unsafe[0]}::value] instead`);
  const { command, missing } = fill(template, { ...(root ? propsOf(root) : {}), ...args });
  if (missing.length) return refuse(`no value for ${missing.map((name) => `{{${name}}}`).join(", ")}: write [${missing[0]}::value] on the runbook note, or pass ${missing[0]}=value`);

  if (line.mode === "apply") {
    if (by !== "person") return refuse(`apply steps are the person's to run${by === "unknown" ? " (who asked isn't known)" : ` (${by} asked)`}. The command: ${command}`);
    const word = line.confirm ?? "apply";
    if (args.confirm !== word) return refuse(`an apply step needs its confirmation: run it again with confirm=${word}. The command: ${command}`);
  }
  // A started record first, so a run that is cut off still shows it began.
  const started = await outline<Block>({ action: "create", parentId: step.id, text: `Running ${title} [run.status::running] [run.at::${at}]` });
  const settle = async (outcome: Outcome): Promise<StepResult> => { await outline({ action: "update", blockId: started.id, expectedRevision: started.revision, text: recordText(title, outcome) }); await mark(step.id, outcome.status); return { title, outcome }; };

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
  const root = await runbookOf(context);
  const all = runs(context.children);
  const last = all.at(-1);
  const ok = last?.status === "ok";
  const filled = template ? fill(template, root ? propsOf(root) : {}) : null;
  const lastExit = last ? /\[run\.exit::(-?\d+)\]/.exec(last.text)?.[1] : undefined;
  say({
    title: titleOf(context.block.text),
    data: { mode: line?.mode ?? "dry", secrets: line?.secrets ?? [], status: last?.status ?? "not-run", runs: all.length },
    view: {
      type: "card", title: titleOf(context.block.text),
      subtitle: `${line?.mode ?? "dry"} step${line?.secrets.length ? ` · secrets from ${line.secrets.join(", ")} (by name)` : ""}`,
      badge: { label: last ? (ok ? "ok" : `${last.status}${lastExit ? ` (exit ${lastExit})` : ""}`) : "not run", tone: ok ? "good" : last ? "bad" : "dim" },
      children: [
        { type: "text", text: !template ? "No command: put one in a code fence." : filled!.missing.length ? `${filled!.command}\nStill needs: ${filled!.missing.join(", ")}` : filled!.command },
        { type: "checklist", items: [{ label: ok ? "ran ok" : "run it", done: ok }] },
      ],
    },
  });
} else {
  const { input, config } = request;
  if (input.action === "run-step") {
    const step = input.target?.blockId && input.target.blockId !== input.context.block.id ? await outline<Block>({ action: "get", blockId: input.target.blockId }) : (input.context.block as Block);
    const result = await runStep(step, input.context, input.args ?? {}, config, askedBy(input.requestedBy));
    fail(`${result.title}: ${result.outcome.status}${result.outcome.exit !== undefined ? ` (exit ${result.outcome.exit})` : ""}${result.outcome.why ? `: ${result.outcome.why}` : ""}`);
  } else {
    const root = input.context.block;
    if (propsOf(root).type !== "runbook") fail("this note is not a runbook: write [type::runbook] on it");
    else {
      const steps: Array<{ block: Block; ancestors: Context["ancestors"] }> = [];
      const walk = async (parentId: string, ancestors: Context["ancestors"]) => {
        for (const child of await outline<Block[]>({ action: "children", parentId })) { if (runLine(child.text)) steps.push({ block: child, ancestors }); await walk(child.id, [...ancestors, { id: child.id, title: "" }]); }
      };
      await walk(root.id, [...input.context.ancestors, { id: root.id, title: "" }]);
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
      if (steps.length) await outline({ action: "create", parentId: root.id, text: `Run of this runbook: ${summary.replace(/\n/g, " ")} [run.status::${stopped ? "failed" : "ok"}] [run.at::${new Date().toISOString()}]\n${done.map((item) => `- ${item}`).join("\n")}` });
      fail(steps.length ? summary : "no steps: a step is a block with a run:: line");
    }
  }
}
} catch (error) {
  // A crash gives the service only a non-zero exit, and it shows the person nothing of why: say it.
  if (request.operation === "act") fail(`the runbook extension failed: ${(error as Error).message}`);
  else process.stdout.write(JSON.stringify({ ok: false, code: "invalid-config" }));
}
