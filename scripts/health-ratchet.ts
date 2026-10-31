// Run at the repository root. --write records the first baseline or lowers it; --report [previous.json] [--json]
// compares with a previous report saved in a health note, otherwise the baseline. No type checking: one source read
// and a syntax walk, so comments, quoted examples and multiline expressions don't masquerade as new copies.
// Width candidates are syntactic: .length feeding a width/column/room expression or a padding repeat. This isn't
// type inference or a census of every possible spelling. Tests, declarations, generated bundles and vendors aren't
// source for this check. A site's fingerprint ignores whitespace and line numbers so moving it doesn't make it new.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const baselinePath = "scripts/health-baseline.json";
const cap = 2_000;
const owners = {
  "width-length": "the door's width helpers: packages/door/src/style.ts:168 (width), :258 (pad), :288 (drawEllipsized); packages/door/src/text.ts:147 (rowLines)",
  "pad-end": "the door's width helpers: packages/door/src/style.ts:258 (pad), :288 (drawEllipsized)",
  "line-offset-reduce": "outline-core's sourceLines in packages/outline-core/src/code-ranges.ts:16 (line offsets; no lineAt/offsetOf exports exist)",
  "heading-regex": "outline-core's headerLine/titleWords in packages/outline-core/src/header-line.ts:54 and :128",
  "host-ctx-cast": "the typed SurfaceHost.ctx in packages/door/src/surface/note.ts:180; extend its Ctx contract instead of casting it",
};
type Pattern = keyof typeof owners;
type Site = { file: string; line: number; key: string };
type Counts = Record<Pattern, { count: number; sites: string[] }>;
type Baseline = { revision: string | null; patterns: Counts; files: Record<string, number> };
type FileMetric = { file: string; lines: number; growth: number; commits: number };
type Report = {
  asOf: string; revision: string | null; comparedTo: string | null;
  over1000: number; over2000: number; over1000Delta: number; over2000Delta: number; files: FileMetric[];
  patterns: Record<Pattern, { count: number; delta: number }>;
  coChanges: { files: string[]; commits: number }[];
};
const patterns = Object.keys(owners) as Pattern[];

function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args]);
  if (result.exitCode !== 0) throw Error(result.stderr.toString().trim());
  return result.stdout.toString();
}

function sourceFile(file: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(file) && !/\.d\.ts$|(?:^|\/)(?:tests?|fixtures|vendor|node_modules|dist|out)\/|\.(?:test|spec)\.[jt]sx?$|(?:^|\/)link-grammar\.js$/.test(file);
}

function lineCount(text: string): number {
  return text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;
}

const widthName = (text: string) => /(?:^|_)(?:[a-z]?w|width\d*|cols?|columns?|room|space|padding)(?:_|$)/i
  .test(text.replace(/([a-z0-9])([A-Z])/g, "$1_$2"));
function namesWidth(node: ts.Node): boolean {
  if (ts.isIdentifier(node) && widthName(node.text)) return true;
  return ts.forEachChild(node, namesWidth) ?? false;
}

function widthUse(length: ts.PropertyAccessExpression): boolean {
  for (let node: ts.Node = length; node.parent; node = node.parent) {
    const parent = node.parent;
    if (ts.isBinaryExpression(parent) && namesWidth(parent.left === node ? parent.right : parent.left)) return true;
    if ((ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && namesWidth(parent.name)) return true;
    if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === "repeat") return true;
    if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === "rep" && parent.arguments[1] === node) return true;
    if (ts.isStatement(parent) || ts.isBlock(parent)) break;
  }
  return false;
}

