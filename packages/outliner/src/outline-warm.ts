// What a door asks first, asked once before any door (a host warming an outline, PIE-1610): `waiting.list`'s parses are kept
// per note, the statements stay prepared and the code has run, so three doors don't each pay for a cold host. The reads
// another machine may answer go straight to the store: a laptop's round trips would be doors kept waiting. A new thing
// every door asks first and is slow only once goes here.
import { heldBy } from "./loop-watch";
import type { OutlinerStore } from "./store";
import { waitingAsks } from "./waiting-you";
import { seedMachinery } from "./watch-machinery";

/** The holds every door would meet at once. */
export async function warmHolds(name: string, store: OutlinerStore, pass: () => Promise<void>): Promise<void> {
  await pass();
  heldBy(`open ${name}: graph`, () => store.liveBlocks());
  await pass();
  heldBy(`open ${name}: waiting`, () => waitingAsks(store));
  await pass();
  heldBy(`open ${name}: machinery`, () => seedMachinery(store));
}

export async function warmReads(name: string, store: OutlinerStore, ask: (request: { action: string } & Record<string, unknown>) => Promise<unknown>, pass: () => Promise<void>): Promise<void> {
  const newest = (store.database.query("SELECT id FROM blocks WHERE effective_deleted_root_id IS NULL ORDER BY updated_at DESC LIMIT 1").get() as { id: string } | null)?.id;
  if (!newest) return;
  await store.warmValueReferences(pass);
  await pass();
  heldBy(`open ${name}: links`, () => {
    store.queryBacklinks({ targetBlockId: newest, limit: 20 });
    store.resolveBlockReferences(`((${newest}))`);
    store.resolvePageAddress("warm");
  });
  const reads: Array<{ action: string } & Record<string, unknown>> = [
    { action: "blocks.query", query: { where: "type=roadmap-item", limit: 50, sort: "updated desc" } },
    { action: "children", parentId: newest },
    { action: "resources.projection.read", blockId: newest, text: "" },
    { action: "annotations.list", query: { subject: { kind: "block", blockId: newest }, includeResolved: true } },
    { action: "blocks.facets", blockIds: [newest] },
    { action: "properties.preview", blockId: newest, text: "" },
    { action: "draft.proposals.list", blockId: newest },
    { action: "agents.held" }, { action: "styles.list" }, { action: "headings.styles" }, { action: "callouts.types" },
  ];
  for (const read of reads) { await pass(); await ask(read).catch(() => {}); }
}
