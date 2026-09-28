// The saved-view query grammar with OR, NOT, parentheses and created/updated ranges (PIE-398), ported
// from the outliner's block-query.ts (lexQueryExpression, ExpressionParser, compileQueryExpression) so
// the door can plan a write: which plain clauses a move or a new card has to set, and whether the rest
// of the query (a group, a NOT, a range) holds for the card as it will be. Membership itself is still
// the service's answer (views.read); this only decides what the door may patch. Parity with the
// outliner's parser and evaluator is tested (test/kanban.test.ts).
import { parseFilterClause, type PropertyFilter } from "./views";

export type QueryExpr =
  | { kind: "property"; key: string; value?: string }
  | { kind: "time"; field: "created" | "updated"; op: "<" | "<=" | ">" | ">="; value: string }
  | { kind: "not"; operand: QueryExpr }
  | { kind: "and" | "or"; operands: QueryExpr[] };

type Tok =
  | { kind: "lparen" | "rparen" | "and" | "or" | "not" }
  | { kind: "cmp"; op: "<" | "<=" | ">" | ">=" }
  | { kind: "word"; text: string };

const MAX_DEPTH = 32, MAX_LEAVES = 200, DAY = 86_400_000;

/** block-query.ts tokenizeFilterExpression: split on whitespace outside double quotes, quotes kept. */
function words(input: string): string[] {
  const out: string[] = [];
  let start = -1, quoted = false, escaped = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (start < 0) { if (/\s/.test(c)) continue; start = i; }
    if (quoted) {
      if (escaped) { if (c !== "\\" && c !== '"') throw new Error('Only \\\\ and \\" escapes are supported'); escaped = false; }
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (/\s/.test(c)) { out.push(input.slice(start, i)); start = -1; }
  }
  if (escaped) throw new Error("Dangling escape in quoted filter value");
  if (quoted) throw new Error("Unterminated quoted filter value");
  if (start >= 0) out.push(input.slice(start));
  return out;
}

/** Trailing ")" in one word that close no "(" of the word itself (quotes excluded). */
function trailingUnbalanced(text: string): number {
  const unbalanced = new Set<number>();
  let open = 0, quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === "\\") i++; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === "(") open++;
    else if (c === ")") { if (open > 0) open--; else unbalanced.add(i); }
  }
  let n = 0;
  while (unbalanced.has(text.length - 1 - n)) n++;
  return n;
}

function lex(input: string): { tokens: Tok[]; simple: boolean } {
  const tokens: Tok[] = [];
  let depth = 0, simple = true;
  for (const word of words(input)) {
    let text = word;
    while (text.startsWith("(")) { tokens.push({ kind: "lparen" }); depth++; simple = false; text = text.slice(1); }
    const closing = Math.min(depth, trailingUnbalanced(text));
    text = text.slice(0, text.length - closing);
    if (text) {
      const lower = text.toLowerCase();
      const keyed = /^([A-Za-z][A-Za-z0-9_.-]*)(<=|>=|<|>)(.*)$/s.exec(text);
      const bare = /^(<=|>=|<|>)(.*)$/s.exec(text);
      if (lower === "and" || lower === "or" || lower === "not") { tokens.push({ kind: lower }); simple = false; }
      else if (keyed) {
        tokens.push({ kind: "word", text: keyed[1]! }, { kind: "cmp", op: keyed[2] as any });
        if (keyed[3]) tokens.push({ kind: "word", text: keyed[3] });
        simple = false;
      } else if (bare) {
        tokens.push({ kind: "cmp", op: bare[1] as any });
        if (bare[2]) tokens.push({ kind: "word", text: bare[2] });
        simple = false;
      } else tokens.push({ kind: "word", text });
    }
    for (let i = 0; i < closing; i++) { tokens.push({ kind: "rparen" }); depth--; }
  }
  return { tokens, simple };
}

