// Does a door's request ever wait over a second (PIE-1546)? A scratch host on a pie-shaped fictional outline, with what
// float-2's log showed filling the queue, one cause a phase, so each is named by its own numbers:
//
// - steady: three doors with their watched reads, each opening a note every 3 s (the note-open burst as the door sends
//   it), while an agent writes and a tool's bookkeeping writes come in;
// - toss: the same, with an EchoNet toss's read of every note's threads (`annotations.list`, one a note, on a connection
//   of its own);
// - laptop: the same, with a machine forwarded in `.remote/` that takes a while to answer (a laptop over a link);
// - restart: the host stops and starts with all three doors reconnecting at once.
//
//   bun scripts/bench-host-queue.ts [--phase steady,toss,laptop,restart] [--shape pie|small] [--seconds 30] [--warm 8]
//                                   [--laptop-ms 500] [--outliner <package dir>] [--profile <dir>] [--timeline]
//                                   [--copy <file.sqlite>] [--others <n>] [--small <n>] [--slow-core <n>] [--check] [--json <file>] [--keep]
//
// What it reports is what `journalctl -u outliner-host | grep slow_request` reports: requests with `queuedMs` over 1 s,
// by action, read from the host's own log. --check exits 1 when any phase has one. Never a real outline: the outlines
// folder is a temp dir, removed unless --keep. --outliner runs another checkout's host, for a before. --copy serves a
// private copy of an outline's file instead of the fiction (a snapshot, to see what only the real shape shows); its host
// finds no programs on its PATH and no home of its own, so a copy's agents and extensions reach nothing outside.
// --others adds that many more outlines of the same shape, each with a door of its own at the restart; --small makes that
// many of them small (float-2's eight: pie, three as large, four echo outlines of a few notes: `--others 7 --small 4`). --slow-core pins the host to that CPU core, its collector's threads with it: about as slow as float-2's host is
// next to float-box's (a whole read of pie: 760 ms there, 450 ms here), with the doors' side left alone.
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { blockCommentTarget } from "../src/block-comments";
import { OutlinerStore } from "../src/store";
import { fixturePaths, makeOutline } from "./host-bench/fixture";
import { Conn, quantile } from "./host-bench/wire";

const { values } = parseArgs({ options: {
  phase: { type: "string" }, shape: { type: "string" }, warm: { type: "string" }, seconds: { type: "string" }, "laptop-ms": { type: "string" }, outliner: { type: "string" }, copy: { type: "string" }, others: { type: "string" }, small: { type: "string" },
  "slow-core": { type: "string" }, profile: { type: "string" }, timeline: { type: "boolean" }, check: { type: "boolean" }, json: { type: "string" }, keep: { type: "boolean" },
} });
const outliner = resolve(values.outliner ?? join(import.meta.dir, ".."));
const phases = (values.phase ?? "steady,toss,laptop,restart").split(",");
const seconds = Number(values.seconds ?? 30);
const shape = (values.shape ?? "pie") as "pie" | "small";
const warmS = Number(values.warm ?? 8);
const laptopMs = Number(values["laptop-ms"] ?? 500);
const root = mkdtempSync(join(process.env.EP0CH_BENCH_TMP || tmpdir(), "host-queue-"));
const outlines = join(root, "outlines");
const socket = join(outlines, ".host", "host.sock");
const OUTLINE = "bench";
const OTHERS = Array.from({ length: Number(values.others ?? 0) }, (_, i) => `other-${i}`);
const paths = fixturePaths(outlines, OUTLINE);
const MARKS = 500;

