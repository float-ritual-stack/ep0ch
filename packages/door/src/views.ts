// Read a saved virtual-branch view. The service owns what a view means: `views.read` (PIE-397) answers
// its members, in branch order, within its limit. The door shows that answer and never evaluates a
// view itself. What a write into a view must change is the service's answer too (`views.planWrite`, src/move.ts).
import type { Msg } from "./board";
import type { SavedViewRead, SocketBoard } from "./socket";

export interface ViewRead {
  status: "ready" | "invalid" | "unsupported" | "missing" | "changed" | "failed";
  items: Msg[];
  limit: number;
  truncated: boolean;
  errors: string[];
  /** Every member, beyond the limit. */
  total?: number;
}

const DEFAULT_LIMIT = 200;

export async function readView(board: SocketBoard, def: Msg): Promise<ViewRead> {
  const served = await board.readSavedView(def.id).catch((e: Error) => ({ failed: e.message }));
  if ("failed" in served) return { status: "failed", items: [], limit: DEFAULT_LIMIT, truncated: false, errors: [served.failed] };
  return viewReadOf(served);
}

/** A `views.read` answer (its blocks already rows) as the door reads a view. */
export function viewReadOf(served: SavedViewRead): ViewRead {
  return {
    status: served.status,
    items: served.blocks,
    limit: served.effectiveLimit ?? served.configuredLimit ?? DEFAULT_LIMIT,
    truncated: served.completeness?.kind === "truncated" || served.nextOffset !== undefined,
    errors: served.errors,
    total: served.total,
  };
}