/** block-query.ts parseQueryTime, for evaluating a range; throws on a value the service would refuse. */
function timeBound(value: string, now: number): { at: number } | { day: number } {
  const v = value.trim(), lower = v.toLowerCase();
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lower);
  const day = (y: number, m: number, d: number) => { const s = Date.UTC(y, m - 1, d), x = new Date(s); return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? s : null; };
  if (date) { const s = day(+date[1]!, +date[2]!, +date[3]!); if (s === null) throw new Error(`Invalid date: ${value}`); return { day: s }; }
  const dt = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))?$/.exec(v);
  if (dt) {
    const [, y, mo, d, h, mi, s = "0", zone, oh = "0", om = "0"] = dt;
    if (day(+y!, +mo!, +d!) === null || +h! > 23 || +mi! > 59 || +s > 59 || +oh > 23 || +om > 59) throw new Error(`Invalid time: ${value}`);
    const at = Date.parse(zone ? v : `${v}Z`);
    if (!Number.isFinite(at)) throw new Error(`Invalid datetime: ${value}`);
    return { at };
  }
  const today = Math.floor(now / DAY) * DAY;
  if (lower === "now") return { at: now };
  if (lower === "today") return { day: today };
  if (lower === "yesterday") return { day: today - DAY };
  const rel = /^-(\d{1,6})([hdw])$/.exec(lower);
  if (rel) return { at: now - Number(rel[1]) * (rel[2] === "h" ? 3_600_000 : rel[2] === "d" ? DAY : 7 * DAY) };
  throw new Error(`Invalid time value: ${value}; use YYYY-MM-DD, an ISO datetime, now, today, yesterday or -N followed by h, d or w`);
}

class Parser {
  private i = 0;
  private leaves = 0;
  constructor(private readonly t: Tok[]) {}
  parse(): QueryExpr {
    if (!this.t.length) throw new Error("Query cannot be empty");
    const e = this.or(0);
    const extra = this.t[this.i];
    if (extra) throw new Error(extra.kind === "rparen" ? "Unmatched )" : "Unexpected query text");
    return e;
  }
  private peek() { return this.t[this.i]; }
  private or(d: number): QueryExpr {
    const ops = [this.and(d)];
    while (this.peek()?.kind === "or") { this.i++; ops.push(this.and(d)); }
    return ops.length === 1 ? ops[0]! : { kind: "or", operands: ops };
  }
  private and(d: number): QueryExpr {
    const ops = [this.unary(d)];
    for (;;) {
      const n = this.peek();
      if (!n || n.kind === "or" || n.kind === "rparen") break;
      if (n.kind === "and") this.i++;
      ops.push(this.unary(d));
    }
    return ops.length === 1 ? ops[0]! : { kind: "and", operands: ops };
  }
  private unary(d: number): QueryExpr {
    if (this.peek()?.kind === "not") {
      this.i++;
      const k = this.peek()?.kind;
      if (k !== "word" && k !== "lparen" && k !== "not") throw new Error("NOT requires a clause or group after it");
      return { kind: "not", operand: this.unary(d) };
    }
    return this.primary(d);
  }
  private primary(d: number): QueryExpr {
    const t = this.peek();
    if (!t) throw new Error("Expected a clause or group");
    if (t.kind === "lparen") {
      if (d >= MAX_DEPTH) throw new Error("Query groups are nested too deeply");
      this.i++;
      if (this.peek()?.kind === "rparen") throw new Error("Empty group");
      const inner = this.or(d + 1);
      if (this.peek()?.kind !== "rparen") throw new Error("Unclosed (");
      this.i++;
      return inner;
    }
    if (t.kind === "cmp") throw new Error("A range needs created or updated before its comparison");
    if (t.kind !== "word") throw new Error(`${t.kind.toUpperCase()} needs a clause before it`);
    this.i++;
    if (++this.leaves > MAX_LEAVES) throw new Error("Query has too many clauses");
    const cmp = this.peek();
    if (cmp?.kind === "cmp") {
      this.i++;
      const field = t.text.toLowerCase();
      if (field !== "created" && field !== "updated") throw new Error("Range comparisons support only created and updated");
      const v = this.peek();
      if (v?.kind !== "word") throw new Error(`${field} ${cmp.op} requires a time value`);
      this.i++;
      timeBound(v.text, Date.now());
      return { kind: "time", field, op: cmp.op, value: v.text };
    }
    const clause = parseFilterClause(t.text);
    if (clause.key === "deleted") throw new Error("deleted=true selects Trash and cannot be combined with OR, NOT, groups or ranges");
    return { kind: "property", ...clause };
  }
}