// ─── The outline ───────────────────────────────────────────────────────
const made = performance.now();
mkdirSync(paths.workspaceRoot, { recursive: true });
// Marks on notes across the outline, as pie has them: what `annotations.list` reads.
const marked: string[] = [];
let fixture: { notes: number; probe: string; hub: string; board: string };
if (values.copy) {
  copyFileSync(resolve(values.copy), paths.database);
  // What sits beside it, if anything (`extensions`, `user-extensions`, `extension-schedules.json`): without its extensions
  // the host would take their pages down as gone; without its schedules they would all be due.
  const beside = dirname(resolve(values.copy));
  for (const [from, to] of [["extensions", join(paths.workspaceRoot, "extensions")], ["extension-schedules.json", join(paths.workspaceRoot, "extension-schedules.json")], ["user-extensions", join(root, ".config", "pi-herdr-outliner", "extensions")]] as const)
    if (existsSync(join(beside, from))) cpSync(join(beside, from), to, { recursive: true });
  const { Database } = await import("bun:sqlite");
  const db = new Database(paths.database, { readonly: true });
  const one = (sql: string) => (db.query(sql).get() as { id: string } | null)?.id ?? "";
  const probe = one("SELECT id FROM blocks WHERE deleted_at IS NULL ORDER BY id LIMIT 1 OFFSET 5000");
  fixture = {
    notes: (db.query("SELECT count(*) AS n FROM blocks WHERE deleted_at IS NULL").get() as { n: number }).n, probe,
    hub: one("SELECT parent_id AS id FROM blocks WHERE parent_id IS NOT NULL AND deleted_at IS NULL GROUP BY parent_id ORDER BY count(*) DESC LIMIT 1") || probe,
    board: one("SELECT b.parent_id AS id FROM blocks b JOIN block_properties p ON p.block_id = b.id AND p.key = 'type' AND p.value = 'virtual-branch' WHERE b.parent_id IS NOT NULL AND b.deleted_at IS NULL GROUP BY b.parent_id ORDER BY count(*) DESC LIMIT 1") || probe,
  };
  for (const row of db.query("SELECT DISTINCT b.parent_id AS id FROM blocks b JOIN block_properties p ON p.block_id = b.id AND p.key = 'type' AND p.value = 'annotation' WHERE b.parent_id IS NOT NULL AND b.deleted_at IS NULL LIMIT 250").all() as { id: string }[]) marked.push(row.id);
  if (!marked.length) marked.push(probe);
  db.close();
  console.log(`outline: a private copy of ${values.copy}, ${fixture.notes} notes (${((performance.now() - made) / 1000).toFixed(1)} s)`);
} else {
  const made_ = makeOutline(paths.database, paths.workspaceRoot, shape);
  fixture = made_;
  const store = new OutlinerStore(paths.database, { workspaceRoot: paths.workspaceRoot });
  try {
    const notes = store.queryBlocks({ filters: [{ key: "type", value: "roadmap-item" }], limit: 400 }).blocks;
    store.database.transaction(() => {
      for (let i = 0; i < MARKS; i++) {
        const note = store.require(notes[i % notes.length]!.id);
        store.createAnnotation(`bench-mark-${i}`, { target: blockCommentTarget(note), body: `Mark ${i}: the gutter needs another look.`, source: "agent" }, "agent", { actorId: "moss" } as never);
        if (i % 2 === 0) marked.push(note.id);
      }
    })();
  } finally { store.close(); }
  console.log(`outline: ${shape}-shaped, ${fixture.notes} notes, ${MARKS} marks (${((performance.now() - made) / 1000).toFixed(1)} s)`);
}

for (const [i, other] of OTHERS.entries()) {
  const place = fixturePaths(outlines, other);
  mkdirSync(place.workspaceRoot, { recursive: true });
  if (i >= OTHERS.length - Number(values.small ?? 0)) makeOutline(place.database, place.workspaceRoot, "small");
  else copyFileSync(paths.database, place.database);
}

