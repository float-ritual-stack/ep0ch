// The outline's heading styles in the door (PIE-599): outline-core's built-ins plus what the outline declares
// (`headings.styles`), kept per connection as the callout types are (src/outline-lists.ts). The reader draws a styled
// heading or rule (`## Your calls [heading::band]`, `--- [rule::fade]`) by them.
import { BUILTIN_HEADING_STYLE_REGISTRY, headingStyleRegistry, type HeadingStyle, type HeadingStyleRegistry } from "@ep0ch/outline-core/heading-styles";
import { outlineList } from "./outline-lists";

type HeadingBoard = { headingStyles?: () => Promise<{ styles: HeadingStyle[]; problems: string[] }> };

const HEADINGS = outlineList<HeadingStyle, HeadingStyleRegistry>(
  (b: HeadingBoard) => (typeof b.headingStyles === "function" ? () => b.headingStyles!().then(r => ({ items: r.styles, problems: r.problems })) : undefined),
  headingStyleRegistry, BUILTIN_HEADING_STYLE_REGISTRY,
);

/** The outline's heading styles for this connection: the built-ins until (and unless) the service answers. */
export const headingStylesOf = HEADINGS.of;
/** Which answer `headingStylesOf` gives now, for a reader's layout cache. */
export const headingStylesStamp = HEADINGS.stamp;
/** What's wrong with the outline's heading-style declarations, as the service last said. */
export const headingStyleProblems = HEADINGS.problems;
