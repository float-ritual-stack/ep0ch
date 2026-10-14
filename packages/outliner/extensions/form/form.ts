// Form: one action that serves every note that writes its own form (PIE-828). The note says its fields as
// `[form-field::<name> <type> …]` chips; the service reads them, the door asks for them (the power bar, one at a time)
// and checks the answers as it checks declared arguments, then this writes one entry under the note, each answer a
// property. It imports nothing from the outline's code: the service tells it the note's fields (`input.fields`).
const request = (await Bun.stdin.json()) as { operation: string; input: any };
const say = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));

/** A value as a property's: one line, no bracket that would close the chip early. */
const chipValue = (value: string) => value.replace(/\s+/g, " ").replace(/[\[\]]/g, "").trim();

function act() {
  const { args = {}, fields = [], target } = request.input as { args?: Record<string, string>; fields?: { name: string; type: string }[]; target?: { blockId?: string } };
  if (!target?.blockId) return say({ message: "refused: this fills in the form of a note (block=<id>)" });
  const answered = fields.filter((field) => (args[field.name] ?? "").trim());
  if (!answered.length) return say({ message: "nothing to write: every field was left empty" });
  // The entry's title is its first text answer, else the first answer; every answer is a chip on it.
  const lead = answered.find((field) => field.type === "text") ?? answered[0]!;
  const title = chipValue(args[lead.name]!);
  const chips = answered.map((field) => `[${field.name}::${chipValue(args[field.name]!)}]`).join(" ");
  return say({ message: `wrote ${title}`, writes: [{ op: "create", parentId: target.blockId, text: `${title} ${chips}` }] });
}

if (request.operation === "act") act();
else say({ message: `no ${request.operation}` });
