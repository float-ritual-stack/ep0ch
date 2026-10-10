import { firstLineWithoutPropertyTokens, matchesFilters, normalizePropertyKey } from "./properties";
import { ME_READER, QueryAtomError, THIS_TARGET, isQueryAtomWord, parseQueryAtom, tagMatches, type QueryRelationAtom } from "@ep0ch/outline-core/query-atoms";
import { QUESTION_DEFAULT_LIMIT, QUESTION_MAX_LIMIT } from "@ep0ch/outline-core/protocol";
import { ROADMAP_WORK_STAGES } from "./types";
import { isPropertyKey, isWritablePropertyValue, PROPERTY_KEY_SOURCE } from "@ep0ch/outline-core/property-grammar";
import type {
  Block,
  BlockProperty,
  BlockQuerySort,
  BlockSearchQuery,
  NormalizedBlockSearchQuery,
  PropertyFilter,
  PropertyQueryScope,
  PropertyRecord,
  QueryComparison,
  OutlinerRequestProblem,
  QueryExpression,
} from "./types";

export const MAX_BLOCK_QUERY_LIMIT = QUESTION_MAX_LIMIT;
const KEYED_RANGE = new RegExp(`^(${PROPERTY_KEY_SOURCE})(<=|>=|<|>)(.*)$`, "s");
/** `child:` or a counted `child>=N:` (at least N direct children have the property). */
const CHILD_COUNT = /^child(?:>=(\d{1,4}))?:/i;

const BOOLEAN_OPERATORS = new Set(["and", "not", "or"]);
const PROPERTY_QUERY_SCOPES = new Set<PropertyQueryScope>([
  "block",
  "line",
  "inline",
  "all",
]);

export function normalizePropertyQueryScope(value: unknown): PropertyQueryScope {
  if (typeof value !== "string" || !PROPERTY_QUERY_SCOPES.has(value as PropertyQueryScope)) {
    throw new Error(`Invalid property scope: ${String(value)}`);
  }
  return value as PropertyQueryScope;
}


export class BlockQuerySyntaxError extends Error {
  /** Request field whose text was parsed, set where a request field is parsed; `index` is within it. */
  field?: string;

  constructor(
    message: string,
    readonly index: number,
    hint?: string,
  ) {
    super(`${message} at character ${index + 1}${hint ? `. ${hint}` : ""}`);
    this.name = "BlockQuerySyntaxError";
  }
}

export interface FilterCompletionTarget {
  kind: "key" | "value";
  start: number;
  end: number;
  prefix: string;
  key?: string;
}

function syntaxError(message: string, index: number, hint?: string): never {
  throw new BlockQuerySyntaxError(message, index, hint);
}

const QUERY_EXAMPLE = "Example: type=thread and (status=open or status=blocked)";
const CLAUSE_GUESS = new RegExp(`^\\s*(${PROPERTY_KEY_SOURCE})\\s*(!=|==|::|:|=)\\s*(.+?)\\s*$`, "s");

/**
 * What a clause that would not parse most likely meant, then a working example: the teaching half of a
 * refusal. `[type::thread]` and `type = thread` read now; what is left is `type!=thread` (NOT type=thread),
 * a lone colon and the like.
 */
