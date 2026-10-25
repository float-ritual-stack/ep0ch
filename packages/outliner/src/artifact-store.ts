import { homedir } from "node:os";
import { artifactKind } from "@ep0ch/outline-core/media-line";
import { localMachineName } from "./machine-name";
import { deployedArtifacts } from "./artifact-deploy";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, openSync, closeSync, readSync, writeSync, rmSync, fstatSync, realpathSync, constants, lstatSync, existsSync, cpSync, watch, type FSWatcher } from "node:fs";
import { join, dirname, extname, basename, resolve } from "node:path";
import { ArtifactCompiler, mermaidArtifactPage, reactArtifactPage } from "./publish-artifacts";
import { artifactReference, type ArtifactInfo, type ArtifactReader, type ArtifactRequest } from "@ep0ch/outline-core/artifacts";
import { artifactKey, artifactPageUrl, grantPath } from "./artifact-grants";
import { artifactEntryLimit, artifactLimit, DROP_FILE, DROP_RESULTS, remoteInbox, type DropMeta, type DropResult } from "./artifact-inbox";
import { looksTar, looksZip, stripRoot, unzip } from "./artifact-archive";
import { handOver, pageTitle } from "./artifact-handover";

const artifactSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function artifactName(name: string): string {
  if (artifactReference(name)?.name !== name) throw new Error("Use an artifact name containing letters, numbers, dots, underscores or hyphens.");
  return name;
}
function artifactPath(path: string): string {
  if (!path || path.includes("\\") || path.includes("\0") || path.split("/").some(p => !p || p === "." || p === "..")) throw new Error(`Unsafe artifact path: ${path}`);
  return path;
}
function checkArtifactSize(entries: number, bytes: number, context = "") {
  if (entries > artifactEntryLimit()) throw new Error(`Artifact has ${entries} entries; cap is ${artifactEntryLimit()}.`);
  if (bytes > artifactLimit()) throw new Error(`Artifact exceeds ${artifactLimit()} bytes${context}.`);
}
function artifactFiles(folder: string, ignoreHidden = false, budget?: { entries: number; bytes: number; context?: string }): string[] {
  return readdirSync(folder).filter(name => !ignoreHidden || !name.startsWith(".")).sort().flatMap(name => {
    const path = join(folder, name), stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error(`Artifacts cannot contain links or special files: ${name}`);
    if (budget) {
      budget.entries++; budget.bytes += stat.isFile() ? stat.size : 0;
      checkArtifactSize(budget.entries, budget.bytes, budget.context);
    }
    return stat.isDirectory() ? artifactFiles(path, ignoreHidden, budget).map(p => `${name}/${p}`) : [name];
  });
}

function readArtifactInput(source: string, folder: boolean, ignoreHidden = false): Record<string, Buffer> {
  const paths = folder ? artifactFiles(source, ignoreHidden, { entries: 0, bytes: 0 }) : [basename(source)];
  if (!folder) checkArtifactSize(1, lstatSync(source).size);
  return Object.fromEntries(paths.map(path => [path, readFileSync(folder ? join(source, path) : source)]));
}

function artifactHash(folder: string, files: string[]): string {
  const hash = new Bun.CryptoHasher("sha256");
  for (const file of files) hash.update(file + "\0").update(readFileSync(join(folder, file)));
  return hash.digest("hex");
}

