// A read-only mirror of an outline whose home is another machine (PIE-562). float-hub lives on the laptop, which is
// often asleep or behind a VPN, so a client on this machine (the remote MCP gateway, the web client's pages of another
// machine's outline) can read a copy here instead, and never depend on the laptop answering. The copy is kept current
// from the outline's own backups: the laptop's Litestream replicates it to the bucket, and `litestream restore -f` here
// follows that replica into `<mirrors>/<machine>/<name>.sqlite` (the door README's "Remote MCP gateway"). That file is
// Litestream's; nothing here writes to it. While a follower still runs, the backup job's restic restore lands beside
// it, in `<mirrors>/.restic/<machine>/` (door backup/jobs.ts `mirrorFolder`); whichever of the two holds the newer
// change is served, and every read names which (`copy`).
//
// To read it, the mirror snapshots the followed file whenever it has changed (`VACUUM INTO`, from a read-only
// connection) and serves the snapshot from an outline host of its own, in this process, opened `readOnly` (OutlineHost:
// the same service and the same reads as a live outline, and nothing but reads). Each snapshot is a generation in its
// own folder; the one before is closed a while after it is replaced. The access setting is the one the copy carries,
// so `ep0ch mcp access` on the laptop reaches the mirror with its next change. So is the home database's instance id
// (read from the copy's metadata before the host here opens it): a write queued for the home machine carries it.
//
// Each client attaches its own reader to a generation's socket (`attach`): the gateway a door board, the web client a
// publisher. The gateway's own settings and checks (the follower's health, the migration scripts) are the door's
// (packages/door/src/mcp-mirror.ts), passed in. Which outlines are mirrored is one setting, `EP0CH_MCP_MIRRORS`.
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isMachineName, isOutlineName, outlinesFolder } from "@ep0ch/outline-core/outline-location";
import { MCP_ACCESS_LEVELS, type McpAccessLevel } from "@ep0ch/outline-core/protocol";

type Env = Record<string, string | undefined>;

/** The outliner's OutlineHost, as much of it as a mirror uses. Loaded when the first generation opens. */
interface OutlineHost { readonly socketPath: string; start(): Promise<void>; close(): Promise<void> }
type OutlineHostClass = new (o: { outlinesFolder: string; readOnly: boolean; log: (line: string) => void }) => OutlineHost;
/** Loaded by a name the type checker doesn't follow: a client package checks this file by its own settings, not the host's. */
const OUTLINE_HOST_MODULE = "./outline-host";
const OUTLINE_INSTANCE_MODULE = "./outline-instance";
const loadOutlineHost = async () => (await import(OUTLINE_HOST_MODULE) as { OutlineHost: OutlineHostClass }).OutlineHost;

/** How often a read looks for a newer copy; a change is at most this late. */
const CHECK_EVERY_MS = 15_000;
/** How long a replaced generation keeps serving the reads that began on it. */
const RETIRE_AFTER_MS = 120_000;

/** Which outlines are mirrored, and where the followed copies are: `EP0CH_MCP_MIRRORS`, `EP0CH_MCP_MIRROR_DIR`. */
export interface MirrorsConfig { folder: string; mirrors: { outline: string; machine: string }[] }

/**
 * `EP0CH_MCP_MIRRORS=float-hub@laptop,sysops-log@laptop`: the one list of other machines' outlines this machine reads,
 * read by the MCP gateway and the web client alike (both units load it from the same settings file).
 */
