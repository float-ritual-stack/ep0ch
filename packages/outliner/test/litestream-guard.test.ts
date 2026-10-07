// The Litestream guard (PIE-607): a change to an outline's file is made with this machine's replicator for it
// stopped, and started again after; a replicator it can't stop refuses the change with the commands. A scratch home
// with fictional unit files and configs, and a fake systemctl: no real unit is asked or touched.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { anyPaused, cancelRetry, metaDir, recoverPaused, replicatorsFor, running, stuckPauses, withLitestreamPaused } from "../src/litestream-guard";
import { instancesIn, litestreamUnits, templateInstance } from "../src/litestream-units";

const root = mkdtempSync(join(tmpdir(), "litestream-guard-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const home = join(root, "home"), outlines = join(root, "outlines"), elsewhere = join(root, "elsewhere");
mkdirSync(join(home, ".config/systemd/user"), { recursive: true });
mkdirSync(outlines, { recursive: true });
writeFileSync(join(home, "litestream.yml"), `dbs:\n  - dir: ${outlines}\n    pattern: "*.sqlite"\n    watch: true\n    replica:\n      type: file\n      path: ${root}/replica\n`);
writeFileSync(join(home, ".config/systemd/user/litestream.service"), `[Service]\nExecStart=%h/.local/bin/litestream replicate -config %h/litestream.yml\n`);
writeFileSync(join(home, ".config/systemd/user/litestream-mirror@.service"), `[Service]\nExecStart=%h/.local/bin/litestream restore -f -config %h/m.yml %h/outline-mirrors/laptop/%i.sqlite\n`);

/** A fake systemctl: the replicator's state, and every call made. */
function fakeSystemd(state: { active: boolean; stopFails?: boolean; startFails?: number }) {
  const calls: string[] = [];
  const run = (argv: string[]) => {
    calls.push(argv.slice(1).join(" "));
    if (argv[2] === "is-active") return { code: state.active ? 0 : 3, out: state.active ? "active" : "inactive" };
    if (argv[2] === "stop") { if (state.stopFails) return { code: 1, out: "Failed to stop litestream.service: Access denied" }; state.active = false; return { code: 0, out: "" }; }
    if (argv[2] === "start") {
      if (state.startFails) { state.startFails--; return { code: 1, out: "Failed to start litestream.service: Unit is masked" }; }
      state.active = true; return { code: 0, out: "" };
    }
    return { code: 1, out: "?" };
  };
  return { run, calls };
}
const records = join(root, "paused");
/** The pause rows (the guard's records), read and written as another process would. */
const pauses = () => { const db = new Database(join(records, "pauses.sqlite")); db.run("CREATE TABLE IF NOT EXISTS pauses (unit TEXT PRIMARY KEY, record TEXT NOT NULL)"); return db; };
const pausedUnits = () => { const db = pauses(); try { return (db.query("SELECT unit FROM pauses").all() as { unit: string }[]).map(r => r.unit); } finally { db.close(); } };
const pause = (rec: { unit: string; kind: string; path: string; holders: string[]; since: string }) => { const db = pauses(); db.run("INSERT OR REPLACE INTO pauses VALUES (?, ?)", [rec.unit, JSON.stringify(rec)]); db.close(); };
const holdersOf = (unit: string) => { const db = pauses(); try { return JSON.parse((db.query("SELECT record FROM pauses WHERE unit = ?").get(unit) as { record: string }).record).holders; } finally { db.close(); } };
const o = (run: ReturnType<typeof fakeSystemd>["run"], alive: (pid: number) => boolean = p => p === process.pid) => ({ platform: "linux" as const, home, run, env: {}, records, alive });

describe("the Litestream guard", () => {
  test("only the replicator whose config names the outline's folder", () => {
    expect(replicatorsFor([join(outlines, "garden.sqlite")], { platform: "linux", home, env: {} }).units.map(u => u.name)).toEqual(["litestream.service"]);
    expect(replicatorsFor([join(outlines, "garden.txt")], { platform: "linux", home, env: {} }).units).toEqual([]);   // the pattern
    expect(replicatorsFor([join(elsewhere, "garden.sqlite")], { platform: "linux", home, env: {} }).units).toEqual([]);
  });

  test("stopped for the change, started after; two changes at once share one stop", async () => {
    const sd = fakeSystemd({ active: true });
    const order: string[] = [];
    await withLitestreamPaused([join(outlines, "garden.sqlite")], "deleting garden", async () => {
      order.push(`change while active=${sd.calls.includes("--user stop litestream.service")}`);
      await withLitestreamPaused([join(outlines, "pantry.sqlite")], "deleting pantry", () => { order.push("nested"); }, o(sd.run));
    }, o(sd.run));
    expect(order).toEqual(["change while active=true", "nested"]);
    expect(sd.calls.filter(c => c.includes("stop") || c.includes("start"))).toEqual(["--user stop litestream.service", "--user start litestream.service"]);
  });

  test("started again even when the change fails", async () => {
    const sd = fakeSystemd({ active: true });
    await expect(withLitestreamPaused([join(outlines, "garden.sqlite")], "deleting garden", () => { throw new Error("disk full"); }, o(sd.run))).rejects.toThrow("disk full");
    expect(sd.calls.at(-1)).toBe("--user start litestream.service");
  });

  test("a stopped replicator is left stopped; a scratch folder touches nothing", async () => {
    const sd = fakeSystemd({ active: false });
    expect(await withLitestreamPaused([join(outlines, "garden.sqlite")], "x", () => 7, o(sd.run))).toBe(7);
    expect(sd.calls).toEqual(["--user is-active litestream.service"]);
    const none = fakeSystemd({ active: true });
    await withLitestreamPaused([join(elsewhere, "garden.sqlite")], "x", () => {}, o(none.run));
    expect(none.calls).toEqual([]);
  });

  test("one it can't stop refuses the change, with the commands, and keeps the meta folder", async () => {
    const sd = fakeSystemd({ active: true, stopFails: true });
    let ran = false;
    const refused = withLitestreamPaused([join(outlines, "garden.sqlite")], "deleting the outline garden", () => { ran = true; }, o(sd.run));
    await expect(refused).rejects.toThrow("systemctl --user stop litestream.service, then deleting the outline garden again, then systemctl --user start litestream.service");
    await expect(refused).rejects.toThrow("never litestream reset");
    expect(ran).toBe(false);
    expect(metaDir(join(outlines, "garden.sqlite"))).toBe(join(outlines, ".garden.sqlite-litestream"));
  });

  test("a crash mid-change leaves a record: the next guard (or the host's start) starts the replicator again", async () => {
    const sd = fakeSystemd({ active: true });
    // A change in a process that died after the stop (pid 4242 is dead in this fake).
    await withLitestreamPaused([join(outlines, "garden.sqlite")], "x", () => {
      expect(pausedUnits()).toEqual(["litestream.service"]);
      // Committed, and marked paused only once the stop went through.
      const db = pauses(); expect(JSON.parse((db.query("SELECT record FROM pauses").get() as { record: string }).record).state).toBe("paused"); db.close();
    }, o(sd.run));
    expect(pausedUnits()).toEqual([]);
    pause({ unit: "litestream.service", kind: "systemd", path: "/x", holders: ["4242:1"], since: "2026-05-02T09:00:00Z" });
    sd.calls.length = 0;
    expect(recoverPaused(o(sd.run))).toEqual(["litestream.service"]);
    expect(sd.calls).toEqual(["--user start litestream.service"]);
    expect(pausedUnits()).toEqual([]);
  });

  test("a stop that dies half way (the record still `stopping`, its holder gone) is recovered like any other", () => {
    const sd = fakeSystemd({ active: false });
    pause({ unit: "litestream.service", kind: "systemd", path: "/x", holders: ["4242:1"], since: "2026-05-02T09:00:00Z", state: "stopping" } as never);
    expect(recoverPaused(o(sd.run))).toEqual(["litestream.service"]);
    expect(pausedUnits()).toEqual([]);
  });

  test("paused by a live change in another process: held here too, never started under it", async () => {
    const sd = fakeSystemd({ active: false });
    const other = 4343;
    pause({ unit: "litestream.service", kind: "systemd", path: "/x", holders: [`${other}:1`], since: "2026-05-02T09:00:00Z" });
    const alive = (p: number) => p === process.pid || p === other;
    await withLitestreamPaused([join(outlines, "garden.sqlite")], "x", () => {}, o(sd.run, alive));
    expect(sd.calls.filter(c => c.includes("start") || c.includes("stop"))).toEqual([]);
    expect(holdersOf("litestream.service")).toEqual([`${other}:1`]);
    const db = pauses(); db.run("DELETE FROM pauses"); db.close();
  });

  test("a state or a config it can't read refuses", async () => {
    expect(running({ kind: "launchd", name: "io.example.litestream" }, () => ({ code: 113, out: "Could not find service \"io.example.litestream\" in domain" }), 501)).toBe(false);
    expect(running({ kind: "launchd", name: "io.example.litestream" }, () => ({ code: 5, out: "Input/output error" }), 501)).toBeNull();
    const unknown = (argv: string[]) => ({ code: 1, out: argv[2] === "is-active" ? "unknown-state" : "" });
    await expect(withLitestreamPaused([join(outlines, "garden.sqlite")], "x", () => {}, o(unknown))).rejects.toThrow("its state can't be read");
  });

  test("a template unit is its instances", () => {
    const tpl = litestreamUnits("linux", home).find(u => u.name === "litestream-mirror@.service")!;
    const names = instancesIn("litestream-mirror@float-hub.service loaded active running x\nlitestream-mirror@notes.service loaded active running y\nother.service loaded", tpl.name);
    expect(names).toEqual(["float-hub", "notes"]);
    expect(templateInstance(tpl, "notes")).toMatchObject({ name: "litestream-mirror@notes.service", output: join(home, "outline-mirrors/laptop/notes.sqlite") });
  });

  test("a start that fails after the change leaves no holder (this process lives on), marked failed, and is retried until it works", async () => {
    const sd = fakeSystemd({ active: true, startFails: 2 });
    const log: string[] = [];
    const opts = { ...o(sd.run), retryDelays: [5], log: (l: string) => log.push(l) };
    await withLitestreamPaused([join(outlines, "garden.sqlite")], "deleting garden", () => {}, opts);
    // The record has no holder: a live host process must not keep the replicator stopped.
    expect(holdersOf("litestream.service")).toEqual([]);
    expect(stuckPauses(opts)).toMatchObject([{ unit: "litestream.service", attempts: 1, error: expect.stringContaining("masked"), fix: "systemctl --user start litestream.service" }]);
    for (let waited = 0; stuckPauses(opts).length && waited < 2000; waited += 10) await Bun.sleep(10);
    cancelRetry();
    expect(stuckPauses(opts)).toEqual([]);
    expect(pausedUnits()).toEqual([]);
    expect(sd.calls.filter(c => c.endsWith("start litestream.service")).length).toBe(3);
    expect(log.some(l => l.includes("still stopped after try 1"))).toBe(true);
    expect(log.some(l => l.includes("started again (try 2)"))).toBe(true);
  });

  test("recoverPaused that can't start it keeps the record and marks the failure, counting tries", () => {
    const sd = fakeSystemd({ active: false, startFails: 1 });
    pause({ unit: "litestream.service", kind: "systemd", path: "/x", holders: ["4242:1"], since: "2026-05-02T09:00:00Z" });
    expect(recoverPaused(o(sd.run))).toEqual([]);
    expect(stuckPauses(o(sd.run))).toMatchObject([{ attempts: 1 }]);
    expect(recoverPaused(o(sd.run))).toEqual(["litestream.service"]);
    expect(pausedUnits()).toEqual([]);
  });

  test("records that can't be read are an error, never \"none stuck\"; a pause a live change holds is still pending", () => {
    const broken = join(root, "broken");
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "pauses.sqlite"), "not a database");
    expect(() => stuckPauses({ records: broken })).toThrow();
    expect(stuckPauses({ records: join(root, "none-yet") })).toEqual([]);
    pause({ unit: "litestream.service", kind: "systemd", path: "/x", holders: [`${process.pid}:9`], since: "2026-05-02T09:00:00Z" });
    expect(stuckPauses(o(fakeSystemd({ active: true }).run))).toEqual([]);
    expect(anyPaused(o(fakeSystemd({ active: true }).run))).toBe(true);
    const db = pauses(); db.run("DELETE FROM pauses"); db.close();
  });
});
