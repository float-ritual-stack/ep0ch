import { actorNamed } from "./attribution";
import { VALUE_OPERAND_SOURCE, type Clause } from "./query-clauses";
import { PROPERTY_QUERY_SCOPES as QUERY_SCOPES, type BlockProperty } from "./protocol";
import type { PropertyRecord } from "./property-parse";
import type { PropertyFilter, PropertyQueryScope, QueryComparison, QueryExpression } from "./query-types";
import { matchesFilters, normalizePropertyKey } from "./query-properties";
import { firstLineWithoutPropertyTokens } from "./property-parse";
import { ME_READER, QueryAtomError, THIS_TARGET, isQueryAtomWord, parseQueryAtom, tagMatches, type QueryRelationAtom } from "./query-atoms";
import { isPropertyKey, isWritablePropertyValue, splitPropertyValue, PROPERTY_KEY_SOURCE } from "./property-grammar";
import { fromWallClock, readBound, readDateBound, readNumber, valueHolds, wallClock } from "./dates";
const KEYED_RANGE = new RegExp(`^(${PROPERTY_KEY_SOURCE})(<=|>=|<|>)(.*)$`, "s");
/** `child:` or a counted `child>=N:` (at least N direct children have the property). */
const CHILD_COUNT = /^child(?:>=(\d{1,4}))?:/i;

const BOOLEAN_OPERATORS = new Set(["and", "not", "or"]);
const PROPERTY_QUERY_SCOPES = new Set<PropertyQueryScope>(QUERY_SCOPES);

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
    // `key={{this.project}}`: a `{{ }}` value operand keeps the spaces inside its braces.
    if (character === "{" && input[index + 1] === "{") {
      const close = input.indexOf("}}", index + 2);
      if (close >= 0 && !input.slice(index, close).includes("\n")) { index = close + 1; continue; }
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
      const quoted = /\s/.test(value) && !value.startsWith('"') && !/^\{\{.*\}\}$/s.test(value) ? `"${value.replace(/[\\"]/g, "\\$&")}"` : value;
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
// Boolean query grammar (OR, NOT, grouping, comparisons).
//
//   expression := or
//   or         := and ( OR and )*
//   and        := unary ( [AND] unary )*        juxtaposition is AND
//   unary      := NOT unary | primary
//   primary    := "(" expression ")" | range | compare | clause
//   range      := (created | updated) (< | <= | > | >=) time
//   compare    := key (< | <= | > | >=) bound   any other property (PIE-769): a date, a number or text
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
        // A value operand (`project={{this.project}}`) is bound by the service: the expression's, not a plain filter's.
        if (VALUE_OPERAND.test(text)) simple = false;
        // A clause whose value is a date (`due=today`, `due="Oct 20"`) is the evaluator's: it holds for that day.
        if (isQueryAtomWord(text) || datedClause(text)) simple = false;
      }
    }
    for (let index = 0; index < closing; index += 1) {
      tokens.push({ kind: "rparen", start: start + text.length + index });
      depth -= 1;
    }
  }
  return { tokens, simple };
}

/** `key={{path}}`: a property clause whose value is read from the Site (the whole value, unquoted). */
const VALUE_OPERAND = new RegExp(`^\\(*${VALUE_OPERAND_SOURCE}\\)*$`, "s");

const KEY_VALUE = new RegExp(`^(?:${PROPERTY_KEY_SOURCE})(?:=|::)(.+)$`, "s");

