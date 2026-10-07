import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HeadingStyle } from "@ep0ch/outline-core/heading-styles";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function startService() {
  const directory = mkdtempSync(join(tmpdir(), "outliner-heading-styles-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  const socket = join(directory, "outliner.sock");
  const server = new OutlinerServer(store, socket);
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  return new OutlinerClient(socket);
}

type Styles = { styles: HeadingStyle[]; problems: string[]; complete: boolean };

test("headings.styles (PIE-599): the styles the outline's notes declare, in the order they were written, and what's wrong", async () => {
  const client = await startService();
  expect(await client.request<Styles>({ action: "headings.styles" })).toEqual({ styles: [], problems: [], complete: true });
  const plot = await client.request<Block>({ action: "create", text: "Plot heading style [heading-style::plot] [heading-pattern::dots] [heading-align::left] [heading-tone::green] [heading-default::2]" });
  await client.request<Block>({ action: "create", text: "Another plot [heading-style::plot]" });
  const r = await client.request<Styles>({ action: "headings.styles" });
  expect(r.styles).toHaveLength(1);
  expect(r.styles[0]).toMatchObject({ name: "plot", pattern: "dots", align: "left", tone: "green", defaults: [2], block: plot.id });
  expect(r.problems).toEqual([expect.stringContaining("heading style plot is declared already")]);
});

test("a styled heading is a heading to the service: its anchored section is sliced as written, through the next heading", async () => {
  const client = await startService();
  const note = await client.request<Block>({ action: "create", text: "Plan\n\n## Beds [heading::band] ^beds\nFour beds.\n\n## Water\nhose" });
  const read = await client.request<{ status: string; fragment: { text: string; startLine: number; endLine: number } }>({ action: "fragments.read", blockId: note.id, fragmentId: "beds" });
  expect(read.status).toBe("resolved");
  expect(read.fragment.text.trimEnd()).toBe("## Beds [heading::band]\nFour beds.");
});
