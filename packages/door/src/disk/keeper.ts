// The disk keeper's decisions (PIE-1787), pure, so tests describe a disk's history instead of filling one. The keeper
// never deletes anything itself: it measures, runs the owner that reclaims (offload's sweep for cold Claude files), and
// for everything else names the owner and the command. What it found goes through the backup job's alert path
// (src/backup/alert.ts: alert.json, the status bar, `ep0ch doctor`, Herdr and ntfy), one announcement per incident and
// another only when it gets worse.
import type { Incident } from "../backup/alert";
import { hhmm } from "../backup/alert";
import { size } from "../setup/progress";

/** At this share full, the keeper runs the sweep (offload --sweep --yes). */
export const SWEEP_AT = 75;
/** At this share full, one alert; at the second, one more. */
export const ALERT_AT = 85;
export const WORSE_AT = 95;
/** A disk that would fill within this long at the last hour's rate is an incident at any share. */
export const FILL_WITHIN_MS = 12 * 3_600_000;
/** Samples kept: a day and a bit, so "the last day" always has its oldest end. */
export const KEEP_MS = 26 * 3_600_000;
/** journald's cap, the one command for the system journal (the user journal is in the same files: no user-level cap). */
export const JOURNALD_CAP = "sudo mkdir -p /etc/systemd/journald.conf.d && printf '[Journal]\\nSystemMaxUse=300M\\n' | sudo tee /etc/systemd/journald.conf.d/ep0ch.conf && sudo systemctl restart systemd-journald";

export interface Thresholds { sweepAt: number; alertAt: number; worseAt: number; fillWithinMs: number }
export const DEFAULTS: Thresholds = { sweepAt: SWEEP_AT, alertAt: ALERT_AT, worseAt: WORSE_AT, fillWithinMs: FILL_WITHIN_MS };

/** One filesystem as `df -Pk` says it, in bytes. */
export interface Fs { mount: string; size: number; used: number; avail: number }

/** `df -Pk <paths>`: one row per path given, in order (the same filesystem may come more than once). */
export function parseDf(out: string): Fs[] {
  const rows: Fs[] = [];
  for (const line of out.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 6) continue;
    const [sizeK, usedK, availK] = [cols[1], cols[2], cols[3]].map(Number) as [number, number, number];
    if (![sizeK, usedK, availK].every(Number.isFinite) || sizeK <= 0) continue;
    rows.push({ mount: cols.slice(5).join(" "), size: sizeK * 1024, used: usedK * 1024, avail: availK * 1024 });
  }
  return rows;
}

/** Used share as df says it (used over used plus available, rounded up). */
export const percent = (f: Pick<Fs, "used" | "avail">) => Math.ceil((100 * f.used) / Math.max(1, f.used + f.avail));

/** One look at one filesystem: its numbers, and the size of each place on it (bytes by path, `~` for home). */
export interface Sample { at: string; mount: string; size: number; used: number; avail: number; places?: Record<string, number> }

export interface SweepRecord {
  at: string; mount: string; code: number; before: number; after: number;
  /** What offload said, its last lines. */
  said: string;
}

/** What the keeper remembers (disk.json, beside alert.json). */
export interface DiskState {
  samples: Sample[];
  sweeps: SweepRecord[];
  /** The incidents now, as alert.json carries them. */
  incidents: Incident[];
  /** Each open incident's worst rank announced so far: another announcement only for a higher rank. */
  announced: Record<string, number>;
  checkedAt?: string;
}
export const emptyDisk = (): DiskState => ({ samples: [], sweeps: [], incidents: [], announced: {} });

/**
 * `du -x -k -d <depth> <root>` lines as places: each deepest directory listed, and a shallower one's own files as
 * `<dir> (files)` (its size less its listed children), so a growing log file in /var/log is named too.
 */
export function parsePlaces(out: string, root: string, depth: number, home: string): Record<string, number> {
  const sizes = new Map<string, number>();
  for (const line of out.split("\n")) {
    const m = /^(\d+)\s+(.+)$/.exec(line.trim());
    if (m) sizes.set(m[2]!.replace(/\/+$/, "") || "/", Number(m[1]) * 1024);
  }
  const level = (p: string) => (p === root ? 0 : p.slice(root.length).split("/").filter(Boolean).length);
  const out_: Record<string, number> = {};
  const name = (p: string) => (p === home ? "~" : p.startsWith(home + "/") ? `~${p.slice(home.length)}` : p);
  for (const [p, bytes] of sizes) {
    if (p !== root && !p.startsWith(root === "/" ? "/" : root + "/")) continue;
    const children = [...sizes.keys()].filter(c => c !== p && c.startsWith(p === "/" ? "/" : p + "/") && level(c) === level(p) + 1);
    if (level(p) >= depth || !children.length) { out_[name(p)] = bytes; continue; }
    const own = bytes - children.reduce((t, c) => t + sizes.get(c)!, 0);
    if (own > 0) out_[`${name(p)} (files)`] = own;
  }
  return out_;
}

