// The showcase seed's "Notes that read themselves" (PIE-533 S2): the design's fixture note, with the notes its
// placeholders read from. Fictional. A later slice adds `::fields`, `::if` and a copied figure to the fixture's end.
import { SEED } from "./names";

/** A note a placeholder reads through a `[[page]]`: a person with a first name. */
export const VENT_PERSON = `${SEED.ventPerson} [page::${SEED.ventPerson}] [firstName::Ada] [lastName::Marsh]`;

/** A note a `((id))` placeholder reads: a recipe with the question it asks. */
export const VENT_RECIPE = `${SEED.ventRecipe} [query::type=chore stage=todo] [machine::shed]`;

/** The parent, whose `[project::…]` the fixture reads as `{{parent.project}}`. */
export const VENT_PROJECT = `${SEED.ventProject} [project::spring-sowing]`;

/** The fixture note: every head of the first rows of the design's table, and one typo for the did-you-mean. */
export function ventRailText(recipeId: string): string {
  return [
    `${SEED.ventRail} [target::https://example.test/vent] [status::active] [guide::${SEED.ventPerson}] [owner::Ada] [person::[[${SEED.ventPerson}]]] [recipe::((${recipeId}))]`,
    "",
    "Play it at {{this.target}}. Owner: {{this.owner}}, status {{this.status}}.",
    `Its project is {{parent.project}}. The guide is {{person.firstName}} {{person.lastName}}, reached through the person link.`,
    `The recipe asks {{((${recipeId})).query}}; by page, {{[[${SEED.ventPerson}]].firstName}} is the first name.`,
    "A typo: {{this.ownr}}. A fallback: {{this.crew || nobody yet}}.",
    "Open [[{{this.guide}}]]; the paragraph mark beside it opens the line its value reads.",
    "- first pass [connectTo::demonstrating by doing]",
    "- second pass [connectTo::shacks not cathedrals]",
  ].join("\n");
}
