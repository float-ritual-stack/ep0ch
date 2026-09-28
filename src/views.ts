// Read a saved virtual-branch view. The service owns what a view means: when it has `views.read`
// (PIE-397) the door asks it and shows the answer. Against an older service the door falls back to
// its own port of the outliner's evaluator (pi-herdr-outliner src/saved-view-read.ts +
// virtual-branches.ts): parse the query into property filters, ask the service for branch-local
// rank order when the view has no sort, keep canonical roots once, honour the authored limit, and
// report invalid / failed / truncated distinctly from an empty result.
//
// Either way the door also reads the query's shape for itself (`queryShape`), but only to plan a
// card move and to decide which lanes a change could touch; it never decides membership with it.
import type { Msg } from "./board";
import type { SocketBoard } from "./socket";

export interface PropertyFilter { key: string; value?: string }
export interface ViewRead {
  status: "ready" | "invalid" | "unsupported" | "missing" | "changed" | "failed";
  items: Msg[];
  limit: number;
  truncated: boolean;
  errors: string[];
  /** The query as property clauses that must all hold, when it is only that: what a card must carry to be in this view. */
  filters: PropertyFilter[];
  /**
   * Set when the query is more than a list of clauses (OR, NOT, a date range, parentheses): why a
   * property patch can't be trusted to put a card in this view. `filters` is empty then.
   */
  unpatchable?: string;
  /** For an unpatchable query that is still a plain AND: the clauses any member must carry (NOT and date terms left out). */
  required?: PropertyFilter[];
  /** Every member, beyond the limit (views.read only). */
  total?: number;
  /** Who evaluated it: the service (views.read) or the door's own port (older services). */
  by?: "service" | "door";
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
  return queryTokens(input).map(parseFilterClause);
}

/** Split on whitespace outside double quotes, keeping the quotes (block-query.ts's tokenizer). */
function queryTokens(input: string): string[] {
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
  return tokens;
}

/**
 * What kind of query this is, for moving cards: a plain list of clauses a property patch can
 * satisfy, or the reason it can't be. Newer services also accept `OR`, `NOT`, parentheses and
 * `created`/`updated` ranges (PIE-398); the door recognises those words only to refuse a move, and
 * leaves what they select to the service.
 */
export function queryShape(input: string): { filters: PropertyFilter[] } | { unpatchable: string; required?: PropertyFilter[] } {
  let tokens: string[];
  try { tokens = queryTokens(input); } catch (e) { return { unpatchable: `its query doesn't parse here (${(e as Error).message})` }; }
  const bare = (t: string | undefined) => (t === undefined || t.startsWith('"') ? "" : t.toLowerCase());
  const isTime = (t: string) => t === "created" || t === "updated";
  const op = /^[<>]=?/;
  // How many tokens a created/updated range at i takes (`updated >= -7d`, `updated>= -7d`, `updated>=-7d`), or 0.
  const range = (i: number): number => {
    const t = bare(tokens[i]), next = bare(tokens[i + 1]);
    if (isTime(t) && op.test(next)) return next.replace(op, "") ? 2 : 3;
    const m = t.match(/^(created|updated)\s*([<>]=?)(.*)$/);
    return m ? (m[3] ? 1 : 2) : 0;
  };
  let why: string | null = null, grouped = false;
  const clauses: string[] = [], required: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = bare(tokens[i]);
    if (t === "or") { why ??= "uses OR; a move can't pick which side to satisfy"; grouped = true; continue; }
    if (t.startsWith("(") || t.startsWith("not(")) { why ??= "groups clauses in parentheses; a move only satisfies a plain list of clauses"; grouped = true; continue; }
    if (t === "not") {
      why ??= "uses NOT; a move won't remove or invent properties to satisfy it";
      const n = range(i + 1);
      i += n || 1;                                            // NOT applies to the next term only
      continue;
    }
    const n = range(i);
    if (n || op.test(t)) { why ??= "filters by when cards were created or updated; a move can't change that"; i += Math.max(0, n - 1); continue; }
    if (t === "and") continue;              // an explicit AND means the same as the space between clauses
    clauses.push(tokens[i]!);
  }
  if (why) {
    // A plain AND of terms: its plain clauses must still hold for a card to be in the view. With OR or
    // parentheses the door can't say even that.
    if (grouped) return { unpatchable: why };
    try { return { unpatchable: why, required: clauses.map(parseFilterClause) }; } catch { return { unpatchable: why }; }
  }
  try { return { filters: clauses.map(parseFilterClause) }; }
  catch (e) { return { unpatchable: `its query isn't a list of property clauses (${(e as Error).message})` }; }
}

/** The outliner's matchesFilters over block-scope properties: every clause holds for some property. */
export function matchesFilters(properties: readonly { key: string; value: string }[], filters: readonly PropertyFilter[]): boolean {
  return filters.every(f => properties.some(p => p.key === f.key && (f.value === undefined || p.value.toLowerCase() === f.value.toLowerCase())));
}

export async function readView(board: SocketBoard, def: Msg): Promise<ViewRead> {
  const served = await board.readSavedView(def.id).catch((e: Error) => ({ failed: e.message }));
  if (served && "failed" in served) return { status: "failed", items: [], limit: DEFAULT_LIMIT, truncated: false, errors: [served.failed], filters: [], by: "service" };
  if (!served) return readViewHere(board, def);
  const shape = served.status === "ready" ? queryShape(def.props.query ?? "") : { filters: [] };
  return {
    status: served.status,
    items: served.blocks,
    limit: served.effectiveLimit ?? served.configuredLimit ?? DEFAULT_LIMIT,
    truncated: served.completeness?.kind === "truncated" || served.nextOffset !== undefined,
    errors: served.errors,
    filters: "filters" in shape ? shape.filters : [],
    ...("unpatchable" in shape ? { unpatchable: shape.unpatchable, ...(shape.required ? { required: shape.required } : {}) } : {}),
    total: served.total,
    by: "service",
  };
}

/** The door's own evaluation, for services without views.read. Kept identical to the outliner's (tested). */
export async function readViewHere(board: SocketBoard, def: Msg): Promise<ViewRead> {
  const errors: string[] = [];
  let filters: PropertyFilter[] = [];
  const empty = (status: ViewRead["status"], limit = DEFAULT_LIMIT): ViewRead => ({ status, items: [], limit, truncated: false, errors, filters, by: "door" });
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
      ...board.listFields(),
    });
    const seen = new Set<string>();
    const roots = board.toMsgs(r.blocks).filter(m => m.id !== def.id && !seen.has(m.id) && (seen.add(m.id), true));
    return { status: "ready", items: roots.slice(0, limit), limit, truncated: roots.length > limit || r.completeness?.kind === "truncated", errors, filters, by: "door" };
  } catch (e) {
    errors.push((e as Error).message);
    return empty("failed", limit);
  }
}