// ─── The host, and what it logs ────────────────────────────────────────
interface Row { status: string; action?: string; outline?: string; ms?: number; queuedMs?: number; handleMs?: number; loopMs?: number; during?: string[]; phase: string; actor?: string; who?: string[] }
const rows: Row[] = [];
const warmLines: { line: string; phase: string }[] = [];
let phase = "start-up";
let host: ReturnType<typeof startHost>;
const profile = values.profile ? ["--cpu-prof", "--cpu-prof-md", `--cpu-prof-dir=${resolve(values.profile)}`] : [];
const pinned = values["slow-core"] ? [Bun.which("taskset") ?? "taskset", "-c", values["slow-core"]] : [];
function startHost() {
  const child = Bun.spawn([...pinned, process.execPath, ...profile, join(outliner, "src/host-main.ts")], {
    cwd: outliner, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    env: { PATH: values.copy ? dirname(process.execPath) : process.env.PATH ?? "", HOME: root, EP0CH_OUTLINES: outlines, TMPDIR: root },
  });
  for (const stream of [child.stdout, child.stderr] as ReadableStream<Uint8Array>[]) {
    void (async () => {
      let rest = "";
      for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
        const lines = (rest + chunk).split("\n");
        rest = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("{")) { try { rows.push({ ...JSON.parse(line), phase }); } catch {} }
          else if (/^Outline ".*" (warmed|did not warm)/.test(line)) warmLines.push({ line, phase });
        }
      }
    })();
  }
  return child;
}
const up = async () => {
  for (;;) {
    const ping = new Conn(socket, OUTLINE);
    const answer = await ping.request({ action: "ping" }, 1000);
    ping.close();
    if (!answer.error) return;
    await Bun.sleep(50);
  }
};
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { host?.kill("SIGKILL"); process.exit(130); });

// ─── A door ────────────────────────────────────────────────────────────
const refused = new Map<string, number>();
const MISSING = "99999999-aaaa-4bbb-8ccc-000000000001";
/** A door on its one connection: its watched reads, its status bar's lists, and a note opened every 3 s. */
class Door {
  conn: Conn;
  asked = 0; answers: number[] = []; errors = 0;
  private running = true;
  private opening?: Promise<void>;
  private chromeTimer: ReturnType<typeof setTimeout> | null = null;
  private watches = new Map<string, Record<string, unknown>>();
  constructor(readonly name: string, outline = OUTLINE) { this.conn = new Conn(socket, outline, event => this.heard(event)); }
  private async ask(body: Record<string, unknown>): Promise<unknown> {
    this.asked += 1;
    const answer = await this.conn.request(body, 60_000);
    this.answers.push(answer.ms);
    if (answer.error) { this.errors += 1; refused.set(`${String(body.action)}: ${answer.error.slice(0, 120)}`, (refused.get(`${String(body.action)}: ${answer.error.slice(0, 120)}`) ?? 0) + 1); }
    return answer.result;
  }
  async start(): Promise<void> {
    this.ask({ action: "events.subscribe", client: { clientId: `${this.name}-${crypto.randomUUID()}`, role: "observer", contextId: `door-${this.name}` } });
    const reads: Array<[string, Record<string, unknown>]> = [
      // The workboard page and the build log's figures.
      ["doing", { action: "blocks.query", query: { where: "type=roadmap-item AND work-stage=doing", limit: 50 } }],
      ["queued", { action: "blocks.query", query: { where: "type=roadmap-item AND work-stage=queued", limit: 50, sort: "updated desc" } }],
      ["deploys", { action: "blocks.query", query: { where: "type=deploy", limit: 30, sort: "created desc" } }],
      ["findings", { action: "blocks.query", query: { where: "type=review-finding", limit: 50, machinery: "show", sort: "updated desc" } }],
      ["figure", { action: "site.answer", blockId: fixture.board, produce: { kind: "figure", figure: "stat", props: { items: [{ label: "doing", query: "type=roadmap-item work-stage=doing" }] } } }],
      ["hub", { action: "references.backlinks", query: { targetBlockId: fixture.hub, limit: 50 } }],
      ["links", { action: "blocks.authored-links", ownerBlockId: fixture.probe }],
      ["waiting", { action: "waiting.list" }],
      ["styles", { action: "styles.list" }], ["headings", { action: "headings.styles" }], ["callouts", { action: "callouts.types" }],
    ];
    for (const [key, request] of reads) { this.watches.set(key, request); void this.ask({ ...request, watch: key }); }
    this.chrome();
    this.opening = (async () => {
      let n = 0;
      while (this.running) {
        await this.open(n++);
        await Bun.sleep(3_000);
      }
    })();
  }
  private heard(event: Record<string, any>): void {
    if (event.action === "queries.changed") for (const change of event.changes ?? []) {
      const request = this.watches.get(change.key);
      if (request && !change.dropped) void this.ask({ ...request, watch: change.key, generation: change.generation });
    }
    // A door's lists leave out what's stamped machinery: the service says so (`hidden`).
    if (event.domain !== "content" || event.hidden) return;
    if (this.chromeTimer) clearTimeout(this.chromeTimer);
    this.chromeTimer = setTimeout(() => { this.chromeTimer = null; this.chrome(); }, 400);
  }
  private chrome(): void {
    void this.ask({ action: "agents.held" });
    void this.ask({ action: "draft.proposals.list", blockId: fixture.probe });
  }
  /** What a door sends when a note opens (float-2's log, in the order it sends them), all at once on the connection. */
  private async open(n: number): Promise<void> {
    const blockId = marked[n % marked.length]!;
    await Promise.all([
      this.ask({ action: "children", parentId: blockId }),
      // A note with a reference nobody here has: it's looked for on the other machines.
      this.ask({ action: "references.resolve", text: `See ((${blockId})) and ((${MISSING}))` }),
      this.ask({ action: "pages.resolve", address: "Page 3" }),
      this.ask({ action: "resources.projection.read", blockId, text: "" }),
      this.ask({ action: "transclusions.read", targets: [{ blockId }], hostBlockId: blockId }),
      this.ask({ action: "annotations.list", query: { subject: { kind: "block", blockId }, includeResolved: true } }),
      this.ask({ action: "references.backlinks", query: { targetBlockId: blockId, limit: 20 } }),
      this.ask({ action: "blocks.authored-links", ownerBlockId: blockId }),
      this.ask({ action: "blocks.facets", blockIds: [blockId, fixture.hub, fixture.probe] }),
      this.ask({ action: "properties.preview", blockId, text: "" }),
    ]);
  }
  async stop(): Promise<void> {
    this.running = false;
    if (this.chromeTimer) clearTimeout(this.chromeTimer);
    this.conn.close();
    await this.opening?.catch(() => {});
  }
}

