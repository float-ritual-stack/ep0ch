import { codeFenceOpen } from "@ep0ch/outline-core/code-fence";
import { scanLiteralRegions } from "@ep0ch/outline-core/code-ranges";
import { HASHTAG_VALUE_PATTERN, PROPERTY_KEY_PATTERN, isHexColour, isWritablePropertyValue, propertyValueHolds } from "@ep0ch/outline-core/property-grammar";
import { PROPERTY_PARSER_VERSION, parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import type {
  BlockProperty,
  PropertyFilter,
  PropertyParsePreview,
  PropertyPatchOperation,
  PropertyQueryScope,
  PropertyRecord,
} from "./types";

/** Reads a draft with the save-time parser without storing or changing anything. */
export function previewPropertyParse(text: unknown): PropertyParsePreview {
  if (typeof text !== "string") throw new Error("properties.preview requires text");
  const tokens = parsePropertyRecords(text);
  return {
    parserVersion: PROPERTY_PARSER_VERSION,
    properties: tokens
      .filter((property) => property.scope === "block")
      .map(({ key, value }) => ({ key, value })),
    tokens,
  };
}


export function normalizePropertyKey(key: string): string {
  const normalized = key.trim();
  if (!PROPERTY_KEY_PATTERN.test(normalized)) throw new Error(`Invalid property key: ${key}`);
  return normalized.toLowerCase();
}

export function validateProperty(key: string, value: string): BlockProperty {
  const normalizedKey = normalizePropertyKey(key);
  const normalizedValue = value.trim();
  if (!normalizedValue) throw new Error(`Property value cannot be empty: ${key}`);
  if (!isWritablePropertyValue(normalizedValue)) {
    throw new Error(`Property value must be one line with balanced brackets (links such as [[page]] and ((id|label)) are fine): ${key}`);
  }
  return { key: normalizedKey, value: normalizedValue };
}

export function formatProperty(property: BlockProperty): string {
  const validated = validateProperty(property.key, property.value);
  return `[${validated.key}::${validated.value}]`;
}

export function patchPropertyText(text: string, operations: PropertyPatchOperation[]): string {
  const tokens = parsePropertyRecords(text);
  const mutations: Array<{ start: number; end: number; replacement: string }> = [];
  const touchedOrdinals = new Set<number>();
  const appends: BlockProperty[] = [];

  for (const operation of operations) {
    const operationKind: string = operation.op;
    if (operationKind === "append") {
      const append = operation as Extract<PropertyPatchOperation, { op: "append" }>;
      appends.push(validateProperty(append.key, append.value));
      continue;
    }
    if (operationKind !== "remove" && operationKind !== "replace") {
      throw new Error(`Unknown property patch operation: ${operationKind}`);
    }
    const tokenOperation = operation as Exclude<PropertyPatchOperation, { op: "append" }>;
    if (!Number.isInteger(tokenOperation.ordinal) || tokenOperation.ordinal < 0) {
      throw new Error(`Invalid property token ordinal: ${tokenOperation.ordinal}`);
    }
    if (touchedOrdinals.has(tokenOperation.ordinal)) {
      throw new Error(`Property token patched more than once: ${tokenOperation.ordinal}`);
    }
    touchedOrdinals.add(tokenOperation.ordinal);
    const token = tokens[tokenOperation.ordinal];
    if (!token) throw new Error(`Property token not found: ${tokenOperation.ordinal}`);
    let replacement = "";
    if (operationKind === "replace") {
      const key = "key" in tokenOperation ? tokenOperation.key ?? token.key : token.key;
      const value = "value" in tokenOperation ? tokenOperation.value : token.value;
      const validated = validateProperty(key, value);
      const hashtagValue = validated.value.match(HASHTAG_VALUE_PATTERN)?.[0];
      if (token.syntax === "hashtag") {
        if (validated.key === "tag" && hashtagValue === validated.value && /\p{L}/u.test(validated.value) && !isHexColour(validated.value)) {
          replacement = `#${validated.value}`;
        } else {
          // Explicit properties in body prose are inline-scoped. Move a value
          // that cannot use hashtag syntax to the preamble to retain its scope.
          appends.push(validated);
        }
      } else {
        replacement = token.syntax === "bare" ? `${validated.key}:: ${validated.value}` : formatProperty(validated);
      }
    }
    mutations.push({ start: token.start, end: token.end, replacement });
  }

  let patched = text;
  for (const mutation of mutations.sort((left, right) => right.start - left.start)) {
    patched = patched.slice(0, mutation.start) + mutation.replacement + patched.slice(mutation.end);
  }
  if (appends.length === 0) return patched;

  const appendedText = appends.map(formatProperty).join(" ");
  const metadataToken = parsePropertyRecords(patched).find(
    (token) => token.scope === "block" && token.placement === "metadata-line" && token.syntax !== "hashtag",
  );
  if (metadataToken) {
    const lineEnd = patched.indexOf("\n", metadataToken.end);
    let insertion = lineEnd < 0 ? patched.length : lineEnd;
    if (insertion > 0 && patched[insertion - 1] === "\r") insertion -= 1;
    const separator = patched.slice(0, insertion).endsWith(" ") ? "" : " ";
    return patched.slice(0, insertion) + separator + appendedText + patched.slice(insertion);
  }
  if (!patched) return appendedText;

  const firstNewline = patched.indexOf("\n");
  const usesCrlf = firstNewline > 0 && patched[firstNewline - 1] === "\r";
  const lineBreak = usesCrlf ? "\r\n" : "\n";
  let firstLineEnd = firstNewline;
  if (firstNewline < 0) {
    firstLineEnd = patched.length;
  } else if (usesCrlf) {
    firstLineEnd -= 1;
  }
  const firstLine = {
    start: 0,
    end: firstNewline < 0 ? patched.length : firstNewline + 1,
    contentEnd: firstLineEnd,
  };
  // A fence or a literal region on the first line would swallow a property
  // appended after it, so the property goes on its own line before it instead.
  if (codeFenceOpen(patched.slice(0, firstLine.contentEnd)) || scanLiteralRegions(patched).regions[0]?.start === 0) {
    return `${appendedText}${lineBreak}${patched}`;
  }
  if (firstNewline < 0) return `${patched}\n${appendedText}`;
  return `${patched.slice(0, firstLineEnd)}${lineBreak}${appendedText}${patched.slice(firstLineEnd)}`;
}

export function matchingPropertyRecords(
  properties: readonly PropertyRecord[],
  filters: readonly PropertyFilter[],
  propertyScope: PropertyQueryScope = "block",
): PropertyRecord[] {
  const scoped = propertyScope === "all"
    ? properties
    : properties.filter((property) => property.scope === propertyScope);
  if (filters.length === 0) return [...scoped];
  return scoped.filter((property) =>
    filters.some(
      (filter) =>
        (property.key === filter.key || filter.key === "tag" && property.key === "tags") &&
        (filter.value === undefined || valueMatches(property.value, filter.value)),
    )
  );
}

export function matchesFilters(
  properties: readonly (BlockProperty | PropertyRecord)[],
  filters: readonly PropertyFilter[],
  propertyScope: PropertyQueryScope = "block",
): boolean {
  // Asked of every note on each query and view read: no arrays made per note.
  return filters.every((filter) =>
    properties.some(
      (property) =>
        (property.key === filter.key || filter.key === "tag" && property.key === "tags") &&
        (propertyScope === "all" || ("scope" in property ? property.scope : "block") === propertyScope) &&
        (filter.value === undefined || valueMatches(property.value, filter.value)),
    )
  );
}

function valueMatches(value: string, wanted: string): boolean {
  return propertyValueHolds(value, wanted);
}

export function getProperty(properties: readonly BlockProperty[], key: string): string | undefined {
  return properties.find((property) => property.key === key.toLowerCase())?.value;
}
