// Fictional notes whose code the service and every client must find in the same place: the property parser and
// the door's reader run these same notes (outliner test/literal-regions.test.ts, door test/code-fences.test.ts).

/** A tilde fence: inside it `**bold**`, `[key::value]` and a hashtag are code; a backtick run doesn't close it. */
export const TILDE_FENCE_NOTE = [
  "Potting bench",
  "",
  "Before the fence, [shelf::top] is a property.",
  "~~~text",
  "**not bold** and [crate::7] are code, as is #compost",
  "```",
  "still code [lid::open]",
  "~~~",
  "After it, [shelf::low] is a property again.",
].join("\n");

/** Its lines inside the fence, opening and closing lines included. */
export const TILDE_FENCE_LINES = [3, 4, 5, 6, 7];

/** The properties the service reads in it, in order: none from the fence. */
export const TILDE_FENCE_PROPERTIES = [["shelf", "top"], ["shelf", "low"]];

/** A fence of four backticks: a shorter run inside is its text, and only four or more close it. */
export const LONG_FENCE_NOTE = [
  "Seed tray labels",
  "````md",
  "```",
  "[tray::3] stays text",
  "```",
  "````",
  "Then [tray::4] is read.",
].join("\n");

/** Its lines inside the fence. */
export const LONG_FENCE_LINES = [1, 2, 3, 4, 5];

/** The properties the service reads in it. */
export const LONG_FENCE_PROPERTIES = [["tray", "4"]];

/** A fence nested under a bullet, four columns in: code in the list item, as CommonMark (and Detail) read it. */
export const LIST_FENCE_NOTE = [
  "Watering rota",
  "- Water the beans",
  "    ```sh",
  "    [can::2] stays text",
  "    ```",
  "- Then fill [can::3] cans",
].join("\n");

/** Its lines inside the fence. */
export const LIST_FENCE_LINES = [2, 3, 4];

/** The properties the service reads in it. */
export const LIST_FENCE_PROPERTIES = [["can", "3"]];

// ── code is opaque (PIE-764) ──────────────────────────────────────────────────────────────────────────────────

/** The note a reference in a code span names, and one that names nothing: fictional ids. */
export const QUOTED_TARGET_ID = "5f0c2a8e-4b1d-4e7a-9c3f-2d6e8b1a7c40";

/**
 * kitty's request (PIE-764), as written: prose that explains the link form inside backticks. Neither quoted form is a
 * reference; the real one at the end is.
 */
export const KITTY_REQUEST_NOTE = [
  "A reference written inside a code span is still parsed as a link, so an example like `((note^anchor|label))` shows up unresolved in the links tile [type::request] [thread::requests]",
  "Seen on the meeting-review screen: the links list showed two entries reading \"at 08:17\", both from prose that explained the link form inside backticks (`((transcript^anchor|at 08:17))` and `((transcript-id^t0817|at 08:17))`).",
  "",
  "Why it matters: if a code span doesn't shield `((`, `[[` or `[key::value]`, every explanation of the syntax becomes a false link, a false property or a false warning.",
  `The real one: ((${QUOTED_TARGET_ID}|meeting notes)).`,
].join("\n");

/** A fence holding every link form and a property: all text. */
export const FENCED_LINKS_NOTE = [
  "Link forms [type::guide]",
  "```blockdown",
  "[[x]] and ((transcript-id^t0817|at 08:17)) and !((transcript-id)) [status::fake]",
  "```",
  "After it, [[Garden]] is a page link.",
].join("\n");

/**
 * An unclosed backtick before a property line. CommonMark: an unclosed run is text, and a span never crosses a line
 * here, so the stray backtick hides nothing, neither the next line's properties nor its own line's.
 */
export const STRAY_BACKTICK_NOTE = [
  "Quote cut mid-span: `columns: [title, tl… [type::annotation]",
  "[anchor::passage] [status::open]",
  "A later `code` span and [[Garden]].",
].join("\n");
