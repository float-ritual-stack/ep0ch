// Does the outline host keep answering (PIE-625)? A scratch host on a fictional outline the size of a working one,
// with the clients a working day has: two Trees and five Details that read again after every change (as the real
// ones do), a door, the publisher and an MCP gateway subscribed, an agent writing, a VACUUM INTO backup, and a
// restart. A probe asks for one note every 50 ms; each phase reports how long the answers took.
//
//   bun scripts/bench-host-stalls.ts [--outliner <package dir>] [--keep] [--budget <ms>]
//
// --outliner runs another checkout's host (main's, for a before), with this checkout's fixture and clients.
// The exit code is 1 when a phase's slowest answer is over the budget (default 200 ms). Never a real outline: the
// outlines folder is a temp dir, removed at the end unless --keep.
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { OutlinerStore } from "../src/store";

const { values } = parseArgs({ options: { outliner: { type: "string" }, keep: { type: "boolean" }, budget: { type: "string" } } });
const outliner = resolve(values.outliner ?? join(import.meta.dir, ".."));
const budget = Number(values.budget ?? 200);
const root = mkdtempSync(join(process.env.EP0CH_BENCH_TMP ?? tmpdir(), "host-stalls-"));
const outlines = join(root, "outlines");
const socket = join(outlines, ".host", "host.sock");
const OUTLINE = "bench";

// ─── The fictional outline ───────────────────────────────────────────────

/** About the shape of a working outline: ~2.4k notes, ~14k property tokens, 72 saved views, references between notes. */
function makeOutline(path: string): { notes: number; views: number; probe: string } {
  const store = new OutlinerStore(path, { workspaceRoot: join(outlines, OUTLINE) });
  const projects = ["harbor", "lantern", "meadow", "quarry", "orchard", "beacon", "thistle", "copper"];
  const tracks = ["stability", "performance", "docs", "ux", "data"];
  const stages = ["queued", "doing", "review", "validate", "done", "later"];
  let notes = 0, views = 0;
  const ids: string[] = [];
  const add = (text: string, parent: string | null = null) => { notes += 1; const block = store.create(text, parent, "user"); ids.push(block.id); return block; };
  const pick = <T>(list: readonly T[], n: number) => list[n % list.length]!;
  const prose = (n: number) => `Some words about step ${n}: who does it, what it needs, and what done looks like. See https://example.test/notes/${n}.`;
  store.database.transaction(() => {
    const hubs = projects.map((name, i) => add(`Project ${name} [type::project] [owner::team-${i % 3}]`));
    const board = add("Workboard [type::hub]");
    for (let i = 0; i < 560; i++) {
      const project = pick(projects, i), hub = pick(hubs, i);
      const related = ids.length > 10 ? ` [related-to::((${pick(ids, i * 7)}))]` : "";
      const item = add(`BEN-${i} — Make the ${project} thing better, part ${i} [type::roadmap-item] [priority::${pick(["high", "medium", "low"], i)}] ` +
        `[work-stage::${pick(stages, i)}] [project::${project}] [arc::${pick(["core", "edge"], i)}] [track::${pick(tracks, i)}] [ref::BEN-${i}]${related}\n\n` +
        `${prose(i)}\n- first, ((${pick(ids, i * 3)}))\n- then the rest #followup`, hub.id);
      if (i % 2 === 0) add(`Delivery for BEN-${i} [type::delivery] [repository::example/${project}] [pull-request-number::${1000 + i}] ` +
        `[pull-request-state::${pick(["open", "merged"], i)}] [work-branch::ben-${i}] [base-branch::main] [delivery-stage::review]`, item.id);
      if (i % 5 === 0) add(`Proof for BEN-${i} [type::proof] [commit::${(i * 2654435761 >>> 0).toString(16)}]\n${prose(i + 1)}`, item.id);
    }
    for (let i = 0; i < 1_350; i++) {
      const parent = i % 4 === 0 ? null : pick(ids, i * 13);
      const long = i % 97 === 0;
      const body = long
        ? Array.from({ length: 300 }, (_, n) => n % 40 === 0 ? `## Part ${n}\n\`\`\`ts\nconst step${n} = ${n};\n\`\`\`` : `- ${prose(n)} [[Page ${n % 30}]]`).join("\n")
        : `${prose(i)}\n- a line with [status::${pick(["open", "closed"], i)}] and ((${pick(ids, i * 5)}))`;
      add(`Note ${i} about ${pick(projects, i)} [type::${pick(["note", "log", "idea", "task"], i)}] [project::${pick(projects, i)}] [tag::t${i % 9}]\n${body}`, parent);
    }
    for (let i = 0; i < 30; i++) add(`Page ${i} [page::Page ${i}] [type::page]\n${prose(i)}`);
    for (let i = 0; i < 4; i++) add(`Callout ${i} [callout-type::kind-${i}] [color::${pick(["red", "blue"], i)}]`);
    for (let i = 0; i < 72; i++) {
      views += 1;
      const query = i % 3 === 0 ? `type=roadmap-item project=${pick(projects, i)}` : i % 3 === 1 ? `work-stage=${pick(stages, i)}` : `type=${pick(["note", "task", "delivery"], i)}`;
      add(`View ${i} [type::virtual-branch] [query::${query}] [limit::${pick([20, 50, 200], i)}]`, board.id);
    }
  })();
  const probe = ids[ids.length >> 1]!;
  store.close();
  return { notes, views, probe };
}

