import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../../../scripts/health-ratchet.ts");
const scratch: string[] = [];
const file = "packages/door/src/drawing.ts";
const original = readFileSync(resolve(import.meta.dir, "../src/text.ts"), "utf8");

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "health-ratchet-"));
  scratch.push(dir);
  mkdirSync(join(dir, "packages/door/src"), { recursive: true });
  mkdirSync(join(dir, "scripts"));
  git(dir, "init", "-q");
  return dir;
}

function git(dir: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd: dir });
  if (result.exitCode !== 0) throw Error(result.stderr.toString());
}

function run(dir: string, ...args: string[]) {
  const result = Bun.spawnSync([process.execPath, script, ...args], { cwd: dir });
  return { code: result.exitCode, text: result.stdout.toString() + result.stderr.toString() };
}

// The test owns these folders under the system tmpdir, which scratch-clean refuses outside agent-env.
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test("a builder gets the added width site's location and owner, then must lower the baseline after deleting a copy", () => {
  const dir = repo();
  const before = original + '\nexport const oldWidth = (label: string) => label.length + 1;\n';
  writeFileSync(join(dir, file), before);
  expect(run(dir, "--write").code).toBe(0);
  expect(run(dir).code).toBe(0);

  const addedLine = before.split("\n").length;
  writeFileSync(join(dir, file), before + 'export const healthWidthProbe = (label: string) => label.length + 2;\n');
  const added = run(dir);
  expect(added.code).toBe(1);
  expect(added.text).toContain(`${file}:${addedLine}`);
  expect(added.text).toMatch(/width-length: 2 > baseline 1/);
  expect(added.text).toContain("packages/door/src/style.ts");
  expect(added.text).toContain("width");

  writeFileSync(join(dir, file), original);
  const removed = run(dir);
  expect(removed.code).toBe(1);
  expect(removed.text).toContain("lower the baseline: bun scripts/health-ratchet.ts --write");
  expect(run(dir, "--write").code).toBe(0);
  expect(run(dir).code).toBe(0);
});

test("copy recognizers read code across lines, leave strings and collection lengths alone, and cannot be raised with --write", () => {
  const dir = repo();
  const clean = 'const example = "title.padEnd(10) label.length /^#{1,6}/";\n// title.padEnd(10)\nconst last = items.length - 1;\n';
  writeFileSync(join(dir, file), clean);
  expect(run(dir, "--write").code).toBe(0);
  for (const [pattern, source] of [
    ["width-length", "const width =\n  label.length + 1;"],
    ["pad-end", 'const label = title.padEnd(10);'],
    ["line-offset-reduce", 'const at = lines.slice(0, line)\n  .reduce((sum, text) => sum + text.length + 1, 0);'],
    ["heading-regex", 'const heading = /^(#{1,6})\\s+/.exec(line);'],
    ["host-ctx-cast", 'const ctx = (host.ctx as WiderContext);'],
  ]) {
    writeFileSync(join(dir, file), clean + source + "\n");
    const checked = run(dir);
    expect(checked.code).toBe(1);
    expect(checked.text).toContain(`${pattern}: 1 > baseline 0`);
    expect(checked.text).toContain(`${file}:`);
    expect(run(dir, "--write").code).toBe(1);
  }
});

test("source files stop at 2,000 lines, and an existing large file can only shrink", () => {
  const dir = repo();
  writeFileSync(join(dir, file), "// drawing\n".repeat(2_002));
  expect(run(dir, "--write").code).toBe(0);
  writeFileSync(join(dir, file), "// drawing\n".repeat(2_003));
  expect(run(dir).text).toContain(`${file}:2003: 2003 lines > baseline 2002`);
  expect(run(dir, "--write").code).toBe(1);
  writeFileSync(join(dir, file), "// drawing\n".repeat(2_000));
  expect(run(dir).text).toContain("lower the baseline");
  expect(run(dir, "--write").code).toBe(0);
  expect(run(dir).code).toBe(0);
  writeFileSync(join(dir, file), "// drawing\n".repeat(2_001));
  const crossing = run(dir);
  expect(crossing.code).toBe(1);
  expect(crossing.text).toContain(`${file}:2001: 2001 lines > baseline 2000`);
});

