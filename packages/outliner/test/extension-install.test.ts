// `outliner ext add` (wave A): copies a built-in into the user folder and seeds config.json from an
// existing resource-extensions.json entry. Made-up paths and names only.
import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addExtension, runExtCommand } from "../src/extension-install";
import { EXT_FLAGS } from "../src/extension-flags";
import { ResourceExtensionRuntime } from "../src/resource-extensions";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, ChangeFeedPage } from "../src/types";
import type { RuleListEntry } from "../src/extension-rules";
import { scratchDir } from "./scratch-outline";

test("kept extension rules switch off without warnings on reopen, and reinstall restores their triggers", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-ext-rules-"));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-registry.json");
  const outline = join(root, "outline"), socket = join(root, "outline.sock"), database = join(root, "outline.sqlite");
  mkdirSync(outline);
  let store = new OutlinerStore(database, { workspaceRoot: outline });
  const open = async () => {
    const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, ruleQuietMs: 10, stateDirectory: join(root, "state") });
    await server.start();
    return server;
  };
  let server = await open();
  const client = new OutlinerClient(socket);
  const list = () => client.request<{ rules: RuleListEntry[]; ruleProblems: string[]; hub: string }>({ action: "extensions.list", reload: true });
  try {
    await client.request({ action: "extensions.install", extension: "intake", where: "outline" });
    const rule = store.queryBlocks({ filters: [{ key: "rule-name", value: "intake-demo" }] }).blocks[0]!;
    const inbox = store.children(rule.parentId!).find(block => block.text === "Inbox (demo)")!;
    const edited = rule.text.replace(" [rule-batch::30s]", "") + "\n\nMy garden requests.";
    await client.request({ action: "update", blockId: rule.id, expectedRevision: rule.revision, text: edited, mutation: { author: "user" } });
    const removed = await client.request<{ rulesDisabled?: number; lines: string[] }>({ action: "extensions.uninstall", extension: "intake", demo: "keep" });
    expect(store.require(rule.id).text).toBe(edited.replace("[rule-on::", "[rule-was-on::"));
    expect(store.require(rule.id)).toMatchObject({ author: "agent", actorId: "ext:intake" });
    expect(removed.rulesDisabled).toBe(1);
    expect(removed.lines.join("\n")).toContain("1 rule switched off");
    await server.close(); store.close();
    store = new OutlinerStore(database, { workspaceRoot: outline });
    server = await open();
    const reopened = await list();
    expect(reopened.ruleProblems).toEqual([]);
    expect(store.require(reopened.hub).text).toContain("1 rule switched off");
    const back = await client.request<{ rulesEnabled?: number; lines: string[] }>({ action: "extensions.install", extension: "intake", where: "outline" });
    expect(store.require(rule.id).text).toBe(edited);
    expect(store.require(rule.id)).toMatchObject({ author: "agent", actorId: "ext:intake" });
    expect(back.rulesEnabled).toBe(1);
    expect(back.lines.join("\n")).toContain("1 rule switched back on");
    await list();
    const request = await client.request<Block>({ action: "create", parentId: inbox.id, text: "The hose reel jams [type::request]", author: "user" });
    const deadline = Date.now() + 10_000;
    while (!store.children(request.id).length && Date.now() < deadline) await Bun.sleep(25);
    expect(store.children(request.id).map(block => block.text)).toEqual([expect.stringContaining("Prior art and related [type::prior-art]")]);
    expect((await list()).rules.find(entry => entry.source.kind === "note" && entry.source.blockId === rule.id)?.ranToday).toBe(1);
    const feed = await client.request<ChangeFeedPage>({ action: "changes.since", sequence: 0, limit: 1000 });
    if (feed.kind !== "changes") throw new Error("expected changes");
    expect(feed.changes.filter(change => change.blockId === rule.id && ["ext.intake.uninstall", "ext.intake.install"].includes(change.action)).map(change => change.actor))
      .toEqual([{ author: "agent", actorId: "ext:intake" }, { author: "agent", actorId: "ext:intake" }]);
    const own = await client.request<Block>({ action: "create", text: "My rule [rule-name::my-intake] [rule-match::type=idea] [rule-on::intake/prior-art]", author: "user" });
    const quoted = await client.request<Block>({ action: "create", text: "Rule examples\n\n`[rule-on::intake/prior-art]`\n\nAn inline [rule-on::intake/prior-art] example.", author: "user" });
    const cli = async (...args: string[]) => {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "../../door/src/main.ts"), "ext", ...args, "--outline-folder", outline], {
        cwd: root, env: { ...process.env, EP0CH_WS: "rules-scratch", EP0CH_SOCKET: socket, EP0CH_OUTLINES: join(root, "outlines") }, stdout: "pipe", stderr: "pipe",
      });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ code, err }).toMatchObject({ code: 0 });
      return out;
    };
    const onChange = await client.request<Block>({ action: "create", text: "Re-sort on edit [rule-name::resort] [rule-match::type=idea] [rule-on-change::intake/prior-art]", author: "user" });
    expect(await cli("rm", "intake", "--demo", "remove")).toContain("3 rules switched off");
    expect(store.require(onChange.id).text).toContain("[rule-was-on-change::intake/prior-art]");
    expect(store.require(rule.id).text).toContain("[rule-was-on::intake/prior-art]");
    expect(store.require(own.id).text).toContain("[rule-was-on::intake/prior-art]");
    expect(store.require(quoted.id).text).toBe(quoted.text);
    expect(await cli("install", "intake")).toContain("3 rules switched back on");
    expect(store.require(onChange.id).text).toBe(onChange.text);
    expect(store.require(rule.id).text).toBe(edited);
    expect(store.require(own.id).text).toBe(own.text);
    await client.request({ action: "extensions.install", extension: "done-stamp", where: "outline" });
    const standalone = await client.request<Block>({ action: "create", text: "Stamp ideas [rule-name::stamp-ideas] [rule-match::type=idea] [rule-on::done-stamp/stamp]", author: "user" });
    expect(await cli("rm", "done-stamp")).toContain("1 rule switched off");
    expect(store.require(standalone.id).text).toContain("[rule-was-on::done-stamp/stamp]");
    await client.request({ action: "create", text: "Missing extension [rule-name::missing] [rule-match::type=request] [rule-on::absent/run]", author: "user" });
    expect((await list()).ruleProblems.join("\n")).toContain("rule-on names absent/run, but absent isn't installed here");
  } finally {
    await server.close(); store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test("ext add copies the Jira extension and keeps the old registry's email and keychain reference, never a secret", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-ext-add-"));
  const saved = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  try {
    process.env.OUTLINER_EXTENSIONS_DIR = join(root, "extensions");
    process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "resource-extensions.json");
    writeFileSync(join(root, "resource-extensions.json"), JSON.stringify({ version: 1, providers: { jira: {
      manifest: "/opt/example/jira/manifest.json", enabled: true,
      config: { authMode: "basic", email: "someone@example.test" },
      credentials: { token: { keychainService: "jira-api-token" } },
    } } }));
    const lines = await addExtension("jira");
    expect(lines[0]).toContain("installed jira");
    const config = JSON.parse(readFileSync(join(root, "extensions", "jira", "config.json"), "utf8"));
    expect(config).toEqual({ config: { authMode: "basic", email: "someone@example.test" }, secrets: { token: { keychainService: "jira-api-token" } } });
    expect(statSync(join(root, "extensions", "jira", "config.json")).mode & 0o077).toBe(0);

    const described = await new ResourceExtensionRuntime(undefined, undefined, [join(root, "extensions")]).describe("jira");
    expect(described).toMatchObject({ id: "jira", name: "Jira", contract: 2, handlers: [{ key: "jira", pollEvery: "12m" }] });

    // A second add updates the code and keeps the person's config.
    expect((await addExtension("jira")).join("\n")).toContain("kept");
    expect(await new ResourceExtensionRuntime(join(root, "none.json"), undefined, [join(root, "empty")]).describe("jira")).toBeNull();
  } finally {
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", saved.dir], ["OUTLINER_RESOURCE_EXTENSIONS", saved.registry]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("ext add copies only references to a secret: a literal value in the old registry is left out", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-ext-add-literal-"));
  const saved = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  try {
    process.env.OUTLINER_EXTENSIONS_DIR = join(root, "extensions");
    process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "resource-extensions.json");
    writeFileSync(join(root, "resource-extensions.json"), JSON.stringify({ version: 1, providers: { jira: {
      manifest: "/opt/example/jira/manifest.json", enabled: true,
      config: { authMode: "basic", email: "someone@example.test" },
      credentials: { token: { env: "EXAMPLE_JIRA_TOKEN" }, pasted: "made-up-literal-secret", nested: { value: "made-up-literal-secret" } },
    } } }));
    await addExtension("jira");
    const written = readFileSync(join(root, "extensions", "jira", "config.json"), "utf8");
    expect(written).not.toContain("made-up-literal-secret");
    expect(JSON.parse(written).secrets).toEqual({ token: { env: "EXAMPLE_JIRA_TOKEN" } });
  } finally {
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", saved.dir], ["OUTLINER_RESOURCE_EXTENSIONS", saved.registry]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

async function installFolder(source: string, root: string) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli.ts"), "ext", "add", source, "--outline-folder", join(root, "outline")], {
    cwd: root,
    env: { ...process.env, EP0CH_OUTLINES: join(root, "outlines"), EP0CH_SOCKET: join(root, "absent.sock"), XDG_CONFIG_HOME: join(root, "config") },
    stdout: "pipe", stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, output: stdout + stderr };
}

