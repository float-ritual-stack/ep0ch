// ep0ch-script effects=write
// Changes one property of one note, the way a lens cell's press asks: `lens-set note=<id> key=status value=done`,
// or `next=1` to step to the next value (the choices given, else every value that key has in the outline, then
// unset). One attributed, undoable write of the note's first line; an agent runs the same line.

const note = props.note?.[0], key = props.key?.[0];
if (!note || !key) throw new Error("lens-set needs note=<id> key=<property> and value=… (or next=1 to step through the key's values)");
const record = await read(note);
const current = record.properties.find(p => p.key === key)?.values[0] ?? "";
let value = props.value?.[0];
if (props.next?.[0]) {
  let choices = (props.choices?.[0] ?? "").split("|").map(s => s.trim()).filter(Boolean);
  if (!choices.length) {
    const seen = await q(key, { limit: 200, properties: true });
    choices = [...new Set((seen.blocks ?? []).flatMap(b => (b.properties ?? []).find(p => p.key === key)?.values ?? []))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  if (!choices.length) throw new Error(`nothing has a ${key} yet: give value=… the first time, or choices=a|b|c`);
  const ring = [...choices, ""];
  value = ring[(ring.indexOf(current) + 1) % ring.length];
}
if (value === undefined) throw new Error("lens-set needs value=… or next=1");
await tools.outline_set_property({ ref: record.id, revision: record.revision, properties: { [key]: value === "" ? null : value } });
return `${record.title}: ${key} ${current || "(unset)"} → ${value || "(unset)"}`;
