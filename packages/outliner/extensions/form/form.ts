// Form: one action that serves every note that writes its own form (PIE-828). The note says its fields as
// `[form-field::<name> <type> …]` chips; the service reads them, the door asks for them (the power bar, one at a time)
// and checks the answers as it checks declared arguments, then this writes one entry under the note, each answer a
// property. It imports nothing from the outline's code: the service tells it the note's fields (`input.fields`).
const request = (await Bun.stdin.json()) as { operation: string; input: any };
const say = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));

/** Whether an answer can be a property's value as written: one line, its brackets balanced (`[[page]]`, `a[0]`). */
function chipSafe(value: string): boolean {
  if (/[\r\n]/.test(value)) return false;
  let depth = 0;
  for (const c of value) {
    if (c === "[") depth++;
    else if (c === "]" && --depth < 0) return false;
  }
  return depth === 0;
}

function act() {
  const { args = {}, fields = [], target } = request.input as { args?: Record<string, string>; fields?: { name: string; type: string }[]; target?: { blockId?: string } };
  if (!target?.blockId) return say({ message: "refused: this fills in the form of a note (block=<id>)" });
  const answer = (name: string) => (Object.hasOwn(args, name) ? args[name]!.trim() : "");
  const answered = fields.filter((field) => answer(field.name));
  if (!answered.length) return say({ message: "nothing to write: every field was left empty" });
  // Every answer is a chip on the entry, as written; one that can't be a chip (a line break, a lone bracket) is kept
  // whole in the entry's body instead, in a literal region, so nothing typed is lost or read as a property.
  const chips = answered.filter((field) => chipSafe(answer(field.name)));
  const kept = answered.filter((field) => !chipSafe(answer(field.name)));
  // The title is the first text answer that is a chip, else the first chip, else "Entry".
  const lead = chips.find((field) => field.type === "text") ?? chips[0];
  const title = lead ? answer(lead.name) : "Entry";
  const text = [`${title} ${chips.map((field) => `[${field.name}::${answer(field.name)}]`).join(" ")}`.trim(),
    ...(kept.length ? ["", "<!-- literal -->", ...kept.flatMap((field) => [`${field.name}:`, answer(field.name)]), "<!-- /literal -->"] : [])].join("\n");
  return say({ message: `wrote ${title}`, writes: [{ op: "create", parentId: target.blockId, text }] });
}

if (request.operation === "act") act();
else say({ message: `no ${request.operation}` });
