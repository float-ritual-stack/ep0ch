import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
import type { RunbookStep } from "@ep0ch/outline-core/runbook";
import { outline } from "./outline";
import { recordText } from "./record";

// Installed copies live outside the checkout; Bun does not use NODE_PATH for ESM imports.
const core = createRequire(join(process.env.NODE_PATH!, "../package.json"));
const { outputAnchor, outputHash, outputRegionAt } = core("@ep0ch/outline-core/output-region") as typeof import("@ep0ch/outline-core/output-region");
const { parsePropertyRecords } = core("@ep0ch/outline-core/property-parse") as typeof import("@ep0ch/outline-core/property-parse");
const { plainText } = core("@ep0ch/outline-core/secret-scrub") as typeof import("@ep0ch/outline-core/secret-scrub");
const { clockWords } = core("@ep0ch/outline-core/age") as typeof import("@ep0ch/outline-core/age");
const { shellStages } = core("@ep0ch/outline-core/shell-line") as typeof import("@ep0ch/outline-core/shell-line");

interface Block { id: string; text: string; revision: number }
interface Request {
  operation: "run" | "act";
  deadlineAt: number;
  input: {
    handler?: string; action?: string; args?: Record<string, string>;
    context: { block: Block; line?: { index: number }; runbook?: { steps: RunbookStep[]; records: Block[] } };
    target?: { line?: number }; requestedBy?: { author: string; actorId?: string };
  };
}

const field = (text: string, key: string) => parsePropertyRecords(text).find(p => p.key === key)?.value;
const outputLines = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");

async function command(step: RunbookStep, text: string, deadlineAt: number) {
  const binary = step.shell === "nu" ? Bun.which("nu") : "sh";
  if (!binary) throw new Error("nu is not installed on this machine; install Nushell and put nu on PATH");
  const literal = (value: string) => value.replace(/\{\{(RUNBOOK_VALUE_\d+)\}\}/g, (_, key: string) => step.env[key] ?? "");
  const env = Object.fromEntries(Object.entries(step.env).map(([key, value]) => [key, literal(value)]));
  return new Promise<{ stdout: string; stderr: string; exit: number; timedOut: boolean }>((done, fail) => {
    const child = spawn(binary, ["-c", text], { cwd: step.cwd, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    const stop = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } };
    const timer = setTimeout(() => { timedOut = true; stop(); }, Math.max(1, deadlineAt - Date.now() - 1000));
    process.once("SIGTERM", stop);
    const cleanup = () => { clearTimeout(timer); process.off("SIGTERM", stop); };
    child.once("error", error => { cleanup(); fail(error); });
    child.once("close", code => { cleanup(); done({ stdout: plainText(stdout), stderr: plainText(stderr), exit: code ?? 124, timedOut }); });
  });
}

