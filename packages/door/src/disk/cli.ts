// `ep0ch disk`: what the disk keeper last saw (each filesystem, what's biggest and who reclaims it, the last sweep,
// what's open), and `ep0ch disk keep`, the run its timer makes (PIE-1787).
import { ageSince } from "@ep0ch/outline-core/age";
import { size } from "../setup/progress";
import { hhmm } from "../backup/alert";
import { ownerOf, percent } from "./keeper";
import { keep } from "./run";
import { diskSettings, diskStateDir, readDisk } from "./state";

type Env = Record<string, string | undefined>;
interface IO { out: (s: string) => void; err: (s: string) => void }

export const DISK_USAGE = "ep0ch disk [status] [--json] | ep0ch disk keep [--sweep] [--json]";

export function statusLines(env: Env, now = Date.now()): string[] {
  const s = readDisk(diskStateDir(diskSettings(env)));
  if (!s.samples.length) return ["The disk keeper hasn't looked yet: ep0ch disk keep looks now (its timer, ep0ch-disk.timer, every 15 minutes; ep0ch install --apply writes it where EP0CH_DISK_BOX names a storage box)"];
  const out: string[] = [];
  const mounts = [...new Set(s.samples.map(x => x.mount))];
  for (const m of mounts) {
    const x = s.samples.filter(y => y.mount === m).at(-1)!;
    out.push(`${m}: ${percent(x)}% full, ${size(x.avail)} free of ${size(x.size)} (looked ${ageSince(x.at, now, "ago")})`);
    const big = Object.entries(x.places ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
    for (const [place, bytes] of big) {
      const o = ownerOf(place);
      out.push(`  ${size(bytes).padStart(7)}  ${place} · ${o.owner}${o.moves ? `: ${o.how}` : o.fix ? ` · ${o.fix}` : ""}`);
    }
  }
  const sweep = s.sweeps.at(-1);
  out.push(sweep ? `last sweep ${hhmm(sweep.at)}: ${sweep.before}% → ${sweep.after}% (offload exit ${sweep.code}: ${sweep.said})` : "no sweep yet: the keeper sweeps when home's disk is past 75%, and offload-sweep.timer weekly");
  out.push(...(s.incidents.length ? s.incidents.map(i => `✗ ${i.title}: ${i.detail} · fix: ${i.fix}`) : ["nothing open"]));
  return out;
}

export async function diskCommand(args: readonly string[], io: IO = { out: console.log, err: console.error }, env: Env = process.env): Promise<number> {
  const sub = args[1] && !args[1].startsWith("-") ? args[1] : "status";
  const rest = args.slice(sub === args[1] ? 2 : 1).filter(a => a !== "--json" && !(sub === "keep" && a === "--sweep"));
  if (!["status", "keep"].includes(sub) || rest.length) { io.err(`ep0ch: ${DISK_USAGE}`); return 2; }
  const json = args.includes("--json");
  if (sub === "keep") {
    try {
      const s = await keep({ env, say: json ? undefined : io.out, sweep: args.includes("--sweep") });
      if (json) io.out(JSON.stringify({ incidents: s.incidents, sweep: s.sweeps.at(-1) ?? null, announced: s.justAnnounced.map(i => i.key) }));
      return 0;
    } catch (e) { io.err(`ep0ch disk keep: ${(e as Error).message}`); return 1; }
  }
  if (json) { io.out(JSON.stringify(readDisk(diskStateDir(diskSettings(env))))); return 0; }
  for (const l of statusLines(env)) io.out(l);
  return 0;
}