/** Who reclaims a place: offload's sweep moves it, or its owner keeps it (with the command), or nobody does. */
export interface Owner { path: string; owner: string; moves: boolean; how: string; fix?: string }
export const OWNERS: readonly Owner[] = [
  { path: "~/.claude/projects", owner: "offload's sweep", moves: true, how: "session transcripts older than 7 days go to the storage box" },
  { path: "~/.claude/uploads", owner: "offload's sweep", moves: true, how: "files older than 30 days go to the storage box" },
  { path: "~/.claude/remote", owner: "offload's sweep", moves: true, how: "Claude Desktop builds unused for 30 days go (the newest stays; plugins stay)" },
  { path: "~/recon", owner: "offload's sweep", moves: true, how: "clones older than 14 days go to the storage box" },
  { path: "~/backups", owner: "install's retention", moves: false, how: "ep0ch install keeps the last EP0CH_INSTALL_KEEP runs per outline", fix: "ep0ch install --apply   (prunes old install backups first)" },
  { path: "~/.local/state/ep0ch-door/backup", owner: "the backup job's archive (PIE-1786)", moves: false, how: "the archive of every outline's change log", fix: "ep0ch backup status" },
  { path: "/var/log/journal", owner: "journald's cap", moves: false, how: "the system and user journals, capped by SystemMaxUse", fix: JOURNALD_CAP },
  { path: "/var/log", owner: "logrotate", moves: false, how: "syslog and friends, rotated weekly", fix: "sudo logrotate -f /etc/logrotate.conf" },
];
/** The owner of a place: the longest path it sits under, else nobody (the keeper reports it). */
export function ownerOf(place: string): Owner {
  const p = place.replace(/ \(files\)$/, "");
  const hit = [...OWNERS].sort((a, b) => b.path.length - a.path.length).find(o => p === o.path || p.startsWith(o.path + "/"));
  if (hit) return hit;
  // A folder's own files (beside the folders listed under it): the largest first, to see which one grew.
  if (place.endsWith(" (files)")) return { path: p, owner: "nobody", moves: false, how: "files directly in this folder", fix: `ls -lhS ${p} | head   (offload <file> moves one to the storage box, if it's cold)` };
  return { path: p, owner: "nobody", moves: false, how: "no part of ep0ch reclaims it", fix: `du -xh -d1 ${p} | sort -h | tail   (offload ${p} moves it to the storage box, if it's cold)` };
}

export interface Growth { place: string; bytes: number; owner: Owner }

/** What grew since the sample nearest `ago` before the newest, largest first: places that grew by more than `min`. */
export function growth(samples: readonly Sample[], mount: string, agoMs: number, min: number): Growth[] {
  const mine = samples.filter(s => s.mount === mount && s.places);
  const now = mine.at(-1);
  if (!now) return [];
  const t = Date.parse(now.at) - agoMs;
  const then = mine.filter(s => s !== now).reduce<Sample | null>((best, s) => !best || Math.abs(Date.parse(s.at) - t) < Math.abs(Date.parse(best.at) - t) ? s : best, null);
  if (!then) return [];
  return Object.entries(now.places!).map(([place, bytes]) => ({ place, bytes: bytes - (then.places![place] ?? 0), owner: ownerOf(place) }))
    .filter(g => g.bytes > min).sort((a, b) => b.bytes - a.bytes);
}

/** Bytes a filesystem gained per hour, from the sample nearest an hour before the newest (at least 20 minutes back). */
export function ratePerHour(samples: readonly Sample[], mount: string): number | null {
  const mine = samples.filter(s => s.mount === mount);
  const now = mine.at(-1);
  if (!now) return null;
  const t = Date.parse(now.at) - 3_600_000;
  const back = mine.filter(s => Date.parse(now.at) - Date.parse(s.at) >= 20 * 60_000);
  const then = back.reduce<Sample | null>((best, s) => !best || Math.abs(Date.parse(s.at) - t) < Math.abs(Date.parse(best.at) - t) ? s : best, null);
  if (!then) return null;
  return ((now.used - then.used) * 3_600_000) / (Date.parse(now.at) - Date.parse(then.at));
}

const said = (g: Growth) => `+${size(g.bytes)} ${g.place} (${g.owner.owner}${g.owner.moves ? ", which moves it" : g.owner.owner === "nobody" ? ": reported" : ", can't be moved"})`;
/** The fix an incident names: the biggest grower the sweep can't move, else what's big and who owns it. */
const fixFor = (grew: readonly Growth[]) => grew.find(g => !g.owner.moves)?.owner.fix ?? "ep0ch disk   (what's big on it, and who reclaims each)";

export interface DiskIncident extends Incident { rank: number }
const machineMount = (machine: string, mount: string) => `${machine}:${mount}`;

