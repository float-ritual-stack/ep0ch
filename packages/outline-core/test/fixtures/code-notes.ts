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