function scan() {
  const files: Record<string, number> = {};
  const sites = Object.fromEntries(patterns.map(p => [p, []])) as Record<Pattern, Site[]>;
  const paths = [...new Set(git("ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0"))].filter(sourceFile).sort();
  for (const file of paths) {
    if (!existsSync(file)) continue; // Tracked deletions are still in ls-files until staged.
    const text = readFileSync(file, "utf8");
    files[file] = lineCount(text);
    const door = file.startsWith("packages/door/src/");
    const copies = /^packages\/(?:door\/src|outliner\/(?:src|extensions)|claude-mod\/hooks)\//.test(file);
    if (!copies) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const add = (pattern: Pattern, node: ts.Node) => {
      const at = node.getStart(source);
      let statement = node;
      while (statement.parent && !ts.isStatement(statement)) statement = statement.parent;
      const key = `${file}:${Bun.hash(statement.getText(source).replace(/\s+/g, "")).toString(16)}`;
      sites[pattern].push({ file, line: source.getLineAndCharacterOfPosition(at).line + 1, key });
    };
    const walk = (node: ts.Node) => {
      if (door && ts.isPropertyAccessExpression(node) && node.name.text === "length" && widthUse(node)) add("width-length", node);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.text;
        if (door && name === "padEnd") add("pad-end", node);
        if (name === "reduce" && /\.slice\(\s*0\s*,/.test(node.expression.expression.getText(source)) &&
          /\.length\s*\+\s*1\b/.test(node.arguments[0]?.getText(source) ?? "")) add("line-offset-reduce", node);
      }
      if (ts.isRegularExpressionLiteral(node) && node.text.startsWith("/^") && node.text.includes("#{1,6}")) add("heading-regex", node);
      if (door && ts.isAsExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.getText(source) === "host.ctx") add("host-ctx-cast", node);
      ts.forEachChild(node, walk);
    };
    walk(source);
  }
  return { files, sites };
}

function differences(current: ReturnType<typeof scan>, baseline: Baseline, lowering: boolean): string[] {
  const errors: string[] = [];
  for (const pattern of patterns) {
    const now = current.sites[pattern], was = baseline.patterns[pattern];
    if (now.length > was.count) {
      errors.push(`${pattern}: ${now.length} > baseline ${was.count} (+${now.length - was.count}). Use ${owners[pattern]}.`);
      const known = new Map<string, number>();
      for (const key of was.sites) known.set(key, (known.get(key) ?? 0) + 1);
      for (const site of now) {
        const remaining = known.get(site.key) ?? 0;
        if (remaining) known.set(site.key, remaining - 1);
        else errors.push(`  ${site.file}:${site.line} new ${pattern} site`);
      }
    } else if (now.length < was.count && !lowering) {
      errors.push(`${pattern}: ${now.length} < baseline ${was.count}; lower the baseline: bun scripts/health-ratchet.ts --write`);
    }
  }
  for (const file of new Set([...Object.keys(current.files), ...Object.keys(baseline.files)])) {
    const now = current.files[file] ?? 0, was = baseline.files[file] ?? cap;
    if (now > was) errors.push(`${file}:${was + 1}: ${now} lines > baseline ${was} (+${now - was}). Use the existing shared owner; inventory responsibilities under PIE-1376 before splitting.`);
    else if (baseline.files[file] !== undefined && now < was && !lowering) errors.push(`${file}: ${now} lines < baseline ${was}; lower the baseline: bun scripts/health-ratchet.ts --write`);
  }
  return errors;
}

// Git supplies the baseline's smaller files without storing a second full line-count inventory in the baseline.
function linesAt(revision: string | null): Record<string, number> {
  if (!revision) return {};
  const files = git("ls-tree", "-rz", "--name-only", revision).split("\0").filter(sourceFile);
  const result = Bun.spawnSync(["git", "cat-file", "--batch"], { stdin: Buffer.from(files.map(f => `${revision}:${f}\n`).join("")) });
  if (result.exitCode !== 0) throw Error(result.stderr.toString());
  const counts: Record<string, number> = {};
  let at = 0;
  for (const file of files) {
    const end = result.stdout.indexOf(10, at), header = result.stdout.subarray(at, end).toString();
    at = end + 1;
    if (header.endsWith(" missing")) continue;
    const size = Number(header.split(" ")[2]);
    counts[file] = lineCount(result.stdout.subarray(at, at + size).toString());
    at += size + 1;
  }
  return counts;
}

