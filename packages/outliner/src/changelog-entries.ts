// The CHANGELOG's entries waiting to be folded in (PIE-1696). Every PR used to add its `###` section at the top of
// `[Unreleased]` in CHANGELOG.md, so any two PRs conflicted there, on GitHub too: it ignores a `merge=union` attribute,
// and union drops a line two entries share, like a `- **Run:**` line. A PR adds its entry as a file of its own instead,
// `changelog/<date>-<branch>.md` (the branch's `/` as `-`), which no other PR touches; loki folds them into
// CHANGELOG.md with `bun scripts/changelog-fold.ts` in its daily PR. Everything that reads what shipped reads both.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The folder entries wait in, at the repository's root. */
export const CHANGELOG_ENTRIES = "changelog";

/** The entries not yet folded, newest first (their names start with the date), each one `###` section. */
export function changelogEntries(repo: string): { file: string; text: string }[] {
  const dir = join(repo, CHANGELOG_ENTRIES);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(".md")).sort().reverse()
    .map(f => ({ file: join(CHANGELOG_ENTRIES, f), text: readFileSync(join(dir, f), "utf8").trim() }));
}

/** Everything the CHANGELOG says, as one text: CHANGELOG.md with the waiting entries at the top of `[Unreleased]`, as
 * folding them would write it. Null without a CHANGELOG.md. */
export function changelogText(repo: string): string | null {
  const file = join(repo, "CHANGELOG.md");
  if (!existsSync(file)) return null;
  return withEntries(readFileSync(file, "utf8"), changelogEntries(repo).map(e => e.text));
}

/** The CHANGELOG with these entries, newest first, at the top of `[Unreleased]`; refused when it has no such heading. Pure. */
export function withEntries(changelog: string, entries: string[]): string {
  if (!entries.length) return changelog;
  const at = /^## \[Unreleased\][^\n]*\n\n?/m.exec(changelog);
  if (!at) throw Error("CHANGELOG.md has no `## [Unreleased]` heading to fold entries under");
  const end = at.index + at[0].length;
  return `${changelog.slice(0, at.index)}## [Unreleased]\n\n${entries.map(e => `${e.trim()}\n\n`).join("")}${changelog.slice(end)}`;
}