function clauseHint(clause: string): string {
  const text = clause.trim();
  const guess = CLAUSE_GUESS.exec(/^\[[^\[].*\]$/s.test(text) ? text.slice(1, -1) : text);
  let didYouMean = "";
  if (guess) {
    const value = /\s/.test(guess[3]!) && !guess[3]!.startsWith('"') ? `"${guess[3]!.replace(/[\\"]/g, "\\$&")}"` : guess[3]!;
    didYouMean = guess[2] === "!="
      ? `Did you mean NOT ${guess[1]}=${value}? There is no != ; put NOT before the clause. `
      : `Did you mean ${guess[1]}=${value}? `;
  }
  return `${didYouMean}${QUERY_EXAMPLE}`;
}

function separatorIn(clause: string): { index: number; length: number } | null {
  const equals = clause.indexOf("=");
  const doubleColon = clause.indexOf("::");
  if (equals < 0 && doubleColon < 0) return null;
  if (equals < 0) return { index: doubleColon, length: 2 };
  if (doubleColon < 0) return { index: equals, length: 1 };
  return equals < doubleColon
    ? { index: equals, length: 1 }
    : { index: doubleColon, length: 2 };
}

function normalizeFilterValue(value: string, key: string): string {
  const normalized = value.trim();
  if (!normalized)
    throw new Error(`Property filter value cannot be empty: ${key}`);
  if (!isWritablePropertyValue(normalized)) {
    throw new Error(
      `Property filter value must be one line with balanced brackets: ${key}`,
    );
  }
  return normalized;
}

export function normalizePropertyFilter(filter: PropertyFilter): PropertyFilter {
  if (!filter || typeof filter.key !== "string" || (filter.value !== undefined && typeof filter.value !== "string")) {
    throw new Error("Property filter requires a string key and optional string value");
  }
  const key = normalizePropertyKey(filter.key);
  if (BOOLEAN_OPERATORS.has(key)) {
    throw new Error(
      `Boolean operator is not supported in block filters: ${filter.key}`,
    );
  }
  return filter.value === undefined
    ? { key }
    : { key, value: normalizeFilterValue(filter.value, key) };
}

function parseQuotedValue(raw: string, offset: number): string {
  let value = "";
  for (let index = 1; index < raw.length; index += 1) {
    const character = raw[index]!;
    if (character === '"') {
      if (raw.slice(index + 1).trim()) {
        syntaxError(
          "Unexpected text after quoted filter value",
          offset + index + 1,
        );
      }
      return value;
    }
    if (character !== "\\") {
      value += character;
      continue;
    }
    const escaped = raw[index + 1];
    if (escaped !== "\\" && escaped !== '"') {
      syntaxError('Only \\\\ and \\" escapes are supported', offset + index);
    }
    value += escaped;
    index += 1;
  }
  syntaxError("Unterminated quoted filter value", offset);
}

export function parsePropertyFilterClause(
  input: string,
  offset = 0,
): PropertyFilter {
  const clause = input.trim();
  const leadingWhitespace = input.length - input.trimStart().length;
  const clauseOffset = offset + leadingWhitespace;
  if (!clause)
    syntaxError("Property filter clause cannot be empty", clauseOffset);

  const separator = separatorIn(clause);
  const rawKey = separator ? clause.slice(0, separator.index).trim() : clause;
  let key: string;
  try {
    key = normalizePropertyKey(rawKey);
  } catch {
    syntaxError(
      `Invalid property filter key: ${rawKey || "(empty)"}`,
      clauseOffset,
      clauseHint(clause),
    );
  }
  if (BOOLEAN_OPERATORS.has(key)) {
    syntaxError(`Boolean operator ${rawKey} is not supported`, clauseOffset, QUERY_EXAMPLE);
  }
  if (!separator) {
    if (/\s/.test(clause))
      syntaxError(
        "Property presence filter cannot contain whitespace",
        clauseOffset,
        `Put = between a key and its value: key=value. ${QUERY_EXAMPLE}`,
      );
    return { key };
  }

  const valueOffset = clauseOffset + separator.index + separator.length;
  const rawValue = clause.slice(separator.index + separator.length).trim();
  if (!rawValue)
    syntaxError(`Property filter value cannot be empty: ${key}`, valueOffset);
  const value = rawValue.startsWith('"')
    ? parseQuotedValue(
        rawValue,
        valueOffset +
          clause.slice(separator.index + separator.length).indexOf(rawValue),
      )
    : rawValue;
  try {
    return normalizePropertyFilter({ key, value });
  } catch (error) {
    syntaxError(
      error instanceof Error ? error.message : String(error),
      valueOffset,
    );
  }
}

interface FilterToken {
  text: string;
  start: number;
}

function tokenizeFilterExpression(input: string): FilterToken[] {
  const tokens: FilterToken[] = [];
  let start = -1;
  let quoteStart = -1;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (start < 0) {
      if (/\s/.test(character)) continue;
      start = index;
    }
    if (quoteStart >= 0) {
      if (escaped) {
        if (character !== "\\" && character !== '"') {
          syntaxError('Only \\\\ and \\" escapes are supported', index - 1);
        }
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quoteStart = -1;
      }
      continue;
    }
    if (character === '"') {
      quoteStart = index;
      continue;
    }
    // `[type::thread]`, a Blockdown property token, is one clause and keeps the spaces in its value.
    if (character === "[" && input[index + 1] !== "[" && /^\(*$/.test(input.slice(start, index))) {
      const close = closingBracket(input, index);
      if (close >= 0 && PROPERTY_TOKEN_START.test(input.slice(index + 1, close))) { index = close; continue; }
    }
    // `links:[[a page]]` and the other relations' `[[a page]]` keep a page name's spaces.
    if (character === "[" && input[index + 1] === "[" && /^\(*(?:links|linkedfrom|under|parent):$/i.test(input.slice(start, index))) {
      const close = input.indexOf("]]", index + 2);
      if (close >= 0 && !input.slice(index, close).includes("\n")) { index = close + 1; continue; }
    }
    if (/\s/.test(character)) {
      tokens.push({ text: input.slice(start, index), start });
      start = -1;
    }
  }

  if (escaped)
    syntaxError("Dangling escape in quoted filter value", input.length - 1);
  if (quoteStart >= 0)
    syntaxError("Unterminated quoted filter value", quoteStart);
  if (start >= 0) tokens.push({ text: input.slice(start), start });
  return foldClauseTokens(tokens);
}

const PROPERTY_TOKEN_START = new RegExp(`^\\s*(?:${PROPERTY_KEY_SOURCE})::`);
const PROPERTY_TOKEN = new RegExp(`^(\\(*)\\[\\s*(${PROPERTY_KEY_SOURCE})::(.*?)\\s*\\]((?:\\))*)$`, "s");
const BARE_KEY = new RegExp(`^\\(*(?:${PROPERTY_KEY_SOURCE})$`);
const KEY_THEN_SEPARATOR = new RegExp(`^\\(*(?:${PROPERTY_KEY_SOURCE})(?:=|::)$`);
const isKeyword = (text: string) => /^(?:and|or|not)$/i.test(text);

/** The index of the `]` closing the `[` at `open` (nested brackets balance), or -1 on this line. */
function closingBracket(input: string, open: number): number {
  let depth = 0, quoted = false;
  for (let index = open; index < input.length; index += 1) {
    const character = input[index];
    if (character === "\n") return -1;
    if (quoted) {
      if (character === "\\") index += 1;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "[") depth += 1;
    else if (character === "]" && (depth -= 1) === 0) return index;
  }
  return -1;
}

/**
 * Words into clauses. `[key::value]` reads as `key=value`, and whitespace around `=` or `::` is allowed
 * (`type = thread`, `type= thread`, `type =thread`). Neither form parsed before (a key can't hold `[`, and a
 * word beginning with `=` had no key), so no query that parsed changes meaning; `k=a=` and the like keep their
 * value because only a word that ends in the separator, or begins with it, takes its neighbour.
 */
function foldClauseTokens(tokens: FilterToken[]): FilterToken[] {
  const out: FilterToken[] = [];
  for (let at = 0; at < tokens.length; at += 1) {
    let token = { ...tokens[at]! };
    const token$ = PROPERTY_TOKEN.exec(token.text);
    if (token$) {
      const value = token$[3]!;
      const quoted = /\s/.test(value) && !value.startsWith('"') ? `"${value.replace(/[\\"]/g, "\\$&")}"` : value;
      token = { ...token, text: `${token$[1]}${token$[2]}=${quoted}${token$[4]}` };
    }
    const previous = out[out.length - 1];
    const lead = /^(?:=|::)(.*)$/s.exec(token.text);
    if (previous && lead && BARE_KEY.test(previous.text) && !isKeyword(previous.text)) {
      previous.text += token.text;
      const next = tokens[at + 1];
      if (!lead[1] && next && !isKeyword(next.text)) { previous.text += next.text; at += 1; }
      continue;
    }
    const next = tokens[at + 1];
    if (KEY_THEN_SEPARATOR.test(token.text) && next && !isKeyword(next.text) && !/^\)*$/.test(next.text)) {
      token.text += next.text;
      at += 1;
    }
    out.push(token);
  }
  return out;
}

export function parsePropertyFilterExpression(input: string): PropertyFilter[] {
  return tokenizeFilterExpression(input).map((token) =>
    parsePropertyFilterClause(token.text, token.start),
  );
}

export function serializePropertyFilterValue(value: string): string {
  const normalized = normalizeFilterValue(value, "value");
  if (!/[\s"\\]/.test(normalized)) return normalized;
  return `"${normalized.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function serializePropertyFilters(
  filters: readonly PropertyFilter[],
): string {
  return filters
    .map(normalizePropertyFilter)
    .map((filter) =>
      filter.value === undefined
        ? filter.key
        : `${filter.key}=${serializePropertyFilterValue(filter.value)}`,
    )
    .join(" ");
}

// ---------------------------------------------------------------------------
// Boolean query grammar (OR, NOT, grouping, created/updated ranges).
//
//   expression := or
//   or         := and ( OR and )*
//   and        := unary ( [AND] unary )*        juxtaposition is AND
//   unary      := NOT unary | primary
//   primary    := "(" expression ")" | range | clause
//   range      := (created | updated) (< | <= | > | >=) time
//
// Keywords are case-insensitive. Every clause keeps the existing presence and
// equality syntax, so a query without operators, parentheses or ranges parses
// to exactly the positive-AND filters it always meant. Those words and prefixes
// were syntax errors before, so no previously valid query changes meaning.
// ---------------------------------------------------------------------------

const MAX_QUERY_EXPRESSION_DEPTH = 32;
const MAX_QUERY_EXPRESSION_LEAVES = 200;
const COMPARISONS = new Set<QueryComparison>(["<", "<=", ">", ">="]);
const DAY_MS = 86_400_000;

/**
 * Structured detail for a rejected query. A syntax position is reported only with
 * the request field it indexes; syntax errors from other text (for example a
 * saved definition) carry just the message.
 */
export function queryRequestProblem(error: unknown): OutlinerRequestProblem | undefined {
  if (error instanceof BlockQuerySyntaxError) {
    return {
      code: "query-syntax", message: error.message,
      ...(error.field ? { field: error.field, position: error.index } : {}),
    };
  }
  if (error instanceof BlockQueryError) return { code: "query-invalid", message: error.message };
  return undefined;
}

export class BlockQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockQueryError";
  }
}

type ExpressionToken =
  | { kind: "lparen" | "rparen" | "and" | "or" | "not"; start: number }
  | { kind: "cmp"; op: QueryComparison; start: number }
  | { kind: "word"; text: string; start: number };

function lexQueryExpression(input: string): { tokens: ExpressionToken[]; simple: boolean } {
  const tokens: ExpressionToken[] = [];
  let depth = 0;
  let simple = true;
  for (const word of tokenizeFilterExpression(input)) {
    let text = word.text;
    let start = word.start;
    while (text.startsWith("(")) {
      tokens.push({ kind: "lparen", start });
      depth += 1;
      simple = false;
      text = text.slice(1);
      start += 1;
    }
    // A trailing ")" closes a group only while one is open and it does not
    // balance a "(" earlier in the same unquoted value, so `(k=f(x))` keeps
    // `f(x)`. At depth 0 it stays part of an unquoted value exactly as before.
    const closing = Math.min(depth, trailingUnbalancedParens(text));
    text = text.slice(0, text.length - closing);
    if (text) {
      const lower = text.toLowerCase();
      // `child>=2:key=value` is one clause (a counted `child:`), not a range on a key named child.
      const keyedRange = CHILD_COUNT.test(text) ? null : KEYED_RANGE.exec(text);
      const bareRange = /^(<=|>=|<|>)(.*)$/s.exec(text);
      if (lower === "and" || lower === "or" || lower === "not") {
        tokens.push({ kind: lower, start });
        simple = false;
      } else if (keyedRange) {
        tokens.push({ kind: "word", text: keyedRange[1]!, start });
        tokens.push({ kind: "cmp", op: keyedRange[2] as QueryComparison, start: start + keyedRange[1]!.length });
        if (keyedRange[3]) tokens.push({ kind: "word", text: keyedRange[3], start: start + keyedRange[1]!.length + keyedRange[2]!.length });
        simple = false;
      } else if (bareRange) {
        tokens.push({ kind: "cmp", op: bareRange[1] as QueryComparison, start });
        if (bareRange[2]) tokens.push({ kind: "word", text: bareRange[2], start: start + bareRange[1]!.length });
        simple = false;
      } else {
        tokens.push({ kind: "word", text, start });
        if (isQueryAtomWord(text)) simple = false;
      }
    }
    for (let index = 0; index < closing; index += 1) {
      tokens.push({ kind: "rparen", start: start + text.length + index });
      depth -= 1;
    }
  }
  return { tokens, simple };
}

/** Count the trailing ")" in one clause that close no "(" of the clause itself (quotes excluded). */
function trailingUnbalancedParens(text: string): number {
  const unbalanced = new Set<number>();
  let open = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === "\\") index += 1;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "(") open += 1;
    else if (character === ")") {
      if (open > 0) open -= 1;
      else unbalanced.add(index);
    }
  }
  let count = 0;
  while (unbalanced.has(text.length - 1 - count)) count += 1;
  return count;
}

type ParsedTime = { kind: "instant"; at: (now: number) => number } | { kind: "day"; start: (now: number) => number };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))?$/;

function utcDay(year: number, month: number, day: number): number | null {
  const start = Date.UTC(year, month - 1, day);
  const date = new Date(start);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? start : null;
}

function startOfUtcDay(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

/** Parse a range value; relative values resolve against the evaluation time. */
export function parseQueryTime(value: string): ParsedTime {
  const normalized = value.trim().toLowerCase();
  const date = ISO_DATE.exec(normalized);
  if (date) {
    const start = utcDay(Number(date[1]), Number(date[2]), Number(date[3]));
    if (start === null) throw new BlockQueryError(`Invalid date: ${value}`);
    return { kind: "day", start: () => start };
  }
  const datetime = ISO_DATETIME.exec(value.trim());
  if (datetime) {
    const text = value.trim();
    // Date.parse rolls impossible fields over (2026-02-30 becomes March 2), so
    // validate the calendar day and clock fields first.
    const [, year, month, day, hour, minute, second = "0", zone, offsetHour = "0", offsetMinute = "0"] = datetime;
    if (utcDay(Number(year), Number(month), Number(day)) === null) throw new BlockQueryError(`Invalid date: ${value}`);
    if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || Number(offsetHour) > 23 || Number(offsetMinute) > 59) {
      throw new BlockQueryError(`Invalid time: ${value}`);
    }
    const at = Date.parse(zone ? text : `${text}Z`);
    if (!Number.isFinite(at)) throw new BlockQueryError(`Invalid datetime: ${value}`);
    return { kind: "instant", at: () => at };
  }
  if (normalized === "now") return { kind: "instant", at: now => now };
  if (normalized === "today") return { kind: "day", start: now => startOfUtcDay(now) };
  if (normalized === "yesterday") return { kind: "day", start: now => startOfUtcDay(now) - DAY_MS };
  const relative = /^-(\d{1,6})([hdw])$/.exec(normalized);
  if (relative) {
    const unit = relative[2] === "h" ? 3_600_000 : relative[2] === "d" ? DAY_MS : 7 * DAY_MS;
    const offset = Number(relative[1]) * unit;
    return { kind: "instant", at: now => now - offset };
  }
  throw new BlockQueryError(
    `Invalid time value: ${value}; use YYYY-MM-DD, an ISO datetime, now, today, yesterday or -N followed by h, d or w`,
  );
}

class ExpressionParser {
  private index = 0;
  private leaves = 0;

  constructor(
    private readonly tokens: readonly ExpressionToken[],
    private readonly inputLength: number,
    private readonly rejectDeleted: boolean,
  ) {}

  parse(): QueryExpression {
    if (this.tokens.length === 0) syntaxError("Query cannot be empty", 0);
    const expression = this.parseOr(0);
    const extra = this.tokens[this.index];
    if (extra) syntaxError(extra.kind === "rparen" ? "Unmatched )" : "Unexpected query text", extra.start);
    return expression;
  }

  private peek(): ExpressionToken | undefined {
    return this.tokens[this.index];
  }

  private position(): number {
    return this.peek()?.start ?? this.inputLength;
  }

  private parseOr(depth: number): QueryExpression {
    const operands = [this.parseAnd(depth)];
    while (this.peek()?.kind === "or") {
      this.index += 1;
      operands.push(this.parseAnd(depth));
    }
    return operands.length === 1 ? operands[0]! : { kind: "or", operands };
  }

  private parseAnd(depth: number): QueryExpression {
    const operands = [this.parseUnary(depth)];
    for (;;) {
      const next = this.peek();
      if (!next || next.kind === "or" || next.kind === "rparen") break;
      if (next.kind === "and") this.index += 1;
      operands.push(this.parseUnary(depth));
    }
    return operands.length === 1 ? operands[0]! : { kind: "and", operands };
  }

  private parseUnary(depth: number): QueryExpression {
    const token = this.peek();
    if (token?.kind === "not") {
      this.index += 1;
      if (!this.startsOperand()) syntaxError("NOT requires a clause or group after it", this.position());
      return { kind: "not", operand: this.parseUnary(depth) };
    }
    return this.parsePrimary(depth);
  }

  private startsOperand(): boolean {
    const kind = this.peek()?.kind;
    return kind === "word" || kind === "lparen" || kind === "not";
  }

  private parsePrimary(depth: number): QueryExpression {
    const token = this.peek();
    if (!token) syntaxError("Expected a clause or group", this.inputLength);
    if (token.kind === "lparen") {
      if (depth >= MAX_QUERY_EXPRESSION_DEPTH) syntaxError("Query groups are nested too deeply", token.start);
      this.index += 1;
      if (this.peek()?.kind === "rparen") syntaxError("Empty group", token.start);
      const inner = this.parseOr(depth + 1);
      if (this.peek()?.kind !== "rparen") syntaxError("Unclosed (", token.start);
      this.index += 1;
      return inner;
    }
    if (token.kind === "cmp") syntaxError("A range needs created or updated before its comparison", token.start);
    if (token.kind !== "word") {
      syntaxError(`${token.kind.toUpperCase()} needs a clause before it`, token.start);
    }
    this.index += 1;
    if ((this.leaves += 1) > MAX_QUERY_EXPRESSION_LEAVES) syntaxError("Query has too many clauses", token.start);
    const comparison = this.peek();
    if (comparison?.kind === "cmp") {
      this.index += 1;
      const field = token.text.toLowerCase();
      if (field !== "created" && field !== "updated") {
        syntaxError("Range comparisons support only created and updated", token.start);
      }
      const value = this.peek();
      if (value?.kind !== "word") syntaxError(`${field} ${comparison.op} requires a time value`, value?.start ?? this.inputLength);
      this.index += 1;
      try {
        parseQueryTime(value.text);
      } catch (error) {
        syntaxError(error instanceof Error ? error.message : String(error), value.start);
      }
      return { kind: "time", field, op: comparison.op, value: value.text };
    }
    if (isQueryAtomWord(token.text)) {
      try {
        return parseQueryAtom(token.text)!;
      } catch (error) {
        if (error instanceof QueryAtomError) syntaxError(error.message, token.start);
        throw error;
      }
    }
    // `child:key=value` holds when a direct child has the property. `:` was never
    // valid in a key, so no query that parsed before changes meaning.
    // `child>=2:key=value`: at least that many direct children have it (a hub: `child>=2:type=virtual-branch`).
    const child = CHILD_COUNT.exec(token.text);
    const relation = child ? "child" as const : undefined;
    const count = child?.[1] === undefined ? 1 : Number(child[1]);
    if (child && count < 1) syntaxError("child>=N: needs N of 1 or more, like child>=2:type=virtual-branch", token.start);
    const skip = child?.[0].length ?? 0;
    const clause = parsePropertyFilterClause(token.text.slice(skip), token.start + skip);
    if (this.rejectDeleted && clause.key === "deleted") {
      syntaxError("deleted=true selects Trash and cannot be combined with OR, NOT, groups or ranges", token.start);
    }
    return { kind: "property", ...clause, ...(relation ? { relation } : {}), ...(count > 1 ? { count } : {}) };
  }
}

/** Parse query text in the documented grammar into a boolean expression. */
export function parseQueryExpression(input: string): QueryExpression {
  const { tokens } = lexQueryExpression(input);
  return new ExpressionParser(tokens, input.length, true).parse();
}

/**
 * Parse saved or typed query text. Positive-AND clause lists stay flat filters
 * (preserving deleted=true and every existing meaning); anything using the
 * boolean grammar becomes a `where` expression.
 */
export function parseSearchExpression(input: string): { filters: PropertyFilter[]; where?: QueryExpression } {
  const { tokens, simple } = lexQueryExpression(input);
  if (simple && !tokens.some((token) => token.kind === "word" && CHILD_COUNT.test(token.text))) {
    return { filters: parsePropertyFilterExpression(input) };
  }
  return { filters: [], where: new ExpressionParser(tokens, input.length, true).parse() };
}

function normalizeQueryExpression(expression: QueryExpression, depth = 0, leaves = { count: 0 }): QueryExpression {
  if (!expression || typeof expression !== "object") throw new BlockQueryError("Query expression must be an object");
  if (depth > MAX_QUERY_EXPRESSION_DEPTH) throw new BlockQueryError("Query expression is nested too deeply");
  switch (expression.kind) {
    case "property": {
      if ((leaves.count += 1) > MAX_QUERY_EXPRESSION_LEAVES) throw new BlockQueryError("Query expression has too many clauses");
      const filter = normalizePropertyFilter({ key: expression.key, ...(expression.value === undefined ? {} : { value: expression.value }) });
      if (filter.key === "deleted") throw new BlockQueryError("deleted=true cannot appear inside a query expression; use filters or includeDeleted");
      if (expression.relation !== undefined && expression.relation !== "child") throw new BlockQueryError(`Unknown query relation: ${String(expression.relation)}`);
      const count = expression.count;
      if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 9999 || expression.relation !== "child")) throw new BlockQueryError("count is a child: clause's minimum, a whole number from 1");
      return { kind: "property", ...filter, ...(expression.relation ? { relation: expression.relation } : {}), ...(count !== undefined && count > 1 ? { count } : {}) };
    }
    case "time": {
      if ((leaves.count += 1) > MAX_QUERY_EXPRESSION_LEAVES) throw new BlockQueryError("Query expression has too many clauses");
      if (expression.field !== "created" && expression.field !== "updated") {
        throw new BlockQueryError(`Query range field must be created or updated: ${String(expression.field)}`);
      }
      if (!COMPARISONS.has(expression.op)) throw new BlockQueryError(`Query range comparison must be <, <=, > or >=: ${String(expression.op)}`);
      if (typeof expression.value !== "string") throw new BlockQueryError("Query range value must be a string");
      parseQueryTime(expression.value);
      return { kind: "time", field: expression.field, op: expression.op, value: expression.value.trim() };
    }
    case "tag":
    case "links":
    case "linkedfrom":
    case "under":
    case "parent":
    case "title":
    case "text":
    case "call":
    case "unread":
    case "thread": {
      if ((leaves.count += 1) > MAX_QUERY_EXPRESSION_LEAVES) throw new BlockQueryError("Query expression has too many clauses");
      const word = expression.kind === "tag" ? `#${String(expression.tag)}`
        : expression.kind === "links" || expression.kind === "linkedfrom" || expression.kind === "under" || expression.kind === "parent" ? `${expression.kind}:${String(expression.target)}`
        : expression.kind === "call" ? `call:${String(expression.call)}`
        : expression.kind === "unread" || expression.kind === "thread" ? `${expression.kind}:${String(expression.reader)}`
        : `${expression.kind}~"${String(expression.text).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
      try {
        const atom = parseQueryAtom(word);
        if (!atom || atom.kind !== expression.kind) throw new BlockQueryError(`Query atom ${word} is not a ${expression.kind} atom`);
        return atom;
      } catch (error) {
        if (error instanceof QueryAtomError) throw new BlockQueryError(error.message);
        throw error;
      }
    }
    case "not":
      return { kind: "not", operand: normalizeQueryExpression(expression.operand, depth + 1, leaves) };
    case "and":
    case "or": {
      if (!Array.isArray(expression.operands) || expression.operands.length === 0) {
        throw new BlockQueryError(`Query ${expression.kind} requires at least one operand`);
      }
      const operands = expression.operands.map(operand => normalizeQueryExpression(operand, depth + 1, leaves));
      return operands.length === 1 ? operands[0]! : { kind: expression.kind, operands };
    }
    default:
      throw new BlockQueryError(`Unknown query expression kind: ${String((expression as { kind?: unknown }).kind)}`);
  }
}

/**
 * What the relation atoms read, from the service: a target named the way a person types it resolved to a block id (it
 * throws a corrective error when none is), the ids of the blocks linking to it (the backlink index) and of the blocks it
 * links to (the same occurrences, read from its side), whether a block sits in a subtree and a block's parent. Without
 * it the relation atoms hold for nothing, and `title~`, `text~` and `#tag` still answer from the block itself.
 */
export interface QueryRelations {
  resolve(atom: QueryRelationAtom, target: string): string;
  linkSources(blockId: string): ReadonlySet<string>;
  /** The active blocks `blockId` links to (`linkedfrom:`): the backlink relation's occurrences, so `links:` and it agree. */
  linkTargets?(blockId: string): ReadonlySet<string>;
  within(blockId: string, rootId: string): boolean;
  /** A block's parent id (`parent:`); null at the top. */
  parentOf?(blockId: string): string | null | undefined;
  /** The ids of the blocks whose latest change (else their creation) came from a call with this id (PIE-685). */
  callBlocks?(call: string): ReadonlySet<string>;
  /** The revision `reader` last read each block at (`unread:`, PIE-708). */
  readRevisions?(reader: string): ReadonlyMap<string, number>;
  /** The comments and replies in the threads `reader` started or wrote in (`thread:`). */
  threadBlocks?(reader: string): ReadonlySet<string>;
}

/** The reader an atom names: `me` is the person (every client reads as them); an agent names its own actor id. */
function readerOf(reader: string): string {
  return reader === ME_READER ? PERSON_READER : reader;
}

/** The person's reader key (their read marks, their threads): the door, the web client and the CLI read as them. */
export const PERSON_READER = "user";

export interface QueryExpressionSubject {
  id?: string;
  text?: string;
  createdAt: string;
  updatedAt: string;
  /** Its revision, for `unread:` (read at an older one is unread again). */
  revision?: number;
  /** The block's active direct children's properties, for `child:` clauses; without it they never match. */
  childProperties?: () => readonly (readonly (BlockProperty | PropertyRecord)[])[];
}

export type CompiledQueryExpression = (
  subject: QueryExpressionSubject,
  properties: readonly (BlockProperty | PropertyRecord)[],
  propertyScope?: PropertyQueryScope,
) => boolean;

/** Resolve relative times once, at `now`, and return a predicate over one block. */
export function compileQueryExpression(expression: QueryExpression, now = Date.now(), relations?: QueryRelations): CompiledQueryExpression {
  switch (expression.kind) {
    case "tag": {
      const tag = expression.tag;
      return (_subject, properties) => tagMatches(properties.filter(p => p.key === "tag").map(p => p.value), tag);
    }
    case "title": {
      const needle = expression.text.toLowerCase();
      return subject => titleOf(subject.text ?? "").toLowerCase().includes(needle);
    }
    case "text": {
      const needle = expression.text.toLowerCase();
      return subject => (subject.text ?? "").toLowerCase().includes(needle);
    }
    case "links": {
      if (!relations) return () => false;
      const sources = relations.linkSources(relations.resolve(expression.kind, expression.target));
      return subject => subject.id !== undefined && sources.has(subject.id);
    }
    case "linkedfrom": {
      if (!relations?.linkTargets) return () => false;
      const targets = relations.linkTargets(relations.resolve(expression.kind, expression.target));
      return subject => subject.id !== undefined && targets.has(subject.id);
    }
    case "under": {
      if (!relations) return () => false;
      const root = relations.resolve(expression.kind, expression.target);
      return subject => subject.id !== undefined && relations.within(subject.id, root);
    }
    case "parent": {
      if (!relations?.parentOf) return () => false;
      const parent = relations.resolve(expression.kind, expression.target);
      return subject => subject.id !== undefined && relations.parentOf!(subject.id) === parent;
    }
    case "call": {
      const written = relations?.callBlocks?.(expression.call);
      return subject => !!written && subject.id !== undefined && written.has(subject.id);
    }
    case "unread": {
      // Read at its current revision or later is read; anything else (never opened, changed since) is unread.
      const read = relations?.readRevisions?.(readerOf(expression.reader));
      return subject => !!read && subject.id !== undefined && (read.get(subject.id) ?? 0) < (subject.revision ?? 1);
    }
    case "thread": {
      const blocks = relations?.threadBlocks?.(readerOf(expression.reader));
      return subject => !!blocks && subject.id !== undefined && blocks.has(subject.id);
    }
    case "property": {
      const filter = [{ key: expression.key, ...(expression.value === undefined ? {} : { value: expression.value }) }];
      if (expression.relation === "child") {
        const least = expression.count ?? 1;
        return (subject) => {
          let found = 0;
          for (const properties of subject.childProperties?.() ?? []) if (matchesFilters(properties, filter) && ++found >= least) return true;
          return false;
        };
      }
      return (_subject, properties, scope) => matchesFilters(properties, filter, scope);
    }
    case "time": {
      const time = parseQueryTime(expression.value);
      const field = expression.field === "created" ? "createdAt" : "updatedAt";
      let test: (at: number) => boolean;
      if (time.kind === "instant") {
        const bound = time.at(now);
        test = expression.op === "<" ? at => at < bound
          : expression.op === "<=" ? at => at <= bound
          : expression.op === ">" ? at => at > bound
          : at => at >= bound;
      } else {
        // A day is an interval: > D starts after that day, <= D includes all of it.
        const start = time.start(now);
        const end = start + DAY_MS;
        test = expression.op === "<" ? at => at < start
          : expression.op === "<=" ? at => at < end
          : expression.op === ">" ? at => at >= end
          : at => at >= start;
      }
      return subject => {
        const at = Date.parse(subject[field]);
        return Number.isFinite(at) && test(at);
      };
    }
    case "not": {
      const operand = compileQueryExpression(expression.operand, now, relations);
      return (subject, properties, scope) => !operand(subject, properties, scope);
    }
    case "and": {
      const operands = expression.operands.map(operand => compileQueryExpression(operand, now, relations));
      return (subject, properties, scope) => operands.every(operand => operand(subject, properties, scope));
    }
    case "or": {
      const operands = expression.operands.map(operand => compileQueryExpression(operand, now, relations));
      return (subject, properties, scope) => operands.some(operand => operand(subject, properties, scope));
    }
  }
}

/** Property clauses that can contribute match context (not under NOT). */
export function positivePropertyFilters(expression: QueryExpression): PropertyFilter[] {
  switch (expression.kind) {
    case "property": return expression.relation ? [] : [{ key: expression.key, ...(expression.value === undefined ? {} : { value: expression.value }) }];
    case "time":
    case "tag":
    case "links":
    case "linkedfrom":
    case "under":
    case "parent":
    case "title":
    case "text":
    case "call":
    case "unread":
    case "thread":
    case "not": return [];
    default: return expression.operands.flatMap(positivePropertyFilters);
  }
}

/** A block's title: its first line without property tokens. */
function titleOf(text: string): string {
  return firstLineWithoutPropertyTokens(text)?.trim() ?? "";
}

/** Why a question that says `this` can't be answered without one (ADR 0004). */
export const THIS_MISSING = "this is the note the query sits in; this query has none (pass this=<block id>)";

/**
 * `expression` with every `this` target bound to block `thisId` (`links:this` → `links:((id))`). With no `thisId`, a
 * `this` is refused with what to pass.
 */
export function bindThis(expression: QueryExpression, thisId: string | undefined): QueryExpression {
  switch (expression.kind) {
    case "links":
    case "linkedfrom":
    case "under":
    case "parent":
      if (expression.target !== THIS_TARGET) return expression;
      if (!thisId) throw new BlockQueryError(THIS_MISSING);
      return { ...expression, target: `((${thisId}))` };
    case "not":
      return { kind: "not", operand: bindThis(expression.operand, thisId) };
    case "and":
    case "or":
      return { kind: expression.kind, operands: expression.operands.map(operand => bindThis(operand, thisId)) };
    default:
      return expression;
  }
}

/** Every property key an expression names, under NOT and `child:` too: what a "no notes have <key>" hint checks. */
export function expressionPropertyKeys(expression: QueryExpression | undefined): string[] {
  if (!expression) return [];
  switch (expression.kind) {
    case "property": return [expression.key];
    case "not": return expressionPropertyKeys(expression.operand);
    case "and":
    case "or": return expression.operands.flatMap(expressionPropertyKeys);
    default: return [];
  }
}

/** The date buckets a group can name: `created:day`, `updated:month`, … */
const DATE_GROUP = /^(created|updated):(day|week|month)$/;

/** A group as the service keeps it: a property key lowercased, or a date bucket. Throws why it can't be one. */
export function normalizeGroupField(group: unknown): string {
  if (typeof group !== "string" || !group.trim()) throw new BlockQueryError("group is a property name, or created:day|week|month or updated:day|week|month");
  const trimmed = group.trim().toLowerCase();
  if (DATE_GROUP.test(trimmed)) return trimmed;
  const key = trimmed.startsWith(SORT_PROPERTY) ? trimmed.slice(SORT_PROPERTY.length).trim() : trimmed;
  if (!isPropertyKey(key)) {
    throw new BlockQueryError(`group is a property name (a letter, then letters, digits, _ . or -), or created:day|week|month or updated:day|week|month, not ${group}`);
  }
  return key;
}

/** The date bucket a group names, or null for a property. */
export function dateGroupOf(group: string): { field: "createdAt" | "updatedAt"; unit: "day" | "week" | "month" } | null {
  const match = DATE_GROUP.exec(group);
  if (!match) return null;
  return { field: match[1] === "created" ? "createdAt" : "updatedAt", unit: match[2] as "day" | "week" | "month" };
}

/** `"<field>[ asc|desc]"` (asc unless said) or `{ field, direction }`, checked and normalized. */
function normalizeSort(sort: unknown): BlockQuerySort {
  let field: unknown, direction: unknown;
  if (typeof sort === "string") {
    const words = sort.trim().split(/\s+/);
    if (!words[0] || words.length > 2) throw new Error(`Sort is "<property|created|updated|title>[ asc|desc]", not ${sort}`);
    field = words[0];
    direction = words[1] ?? "asc";
  } else if (sort && typeof sort === "object" && !Array.isArray(sort)) {
    ({ field, direction } = sort as { field?: unknown; direction?: unknown });
  } else {
    throw new Error("Block search sort must be an object or \"<field>[ asc|desc]\"");
  }
  const normalized = normalizeSortField(field);
  if (normalized === null) throw new Error(sortFieldProblem(field));
  const dir = typeof direction === "string" ? direction.trim().toLowerCase() : direction;
  if (dir !== "asc" && dir !== "desc") {
    throw new Error(`Sort direction is asc or desc, not ${String(direction)}: asc puts the smallest first`);
  }
  return { field: normalized, direction: dir };
}

export function normalizeBlockSearchQuery(
  query: BlockSearchQuery,
): NormalizedBlockSearchQuery {
  if (!query || typeof query !== "object")
    throw new Error("Block search query is required");
  if ("expression" in query) {
    throw new Error("blocks.query's expression is now where: send { where: \"type=task\" }; a structured predicate is predicate");
  }
  const limit = query.limit ?? QUESTION_DEFAULT_LIMIT;
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_BLOCK_QUERY_LIMIT
  ) {
    throw new Error(
      `Block search limit must be an integer from 1 through ${MAX_BLOCK_QUERY_LIMIT}`,
    );
  }
  if (query.filters !== undefined && !Array.isArray(query.filters)) {
    throw new Error("Block search filters must be an array");
  }
  for (const [index, filter] of (query.filters ?? []).entries()) {
    if (
      !filter ||
      typeof filter !== "object" ||
      typeof filter.key !== "string"
    ) {
      throw new Error(`Block search filter ${index + 1} requires a string key`);
    }
    if (filter.value !== undefined && typeof filter.value !== "string") {
      throw new Error(
        `Block search filter ${index + 1} value must be a string`,
      );
    }
  }
  for (const [field, value] of [
    ["text", query.text],
    ["subtreeRootId", query.subtreeRootId],
    ["rankViewId", query.rankViewId],
    ["this", query.this],
  ] as const) {
    if (value !== undefined && typeof value !== "string") {
      throw new Error(`Block search ${field} must be a string`);
    }
  }

  if (query.where !== undefined && typeof query.where !== "string") {
    throw new Error("Block search where must be query text, like \"type=task NOT links:this\"; a structured predicate is predicate");
  }
  const thisId = query.this?.trim() || undefined;
  const parts: QueryExpression[] = [];
  // Plain clause lists keep their filter meaning, including deleted=true.
  let parsedExpression: ReturnType<typeof parseSearchExpression> | null = null;
  try {
    parsedExpression = query.where?.trim() ? parseSearchExpression(query.where) : null;
  } catch (error) {
    if (error instanceof BlockQuerySyntaxError) error.field = "where";
    throw error;
  }
  if (parsedExpression?.where) parts.push(bindThis(parsedExpression.where, thisId));
  if (query.predicate !== undefined) parts.push(bindThis(normalizeQueryExpression(query.predicate), thisId));
  const predicate = parts.length === 0 ? undefined
    : parts.length === 1 ? parts[0]! : { kind: "and" as const, operands: parts };

  const sort = query.sort === undefined ? undefined : normalizeSort(query.sort);
  const group = query.group === undefined ? undefined : normalizeGroupField(query.group);
  let facets: true | string[] | undefined;
  if (query.facets !== undefined) {
    if (query.facets === true) facets = true;
    else if (Array.isArray(query.facets) && query.facets.every(key => typeof key === "string" && isPropertyKey(key.trim().toLowerCase()))) {
      facets = [...new Set(query.facets.map(key => key.trim().toLowerCase()))];
    } else throw new BlockQueryError("facets is true (every key the matches carry) or a list of property names");
  }

  const filters: PropertyFilter[] = [];
  const seen = new Set<string>();
  let includeDeleted = query.includeDeleted;
  for (const candidate of [...(query.filters ?? []), ...(parsedExpression?.filters ?? [])]) {
    const filter = normalizePropertyFilter(candidate);
    if (filter.key === "deleted" && filter.value?.toLowerCase() === "true") {
      includeDeleted ??= "roots";
      continue;
    }
    const identity = `${filter.key}\0${filter.value === undefined ? "presence" : `value:${filter.value.toLowerCase()}`}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    filters.push(filter);
  }

  if (
    includeDeleted !== undefined &&
    includeDeleted !== "roots" &&
    includeDeleted !== "all"
  ) {
    throw new Error(`Invalid deleted-content mode: ${String(includeDeleted)}`);
  }
  const text = query.text?.trim() || undefined;
  const subtreeRootId = query.subtreeRootId?.trim() || undefined;
  const rankViewId = query.rankViewId?.trim() || undefined;
  const propertyScope = query.propertyScope === undefined
    ? undefined
    : normalizePropertyQueryScope(query.propertyScope);
  if (rankViewId && sort) {
    throw new Error("Block search cannot combine rankViewId with sorting");
  }

  return {
    ...(filters.length > 0 ? { filters } : {}),
    ...(predicate ? { predicate } : {}),
    ...(text ? { text } : {}),
    ...(subtreeRootId ? { subtreeRootId } : {}),
    ...(rankViewId ? { rankViewId } : {}),
    ...(propertyScope ? { propertyScope } : {}),
    ...(includeDeleted ? { includeDeleted } : {}),
    ...(sort ? { sort } : {}),
    ...(group ? { group } : {}),
    ...(facets ? { facets } : {}),
    limit,
  };
}

const SORT_PROPERTY = "property:";

/** The sort fields that aren't properties: `property:<name>` names a property so called. */
const SORT_BUILTINS = new Set(["created", "updated", "title"]);

/**
 * A sort field as the service keeps it: `created`, `updated`, `title`, a property key lowercased, or `property:<key>`
 * for a property called created, updated or title (any other `property:<key>` is just the key). Null when it is none
 * of them.
 */
export function normalizeSortField(field: unknown): string | null {
  if (typeof field !== "string") return null;
  const trimmed = field.trim().toLowerCase();
  const key = trimmed.startsWith(SORT_PROPERTY) ? trimmed.slice(SORT_PROPERTY.length).trim() : null;
  if (key !== null) return isPropertyKey(key) ? (SORT_BUILTINS.has(key) ? `${SORT_PROPERTY}${key}` : key) : null;
  return isPropertyKey(trimmed) ? trimmed : null;
}

/** Why `field` can't be a sort, with the fix: the key it seems to mean, when there is one. */
export function sortFieldProblem(field: unknown): string {
  // The key it seems to mean: the one key-like word in it (`[rank::]` means rank), kept under `property:`.
  const text = typeof field === "string" ? field.trim() : "";
  const prefixed = text.toLowerCase().startsWith(SORT_PROPERTY), rest = prefixed ? text.slice(SORT_PROPERTY.length) : text;
  const words = [...rest.matchAll(/[A-Za-z][A-Za-z0-9_.-]*/g)].map(m => m[0]);
  const meant = words.length === 1 && !/\s/.test(rest.trim()) ? `${prefixed ? SORT_PROPERTY : ""}${words[0]!.toLowerCase()}` : undefined;
  return meant
    ? `Sort by ${meant}, not ${String(field)}: a sort is created, updated, title or a property key`
    : `Sort is created, updated, title or a property key (a letter, then letters, digits, _ . or -), not ${String(field)}`;
}

/** The property key a sort field names, or null for a timestamp or title sort. */
export function sortPropertyKey(field: string): string | null {
  if (SORT_BUILTINS.has(field)) return null;
  return field.startsWith(SORT_PROPERTY) ? field.slice(SORT_PROPERTY.length) : field;
}

/**
 * A property's own value order, where a part owns the key's meaning: `work-stage` is the workboard's
 * (ROADMAP_WORK_STAGES). Any other key orders as numbers, then text.
 */
const OWNED_ORDERS: ReadonlyMap<string, readonly string[]> = new Map([["work-stage", ROADMAP_WORK_STAGES]]);

/**
 * How `key`'s values compare, `direction` 1 (asc) or -1 (desc): values in its owned order first, in that order; then
 * decimal numbers as numbers; then text without case. The classes keep their places in either direction; the direction
 * orders within each. A value that is empty is the caller's to place (last).
 */
export function valueOrder(key: string | null, direction: 1 | -1 = 1): (left: string, right: string) => number {
  const owned = key ? OWNED_ORDERS.get(key) : undefined;
  const classed = (value: string): [number, number | string] => {
    const at = owned ? owned.indexOf(value.trim().toLowerCase()) : -1;
    if (at >= 0) return [0, at];
    const v = sortValue(value) ?? "";
    return typeof v === "number" ? [1, v] : [2, v];
  };
  return (left, right) => {
    const [ca, a] = classed(left), [cb, b] = classed(right);
    if (ca !== cb) return ca - cb;
    return direction * (typeof a === "number" ? a - (b as number) : (a as string).localeCompare(b as string));
  };
}

/**
 * Orders matched blocks by a normalized sort. Timestamps break ties by creation, then id. A property sort compares
 * `valueOf(block, key)` (by default its block-scoped value): decimal numbers as numbers, before any text value in
 * either direction; text without case; blocks without the property last in either direction; ties keep the order
 * they came in (outline order).
 */
export function sortQueriedBlocks<T extends Pick<Block, "id" | "createdAt" | "updatedAt" | "properties"> & { text?: string }>(
  blocks: T[],
  sort: BlockQuerySort,
  valueOf: (block: T, key: string) => string | undefined = (block, key) => block.properties.find(p => p.key === key)?.value,
): void {
  const direction = sort.direction === "asc" ? 1 : -1;
  const key = sortPropertyKey(sort.field);
  if (sort.field === "title") {
    const titles = new Map(blocks.map(block => [block.id, titleOf(block.text ?? "").toLowerCase()]));
    blocks.sort((left, right) => direction * titles.get(left.id)!.localeCompare(titles.get(right.id)!) || left.id.localeCompare(right.id));
    return;
  }
  if (key === null) {
    const field = sort.field === "created" ? "createdAt" : "updatedAt";
    blocks.sort((left, right) =>
      direction * left[field].localeCompare(right[field]) ||
      direction * left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
    );
    return;
  }
  const values = new Map(blocks.map(block => [block.id, valueOf(block, key)?.trim() || null]));
  const order = valueOrder(key, direction);
  blocks.sort((left, right) => {
    const a = values.get(left.id)!, b = values.get(right.id)!;
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    return order(a, b);
  });
}

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

function sortValue(value: string | undefined): number | string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  // Only a decimal number is a number (0x10 and 1e3 are text).
  return DECIMAL.test(trimmed) ? Number(trimmed) : trimmed.toLowerCase();
}

function clauseRangeAtCursor(
  input: string,
  cursor: number,
): { start: number; end: number } {
  const boundedCursor = Math.max(0, Math.min(cursor, input.length));
  let start = 0;
  let quote = false;
  let escaped = false;
  for (let index = 0; index < boundedCursor; index += 1) {
    const character = input[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quote = false;
    } else if (character === '"') quote = true;
    else if (/\s/.test(character)) start = index + 1;
  }

  let end = input.length;
  quote = false;
  escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const character = input[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quote = false;
    } else if (character === '"') quote = true;
    else if (/\s/.test(character)) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function partialValuePrefix(raw: string): string {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('"')) return trimmed;
  let result = "";
  for (let index = 1; index < trimmed.length; index += 1) {
    const character = trimmed[index]!;
    if (character === '"') break;
    if (character === "\\" && index + 1 < trimmed.length) {
      const escaped = trimmed[index + 1]!;
      if (escaped === "\\" || escaped === '"') {
        result += escaped;
        index += 1;
        continue;
      }
    }
    result += character;
  }
  return result;
}

export function filterCompletionTargetAtCursor(
  input: string,
  cursor: number,
): FilterCompletionTarget | null {
  const range = clauseRangeAtCursor(input, cursor);
  const beforeCursor = input.slice(
    range.start,
    Math.max(range.start, Math.min(cursor, input.length)),
  );
  const separator = separatorIn(beforeCursor);
  if (!separator) {
    const prefix = beforeCursor.trim();
    if (prefix && !isPropertyKey(prefix)) return null;
    return {
      kind: "key",
      start: range.start,
      end: range.end,
      prefix: prefix.toLowerCase(),
    };
  }

  const rawKey = beforeCursor.slice(0, separator.index).trim();
  let key: string;
  try {
    key = normalizePropertyKey(rawKey);
  } catch {
    return null;
  }
  const rawValue = beforeCursor.slice(separator.index + separator.length);
  return {
    kind: "value",
    start: range.start,
    end: range.end,
    key,
    prefix: partialValuePrefix(rawValue),
  };
}
