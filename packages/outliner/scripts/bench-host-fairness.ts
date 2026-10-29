// Can a bulk job starve the outline host (PIE-1413)? On Oct 29 a write-review backfill (`ep0ch review backfill --into
// pie`) froze pie's host: stalls of 5–8 s per note's records, door requests queued up to 64 s while it ran and ~200 s in
// the catch-up after it stopped. This serves a pie-shaped fictional outline (or a private copy, `--copy`) to the clients
// a working day has, runs the bulk jobs, and measures what a person would feel.
//
//   bun scripts/bench-host-fairness.ts [--shape pie|small] [--copy <file.sqlite>] [--outliner <package dir>]
//                                      [--import <n>] [--import-s 60] [--since 7d] [--limit <notes>] [--backfill-s 120]
//                                      [--crowd] [--no-door] [--check] [--json <file>] [--log <file>] [--profile <dir>] [--keep]
//
// The clients, as Evan's day has them: a real door on the Desk (the door package's scripts/bench-door-desk.ts: its own
// App on one connection, a board tile on the hub of saved views and a live query tile over the records the backfill
// writes, the person reading a note's children and saving through it, every request it makes timed from its side), a
// second door's watched reads (~17, among them the Jev suggestions page's queries over those records, asked again when
// `queries.changed` says so, and its held and waiting asks 400 ms after a change, as the door's ServiceLists do), the
// publisher and an MCP gateway subscribed. --crowd adds a third door, a Herdr Tree that reads the tree and every saved
// view after each change, and two Details. A probe pings every 50 ms on its own connection.
//
// The phases: idle (and a few ordinary operations timed), backfill (the real `reviewBackfill` with `into`, Jev off,
// stopped at --backfill-s if it hasn't finished),
// after (10 s), import (`--import` creates, four at once, stopped halfway or at --import-s by closing its
// connections), after-stop
// (10 s), then convergence: every door's watched answers against the same read asked fresh.
//
// Reported per phase: ping p50, p95, p99 and max; the host's longest loop stall and stalled total; what the doors heard
// (content events, queries.changed, reads asked again). `--check` exits 1 unless ping p95 < 200 ms in every phase, no
// stall over 1 s, every watch converged, and the ordinary operations within budget (p95: a note read and a save
// `--ops-budget`, 200 ms; a whole-outline query `--query-budget`, 1 s).
// Never a real outline: the outlines folder is a temp dir (a copy is copied in first), removed unless --keep.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { OutlinerClient } from "../src/client";
import { reviewBackfill } from "../src/write-review-backfill";
import { fixturePaths, makeOutline, type FixtureShape } from "./host-bench/fixture";
import { Conn, quantile } from "./host-bench/wire";

const { values } = parseArgs({
  options: {
    shape: { type: "string" }, copy: { type: "string" }, outliner: { type: "string" }, import: { type: "string" }, since: { type: "string" },
    check: { type: "boolean" }, "backfill-s": { type: "string" }, "import-s": { type: "string" }, profile: { type: "string" }, log: { type: "string" }, "no-door": { type: "boolean" }, crowd: { type: "boolean" }, json: { type: "string" }, keep: { type: "boolean" }, "ops-budget": { type: "string" }, "query-budget": { type: "string" }, limit: { type: "string" },
  },
});
const outliner = resolve(values.outliner ?? join(import.meta.dir, ".."));
const shape = (values.shape ?? "pie") as FixtureShape;
const importCount = Number(values.import ?? 3000);
const opsBudget = Number(values["ops-budget"] ?? 200);
// A whole-outline query waits behind the Tree's and the doors' reads of the same change (on main: p95 ~1.5 s).
const queryBudget = Number(values["query-budget"] ?? 1_000);
const root = mkdtempSync(join(process.env.EP0CH_BENCH_TMP ?? tmpdir(), "host-fairness-"));
const outlines = join(root, "outlines");
const socket = join(outlines, ".host", "host.sock");
const OUTLINE = "bench";
const paths = fixturePaths(outlines, OUTLINE);

// ─── The outline ─────────────────────────────────────────────────────────

