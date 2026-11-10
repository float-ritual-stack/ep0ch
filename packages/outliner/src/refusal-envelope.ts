import { refusalKindOf, type RefusalKind } from "@ep0ch/outline-core/refusal";
import type { OutlinerResponse } from "@ep0ch/outline-core/protocol";
import { queryRequestProblem } from "./block-query";
import { isSqliteBusy } from "./sqlite-busy";

/** The kind of a refusal at the host's boundary: the error's own, else `busy` for a locked store (sqlite's errno, not its words). */
export function hostRefusalKind(error: unknown): RefusalKind {
  return isSqliteBusy(error) ? "busy" : refusalKindOf(error);
}

/** Every refusal's envelope, for every branch of the dispatcher, sync and async (busy retries are `retriesBusy`, request-envelope.ts): its words, its kind, and a query's problem when it has one. */
export function refusalEnvelope(id: string, error: unknown, sequence: number): Extract<OutlinerResponse, { ok: false }> {
  const problem = queryRequestProblem(error);
  return { id, ok: false, error: error instanceof Error ? error.message : String(error), kind: hostRefusalKind(error), ...(problem ? { problem } : {}), sequence };
}
