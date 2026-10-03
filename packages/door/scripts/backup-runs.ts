// One note per backup run, for `::graph-uptime` with `source: backups` (src/figures/days.ts): a timer runs the backup
// through this script, which records how it went in an outline, through its outline host's socket, as an agent:
//
//   <source> backup <date> [type::backup-run] - [status::ok] - [date::2026-10-03] - [source::restic] - [took::4m 12s]
//
// under one note per outline, `Backup runs [type::backup-log]` (made the first time), or the note `--under` names.
// It never reads the backup's secrets or its repository: only the command's exit code and how long it took.
//
//   bun scripts/backup-runs.ts --ws pie --source restic -- ~/.local/bin/ep0ch-snapshot   (runs it; exits as it did)
//   bun scripts/backup-runs.ts --ws pie --source litestream --status degraded            (records a run told about)
import { boardFor } from "../src/notes-cli";
import type { Actor } from "../src/socket";

const USAGE = `bun scripts/backup-runs.ts [--ws <outline>] [--machine <host>] [--source <name>] [--under <id>]
                          (--status ok|degraded|down [--date YYYY-MM-DD] | -- <command> [args…])`;
const AGENT: Actor = { kind: "agent", id: "backup-runs" };
export const STATUSES = ["ok", "degraded", "down"] as const;

/** The note a run is: its title line, its properties between ` - ` as a header line writes them. */
export function runNote(run: { source: string; status: string; date: string; took?: string }): string {
  const chips = [`[type::backup-run]`, `[status::${run.status}]`, `[date::${run.date}]`, `[source::${run.source}]`, ...(run.took ? [`[took::${run.took}]`] : [])];
  return `${run.source} backup ${run.date} ${chips.join(" - ")}`;
}

/** `ms` as `4m 12s`. */
export const took = (ms: number) => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };

/** Today on this machine's clock, `YYYY-MM-DD`. */
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const dash = argv.indexOf("--");
  const flags = dash >= 0 ? argv.slice(0, dash) : argv, command = dash >= 0 ? argv.slice(dash + 1) : [];
  const value = (f: string) => { const at = flags.indexOf(f); return at >= 0 ? flags[at + 1] : undefined; };
  const source = value("--source") ?? "backup", date = value("--date") ?? localDate();
  let status = value("--status");
  /** The flags given, with `flag` set to `to` (added when it wasn't given), as a command to run. */
  const again = (flag: string, to: string) => {
    const at = flags.indexOf(flag);
    const next = at >= 0 ? flags.map((f, i) => (i === at + 1 ? to : f)) : [...flags, flag, to];
    return `bun scripts/backup-runs.ts ${next.join(" ")}`;
  };
  if (!command.length && !status) {
    console.error(`backup-runs: run the backup after -- (${`bun scripts/backup-runs.ts ${flags.join(" ")} -- ~/.local/bin/ep0ch-snapshot`.replace(/  +/g, " ")}), or say how a run went: ${again("--status", "ok")}\n  ${USAGE}`);
    process.exit(2);
  }
  if (status && !(STATUSES as readonly string[]).includes(status)) { console.error(`backup-runs: --status is ${STATUSES.join(", ")}, not ${status}: ${again("--status", "ok")}`); process.exit(2); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error(`backup-runs: --date is YYYY-MM-DD, not ${date}: ${again("--date", localDate())}`); process.exit(2); }

  let code = 0, ms: number | undefined;
  if (command.length) {
    const start = Date.now();
    code = Bun.spawnSync(command, { stdio: ["inherit", "inherit", "inherit"] }).exitCode ?? 1;
    ms = Date.now() - start;
    status ??= code === 0 ? "ok" : "down";
  }

  // The run is recorded after it ran: a backup never waits on the outline, and an outline that is down loses one note.
  const board = await boardFor(flags);
  if ("error" in board) {
    console.error(`backup-runs: ${board.error}; the run (${status}) wasn't recorded. Record it by hand: bun scripts/backup-runs.ts ${[...flags.filter((f, i) => f !== "--status" && flags[i - 1] !== "--status" && f !== "--date" && flags[i - 1] !== "--date"), "--status", status!, "--date", date].join(" ")}`);
    process.exit(code || 1);
  }
  try {
    let parent = value("--under") ?? null;
    if (!parent) {
      const logs = await board.byProp("type", "backup-log", 5);
      parent = (logs.find(m => m.parentId === null) ?? logs[0] ?? await board.createBlock(null, "Backup runs [type::backup-log]\nOne note per backup run (scripts/backup-runs.ts); `::graph-uptime` with `source: backups` draws them.", AGENT)).id;
    }
    const note = await board.createBlock(parent, runNote({ source, status: status!, date, ...(ms !== undefined ? { took: took(ms) } : {}) }), AGENT);
    console.error(`backup-runs: ${source} ${status} on ${date}, recorded as ((${note.id}))`);
  } catch (e) {
    console.error(`backup-runs: couldn't record the run (${status}): ${(e as Error).message}`);
    code ||= 1;
  } finally { board.close(); }
  process.exit(code);
}
