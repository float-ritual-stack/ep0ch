// PIE-1402, found live on pie (Oct 29): a backfill --into stalled the host's loop 5–8 s per note's records, and the
// person's door waited up to 64 s for a checklist. The backfill must stay invisible: a door's ping answers in under
// 200 ms while it runs. A scratch outline of a few thousand made-up notes, Jev off.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scratchOutline } from "./scratch-outline";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { reviewBackfill } from "../src/write-review-backfill";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

test("a backfill --into leaves the host answering a door's ping in under 200 ms", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-backfill-load-"));
  const { env: _env, ...paths } = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  // Old notes first (outside the window's newest), then the agents' walls the backfill reviews.
  for (let i = 0; i < 6000; i++) store.create(`Seed packet ${i} [type::packet] [bed::b${i % 40}]\n\nSown in row ${i % 12}.`, null, "user");
  const wall = (i: number) => `Shed status ${i}\n\n- The roof went on at nine and the felt was cut to size. The tacks ran out halfway; we borrowed a box. Then the rain held off.\n- Evan, should we paint it now or wait for spring?\n\n${"The gutter came down and went back up again. ".repeat(5)}`;
  for (let i = 0; i < 40; i++) store.create(wall(i), null, "agent", { actorId: "moss/claude-code@shed" });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  const client = new OutlinerClient(paths.socket), door = new OutlinerClient(paths.socket);
  cleanups.push(async () => { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  // A door watching a view, as the person's does: its queries are evaluated again after changes.
  await door.request({ action: "blocks.query", query: { where: "type=packet", limit: 50 }, watch: "packets" } as never);
  let done = false, worst = 0;
  const pings = (async () => {
    while (!done) {
      const at = performance.now();
      await door.request({ action: "ping" } as never);
      worst = Math.max(worst, performance.now() - at);
      await Bun.sleep(25);
    }
  })();
  const report = await reviewBackfill(client as never, { since: "7d", jev: false, into: client as never, limit: 40 });
  done = true;
  await pings;
  expect(report.reviewed).toBe(40);
  expect(report.findings).toBeGreaterThan(40);
  expect(worst).toBeLessThan(200);
}, 300_000);
