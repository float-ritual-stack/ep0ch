import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveStyle, styleLayers, type StyleSheet } from "@ep0ch/outline-core/style-cascade";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function startService() {
  const directory = mkdtempSync(join(tmpdir(), "outliner-style-sheets-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  const socket = join(directory, "outliner.sock");
  const server = new OutlinerServer(store, socket);
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  return new OutlinerClient(socket);
}

type Sheets = { sheets: StyleSheet[]; problems: string[]; complete: boolean };

test("styles.list (PIE-673): the style sheets the outline's notes and lines declare, oldest first, and what's wrong", async () => {
  const client = await startService();
  expect(await client.request<Sheets>({ action: "styles.list" })).toEqual({ sheets: [], problems: [], complete: true });
  const global = await client.request<Block>({ action: "create", text: "Reading comfort [style-for::global] [style.measure::72] [style.list.gap::1]" });
  const looks = await client.request<Block>({ action: "create", text: [
    "Looks",
    "",
    "Detail tiles [style-for::tile:detail] [style.pad::1] [style.narrow.margin.x::0]",
    "Written as code: `[style-for::screen:ghost]`",
    "A typo [style-for::tile:] [style.margin.x::2]",
    "Old band spelling [style-for::screen:desk] [heading-margin::1 0 1]",
  ].join("\n") });
  const r = await client.request<Sheets>({ action: "styles.list" });
  expect(r.sheets).toEqual([
    { for: "global", block: global.id, fields: { measure: "72", "list.gap": "1" } },
    { for: "tile:detail", block: looks.id, line: 2, fields: { "pad.y": "1", "pad.x": "2", "narrow.margin.x": "0" } },
    { for: "screen:desk", block: looks.id, line: 5, fields: { "heading.margin": "1 0 1" } },
  ]);
  expect(r.problems).toEqual([expect.stringContaining('style-for "tile:" is global, tile:<kind>')]);
  // What a reader on the desk resolves from them at 40 columns.
  const v = resolveStyle(styleLayers(r.sheets, { tile: "detail", screen: "desk" }), 40).values;
  expect(v).toMatchObject({ measure: 72, "pad.x": 2, "pad.y": 1, "margin.x": 0, "list.gap": 1, "heading.margin": { top: 1, cols: 0, bottom: 1 } });
});
