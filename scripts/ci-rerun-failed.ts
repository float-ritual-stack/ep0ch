#!/usr/bin/env bun
// After a CI test run that failed: each file with a failed test is run again alone, and the step summary says, test
// by test, whether it failed again (most likely a real failure) or passed alone (a flake: it fails only beside the
// other files, under load). The run stays failed either way: this says which kind of red it is, so a flake is seen
// and fixed instead of re-run until it's green. The rerun's own results are not uploaded as the run's.
//
//   bun scripts/ci-rerun-failed.ts <junit.xml> [<the package's folder, from the repository's root>]
//     run from the package's folder, with the environment its tests ran in
//
// Writes $GITHUB_STEP_SUMMARY (else stdout) and a GitHub annotation per test, each file's as soon as it has run
// again (a job that runs out of time keeps what was said); always exits 0.
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** All the reruns together get this long (the job's own limit is near): a file not reached is said not run again. */
const BUDGET_MS = 4 * 60_000;

interface Failed { file: string; name: string; kind: string; message: string }
type Outcome = "passed" | "failed" | "skipped";

const unescape = (s: string) => s.replace(/&#10;/g, "\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attr = (tag: string, name: string) => unescape(tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? "");

/** Every test case of a Bun JUnit report: file, `describe > name`, how it went, and a failure's type and first line. */
export function cases(xml: string): (Failed & { outcome: Outcome })[] {
  const out: (Failed & { outcome: Outcome })[] = [];
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const tag = m[1]!, body = m[3] ?? "", group = attr(tag, "classname");
    const failure = body.match(/<(?:failure|error)\b([^>]*)/);
    out.push({
      file: attr(tag, "file"),
      name: [group, attr(tag, "name")].filter(Boolean).join(" > "),
      outcome: failure ? "failed" : /<skipped\b/.test(body) ? "skipped" : "passed",
      kind: failure ? attr(failure[1]!, "type") : "",
      message: failure ? attr(failure[1]!, "message").split("\n").find(l => l.trim())?.trim() ?? "" : "",
    });
  }
  return out;
}

if (import.meta.main) {
  const report = process.argv[2], at = process.argv[3] ? `${process.argv[3].replace(/\/$/, "")}/` : "";
  const summary = (s: string) => (process.env.GITHUB_STEP_SUMMARY ? appendFileSync(process.env.GITHUB_STEP_SUMMARY, s) : process.stdout.write(s));
  if (!report || !existsSync(report)) {
    summary(`No test report at ${report ?? "(none given)"} (a run that hung and was stopped writes none): nothing to run again.\n`);
    process.exit(0);
  }
  const all = cases(readFileSync(report, "utf8")).filter(c => c.outcome === "failed");
  // A worker that crashed or was stopped (a hung run, ended by the workflow) is no test to run again: it's said once.
  const crashed = all.filter(c => !c.file || c.name.includes("(worker crashed)"));
  if (crashed.length) summary(`${crashed.length} test worker${crashed.length === 1 ? "" : "s"} crashed or ${crashed.length === 1 ? "was" : "were"} stopped before reporting (a hung run is stopped at 12 minutes: its report is in the log above).\n\n`);
  const failed = all.filter(c => !crashed.includes(c));
  if (!failed.length) { summary("The run failed with no failed test in its report (an error between tests, or a crash): nothing to run again.\n"); process.exit(0); }
  const tmp = mkdtempSync(join(tmpdir(), "ci-rerun-"));
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160);
  const line = (s: string) => s.replace(/[\r\n]+/g, " ");
  summary([
    `### Failed tests, each file run again alone`, ``,
    `A test that passed alone fails only beside the other files (load, timing, a shared resource): a flake to fix, not to re-run.`, ``,
    `| test | file | failure | alone |`, `| --- | --- | --- | --- |`, ``,
  ].join("\n"));
  const end = Date.now() + BUDGET_MS;
  for (const [i, file] of [...new Set(failed.map(f => f.file))].entries()) {
    const left = end - Date.now();
    /** This file's tests as they went alone; null when it wasn't run again or didn't finish. */
    let alone: Map<string, Outcome> | null = null;
    if (left > 10_000) {
      const out = join(tmp, `${i}.xml`);
      const r = Bun.spawnSync(["bun", "test", `./${file}`, "--reporter=junit", `--reporter-outfile=${out}`], { stdout: "ignore", stderr: "ignore", timeout: left });
      if (existsSync(out) && r.exitCode !== null) alone = new Map(cases(readFileSync(out, "utf8")).map(c => [c.name, c.outcome]));
    }
    for (const f of failed.filter(f => f.file === file)) {
      const o = alone?.get(f.name);
      // Only a test seen to pass alone is called a flake: one missing from the rerun, or skipped there, says nothing.
      const verdict = !alone ? "not run again (no time left, or it didn't finish)" : o === "passed" ? "passed alone: a flake" : o === "failed" ? "failed again alone" : `not seen alone (${o ?? "missing from the rerun"})`;
      summary(`| ${cell(f.name)} | ${cell(f.file)} | ${cell(`${f.kind}: ${f.message}`)} | ${verdict} |\n`);
      const flake = o === "passed";
      // An annotation's text is one line: GitHub ends it at a newline.
      console.log(`::${flake ? "warning" : "error"} file=${at}${f.file},title=${flake ? "Flaky test" : "Failed test"}::${line(f.name)} (${verdict}): ${line(f.message)}`);
    }
  }
}