for (const problem of ["missing", "without opt-in"] as const) {
  test(`ext add refuses a renamed source folder's script ${problem} before copying`, async () => {
    const root = mkdtempSync(join(tmpdir(), "outliner-ext-script-"));
    try {
      const source = join(root, "download");
      mkdirSync(join(source, "scripts"), { recursive: true });
      writeFileSync(join(source, "extension.json"), JSON.stringify({ contract: 2, id: "garden", name: "Garden", version: 1,
        scripts: [{ name: "water", file: "scripts/water.js", about: "Waters the garden" }] }));
      if (problem === "without opt-in") writeFileSync(join(source, "scripts/water.js"), "return 3;\n");
      const result = await installFolder(source, root);
      expect(result.code).toBe(1);
      expect(result.output).toContain("scripts/water.js");
      expect(result.output).toContain(problem === "missing" ? "restore that file" : "first line of // ep0ch-script");
      expect(existsSync(join(root, "outline/extensions/garden"))).toBe(false);
      writeFileSync(join(source, "scripts/water.js"), "// ep0ch-script\nreturn 3;\n");
      const installed = await installFolder(source, root);
      expect(installed.code).toBe(0);
      expect(installed.output).toContain("installed garden");
      expect(readFileSync(join(root, "outline/extensions/garden/scripts/water.js"), "utf8")).toContain("// ep0ch-script");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("ext add refuses two script names for one file and names both declarations", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-ext-script-names-"));
  try {
    const source = join(root, "garden");
    mkdirSync(join(source, "scripts"), { recursive: true });
    writeFileSync(join(source, "extension.json"), JSON.stringify({ contract: 2, id: "garden", name: "Garden", version: 1,
      scripts: [{ name: "water", file: "scripts/steps.js", about: "Waters the garden" }, { name: "feed", file: "scripts/steps.js", about: "Feeds the garden" }] }));
    writeFileSync(join(source, "scripts/steps.js"), "// ep0ch-script\nreturn 3;\n");
    const result = await installFolder(source, root);
    expect(result.code).toBe(1);
    for (const word of ["water", "feed", "scripts/steps.js", "different file"]) expect(result.output).toContain(word);
    expect(existsSync(join(root, "outline/extensions/garden"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// PIE-1405: the power bar's "install <name>" row reads the extension's own description; one without any read "install Jira".
test("every extension the repo offers says what it is, for the row that installs it", () => {
  const folder = join(import.meta.dir, "..", "extensions");
  const missing = readdirSync(folder).filter(id => existsSync(join(folder, id, "extension.json")))
    .filter(id => !String(JSON.parse(readFileSync(join(folder, id, "extension.json"), "utf8")).description ?? "").trim());
  expect(missing).toEqual([]);
});

async function removeFrom(root: string, args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli.ts"), "ext", "remove", ...args], {
    cwd: root,
    env: { ...process.env, EP0CH_WS: "", EP0CH_OUTLINES: join(root, "outlines"), OUTLINER_EXTENSIONS_DIR: join(root, "user-extensions"),
      EP0CH_SOCKET: join(root, "absent.sock"), XDG_CONFIG_HOME: join(root, "config"), ...env },
    stdout: "pipe", stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, output: stdout + stderr };
}

function outlineCopy(root: string, outline: string, id: string) {
  const dir = join(root, "outlines", outline, "extensions", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "extension.json"), JSON.stringify({ contract: 2, id, name: "Garden", version: 1 }));
  return dir;
}

test("ext remove without --outline-folder takes it from the outline it's run in (EP0CH_WS or .ep0ch)", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-ext-remove-"));
  try {
    mkdirSync(join(root, "user-extensions"));
    const copy = outlineCopy(root, "garden-notes", "garden");
    const result = await removeFrom(root, ["garden"], { EP0CH_WS: "garden-notes" });
    expect(result.output).toContain(`removed ${copy}`);
    expect(result.output).toContain("garden-notes");
    expect(result.code).toBe(0);
    expect(existsSync(copy)).toBe(false);
    // The nearest .ep0ch names it just as well.
    const again = outlineCopy(root, "garden-notes", "garden"), project = join(root, "project");
    mkdirSync(project);
    writeFileSync(join(project, ".ep0ch"), 'ws = "garden-notes"\n');
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli.ts"), "ext", "remove", "garden"], {
      cwd: project, env: { ...process.env, EP0CH_WS: "", EP0CH_OUTLINES: join(root, "outlines"), OUTLINER_EXTENSIONS_DIR: join(root, "user-extensions"),
        EP0CH_SOCKET: join(root, "absent.sock"), XDG_CONFIG_HOME: join(root, "config") }, stdout: "pipe", stderr: "pipe",
    });
    expect(await child.exited).toBe(0);
    expect(existsSync(again)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("ext remove never deletes another outline's copy: it names the command that would", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-ext-remove-"));
  try {
    mkdirSync(join(root, "user-extensions"));
    mkdirSync(join(root, "outlines", "garden-notes"), { recursive: true });
    const other = outlineCopy(root, "orchard", "garden");
    // Cleaning up garden-notes' demos after its folder went must leave orchard's install alone.
    for (const args of [["garden"], ["garden", "--demo", "remove"]]) {
      const result = await removeFrom(root, args, { EP0CH_WS: "garden-notes" });
      expect(result.code).toBe(1);
      expect(result.output).toContain(`ext remove garden --outline-folder ${join(root, "outlines", "orchard")}`);
      expect(existsSync(other)).toBe(true);
    }
    // With no outline named, an outline's copy is still only named, never taken.
    const unnamed = await removeFrom(root, ["garden"]);
    expect(unnamed.code).toBe(1);
    expect(existsSync(other)).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("ext remove of a name nobody has says every folder it looked in", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-ext-remove-"));
  try {
    mkdirSync(join(root, "user-extensions"));
    outlineCopy(root, "garden-notes", "other");
    const result = await removeFrom(root, ["garden"], { EP0CH_WS: "garden-notes" });
    expect(result.code).toBe(1);
    expect(result.output).toContain(join(root, "user-extensions"));
    expect(result.output).toContain(join(root, "outlines", "garden-notes", "extensions"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** `ext …` run from `cwd` on a scratch outlines folder with no service answering (PIE-1548). */
async function extFrom(root: string, cwd: string, args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli.ts"), "ext", ...args], {
    cwd,
    env: { ...process.env, EP0CH_WS: "", EP0CH_MACHINE: "", EP0CH_OUTLINES: join(root, "outlines"), OUTLINER_EXTENSIONS_DIR: join(root, "user-extensions"),
      EP0CH_SOCKET: join(root, "absent.sock"), XDG_CONFIG_HOME: join(root, "config"), ...env },
    stdout: "pipe", stderr: "pipe", stdin: "ignore",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, output: stdout + stderr };
}

/** A folder two levels under the one whose `.ep0ch/config.toml` names `outline`. */
function boundSubfolder(root: string, outline: string, machine?: string): string {
  const project = join(root, "project");
  mkdirSync(join(project, ".ep0ch"), { recursive: true });
  writeFileSync(join(project, ".ep0ch", "config.toml"), `ws = "${outline}"\n${machine ? `machine = "${machine}"\n` : ""}`);
  const deep = join(project, "beds", "north");
  mkdirSync(deep, { recursive: true });
  return deep;
}

function userCopy(root: string, id: string) {
  const dir = join(root, "user-extensions", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "extension.json"), JSON.stringify({ contract: 2, id, name: "Garden", version: 1 }));
  return dir;
}

function withScratch(run: (root: string) => Promise<void>) {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), "outliner-ext-pick-"));
    try {
      mkdirSync(join(root, "user-extensions"));
      await run(root);
    } finally { rmSync(root, { recursive: true, force: true }); }
  };
}

test("ext remove <name> from a subfolder takes the outline's own copy", withScratch(async (root) => {
  const copy = outlineCopy(root, "garden-notes", "garden");
  const result = await extFrom(root, boundSubfolder(root, "garden-notes"), ["remove", "garden"]);
  expect(result.output).toContain(`removed ${copy} (garden-notes's folder)`);
  expect(result.code).toBe(0);
  expect(existsSync(copy)).toBe(false);
}));

test("ext remove falls back to the machine's copy, and --ws names the outline from anywhere", withScratch(async (root) => {
  mkdirSync(join(root, "outlines", "garden-notes"), { recursive: true });
  const user = userCopy(root, "garden");
  const here = boundSubfolder(root, "garden-notes");
  const result = await extFrom(root, here, ["remove", "garden"]);
  expect(result.code).toBe(0);
  expect(result.output).toContain("the user folder");
  expect(existsSync(user)).toBe(false);
  // EP0CH_WS (what `ep0ch --ws` sets) wins over the .ep0ch.
  const orchard = outlineCopy(root, "orchard", "garden");
  expect((await extFrom(root, here, ["remove", "garden"], { EP0CH_WS: "orchard" })).code).toBe(0);
  expect(existsSync(orchard)).toBe(false);
}));

test("ext remove of a copy in both places refuses with both paths and the two commands, then each flag picks", withScratch(async (root) => {
  const own = outlineCopy(root, "garden-notes", "garden"), user = userCopy(root, "garden");
  const here = boundSubfolder(root, "garden-notes");
  const refused = await extFrom(root, here, ["remove", "garden", "--demo", "remove"]);
  expect(refused.code).toBe(1);
  expect(refused.output).toContain(own);
  expect(refused.output).toContain(user);
  const outlineCommand = `ep0ch ext remove garden --outline-folder ${join(root, "outlines", "garden-notes")} --demo remove`;
  const userCommand = "ep0ch ext remove garden --user-folder --demo remove";
  expect(refused.output).toContain(outlineCommand);
  expect(refused.output).toContain(userCommand);
  expect(existsSync(own) && existsSync(user)).toBe(true);
  // The commands it named do what they say, each taking only its own copy.
  expect((await extFrom(root, here, ["remove", "garden", "--user-folder"])).code).toBe(0);
  expect(existsSync(user)).toBe(false);
  expect(existsSync(own)).toBe(true);
  expect((await extFrom(root, here, ["remove", "garden", "--outline-folder", join(root, "outlines", "garden-notes")])).code).toBe(0);
  expect(existsSync(own)).toBe(false);
  // One picks one.
  const both = await extFrom(root, here, ["remove", "garden", "--user-folder", "--outline-folder", join(root, "outlines", "garden-notes")]);
  expect(both.code).toBe(1);
  expect(both.output).toContain("--outline-folder or --user-folder");
}));

test("ext remove of an outline on another machine says so and names the command there", withScratch(async (root) => {
  // Outside agent-env, so the .ep0ch's machine counts (a scratch shell sets it aside).
  const env = { EP0CH_AGENT_ENV: "" };
  const result = await extFrom(root, boundSubfolder(root, "garden-notes", "box-a"), ["remove", "garden"], env);
  expect(result.code).toBe(1);
  expect(result.output).toContain("garden-notes is on box-a");
  expect(result.output).toContain("ssh box-a ep0ch ext remove garden --ws garden-notes");
  expect(result.output).not.toContain("no outline is named");
}));

test("ext update <name> looks where remove does; --all still takes every folder", withScratch(async (root) => {
  const here = boundSubfolder(root, "garden-notes");
  // moon is a real built-in: its copies here are older, so an update refreshes them.
  const copyOf = (dir: string) => { mkdirSync(dir, { recursive: true }); cpSync(join(import.meta.dir, "../extensions/moon"), dir, { recursive: true }); writeFileSync(join(dir, "stray.ts"), "// changed here\n"); return dir; };
  const own = copyOf(join(root, "outlines", "garden-notes", "extensions", "moon"));
  const other = copyOf(join(root, "outlines", "orchard", "extensions", "moon"));
  const named = await extFrom(root, here, ["update", "moon", "--keep-forked", "--json"]);
  expect(named.code).toBe(0);
  expect(JSON.parse(named.output.trim())).toMatchObject([{ id: "moon", where: "garden-notes", dir: own }]);
  // Both places: refused, with the two commands.
  const user = copyOf(join(root, "user-extensions", "moon"));
  const refused = await extFrom(root, here, ["update", "moon", "--yes"]);
  expect(refused.code).toBe(1);
  expect(refused.output).toContain(`ep0ch ext update moon --outline-folder ${join(root, "outlines", "garden-notes")} --yes`);
  expect(refused.output).toContain("ep0ch ext update moon --user-folder --yes");
  expect(refused.output).toContain(user);
  const picked = await extFrom(root, here, ["update", "moon", "--user-folder", "--keep-forked", "--json"]);
  expect(JSON.parse(picked.output.trim())).toMatchObject([{ where: "user", dir: user }]);
  // Only another outline has it, from a folder that names none: named with its command, nothing touched.
  rmSync(user, { recursive: true });
  const elsewhere = await extFrom(root, root, ["update", "moon", "--keep-forked"]);
  expect(elsewhere.code).toBe(1);
  expect(elsewhere.output).toContain(`ep0ch ext update moon --outline-folder ${join(root, "outlines", "orchard")}`);
  expect(elsewhere.output).toContain("ep0ch ext add moon");
  const all = await extFrom(root, here, ["update", "--all", "--keep-forked", "--json"]);
  expect(JSON.parse(all.output.trim()).map((copy: { where: string }) => copy.where).sort()).toEqual(["garden-notes", "orchard"]);
  expect(existsSync(other)).toBe(true);
}));

// In process: a spawned CLI per flag (14 of them) took the whole 5 s budget at normal load (PIE-1692). One spawn
// still shows the real `ep0ch ext` reaches the same parser.
test("every flag ext remove and ext update list parses, and a flag not listed is refused", withScratch(async (root) => {
  for (const [verb, name] of [["remove", "absent"], ["update", "moon"], ["add", "absent"]] as const) {
    for (const flag of EXT_FLAGS[verb]) {
      const args = [verb, name, `--${flag.name}`, ...(flag.value ? [flag.name === "demo" ? "keep" : join(root, "nowhere")] : [])];
      if (flag.name === "all") args.splice(1, 1);
      expect(await extHere(root, args)).not.toContain("Unknown option");
    }
    expect(await extHere(root, [verb, name, "--no-such-flag"])).toContain("Unknown option");
  }
  expect((await extFrom(root, root, ["remove", "absent", "--no-such-flag"])).output).toContain("Unknown option");
}));

/** `ext …` as extFrom runs it, in this process: its output, with no service answering. */
async function extHere(root: string, args: string[]): Promise<string> {
  const env = { EP0CH_WS: "", EP0CH_MACHINE: "", EP0CH_OUTLINES: join(root, "outlines"), OUTLINER_EXTENSIONS_DIR: join(root, "user-extensions"),
    EP0CH_SOCKET: join(root, "absent.sock"), XDG_CONFIG_HOME: join(root, "config") };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  const cwd = process.cwd(), log = console.log, error = console.error;
  const output: string[] = [];
  Object.assign(process.env, env);
  process.chdir(root);
  console.log = console.error = (...parts: unknown[]) => { output.push(parts.join(" ")); };
  try {
    await runExtCommand(args, async () => null);
  } finally {
    console.log = log; console.error = error;
    process.chdir(cwd);
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  return output.join("\n");
}

// PIE-1620, seen on a running scratch host: `ext add --outline-folder` asked the service of the outline this shell names,
// so the folder's own outline loaded the rule on its watcher's time. A note written in that gap became the rule's baseline
// and never started it.
test("ext add --outline-folder has that folder's outline load the extension before it returns, whichever outline the shell names", async () => {
  const root = mkdtempSync(join(tmpdir(), "ext-add-live-"));
  const outlines = join(root, "outlines");
  const env = { ...process.env, EP0CH_OUTLINES: outlines, XDG_CONFIG_HOME: join(root, "config"), EP0CH_DEFAULT_WS: "elsewhere", EP0CH_WS: "elsewhere", OUTLINER_EXTENSIONS_DIR: join(root, "user-extensions"), OUTLINER_RESOURCE_EXTENSIONS: join(root, "no-registry.json") };
  const main = join(import.meta.dir, "../../door/src/main.ts");
  const host = Bun.spawn([process.execPath, join(import.meta.dir, "../src/host-main.ts")], { cwd: root, env, stdout: "ignore", stderr: "ignore" });
  const run = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, main, ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, out, err };
  };
  try {
    for (const name of ["elsewhere", "yard"]) {
      const end = Date.now() + 15_000;
      for (;;) {
        const made = await run("outline", "create", name);
        if (made.code === 0) break;
        if (Date.now() > end) throw new Error(made.err);
        await Bun.sleep(100);
      }
    }
    const added = await run("ext", "add", "asks", "--outline-folder", join(outlines, "yard"));
    expect(added).toMatchObject({ code: 0 });
    expect(added.out).toContain("service: asks is active");
  } finally {
    host.kill();
    await host.exited;
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

// PIE-1737: removing an extension took its settings with it, so a reinstall was silently back on its defaults. They are
// kept beside the folder (as a fork is) and a reinstall takes them back, saying so.
test("a removed extension's settings come back when it is installed again, and both answers say so (PIE-1737)", async () => {
  // Its socket goes under the root: scratchDir, short under agent-env's long TMPDIR (PIE-1654).
  const root = scratchDir("outliner-ext-settings-");
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-registry.json");
  const outline = join(root, "outline"), socket = join(root, "outline.sock");
  mkdirSync(outline);
  const store = new OutlinerStore(join(root, "outline.sqlite"), { workspaceRoot: outline });
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state") });
  await server.start();
  const client = new OutlinerClient(socket);
  try {
    const installed = await client.request<{ page?: string }>({ action: "extensions.install", extension: "tidy", where: "outline" });
    // Its demo's ask was written by the extension: it waits for a person's R, never spending a model call on install.
    const demo = store.children(installed.page!).find(block => block.text.startsWith("Tidy, on a made-up garden meeting"))!;
    expect(demo.text).toContain("\n@tidy clean up the transcript");
    await Bun.sleep(300);
    expect(store.agentRequests(demo.id).map(row => [row.status, row.message])).toEqual([["waiting", "held: tidy's demo · ask again to send"]]);
    // An agent's r doesn't send it either (CodeRabbit on #1437): only a person's.
    const line = demo.text.split("\n").indexOf("@tidy clean up the transcript");
    await expect(client.request({ action: "resources.projection.refresh", blockId: demo.id, line, mutation: { author: "agent", actorId: "loki" } })).rejects.toThrow("waits for a person's r");
    const config = join(outline, "extensions", "tidy", "config.json");
    const settings = `${JSON.stringify({ config: { answer: ["/opt/made-up/model", "--slow"] } }, null, 2)}\n`;
    writeFileSync(config, settings, { mode: 0o600 });
    const removed = await client.request<{ lines: string[]; settingsKept?: string }>({ action: "extensions.uninstall", extension: "tidy", demo: "remove" });
    expect(existsSync(join(outline, "extensions", "tidy"))).toBe(false);
    const kept = join(outline, "extensions-settings", "tidy.json");
    expect(removed.settingsKept).toBe(kept);
    expect(readFileSync(kept, "utf8")).toBe(settings);
    expect(statSync(kept).mode & 0o077).toBe(0);
    expect(removed.lines.join("\n")).toContain(`kept its settings in ${kept}`);
    const back = await client.request<{ lines: string[]; settingsBack?: string }>({ action: "extensions.install", extension: "tidy", where: "outline" });
    expect(back.settingsBack).toBe(kept);
    expect(readFileSync(config, "utf8")).toBe(settings);
    expect(statSync(config).mode & 0o077).toBe(0);
    expect(existsSync(kept)).toBe(false);
    expect(back.lines.join("\n")).toContain(`took its settings back from ${kept}`);
  } finally {
    await server.close(); store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
