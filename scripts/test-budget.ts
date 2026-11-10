// The test-time budget (PIE-1422): how long each package's tests and each test file may take, summed, so adding
// shards or `--parallel` can't hide growth. The budget is scripts/test-budget.json, and only Evan raises it (the
// repository's mod refuses an agent's change to it). The times come from the JUnit every box-test run writes: on the
// box, `times` turns each package's report into `test-time` lines in the run's output; here, `compare` reads those
// lines back out of the log and holds them to the budget. box-test prints the comparison after every run, and
// scripts/nightly-main turns it into the night's verdict: over budget is red, with the files that grew since the last
// green night; at 80% of a package's total, a warning line in the build log.
//
//   bun scripts/test-budget.ts times <package> <junit.xml>     the report's per-file seconds, as test-time lines
//   bun scripts/test-budget.ts compare --log <file> [--budget <file> | --budget-at <rev>] [--last <file>] [--markdown <file>] [--line <file>]
//        the comparison, printed (--markdown: as a pie request's body; --line: one line for the build log);
//        exit 0 within budget, 3 near it (80%), 4 over, 5 no test times in the log or no budget
//   bun scripts/test-budget.ts propose --log <file> [--budget <file>] [--write]
//        a budget at these times plus 25%, printed; --write puts it in the budget file itself (a temp file, renamed
//        once whole): Evan's raise, `! bun scripts/test-budget.ts propose --log <log> --write`
//
// A budget with `"estimated": true` was never measured on float-box: over it, the night warns (exit 0, "over the
// estimated test budget") and prints the measured budget this run would give, rather than going red on a guess.
// propose writes a measured one (no `estimated`), and from then on over is red.
//
// A file's time is its JUnit <testsuite> time: its tests and its hooks (a beforeAll that starts a scratch host counts).
// --last defaults to the nightly's last green run (<state>/ep0ch/nightly/last-green.tsv), so a box-test run and the
// nightly say the same thing.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** package → test file → seconds. */
export type Times = Map<string, Map<string, number>>;
export type PackageBudget = { total: number; file: number; files?: Record<string, number> };
export type Budget = { about?: string; estimated?: boolean; measured?: string; packages: Record<string, PackageBudget> };

export const NEAR = 0.8;
export const HEADROOM = 1.25;
/** A package's total never goes under this: a package whose tests take a second would otherwise go red on noise. */
export const MIN_TOTAL = 30;
export const BUDGET_PATH = "scripts/test-budget.json";
const TAG = "test-time";

/** Each test file's seconds in a Bun JUnit report: the time of each top-level <testsuite> (one per file). */
export function junitTimes(xml: string): Map<string, number> {
  const out = new Map<string, number>();
  let depth = 0;
  for (const m of xml.matchAll(/<(\/?)testsuite(\s[^>]*?)?(\/?)>/g)) {
    if (m[1]) { depth--; continue; }
    depth++;
    if (depth === 1) {
      const attrs = m[2] ?? "";
      const file = /\bfile="([^"]*)"/.exec(attrs)?.[1] ?? /\bname="([^"]*)"/.exec(attrs)?.[1];
      const time = Number(/\btime="([^"]*)"/.exec(attrs)?.[1]);
      if (file && Number.isFinite(time)) out.set(file, (out.get(file) ?? 0) + time);
    }
    if (m[3]) depth--;
  }
  return out;
}

/** The test-time lines for one package's report: `test-time<TAB>package<TAB>file<TAB>seconds`. */
export function timeLines(pkg: string, times: Map<string, number>): string {
  return [...times].map(([file, s]) => `${TAG}\t${pkg}\t${file}\t${s.toFixed(3)}`).join("\n");
}

/** The test-time lines in a log (or a saved last-green file), whatever else is around them; a later line for a file wins. */
export function timesOf(text: string): Times {
  const out: Times = new Map();
  for (const line of text.split("\n")) {
    const [tag, pkg, file, secs] = line.replace(/\r$/, "").split("\t");
    if (tag !== TAG || !pkg || !file || secs === undefined || !Number.isFinite(Number(secs))) continue;
    if (!out.has(pkg)) out.set(pkg, new Map());
    out.get(pkg)!.set(file, Number(secs));
  }
  return out;
}

