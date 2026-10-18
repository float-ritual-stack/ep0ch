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
function artifactFiles(folder: string): string[] {
  return readdirSync(folder).sort().flatMap(name => {
    const path = join(folder, name), stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error(`Artifacts cannot contain links or special files: ${name}`);
    return stat.isDirectory() ? artifactFiles(path).map(p => `${name}/${p}`) : [name];
  });
}

export class ArtifactStore {
  readonly root: string;
  readonly live: string;
  readonly compiler: ArtifactCompiler;
  private uploads = new Map<string, { name: string; path: string; bytes: number }>();
  private watcher?: FSWatcher;
  private pending = new Map<string, Promise<void>>();
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
  async compile(name: string) {
    const folder = join(this.live, name);
    if (lstatSync(folder).isSymbolicLink()) throw new Error("An artifact folder cannot be a symlink.");
    const generated = join(this.root, "generated", name);
    const index = join(folder, "index.html");
    if (existsSync(index) && (!existsSync(generated) || readFileSync(generated, "utf8") !== new Bun.CryptoHasher("sha256").update(readFileSync(index)).digest("hex"))) return;
    const files = artifactFiles(folder).filter(p => p !== "index.html");
    if (files.length !== 1 || !/\.(jsx|tsx)$/.test(files[0]!)) return;
    const source = readFileSync(join(folder, files[0]!), "utf8");
    const build = await this.compiler.compile(source, extname(files[0]!) as ".jsx" | ".tsx");
    // Saving source always wins, including source that cannot compile.
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
    const enqueue = (name: string) => {
      if (!name || name.startsWith(".")) return;
      const prior = this.pending.get(name) ?? Promise.resolve();
      const job = prior.then(async () => { if (existsSync(join(this.live, name))) { this.id(name); await this.compile(name); } }).catch(e => console.error(`artifact ${name}: ${e.message}`));
      this.pending.set(name, job);
      void job.finally(() => { if (this.pending.get(name) === job) this.pending.delete(name); });
    };
    this.watcher = watch(this.live, { recursive: true }, (_, file) => { if (file) enqueue(String(file).split("/")[0]!); });
    for (const name of readdirSync(this.live)) enqueue(name);
  }
  close() { this.watcher?.close(); for (const upload of this.uploads.values()) rmSync(upload.path, { force: true }); this.uploads.clear(); }
  async put(name: string, files: Record<string, string | Uint8Array>) {
    artifactName(name); this.prepare();
    let size = 0;
    for (const [path, content] of Object.entries(files)) { artifactPath(path); size += Buffer.byteLength(content); }
    if (size > artifactLimit()) throw new Error(`Artifact exceeds ${artifactLimit()} bytes.`);
    const stage = join(this.root, `.${crypto.randomUUID()}.incoming`);
    mkdirSync(stage);
    try {
      for (const [path, content] of Object.entries(files)) { const to = join(stage, path); mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, content); }
      return await this.install(name, stage);
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }
  private async install(name: string, stage: string) {
    const folder = join(this.live, name), previous = `${stage}.previous`;
    if (existsSync(folder)) {
      if (lstatSync(folder).isSymbolicLink()) throw new Error("An artifact folder cannot be a symlink.");
      renameSync(folder, previous);
    }
    try { renameSync(stage, folder); }
    catch (error) { if (existsSync(previous)) renameSync(previous, folder); throw error; }
    rmSync(previous, { recursive: true, force: true });
    await this.compile(name);
    return this.info(name);
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
      case "artifacts.snapshot": {
        const name = artifactName(request.name);
        await this.compile(name);
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
