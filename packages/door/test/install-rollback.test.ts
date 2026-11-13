// PIE-1786: install's way back for the code is apart from the data's. `--sha <earlier> --back` takes the checkout back
// along main and leaves every outline as it is; across a schema step it refuses and names the data's way back. A
// scratch checkout with its own origin, and a scratch outline: no real checkout or outline is touched.
import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { scratchDir } from "./scratch";
import { setupCommand } from "../src/setup/apply";
import { OutlinerStore } from "../../outliner/src/store";
import { SCHEMA_VERSION } from "@ep0ch/outliner/schema";

test("the code goes back along main and forward again with the outline untouched; across a schema step it refuses (PIE-1786)", async () => {
  const dir = scratchDir("install-back-");
  const repo = join(dir, "repo"), origin = join(dir, "origin.git"), home = join(dir, "home"), outlines = join(dir, "outlines");
  mkdirSync(home); mkdirSync(outlines);
  const env = { HOME: home, PATH: `${process.execPath.slice(0, process.execPath.lastIndexOf("/"))}:/usr/bin:/bin`, XDG_CONFIG_HOME: join(home, ".config"), EP0CH_OUTLINES: outlines, EP0CH_STATE: join(dir, "state"), GIT_AUTHOR_NAME: "Wren", GIT_AUTHOR_EMAIL: "wren@example.test", GIT_COMMITTER_NAME: "Wren", GIT_COMMITTER_EMAIL: "wren@example.test" };
  const git = (...args: string[]) => {
    const r = Bun.spawnSync(["git", ...args], { env, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode) throw new Error(r.stderr.toString());
    return r.stdout.toString().trim();
  };
  const output: string[] = [];
  const io = { env, repoRoot: repo, cwd: home, platform: "other", out: (s: string) => output.push(s), err: (s: string) => output.push(s) };
  const schemaFile = join(repo, "packages/outliner/src/schema.ts");
  const schemaText = readFileSync(resolve(import.meta.dir, "../../outliner/src/schema.ts"), "utf8");
  try {
    git("init", "-qb", "main", repo);
    mkdirSync(join(repo, "packages/door/scripts"), { recursive: true });
    copyFileSync(resolve(import.meta.dir, "../scripts/with-secrets"), join(repo, "packages/door/scripts/with-secrets"));
    mkdirSync(dirOf(schemaFile), { recursive: true });
    // The oldest commit opens the schema before this one: going back to it crosses a schema step.
    writeFileSync(schemaFile, schemaText.replace(`export const SCHEMA_VERSION = ${SCHEMA_VERSION};`, `export const SCHEMA_VERSION = ${SCHEMA_VERSION - 1};`));
    writeFileSync(join(repo, "journal"), "zero");
    git("-C", repo, "add", "."); git("-C", repo, "commit", "-qm", "before the schema step");
    const older = git("-C", repo, "rev-parse", "HEAD");
    writeFileSync(schemaFile, schemaText);
    writeFileSync(join(repo, "journal"), "one"); git("-C", repo, "commit", "-qam", "one");
    const one = git("-C", repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "journal"), "two"); git("-C", repo, "commit", "-qam", "two");
    const two = git("-C", repo, "rev-parse", "HEAD");
    git("clone", "-q", "--bare", repo, origin); git("-C", repo, "remote", "add", "origin", origin);
    git("-C", repo, "fetch", "-q", "origin");
    // The outline, as the code at `two` has it.
    const store = new OutlinerStore(join(outlines, "garden.sqlite"));
    const note = store.create("Seed trays\nWater from below.");
    store.close();
    const outline = readFileSync(join(outlines, "garden.sqlite"));
    const head = () => git("-C", repo, "rev-parse", "HEAD");

    // Back: the checkout to `one`, the outline as it was (the rest of the run can't finish in this partial checkout).
    await setupCommand(["install", "--apply", "--sha", one, "--back", "--json"], io);
    expect(head()).toBe(one);
    expect(output.join("\n")).toContain("went back");
    expect(readFileSync(join(outlines, "garden.sqlite")).equals(outline)).toBe(true);
    // Forward again, along main.
    output.length = 0;
    await setupCommand(["install", "--apply", "--sha", two, "--json"], io);
    expect(head()).toBe(two);
    const reopened = new OutlinerStore(join(outlines, "garden.sqlite"));
    try { expect(reopened.require(note.id).text).toBe("Seed trays\nWater from below."); } finally { reopened.close(); }

    // Across the schema step: refused, nothing moved, and the data's way back named.
    output.length = 0;
    const refused = await setupCommand(["install", "--apply", "--sha", older, "--back", "--json"], io).catch((e: Error) => { output.push(e.message); return 1; });
    expect(refused).not.toBe(0);
    expect(head()).toBe(two);
    expect(output.join("\n")).toMatch(new RegExp(`opens schema ${SCHEMA_VERSION - 1}, and garden is schema ${SCHEMA_VERSION}.*ep0ch backup restore`, "s"));
    // --back alone, or on a commit ahead: refused.
    output.length = 0;
    expect(await setupCommand(["install", "--apply", "--back"], io)).toBe(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60_000);

function dirOf(path: string) { return path.slice(0, path.lastIndexOf("/")); }

test("a schema step keeps one copy per outline: the copies from earlier steps are the ones it lets go (PIE-1786)", async () => {
  const { olderSchemaCopies } = await import("../src/setup/apply");
  const root = scratchDir("install-copies-");
  try {
    for (const [run, file] of [["20261101T000000Z", "garden.schema-11.sqlite"], ["20261112T000000Z", "garden.schema-12.sqlite"], ["20261112T000000Z", "garden-two.schema-12.sqlite"], ["20261113T000000Z", "garden.sqlite"]] as const) {
      mkdirSync(join(root, run), { recursive: true }); writeFileSync(join(root, run, file), "");
    }
    expect(olderSchemaCopies(root, "garden", join(root, "20261112T000000Z/garden.schema-12.sqlite"))).toEqual([join(root, "20261101T000000Z/garden.schema-11.sqlite")]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--back never drops a commit origin doesn't have, nor a file git doesn't track (Codex on #1502)", async () => {
  const dir = scratchDir("install-back-keep-");
  const repo = join(dir, "repo"), origin = join(dir, "origin.git"), home = join(dir, "home"), outlines = join(dir, "outlines");
  mkdirSync(home); mkdirSync(outlines);
  const env = { HOME: home, PATH: `${process.execPath.slice(0, process.execPath.lastIndexOf("/"))}:/usr/bin:/bin`, XDG_CONFIG_HOME: join(home, ".config"), EP0CH_OUTLINES: outlines, EP0CH_STATE: join(dir, "state"), GIT_AUTHOR_NAME: "Wren", GIT_AUTHOR_EMAIL: "wren@example.test", GIT_COMMITTER_NAME: "Wren", GIT_COMMITTER_EMAIL: "wren@example.test" };
  const git = (...args: string[]) => {
    const r = Bun.spawnSync(["git", ...args], { env, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode) throw new Error(r.stderr.toString());
    return r.stdout.toString().trim();
  };
  const output: string[] = [];
  const io = { env, repoRoot: repo, cwd: home, platform: "other", out: (s: string) => output.push(s), err: (s: string) => output.push(s) };
  const attempt = (sha: string) => setupCommand(["install", "--apply", "--sha", sha, "--back", "--json"], io).catch((e: Error) => { output.push(e.message); return 1; });
  try {
    git("init", "-qb", "main", repo);
    mkdirSync(join(repo, "packages/door/scripts"), { recursive: true });
    copyFileSync(resolve(import.meta.dir, "../scripts/with-secrets"), join(repo, "packages/door/scripts/with-secrets"));
    mkdirSync(join(repo, "packages/outliner/src"), { recursive: true });
    copyFileSync(resolve(import.meta.dir, "../../outliner/src/schema.ts"), join(repo, "packages/outliner/src/schema.ts"));
    // The older commit tracks seed-notes; the newer one doesn't.
    writeFileSync(join(repo, "seed-notes"), "from the older commit");
    git("-C", repo, "add", "."); git("-C", repo, "commit", "-qm", "one");
    const one = git("-C", repo, "rev-parse", "HEAD");
    git("-C", repo, "rm", "-q", "seed-notes"); git("-C", repo, "commit", "-qm", "two");
    git("clone", "-q", "--bare", repo, origin); git("-C", repo, "remote", "add", "origin", origin);
    git("-C", repo, "fetch", "-q", "origin");
    // A file of the person's own where the older commit has one: going back would overwrite it.
    writeFileSync(join(repo, "seed-notes"), "the person's own notes");
    output.length = 0;
    expect(await attempt(one)).not.toBe(0);
    expect(readFileSync(join(repo, "seed-notes"), "utf8")).toBe("the person's own notes");
    expect(git("-C", repo, "log", "-1", "--format=%s")).toBe("two");
    rmSync(join(repo, "seed-notes"));
    // A commit origin doesn't have: going back would drop it.
    writeFileSync(join(repo, "journal"), "local only"); git("-C", repo, "add", "journal"); git("-C", repo, "commit", "-qm", "local only");
    const local = git("-C", repo, "rev-parse", "HEAD");
    output.length = 0;
    expect(await attempt(one)).not.toBe(0);
    expect(git("-C", repo, "rev-parse", "HEAD")).toBe(local);
    expect(output.join("\n")).toMatch(/isn't on origin\/main/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60_000);

test("ordinary retention never removes a schema step's copy, even keeping one run (Codex on #1502)", async () => {
  const { pruneInstallBackups } = await import("../src/setup/install-backups");
  const root = scratchDir("install-keep-schema-");
  try {
    for (const run of ["20261101T000000Z", "20261112T000000Z", "20261113T000000Z"]) { mkdirSync(join(root, run)); writeFileSync(join(root, run, "garden.sqlite"), ""); }
    writeFileSync(join(root, "20261101T000000Z", "garden.schema-12.sqlite"), "");
    pruneInstallBackups(root, 1, () => {});
    expect(readFileSync(join(root, "20261101T000000Z", "garden.schema-12.sqlite"), "utf8")).toBe("");
    expect(() => readFileSync(join(root, "20261112T000000Z", "garden.sqlite"))).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