const made = performance.now();
let probe: string, hub: string, viewIds: string[], boardHub: string;
mkdirSync(paths.workspaceRoot, { recursive: true });
if (values.copy) {
  copyFileSync(resolve(values.copy), paths.database);
  const { Database } = await import("bun:sqlite");
  const db = new Database(paths.database, { readonly: true });
  const one = (sql: string) => (db.query(sql).get() as { id: string } | null)?.id ?? "";
  viewIds = (db.query("SELECT block_id AS id FROM block_properties WHERE key = 'type' AND value = 'virtual-branch'").all() as { id: string }[]).map(r => r.id).slice(0, 10);
  probe = one("SELECT id FROM blocks WHERE deleted_at IS NULL ORDER BY id LIMIT 1 OFFSET 5000");
  hub = one("SELECT parent_id AS id FROM blocks WHERE parent_id IS NOT NULL AND deleted_at IS NULL GROUP BY parent_id ORDER BY count(*) DESC LIMIT 1") || probe;
  // The board: the hub with the most saved views under it.
  boardHub = one("SELECT b.parent_id AS id FROM blocks b JOIN block_properties p ON p.block_id = b.id AND p.key = 'type' AND p.value = 'virtual-branch' WHERE b.parent_id IS NOT NULL AND b.deleted_at IS NULL GROUP BY b.parent_id ORDER BY count(*) DESC LIMIT 1");
  db.close();
  console.log(`outline: a private copy of ${values.copy}`);
} else {
  const fixture = makeOutline(paths.database, paths.workspaceRoot, shape);
  ({ probe, hub } = fixture);
  boardHub = fixture.board;
  viewIds = fixture.viewIds.slice(0, 10);
  console.log(`outline: ${shape}-shaped fixture, ${fixture.notes} notes, ${fixture.views} saved views (${((performance.now() - made) / 1000).toFixed(1)} s)`);
}

// ─── The host ────────────────────────────────────────────────────────────

