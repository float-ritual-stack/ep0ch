// `ep0ch doctor` and `ep0ch install` (PIE-450): the plan and the report from described machines (no real
// stack is read), the platform, the host unit, the PATH link chooser, backup naming, and the read-only probes on
// scratch files. Nothing here touches a real outline, Herdr, unit or checkout.
//
// The stack is one checkout (the ep0ch repo) and one outline host serving `<outlines>/<name>.sqlite` (PIE-530).
import { ep0ch } from "../src/session/place";
import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { backupDatabase, formatPlan, handoverLines, hostReady, hostVerb, linkSummary, migrationRecovery, outlinesToMigrate, setupCommand, tilde } from "../src/setup/apply";
import { applyLinks } from "../src/setup/links";
import { skillLinkFacts } from "../src/setup/skill-links";
import { extFacts } from "../src/setup/ext-links";
import { PROTOCOL } from "@ep0ch/outline-core/protocol";
import { doctorChecks, formatDoctor, MARK, skillChecks, versionAtLeast } from "../src/setup/doctor";
import { claudeModIn, databases, depsState, fetchRace, herdrKeys, hostAnswers, hostFacts, hostUnit, launchdState, doorOfShown, mcpUnits, movedSince, openOutlineToPing, outlineSchema, schemaCodeOf, startFromElapsed, systemdState } from "../src/setup/facts";
import { type Checkout, detectPlatform, type Facts, type HostFacts, type HostUnit, type McpFacts, type SessionFact, staleness } from "../src/setup/model";
import { backupName, buildPlan, checkoutStep, chooseLinkDir, extStep, skillsStep, hostStep, hostUnitArgv, linkCandidates, mcpStep, type PlanOptions, stamp, unitChanges } from "../src/setup/plan";

const scratch = mkdtempSync(join(tmpdir(), "ep0ch-setup-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const HOME = "/Users/wren";
const REPO = `${HOME}/projects/ep0ch`;
const now = new Date("2026-03-14T09:26:53.589Z");
const opts = (o: Partial<PlanOptions> = {}): PlanOptions => ({ now, backupDir: `${HOME}/backups/ep0ch`, ...o });

const checkout = (root: string, o: Partial<Checkout> = {}): Checkout =>
  ({ root, git: true, branch: "main", head: "1111111aaaa", upstream: "1111111aaaa", ahead: 0, behind: 0, dirty: false, ...o });

const launchd: HostUnit = { kind: "launchd", path: `${HOME}/Library/LaunchAgents/io.ep0ch.outliner-host.plist`, name: "io.ep0ch.outliner-host",
  program: `${REPO}/packages/outliner/src/host-main.ts`, outlines: `${HOME}/outlines`, stale: [],
  state: { active: true, pid: 4242, lastExit: "(never exited)", detail: "launchd: running, pid 4242" } };

const host = (o: Partial<HostFacts> = {}): HostFacts => ({ folder: `${HOME}/outlines`, socket: `${HOME}/outlines/.host/host.sock`, running: true,
  outlines: [{ name: "float-hub", database: `${HOME}/outlines/float-hub.sqlite`, folder: `${HOME}/outlines/float-hub`, open: true }], protocol: PROTOCOL, unit: launchd, ...o });

/** A Homebrew Mac: the checkout 9 behind, Herdr's managed plugin behind, no ep0ch on PATH, its host under launchd. */
function laptop(o: Partial<Facts> = {}): Facts {
  const pluginRoot = `${HOME}/.config/herdr/plugins/github/float.pi-outliner-0a1b2c`;
  return {
    platform: "macos", home: HOME, pathDirs: ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"],
    bun: { path: "/opt/homebrew/bin/bun", version: "1.4.2" },
    herdr: { path: "/opt/homebrew/bin/herdr", version: "0.9.1", server: true, configPath: `${HOME}/.config/herdr/config.toml`,
      keys: { "open-here": "prefix+u", "open-tree": "prefix+shift+u", "comment-selection": "prefix+shift+a", capture: "prefix+shift+c" } },
    plugin: { id: "float.pi-outliner", kind: "github", root: pluginRoot, manifestPath: `${pluginRoot}/herdr-plugin.toml`, enabled: true,
      source: { owner: "float-ritual-stack", repo: "ep0ch", ref: "main", commit: "239aaaa0000" }, checkout: null,
      remote: { commit: "246bbbb0000" }, protocol: PROTOCOL, deps: { needed: false, why: "ok" }, actions: ["open-here", "open-tree", "comment-selection", "capture", "open"] },
    repo: { root: REPO, checkout: checkout(REPO, { head: "40aaaaa", upstream: "49bbbbb", behind: 9 }), deps: { needed: false, why: "ok" },
      entry: `${REPO}/packages/door/src/main.ts`, door: `${REPO}/packages/door`, outliner: `${REPO}/packages/outliner`,
      claudeMod: `${REPO}/packages/claude-mod`, claudeModInstaller: `${REPO}/packages/claude-mod/scripts/install-claude-mod.ts`, protocol: PROTOCOL },
    ep0ch: { found: null, target: null, pointsHere: false },
    linkDirs: [{ dir: `${HOME}/.local/bin`, onPath: false, writable: false }, { dir: "/opt/homebrew/bin", onPath: true, writable: true }, { dir: "/usr/local/bin", onPath: true, writable: false }],
    host: host(),
    databases: [{ name: "float-hub", path: `${HOME}/outlines/float-hub.sqlite` }],
    claude: { settingsPath: `${HOME}/.claude/settings.json`, settingsDirs: [`${REPO}/packages/claude-mod`], envDirs: null },
    ...o,
  };
}

/** The same machine once everything is current. */
function current(): Facts {
  const f = laptop();
  return { ...f, plugin: { ...f.plugin!, remote: { commit: "239aaaa0000" } }, repo: { ...f.repo, checkout: checkout(REPO) },
    ep0ch: { found: "/opt/homebrew/bin/ep0ch", target: f.repo.entry, pointsHere: true } };
}

/**
 * float-2 right after the move to one repo: the plugin linked to the new checkout, but the host's systemd unit still
 * from before (the old checkout's host-main.ts, OUTLINER_STATE_DIR and OUTLINER_DEFAULT_OUTLINE), and `ep0ch` on
 * PATH still the old ep0ch-door checkout's link.
 */
function float2(): Facts {
  const home = "/home/evan", repo = `${home}/projects/ep0ch`;
  const f = current();
  const unit: HostUnit = { kind: "systemd", path: `${home}/.config/systemd/user/outliner-host.service`, name: "outliner-host.service",
    program: `${home}/projects/pi-herdr-outliner/src/host-main.ts`, outlines: `${home}/outlines`, stale: ["OUTLINER_STATE_DIR", "OUTLINER_DEFAULT_OUTLINE"],
    state: { active: true, pid: 77, detail: "systemd: active (running), pid 77" } };
  return {
    ...f, platform: "linux", home,
    plugin: { ...f.plugin!, kind: "local", root: `${repo}/packages/outliner`, source: undefined, remote: undefined, checkout: checkout(repo) },
    repo: { ...f.repo, root: repo, checkout: checkout(repo), entry: `${repo}/packages/door/src/main.ts`, door: `${repo}/packages/door`, outliner: `${repo}/packages/outliner`,
      claudeMod: `${repo}/packages/claude-mod`, claudeModInstaller: `${repo}/packages/claude-mod/scripts/install-claude-mod.ts` },
    ep0ch: { found: `${home}/.local/bin/ep0ch`, target: `${home}/projects/ep0ch-door/src/main.ts`, pointsHere: false },
    linkDirs: [{ dir: `${home}/.local/bin`, onPath: true, writable: true, existing: "link" }],
    host: host({ folder: `${home}/outlines`, socket: `${home}/outlines/.host/host.sock`, unit,
      outlines: [{ name: "pie", database: `${home}/outlines/pie.sqlite`, folder: `${home}/outlines/pie`, open: true }] }),
    databases: [{ name: "pie", path: `${home}/outlines/pie.sqlite` }],
    claude: { settingsPath: `${home}/.claude/settings.json`, settingsDirs: [`${repo}/packages/claude-mod`], envDirs: null },
  };
}

const statuses = (f: Facts, o = opts()) => buildPlan(f, o).steps.map(s => `${s.id}:${s.status}`);

describe("platform and the host unit", () => {
  test("linux and darwin by name; anything else is other, and nothing assumes systemd or launchd", () => {
    expect(detectPlatform("linux")).toBe("linux");
    expect(detectPlatform("darwin")).toBe("macos");
    expect(detectPlatform("win32")).toBe("other");
  });

  test("the host unit is looked for where the platform keeps them, by what it runs and the outlines folder it serves", () => {
    const home = join(scratch, "unit-home");
    mkdirSync(join(home, ".config/systemd/user"), { recursive: true });
    mkdirSync(join(home, "Library/LaunchAgents"), { recursive: true });
    writeFileSync(join(home, ".config/systemd/user/compost.service"), "[Service]\nExecStart=/usr/bin/true\n");
    writeFileSync(join(home, ".config/systemd/user/garden-host.service"), "[Service]\nExecStart=bun /opt/ep0ch/packages/outliner/src/host-main.ts\n");
    writeFileSync(join(home, "Library/LaunchAgents/io.example.garden.plist"), "<key>Label</key><string>io.example.garden-host</string>\n<array><string>/opt/homebrew/bin/bun</string><string>/opt/ep0ch/packages/outliner/src/host-main.ts</string></array>");
    expect(hostUnit("linux", home)).toEqual({ kind: "systemd", path: join(home, ".config/systemd/user/garden-host.service"), name: "garden-host.service",
      program: "/opt/ep0ch/packages/outliner/src/host-main.ts", outlines: join(home, "outlines"), stale: [] });
    // launchd names a job by its Label, not its file.
    expect(hostUnit("macos", home)).toMatchObject({ kind: "launchd", name: "io.example.garden-host", outlines: join(home, "outlines"), stale: [] });
    expect(hostUnit("other", home)).toBeNull();
  });

  test("only a unit serving the asked outlines folder is the host's: another folder's is another host, never restarted for this one", () => {
    const home = join(scratch, "unit-folder-home");
    const dir = join(home, ".config/systemd/user");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "orchard-host.service"), "[Service]\nEnvironment=EP0CH_OUTLINES=%h/orchard-outlines\nExecStart=bun /opt/ep0ch/packages/outliner/src/host-main.ts\n");
    // A scratch folder (a test's host): no unit serves it.
    expect(hostUnit("linux", home, join(scratch, "scratch-outlines"))).toBeNull();
    // ~/outlines: this unit serves another folder, so it isn't that host's either.
    expect(hostUnit("linux", home)).toBeNull();
    expect(hostUnit("linux", home, join(home, "orchard-outlines"))?.name).toBe("orchard-host.service");
    const mac = join(scratch, "unit-folder-mac");
    mkdirSync(join(mac, "Library/LaunchAgents"), { recursive: true });
    writeFileSync(join(mac, "Library/LaunchAgents/io.example.orchard.plist"), `<key>Label</key><string>io.example.orchard</string><key>EnvironmentVariables</key><dict><key>EP0CH_OUTLINES</key><string>${mac}/orchard/</string></dict><array><string>/opt/ep0ch/packages/outliner/src/host-main.ts</string></array>`);
    expect(hostUnit("macos", mac, join(mac, "orchard"))?.name).toBe("io.example.orchard");
    expect(hostUnit("macos", mac)).toBeNull();
  });

  test("a unit from before outlines by name: it serves ~/outlines by default, and what it still sets is listed", () => {
    const home = join(scratch, "unit-old-home");
    const dir = join(home, ".config/systemd/user");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "outliner-host.service"), [
      "[Service]", "WorkingDirectory=/home/wren/projects/pi-herdr-outliner", "Environment=OUTLINER_STATE_DIR=%h/.local/state/pi-herdr-outliner",
      "Environment=OUTLINER_DEFAULT_OUTLINE=orchard", "ExecStart=/usr/bin/bun /home/wren/projects/pi-herdr-outliner/src/host-main.ts", ""].join("\n"));
    expect(hostUnit("linux", home)).toMatchObject({ name: "outliner-host.service", program: "/home/wren/projects/pi-herdr-outliner/src/host-main.ts",
      outlines: join(home, "outlines"), stale: ["OUTLINER_STATE_DIR", "OUTLINER_DEFAULT_OUTLINE"] });
  });
});

