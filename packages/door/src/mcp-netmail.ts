// Netmail (PIE-615, PIE-562's store-and-forward writes): a remote MCP write to an outline whose home is another machine
// (float-hub on the laptop) never touches the read-only mirror the gateway reads it from. It waits on the gateway's
// machine, in a small store of its own (`<mirrors>/.netmail.sqlite`), until that machine dials in and applies it.
//
//   queue   the gateway adds an entry: the outline and block (its URI), the write (src/mcp-writes.ts's shape), and what
//           the mirror showed of the block: its revision, its text's hash, and the instance id of the database the
//           copy came from (the home machine's, read from the copy's metadata), with who wrote it and when.
//   pull    the home machine, whenever it's online (its backup job every 15 minutes, or `ep0ch mcp pull`), asks over ssh
//           for its entries (`ep0ch mcp queue take --machine <name> --json` on the hub, in a login shell), applies each
//           to its own outline with the same `applyWrite` the gateway uses for a live one, and reports what each became
//           (`ep0ch mcp queue settle`). ssh is the trust the machines already share (the mirrors and forwards use it);
//           the gateway grows no second credential and no inbound path to the laptop.
//   apply   an entry is applied as the outline's access allows now (its owner may have narrowed it since). One whose
//           note changed since the mirror showed it (another revision of the same database; in a replaced database,
//           other text) becomes a proposal under the note: a conflict note, never an overwrite. A new block and a
//           comment don't conflict; a comment whose passage changed lands on the whole note, quoting it.
//
// The home machine keeps a ledger of the entries it applied (`<state>/backup/netmail-applied.json`) until the hub has
// heard what they became, so a pull cut off between applying and settling never applies one twice.
import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import type { McpAccessLevel } from "@ep0ch/outline-core/protocol";
import { configFileOf, parseEnvFile, type Env } from "./backup/config";
import { applyWrite, isWriteTool, type McpWrite, type McpWriteTool, type WriteOutcome } from "./mcp-writes";
import { boardFor, type NotesBoard } from "./notes-cli";
import { writeState } from "./state";

/** A queued write, as the hub keeps it and the home machine takes it. */
export interface NetmailEntry {
  id: string;
  machine: string;
  outline: string;
  uri: string;
  blockId: string;
  tool: McpWriteTool;
  input: Record<string, unknown>;
  /** The revision the caller read (a patch's or property's), else null. */
  revision: number | null;
  /** What the mirror showed of the block when it was queued: its revision, its text's hash, its database's instance. */
  mirrorRevision: number | null;
  textHash: string | null;
  instanceId: string | null;
  /** The access level it was queued under: propose or full. */
  level: McpAccessLevel;
  actorId: string;
  subject: string;
  clientId: string | null;
  queuedAt: string;
}

/** What an entry became on its home machine. */
export interface NetmailSettled { id: string; state: "applied" | "proposed" | "unchanged" | "refused"; said: string; uri?: string; at: string }

/** One machine's queue, as list_outlines, doctor and the backup job show it. */
export interface NetmailSummary { machine: string; waiting: number; oldest: string | null; lastPull: string | null; byOutline: Record<string, number> }

export const textHash = (text: string) => createHash("sha256").update(text).digest("hex");

/** The store's file: beside the mirrors (EP0CH_MCP_MIRROR_DIR, or the backup settings' file, or ~/outline-mirrors). */
export function netmailFile(env: Env = process.env): string {
  const home = resolve(env.HOME || homedir());
  const file = configFileOf({ ...env, HOME: home });
  const fromFile = (() => { try { return existsSync(file) ? parseEnvFile(readFileSync(file, "utf8")) : {}; } catch { return {}; } })();
  const folder = resolve(env.EP0CH_MCP_MIRROR_DIR?.trim() || fromFile.EP0CH_MCP_MIRROR_DIR?.trim() || join(home, "outline-mirrors"));
  return join(folder, ".netmail.sqlite");
}

const SCHEMA_VERSION = 1;

