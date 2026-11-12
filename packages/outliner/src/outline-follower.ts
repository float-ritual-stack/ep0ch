// A follower of an outline whose home is another machine (ADR 0009, PIE-1751; it replaces PIE-562's mirror). float-hub
// lives on the laptop, which is often asleep or behind a VPN, so a client on float-2 (the remote MCP gateway, the web
// client's pages of the laptop's outline, a link read) reads a copy here and never depends on the laptop answering.
//
// The copy is `<mirrors>/<machine>/<outline>.sqlite`, the home's change log applied from its cursor: the owner asks
// the home's host for `log.range` through the shared forward (`<outlines>/.remote/<machine>.sock`) whenever the home's
// event stream says something changed, and every FOLLOW_EVERY_MS without one, and applies each range through the store
// that answers the copy's reads. A range that doesn't follow the copy's cursor is refused (change-log.ts
// `checkFollows`): another log, or a home put back to an earlier file, rebuilds the copy from the home's genesis
// beside it and swaps it in; another schema leaves the copy as it is, stale, saying which machine to update.
//
// One process serves a machine's copies: the first to need them starts a read-only outline host on that folder and
// holds its lock; every other process (the gateway, the web client, the outline host's link reads) attaches its own
// reader to that host's socket (`attach`), and takes over when the owner has gone. The owner writes what each copy
// holds (`.follow/<outline>.json`: the cursor, when the last range landed, and whether it is stale) for the others.
//
// A copy older than this build's schema (a deploy here while the home sleeps) is taken up by `migrate` and served,
// stale, until the home's own migration writes the genesis it rebuilds from.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isMachineName, isOutlineName, outlineLayout, outlinesFolder } from "@ep0ch/outline-core/outline-location";
import { MCP_ACCESS_LEVELS, type McpAccessLevel } from "@ep0ch/outline-core/protocol";
import { applyRange, RangeRefused, type LogRange } from "./change-log";

type Env = Record<string, string | undefined>;

/** The outliner's OutlineHost, as much of it as a follower uses. Loaded when the first copy is served. */
interface FolderHost { readonly socketPath: string; start(): Promise<void>; close(): Promise<void>; applyLog(name: string, range: LogRange): Promise<number>; closeOutline(name: string): Promise<unknown>; open(name: string): Promise<{ store: { log: { cursor(): { lsn: number; logId: string } }; outlineInstanceId: string } }> }
type FolderHostClass = new (o: { outlinesFolder: string; readOnly: boolean; log: (line: string) => void; copy?: { machine: string; state: string } }) => FolderHost;
/** Loaded by a name the type checker doesn't follow: a client package checks this file by its own settings, not the host's. */
const OUTLINE_HOST_MODULE = "./outline-host";
const SCHEMA_MODULE = "./schema";
const CLIENT_MODULE = "./client";
const FORWARD_MODULE = "./machine-forward";

/** How often the owner asks the home without an event; a change the event stream missed is at most this late. */
export const FOLLOW_EVERY_MS = 10_000;
/** Entries asked for per range. */
const RANGE_LIMIT = 5_000;

/** Which outlines are followed, and where their copies are: `EP0CH_MCP_MIRRORS`, `EP0CH_MCP_MIRROR_DIR`. */
export interface MirrorsConfig { folder: string; mirrors: { outline: string; machine: string }[] }

/**
 * `EP0CH_MCP_MIRRORS=float-hub@laptop,sysops-log@laptop`: the one list of other machines' outlines this machine
 * follows, read by the MCP gateway, the web client and `ep0ch follow` alike (their units load the same settings file).
 */
export function mirrorsConfig(env: Env): MirrorsConfig | { error: string } {
  const home = env.HOME || homedir();
  const folder = resolve(env.EP0CH_MCP_MIRROR_DIR?.trim() || join(home, "outline-mirrors"));
  // The outlines folder is served writable as this machine's own: a copy there would be both.
  if (folder === outlinesFolder(env, home)) return { error: `EP0CH_MCP_MIRROR_DIR=${folder} is the outlines folder; copies need a folder of their own (e.g. ~/outline-mirrors)` };
  const mirrors: MirrorsConfig["mirrors"] = [];
  for (const item of (env.EP0CH_MCP_MIRRORS ?? "").split(",").map(s => s.trim()).filter(Boolean)) {
    const [outline, machine, extra] = item.split("@");
    if (extra !== undefined || !outline || !isOutlineName(outline) || !machine || !isMachineName(machine)) {
      return { error: `EP0CH_MCP_MIRRORS: ${JSON.stringify(item)} isn't <outline>@<machine> (e.g. float-hub@laptop)` };
    }
    if (mirrors.some(m => m.outline === outline && m.machine === machine)) return { error: `EP0CH_MCP_MIRRORS names ${outline}@${machine} twice` };
    mirrors.push({ outline, machine });
  }
  return { folder, mirrors };
}