describe("the PATH link chooser", () => {
  test("the first candidate that is on PATH and writable: Homebrew's bin on a Mac without ~/.local/bin on PATH", () => {
    expect(chooseLinkDir(laptop().linkDirs)).toBe("/opt/homebrew/bin");
  });
  test("~/.local/bin first when it is on PATH and writable", () => {
    expect(chooseLinkDir([{ dir: "/home/wren/.local/bin", onPath: true, writable: true }, { dir: "/usr/local/bin", onPath: true, writable: true }])).toBe("/home/wren/.local/bin");
  });
  test("writable but off PATH, or on PATH but not writable, doesn't count; none means null (never sudo)", () => {
    expect(chooseLinkDir([{ dir: "/a", onPath: false, writable: true }, { dir: "/b", onPath: true, writable: false }])).toBeNull();
  });
  test("the candidates, in order", () => {
    expect(linkCandidates("/home/wren")).toEqual(["/home/wren/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"]);
  });
});

describe("backup naming", () => {
  test("one folder per run, named by its UTC time; each outline by its name", () => {
    expect(stamp(now)).toBe("20260314T092653Z");
    expect(backupName("float-hub", now)).toBe("20260314T092653Z/float-hub.sqlite");
  });
});

describe("the plan", () => {
  test("a behind laptop: backup first, then the checkout, the managed plugin and the link; the host restarts on the new code", () => {
    const plan = buildPlan(laptop(), opts());
    expect(plan.steps.map(s => `${s.id}:${s.status}`)).toEqual(["backup:do", "repo:do", "plugin:do", "link:do", "host:do", "session:skip"]);
    const [backup, repo, plugin, link, hostRestart] = plan.steps;
    expect(backup!.backups!.map(b => b.dest)).toEqual([`${HOME}/backups/ep0ch/20260314T092653Z/float-hub.sqlite`]);
    expect(repo!.commands[0]).toBe(`git -C ${REPO} pull --ff-only origin main`);
    expect(repo!.why).toContain("9 commits behind");
    expect(plugin!.commands).toEqual(["herdr plugin install float-ritual-stack/ep0ch/packages/outliner --ref main --yes"]);
    expect(link!.commands).toEqual([`ln -s ${REPO}/packages/door/src/main.ts /opt/homebrew/bin/ep0ch`]);
    expect(hostRestart!.commands).toEqual(["launchctl kickstart -k gui/$(id -u)/io.ep0ch.outliner-host"]);
    expect(hostRestart!.why).toContain("the ep0ch checkout is updated in this run");
  });

  test("everything current: every step skipped, the backup too (a second run does nothing)", () => {
    expect(statuses(current())).toEqual(["backup:skip", "repo:skip", "plugin:skip", "link:skip", "host:skip", "session:skip"]);
  });

  test("float-2 after the move: the unit is the person's to change (install never edits it), and the old ep0ch link is pointed here", () => {
    const f = float2();
    const plan = buildPlan(f, opts({ backupDir: "/home/evan/backups/ep0ch" }));
    expect(plan.steps.map(s => `${s.id}:${s.status}`)).toEqual(["backup:do", "repo:skip", "plugin:skip", "link:do", "host:manual", "session:skip"]);
    expect(plan.steps[0]!.backups!.map(b => `${b.path} → ${b.dest}`)).toEqual(["/home/evan/outlines/pie.sqlite → /home/evan/backups/ep0ch/20260314T092653Z/pie.sqlite"]);
    expect(plan.steps[2]!.why).toBe("linked to /home/evan/projects/ep0ch/packages/outliner: updated with the ep0ch checkout");
    expect(plan.steps[3]!.commands).toEqual(["ln -sfn /home/evan/projects/ep0ch/packages/door/src/main.ts /home/evan/.local/bin/ep0ch"]);
    const change = unitChanges(f)!;
    expect(change).toContain("ExecStart=<bun> /home/evan/projects/ep0ch/packages/outliner/src/host-main.ts and WorkingDirectory=/home/evan/projects/ep0ch/packages/outliner");
    expect(change).toContain("drop OUTLINER_STATE_DIR");
    expect(change).toContain("drop OUTLINER_DEFAULT_OUTLINE");
    expect(change).toEndWith("then systemctl --user daemon-reload && systemctl --user restart outliner-host.service");
    expect(plan.steps[4]!.why).toContain(change);
  });

  test("a plugin linked to the old checkout, or managed from the old repo: relinked by the person, with the commands", () => {
    const f = float2();
    f.plugin = { ...f.plugin!, root: "/home/evan/projects/pi-herdr-outliner" };
    expect(buildPlan(f, opts()).steps[2]).toMatchObject({ status: "manual",
      commands: ["herdr plugin unlink float.pi-outliner", "herdr plugin link /home/evan/projects/ep0ch/packages/outliner --enabled"] });
    const old = laptop({ plugin: { ...laptop().plugin!, source: { owner: "float-ritual-stack", repo: "pi-herdr-outliner", ref: "main", commit: "239aaaa0000" } } });
    const step = buildPlan(old, opts()).steps[2]!;
    expect(step.status).toBe("manual");
    expect(step.commands[0]).toBe("herdr plugin install float-ritual-stack/ep0ch/packages/outliner --ref main --yes");
  });

  test("a managed install Herdr can't compare is left to the person, with the refresh command; another ref is refreshed from main", () => {
    const f = laptop({ plugin: { ...laptop().plugin!, remote: { commit: null, error: "could not resolve host" } } });
    expect(buildPlan(f, opts()).steps[2]).toMatchObject({ status: "manual", why: expect.stringContaining("managed, cannot compare (could not resolve host)") });
    const pr = laptop({ plugin: { ...laptop().plugin!, source: { owner: "float-ritual-stack", repo: "ep0ch", ref: "pr-239", commit: "239aaaa0000" } } });
    expect(buildPlan(pr, opts()).steps[2]!.why).toContain("installed from pr-239, refreshed from main");
  });

  test("a checkout: fast-forward, bun install when needed, and the cases a person must handle", () => {
    const root = "/home/wren/src/ep0ch";
    expect(checkoutStep(checkout(root, { behind: 3 }), null, "x").commands[0]).toBe(`git -C ${root} pull --ff-only origin main`);
    expect(checkoutStep(checkout(root), { needed: true, why: "node_modules is missing" }, "x")).toMatchObject({ status: "do", commands: [`(cd ${root} && bun install --frozen-lockfile)`] });
    expect(checkoutStep(checkout(root, { branch: "sketch" }), null, "x").status).toBe("manual");
    expect(checkoutStep(checkout(root, { branch: null }), null, "x").why).toContain("detached");
    expect(checkoutStep(checkout(root, { ahead: 1, behind: 2 }), null, "x").why).toContain("diverged");
    expect(checkoutStep(checkout(root, { behind: 2, dirty: true }), null, "x").why).toContain("local changes");
    expect(checkoutStep(checkout(root, { ahead: 2 }), null, "x")).toMatchObject({ status: "skip" });
    expect(checkoutStep(checkout(root, { git: false }), null, "x").status).toBe("manual");
    expect(checkoutStep(checkout(root, { behind: 1, fetchError: "offline" }), null, "x").why).toContain("this one failed: offline");
  });

  test("ep0ch: another checkout's link outside install's directories, a stranger on PATH, or no writable directory needs the person", () => {
    const other = laptop({ ep0ch: { found: "/usr/local/bin/ep0ch", target: "/Users/wren/old/ep0ch-door/src/main.ts", pointsHere: false } });
    expect(buildPlan(other, opts()).steps[3]).toMatchObject({ status: "manual", why: expect.stringContaining("ln -sfn") });
    const stranger = laptop({ ep0ch: { found: "/usr/local/bin/ep0ch", target: "/usr/local/bin/ep0ch", pointsHere: false } });
    expect(buildPlan(stranger, opts()).steps[3]!.status).toBe("manual");
    const nowhere = laptop({ linkDirs: laptop().linkDirs.map(d => ({ ...d, writable: false })) });
    expect(buildPlan(nowhere, opts()).steps[3]!.why).toContain("never uses sudo");
    const broken = laptop({ linkDirs: [{ dir: "/opt/homebrew/bin", onPath: true, writable: true, existing: "broken-link" }] });
    expect(buildPlan(broken, opts()).steps[3]!.commands).toEqual([`ln -sfn ${REPO}/packages/door/src/main.ts /opt/homebrew/bin/ep0ch`]);
  });

  test("the dry run prints each step with its mark and command", () => {
    const f = laptop();
    const text = formatPlan(f, buildPlan(f, opts()), false);
    expect(text).toContain("dry run");
    expect(text).toMatch(/^1 → Back up every outline$/m);
    expect(text).toContain(`into ${HOME}/backups/ep0ch/20260314T092653Z\n    float-hub\n`);
    expect(text).toMatch(/^2 → Update the ep0ch checkout$/m);
  });

  test("the dry run says the backup folders once and the outlines by name; the sessions to hand over as a table", () => {
    const f = laptop({
      databases: ["bbs", "boops", "float-hub"].map(name => ({ name, path: `${HOME}/outlines/${name}.sqlite` })),
      sessions: [
        { outline: "pie-hole", machine: "allotment", pid: 80455, dir: `${REPO}/packages/door`, commit: "40aaaaa", clients: 0, programs: 0 },
        { outline: "float-bbs-test", pid: 82395, dir: `${REPO}/packages/door`, commit: "40aaaaa", clients: 0, programs: 1 },
        { outline: "garden", pid: 99, dir: `${HOME}/old/ep0ch-door`, commit: "40aaaaa", clients: 1, programs: 2 },
      ],
    });
    const text = formatPlan(f, buildPlan(f, opts()), false);
    expect(text).toContain([
      "1 → Back up every outline",
      `    before anything changes: a consistent copy (VACUUM INTO) of each ${HOME}/outlines/*.sqlite, integrity-checked, into ${HOME}/backups/ep0ch/20260314T092653Z`,
      "    bbs · boops · float-hub",
      "2 → Update the ep0ch checkout",
    ].join("\n"));
    expect(text).toContain([
      "6 → Hand the door sessions to the new code",
      "    a new daemon on 49bbbbb takes each over; its programs keep running and its terminals attach again",
      "    outline                pid    runs     programs  terminals",
      "    pie-hole on allotment  80455  40aaaaa  0         0",
      "    float-bbs-test         82395  40aaaaa  1         0",
      `    garden (pid 99) runs another checkout's door, ${HOME}/old/ep0ch-door; run install from that one`,
      `    $ ${ep0ch()}session upgrade --all`,
    ].join("\n"));
    expect(text).not.toMatch(/terminals attach again; /);
  });

  test("a fetch that raced another git process isn't an error; a real one says git's error and the retry", () => {
    const raced = checkoutStep(checkout(REPO, { head: "40aaaaa", upstream: "49bbbbb", behind: 1, fetchRaced: true }), null, "the ep0ch checkout");
    expect(raced.why).toBe("1 commit behind origin/main (40aaaaa → 49bbbbb) (the fetch raced another git process; used the ref it wrote)");
    const failed = checkoutStep(checkout(REPO, { head: "40aaaaa", upstream: "49bbbbb", behind: 1, fetchError: "fatal: unable to access" }), null, "the ep0ch checkout");
    expect(failed.why).toContain(`this one failed: fatal: unable to access; retry: git -C ${REPO} fetch origin main`);
    expect(fetchRace("error: cannot lock ref 'refs/remotes/origin/main': is at 3e4c033e3 but expected 24a9517e2")).toBe(true);
    expect(fetchRace("fatal: unable to access 'https://example.invalid/': Could not resolve host")).toBe(false);
  });

  test("no unit for the host: a note says what one runs (install doesn't create units)", () => {
    const f = { ...float2(), host: host({ folder: "/home/evan/outlines", socket: "/home/evan/outlines/.host/host.sock", running: false, outlines: [], unit: null }) };
    expect(buildPlan(f, opts()).steps[4]).toMatchObject({ status: "manual", title: "Start the outline host" });
    expect(buildPlan(f, opts()).notes.join("\n")).toContain("ExecStart=bun /home/evan/projects/ep0ch/packages/outliner/src/host-main.ts");
  });
});

