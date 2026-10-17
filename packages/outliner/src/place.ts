// place(): where a producer's output goes in a note (PIE-956, S6; PIE-533 design §4.5). A pure planner: it reads a note's
// text, resolves the address against it and says what to write as `draft.patch` spans, or why it won't. The caller
// (ScriptRuns) reads the note through the draft router, sends the spans as the producer, and says the outcome.
//
// Materialized output is always an output region (outline-core `output-region.ts`): a folded callout the producer owns,
// its body hashed in the text so ownership survives restarts. Rules, from the design:
//  - the default mode is `append`; `replace` and `upsert` are opt-in. `replace` never creates.
//  - `append` and `prepend` write a new region next to the anchor's slice, comparing only against the anchor's own line
//    (or an output region), never text the person wrote. At a heading, prepend goes right after the heading line and
//    append after the last output region directly under it.
//  - `replace` touches only this producer's own region, and only while its body still matches its hash. A person's edit
//    makes the region theirs: the new output becomes one proposal beside it.
//  - a missing, moved or duplicate anchor gives one proposal at the caller with a did-you-mean, never the note's end.
import { editDistance } from "@ep0ch/outline-core/tool-args";
import type { DraftPatchSpan } from "@ep0ch/outline-core/draft-patch-compare";
import { frontMatterLines } from "@ep0ch/outline-core/header-line";
import { findOutputRegions, outputAnchor, outputRegionText, type OutputRegion } from "@ep0ch/outline-core/output-region";
import { fragmentAnchors, resolveFragmentSlice, type FragmentAnchor } from "./fragments";

export type PlaceMode = "append" | "prepend" | "replace" | "upsert";
export const PLACE_MODES: readonly PlaceMode[] = ["append", "prepend", "replace", "upsert"];

export interface PlaceRequest {
  /** The producer's block id (`[output-of::((id))]`) and the name its region is labelled with by default. */
  producer: { id: string; name: string };
  /** `^weekly` (or `weekly`): the anchor the output goes at. Absent: `here`. */
  at?: string;
  mode?: PlaceMode;
  content: string;
  /** The region's label; default the producer's name. */
  label?: string;
  /** The note line (from 0) the producer was invoked from: the target when `at` is absent, and where a proposal is drawn. */
  here?: number;
  /** `{{` in the output stays literal unless this is true. */
  interpolate?: boolean;
  /** More anchors the whole outline has (`ensureFragmentAnchor`'s index): more did-you-mean candidates. */
  otherAnchors?: readonly string[];
}

export type PlacePlan =
  /** Write these spans. `created`: a region was made, else the producer's own was replaced. */
  | { ok: true; spans: DraftPatchSpan[]; anchor: string; created: boolean; summary: string; mark: string }
  /** A proposal, drawn at the caller: these spans, sent with `propose: always`, are what it would do. */
  | { ok: false; kind: "proposal"; reason: string; spans: DraftPatchSpan[]; anchor?: string; mark: string }
  /** Refused at the call: nothing is written and nothing proposed. */
  | { ok: false; kind: "refused"; reason: string };

const KIND_WORDS: Record<string, string> = { heading: "a heading section", paragraph: "a paragraph", "list-item": "a list item", component: "a component", quote: "a quote", callout: "a callout" };

/** The anchors nearest `wanted`: a typo, a prefix or a near word. */
export function didYouMean(wanted: string, known: readonly string[]): string[] {
  const near = known.map(id => ({ id, d: id.startsWith(wanted) || wanted.startsWith(id) ? 0 : editDistance(wanted.toLowerCase(), id.toLowerCase()) }))
    .filter(x => x.d <= Math.max(2, Math.floor(wanted.length / 2)));
  return [...new Set(near.sort((a, b) => a.d - b.d).map(x => x.id))].slice(0, 3);
}

/** Whether `line` is in the note's front matter (outline-core's header grammar: its title, header chips and property lines): an address there is refused. */
function inFrontMatter(text: string, line: number): boolean {
  return frontMatterLines(text).has(line);
}

const offsetOf = (lines: readonly string[]) => { let o = 0; const at = lines.map(l => { const s = o; o += l.length + 1; return s; }); return at; };

