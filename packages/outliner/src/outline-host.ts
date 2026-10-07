import { Database } from "bun:sqlite";
import { PROTOCOL } from "@ep0ch/outline-core/protocol";
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, isAbsolute, join } from "node:path";
import { aiPromptDirectory, initializeAiPrompts } from "./ai-prompts";
import type { HerdrRuntimeRegistry } from "./herdr-registry";
import type { ImportReport } from "./outline-import";
import { isOutlineName, OUTLINE_NAME_PATTERN } from "./paths";
import { DOT_EP0CH, formatDotEp0ch, outlineLayout, outlineOfFile } from "@ep0ch/outline-core/outline-location";
import { OutlinerServer } from "./server";
import { OutlinerStore } from "./store";
import {
  type HostedOutlineAttachment,
  type HostedOutlineDeletion,
  type HostedOutlineList,
  type HostedOutlineSummary,
  type HostedPaneOutline,
  type OutlinerHostStatus,
  type OutlinerResponse,
  type OutlinerServiceStatus,
} from "./types";
import { probeSocket } from "./socket-probe";
import { acquireLockFile, acquireWorkspaceOwnership, ownerLockOf } from "./workspace-ownership";
import { metaDir, withLitestreamPaused } from "./litestream-guard";

/*
 * The outline host (PIE-457, PIE-530): one process per user and machine, one socket, any number of outlines, like
 * a tmux server. Outlines live in one folder (EP0CH_OUTLINES, else `~/outlines`): `<name>.sqlite` is the outline,
 * `<name>/` its own folder (prompts, assistant sessions, files it links relatively). Whatever `.sqlite` is there
 * exists; nothing is scanned elsewhere, hashed or registered, and an outline is only ever born through
 * `outlines.create` (or `outlines.attach` with `create`) or `outlines.import`.
 *
 * Every connection talks to one outline (one request, or one subscription), so the host reads only the first
 * line, picks the outline its `outline` field names (or the default, when the host has one), and hands the socket
 * and what it already read to that outline's OutlinerServer, which serves it exactly as it would alone.
 */

export interface HostedOutline {
  name: string;
  database: string;
  /** The outline's own folder: side files, and the root its relative file links resolve against. */
  stateDirectory: string;
  workspaceRoot: string;
  promptDirectory: string;
  store: OutlinerStore;
  server: OutlinerServer;
}

export interface OutlineHostOptions {
  /** The outlines folder (`resolveOutlinesFolder`). */
  outlinesFolder: string;
  /** Where requests without `outline` go (tests and scripts that hold one outline). It must already exist; the host never creates it. */
  defaultOutline?: string;
  /** Shared by every outline: Herdr's panes are one machine-wide fact. */
  herdrRegistry?: HerdrRuntimeRegistry;
  /** `OUTLINER_PROMPT_DIR`: one prompt folder for every outline, used as is. */
  promptDirectory?: string;
  /** Called once per outline after it opens (the Inbox agent starts here). A failure is logged. */
  onOpen?: (outline: HostedOutline) => void | Promise<void>;
  /** A fault on the host's listener after it started (the socket is gone); by default logged. */
  onListenerError?: (error: Error) => void;
  log?: (message: string) => void;
  /**
   * A read-only host: it serves copies (a mirror of another machine's outline) and answers only reads
   * (`READ_ONLY_ACTIONS`) and `outlines.list`. It never creates, imports or deletes an outline.
   */
  readOnly?: boolean;
}

const HOST_ACTIONS = new Set(["outlines.list", "outlines.create", "outlines.import", "outlines.attach", "outlines.close", "outlines.delete", "outlines.pane"]);
/** A first line longer than this is not a request; the connection is dropped. */
const MAX_FIRST_LINE = 64 * 1024 * 1024;

/** `importOutline` in a child process (the CLI's `import`), so the host's event loop keeps serving meanwhile. */
async function importInChild(source: string, target: string): Promise<ImportReport> {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "cli.ts"), "import", source, target, "--json"], {
    stdout: "pipe", stderr: "pipe", stdin: "ignore", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(stderr.trim().replace(/^error: /, "") || `the import exited ${code}`);
  return JSON.parse(stdout) as ImportReport;
}

function requireName(name: unknown): string {
  if (!isOutlineName(name)) {
    throw new Error(`An outline name must be a short slug of lowercase letters, digits and hyphens (${OUTLINE_NAME_PATTERN.source}); got ${JSON.stringify(name)}`);
  }
  return name;
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
}

