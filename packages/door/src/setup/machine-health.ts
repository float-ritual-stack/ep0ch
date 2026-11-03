// Doctor's "machine" group (PIE-1535): what the machine itself says about the work running on it, each with the command
// that looks closer or fixes it. Failed user units (systemd's own JSON), the nightly run on main (scripts/nightly-main's
// nightly.tsv), the test runs (scripts/box-test's box-test.tsv and its run folders) and the load. Read-only, like the
// rest of doctor: files are read and `systemctl --user --failed` asked; nothing is started or stopped. The tv channel
// `ep0ch-health` lists these rows with the rest of doctor's.
import { readdirSync, readFileSync } from "node:fs";
import { cpus, loadavg, userInfo } from "node:os";
import { join } from "node:path";
import type { Platform } from "./model";

type Env = Record<string, string | undefined>;
type Run = (cmd: string[], o?: { env?: Env; timeoutMs?: number }) => Promise<{ code: number; out: string; err: string }>;

/** One row of a tab-separated record file, split, with the file it came from. */
export interface LastRow { file: string; cols: string[] }

export interface MachineHealth {
  /** Failed systemd user units by name; null when systemd can't be asked (macOS, no user manager). */
  failed: string[] | null;
  /** nightly.tsv's newest row, or the file that would hold it. */
  nightly: LastRow | { file: string; none: true };
  /** box-test.tsv's newest row, and the box-test run folders there now (one each running run, on float-box). */
  boxTest: { last: LastRow | null; file: string; running: number; slots: number };
  load: { five: number; cpus: number };
  now: number;
}

const stateDir = (env: Env, home: string) => join(env.XDG_STATE_HOME || join(home, ".local/state"), "ep0ch");

function lastRow(file: string): LastRow | null {
  try {
    const line = readFileSync(file, "utf8").trimEnd().split("\n").at(-1);
    return line ? { file, cols: line.split("\t") } : null;
  } catch { return null; }
}

export async function gatherMachine(o: { platform: Platform; home: string; env: Env; run: Run }): Promise<MachineHealth> {
  let failed: string[] | null = null;
  if (o.platform === "linux") {
    const r = await o.run(["systemctl", "--user", "--failed", "--output=json", "--no-pager"], { env: o.env, timeoutMs: 5000 });
    try { if (r.code === 0) failed = (JSON.parse(r.out || "[]") as { unit: string }[]).map(u => u.unit); } catch { failed = null; }
  }
  const dir = stateDir(o.env, o.home);
  const nightlyFile = join(dir, "nightly/nightly.tsv");
  const boxFile = join(dir, "box-test.tsv");
  // box-test's run folders on float-box: /tmp/ep0ch-box-<user>-<id>, removed when the run ends (scripts/box-test).
  let running = 0;
  try { const prefix = `ep0ch-box-${userInfo().username}-`; running = readdirSync("/tmp").filter(n => n.startsWith(prefix)).length; } catch { /* no /tmp */ }
  return {
    failed,
    nightly: lastRow(nightlyFile) ?? { file: nightlyFile, none: true },
    boxTest: { last: lastRow(boxFile), file: boxFile, running, slots: Number(o.env.EP0CH_BOX_SLOTS) || 2 },
    load: { five: loadavg()[1] ?? 0, cpus: cpus().length || 1 },
    now: Date.now(),
  };
}

const ago = (now: number, iso: string) => {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const m = Math.round(ms / 60_000);
  return m < 90 ? `${m}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

export interface MachineCheck { name: string; status: "ok" | "behind" | "info"; detail: string; fix?: string }

/** The machine's rows for doctor: each says what it read and the command that looks closer or fixes it. */
export function machineChecks(m: MachineHealth): MachineCheck[] {
  const out: MachineCheck[] = [];
  if (m.failed) out.push(m.failed.length
    ? { name: "user units", status: "behind", detail: `${m.failed.length} failed: ${m.failed.join(", ")} · journalctl --user -u ${m.failed[0]} -n 50 says why`, fix: `systemctl --user restart ${m.failed.join(" ")}` }
    : { name: "user units", status: "ok", detail: "no failed systemd user units" });

  if ("none" in m.nightly) out.push({ name: "nightly", status: "info", detail: `no nightly run recorded here (${m.nightly.file}); scripts/nightly-main writes it, on float-box's ep0ch-nightly.timer` });
  else {
    const [at = "", sha = "", code = "", secs = "", red = "", log = ""] = m.nightly.cols;
    const old = m.now - Date.parse(at) > 36 * 3600_000;
    const said = `main ${sha} ${code === "0" ? "green" : `red (exit ${code}, ${red || "?"} red file${red === "1" ? "" : "s"})`} ${ago(m.now, at)}, ${secs}`;
    if (code !== "0") out.push({ name: "nightly", status: "behind", detail: `${said}; the red files are a ticket in pie's queue`, fix: `tail -n 80 ${log}` });
    else if (old) out.push({ name: "nightly", status: "behind", detail: `${said}: no run since`, fix: "systemctl --user status ep0ch-nightly.timer ep0ch-nightly.service" });
    else out.push({ name: "nightly", status: "ok", detail: said });
  }

  const b = m.boxTest;
  const runs = `${b.running} running of ${b.slots} slots`;
  if (!b.last) out.push({ name: "box-test", status: "info", detail: `${runs}; no run recorded (${b.file})` });
  else {
    const [at = "", sha = "", what = "", , secs = "", , code = "", target = ""] = b.last.cols;
    const full = b.running >= b.slots ? "; every slot taken: a run past the cap waits (ls -d /tmp/ep0ch-box-* lists them)" : "";
    out.push({ name: "box-test", status: "info", detail: `${runs}; last: ${what} at ${sha} on ${target} exit ${code} ${ago(m.now, at)}, ${secs}${full}` });
  }

  const busy = m.load.five > m.load.cpus;
  out.push({ name: "load", status: busy ? "behind" : "ok", detail: `${m.load.five.toFixed(2)} over 5 min on ${m.load.cpus} cpus${busy ? ": more runs than cpus; top -o %CPU shows what's running" : ""}`, ...(busy ? { fix: "ep0ch agent ls" } : {}) });
  return out;
}
