// The publisher's private-use characters (PIE-1647): who holds which. A page part that rides through the Markdown
// renderer as sentinels (marginalia's marks, components, block anchors, checklist steps) takes its block and its marker
// from here, and draws its HTML in their place once the page is rendered. A new one claims the next free block below
// and the next marker, here and nowhere else; publish.ts and the renderer read the whole range as `PRIVATE_USE`.
//
//   markers  U+E000..U+E005   one character each: what a sentinel opens (and closes) with
//   blocks   U+E100 marginalia, U+E200 components (one character, up to 255 each)
//            U+E300 anchors, U+E400 steps (two characters, a high and a low, up to 65536 each)

/** A Unicode escape for a regular expression's source. */
const hex = (code: number) => `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;

/** One part's block of indices: how an index is written, read back, and matched. */
export interface SentinelBlock {
  /** How many indices it holds. */
  readonly capacity: number;
  /** The source of a regular expression matching one of its characters, `[\uE300-\uE3FF]`. */
  readonly char: string;
  /** Index `index` as its characters (one, or two: high then low). */
  encode(index: number): string;
  /** The index `chars` (as `encode` wrote them) stand for. */
  decode(chars: string): number;
}

/** A block at `base`: one character up to `base + 0xFE` (255 indices), or two, each up to `base + 0xFF` (65536). */
function block(base: number, width: 1 | 2): SentinelBlock {
  if (width === 1) return {
    capacity: 255,
    char: `[${hex(base)}-${hex(base + 0xFE)}]`,
    encode: index => String.fromCharCode(base + index),
    decode: chars => chars.charCodeAt(0) - base,
  };
  return {
    capacity: 256 * 256,
    char: `[${hex(base)}-${hex(base + 0xFF)}]`,
    encode: index => `${String.fromCharCode(base + (index >> 8))}${String.fromCharCode(base + (index & 0xFF))}`,
    decode: chars => ((chars.charCodeAt(0) - base) << 8) + chars.charCodeAt(1) - base,
  };
}

/** Each part's block. */
export const SENTINEL_BLOCKS = {
  marginalia: block(0xE100, 1),
  components: block(0xE200, 1),
  anchors: block(0xE300, 2),
  steps: block(0xE400, 2),
} as const;

/** Each part's markers: what its sentinels open (and close) with. */
export const SENTINEL_MARKERS = {
  markOpen: String.fromCharCode(0xE000),
  markClose: String.fromCharCode(0xE001),
  component: String.fromCharCode(0xE002),
  anchor: String.fromCharCode(0xE003),
  step: String.fromCharCode(0xE004),
  /** Around a replacement's group of anchors, which drawAnchors moves inside the figure it follows. */
  anchorGroup: String.fromCharCode(0xE005),
} as const;

/** The source of a regular expression matching any private-use character: every sentinel, and more. */
export const PRIVATE_USE = "[\\uE000-\\uF8FF]";

/** The markers and marginalia's block, the characters a mark's own sentinels are drawn from (U+E000..U+E1FF). */
export const MARKERS_THROUGH_MARGINALIA = `${hex(0xE000)}-${hex(0xE1FF)}`;
