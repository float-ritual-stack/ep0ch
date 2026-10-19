import { afterAll, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setupCommand } from "../src/setup/apply";

const scratch = mkdtempSync(join(tmpdir(), "setup-secrets-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const source = resolve(import.meta.dir, "../scripts/with-secrets");

for (const platform of ["linux", "darwin"]) for (const state of ["missing", "old", "current", "newer", "wrong-mode"]) {
  test(`${platform} install makes ${state} with-secrets current and doctor explains the fix`, async () => {
    const home = join(scratch, platform, state), repo = join(home, "repo");
    const shipped = join(repo, "packages/door/scripts/with-secrets"), installed = join(home, ".local/bin/with-secrets");
    mkdirSync(dirname(shipped), { recursive: true });
    mkdirSync(dirname(installed), { recursive: true });
    copyFileSync(source, shipped);
    const mod = join(repo, "packages/outliner/scripts/install-claude-mod.ts");
    mkdirSync(dirname(mod), { recursive: true }); writeFileSync(mod, "process.exit(0);\n");
    if (state === "current") { copyFileSync(source, installed); chmodSync(installed, 0o755); }
    if (state === "old") writeFileSync(installed, "#!/bin/bash\necho 'usage: with-secrets group -- command' >&2\nexit 2\n", { mode: 0o755 });
    if (state === "newer") writeFileSync(installed, readFileSync(source, "utf8").replace("# with-secrets v1", "# with-secrets v2"), { mode: 0o755 });
    if (state === "newer") chmodSync(installed, 0o755);
    if (state === "wrong-mode") { copyFileSync(source, installed); chmodSync(installed, 0o644); }
    const before = state === "current" || state === "newer" ? statSync(installed).mtimeMs : undefined;
    const lines: string[] = [];
    const io = { repoRoot: repo, cwd: home, platform, env: { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, EP0CH_OUTLINES: join(home, "outlines"), EP0CH_STATE: join(home, "state"), XDG_CONFIG_HOME: join(home, ".config") }, out: (s: string) => lines.push(s), err: (s: string) => lines.push(s) };
    await setupCommand(["doctor", "--json"], io);
    const checks = JSON.parse(lines.at(-1)!).checks;
    lines.length = 0;
    expect(await setupCommand(["install", "--apply", "--json"], io)).toBe(0);
    expect(readFileSync(installed, "utf8")).toBe(state === "newer" ? readFileSync(source, "utf8").replace("# with-secrets v1", "# with-secrets v2") : readFileSync(source, "utf8"));
    expect(statSync(installed).mode & 0o777).toBe(0o755);
    if (before !== undefined) expect(statSync(installed).mtimeMs).toBe(before);
    expect(checks.find((c: any) => c.name === "with-secrets")).toMatchObject((state === "current" || state === "newer") ? { status: "ok" } : { status: state === "missing" ? "missing" : "behind", fix: "ep0ch install --apply" });
    expect(lines.join("\n")).toContain("with-secrets");
  }, 30_000);
}
