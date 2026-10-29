export { labelBar, linkOccurrences, pageAddressText, pageLinkSpans, qualifiedReference, referencedBlock } from "../../outline-core/src/link-syntax";
export { BLOCK_ID_PATTERN, formatEp0chBlockUri } from "../../outline-core/src/addressable-resource";
export { COMPONENT_OPEN, componentBlocks } from "../../outline-core/src/component-block";
export { codeBlocks } from "../../outline-core/src/code-fence";
/** outline-core's step box grammar: the status a box's inner character (or the whole `[c]`) reads as, or null. */
export function boxStatus(box: string): 'todo' | 'done' | 'waiting' | 'problem' | 'approved' | 'rejected' | null
