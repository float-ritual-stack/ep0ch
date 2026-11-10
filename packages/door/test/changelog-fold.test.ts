import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// PIE-1696: two PRs that each add a CHANGELOG entry merge clean, because each entry is a file of its own, and loki's
// fold puts them into CHANGELOG.md, newest first. A made-up repository; the real script.
const script = resolve(import.meta.dir, "../../../scripts/changelog-fold.ts");
const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const identity = ["-c", "user.name=Gardener", "-c", "user.email=garden@example.test", "-c", "commit.gpgsign=false"];
function git(dir: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...identity, ...args], { cwd: dir });
  if (result.exitCode !== 0) throw Error(result.stdout.toString() + result.stderr.toString());
  return result.stdout.toString();
}
function fold(dir: string) {
  const result = Bun.spawnSync([process.execPath, script], { cwd: dir });
  return { code: result.exitCode, text: result.stdout.toString() + result.stderr.toString() };
}

const run = "- **Run:** `ep0ch install --apply`. PROTOCOL and the schema don't move.\n";
const changelog = (top: string) => `# Changelog\n\n## [Unreleased]\n\n${top}### An earlier change (PIE-1)\n\n- **Older:** a change.\n${run}\n## Before\n\n- First.\n`;
const entry = (name: string) => `### ${name} (PIE-2)\n\n- **${name} one:** a.\n- **${name} two:** b.\n${run}`;

test("two branches each adding an entry merge clean, and the fold puts both in CHANGELOG.md, newest first, every line kept", () => {
  const dir = mkdtempSync(join(tmpdir(), "changelog-fold-"));
  scratch.push(dir);
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "CHANGELOG.md"), changelog(""));
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "Changelog");
  for (const [branch, file, name] of [["tulips", "2026-03-01-feat-tulips.md", "Tulips open"], ["roses", "2026-03-02-fix-roses.md", "Roses climb"]]) {
    git(dir, "checkout", "-qb", branch!, "main");
    mkdirSync(join(dir, "changelog"), { recursive: true });
    writeFileSync(join(dir, "changelog", file!), entry(name!));
    git(dir, "add", ".");
    git(dir, "commit", "-qm", branch!);
  }
  git(dir, "merge", "--no-edit", "tulips");
  expect(readdirSync(join(dir, "changelog")).sort()).toEqual(["2026-03-01-feat-tulips.md", "2026-03-02-fix-roses.md"]);

  const folded = fold(dir);
  expect(folded.code).toBe(0);
  expect(folded.text).toContain("Folded 2 entries into CHANGELOG.md");
  // Each entry keeps its own Run line, the one a union merge of two entries in one file drops.
  expect(readFileSync(join(dir, "CHANGELOG.md"), "utf8")).toBe(changelog(`${entry("Roses climb")}\n${entry("Tulips open")}\n`));
  expect(readdirSync(join(dir, "changelog"))).toEqual([]);
  expect(fold(dir).text).toContain("No entries waiting in changelog/.");
});