// ─── Talking to the host ─────────────────────────────────────────────────

function request<T = unknown>(body: Record<string, unknown>, timeoutMs = 5_000): Promise<{ ms: number; result?: T; error?: string }> {
  const started = performance.now();
  return new Promise(resolve => {
    const connection = createConnection(socket);
    let buffer = "";
    const done = (answer: { result?: T; error?: string }) => { clearTimeout(timer); connection.destroy(); resolve({ ms: performance.now() - started, ...answer }); };
    const timer = setTimeout(() => done({ error: "timeout" }), timeoutMs);
    connection.on("connect", () => connection.write(`${JSON.stringify({ id: crypto.randomUUID(), outline: OUTLINE, ...body })}\n`));
    connection.on("data", chunk => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const response = JSON.parse(buffer.slice(0, newline));
      done(response.ok ? { result: response.result } : { error: response.error });
    });
    connection.on("error", error => done({ error: error.message }));
  });
}

/** A subscribed client that, like the real one, reads again after each content change (and once on connecting). */
class Client {
  private connection: Socket | null = null;
  private reading: Promise<unknown> | null = null;
  private again = false;
  private stopped = false;
  constructor(readonly role: string, private readonly read: () => Promise<unknown>) { this.connect(); }
  private connect(): void {
    if (this.stopped) return;
    const connection = createConnection(socket);
    this.connection = connection;
    let buffer = "";
    connection.setEncoding("utf8");
    connection.on("connect", () => {
      connection.write(`${JSON.stringify({ id: crypto.randomUUID(), outline: OUTLINE, action: "events.subscribe", client: { clientId: `${this.role}-${crypto.randomUUID()}`, contextId: `bench-${this.role}`, role: this.role === "tree" ? "tree" : this.role === "detail" ? "detail" : "observer" } })}\n`);
      this.refresh();
    });
    connection.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.includes('"domain":"content"')) this.refresh();
      }
    });
    connection.on("error", () => {});
    connection.on("close", () => { if (!this.stopped) setTimeout(() => this.connect(), 250); });
  }
  private refresh(): void {
    if (this.reading) { this.again = true; return; }
    refreshes[phase] = (refreshes[phase] ?? 0) + 1;
    this.reading = this.read().finally(() => {
      this.reading = null;
      if (this.again) { this.again = false; this.refresh(); }
    });
  }
  stop(): void { this.stopped = true; this.connection?.destroy(); }
}

// ─── The run ─────────────────────────────────────────────────────────────

let host: ReturnType<typeof Bun.spawn> | null = null;
const hostLog: string[] = [];
async function startHost(): Promise<void> {
  host = Bun.spawn([process.execPath, join(outliner, "src/host-main.ts")], {
    cwd: outliner, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    env: { PATH: process.env.PATH ?? "", HOME: root, EP0CH_OUTLINES: outlines, TMPDIR: root },
  });
  for (const stream of [host.stdout, host.stderr] as ReadableStream<Uint8Array>[]) {
    void (async () => { for await (const chunk of stream.pipeThrough(new TextDecoderStream())) hostLog.push(...chunk.split("\n").filter(Boolean)); })();
  }
  while ((await request({ action: "ping" }, 200)).error) await Bun.sleep(20);
}
async function stopHost(): Promise<void> {
  host?.kill("SIGTERM");
  await host?.exited;
  host = null;
}

const samples: Record<string, number[]> = {};
/** How many times a client read again, by phase; and the agent's writes. */
const refreshes: Record<string, number> = {};
let writes = 0;
let phase = "start-up";
let probing = true;
async function probe(blockId: string): Promise<void> {
  while (probing) {
    const current = phase;
    const answer = await request({ action: "get", blockId }, 5_000);
    // A refused connection is the restart's own gap (no host yet), not a stall.
    if (answer.error !== "timeout" && answer.error && /ENOENT|ECONNREFUSED/.test(answer.error)) { await Bun.sleep(50); continue; }
    (samples[current] ??= []).push(answer.error === "timeout" ? 5_000 : answer.ms);
    await Bun.sleep(50);
  }
}

