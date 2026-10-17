// Output regions (PIE-956, S6): the folded callout a producer (a script, an @name answer) owns inside a note.
//
//   > [!output]- weekly [output-of::((script-id))] [output-hash::3f9a1c] ^out-weekly-7c2e
//   > | day | done |
//
// Ownership is in the text: `[output-hash::]` is the hash of the body as the producer last wrote it, so a region whose
// body no longer matches has been edited by a person and is theirs (it survives restarts, deploys and trashed run
// notes). The anchor is unique per (producer, target). `[!answer]` regions are the same kind with the callout type
// naming it. The service writes them (outliner `place.ts`), the door and Detail draw them by this one grammar.
// Pure: no I/O.

/** The callout types that make a region: what a script wrote, and what an `@name` agent answered. */
export const OUTPUT_TYPES = ["output", "answer"] as const;
export type OutputType = (typeof OUTPUT_TYPES)[number];

/** One output region found in a note's text. Offsets are UTF-16 units of that text; `end` is after the last `>` line, before its newline. */
export interface OutputRegion {
  type: OutputType;
  /** The header's words before the chips: what the region is called. */
  label: string;
  /** `[output-of::((id))]`: the producer's block id; absent on an `[!answer]` with no producer. */
  producer?: string;
  /** `[output-hash::…]` as written; absent when the region has none (never the producer's own). */
  hash?: string;
  /** The `^anchor` on the header line, without the caret. */
  anchor?: string;
  start: number;
  end: number;
  /** The header's line index and the last body line's. */
  startLine: number;
  endLine: number;
  /** The body, `>` marks removed, lines joined with `\n`. */
  body: string;
  /** The region's body no longer matches the hash its producer wrote: a person edited it, so it is theirs. */
  edited: boolean;
}

const HEADER = /^(\s*)>\s*\[!(output|answer)\][+-]?\s*(.*)$/;
const ANCHOR_END = /\s\^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\s*$/;
const FENCE = /^\s{0,3}(```|~~~)/;

/** A small stable hash (cyrb53) as lowercase hex: for ownership and anchors, not security. */
function digest(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** The hash of a region's body as `[output-hash::]` holds it (line ends and trailing space don't count). */
export const outputHash = (body: string): string => digest(body.replace(/\r\n?/g, "\n").split("\n").map(l => l.trimEnd()).join("\n").trim()).slice(0, 12);

/** The words a label gives an anchor: lowercase letters, digits and dashes. */
const slug = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "out";

/**
 * The anchor of the region `producer` keeps at `target` (an address as text, `^weekly`, `here:12`): `^out-<label>-<short hash
 * of producer and target>`. The same pair always gives the same anchor, so a second run finds its region; two producers
 * aimed at one anchor get two.
 */
export const outputAnchor = (producer: string, target: string, label = "out"): string => `out-${slug(label)}-${digest(`${producer}\n${target}`).slice(0, 4)}`;

/** Whether a line opens an output region, and its parts. */
export function outputHeader(line: string): { type: OutputType; label: string; producer?: string; hash?: string; anchor?: string } | null {
  const m = HEADER.exec(line);
  if (!m) return null;
  let rest = m[3]!;
  const anchor = ANCHOR_END.exec(rest)?.[1];
  if (anchor) rest = rest.replace(ANCHOR_END, "");
  const producer = /\[output-of::\(\(([A-Za-z0-9_-]+)(?:\|[^)]*)?\)\)\]/.exec(rest)?.[1];
  const hash = /\[output-hash::([A-Za-z0-9]+)\]/.exec(rest)?.[1];
  const label = rest.replace(/\[(?:output-of|output-hash)::[^\]]*\]/g, "").trim();
  return { type: m[2] as OutputType, label, ...(producer ? { producer } : {}), ...(hash ? { hash } : {}), ...(anchor ? { anchor } : {}) };
}

/** Every output region in `text`, in order. A `>` line inside a code fence is code, never a region. */
export function findOutputRegions(text: string): OutputRegion[] {
  const lines = text.split("\n");
  const regions: OutputRegion[] = [];
  let offset = 0, fenced = false;
  const starts = lines.map(l => { const at = offset; offset += l.length + 1; return at; });
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i]!)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const head = outputHeader(lines[i]!);
    if (!head) continue;
    let last = i;
    while (last + 1 < lines.length && /^\s*>/.test(lines[last + 1]!) && !outputHeader(lines[last + 1]!)) last++;
    const body = lines.slice(i + 1, last + 1).map(l => l.replace(/^\s*>\s?/, "")).join("\n");
    const end = starts[last]! + lines[last]!.length;
    regions.push({
      ...head, start: starts[i]!, end, startLine: i, endLine: last, body,
      edited: head.hash !== undefined && head.hash !== outputHash(body),
    });
    i = last;
  }
  return regions;
}

/** The region whose header carries `anchor`, if any. */
export const outputRegionAt = (text: string, anchor: string): OutputRegion | undefined => findOutputRegions(text).find(r => r.anchor === anchor);

/** The text of a region: its header (label, producer, hash, anchor) and the body as `>` lines. `{{` in the body is escaped as `\{{` unless `interpolate`. */
export function outputRegionText(r: { type?: OutputType; label: string; producer?: string; anchor: string; body: string; interpolate?: boolean }): string {
  const body = (r.interpolate ? r.body : escapeBraces(r.body)).replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  const head = `> [!${r.type ?? "output"}]- ${r.label}${r.producer ? ` [output-of::((${r.producer}))]` : ""} [output-hash::${outputHash(body)}] ^${r.anchor}`;
  return [head, ...body.split("\n").map(l => (l ? `> ${l}` : ">"))].join("\n");
}

/** `{{` written literally: output a script produced never starts resolving in prose. */
export const escapeBraces = (text: string): string => text.replace(/(?<!\\)\{\{/g, "\\{{");

/** `text` with every output region's characters replaced by spaces (newlines kept), so offsets and lines stay: what the record builder reads, so a table's `[status::done]` or a link inside a region is never the note's. */
export function maskOutputRegions(text: string): string {
  if (!text.includes("[!output]") && !text.includes("[!answer]")) return text;
  let out = text;
  for (const r of findOutputRegions(text)) out = out.slice(0, r.start) + out.slice(r.start, r.end).replace(/[^\n]/g, " ") + out.slice(r.end);
  return out;
}
