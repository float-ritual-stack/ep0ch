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
  /** The parsed query, when it parsed: what a card must carry to be in this view. */
  filters: PropertyFilter[];
}

const DEFAULT_LIMIT = 200, MAX_LIMIT = 1000;
const BOOLEAN = new Set(["and", "not", "or"]);
// The outliner's property key (properties.ts PROPERTY_KEY_PATTERN): a letter first.
const KEY = /^[A-Za-z][A-Za-z0-9_.-]*$/;

// block-query.ts parseQuotedValue: only \\ and \" escape, nothing may follow the closing quote.
function quoted(raw: string): string {
  let value = "";
  for (let i = 1; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === '"') {
      if (raw.slice(i + 1).trim()) throw new Error("Unexpected text after quoted filter value");
      return value;
    }
    if (c !== "\\") { value += c; continue; }
    const e = raw[i + 1];
    if (e !== "\\" && e !== '"') throw new Error('Only \\\\ and \\" escapes are supported');
    value += e; i++;
  }
  throw new Error("Unterminated quoted filter value");
}

/** One clause: `key` (the property is present) or `key=value` / `key::value` (case-insensitive value). */
export function parseFilterClause(input: string): PropertyFilter {
  const text = input.trim();
  if (!text) throw new Error("Property filter clause cannot be empty");
  const eq = text.indexOf("="), dc = text.indexOf("::");
  const sep = eq < 0 && dc < 0 ? null : eq < 0 ? { at: dc, len: 2 } : dc < 0 ? { at: eq, len: 1 } : eq < dc ? { at: eq, len: 1 } : { at: dc, len: 2 };
  const raw = sep ? text.slice(0, sep.at).trim() : text;
  if (!KEY.test(raw)) throw new Error(`Invalid property filter key: ${raw || "(empty)"}`);
  const key = raw.toLowerCase();
  if (BOOLEAN.has(key)) throw new Error(`Boolean operator ${raw} is not supported`);
  if (!sep) return { key };
  const rawValue = text.slice(sep.at + sep.len).trim();
  if (!rawValue) throw new Error(`Property filter value cannot be empty: ${key}`);
  const value = (rawValue.startsWith('"') ? quoted(rawValue) : rawValue).trim();
  if (!value) throw new Error(`Property filter value cannot be empty: ${key}`);
  if (/[\]\r\n]/.test(value)) throw new Error(`Property filter value cannot contain ], CR, or LF: ${key}`);
  return { key, value };
}

/** Whitespace-separated clauses, all of which must hold; double quotes keep spaces inside a value. */
export function parseFilterExpression(input: string): PropertyFilter[] {
  const tokens: string[] = [];
  let cur = "", inQuote = false, escaped = false;
  for (const ch of input) {
    if (escaped) {
      if (ch !== "\\" && ch !== '"') throw new Error('Only \\\\ and \\" escapes are supported');
      cur += ch; escaped = false; continue;
    }
    if (ch === "\\" && inQuote) { cur += ch; escaped = true; continue; }
    if (ch === '"') inQuote = !inQuote;
    if (!inQuote && /\s/.test(ch)) { if (cur) tokens.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (escaped) throw new Error("Dangling escape in quoted filter value");
  if (inQuote) throw new Error("Unterminated quoted filter value");
  if (cur) tokens.push(cur);
  return tokens.map(parseFilterClause);
}

/** The outliner's matchesFilters over block-scope properties: every clause holds for some property. */
export function matchesFilters(properties: readonly { key: string; value: string }[], filters: readonly PropertyFilter[]): boolean {
  return filters.every(f => properties.some(p => p.key === f.key && (f.value === undefined || p.value.toLowerCase() === f.value.toLowerCase())));
}

export async function readView(board: SocketBoard, def: Msg): Promise<ViewRead> {
  const errors: string[] = [];
  let filters: PropertyFilter[] = [];
  const empty = (status: ViewRead["status"], limit = DEFAULT_LIMIT): ViewRead => ({ status, items: [], limit, truncated: false, errors, filters });
  if ((def.props.type ?? "").toLowerCase() !== "virtual-branch") {
    errors.push("Only type=virtual-branch views are read; other kinds are not substituted with a property query");
    return empty("unsupported");
  }
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
    return { status: "ready", items: roots.slice(0, limit), limit, truncated: roots.length > limit || r.completeness?.kind === "truncated", errors, filters };
  } catch (e) {
    errors.push((e as Error).message);
    return empty("failed", limit);
  }
}