/**
 * A saved view's query as an expression. `simple` is a plain list of clauses (all must hold), which
 * every service reads the same; anything else needs the PIE-398 grammar. Throws the parser's reason.
 */
export function parseQuery(input: string): { expr: QueryExpr; simple: boolean } {
  const { tokens, simple } = lex(input);
  return { expr: new Parser(tokens).parse(), simple };
}

/** The top-level AND's terms (one term when the query is a single clause or group). */
export const topTerms = (e: QueryExpr): QueryExpr[] => (e.kind === "and" ? e.operands : [e]);

export interface Subject { properties: readonly { key: string; value: string }[]; createdAt?: number; updatedAt?: number }

/**
 * Does `e` hold for the card? The outliner's matcher: a property clause holds when some block-scope
 * property has that key (and value, case-insensitively). A range with no timestamp to test gives
 * `undefined` ("can't tell"), which NOT, AND and OR carry through.
 */
export function holds(e: QueryExpr, s: Subject, now = Date.now()): boolean | undefined {
  switch (e.kind) {
    case "property": return s.properties.some(p => p.key === e.key && (e.value === undefined || p.value.toLowerCase() === e.value.toLowerCase()));
    case "time": {
      const at = e.field === "created" ? s.createdAt : s.updatedAt;
      if (at === undefined || !Number.isFinite(at)) return undefined;
      const b = timeBound(e.value, now);
      if ("at" in b) return e.op === "<" ? at < b.at : e.op === "<=" ? at <= b.at : e.op === ">" ? at > b.at : at >= b.at;
      const end = b.day + DAY;
      return e.op === "<" ? at < b.day : e.op === "<=" ? at < end : e.op === ">" ? at >= end : at >= b.day;
    }
    case "not": { const v = holds(e.operand, s, now); return v === undefined ? undefined : !v; }
    case "and": {
      let unknown = false;
      for (const o of e.operands) { const v = holds(o, s, now); if (v === false) return false; if (v === undefined) unknown = true; }
      return unknown ? undefined : true;
    }
    case "or": {
      let unknown = false;
      for (const o of e.operands) { const v = holds(o, s, now); if (v === true) return true; if (v === undefined) unknown = true; }
      return unknown ? undefined : false;
    }
  }
}

/** The expression back in the query's own words, for a reason: `(project=a OR project=b)`, `NOT stage=done`. */
export function showExpr(e: QueryExpr, nested = false): string {
  switch (e.kind) {
    case "property": return e.value === undefined ? e.key : `${e.key}=${/[\s()"]/.test(e.value) ? JSON.stringify(e.value) : e.value}`;
    case "time": return `${e.field} ${e.op} ${e.value}`;
    case "not": return `NOT ${showExpr(e.operand, true)}`;
    case "and": { const s = e.operands.map(o => showExpr(o, true)).join(" "); return nested ? `(${s})` : s; }
    case "or": { const s = e.operands.map(o => showExpr(o, true)).join(" OR "); return nested ? `(${s})` : s; }
  }
}

/** Every key an expression mentions. */
export function keysOf(e: QueryExpr): string[] {
  switch (e.kind) {
    case "property": return [e.key];
    case "time": return [];
    case "not": return keysOf(e.operand);
    default: return [...new Set(e.operands.flatMap(keysOf))];
  }
}

/** A lane's query split for writing: the plain top-level clauses a write sets, and the terms that must already hold. */
export interface WritableQuery { expr: QueryExpr; plain: PropertyFilter[]; rest: QueryExpr[] }

export function writableQuery(input: string): WritableQuery {
  const { expr } = parseQuery(input);
  const plain: PropertyFilter[] = [], rest: QueryExpr[] = [];
  for (const t of topTerms(expr)) {
    if (t.kind === "property") plain.push(t.value === undefined ? { key: t.key } : { key: t.key, value: t.value });
    else rest.push(t);
  }
  return { expr, plain, rest };
}