/** What's wrong with one filesystem now: full (85, then 95), filling fast, a sweep that failed. */
export function diskIncidents(o: { machine: string; box?: string; samples: readonly Sample[]; sweeps: readonly SweepRecord[]; mount: string; t: Thresholds; now: number }): DiskIncident[] {
  const out: DiskIncident[] = [];
  const latest = o.samples.filter(s => s.mount === o.mount).at(-1);
  if (!latest) return out;
  const pct = percent(latest), where = `${o.mount} on ${o.machine}`;
  const min = latest.size / 200;
  const day = growth(o.samples, o.mount, 24 * 3_600_000, min).slice(0, 3);
  const free = `${size(latest.avail)} free of ${size(latest.size)}`;
  const sweep = o.sweeps.filter(s => s.mount === o.mount).at(-1);
  const swept = sweep && o.now - Date.parse(sweep.at) < 24 * 3_600_000 ? `; the sweep at ${hhmm(sweep.at)} took it from ${sweep.before}% to ${sweep.after}%` : "";
  if (pct >= o.t.alertAt) {
    const worse = pct >= o.t.worseAt;
    out.push({ key: `disk:${machineMount(o.machine, o.mount)}:full`, rank: worse ? 2 : 1, since: latest.at,
      title: `${where} is ${pct}% full`,
      detail: `${where} is ${pct}% full (${free})${swept}; the last day: ${day.length ? day.map(said).join(", ") : "nothing grew by much"}`,
      fix: fixFor(day) });
  }
  const rate = ratePerHour(o.samples, o.mount);
  if (rate && rate > 0 && (latest.avail / rate) * 3_600_000 < o.t.fillWithinMs) {
    const hours = latest.avail / rate;
    const hour = growth(o.samples, o.mount, 3_600_000, min).slice(0, 3);
    out.push({ key: `disk:${machineMount(o.machine, o.mount)}:rate`, rank: 1, since: latest.at,
      title: `${where} fills in about ${hours < 1 ? `${Math.max(1, Math.round(hours * 60))} minutes` : `${Math.round(hours)} hours`}`,
      detail: `${where} grew ${size(rate)} in the last hour (${free}, ${pct}% full); growing: ${hour.length ? hour.map(said).join(", ") : "nothing the keeper measures (outside ~ and /var/log)"}`,
      fix: fixFor(hour) });
  }
  if (sweep && sweep.code !== 0) {
    const differs = sweep.code === 4;
    out.push({ key: `disk:${machineMount(o.machine, o.mount)}:sweep`, rank: differs ? 2 : 1, since: sweep.at,
      title: differs ? `the sweep on ${o.machine} found copies that differ` : `the sweep on ${o.machine} couldn't reach the storage box`,
      detail: `${differs ? "offload's copies on the storage box differ from the originals, so nothing was removed" : sweep.code === 3 ? "the storage box didn't answer, so nothing was moved" : `offload --sweep --yes failed (exit ${sweep.code})`} (${hhmm(sweep.at)}, ${sweep.before}% full): ${sweep.said}`,
      fix: differs ? "offload --sweep --yes --checksum   (copies them again, compared by content, then removes them here)"
        : `ssh ${o.box ?? "storagebox"} true   (says why it doesn't answer); the next run sweeps again` });
  }
  return out;
}

/** The incidents to announce: new ones, and open ones that got worse. Cleared ones are forgotten. */
export function escalate(prev: Record<string, number>, found: readonly DiskIncident[]): { announce: DiskIncident[]; announced: Record<string, number> } {
  const announce = found.filter(i => i.rank > (prev[i.key] ?? 0));
  return { announce, announced: Object.fromEntries(found.map(i => [i.key, Math.max(i.rank, prev[i.key] ?? 0)])) };
}

/** Whether the keeper sweeps now: the filesystem holding home is past the line. */
export const shouldSweep = (f: Pick<Fs, "used" | "avail">, t: Thresholds) => percent(f) >= t.sweepAt;

/** Keep the last KEEP_MS of samples and the last 50 sweeps. */
export function trimmed(s: DiskState, now: number): DiskState {
  return { ...s, samples: s.samples.filter(x => now - Date.parse(x.at) <= KEEP_MS), sweeps: s.sweeps.slice(-50) };
}

/** A threshold from the settings (`EP0CH_DISK_SWEEP_AT=60`), else the default. */
export function thresholds(env: Record<string, string | undefined>): Thresholds {
  const n = (k: string, d: number) => { const v = Number(env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
  return { sweepAt: n("EP0CH_DISK_SWEEP_AT", SWEEP_AT), alertAt: n("EP0CH_DISK_ALERT_AT", ALERT_AT), worseAt: n("EP0CH_DISK_WORSE_AT", WORSE_AT), fillWithinMs: n("EP0CH_DISK_FILL_HOURS", FILL_WITHIN_MS / 3_600_000) * 3_600_000 };
}