/** The hub's queue: one SQLite file, one writer at a time (SQLite's own lock), opened per use. */
export class Netmail {
  private readonly db: Database;
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    const version = (this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version === 0) {
      this.db.exec(`
        CREATE TABLE entries (
          id TEXT PRIMARY KEY, machine TEXT NOT NULL, outline TEXT NOT NULL, uri TEXT NOT NULL, block_id TEXT NOT NULL,
          tool TEXT NOT NULL, input TEXT NOT NULL, revision INTEGER, mirror_revision INTEGER, text_hash TEXT, instance_id TEXT,
          level TEXT NOT NULL, actor_id TEXT NOT NULL, subject TEXT NOT NULL, client_id TEXT, queued_at TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'queued', settled_at TEXT, said TEXT, result_uri TEXT
        );
        CREATE INDEX entries_waiting ON entries (machine, state, queued_at);
        CREATE TABLE pulls (machine TEXT PRIMARY KEY, at TEXT NOT NULL);
        PRAGMA user_version = ${SCHEMA_VERSION};`);
    } else if (version !== SCHEMA_VERSION) {
      this.db.close();
      throw new Error(`${path} is netmail store version ${version}; this ep0ch reads version ${SCHEMA_VERSION} (move it aside once the home machines have pulled it, and the next write makes a new one)`);
    }
  }

  enqueue(e: Omit<NetmailEntry, "id" | "queuedAt">, now = Date.now()): NetmailEntry {
    const entry: NetmailEntry = { ...e, id: randomUUID(), queuedAt: new Date(now).toISOString() };
    this.db.query(`INSERT INTO entries (id, machine, outline, uri, block_id, tool, input, revision, mirror_revision, text_hash, instance_id, level, actor_id, subject, client_id, queued_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(entry.id, entry.machine, entry.outline, entry.uri, entry.blockId, entry.tool, JSON.stringify(entry.input),
      entry.revision, entry.mirrorRevision, entry.textHash, entry.instanceId, entry.level, entry.actorId, entry.subject, entry.clientId, entry.queuedAt);
    return entry;
  }

  /** The machine's waiting entries, oldest first; `pulled` records that it dialed in. */
  take(machine: string, pulled?: number): NetmailEntry[] {
    if (pulled !== undefined) this.db.query("INSERT INTO pulls (machine, at) VALUES (?, ?) ON CONFLICT(machine) DO UPDATE SET at = excluded.at").run(machine, new Date(pulled).toISOString());
    const rows = this.db.query("SELECT * FROM entries WHERE machine = ? AND state = 'queued' ORDER BY queued_at, rowid").all(machine) as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string, machine: r.machine as string, outline: r.outline as string, uri: r.uri as string, blockId: r.block_id as string,
      tool: r.tool as McpWriteTool, input: JSON.parse(r.input as string), revision: r.revision as number | null, mirrorRevision: r.mirror_revision as number | null,
      textHash: r.text_hash as string | null, instanceId: r.instance_id as string | null, level: r.level as McpAccessLevel, actorId: r.actor_id as string,
      subject: r.subject as string, clientId: r.client_id as string | null, queuedAt: r.queued_at as string,
    }));
  }

  /** Records what the machine's entries became; an id it doesn't hold waiting is skipped. Returns how many settled. */
  settle(machine: string, results: NetmailSettled[]): number {
    const q = this.db.query("UPDATE entries SET state = ?, settled_at = ?, said = ?, result_uri = ? WHERE id = ? AND machine = ? AND state = 'queued'");
    let n = 0;
    this.db.transaction(() => { for (const r of results) n += q.run(r.state, r.at, r.said, r.uri ?? null, r.id, machine).changes; })();
    return n;
  }

  /** Every machine's queue: those with entries waiting or a pull recorded. */
  summaries(): NetmailSummary[] {
    const out = new Map<string, NetmailSummary>();
    const of = (machine: string) => { let s = out.get(machine); if (!s) out.set(machine, s = { machine, waiting: 0, oldest: null, lastPull: null, byOutline: {} }); return s; };
    for (const r of this.db.query("SELECT machine, outline, count(*) AS n, min(queued_at) AS oldest FROM entries WHERE state = 'queued' GROUP BY machine, outline").all() as { machine: string; outline: string; n: number; oldest: string }[]) {
      const s = of(r.machine);
      s.waiting += r.n; s.byOutline[r.outline] = r.n;
      if (!s.oldest || r.oldest < s.oldest) s.oldest = r.oldest;
    }
    for (const r of this.db.query("SELECT machine, at FROM pulls").all() as { machine: string; at: string }[]) of(r.machine).lastPull = r.at;
    return [...out.values()].sort((a, b) => a.machine.localeCompare(b.machine));
  }

  /** The latest entries settled, newest first: for `ep0ch mcp queue status`. */
  settled(limit = 10): (NetmailSettled & { outline: string; machine: string; tool: string; actorId: string })[] {
    return (this.db.query("SELECT id, machine, outline, tool, actor_id, state, said, result_uri, settled_at FROM entries WHERE state != 'queued' ORDER BY settled_at DESC LIMIT ?").all(limit) as Record<string, string>[])
      .map(r => ({ id: r.id!, machine: r.machine!, outline: r.outline!, tool: r.tool!, actorId: r.actor_id!, state: r.state as NetmailSettled["state"], said: r.said ?? "", ...(r.result_uri ? { uri: r.result_uri } : {}), at: r.settled_at! }));
  }

  close(): void { this.db.close(); }
}

/** A machine's summary from the store at `path`, or none when nothing was ever queued there. */
export function readSummaries(path: string): NetmailSummary[] {
  if (!existsSync(path)) return [];
  const n = new Netmail(path);
  try { return n.summaries(); } finally { n.close(); }
}

// ─── The hub's side: `ep0ch mcp queue …` ─────────────────────────────────────

export const QUEUE_USAGE = `  ep0ch mcp queue [status] [--json]
                                   the remote MCP gateway's queued writes for other machines' outlines (netmail): how many wait
                                   for each machine, the oldest, its last pull, and what the latest became
  ep0ch mcp queue take --machine <name> --json   (run over ssh by that machine's pull) its waiting writes
  ep0ch mcp queue settle --machine <name>        (the same, after applying) what each became, as JSON on stdin
  ep0ch mcp pull [--from <ssh-name>]
                                   on an outline's home machine: apply the writes queued for it on the gateway's machine
                                   (EP0CH_MCP_HUB, its ssh name; this machine is EP0CH_BACKUP_MACHINE there). The backup job
                                   runs it every 15 minutes`;

type Io = { out: (line: string) => void; err: (line: string) => void; stdin?: () => Promise<string> };

const flagOf = (args: readonly string[], name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const MACHINE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export async function queueCommand(args: readonly string[], io: Io, env: Env = process.env): Promise<number> {
  const sub = args[0] && !args[0].startsWith("-") ? args[0] : "status";
  const file = netmailFile(env);
  if (sub === "status") {
    const sums = readSummaries(file);
    if (args.includes("--json")) {
      const recent = existsSync(file) ? (() => { const n = new Netmail(file); try { return n.settled(); } finally { n.close(); } })() : [];
      io.out(JSON.stringify({ store: file, machines: sums, recent }, null, 2));
      return 0;
    }
    if (!sums.length) { io.out(`no queued writes (${file}${existsSync(file) ? "" : " doesn't exist yet"})`); return 0; }
    for (const s of sums) io.out(`${s.machine}: ${s.waiting} waiting${s.oldest ? `, oldest ${s.oldest}` : ""}${Object.keys(s.byOutline).length ? ` (${Object.entries(s.byOutline).map(([o, n]) => `${o} ${n}`).join(", ")})` : ""}; last pull ${s.lastPull ?? "never"}`);
    return 0;
  }
  const machine = flagOf(args, "--machine");
  if (!machine || !MACHINE.test(machine)) { io.err(`ep0ch mcp queue ${sub}: --machine <name> names the machine whose writes these are`); return 2; }
  if (sub === "take") {
    // Nothing queued yet makes no store: an empty answer, and the pull is still recorded.
    const n = new Netmail(file);
    try { io.out(JSON.stringify({ machine, entries: n.take(machine, Date.now()) })); } finally { n.close(); }
    return 0;
  }
  if (sub === "settle") {
    let results: NetmailSettled[];
    try {
      const parsed = JSON.parse(await (io.stdin ?? (() => Bun.stdin.text()))()) as { results?: unknown };
      if (!Array.isArray(parsed.results)) throw new Error("no results list");
      results = parsed.results as NetmailSettled[];
    } catch (e) { io.err(`ep0ch mcp queue settle: stdin isn't {"results": [...]}: ${(e as Error).message}`); return 2; }
    const n = new Netmail(file);
    try { io.out(JSON.stringify({ machine, settled: n.settle(machine, results) })); } finally { n.close(); }
    return 0;
  }
  io.err(`ep0ch mcp queue: ${sub}? one of status, take, settle\n${QUEUE_USAGE}`);
  return 2;
}

// ─── The home machine's side: the pull ───────────────────────────────────────

/** What the home machine asks of the hub over ssh: its login shell's `ep0ch`, without this side's routing. */
const remoteEp0ch = (command: string) => `exec env -u EP0CH_SOCKET -u EP0CH_MACHINE -u EP0CH_WS "\${SHELL:-/bin/sh}" -lc '${command}'`;

async function ssh(env: Env, hub: string, command: string, stdin?: string): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn([env.EP0CH_SSH || "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "--", hub, remoteEp0ch(command)], {
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout: "pipe", stderr: "pipe", env: env as Record<string, string>,
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}

/** The JSON object a remote command printed, past whatever a login shell printed around it (a motd). */
function lastJson(text: string): unknown {
  for (const line of text.split("\n").reverse()) {
    const t = line.trim();
    if (t.startsWith("{")) { try { return JSON.parse(t); } catch { /* not this line */ } }
  }
  throw new Error(`no JSON in its answer (${JSON.stringify(text.trim().slice(0, 120))})`);
}

type Ledger = Record<string, NetmailSettled>;
const LEDGER = "netmail-applied.json";
const readLedger = (dir: string): Ledger => { try { return JSON.parse(readFileSync(join(dir, LEDGER), "utf8")) as Ledger; } catch { return {}; } };

export interface PullOptions {
  hub: string;
  /** This machine's name on the hub (EP0CH_BACKUP_MACHINE): the machine its mirrors are named by. */
  machine: string;
  /** Where the ledger lives: the backup job's state folder. */
  state: string;
  env: Env;
  now?: () => number;
  say?: (line: string) => void;
  /** Opens one of this machine's outlines (tests pass their scratch host's). */
  open?: (outline: string) => Promise<NotesBoard | { error: string }>;
}

export interface PullResult { ok: boolean; detail: string; taken: number; settled: NetmailSettled[] }

/** Applies one queued entry to this machine's outline, as its access allows now. */
export async function applyEntry(board: NotesBoard, e: NetmailEntry, now: () => number): Promise<NetmailSettled> {
  const at = () => new Date(now()).toISOString();
  const refused = (said: string): NetmailSettled => ({ id: e.id, state: "refused", said, uri: e.uri, at: at() });
  if (!isWriteTool(e.tool)) return refused(`${e.tool} isn't a write this machine knows`);
  const level = (await board.mcpAccessStatus()).level;
  if (level !== "propose" && level !== "full") return refused(`MCP access for ${e.outline} is ${level} here now, so the write queued at ${e.queuedAt} was dropped`);
  const info = await board.info();
  const uri = (blockId: string) => formatEp0chBlockUri({ ...board.address, blockId });
  const write: McpWrite = { tool: e.tool, blockId: e.blockId, input: e.input, ...(e.revision !== null ? { revision: e.revision } : {}) };
  // Whether the note is still what the mirror showed: the same database at the same revision, or (a database replaced
  // since, whose revisions mean nothing here) the same text, read at the caller's revision. Anything else is proposed.
  let revision: number | undefined, proposeOnly = false;
  if (e.revision !== null) {
    const r = (await board.records([e.blockId])).records.find(x => x.id === e.blockId);
    if (!r) return refused(`${e.uri} isn't in ${e.outline} here (deleted since it was written?)`);
    const sameDatabase = !!e.instanceId && e.instanceId === info.outlineInstanceId;
    if (sameDatabase) revision = e.revision;
    else if (e.textHash && e.textHash === textHash(r.text) && e.revision === e.mirrorRevision) revision = r.revision;
    else { proposeOnly = true; revision = r.revision; }
  }
  // At the level it was queued under, or narrower: an owner who has since moved full to propose gets proposals.
  const effective: McpAccessLevel = e.level === "propose" || level === "propose" ? "propose" : "full";
  try {
    const done: WriteOutcome = await applyWrite(board, write, { level: effective, actor: { actorId: e.actorId, sessionId: e.subject }, uri, proposeOnly, ...(revision !== undefined ? { revision } : {}), queued: { at: e.queuedAt } });
    return { id: e.id, state: done.outcome, said: `${done.said} (queued ${e.queuedAt})`, ...(done.uri ? { uri: done.uri } : {}), at: at() };
  } catch (err) {
    return refused(`refused here: ${(err as Error).message}`);
  }
}

/** One pull: take this machine's entries from the hub, apply each, settle them there. */
export async function pullNetmail(o: PullOptions): Promise<PullResult> {
  const now = o.now ?? Date.now, say = o.say ?? (() => {});
  const took = await ssh(o.env, o.hub, `ep0ch mcp queue take --machine ${o.machine} --json`);
  if (took.code !== 0) {
    const why = took.code === 255 ? `${o.hub} doesn't answer over ssh` : took.code === 127 || /not found/.test(took.err) ? `${o.hub} has no ep0ch on a login shell's PATH` : `ep0ch mcp queue take on ${o.hub} failed (${took.code}): ${took.err.trim().split("\n").at(-1)}`;
    return { ok: false, detail: why, taken: 0, settled: [] };
  }
  let entries: NetmailEntry[];
  try { entries = (lastJson(took.out) as { entries: NetmailEntry[] }).entries; if (!Array.isArray(entries)) throw new Error("no entries list"); }
  catch (e) { return { ok: false, detail: `${o.hub}'s queue answered oddly: ${(e as Error).message}`, taken: 0, settled: [] }; }
  const ledger = readLedger(o.state);
  if (!entries.length && !Object.keys(ledger).length) return { ok: true, detail: `nothing queued on ${o.hub}`, taken: 0, settled: [] };
  const open = o.open ?? (name => boardFor(["--ws", name, "--here"]));
  const boards = new Map<string, NotesBoard | { error: string }>();
  const results: NetmailSettled[] = [];
  try {
    for (const e of entries) {
      if (ledger[e.id]) { results.push(ledger[e.id]!); continue; }
      let board = boards.get(e.outline);
      if (!board) boards.set(e.outline, board = await open(e.outline));
      // An outline that isn't open here now waits for the next pull; it isn't settled.
      if ("error" in board) { say(`netmail: ${e.outline} isn't open here (${board.error}); its writes wait`); continue; }
      const r = await applyEntry(board, e, now);
      ledger[e.id] = r;
      writeState(LEDGER, ledger, o.state);
      results.push(r);
      say(`netmail ${e.outline}: ${r.state} · ${r.said}`);
    }
  } finally { for (const b of boards.values()) if (!("error" in b)) b.close(); }
  // Entries the ledger holds that the hub no longer lists were settled by an earlier pull whose answer was lost.
  const listed = new Set(entries.map(e => e.id));
  for (const id of Object.keys(ledger)) if (!listed.has(id)) delete ledger[id];
  if (!results.length) { writeState(LEDGER, ledger, o.state); return { ok: true, detail: `${entries.length} queued on ${o.hub}, none applied here yet`, taken: entries.length, settled: [] }; }
  const settled = await ssh(o.env, o.hub, `ep0ch mcp queue settle --machine ${o.machine}`, JSON.stringify({ results }));
  if (settled.code !== 0) {
    writeState(LEDGER, ledger, o.state);
    return { ok: false, detail: `applied ${results.length}, but ${o.hub} didn't take what they became (${settled.code}); the next pull tells it again`, taken: entries.length, settled: results };
  }
  for (const r of results) delete ledger[r.id];
  writeState(LEDGER, ledger, o.state);
  const counts = (["applied", "proposed", "unchanged", "refused"] as const).map(s => [s, results.filter(r => r.state === s).length] as const).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`).join(", ");
  return { ok: true, detail: `${results.length} from ${o.hub}: ${counts}`, taken: entries.length, settled: results };
}