describe("the door sessions (PIE-418), one per outline", () => {
  const session = (o: Partial<SessionFact> = {}): SessionFact => ({ outline: "garden", pid: 4321, dir: `${REPO}/packages/door`, commit: "40aaaaa", clients: 2, programs: 3, ...o });
  test("a session on the code before the checkout's update is handed to a daemon on the new code; its programs keep running", () => {
    const step = buildPlan(laptop({ sessions: [session()] }), opts()).steps.at(-1)!;
    expect(step).toMatchObject({ id: "session", status: "do", commands: [`${ep0ch()}session upgrade --all`] });
    expect(step.why).toBe("garden (pid 4321) runs 40aaaaa, the checkout will be at 49bbbbb: a new daemon on that code takes it over; its 3 programs keep running and its 2 terminals attach again");
  });
  test("every session is said: one behind on a machine, one current", () => {
    const f = current();
    const step = buildPlan({ ...f, sessions: [session({ outline: "seed-library", machine: "allotment" }), session({ pid: 99, commit: f.repo.checkout.head })] }, opts()).steps.at(-1)!;
    expect(step.status).toBe("do");
    expect(step.why).toContain("seed-library on allotment (pid 4321) runs 40aaaaa");
    expect(step.why).toContain("garden (pid 99) runs the current code");
  });
  test("a deps-only update keeps HEAD; a checkout left for the person isn't handed to", () => {
    const f = current();
    const ahead = { ...f, repo: { ...f.repo, checkout: checkout(REPO, { head: "50ccccc", upstream: "1111111aaaa", ahead: 2 }), deps: { needed: true, why: "a package is missing" } } };
    expect(buildPlan({ ...ahead, sessions: [session({ commit: "50ccccc" })] }, opts()).steps.at(-1)!.status).toBe("skip");
    const branch = { ...f, repo: { ...f.repo, checkout: checkout(REPO, { branch: "pie-418/try", head: "60ddddd" }) } };
    expect(buildPlan({ ...branch, sessions: [session({ commit: "1111111aaaa" })] }, opts()).steps.at(-1)).toMatchObject({ status: "skip", why: expect.stringContaining("left for you") });
  });
  test("none running, one on the current code, or one from another checkout: nothing to do", () => {
    expect(buildPlan(laptop(), opts()).steps.at(-1)).toMatchObject({ id: "session", status: "skip", why: "no door session runs" });
    const f = current();
    expect(buildPlan({ ...f, sessions: [session({ commit: f.repo.checkout.head })] }, opts()).steps.at(-1)!.why).toContain("runs the current code");
    expect(buildPlan(laptop({ sessions: [session({ dir: "/Users/wren/old/ep0ch-door" })] }), opts()).steps.at(-1)!.why).toContain("runs another checkout's door");
  });
});

describe("what --apply did, scannable", () => {
  test("handed-over sessions: a table, the code they moved between said once", () => {
    const h = (name: string, pid: [number, number], programs: number, code: [string, string] = ["24a9517e2", "3e4c033e3"]) => ({ name, pid, code, programs, terminals: 0 });
    expect(handoverLines([h("pie-hole on allotment", [80455, 95769], 0), h("float-bbs-test", [82395, 95806], 1), h("bbs", [80486, 95790], 0)])).toEqual([
      "    ✓ handed over to new daemons, 24a9517 → 3e4c033; programs kept running, terminals attaching again",
      "      outline                pid          programs  terminals",
      "      pie-hole on allotment  80455→95769  0         0",
      "      float-bbs-test         82395→95806  1         0",
      "      bbs                    80486→95790  0         0",
    ]);
    // Sessions that came from different code: each row says its own.
    expect(handoverLines([h("pie", [1, 2], 0), h("bbs", [3, 4], 2, ["1111111aa", "3e4c033e3"])])).toEqual([
      "    ✓ handed over to new daemons; programs kept running, terminals attaching again",
      "      outline  pid  programs  terminals  code",
      "      pie      1→2  0         0          24a9517 → 3e4c033",
      "      bbs      3→4  2         0          1111111 → 3e4c033",
    ]);
  });
  test("links: one line per folder and kind, by name", () => {
    expect(linkSummary({ roots: [], remove: [`${HOME}/.claude/skills/old-skill`],
      replace: [{ src: `${REPO}/x/ep0ch`, dest: `${HOME}/.agents/skills/ep0ch`, was: "/elsewhere/ep0ch" }],
      make: ["ep0ch", "ep0ch-core", "daily-brief"].map(n => ({ src: `${REPO}/packages/door/skills/${n}`, dest: `${HOME}/.claude/skills/${n}` })) })).toEqual([
      `    ✓ took away (their files are gone) in ${HOME}/.claude/skills/: old-skill`,
      `    ✓ replaced another checkout's in ${HOME}/.agents/skills/: ep0ch`,
      `    ✓ linked in ${HOME}/.claude/skills/: ep0ch · ep0ch-core · daily-brief`,
    ]);
  });
});

describe("the outline host under launchd (the Mac) or systemd", () => {
  const mac = (o: Partial<HostFacts> = {}) => ({ ...current(), host: host(o) });

  test("launchd's print: running with a pid; stopped with its last exit; not loaded", () => {
    expect(launchdState("io.example.outliner-host = {\n\tactive count = 1\n\tstate = running\n\tpid = 4242\n\tlast exit code = (never exited)\n\tendpoints = {\n\t\tstate = active\n\t}\n}"))
      .toEqual({ active: true, pid: 4242, lastExit: "(never exited)", detail: "launchd: running, pid 4242" });
    expect(launchdState("x = {\n\tstate = not running\n\tlast exit code = 1\n}")).toEqual({ active: false, lastExit: "1", detail: "launchd: not running, last exit 1" });
    expect(launchdState(null)).toEqual({ active: false, detail: "not loaded in launchd" });
  });

  test("systemd's show: active with a pid; failed with its status", () => {
    expect(systemdState("ActiveState=active\nSubState=running\nMainPID=77\nExecMainStatus=0")).toEqual({ active: true, pid: 77, detail: "systemd: active (running), pid 77" });
    expect(systemdState("ActiveState=failed\nSubState=failed\nMainPID=0\nExecMainStatus=1")).toEqual({ active: false, lastExit: "1", detail: "systemd: failed (failed), last exit 1" });
  });

  test("current code: nothing to restart; an update restarts it with launchd's kickstart -k", () => {
    expect(hostStep(mac(), false)).toMatchObject({ status: "skip" });
    expect(hostStep(mac(), true)).toMatchObject({ status: "do", commands: ["launchctl kickstart -k gui/$(id -u)/io.ep0ch.outliner-host"] });
    expect(hostUnitArgv(launchd, "restart", 501)).toEqual(["launchctl", "kickstart", "-k", "gui/501/io.ep0ch.outliner-host"]);
  });

  test("a host on another protocol than the checkout is restarted too, and doctor says install does it", () => {
    const old = mac({ protocol: PROTOCOL - 1 });
    expect(hostStep(old, false)).toMatchObject({ status: "do" });
    const c = Object.fromEntries(doctorChecks(old).map(x => [`${x.group}/${x.name}`, x]));
    expect(c["outlines/host"]).toMatchObject({ status: "behind", fix: "ep0ch install --apply restarts it (launchctl kickstart -k gui/$(id -u)/io.ep0ch.outliner-host)" });
  });

  test("set up but not answering: doctor names launchd's state and the command that starts it; install starts it", () => {
    const down = mac({ running: false, outlines: [], unit: { ...launchd, state: { active: false, lastExit: "1", detail: "launchd: not running, last exit 1" } } });
    const c = Object.fromEntries(doctorChecks(down).map(x => [`${x.group}/${x.name}`, x]));
    expect(c["outlines/host"]).toMatchObject({ status: "missing", fix: "launchctl kickstart gui/$(id -u)/io.ep0ch.outliner-host" });
    expect(c["outlines/host"]!.detail).toContain("launchd: not running, last exit 1");
    expect(hostStep(down, false)).toMatchObject({ status: "do", title: "Start the outline host" });
    const unloaded = mac({ running: false, outlines: [], unit: { ...launchd, state: { active: false, detail: "not loaded in launchd" } } });
    expect(hostStep(unloaded, false).commands).toEqual([`launchctl bootstrap gui/$(id -u) ${launchd.path}`]);
  });

  test("a unit whose job runs but doesn't answer is restarted, never started (a start would do nothing, and install waited on it)", () => {
    const sd: HostUnit = { ...launchd, kind: "systemd", path: "/home/evan/.config/systemd/user/outliner-host.service", name: "outliner-host.service", state: { active: true, pid: 77, detail: "systemd: active (running), pid 77" } };
    const hung = mac({ running: false, outlines: [], unit: sd });
    expect(hostStep(hung, false)).toMatchObject({ status: "do", title: "Restart the outline host on the new code", why: expect.stringContaining("runs (pid 77) but nothing answers"), commands: ["systemctl --user restart outliner-host.service"] });
    expect(hostVerb(hung)).toBe("restart");
    expect(hostVerb(mac({ running: false, outlines: [], unit: { ...sd, state: { active: false, detail: "systemd: inactive (dead)" } } }))).toBe("start");
    expect(hostVerb(mac())).toBe("restart");
  });

  test("a host busy for a moment isn't taken for one that's down: it's asked again", async () => {
    let n = 0;
    expect(await hostAnswers("/x.sock", 3, 1, async () => (++n >= 3 ? {} : null))).toBe(true);
    expect(n).toBe(3);
    expect(await hostAnswers("/x.sock", 3, 1, async () => null)).toBe(false);
  });

  test("ready after a restart: systemd's needs only the host answering (its pid may be read late); launchd's needs a new pid too", async () => {
    const sd = { ...current(), platform: "linux" as const, host: host({ unit: { ...launchd, kind: "systemd", name: "outliner-host.service", state: { active: true, pid: 77, detail: "" } } }) };
    const answers = async () => ({});
    expect(await hostReady(sd, "restart", 77, 50, answers, async () => 77)).toBe(true);
    // launchd: the old process answering under the old pid isn't the new host; a new pid that answers is.
    // Through the grace too, and a pid that can't be read isn't a new one.
    expect(await hostReady(mac(), "restart", 4242, 50, answers, async () => 4242, 3, 1)).toBe(false);
    expect(await hostReady(mac(), "restart", 4242, 50, answers, async () => undefined, 3, 1)).toBe(false);
    expect(await hostReady(mac(), "restart", 4242, 50, answers, async () => 5151)).toBe(true);
    // Nothing answers in time, nor in the grace: not ready.
    expect(await hostReady(sd, "restart", 77, 50, async () => null, async () => 78, 3, 1)).toBe(false);
    // Answering late (after the 30s, in the grace): up, so install goes on.
    let calls = 0;
    expect(await hostReady(sd, "start", undefined, 1, async () => (++calls > 3 ? {} : null), async () => 1, 5, 1)).toBe(true);
  });

  test("a host outside any unit is restarted by the person", () => {
    expect(hostStep(mac({ unit: null }), true)).toMatchObject({ status: "manual" });
  });

  test("the socket answers but the unit isn't running: another process serves it, and install doesn't start the unit beside it", () => {
    const beside = mac({ unit: { ...launchd, state: { active: false, lastExit: "1", detail: "launchd: not running, last exit 1" } } });
    expect(hostStep(beside, true)).toMatchObject({ status: "manual", why: expect.stringContaining("another process answers") });
    expect(hostStep(beside, false)).toMatchObject({ status: "skip" });
  });
});

