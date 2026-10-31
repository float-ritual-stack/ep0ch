import type { PropertyMatch } from "./protocol";
import { statusWord } from "./checklist-marks";

/** A line match opens where the property was written, rather than at the note's header. */
export const bodyMatch = (block: { propertyMatches?: PropertyMatch[] }): PropertyMatch | undefined => block.propertyMatches?.find(match => match.scope !== "block");

export const matchWords = (match: PropertyMatch, withValue = true) =>
  `line ${match.line + 1}${match.task ? ` ${statusWord(match.task)}` : ""} ${match.key}${withValue ? `: ${match.value}` : ""}`;
