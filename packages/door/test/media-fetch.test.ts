// A picture that isn't on the door's machine is asked of the outline's host (PIE-1634: a laptop outline's picture seen
// on float-2): its bytes land in the media cache by their hash and the picture loads from there. The host here is a
// stand-in function; the made-up picture is a 2x2 PNG sharp makes. EP0CH_STATE is a scratch folder (the media cache).
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = mkdtempSync(join(tmpdir(), "door-media-fetch-"));
process.env.EP0CH_STATE = state;
afterAll(() => rmSync(state, { recursive: true, force: true }));

test("a picture not on this machine loads from the host's copy, asked once; one the host lacks says why", async () => {
  const { media, useMediaFetch, onMediaChange, mediaCache } = await import("../src/media");
  const sharp = (await import("sharp")).default;
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 40, g: 30, b: 20 } } }).png().toBuffer();
  const asked: string[] = [];
  useMediaFetch(async (path) => {
    asked.push(path);
    if (path.endsWith("kite.png")) return { base64: png.toString("base64"), mime: "image/png", sha256: "f".repeat(64) };
    throw new Error("no copy of it is in the media bucket");
  });
  let changed = Promise.withResolvers<void>();
  onMediaChange(() => changed.resolve());
  const kite = "/nowhere/laptop/screenshots/kite.png";
  expect(media(kite, "img").state).toBe("loading");
  await changed.promise;
  expect(existsSync(join(mediaCache(), "copies", `${"f".repeat(64)}.png`))).toBe(true);
  for (let i = 0; i < 50 && media(kite, "img").state !== "ready"; i++) { changed = Promise.withResolvers(); await Promise.race([changed.promise, Bun.sleep(100)]); }
  expect(media(kite, "img")).toMatchObject({ state: "ready", width: 2, height: 2 });
  expect(asked).toEqual([kite]);
  changed = Promise.withResolvers();
  media("/nowhere/laptop/gone.png", "img");
  await changed.promise;
  expect(media("/nowhere/laptop/gone.png", "img")).toMatchObject({ state: "error", reason: expect.stringContaining("no copy of it is in the media bucket") });
  changed = Promise.withResolvers();
  media("~/laptop/heron.png", "img");
  await changed.promise;
  expect(asked.at(-1)).toBe("~/laptop/heron.png");
  useMediaFetch(null);
});

test("a fetch that failed is asked again after the retry wait (its copy may have landed since)", async () => {
  const { media, useMediaFetch, onMediaChange } = await import("../src/media");
  const sharp = (await import("sharp")).default;
  const png = await sharp({ create: { width: 3, height: 3, channels: 3, background: { r: 20, g: 40, b: 60 } } }).png().toBuffer();
  let landed = false, asks = 0;
  useMediaFetch(async () => { asks++; if (!landed) throw new Error("its copy to the media bucket is on its way"); return { base64: png.toString("base64"), mime: "image/png", sha256: "e".repeat(64) }; }, 300);
  let changed = Promise.withResolvers<void>();
  onMediaChange(() => changed.resolve());
  const heron = "/nowhere/laptop/retry-heron.png";
  media(heron, "img");
  await changed.promise;
  // Inside the wait it stays the error, asked once.
  expect(media(heron, "img")).toMatchObject({ state: "error", reason: expect.stringContaining("on its way") });
  expect(asks).toBe(1);
  landed = true;
  await Bun.sleep(350);
  changed = Promise.withResolvers();
  media(heron, "img");
  await changed.promise;
  for (let i = 0; i < 50 && media(heron, "img").state !== "ready"; i++) { changed = Promise.withResolvers(); await Promise.race([changed.promise, Bun.sleep(100)]); }
  expect(media(heron, "img")).toMatchObject({ state: "ready", width: 3 });
  expect(asks).toBeGreaterThanOrEqual(2);
  useMediaFetch(null);
});

test("an answer that can't be kept (no bytes, a cache that can't be written) is an error, never loading forever", async () => {
  const { media, useMediaFetch, onMediaChange } = await import("../src/media");
  useMediaFetch(async () => ({ mime: "image/png" }) as never);
  const changed = Promise.withResolvers<void>();
  onMediaChange(() => changed.resolve());
  const path = "/nowhere/laptop/empty-answer.png";
  media(path, "img");
  await changed.promise;
  expect(media(path, "img")).toMatchObject({ state: "error", reason: expect.stringContaining("couldn't keep") });
  useMediaFetch(null);
});
