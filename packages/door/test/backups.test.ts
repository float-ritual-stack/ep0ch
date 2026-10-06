// `ep0ch doctor`'s backup checks (PIE-371): Litestream units read from a scratch home, a fake `run` standing in for
// systemctl, journalctl and `litestream ltx`/`restore`, and the verdicts on described replicas. Fictional names; no
// bucket, no real unit.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  backupChecks, configDatabases, etimeSeconds, gatherBackups, litestreamArgv, litestreamUnits, localTxid, logErrors, mirrorHealth,
  mirrorVerdict, parseLtxList, replicaUrl, replicaVerdict, STALE_AFTER_MS, type LitestreamUnit, type ReplicaFacts,
} from "../src/setup/backups";
import { scratchDir } from "./scratch";

const NOW = Date.parse("2026-03-14T12:00:00Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const ltx = (rows: { level?: number; min: number; max: number; at: string }[]) =>
  JSON.stringify(rows.map(r => ({ level: r.level ?? 0, min_txid: r.min.toString(16).padStart(16, "0"), max_txid: r.max.toString(16).padStart(16, "0"), size: 10, timestamp: r.at })));
const pos = (rows: Parameters<typeof ltx>[0]) => { const p = parseLtxList(ltx(rows)); if ("error" in p) throw new Error(p.error); return p; };
const unit = (o: Partial<LitestreamUnit> = {}): LitestreamUnit => ({ kind: "systemd", name: "litestream.service", path: "/fictional/litestream.service", role: "replicate", wrapper: [], litestream: "litestream", config: "/fictional/litestream.yml", ...o });

describe("reading Litestream units and configs", () => {
  test("argv: the wrapper, the binary, replicate or a follower's output, the config", () => {
    expect(litestreamArgv(["/u/.local/bin/with-secrets", "bucket-keys", "--", "/u/.local/bin/litestream", "replicate", "-config", "/u/ls.yml"]))
      .toEqual({ wrapper: ["/u/.local/bin/with-secrets", "bucket-keys", "--"], litestream: "/u/.local/bin/litestream", role: "replicate", config: "/u/ls.yml" });
    expect(litestreamArgv(["litestream", "restore", "-f", "-follow-interval", "10s", "-config", "/u/m.yml", "/u/mirrors/far/garden.sqlite"]))
      .toMatchObject({ role: "follow", output: "/u/mirrors/far/garden.sqlite", config: "/u/m.yml" });
    expect(litestreamArgv(["litestream", "restore", "-o", "/tmp/x", "s3://b/x"])).toBeNull();
    expect(litestreamArgv(["bun", "host-main.ts"])).toBeNull();
    expect(litestreamArgv(["litestream", "replicate"])).toMatchObject({ config: "/etc/litestream.yml" });
  });

  test("a replica's URL: a dir entry's database under its path, with the endpoint and region", () => {
    const r = { type: "s3", bucket: "fictional-bucket", path: "box-a/outlines", endpoint: "https://objects.example.test", region: "r1" };
    expect(replicaUrl(r, "garden.sqlite")).toBe("s3://fictional-bucket/box-a/outlines/garden.sqlite?endpoint=https://objects.example.test&region=r1");
    expect(replicaUrl({ ...r, path: "box-a/outlines/garden.sqlite" })).toBe("s3://fictional-bucket/box-a/outlines/garden.sqlite?endpoint=https://objects.example.test&region=r1");
    expect(replicaUrl({ url: "s3://b/p" }, "x.sqlite")).toBe("s3://b/p/x.sqlite");
    expect(replicaUrl(undefined)).toBeNull();
  });

  test("ps etime as seconds", () => {
    expect(etimeSeconds("05:07")).toBe(307);
    expect(etimeSeconds("2-03:04:05")).toBe(((2 * 24 + 3) * 60 + 4) * 60 + 5);
    expect(etimeSeconds("nope")).toBeNull();
  });

  test("a log's ERROR lines: the count in the last hour, the latest, the latest per database", () => {
    const line = (min: number, db: string, msg = "monitor error") => `time=${at(min)} level=ERROR msg="${msg}" system=store db=${db} replica=s3 error="open ltx file /o/.${db}-litestream/ltx/0/0000000000000001-0000000000000001.ltx: no such file or directory"`;
    const text = [line(120, "attic.sqlite"), `time=${at(50)} level=INFO msg="compaction complete" db=garden.sqlite`, line(30, "garden.sqlite"), line(5, "attic.sqlite")].join("\n");
    const errors = logErrors(text, NOW);
    expect(errors.errorsLastHour).toBe(2);
    expect(errors.latest?.at).toBe(at(5));
    expect(Object.keys(errors.byDb).sort()).toEqual(["attic.sqlite", "garden.sqlite"]);
    expect(errors.lostState).toEqual(["attic.sqlite", "garden.sqlite"]);
    // What a process before the running one logged is history.
    expect(logErrors(text, NOW, NOW - 10 * 60_000)).toMatchObject({ errorsLastHour: 1, lostState: ["attic.sqlite"] });
    expect(logErrors("", NOW)).toEqual({ errorsLastHour: 0, byDb: {} });
  });
});

describe("verdicts", () => {
  const db = (o: Partial<ReplicaFacts>): ReplicaFacts => ({ name: "garden", path: "/o/garden.sqlite", url: "s3://b/box-a/outlines/garden.sqlite", replica: { error: "unset" }, ...o });

  test("a replica as far as its database is current; behind only while the last write is recent", () => {
    expect(replicaVerdict(unit(), db({ local: { txid: 9, lastWrite: NOW - 60 * 60_000 }, replica: pos([{ min: 1, max: 9, at: at(59) }]) }), NOW, "/h").status).toBe("ok");
    const uploading = replicaVerdict(unit(), db({ local: { txid: 10, lastWrite: NOW - 60_000 }, replica: pos([{ min: 1, max: 9, at: at(30) }]) }), NOW, "/h");
    expect(uploading).toMatchObject({ status: "ok", detail: expect.stringContaining("uploading") });
    const stale = replicaVerdict(unit(), db({ local: { txid: 10, lastWrite: NOW - STALE_AFTER_MS - 60_000 }, replica: pos([{ min: 1, max: 9, at: at(90) }]) }), NOW, "/h");
    expect(stale).toMatchObject({ status: "missing", detail: expect.stringContaining("stale"), fix: "systemctl --user restart litestream.service" });
    // Written all the time, uploading nothing: stale since the first write the replica lacks, however recent the last.
    const busy = replicaVerdict(unit(), db({ local: { txid: 30, lastWrite: NOW - 30_000, written: [{ txid: 9, at: NOW - 3 * 3_600_000 }, { txid: 10, at: NOW - 2 * 3_600_000 }, { txid: 30, at: NOW - 30_000 }] }, replica: pos([{ min: 1, max: 9, at: at(180) }]) }), NOW, "/h");
    expect(busy).toMatchObject({ status: "missing", detail: expect.stringContaining("stale since 2026-03-14 10:00Z") });
  });

  test("a replica ahead of its database (local state reset, old history kept) is said, with the fresh start", () => {
    const v = replicaVerdict(unit({ kind: "launchd", name: "io.example.litestream", path: "/h/Library/LaunchAgents/io.example.litestream.plist" }),
      db({ local: { txid: 2, lastWrite: NOW - 60_000 }, replica: pos([{ level: 9, min: 1, max: 0x1a6, at: at(40) }, { min: 1, max: 2, at: at(5) }]) }), NOW, "/h");
    expect(v.status).toBe("missing");
    expect(v.detail).toContain("the replica holds txid 1a6 but the database's replication is at 2");
    expect(v.fix).toContain("launchctl bootout gui/$(id -u)/io.example.litestream");
    expect(v.fix).toContain("mv /o/.garden.sqlite-litestream /h/backups/ep0ch/litestream-state-");
    expect(v.fix).toContain("in the bucket, delete s3://b/box-a/outlines/garden.sqlite/");
    expect(v.fix).toContain("launchctl bootstrap gui/$(id -u) /h/Library/LaunchAgents/io.example.litestream.plist");
    expect(replicaVerdict(unit(), db({ local: { txid: null, lastWrite: NOW }, replica: pos([{ min: 1, max: 3, at: at(5) }]) }), NOW, "/h").detail).toContain("never been replicated");
    expect(replicaVerdict(unit(), db({ local: { txid: 3, lastWrite: NOW } }), NOW, "/h").status).toBe("unknown");
  });

  test("a mirror: current, following, stale since the first file it missed, or stuck under a restarted history", () => {
    const follower = unit({ role: "follow", name: "mirror-follow.service", output: "/m/far/garden.sqlite" });
    const m = (txid: number, rows: Parameters<typeof ltx>[0]) => mirrorVerdict(follower, db({ path: "/m/far/garden.sqlite", mirror: { txid }, replica: pos(rows) }), NOW);
    expect(m(9, [{ min: 1, max: 9, at: at(60) }]).status).toBe("ok");
    expect(m(9, [{ min: 1, max: 9, at: at(60) }, { min: 10, max: 10, at: at(2) }]).detail).toContain("following");
    const behind = m(9, [{ min: 1, max: 9, at: at(60) }, { min: 10, max: 10, at: at(45) }, { min: 11, max: 11, at: at(20) }]);
    expect(behind).toMatchObject({ status: "missing", staleSince: at(45), fix: "systemctl --user restart mirror-follow.service" });
    const stuck = m(0x1a6, [{ level: 9, min: 1, max: 0x1a6, at: at(60) }, { min: 1, max: 2, at: at(20) }]);
    expect(stuck).toMatchObject({ status: "missing", staleSince: at(20) });
    expect(stuck.detail).toContain("history restarted");
  });
});

describe("gathering from a scratch home, with a fake run", () => {
  let home = "";
  const calls: string[][] = [];
  const replicas: Record<string, string> = {};
  const run = async (argv: string[], o: { env?: Record<string, string | undefined> } = {}) => {
    calls.push(argv);
    const cmd = argv.find(a => a.endsWith("litestream")) ? argv[argv.findIndex(a => a.endsWith("litestream")) + 1] : argv[0];
    if (argv[0] === "systemctl") return { code: 0, out: argv.includes("mirror-follow.service") ? "ActiveState=active\nSubState=running\nMainPID=4242\nExecMainStatus=0" : "ActiveState=active\nSubState=running\nMainPID=4141\nExecMainStatus=0", err: "" };
    if (argv[0] === "ps") return { code: 0, out: " 01:00:00\n", err: "" };
    if (argv[0] === "journalctl") return { code: 0, out: argv.includes("litestream.service") ? `time=${new Date(Date.now() - 60_000).toISOString()} level=ERROR msg="monitor error" db=attic.sqlite error="open ltx file /x/ltx/0/0000000000000001-0000000000000001.ltx: no such file or directory"` : "", err: "" };
    if (cmd === "ltx") {
      // The keys came from the unit's EnvironmentFile, only into this process.
      if (o.env?.FICTIONAL_KEY !== "not-a-real-key") return { code: 1, out: "", err: "no credentials" };
      const url = argv.at(-1)!;
      const found = Object.entries(replicas).find(([k]) => url.includes(k));
      return found ? { code: 0, out: found[1], err: "" } : { code: 1, out: "", err: "not found" };
    }
    if (cmd === "restore") {
      const out = argv[argv.indexOf("-o") + 1]!;
      const d = new Database(out); d.exec("CREATE TABLE t (x); INSERT INTO t VALUES (1);"); d.close();
      return { code: 0, out: "", err: "" };
    }
    return { code: 1, out: "", err: `unexpected ${argv.join(" ")}` };
  };

  beforeAll(() => {
    home = scratchDir("ep0ch-backups-");
    const units = join(home, ".config/systemd/user"), outlines = join(home, "outlines"), mirrors = join(home, "outline-mirrors/far-box");
    for (const d of [units, outlines, mirrors, join(home, "secrets"), join(outlines, ".garden.sqlite-litestream/ltx/0"), join(outlines, ".attic.sqlite-litestream/ltx/0")]) mkdirSync(d, { recursive: true });
    writeFileSync(join(home, "secrets/bucket.env"), "FICTIONAL_KEY=not-a-real-key\n");
    writeFileSync(join(units, "litestream.service"), `[Service]\nEnvironmentFile=%h/secrets/bucket.env\nExecStart=%h/bin/litestream replicate -config %h/ls.yml\n`);
    writeFileSync(join(units, "mirror-follow.service"), `[Service]\nEnvironmentFile=%h/secrets/bucket.env\nExecStart=%h/bin/litestream restore -f -follow-interval 10s -config %h/mirrors.yml %h/outline-mirrors/far-box/garden.sqlite\n`);
    writeFileSync(join(units, "outliner-host.service"), `[Service]\nExecStart=bun host-main.ts\n`);
    const replica = (path: string) => `    replica:\n      type: s3\n      bucket: fictional-bucket\n      path: ${path}\n      endpoint: https://objects.example.test\n      region: r1\n`;
    writeFileSync(join(home, "ls.yml"), `dbs:\n  - dir: ${outlines}\n    pattern: "*.sqlite"\n    watch: true\n${replica("box-b/outlines")}`);
    writeFileSync(join(home, "mirrors.yml"), `dbs:\n  - path: ${join(mirrors, "garden.sqlite")}\n${replica("far-box/outlines/garden.sqlite")}`);
    for (const f of ["garden.sqlite", "attic.sqlite", "garden.sqlite.owner.sqlite", ".hidden-copy.sqlite"]) writeFileSync(join(outlines, f), "");
    const old = (NOW - 60 * 60_000) / 1000;
    utimesSync(join(outlines, "garden.sqlite"), old, old);
    utimesSync(join(outlines, "attic.sqlite"), old, old);
    writeFileSync(join(outlines, ".garden.sqlite-litestream/ltx/0/0000000000000009-0000000000000009.ltx"), "");
    writeFileSync(join(outlines, ".attic.sqlite-litestream/ltx/0/0000000000000002-0000000000000002.ltx"), "");
    writeFileSync(join(mirrors, "garden.sqlite"), "");
    writeFileSync(join(mirrors, "garden.sqlite-txid"), "0000000000000004\n");
    replicas["box-b/outlines/garden.sqlite"] = ltx([{ min: 1, max: 9, at: at(70) }]);
    replicas["box-b/outlines/attic.sqlite"] = ltx([{ level: 9, min: 1, max: 0x40, at: at(80) }, { min: 1, max: 2, at: at(70) }]);
    replicas["far-box/outlines/garden.sqlite"] = ltx([{ min: 1, max: 4, at: at(90) }, { min: 5, max: 6, at: at(40) }]);
  });
  afterAll(() => { if (home) rmSync(home, { recursive: true, force: true }); });

  test("the units: a replicator and a follower, never the host's unit", () => {
    expect(litestreamUnits("linux", home).map(u => [u.name, u.role])).toEqual([["litestream.service", "replicate"], ["mirror-follow.service", "follow"]]);
    expect(configDatabases(`dbs:\n  - dir: ${join(home, "outlines")}\n    pattern: "*.sqlite"\n`).map(d => d.path.split("/").pop())).toEqual(["attic.sqlite", "garden.sqlite"]);
    expect(localTxid(join(home, "outlines/garden.sqlite"))).toBe(9);
  });

  test("doctor's checks: running units, the log's errors with the fresh start, each replica and the mirror; no key printed", async () => {
    const b = await gatherBackups({ platform: "linux", home, env: { PATH: "/usr/bin" }, run, now: NOW, restore: true });
    const checks = backupChecks(b, home);
    const by = Object.fromEntries(checks.map(c => [c.name, c]));
    expect(by["replicator litestream.service"]).toMatchObject({ status: "ok", detail: expect.stringContaining("pid 4141, up since") });
    expect(by["replicator litestream.service log"]).toMatchObject({ status: "missing", detail: expect.stringContaining("1 ERROR line in the last hour") });
    expect(by["replicator litestream.service log"]!.fix).toContain("attic.sqlite: Litestream lost a file of its local state");
    expect(by["replica garden"]).toMatchObject({ status: "ok" });
    expect(by["replica attic"]).toMatchObject({ status: "missing", detail: expect.stringContaining("the replica holds txid 40") });
    expect(by["mirror garden"]).toMatchObject({ status: "missing", detail: expect.stringContaining(`stale since`) });
    expect(by["restore garden"]).toMatchObject({ status: "ok", detail: expect.stringContaining("integrity_check ok") });
    expect(checks.map(c => c.name)).not.toContain("replica garden.sqlite.owner");
    expect(JSON.stringify(checks)).not.toContain("not-a-real-key");
    // ltx ran the way the unit runs Litestream: its binary; restore wrote only under the temp folder.
    expect(calls.filter(c => c.includes("ltx")).every(c => c[0] === join(home, "bin/litestream"))).toBe(true);
    expect(calls.filter(c => c.includes("restore") && c.includes("-o")).every(c => c[c.indexOf("-o") + 1]!.includes("ep0ch-restore-"))).toBe(true);
  });

  test("the gateway's question about one mirror: stale since the first replica file it missed", async () => {
    const stale = await mirrorHealth(join(home, "outline-mirrors/far-box/garden.sqlite"), { platform: "linux", home, env: {}, run, now: NOW });
    expect(stale).toEqual({ since: at(40), why: expect.stringContaining("the mirror is at txid 4, the replica at 6") });
    expect(await mirrorHealth(join(home, "outline-mirrors/far-box/other.sqlite"), { platform: "linux", home, env: {}, run, now: NOW })).toBeNull();
  });
});