// ─── The writers ───────────────────────────────────────────────────────
const writer = (ms: number, write: (conn: Conn, n: number) => Promise<unknown>) => {
  let running = true;
  const conn = new Conn(socket, OUTLINE);
  const done = (async () => {
    for (let n = 0; running; n++) {
      await write(conn, n);
      await Bun.sleep(ms);
    }
  })();
  return async () => { running = false; await done; conn.close(); };
};
/** An agent working: a note a couple of seconds, a save now and then. */
const agent = () => writer(2_000, conn => conn.request({ action: "create", text: `Moss's note ${crypto.randomUUID().slice(0, 8)} about the shed`, mutation: { author: "agent", actorId: "moss/claude-code@shed" } } as never));
/** A tool's bookkeeping: `[machine::record]` notes, 20 a minute. */
const machinery = () => writer(3_000, conn => conn.request({ action: "create", text: `Quiet review ${crypto.randomUUID().slice(0, 8)} [machine::record] [type::review-quiet]`, mutation: { author: "agent", actorId: "jev/write-review" } } as never));

/** A toss: every note's threads, one a note, until it's read them all. */
const toss = async () => {
  const conn = new Conn(socket, OUTLINE);
  const started = performance.now();
  for (const blockId of marked) await conn.request({ action: "annotations.list", query: { subject: { kind: "block", blockId }, includeResolved: true } });
  conn.close();
  return { notes: marked.length, s: Number(((performance.now() - started) / 1000).toFixed(1)) };
};