/** The metadata key the outliner keeps an outline's MCP access setting under (store.ts `MCP_ACCESS_METADATA_KEY`). */
const ACCESS_KEY = "mcp.local_access";

/** A database's schema version (`PRAGMA user_version`, read-only), or null when it can't be read. */
export function userVersionOf(path: string): number | null {
  try {
    const db = new Database(path, { readonly: true });
    try { return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version; } finally { db.close(); }
  } catch { return null; }
}

/** The access setting a copy carries, read from its metadata alone (any schema has it); null when it can't be read. */
export function accessOf(path: string): McpAccessLevel | null {
  try {
    const db = new Database(path, { readonly: true });
    try {
      const v = (db.query("SELECT value FROM metadata WHERE key = ?").get(ACCESS_KEY) as { value: string } | null)?.value ?? "none";
      return (MCP_ACCESS_LEVELS as readonly string[]).includes(v) ? v as McpAccessLevel : "none";
    } finally { db.close(); }
  } catch { return null; }
}

/** What taking a copy up to this build's schema did: the versions, or why it couldn't. Null: it was current. */
export type Migrated = { from: number; to: number } | { from: number | null; error: string; /** The copy is newer than this build. */ newer?: true };
/** Takes a follower's copy up to the schema this build opens, in place (the copy is the follower's own file). */
export type MigrateCopy = (file: string) => Promise<Migrated | null>;

/** No migration: a copy at another schema than `schema` is refused with what puts it right. */
export const refuseOtherSchemas = (schema: () => number | null): MigrateCopy => async file => {
  const from = userVersionOf(file), to = schema();
  if (from === null) return { from, error: "its schema version can't be read" };
  if (to === null || from === to) return null;
  return from > to
    ? { from, error: `it is schema ${from}, newer than the schema ${to} this build opens; on this machine: ep0ch install --apply`, newer: true }
    : { from, error: `it is schema ${from}, older than the schema ${to} this build opens` };
};

/** Which copy is served: its path under the mirrors folder, when a range last landed here, and the log position it holds. */
export interface MirrorCopy { file: string; copiedAt: string; cursor: number }
/** Stale: the home doesn't answer, or refused to be followed; `since` the last range that landed. */
export interface MirrorStale { since: string | null; why: string }
/** What a read gives: the client's reader of the copy, the newest change it holds, and which copy it is. */
export interface MirrorRead<B> { board: B; asOf: string; stale?: MirrorStale; homeInstanceId: string | null; copy: MirrorCopy; migrated?: { from: number; to: number } }
/** Why a copy can't be read; `access` is the setting it carries, when its metadata can still be read. */
export interface MirrorUnreadable { error: string; access?: McpAccessLevel }

/** A client's reader of the copies' host: attached to its socket, closed with the follower. */
export interface Attached<B> { board: B; close(): void }

export interface OutlineFollowerOptions<B> {
  /** Opens the client's reader on the copies' host socket (it names `outline`). */
  attach: (socket: string, outline: string) => Promise<Attached<B>>;
  log?: (line: string) => void;
  now?: () => number;
  /** The schema this build opens; null when it can't be told. */
  schema?: () => number | null;
  /** Takes an older copy up to `schema`; default: refuses any other schema. */
  migrate?: MigrateCopy;
  /** Who logs (`mcp follow`, `web follow`). */
  label?: string;
  /** The home machine's host socket (default: the shared forward, started when nobody has). */
  reach?: (machine: string) => Promise<string>;
  /** The outlines folder whose `.remote/` holds the forwards (default: this machine's). */
  outlines?: string;
  /** How often the owner asks the home without an event (default FOLLOW_EVERY_MS). */
  everyMs?: number;
}

/** What the owner says of a copy, for every process that reads it. */
interface FollowStatus { cursor: number; logId: string | null; asOf: string | null; copiedAt: string | null; homeInstanceId: string | null; stale: MirrorStale | null; migrated?: { from: number; to: number } }