let phase = "start-up";
const phaseAt = performance.now();
/** The host's CPU time (user + system, ms) from /proc, to say how busy each phase kept it. */
const cpuMs = () => { try { const f = readFileSync(`/proc/${host.pid}/stat`, "utf8").split(") ")[1]!.split(" "); return (Number(f[11]) + Number(f[12])) * 10; } catch { return NaN; } };
const busy: Record<string, number> = {};
let phaseCpu = 0, phaseWall = 0;
const enter = (name: string) => {
  const cpu = cpuMs(), wall = performance.now();
  if (phaseWall) busy[phase] = Math.round((cpu - phaseCpu) / (wall - phaseWall) * 100);
  phaseCpu = cpu; phaseWall = wall;
  phase = name;
  console.error(`[${((performance.now() - phaseAt) / 1000).toFixed(0)} s] ${name}`);
  door?.stdin.write(`phase ${name}\n`);
};
const hostLog: Array<{ phase: string; line: string }> = [];
// --profile <dir>: the host's CPU profile, as markdown, written there when it stops.
const profile = values.profile ? ["--cpu-prof", "--cpu-prof-md", `--cpu-prof-dir=${resolve(values.profile)}`] : [];
const host = Bun.spawn([process.execPath, ...profile, join(outliner, "src/host-main.ts")], {
  cwd: outliner, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  env: { PATH: process.env.PATH ?? "", HOME: root, EP0CH_OUTLINES: outlines, TMPDIR: root },
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { host.kill("SIGKILL"); process.exit(130); });
for (const stream of [host.stdout, host.stderr] as ReadableStream<Uint8Array>[]) {
  void (async () => { for await (const chunk of stream.pipeThrough(new TextDecoderStream())) for (const line of chunk.split("\n")) if (line) hostLog.push({ phase, line }); })();
}
for (;;) {
  const ping = new Conn(socket, OUTLINE);
  const answer = await ping.request({ action: "ping" }, 500);
  ping.close();
  if (!answer.error) break;
  await Bun.sleep(50);
}

// ─── The clients ─────────────────────────────────────────────────────────

interface Heard { content: number; queriesChanged: number; asked: number; chrome: number }
const heard: Record<string, Heard> = {};
const count = (key: keyof Heard, n = 1) => { (heard[phase] ??= { content: 0, queriesChanged: 0, asked: 0, chrome: 0 })[key] += n; };
const subscribe = (conn: Conn, role: string) => conn.request({ action: "events.subscribe", client: { clientId: `${role}-${crypto.randomUUID()}`, contextId: `bench-${role}-${crypto.randomUUID()}`, role } });

/** A door: its watched reads (ADR 0004), asked again only when the service says one changed, and its ServiceLists. */
class Door {
  readonly conn: Conn;
  readonly watches = new Map<string, { request: Record<string, unknown>; generation: number; hash: string }>();
  private chromeTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(readonly name: string) {
    this.conn = new Conn(socket, OUTLINE, event => this.heard(event));
  }
  async start(): Promise<void> {
    await subscribe(this.conn, "observer");
    const reads: Array<[string, Record<string, unknown>]> = [
      // The suggestions page's reads: Jev's records are machinery, so it shows them (PIE-867).
      ["jev-recent", { action: "blocks.query", query: { where: "type=review-finding", sort: "updated desc", limit: 50, machinery: "show" } }],
      ["jev-rubric", { action: "blocks.query", query: { where: "type=review-finding source=backfill", group: "rubric", limit: 1, machinery: "show" } }],
      ["jev-writer", { action: "blocks.query", query: { where: "type=review-finding", group: "writer", limit: 1, machinery: "show" } }],
      // A figure over what an import writes.
      ["packets", { action: "blocks.query", query: { where: "type=packet", group: "bed", limit: 20, sort: "updated desc" } }],
      ["doing", { action: "blocks.query", query: { where: "type=roadmap-item AND work-stage=doing", limit: 50 } }],
      ["review", { action: "blocks.query", query: { where: "type=roadmap-item AND work-stage=review", limit: 50 } }],
      ["backlinks", { action: "references.backlinks", query: { targetBlockId: hub, limit: 50 } }],
      ...viewIds.map((viewId, i): [string, Record<string, unknown>] => [`view-${i}`, { action: "views.read", viewId }]),
    ];
    for (const [key, request] of reads) {
      const answer = await this.conn.request<Record<string, unknown>>({ ...request, watch: key });
      if (answer.error) { console.error(`bench: ${this.name} couldn't watch ${key}: ${answer.error}`); continue; }
      this.watches.set(key, { request, generation: Number(answer.result?.generation ?? 0), hash: hashOf(answer.result) });
    }
    await this.chrome();
  }
  private heard(event: Record<string, any>): void {
    if (event.domain === "content") {
      count("content");
      if (this.chromeTimer) clearTimeout(this.chromeTimer);
      this.chromeTimer = setTimeout(() => { this.chromeTimer = null; void this.chrome(); }, 400);
    }
    if (event.action === "queries.changed") {
      count("queriesChanged");
      for (const change of event.changes as Array<{ key: string; generation: number; dropped?: boolean }>) void this.again(change.key, change.dropped ? undefined : change.generation);
    }
  }
  /** One read in flight per watch, the newest generation asked next, as the door's Watched does. */
  private readonly asking = new Map<string, { next: number | undefined | null }>();
  private async again(key: string, generation: number | undefined): Promise<void> {
    const watch = this.watches.get(key);
    if (!watch) return;
    const inFlight = this.asking.get(key);
    if (inFlight) { inFlight.next = generation; return; }
    const state = { next: null as number | undefined | null };
    this.asking.set(key, state);
    for (let asked: number | undefined | null = generation; asked !== null; asked = state.next, state.next = null) {
      count("asked");
      const answer = await this.conn.request<Record<string, unknown>>({ ...watch.request, watch: key, ...(asked === undefined ? {} : { generation: asked }) });
      if (answer.result && Number(answer.result.generation ?? 0) >= watch.generation) {
        watch.generation = Number(answer.result.generation ?? 0);
        watch.hash = hashOf(answer.result);
      }
    }
    this.asking.delete(key);
  }
  private async chrome(): Promise<void> {
    count("chrome");
    await Promise.all([this.conn.request({ action: "agents.held" }), this.conn.request({ action: "waiting.list" })]);
  }
}

/** A subscribed client that reads again after each content change, coalesced while a read is in flight (Tree, Detail). */
class Reader {
  readonly conn: Conn;
  private reading: Promise<unknown> | null = null;
  private again = false;
  constructor(role: string, private readonly read: (conn: Conn) => Promise<unknown>) {
    this.conn = new Conn(socket, OUTLINE, event => { if (event.domain === "content") this.refresh(); });
    void subscribe(this.conn, role).then(() => this.refresh());
  }
  private refresh(): void {
    if (this.reading) { this.again = true; return; }
    this.reading = this.read(this.conn).finally(() => { this.reading = null; if (this.again) { this.again = false; this.refresh(); } });
  }
}

/** An answer's identity, as the service hashes it: everything but the sequence and generation. */
function hashOf(result: unknown): string {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => k !== "sequence" && k !== "generation").sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, strip(v)]));
    return value;
  };
  return Bun.hash(JSON.stringify(strip(result))).toString(36);
}

