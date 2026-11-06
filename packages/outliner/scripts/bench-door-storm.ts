// A door under a storm of change events, alone (PIE-1606): the fairness bench's door on the same outline, with one writer
// at a steady rate and nothing else, so the door's own loop is all that's left to look at. About half a minute.
//
//   bun scripts/bench-door-storm.ts [--rate 20] [--seconds 20] [--check] [--profile <dir>] [--json <file>]
//
// Reported per phase: the door's loop (lag, paints, paint time, events heard) and what the person's reads and saves took
// through it. `--check` exits 1 when the person's p95 in the storm is 200 ms or over (the fairness bench's bar).
// Never a real outline: a temp dir, removed at the end.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fixturePaths, makeOutline } from "./host-bench/fixture";
import { Conn, quantile } from "./host-bench/wire";

const { values } = parseArgs({ options: { rate: { type: "string" }, seconds: { type: "string" }, check: { type: "boolean" }, profile: { type: "string" }, json: { type: "string" } } });
const rate = Number(values.rate ?? 20), seconds = Number(values.seconds ?? 20);
const outliner = resolve(join(import.meta.dir, ".."));
const root = mkdtempSync(join(process.env.EP0CH_BENCH_TMP || tmpdir(), "door-storm-"));
const outlines = join(root, "outlines"), socket = join(outlines, ".host", "host.sock"), OUTLINE = "bench";
const paths = fixturePaths(outlines, OUTLINE);
mkdirSync(paths.workspaceRoot, { recursive: true });
const fixture = makeOutline(paths.database, paths.workspaceRoot, "pie");

const env = { PATH: process.env.PATH ?? "", HOME: root, TMPDIR: root };
const host = Bun.spawn([process.execPath, join(outliner, "src/host-main.ts")], { cwd: outliner, stdin: "ignore", stdout: "ignore", stderr: "ignore", env: { ...env, EP0CH_OUTLINES: outlines } });
for (;;) { const c = new Conn(socket, OUTLINE); const a = await c.request({ action: "ping" }, 500); c.close(); if (!a.error) break; await Bun.sleep(50); }
const profile = values.profile ? ["--cpu-prof", "--cpu-prof-md", `--cpu-prof-dir=${resolve(values.profile)}`] : [];
const door = Bun.spawn([process.execPath, ...profile, join(outliner, "..", "door", "scripts", "bench-door-desk.ts"), "--socket", socket, "--outline", OUTLINE, "--hub", fixture.board, "--note", fixture.probe, "--query", "type=storm"], {
  cwd: join(outliner, "..", "door"), stdin: "pipe", stdout: "pipe", stderr: "inherit", env: { ...env, EP0CH_STATE: join(root, "door-state"), EP0CH_CONTROL: join(root, "door.sock"), EP0CH_DAEMON: "0" },
});
const phase = (name: string) => door.stdin.write(`phase ${name}\n`);
await Bun.sleep(5_000);
phase("idle");
await Bun.sleep(5_000);
phase("storm");
const writer = new Conn(socket, OUTLINE);
const parent = (await writer.request<{ id: string }>({ action: "create", text: "Storm [type::hub]", author: "agent", actorId: "bench-storm" })).result!.id;
for (let i = 0, start = performance.now(); i < rate * seconds; i++) {
  await writer.request({ action: "create", parentId: parent, text: `Storm ${i} [type::storm]\n\nA note written by the storm.`, author: "agent", actorId: "bench-storm" });
  const wait = start + (i + 1) * (1000 / rate) - performance.now();
  if (wait > 0) await Bun.sleep(wait);
}
writer.close();
phase("after");
await Bun.sleep(5_000);
phase("report");
door.stdin.write("report\n");
const out = await new Response(door.stdout).text();
const report = JSON.parse(out.trim().split("\n").at(-1)!) as { timed: Array<{ phase: string; action: string; ms: number; failed?: true }>; tiles: number; stale: number; loops: Record<string, { lagMs: number; lagP95: number; lagMax: number; paints: number; paintMs: number; paintMax: number; events: number }> };
door.kill(); host.kill("SIGTERM"); await host.exited;
const PERSON = new Set(["children", "update"]);
const rows = ["idle", "storm", "after"].map(name => {
  const list = report.timed.filter(t => t.phase === name && PERSON.has(t.action)).map(t => t.ms).sort((a, b) => a - b);
  return { phase: name, loop: report.loops[name], person: { n: list.length, p95: Math.round(quantile(list, 0.95)), max: Math.round(list.at(-1) ?? 0) } };
});
console.log(`phase   lag ms  lag p95  lag max  paints  paint ms  paint max  events   person n  p95  max`);
for (const r of rows) { const l = r.loop!; console.log(`${r.phase.padEnd(6)} ${String(l.lagMs).padStart(7)} ${String(l.lagP95).padStart(8)} ${String(l.lagMax).padStart(8)} ${String(l.paints).padStart(7)} ${String(l.paintMs).padStart(9)} ${String(l.paintMax).padStart(10)} ${String(l.events).padStart(7)} ${String(r.person.n).padStart(10)} ${String(r.person.p95).padStart(4)} ${String(r.person.max).padStart(4)}`); }
console.log(`query tiles: ${report.tiles - report.stale} of ${report.tiles} show what a fresh read gives`);
if (values.json) writeFileSync(values.json, JSON.stringify({ rows, stale: report.stale, tiles: report.tiles }, null, 2));
rmSync(root, { recursive: true, force: true });
process.exit(values.check && (rows[1]!.person.p95 >= 200 || report.stale) ? 1 : 0);
