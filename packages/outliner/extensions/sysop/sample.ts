// Pure parts of the sysop monk: the one shell snippet a tick runs on a machine, how its output becomes a reading, how
// the page's thresholds are read, which readings cross them, and the one safe command for the process holding memory.
// No I/O.

/** What one tick reads on one machine. Bytes are bytes; `load` is the one-minute average. */
export interface Reading {
  memoryTotal: number;
  /** Memory a process could take now (`free`'s available column, else its free column). */
  memoryFree: number;
  load: number;
  cpus: number;
  diskTotal: number;
  diskFree: number;
  failedUnits: string[];
  /** The three processes with the most resident memory, largest first. */
  top: Process[];
}

export interface Process {
  pid: number;
  /** Resident set, in bytes. */
  rss: number;
  /** The command's first word, without its folder. */
  name: string;
  /** The one command that frees it: a user unit or a container restart. Nothing else is safe to run unasked. */
  command?: string;
}

/** The snippet runs every read in one shell, each part under a `@@name` line, so a machine is one ssh per tick. */
export const SNIPPET = [
  "if [ \"$(uname -s)\" = Darwin ]; then",
  "echo @@macmem; sysctl -n hw.memsize; vm_stat",
  "echo @@load; sysctl -n vm.loadavg | tr -d '{}'",
  "echo @@cpus; sysctl -n hw.ncpu",
  "echo @@macdisk; df -k -P /",
  "echo @@top; ps -axo pid=,rss=,args= | sort -k2nr | head -3",
  "else",
  "echo @@mem; free -b",
  "echo @@load; cat /proc/loadavg",
  "echo @@cpus; nproc",
  "echo @@disk; df -B1 -P /",
  "echo @@failed; systemctl --user --failed --no-pager --plain --no-legend || exit 1",
  "echo @@top; ps -eo pid,rss,args --sort=-rss --no-headers 2>/dev/null | head -3",
  "echo @@cgroup; for p in $(ps -eo pid --sort=-rss --no-headers 2>/dev/null | head -3); do echo \"$p $(head -1 /proc/$p/cgroup 2>/dev/null)\"; done",
  "fi",
  "echo @@docker; if command -v docker >/dev/null 2>&1; then docker ps --no-trunc --format '{{.ID}} {{.Names}}' 2>/dev/null; fi",
  "echo @@end",
].join("\n");

/** The snippet's output split at its `@@name` lines. */
export function sections(output: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current: string[] | null = null;
  for (const line of output.replace(/\r/g, "").split("\n")) {
    const m = line.match(/^@@([a-z]+)\s*$/);
    if (m) { current = out[m[1]!] = []; continue; }
    if (current && line.trim()) current.push(line);
  }
  return out;
}

/**
 * A reading from the snippet's output. Throws on output with no `@@end` (a machine that answered with something other
 * than the snippet's output: a shell that printed a banner and died, a wrong host) so the tick records it, not a zero.
 */
export function parseReading(output: string): Reading {
  const s = sections(output);
  if (!s.end) throw new Error("the sample didn't finish: no @@end in the output");
  const mem = (s.mem ?? []).find((l) => /^Mem:/.test(l))?.split(/\s+/) ?? [];
  const mac = s.macmem?.join("\n");
  const pageSize = Number(mac?.match(/page size of (\d+) bytes/)?.[1]);
  const pages = (kind: string) => Number(mac?.match(new RegExp(`Pages ${kind}:\\s+(\\d+)`))?.[1]);
  const memoryTotal = mac ? Number(s.macmem![0]) : Number(mem[1]);
  const memoryFree = mac ? (pages("free") + pages("inactive")) * pageSize : Number(mem[6]);
  const load = Number(s.load?.[0]?.trim().split(/\s+/)[0]);
  const cpus = Number(s.cpus?.[0]);
  const disk = (s.macdisk ?? s.disk ?? []).find((l) => /\s\/$/.test(l))?.trim().split(/\s+/) ?? [];
  const diskTotal = Number(disk[1]) * (mac ? 1024 : 1), diskFree = Number(disk[3]) * (mac ? 1024 : 1);
  if (![memoryTotal, memoryFree, load, cpus, diskTotal, diskFree].every(Number.isFinite) || memoryTotal <= 0 || diskTotal <= 0 || cpus <= 0) {
    throw new Error("sample has no usable memory, load or disk reading; check the machine's free/sysctl and df commands");
  }
  const failedUnits = (s.failed ?? []).map((l) => l.trim().split(/\s+/)[0]!).filter((u) => /\.(service|timer|socket|mount|path|scope|slice|target)$/.test(u));
  const cgroups = new Map<number, string>();
  for (const line of s.cgroup ?? []) { const m = line.match(/^(\d+)\s+(.*)$/); if (m) cgroups.set(Number(m[1]), m[2]!); }
  const containers = new Map<string, string>();
  for (const line of s.docker ?? []) { const [id, name] = line.trim().split(/\s+/); if (id && name) containers.set(id, name); }
  const top: Process[] = [];
  for (const line of s.top ?? []) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]), rss = Number(m[2]) * 1024;
    const first = m[3]!.trim().split(/\s+/)[0] ?? "";
    const name = first.slice(first.lastIndexOf("/") + 1) || first;
    const command = commandFor(cgroups.get(pid) ?? "", containers);
    top.push({ pid, rss, name, ...(command ? { command } : {}) });
  }
  return { memoryTotal, memoryFree, load, cpus, diskTotal, diskFree, failedUnits, top };
}