describe("the remote MCP gateway's unit (ep0ch mcp serve --http)", () => {
  const gw = (o: Partial<McpFacts> = {}): McpFacts => ({
    unit: { kind: "systemd", path: "/home/evan/.config/systemd/user/ep0ch-mcp.service", name: "ep0ch-mcp.service", state: { active: true, pid: 91, detail: "systemd: active (running), pid 91" } },
    door: "/home/evan/projects/ep0ch/packages/door", startedAt: 1_800_000_000, runs: "1111111aaaa", behind: false, ...o,
  });
  const on = (m: McpFacts | null, o: Partial<Facts> = {}): Facts => ({ ...float2(), mcp: m, ...o });
  const checks = (f: Facts) => Object.fromEntries(doctorChecks(f).map(x => [`${x.group}/${x.name}`, x]));

  test("found by what its ExecStart runs, with the door it runs; a host's unit, a comment or a description isn't it", () => {
    const home = join(scratch, "mcp-home"), dir = join(home, ".config/systemd/user");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "outliner-host.service"), "[Service]\nExecStart=%h/.bun/bin/bun src/host-main.ts\n");
    writeFileSync(join(dir, "a-notes.service"), "[Unit]\nDescription=not bun src/main.ts mcp serve --http\n[Service]\n# ExecStart=bun src/main.ts mcp serve --http\nExecStart=/bin/true\n");
    expect(mcpUnits("linux", home)).toEqual([]);
    writeFileSync(join(dir, "ep0ch-mcp.service"), "[Service]\nWorkingDirectory=%h/projects/ep0ch/packages/door\nExecStart=%h/.local/bin/with-secrets clerk -- %h/.bun/bin/bun src/main.ts mcp serve --http --port 8792\n");
    // An absolute main.ts is the door it runs, whatever the WorkingDirectory says.
    writeFileSync(join(dir, "b-mcp.service"), "[Service]\nWorkingDirectory=%h/projects/ep0ch/packages/door\nExecStart=/usr/bin/bun %h/projects/ep0ch-wt-x/packages/door/src/main.ts mcp serve --http\n");
    // A relative one with no WorkingDirectory: which door can't be told.
    writeFileSync(join(dir, "c-mcp.service"), "[Service]\nExecStart=bun src/main.ts mcp serve --http\n");
    expect(mcpUnits("linux", home)).toEqual([
      { kind: "systemd", path: join(dir, "b-mcp.service"), name: "b-mcp.service", door: join(home, "projects/ep0ch-wt-x/packages/door") },
      { kind: "systemd", path: join(dir, "c-mcp.service"), name: "c-mcp.service", door: null },
      { kind: "systemd", path: join(dir, "ep0ch-mcp.service"), name: "ep0ch-mcp.service", door: join(home, "projects/ep0ch/packages/door") },
    ]);
    const agents = join(home, "Library/LaunchAgents");
    mkdirSync(agents, { recursive: true });
    writeFileSync(join(agents, "io.ep0ch.mcp.plist"), "<plist><dict><key>Label</key><string>io.ep0ch.mcp</string><key>ProgramArguments</key><array><string>/opt/homebrew/bin/bun</string><string>src/main.ts</string><string>mcp</string><string>serve</string><string>--http</string></array><key>WorkingDirectory</key><string>/Users/wren/projects/ep0ch/packages/door</string></dict></plist>");
    expect(mcpUnits("macos", home)).toEqual([{ kind: "launchd", path: join(agents, "io.ep0ch.mcp.plist"), name: "io.ep0ch.mcp", door: "/Users/wren/projects/ep0ch/packages/door" }]);
    expect(startFromElapsed(" 1-02:03:04\n", 1_800_000_000_000)).toBe(1_800_000_000 - (86400 + 2 * 3600 + 3 * 60 + 4));
    expect(startFromElapsed("05:06", 1_800_000_000_000)).toBe(1_800_000_000 - 306);
    expect(startFromElapsed("?", 0)).toBeUndefined();
  });

  test("whether HEAD moved since it started: a move in its start second counts; a no-op entry doesn't", () => {
    const A = "a".repeat(40), B = "b".repeat(40);
    expect(movedSince([{ commit: A, at: 100 }], 200)).toEqual({ runs: A, behind: false });
    expect(movedSince([{ commit: B, at: 300 }, { commit: A, at: 100 }], 200)).toEqual({ runs: A, behind: true });
    expect(movedSince([{ commit: B, at: 200 }, { commit: A, at: 100 }], 200)).toEqual({ runs: A, behind: true });
    expect(movedSince([{ commit: A, at: 300 }, { commit: A, at: 100 }], 200)).toEqual({ runs: A, behind: false });
    // No move before it started (an expired reflog): unknown, not behind.
    expect(movedSince([{ commit: B, at: 300 }], 200)).toEqual({ runs: null });
  });

  test("what systemd loaded (drop-ins included) says which door it runs", () => {
    const shown = "ExecStart={ path=/home/evan/.local/bin/with-secrets ; argv[]=/home/evan/.local/bin/with-secrets clerk -- /home/evan/.bun/bin/bun src/main.ts mcp serve --http --port 8792 ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }\nWorkingDirectory=/home/evan/projects/ep0ch/packages/door";
    expect(doorOfShown(shown, "/home/evan")).toBe("/home/evan/projects/ep0ch/packages/door");
    expect(doorOfShown(shown.replace("bun src/main.ts", "bun /srv/other/packages/door/src/main.ts"), "/home/evan")).toBe("/srv/other/packages/door");
    expect(doorOfShown("ExecStart={ path=/bin/true ; argv[]=/bin/true ; }\nWorkingDirectory=/x", "/home/evan")).toBeNull();
    expect(doorOfShown("ExecStart={ path=/b ; argv[]=bun src/main.ts mcp serve --http ; }\nWorkingDirectory=", "/home/evan")).toBeNull();
  });

  test("on the checkout's code: nothing to do; the checkout updated in this run, or moved since it started: restarted, said in the plan", () => {
    expect(mcpStep(on(gw()), false)).toMatchObject({ id: "mcp", status: "skip", why: "the gateway runs the current code (systemd ep0ch-mcp.service, 1111111)" });
    expect(mcpStep(on(gw()), true)).toMatchObject({ status: "do", why: expect.stringContaining("the ep0ch checkout is updated in this run"), commands: ["systemctl --user restart ep0ch-mcp.service"] });
    const moved = on(gw({ runs: "0000000ffff", behind: true }), { repo: { ...float2().repo, checkout: checkout("/home/evan/projects/ep0ch", { head: "2222222bbbb", upstream: "2222222bbbb" }) } });
    expect(mcpStep(moved, false)).toMatchObject({ status: "do", why: expect.stringContaining("it started on 0000000, and the checkout is at 2222222 now") });
    // In the plan: after the host it talks to, before the sessions.
    const ids = buildPlan(moved, opts()).steps.map(s => `${s.id}:${s.status}`);
    expect(ids.indexOf("mcp:do")).toBe(ids.findIndex(x => x.startsWith("host:")) + 1);
    expect(buildPlan(on(null), opts()).steps.some(s => s.id === "mcp")).toBe(false);
  });

  test("another checkout's gateway, or one not running, is left alone and said", () => {
    expect(mcpStep(on(gw({ door: "/home/evan/projects/ep0ch-wt-x/packages/door", behind: true })), true)).toMatchObject({ status: "skip", why: expect.stringContaining("not this checkout's door") });
    const down = gw({ unit: { ...gw().unit, state: { active: false, lastExit: "1", detail: "systemd: failed (failed), last exit 1" } }, startedAt: undefined, runs: undefined, behind: undefined });
    expect(mcpStep(on(down), true)).toMatchObject({ status: "skip", why: expect.stringContaining("isn't running (systemd: failed (failed), last exit 1)") });
  });

  test("doctor flags a gateway running older code than the checkout, with what restarts it", () => {
    expect(checks(on(gw()))["ep0ch/mcp gateway"]).toMatchObject({ status: "ok", detail: "systemd ep0ch-mcp.service runs the checkout's code (1111111)" });
    const behind = checks(on(gw({ runs: "0000000ffff", behind: true })))["ep0ch/mcp gateway"]!;
    expect(behind).toMatchObject({ status: "behind", fix: "ep0ch install --apply restarts it (systemctl --user restart ep0ch-mcp.service)" });
    expect(behind.detail).toContain("runs older code than the checkout: it started on 0000000");
    expect(checks(on(gw({ door: "/elsewhere/packages/door" })))["ep0ch/mcp gateway"]).toMatchObject({ status: "info" });
    expect(checks(on(null))["ep0ch/mcp gateway"]).toBeUndefined();
    // No start time or reflog: unknown, never ✓, and never restarted on a guess (unless the checkout moves in this run).
    const unsure = on(gw({ startedAt: undefined, runs: undefined, behind: undefined }));
    expect(checks(unsure)["ep0ch/mcp gateway"]).toMatchObject({ status: "unknown", fix: "systemctl --user restart ep0ch-mcp.service" });
    expect(mcpStep(unsure, false)).toMatchObject({ status: "skip", why: expect.stringContaining("can't be told") });
    expect(mcpStep(unsure, true)).toMatchObject({ status: "do" });
  });

  test("a gateway whose door can't be told is never restarted, even when the checkout updates", () => {
    expect(mcpStep(on(gw({ door: null, behind: true })), true)).toMatchObject({ status: "skip", why: expect.stringContaining("can't be told") });
    expect(checks(on(gw({ door: null })))["ep0ch/mcp gateway"]).toMatchObject({ status: "info" });
  });
});

