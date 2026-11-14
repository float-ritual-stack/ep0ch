// The made-up notes the `cursor` scene moves through by key: an allotment's beds, a bed with rows under it, a shed.
// Written into a scratch outline (never a real one: the socket is a scratch host's, named outright), after the
// notes a new outline starts with, so the scene finds the beds fourth from the end of the tree.
//   bun scenes/cursor.seed.ts <a scratch host's socket> <outline>
import { OutlinerClient } from "../../outliner/src/client";

const [socket, outline] = process.argv.slice(2);
if (!socket || !outline) throw new Error("usage: bun scenes/cursor.seed.ts <a scratch host's socket> <outline>");
const client = new OutlinerClient(socket, 20_000);
const create = (text: string, parentId?: string) => client.request<{ id: string }>({ action: "create", outline, text, author: "user", ...(parentId ? { parentId } : {}) });
const beds = await create("Beds [type::plan] [season::spring]\n\nFour beds this year. The cold frame goes in first, then the peas along the fence.\n\n## Sowing\n\n- Peas in March\n- Beans in May\n- Garlic in October\n\n## Paths\n\nBark on the long path, grass between the beds. The water butt stands by the shed door.");
const north = await create("North bed [type::bed] [crop::peas]\n\nPeas along the hazel fence.", beds.id);
await create("First row [type::row]", north.id);
await create("Second row [type::row]", north.id);
await create("South bed [type::bed] [crop::beans]\n\nBeans, then garlic.", beds.id);
await create("East bed [type::bed] [crop::leeks]\n\nShade from the plum by noon.", beds.id);
const shed = await create("Shed [type::place]\n\nThe fork hangs by the door.");
await create("Seed list [type::list]\n\n- Peas\n- Runner beans\n- Leeks", shed.id);
await create("Compost [type::place]\n\nTurned every other week.");
console.log(`wrote the beds (${beds.id}) and the shed (${shed.id})`);
process.exit(0);
