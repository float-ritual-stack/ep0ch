// Every component's own example (its schema's, outline-core's component-schema.ts) as the page a client draws of it:
// a scratch outline is given one note a component, holding the example as its schema writes it, and `notes.page`
// answers each. `bun scripts/component-pages.ts` writes outline-core/fixtures/component-pages.json; a test makes it
// again and compares. A client that can't run the service draws these to see how each component fares there (the
// native window's coverage table, packages/native/docs/prim-coverage.md).
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_COMPONENT_SCHEMAS, componentIsLive, variation } from "@ep0ch/outline-core/component-schema";
import type { NotePage } from "@ep0ch/outline-core/note-page";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";

export interface ComponentPage {
  /** The schema's id, title and group, and whether it asks the outline anything. */
  id: string; title: string; group: string; live: boolean;
  /** The example as its schema writes it: the note's body. */
  source: string;
  /** What `notes.page` answers of the note that holds it: the parts a client draws, and its header image. */
  page: Pick<NotePage, "title" | "text" | "chips" | "parts"> & { hero?: NotePage["hero"] };
}

/** The made-up notes the examples' questions can find: a few beds and chores, with the properties gardens have. */
const GARDEN = [
  "North bed [type::bed] [stage::sown] [crop::peas]", "South bed [type::bed] [stage::dug] [crop::beans]", "Cold frame [type::bed] [stage::sown] [crop::kale]",
  "Turn the compost [type::chore] [state::todo]", "Mend the net [type::chore] [state::done]",
];

/** Every built-in component's example page, in the schemas' order. Ids, times and the scratch folder never reach it. */
export async function componentPages(): Promise<ComponentPage[]> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-component-pages-")));
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: root });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state") });
  server.setOutline({ name: "garden" });
  await server.start();
  const client = new OutlinerClient(socket, 20_000);
  try {
    const create = (text: string) => client.request<{ id: string }>({ action: "create", text, author: "user" });
    for (const text of GARDEN) await create(text);
    const out: ComponentPage[] = [];
    for (const schema of BUILTIN_COMPONENT_SCHEMAS) {
      const example = variation(schema, {});
      // A component declared by a note (a heading style, a callout type) has that note beside the one that uses it.
      if (example.note) await create(example.note);
      const note = await create(`${schema.title} example\n${example.use}`);
      const page = await client.request<NotePage>({ action: "notes.page", blockId: note.id });
      out.push({ id: schema.id, title: schema.title, group: schema.group, live: componentIsLive(schema), source: example.use,
        page: { title: page.title, text: page.text, chips: page.chips, parts: page.parts, ...(page.hero ? { hero: page.hero } : {}) } });
    }
    return JSON.parse(steady(JSON.stringify(out))) as ComponentPage[];
  } finally {
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

/** What differs from run to run, made the same: each note's id by the order it is first named, and a clock's reading. */
function steady(json: string): string {
  const ids = new Map<string, string>();
  return json
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, id => ids.get(id) ?? (ids.set(id, `note-${String(ids.size + 1).padStart(3, "0")}`), ids.get(id)!))
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?\b/g, "2031-04-01 09:00")
    .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/g, "Apr 1")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "09:00");
}

export const componentPagesFixture = async (): Promise<string> => `${JSON.stringify({
  about: "Every built-in component's own example (its schema's) as the page `notes.page` answers of a note that holds it, on a scratch outline of made-up beds and chores. Made by the service; never edited by hand.",
  by: "packages/outliner/scripts/component-pages.ts",
  components: await componentPages(),
}, null, 1)}\n`;

if (import.meta.main) await Bun.write(join(import.meta.dir, "../../outline-core/fixtures/component-pages.json"), await componentPagesFixture());