/** One machine's copies folder, as this process has it: served by its own host (the owner) or attached to another's. */
interface Folder {
  dir: string; machine: string; owner: FolderHost | null; socket: string;
  claiming: Promise<void> | null;
  loops: Map<string, { loop: FollowLoop; users: number }>;
  /** When the other process's host last answered (a read asks again at most every ANSWER_CHECK_MS). */
  answeredAt: number;
}
const ANSWER_CHECK_MS = 5_000;
/** How long a read waits for the first copy to arrive; a home that accepts and never answers doesn't hold reads up. */
const FIRST_COPY_WAIT_MS = 3_000;
/** A home that wasn't reached is asked again after this (each ask can be an ssh spawn). */
const REACH_BACKOFF_MS = 15_000;
const folders = new Map<string, Folder>();

const statusFile = (dir: string, outline: string) => join(dir, ".follow", `${outline}.json`);
function readStatus(dir: string, outline: string): FollowStatus | null {
  try { return JSON.parse(readFileSync(statusFile(dir, outline), "utf8")) as FollowStatus; } catch { return null; }
}
function writeStatus(dir: string, outline: string, s: FollowStatus): void {
  const file = statusFile(dir, outline);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(s)}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

/** Whether something answers at a socket (the copies' host, run by another process). */
async function answers(socket: string): Promise<boolean> {
  if (!existsSync(socket)) return false;
  const { OutlinerClient } = await import(CLIENT_MODULE) as typeof import("./client");
  try { await new OutlinerClient(socket, 1_500).request({ action: "outlines.list" } as never); return true; } catch { return false; }
}

/** The removal of a database file and its side files (a copy being replaced: nothing has it open). */
const removeDatabase = (path: string) => { for (const s of ["", "-wal", "-shm"]) rmSync(path + s, { force: true }); };

/**
 * One followed outline in the owner: asks the home for ranges and applies them, one pull at a time, woken by the home's
 * events and a timer.
 */
class FollowLoop {
  private pulling: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private watcher: { stop(): Promise<void> } | null = null;
  private stopped = false;
  /** The home's last refusal to be reached, and when: asked again only after REACH_BACKOFF_MS (an ssh spawn each time). */
  private unreached: { at: number; error: Error } | null = null;
  status: FollowStatus;

  constructor(private readonly folder: Folder, readonly outline: string, private readonly o: Required<Pick<OutlineFollowerOptions<unknown>, "log" | "now" | "schema" | "migrate" | "label" | "reach" | "everyMs">>) {
    this.status = readStatus(folder.dir, outline) ?? { cursor: 0, logId: null, asOf: null, copiedAt: null, homeInstanceId: null, stale: null };
  }

  private get file() { return join(this.folder.dir, `${this.outline}.sqlite`); }
  private say(line: string) { this.o.log(`${this.o.label} ${this.outline}@${this.folder.machine}: ${line}`); }

  start(): void {
    this.timer = setInterval(() => void this.pull(), this.o.everyMs);
    (this.timer as { unref?: () => void }).unref?.();
    void this.watch();
  }

  /** The home's event stream: any change there is a pull here, a moment later. */
  private async watch(): Promise<void> {
    const { OutlinerWatcher } = await import(CLIENT_MODULE) as typeof import("./client");
    if (this.stopped) return;
    let socket: string;
    try { socket = await this.reachHome(); } catch { setTimeout(() => void this.watch(), this.o.everyMs).unref?.(); return; }
    let soon: ReturnType<typeof setTimeout> | null = null;
    const nudge = () => { if (soon) return; soon = setTimeout(() => { soon = null; void this.pull(); }, 150); (soon as { unref?: () => void }).unref?.(); };
    this.watcher = new OutlinerWatcher(socket, {
      client: { clientId: `follower:${process.pid}:${this.outline}`, role: "observer", contextId: "follow" },
      onConnect: nudge, onEvent: nudge, onError: () => {},
    }, 5_000, this.outline, async () => { await this.reachHome(); });
  }

