// What Detail annotates when a person comments on a selection: a line range of a file as offsets, a PDF selection
// as its page regions, a filesystem Resource's representation, a rendered passage's target, the editor's selection
// as offsets, and an anchor's offset back as an editor point. The controller (detail-controller.ts) asks these when
// it begins a comment and when it reveals one; the anchors themselves are annotations.ts's.
import { findPassage, isMiss } from "@ep0ch/outline-core/passage";
import { annotationSourceHash, createPdfPageRegionAnchor, createTextQuoteAnchor } from "./annotations";
import type { DetailState } from "./detail-controller";
import type { ReferencedFile } from "./files";
import type { TextBuffer, TextBufferRange } from "./text-buffer";
import type {
  AnnotationAnchor,
  AnnotationRepresentation,
  AnnotationTarget,
  RenderedPassageObservation,
  RenderedPassageProjection,
  RenderedSelectionCapture,
  Resource,
  ResourceDescription,
} from "./types";

export function annotationOffsetsForLineRange(
  text: string,
  startLine: number,
  endLine: number,
): { start: number; end: number } {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  const start = starts[startLine - 1];
  if (start === undefined || endLine < startLine) {
    throw new Error("Annotation line range is outside the file");
  }
  const next = starts[endLine];
  let end = next === undefined ? text.length : next - 1;
  if (end > start && text.charCodeAt(end - 1) === 13) end -= 1;
  if (end <= start) throw new Error("Annotation line range must contain text");
  return { start, end };
}

export function pdfAnnotationAnchor(
  description: ResourceDescription,
  start: number,
  end: number,
): Extract<AnnotationAnchor, { kind: "pdf-page-region" }> {
  const pdf = description.pdf;
  if (!pdf) throw new Error("PDF representation is unavailable");
  const page = pdf.pages.find((candidate) =>
    start >= candidate.start && end <= candidate.end
  );
  if (!page) throw new Error("PDF annotations must stay within one extracted page");
  const regions = page.spans
    .filter((span) => span.end > start && span.start < end)
    .map(({ region }) => region);
  if (regions.length === 0) {
    throw new Error("PDF selection has no durable page region");
  }
  return createPdfPageRegionAnchor(pdf.markdown, start, end, page.page, regions);
}

export function filesystemAnnotationRepresentation(
  resource: Resource,
  file: ReferencedFile,
): AnnotationRepresentation {
  if (resource.provider !== "filesystem") {
    throw new Error("Filesystem annotation requires a filesystem Resource");
  }
  const sourceText = file.sourceText ?? file.lines.join("\n");
  const contentHash = file.sourceHash ?? annotationSourceHash(sourceText);
  const revisionParts = file.sourceVersion?.split(":");
  const revision = revisionParts?.length === 3 &&
      revisionParts.slice(0, 2).every((part) => /^\d+$/.test(part)) &&
      /^[0-9a-f]{64}$/.test(revisionParts[2]!)
    ? {
        resourceId: resource.id,
        addressVersion: resource.addressVersion,
        revision: {
          kind: "filesystem" as const,
          mtimeNs: revisionParts[0]!,
          size: revisionParts[1]!,
          contentHash: revisionParts[2]!,
        },
      }
    : null;
  return {
    id: `filesystem:${resource.id}:${file.sourceVersion ?? contentHash}:${contentHash}`,
    subject: { kind: "resource", resourceId: resource.id },
    sourceSnapshot: {
      kind: "resource",
      resourceId: resource.id,
      sourceSnapshotId: null,
      revision,
    },
    adapter: { id: "filesystem.text", version: 1 },
    mediaType: resource.mediaType ?? "text/plain",
    contentHash,
    capturedAt: file.capturedAt ?? "1970-01-01T00:00:00.000Z",
  };
}

export function renderedSelectionAnnotationTarget(
  state: Pick<
    DetailState,
    "context" | "resolvedSelectedText" | "projectedSelectedText"
  >,
  capture: RenderedSelectionCapture,
): AnnotationTarget {
  const selected = state.context.selected;
  if (!selected) throw new Error("No block is open in this Detail");
  if (selected.id !== capture.hostBlockId) {
    throw new Error("The Detail target changed after the rendered selection was captured");
  }
  const projected = state.projectedSelectedText !== selected.text;
  const resolved = state.resolvedSelectedText !== state.projectedSelectedText;
  const projection: RenderedPassageProjection = projected && resolved
    ? "mixed"
    : projected
      ? "generated"
      : resolved
        ? "resolved"
        : "canonical";
  const { snapshotText, passage, ...evidence } = capture;
  const observation: RenderedPassageObservation = { ...evidence, projection };
  // The one quote lookup (outline-core passage.ts, ADR 0004 contract 5): placed only when the words are there once.
  const found = passage ? null : findPassage(snapshotText, capture.quote);
  const match = found && !isMiss(found) ? found.start : -1;
  const unique = match >= 0;
  const contentHash = annotationSourceHash(snapshotText);
  return {
    ...(passage ? {passage} : {}),
    representation: {
      id: `rendered:${capture.hostBlockId}:${capture.paneId}:${capture.contentRevision}:${contentHash}${passage ? `:${capture.detailClientId}` : ""}`,
      subject: { kind: "block", blockId: selected.id },
      sourceSnapshot: { kind: "rendered", observation },
      adapter: { id: passage ? "outliner.document-frame" : "herdr.rendered-passage", version: 1 },
      mediaType: "text/plain",
      contentHash,
      capturedAt: capture.capturedAt,
      observation,
    },
    anchor: unique
      ? createTextQuoteAnchor(snapshotText, match, match + capture.quote.length)
      : {
          kind: "text-quote",
          start: null,
          end: null,
          exact: capture.quote,
          prefix: "",
          suffix: "",
        },
  };
}

function textRangeOffsets(
  text: string,
  range: TextBufferRange,
): { start: number; end: number } | null {
  const lines = text.split("\n");
  const offset = ({ row, column }: TextBufferRange["start"]): number | null => {
    const line = lines[row];
    if (line === undefined || column < 0 || column > line.length) return null;
    let total = column;
    for (let index = 0; index < row; index += 1) total += lines[index]!.length + 1;
    return total;
  };
  const anchor = offset(range.start);
  const focus = offset(range.end);
  if (anchor === null || focus === null || anchor === focus) return null;
  return anchor < focus
    ? { start: anchor, end: focus }
    : { start: focus, end: anchor };
}

export function detailBufferRangeOffsets(buffer: Readonly<TextBuffer>): { start: number; end: number } | null {
  const range = buffer.selectionRange;
  return range ? textRangeOffsets(buffer.text, range) : null;
}
export function detailBufferPointAtOffset(text: string, offset: number): { row: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, clamped);
  const lines = before.split("\n");
  return { row: lines.length - 1, column: lines[lines.length - 1]!.length };
}
