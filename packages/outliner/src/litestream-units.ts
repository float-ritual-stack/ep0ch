// The Litestream units on this machine and the databases their configs name (PIE-371, PIE-607): read from the unit
// files (systemd user units on Linux, launchd agents on macOS) and Litestream's YAML, without asking Litestream or
// systemd anything. The door's doctor (packages/door/src/setup/backups.ts) checks them; the outline host's
// Litestream guard (litestream-guard.ts) pauses the replicator around a change to an outline's file.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { outlineOfFile } from "@ep0ch/outline-core/outline-location";

export type Platform = "linux" | "macos" | "other";
type Env = Record<string, string | undefined>;

/** One Litestream unit, from its file: how it runs Litestream. A template (`litestream-mirror@.service`) is read as each running instance (`instances`). */
export interface LitestreamUnit {
  kind: "systemd" | "launchd";
  name: string;
  path: string;
  role: "replicate" | "follow";
  /** What runs before litestream (`with-secrets hetzner-s3 --`), so a check runs it the same way. */
  wrapper: string[];
  litestream: string;
  config: string;
  /** A follower's output database (`-o`, else the last argument). */
  output?: string;
  /** A follower given a replica URL (`restore -f -o <output> <url>`) instead of a config's database. */
  url?: string;
  /** systemd's EnvironmentFile (the bucket's keys), read only into the child's environment. */
  envFile?: string;
  /** launchd's StandardErrorPath and StandardOutPath (Litestream logs to stdout): its logs. */
  logPaths?: string[];
}

// ── reading units ────────────────────────────────────────────────────────────────────────────────────────────

/** systemd's ExecStart split as a shell would (quotes kept simple), with %h for the home folder. */
const words = (s: string, home: string) => (s.match(/"[^"]*"|\S+/g) ?? []).map(w => w.replace(/^"|"$/g, "").replace(/%h/g, home));

/** How a unit runs Litestream, from its argv: its wrapper, the binary, the command, the config, a follower's output. */
export function litestreamArgv(argv: readonly string[]): Pick<LitestreamUnit, "wrapper" | "litestream" | "role" | "config" | "output" | "url"> | null {
  const at = argv.findIndex(a => basename(a) === "litestream");
  if (at < 0) return null;
  const cmd = argv[at + 1], rest = argv.slice(at + 2);
  const flag = (f: string) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : undefined; };
  const config = flag("-config") ?? flag("--config") ?? "/etc/litestream.yml";
  if (cmd === "replicate") return { wrapper: argv.slice(0, at), litestream: argv[at]!, role: "replicate", config };
  if (cmd === "restore" && (rest.includes("-f") || rest.includes("--f"))) {
    const last = rest.at(-1), o = flag("-o");
    if (!last || last.startsWith("-")) return null;
    const base = { wrapper: argv.slice(0, at), litestream: argv[at]!, role: "follow" as const, config };
    if (o) return /^[a-z0-9]+:\/\//i.test(last) ? { ...base, output: o, url: last } : { ...base, output: o };
    return { ...base, output: last };
  }
  return null;
}

/** A plist's string values under a key: one (`<string>`), or an array's. */
const plistStrings = (text: string, key: string): string[] => {
  const m = new RegExp(`<key>\\s*${key}\\s*</key>\\s*(<array>([\\s\\S]*?)</array>|<string>([^<]*)</string>)`).exec(text);
  if (!m) return [];
  return m[2] !== undefined ? [...m[2].matchAll(/<string>([^<]*)<\/string>/g)].map(x => x[1]!.trim()) : [m[3]!.trim()];
};

/** The Litestream units on this machine: systemd user units on Linux, launchd agents on macOS. */
export function litestreamUnits(platform: Platform, home: string): LitestreamUnit[] {
  const [kind, dir, ext] = platform === "linux" ? ["systemd", join(home, ".config/systemd/user"), ".service"] as const
    : platform === "macos" ? ["launchd", join(home, "Library/LaunchAgents"), ".plist"] as const : [null, "", ""] as const;
  if (!kind || !existsSync(dir)) return [];
  const out: LitestreamUnit[] = [];
  for (const file of readdirSync(dir).filter(n => n.endsWith(ext)).sort()) {
    let text: string;
    try { text = readFileSync(join(dir, file), "utf8"); } catch { continue; }
    if (!text.includes("litestream")) continue;
    if (kind === "systemd") {
      const exec = /^\s*ExecStart\s*=\s*(.+)$/m.exec(text)?.[1];
      const how = exec ? litestreamArgv(words(exec, home)) : null;
      if (!how) continue;
      const envFile = /^\s*EnvironmentFile\s*=\s*-?(.+)$/m.exec(text)?.[1]?.trim().replace(/%h/g, home);
      out.push({ kind, name: file, path: join(dir, file), ...how, ...(envFile ? { envFile } : {}) });
    } else {
      const how = litestreamArgv(plistStrings(text, "ProgramArguments"));
      if (!how) continue;
      const label = plistStrings(text, "Label")[0] ?? file.replace(/\.plist$/, "");
      const logPaths = [...new Set([...plistStrings(text, "StandardOutPath"), ...plistStrings(text, "StandardErrorPath")])];
      out.push({ kind, name: label, path: join(dir, file), ...how, ...(logPaths.length ? { logPaths } : {}) });
    }
  }
  return out;
}

