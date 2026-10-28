// The schema of `::button` (PIE-957, S7): a labelled press in a note that runs an action line as the person. One schema in
// its own file, registered by one line in component-schema.ts. The line's grammar is button-call.ts; the door draws it
// and runs the press through its one dispatcher. Pure: no I/O; types only from component-schema.ts.
import type { ComponentSchema } from "./component-schema";
import { enumOf } from "./prop-values";

export const BUTTON: ComponentSchema = {
  id: "button", group: "controls",
  title: "Button (::button)",
  intro: 'One press runs a sequence in order: write ::button{label="Fold the bottom"}, one action or ((script)) per line, then ::. Acts tap the current value; scripts receive input and replace it with their return, including undefined. act=["action one", "action two"] and of=[script1, script2] are the same steps on one line. One undo group covers reversible effects. The first failure stops the sequence and reports completed steps and effects that remain; Sources shows inputs, outputs and action answers. A single act="action line" or of=script with slots still works. Published buttons are inert.',
  where: "a closed ::button{...} body, or one line with act= / of=",

  props: [
    { key: "label", where: "line", type: "text", meaning: "what the button says; the script's or action's name when left out", samples: ["Review", "Play 5"] },
    { key: "act", where: "line", type: "action", meaning: "an action line, or a comma-separated list of quoted action lines; the power bar grammar", samples: ["layout.load name=review", "ttt-move at=5"] },
    { key: "alt", where: "line", type: "action", meaning: "the action line an alt+click runs; belongs to the button, never a script slot", samples: ["theme.cycle"] },
    { key: "glyph", where: "line", type: "text", meaning: "one character drawn before the label; a press's state takes its place while it runs, after it ends and when it can't run", samples: ["▶", "⟳", "✕"] },
    { key: "tone", where: "line", type: "enum", values: enumOf({ quiet: "the link colour, for most buttons", primary: "the one to press, brighter", danger: "a press that removes or can't be undone" }), meaning: "the theme role it is drawn in (quiet)", samples: ["primary", "danger"] },
    { key: "frame", where: "line", type: "enum", values: enumOf({ none: "one row: [label], or a filled band with fill=on", box: "a thin square frame", round: "a thin frame with round corners", heavy: "a thick frame", double: "a double-line frame" }), meaning: "a frame of the box glyphs, three rows high; none (the default) is one row", samples: ["round", "heavy"] },
    { key: "fill", where: "line", type: "enum", values: enumOf({ on: "the tone as background", off: "the tone as text only" }), meaning: "the tone as its background: with frame=none a filled band (off)", samples: ["on"] },
    { key: "of", where: "line", type: "script", meaning: "a script or comma-separated list of scripts to pipe, in place of act=; every word except label, act and alt on the line is its slot (`at=5` is props.at)", samples: ["fantasia", "ttt-move"] },
  ],
  source: { use: '::button{label="Fold the bottom"}\ntile.collapse on=true tile=links\ntile.collapse on=true tile=preview\n::' }, example: {}, sweep: [], grids: [], space: [],
};