describe("the doctor", () => {
  const byName = (f: Facts) => Object.fromEntries(doctorChecks(f).map(c => [`${c.group}/${c.name}`, c]));

  test("the laptop: what's behind, with the command that fixes it", () => {
    const c = byName(laptop());
    expect(c["plugin/in Herdr"]).toMatchObject({ status: "behind", fix: "herdr plugin install float-ritual-stack/ep0ch/packages/outliner --ref main --yes" });
    expect(c["ep0ch/checkout"]!.status).toBe("behind");
    expect(c["ep0ch/ep0ch on PATH"]).toMatchObject({ status: "missing", fix: `ln -s ${REPO}/packages/door/src/main.ts /opt/homebrew/bin/ep0ch` });
    expect(c["outlines/folder"]!.detail).toBe(`${HOME}/outlines · float-hub`);
    expect(c["outlines/host"]).toMatchObject({ status: "ok" });
    expect(c["claude/claude-mod"]!.status).toBe("ok");
    expect(formatDoctor(laptop())).toMatch(/^ {2}! in Herdr/m);
  });

  test("float-2 after the move: the unit from before outlines by name is behind, with the change", () => {
    const c = byName(float2());
    expect(c["outlines/host unit"]).toMatchObject({ status: "behind" });
    expect(c["outlines/host unit"]!.fix).toContain("drop OUTLINER_STATE_DIR");
    expect(c["plugin/in Herdr"]!.status).toBe("ok");
    expect(c["ep0ch/ep0ch on PATH"]).toMatchObject({ status: "behind", fix: "ln -sfn /home/evan/projects/ep0ch/packages/door/src/main.ts /home/evan/.local/bin/ep0ch" });
  });

  test("this folder: the outline it opens and why, or the init it would offer", () => {
    expect(byName({ ...current(), here: { folder: "/w/garden", outline: "garden", why: "the outline garden (/w/garden/.ep0ch)" } })["outlines/this folder"]!.detail)
      .toBe("/w/garden opens the outline garden (/w/garden/.ep0ch)");
    expect(byName({ ...current(), here: { folder: "/w/jam", unnamed: "no outline is named for /w/jam", guess: "jam" } })["outlines/this folder"]!.detail)
      .toBe('/w/jam: no outline is named for /w/jam; ep0ch init would start "jam"');
  });

  test("all current is all ✓", () => {
    expect(doctorChecks(current()).filter(c => c.status === "behind" || c.status === "missing")).toEqual([]);
  });

  test("a checkout on another protocol than this door says so", () => {
    const f = current();
    f.repo = { ...f.repo, protocol: PROTOCOL + 1 };
    expect(byName(f)["ep0ch/this door"]!.detail).toContain(`this door speaks protocol ${PROTOCOL} and the checkout ${PROTOCOL + 1}`);
  });

  test("a checkout whose fetch failed is never ✓: it couldn't be checked, and the summary says so", () => {
    const f = current();
    f.repo = { ...f.repo, checkout: checkout(REPO, { fetchError: "timed out after 90s" }) };
    expect(buildPlan(f, opts()).steps[1]).toMatchObject({ status: "manual", unchecked: true, why: expect.stringContaining("so the ep0ch checkout wasn't updated") });
    expect(byName(f)["ep0ch/checkout"]!.status).toBe("unknown");
    const text = formatDoctor(f);
    expect(text).toMatch(/^ {2}\? checkout/m);
    expect(text).toContain("1 couldn't be checked (? above); the rest is current");
  });

  test("a managed install that can't be compared says so: it couldn't be checked, not current", () => {
    const c = byName(laptop({ plugin: { ...laptop().plugin!, remote: { commit: null, error: "offline" } } }));
    expect(c["plugin/in Herdr"]!.status).toBe("unknown");
  });

  test("a Claude mod from another checkout is stale; FORCE_HYPERLINK is noted", () => {
    const f = current();
    f.claude = { ...f.claude, settingsDirs: [`${HOME}/projects/pi-herdr-outliner/claude-mod`], forceHyperlink: "1" };
    const c = byName(f);
    expect(c["claude/claude-mod"]).toMatchObject({ status: "behind", fix: `bun ${REPO}/packages/claude-mod/scripts/install-claude-mod.ts` });
    expect(c["claude/FORCE_HYPERLINK"]!.detail).toContain("PIE-486");
  });

  test("a folder list with no mode is noted (nothing feeds), never a fix", () => {
    const f = current();
    expect(byName(f)["claude/mentions"]).toBeUndefined();
    f.claude = { ...f.claude, mentions: { listed: true } };
    const row = byName(f)["claude/mentions"]!;
    expect(row.status).toBe("info");
    expect(row.fix).toBeUndefined();
    expect(row.detail).toContain("every folder whose .ep0ch names an outline feeds that outline");
  });

  test("missing keys and a stopped Herdr server", () => {
    const f = current();
    f.herdr = { ...f.herdr, server: false, keys: { "open-here": "prefix+u" } };
    const c = byName(f);
    expect(c["herdr/server"]!.status).toBe("missing");
    expect(c["herdr/keys"]!.detail).toContain("no key for open-tree, comment-selection, capture");
  });

  test("versions and staleness", () => {
    expect(versionAtLeast("1.4.2", "1.3.0")).toBe(true);
    expect(versionAtLeast("1.2.9", "1.3.0")).toBe(false);
    expect(staleness({ protocol: 81 }, 82)).toEqual(["protocol 82 (runs 81)"]);
    expect(staleness({ protocol: 82 }, 82)).toEqual([]);
    expect(staleness({}, 82)).toEqual([]);
  });
});

describe("read-only probes on scratch files", () => {
  test("bun install is needed when node_modules or a package is missing, or a version differs from bun.lock", () => {
    const root = join(scratch, "repo-deps");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { "@garden/trowel": "1.2.0" } }));
    writeFileSync(join(root, "bun.lock"), `{\n  "packages": {\n    "@garden/trowel": ["@garden/trowel@1.2.0", "", {}, "sha512-x"],\n  }\n}\n`);
    expect(depsState(root)).toEqual({ needed: true, why: "node_modules is missing" });
    mkdirSync(join(root, "node_modules/@garden"), { recursive: true });
    expect(depsState(root).why).toBe("@garden/trowel isn't installed");
    mkdirSync(join(root, "node_modules/@garden/trowel"));
    writeFileSync(join(root, "node_modules/@garden/trowel/package.json"), JSON.stringify({ version: "1.1.0" }));
    expect(depsState(root).why).toBe("@garden/trowel is 1.1.0, bun.lock has 1.2.0");
    writeFileSync(join(root, "node_modules/@garden/trowel/package.json"), JSON.stringify({ version: "1.2.0" }));
    expect(depsState(root).needed).toBe(false);
  });

  test("a workspace package's own dependencies count: a package only packages/door declares, missing, needs bun install", () => {
    const root = join(scratch, "repo-workspace-deps");
    mkdirSync(join(root, "packages/door/node_modules/image-size"), { recursive: true });
    mkdirSync(join(root, "packages/outline-core"), { recursive: true });
    mkdirSync(join(root, "node_modules"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"], devDependencies: {} }));
    writeFileSync(join(root, "packages/outline-core/package.json"), JSON.stringify({ name: "@ep0ch/outline-core" }));
    writeFileSync(join(root, "packages/door/package.json"), JSON.stringify({ dependencies: { "@ep0ch/outline-core": "workspace:*", "image-size": "2.0.4", sharp: "0.35.5" } }));
    writeFileSync(join(root, "bun.lock"), `{\n  "packages": {\n    "image-size": ["image-size@2.0.4", "", {}, "sha512-x"],\n    "sharp": ["sharp@0.35.5", "", {}, "sha512-y"],\n  }\n}\n`);
    writeFileSync(join(root, "packages/door/node_modules/image-size/package.json"), JSON.stringify({ version: "2.0.4" }));
    expect(depsState(root)).toEqual({ needed: true, why: "sharp isn't installed (packages/door)" });
    mkdirSync(join(root, "packages/door/node_modules/sharp"));
    writeFileSync(join(root, "packages/door/node_modules/sharp/package.json"), JSON.stringify({ version: "0.35.5" }));
    expect(depsState(root).needed).toBe(false);
  });

  test("Herdr keys are read from [[keys.command]] blocks naming the plugin's actions", () => {
    const path = join(scratch, "config.toml");
    writeFileSync(path, `onboarding = false\n\n[[keys.command]]\nkey = "prefix+u"\ntype = "plugin_action"\ncommand = "float.pi-outliner.open-here"\n\n[[keys.command]]\nkey = "prefix+g"\ntype = "plugin_action"\ncommand = "other.plugin.open-here"\n\n[theme]\nname = "x"\n`);
    expect(herdrKeys(path)).toEqual({ "open-here": "prefix+u" });
    expect(herdrKeys(join(scratch, "none.toml"))).toEqual({});
  });

  test("databases: every <outlines>/<name>.sqlite by name, and nothing else in the folder", () => {
    const folder = join(scratch, "outlines");
    mkdirSync(join(folder, "orchard"), { recursive: true });
    mkdirSync(join(folder, ".host"), { recursive: true });
    for (const f of ["orchard.sqlite", "seed-library.sqlite", "orchard.sqlite-wal", "notes.txt", ".host/host.lock"]) writeFileSync(join(folder, f), "");
    expect(databases(folder)).toEqual([{ name: "orchard", path: join(folder, "orchard.sqlite") }, { name: "seed-library", path: join(folder, "seed-library.sqlite") }]);
    expect(databases(join(scratch, "no-outlines"))).toEqual([]);
  });

  test("the Claude mod: packages/claude-mod, else packages/outliner/claude-mod, with its installer", () => {
    const repo = join(scratch, "repo-mod");
    mkdirSync(join(repo, "packages/outliner/claude-mod"), { recursive: true });
    mkdirSync(join(repo, "packages/outliner/scripts"), { recursive: true });
    writeFileSync(join(repo, "packages/outliner/scripts/install-claude-mod.ts"), "");
    expect(claudeModIn(repo)).toEqual({ dir: join(repo, "packages/outliner/claude-mod"), installer: join(repo, "packages/outliner/scripts/install-claude-mod.ts") });
    mkdirSync(join(repo, "packages/claude-mod/scripts"), { recursive: true });
    writeFileSync(join(repo, "packages/claude-mod/scripts/install-claude-mod.ts"), "");
    expect(claudeModIn(repo)).toEqual({ dir: join(repo, "packages/claude-mod"), installer: join(repo, "packages/claude-mod/scripts/install-claude-mod.ts") });
  });

  test("a backup is a consistent copy of a live WAL database, integrity-checked, never overwriting", () => {
    const src = join(scratch, "live.sqlite"), dest = join(scratch, "backups/live-copy.sqlite");
    mkdirSync(join(scratch, "backups"));
    const writer = new Database(src);
    writer.exec("PRAGMA journal_mode=WAL; CREATE TABLE notes(text); INSERT INTO notes VALUES ('plant the beans'), ('turn the compost');");
    expect(backupDatabase(src, dest)).toEqual({ integrity: "ok" });
    writer.close();
    const copy = new Database(dest, { readonly: true });
    expect(copy.query("SELECT count(*) AS n FROM notes").get()).toEqual({ n: 2 });
    copy.close();
    expect(statSync(dest).mode & 0o777).toBe(0o600);
    expect(() => backupDatabase(src, dest)).toThrow("already exists");
    expect(existsSync(src)).toBe(true);
  });

  test("a failed backup leaves an existing file at the destination as it was, and removes only its own copy", () => {
    const src = join(scratch, "pond.sqlite"), dest = join(scratch, "backups/pond-earlier.sqlite");
    const w = new Database(src);
    w.exec("CREATE TABLE notes(text); INSERT INTO notes VALUES ('net the leaves')");
    w.close();
    writeFileSync(dest, "an earlier backup");
    expect(() => backupDatabase(src, dest)).toThrow("already exists");
    expect(readFileSync(dest, "utf8")).toBe("an earlier backup");
    const notADb = join(scratch, "not-a-db.sqlite"), bad = join(scratch, "backups/not-a-db-copy.sqlite");
    writeFileSync(notADb, "this is not a database, it is a shopping list: twine, seed trays");
    expect(() => backupDatabase(notADb, bad)).toThrow();
    expect(existsSync(bad)).toBe(false);
    expect(readFileSync(notADb, "utf8")).toContain("shopping list");
  });
});

describe("the command line", () => {
  test("a flag that doesn't belong is refused before anything is read, --restart-services too (per-folder services are gone)", async () => {
    const said: string[] = [];
    const io = { out: (s: string) => said.push(s), err: (s: string) => said.push(s) };
    expect(await setupCommand(["doctor", "--apply"], io)).toBe(2);
    expect(await setupCommand(["install", "--yes"], io)).toBe(2);
    expect(await setupCommand(["install", "--restart-services"], io)).toBe(2);
    expect(said.every(s => s.includes("ep0ch install [--apply] [--json]"))).toBe(true);
  });
});

