// `open file=` (src/desk/file-open.ts, PIE-602): a file's diff, from git or against a copy from before. Fictional files
// in a temp folder; the opens themselves are driven through act in the showcase test ("a session's files").
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffNote } from "../src/desk/file-open";

const root = mkdtempSync(join(tmpdir(), "file-open-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("a file's diff", () => {
  test("in git: against its last commit; a file git doesn't track yet is all added", async () => {
    const repo = join(root, "repo");
    Bun.spawnSync(["mkdir", "-p", repo]);
    Bun.spawnSync(["git", "init", "-q", repo]);
    const file = join(repo, "plan.md");
    writeFileSync(file, "# Beds\nBorlotti\n");
    Bun.spawnSync(["git", "-C", repo, "add", "plan.md"]);
    Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "seed"]);
    writeFileSync(file, "# Beds\nRunner beans\n");
    const note = await diffNote(file, undefined);
    expect(note.id).toBe(`file-diff:${file}`);
    expect(note.text).toStartWith(`plan.md · diff\n*${file} · against its last commit*`);
    expect(note.text).toContain("```diff");
    expect(note.text).toContain("-Borlotti");
    expect(note.text).toContain("+Runner beans");
    const fresh = join(repo, "new.txt");
    writeFileSync(fresh, "chard\n");
    expect((await diffNote(fresh, undefined)).text).toContain("+chard");
  });

  test("outside git: against the copy taken before; with none, it says so", async () => {
    const file = join(root, "seed-list.txt"), copy = join(root, "seed-list.before");
    writeFileSync(copy, "broad beans\n");
    writeFileSync(file, "broad beans\nleeks\n");
    const note = await diffNote(file, copy);
    expect(note.text).toContain("against the copy taken when the session first touched it");
    expect(note.text).toContain("+leeks");
    expect((await diffNote(file, undefined)).text).toContain("Not in a git repository, and no copy from before the change to compare with.");
  });
});
