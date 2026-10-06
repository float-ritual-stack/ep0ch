// A read-only mirror of an outline whose home is another machine (PIE-562). float-hub lives on the laptop, which is
// often asleep or behind a VPN, so the remote MCP gateway reads a copy on its own machine instead, and never depends on
// the laptop answering. The copy is kept current from the outline's own backups: the laptop's Litestream replicates it
// to the bucket, and `litestream restore -f` here follows that replica into `<mirrors>/<machine>/<name>.sqlite` (the
// door README's "Remote MCP gateway"). That file is Litestream's; nothing here writes to it.
//
// To read it, the gateway snapshots the followed file whenever it has changed (`VACUUM INTO`, from a read-only
// connection) and serves the snapshot from an outline host of its own, in this process, opened `readOnly` (the
// outliner's OutlineHost: the same service and the same reads as a live outline, and nothing but reads). Each snapshot
// is a generation in its own folder; the one before is closed a while after it is replaced. The access setting is the
// one the copy carries, so `ep0ch mcp access` on the laptop reaches the mirror with its next change.
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isMachineName } from "@ep0ch/outline-core/outline-location";
import { outlinesDir } from "./discover";
import type { NotesBoard } from "./notes-cli";
import { OUTLINE_NAME, SocketBoard } from "./socket";

type Env = Record<string, string | undefined>;

/** The outliner's OutlineHost, as much of it as a mirror uses. */
interface OutlineHost { readonly socketPath: string; start(): Promise<void>; close(): Promise<void> }
type OutlineHostClass = new (o: { outlinesFolder: string; readOnly: boolean; log: (line: string) => void }) => OutlineHost;
/**
 * Loaded when the first mirror opens, by a name the type checker doesn't follow: the outliner's sources are checked
 * by its own (looser) settings, not the door's.
 */
const OUTLINE_HOST_MODULE = "@ep0ch/outliner/outline-host";
const loadOutlineHost = async () => (await import(OUTLINE_HOST_MODULE) as { OutlineHost: OutlineHostClass }).OutlineHost;

/** How often a read looks for a newer copy; a change is at most this late. */
const CHECK_EVERY_MS = 15_000;
/** How long a replaced generation keeps serving the reads that began on it. */
const RETIRE_AFTER_MS = 120_000;

/** Which outlines the gateway mirrors, and where the followed copies are: `EP0CH_MCP_MIRRORS`, `EP0CH_MCP_MIRROR_DIR`. */
export interface MirrorsConfig { folder: string; mirrors: { outline: string; machine: string }[] }

export function mirrorsConfig(env: Env): MirrorsConfig | { error: string } {
  const folder = resolve(env.EP0CH_MCP_MIRROR_DIR?.trim() || join(env.HOME || homedir(), "outline-mirrors"));
  // The outlines folder is served writable and replicated as this machine's own: a copy there would be both.
  if (folder === resolve(outlinesDir(env))) return { error: `EP0CH_MCP_MIRROR_DIR=${folder} is the outlines folder; mirrors need a folder of their own (e.g. ~/outline-mirrors)` };
  const mirrors: MirrorsConfig["mirrors"] = [];
  for (const item of (env.EP0CH_MCP_MIRRORS ?? "").split(",").map(s => s.trim()).filter(Boolean)) {
    const [outline, machine, extra] = item.split("@");
    if (extra !== undefined || !outline || !OUTLINE_NAME.test(outline) || !machine || !isMachineName(machine)) {
      return { error: `EP0CH_MCP_MIRRORS: ${JSON.stringify(item)} isn't <outline>@<machine> (e.g. float-hub@laptop)` };
    }
    if (mirrors.some(m => m.outline === outline)) return { error: `EP0CH_MCP_MIRRORS names ${outline} twice` };
    mirrors.push({ outline, machine });
  }
  return { folder, mirrors };
}

interface Generation { dir: string; host: OutlineHost; board: NotesBoard; asOf: string; marker: string }

/** What a mirror read gives: the copy's board and the newest change it holds. */
export interface MirrorRead { board: NotesBoard; asOf: string }

export class OutlineMirror {
  /** The file Litestream follows the replica into. */
  readonly follow: string;
  private readonly work: string;
  private current: Generation | null = null;
  private readonly retiring = new Set<Generation>();
  private checkedAt = 0;
  private refreshing: Promise<void> | null = null;
  private made = 0;
  private problem: string | null = null;
  private closed = false;