/** Writes `region` after lines[line] (a blank line between), or before it. */
function insertion(lines: readonly string[], line: number, region: string, where: "after" | "before"): DraftPatchSpan {
  const starts = offsetOf(lines);
  const observed = lines[line]!;
  const range = { start: starts[line]!, end: starts[line]! + observed.length };
  if (where === "after") {
    const next = lines[line + 1];
    return { observed, range, replacement: `${observed}\n\n${region}${next !== undefined && next.trim() ? "\n" : ""}` };
  }
  const prev = lines[line - 1];
  return { observed, range, replacement: `${prev !== undefined && prev.trim() ? "\n" : ""}${region}\n\n${observed}` };
}

/**
 * The mark a patch is sent with: the first line below the span that is unique in the note. `draft.patch` changes only text
 * above its mark and draws a proposal there, so the edit sits at its address and a proposal is drawn just under it. Empty
 * when the span reaches the note's end.
 */
export function markBelow(lines: readonly string[], lastLine: number): string {
  for (let i = lastLine + 1; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t && lines.filter(l => l.trim() === t).length === 1) return lines[i]!;
  }
  return "";
}

const regionOfProducer = (r: OutputRegion, producer: string) => r.producer === producer;

/** Plans one `place()` of `req` in `text`. */
export function planPlace(text: string, req: PlaceRequest): PlacePlan {
  const mode = req.mode ?? "append";
  if (!PLACE_MODES.includes(mode)) return { ok: false, kind: "refused", reason: `mode is ${PLACE_MODES.join(", ")}, not ${JSON.stringify(mode)}` };
  const lines = text.split("\n");
  const label = req.label ?? req.producer.name;
  const regions = findOutputRegions(text);
  const anchors = fragmentAnchors(text);
  const here = req.here !== undefined && req.here >= 0 && req.here < lines.length ? req.here : undefined;
  
  const region = (target: string, anchor?: string) => {
    const a = anchor ?? outputAnchor(req.producer.id, target, label);
    return { anchor: a, text: outputRegionText({ label, producer: req.producer.id, anchor: a, body: req.content, ...(req.interpolate ? { interpolate: true } : {}) }) };
  };
  /** A proposal at the caller: the region goes after the caller's line, held for the person. */
  const proposeAtCaller = (reason: string, target: string): PlacePlan => {
    if (here === undefined) return { ok: false, kind: "refused", reason: `${reason}; and there is no caller line to draw a proposal at, so nothing was written` };
    const r = region(target);
    return { ok: false, kind: "proposal", reason, spans: [insertion(lines, here, r.text, "after")], anchor: r.anchor, mark: markBelow(lines, here) };
  };

  // The address.
  const wanted = req.at?.trim().replace(/^\^/, "");
  if (!wanted) {
    if (here === undefined) return { ok: false, kind: "refused", reason: "place needs at: ^anchor, or to run from a line of a note (here)" };
    if (mode === "replace") return { ok: false, kind: "refused", reason: "replace needs an output region: give at: its ^anchor (use upsert to create or replace this producer's region)" };
    if (inFrontMatter(text, here)) return { ok: false, kind: "refused", reason: "the caller line is in the note's front matter; place writes below it" };
    // The caller's own words name the address, so a second run finds the region the first made though the line moved.
    const target = `here:${lines[here]!.trim()}`;
    if (mode === "upsert") {
      const mine = regions.find(r => r.anchor === outputAnchor(req.producer.id, target, label) && regionOfProducer(r, req.producer.id));
      if (mine) return replaceRegion(mine);
    }
    return placeAt(target, here, here, mode === "prepend" ? "before" : "after", undefined);
  }
  const matches = anchors.filter(a => a.id === wanted);
  if (matches.length !== 1) {
    const known = [...new Set([...anchors.map(a => a.id), ...(req.otherAnchors ?? [])])];
    const near = didYouMean(wanted, known);
    const reason = matches.length > 1
      ? `^${wanted} is on ${matches.length} lines of this note; an address must name one`
      : `^${wanted} isn't in this note${near.length ? `; did you mean ${near.map(n => `^${n}`).join(" or ")}?` : ""}`;
    return proposeAtCaller(reason, `^${wanted}`);
  }
  const anchor = matches[0]!;
  if (inFrontMatter(text, anchor.lineIndex) && anchor.kind !== "heading") return { ok: false, kind: "refused", reason: `^${wanted} is in the note's front matter; place writes below it` };
  const own = regions.find(r => r.anchor === wanted);

  // The address names an output region itself: this producer's can be replaced (or upserted); another's is never touched.
  if (own) {
    if (!regionOfProducer(own, req.producer.id)) return { ok: false, kind: "refused", reason: `^${wanted} is ${own.producer ? `another producer's region ((${own.producer}))` : "an output region with no producer"}; place only replaces its own` };
    if (mode === "append" || mode === "prepend") return placeAt(`^${wanted}`, own.startLine, own.endLine, mode === "prepend" ? "before" : "after", undefined);
    return replaceRegion(own);
  }
  if (mode === "replace") return { ok: false, kind: "refused", reason: `^${wanted} is ${KIND_WORDS[anchor.kind] ?? anchor.kind}; replace needs an output region; use upsert or append` };

  const slice = resolveFragmentSlice(text, wanted);
  if (slice.status !== "resolved") return proposeAtCaller(`^${wanted} can't be sliced`, `^${wanted}`);
  const { startLine, endLine } = slice.slice;
  if (mode === "upsert") {
    const regionAnchor = outputAnchor(req.producer.id, `^${wanted}`, label);
    const mine = regions.find(r => r.anchor === regionAnchor && regionOfProducer(r, req.producer.id));
    if (mine) return replaceRegion(mine);
    return placeAt(`^${wanted}`, startLine, endLine, "after", anchor);
  }
  return placeAt(`^${wanted}`, startLine, endLine, mode === "prepend" ? "before" : "after", anchor);

  function replaceRegion(r: OutputRegion): PlacePlan {
    const next = outputRegionText({ label, producer: req.producer.id, anchor: r.anchor!, body: req.content, ...(req.interpolate ? { interpolate: true } : {}) });
    const span: DraftPatchSpan = { observed: text.slice(r.start, r.end), range: { start: r.start, end: r.end }, replacement: next };
    if (r.edited || r.hash === undefined) {
      return { ok: false, kind: "proposal", anchor: r.anchor!, spans: [span], mark: markBelow(lines, r.endLine),
        reason: `${label}'s new output is proposed: the region was edited, so it is yours; apply it or dismiss it` };
    }
    return { ok: true, spans: [span], anchor: r.anchor!, created: false, mark: markBelow(lines, r.endLine), summary: `replaced ${label}'s region ^${r.anchor}` };
  }

  function placeAt(target: string, first: number, last: number, where: "after" | "before", at: FragmentAnchor | undefined): PlacePlan {
    let line = where === "before" ? first : last;
    // At a heading: prepend goes right after the heading line; append after the last output region directly under it.
    if (at?.kind === "heading") {
      line = at.lineIndex;
      where = "after";
      if (mode !== "prepend") {
        let cursor = at.lineIndex + 1;
        for (;;) {
          while (cursor < lines.length && !lines[cursor]!.trim()) cursor++;
          const next = regions.find(r => r.startLine === cursor);
          if (!next) break;
          line = next.endLine;
          cursor = next.endLine + 1;
        }
      }
    }
    // A component's standalone `^anchor` line sits under its closing `::`: output goes after it, so the anchor still names the component.
    if (where === "after" && at && at.kind !== "heading" && at.lineIndex > line && lines.slice(line + 1, at.lineIndex).every(l => !l.trim()) && lines[at.lineIndex]!.trim() === `^${at.id}`) line = at.lineIndex;
    const r = region(target);
    // A second append with the same producer at the same target would reuse the anchor: it stays unique by suffix.
    let anchorId = r.anchor, n = 1;
    while (regions.some(x => x.anchor === anchorId) || anchors.some(a => a.id === anchorId)) anchorId = `${r.anchor}-${++n}`;
    const text2 = anchorId === r.anchor ? r.text : outputRegionText({ label, producer: req.producer.id, anchor: anchorId, body: req.content, ...(req.interpolate ? { interpolate: true } : {}) });
    return { ok: true, spans: [insertion(lines, line, text2, where)], anchor: anchorId, created: true, mark: markBelow(lines, line),
      summary: `created ${label}'s region ^${anchorId} ${where === "before" ? "before" : "after"} ${target.startsWith("here") ? "the line that ran it" : target}` };
  }
}