// A real door on the Desk (the door package's scripts/bench-door-desk.ts): its own App on one connection, with a board
// tile on the hub of saved views and a live query tile over the records the backfill writes; the person's reads and
// saves go through it. Its requests are timed from its side (PIE-1413's second round: the probe passed while this
// connection starved). --no-door leaves it out.
const doorScript = join(outliner, "..", "door", "scripts", "bench-door-desk.ts");
const door = !values["no-door"] && existsSync(doorScript) ? Bun.spawn([process.execPath, doorScript, "--socket", socket, "--outline", OUTLINE, "--hub", boardHub, "--note", probe, "--query", "type=review-finding"], {
  cwd: join(outliner, "..", "door"), stdin: "pipe", stdout: "pipe", stderr: "inherit",
  env: { PATH: process.env.PATH ?? "", HOME: root, TMPDIR: root, EP0CH_STATE: join(root, "door-state"), EP0CH_CONTROL: join(root, "door.sock"), EP0CH_DAEMON: "0" },
}) : null;
if (door) await Bun.sleep(5_000);

// Evan's day: the real door above, a second door's watched reads, the publisher and an MCP gateway. --crowd adds what a
// heavier day has: a third door, a Herdr Tree reading the tree and every view after each change, two Details.
const crowd = !!values.crowd;
const doors = crowd ? [new Door("door-1"), new Door("door-2")] : [new Door("door-1")];
await Promise.all(doors.map(door => door.start()));
const readers = [
  ...(crowd ? [
    new Reader("tree", conn => Promise.all([conn.request({ action: "tree.index" }), ...viewIds.map(viewId => conn.request({ action: "views.read", viewId, format: "tree" }))])),
    ...[0, 1].map(() => new Reader("detail", conn => Promise.all([conn.request({ action: "callouts.types" }), conn.request({ action: "headings.styles" }), conn.request({ action: "get", blockId: probe })]))),
  ] : []),
  new Reader("observer", async () => {}), new Reader("observer", async () => {}),
];

// ─── The probe ───────────────────────────────────────────────────────────

const pings: Record<string, number[]> = {};
let probing = true;
const probeConn = new Conn(socket, OUTLINE);
const probing$ = (async () => {
  while (probing) {
    const at = phase;
    const answer = await probeConn.request({ action: "ping" }, 300_000);
    (pings[at] ??= []).push(answer.error ? 300_000 : answer.ms);
    await Bun.sleep(50);
  }
})();

/** A few ordinary operations, one at a time: what a person does between bulk jobs. */
async function ops(label: string): Promise<Record<string, { p50: number; p95: number }>> {
  const conn = new Conn(socket, OUTLINE);
  const note = (await conn.request<{ id: string; revision: number }>({ action: "create", text: "Bench scratch note", author: "agent", actorId: "bench" })).result!;
  let block = note;
  const times: Record<string, number[]> = { get: [], query: [], update: [] };
  for (let i = 0; i < 30; i++) {
    times.get!.push((await conn.request({ action: "get", blockId: probe })).ms);
    times.query!.push((await conn.request({ action: "blocks.query", query: { where: "type=roadmap-item", limit: 20 } })).ms);
    const answer = await conn.request<{ id: string; revision: number }>({ action: "update", blockId: block.id, text: `Bench scratch note ${i}`, expectedRevision: block.revision, author: "agent", actorId: "bench" });
    times.update!.push(answer.ms);
    if (answer.result) block = answer.result;
    await Bun.sleep(30);
  }
  conn.close();
  const out = Object.fromEntries(Object.entries(times).map(([k, list]) => { const s = [...list].sort((a, b) => a - b); return [k, { p50: Math.round(quantile(s, 0.5)), p95: Math.round(quantile(s, 0.95)) }]; }));
  console.log(`ops ${label}: ${Object.entries(out).map(([k, v]) => `${k} p50 ${v.p50} p95 ${v.p95} ms`).join(", ")}`);
  return out;
}

