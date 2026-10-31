import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { codeVersion } from "../session/code-version";
import { outlineState } from "../state";
import { messageContext } from "../status-log";

export interface TraceRow {
  trace: string; action: string; tile: string | null; probe: string | null;
  rev: string | null; pid: number; at: string;
}
export interface TraceRun extends TraceRow { rows: TraceRow[] }
export const TRACE_RUNS = 100;
// Read at startup: a checkout advancing underneath a running door is not the code it loaded.
const rev = codeVersion().commit;
let enabled = false;
let runs = new Map<string, TraceRow[]>();
const tracePath = () => join(outlineState(), "trace.jsonl");

export function traceState() { return { enabled, rev, pid: process.pid, path: tracePath(), retained: TRACE_RUNS }; }

export function setTracing(on: boolean) {
  if (on && !enabled) {
    runs = readRuns();
    mkdirSync(outlineState(), { recursive: true, mode: 0o700 });
  }
  enabled = on;
  return traceState();
}

function readRuns(): Map<string, TraceRow[]> {
  const found = new Map<string, TraceRow[]>(), path = tracePath();
  if (existsSync(path)) for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    const row: TraceRow = JSON.parse(line);
    if (!found.has(row.trace)) found.set(row.trace, []);
    found.get(row.trace)!.push(row);
  }
  return found;
}

function append(row: TraceRow) {
  runs.get(row.trace)!.push(row);
  if (runs.size > TRACE_RUNS) {
    runs.delete(runs.keys().next().value!);
    writeFileSync(tracePath(), [...runs.values()].flat().map(r => JSON.stringify(r) + "\n").join(""), { mode: 0o600 });
  } else appendFileSync(tracePath(), JSON.stringify(row) + "\n", { mode: 0o600 });
}

/** A dispatch row survives even when no probe fires, so an absent hit still names the running code. */
export function beginTrace(action: string, tile?: string): string | undefined {
  if (!enabled) return;
  const trace = randomUUID();
  runs.set(trace, []);
  append({ trace, action, tile: tile ?? null, probe: null, rev, pid: process.pid, at: new Date().toISOString() });
  return trace;
}

/** Put this at the owner of a path; the dispatched request supplies its identity. */
export function probe(name: string): void {
  if (!enabled) return;
  const context = messageContext.getStore();
  if (!context?.trace || !runs.has(context.trace)) return;
  append({ trace: context.trace, action: context.action!, tile: context.tile ?? null, probe: name, rev, pid: process.pid, at: new Date().toISOString() });
}

export function traceRuns(action: string | undefined, last: number): TraceRun[] {
  return [...readRuns().values()].filter(rows => !action || rows[0]!.action === action).slice(-last).map(rows => ({ ...rows[0]!, rows }));
}