test("text output shows the home directory as ~ (JSON keeps whole paths)", () => {
  expect(tilde("ep0ch doctor · linux · /home/wren\n  $ ln -s /home/wren/ep0ch/packages/door/src/main.ts /home/wren/.local/bin/ep0ch (x /home/wren)", "/home/wren"))
    .toBe("ep0ch doctor · linux · ~\n  $ ln -s ~/ep0ch/packages/door/src/main.ts ~/.local/bin/ep0ch (x ~)");
  expect(tilde("/home/wrenfield/x", "/home/wren")).toBe("/home/wrenfield/x");
});

describe("never opening an outline to look at it", () => {
  test("the host is pinged only through an open outline, else not at all", () => {
    const o = (name: string, open: boolean) => ({ name, database: `/x/${name}.sqlite`, folder: `/x/${name}`, open });
    expect(openOutlineToPing([o("pond", false), o("orchard", true)])).toBe("orchard");
    expect(openOutlineToPing([o("pond", false)])).toBeNull();
  });

  test("doctor's host probe never pings a closed outline (the host would open it)", async () => {
    const folder = join(scratch, "probe-outlines");
    mkdirSync(join(folder, ".host"), { recursive: true });
    const seen: any[] = [];
    const server = Bun.listen<{ buf: string }>({ unix: join(folder, ".host/host.sock"), socket: {
      open(s) { s.data = { buf: "" }; },
      data(s, d) {
        s.data.buf += d.toString();
        const nl = s.data.buf.indexOf("\n");
        if (nl < 0) return;
        const req = JSON.parse(s.data.buf.slice(0, nl));
        seen.push(req);
        const result = req.action === "outlines.list"
          ? { outlines: [{ name: "pond", database: join(folder, "pond.sqlite"), folder: join(folder, "pond"), open: false }] }
          : { protocolVersion: PROTOCOL };
        s.write(JSON.stringify({ id: req.id, ok: true, result, sequence: 0 }) + "\n");
      },
    } });
    try {
      const h = await hostFacts(folder, "linux", scratch);
      expect(h.running).toBe(true);
      expect(h.socket).toBe(join(folder, ".host/host.sock"));
      expect(h.protocol).toBeUndefined();
      expect(seen.map(r => r.action)).not.toContain("ping");
    } finally { server.stop(true); }
  });
});

describe("the door's extensions (packages/door/ext): their links", () => {
  /** A door with one extension asking for two cable files and a helper on PATH, in a scratch home. */
  function door() {
    const root = mkdtempSync(join(scratch, "ext-")), ext = join(root, "door", "ext", "telly");
    mkdirSync(join(ext, "cable"), { recursive: true }); mkdirSync(join(ext, "bin"));
    writeFileSync(join(ext, "cable", "notes.toml"), "# a channel\n");
    writeFileSync(join(ext, "cable", "files.toml"), "# a channel\n");
    writeFileSync(join(ext, "bin", "telly-help"), "#!/bin/sh\n");
    writeFileSync(join(ext, "ext.json"), JSON.stringify({ requires: ["telly"], links: [
      { from: "cable", into: ["$TELLY_CONFIG/cable", "~/.config/telly/cable"] }, { from: "bin", into: ["@bin"] }] }));
    const home = join(root, "home"), bin = join(home, ".local/bin");
    mkdirSync(bin, { recursive: true });
    return { extRoot: join(root, "door", "ext"), ext, home, bin, cable: join(home, ".config/telly/cable") };
  }
  const on = (d: ReturnType<typeof door>, env: Record<string, string> = {}, which = (n: string) => (n === "telly" ? "/usr/bin/telly" : null)) =>
    extFacts(d.extRoot, { env, home: d.home, bin: d.bin, which, record: join(d.home, "state", "install-links.json") });
  const withExt = (ext: Facts["ext"]): Facts => ({ ...current(), ext });

  test("a first install links each file where its program finds it, and says each one", () => {
    const d = door();
    const facts = on(d);
    expect(facts.exts[0]!.links.map(l => [l.dest, l.state])).toEqual([
      [join(d.cable, "files.toml"), "missing"], [join(d.cable, "notes.toml"), "missing"], [join(d.bin, "telly-help"), "missing"]]);
    const step = extStep(withExt(facts));
    expect([step.status, step.why]).toEqual(["do", "3 to link"]);
    expect(step.commands).toContain(`ln -s ${join(d.ext, "cable", "notes.toml")} ${join(d.cable, "notes.toml")}`);
    expect(statuses(withExt(facts))).toEqual(["backup:skip", "repo:skip", "plugin:skip", "link:skip", "host:skip", "session:skip", "ext:do"]);
    const said: string[] = [];
    applyLinks(step.links!, s => said.push(s));
    expect(said).toEqual(expect.arrayContaining([`${join(d.cable, "notes.toml")} → ${join(d.ext, "cable", "notes.toml")}`]));
    // A second run has nothing to do.
    expect(extStep(withExt(on(d)))).toMatchObject({ status: "skip", why: "3 linked" });
  });

  test("a file that isn't install's is never replaced: left as it is, and said", () => {
    const d = door();
    mkdirSync(d.cable, { recursive: true });
    writeFileSync(join(d.cable, "notes.toml"), "# the person's own\n");
    const step = extStep(withExt(on(d)));
    expect(step.status).toBe("do");
    expect(step.why).toContain(`left as they are (not install's): ${join(d.cable, "notes.toml")}`);
    expect(step.links!.make.map(l => l.dest)).not.toContain(join(d.cable, "notes.toml"));
    applyLinks(step.links!, () => {});
    expect(readFileSync(join(d.cable, "notes.toml"), "utf8")).toBe("# the person's own\n");
    // And if one appears between the plan and the apply, the link fails rather than replacing it.
    const late = door(), plan = extStep(withExt(on(late)));
    mkdirSync(late.cable, { recursive: true });
    writeFileSync(join(late.cable, "files.toml"), "# arrived since\n");
    expect(() => applyLinks(plan.links!, () => {})).toThrow(/linking .*files\.toml failed/);
    expect(readFileSync(join(late.cable, "files.toml"), "utf8")).toBe("# arrived since\n");
  });

  test("$NAME applies when it's set; a program not on PATH links nothing and says why", () => {
    const d = door();
    expect(on(d, { TELLY_CONFIG: join(d.home, "elsewhere") }).exts[0]!.links[0]!.dest).toBe(join(d.home, "elsewhere", "cable", "files.toml"));
    const without = on(d, {}, () => null);
    expect(without.exts[0]).toMatchObject({ links: [], problem: "telly isn't on PATH" });
    expect(extStep(withExt(without))).toMatchObject({ status: "skip", why: "nothing to link; not linked: telly: telly isn't on PATH" });
  });

  test("deleting the extension, the last one: install's recorded links are taken away next time, and nothing else", () => {
    const d = door();
    applyLinks(extStep(withExt(on(d))).links!, () => {});
    writeFileSync(join(d.cable, "someone-elses.toml"), "# not ours\n");
    rmSync(d.extRoot, { recursive: true, force: true });
    const facts = on(d);
    expect(facts.exts).toEqual([]);
    expect(facts.stale.map(s => s.dest).sort()).toEqual([join(d.bin, "telly-help"), join(d.cable, "files.toml"), join(d.cable, "notes.toml")].sort());
    const step = extStep(withExt(facts));
    expect([step.status, step.why]).toEqual(["do", "3 stale to take away"]);
    applyLinks(step.links!, () => {});
    expect(existsSync(join(d.cable, "someone-elses.toml"))).toBe(true);
    expect(existsSync(join(d.cable, "notes.toml"))).toBe(false);
    expect(extStep(withExt(on(d)))).toMatchObject({ status: "skip" });
  });

  test("a file of the person's own where a link would go: said every run, never a step left for them", () => {
    const d = door();
    applyLinks(extStep(withExt(on(d))).links!, () => {});
    rmSync(join(d.cable, "notes.toml"));
    writeFileSync(join(d.cable, "notes.toml"), "# mine now\n");
    expect(extStep(withExt(on(d)))).toMatchObject({ status: "skip", why: expect.stringContaining("left as they are (not install's)") });
  });

});

