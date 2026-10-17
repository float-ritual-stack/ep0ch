// PIE-978 (permissions): what a published page draws from the Site never reveals a note the page may not show. A render
// script's output, an `::if` over a relation, on the tailnet page (every note but a locked one) and the public one (only
// [publish::public] notes). Scratch services in temp folders; every note is made up.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { Publisher } from "../src/publish";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { scratchOutline } from "./scratch-outline";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function until<T>(what: string, check: () => T | undefined | null | false, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-publish-visibility-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const workspace = join(root, "garden");
  mkdirSync(workspace);
  const paths = scratchOutline(root, { folder: workspace });
  const store = new OutlinerStore(paths.database, { workspaceRoot: workspace });
  const server = new OutlinerServer(store, paths.socket, undefined, undefined, { extensionPollMs: 0, agentRequestQuietMs: 80, ruleQuietMs: 20 });
  await server.start();
  const client = new OutlinerClient(paths.socket, 15_000);
  const publisher = new Publisher({ client });
  await publisher.start();
  cleanups.push(async () => {
    await publisher.stop();
    await server.close();
    store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  /** The page as a tailnet reader sees it, and as anyone with the public link does. */
  const tailnet = async (slug: string) => (await publisher.handle(new Request(`http://127.0.0.1/p/${slug}?view=html`, { headers: { accept: "text/html" } }))).text();
  const publicly = async (slug: string) => (await publisher.handle(new Request(`http://moth-box.tail0000.ts.net/share/p/${slug}?view=html`, { headers: { accept: "text/html" } }), "public")).text();
  return { store, client, tailnet, publicly };
}

test("a render script's output on a page says hidden here when the script read a note the page may not show", async () => {
  const { store, client, tailnet, publicly } = await setup();
  const quiet = store.create("Gate codes [code::4471]");
  const locked = store.create("Vault codes [publish::never] [code::9023]");
  const page = store.create([
    "Shed report [publish::public:shed-report]",
    `::= (await resolve('((${quiet.id})).code')).values[0]`,
    `::= (await resolve('((${locked.id})).code')).values[0]`,
  ].join("\n"), null, "user");
  await client.request({ action: "resources.projection.read", blockId: page.id, materialize: true });
  await until("both lines drawn", () => store.extensionOutputs(page.id).filter(row => row.result).length === 2);
  // The tailnet page shows an untagged note, never a locked one; the public page shows neither.
  const inside = await tailnet("shed-report");
  expect(inside).toContain("4471");
  expect(inside).not.toContain("9023");
  const outside = await publicly("shed-report");
  expect(outside).not.toContain("4471");
  expect(outside).not.toContain("9023");
  expect(outside).toContain("hidden here");
});

test("an ::if over a relation never lets its body say what a note the page may not show holds", async () => {
  const { store, tailnet, publicly } = await setup();
  const plan = store.create("Bed plan [publish::public:bed-plan] [status::open]\n::if{where=\"child:status=approved\"}\nApproved by the committee.\n::");
  store.create("Quote from the nursery [status::approved]", plan.id);
  const inside = await tailnet("bed-plan");
  expect(inside).toContain("Approved by the committee.");
  expect(await publicly("bed-plan")).not.toContain("Approved by the committee.");

  const locked = store.create("Bed plan two [publish::public:bed-plan-two] [status::open]\n::if{where=\"child:status=approved\"}\nApproved too.\n::");
  store.create("Locked quote [status::approved] [publish::never]", locked.id);
  expect(await tailnet("bed-plan-two")).not.toContain("Approved too.");
  expect(await publicly("bed-plan-two")).not.toContain("Approved too.");
});
