// Runs every Herdr console scenario, one at a time, with each variant it takes (`--composed`, `--forwarded`, `--held`), and
// prints a row per run: name, variant, exit code, seconds, and the log. Exits 1 when any run is red (PIE-1698).
//
//   scripts/agent-env <name> --test -- bun test/e2e/run-all.ts [scenario…]      (from packages/outliner)
//
// goto-jev asks a live Jev, so it runs only with TYPESAFE_API_KEY set (`with-secrets typesafe -- …`) and says so.
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const here = import.meta.dir;
const HELPERS = new Set(["herdr-runner", "service-forwarder", "herdr-registry-fault", "roadmap-agent-session", "run-all"]);
const asked = process.argv.slice(2);
const names = (asked.length ? asked : readdirSync(here).filter(file => file.endsWith(".ts")).map(file => basename(file, ".ts")))
  .filter(name => !HELPERS.has(name)).sort();
const logs = mkdtempSync(join(tmpdir(), "herdr-e2e-"));
const rows: string[] = [];
let red = 0;
for (const name of names) {
  const source = readFileSync(join(here, `${name}.ts`), "utf8");
  const variants = ["", ...["--composed", "--forwarded", "--held"].filter(flag => source.includes(`"${flag}"`) || source.includes(`'${flag}'`))];
  for (const variant of variants) {
    const label = `${name}${variant ? ` ${variant}` : ""}`;
    if (name === "goto-jev" && !process.env.TYPESAFE_API_KEY) {
      rows.push(`${name}\t${variant || "plain"}\tskipped\t0\tneeds TYPESAFE_API_KEY`);
      console.log(`- ${label}: skipped, needs TYPESAFE_API_KEY`);
      continue;
    }
    const log = join(logs, `${name}${variant}-${rows.length + 1}.log`);
    const started = performance.now();
    const run = Bun.spawnSync(["timeout", "600", process.execPath, "run", join(here, `${name}.ts`), ...(variant ? [variant] : [])],
      { cwd: join(here, "..", ".."), env: process.env, stdout: "pipe", stderr: "pipe" });
    writeFileSync(log, `${run.stdout.toString()}${run.stderr.toString()}`);
    const seconds = Math.round((performance.now() - started) / 1000);
    if (run.exitCode !== 0) red += 1;
    rows.push(`${name}\t${variant || "plain"}\t${run.exitCode}\t${seconds}\t${log}`);
    console.log(`${run.exitCode === 0 ? "✓" : "✗"} ${label} · ${seconds}s${run.exitCode === 0 ? "" : ` · ${log}`}`);
  }
}
writeFileSync(join(logs, "results.tsv"), `${rows.join("\n")}\n`);
console.log(`${rows.length} runs, ${red} red · ${join(logs, "results.tsv")}`);
process.exitCode = red ? 1 : 0;