describe("the agent skills: their links where Claude Code (and ~/.agents) finds them", () => {
  const skill = (dir: string, name: string, frontName = name) => {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${frontName}\ndescription: A made-up skill.\n---\n\n# ${name}\n`);
  };
  /** A checkout with the door's skills and the outliner's Pi skills, an old checkout's copies, and a scratch home. */
  function machine(o: { shared?: boolean } = {}) {
    const root = mkdtempSync(join(scratch, "skills-"));
    const door = join(root, "ep0ch", "packages", "door"), outliner = join(root, "ep0ch", "packages", "outliner");
    for (const n of ["ep0ch", "ep0ch-core"]) skill(join(door, "skills"), n);
    for (const n of ["outliner-documentation", "outliner-workflow"]) skill(join(outliner, "pi-extension", "skills"), n);
    const old = join(root, "ep0ch-door", "skills");
    for (const n of ["ep0ch", "ep0ch-core"]) skill(old, n);
    const home = join(root, "home"), claude = join(home, ".claude", "skills"), shared = join(home, ".agents", "skills");
    mkdirSync(claude, { recursive: true });
    if (o.shared) mkdirSync(shared, { recursive: true });
    return { door, outliner, old, home, claude, shared, record: join(home, "state", "install-links.json") };
  }
  const look = (m: ReturnType<typeof machine>, env: Record<string, string> = {}) => skillLinkFacts({ door: m.door, outliner: m.outliner, env, home: m.home, record: m.record });
  const withSkills = (skills: Facts["skills"]): Facts => ({ ...current(), skills });

  test("a first install links the door's skills and the outliner's Claude Code one, not its Pi-only ones", () => {
    const m = machine();
    const facts = look(m);
    expect(facts.links.map(l => [l.dest, l.state])).toEqual([
      [join(m.claude, "ep0ch"), "missing"], [join(m.claude, "ep0ch-core"), "missing"], [join(m.claude, "outliner-documentation"), "missing"]]);
    expect(skillChecks(withSkills(facts)).map(c => `${MARK[c.status]} ${c.name}`)).toEqual(["✗ ep0ch", "✗ ep0ch-core", "✗ outliner-documentation"]);
    const step = skillsStep(withSkills(facts));
    expect([step.status, step.why]).toEqual(["do", "3 to link"]);
    expect(step.commands).toContain(`ln -s ${join(m.door, "skills", "ep0ch-core")} ${join(m.claude, "ep0ch-core")}`);
    expect(statuses(withSkills(facts))).toEqual(["backup:skip", "repo:skip", "plugin:skip", "link:skip", "host:skip", "session:skip", "skills:do"]);
    applyLinks(step.links!, () => {});
    expect(readlinkSync(join(m.claude, "ep0ch-core"))).toBe(join(m.door, "skills", "ep0ch-core"));
    expect(JSON.parse(readFileSync(m.record, "utf8")).links).toContain(join(m.claude, "ep0ch-core"));
    const again = look(m);
    expect(skillsStep(withSkills(again))).toMatchObject({ status: "skip", why: "3 linked" });
    expect(skillChecks(withSkills(again)).every(c => c.status === "ok")).toBe(true);
  });

  test("~/.agents/skills gets them too when it's there; CLAUDE_CONFIG_DIR moves Claude Code's", () => {
    const m = machine({ shared: true });
    expect(look(m).into).toEqual([m.claude, m.shared]);
    const elsewhere = join(m.home, "claude-config");
    expect(look(m, { CLAUDE_CONFIG_DIR: elsewhere }).into).toEqual([join(elsewhere, "skills"), m.shared]);
  });

  test("an old checkout's copy of the same skill is replaced, and said; doctor shows it with the fix", () => {
    const m = machine();
    symlinkSync(join(m.old, "ep0ch-core"), join(m.claude, "ep0ch-core"));
    const facts = look(m);
    expect(facts.links.find(l => l.dest === join(m.claude, "ep0ch-core"))).toMatchObject({ state: "replace", was: join(m.old, "ep0ch-core") });
    const check = skillChecks(withSkills(facts)).find(c => c.name === "ep0ch-core")!;
    expect(check).toMatchObject({ status: "behind", fix: `ln -sfn ${join(m.door, "skills", "ep0ch-core")} ${join(m.claude, "ep0ch-core")}   (or ep0ch install --apply)` });
    const step = skillsStep(withSkills(facts));
    expect(step.why).toBe("2 to link, 1 to replace (another checkout's)");
    expect(step.commands).toContain(`ln -sfn ${join(m.door, "skills", "ep0ch-core")} ${join(m.claude, "ep0ch-core")}   # was ${join(m.old, "ep0ch-core")}`);
    const said: string[] = [];
    applyLinks(step.links!, s => said.push(s));
    expect(said).toContain(`${join(m.claude, "ep0ch-core")} → ${join(m.door, "skills", "ep0ch-core")} (was ${join(m.old, "ep0ch-core")})`);
    expect(readlinkSync(join(m.claude, "ep0ch-core"))).toBe(join(m.door, "skills", "ep0ch-core"));
    expect(existsSync(join(m.old, "ep0ch-core", "SKILL.md"))).toBe(true);
  });

  test("a real folder, or a link to some other skill under the name, is never install's: said and left", () => {
    const m = machine();
    skill(m.claude, "ep0ch");                                    // the person's own folder
    skill(m.old, "ep0ch-core-fork", "ep0ch-core-fork");
    mkdirSync(join(m.old, "x"));
    skill(join(m.old, "x"), "ep0ch-core", "someone-elses");       // same folder name, another skill's SKILL.md
    symlinkSync(join(m.old, "x", "ep0ch-core"), join(m.claude, "ep0ch-core"));
    const facts = look(m);
    const checks = skillChecks(withSkills(facts));
    expect(checks.find(c => c.name === "ep0ch")).toMatchObject({ status: "info", detail: expect.stringContaining("is yours (not a link)") });
    expect(checks.find(c => c.name === "ep0ch-core")).toMatchObject({ status: "behind", detail: expect.stringContaining("not this skill's copy; install leaves it") });
    const step = skillsStep(withSkills(facts));
    expect(step.why).toContain(`left as they are (not install's): ${join(m.claude, "ep0ch")}, ${join(m.claude, "ep0ch-core")}`);
    applyLinks(step.links!, () => {});
    expect(lstatSync(join(m.claude, "ep0ch")).isDirectory()).toBe(true);
    expect(readlinkSync(join(m.claude, "ep0ch-core"))).toBe(join(m.old, "x", "ep0ch-core"));
  });

  test("a link left by a worktree or checkout since deleted is broken whatever it was: replaced", () => {
    const m = machine();
    const gone = join(m.home, "projects", "ep0ch-wt-gone", "packages", "door", "skills", "ep0ch-core");
    skill(dirname(gone), "ep0ch-core");
    symlinkSync(gone, join(m.claude, "ep0ch-core"));
    rmSync(join(m.home, "projects"), { recursive: true });
    const facts = look(m);
    expect(facts.links.find(l => l.dest === join(m.claude, "ep0ch-core"))).toMatchObject({ state: "replace", was: gone });
    applyLinks(skillsStep(withSkills(facts)).links!, () => {});
    expect(readlinkSync(join(m.claude, "ep0ch-core"))).toBe(join(m.door, "skills", "ep0ch-core"));
    // A broken link under another skill's name is still left alone.
    rmSync(join(m.claude, "ep0ch")); symlinkSync(join(m.home, "nowhere", "other-skill"), join(m.claude, "ep0ch"));
    expect(look(m).links.find(l => l.dest === join(m.claude, "ep0ch"))).toMatchObject({ state: "taken" });
  });

  test("a folder install linked into before is still looked in for stale links (CLAUDE_CONFIG_DIR changed since)", () => {
    const m = machine();
    const before = join(m.home, "claude-before");
    applyLinks(skillsStep(withSkills(look(m, { CLAUDE_CONFIG_DIR: before }))).links!, () => {});
    rmSync(join(m.door, "skills", "ep0ch"), { recursive: true });
    expect(look(m).stale.map(s => s.dest)).toEqual([join(before, "skills", "ep0ch")]);
  });

  test("the commands quote a path that needs it", () => {
    const m = machine();
    const spaced = join(m.home, "Claude Config");
    const step = skillsStep(withSkills(look(m, { CLAUDE_CONFIG_DIR: spaced })));
    expect(step.commands).toContain(`ln -s ${join(m.door, "skills", "ep0ch")} '${join(spaced, "skills", "ep0ch")}'`);
  });

  test("a link that changed between the plan and the apply isn't replaced", () => {
    const m = machine();
    symlinkSync(join(m.old, "ep0ch-core"), join(m.claude, "ep0ch-core"));
    const plan = skillsStep(withSkills(look(m)));
    rmSync(join(m.claude, "ep0ch-core"));
    symlinkSync(join(m.old, "ep0ch"), join(m.claude, "ep0ch-core"));
    expect(() => applyLinks(plan.links!, () => {})).toThrow(/changed since the plan/);
    expect(readlinkSync(join(m.claude, "ep0ch-core"))).toBe(join(m.old, "ep0ch"));
  });

  test("a skill deleted from the repo: install's link to it is taken away next time, and nothing else", () => {
    const m = machine({ shared: true });
    applyLinks(skillsStep(withSkills(look(m))).links!, () => {});
    symlinkSync(join(m.old, "ep0ch"), join(m.claude, "kept-old"));   // someone else's link, its file there
    rmSync(join(m.door, "skills", "ep0ch-core"), { recursive: true });
    const facts = look(m);
    expect(facts.stale.map(s => s.dest)).toEqual([join(m.claude, "ep0ch-core"), join(m.shared, "ep0ch-core")]);
    expect(skillChecks(withSkills(facts)).filter(c => c.detail.includes("a skill that's gone")).map(c => c.fix)).toEqual([
      `rm ${join(m.claude, "ep0ch-core")}   (or ep0ch install --apply)`, `rm ${join(m.shared, "ep0ch-core")}   (or ep0ch install --apply)`]);
    const step = skillsStep(withSkills(facts));
    expect([step.status, step.why]).toEqual(["do", "2 stale to take away"]);
    applyLinks(step.links!, () => {});
    expect(existsSync(join(m.claude, "ep0ch-core"))).toBe(false);
    expect(readlinkSync(join(m.claude, "kept-old"))).toBe(join(m.old, "ep0ch"));
    expect(JSON.parse(readFileSync(m.record, "utf8")).links).not.toContain(join(m.claude, "ep0ch-core"));
    expect(skillsStep(withSkills(look(m)))).toMatchObject({ status: "skip" });
  });
});

describe("doctor: the art packs (PIE-596)", () => {
  test("none: the menus draw without art, and the fix names the checkout's own few pieces; found: ok", () => {
    const c = (art: Facts["art"]) => doctorChecks(laptop({ art })).find(x => x.name === "art packs");
    expect(c(undefined)).toBeUndefined();
    const none = c({ dir: "/srv/no-art", packs: 0, fromEnv: true })!;
    expect(none).toMatchObject({ group: "ep0ch", status: "info", detail: "none in /srv/no-art (EP0CH_PACKS): the menus draw without art" });
    expect(none.fix).toContain(`export EP0CH_PACKS=${REPO}/packages/door/test/fixtures/packs`);
    expect(c({ dir: "/srv/art", packs: 2, fromEnv: true })).toMatchObject({ status: "ok", detail: "2 in /srv/art" });
  });
});