/** Unquote a query word's `"…"` (only \\ and \" escape); a word without quotes is itself. */
function unquoted(word: string): string {
  return word.startsWith('"') && word.endsWith('"') && word.length >= 2 ? word.slice(1, -1).replace(/\\([\\"])/g, "$1") : word;
}

/** The date a `key=value` clause's value reads as (`due=today`, `due="Oct 20"`), or null: a plain value compares as text. */
function datedClause(text: string): boolean {
  const value = KEY_VALUE.exec(text)?.[1];
  return value !== undefined && readNumber(unquoted(value)) === null && readDateBound(unquoted(value)) !== null;
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

type ParsedTime = { kind: "instant"; at: (now: number) => number } | { kind: "day"; start: (now: number) => number; end: (now: number) => number };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))?$/;

function utcDay(year: number, month: number, day: number): number | null {
  const start = Date.UTC(year, month - 1, day);
  const date = new Date(start);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? start : null;
}


/** Parse a range value; relative values resolve against the evaluation time. */
export function parseQueryTime(value: string): ParsedTime {
  const normalized = value.trim().toLowerCase();
  const date = ISO_DATE.exec(normalized);
  if (date) {
    const start = utcDay(Number(date[1]), Number(date[2]), Number(date[3]));
    if (start === null) throw new BlockQueryError(`Invalid date: ${value}`);
    return { kind: "day", start: () => start, end: () => start + DAY_MS };
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
  // Everything else is outline-core's one reader of a relative bound (PIE-922): `-7d` is that calendar day, `-2h` an instant.
  if (readDateBound(normalized, 0) !== null) {
    const bound = (now: number) => readDateBound(normalized, wallClock(now))!;
    const instant = bound(0).from === bound(0).to;
    // An instant is elapsed time from now (a `-2h` is two hours across a clock change); a day runs from its own midnight to the next one.
    return instant
      ? { kind: "instant", at: now => now + bound(now).from - wallClock(now) }
      : { kind: "day", start: now => fromWallClock(bound(now).from), end: now => fromWallClock(bound(now).to + 1) };
  }
  throw new BlockQueryError(
    `Invalid time value: ${value}; use YYYY-MM-DD, an ISO datetime, now, today, yesterday or -N followed by m, h, d or w (-30m, -2h, -7d)`,
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
    if (token.kind === "cmp") syntaxError("A comparison needs a property before it", token.start, "Write it like due <= +3d, rating > 3 or updated >= -7d");
    if (token.kind !== "word") {
      syntaxError(`${token.kind.toUpperCase()} needs a clause before it`, token.start);
    }
    this.index += 1;
    if ((this.leaves += 1) > MAX_QUERY_EXPRESSION_LEAVES) syntaxError("Query has too many clauses", token.start);
    const comparison = this.peek();
    if (comparison?.kind === "cmp") {
      this.index += 1;
      const field = token.text.toLowerCase();
      const value = this.peek();
      if (field !== "created" && field !== "updated") {
        let key: string;
        try {
          key = normalizePropertyKey(token.text);
        } catch {
          syntaxError(`${token.text} is not a property to compare`, token.start, "Write it like due <= +3d, rating > 3 or release-window = today");
        }
        if (value?.kind !== "word") {
          syntaxError(`${key} ${comparison.op} needs a value after it`, value?.start ?? this.inputLength, `Write it like ${key} ${comparison.op} today, ${key} ${comparison.op} 3 or ${key} ${comparison.op} "Oct 20"`);
        }
        this.index += 1;
        const bound = unquoted(value.text).trim();
        if (!bound) syntaxError(`${key} ${comparison.op} needs a value after it`, value.start);
        return { kind: "compare", key, op: comparison.op, value: bound };
      }
      if (value?.kind !== "word") syntaxError(`${field} ${comparison.op} requires a time value`, value?.start ?? this.inputLength);
      this.index += 1;
      // Quoted as a property's bound is (`updated >= "29 Oct 2026"`, a day on this machine's wall clock).
      const bound = unquoted(value.text).trim();
      try {
        parseQueryTime(bound);
      } catch (error) {
        syntaxError(error instanceof Error ? error.message : String(error), value.start);
      }
      return { kind: "time", field, op: comparison.op, value: bound };
    }
    if (isQueryAtomWord(token.text)) {
      try {
        return parseQueryAtom(token.text)!;
      } catch (error) {
        if (error instanceof QueryAtomError) syntaxError(error.message, token.start);
        throw error;
      }
    }
    // `project={{this.project}}`: the value is an operand the service binds (`bindThis`); the text never reaches the query.
    const operand = VALUE_OPERAND.exec(token.text);
    if (operand) return { kind: "property", key: normalizePropertyKey(operand[1]!), from: operand[2]! };
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

/** The facet pick a query clause names, including a learned alias or a corrected suggestion. */
export function queryClausePick(expression: QueryExpression, mode: Clause["mode"] = "include"): Clause | undefined {
  if (expression.kind === "not") return queryClausePick(expression.operand, mode === "include" ? "exclude" : "include");
  if (expression.kind === "tag") return { key: "tag", value: expression.tag, mode };
  if (expression.kind === "property" && !expression.relation && !expression.from) return { key: expression.key, value: expression.value, mode };
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

export function normalizeQueryExpression(expression: QueryExpression, depth = 0, leaves = { count: 0 }): QueryExpression {
  if (!expression || typeof expression !== "object") throw new BlockQueryError("Query expression must be an object");
  if (depth > MAX_QUERY_EXPRESSION_DEPTH) throw new BlockQueryError("Query expression is nested too deeply");
  switch (expression.kind) {
    case "property": {
      if ((leaves.count += 1) > MAX_QUERY_EXPRESSION_LEAVES) throw new BlockQueryError("Query expression has too many clauses");
      if (expression.from !== undefined) {
        if (typeof expression.from !== "string" || !/^\{\{[^\n]*\}\}$/.test(expression.from)) throw new BlockQueryError("A property's from is a {{path}}, such as {{this.project}}");
        return { kind: "property", key: normalizePropertyKey(String(expression.key)), from: expression.from };
      }
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
    case "compare": {
      if ((leaves.count += 1) > MAX_QUERY_EXPRESSION_LEAVES) throw new BlockQueryError("Query expression has too many clauses");
      const key = normalizePropertyKey(String(expression.key));
      if (!COMPARISONS.has(expression.op)) throw new BlockQueryError(`Query comparison must be <, <=, > or >=: ${String(expression.op)}`);
      if (typeof expression.value !== "string" || !expression.value.trim()) throw new BlockQueryError(`Query comparison ${key} ${expression.op} needs a value`);
      return { kind: "compare", key, op: expression.op, value: expression.value.trim() };
    }
    case "tag":
    case "links":
    case "linkedfrom":
    case "under":
    case "parent":
    case "title":
    case "text":
    case "call":
    case "by":
    case "unread":
    case "thread": {
      if ((leaves.count += 1) > MAX_QUERY_EXPRESSION_LEAVES) throw new BlockQueryError("Query expression has too many clauses");
      const word = expression.kind === "tag" ? `#${String(expression.tag)}`
        : expression.kind === "links" || expression.kind === "linkedfrom" || expression.kind === "under" || expression.kind === "parent" ? `${expression.kind}:${String(expression.target)}`
        : expression.kind === "call" ? `call:${String(expression.call)}`
        : expression.kind === "by" ? `by:${String(expression.who)}`
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
  /** The latest text/property writer, as revision history records it. */
  writerOf?(blockId: string): { author?: string; actorId?: string };
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
  /** Its revision, for `unread:` (read at an older one is unread again) and `revision >= 2`. */
  revision?: number;
  /** Who wrote it last, for `by:`: an author and an actor id. */
  author?: string;
  actorId?: string;
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
      return (_subject, properties) => tagMatches(properties.filter(p => p.key === "tag" || p.key === "tags").flatMap(p => splitPropertyValue(p.value)), tag);
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
    case "by": {
      // An author (`user`, `agent`, `system`) or a writer (`actorNamed`), ignoring case: who wrote the block last.
      const who = expression.who.toLowerCase();
      return subject => {
        const writer = subject.id && relations?.writerOf ? relations.writerOf(subject.id) : subject;
        return writer.author?.toLowerCase() === who || actorNamed(writer.actorId, who);
      };
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
      // `due=today`, `due="Oct 20"`: the same text, or a value on that day (a span holding it), however it's written.
      const day = expression.value === undefined || readNumber(expression.value) !== null ? null : readDateBound(expression.value, wallClock(now));
      if (day) {
        const wall = wallClock(now), bound = { kind: "date" as const, when: day }, key = expression.key, value = expression.value!;
        const holds = (properties: readonly (BlockProperty | PropertyRecord)[], scope: PropertyQueryScope = "block") =>
          properties.some(p => p.key === key && (scope === "all" || ("scope" in p ? p.scope : "block") === scope)
            && (matchesFilters([p], [{ key, value }], "all") || valueHolds(p.value, "=", bound, wall) === true));
        if (expression.relation === "child") {
          const least = expression.count ?? 1;
          return subject => (subject.childProperties?.() ?? []).filter(properties => holds(properties)).length >= least;
        }
        return (_subject, properties, scope) => holds(properties, scope);
      }
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
    case "compare": {
      const wall = wallClock(now), bound = readBound(expression.value, wall), key = expression.key, op = expression.op;
      // `revision >= 2` is the block's own revision (PIE-867): a note saved more than once, as `unread:` reads it.
      if (key === "revision") return subject => subject.revision !== undefined && valueHolds(String(subject.revision), op, bound, wall) === true;
      return (_subject, properties, scope = "block") => properties.some(p =>
        p.key === key && (scope === "all" || ("scope" in p ? p.scope : "block") === scope) && valueHolds(p.value, op, bound, wall) === true);
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
        const start = time.start(now), end = time.end(now);
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
      // What excludes a note is its own (PIE-1277): under a wider scope, `NOT work-stage=done` still asks the note's
      // header, so a body line listing a done ticket never hides it. The scope widens what puts a note in, only.
      const operand = compileQueryExpression(expression.operand, now, relations);
      return (subject, properties) => !operand(subject, properties, "block");
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

/**
 * The chips a row matched on (PIE-1277): of `records` (already in the question's scope), those a positive clause
 * holds for on its own: a plain filter, a `key=value` (a date on that day too) or a comparison (`cost < 10` keeps
 * the 5, not the 100), never one under NOT. A row opens at the first.
 */
export function matchedChips(records: readonly PropertyRecord[], filters: readonly PropertyFilter[], where: QueryExpression | undefined, now = Date.now()): PropertyRecord[] {
  const wall = wallClock(now);
  const tests: ((p: PropertyRecord) => boolean)[] = filters.map(f => p => matchesFilters([p], [f], "all"));
  const visit = (e: QueryExpression): void => {
    if (e.kind === "and" || e.kind === "or") { e.operands.forEach(visit); return; }
    if (e.kind === "property" && !e.relation) {
      const day = e.value === undefined || readNumber(e.value) !== null ? null : readDateBound(e.value, wall);
      const filter = { key: e.key, ...(e.value === undefined ? {} : { value: e.value }) };
      tests.push(p => matchesFilters([p], [filter], "all") || (!!day && p.key === e.key && valueHolds(p.value, "=", { kind: "date", when: day }, wall) === true));
    } else if (e.kind === "compare" && e.key !== "revision") {
      const bound = readBound(e.value, wall);
      tests.push(p => p.key === e.key && valueHolds(p.value, e.op, bound, wall) === true);
    }
  };
  if (where) visit(where);
  return tests.length ? records.filter(p => tests.some(test => test(p))) : [];
}

/** Property clauses that can contribute match context (not under NOT). */
export function positivePropertyFilters(expression: QueryExpression): PropertyFilter[] {
  switch (expression.kind) {
    case "property": return expression.relation ? [] : [{ key: expression.key, ...(expression.value === undefined ? {} : { value: expression.value }) }];
    case "compare": return [{ key: expression.key }];
    case "time":
    case "tag":
    case "links":
    case "linkedfrom":
    case "under":
    case "parent":
    case "title":
    case "text":
    case "call":
    case "by":
    case "unread":
    case "thread":
    case "not": return [];
    default: return expression.operands.flatMap(positivePropertyFilters);
  }
}

/** A block's title: its first line without property tokens. */
export function titleOf(text: string): string {
  return firstLineWithoutPropertyTokens(text)?.trim() ?? "";
}

/** Why a question that says `this` can't be answered without one (ADR 0004). */
export const THIS_MISSING = "this is the note the query sits in; this query has none (pass this=<block id>)";

/** What `{{path}}` in a query reads: the values of a Site path for the note the question sits in; throws a corrective error. */
export type ValueBinder = (path: string) => string[];

/** No clause matches: an `or` of nothing. */
const NO_MATCH: QueryExpression = { kind: "or", operands: [] };

/** Whether a query (its text) has a clause about other notes (`child:`, `links:`, `under:`…); one that can't be read says no. */
export function readsOtherNotes(query: string): boolean {
  try { return queryReach(parseSearchExpression(query).where).open; } catch { return false; }
}

/** The relations a query reads (none for one that can't be read). */
export function queryRelations(query: string): ReadonlySet<QueryRelationKind> {
  try { return queryReach(parseSearchExpression(query).where).relations; } catch { return new Set(); }
}

/** The relations a query reads: `child` (a child's properties) and the atoms about other notes. */
export type QueryRelationKind = "child" | "links" | "linkedfrom" | "under" | "parent" | "other";

/**
 * What a query expression asks about: the property keys it names, which relations to other notes it reads (`child:`,
 * `links:`, `linkedfrom:`, `under:`, `parent:`; `other` for the reader/author atoms), so its answer depends on notes the
 * subject doesn't name.
 */
export function queryReach(expression: QueryExpression | undefined): { open: boolean; children: boolean; relations: Set<QueryRelationKind>; asked: string[] } {
  const relations = new Set<QueryRelationKind>();
  const asked: string[] = [];
  const walk = (e: QueryExpression | undefined): void => {
    if (!e) return;
    switch (e.kind) {
      case "property": if (e.relation) relations.add("child"); else asked.push(e.key); return;
      case "compare": asked.push(e.key); return;
      case "not": walk(e.operand); return;
      case "and": case "or": e.operands.forEach(walk); return;
      case "time": case "tag": case "title": case "text": return;
      case "links": case "linkedfrom": case "under": case "parent": relations.add(e.kind); return;
      default: relations.add("other");
    }
  };
  walk(expression);
  return { open: relations.size > 0, children: relations.has("child"), relations, asked };
}

/**
 * `expression` with every `this` target bound to block `thisId` (`links:this` → `links:((id))`) and every value operand
 * (`project={{this.project}}`) bound to the values `values` reads for its path: one clause per value (any of them), none
 * matching nothing. A value is an operand, never query text. With no `thisId`, a `this` is refused with what to pass.
 */
export function bindThis(expression: QueryExpression, thisId: string | undefined, values?: ValueBinder): QueryExpression {
  switch (expression.kind) {
    case "links":
    case "linkedfrom":
    case "under":
    case "parent":
      if (expression.target !== THIS_TARGET) return expression;
      if (!thisId) throw new BlockQueryError(THIS_MISSING);
      return { ...expression, target: `((${thisId}))` };
    case "property": {
      if (expression.from === undefined) return expression;
      if (!thisId || !values) throw new BlockQueryError(`${expression.from} reads the note this query sits in; this query has none (pass this=<block id>)`);
      const { from, ...rest } = expression;
      const got = [...new Set(values(from.slice(2, -2).trim()))];
      const clauses = got.map((value): QueryExpression => ({ ...rest, value }));
      return clauses.length === 0 ? NO_MATCH : clauses.length === 1 ? clauses[0]! : { kind: "or", operands: clauses };
    }
    case "not":
      return { kind: "not", operand: bindThis(expression.operand, thisId, values) };
    case "and":
    case "or":
      return { kind: expression.kind, operands: expression.operands.map(operand => bindThis(operand, thisId, values)) };
    default:
      return expression;
  }
}

/** Every property key an expression names, under NOT and `child:` too: what a "no notes have <key>" hint checks. */
export function expressionPropertyKeys(expression: QueryExpression | undefined): string[] {
  if (!expression) return [];
  switch (expression.kind) {
    case "property":
    case "compare": return [expression.key];
    case "not": return expressionPropertyKeys(expression.operand);
    case "and":
    case "or": return expression.operands.flatMap(expressionPropertyKeys);
    default: return [];
  }
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