// ─── The run ─────────────────────────────────────────────────────────────

await Bun.sleep(3_000);
enter("idle");
const opsBefore = await ops("idle");
await Bun.sleep(3_000);

enter("backfill");
// The writer is stopped at --backfill-s, as a person stops a run that takes too long: its next request is refused.
const client = new OutlinerClient(socket, 300_000, OUTLINE);
const startedBackfill = performance.now();
const deadline = startedBackfill + Number(values["backfill-s"] ?? 120) * 1_000;
let keeps = 0;
const writer = {
  request: (input: { action: string }, timeoutMs?: number) => {
    if (performance.now() > deadline) return Promise.reject(new Error("stopped"));
    if (input.action === "suggestions.keep") keeps += 1;
    return client.request(input as never, timeoutMs);
  },
};
let stopped = false;
const report = await reviewBackfill(writer as never, { since: values.since ?? "7d", jev: false, into: writer as never, limit: Number(values.limit ?? 500), outline: OUTLINE })
  .catch(error => { if ((error as Error).message !== "stopped") throw error; stopped = true; return null; });
const backfillMs = performance.now() - startedBackfill;
console.log(report
  ? `backfill: ${report.reviewed} notes reviewed, ${report.flagged} flagged, ${report.findings} findings, ${keeps} keeps in ${(backfillMs / 1000).toFixed(1)} s`
  : `backfill: stopped at ${(backfillMs / 1000).toFixed(1)} s after ${keeps} keeps`);

enter("after-backfill");
await Bun.sleep(10_000);

enter("import");
let created = 0;
const importers = [0, 1, 2, 3].map(() => new Conn(socket, OUTLINE));
const parent = (await importers[0]!.request<{ id: string }>({ action: "create", text: "Imported [type::hub]", author: "agent", actorId: "bench-import" })).result!.id;
const startedImport = performance.now();
// Stopped halfway, or at --import-s if it gets no further.
const importDeadline = startedImport + Number(values["import-s"] ?? 60) * 1_000;
await Promise.all(importers.map(async (conn, k) => {
  for (let i = k; i < importCount && created < importCount / 2 && performance.now() < importDeadline; i += importers.length) {
    const answer = await conn.request({ action: "create", parentId: parent, text: `Imported ${i} [type::packet] [bed::b${i % 40}]\n\nSown in row ${i % 12}.`, author: "agent", actorId: "bench-import" });
    if (!answer.error) created += 1;
  }
}));
// Stopped halfway, as a person stops a job: its connections go.
for (const conn of importers) conn.close();
const importMs = performance.now() - startedImport;
console.log(`import: ${created} of ${importCount} created in ${(importMs / 1000).toFixed(1)} s, then stopped`);

enter("after-stop");
await Bun.sleep(10_000);

// Convergence: quiet for 2 s (no queries.changed), then every watch's answer against the same read asked fresh.
enter("converge");
const convergeStarted = performance.now();
for (let quietSince = performance.now(), last = -1; performance.now() - convergeStarted < 60_000;) {
  const now = Object.values(heard).reduce((n, h) => n + h.queriesChanged + h.asked, 0);
  if (now !== last) { last = now; quietSince = performance.now(); }
  if (performance.now() - quietSince > 2_000) break;
  await Bun.sleep(100);
}
const stale: string[] = [];
const fresh = new Conn(socket, OUTLINE);
for (const door of doors) {
  for (const [key, watch] of door.watches) {
    const answer = await fresh.request<Record<string, unknown>>(watch.request);
    if (hashOf(answer.result) !== watch.hash) stale.push(`${door.name}:${key}`);
  }
}
fresh.close();
const opsAfter = await ops("after");
probing = false;
await probing$;
for (const conn of [probeConn, ...doors.map(d => d.conn), ...readers.map(r => r.conn)]) conn.close();
enter("report");
type DoorTimed = { phase: string; action: string; ms: number; failed?: true; view?: string };
let doorTimed: DoorTimed[] = [];
let doorTiles = { tiles: 0, stale: 0 };
if (door) {
  door.stdin.write("report\n");
  const out = await Promise.race([new Response(door.stdout).text(), Bun.sleep(90_000).then(() => "")]);
  door.kill();
  try {
    const report = JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as { timed?: DoorTimed[]; tiles?: number; stale?: number };
    doorTimed = report.timed ?? [];
    doorTiles = { tiles: report.tiles ?? 0, stale: report.stale ?? 0 };
  } catch { console.error("bench: the door gave no report"); }
}
host.kill("SIGTERM");
await host.exited;

