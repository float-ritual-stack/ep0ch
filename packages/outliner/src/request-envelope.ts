import { replayOnce } from "./actions";
import { queryRequestProblem } from "./block-query";
import { isSqliteBusy } from "./sqlite-busy";
import type { OutlinerResponse } from "./types";

/** How long a busy database is waited out before its one retry. */
export const BUSY_RETRY_MS = 50;

/**
 * Whether a busy database is tried once more, the one rule for the host's sync and async dispatch: a request may
 * contain several commits, so only when none of its content landed (`sequence` unchanged), and never an action whose
 * row says `once` (it acts outside the store, a provider command or a deploy).
 */
export function retriesBusy(request: { action: unknown }, error: unknown, attempt: number, sequence: { before: number; now: number }): boolean {
  return isSqliteBusy(error) && attempt === 0 && sequence.now === sequence.before && !replayOnce(request.action);
}

/** Every refusal's envelope, for every branch and both paths: its words, and a query's problem when it has one. */
export function refusal(id: string, error: unknown, sequence: number): OutlinerResponse {
  const problem = queryRequestProblem(error);
  return { id, ok: false, error: error instanceof Error ? error.message : String(error), ...(problem ? { problem } : {}), sequence };
}
