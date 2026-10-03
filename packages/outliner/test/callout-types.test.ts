import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calloutRegistry, type CalloutType } from "@ep0ch/outline-core/callouts";
import { OutlinerClient } from "../src/client";
import { parseDetailCallouts } from "../src/detail-callouts";
import { DEFAULT_DETAIL_CALLOUT_THEME } from "../src/detail-callout-theme";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function startService() {
  const directory = mkdtempSync(join(tmpdir(), "outliner-callout-types-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  const socket = join(directory, "outliner.sock");
  const server = new OutlinerServer(store, socket);
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  return new OutlinerClient(socket);
}

type Types = { types: CalloutType[]; problems: string[]; complete: boolean };

test("callouts.types (PIE-538): the types the outline's notes declare, in the order they were written, and what's wrong", async () => {
  const client = await startService();
  expect(await client.request<Types>({ action: "callouts.types" })).toEqual({ types: [], problems: [], complete: true });
  const recipe = await client.request<Block>({ action: "create", text: "Recipe callouts [callout-type::recipe] [callout-icon::♨] [callout-tone::green] [callout-aliases::dish]" });
  await client.request<Block>({ action: "create", text: "Seed packets [callout-type::recipe]" });
  const r = await client.request<Types>({ action: "callouts.types" });
  expect(r.types).toEqual([{ name: "recipe", title: "Recipe", icon: "♨", tone: "green", aliases: ["dish"], block: recipe.id }]);
  expect(r.problems).toHaveLength(1);
  expect(r.problems[0]).toContain("callout type recipe is declared already");

  // Detail draws a declared type through the same list: its alias resolves, its icon and title are the outline's.
  const [region] = parseDetailCallouts("> [!dish]\n> two cups", { ...DEFAULT_DETAIL_CALLOUT_THEME, registry: calloutRegistry(r.types) });
  expect(region).toMatchObject({ calloutType: "dish", canonicalType: "recipe", title: "Recipe", icon: "♨" });
});