  constructor(readonly outline: string, readonly machine: string, folder: string, private readonly log: (line: string) => void = console.error, private readonly now: () => number = Date.now) {
    this.follow = join(folder, machine, `${outline}.sqlite`);
    this.work = join(folder, ".serve", machine, outline);
  }

  /** Whether a copy has arrived (Litestream's follow made the file). */
  exists(): boolean { return existsSync(this.follow); }

  /** The newest copy's board, checked for a newer one at most every CHECK_EVERY_MS; or why there's none. */
  async read(): Promise<MirrorRead | { error: string }> {
    if (this.closed) return { error: "the gateway is stopping" };
    if (!this.exists()) return { error: `no copy of ${this.outline}@${this.machine} has reached this machine yet (${this.follow} doesn't exist)` };
    if (!this.current || this.now() - this.checkedAt >= CHECK_EVERY_MS) {
      this.refreshing ??= this.refresh().finally(() => { this.refreshing = null; });
      await this.refreshing;
    }
    if (!this.current) return { error: `the copy of ${this.outline}@${this.machine} can't be read: ${this.problem ?? "unknown"}` };
    return { board: this.current.board, asOf: this.current.asOf };
  }

  /** The followed file's state: a change in either file is a newer copy. */
  private marker(): string {
    return ["", "-wal"].map(suffix => { try { const s = statSync(this.follow + suffix); return `${s.mtimeMs}:${s.size}`; } catch { return "-"; } }).join("/");
  }

  private async refresh(): Promise<void> {
    this.checkedAt = this.now();
    const marker = this.marker();
    if (this.current?.marker === marker) return;
    try {
      const next = await this.build(marker);
      if (this.closed) { await this.drop(next); return; }
      if (this.current) this.retire(this.current);
      this.current = next;
      this.problem = null;
    } catch (e) {
      // The copy before keeps serving; the next check tries again.
      this.problem = (e as Error).message;
      this.log(`mcp mirror ${this.outline}@${this.machine}: can't take a snapshot: ${this.problem}`);
    }
  }

  /** A snapshot of the followed file, consistent (taken again while it changed underneath), in its own folder. */
  private snapshot(target: string, marker: string): string {
    for (let attempt = 0; ; attempt++) {
      rmSync(target, { force: true });
      const source = new Database(this.follow, { readonly: true });
      try {
        source.exec("PRAGMA busy_timeout = 5000;");
        source.run("VACUUM INTO ?", [target]);
      } finally { source.close(); }
      const after = this.marker();
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
    return marker;
  }

  private async build(marker: string): Promise<Generation> {
    // Folders a gateway before this one left are its own, and nothing serves them now.
    if (this.made === 0) rmSync(this.work, { recursive: true, force: true });
    const dir = join(this.work, String(++this.made));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    let host: OutlineHost | undefined;
    try {
      marker = this.snapshot(join(dir, `${this.outline}.sqlite`), marker);
      const OutlineHost = await loadOutlineHost();
      host = new OutlineHost({ outlinesFolder: dir, readOnly: true, log: line => this.log(`mcp mirror ${this.outline}@${this.machine}: ${line}`) });
      await host.start();
      const board = new SocketBoard(host.socketPath, 30_000, this.outline) as NotesBoard;
      board.address = { outline: this.outline, machine: this.machine };
      try {
        await board.info();
        const newest = Math.max(0, ...(await board.index()).map(b => b.updatedAt).filter(Number.isFinite));
        return { dir, host, board, marker, asOf: new Date(newest || statSync(this.follow).mtimeMs).toISOString() };
      } catch (e) { board.close(); throw e; }
    } catch (e) {
      await host?.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
      throw e;
    }
  }

  private retire(gen: Generation): void {
    this.retiring.add(gen);
    setTimeout(() => { if (this.retiring.delete(gen)) void this.drop(gen); }, RETIRE_AFTER_MS).unref();
  }

  private async drop(gen: Generation): Promise<void> {
    gen.board.close();
    await gen.host.close().catch(e => this.log(`mcp mirror ${this.outline}@${this.machine}: ${(e as Error).message}`));
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