export async function shellHandler(request: Request): Promise<unknown> {
  const { context, args = {} } = request.input;
  const line = request.input.target?.line ?? context.line!.index;
  const step = context.runbook?.steps.find(s => s.block === context.block.id && s.line === line && s.shell);
  if (!step) throw new Error("Choose a sh:: or nu:: command line");
  const shell = step.shell!;
  const anchor = outputAnchor(step.block, `^${step.anchor}`, shell);
  const current = await outline<Block>({ action: "get", blockId: step.block });
  const region = outputRegionAt(current.text, anchor);
  if (request.operation === "run") {
    const last = context.runbook!.records.filter(r => field(r.text, "run.step") === `^${step.anchor}`).at(-1);
    const at = last && field(last.text, "run.at"), status = last && field(last.text, "run.status");
    const message = last && field(last.text, "run.message");
    const time = at ? clockWords(at, Date.now()) : "";
    const facts = message || (region?.edited ? `${shell} · edited output; replace it or keep as your text` : at ? `${shell} · as of ${time}` : `${shell} · not run`);
    const children: unknown[] = [{ type: "row", children: [
      { type: "text", text: facts },
      { type: "button", label: at ? "run again" : "run", act: `ext.runbook.run-${shell} block=${step.block} line=${line}` },
      ...(last ? [{ type: "button", label: "run record", act: `open id=${last.id}` }] : []),
      ...(region ? [{ type: "button", label: "Keep as my text", act: `ext.runbook.keep-${shell} block=${step.block} line=${line}` }] : []),
    ] }];
    const cat = /^cat\s+(?:'([^']+)'|"([^"]+)"|([^\s|;<>]+))\s*$/.exec(shellStages(step.command).command);
    if (cat) {
      const path = resolve(step.cwd!, (cat[1] ?? cat[2] ?? cat[3]!).replace(/^~(?=$|\/)/, homedir()));
      const known = await outline<{ blocks: { id: string }[] }>({ action: "blocks.query", query: { where: `file=${JSON.stringify(path)}`, limit: 1 } });
      children.push({ type: "text", text: `Live instead: [file::${path}]${known.blocks[0] ? ` or !((${known.blocks[0].id}))` : ""}` });
    }
    return { title: shell, data: { status, at, record: last?.id }, view: { type: "stack", children } };
  }
  if (request.input.action?.startsWith("keep-")) {
    if (!region) throw new Error("This line has no output to keep");
    await outline({ action: "draft.patch", blockId: current.id, revision: current.revision, policy: "edit", patches: [{ observed: current.text.slice(region.start, region.end), range: { start: region.start, end: region.end }, replacement: region.body }] });
    return { message: "Kept as your text; the next run makes its own region" };
  }
  if (region?.edited && args.replace !== outputHash(region.body)) return {
    confirmation: { message: "This output was edited; replace your text?", argument: "replace", value: outputHash(region.body) },
  };
  const at = new Date().toISOString();
  const by = request.input.requestedBy?.author === "user" ? "person" : request.input.requestedBy?.actorId ?? "ext:runbook";
  let exit: number | undefined, stdout = "", stderr = "", failure: string | undefined;
  try {
    if (step.problems.length) throw new Error(step.problems.join("\n"));
    if (step.fields.length) throw new Error(`Supply ${step.fields.map(f => f.name).join(", ")} in a runbook fence with its prompt`);
    const pipeline = shellStages(step.command);
    const result = await command(step, pipeline.command, request.deadlineAt);
    exit = result.exit; stdout = result.stdout; stderr = result.stderr;
    if (result.timedOut) throw new Error("runbook deadline reached; command stopped");
    if (exit !== 0) throw new Error(`exit ${exit}: ${stderr.split("\n")[0] || "command failed"}`);
    let content = stdout;
    for (const name of pipeline.stages) content = (await outline<{ markdown: string }>({ action: "scripts.render", of: name, blockId: step.block, line, props: { lines: outputLines(content), cwd: [step.cwd!] }, deadlineMs: Math.max(1, request.deadlineAt - Date.now() - 1000) }, { timeoutMs: Math.max(1, request.deadlineAt - Date.now()) })).markdown;
    const lines = outputLines(content);
    if (lines.length > 200) content = [...lines.slice(0, 200), `+${lines.length - 200} lines`].join("\n");
    const placed = await outline<{ outcome: string; message: string }>({ action: "outputs.place", blockId: step.block, producer: { id: step.block, name: shell }, at: region ? anchor : step.anchor, mode: "upsert", content, here: line, ...(args.replace ? { replaceHash: args.replace } : {}) });
    if (placed.outcome !== "applied") throw new Error(placed.message);
  } catch (error) { failure = (error as Error).message; }
  const status = failure ? "failed" : "ok";
  const words = failure ? ` [run.message::${failure.replace(/[\]\r\n]/g, " ").slice(0, 350)}]` : "";
  const text = recordText(step, { status, at, end: new Date().toISOString(), cwd: step.cwd!, owner: `${hostname()}:${process.pid}`, ...(exit !== undefined ? { exit: String(exit) } : {}), output: `${stdout}\n${stderr}${failure ? `\n${failure}` : ""}` }, by).replace("\n", `${words}\n`);
  const record = await outline<Block>({ action: "create", parentId: step.root, text });
  if (failure) throw new Error(`${failure} · run record ((${record.id}))`);
  return { message: `${shell} output written · run record ((${record.id}))` };
}
