// An install run by the machine link sees the person's PATH (PIE-1243): the link agent (a launchd plist on a Mac, a
// systemd user unit on Linux) carries the PATH of the install that wrote it, and a tool that is still missing says
// which PATH was checked. Made-up homes and PATHs only.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkInstallStep } from "../src/setup/link";
import { backupsStep, linkStep, pluginStep } from "../src/setup/plan";
import { gatherFacts } from "../src/setup/facts";
import type { Facts } from "../src/setup/model";

const scratch = mkdtempSync(join(tmpdir(), "ep0ch-install-path-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const PERSON = ["/opt/example/bin", "/Users/wren/.local/bin", "/usr/bin", "/bin"];
const LAUNCHD = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

/** Just what the link step reads: a connector on a Mac (or Linux) with bun, its home in the scratch folder. */
function connector(o: { platform?: "macos" | "linux"; pathDirs?: string[]; home?: string } = {}): Facts {
  const home = o.home ?? join(scratch, "home-" + Math.random().toString(36).slice(2));
  return {
    platform: o.platform ?? "macos", home, pathDirs: o.pathDirs ?? PERSON,
    bun: { path: "/opt/example/bin/bun", version: "1.4.2" },
    repo: { entry: "/Users/wren/projects/ep0ch/packages/door/src/main.ts" },
    host: { folder: "/Users/wren/outlines" },
    linkConfig: { mode: "connect", server: "https://link.example.test", machine: "laptop" },
    linkState: { running: true, enabled: true, loaded: true },
  } as unknown as Facts;
}

const written = (f: Facts) => linkInstallStep(f, false)!.writes![0]!.text;

describe("the link agent carries the installing person's PATH", () => {
  test("launchd: the plist's environment holds PATH beside EP0CH_OUTLINES", () => {
    expect(written(connector())).toContain("<key>EnvironmentVariables</key><dict><key>EP0CH_OUTLINES</key><string>/Users/wren/outlines</string><key>PATH</key><string>/opt/example/bin:/Users/wren/.local/bin:/usr/bin:/bin</string></dict>");
  });

  test("systemd: the unit has an Environment line for PATH", () => {
    expect(written(connector({ platform: "linux", pathDirs: ["/home/wren/.local/bin", "/usr/bin"] }))).toContain('Environment="PATH=/home/wren/.local/bin:/usr/bin"\n');
  });

  test("an install with another PATH rewrites the agent and reloads it; the same PATH leaves it alone", () => {
    const home = join(scratch, "rewrite");
    const before = connector({ home, pathDirs: LAUNCHD });
    const file = join(home, "Library/LaunchAgents/io.ep0ch.link.plist");
    mkdirSync(join(home, "Library/LaunchAgents"), { recursive: true });
    writeFileSync(file, written(before));
    expect(linkInstallStep(before, false)).toMatchObject({ status: "skip" });
    const step = linkInstallStep(connector({ home }), false)!;
    expect(step.status).toBe("do");
    expect(step.writes![0]!.text).toContain("<key>PATH</key><string>/opt/example/bin:/Users/wren/.local/bin:/usr/bin:/bin</string>");
    expect(step.commands[0]).toBe("launchctl bootout gui/$(id -u)/io.ep0ch.link");
  });
});

describe("an install's facts read the PATH it was given", () => {
  /** A made-up machine: Herdr, restic and with-secrets in a Homebrew-like bin, none of them in /usr/bin or /bin. */
  const home = join(scratch, "wren"), brew = join(scratch, "brew/bin");
  mkdirSync(brew, { recursive: true });
  const tool = (name: string, body: string) => { writeFileSync(join(brew, name), `#!/bin/sh\n${body}\n`); chmodSync(join(brew, name), 0o755); };
  tool("herdr", 'case "$1" in --version) echo "herdr 0.9.1";; status) echo \'{"running":false}\';; *) exit 1;; esac');
  tool("restic", 'echo "restic 0.17.3"');
  tool("with-secrets", 'echo "restic"; echo "backup"');
  const env = (PATH: string) => ({ HOME: home, PATH, EP0CH_OUTLINES: join(home, "outlines"), EP0CH_STATE: join(home, "state"), EP0CH_CONTROL: join(home, "state/control.sock"), EP0CH_BACKUP_MACHINE: "laptop" });
  const facts = (PATH: string) => gatherFacts({ env: env(PATH), fetch: false, platform: "linux", cwd: home });

  test("the agent's PATH (the person's): Herdr, restic and with-secrets are found", async () => {
    const f = await facts(`${brew}:/usr/bin:/bin`);
    expect(f.herdr.path).toBe(join(brew, "herdr"));
    expect(f.restic?.restic).toBe(join(brew, "restic"));
    expect(f.restic?.groups).toEqual(["restic", "backup"]);
    expect(pluginStep(f).why).not.toContain("isn't installed");
  }, 60_000);

  test("launchd's bare PATH: each missing tool says which PATH was checked", async () => {
    const f = await facts("/usr/bin:/bin");
    expect(f.herdr.path).toBeNull();
    expect(pluginStep(f)).toMatchObject({ status: "manual", why: expect.stringContaining("Herdr isn't installed (checked PATH=/usr/bin:/bin)") });
    const backups = backupsStep({ ...f, databases: [{ name: "garden", path: join(home, "outlines/garden.sqlite") }] })!;
    expect(backups.why).toContain("restic isn't installed");
    expect(backups.why).toContain("with-secrets isn't on PATH");
    expect(backups.why).toEndWith("; checked PATH=/usr/bin:/bin");
    const link = linkStep({ ...f, ep0ch: { found: null, target: null, pointsHere: false }, linkDirs: f.linkDirs.map(d => ({ ...d, onPath: false })) });
    expect(link).toMatchObject({ status: "manual", why: expect.stringContaining("(checked PATH=/usr/bin:/bin; install never uses sudo)") });
  }, 60_000);
});
