import { isMachineName, isOutlineName } from "./outline-location";

export const EP0CH_URI_SCHEME = "ep0ch";
export const BLOCK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const FRAGMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const EP0CH_BLOCK_URI = /^ep0ch:\/\/([^@/?#]+)@([^/?#]+)\/b\/([^/?#]+)(?:#([^?#]*))?$/;
const BLOCK_REFERENCE_HEAD_PATTERN = /^\(\(([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\^([A-Za-z0-9][A-Za-z0-9_-]{0,63}))?(?=\)\)|\|)/i;

export interface Ep0chBlockUri {
  outline: string;
  machine: string;
  blockId: string;
  fragment?: string;
}

function decodeField(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`Invalid ep0ch URI ${label}: bad percent encoding`);
  }
}

function encodeField(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The `))` that closes a `((` opened just before `from`. Parentheses inside
 * are balanced, so `((Rough edges (x)))` closes after `(x)`; when they cannot
 * balance (`((Smile :)))`), the first `))` at or after `minimum` closes it.
 * Returns the offset after the closing `))`, or -1.
 */
export function referenceEnvelopeEnd(text: string, from: number, singleLine = false, minimum = from): number {
  let depth = 0;
  let first = -1;
  for (let cursor = from; cursor < text.length - 1; cursor += 1) {
    const character = text[cursor]!;
    // Titles and labels are one line: once a close is known, balance only within it.
    if ((singleLine || first >= 0) && (character === "\n" || character === "\r")) break;
    if (character === ")" && text[cursor + 1] === ")" && cursor >= minimum) {
      if (first < 0) first = cursor + 2;
      if (depth <= 0) return depth === 0 ? cursor + 2 : first;
    }
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    if (depth < 0 && first >= 0) return first;
  }
  return first;
}

export function normalizeBlockId(value: string): string {
  if (!BLOCK_ID_PATTERN.test(value)) throw new Error(`Invalid block id: ${value}`);
  return value.toLowerCase();
}

/**
 * The block an exact address names: a UUID, or `((uuid))`, `((uuid^fragment))`, `((uuid|label))` written whole. It
 * throws on anything else, so a URI, an MCP argument or a stored reference is a full id or refused. A value someone
 * wrote in a note or typed (an id's first 8+ characters, a reference as the note scan reads it) unwraps with
 * link-syntax.ts's `referencedBlock` instead: that is the authored-reference scan, and it never throws.
 */
export function parseBlockRef(input: string): { blockId: string; fragment?: string } {
  if (BLOCK_ID_PATTERN.test(input)) return { blockId: input.toLowerCase() };
  const match = BLOCK_REFERENCE_HEAD_PATTERN.exec(input);
  if (!match) throw new Error(`Invalid block reference: ${input}`);
  let end = match[0].length + 2;
  if (input[match[0].length] === "|") {
    end = referenceEnvelopeEnd(input, match[0].length + 1, true, match[0].length + 2);
    if (end < 0 || !input.slice(match[0].length + 1, end - 2).trim()) {
      throw new Error(`Invalid block reference: ${input}`);
    }
  }
  if (end !== input.length) throw new Error(`Invalid block reference: ${input}`);
  return { blockId: match[1]!.toLowerCase(), ...(match[2] ? { fragment: match[2] } : {}) };
}

export function formatEp0chBlockUri(target: Ep0chBlockUri): string {
  if (!isOutlineName(target.outline)) throw new Error(`Invalid outline name: ${target.outline}`);
  if (!isMachineName(target.machine)) throw new Error(`Invalid machine name: ${target.machine}`);
  const blockId = normalizeBlockId(target.blockId);
  if (target.fragment !== undefined && !FRAGMENT_ID_PATTERN.test(target.fragment)) throw new Error(`Invalid fragment id: ${target.fragment}`);
  return `ep0ch://${encodeField(target.outline)}@${encodeField(target.machine)}/b/${blockId}${target.fragment ? `#${encodeField(target.fragment)}` : ""}`;
}

export function parseEp0chBlockUri(input: string): Ep0chBlockUri {
  const match = EP0CH_BLOCK_URI.exec(input);
  if (!match) throw new Error("Invalid ep0ch block URI; expected exact ep0ch://<outline>@<machine>/b/<uuid>[#fragment]");
  const outline = decodeField(match[1]!, "outline");
  const machine = decodeField(match[2]!, "machine");
  const blockId = decodeField(match[3]!, "block id");
  const fragment = match[4] === undefined ? undefined : decodeField(match[4], "fragment");
  if (!isOutlineName(outline)) throw new Error(`Invalid ep0ch URI outline: ${outline}`);
  if (!isMachineName(machine)) throw new Error(`Invalid ep0ch URI machine: ${machine}`);
  const normalizedBlockId = normalizeBlockId(blockId);
  if (fragment !== undefined && !FRAGMENT_ID_PATTERN.test(fragment)) throw new Error(`Invalid ep0ch URI fragment: ${fragment}`);
  return { outline, machine, blockId: normalizedBlockId, ...(fragment ? { fragment } : {}) };
}

/** An outline as a URI names it: `name@machine`. */
export interface OutlineAddress { outline: string; machine: string }

/**
 * Whether a URI's machine is `machine`: the one comparison every client makes before it routes or refuses a URI (the
 * door's open and `--screen`, its control socket, the MCP server). Exact today; a machine's aliases (PIE-520's
 * canonical machine name) are accepted here when the service names one.
 */
export function sameMachine(uriMachine: string, machine: string): boolean {
  return uriMachine === machine;
}

/** Whether `uri` names the outline at `at` (`outline@machine`); an `at` with no outline names none. */
export function namesOutline(uri: OutlineAddress, at: { outline?: string | null; machine: string }): boolean {
  return !!at.outline && uri.outline === at.outline && sameMachine(uri.machine, at.machine);
}

export function parseAddressedBlock(input: string): Ep0chBlockUri | { blockId: string; fragment?: string } {
  if (input.trimStart().startsWith("ep0ch://")) return parseEp0chBlockUri(input);
  return parseBlockRef(input);
}
