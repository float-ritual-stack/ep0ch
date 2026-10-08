import { resourceTextRevision } from "@ep0ch/outline-core/protocol";
import { resourceAnnotationRepresentation } from "./annotation-representations";
import { blockCommentSelection } from "./block-comments";
import type { ResourceDescription } from "./resources";
import type { AnnotationRepresentation, AnnotationTarget, BlockCommentPassage } from "./types";

/** The text of a Resource a comment can quote here, or null when it has none (a PDF's passages are Detail's: page regions). */
export function resourceCommentText(description: ResourceDescription): string | null {
  if (description.pdf) return null;
  return description.web?.markdown ?? description.filesystem?.text ?? null;
}

/**
 * What a Resource's text is now, as the service would anchor a comment or re-anchor its threads: its
 * representation and the text it hashes. Null when nothing is stored that a comment can quote (the file is gone
 * or moved, a ticket, a policy that denies reads).
 */
export function resourceCommentSource(description: ResourceDescription): { representation: AnnotationRepresentation; text: string } | null {
  const text = resourceCommentText(description);
  if (text === null) return null;
  const representation = resourceAnnotationRepresentation(description);
  return representation ? { representation, text } : null;
}

/** The target of a comment on a passage of a Resource's text, refused when the text is no longer the one the client read. */
export function resourceCommentTarget(
  source: { representation: AnnotationRepresentation; text: string },
  expectedRevision: number,
  passage?: BlockCommentPassage,
): Pick<AnnotationTarget, "representation" | "anchor" | "listItemId"> {
  const hash = source.representation.contentHash;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("Resource comment requires a positive expectedRevision");
  if (hash !== null && resourceTextRevision(hash) !== expectedRevision) {
    throw new Error("Comment source revision is stale; the Resource's text changed since it was read");
  }
  return { representation: source.representation, ...blockCommentSelection(source.text, passage) };
}