function report(current: ReturnType<typeof scan>, baseline: Baseline, revision: string | null, previous?: Report): Report {
  const before = previous ? Object.fromEntries(previous.files.map(f => [f.file, f.lines])) : { ...linesAt(baseline.revision), ...baseline.files };
  const commits = new Map<string, number>(), pairs = new Map<string, number>();
  if (revision) for (const commit of git("log", "--since=7.days", "--name-only", "--no-renames", "--format=%x00").split("\0")) {
    const files = [...new Set(commit.split("\n").filter(f => f in current.files))].sort();
    for (const [i, file] of files.entries()) {
      commits.set(file, (commits.get(file) ?? 0) + 1);
      for (const other of files.slice(i + 1)) {
        const key = `${file}\0${other}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  const files = Object.entries(current.files).map(([file, lines]) => ({ file, lines, growth: lines - (before[file] ?? 0), commits: commits.get(file) ?? 0 }));
  const over1000 = files.filter(f => f.lines > 1_000).length, over2000 = files.filter(f => f.lines > cap).length;
  return {
    asOf: new Date().toISOString(), revision, comparedTo: previous?.revision ?? baseline.revision,
    over1000, over2000, over1000Delta: over1000 - Object.values(before).filter(n => n > 1_000).length,
    over2000Delta: over2000 - Object.values(before).filter(n => n > cap).length, files,
    patterns: Object.fromEntries(patterns.map(p => [p, { count: current.sites[p].length, delta: current.sites[p].length - (previous?.patterns[p].count ?? baseline.patterns[p].count) }])) as Report["patterns"],
    coChanges: [...pairs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([pair, commits]) => ({ files: pair.split("\0"), commits })),
  };
}

const signed = (n: number) => n >= 0 ? `+${n}` : String(n);
function printReport(r: Report) {
  console.log(`Code health, ${r.asOf.slice(0, 10)}\nRevision: ${r.revision}\nCompared with: ${r.comparedTo}\nSource files over 1,000: ${r.over1000} (${signed(r.over1000Delta)}); over 2,000: ${r.over2000} (${signed(r.over2000Delta)})`);
  console.log("\nFiles over 1,000 lines (lines, growth, commits over 7 days):");
  for (const f of r.files.filter(f => f.lines > 1_000).sort((a, b) => b.lines - a.lines)) console.log(`${f.file}: ${f.lines}, ${signed(f.growth)}, ${f.commits} commits${f.lines > cap ? " [over 2,000]" : ""}`);
  console.log("\nChurn over 7 days (top 20; --json includes every source file):");
  for (const f of r.files.filter(f => f.commits).sort((a, b) => b.commits - a.commits || a.file.localeCompare(b.file)).slice(0, 20)) console.log(`${f.file}: ${f.commits} commits, ${f.lines} lines, growth ${signed(f.growth)}`);
  console.log("\nTop co-change pairs over 7 days:");
  for (const pair of r.coChanges) console.log(`${pair.commits}: ${pair.files.join(" + ")}`);
  console.log("\nRatchet counts (delta):");
  for (const p of patterns) console.log(`${p}: ${r.patterns[p].count} (${signed(r.patterns[p].delta)})`);
}

const args = process.argv.slice(2);
if (args.some(a => a.startsWith("--") && !["--write", "--report", "--json"].includes(a)) ||
  (args.includes("--write") && args.includes("--report")) || (args.includes("--json") && !args.includes("--report")) ||
  args.filter(a => !a.startsWith("--")).length > Number(args.includes("--report"))) {
  console.error("Usage: bun scripts/health-ratchet.ts [--write | --report [previous.json] [--json]]");
  process.exit(1);
}
process.chdir(git("rev-parse", "--show-toplevel").trim());
const baseline: Baseline | undefined = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : undefined;
const current = scan();
const head = Bun.spawnSync(["git", "rev-parse", "--verify", "HEAD"]);
const revision = head.exitCode === 0 ? head.stdout.toString().trim() : null;
if (args.includes("--write")) {
  const errors = baseline ? differences(current, baseline, true) : [];
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
  const next: Baseline = {
    revision,
    patterns: Object.fromEntries(patterns.map(p => [p, { count: current.sites[p].length, sites: current.sites[p].map(s => s.key) }])) as Counts,
    files: Object.fromEntries(Object.entries(current.files).filter(([, lines]) => lines > cap)),
  };
  writeFileSync(baselinePath, JSON.stringify(next, null, 2) + "\n");
  console.log(`Wrote ${baselinePath}`);
} else if (!baseline) {
  console.error(`Missing ${baselinePath}; create the first baseline: bun scripts/health-ratchet.ts --write`);
  process.exit(1);
} else if (args.includes("--report")) {
  const previous = args.find(a => !a.startsWith("--"));
  const result = report(current, baseline, revision, previous ? JSON.parse(readFileSync(previous, "utf8")) : undefined);
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else printReport(result);
} else {
  const errors = differences(current, baseline, false);
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
  console.log("Code health: all copy-pattern counts and file caps match their baselines.");
}
