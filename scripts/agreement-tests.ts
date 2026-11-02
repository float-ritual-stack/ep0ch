// Runs the agreement tests scripts/agreement-tests.txt lists (PIE-1504): every `bun run check` does, so a doc, a key
// row or a package boundary that no longer agrees with the code is red in the builder's gate, not found by hand on
// main. Each line is a test file from the repository root, with an optional `-t <regex>` (only the tests whose names
// match). Files without a filter run in one `bun test` per package; each filtered line runs alone. Every run has
// EP0CH_TEST_HOST_FREE=1: a listed file that starts a host or a process fails (scripts/host-free-guard.ts, loaded by
// the packages' test preloads). Prints each run's seconds and the total; exits with the first failing run's code.
//   bun scripts/agreement-tests.ts [--list <file>] [--quiet]
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const listAt = args.includes("--list") ? args[args.indexOf("--list") + 1] : "scripts/agreement-tests.txt";
const quiet = args.includes("--quiet");
if (!listAt) { console.error("agreement-tests: --list takes a file"); process.exit(2); }

export type Entry = { file: string; filter?: string };
export const parseList = (text: string): Entry[] => text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(line => {
  const m = /^(\S+)(?:\s+-t\s+(.+))?$/.exec(line);
  if (!m) throw new Error(`agreement-tests: a line is a file, then an optional -t <regex>: ${line}`);
  return m[2] ? { file: m[1]!, filter: m[2] } : { file: m[1]! };
});

/**
 * The bun test runs the list asks for: one for every unfiltered file, one per filtered line. Each runs from the
 * repository root, whose bunfig loads every package's test preload (scripts/test-preload.ts) and so the guard.
 */
export type Run = { files: string[]; filter?: string };
export const runsOf = (entries: Entry[]): Run[] => {
  const plain = entries.filter(e => !e.filter).map(e => e.file);
  const runs: Run[] = plain.length ? [{ files: plain }] : [];
  for (const e of entries) if (e.filter) runs.push({ files: [e.file], filter: e.filter });
  return runs;
};

if (import.meta.main) {
  const entries = parseList(readFileSync(resolve(root, listAt), "utf8"));
  const missing = entries.filter(e => !existsSync(resolve(root, e.file)));
  if (missing.length) { console.error(`agreement-tests: not found: ${missing.map(e => e.file).join(", ")} (${listAt})`); process.exit(2); }
  const started = Date.now();
  let code = 0;
  for (const run of runsOf(entries)) {
    const t0 = Date.now();
    const cmd = ["bun", "test", ...run.files, ...(run.filter ? ["-t", run.filter] : [])];
    const r = Bun.spawnSync(cmd, { cwd: root, env: { ...process.env, EP0CH_TEST_HOST_FREE: "1", EP0CH_TEST_FILE: run.files.join(" ") }, stdout: "pipe", stderr: "pipe" });
    const out = r.stdout.toString() + r.stderr.toString();
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    const count = (what: string) => Number(new RegExp(`^\\s*(\\d+) ${what}$`, "m").exec(plain)?.[1] ?? 0);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const label = `${run.files.join(" ")}${run.filter ? ` -t "${run.filter}"` : ""}`;
    if (r.exitCode === 0) { if (!quiet) console.log(`✓ ${label} · ${count("pass")} pass · ${secs}s`); }
    else {
      code ||= r.exitCode || 1;
      console.log(`✗ ${label} · ${count("fail")} fail · ${secs}s`);
      console.log(plain.split("\n").filter(l => /^(error|✗|\(fail\))|Error:|agreement test/.test(l)).slice(0, 12).map(l => `  ${l}`).join("\n"));
    }
  }
  const total = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${code === 0 ? "agreement tests green" : "agreement tests red"} · ${total}s (${listAt})`);
  process.exit(code);
}