  /** One pull at a time; a pull asked for while one runs runs once more after it. */
  pull(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.pulling) { this.again = true; return this.pulling; }
    this.pulling = this.pullNow().finally(() => {
      this.pulling = null;
      if (this.again && !this.stopped) { this.again = false; void this.pull(); }
    });
    return this.pulling;
  }

  private stale(why: string): void {
    const since = this.status.copiedAt;
    if (this.status.stale?.why !== why) this.say(`stale: ${why}`);
    this.status = { ...this.status, stale: { since, why } };
    writeStatus(this.folder.dir, this.outline, this.status);
  }

  /** The home's host socket, or why not; a home that wasn't reached isn't asked again for REACH_BACKOFF_MS. */
  private async reachHome(): Promise<string> {
    if (this.unreached && this.o.now() - this.unreached.at < REACH_BACKOFF_MS) throw this.unreached.error;
    try { const socket = await this.o.reach(this.folder.machine); this.unreached = null; return socket; }
    catch (e) { this.unreached = { at: this.o.now(), error: e as Error }; throw e; }
  }

  private async client() {
    const { OutlinerClient } = await import(CLIENT_MODULE) as typeof import("./client");
    return new OutlinerClient(await this.reachHome(), 15_000, this.outline);
  }

  private async pullNow(): Promise<void> {
    const host = this.folder.owner!;
    // The copy here first, whether or not its home answers: one older than this build is taken up, and one found here
    // with nothing said of it (an earlier copy, a status file lost) is served as it is until the home answers.
    let opened: Awaited<ReturnType<FolderHost["open"]>> | null = null;
    if (existsSync(this.file)) {
      try { opened = await host.open(this.outline); }
      catch (e) {
        if (!(await this.takeUp(e))) return;
        try { opened = await host.open(this.outline); }
        catch (again) { this.stale(`the copy can't be opened: ${(again as Error).message}`); return; }
      }
      if (!this.status.copiedAt) {
        const at = new Date(statSync(this.file).mtimeMs).toISOString();
        this.status = { ...this.status, cursor: opened.store.log.cursor().lsn, asOf: at, copiedAt: at, homeInstanceId: opened.store.outlineInstanceId };
        writeStatus(this.folder.dir, this.outline, this.status);
      }
    }
    let home;
    try { home = await this.client(); } catch (e) { this.stale(`${this.folder.machine} doesn't answer: ${(e as Error).message}`); return; }
    const ask = (after: number) => home.request<LogRange>({ action: "log.range", after, limit: RANGE_LIMIT } as never);
    try {
      if (!opened) { await this.rebuild(ask, "a first copy"); return; }
      for (;;) {
        const at = opened.store.log.cursor();
        const range = await ask(at.lsn);
        try { await host.applyLog(this.outline, range); }
        catch (e) {
          if (!(e instanceof RangeRefused)) throw e;
          if (e.rebuild) { await this.rebuild(ask, e.message); return; }
          this.stale(e.message);
          return;
        }
        this.landed(range, opened.store.outlineInstanceId);
        if (range.complete) return;
      }
    } catch (e) {
      this.stale(`${this.folder.machine} didn't give its log: ${(e as Error).message}`);
    }
  }

  /** A copy the host can't open: one older than this build is migrated in place, and served stale until the home's genesis. */
  private async takeUp(error: unknown): Promise<boolean> {
    const migrated = await this.o.migrate(this.file);
    if (!migrated) { this.stale(`the copy can't be opened: ${(error as Error).message}`); return false; }
    if ("error" in migrated) { this.stale(`the copy is schema ${migrated.from ?? "?"} and can't be taken up to this build's: ${migrated.error}`); return false; }
    this.say(`migrated the copy from schema ${migrated.from} to ${migrated.to}; a range from ${this.folder.machine} rebuilds it when its own migration has run`);
    this.status = { ...this.status, migrated: { from: migrated.from, to: migrated.to } };
    return true;
  }

  private landed(range: LogRange, homeInstanceId: string | null): void {
    const last = range.entries.at(-1);
    this.status = {
      cursor: last?.lsn ?? range.after, logId: range.logId, asOf: last?.at ?? this.status.asOf ?? new Date(this.o.now()).toISOString(),
      copiedAt: last ? new Date(this.o.now()).toISOString() : this.status.copiedAt ?? new Date(this.o.now()).toISOString(), homeInstanceId, stale: null,
    };
    writeStatus(this.folder.dir, this.outline, this.status);
  }

  /**
   * A fresh copy from the home's newest genesis, built beside the served one by a connection of its own (nothing serves
   * it yet), then swapped in with the old one closed.
   */
  private async rebuild(ask: (after: number) => Promise<LogRange>, why: string): Promise<void> {
    const { openFollowerSchema, SCHEMA_VERSION } = await import(SCHEMA_MODULE) as typeof import("./schema");
    const first = await ask(0);
    const aside = join(this.folder.dir, `.${this.outline}.rebuild.sqlite`);
    removeDatabase(aside);
    mkdirSync(this.folder.dir, { recursive: true, mode: 0o700 });
    const db = new Database(aside, { create: true });
    let range = first, instance: string | null = null;
    try {
      db.exec("PRAGMA journal_mode = WAL;");
      openFollowerSchema(db, first.logId);
      for (;;) {
        applyRange(db, range, SCHEMA_VERSION);
        if (range.complete) break;
        range = await ask(range.entries.at(-1)!.lsn);
      }
      instance = (db.query("SELECT value FROM metadata WHERE key = 'outline_instance_id'").get() as { value: string } | null)?.value ?? null;
    } catch (e) {
      db.close();
      removeDatabase(aside);
      if (e instanceof RangeRefused) { this.stale(e.message); return; }
      throw e;
    }
    db.close();
    if (existsSync(this.file)) await this.folder.owner!.closeOutline(this.outline).catch(() => {});
    removeDatabase(this.file);
    renameSync(aside, this.file);
    this.say(`copy made from ${this.folder.machine}'s log (${why}), at ${range.entries.at(-1)?.lsn ?? range.after}`);
    this.landed(range, instance);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.watcher?.stop();
    // A pull waiting on a silent home isn't waited out: what it brings lands, or doesn't, after.
    await Promise.race([this.pulling?.catch(() => {}), Bun.sleep(1_000)]);
  }
}