function lstatOrUndefined(path: string) {
  try { return lstatSync(path); }
  catch (error) { if (errorCode(error) === "ENOENT") return undefined; throw error; }
}

const SQLITE_HEADER = "SQLite format 3\u0000";

function hasSqliteHeader(path: string): boolean {
  const descriptor = openSync(path, "r");
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    return readSync(descriptor, header, 0, header.length, 0) === header.length && header.toString("latin1") === SQLITE_HEADER;
  } finally {
    closeSync(descriptor);
  }
}

/** Whether a SQLite file has the outliner's tables. Opens read-only; creates and migrates nothing. */
function isOutlinerDatabase(path: string): boolean {
  const database = new Database(path, { readonly: true });
  try {
    const tables = database.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('blocks', 'metadata')").all();
    return tables.length === 2;
  } finally {
    database.close();
  }
}

export class OutlineHost {
  readonly socketPath: string;
  readonly outlinesFolder: string;
  readonly defaultOutline: string | undefined;
  private readonly layout: ReturnType<typeof outlineLayout>;
  private listener: Server | null = null;
  private readonly opened = new Map<string, HostedOutline>();
  private readonly opening = new Map<string, Promise<HostedOutline>>();
  /** Outlines whose files are being moved away or written; they must not open meanwhile. */
  private readonly busy = new Set<string>();
  private readonly connections = new Set<Socket>();
  private closing = false;
  private releaseHostLock: (() => void) | undefined;

  constructor(private readonly options: OutlineHostOptions) {
    this.layout = outlineLayout(options.outlinesFolder);
    this.socketPath = this.layout.socket;
    this.outlinesFolder = this.layout.root;
    this.defaultOutline = options.defaultOutline === undefined ? undefined : requireName(options.defaultOutline);
  }

  private log(message: string): void {
    (this.options.log ?? (text => console.error(text)))(message);
  }

