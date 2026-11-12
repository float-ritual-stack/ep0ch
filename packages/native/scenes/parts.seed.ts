// The made-up note the `parts` scene opens: figures, a box, a live list and two buttons, written into a scratch
// outline (never a real one: the socket is a scratch host's, named outright).
//   bun scenes/parts.seed.ts <a scratch host's socket> <outline>
import { OutlinerClient } from "../../outliner/src/client";

const [socket, outline] = process.argv.slice(2);
if (!socket || !outline) throw new Error("usage: bun scenes/parts.seed.ts <a scratch host's socket> <outline>");
const client = new OutlinerClient(socket, 20_000);
const create = (text: string, parentId?: string) => client.request<{ id: string }>({ action: "create", outline, text, author: "user", ...(parentId ? { parentId } : {}) });

const plan = await create([
  "Bed plan [type::plan] [season::spring]",
  "Four beds this year. The cold frame goes in first.",
  "",
  "::button{label=\"Fold the side away\" act=\"dock.toggle side=right\"}",
  "",
  "::button{label=\"Sow the peas\" tone=primary}",
  "note.new text=Peas",
  "::",
  "",
  "::graph-stat",
  "- beds: 4",
  "- **sown**: 3",
  "- trays: 12",
  "::",
  "",
  "::box{pad.x=1}",
  "What is left before the frost lifts:",
  "::graph-check",
  "- [x] Dig the north bed",
  "- [x] Mend the net",
  "- [ ] Sow the peas — after the frost",
  "::",
  "::graph-meter",
  "---",
  "title: Water butt",
  "value: 0.6",
  "---",
  "::",
  "::",
  "",
  "::graph-rank",
  "---",
  "title: Seed packets",
  "---",
  "- beans: 12",
  "- **peas**: 9",
  "- *kale*: 2",
  "::",
  "",
  "::links{query=\"type=bed\" title=\"The beds\"}",
  "::",
].join("\n"));
for (const bed of ["North bed [type::bed] [crop::peas]", "South bed [type::bed] [crop::beans]", "Cold frame [type::bed] [crop::kale]"]) await create(bed, plan.id);
// The note the `links` scene opens: a `::links` of every group a note has (what it links to, what links to it, what
// is under it), so a list on a page and the links tile beside it show the same rows under the same headers.
const shed = await create(["Potting shed [type::place]", `Where the trays wait. The ((${plan.id})) says what goes in them.`, "", "::links", "::"].join("\n"));
for (const tray of ["Pea trays [type::tray]", "Kale trays [type::tray]"]) await create(tray, shed.id);
await create(`Frost watch\nCover what is in the ((${shed.id})) on a cold night.`);
// The note the `draft` scene opens to be written: two paragraphs, so an agent's tidy of the first lands in the draft
// while the person types in the second.
await create(["Frost fleece [type::chore]", "Cover the pea trays  on a cold  night.", "", "Fold it away in the morning."].join("\n"));
console.log(plan.id);
process.exit(0);
