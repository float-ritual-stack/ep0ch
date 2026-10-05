import { isMachineName, isOutlineName } from "./outline-location";

export const EP0CH_URI_SCHEME = "ep0ch";
export const BLOCK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const FRAGMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const EP0CH_BLOCK_URI = /^ep0ch:\/\/([^@/?#]+)@([^/?#]+)\/b\/([^/?#]+)(?:#([^?#]*))?$/;
const BLOCK_REFERENCE = /^\(\(([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\^([A-Za-z0-9][A-Za-z0-9_-]{0,63}))?(?:\|[^\r\n]+?)?\)\)$/i;

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

export function normalizeBlockId(value: string): string {
  if (!BLOCK_ID_PATTERN.test(value)) throw new Error(`Invalid block id: ${value}`);
  return value.toLowerCase();
}

export function parseBlockRef(input: string): { blockId: string; fragment?: string } {
  const text = input.trim();
  if (BLOCK_ID_PATTERN.test(text)) return { blockId: text.toLowerCase() };
  const match = BLOCK_REFERENCE.exec(text);
  if (!match) throw new Error(`Invalid block reference: ${input}`);
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
  const match = EP0CH_BLOCK_URI.exec(input.trim());
  if (!match) throw new Error("Invalid ep0ch block URI; expected ep0ch://<outline>@<machine>/b/<uuid>[#fragment]");
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

export function parseAddressedBlock(input: string): Ep0chBlockUri | { blockId: string; fragment?: string } {
  const text = input.trim();
  if (text.startsWith("ep0ch://")) return parseEp0chBlockUri(text);
  return parseBlockRef(text);
}
