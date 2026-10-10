// A schedule that runs once per host (`once: "host"`, PIE-767): an outline host serves every outline from one
// process, and an extension in the user folder serves each of them, so a per-outline schedule fires in every outline.
// A host-wide one is held by one outline's runner, listed by the others as running there, run one at a time across
// the host, and taken over by another outline when its holder closes. The extension is made up; nothing runs code.
import { expect, test } from "bun:test";
import type { LoadedExtension } from "../src/extension-manifest";
import { ExtensionSchedules, type ScheduledEntry } from "../src/extension-schedule";

const extension = (directory: string, schedule: Record<string, string>) => ({
  id: "feed", name: "Feed", version: 1, origin: "user", directory, config: {}, credentials: {}, sources: [], enabled: true, command: null, stamp: "1",
  manifest: { contract: 2, id: "feed", version: 1, name: "Feed", actions: [{ id: "pull", label: "Pull", on: "outline", effects: "write", schedule }] },
}) as unknown as LoadedExtension;

/** One outline's runner over the same user-folder extension, recording which outline ran each entry. */
function runner(outline: string, served: LoadedExtension, now: () => number, ran: string[], gate?: Promise<void>, serves = () => true) {
  const schedules = new ExtensionSchedules({
    serving: () => (serves() ? [served] : []),
    run: async (entry: ScheduledEntry) => { ran.push(`${outline} ${entry.entry}`); await gate; return `pulled in ${outline}`; },
    now, outline: () => outline, tickMs: 3_600_000,
  });
  schedules.start();
  return schedules;
}

test("a host-wide schedule runs in one outline of the host; the others list where it runs; a per-outline one runs in each", async () => {
  let now = Date.parse("2026-10-10T09:00:00.000Z");
  const ran: string[] = [];
  const hostWide = extension("/made-up/user-extensions/feed", { every: "1h", once: "host" });
  const [garden, shed] = [runner("garden", hostWide, () => now, ran), runner("shed", hostWide, () => now, ran)];
  try {
    expect(garden.list("feed")).toEqual([{ entry: "action:pull", every: "1h", once: "host", next: "2026-10-10T10:00:00.000Z" }]);
    expect(shed.list("feed")).toEqual([{ entry: "action:pull", every: "1h", once: "host", runsIn: "garden", next: "2026-10-10T10:00:00.000Z" }]);
    now = Date.parse("2026-10-10T10:00:30.000Z");
    await Promise.all([garden.tick(), shed.tick()]);
    expect(ran).toEqual(["garden action:pull"]);
    // The other outline lists the holder's run.
    expect(shed.list("feed")[0]).toMatchObject({ runsIn: "garden", last: { ok: true, message: "pulled in garden" } });
    // Its holder closes: the next outline to look takes it, and runs it when it's due.
    garden.stop();
    // It takes the holder's last run with it: due an hour after that run, not at once.
    expect(shed.list("feed")[0]).toMatchObject({ next: "2026-10-10T11:00:30.000Z", last: { message: "pulled in garden" } });
    expect(shed.list("feed")[0]).not.toHaveProperty("runsIn");
    now = Date.parse("2026-10-10T10:05:00.000Z");
    await shed.tick();
    expect(ran).toEqual(["garden action:pull"]);
    now = Date.parse("2026-10-10T11:01:00.000Z");
    await shed.tick();
    expect(ran).toEqual(["garden action:pull", "shed action:pull"]);
  } finally {
    garden.stop();
    shed.stop();
  }

  const perOutline = extension("/made-up/user-extensions/feed-2", { every: "1h" });
  const each: string[] = [];
  let later = Date.parse("2026-10-10T09:00:00.000Z");
  const [a, b] = [runner("garden", perOutline, () => later, each), runner("shed", perOutline, () => later, each)];
  try {
    // Each outline sees it (first seen 09:00), then both run it when it's due.
    expect([a.list("feed")[0]?.runsIn, b.list("feed")[0]?.runsIn]).toEqual([undefined, undefined]);
    later = Date.parse("2026-10-10T10:00:30.000Z");
    await Promise.all([a.tick(), b.tick()]);
    expect(each.sort()).toEqual(["garden action:pull", "shed action:pull"]);
  } finally {
    a.stop();
    b.stop();
  }
});

test("a host-wide schedule runs one at a time across the host: asked now in another outline while it runs, it says where", async () => {
  let now = Date.parse("2026-10-10T09:00:00.000Z");
  const ran: string[] = [];
  const release = Promise.withResolvers<void>();
  const hostWide = extension("/made-up/user-extensions/feed-3", { every: "1h", once: "host" });
  const [garden, shed] = [runner("garden", hostWide, () => now, ran, release.promise), runner("shed", hostWide, () => now, ran)];
  try {
    expect(garden.list("feed")[0]).not.toHaveProperty("runsIn");
    now = Date.parse("2026-10-10T10:00:30.000Z");
    const running = garden.tick();
    await Bun.sleep(10);
    expect(shed.list("feed")[0]).toMatchObject({ runsIn: "garden", running: true });
    await expect(shed.runNow("feed", "action:pull")).rejects.toThrow("feed's action:pull is running now (in garden); it runs once at a time");
    release.resolve();
    await running;
    // Asked by hand once it's done, it runs where it's asked.
    expect(await shed.runNow("feed", "action:pull")).toMatchObject({ ok: true, message: "pulled in shed" });
  } finally {
    garden.stop();
    shed.stop();
  }
});

test("a host-wide schedule's holder that stops serving the extension lets another outline take it", async () => {
  let now = Date.parse("2026-10-10T09:00:00.000Z");
  const ran: string[] = [];
  let gardenServes = true;
  const hostWide = extension("/made-up/user-extensions/feed-4", { every: "1h", once: "host" });
  const [garden, shed] = [runner("garden", hostWide, () => now, ran, undefined, () => gardenServes), runner("shed", hostWide, () => now, ran)];
  try {
    garden.list("feed");
    expect(shed.list("feed")[0]).toMatchObject({ runsIn: "garden" });
    // The extension leaves garden (disabled there, its folder moved): garden is open, but shed runs it now.
    gardenServes = false;
    expect(shed.list("feed")[0]).not.toHaveProperty("runsIn");
    now = Date.parse("2026-10-10T10:00:30.000Z");
    await Promise.all([garden.tick(), shed.tick()]);
    expect(ran).toEqual(["shed action:pull"]);
  } finally {
    garden.stop();
    shed.stop();
  }
});
