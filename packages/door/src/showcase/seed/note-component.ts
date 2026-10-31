// The showcase's "note component" section (note components): a render script's note is a component, called
// `::packet-shelf{where="…"}` in any note, its props from its `[form-field::]` chips; `::` completes it with `g` to its
// note, and a name no component has offers `+ new component`. Fictional: the seed packets are the showcase's own.
export const NOTE_COMPONENT_SCRIPT = [
  "Packet shelf [script::packet-shelf] [mode::render] [form-field::where query default=showcase-seed=yes]",
  "The packets a query holds, one badge each.",
  "",
  '::packet-shelf{where="showcase-seed=yes"}',
  "",
  "```js",
  "const found = await q(props.where[0]);",
  "return view.row({ children: found.blocks.map(b => view.badge({ label: b.title })) });",
  "```",
].join("\n");

export const NOTE_COMPONENT = [
  "A note component",
  "The Packet shelf script note is a component: the line below calls it with its where= prop, and what it returns draws under the line. Edit the script and every call redraws.",
  "",
  '::packet-shelf{where="showcase-seed=yes"}',
  "",
  "Press e and type ::pac on a new line: Packet shelf is offered under this outline's, g opens its note. Inside where=\" the query grammar completes. Type ::stale instead: the last row, + new component ::stale, writes a starter note under [[components]], puts ::stale{} on the line and opens the note beside (act: component.new name=stale).",
].join("\n");
