// The schema of `::button` (PIE-957, S7): a labelled press in a note that runs an action line as the person. One schema in
// its own file, registered by one line in component-schema.ts. The line's grammar is button-call.ts; the door draws it
// and runs the press through its one dispatcher. Pure: no I/O; types only from component-schema.ts.
import type { ComponentSchema } from "./component-schema";

export const BUTTON: ComponentSchema = {
  id: "button", group: "controls",
  title: "Button (::button)",
  intro: "A button written into a note: `::button{label=\"Review\" act=\"layout.load name=review\"}` runs one action line, or `::button{label=\"Fantasia\" of=fantasia layout=focus}` runs a script with its slots. A press goes through the door's one dispatcher as you (the status line shows what it runs before you press; an action that writes asks once more), and the run records you as who asked and the button's author. On a published or shared page a button is inert: readers read.",
  where: "a line of a note: `::button{…}` with its attributes in the braces",
  props: [
    { key: "label", where: "line", type: "text", meaning: "what the button says; the script's or action's name when left out", samples: ["Review", "Play 5"] },
    { key: "act", where: "line", type: "action", meaning: "the action line a press runs, as the power bar takes it", samples: ["layout.load name=review", "ttt-move at=5"] },
    { key: "of", where: "line", type: "ref", meaning: "a script to run, in place of act=; every other word on the line is its slot (`at=5` is props.at)", samples: ["fantasia", "ttt-move"] },
  ],
  source: { use: "::button{label=\"Review\" act=\"layout.load name=review\"}" }, example: {}, sweep: [], grids: [], space: [],
};
