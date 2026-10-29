export { labelBar, linkOccurrences, pageAddressText, pageLinkSpans, qualifiedReference, referencedBlock } from "../../outline-core/src/link-syntax";
export { BLOCK_ID_PATTERN, formatEp0chBlockUri } from "../../outline-core/src/addressable-resource";
export { COMPONENT_OPEN, componentBlocks } from "../../outline-core/src/component-block";
export { codeBlocks } from "../../outline-core/src/code-fence";
/** outline-core's step box grammar: the status a box's inner character (or the whole `[c]`) reads as, or null. */
export function boxStatus(box: string): 'todo' | 'done' | 'waiting' | 'problem' | 'approved' | 'rejected' | null
/** outline-core's `@name` matcher (mention.ts): whether a text addresses `name`, as a word. */
export function mentions(text: string, name: string): boolean
/** outline-core's actor id reader (attribution.ts): `mcp:loki/claude.ai` and `loki/claude-code@float-2` are persona loki. */
export function parseActor(actorId: string | undefined | null): { persona?: string; principal?: string; handle: string; label: string; mcp: boolean }
