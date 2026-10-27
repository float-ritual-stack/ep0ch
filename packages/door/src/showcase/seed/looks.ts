// The showcase seed's looks (split out of seed.ts): its notes' text and fixtures. Exported through ../seed.ts as before.
import { readFileSync } from "node:fs";
import { SEED } from "./names";
import { SHOWCASE_ASSETS } from "./media";

/** The outline's own style, the seed order's, declared on a line of the note as a person writes one: dots, two rows, left, on the top row, green. */
export const HEADING_STYLE_LINE = "# Plot style [heading-style::plot] [heading-pattern::dots] [heading-rows::2] [heading-align::left] [heading-row::top] [heading-tone::green]";

/**
 * Heading styles (PIE-599): the three ways to write one, each working. A style named on a heading (every built-in
 * pattern, alignment and row), one heading's own fields (`[heading-tone::amber]` over its style, and fields alone over
 * the base style), and a style the outline declares on a line of this note (the seed order's), so the look changes
 * with no door change; a styled rule, a plain one and a plain heading; each with a body to fold.
 */
/**
 * The style section's page (PIE-673): drawn by the named style the Looks lab note declares ([style::lab]): a paragraph
 * long enough to wrap at any width, a list for the gap and dividers, and a box with a look of its own.
 */
export const SPACING_LAB = [
  `${SEED.spacingLab} [page::${SEED.spacingLab}] [style::lab] [crop::beans]`,
  "This page is drawn by the lab style, which the Looks lab note declares: its measure holds the text to 64 columns, centred in a wide tile, its padding keeps it off the frame, and its list has a blank row and a dotted line between items. Nudge any value in the tune inspector under it and the page moves in the next frame; s writes it to the level you pick, and every door on the outline draws it.",
  "",
  "## Seed trays",
  "- Tomatoes on the warm shelf, the ones from [[Headings and dividers]]",
  "- Chillies in the propagator",
  "- Basil by the kitchen window",
  "- Peppers, pricked out in May",
  "",
  "## Hardy ones [style.list.gap::0] [style.list.divider::none]",
  "This list is tight: its own heading says so (this list), whatever the lab style gives the page's other lists.",
  "- Kale",
  "- Leeks",
  "",
  "::box{list.gap=0 list.zebra list.zebra.bg=green list.zebra.strength=4 margin.x=4 edge=bar tone=green}",
  "Live **{{this.crop}}** from [[Headings and dividers]]: the same note inside a box.",
  "- Leeks",
  "- Onion sets",
  "- Garlic",
  "::",
  "",
  "::box{bg=sunken border=round tone=amber pad=1 list.gap=2 list.divider=glyph list.divider.glyph=✦}",
  "A sunken box in an amber frame. Its list's divider is a glyph of its own, centred in the gap.",
  "- Broad beans",
  "- Runner beans",
  "::",
  "",
  "## The header's picture",
  "This page's header picture is the line below, wherever it's written: `[layout::hero]` makes it the header and `[hero-focus::0.5,0.35]` keeps a point a little higher than its middle. Scroll it up under the title: the header takes it as its backdrop, its own violet surface yielding to it. The whole header shares one band with a violet rule beneath its last row. The tune's Hero rows (alt+y) edit this line.",
  `[img::${SHOWCASE_ASSETS}/evening-beds.jpg] [layout::hero] [hero-focus::0.5,0.35] [alt::the beds at dusk, the shed lit]`,
  "",
  "## The published look",
  "[[Garden dispatch]] uses `[publish-skin::dispatch]` on the web: dark phosphor, a masthead and newsprint rules over the same publisher HTML. [[skins/dispatch]] holds its CSS. A child inherits the skin; its own publish-skin selects another. The terminal keeps its own look.",
  "",
  "Tune groups follow the cascade declarations. Enter or a click folds a heading, kept for you; f filters to values set at the chosen level.",
  "The end of the lab.",
].join("\n");

/** The style section's declaration: the named style the Spacing lab page uses, edited in place to restyle it live. */
export const LOOKS_LAB = [
  `${SEED.looksLab} [style-for::lab] [style.measure::64] [style.pad::1] [style.list.gap::1] [style.list.divider::dots] [style.narrow.list.gap::0] [style.bg::raised] [style.edge::bar] [style.tone::violet] [style.header.bg::violet] [style.header.bg.opacity::40] [style.header.rule::line] [style.header.rule.tone::violet]`,
  "This note declares the lab style, which [[Spacing lab]] uses. Its fields are the look: e here, change a value, ctrl+s, and every reader of that page restyles at once, in every door on the outline. Under 60 columns (narrow) the lab drops its list gap.",
  "",
  "Surfaces are theme roles, never colours: raised, sunken or a tone (blue, green, violet, amber, coral, neutral), each drawn dark in every theme. The lab tile sits on a raised surface with a violet bar down its side; its whole header on violet at 40% with a violet bottom rule, taking the beds picture once it scrolls under, the crop moved up 15%.",
  "",
  "A tile kind has its own: `[style-for::tile:backlinks] [style.list.zebra::on]` on any line would stripe every links tile.",
].join("\n");

