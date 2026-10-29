// `outliner ext add` (wave A): copies a built-in into the user folder and seeds config.json from an
// existing resource-extensions.json entry. Made-up paths and names only.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addExtension } from "../src/extension-install";
import { ResourceExtensionRuntime } from "../src/resource-extensions";

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