  /**
   * Takes the host lock (`.host/host.lock`), opens the default outline when there is one so its database is held
   * from the start, then listens on `.host/host.sock`. `.host/` is kept private (0700): on macOS a socket's own
   * mode is not checked, so its folder is what keeps other users out.
   */
  async start(): Promise<void> {
    mkdirSync(this.outlinesFolder, { recursive: true });
    mkdirSync(this.layout.hostDir, { recursive: true, mode: 0o700 });
    chmodSync(this.layout.hostDir, 0o700);
    this.releaseHostLock = acquireLockFile(this.layout.lock, "The outline host lock");
    try {
      // Only a host holds the lock, so a socket file here is left by one that died, unless something else answers on it.
      if ((await probeSocket(this.socketPath, 250)) === "answers") throw new Error(`Something already listens at ${this.socketPath}`);
      if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
      if (this.defaultOutline) {
        if (!lstatOrUndefined(this.layout.database(this.defaultOutline))) {
          this.log(`DEFAULT OUTLINE MISSING: "${this.defaultOutline}" is not in ${this.outlinesFolder}; requests without an outline fail until it is created.`);
        } else {
          await this.open(this.defaultOutline).catch(error => {
            this.log(`DEFAULT OUTLINE FAILED TO OPEN: "${this.defaultOutline}": ${error instanceof Error ? error.message : String(error)}. Requests without an outline fail until it opens.`);
          });
        }
      }
      const listener = createServer(socket => this.accept(socket));
      const started = Promise.withResolvers<void>();
      listener.once("error", started.reject);
      listener.listen(this.socketPath, () => {
        listener.off("error", started.reject);
        started.resolve();
      });
      await started.promise;
      // After start, a listener fault is the host's own: report it; the process decides to exit.
      listener.on("error", error => (this.options.onListenerError ?? (fault => this.log(`Outline host listener failed: ${fault.message}`)))(error));
      this.listener = listener;
    } catch (error) {
      await this.close().catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    const listener = this.listener;
    this.listener = null;
    const listenerClosed = Promise.withResolvers<void>();
    if (listener) listener.close(error => (error ? listenerClosed.reject(error) : listenerClosed.resolve()));
    else listenerClosed.resolve();
    await Promise.allSettled(this.opening.values());
    const failures: unknown[] = [];
    for (const outline of this.opened.values()) {
      try { await outline.server.close(); } catch (error) { failures.push(error); }
    }
    for (const socket of this.connections) socket.destroy();
    this.connections.clear();
    for (const outline of this.opened.values()) {
      try { outline.store.close(); } catch (error) { failures.push(error); }
    }
    this.opened.clear();
    await listenerClosed.promise;
    if (listener && existsSync(this.socketPath)) unlinkSync(this.socketPath);
    this.releaseHostLock?.();
    this.releaseHostLock = undefined;
    if (failures.length > 0) throw new AggregateError(failures, "Some outlines did not close cleanly");
  }

  /** What `ping` reports as `host`. */
  status(): OutlinerHostStatus {
    return {
      socket: this.socketPath,
      outlines: this.names(),
      ...(this.defaultOutline ? { defaultOutline: this.defaultOutline } : {}),
    };
  }

  private names(): string[] {
    let entries: string[];
    try { entries = readdirSync(this.outlinesFolder); }
    catch (error) { if (errorCode(error) === "ENOENT") return []; throw error; }
    return entries.map(outlineOfFile).filter(name => name !== null).sort();
  }

  private summary(name: string): HostedOutlineSummary {
    return {
      name, database: this.layout.database(name), folder: this.layout.folder(name), open: this.opened.has(name),
      ...(name === this.defaultOutline ? { default: true } : {}),
    };
  }

  /** Every outline in the folder, open or not. Reads only; never creates anything. */
  list(): HostedOutlineList {
    return {
      ...(this.defaultOutline ? { defaultOutline: this.defaultOutline } : {}),
      outlines: this.names().map(name => this.summary(name)),
    };
  }

  private refuseTaken(name: string): void {
    if (lstatOrUndefined(this.layout.database(name))) throw new Error(`An outline named "${name}" already exists in ${this.outlinesFolder}`);
    if (this.busy.has(name)) throw new Error(`Outline "${name}" is being changed; try again`);
  }

  /** Claims `<name>.sqlite` exclusively (an empty file), so two creates or imports can never share a name. */
  private claim(name: string): string {
    const database = this.layout.database(name);
    mkdirSync(this.outlinesFolder, { recursive: true });
    try { closeSync(openSync(database, "wx", 0o600)); }
    catch (error) {
      if (errorCode(error) === "EEXIST") throw new Error(`An outline named "${name}" already exists in ${this.outlinesFolder}`);
      throw error;
    }
    return database;
  }

  /**
   * Removes what a failed create or import made: the claimed file and its SQLite side files, with Litestream paused
   * (litestream-guard.ts: its meta folder kept). Never the lock file.
   */
  private async unclaim(name: string): Promise<void> {
    const database = this.layout.database(name);
    await withLitestreamPaused([database], `removing the half-made outline ${name}`, () => {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(`${database}${suffix}`, { force: true });
    });
  }

  /**
   * A change that makes `name`'s file again where one was before (Litestream's meta folder for it is still there, from
   * an outline deleted under that name): made with Litestream paused. A name never used is made as it is.
   */
  private remade<T>(name: string, what: string, change: () => Promise<T>): Promise<T> {
    const database = this.layout.database(name);
    return existsSync(metaDir(database)) ? withLitestreamPaused([database], what, change) : change();
  }

  /**
   * Creates a new, empty outline and opens it. Refuses a name already in use; never overwrites. Its folder
   * `<name>/` may exist already (files kept there before it had an outline); it is used as it is.
   */
  async create(nameInput: unknown): Promise<HostedOutlineSummary> {
    const name = requireName(nameInput);
    this.refuseTaken(name);
    return this.remade(name, `creating the outline ${name}`, async () => {
      this.claim(name);
      try {
        await this.open(name);
      } catch (error) {
        await this.unclaim(name);
        throw error;
      }
      return this.summary(name);
    });
  }

  /**
   * A new outline from an older database (PIE-530): a fresh `<name>.sqlite` holding what matters from `path`
   * (`importOutline`: its blocks, properties, page addresses and work ids), never the file itself, which is only
   * read. Refused: a taken name, a file that is not an outliner database, and one another process serves.
   */
  async importDatabase(pathInput: unknown, nameInput: unknown): Promise<HostedOutlineSummary & { imported: ImportReport }> {
    const name = requireName(nameInput);
    if (typeof pathInput !== "string" || !isAbsolute(pathInput)) throw new Error("outlines.import needs the database's absolute path");
    let real: string;
    try { real = realpathSync(pathInput); }
    catch { throw new Error(`No database at ${pathInput}`); }
    if (!statSync(real).isFile()) throw new Error(`${pathInput} is not a database file`);
    if (dirname(real) === this.outlinesFolder && real.endsWith(".sqlite")) throw new Error(`${real} is already an outline here`);
    if (!hasSqliteHeader(real)) throw new Error(`${real} is not an outliner database (not a SQLite file)`);
    this.refuseTaken(name);
    // A database another process serves is still changing: refuse rather than copy half of it.
    let release: () => void;
    try { release = acquireWorkspaceOwnership(real); }
    catch (error) {
      if (!(error instanceof Error && error.message.startsWith("Outliner workspace is already owned"))) throw error;
      throw new Error(`${real} is in use by another outliner process; stop it before importing the database`, { cause: error });
    }
    let started = false;
    try { return await this.remade(name, `importing ${real} as ${name}`, () => { started = true; return this.importAs(real, name, release); }); }
    finally { if (!started) release(); }
  }

  private async importAs(real: string, name: string, release: () => void): Promise<HostedOutlineSummary & { imported: ImportReport }> {
    let imported: ImportReport;
    this.busy.add(name);
    try {
      if (!isOutlinerDatabase(real)) throw new Error(`${real} is not an outliner database (no blocks and metadata tables)`);
      const target = this.layout.database(name);
      // The import makes the file itself (and removes it when it fails); nothing may be there.
      if (lstatOrUndefined(target)) throw new Error(`An outline named "${name}" already exists in ${this.outlinesFolder}`);
      // In a process of its own: a long import never stalls the other outlines this host serves.
      imported = await importInChild(real, target);
      chmodSync(target, 0o600);
    } finally {
      this.busy.delete(name);
      release();
    }
    try {
      await this.open(name);
    } catch (error) {
      await this.unclaim(name);
      throw error;
    }
    return { ...this.summary(name), imported };
  }

  /**
   * Opens an outline by name, as a client session starts: like `tmux new -A`, it creates the outline first when
   * `create` is set and none has the name. A plain read never creates; only a session opener asks for `create`.
   */
  async attach(nameInput: unknown, create: boolean): Promise<HostedOutlineAttachment> {
    const name = requireName(nameInput);
    if (!lstatOrUndefined(this.layout.database(name))) {
      if (!create) throw new Error(`No outline named "${name}" in ${this.outlinesFolder}; create it with \`ep0ch init ${name}\``);
      try {
        return { outline: await this.create(name), created: true };
      } catch (error) {
        // Another session created it a moment ago: attach to that one.
        if (!lstatOrUndefined(this.layout.database(name))) throw error;
      }
    }
    await this.open(name);
    return { outline: this.summary(name), created: false };
  }

  /**
   * Stops serving one outline and releases its database. It is not a lock: its next request opens it again, and
   * live panes reconnect at once. Close the panes first to keep it closed.
   */
  async closeOutline(nameInput: unknown): Promise<HostedOutlineSummary> {
    const name = requireName(nameInput);
    await this.opening.get(name)?.catch(() => undefined);
    const outline = this.opened.get(name);
    if (outline) {
      this.opened.delete(name);
      try { await outline.server.close(); } finally { outline.store.close(); }
    }
    if (!lstatOrUndefined(this.layout.database(name))) throw new Error(`No outline named "${name}" in ${this.outlinesFolder}`);
    return this.summary(name);
  }

  /**
   * Removes an outline from the host. Nothing is erased: its database and its folder move to
   * `.deleted/<name>-<time>/`. The default outline is refused.
   */
  async delete(nameInput: unknown): Promise<HostedOutlineDeletion> {
    const name = requireName(nameInput);
    if (name === this.defaultOutline) throw new Error(`"${name}" is this host's default outline; it cannot be deleted while the host serves it as the default`);
    const database = this.layout.database(name);
    if (!lstatOrUndefined(database)) throw new Error(`No outline named "${name}" in ${this.outlinesFolder}`);
    if (this.busy.has(name)) throw new Error(`Outline "${name}" is already being changed`);
    this.busy.add(name);
    try {
      await this.closeOutline(name);
      // Its owner lock (`<name>.sqlite.owner.sqlite`, workspace-ownership.ts) is held while it moves, so nobody opens it
      // half moved; then, once nothing else can hold it, removed with its journal: it stores no data, and left behind
      // it is clutter in the outlines folder. Held by another process (a contender is opening it right now), the
      // delete is refused and nothing moves.
      const lock = ownerLockOf(database);
      let release: () => void;
      try { release = acquireLockFile(lock.path, `Outline "${name}"`); }
      catch (error) { throw new Error(`${(error as Error).message}; nothing was moved: stop what holds it (\`fuser -v ${lock.path}\` says which process), then delete it again`, { cause: error }); }
      // With Litestream paused (litestream-guard.ts): its meta folder stays, so an outline made again under this name
      // continues the replica's history instead of colliding with it.
      try { return await withLitestreamPaused([database], `deleting the outline ${name}`, () => {
        const movedTo = join(this.layout.deleted, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
        mkdirSync(movedTo, { recursive: true });
        for (const suffix of ["", "-wal", "-shm"]) {
          if (lstatOrUndefined(`${database}${suffix}`)) renameSync(`${database}${suffix}`, join(movedTo, `${name}.sqlite${suffix}`));
        }
        if (lstatOrUndefined(this.layout.folder(name))) renameSync(this.layout.folder(name), join(movedTo, name));
        for (const file of lock.files) rmSync(file, { force: true });
        return { name, movedTo };
      }); } finally {
        release();
      }
    } finally {
      this.busy.delete(name);
    }
  }

  /**
   * The outline a live pane is registered on (`hostname` + Herdr `paneId`), so a Herdr action invoked from that
   * pane uses its outline rather than re-resolving the folder. Only open outlines have live panes. Reads only.
   */
  paneOutline(paneInput: unknown, hostInput: unknown): HostedPaneOutline {
    if (typeof paneInput !== "string" || !paneInput || typeof hostInput !== "string" || !hostInput) throw new Error("outlines.pane needs a paneId and a hostname");
    for (const outline of this.opened.values()) {
      const client = outline.server.liveClients().find(candidate => candidate.runtime?.paneId === paneInput && candidate.runtime.hostname === hostInput);
      if (client) return { outline: outline.name, clientId: client.clientId, role: client.role };
    }
    return {};
  }

  /** Opens an outline on first use and keeps it open. A failure is that outline's alone and is retried next time. */
  open(name: string): Promise<HostedOutline> {
    if (this.closing) return Promise.reject(new Error("The outline host is stopping"));
    if (this.busy.has(name) && !this.opening.has(name)) return Promise.reject(new Error(`Outline "${name}" is being changed`));
    const opened = this.opened.get(name);
    if (opened) return Promise.resolve(opened);
    const pending = this.opening.get(name);
    if (pending) return pending;
    const opening = this.openNow(name).finally(() => this.opening.delete(name));
    this.opening.set(name, opening);
    return opening;
  }

  private async openNow(nameInput: string): Promise<HostedOutline> {
    const name = requireName(nameInput);
    const database = this.layout.database(name);
    const entry = lstatOrUndefined(database);
    if (!entry) throw new Error(`No outline named "${name}" in ${this.outlinesFolder}; create it with \`ep0ch init ${name}\``);
    if (!entry.isFile()) throw new Error(`${database} is not a file; an outline is a database file in ${this.outlinesFolder}, never a link`);
    const stateDirectory = this.layout.folder(name);
    const workspaceRoot = stateDirectory;
    mkdirSync(stateDirectory, { recursive: true });
    // The outline's own folder names it, so a program working there (an agent, a publisher) reaches this outline.
    const dotEp0ch = join(stateDirectory, DOT_EP0CH);
    if (!lstatOrUndefined(dotEp0ch)) {
      try { writeFileSync(dotEp0ch, formatDotEp0ch(name), { flag: "wx", mode: 0o644 }); }
      catch (error) { this.log(`Outline "${name}": could not write ${dotEp0ch}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    let store: OutlinerStore;
    try {
      store = new OutlinerStore(database, { workspaceRoot });
    } catch (error) {
      throw new Error(`Outline "${name}" could not be opened: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    let server: OutlinerServer | undefined;
    try {
      const promptDirectory = aiPromptDirectory(this.options.promptDirectory ?? join(stateDirectory, "prompts"));
      if (this.options.promptDirectory === undefined && !this.options.readOnly) await initializeAiPrompts(promptDirectory);
      server = new OutlinerServer(store, this.socketPath, this.options.herdrRegistry, promptDirectory, { stateDirectory, readOnly: this.options.readOnly === true });
      server.setOutline({ name });
      server.setHost(() => this.status());
      server.startHosted();
      if (this.closing) throw new Error("The outline host is stopping");
      const outline: HostedOutline = { name, database, stateDirectory, workspaceRoot, promptDirectory, store, server };
      this.opened.set(name, outline);
      try { await this.options.onOpen?.(outline); }
      catch (error) { this.log(`Outline "${name}": ${error instanceof Error ? error.message : String(error)}`); }
      return outline;
    } catch (error) {
      try { await server?.close(); } finally { store.close(); }
      throw error;
    }
  }

  private accept(socket: Socket): void {
    this.connections.add(socket);
    socket.setEncoding("utf8");
    socket.once("close", () => this.connections.delete(socket));
    // A peer that vanishes before routing is routine; the outline adds its own handling after.
    socket.on("error", () => {});
    let buffered = "";
    const receive = (chunk: string): void => {
      buffered += chunk;
      const newline = buffered.indexOf("\n");
      if (newline < 0) {
        if (buffered.length > MAX_FIRST_LINE) socket.destroy();
        return;
      }
      socket.off("data", receive);
      // Held until the outline takes over, so nothing arrives while nobody listens.
      socket.pause();
      void this.route(socket, buffered.slice(0, newline), buffered).catch(error => {
        this.log(`Outline host could not route a connection: ${error instanceof Error ? error.message : String(error)}`);
        socket.destroy();
      });
    };
    socket.on("data", receive);
  }

  private reply(socket: Socket, response: OutlinerResponse): void {
    // Host answers are not in any outline's sequence.
    socket.end(`${JSON.stringify(response)}\n`);
  }

  private async route(socket: Socket, line: string, buffered: string): Promise<void> {
    let request: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) request = parsed as Record<string, unknown>;
    } catch {
      request = undefined;
    }
    const id = typeof request?.id === "string" ? request.id : "invalid";
    const fail = (error: unknown) => this.reply(socket, {
      id, ok: false, error: error instanceof Error ? error.message : String(error), sequence: 0,
    });
    if (request && HOST_ACTIONS.has(String(request.action))) {
      if (this.options.readOnly && request.action !== "outlines.list") {
        fail(new Error(`This outline host serves read-only copies: ${String(request.action)} isn't served`));
        return;
      }
      try {
        this.reply(socket, { id, ok: true, result: await this.handleHostAction(request), sequence: 0 });
      } catch (error) {
        fail(error);
      }
      return;
    }
    const named = request?.outline;
    if (named !== undefined && !isOutlineName(named)) {
      fail(new Error(`outline must be an outline name (${OUTLINE_NAME_PATTERN.source}); got ${JSON.stringify(named)}`));
      return;
    }
    if (request?.action === "ping" && named === undefined && !this.defaultOutline) {
      this.reply(socket, { id, ok: true, result: this.hostPing(), sequence: 0 });
      return;
    }
    const name = named ?? this.defaultOutline;
    if (!name) {
      fail(new Error("Name the outline: every request to the outline host carries `outline: <name>` (see `ep0ch outline list`)"));
      return;
    }
    let outline: HostedOutline;
    try {
      outline = await this.open(name);
    } catch (error) {
      fail(error);
      return;
    }
    if (socket.destroyed) return;
    outline.server.acceptConnection(socket, buffered);
    socket.resume();
  }

  /** `ping` on a host with no default outline: the host alone. */
  private hostPing(): OutlinerServiceStatus {
    return {
      status: "ready",
      protocolVersion: PROTOCOL,
      host: this.status(),
    };
  }

  private handleHostAction(request: Record<string, unknown>): Promise<unknown> | unknown {
    switch (request.action) {
      case "outlines.list": return this.list();
      case "outlines.create": return this.create(request.name);
      case "outlines.import": return this.importDatabase(request.path, request.name);
      case "outlines.attach": return this.attach(request.name, request.create === true);
      case "outlines.pane": return this.paneOutline(request.paneId, request.hostname);
      case "outlines.close": return this.closeOutline(request.name);
      case "outlines.delete": return this.delete(request.name);
      default: throw new Error(`Unsupported host action: ${String(request.action)}`);
    }
  }
}