// ─── Report ──────────────────────────────────────────────────────────────

const stalls: Record<string, number[]> = {};
const slowest: Record<string, string> = {};
/** Each phase's longest stalls, and the requests that held the loop longest (the host's slow_request lines). */
const worst: Record<string, { stalls: Array<{ ms: number; during: string[] }>; requests: Array<Record<string, unknown>> }> = {};
for (const { phase: at, line } of hostLog) {
  const record = line.startsWith("{") ? (() => { try { return JSON.parse(line); } catch { return null; } })() : null;
  if (record?.status === "slow_request" && record.loopMs + record.publishMs >= 100) {
    const list = (worst[at] ??= { stalls: [], requests: [] }).requests;
    list.push(record);
    list.sort((a, b) => (b.loopMs as number) + (b.publishMs as number) - (a.loopMs as number) - (a.publishMs as number)).splice(5);
  }
  if (record?.status !== "loop_stalled") continue;
  const stall = record as { ms: number; during: string[] };
  (stalls[at] ??= []).push(stall.ms);
  if (stall.ms >= Math.max(...stalls[at]!)) slowest[at] = stall.during.slice(0, 3).join(", ") || "nothing the host timed";
  const list = (worst[at] ??= { stalls: [], requests: [] }).stalls;
  list.push(stall);
  list.sort((a, b) => b.ms - a.ms).splice(3);
}
const phases = ["idle", "backfill", "after-backfill", "import", "after-stop", "converge"];
const rows = phases.map(name => {
  const sorted = [...(pings[name] ?? [])].sort((a, b) => a - b);
  const s = stalls[name] ?? [];
  return {
    phase: name, pings: sorted.length, p50: Math.round(quantile(sorted, 0.5)), p95: Math.round(quantile(sorted, 0.95)), p99: Math.round(quantile(sorted, 0.99)), max: Math.round(sorted.at(-1) ?? 0),
    longestStall: s.length ? Math.max(...s) : 0, stalledMs: s.reduce((a, b) => a + b, 0), during: slowest[name] ?? "",
    ...(heard[name] ?? { content: 0, queriesChanged: 0, asked: 0, chrome: 0 }),
  };
});
console.log(`\nphase            pings   p50   p95   p99    max  stall-max  stalled  content  q.changed  asked  chrome  host cpu`);
for (const r of rows) {
  console.log(`${r.phase.padEnd(15)} ${String(r.pings).padStart(6)} ${String(r.p50).padStart(5)} ${String(r.p95).padStart(5)} ${String(r.p99).padStart(5)} ${String(r.max).padStart(6)} ${String(r.longestStall).padStart(10)} ${String(r.stalledMs).padStart(8)} ${String(r.content).padStart(8)} ${String(r.queriesChanged).padStart(10)} ${String(r.asked).padStart(6)} ${String(r.chrome).padStart(7)} ${String(busy[r.phase] ?? "").padStart(8)}%`);
}
for (const r of rows) if (r.during) console.log(`  ${r.phase}: the longest stall ran ${r.during}`);
for (const [at, { requests }] of Object.entries(worst)) {
  if (requests.length) console.log(`  ${at}: held the loop longest: ${requests.map(q => `${q.action} ${q.loopMs}+${q.publishMs} ms`).join(", ")}`);
}
const watchCount = doors.reduce((n, d) => n + d.watches.size, 0);
console.log(`\nconvergence: ${watchCount - stale.length} of ${watchCount} watches agree with a fresh read${stale.length ? `; stale: ${stale.join(", ")}` : ""}`);
// The door's own requests, by phase: everything it asked, and what the person did through it (a note's children, a save).
const PERSON = new Set(["children", "update"]);
const doorRows = phases.map(name => {
  const of = (pick: (t: DoorTimed) => boolean) => { const list = doorTimed.filter(t => t.phase === name && pick(t)).map(t => t.ms).sort((a, b) => a - b); return { n: list.length, p95: Math.round(quantile(list, 0.95)), max: Math.round(list.at(-1) ?? 0) }; };
  const all = of(() => true), person = of(t => PERSON.has(t.action));
  const failed = doorTimed.filter(t => t.phase === name && t.failed).length;
  const slowest = Object.entries(Object.groupBy(doorTimed.filter(t => t.phase === name), t => t.action)).map(([action, list]) => [action, Math.max(...list!.map(t => t.ms))] as const).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a, ms]) => `${a} ${Math.round(ms)}`).join(", ");
  const asked = Object.fromEntries(Object.entries(Object.groupBy(doorTimed.filter(t => t.phase === name), t => t.action)).map(([a, list]) => [a, list!.length]).sort((a, b) => b[1] - a[1]));
  const views = new Set(doorTimed.filter(t => t.phase === name && t.view).map(t => t.view)).size;
  return { phase: name, all, person, failed, slowest, asked, views };
});
if (door) {
  console.log(`\nthe door's own requests  all: n   p95    max   person (children, save): n   p95    max   failed  slowest`);
  console.log(`the door's query tiles (its board's lanes and the query tile): ${doorTiles.tiles - doorTiles.stale} of ${doorTiles.tiles} show what a fresh read gives`);
  for (const r of doorRows) console.log(`${r.phase.padEnd(15)} ${String(r.all.n).padStart(12)} ${String(r.all.p95).padStart(5)} ${String(r.all.max).padStart(6)} ${String(r.person.n).padStart(30)} ${String(r.person.p95).padStart(5)} ${String(r.person.max).padStart(6)} ${String(r.failed).padStart(8)}  ${r.slowest}`);
}
const failures = [
  ...doorRows.filter(r => r.person.p95 >= 200).map(r => `${r.phase}: the person's requests in the door p95 ${r.person.p95} ms`),
  ...doorRows.filter(r => r.all.max > 5_000).map(r => `${r.phase}: a door request took ${r.all.max} ms`),
  ...doorRows.filter(r => r.failed).map(r => `${r.phase}: ${r.failed} door requests failed`),
  ...(doorTiles.stale ? [`${doorTiles.stale} of the door's query tiles didn't converge`] : []),
  ...rows.filter(r => r.p95 >= 200).map(r => `${r.phase}: ping p95 ${r.p95} ms`),
  ...rows.filter(r => r.longestStall > 1_000).map(r => `${r.phase}: a ${r.longestStall} ms stall`),
  ...(stale.length ? [`${stale.length} watches didn't converge`] : []),
  ...[["idle", opsBefore], ["after", opsAfter]].flatMap(([when, ops]) => Object.entries(ops as Record<string, { p95: number }>)
    .filter(([k, v]) => v.p95 > (k === "query" ? queryBudget : opsBudget)).map(([k, v]) => `ops ${when}: ${k} p95 ${v.p95} ms`)),
];
console.log(failures.length ? `\nover the bar:\n${failures.map(f => `  ✗ ${f}`).join("\n")}` : "\nwithin the bar: ping p95 < 200 ms in every phase, no stall over 1 s, every watch converged");
if (values.json) writeFileSync(values.json, JSON.stringify({ outliner, shape: values.copy ? "copy" : shape, backfill: { ...(report ?? {}), samples: undefined, keeps, stopped, ms: Math.round(backfillMs) }, import: { created, ms: Math.round(importMs) }, rows, doorRows, doorTiles, worst, stale, opsBefore, opsAfter, failures }, null, 2));
if (values.keep) console.log(`kept: ${root}`);
if (values.log) writeFileSync(values.log, hostLog.map(h => `${h.phase}\t${h.line}`).join("\n"));
else rmSync(root, { recursive: true, force: true });
process.exit(values.check && failures.length ? 1 : 0);