/**
 * The one safe command for a process, from its cgroup line (`0::/user.slice/…/app.slice/tempo.service`,
 * `0::/system.slice/docker-<id>.scope`): restart its user unit, or restart its container. A system unit, a login
 * shell or anything else gets none: "nothing safe to run; look".
 */
export function commandFor(cgroup: string, containers: ReadonlyMap<string, string>): string | undefined {
  const user = cgroup.match(/\/user@\d+\.service\/(?:[^/]+\/)*([A-Za-z0-9@._-]+)\.service$/);
  if (user) return `systemctl --user restart ${user[1]}.service`;
  const docker = cgroup.match(/(?:docker-|\/docker\/)([0-9a-f]{12,64})(?:\.scope|$)/);
  if (docker) { const name = containers.get(docker[1]!); if (name) return `docker restart ${name}`; }
  return undefined;
}

/** Only a user unit's or a container's restart may run as `calm`; anything else recorded on a trip is refused. */
export const SAFE_COMMAND = /^(?:systemctl --user restart [A-Za-z0-9@._-]+|docker restart [A-Za-z0-9._-]+)$/;

/** The page's thresholds: `[memory-free-min::2G] [load-max::8] [disk-free-min::10%]`. Each is bytes, or a share of the total. */
export interface Thresholds {
  memoryFreeMin?: Amount;
  loadMax?: number;
  diskFreeMin?: Amount;
}
export type Amount = { bytes: number } | { share: number };

const UNITS: Record<string, number> = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };

/** `2G`, `512M`, `10%`, `3000000000`; anything else is no threshold. */
export function parseAmount(text: string | undefined): Amount | undefined {
  const m = (text ?? "").trim().match(/^(\d+(?:\.\d+)?)\s*(%|[kmgt]i?b?)?$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (m[2] === "%") return { share: n / 100 };
  return { bytes: Math.round(n * (UNITS[(m[2] ?? "").toLowerCase()[0] ?? ""] ?? 1)) };
}

export function thresholdsOf(props: Record<string, string | undefined>): Thresholds {
  const load = Number(props["load-max"]);
  return {
    ...(parseAmount(props["memory-free-min"]) ? { memoryFreeMin: parseAmount(props["memory-free-min"]) } : {}),
    ...(Number.isFinite(load) && props["load-max"] ? { loadMax: load } : {}),
    ...(parseAmount(props["disk-free-min"]) ? { diskFreeMin: parseAmount(props["disk-free-min"]) } : {}),
  };
}

const atLeast = (amount: Amount, total: number) => "bytes" in amount ? amount.bytes : amount.share * total;

/** What a reading crossed: each with its kind, the number in words, the process holding it and the one command. */
export interface Crossing {
  kind: "memory" | "load" | "disk" | "failed";
  /** The number, in words: "1.2G free of 64G (under 2G)". */
  number: string;
  /** The process named for it, when one is: memory's top process; load's too. */
  process?: Process;
  /** The one command, when there is one. */
  command?: string;
}

export function crossings(r: Reading, t: Thresholds): Crossing[] {
  const out: Crossing[] = [];
  const top = r.top[0];
  if (t.memoryFreeMin && r.memoryFree < atLeast(t.memoryFreeMin, r.memoryTotal)) {
    out.push({ kind: "memory", number: `${bytes(r.memoryFree)} free of ${bytes(r.memoryTotal)} (under ${amount(t.memoryFreeMin)})`, ...(top ? { process: top, ...(top.command ? { command: top.command } : {}) } : {}) });
  }
  if (t.loadMax !== undefined && r.load > t.loadMax) {
    out.push({ kind: "load", number: `load ${r.load} on ${r.cpus} cpus (over ${t.loadMax})`, ...(top ? { process: top, ...(top.command ? { command: top.command } : {}) } : {}) });
  }
  if (t.diskFreeMin && r.diskFree < atLeast(t.diskFreeMin, r.diskTotal)) {
    out.push({ kind: "disk", number: `${bytes(r.diskFree)} free of ${bytes(r.diskTotal)} on / (under ${amount(t.diskFreeMin)})` });
  }
  if (r.failedUnits.length) {
    const unit = r.failedUnits[0]!;
    out.push({ kind: "failed", number: `${r.failedUnits.length} failed ${r.failedUnits.length === 1 ? "unit" : "units"}: ${r.failedUnits.join(", ")}`, command: `systemctl --user restart ${unit}` });
  }
  return out;
}

export const amount = (a: Amount): string => "bytes" in a ? bytes(a.bytes) : `${Math.round(a.share * 100)}%`;

/** Bytes in words: 47.0G, 512M, 3.2K. */
export function bytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "?";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}G`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)}M`;
  if (n >= 1024) return `${Math.round(n / 1024)}K`;
  return `${n}B`;
}

export type Status = "ok" | "degraded" | "down";
const RANK: Record<Status, number> = { ok: 0, degraded: 1, down: 2 };
export const worst = (a: Status, b: Status): Status => (RANK[a] >= RANK[b] ? a : b);
export const statusOf = (value: string | undefined): Status => (value === "degraded" || value === "down" ? value : "ok");

/** A property value holds no `]` and no newline. */
export const value = (text: string): string => text.replace(/[\]\r\n]+/g, " ").trim();

/** The machines the page names: `[machines::float-2, float-box, laptop]`. */
export const machinesOf = (text: string | undefined): string[] => (text ?? "").split(",").map((m) => m.trim()).filter(Boolean);

/** A time as the page says it: 1:40 AM, in the host's own zone. */
export const clock = (iso: string): string => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** The day a time falls in, on the host's own calendar. */
export function dayOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
