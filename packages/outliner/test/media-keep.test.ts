// `media.keep`: a file a client puts into a draft, kept by the door's rule. One scratch service over a made-up
// outline; the pictures are a few bytes of a PNG.
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageLine, isImageName, keptAs, keptMediaName, type MediaKept } from "@ep0ch/outline-core/media-keep";
import { parseMediaLine } from "@ep0ch/outline-core/media-line";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { scratchOutline } from "./scratch-outline";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

// Enough of a PNG for a type check.
const MOTH = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1]);

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-media-keep-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "garden"), elsewhere = join(root, "desktop");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(elsewhere, { recursive: true });
  const paths = scratchOutline(root, { name: "garden", folder: workspace });
  const store = new OutlinerStore(paths.database, { workspaceRoot: workspace });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); });
  const client = new OutlinerClient(paths.socket, 15_000);
  const keep = (ask: Record<string, unknown>) => client.request<MediaKept>({ action: "media.keep", ...ask } as never);
  return { workspace, elsewhere, keep };
}

test("the rule both keepers ask: what a name is kept as, and what a kept picture is called", () => {
  expect([keptAs("bed at dusk.PNG"), keptAs("plan.html"), keptAs("seeds.csv"), keptAs("heap")]).toEqual(["picture", "artifact", null, null]);
  expect(isImageName("/made/up/rows.jpeg")).toBe(true);
  expect(keptMediaName("2026-11-14", "1a2b3c4d5e6f", ".png")).toBe("2026-11-14-1a2b3c4d.png");
});

test("a picture handed over as bytes is kept in the outline's media folder, once, and answered as its media line", async () => {
  const { workspace, keep } = await setup();
  const kept = await keep({ name: "moth.png", base64: Buffer.from(MOTH).toString("base64") });
  const hash = createHash("sha256").update(MOTH).digest("hex");
  expect(kept.path).toBe(join(workspace, "media", keptMediaName(new Date().toISOString().slice(0, 10), hash, ".png")));
  expect(Buffer.from(readFileSync(kept.path))).toEqual(Buffer.from(MOTH));
  expect(kept).toMatchObject({ kind: "picture", kept: true, line: imageLine(kept.path) });
  // The line is one a reader draws: the media grammar reads it as that picture.
  expect(parseMediaLine(kept.line)).toMatchObject({ kind: "img", path: kept.path });
  // The same picture again is the same file: nothing is written twice.
  const again = await keep({ base64: Buffer.from(MOTH).toString("base64") });
  expect(again).toMatchObject({ path: kept.path, kept: false });
  expect(readdirSync(join(workspace, "media"))).toHaveLength(1);
});

test("a picture named by its path on the outline's machine is read there", async () => {
  const { workspace, elsewhere, keep } = await setup();
  writeFileSync(join(elsewhere, "kite.png"), MOTH);
  const kept = await keep({ path: join(elsewhere, "kite.png") });
  expect(kept.kind).toBe("picture");
  expect(kept.path.startsWith(join(workspace, "media"))).toBe(true);
  await expect(keep({ path: join(elsewhere, "never.png") })).rejects.toThrow(/isn't on the outline's machine/);
});

test("an artifact is not copied: its line names where it is; anything else is refused with what a note keeps", async () => {
  const { workspace, elsewhere, keep } = await setup();
  const page = join(elsewhere, "night shift.html");
  writeFileSync(page, "<p>beds</p>");
  expect(await keep({ name: "night shift.html", path: page })).toEqual({ path: page, line: `[artifact::${page}]`, kind: "artifact", kept: false });
  expect(existsSync(join(workspace, "media"))).toBe(false);
  await expect(keep({ name: "night shift.html", base64: "PHA+" })).rejects.toThrow(/its line names its path/);
  await expect(keep({ name: "seeds.csv", base64: "YQ==" })).rejects.toThrow(/no picture and no page/);
  await expect(keep({})).rejects.toThrow(/takes a file/);
});
