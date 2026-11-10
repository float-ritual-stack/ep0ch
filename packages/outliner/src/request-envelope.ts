import { replayOnce } from "./actions";
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
