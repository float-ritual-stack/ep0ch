// The property token's grammar: what a `[key::value]` token and a property key are. This file is the
// one definition. The service's parser (properties.ts), the query language (block-query.ts) and context
// resolution use it, and the door imports it to find tokens while it paints. It lives in outline-core so
// both sides import the same file: any change to what these patterns match bumps PROTOCOL (protocol.ts).
//
// This is the token grammar only. Whether a token counts as a property also depends on where it sits
// (code spans, fences, literal regions, reference labels) and its scope, which `properties.preview`
// answers for a whole text.

/** A property key: a letter, then letters, digits, `_`, `.` or `-` (`plot.row`, `bed_2`; not `2nd-pass`). */
export const PROPERTY_KEY_SOURCE = "[A-Za-z][A-Za-z0-9_.-]*";
/** A bracket token's value: at least one character, no `]`, CR or LF (`[empty::]` is text). */
export const PROPERTY_VALUE_SOURCE = String.raw`[^\]\r\n]+`;
/** `[key::value]`, capturing the key and the value. */
export const PROPERTY_TOKEN_SOURCE = String.raw`\[(${PROPERTY_KEY_SOURCE})::(${PROPERTY_VALUE_SOURCE})\]`;

export const PROPERTY_KEY_PATTERN = new RegExp(`^${PROPERTY_KEY_SOURCE}$`);

/**
 * A hashtag's value (after the `#`): letters, digits, `_`, marks and `-`, `/` between segments (`#garden/beds`). A
 * hashtag is a property (`tag`) when its value holds a letter and it starts a word; the parser says where.
 */
export const HASHTAG_VALUE_PATTERN = /[\p{L}\p{N}_][\p{L}\p{M}\p{N}_-]*(?:\/[\p{L}\p{N}_][\p{L}\p{M}\p{N}_-]*)*/u;

/** A fresh global pattern for `[key::value]` tokens (match[1] the key as written, match[2] the raw value). */
export function propertyTokenPattern(): RegExp {
  return new RegExp(PROPERTY_TOKEN_SOURCE, "g");
}

export function isPropertyKey(key: string): boolean {
  return PROPERTY_KEY_PATTERN.test(key);
}

/** A token preceded by an odd run of backslashes (`\[key::value]`) is escaped: it is text. */
export function isEscapedAt(text: string, offset: number): boolean {
  let cursor = offset;
  while (cursor > 0 && text[cursor - 1] === "\\") cursor -= 1;
  return (offset - cursor) % 2 === 1;
}

export interface PropertyTokenMatch {
  /** The key, lowercased as the service stores it. */
  key: string;
  /** The value, trimmed. */
  value: string;
  raw: string;
  start: number;
  end: number;
}

/** The unescaped `[key::value]` tokens of one line of text, in order. */
export function propertyTokensInLine(line: string): PropertyTokenMatch[] {
  const out: PropertyTokenMatch[] = [];
  for (const match of line.matchAll(propertyTokenPattern())) {
    const start = match.index ?? 0;
    if (isEscapedAt(line, start)) continue;
    out.push({ key: match[1]!.toLowerCase(), value: match[2]!.trim(), raw: match[0], start, end: start + match[0].length });
  }
  return out;
}

/** One line with its unescaped tokens taken out (the spaces around them are left as they were). */
export function withoutPropertyTokens(line: string): string {
  let out = "";
  let cursor = 0;
  for (const token of propertyTokensInLine(line)) {
    out += line.slice(cursor, token.start);
    cursor = token.end;
  }
  return out + line.slice(cursor);
}

/** A line holding one or more tokens and nothing else but spaces and tabs. */
export function isPropertyTokenLine(line: string): boolean {
  const tokens = propertyTokensInLine(line);
  return tokens.length > 0 && /^[ \t]*$/.test(withoutPropertyTokens(line));
}