export class ArtifactStore {
  // Outline servers on the same host share this path index, including while a compile awaits.
  private static pathReads = new Map<string, Promise<void>>();
  private static resolving = new Map<string, Promise<ArtifactInfo>>();
  private fileHashes = new Map<string, { dev: number; ino: number; size: number; mtime: number; hash: string }>();
  readonly root: string;
  readonly live: string;
  readonly compiler: ArtifactCompiler;
  private uploads = new Map<string, { name: string; path: string; bytes: number }>();
  private watchers: FSWatcher[] = [];
  private readonly outlines: string;
  private pending: Promise<void> = Promise.resolve();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private changes = new Map<string, number>();
  constructor(outlines: string) {
    this.outlines = outlines;
    this.root = join(outlines, ".artifacts");
    this.live = join(this.root, "live");
    this.compiler = new ArtifactCompiler({ cacheDirectory: join(outlines, ".artifact-cache") });
  }
  private prepare() { for (const folder of [this.live, join(this.root, "snapshots")]) mkdirSync(folder, { recursive: true }); }
  info(ref: string): ArtifactInfo {
    const parsed = artifactReference(ref);
    if (!parsed) throw new Error("Use an artifact name, or <name>@<number> for a snapshot.");
    const { name, version } = parsed, pin = version?.toString();
    const folder = pin ? join(this.root, "snapshots", name, pin, "files") : join(this.live, name);
    if (!existsSync(folder)) throw new Error(`No artifact ${ref}; use ep0ch artifact put <file-or-folder> --name ${name}.`);
    if (lstatSync(folder).isSymbolicLink()) throw new Error("An artifact folder cannot be a symlink.");
    const files = artifactFiles(folder), bytes = files.reduce((n, p) => n + lstatSync(join(folder, p)).size, 0);
    return { name, ...(pin ? { version: Number(pin) } : {}), files, bytes, url: artifactPageUrl(ref) ?? null };
  }
  /**
   * Where a frame loads `info` from for `reader` (PIE-1266): the artifact host's path that grants it, the one place a
   * surface may see that host. Null when no artifact host is known, or a share is asked for without its outline.
   */
  frame(info: ArtifactInfo, reader: ArtifactReader, outline?: string): string | null {
    const origin = process.env.EP0CH_ARTIFACT_ORIGIN?.replace(/\/$/, "");
    if (!origin) return null;
    const ref = info.version ? `${info.name}@${info.version}` : info.name;
    return `${origin}${grantPath(artifactKey(this.root, true)!, reader, ref, { outline })}`;
  }
  async compile(name: string, folder = join(this.live, name), rejectErrors = false) {
    if (lstatSync(folder).isSymbolicLink()) throw new Error("An artifact folder cannot be a symlink.");
    const generated = join(this.root, "generated", name);
    const index = join(folder, "index.html");
    if (existsSync(index) && (!existsSync(generated) || readFileSync(generated, "utf8") !== new Bun.CryptoHasher("sha256").update(readFileSync(index)).digest("hex"))) return;
    const files = artifactFiles(folder).filter(p => p !== "index.html");
    if (files.length !== 1 || !/\.(jsx|tsx|mermaid|mmd|md|markdown)$/i.test(files[0]!)) return;
    const source = readFileSync(join(folder, files[0]!), "utf8");
    const extension = extname(files[0]!).toLowerCase();
    let html: string;
    if (extension === ".mermaid" || extension === ".mmd") html = mermaidArtifactPage(name, source);
    else if (extension === ".md" || extension === ".markdown") {
      const { renderMarkdownHtml } = await import("./publish");
      html = `<!doctype html><meta charset="utf-8"><body>${renderMarkdownHtml(source)}</body>`;
    } else {
      const build = await this.compiler.compile(source, extension as ".jsx" | ".tsx");
      if (!build.ok && rejectErrors) throw new Error(`Artifact could not compile: ${build.problems.join("\n")}`);
      // Direct puts preserve source even when it cannot compile.
      html = build.ok ? reactArtifactPage(name, build.script) : `<!doctype html><title>Artifact needs fixing</title><pre>${build.problems.join("\n").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`;
    }
    if (readFileSync(join(folder, files[0]!), "utf8") !== source) return;
    if (!existsSync(join(folder, "index.html")) || readFileSync(join(folder, "index.html"), "utf8") !== html) {
      mkdirSync(dirname(generated), { recursive: true });
      writeFileSync(generated, new Bun.CryptoHasher("sha256").update(html).digest("hex"));
      writeFileSync(index, html);
    }
  }
  startWatcher() {
    this.prepare();
    // The synced inbox (a laptop's mutagen mirrors it) and the server-side one (publish-upload.ts writes whole drops
    // into it by rename), read the same way; only the second carries who sent it and where its card goes.
    this.watchInbox(process.env.EP0CH_ARTIFACT_INBOX ?? join(this.root, "inbox"), false, Number(process.env.EP0CH_ARTIFACT_SETTLE_MS ?? 10_000));
    this.watchInbox(remoteInbox(this.outlines), true, Number(process.env.EP0CH_ARTIFACT_REMOTE_SETTLE_MS ?? 100));
  }
  private watchInbox(inbox: string, remote: boolean, settle: number) {
    mkdirSync(inbox, { recursive: true });
    // Answers nobody came back for (the sender's request gave up waiting) are not kept.
    if (remote) for (const stale of existsSync(join(inbox, DROP_RESULTS)) ? readdirSync(join(inbox, DROP_RESULTS)) : []) {
      const path = join(inbox, DROP_RESULTS, stale);
      if (Date.now() - lstatSync(path).mtimeMs > 24 * 60 * 60_000) rmSync(path, { force: true });
    }
    const enqueue = (name: string) => {
      if (!name || name.startsWith(".") || name === "receipts.log") return;
      const key = `${remote ? "remote:" : ""}${name}`;
      clearTimeout(this.timers.get(key));
      const change = (this.changes.get(key) ?? 0) + 1;
      this.changes.set(key, change);
      const current = () => this.changes.get(key) === change;
      this.timers.set(key, setTimeout(() => {
        this.timers.delete(key);
        this.pending = this.pending.then(async () => {
          if (current() && existsSync(join(inbox, name))) await this.pickup(inbox, name, current, remote);
        }).catch(error => console.error(`artifact ${name}: ${error.message}`));
      }, settle));
    };
    this.watchers.push(watch(inbox, { recursive: true }, (_, file) => {
      if (file && !String(file).split("/").some(part => part.startsWith("."))) enqueue(String(file).split("/")[0]!);
    }));
    for (const name of readdirSync(inbox)) enqueue(name);
  }
  /** What a dropped entry holds, as the files to install: a folder, a zip or tar (opened under the archive rules), or one page or image. */
  private readDrop(source: string, entry: string, explicit?: string): { name: string; files: Record<string, Buffer>; compile: boolean } {
    const stat = lstatSync(source), folder = stat.isDirectory();
    if (stat.isSymbolicLink() || (!folder && !stat.isFile())) throw new Error("Drop a regular file or folder, without links.");
    if (folder) return { name: explicit ?? entry, files: readArtifactInput(source, true, true), compile: false };
    const head = Buffer.alloc(512), fd = openSync(source, "r");
    try { readSync(fd, head, 0, 512, 0); } finally { closeSync(fd); }
    const extension = extname(entry).toLowerCase();
    let files: Record<string, Buffer>, compile = false;
    if (looksZip(head)) {
      checkArtifactSize(1, stat.size);
      files = unzip(readFileSync(source), { entries: artifactEntryLimit(), bytes: artifactLimit(), path: artifactPath });
    } else if (looksTar(head) || extension === ".tar") {
      const stage = join(this.root, `.${crypto.randomUUID()}.untar`);
      mkdirSync(stage);
      try { untar(source, stage); files = stripRoot(readArtifactInput(stage, true, true)); }
      finally { rmSync(stage, { recursive: true, force: true }); }
    } else if (/\.(html|jsx|tsx|svg|mermaid|md|png|jpe?g|gif|webp|pdf)$/i.test(entry)) {
      files = readArtifactInput(source, false); compile = true;
    } else throw new Error("Unknown artifact kind; use html, jsx, tsx, svg, mermaid or md, a zip or tar of a built folder, or an image or pdf.");
    if (!Object.keys(files).length) throw new Error("The archive holds no files.");
    if (explicit) return { name: explicit, files, compile };
    // It names itself: a single page by its own title (a file called orrery.html with <title>ep0ch Orrery</title> is
    // ep0ch-orrery), an archive by its file name unless that says nothing (upload, index), then by its page's title.
    const stem = artifactSlug(basename(entry, extname(entry)));
    const page = files["index.html"] ?? Object.entries(files).find(([path]) => /\.html?$/i.test(path))?.[1];
    const titled = page ? artifactSlug(pageTitle(page.toString("utf8")) ?? "") : "";
    const archive = looksZip(head) || looksTar(head) || extension === ".tar";
    const empty = ["", "index", "upload", "file", "untitled", "artifact"].includes(stem);
    const chosen = archive ? (empty ? titled : stem) : titled || (empty ? "" : stem);
    return { name: chosen || `upload-${crypto.randomUUID().slice(0, 4)}`, files, compile };
  }
  private async pickup(inbox: string, entry: string, current: () => boolean, remote = false) {
    const source = join(inbox, entry);
    let meta: DropMeta | undefined;
    try {
      if (remote) meta = JSON.parse(readFileSync(join(source, DROP_FILE), "utf8")) as DropMeta;
      const { name, files, compile } = remote ? this.readDrop(join(source, "file", basename(meta!.filename)), basename(meta!.filename), meta!.name) : this.readDrop(source, entry);
      await this.put(name, files, { compile, rejectErrors: true });
      const version = await this.snapshot(name);
      appendFileSync(join(inbox, "receipts.log"), `${new Date().toISOString()}\t${name}\t${version.version}\t${version.url ?? ""}\n`);
      // A save arriving during compilation belongs to the next pickup.
      if (!current()) return;
      if (meta) {
        const page = Object.hasOwn(files, "index.html") ? files["index.html"] : Object.entries(files).find(([path]) => /\.html?$/i.test(path))?.[1];
        const title = page ? pageTitle(page.toString("utf8")) : undefined;
        const told = await handOver(this.outlines, meta, { installed: { name, version: version.version, ...(title ? { title } : {}) } });
        this.answer(inbox, meta.id, { ok: true, name, version: version.version, ...(title ? { title } : {}), ...told });
      }
      rmSync(source, { recursive: true, force: true });
    } catch (error) {
      if (!current()) return;
      const failed = join(inbox, ".failed", entry);
      mkdirSync(failed, { recursive: true });
      // Keep earlier failures when the same filename is dropped again.
      const destination = existsSync(join(failed, "source")) ? join(failed, crypto.randomUUID()) : failed;
      mkdirSync(join(destination, "source"), { recursive: true });
      renameSync(source, join(destination, "source", entry));
      writeFileSync(join(destination, "reason.txt"), `${(error as Error).message}\n`);
      if (meta) {
        const reason = (error as Error).message;
        const told = await handOver(this.outlines, meta, { reason });
        this.answer(inbox, meta.id, { ok: false, reason, ...told });
      }
    }
  }
  /** Tells the publisher, which is holding the sender's request open, what became of drop `id`. */
  private answer(inbox: string, id: string, result: DropResult) {
    const folder = join(inbox, DROP_RESULTS);
    mkdirSync(folder, { recursive: true });
    const temporary = join(folder, `.${id}.tmp`);
    writeFileSync(temporary, JSON.stringify(result));
    renameSync(temporary, join(folder, `${id}.json`));
  }
  async close() {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await this.pending;
    for (const upload of this.uploads.values()) rmSync(upload.path, { force: true });
    this.uploads.clear();
  }
  async put(name: string, files: Record<string, string | Uint8Array>, options = { compile: true, rejectErrors: false }) {
    artifactName(name); this.prepare();
    let size = 0;
    const entries = new Set<string>();
    for (const [path, content] of Object.entries(files)) {
      artifactPath(path); size += Buffer.byteLength(content);
      const parts = path.split("/");
      for (let at = 1; at <= parts.length; at++) entries.add(parts.slice(0, at).join("/"));
      checkArtifactSize(entries.size, size);
    }
    const stage = join(this.root, `.${crypto.randomUUID()}.incoming`);
    mkdirSync(stage);
    try {
      for (const [path, content] of Object.entries(files)) { const to = join(stage, path); mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, content); }
      return await this.install(name, stage, options);
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }
  private async install(name: string, stage: string, options = { compile: true, rejectErrors: false }) {
    if (options.compile) await this.compile(name, stage, options.rejectErrors);
    artifactFiles(stage, false, { entries: 0, bytes: 0, context: " after compilation" });
    const folder = join(this.live, name), previous = `${stage}.previous`;
    if (existsSync(folder)) {
      if (lstatSync(folder).isSymbolicLink()) throw new Error("An artifact folder cannot be a symlink.");
      renameSync(folder, previous);
    }
    try { renameSync(stage, folder); }
    catch (error) { if (existsSync(previous)) renameSync(previous, folder); throw error; }
    rmSync(previous, { recursive: true, force: true });
    return this.info(name);
  }
  contentHash(name: string): string {
    return artifactHash(join(this.live, name), this.info(name).files);
  }
  private async snapshot(name: string) {
    const info = this.info(name), dir = join(this.root, "snapshots", name);
    mkdirSync(dir, { recursive: true });
    if (info.bytes > artifactLimit()) throw new Error(`Artifact exceeds ${artifactLimit()} bytes.`);
    const sequence = join(this.root, "sequences", name);
    mkdirSync(dirname(sequence), { recursive: true });
    const version = (existsSync(sequence) ? Number(readFileSync(sequence, "utf8")) : 0) + 1;
    writeFileSync(sequence, String(version));
    const target = join(dir, String(version)), stage = join(this.root, `.${crypto.randomUUID()}.snapshot`);
    try {
      cpSync(join(this.live, name), join(stage, "files"), { recursive: true });
      const ref = `${name}@${version}`;
      const result = { ...info, version, url: artifactPageUrl(ref) ?? null,
        hash: artifactHash(join(stage, "files"), info.files), at: new Date().toISOString() };
      writeFileSync(join(stage, "meta.json"), JSON.stringify(result));
      renameSync(stage, target);
      return result;
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }

  private async resolveFile(ref: string, workspace: string): Promise<ArtifactInfo> {
    const path = resolve(workspace, ref.startsWith("~/") ? join(homedir(), ref.slice(2)) : ref);
    const indexFile = join(this.root, "paths.json");
    const paths: Record<string, { name: string; hash: string; version: number; gone?: string }> = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : {};
    let entry = paths[path];
    const aliasesFile = join(this.root, "aliases", basename(workspace));
    const aliases: Record<string, string> = existsSync(aliasesFile) ? JSON.parse(readFileSync(aliasesFile, "utf8")) : {};
    const imported = Object.hasOwn(aliases, path) ? aliases[path] : undefined;
    const stem = artifactSlug(basename(path, extname(path))) || "artifact";
    let name = entry?.name ?? imported ?? stem;
    for (let suffix = 2; !entry && !imported && (existsSync(join(this.live, name)) || existsSync(join(this.root, "snapshots", name)) || Object.values(paths).some(row => row.name === name)); suffix++) name = `${stem}-${suffix}`;
    const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
    const machine = localMachineName(dirname(this.root));
    let canonical = path;
    const put = () => `ep0ch artifact put ${quote(canonical)} --name ${name} --machine ${machine}`;
    const save = () => {
      const temporary = `${indexFile}.tmp`;
      writeFileSync(temporary, JSON.stringify(paths));
      renameSync(temporary, indexFile);
    };
    let content: Buffer | undefined;
    let hash: string;
    let fingerprint: { dev: number; ino: number; size: number; mtime: number };
    try {
      canonical = realpathSync(path);
      if (canonical.split("/").some(part => part.startsWith("."))) throw new Error(`The target ${canonical} isn't an artifact for automatic import: hidden path; copy it somewhere visible or run ${put()}.`);
      const fd = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = fstatSync(fd);
        if (stat.isDirectory()) throw new Error(`${path} is a folder; name its entry file, for example [artifact::${join(path, "index.html")}].`);
        if (!artifactKind(canonical)) throw new Error(`The target ${canonical} isn't an artifact (.jsx, .tsx, .html, .svg or .mermaid); to store it explicitly, run ${put()}.`);
        if (!stat.isFile()) throw new Error(`${path} isn't a regular file on ${machine}; run ${put()} with a regular file.`);
        checkArtifactSize(1, stat.size);
        fingerprint = { dev: stat.dev, ino: stat.ino, size: stat.size, mtime: stat.mtimeMs };
        const cached = this.fileHashes.get(canonical);
        if (cached && cached.dev === stat.dev && cached.ino === stat.ino && cached.size === stat.size && cached.mtime === stat.mtimeMs) hash = cached.hash;
        else {
          content = readFileSync(fd);
          hash = new Bun.CryptoHasher("sha256").update(basename(canonical) + "\0").update(content).digest("hex");
        }
        // A removed snapshot needs the source again even when its fingerprint is unchanged.
        if (!content && (entry?.hash !== hash || !existsSync(join(this.root, "snapshots", name, String(entry.version), "files")))) content = readFileSync(fd);
      } finally { closeSync(fd); }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" && entry?.version) {
        if (!entry.gone) { entry.gone = new Date().toISOString(); save(); }
        return { ...this.info(`${entry.name}@${entry.version}`), warning: `file gone since ${entry.gone}: ${path}` };
      }
      if (code) throw new Error(`Can't read ${path} on ${machine} (${code}); from the machine with the file, run ${put()}.`);
      throw error;
    }
    if (entry?.hash !== hash || !existsSync(join(this.root, "snapshots", name, String(entry.version), "files"))) {
      await this.put(name, { [basename(canonical)]: content! });
      const snapshot = await this.snapshot(name);
      entry = paths[path] = { name, hash, version: snapshot.version };
      save();
    } else if (entry?.gone) { delete entry.gone; save(); }
    this.fileHashes.set(canonical, { ...fingerprint!, hash: hash! });
    return this.info(`${name}@${entry!.version}`);
  }

  /** An artifact by name, `name@n`, or the file or folder a path names (imported as a snapshot), as `artifacts.show` answers. */
  private show(requested: string, workspace?: string): ArtifactInfo | Promise<ArtifactInfo> {
    const aliases = workspace ? join(this.root, "aliases", basename(workspace)) : "";
    const map = aliases && existsSync(aliases) ? JSON.parse(readFileSync(aliases, "utf8")) : {};
    const name = Object.hasOwn(map, requested) ? map[requested] : requested;
    const parsed = artifactReference(name);
    if (parsed && (parsed.version || existsSync(join(this.live, parsed.name))) && (name === requested || !artifactKind(requested))) return this.info(name);
    if (requested.includes("/") || extname(requested) || (workspace && existsSync(resolve(workspace, requested)))) {
      const path = resolve(workspace ?? dirname(this.root), requested.startsWith("~/") ? join(homedir(), requested.slice(2)) : requested);
      const key = `${this.root}\0${path}`;
      const shared = ArtifactStore.resolving.get(key);
      const result = shared
        ? Promise.all([shared, this.pending]).then(([info]) => info)
        : Promise.all([ArtifactStore.pathReads.get(this.root), this.pending]).then(() => this.resolveFile(path, workspace ?? dirname(this.root)));
      ArtifactStore.resolving.set(key, result);
      const clear = () => { if (ArtifactStore.resolving.get(key) === result) ArtifactStore.resolving.delete(key); };
      void result.then(clear, clear);
      const settled = this.pending = result.then(() => {}, () => {});
      // Joining an earlier path must not replace a later import's root queue.
      if (!shared) {
        ArtifactStore.pathReads.set(this.root, settled);
        void settled.then(() => { if (ArtifactStore.pathReads.get(this.root) === settled) ArtifactStore.pathReads.delete(this.root); });
      }
      return result;
    }
    return this.info(name);
  }

  async request(request: ArtifactRequest, workspace?: string, outline?: string): Promise<unknown> {
    this.prepare();
    switch (request.action) {
      case "artifacts.deploy":
      case "artifacts.dns":
      case "artifacts.backfill": throw new Error("Select an outline with --ws for artifact deployment and registration.");
      case "artifacts.import": {
        if (!workspace) throw new Error("Select an outline with --ws to import its artifacts folder.");
        const source = join(workspace, "artifacts"), imported: ArtifactInfo[] = [];
        const alreadyThere: string[] = [], collided: { entry: string; name: string }[] = [], skipped: { entry: string; reason: string }[] = [];
        const report = () => ({ imported, alreadyThere, collided, skipped,
          counts: { imported: imported.length, alreadyThere: alreadyThere.length, collided: collided.length, skipped: skipped.length },
          said: "Imported paths resolve to their artifact names. Collisions and invalid entries were skipped. Source files were kept." });
        const aliasFile = join(this.root, "aliases", basename(workspace));
        const aliases: Record<string, string> = existsSync(aliasFile) ? JSON.parse(readFileSync(aliasFile, "utf8")) : {};
        const sourceStat = lstatSync(source, { throwIfNoEntry: false });
        if (!sourceStat) return report();
        if (sourceStat.isSymbolicLink()) throw new Error(`Import refuses link ${source}.`);
        for (const entry of readdirSync(source).filter(entry => !entry.startsWith(".")).sort()) {
          try {
            const path = join(source, entry), stat = lstatSync(path);
            if (stat.isSymbolicLink()) throw new Error(`Import refuses link ${entry}.`);
            const derived = stat.isDirectory() ? entry : basename(entry, extname(entry));
            const name = artifactName(artifactReference(derived)?.name === derived ? derived : artifactSlug(derived));
            const files = readArtifactInput(path, stat.isDirectory(), true);
            const live = join(this.live, name);
            if (existsSync(live)) {
              // Compilation adds an index; only an unchanged generated index is outside the imported source.
              const generated = join(this.root, "generated", name), index = join(live, "index.html");
              const generatedIndex = !Object.hasOwn(files, "index.html") && existsSync(generated) && existsSync(index)
                && readFileSync(generated, "utf8") === new Bun.CryptoHasher("sha256").update(readFileSync(index)).digest("hex");
              const paths = artifactFiles(live).filter(p => !(generatedIndex && p === "index.html"));
              if (aliases[path] === name && paths.length === Object.keys(files).length
                && paths.every(p => files[p] !== undefined && readFileSync(join(live, p)).equals(files[p]!))) alreadyThere.push(entry);
              else collided.push({ entry, name });
              continue;
            }
            imported.push(await this.put(name, files));
            aliases[`artifacts/${entry}`] = name; aliases[path] = name;
            mkdirSync(dirname(aliasFile), { recursive: true });
            writeFileSync(aliasFile, JSON.stringify(aliases));
          } catch (error) { skipped.push({ entry, reason: (error as Error).message }); }
        }
        return report();
      }
      case "artifacts.put": return this.put(request.name, request.files);
      case "artifacts.show": {
        const info = await this.show(request.name, workspace);
        return request.frame ? { ...info, frame: this.frame(info, request.frame, outline) } : info;
      }
      case "artifacts.list": {
        const deployed = deployedArtifacts(this);
        return { artifacts: [...readdirSync(this.live).filter(n => !n.startsWith(".") && !deployed.some(row => row.name === n)).map(n => this.info(n)), ...deployed] };
      }
      case "artifacts.versions": {
        const dir = join(this.root, "snapshots", artifactName(request.name));
        return { versions: existsSync(dir) ? readdirSync(dir).filter(n => existsSync(join(dir, n, "meta.json"))).map(n => {
          // A version's address is its page now, whatever address was kept when it was frozen (PIE-1266).
          const meta = JSON.parse(readFileSync(join(dir, n, "meta.json"), "utf8"));
          return { ...meta, url: artifactPageUrl(`${meta.name}@${meta.version}`) ?? null };
        }).sort((a,b) => a.version - b.version) : [] };
      }
      case "artifacts.snapshot": return this.snapshot(artifactName(request.name));
      case "artifacts.rm": {
        const info = this.info(request.name);
        rmSync(info.version ? join(this.root, "snapshots", info.name, String(info.version)) : join(this.live, info.name), { recursive: true });
        rmSync(join(this.root, "ids", request.name), { force: true });
        return { removed: request.name };
      }
      case "artifacts.upload.begin": {
        artifactName(request.name);
        const upload = crypto.randomUUID(), path = join(this.root, `.${upload}.tar`); writeFileSync(path, ""); this.uploads.set(upload, { name: request.name, path, bytes: 0 }); return { upload };
      }
      case "artifacts.upload.chunk": {
        const upload = this.uploads.get(request.upload); if (!upload) throw new Error("Upload has ended; run ep0ch artifact put again.");
        const data = Buffer.from(request.data, "base64"); upload.bytes += data.length;
        if (upload.bytes > artifactLimit() + 1024 * 1024) { this.uploads.delete(request.upload); rmSync(upload.path); throw new Error("Artifact upload exceeds the size cap."); }
        appendFileSync(upload.path, data); return { bytes: upload.bytes };
      }
      case "artifacts.upload.abort": { const upload = this.uploads.get(request.upload); if (upload) rmSync(upload.path, { force: true }); this.uploads.delete(request.upload); return {}; }
      case "artifacts.upload.finish": {
        const upload = this.uploads.get(request.upload); if (!upload) throw new Error("Upload has ended; run ep0ch artifact put again.");
        this.uploads.delete(request.upload);
        const stage = `${upload.path}.incoming`;
        mkdirSync(stage);
        try { untar(upload.path, stage); return await this.install(upload.name, stage); }
        finally { rmSync(upload.path, { force: true }); rmSync(stage, { recursive: true, force: true }); }
      }
    }
  }
}

