// Installed copies of the built-ins follow updates (PIE-861): an unchanged copy is refreshed in place with its
// config.json kept, a changed one is left alone and said. The built-ins here are a scratch git repo of made-up
// versions (CI's checkout is shallow, so the real history isn't there), and every folder is a temp dir.
import { afterEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addExtension, updateExtensions } from "../src/extension-install";
import { BUILT_IN_EXTENSIONS } from "../src/extension-registry";
import { INSTALL_RECORD, installedCopies } from "../src/extension-update";

const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", "-c", "user.name=test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", ...args], { cwd, stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

/** A repo whose `packages/outliner/extensions/moon` went through two versions; the copies' folders beside it. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), "ext-update-"));
  temps.push(root);
  const repo = join(root, "repo"), builtIns = join(repo, "packages", "outliner", "extensions"), moon = join(builtIns, "moon");
  mkdirSync(builtIns, { recursive: true });
  cpSync(join(BUILT_IN_EXTENSIONS, "moon"), moon, { recursive: true });
  git(root, "init", "-q", "repo");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "Moon, first version");
  const first = { files: Object.fromEntries(readdirSync(moon).map((name) => [name, readFileSync(join(moon, name), "utf8")])) };
  writeFileSync(join(moon, "moon.ts"), `${readFileSync(join(moon, "moon.ts"), "utf8")}// a later fix\n`);
  writeFileSync(join(moon, "phases.ts"), "export const PHASES = 8;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "Moon draws its phases from a table");
  const user = join(root, "config", "extensions"), outline = join(root, "outlines", "demo", "extensions");
  mkdirSync(user, { recursive: true });
  mkdirSync(outline, { recursive: true });
  /** A copy of the first version, made before install records existed. */
  const oldCopy = (dir: string) => {
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(first.files)) writeFileSync(join(dir, name), text);
  };
  const roots = [{ path: user, where: "user" }, { path: outline, where: "demo" }];
  return { root, repo, builtIns, user, outline, oldCopy, roots };
}

test("an unchanged copy from an earlier version is refreshed in place: config.json and your dotfiles stay, and it's recorded", async () => {
  const s = setup();
  const copy = join(s.user, "moon");
  s.oldCopy(copy);
  writeFileSync(join(copy, "config.json"), '{"config":{"place":"Somewhere"}}\n');
  writeFileSync(join(copy, ".env"), "MADE_UP=1\n");

  const [before] = installedCopies(s.roots, s.builtIns);
  expect(before).toMatchObject({ id: "moon", where: "user", state: "stale", recorded: false });
  expect(before!.news).toEqual([expect.objectContaining({ subject: "Moon draws its phases from a table" })]);

  const said: string[] = [];
  const done = await updateExtensions(undefined, { roots: s.roots, builtIns: s.builtIns, say: (line) => said.push(line) });
  expect(done).toMatchObject([{ id: "moon", done: "updated" }]);
  expect(said[0]).toContain("updated moon in the user folder");
  expect(readFileSync(join(copy, "phases.ts"), "utf8")).toContain("PHASES");
  expect(readFileSync(join(copy, "config.json"), "utf8")).toContain("Somewhere");
  expect(existsSync(join(copy, ".env"))).toBe(true);
  expect(JSON.parse(readFileSync(join(copy, INSTALL_RECORD), "utf8"))).toMatchObject({ builtIn: "moon" });

  expect(installedCopies(s.roots, s.builtIns)).toMatchObject([{ id: "moon", state: "current", recorded: true }]);
});

test("a copy someone changed is left alone and said; --yes takes the built-in's and keeps theirs beside the folder", async () => {
  const s = setup();
  const copy = join(s.outline, "moon");
  s.oldCopy(copy);
  writeFileSync(join(copy, "moon.ts"), `${readFileSync(join(copy, "moon.ts"), "utf8")}// my own tweak\n`);

  expect(installedCopies(s.roots, s.builtIns)).toMatchObject([{ id: "moon", where: "demo", state: "forked" }]);
  const said: string[] = [];
  expect(await updateExtensions(undefined, { roots: s.roots, builtIns: s.builtIns, keepForked: true, say: (line) => said.push(line) }))
    .toMatchObject([{ id: "moon", done: "kept" }]);
  expect(said.join("\n")).toContain("ep0ch ext update moon");
  expect(readFileSync(join(copy, "moon.ts"), "utf8")).toContain("my own tweak");

  // Asked, and answered no: still theirs, after seeing the diff.
  said.length = 0;
  expect(await updateExtensions("moon", { roots: s.roots, builtIns: s.builtIns, ask: async () => false, say: (line) => said.push(line) }))
    .toMatchObject([{ done: "kept" }]);
  expect(said.join("\n")).toContain("-// my own tweak");
  expect(said.join("\n")).toContain("+export const PHASES = 8;");

  const [took] = await updateExtensions("moon", { roots: s.roots, builtIns: s.builtIns, yes: true });
  expect(took).toMatchObject({ done: "took" });
  expect(readFileSync(join(took!.forkKept!, "moon.ts"), "utf8")).toContain("my own tweak");
  expect(readFileSync(join(copy, "moon.ts"), "utf8")).not.toContain("my own tweak");
  expect(installedCopies(s.roots, s.builtIns)).toMatchObject([{ state: "current" }]);
});

