import { refusalKindOf, type RefusalKind } from "@ep0ch/outline-core/refusal";
import type { OutlinerResponse } from "@ep0ch/outline-core/protocol";
import { replayOnce } from "./actions";
import { queryRequestProblem } from "./block-query";
import { isSqliteBusy } from "./sqlite-busy";

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

/** The kind of a refusal at the host's boundary: the error's own, else `busy` for a locked store (sqlite's errno, not its words). */
export function hostRefusalKind(error: unknown): RefusalKind {
  return isSqliteBusy(error) ? "busy" : refusalKindOf(error);
}

/** Every refusal's envelope, for every branch of the dispatcher, sync and async: its words, its kind, and a query's problem when it has one. */
export function refusalEnvelope(id: string, error: unknown, sequence: number): Extract<OutlinerResponse, { ok: false }> {
  const problem = queryRequestProblem(error);
  return { id, ok: false, error: error instanceof Error ? error.message : String(error), kind: hostRefusalKind(error), ...(problem ? { problem } : {}), sequence };
}
