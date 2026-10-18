import { mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, openSync, closeSync, readSync, writeSync, rmSync, lstatSync, existsSync, cpSync, watch, type FSWatcher } from "node:fs";
import { join, dirname, extname, basename } from "node:path";
import { ArtifactCompiler, reactArtifactPage } from "./publish-artifacts";
import { artifactReference, type ArtifactInfo, type ArtifactRequest } from "@ep0ch/outline-core/artifacts";

const artifactLimit = () => Number(process.env.EP0CH_ARTIFACT_MAX_BYTES ?? 64 * 1024 * 1024);
function artifactName(name: string): string {
  if (artifactReference(name)?.name !== name) throw new Error("Use an artifact name containing letters, numbers, dots, underscores or hyphens.");
  return name;
}
function artifactPath(path: string): string {
  if (!path || path.includes("\\") || path.includes("\0") || path.split("/").some(p => !p || p === "." || p === "..")) throw new Error(`Unsafe artifact path: ${path}`);
  return path;
}
function artifactFiles(folder: string, ignoreHidden = false): string[] {
  return readdirSync(folder).filter(name => !ignoreHidden || !name.startsWith(".")).sort().flatMap(name => {
    const path = join(folder, name), stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error(`Artifacts cannot contain links or special files: ${name}`);
    return stat.isDirectory() ? artifactFiles(path, ignoreHidden).map(p => `${name}/${p}`) : [name];
  });
}