/** A machine in `.remote/`: a host on the far side of a link that takes a while to answer, with ten outlines. */
function laptop(): { stop(): void } {
  const remote = join(outlines, ".remote");
  mkdirSync(remote, { recursive: true, mode: 0o700 });
  const path = join(remote, "laptop.sock");
  const answer = (request: Record<string, any>) => {
    if (request.action === "outlines.list") return { outlines: Array.from({ length: 10 }, (_, i) => ({ name: `away-${i}` })) };
    if (request.action === "references.backlinks") return { targetBlockId: request.query?.targetBlockId, sources: [], completeness: { kind: "complete" } };
    if (request.action === "pages.resolve") return { address: request.address, normalizedAddress: request.address, status: "missing" };
    return null;
  };
  const server: Server = createServer(socket => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (!line) continue;
        const request = JSON.parse(line);
        setTimeout(() => { if (!socket.destroyed) socket.write(`${JSON.stringify({ id: request.id, ok: true, result: answer(request), sequence: 1 })}\n`); }, laptopMs);
      }
    });
  });
  server.listen(path);
  return { stop() { server.close(); rmSync(path, { force: true }); } };
}

// ─── The phases ────────────────────────────────────────────────────────
interface Report { phase: string; queuedOver1s: number; worstMs: number; byAction: string; answerP95: number; answerMax: number; errors: number; stallMs: number; worstStall: number; stalls: string; who: string[]; note?: string }
const reports: Report[] = [];
function report(name: string, doors: Door[], note?: string): void {
  const here = rows.filter(r => r.phase === name);
  const queued = here.filter(r => r.status === "slow_request" && (r.queuedMs ?? 0) > 1000);
  const by = new Map<string, { n: number; ms: number; max: number }>();
  for (const r of queued) { const e = by.get(r.action!) ?? { n: 0, ms: 0, max: 0 }; e.n++; e.ms += r.queuedMs!; e.max = Math.max(e.max, r.queuedMs!); by.set(r.action!, e); }
  const stalls = here.filter(r => r.status === "loop_stalled");
  const named = new Map<string, number>();
  for (const s of stalls) for (const d of s.during ?? []) { const m = /^(.*?) (\d+)(?: \(\d+×\))?$/.exec(d); if (m) named.set(m[1]!, (named.get(m[1]!) ?? 0) + Number(m[2])); }
  const unnamed = stalls.filter(s => !(s.during ?? []).length).reduce((sum, s) => sum + (s as { ms?: number }).ms!, 0);
  const answers = doors.flatMap(d => d.answers).sort((a, b) => a - b);
  const r: Report = {
    phase: name, queuedOver1s: queued.length, worstMs: Math.max(0, ...queued.map(q => q.queuedMs!)),
    byAction: [...by].sort((a, b) => b[1].ms - a[1].ms).slice(0, 8).map(([a, e]) => `${a} ${e.n}× max ${e.max}`).join(", "),
    answerP95: Math.round(quantile(answers, 0.95)), answerMax: Math.round(answers.at(-1) ?? 0), errors: doors.reduce((s, d) => s + d.errors, 0),
    stallMs: stalls.reduce((s, st) => s + (st as { ms?: number }).ms!, 0), worstStall: Math.max(0, ...stalls.map(s => (s as { ms?: number }).ms!)),
    stalls: [...named].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).concat(unnamed ? [`(unnamed) ${unnamed}`] : []).join(", "),
    who: here.filter(r => r.status === "queued_minute").flatMap(r => r.who ?? []).slice(0, 8),
    ...(note ? { note } : {}),
  };
  reports.push(r);
  console.log(`\n── ${name}${note ? ` (${note})` : ""}`);
  console.log(`  queued over 1 s: ${r.queuedOver1s}, worst ${r.worstMs} ms${r.byAction ? `: ${r.byAction}` : ""}`);
  console.log(`  a door's answers: p95 ${r.answerP95} ms, max ${r.answerMax} ms (${answers.length} asked, ${r.errors} refused)`);
  console.log(`  stalls: ${stalls.length}, ${r.stallMs} ms, longest ${r.worstStall} ms: ${r.stalls}`);
  if (r.who.length) console.log(`  who: ${r.who.join("; ")}`);
}
async function withDoors<T>(name: string, during: () => Promise<T>, note?: (result: T) => string): Promise<void> {
  phase = `${name}-warm`;
  const doors = ["a", "b", "c"].map(n => new Door(n));
  const stopAgent = agent(), stopMachinery = machinery();
  await Promise.all(doors.map(d => d.start()));
  // The first reads of a cold host aren't this phase's: the restart phase measures those.
  await Bun.sleep(warmS * 1000);
  for (const d of doors) d.answers.length = 0;
  phase = name;
  const result = await during();
  await stopAgent(); await stopMachinery();
  await Promise.all(doors.map(d => d.stop()));
  report(name, doors, note?.(result));
  phase = "between";
  await Bun.sleep(1_000);
}

