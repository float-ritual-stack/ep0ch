// Every bundled extension's page, as the host writes it, passes the write review's code rubric (PIE-1270's writeShape):
// no title past a name, no wall, no points stacked in one bullet, no run of prose with nothing else, headings past a
// screen. A new extension can't ship its page as a wall. On a scratch service with every folder in extensions/ copied in.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeShape, type ShapeRule } from "@ep0ch/outline-core/write-shape";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** The rubric's code checks a page is held to: dense (walls, stacked bullets) and format (title, prose alone, headings). */
const RULES: ReadonlySet<ShapeRule> = new Set(["title", "wall", "stacked", "prose", "headings", "callout-nesting"]);
const BUNDLED = join(import.meta.dir, "..", "extensions");

test("every bundled extension's page reads in ten seconds: no wall, no stacked bullet, a short title", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-ext-shape-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outline = join(root, "outline");
  mkdirSync(join(outline, "extensions"), { recursive: true });
  const ids = readdirSync(BUNDLED, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  for (const id of ids) cpSync(join(BUNDLED, id), join(outline, "extensions", id), { recursive: true });
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outline });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state"), scheduleTickMs: 3_600_000 });
  server.setOutline({ name: "shape-scratch" });
  await server.start();
  cleanups.push(async () => {
    await server.close(); store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const client = new OutlinerClient(socket, 20_000);
  const listed = await client.request<{ pages: Record<string, string> }>({ action: "extensions.list", reload: true });
  // Every bundled folder has a page (the outline's own script notes may add more, which aren't held here).
  expect(ids.filter((id) => !listed.pages[id])).toEqual([]);

  const only = process.env.EXT_SHAPE_ONLY?.split(",");
  const findings = ids.filter((id) => !only || only.includes(id)).flatMap((id) =>
    writeShape(store.require(listed.pages[id]!).text).filter((finding) => RULES.has(finding.rule)).map((finding) => `${id}: ${finding.say}`));
  expect(findings).toEqual([]);
});
