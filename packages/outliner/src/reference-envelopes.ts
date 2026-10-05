import { referenceEnvelopeEnd } from "@ep0ch/outline-core/addressable-resource";

export { referenceEnvelopeEnd };

/** Where a `((…))` envelope ends, shared by reference parsing and every re-scan of resolved text. */


export interface BlockReferenceEnvelope {
  start: number;
  end: number;
}

export function blockReferenceEnvelopeRanges(text: string): BlockReferenceEnvelope[] {
  const ranges: BlockReferenceEnvelope[] = [];
  for (let start = text.indexOf("(("); start >= 0; start = text.indexOf("((", start)) {
    const end = referenceEnvelopeEnd(text, start + 2);
    if (end < 0) break;
    ranges.push({ start, end });
    start = end;
  }
  return ranges;
}