host = startHost();
await up();
if (phases.includes("steady")) await withDoors("steady", () => Bun.sleep(seconds * 1000));
if (phases.includes("toss")) await withDoors("toss", toss, r => `${r.notes} notes in ${r.s} s`);
if (phases.includes("laptop")) {
  const away = laptop();
  await withDoors("laptop", () => Bun.sleep(seconds * 1000), () => `a machine answering in ${laptopMs} ms`);
  away.stop();
}
if (phases.includes("restart")) {
  phase = "between";
  // A restart meets outlines that have been open before: their extensions' pages written, as float-2's are.
  for (let i = 0; i < 1200 && warmLines.length < OTHERS.length + 1; i++) await Bun.sleep(100);
  host.kill("SIGTERM");
  await host.exited;
  phase = "restart";
  host = startHost();
  const doors = ["a", "b", "c"].map(n => new Door(n));
  const stopAgent = agent;
  const started = performance.now();
  await up();
  // Doors reconnect at once: what they wait for here is the host warming their outline, which no `queuedMs` counts.
  const gap = Math.round(performance.now() - started);
  doors.push(...OTHERS.map(other => new Door(`door-${other}`, other)));
  await Promise.all(doors.map(d => d.start()));
  const writers = [stopAgent(), machinery()];
  await Bun.sleep(seconds * 1000);
  await Promise.all(writers.map(stop => stop()));
  await Promise.all(doors.map(d => d.stop()));
  report("restart", doors, `${doors.length} doors reconnecting, the first answer ${gap} ms after the host started`);
  for (const { line } of warmLines.filter(w => w.phase === "restart")) console.log(`  ${line}`);
  if (values.timeline) for (const r of rows.filter(r => r.phase === "restart" && (r.status === "loop_stalled" || (r.queuedMs ?? 0) > 1000 || (r.handleMs ?? 0) > 1000 || (r.loopMs ?? 0) > 200)).slice(0, 80)) {
    console.log(`  ${r.status === "loop_stalled" ? `stall ${(r as { ms?: number }).ms} ${r.during?.join(", ")}` : `${r.action} q=${r.queuedMs} h=${r.handleMs} l=${r.loopMs}`}`);
  }
}
host.kill("SIGTERM");
await host.exited;
if (values.json) writeFileSync(values.json, JSON.stringify(reports, null, 2));
if (values.keep) console.log(`kept ${root}`);
else if (existsSync(root)) rmSync(root, { recursive: true, force: true });
if (refused.size) console.log(`\nrefused:\n${[...refused].map(([k, n]) => `  ${n}× ${k}`).join("\n")}`);
const queuedAny = reports.reduce((sum, r) => sum + r.queuedOver1s, 0);
console.log(`\n${queuedAny ? `RED: ${queuedAny} requests queued over 1 s` : "GREEN: nothing queued over 1 s"}`);
if (values.check && queuedAny) process.exit(1);