export class OutlineFollower<B> {
  /** The copy: `<mirrors>/<machine>/<outline>.sqlite`. */
  readonly follow: string;
  private readonly dir: string;
  private readonly homeFile: string;
  private readonly shares: string;
  private attached: Attached<B> | null = null;
  /** Whether this follower counts among its loop's users (the owner's). */
  private looping = false;
  private attachedTo: string | null = null;
  private closed = false;
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private readonly schema: () => number | null;
  private readonly migrate: MigrateCopy;
  private readonly label: string;
  private readonly reach: (machine: string) => Promise<string>;
  private readonly everyMs: number;

  constructor(readonly outline: string, readonly machine: string, folder: string, private readonly options: OutlineFollowerOptions<B>) {
    this.log = options.log ?? console.error;
    this.now = options.now ?? Date.now;
    this.schema = options.schema ?? (() => null);
    this.migrate = options.migrate ?? refuseOtherSchemas(this.schema);
    this.label = options.label ?? "follow";
    this.everyMs = options.everyMs ?? FOLLOW_EVERY_MS;
    const outlines = options.outlines;
    this.reach = options.reach ?? (async m => (await (await import(FORWARD_MODULE) as typeof import("./machine-forward")).forwardFor(m, outlines ?? outlinesFolder({ EP0CH_OUTLINES: process.env.EP0CH_OUTLINES }, process.env.HOME || homedir()))).socket);
    this.dir = join(folder, machine);
    this.follow = join(this.dir, `${outline}.sqlite`);
    this.homeFile = join(folder, ".home", machine, `${outline}.name`);
    // Shared by every process that serves the copy: a snapshot link the gateway mints is downloaded through the web
    // client, and what the web client's pages show is what the gateway's reader_view says (PIE-1091).
    this.shares = join(folder, ".shares", machine);
    // Followed from the start, not from the first read: a read comes when the home is already away.
    this.starting = this.folder().then(() => {}, e => this.log(`${this.label} ${outline}@${machine}: ${(e as Error).message}`));
  }
  private readonly starting: Promise<void>;

  /**
   * The name the outline's own machine gives itself (its host's hostname, as a URI machine name), learned the last time
   * its host answered live, and kept across restarts. Null until then. The ssh name stays an accepted alias.
   */
  homeName(): string | null {
    try { return readFileSync(this.homeFile, "utf8").trim() || null; } catch { return null; }
  }
  rememberHome(name: string): void {
    if (name === this.homeName()) return;
    try { mkdirSync(dirname(this.homeFile), { recursive: true, mode: 0o700 }); writeFileSync(this.homeFile, `${name}\n`); } catch { /* the alias is a convenience */ }
  }

  /** Whether a copy has arrived. */
  exists(): boolean { return existsSync(this.follow); }