console.log(`host: ${outliner}`);
const made = performance.now();
const outline = makeOutline(join(outlines, `${OUTLINE}.sqlite`));
console.log(`fixture: ${outline.notes} notes, ${outline.views} saved views (${((performance.now() - made) / 1000).toFixed(1)} s)`);
const viewIds = (new Database(join(outlines, `${OUTLINE}.sqlite`), { readonly: true })
  .query("SELECT block_id FROM block_properties WHERE key = 'type' AND value = 'virtual-branch'").all() as { block_id: string }[]).map(row => row.block_id);

const clients: Client[] = [];
await startHost();
const probing$ = probe(outline.probe);
// Start-up: every client connects at once and reads what it shows.
for (let i = 0; i < 2; i++) clients.push(new Client("tree", () => Promise.all([request({ action: "tree.index" }), ...viewIds.map(viewId => request({ action: "views.read", viewId, format: "tree" }))])));
for (let i = 0; i < 5; i++) clients.push(new Client("detail", () => Promise.all([request({ action: "callouts.types" }), request({ action: "headings.styles" }), request({ action: "get", blockId: outline.probe })])));
for (const role of ["door", "publisher", "mcp"]) clients.push(new Client(role, async () => {}));
await Bun.sleep(5_000);

// Load: an agent writes every 750 ms; every Tree and Detail reads again after each write.
phase = "load";
const writer = (async () => {
  let block = (await request<{ id: string; revision: number }>({ action: "create", text: "Bench agent note", author: "agent", actorId: "bench" })).result!;
  for (let i = 0; phase === "load" || phase === "backup"; i++) {
    const answer = await request<{ id: string; revision: number }>({ action: "update", blockId: block.id, text: `Bench agent note ${i} [status::s${i}]`, expectedRevision: block.revision, author: "agent", actorId: "bench" });
    if (answer.result) { block = answer.result; writes += 1; }
    else console.error(`bench: a write failed: ${answer.error}`);
    await Bun.sleep(750);
  }
})();
await Bun.sleep(12_000);

// Backup: VACUUM INTO from another connection, as the 15-minute backup does, while the writes go on.
phase = "backup";
for (let i = 0; i < 3; i++) {
  const reader = new Database(join(outlines, `${OUTLINE}.sqlite`), { readonly: true });
  reader.exec(`VACUUM INTO '${join(root, `backup-${i}.sqlite`)}'`);
  reader.close();
  await Bun.sleep(1_000);
}
phase = "settle";
await writer;

// Restart: the host goes away and comes back; every client reconnects and reads again.
await Bun.sleep(1_000);
await stopHost();
phase = "restart";
await startHost();
await Bun.sleep(8_000);
probing = false;
await probing$;
for (const client of clients) client.stop();
await stopHost();

// ─── Report ──────────────────────────────────────────────────────────────

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
let over = false;
console.log(`\n${writes} writes; client reads again: ${Object.entries(refreshes).map(([name, count]) => `${name} ${count}`).join(", ")}`);
console.log(`\nphase      answers   p50 ms   p95 ms   max ms   (one note read every 50 ms; budget ${budget} ms)`);
for (const name of ["start-up", "load", "backup", "restart"]) {
  const sorted = (samples[name] ?? []).sort((a, b) => a - b);
  if (!sorted.length) continue;
  const max = sorted.at(-1)!;
  if (max > budget) over = true;
  console.log(`${name.padEnd(10)} ${String(sorted.length).padStart(7)} ${quantile(sorted, 0.5).toFixed(0).padStart(8)} ${quantile(sorted, 0.95).toFixed(0).padStart(8)} ${max.toFixed(0).padStart(8)}${max > budget ? "   over budget" : ""}`);
}
const stalls = hostLog.filter(line => line.includes('"loop_stalled"')).map(line => JSON.parse(line) as { ms: number; during: string[] });
if (stalls.length) {
  const worst = stalls.sort((a, b) => b.ms - a.ms)[0]!;
  console.log(`\nhost: ${stalls.length} loop stalls ≥100 ms; the longest ${worst.ms} ms, during ${worst.during.join(", ") || "nothing it timed"}`);
}
if (values.keep) console.log(`kept: ${root}`);
else rmSync(root, { recursive: true, force: true });
process.exit(over ? 1 : 0);