export const HEADINGS = [
  `${SEED.headings} [page::${SEED.headings}]`,
  "A heading keeps its Markdown; a style draws it inside a band. Name a style, give one heading its own fields, or declare a style on any line. Narrow, it is the heading's words alone.",
  "",
  HEADING_STYLE_LINE,
  "",
  "# Your calls [heading::band]",
  "The ones only you can make this week.",
  "",
  "## The plot [heading::tab]",
  "Four raised beds, one left fallow.",
  "",
  "## Beds [heading::waffle]",
  "Leeks, then the brassicas under netting.",
  "",
  "### Water butts [heading::uptime]",
  "Two full, one leaking at the tap.",
  "",
  "--- [rule::fade]",
  "",
  "## Seed order [heading::plot]",
  "Peas, broad beans and the climbing French beans.",
  "",
  "## Compost [heading::rule]",
  "Turn the left bay in April.",
  "",
  "## Odd jobs [heading::dots] [heading-tone::amber]",
  "Oil the shed hinge.",
  "",
  "## Greenhouse [heading::waffle] [heading-margin::2 0 1]",
  "Its heading-margin is 2 0 1: two blank rows above the band, no columns, one below.",
  "",
  "## Tool shed [heading-pattern::uptime] [heading-rows::1] [heading-align::right]",
  "The spade, the fork, the good trowel.",
  "",
  "---",
  "",
  "A plain rule above, and a plain heading below.",
  "",
  "## Plain",
  "As Markdown writes it.",
  "",
  "::graph-check",
  "- [ ] Order the seed trays for the raised beds before the first frost comes in",
  "::",
  "",
  "",
  "## A plain heading long enough to wrap in the narrow reader",
  "Wrapped whole under its words, never cut.",
  "",
  "::graph-table", "---", "headers: [Job, Who]", "rows:", "  - [SHED-4 / oil the hinge and the padlock on the shed door, Sam]", "---", "::",
].join("\n");

export const DISPATCH_SKIN = [
  "Dispatch skin [page::skins/dispatch] [publish::public]",
  "```css",
  readFileSync(new URL("../assets/skins/dispatch.css", import.meta.url), "utf8"),
  "```",
].join("\n");

/**
 * Retired look keys (PIE-1365): a page written before PIE-1361, its header picture and look still as `style.header.image…`
 * properties, which draw nothing now. The tune beside it lists them in one line with the fix: [remove], or [move to a
 * hero line], which writes the picture as this note's hero line with the look moved over (the wide-only blur has no
 * place there, and says so).
 */
export const OLD_LOOK = [
  `${SEED.oldLook} [style.header.image::${SHOWCASE_ASSETS}/allotment-dusk.jpg] [style.header.image.y::-15] [style.header.image.tint::0.5] [style.header.image.fade::0.75] [style.header.title::over] [style.wide.header.image.blur::4]`,
  "Written before a header picture was the note's own line: its picture and look are properties of the page, and draw nothing now.",
  "",
  "The tune beside it says so in one line, with the fix: remove takes the keys off; move writes the picture as this note's hero line with the look moved over. u in the tune takes either back.",
].join("\n");

export const SINGLE_LIST = [
  SEED.singleList + " [style.list.gap::0] [style.list.divider::none] [style.list.zebra::off]",
  "Press the middle list's button to style it and save.",
  "## Supplies",
  "",
  "- First oats",
  "- First rice",
  "",
  "Middle supplies.",
  "",
  "- Middle beans [Style the middle list](act:style-middle-list)",
  "- Middle peas",
  "",
  "Last supplies.",
  "",
  "- Last mint",
  "- Last sage",
].join("\n");

export const STYLE_MIDDLE_LIST = [
  "Style the middle list [script::style-middle-list] [effects::write] [results::keep]",
  "```js",
  "await act('tune.level', { level: 'list', tile: 'tune' });",
  "for (const [row, value] of [['list.gap', '2'], ['list.divider', 'dots'], ['list.zebra', 'on']]) await act('tune.set', { row, value, level: 'list', tile: 'tune' });",
  "await act('tune.save', { level: 'list', tile: 'tune' });",
  "return 'Only the middle list has gaps, dividers and stripes. Reopen the note to see them kept.';",
  "```",
].join("\n");