export type PackageRow = { pkg: string; seconds: number; budget: number | null; share: number | null };
export type FileRow = { pkg: string; file: string; seconds: number; budget: number };
export type GrowthRow = { pkg: string; file: string; seconds: number; was: number | null; budget: number };
export type Verdict = {
  /** estimated: over a budget whose numbers were never measured, a warning and no red. */
  status: "ok" | "near" | "over" | "estimated" | "none";
  packages: PackageRow[];
  /** Files past their own budget. */
  over: FileRow[];
  /** Files that took longer than on the last green night (null `was`: new since), most growth first. */
  grew: GrowthRow[];
  hasLast: boolean;
};

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
export const fileBudget = (b: PackageBudget, file: string) => b.files?.[file] ?? b.file;

/** The run's times held to the budget, and against the last green night's when there is one. */
export function compare(budget: Budget, now: Times, last?: Times): Verdict {
  const packages: PackageRow[] = [];
  const over: FileRow[] = [];
  const grew: GrowthRow[] = [];
  let status: Verdict["status"] = now.size ? "ok" : "none";
  const worse = (s: Verdict["status"]) => { if (s === "over" || (s === "near" && status === "ok")) status = s; };
  for (const [pkg, files] of [...now].sort(([a], [b]) => a.localeCompare(b))) {
    const b = budget.packages[pkg];
    const seconds = sum(files);
    packages.push({ pkg, seconds, budget: b?.total ?? null, share: b ? seconds / b.total : null });
    if (!b) continue;
    if (seconds > b.total) worse("over");
    else if (seconds >= NEAR * b.total) worse("near");
    const before = last?.get(pkg);
    for (const [file, s] of files) {
      const fb = fileBudget(b, file);
      if (s > fb) { over.push({ pkg, file, seconds: s, budget: fb }); worse("over"); }
      if (!last) continue;
      const was = before?.get(file) ?? null;
      if (was === null || s > was) grew.push({ pkg, file, seconds: s, was, budget: fb });
    }
  }
  over.sort((a, b) => b.seconds - b.budget - (a.seconds - a.budget));
  grew.sort((a, b) => b.seconds - (b.was ?? 0) - (a.seconds - (a.was ?? 0)));
  const said = status as Verdict["status"];
  return { status: said === "over" && budget.estimated ? "estimated" : said, packages, over, grew, hasLast: !!last };
}

const s = (n: number) => n >= 120 ? `${(n / 60).toFixed(1)} min` : `${n.toFixed(1)} s`;
const pct = (n: number | null) => n === null ? "no budget" : `${Math.round(n * 100)}%`;
const HEAD = {
  ok: "within test budget", near: "near test budget (80%): watch it", over: "over test budget: investigate",
  estimated: "over the estimated test budget: no ticket, its numbers were never measured on float-box", none: "no test times in this run",
} as const;
const RAISE = "`! bun scripts/test-budget.ts propose --log <this log> --write`";
const GREW_SHOWN = 15;