test("the weekly report measures committed growth and co-changes against the previous pass or baseline", () => {
  const dir = repo(), other = "packages/door/src/another.ts";
  const commit = (message: string) => {
    git(dir, "add", ".");
    git(dir, "-c", "user.name=Gardener", "-c", "user.email=garden@example.test", "-c", "commit.gpgsign=false", "commit", "-qm", message);
  };
  writeFileSync(join(dir, file), "// drawing\n".repeat(1_001));
  writeFileSync(join(dir, other), "// another\n");
  commit("A garden drawing");
  expect(run(dir, "--write").code).toBe(0);
  const first = run(dir, "--report", "--json");
  expect(first.code).toBe(0);
  writeFileSync(join(dir, "previous.json"), first.text);
  writeFileSync(join(dir, file), "// drawing\n".repeat(1_006));
  writeFileSync(join(dir, other), 'const width = title.length;\n');
  commit("The drawing grows");
  for (const previous of [[], ["previous.json"]]) {
    const next = run(dir, "--report", ...previous, "--json");
    expect(next.code).toBe(0);
    const report = JSON.parse(next.text);
    expect(report.over1000).toBe(1);
    expect(report.over2000).toBe(0);
    expect(report.files.find((f: { file: string }) => f.file === file)).toMatchObject({ lines: 1_006, growth: 5, commits: 2 });
    expect(report.patterns["width-length"]).toMatchObject({ count: 1, delta: 1 });
    expect(report.coChanges[0]).toEqual({ files: [other, file], commits: 2 });
  }
  expect(run(dir, "--report", "previous.json").text).toContain(`${file}: 1006, +5, 2 commits`);
});

test("two branches whose counts agree merge the baseline clean; counts that really differ conflict (PIE-1696)", () => {
  const dir = repo(), files = [0, 1, 2, 3, 4].map(n => `packages/door/src/bed-${n}.ts`);
  const commit = (message: string) => {
    git(dir, "add", ".");
    git(dir, "-c", "user.name=Gardener", "-c", "user.email=garden@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", message);
  };
  const merge = (branch: string) => Bun.spawnSync(["git", "-c", "user.name=Gardener", "-c", "user.email=garden@example.test",
    "-c", "commit.gpgsign=false", "merge", "--no-edit", branch], { cwd: dir });
  const site = "const labelWidth = (label: string) => label.length + 1;\n";
  const plant = (n: number, comment = "") => writeFileSync(join(dir, files[n]!), `// bed ${n}${comment}\n${site}`);
  const weed = (n: number) => writeFileSync(join(dir, files[n]!), `// bed ${n}\n`);
  files.forEach((_, n) => plant(n));
  git(dir, "checkout", "-qb", "main");
  commit("Five garden copies");
  expect(run(dir, "--write").code).toBe(0);
  commit("Baseline");
  expect(readFileSync(join(dir, "scripts/health-baseline.json"), "utf8")).not.toMatch(/[0-9a-f]{40}/);

  // Each branch changes code, rewrites the baseline as a PR does after merging main, and the next merges into main.
  const branch = (name: string, change: () => void) => {
    git(dir, "checkout", "-qb", name, "main");
    change();
    commit(`${name}: code`);
    expect(run(dir, "--write").code).toBe(0);
    commit(`${name}: baseline`);
  };
  const pair = (a: [string, () => void], b: [string, () => void]) => {
    git(dir, "checkout", "-q", "main");
    branch(...a);
    branch(...b);
    return merge(a[0]);
  };

  // Counts the same, different code: the same baseline on both sides.
  const same = pair(["tulips", () => plant(0, ", tulips")], ["roses", () => plant(4, ", roses")]);
  expect(same.exitCode).toBe(0);
  expect(run(dir).code).toBe(0);

  // Each removes a different copy: both removals land and the count is the sites left, with no stale number to lower.
  const apart = pair(["weed-first", () => weed(0)], ["weed-last", () => weed(4)]);
  expect(apart.exitCode).toBe(0);
  expect(run(dir).code).toBe(0);
  expect(JSON.parse(readFileSync(join(dir, "scripts/health-baseline.json"), "utf8")).patterns["width-length"].sites).toHaveLength(3);

  // One removes a copy, the other that copy and its neighbour: the counts really differ, and the baseline conflicts.
  const differing = pair(["prune-one", () => weed(1)], ["prune-two", () => { weed(1); weed(2); }]);
  expect(differing.exitCode).not.toBe(0);
  expect(differing.stdout.toString()).toContain("CONFLICT (content): Merge conflict in scripts/health-baseline.json");
  expect(differing.stdout.toString()).not.toContain("Merge conflict in packages/door/src/");
});
