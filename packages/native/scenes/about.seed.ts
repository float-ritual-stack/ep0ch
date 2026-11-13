// The made-up notes the `about` and `pictures` scenes open, written into a scratch outline (never a real one: the
// socket is a scratch host's, named outright).
//   bun scenes/about.seed.ts <a scratch host's socket> <outline> [<a scratch folder for the pictures>]
//
// - "Bean rows": a note with a history (three texts), a comment thread on words of it with a reply, and an edit an
//   agent proposed beside it. What the comments, proposals and revisions tiles list of it is the service's.
// - "Seed list": a screen saved as a note, with keys of its own and the list of the keys beside its reader.
// - "The plot in June" (with a folder): a header image, two pictures (one nobody took), an svg fence and a mermaid
//   fence. The pictures are drawn here and written into the folder, so the scratch host has files to read.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OutlinerClient } from "../../outliner/src/client";

const [socket, outline, pictures] = process.argv.slice(2);
if (!socket || !outline) throw new Error("usage: bun scenes/about.seed.ts <a scratch host's socket> <outline> [<a scratch folder for the pictures>]");
const client = new OutlinerClient(socket, 20_000);
const ask = <T,>(request: Record<string, unknown>) => client.request<T>({ outline, ...request } as never);
type Block = { id: string; revision: number; text: string };
const create = (text: string, parentId?: string) => ask<Block>({ action: "create", text, author: "user", ...(parentId ? { parentId } : {}) });
const TIDY = { author: "agent", actorId: "tidy-agent" };

// A note with a history: written, tidied by an agent, then changed by the person.
const first = ["Bean rows [type::bed] [crop::beans]", "Two rows along the south fence, canes at each end.", "", "The beans go in May, once the soil is warm.", "Water at dusk for the first fortnight.", "", "Pick small and often."].join("\n");
let beans = await create(first);
beans = await ask<Block>({ action: "update", blockId: beans.id, text: beans.text.replace("canes at each end", "a cane at every plant"), expectedRevision: beans.revision, mutation: TIDY });
beans = await ask<Block>({ action: "update", blockId: beans.id, text: beans.text.replace("Pick small and often.", "Pick small and often, before the pods string."), expectedRevision: beans.revision, mutation: { author: "user" } });
// A comment on words of it, and an agent's answer in the thread.
const made = await ask<{ annotations: { block: { id: string } }[] }>({ action: "annotations.batch", requestId: "about-seed-comment", author: "user", operations: [
  { operationId: "1", type: "block-comment", input: { blockId: beans.id, expectedRevision: beans.revision, body: "June is safer: the frost came late last year.", source: "user", passage: { quote: "The beans go in May" } } },
] });
await ask({ action: "annotations.reply", requestId: "about-seed-reply", author: "agent", provenance: { actorId: TIDY.actorId }, input: { annotationId: made.annotations[0]!.block.id, body: "The last frost in the log is May 19. I have proposed the change beside the note.", source: "agent" } });
// An edit an agent proposed beside it: listed with its change until it is applied or dismissed.
await ask({ action: "draft.patch", propose: true, blockId: beans.id, revision: beans.revision, patches: [{ observed: "The beans go in May, once the soil is warm.", replacement: "The beans go in June, once the last frost is past." }], mutation: TIDY });

if (pictures) {
  mkdirSync(pictures, { recursive: true });
  const svg = (name: string, body: string, view = "0 0 400 160") => { const path = join(pictures, name); writeFileSync(path, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}">${body}</svg>`); return path; };
  const banner = svg("dusk.svg", `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2640"/><stop offset="1" stop-color="#b0584f"/></linearGradient></defs><rect width="400" height="160" fill="url(#sky)"/><circle cx="318" cy="112" r="28" fill="#d6b487"/><path d="M0 118 Q120 90 220 124 T400 104 V160 H0Z" fill="#2f4d33"/><path d="M0 140 Q160 120 400 142 V160 H0Z" fill="#203324"/>`);
  const beds = svg("beds.svg", `<rect width="400" height="160" rx="10" fill="#f3ecdf"/>${[0, 1, 2, 3].map(i => `<rect x="${22 + i * 93}" y="24" width="76" height="112" rx="6" fill="${i === 2 ? "#e8d7a8" : "#cfe2b6"}" stroke="#7a5a3c" stroke-width="3"/>`).join("")}`);
  await create([
    "The plot in June [type::plan] [season::summer]",
    `[img::${banner}] [layout::hero] [alt::Dusk over the beds]`,
    "Four beds this year, one left fallow. The packet below is what's left of the beans.",
    "",
    "### The beds",
    `[img::${beds}] [alt::Four beds, the third fallow]`,
    "",
    "### What's left",
    `[img::${join(pictures, "missing.png")}] [alt::The photo nobody took]`,
    "",
    "### Sun through the day",
    "```svg",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80"><rect width="320" height="80" rx="8" fill="#1f2a44"/><path d="M20 64 Q160 -8 300 64" fill="none" stroke="#ffcf5c" stroke-width="3"/><circle cx="160" cy="22" r="9" fill="#ffcf5c"/></svg>`,
    "```",
    "",
    "### Who does what",
    "```mermaid",
    "flowchart LR",
    "  Sow --> Water",
    "  Water --> Pick",
    "  Water --> Weed",
    "```",
  ].join("\n"));
}
// A screen with keys of its own, saved as a note: a reader beside the list of the keys, which puts that screen's first.
await ask({ action: "screens.save", mutation: { author: "user" }, spec: {
  name: "seed-list", title: "Seed list", lands: "reader",
  toolbar: ["back", "bar.open", "bar.open scope=screens", "screen.reset"],
  layout: { focus: "reader", root: { t: "split", dir: "row", weights: [0.4, 0.6], kids: [{ t: "leaf", kind: "reader", name: "reader" }, { t: "leaf", kind: "keymap", name: "keys" }] } },
  keys: [
    { key: "ctrl+l", action: "bar.open", args: { scope: "screens" }, says: "open the bar on the screens" },
    { key: "K", action: "tile.focus", tile: "keys", only: ["reader"], says: "the keys to the list of keys" },
    { key: "B", action: "open", args: { id: beans.id }, says: "open the bean rows" },
  ],
} });
console.log(beans.id);
process.exit(0);
