// Folds the waiting CHANGELOG entries (`changelog/*.md`, one per PR) into CHANGELOG.md at the top of `[Unreleased]`,
// newest first, and removes their files (PIE-1696). loki runs it in its daily PR; nothing else edits CHANGELOG.md's
// top, so that PR conflicts with no builder's. Run at the repository root: bun scripts/changelog-fold.ts
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { changelogEntries, changelogText } from "../packages/outliner/src/changelog-entries";

if (process.argv.length > 2) { console.error("Usage: bun scripts/changelog-fold.ts (at the repository root; it takes no arguments)"); process.exit(1); }
const repo = process.cwd();
const entries = changelogEntries(repo);
const text = changelogText(repo);
if (text === null) { console.error(`no CHANGELOG.md in ${repo}: run it at the repository root`); process.exit(1); }
if (!entries.length) { console.log("No entries waiting in changelog/."); process.exit(0); }
writeFileSync(join(repo, "CHANGELOG.md"), text);
for (const e of entries) rmSync(join(repo, e.file));
console.log(`Folded ${entries.length} ${entries.length === 1 ? "entry" : "entries"} into CHANGELOG.md:\n${entries.map(e => `  ${e.file}`).join("\n")}`);
