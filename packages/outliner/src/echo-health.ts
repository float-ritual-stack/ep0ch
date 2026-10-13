// Whether each outline's EchoNet tosser is running (PIE-798). A toss that moved nothing writes no toss log, so the
// heartbeat is the bulletin every toss writes beside the outline (`<outlines>/<name>/echonet/bulletin.json`, src/
// echonet-mail.ts): its age against the toss's schedule says the tosser is trying. `ep0ch doctor` and `ep0ch echo
// status` both read it from here. Files only: it asks no host anything.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface TossHealth {
  outline: string;
  /** When its last toss wrote the bulletin (ms since the epoch), or null when it never has. */
  lastToss: number | null;
  /** How often its schedule tosses (ms), from its copy of the extension; null when no interval says. */
  everyMs: number | null;
  /** ok: within twice the schedule; stale: older (or never), with the command that tosses now. */
  status: "ok" | "stale";
  /** "tossed 4 min ago (every 30m)", or what's wrong and since when. */
  detail: string;
  fix?: string;
}

/** "4 min", "2 h", "3 days": how long ago, said briefly. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}

/**
 * A toss's schedule as its copy of the extension declares it: `every` (`30m`, `90s`, `2h`) in ms, or null when it has
 * none (it tosses only when asked) or one no interval says (a cron): then no age is too old.
 */
function everyOf(manifest: string): { ms: number; text: string } | null {
  let schedule: { every?: string; cron?: string } | undefined;
  try {
    const actions = (JSON.parse(readFileSync(manifest, "utf8")) as { actions?: Array<{ id?: string; schedule?: { every?: string; cron?: string } }> }).actions ?? [];
    schedule = actions.find((action) => action.id === "toss")?.schedule;
  } catch { return null; }
  const match = /^([1-9]\d{0,4})([smh])$/.exec(schedule?.every ?? "");
  return match ? { ms: Number(match[1]) * { s: 1000, m: 60_000, h: 3_600_000 }[match[2] as "s" | "m" | "h"], text: schedule!.every! } : null;
}

/** Each outline in `outlines` with EchoNet in its own folder: when it last tossed, and whether that's too long ago. */
export function tossHealth(outlines: string, now = Date.now()): TossHealth[] {
  let names: string[] = [];
  try { names = readdirSync(outlines).filter((name) => !name.startsWith(".")).sort(); } catch { return []; }
  const out: TossHealth[] = [];
  for (const name of names) {
    const manifest = join(outlines, name, "extensions", "echonet", "extension.json");
    if (!existsSync(manifest)) continue;
    const every = everyOf(manifest);
    let lastToss: number | null = null;
    try { lastToss = statSync(join(outlines, name, "echonet", "bulletin.json")).mtimeMs; } catch { /* never tossed */ }
    const fix = `ep0ch echo toss --ws ${name}`;
    const everyMs = every?.ms ?? null;
    // No interval to hold it to (tossed only when asked, or on a cron): its age is said, never a warning.
    if (!every) {
      out.push({ outline: name, lastToss, everyMs, status: "ok", detail: lastToss === null ? "EchoNet is on with no interval schedule, and hasn't tossed yet" : `tossed ${ago(now - lastToss)} ago (no interval schedule)` });
      continue;
    }
    if (lastToss === null) {
      out.push({ outline: name, lastToss, everyMs, status: "stale", detail: `EchoNet is on, and it has never tossed (every ${every.text}): is its outline host running?`, fix });
      continue;
    }
    const age = now - lastToss;
    out.push(age <= 2 * every.ms
      ? { outline: name, lastToss, everyMs, status: "ok", detail: `tossed ${ago(age)} ago (every ${every.text})` }
      : { outline: name, lastToss, everyMs, status: "stale", detail: `last tossed ${ago(age)} ago, and it tosses every ${every.text}: its schedule isn't running (is its outline host?)`, fix });
  }
  return out;
}