export class ArtifactStore {
  readonly root: string;
  readonly live: string;
  readonly compiler: ArtifactCompiler;
  private uploads = new Map<string, { name: string; path: string; bytes: number }>();
  private watcher?: FSWatcher;
  private pending: Promise<void> = Promise.resolve();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private changes = new Map<string, number>();
  constructor(outlines: string) {
    this.root = join(outlines, ".artifacts");
    this.live = join(this.root, "live");
    this.compiler = new ArtifactCompiler({ cacheDirectory: join(outlines, ".artifact-cache") });
  }
  private prepare() { for (const folder of [this.live, join(this.root, "snapshots"), join(this.root, "ids")]) mkdirSync(folder, { recursive: true }); }
  private id(name: string): string {
    this.prepare();
    const path = join(this.root, "ids", name);
    if (!existsSync(path)) writeFileSync(path, crypto.randomUUID(), { flag: "wx" });
    return readFileSync(path, "utf8");
  }
  info(ref: string): ArtifactInfo {
    const parsed = artifactReference(ref);
    if (!parsed) throw new Error("Use an artifact name, or <name>@<number> for a snapshot.");
    const { name, version } = parsed, pin = version?.toString();
    const folder = pin ? join(this.root, "snapshots", name, pin, "files") : join(this.live, name);
    if (!existsSync(folder)) throw new Error(`No artifact ${ref}; use ep0ch artifact put <file-or-folder> --name ${name}.`);
    if (lstatSync(folder).isSymbolicLink()) throw new Error("An artifact folder cannot be a symlink.");
    const files = artifactFiles(folder), bytes = files.reduce((n, p) => n + lstatSync(join(folder, p)).size, 0);
    const origin = process.env.EP0CH_ARTIFACT_ORIGIN?.replace(/\/$/, "");
    return { name, ...(pin ? { version: Number(pin) } : {}), files, bytes, url: origin ? `${origin}/${this.id(name)}/${encodeURIComponent(ref)}/` : null };
  }
  async compile(name: string, folder = join(this.live, name), rejectErrors = false) {
    if (lstatSync(folder).isSymbolicLink()) throw new Error("An artifact folder cannot be a symlink.");
    const generated = join(this.root, "generated", name);
    const index = join(folder, "index.html");
    if (existsSync(index) && (!existsSync(generated) || readFileSync(generated, "utf8") !== new Bun.CryptoHasher("sha256").update(readFileSync(index)).digest("hex"))) return;
    const files = artifactFiles(folder).filter(p => p !== "index.html");
    if (files.length !== 1 || !/\.(jsx|tsx)$/i.test(files[0]!)) return;
    const source = readFileSync(join(folder, files[0]!), "utf8");
    const build = await this.compiler.compile(source, extname(files[0]!).toLowerCase() as ".jsx" | ".tsx");
    if (!build.ok && rejectErrors) throw new Error(`Artifact could not compile: ${build.problems.join("\n")}`);
    // Direct puts preserve source even when it cannot compile.
    const html = build.ok ? reactArtifactPage(name, build.script) : `<!doctype html><title>Artifact needs fixing</title><pre>${build.problems.join("\n").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`;
    if (readFileSync(join(folder, files[0]!), "utf8") !== source) return;
    if (!existsSync(join(folder, "index.html")) || readFileSync(join(folder, "index.html"), "utf8") !== html) {
      mkdirSync(dirname(generated), { recursive: true });
      writeFileSync(generated, new Bun.CryptoHasher("sha256").update(html).digest("hex"));
      writeFileSync(index, html);
    }
  }
  startWatcher() {
    this.prepare();
    const inbox = process.env.EP0CH_ARTIFACT_INBOX ?? join(this.root, "inbox");
    const settle = Number(process.env.EP0CH_ARTIFACT_SETTLE_MS ?? 10_000);
    mkdirSync(inbox, { recursive: true });
    const enqueue = (name: string) => {
      if (!name || name.startsWith(".") || name === "receipts.log") return;
      clearTimeout(this.timers.get(name));
      const change = (this.changes.get(name) ?? 0) + 1;
      this.changes.set(name, change);
      const current = () => this.changes.get(name) === change;
      this.timers.set(name, setTimeout(() => {
        this.timers.delete(name);
        this.pending = this.pending.then(async () => {
          if (current() && existsSync(join(inbox, name))) await this.pickup(inbox, name, current);
        }).catch(error => console.error(`artifact ${name}: ${error.message}`));
      }, settle));
    };
    this.watcher = watch(inbox, { recursive: true }, (_, file) => {
      if (file && !String(file).split("/").some(part => part.startsWith("."))) enqueue(String(file).split("/")[0]!);
    });
    for (const name of readdirSync(inbox)) enqueue(name);
  }
  private async pickup(inbox: string, entry: string, current: () => boolean) {
    const source = join(inbox, entry);
    try {
      const stat = lstatSync(source), folder = stat.isDirectory();
      if (stat.isSymbolicLink() || (!folder && !stat.isFile())) throw new Error("Drop a regular file or folder, without links.");
      if (!folder && !/\.(html|jsx|tsx|svg|mermaid|md)$/i.test(entry)) throw new Error("Unknown artifact kind; use html, jsx, tsx, svg, mermaid or md, or a built folder.");
      const name = folder ? entry : basename(entry, extname(entry)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const paths = folder ? artifactFiles(source, true) : [entry];
      const pathOf = (path: string) => folder ? join(source, path) : source;
      if (paths.reduce((bytes, path) => bytes + lstatSync(pathOf(path)).size, 0) > artifactLimit()) throw new Error(`Artifact exceeds ${artifactLimit()} bytes.`);
      const files = Object.fromEntries(paths.map(path => [path, readFileSync(pathOf(path))]));
      await this.put(name, files, { compile: !folder, rejectErrors: true });
      const version = await this.snapshot(name);
      appendFileSync(join(inbox, "receipts.log"), `${new Date().toISOString()}\t${name}\t${version.version}\t${version.url ?? ""}\n`);
      // A save arriving during compilation belongs to the next pickup.
      if (current()) rmSync(source, { recursive: true, force: true });
    } catch (error) {
      if (!current()) return;
      const failed = join(inbox, ".failed", entry);
      mkdirSync(failed, { recursive: true });
      // Keep earlier failures when the same filename is dropped again.
      const destination = existsSync(join(failed, "source")) ? join(failed, crypto.randomUUID()) : failed;
      mkdirSync(join(destination, "source"), { recursive: true });
      renameSync(source, join(destination, "source", entry));
      writeFileSync(join(destination, "reason.txt"), `${(error as Error).message}\n`);
    }
  }
  async close() {
    this.watcher?.close();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await this.pending;
    for (const upload of this.uploads.values()) rmSync(upload.path, { force: true });
    this.uploads.clear();
  }
  async put(name: string, files: Record<string, string | Uint8Array>, options = { compile: true, rejectErrors: false }) {
    artifactName(name); this.prepare();
    let size = 0;
    for (const [path, content] of Object.entries(files)) { artifactPath(path); size += Buffer.byteLength(content); }
    if (size > artifactLimit()) throw new Error(`Artifact exceeds ${artifactLimit()} bytes.`);
    const stage = join(this.root, `.${crypto.randomUUID()}.incoming`);
    mkdirSync(stage);
    try {
      for (const [path, content] of Object.entries(files)) { const to = join(stage, path); mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, content); }
      return await this.install(name, stage, options);
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }
  private async install(name: string, stage: string, options = { compile: true, rejectErrors: false }) {
    if (options.compile) await this.compile(name, stage, options.rejectErrors);
    if (options.rejectErrors && artifactFiles(stage).reduce((bytes, path) => bytes + lstatSync(join(stage, path)).size, 0) > artifactLimit()) throw new Error(`Artifact exceeds ${artifactLimit()} bytes after compilation.`);
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
  private async snapshot(name: string) {
    const info = this.info(name), dir = join(this.root, "snapshots", name);
    mkdirSync(dir, { recursive: true });
    if (info.bytes > artifactLimit()) throw new Error(`Artifact exceeds ${artifactLimit()} bytes.`);
    const sequence = join(this.root, "sequences", name);
    mkdirSync(dirname(sequence), { recursive: true });
    const version = (existsSync(sequence) ? Number(readFileSync(sequence, "utf8")) : 0) + 1;
    writeFileSync(sequence, String(version));
    const target = join(dir, String(version));
    cpSync(join(this.live, name), join(target, "files"), { recursive: true });
    const hash = new Bun.CryptoHasher("sha256");
    for (const file of artifactFiles(join(target, "files"))) hash.update(file + "\0").update(readFileSync(join(target, "files", file)));
    const result = { ...this.info(`${name}@${version}`), hash: hash.digest("hex"), at: new Date().toISOString() };
    writeFileSync(join(target, "meta.json"), JSON.stringify(result));
    return result;
  }
  async request(request: ArtifactRequest, workspace?: string): Promise<unknown> {
    this.prepare();
    switch (request.action) {
      case "artifacts.import": {
        if (!workspace) throw new Error("Select an outline with --ws to import its artifacts folder.");
        const source = join(workspace, "artifacts"), imported: ArtifactInfo[] = [];
        const aliasFile = join(this.root, "aliases", basename(workspace));
        const aliases: Record<string, string> = existsSync(aliasFile) ? JSON.parse(readFileSync(aliasFile, "utf8")) : {};
        if (!existsSync(source)) return { imported };
        for (const entry of readdirSync(source)) {
          const path = join(source, entry), stat = lstatSync(path);
          if (stat.isSymbolicLink()) throw new Error(`Import refuses link ${entry}.`);
          const name = stat.isDirectory() ? entry : entry.slice(0, entry.length - extname(entry).length);
          if (existsSync(join(this.live, name))) throw new Error(`Artifact ${name} already exists; move or rename it before importing ${entry}.`);
          const files = stat.isDirectory() ? Object.fromEntries(artifactFiles(path).map(p => [p, readFileSync(join(path, p))])) : { [entry]: readFileSync(path) };
          imported.push(await this.put(name, files));
          aliases[`artifacts/${entry}`] = name; aliases[path] = name;
          mkdirSync(dirname(aliasFile), { recursive: true });
          writeFileSync(aliasFile, JSON.stringify(aliases));
        }
        return { imported, said: "Old artifact paths now resolve to the imported folders. New notes can use [artifact::<name>]. Source files were kept." };
      }
      case "artifacts.put": return this.put(request.name, request.files);
      case "artifacts.show": {
        const aliases = workspace ? join(this.root, "aliases", basename(workspace)) : "";
        const map = aliases && existsSync(aliases) ? JSON.parse(readFileSync(aliases, "utf8")) : {};
        const name = Object.hasOwn(map, request.name) ? map[request.name] : request.name;
        return this.info(name);
      }
      case "artifacts.list": return { artifacts: readdirSync(this.live).filter(n => !n.startsWith(".")).map(n => this.info(n)) };
      case "artifacts.versions": {
        const dir = join(this.root, "snapshots", artifactName(request.name));
        return { versions: existsSync(dir) ? readdirSync(dir).map(n => JSON.parse(readFileSync(join(dir, n, "meta.json"), "utf8"))).sort((a,b) => a.version - b.version) : [] };
      }
      case "artifacts.snapshot": return this.snapshot(artifactName(request.name));
      case "artifacts.rm": {
        const info = this.info(request.name);
        rmSync(info.version ? join(this.root, "snapshots", info.name, String(info.version)) : join(this.live, info.name), { recursive: true });
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
function untar(path: string, folder: string): void {
  const fd = openSync(path, "r"), length = lstatSync(path).size;
  let at = 0, bytes = 0;
  try {
    for (;;) {
      const header = Buffer.alloc(512);
      if (readSync(fd, header, 0, 512, at) !== 512) throw new Error("Incomplete tar upload.");
      at += 512;
      if (header.every(b => b === 0)) break;
      const field = (start: number, end: number) => header.subarray(start, end).toString().split("\0")[0]!;
      const sum = header.reduce((n,b,i) => n + (i >= 148 && i < 156 ? 32 : b), 0);
      if (sum !== parseInt(field(148,156).trim(), 8)) throw new Error("Invalid tar header.");
      const prefix = field(345,500), raw = (prefix ? prefix + "/" : "") + field(0,100);
      const relative = raw.replace(/^\.\//, "").replace(/\/$/, "");
      const kind = field(156,157), size = parseInt(field(124,136).trim(), 8);
      if (!Number.isSafeInteger(size) || size < 0 || at + size > length) throw new Error("Incomplete tar upload.");
      bytes += size;
      if (bytes > artifactLimit()) throw new Error(`Artifact exceeds ${artifactLimit()} bytes.`);
      if (kind === "5") { if (relative && relative !== ".") artifactPath(relative); }
      else if (kind === "0" || kind === "") {
        const target = join(folder, artifactPath(relative)); mkdirSync(dirname(target), { recursive: true });
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