// CLI emits POSIX ustar: reject links and extensions before any file reaches the live folder.
export function untar(path: string, folder: string): void {
  const fd = openSync(path, "r"), length = lstatSync(path).size;
  let at = 0, bytes = 0, entries = 0;
  const seen = new Set<string>();
  try {
    for (;;) {
      const header = Buffer.alloc(512);
      if (readSync(fd, header, 0, 512, at) !== 512) throw new Error("Incomplete tar upload.");
      at += 512;
      if (header.every(b => b === 0)) break;
      entries++;
      checkArtifactSize(entries, bytes);
      const field = (start: number, end: number) => header.subarray(start, end).toString().split("\0")[0]!;
      const sum = header.reduce((n,b,i) => n + (i >= 148 && i < 156 ? 32 : b), 0);
      if (sum !== parseInt(field(148,156).trim(), 8)) throw new Error("Invalid tar header.");
      const prefix = field(345,500), raw = (prefix ? prefix + "/" : "") + field(0,100);
      const relative = raw.replace(/^\.\//, "").replace(/\/$/, "");
      const kind = field(156,157), size = parseInt(field(124,136).trim(), 8);
      if (!Number.isSafeInteger(size) || size < 0 || at + size > length) throw new Error("Incomplete tar upload.");
      bytes += size;
      checkArtifactSize(entries, bytes);
      if (kind === "5") { if (relative && relative !== ".") artifactPath(relative); }
      else if (kind === "0" || kind === "") {
        const target = join(folder, artifactPath(relative)); mkdirSync(dirname(target), { recursive: true });
        if (seen.has(target)) throw new Error(`The archive lists ${relative} twice.`);
        seen.add(target);
        const out = openSync(target, "w"), chunk = Buffer.alloc(64 * 1024);
        try {
          for (let offset = 0; offset < size;) {
            const n = readSync(fd, chunk, 0, Math.min(chunk.length, size - offset), at + offset);
            if (!n) throw new Error("Incomplete tar upload.");
            writeSync(out, chunk, 0, n); offset += n;
          }
        } finally { closeSync(out); }
      } else throw new Error("Upload a folder of regular files, without links or tar extensions.");
      at += Math.ceil(size / 512) * 512;
    }
  } finally { closeSync(fd); }
}