/** The comparison as text, for a terminal and the run's log. */
export function render(v: Verdict, lastLabel = "the last green night", proposal?: Budget): string {
  const out = [`test-budget: ${HEAD[v.status]}`];
  if (v.status === "none") return `${out[0]} (packages without JUnit, or a commit from before PIE-1422)`;
  for (const p of v.packages) out.push(`  ${p.pkg.padEnd(13)} ${s(p.seconds).padStart(9)} of ${p.budget === null ? "—" : s(p.budget)} (${pct(p.share)})`);
  if (v.over.length) {
    out.push("  over their own budget:");
    for (const f of v.over) out.push(`    ${f.pkg}/${f.file}  ${s(f.seconds)} of ${s(f.budget)}`);
  }
  if (v.status !== "ok") {
    if (!v.hasLast) out.push(`  files that grew: no green night recorded to compare with`);
    else if (!v.grew.length) out.push(`  no file grew since ${lastLabel}`);
    else {
      out.push(`  grew since ${lastLabel}:`);
      for (const g of v.grew.slice(0, GREW_SHOWN)) out.push(`    ${g.pkg}/${g.file}  ${g.was === null ? "new" : s(g.was)} → ${s(g.seconds)} (+${s(g.seconds - (g.was ?? 0))})`);
      if (v.grew.length > GREW_SHOWN) out.push(`    and ${v.grew.length - GREW_SHOWN} more`);
    }
  }
  if (v.status === "estimated" && proposal) {
    const own = Object.values(proposal.packages).reduce((n, b) => n + Object.keys(b.files ?? {}).length, 0);
    out.push(`  a measured budget from this run: ${Object.entries(proposal.packages).filter(([p]) => v.packages.some(r => r.pkg === p)).map(([p, b]) => `${p} ${b.total} s`).join(", ")}, ${own} file${own === 1 ? "" : "s"} of ${own === 1 ? "its" : "their"} own (${RAISE} writes it)`);
  }
  if (v.status === "over" || v.status === "near") out.push(`  the budget is ${BUDGET_PATH}; only Evan raises it (${RAISE})`);
  return out.join("\n");
}

/** One line for a build log: each package's share of its budget, the fullest first. */
export function summary(v: Verdict): string {
  const rows = v.packages.filter(p => p.share !== null).sort((a, b) => b.share! - a.share!);
  return `${HEAD[v.status]}: ${rows.map(p => `${p.pkg} ${pct(p.share)} of ${s(p.budget!)}`).join(", ")}${v.over.length ? `; ${v.over.length} file${v.over.length === 1 ? "" : "s"} over their own` : ""}`;
}

/** The same, as the Blockdown of a pie request: tables, the files that grew first. */
export function markdown(v: Verdict, lastLabel = "the last green night", log = ""): string {
  const out: string[] = [];
  out.push(`## Files that grew since ${lastLabel}`);
  if (!v.hasLast) out.push("- No green night is recorded to compare with: the files over their own budget are below.");
  else if (!v.grew.length) out.push("- None: the time is spread over files that each stayed level.");
  else {
    out.push("| file | last green | now | grew |", "|---|---|---|---|");
    for (const g of v.grew.slice(0, 25)) out.push(`| \`${g.pkg}/${g.file}\` | ${g.was === null ? "new" : s(g.was)} | ${s(g.seconds)} | +${s(g.seconds - (g.was ?? 0))} |`);
  }
  out.push("", "## Packages", "| package | summed test time | budget | share |", "|---|---|---|---|");
  for (const p of v.packages) out.push(`| ${p.pkg} | ${s(p.seconds)} | ${p.budget === null ? "—" : s(p.budget)} | ${pct(p.share)} |`);
  if (v.over.length) {
    out.push("", "## Files over their own budget", "| file | now | budget |", "|---|---|---|");
    for (const f of v.over) out.push(`| \`${f.pkg}/${f.file}\` | ${s(f.seconds)} | ${s(f.budget)} |`);
  }
  out.push("", "## Done when", "- The files that grew are back near their last green time, fixed at the cause (the merge that slowed them), or Evan raises the budget in `scripts/test-budget.json`.");
  if (log) out.push(`- The run's log: \`${log}\`.`);
  return out.join("\n");
}

/** A budget at these times plus 25%: each package's total (at least MIN_TOTAL), and a file of its own for each file past the package's default. */
export function propose(now: Times, current: Budget | null, measured: string): Budget {
  const packages: Record<string, PackageBudget> = { ...(current?.packages ?? {}) };
  for (const [pkg, files] of now) {
    const file = current?.packages[pkg]?.file ?? 60;
    const own: Record<string, number> = {};
    for (const [f, secs] of [...files].sort(([a], [b]) => a.localeCompare(b))) if (secs * HEADROOM > file) own[f] = Math.ceil(secs * HEADROOM);
    packages[pkg] = { total: Math.max(MIN_TOTAL, Math.ceil(sum(files) * HEADROOM)), file, ...(Object.keys(own).length ? { files: own } : {}) };
  }
  return { ...(current?.about ? { about: current.about } : {}), measured, packages };
}