export function mirrorsConfig(env: Env): MirrorsConfig | { error: string } {
  const home = env.HOME || homedir();
  const folder = resolve(env.EP0CH_MCP_MIRROR_DIR?.trim() || join(home, "outline-mirrors"));
  // The outlines folder is served writable and replicated as this machine's own: a copy there would be both.
  if (folder === outlinesFolder(env, home)) return { error: `EP0CH_MCP_MIRROR_DIR=${folder} is the outlines folder; mirrors need a folder of their own (e.g. ~/outline-mirrors)` };
  const mirrors: MirrorsConfig["mirrors"] = [];
  for (const item of (env.EP0CH_MCP_MIRRORS ?? "").split(",").map(s => s.trim()).filter(Boolean)) {
    const [outline, machine, extra] = item.split("@");
    if (extra !== undefined || !outline || !isOutlineName(outline) || !machine || !isMachineName(machine)) {
      return { error: `EP0CH_MCP_MIRRORS: ${JSON.stringify(item)} isn't <outline>@<machine> (e.g. float-hub@laptop)` };
    }
    if (mirrors.some(m => m.outline === outline)) return { error: `EP0CH_MCP_MIRRORS names ${outline} twice` };
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

/** What taking a served copy up to this build's schema did: the versions, or why it couldn't. Null: it was current. */
export type Migrated = { from: number; to: number } | { from: number | null; error: string; /** The copy is newer than this build, so a fresher snapshot would not help. */ newer?: true };
/** Takes a PRIVATE copy up to the schema this build opens (never the mirror it came from). */
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

/** Which copy is served: its path under the mirrors folder, and when it last changed here. */
export interface MirrorCopy { file: string; copiedAt: string }

/** Stale: the copy's follower has stopped, or is behind the replica it follows; `since` when that's known. */
export interface MirrorStale { since: string | null; why: string }
/** What a mirror read gives: the client's reader of the copy, the newest change it holds, and which copy it is. */
export interface MirrorRead<B> { board: B; asOf: string; stale?: MirrorStale; homeInstanceId: string | null; copy: MirrorCopy; migrated?: { from: number; to: number } }
/** Why a mirror can't be read; `access` is the setting its copy carries, when the copy's metadata can still be read. */
export interface MirrorUnreadable { error: string; access?: McpAccessLevel }

/** A client's reader of one generation: attached to its host's socket, closed when the generation goes. */
export interface Attached<B> { board: B; /** The newest change the copy holds (ms), 0 when it holds none. */ newest: number; close(): void }

export interface OutlineMirrorOptions<B> {
  /** Opens the client's reader on a generation's host socket (it names `outline`). */
  attach: (socket: string, outline: string) => Promise<Attached<B>>;
  log?: (line: string) => void;
  now?: () => number;
  /** Whether the copy's follower keeps up (the gateway asks this machine's Litestream unit); none: never stale. */
  askHealth?: (follow: string) => Promise<MirrorStale | null>;
  /** The schema this build opens; null when it can't be told. */
  schema?: () => number | null;
  /** Takes an older private copy up to `schema`; default: refuses any other schema. */
  migrate?: MigrateCopy;
  /** Who logs (`mcp mirror`, `web mirror`), and the folder under `.serve/` this process serves from. */
  label?: string;
}

interface Generation<B> { dir: string; host: OutlineHost; attached: Attached<B>; asOf: string; marker: string; homeInstanceId: string | null; copy: MirrorCopy; migrated?: { from: number; to: number } }

/** How often a read asks whether the follower keeps up (it lists the replica's files), and how long it waits. */
const HEALTH_EVERY_MS = 60_000;
const HEALTH_WAIT_MS = 3_000;

export class OutlineMirror<B> {
  /** The file Litestream follows the replica into. */
  readonly follow: string;
  /** Where the backup job restores it while a follower still writes `follow`. */
  readonly restic: string;
  private readonly work: string;
  private current: Generation<B> | null = null;
  private readonly retiring = new Set<Generation<B>>();
  private checkedAt = 0;
  private refreshing: Promise<void> | null = null;
  private made = 0;
  private problem: string | null = null;
  private closed = false;

  private health: { at: number; stale: MirrorStale | null } | null = null;
  private asking: Promise<void> | null = null;
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private readonly askHealth: (follow: string) => Promise<MirrorStale | null>;
  private readonly schema: () => number | null;
  private readonly migrate: MigrateCopy;
  private readonly label: string;

  constructor(readonly outline: string, readonly machine: string, folder: string, private readonly options: OutlineMirrorOptions<B>) {
    this.log = options.log ?? console.error;
    this.now = options.now ?? Date.now;
    this.askHealth = options.askHealth ?? (async () => null);
    this.schema = options.schema ?? (() => null);
    this.migrate = options.migrate ?? refuseOtherSchemas(this.schema);
    this.label = options.label ?? "mirror";
    this.homeFile = join(folder, ".home", machine, `${outline}.name`);
    this.follow = join(folder, machine, `${outline}.sqlite`);
    this.restic = join(folder, ".restic", machine, `${outline}.sqlite`);
    // This process's own folder: another process on the same mirrors (the gateway, the web client) serves from its own.
    this.work = join(folder, ".serve", machine, outline, String(process.pid));
  }

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
  private readonly homeFile: string;

  /** Whether a copy has arrived (Litestream's follow, or the backup job's restore, made the file). */
  exists(): boolean { return existsSync(this.follow) || existsSync(this.restic); }

  /**
   * The newest copy's reader, checked for a newer one at most every CHECK_EVERY_MS; or why there's none, worded to
   * follow "<machine>'s copy" ("hasn't arrived yet", "can't be read: …").
   */
  async read(): Promise<MirrorRead<B> | MirrorUnreadable> {
    if (this.closed) return { error: "isn't served: this process is stopping" };
    if (!this.exists()) return { error: "hasn't arrived yet (its backup hasn't been followed here)" };
    if (!this.current || this.now() - this.checkedAt >= CHECK_EVERY_MS) {
      this.refreshing ??= this.refresh().finally(() => { this.refreshing = null; });
      await this.refreshing;
    }
    if (!this.current) {
      // The access setting stays known while the copy can't be read: the list says what a write would become, and why none can be made.
      const access = accessOf(this.freshest());
      return { error: `can't be read: ${this.problem ?? "unknown"}`, ...(access ? { access } : {}) };
    }
    const stale = await this.staleness();
    return { board: this.current.attached.board, asOf: this.current.asOf, homeInstanceId: this.current.homeInstanceId, copy: this.current.copy, ...(this.current.migrated ? { migrated: this.current.migrated } : {}), ...(stale ? { stale } : {}) };
  }

  /**
   * Whether the follower keeps up, asked at most every HEALTH_EVERY_MS and waited on for at most HEALTH_WAIT_MS (a slow
   * answer lands for the next read). Unknown (no follower unit here, the replica unreadable) is not stale.
   */
  private async staleness(): Promise<MirrorStale | null> {
    if (!this.health || this.now() - this.health.at >= HEALTH_EVERY_MS) {
      this.asking ??= this.askHealth(this.follow)
        .then(stale => { this.health = { at: this.now(), stale }; }, e => { this.log(`${this.label} ${this.outline}@${this.machine}: can't check its follower: ${(e as Error).message}`); this.health = { at: this.now(), stale: this.health?.stale ?? null }; })
        .finally(() => { this.asking = null; });
      await Promise.race([this.asking, Bun.sleep(HEALTH_WAIT_MS)]);
    }
    return this.health?.stale ?? null;
  }

  private relative(path: string): string { return path.slice(join(this.follow, "..", "..").length + 1); }

  /** A file's state: a change in it or its WAL is a newer copy. */
  private static markerOf(path: string): string {
    return ["", "-wal"].map(suffix => { try { const s = statSync(path + suffix); return `${s.mtimeMs}:${s.size}`; } catch { return "-"; } }).join("/");
  }

  /** Both copies' state: a change in either may make the other one the newer. */
  private marker(): string { return `${OutlineMirror.markerOf(this.follow)}|${OutlineMirror.markerOf(this.restic)}`; }

  /**
   * The copy to serve: the one at the newer schema (up to this build's: an older copy has to be migrated, a newer one
   * can't be read), then the one at the later point in its outline's history (the service's change sequence, which
   * every change advances, an access setting's too: block times alone would miss a revoked grant). The follower's
   * wins a tie, unless it is stale (erroring or behind its replica), when the backup job's restore does. Read from
   * read-only connections; a copy that can't be read loses.
   */
  private freshest(): string {
    const position = (path: string) => {
      if (!existsSync(path)) return null;
      try {
        const db = new Database(path, { readonly: true });
        try {
          db.exec("PRAGMA busy_timeout = 5000;");
          const v = Number((db.query("SELECT value FROM metadata WHERE key = 'sequence'").get() as { value: string } | null)?.value);
          const schema = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
          return Number.isFinite(v) ? { sequence: v, schema } : null;
        } finally { db.close(); }
      } catch { return null; }
    };
    const follow = position(this.follow), restic = position(this.restic);
    if (!follow || !restic) return restic && !follow ? this.restic : existsSync(this.follow) ? this.follow : this.restic;
    const current = this.schema();
    // Closest to this build's schema from below; a newer one can't be opened here at all.
    const score = (p: { schema: number }) => current !== null && p.schema > current ? -1 : p.schema;
    if (score(restic) !== score(follow)) return score(restic) > score(follow) ? this.restic : this.follow;
    if (restic.sequence !== follow.sequence) return restic.sequence > follow.sequence ? this.restic : this.follow;
    return this.health?.stale ? this.restic : this.follow;
  }

  private async refresh(): Promise<void> {
    this.checkedAt = this.now();
    const marker = this.marker();
    if (this.current?.marker === marker) return;
    try {
      const next = await this.build(this.freshest(), marker);
      if (this.closed) { await this.drop(next); return; }
      if (this.current) this.retire(this.current);
      this.current = next;
      this.problem = null;
    } catch (e) {
      // A copy that changed and can't be read isn't answered for by the one before: it may have taken away the access
      // the older copy grants. Nothing is served until a snapshot succeeds (the next check tries again).
      if (this.current) { this.retire(this.current); this.current = null; }
      this.problem = (e as Error).message;
      this.log(`${this.label} ${this.outline}@${this.machine}: can't take a snapshot: ${this.problem}`);
    }
  }

  /** A snapshot of a copy, consistent (taken again while it changed underneath), in its own folder. */
  private snapshot(from: string, target: string): void {
    let marker = OutlineMirror.markerOf(from);
    for (let attempt = 0; ; attempt++) {
      rmSync(target, { force: true });
      const source = new Database(from, { readonly: true });
      try {
        source.exec("PRAGMA busy_timeout = 5000;");
        source.run("VACUUM INTO ?", [target]);
      } finally { source.close(); }
      const after = OutlineMirror.markerOf(from);
      if (after === marker) break;
      if (attempt === 2) throw new Error("the copy kept changing while it was read");
      marker = after;
    }
    const copy = new Database(target);
    try {
      const check = copy.query("PRAGMA quick_check").get() as { quick_check?: string } | null;
      if (check?.quick_check !== "ok") throw new Error(`the snapshot failed its check (${check?.quick_check ?? "no answer"})`);
    } finally { copy.close(); }
    chmodSync(target, 0o600);
  }

  private async build(from: string, marker: string): Promise<Generation<B>> {
    if (this.made === 0) this.clearLeftovers();
    const dir = join(this.work, String(++this.made));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    let host: OutlineHost | undefined;
    try {
      const copiedAt = new Date(Math.max(...["", "-wal"].map(suffix => { try { return statSync(from + suffix).mtimeMs; } catch { return 0; } }))).toISOString();
      const served = join(dir, `${this.outline}.sqlite`);
      this.snapshot(from, served);
      // An older schema is taken up on this private copy (never the mirror it came from), or the copy is refused
      // with what puts it right: the home machine uploads a current snapshot.
      const migrated = await this.migrate(served);
      if (migrated && "error" in migrated) {
        throw new Error(`the copy is schema ${migrated.from ?? "?"} and can't be taken up to this build's: ${migrated.error}${migrated.newer ? "" : `. Fix: on ${this.machine}: ep0ch backup snapshot --force   (it uploads a current snapshot, and the mirror here takes it on its next run)`}`);
      }
      if (migrated) this.log(`${this.label} ${this.outline}@${this.machine}: migrated the served copy of ${this.relative(from)} from schema ${migrated.from} to ${migrated.to} (the mirror itself is untouched)`);
      const homeInstanceId = instanceIdOf(served);
      // The host opening the copy would mint a fresh instance id for a file it hasn't seen closed; a copy is its source's
      // instance, so it is told to keep the one it carries (answers name the outline's id, not the copy's).
      (await import(OUTLINE_INSTANCE_MODULE) as { adoptOutlineInstance(path: string): void }).adoptOutlineInstance(served);
      const OutlineHost = await loadOutlineHost();
      host = new OutlineHost({ outlinesFolder: dir, readOnly: true, log: line => this.log(`${this.label} ${this.outline}@${this.machine}: ${line}`) });
      await host.start();
      const attached = await this.options.attach(host.socketPath, this.outline);
      // The marker taken before the snapshot: a change during it is picked up at the next check.
      return { dir, host, attached, marker, homeInstanceId, copy: { file: this.relative(from), copiedAt }, ...(migrated && !("error" in migrated) ? { migrated: { from: migrated.from, to: migrated.to } } : {}), asOf: new Date(attached.newest || Date.parse(copiedAt)).toISOString() };
    } catch (e) {
      await host?.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
      throw e;
    }
  }

  /** Folders left by processes that have gone (each is named by its process id); a running one's are its own. */
  private clearLeftovers(): void {
    const parent = join(this.work, "..");
    let entries: string[] = [];
    try { entries = readdirSync(parent); } catch { return; }
    for (const name of entries) {
      const pid = Number(name);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      if (pid !== process.pid && alive(pid)) continue;
      rmSync(join(parent, name), { recursive: true, force: true });
    }
  }

  private retire(gen: Generation<B>): void {
    this.retiring.add(gen);
    setTimeout(() => { if (this.retiring.delete(gen)) void this.drop(gen); }, RETIRE_AFTER_MS).unref();
  }

  private async drop(gen: Generation<B>): Promise<void> {
    gen.attached.close();
    await gen.host.close().catch(e => this.log(`${this.label} ${this.outline}@${this.machine}: ${(e as Error).message}`));
    rmSync(gen.dir, { recursive: true, force: true });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.refreshing?.catch(() => {});
    const gens = [...this.retiring, ...(this.current ? [this.current] : [])];
    this.retiring.clear();
    this.current = null;
    await Promise.all(gens.map(g => this.drop(g)));
  }
}

/** The instance id a database's metadata holds (the outliner's `outline_instance_id`), or null. */
function instanceIdOf(path: string): string | null {
  const db = new Database(path, { readonly: true });
  try { return (db.query("SELECT value FROM metadata WHERE key = 'outline_instance_id'").get() as { value: string } | null)?.value ?? null; }
  catch { return null; } finally { db.close(); }
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