describe("the outlines' schema (PIE-617): install migrates them, or refuses before updating", () => {
  const SCRIPT = "packages/outliner/scripts/migrations/0003-drop-agent-tables.ts";
  const code = (version: number, scripts: Record<number, string> = { 3: SCRIPT }) => ({ version, scripts });
  /** The laptop 9 behind origin/main, whose code opens schema 3; float-hub (and any `more`) at the given versions. */
  const bumped = (versions: Record<string, number | null>, o: { head?: number; upstream?: ReturnType<typeof code>; f?: Facts } = {}): Facts => {
    const f = o.f ?? laptop();
    const outlines = Object.entries(versions).map(([name, version]) => ({ name, path: `${HOME}/outlines/${name}.sqlite`, version, ...(version === null ? { error: "file is not a database" } : {}) }));
    return { ...f, databases: outlines.map(({ name, path }) => ({ name, path })),
      schema: { head: code(o.head ?? 2, {}), ...(f.repo.checkout.behind ? { upstream: o.upstream ?? code(3) } : {}), outlines } };
  };

  test("a bump in the update: back up, update, stop the host, migrate each outline behind, start the host; the plan says so", () => {
    const f = bumped({ "float-hub": 2, "seed-bank": 2 });
    const plan = buildPlan(f, opts());
    expect(plan.steps.map(s => `${s.id}:${s.status}`)).toEqual(["backup:do", "repo:do", "plugin:do", "link:do", "schema:do", "host:do", "session:skip"]);
    const schema = plan.steps.find(s => s.id === "schema")!;
    expect(schema.why).toBe("schema 2 → 3: will migrate 2 outlines (float-hub, seed-bank) with 0003-drop-agent-tables.ts; the host stops while they migrate (each in one transaction) and starts after");
    expect(schema.commands).toEqual(["launchctl bootout gui/$(id -u)/io.ep0ch.outliner-host",
      `bun ${REPO}/${SCRIPT} ${HOME}/outlines/float-hub.sqlite`, `bun ${REPO}/${SCRIPT} ${HOME}/outlines/seed-bank.sqlite`]);
    // Each outline is copied again just before its script (the host stopped): what going back restores, with the code before.
    expect(schema.migrate).toMatchObject({ from: 2, to: 3, stopsHost: true, before: "40aaaaa",
      outlines: [{ name: "float-hub", copy: `${HOME}/backups/ep0ch/20260314T092653Z/float-hub.schema-2.sqlite` }, { name: "seed-bank", copy: `${HOME}/backups/ep0ch/20260314T092653Z/seed-bank.schema-2.sqlite` }] });
    // launchd's job is booted out to stop it (KeepAlive would bring back a killed one), so it's bootstrapped again.
    expect(plan.steps.find(s => s.id === "host")).toMatchObject({ title: "Start the outline host on the new code", commands: [`launchctl bootstrap gui/$(id -u) ${launchd.path}`] });
    expect(formatPlan(f, plan, false)).toContain("schema 2 → 3: will migrate 2 outlines (float-hub, seed-bank) with 0003-drop-agent-tables.ts");
  });

  test("systemd stops and starts its unit the same way", () => {
    const f = float2();
    const linux = bumped({ pie: 2 }, { f: { ...f, repo: { ...f.repo, checkout: checkout(f.repo.root, { head: "40aaaaa", upstream: "49bbbbb", behind: 9 }) },
      host: { ...f.host, unit: { ...f.host.unit!, program: `${f.repo.outliner}/src/host-main.ts`, stale: [] } } } });
    const plan = buildPlan(linux, opts());
    expect(plan.steps.find(s => s.id === "schema")!.commands[0]).toBe("systemctl --user stop outliner-host.service");
    expect(plan.steps.find(s => s.id === "host")!.commands).toEqual(["systemctl --user start outliner-host.service"]);
  });

  test("an outline too old for the step, or a step whose script was deleted: refused before the checkout moves, with the import route", () => {
    for (const [f, said] of [[bumped({ "float-hub": 1 }), "0003-drop-agent-tables.ts takes schema 2 to 3 only"],
      [bumped({ "float-hub": 2 }, { upstream: code(3, {}) }), "no migration script takes schema 2 to 3"]] as const) {
      const plan = buildPlan(f, opts());
      // The managed plugin, refreshed from main, would be the new code too: held back with the checkout.
      expect(plan.steps.map(s => `${s.id}:${s.status}`)).toEqual(["backup:do", "repo:manual", "plugin:manual", "link:do", "schema:manual", "host:skip", "session:skip"]);
      const schema = plan.steps.find(s => s.id === "schema")!;
      expect(schema.why).toContain(said);
      const v = f.schema!.outlines[0]!.version;
      expect(schema.why).toContain(`import it into a new outline instead: launchctl bootout gui/$(id -u)/io.ep0ch.outliner-host; mv ${HOME}/outlines/float-hub.sqlite ${HOME}/outlines/float-hub.sqlite.schema-${v}; ep0ch install --apply; ep0ch outline import ${HOME}/outlines/float-hub.sqlite.schema-${v} float-hub`);
      expect(plan.steps.find(s => s.id === "repo")!).toMatchObject({ commands: [], why: expect.stringContaining("held back") });
    }
  });

  test("a host install can't stop (outside a unit, or another process at the socket) holds the update back too", () => {
    const outside = bumped({ "float-hub": 2 }, { f: laptop({ host: host({ unit: null }) }) });
    expect(statuses(outside)).toContain("schema:manual");
    expect(buildPlan(outside, opts()).steps.find(s => s.id === "schema")!.why).toContain("runs outside a launchd agent, so install can't stop it to migrate");
    const other = bumped({ "float-hub": 2 }, { f: laptop({ host: host({ unit: { ...launchd, state: { active: false, detail: "launchd: not running" } } }) }) });
    expect(buildPlan(other, opts()).steps.find(s => s.id === "schema")!.why).toContain("another process answers");
    expect(statuses(other)).toContain("repo:manual");
  });

  test("an outline behind the checkout it's on (a run that failed, a hand-run step): migrated without an update; nothing to go back to", () => {
    const f = bumped({ "float-hub": 2, "seed-bank": 3 }, { head: 3, f: current() });
    f.schema!.head = code(3);
    const plan = buildPlan(f, opts());
    expect(plan.steps.map(s => `${s.id}:${s.status}`)).toEqual(["backup:do", "repo:skip", "plugin:skip", "link:skip", "schema:do", "host:do", "session:skip"]);
    expect(plan.steps.find(s => s.id === "schema")!.migrate).toMatchObject({ outlines: [{ name: "float-hub" }] });
    expect(plan.steps.find(s => s.id === "schema")!.migrate!.before).toBeUndefined();
  });

  test("every outline at the schema, or one newer, migrates nothing; the rest of the plan is as before", () => {
    expect(statuses(bumped({ "float-hub": 3 }, { head: 3, f: current() }))).toEqual(["backup:skip", "repo:skip", "plugin:skip", "link:skip", "schema:skip", "host:skip", "session:skip"]);
    const plan = buildPlan(bumped({ "float-hub": 3, "seed-bank": 4 }), opts());
    expect(plan.steps.find(s => s.id === "schema")).toMatchObject({ status: "skip", why: "no outline is behind schema 3; seed-bank is schema 4, newer than this code opens" });
    expect(plan.steps.find(s => s.id === "repo")!.status).toBe("do");
  });

  test("an outline whose version can't be read holds back an update that changes the schema, and nothing else", () => {
    expect(statuses(bumped({ "float-hub": null }))).toContain("repo:manual");
    expect(statuses(bumped({ "float-hub": null }, { head: 3 }))).toContain("repo:do");
  });

  test("a failed migration: the outline named, its copy, the host left stopped, the rerun, and the way back with real commands", () => {
    const f = bumped({ "float-hub": 2, "seed-bank": 2 });
    const m = buildPlan(f, opts()).steps.find(s => s.id === "schema")!.migrate!;
    const copies = `${HOME}/backups/ep0ch/20260314T092653Z`;
    const said = migrationRecovery(f, m, { ...m.outlines[1]!, now: 2 }, [m.outlines[0]!]);
    expect(said).toContain(`seed-bank's script failed; it runs in one transaction, so the file should be as it was (it reads schema 2), and its copy from just before is ${copies}/seed-bank.schema-2.sqlite; float-hub is at schema 3`);
    expect(said).toContain("the outline host is left stopped, so no outline is served half-migrated");
    expect(said).toContain("ep0ch install --apply migrates what's left and starts the host");
    // Each step only after the one before worked; the failed outline restored too (failing isn't proof it's unchanged).
    expect(said).toContain(`or go back to the code before: git -C ${REPO} reset --hard 40aaaaa && cp ${copies}/float-hub.schema-2.sqlite ${HOME}/outlines/float-hub.sqlite && cp ${copies}/seed-bank.schema-2.sqlite ${HOME}/outlines/seed-bank.sqlite && launchctl bootstrap gui/$(id -u) ${launchd.path}`);
  });

  test("every path in the commands is quoted when it needs to be (a folder with a space)", () => {
    const repo = "/Users/wren/my projects/ep0ch", folder = "/Users/wren/my outlines";
    const base = laptop();
    const f = bumped({}, { f: { ...base, repo: { ...base.repo, root: repo, outliner: `${repo}/packages/outliner` },
      host: host({ folder, unit: { ...launchd, path: "/Users/wren/Library/Launch Agents/io.ep0ch.outliner-host.plist", program: `${repo}/packages/outliner/src/host-main.ts` } }) } });
    f.schema!.outlines = [{ name: "float-hub", path: `${folder}/float-hub.sqlite`, version: 2 }];
    f.databases = [{ name: "float-hub", path: `${folder}/float-hub.sqlite` }];
    const plan = buildPlan(f, opts({ backupDir: "/Users/wren/back ups" }));
    const schema = plan.steps.find(s => s.id === "schema")!;
    expect(schema.commands[1]).toBe(`bun '${repo}/${SCRIPT}' '${folder}/float-hub.sqlite'`);
    expect(plan.steps.find(s => s.id === "host")!.commands).toEqual([`launchctl bootstrap gui/$(id -u) '/Users/wren/Library/Launch Agents/io.ep0ch.outliner-host.plist'`]);
    const m = schema.migrate!;
    expect(migrationRecovery(f, m, { ...m.outlines[0]!, now: 2 }, [])).toContain(`git -C '${repo}' reset --hard 40aaaaa && cp '/Users/wren/back ups/20260314T092653Z/float-hub.schema-2.sqlite' '${folder}/float-hub.sqlite' && launchctl bootstrap`);
    const old = bumped({ "float-hub": 1 }, { f: { ...base, host: host({ folder }) } });
    old.schema!.outlines = [{ name: "float-hub", path: `${folder}/float-hub.sqlite`, version: 1 }];
    expect(buildPlan(old, opts()).steps.find(s => s.id === "schema")!.why).toContain(`mv '${folder}/float-hub.sqlite' '${folder}/float-hub.sqlite.schema-1'; ep0ch install --apply; ep0ch outline import '${folder}/float-hub.sqlite.schema-1' float-hub`);
  });

  test("once the host is stopped the outlines are read again: one made since the plan is migrated too, one too old stops the step first", () => {
    const folder = join(scratch, "outlines found again");
    mkdirSync(folder, { recursive: true });
    const at = (name: string, version: number) => { const db = new Database(join(folder, `${name}.sqlite`)); db.exec(`CREATE TABLE seeds (x); PRAGMA user_version = ${version}`); db.close(); };
    at("allotment", 2); at("greenhouse", 2); at("orchard", 3);
    const m = { from: 2, to: 3, script: "/s/0003-x.ts", stopsHost: true, copyDir: "/b/20260314T092653Z",
      outlines: [{ name: "allotment", path: join(folder, "allotment.sqlite"), copy: "/b/20260314T092653Z/allotment.schema-2.sqlite" }] };
    expect(outlinesToMigrate(m, folder)).toEqual({ blocked: [], outlines: [
      { name: "allotment", path: join(folder, "allotment.sqlite"), copy: "/b/20260314T092653Z/allotment.schema-2.sqlite" },
      { name: "greenhouse", path: join(folder, "greenhouse.sqlite"), copy: "/b/20260314T092653Z/greenhouse.schema-2.sqlite" }] });
    at("seed-bank", 1);
    expect(outlinesToMigrate(m, folder).blocked).toEqual([{ name: "seed-bank", path: join(folder, "seed-bank.sqlite"), version: 1 }]);
  });

  test("after a failed run, an outline that can't take the step keeps the stopped host stopped", () => {
    const f = bumped({ "float-hub": 3, "seed-bank": 1 }, { head: 3, f: current() });
    f.schema!.head = code(3);
    const stopped = { ...f, host: host({ running: false, unit: { ...launchd, state: { active: false, detail: "not loaded in launchd" } } }) };
    const plan = buildPlan(stopped, opts());
    expect(plan.steps.find(s => s.id === "schema")!.status).toBe("manual");
    expect(plan.steps.find(s => s.id === "host")).toMatchObject({ status: "manual", commands: [], why: expect.stringContaining("started it would serve only some") });
  });

  test("doctor flags an outline behind the checkout's schema, with install as the fix (or why install can't)", () => {
    const checks = (f: Facts) => Object.fromEntries(doctorChecks(f).map(c => [`${c.group}/${c.name}`, c]));
    const behind = bumped({ "float-hub": 2 }, { head: 3, f: current() });
    behind.schema!.head = code(3);
    expect(checks(behind)["outlines/schema"]).toMatchObject({ status: "behind", detail: "float-hub is schema 2; the checkout's code opens only schema 3, so the host refuses it", fix: "ep0ch install --apply" });
    const old = bumped({ "float-hub": 1 }, { head: 3, f: current() });
    old.schema!.head = code(3);
    expect(checks(old)["outlines/schema"]!.fix).toContain("import it into a new outline instead");
    const fine = bumped({ "float-hub": 3 }, { head: 3, f: current() });
    expect(checks(fine)["outlines/schema"]).toMatchObject({ status: "ok", detail: "float-hub at schema 3, what the checkout's code opens" });
  });

  test("the code's schema from schema.ts and the migration folder's names; an outline's from its file, read-only", () => {
    expect(schemaCodeOf("export const SCHEMA_VERSION = 4;\n", ["0001-stamp.ts", "0004-split-props.ts", "README.md"]))
      .toEqual({ version: 4, scripts: { 1: "packages/outliner/scripts/migrations/0001-stamp.ts", 4: "packages/outliner/scripts/migrations/0004-split-props.ts" } });
    expect(schemaCodeOf(null, [], "gone").version).toBeNull();
    const path = join(scratch, "schema-read.sqlite");
    const db = new Database(path);
    db.exec("PRAGMA journal_mode = WAL; CREATE TABLE seeds (name TEXT); PRAGMA user_version = 2");
    // Open (as a host holds it): read all the same, and the file isn't changed.
    expect(outlineSchema({ name: "schema-read", path })).toEqual({ name: "schema-read", path, version: 2 });
    db.close();
    writeFileSync(join(scratch, "not-a-db.sqlite"), "compost");
    expect(outlineSchema({ name: "not-a-db", path: join(scratch, "not-a-db.sqlite") })).toMatchObject({ version: null, error: expect.any(String) });
  });
});
