// `outliner ext add` (wave A): copies a built-in into the user folder and seeds config.json from an
// existing resource-extensions.json entry. Made-up paths and names only.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addExtension } from "../src/extension-install";
import { ResourceExtensionRuntime } from "../src/resource-extensions";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, ChangeFeedPage } from "../src/types";
import type { RuleListEntry } from "../src/extension-rules";

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
    expect(await cli("rm", "intake", "--demo", "remove")).toContain("2 rules switched off");
    expect(store.require(rule.id).text).toContain("[rule-was-on::intake/prior-art]");
    expect(store.require(own.id).text).toContain("[rule-was-on::intake/prior-art]");
    expect(store.require(quoted.id).text).toBe(quoted.text);
    expect(await cli("install", "intake")).toContain("2 rules switched back on");
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