/** A systemd template unit (`litestream-mirror@.service`): its files run as instances, each its own unit. */
export const isTemplate = (u: Pick<LitestreamUnit, "kind" | "name">) => u.kind === "systemd" && u.name.endsWith("@.service");

/** A template unit as one instance: its name, and %i in its output and replica URL, filled in. */
export function templateInstance(u: LitestreamUnit, instance: string): LitestreamUnit {
  const fill = (v: string | undefined) => v?.replaceAll("%i", instance);
  return { ...u, name: u.name.replace("@.service", `@${instance}.service`), ...(u.output ? { output: fill(u.output)! } : {}), ...(u.url ? { url: fill(u.url)! } : {}) };
}

/** `systemctl list-units --plain --no-legend` lines: the instances of `template` (`litestream-mirror@.service`). */
export function instancesIn(listing: string, template: string): string[] {
  const prefix = template.replace("@.service", "@");
  return [...new Set(listing.split("\n").map(l => l.trim().split(/\s+/)[0] ?? "").filter(n => n.startsWith(prefix) && n.endsWith(".service")).map(n => n.slice(prefix.length, -".service".length)).filter(Boolean))].sort();
}

// ── the config and its databases ─────────────────────────────────────────────────────────────────────────────

interface ReplicaConfig { type?: string; url?: string; bucket?: string; path?: string; endpoint?: string; region?: string }
export interface DbConfig { path?: string; dir?: string; pattern?: string; replica?: ReplicaConfig; replicas?: ReplicaConfig[] }

/** A replica's URL for one database (`rel`: its path under a `dir` entry), in the form `litestream ltx` takes. */
export function replicaUrl(r: ReplicaConfig | undefined, rel?: string): string | null {
  if (!r) return null;
  const tail = (base: string) => {
    if (!rel) return base;
    const q = base.indexOf("?");
    const [path, query] = q < 0 ? [base, ""] : [base.slice(0, q), base.slice(q)];
    return `${path.replace(/\/+$/, "")}/${rel}${query}`;
  };
  if (r.url) return tail(r.url);
  if ((r.type ?? "s3") === "s3" && r.bucket) {
    const q = [...(r.endpoint ? [`endpoint=${r.endpoint}`] : []), ...(r.region ? [`region=${r.region}`] : [])].join("&");
    return `s3://${r.bucket}/${tail((r.path ?? "").replace(/^\/+/, ""))}${q ? `?${q}` : ""}`;
  }
  if (r.type === "file" && r.path) return `file://${tail(r.path)}`;
  return null;
}

const globRe = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`);

/** A config's `dbs` entries as Litestream reads them ($VAR and ${VAR} expanded from its environment), or null when it doesn't parse. */
export function configEntries(configText: string, env: Env = {}): DbConfig[] | null {
  const expanded = configText.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, a, b) => env[a ?? b] ?? "");
  try { return ((Bun.YAML.parse(expanded) as { dbs?: DbConfig[] } | null)?.dbs ?? []); } catch { return null; }
}

/** Whether a config's entries cover this database file, made yet or not: its `path`, or a `dir` whose pattern it matches. */
export function covers(entries: readonly DbConfig[], file: string): boolean {
  return entries.some(db => db.path ? resolve(db.path) === resolve(file)
    : !!db.dir && resolve(db.dir) === resolve(dirname(file)) && globRe(db.pattern ?? "*").test(basename(file)));
}

/** The databases a config names: each `path`, and a `dir` entry's outlines (`<name>.sqlite` matching its pattern). */
export function configDatabases(configText: string, env: Env = {}): { path: string; url: string | null }[] {
  const out: { path: string; url: string | null }[] = [];
  for (const db of configEntries(configText, env) ?? []) {
    const replica = db.replica ?? db.replicas?.[0];
    if (db.path) out.push({ path: db.path, url: replicaUrl(replica) });
    else if (db.dir) {
      const re = globRe(db.pattern ?? "*");
      let files: string[] = [];
      try { files = readdirSync(db.dir).sort(); } catch { /* the folder isn't there */ }
      // Outlines only: the host's side files (`<name>.sqlite.owner.sqlite`) and hidden copies aren't outlines.
      for (const f of files) if (re.test(f) && outlineOfFile(f)) out.push({ path: join(db.dir, f), url: replicaUrl(replica, relative(db.dir, join(db.dir, f))) });
    }
  }
  return out;
}

