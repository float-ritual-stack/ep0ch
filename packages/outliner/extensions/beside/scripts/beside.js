// ep0ch-script mode=render
// Beside: a card of facts about one note, drawn for the surface this extension attaches beside a reader (its
// `attachments[]` names this script) and for a `beside:: note=<id>` line. The note beside it arrives as props.note.

const id = props.note?.[0];
if (!id) return "No note is beside this card.";
const note = await read(id);
if (!note || note.problem) return `That note can't be read${note?.problem ? `: ${note.problem}` : "."}`;

const properties = (note.properties ?? []).filter(p => !p.key.startsWith("_"));
const under = (note.children ?? []).length;

const lines = [
  note.title ?? id,
  "",
  `${under} ${under === 1 ? "note sits" : "notes sit"} under it`,
  properties.length ? `${properties.length} ${properties.length === 1 ? "property" : "properties"}:` : "no properties",
  ...properties.map(p => `- ${p.key}: ${(p.values ?? []).join(", ")}`),
];
return lines.join("\n");
