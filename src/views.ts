// Read a saved virtual-branch view the way the outliner's Tree and `pie view` do
// (pi-herdr-outliner src/saved-view-read.ts + virtual-branches.ts), ported rather than
// imported: parse the query into property filters, ask the service for branch-local
// rank order when the view has no sort, keep canonical roots once, honour the authored
// limit, and report invalid / failed / truncated distinctly from an empty result.
import type { Msg } from "./board";
import type { SocketBoard } from "./socket";

export interface PropertyFilter { key: string; value?: string }
export interface ViewRead {
  status: "ready" | "invalid" | "unsupported" | "failed";
  items: Msg[];
  limit: number;
  truncated: boolean;
  errors: string[];
}

const DEFAULT_LIMIT = 200, MAX_LIMIT = 1000;
const BOOLEAN = new Set(["and", "not", "or"]);
const KEY = /^[a-z0-9][a-z0-9_.-]*$/i;

function clause(text: string): PropertyFilter {
  const eq = text.indexOf("="), dc = text.indexOf("::");
  const sep = eq < 0 && dc < 0 ? null : eq < 0 ? { at: dc, len: 2 } : dc < 0 ? { at: eq, len: 1 } : eq < dc ? { at: eq, len: 1 } : { at: dc, len: 2 };
  const key = (sep ? text.slice(0, sep.at) : text).trim().toLowerCase();
  if (!KEY.test(key)) throw new Error(`Invalid property filter key: ${key || "(empty)"}`);
  if (BOOLEAN.has(key)) throw new Error(`Boolean operator ${key} is not supported`);
  if (!sep) return { key };
  let value = text.slice(sep.at + sep.len).trim();
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2) throw new Error(`Unterminated quoted value for ${key}`);
    value = value.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (!value) throw new Error(`Property filter value cannot be empty: ${key}`);
  if (/[\]\r\n]/.test(value)) throw new Error(`Property filter value cannot contain ], CR, or LF: ${key}`);
  return { key, value };
}

/** Whitespace-separated clauses; double quotes keep spaces inside a value. */
export function parseFilterExpression(input: string): PropertyFilter[] {
  const tokens: string[] = [];
  let cur = "", quoted = false, escaped = false;
  for (const ch of input) {
    if (escaped) { cur += ch; escaped = false; continue; }
    if (ch === "\\" && quoted) { cur += ch; escaped = true; continue; }
    if (ch === '"') quoted = !quoted;
    if (!quoted && /\s/.test(ch)) { if (cur) tokens.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (quoted) throw new Error("Unterminated quoted value");
  if (cur) tokens.push(cur);
  return tokens.map(clause);
}

export async function readView(board: SocketBoard, def: Msg): Promise<ViewRead> {
  const errors: string[] = [];
  const empty = (status: ViewRead["status"], limit = DEFAULT_LIMIT): ViewRead => ({ status, items: [], limit, truncated: false, errors });
  if ((def.props.type ?? "").toLowerCase() !== "virtual-branch") {
    errors.push("Only type=virtual-branch views are read; other kinds are not substituted with a property query");
    return empty("unsupported");
  }
  let filters: PropertyFilter[] = [];
  try { filters = parseFilterExpression(def.props.query ?? ""); } catch (e) { errors.push(`Invalid virtual branch query: ${(e as Error).message}`); }
  if (!errors.length && !filters.length) errors.push("Virtual branch query cannot be empty");
  const sortField = def.props.sort?.toLowerCase(), direction = (def.props.direction ?? "desc").toLowerCase();
  if (!sortField && def.props.direction) errors.push("Virtual branch direction requires a sort property");
  if (sortField && sortField !== "created" && sortField !== "updated") errors.push(`Virtual branch sort must be created or updated: ${def.props.sort}`);
  if (sortField && direction !== "asc" && direction !== "desc") errors.push(`Virtual branch direction must be asc or desc: ${def.props.direction}`);
  let limit = DEFAULT_LIMIT;
  if (def.props.limit !== undefined) {
    const n = Number(def.props.limit);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) errors.push("Virtual branch limit must be an integer from 1 through 1000");
    else limit = n;
  }
  if (errors.length) return empty("invalid", limit);
  try {
    const r = await board.request<{ blocks: any[]; completeness: { kind: string } }>("blocks.query", {
      query: {
        filters, limit: MAX_LIMIT,
        ...(sortField ? { sort: { field: sortField, direction } } : { rankViewId: def.id }),
      },
    });
    const seen = new Set<string>();
    const roots = board.toMsgs(r.blocks).filter(m => m.id !== def.id && !seen.has(m.id) && (seen.add(m.id), true));
    return { status: "ready", items: roots.slice(0, limit), limit, truncated: roots.length > limit || r.completeness?.kind === "truncated", errors };
  } catch (e) {
    errors.push((e as Error).message);
    return empty("failed", limit);
  }
}