  /** This machine's copies folder, claimed by this process when nobody serves it. */
  private async folder(): Promise<Folder> {
    let f = folders.get(this.dir);
    if (!f) { f = { dir: this.dir, machine: this.machine, owner: null, socket: outlineLayout(this.dir).socket, claiming: null, loops: new Map(), answeredAt: 0 }; folders.set(this.dir, f); }
    if (!f.owner && !f.claiming && this.now() - f.answeredAt >= ANSWER_CHECK_MS) {
      // One look at a time in a process: whoever serves the folder answers, or this process takes it.
      const claimed = f;
      claimed.claiming = (async () => {
        if (await answers(claimed.socket)) { claimed.answeredAt = this.now(); return; }
        claimed.answeredAt = 0;
        await this.claim(claimed);
      })().finally(() => { claimed.claiming = null; });
    }
    await f.claiming;
    if (f.owner && !this.looping && !this.closed) {
      this.looping = true;
      let entry = f.loops.get(this.outline);
      if (!entry) {
        const loop = new FollowLoop(f, this.outline, { log: this.log, now: this.now, schema: this.schema, migrate: this.migrate, label: this.label, reach: this.reach, everyMs: this.everyMs });
        f.loops.set(this.outline, entry = { loop, users: 0 });
        loop.start();
        const first = loop.pull();
        if (!this.exists() || !readStatus(this.dir, this.outline)?.copiedAt) await Promise.race([first, Bun.sleep(FIRST_COPY_WAIT_MS)]);
      }
      entry.users++;
    }
    return f;
  }

  private async claim(f: Folder): Promise<void> {
    mkdirSync(f.dir, { recursive: true, mode: 0o700 });
    const { OutlineHost } = await import(OUTLINE_HOST_MODULE) as { OutlineHost: FolderHostClass };
    const host = new OutlineHost({ outlinesFolder: f.dir, readOnly: true, copy: { machine: this.machine, state: this.shares }, log: line => this.log(`${this.label} ${this.machine}: ${line}`) });
    try { await host.start(); f.owner = host; f.socket = host.socketPath; }
    catch (e) {
      // Another process took it first: it serves, this one attaches.
      await host.close().catch(() => {});
      if (!(await answers(f.socket))) this.log(`${this.label} ${this.machine}: can't serve the copies: ${(e as Error).message}`);
    }
  }

  /** The copy's reader, current as of its home's last answer; or why there's none, worded to follow "<machine>'s copy". */
  async read(): Promise<MirrorRead<B> | MirrorUnreadable> {
    if (this.closed) return { error: "isn't served: this process is stopping" };
    const f = await this.folder();
    const status = readStatus(this.dir, this.outline);
    if (!this.exists() || !status?.copiedAt) {
      const why = status?.stale?.why;
      if (this.exists() && why) {
        // The access setting stays known while the copy can't be read: the list says what a write would become.
        const access = accessOf(this.follow);
        return { error: `can't be read: ${why}`, ...(access ? { access } : {}) };
      }
      return { error: `hasn't arrived yet (${why ?? `${this.machine}'s log hasn't been followed here yet`})` };
    }
    if (!f.owner && f.answeredAt === 0) return { error: "isn't served: the process that serves it has stopped; the next read takes it over" };
    if (this.attachedTo !== f.socket) {
      this.attached?.close();
      this.attached = null;
      try { this.attached = await this.options.attach(f.socket, this.outline); this.attachedTo = f.socket; }
      catch (e) {
        const access = accessOf(this.follow);
        return { error: `can't be read: ${(e as Error).message}`, ...(access ? { access } : {}) };
      }
    }
    return {
      board: this.attached!.board, asOf: status.asOf ?? status.copiedAt, homeInstanceId: status.homeInstanceId,
      copy: { file: `${this.machine}/${this.outline}.sqlite`, copiedAt: status.copiedAt, cursor: status.cursor },
      ...(status.migrated ? { migrated: status.migrated } : {}), ...(status.stale ? { stale: status.stale } : {}),
    };
  }

  /** Asks the home now (the owner only; another process's copy is current on its owner's clock). */
  async pull(): Promise<void> {
    const f = await this.folder();
    await f.loops.get(this.outline)?.loop.pull();
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.starting;
    this.attached?.close();
    this.attached = null;
    const f = folders.get(this.dir);
    const entry = f?.loops.get(this.outline);
    if (!f || !entry || !this.looping) return;
    this.looping = false;
    if (--entry.users > 0) return;
    f.loops.delete(this.outline);
    await entry.loop.stop();
    if (f.owner && f.loops.size === 0) {
      const host = f.owner;
      f.owner = null;
      folders.delete(this.dir);
      await host.close().catch(e => this.log(`${this.label} ${this.machine}: ${(e as Error).message}`));
    }
  }
}
