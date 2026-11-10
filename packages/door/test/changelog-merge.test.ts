import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The repository's own .gitattributes, in a made-up repository: two branches that each add a CHANGELOG entry merge
// without a round trip (PIE-1696).
const attributes = resolve(import.meta.dir, "../../../.gitattributes");
const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const identity = ["-c", "user.name=Gardener", "-c", "user.email=garden@example.test", "-c", "commit.gpgsign=false"];
function git(dir: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...identity, ...args], { cwd: dir });
  return { code: result.exitCode, text: result.stdout.toString() + result.stderr.toString() };
}
function ok(dir: string, ...args: string[]) {
  const result = git(dir, ...args);
  if (result.code !== 0) throw Error(result.text);
}

const changelog = (top: string, old = "- **Older:** a change from before.") =>
  `# Changelog\n\n## [Unreleased]\n\n${top}### An earlier change (PIE-1)\n\n${old}\n- **Run:** nothing.\n\n## 0.1.0\n\n- First.\n`;

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "changelog-merge-"));
  scratch.push(dir);
  ok(dir, "init", "-q", "-b", "main");
  copyFileSync(attributes, join(dir, ".gitattributes"));
  writeFileSync(join(dir, "CHANGELOG.md"), changelog(""));
  ok(dir, "add", ".");
  ok(dir, "commit", "-qm", "Changelog");
  return dir;
}

function branch(dir: string, name: string, text: string) {
  ok(dir, "checkout", "-qb", name, "main");
  writeFileSync(join(dir, "CHANGELOG.md"), text);
  ok(dir, "commit", "-qam", name);
}

test("two branches each adding an entry at the top of [Unreleased] merge clean, both entries kept", () => {
  const dir = repo();
  const tulips = "### Tulips open (PIE-2)\n\n- **Tulips:** they open.\n\n";
  const roses = "### Roses climb (PIE-3)\n\n- **Roses:** they climb.\n\n";
  branch(dir, "tulips", changelog(tulips));
  branch(dir, "roses", changelog(roses));
  const merged = git(dir, "merge", "--no-edit", "tulips");
  expect(merged.code).toBe(0);
  const text = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
  expect(text).not.toContain("<<<<<<<");
  // Both entries, in order, and everything else as it was. Their shared blank line is one line to git, so the two
  // entries meet without one between them: a cosmetic join the next CHANGELOG edit can space out.
  expect(text).toContain("- **Roses:** they climb.\n### Tulips open (PIE-2)");
  expect(text.replace("climb.\n###", "climb.\n\n###")).toBe(changelog(roses + tulips));
});

test("two edits of one line merge without a conflict and keep both lines, the old one gone", () => {
  const dir = repo();
  branch(dir, "tulips", changelog("", "- **Older:** a change from before, tulips' wording."));
  branch(dir, "roses", changelog("", "- **Older:** a change from before, roses' wording."));
  expect(git(dir, "merge", "--no-edit", "tulips").code).toBe(0);
  const text = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
  expect(text).toContain("roses' wording.\n- **Older:** a change from before, tulips' wording.\n- **Run:**");
  expect(text).not.toContain("from before.\n");
});
