// Who was queued over a second, a minute a line, from a host's log (PIE-1546). The check after a deploy:
//
//   ssh float-2 journalctl --user -u outliner-host --since -10min | bun scripts/host-queue-minutes.ts --check
//
// Prints each minute that had one (its `queued_minute` line, or counted from `slow_request` lines in a log from before
// they were written) and how many requests the log covers. --check exits 1 when there is one.
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { check: { type: "boolean" } } });

interface Minute { over1s: number; worstMs: number; who: string[] }
const lane = new Map<string, Minute>();
const counted = new Map<string, Map<string, { n: number; worst: number }>>();
let first = "", last = "", lines = 0;

for (const line of (await new Response(Bun.stdin.stream()).text()).split("\n")) {
  const at = line.indexOf('{"status"');
  if (at < 0) continue;
  let row: Record<string, any>;
  try { row = JSON.parse(line.slice(at)); } catch { continue; }
  lines += 1;
  // journalctl's `Nov 06 09:41:12` or `-o short-iso`'s `2026-11-06T09:41:12-05:00`: the minute as the log wrote it.
  const stamp = /^\S+T\d\d:\d\d/.exec(line)?.[0] ?? /^\w{3} \d\d \d\d:\d\d/.exec(line)?.[0] ?? "";
  first ||= stamp;
  last = stamp || last;
  if (row.status === "queued_minute") lane.set(row.minute, { over1s: row.over1s, worstMs: row.worstMs, who: row.who });
  if (row.status === "slow_request" && row.queuedMs >= 1000) {
    const rows = counted.get(stamp) ?? new Map();
    const key = `${row.who ?? "?"} × ${row.action}`, entry = rows.get(key) ?? { n: 0, worst: 0 };
    entry.n += 1;
    entry.worst = Math.max(entry.worst, row.queuedMs);
    rows.set(key, entry);
    counted.set(stamp, rows);
  }
}

// A log with `queued_minute` lines says it itself; `slow_request` lines stand in for the minutes without one.
const minutes = lane.size ? [...lane] : [...counted].map(([minute, rows]) => {
  const sorted = [...rows].sort((a, b) => b[1].n - a[1].n);
  return [minute, {
    over1s: sorted.reduce((sum, [, e]) => sum + e.n, 0), worstMs: Math.max(...sorted.map(([, e]) => e.worst)),
    who: sorted.slice(0, 12).map(([key, e]) => `${key} ${e.n} (worst ${e.worst} ms)`),
  }] as [string, Minute];
});
for (const [minute, row] of minutes) {
  console.log(`${minute}  ${row.over1s} queued over 1 s, worst ${row.worstMs} ms`);
  for (const who of row.who) console.log(`  ${who}`);
}
const total = minutes.reduce((sum, [, row]) => sum + row.over1s, 0);
console.log(`${first || "(no timing lines)"} to ${last}: ${lines} timing lines, ${total ? `${total} requests queued over 1 s in ${minutes.length} minutes` : "none queued over 1 s"}`);
if (values.check && total) process.exit(1);