test("a recorded copy that was edited after install is forked, even when it matches no version", async () => {
  const s = setup();
  const copy = join(s.user, "moon");
  await addExtension(join(s.builtIns, "moon"), { from: join(s.builtIns, "moon"), root: s.user, builtIns: s.builtIns });
  expect(installedCopies(s.roots, s.builtIns)).toMatchObject([{ state: "current", recorded: true }]);
  writeFileSync(join(copy, "notes.ts"), "// mine\n");
  expect(installedCopies(s.roots, s.builtIns)).toMatchObject([{ state: "forked", differs: ["notes.ts"] }]);
  // Someone's own folder added over it carries no record: it's no longer a copy of the built-in as installed.
  const own = join(s.root, "own", "moon");
  cpSync(join(s.builtIns, "moon"), own, { recursive: true });
  await addExtension(own, { root: s.user, builtIns: s.builtIns });
  expect(existsSync(join(copy, INSTALL_RECORD))).toBe(false);
});

test("a recorded copy says what's new since it was installed, across commits that never touched it", async () => {
  const s = setup();
  const copy = join(s.user, "moon");
  // Installed at a commit that never touched it: the record's commit isn't in the built-in's own log.
  writeFileSync(join(s.repo, "elsewhere.md"), "unrelated\n");
  git(s.repo, "add", "-A");
  git(s.repo, "commit", "-qm", "Something else entirely");
  await addExtension(join(s.builtIns, "moon"), { from: join(s.builtIns, "moon"), root: s.user, builtIns: s.builtIns });
  writeFileSync(join(s.builtIns, "moon", "phases.ts"), "export const PHASES = 12;\n");
  git(s.repo, "add", "-A");
  git(s.repo, "commit", "-qm", "Moon counts twelve phases");
  const [stale] = installedCopies(s.roots, s.builtIns);
  expect(stale).toMatchObject({ state: "stale", recorded: true });
  expect(stale!.news).toEqual([expect.objectContaining({ subject: "Moon counts twelve phases" })]);
  // Brought up to date by hand: current, and its record follows, so the built-in's next change finds it unchanged.
  cpSync(join(s.builtIns, "moon"), copy, { recursive: true });
  expect(installedCopies(s.roots, s.builtIns)).toMatchObject([{ state: "current", recordCurrent: false }]);
  await updateExtensions(undefined, { roots: s.roots, builtIns: s.builtIns });
  expect(installedCopies(s.roots, s.builtIns)).toMatchObject([{ state: "current", recordCurrent: true }]);
  // A folder that links to the checkout's built-ins is never taken for a copy of them.
  const linked = join(s.root, "linked");
  symlinkSync(s.builtIns, linked);
  expect(installedCopies([{ path: linked, where: "user" }], s.builtIns)).toEqual([]);
});

test("ext update --all --keep-forked --json: what ep0ch install reads", async () => {
  const root = mkdtempSync(join(tmpdir(), "ext-update-cli-"));
  temps.push(root);
  const env = { PATH: process.env.PATH ?? "", HOME: root, OUTLINER_EXTENSIONS_DIR: join(root, "extensions"), EP0CH_OUTLINES: join(root, "outlines") };
  const cli = join(import.meta.dir, "..", "src", "cli.ts");
  const run = (...args: string[]) => {
    const r = Bun.spawnSync([process.execPath, cli, "ext", ...args], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  };
  expect(run("add", "moon").code).toBe(0);
  writeFileSync(join(root, "extensions", "moon", "moon.ts"), "// changed here\n");
  const r = run("update", "--all", "--keep-forked", "--json");
  expect(r.code).toBe(0);
  expect(JSON.parse(r.out.trim())).toMatchObject([{ id: "moon", where: "user", state: "forked", done: "kept" }]);
  expect(readFileSync(join(root, "extensions", "moon", "moon.ts"), "utf8")).toBe("// changed here\n");
  expect(run("update").code).toBe(1);
});
