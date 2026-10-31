import { setTracing, traceRuns, traceState, type TraceRun } from "./surface/probe";
import type { SocketBoard } from "./socket";
import { prop } from "./props";
import { subject } from "./board";

export type TraceAsk = { op: "on" | "off" | "show"; action?: string; last: number };
export const TRACE_USAGE = "ep0ch trace on|off|show [action] [--last N] [--json]";

export function traceAsk(args: string[]): TraceAsk {
  const op = args[0];
  if (op !== "on" && op !== "off" && op !== "show") throw new Error(TRACE_USAGE);
  let last = 10, action: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const word = args[i]!;
    if (word === "--json") continue;
    if (word === "--last" && op === "show") {
      last = Number(args[++i]);
      if (!Number.isSafeInteger(last) || last < 1) throw new Error(`--last needs a positive integer · ${TRACE_USAGE}`);
    } else if (op === "show" && !word.startsWith("-") && action === undefined) action = word;
    else throw new Error(TRACE_USAGE);
  }
  return { op, action, last };
}

export interface HandlerFinding { ask: string; title: string; handlers: string[] }
export interface TraceReport extends ReturnType<typeof traceState> {
  runs?: TraceRun[];
  service?: { from: number; through: number; findings: HandlerFinding[]; unavailable?: string };
}

export async function traceReport(ask: TraceAsk, board: SocketBoard): Promise<TraceReport> {
  if (ask.op !== "show") return setTracing(ask.op === "on");
  return { ...traceState(), runs: traceRuns(ask.action, ask.last), service: await handlerFindings(board) };
}

/** The mirror is deliberately separate: these are service writes, not door trace ids. */
async function handlerFindings(board: SocketBoard): Promise<NonNullable<TraceReport["service"]>> {
  const through = (await board.changesSince(Number.MAX_SAFE_INTEGER, 1)).sequence;
  const from = Math.max(0, through - 500);
  const page = await board.changesSince(from, 500);
  if (page.kind === "reset") return { from, through: page.sequence, findings: [], unavailable: page.reason };
  const writes = page.changes.flatMap(change => {
    const handler = /^ext\..+\.agent\./.test(change.action) ? change.action : change.actor?.author === "agent" ? change.actor.actorId : undefined;
    return handler && change.blockId && !change.bookkeeping && !change.deleted ? [{ id: change.blockId, handler }] : [];
  });
  const blocks = new Map((await board.readMany([...new Set(writes.map(w => w.id))])).map(m => [m.id, m]));
  const asks = new Map<string, HandlerFinding>();
  for (const { id: written, handler } of writes) {
    const block = blocks.get(written);
    if (!block) continue;
    const id = prop(block, "parent-annotation") ?? written;
    let finding = asks.get(id);
    if (!finding) { finding = { ask: id, title: id, handlers: [] }; asks.set(id, finding); }
    if (!finding.handlers.includes(handler)) finding.handlers.push(handler);
  }
  const findings = [...asks.values()].filter(f => f.handlers.length > 1);
  const titles = new Map((await board.readMany(findings.map(f => f.ask))).map(m => [m.id, subject(m)]));
  for (const finding of findings) finding.title = titles.get(finding.ask) ?? finding.ask;
  return { from, through: page.sequence, findings };
}

export function traceText(report: TraceReport): string {
  const lines = [`tracing ${report.enabled ? "on" : "off"} · code ${report.rev ?? "unknown"} · pid ${report.pid}`, `${report.path} · keeps ${report.retained} runs`];
  if (report.runs) {
    if (!report.runs.length) lines.push("no matching runs recorded · ep0ch trace on, then drive the action");
    for (const run of report.runs) {
      lines.push(`${run.trace} · ${run.action} · tile ${run.tile ?? "—"} · code ${run.rev ?? "unknown"} · pid ${run.pid} · ${run.at}`);
      const hits = run.rows.filter(r => r.probe !== null);
      lines.push(...(hits.length ? hits.map(r => `  ${r.at} · ${r.probe} · tile ${r.tile ?? "—"}`) : ["  no probes reached"]));
    }
  }
  if (report.service) {
    lines.push(`service changes ${report.service.from + 1}–${report.service.through}`);
    for (const f of report.service.findings) lines.push(`${f.title} (${f.ask}): ${f.handlers.length} handlers answered one ask · ${f.handlers.join(", ")}`);
    if (report.service.unavailable) lines.push(`service mirror unavailable: ${report.service.unavailable}`);
    else if (!report.service.findings.length) lines.push("no multiple-handler findings in this window");
  }
  return lines.join("\n") + "\n";
}