function lastGreenPath(): string {
  return join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "ep0ch/nightly/last-green.tsv");
}

/** A saved last-green file's label: its first line, `# <day> <sha>`. */
function labelOf(text: string): string {
  const m = /^# (.+)$/m.exec(text);
  return m ? `the last green night (${m[1]!.trim()})` : "the last green night";
}

function readBudget(args: Map<string, string>, root: string): Budget | null {
  const at = args.get("--budget-at");
  if (at) {
    const r = Bun.spawnSync(["git", "-C", root, "show", `${at}:${BUDGET_PATH}`], { stdout: "pipe", stderr: "ignore" });
    return r.exitCode === 0 ? JSON.parse(r.stdout.toString()) as Budget : null;
  }
  const path = args.get("--budget") ?? join(root, BUDGET_PATH);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Budget : null;
}

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  const root = resolve(import.meta.dir, "..");
  if (cmd === "times") {
    const [pkg, path] = rest;
    if (!pkg || !path) { console.error("usage: bun scripts/test-budget.ts times <package> <junit.xml>"); return 2; }
    if (!existsSync(path)) { console.error(`test-budget: no JUnit report at ${path} (the package's tests didn't get far enough to write one)`); return 0; }
    const lines = timeLines(pkg, junitTimes(readFileSync(path, "utf8")));
    if (lines) console.log(lines);
    return 0;
  }
  const args = new Map<string, string>();
  const write = rest.includes("--write");
  const pairs = rest.filter(a => a !== "--write");
  for (let i = 0; i < pairs.length; i += 2) args.set(pairs[i]!, pairs[i + 1] ?? "");
  const logPath = args.get("--log");
  if ((cmd !== "compare" && cmd !== "propose") || !logPath) {
    console.error("usage: bun scripts/test-budget.ts compare --log <file> [--budget <file> | --budget-at <rev>] [--last <file>] [--markdown <file>] [--line <file>]\n       bun scripts/test-budget.ts propose --log <file> [--budget <file>] [--write]");
    return 2;
  }
  if (!existsSync(logPath)) { console.error(`test-budget: no log at ${logPath}`); return 2; }
  const now = timesOf(readFileSync(logPath, "utf8"));
  const budget = readBudget(args, root);
  const proposed = () => propose(now, budget, `${new Date().toISOString().slice(0, 10)}, from ${logPath}, plus 25%`);
  if (cmd === "propose") {
    const text = `${JSON.stringify(proposed(), null, 2)}\n`;
    if (!write) { process.stdout.write(text); return 0; }
    if (!now.size) { console.error(`test-budget: no test times in ${logPath}, so nothing to write`); return 5; }
    // Whole or not at all: a temp file beside it, renamed over it.
    const path = args.get("--budget") ?? join(root, BUDGET_PATH);
    writeFileSync(`${path}.tmp`, text);
    renameSync(`${path}.tmp`, path);
    console.log(`test-budget: wrote ${path} from ${logPath}`);
    return 0;
  }
  if (!budget) { console.log(`test-budget: no budget to compare with (${args.get("--budget-at") ? `${BUDGET_PATH} at ${args.get("--budget-at")}` : args.get("--budget") ?? BUDGET_PATH})`); return 5; }
  const lastPath = args.get("--last") ?? lastGreenPath();
  const lastText = existsSync(lastPath) ? readFileSync(lastPath, "utf8") : null;
  const last = lastText === null ? undefined : timesOf(lastText);
  const v = compare(budget, now, last);
  const label = lastText === null ? undefined : labelOf(lastText);
  console.log(render(v, label, v.status === "estimated" ? proposed() : undefined));
  const md = args.get("--markdown");
  if (md) writeFileSync(md, markdown(v, label, logPath));
  const line = args.get("--line");
  if (line) writeFileSync(line, summary(v));
  return { ok: 0, near: 3, over: 4, estimated: 0, none: 5 }[v.status];
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
