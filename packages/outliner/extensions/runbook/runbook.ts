import type { RunbookStep } from "@ep0ch/outline-core/runbook";
import { outline } from "./outline";
import { recordText } from "./record";
import { shellHandler } from "./shell";

interface Block { id: string; text: string; revision: number }
interface Context { block: Block; line?: { index: number }; ancestors: { id: string }[]; runbook?: { steps: RunbookStep[]; records: Block[] } }
interface Request { deadlineAt: number; operation: "run" | "act"; input: { action?: string; handler?: string; context: Context; args?: Record<string, string>; target?: { line?: number }; requestedBy?: { author: string; actorId?: string } } }
const say = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));
const request = await Bun.stdin.json() as Request;


try {
  if (["sh", "nu"].includes(request.input.handler ?? "") || /^(run|keep)-(sh|nu)$/.test(request.input.action ?? "")) {
    say(await shellHandler(request));
    process.exit(0);
  }
  const { context, args = {} } = request.input;
  const steps = request.input.action === "record" ? [JSON.parse(args.step!) as RunbookStep] : context.runbook?.steps ?? [];
  const line = request.input.target?.line ?? context.line?.index;
  const step = steps.find(s => s.block === context.block.id && (request.input.action === "record" || line === undefined || s.line === line));
  if (!step) throw new Error("Choose a runnable fence (sh run, bash run, zsh run, or run:: immediately above it).");
  if (request.operation === "run") {
    const records = context.runbook?.records.filter(n => n.text.includes(`[run.step::^${step.anchor}]`)) ?? [];
    const last = records.at(-1)?.text.match(/\[run.status::([^\]]+)\]/)?.[1];
    say({ title: step.title, data: { anchor: step.anchor }, view: { type: "row", children: [
      { type: "button", label: "run", act: `ext.runbook.run-step block=${step.block} line=${step.line}` },
      { type: "text", text: last ?? "not run" },
      ...step.problems.map(text => ({ type: "text", text })),
    ] } });
  } else if (request.input.action === "run-step") {
    if (step.problems.length) throw new Error(step.problems.join("\n"));
    say({ runbook: { steps: [step] } });
  } else {
    const by = request.input.requestedBy?.author === "user" ? "person" : request.input.requestedBy?.actorId ?? request.input.requestedBy?.author ?? "unknown";
    const text = recordText(step, args, by);
    const writes: unknown[] = [];
    if (args.record) {
      const before = await outline<Block>({ action: "get", blockId: args.record });
      writes.push({ op: "update", blockId: before.id, expectedRevision: before.revision, text });
    } else {
      writes.push({ op: "create", parentId: step.root, text });
      const current = await outline<Block>({ action: "get", blockId: step.root });
      if (!current.text.includes("## Runs ^runbook-runs")) writes.push({ op: "update", blockId: step.root, expectedRevision: current.revision,
        text: `${current.text}\n\n## Runs ^runbook-runs\n\n::graph-table\n---\ntitle: Runs\nquery: "type=run under:((${step.root}))"\ncolumns: [title, run.status, run.exit, run.at]\nsort: run.at\ndirection: desc\nmachinery: show\n---\n::` });
    }
    // The record and its first table land as one attributed, revision-checked write group.
    say({ writes });
  }
} catch (error) {
  if (request.operation === "run") say({ title: "Runbook", data: {}, view: { type: "text", text: (error as Error).message } });
  else { process.stderr.write((error as Error).message); process.exitCode = 1; }
}
