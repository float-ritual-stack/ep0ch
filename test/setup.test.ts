// `ep0ch doctor` and `ep0ch install` (PIE-450): the plan and the report from described machines (no real
// stack is read), the platform, the PATH link chooser, backup naming, and the read-only probes on scratch
// files. The sandboxed --apply run is in the PR; nothing here touches a real outline, Herdr or checkout.
import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDatabase, confirmServicePane, formatPlan, setupCommand, tilde } from "../src/setup/apply";
import { OUTLINE_CAPABILITIES } from "../src/socket";
import { doctorChecks, formatDoctor, versionAtLeast } from "../src/setup/doctor";
import { databases, depsState, herdrKeys, hostFacts, hostUnit, launchdState, openOutlineToPing, systemdState } from "../src/setup/facts";
import { type Checkout, detectPlatform, type Facts, type HostFacts, type ServiceFacts, staleness } from "../src/setup/model";
import { backupName, buildPlan, checkoutStep, chooseLinkDir, hostStep, hostUnitArgv, linkCandidates, type PlanOptions, stamp } from "../src/setup/plan";

const scratch = mkdtempSync(join(tmpdir(), "ep0ch-setup-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const HOME = "/Users/wren";
/** What the fictional installed plugin offers: everything the door uses, and one more. */
const CAPS = [...OUTLINE_CAPABILITIES, "mutations.provenance"];
const now = new Date("2026-03-14T09:26:53.589Z");
const opts = (o: Partial<PlanOptions> = {}): PlanOptions => ({ restartServices: false, now, backupDir: `${HOME}/backups/ep0ch`, ...o });

const checkout = (root: string, o: Partial<Checkout> = {}): Checkout =>
  ({ root, git: true, branch: "main", head: "1111111aaaa", upstream: "1111111aaaa", ahead: 0, behind: 0, dirty: false, ...o });

/** A Homebrew Mac like the one in PIE-450: managed plugin behind, door behind, no ep0ch, a folder service on old code. */
function laptop(o: Partial<Facts> = {}): Facts {
  const pluginRoot = `${HOME}/.config/herdr/plugins/github/float.pi-outliner-0a1b2c`;
  return {
    platform: "macos", home: HOME, pathDirs: ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"],
    bun: { path: "/opt/homebrew/bin/bun", version: "1.4.2" },
    herdr: { path: "/opt/homebrew/bin/herdr", version: "0.9.1", server: true, configPath: `${HOME}/.config/herdr/config.toml`, inside: true,
      keys: { "open-here": "prefix+u", "open-tree": "prefix+shift+u", "comment-selection": "prefix+shift+a", capture: "prefix+shift+c" } },
    plugin: { id: "float.pi-outliner", kind: "github", root: pluginRoot, manifestPath: `${pluginRoot}/herdr-plugin.toml`, enabled: true,
      source: { owner: "float-ritual-stack", repo: "pi-herdr-outliner", ref: "main", commit: "239aaaa0000" }, checkout: null,
      remote: { commit: "246bbbb0000" }, protocol: 82, capabilities: CAPS, deps: { needed: false, why: "ok" }, actions: ["open-here", "open-tree", "comment-selection", "capture", "open"] },
    door: { checkout: checkout(`${HOME}/projects/ep0ch-door`, { head: "40aaaaa", upstream: "49bbbbb", behind: 9 }), deps: { needed: false, why: "ok" }, entry: `${HOME}/projects/ep0ch-door/src/main.ts` },
    ep0ch: { found: null, target: null, pointsHere: false },
    linkDirs: [{ dir: `${HOME}/.local/bin`, onPath: false, writable: false }, { dir: "/opt/homebrew/bin", onPath: true, writable: true }, { dir: "/usr/local/bin", onPath: true, writable: false }],
    host: { socket: `${HOME}/.local/state/pi-herdr-outliner/outliner.sock`, configured: false, running: false, outlines: [], unit: null },
    services: [{ stateDir: `${HOME}/.local/state/pi-herdr-outliner/a1b2c3d4e5f6`, socket: `${HOME}/.local/state/pi-herdr-outliner/a1b2c3d4e5f6/outliner.sock`,
      database: `${HOME}/.local/state/pi-herdr-outliner/a1b2c3d4e5f6/outliner.sqlite`, running: true, name: "seed-library", root: `${HOME}/seed-library`,
      protocol: 82, capabilities: CAPS.filter(c => c !== "fragments.candidates"), paneId: "w2:p5" }],
    databases: [{ name: "seed-library", path: `${HOME}/.local/state/pi-herdr-outliner/a1b2c3d4e5f6/outliner.sqlite`, from: "folder" }],
    claude: { settingsPath: `${HOME}/.claude/settings.json`, settingsDirs: [`${pluginRoot}/claude-mod`], envDirs: null },
    expected: CAPS,
    ...o,
  };
}

/** The same machine once everything is current. */
function current(): Facts {
  const f = laptop();
  return { ...f, plugin: { ...f.plugin!, remote: { commit: "239aaaa0000" } }, door: { ...f.door, checkout: checkout(f.door.checkout.root) },
    ep0ch: { found: "/opt/homebrew/bin/ep0ch", target: f.door.entry, pointsHere: true }, services: [{ ...f.services[0]!, capabilities: CAPS }] };
}

const statuses = (f: Facts, o = opts()) => buildPlan(f, o).steps.map(s => `${s.id}:${s.status}`);

describe("platform", () => {
  test("linux and darwin by name; anything else is other, and nothing assumes systemd or launchd", () => {
    expect(detectPlatform("linux")).toBe("linux");
    expect(detectPlatform("darwin")).toBe("macos");
    expect(detectPlatform("win32")).toBe("other");
  });

  test("the host unit is looked for where the platform keeps them, by what it runs", () => {
    const home = join(scratch, "unit-home");
    mkdirSync(join(home, ".config/systemd/user"), { recursive: true });
    mkdirSync(join(home, "Library/LaunchAgents"), { recursive: true });
    writeFileSync(join(home, ".config/systemd/user/compost.service"), "[Service]\nExecStart=/usr/bin/true\n");
    writeFileSync(join(home, ".config/systemd/user/garden-host.service"), "[Service]\nExecStart=bun /opt/outliner/src/host-main.ts\n");
    writeFileSync(join(home, "Library/LaunchAgents/io.example.garden.plist"), "<key>Label</key><string>io.example.garden-host</string>\n<array><string>/opt/homebrew/bin/bun</string><string>/opt/outliner/src/host-main.ts</string></array>");
    expect(hostUnit("linux", home)).toEqual({ kind: "systemd", path: join(home, ".config/systemd/user/garden-host.service"), name: "garden-host.service", program: "/opt/outliner/src/host-main.ts" });
    // launchd names a job by its Label, not its file.
    expect(hostUnit("macos", home)).toEqual({ kind: "launchd", path: join(home, "Library/LaunchAgents/io.example.garden.plist"), name: "io.example.garden-host", program: "/opt/outliner/src/host-main.ts" });
    expect(hostUnit("other", home)).toBeNull();
  });

  test("only a unit serving the asked state folder is the host's: another folder's unit is another host, never restarted for this one", () => {
    const home = join(scratch, "unit-state-home");
    const dir = join(home, ".config/systemd/user");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "orchard-host.service"), "[Service]\nEnvironment=OUTLINER_STATE_DIR=%h/.local/state/orchard\nExecStart=bun /opt/outliner/src/host-main.ts\n");
    // A scratch folder (a test's host): no unit serves it.
    expect(hostUnit("linux", home, join(scratch, "scratch-state"))).toBeNull();
    // The default folder: this unit sets another one, so it isn't the default host's either.
    expect(hostUnit("linux", home)).toBeNull();
    expect(hostUnit("linux", home, join(home, ".local/state/orchard"))?.name).toBe("orchard-host.service");
    const mac = join(scratch, "unit-state-mac");
    mkdirSync(join(mac, "Library/LaunchAgents"), { recursive: true });
    writeFileSync(join(mac, "Library/LaunchAgents/io.example.orchard.plist"), `<key>Label</key><string>io.example.orchard</string><key>EnvironmentVariables</key><dict><key>OUTLINER_STATE_DIR</key><string>${mac}/state/orchard/</string></dict><array><string>/opt/outliner/src/host-main.ts</string></array>`);
    expect(hostUnit("macos", mac, join(mac, "state/orchard"))?.name).toBe("io.example.orchard");
    expect(hostUnit("macos", mac)).toBeNull();
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
  test("<outline name>-<UTC timestamp>.sqlite; a second database of the same name gets -2", () => {
    expect(stamp(now)).toBe("20260314T092653Z");
    const taken = new Set<string>();
    expect(backupName("seed-library", now, taken)).toBe("seed-library-20260314T092653Z.sqlite");
    expect(backupName("seed-library", now, taken)).toBe("seed-library-20260314T092653Z-2.sqlite");
    expect(backupName("Seed Library!", now)).toBe("seed-library-20260314T092653Z.sqlite");
  });
});

describe("the plan", () => {
  test("a behind laptop: backup first, then plugin, door and link; restarts only offered", () => {
    const plan = buildPlan(laptop(), opts());
    expect(plan.steps.map(s => `${s.id}:${s.status}`)).toEqual(["backup:do", "plugin:do", "door:do", "link:do", "restart:offer", "host:skip"]);
    const [backup, plugin, door, link, restart] = plan.steps;
    expect(backup!.backups!.map(b => b.dest)).toEqual([`${HOME}/backups/ep0ch/seed-library-20260314T092653Z.sqlite`]);
    expect(plugin!.commands).toEqual(["herdr plugin install float-ritual-stack/pi-herdr-outliner --ref main --yes"]);
    expect(door!.commands[0]).toBe(`git -C ${HOME}/projects/ep0ch-door pull --ff-only origin main`);
    expect(door!.why).toContain("9 commits behind");
    expect(link!.commands).toEqual([`ln -s ${HOME}/projects/ep0ch-door/src/main.ts /opt/homebrew/bin/ep0ch`]);
    expect(restart!.why).toContain("seed-library (missing fragments.candidates)");
    expect(restart!.why).toContain("--restart-services");
    expect(plan.notes.join("\n")).toContain("launchd");
  });

  test("--restart-services restarts the old services through their Herdr pane and the Outliner's own launcher", () => {
    const restart = buildPlan(laptop(), opts({ restartServices: true })).steps[4]!;
    expect(restart.status).toBe("do");
    expect(restart.commands).toEqual(["herdr pane close w2:p5",
      `OUTLINER_OPEN_WORKSPACE_ROOT=${HOME}/seed-library bun run ${HOME}/.config/herdr/plugins/github/float.pi-outliner-0a1b2c/src/herdr-open.ts --mode service-only`]);
  });

  test("outside Herdr, or without a recorded pane, a restart is left to the person", () => {
    const outside = laptop({ herdr: { ...laptop().herdr, inside: false } });
    expect(buildPlan(outside, opts({ restartServices: true })).steps[4]!.status).toBe("manual");
    const noPane = laptop({ services: [{ ...laptop().services[0]!, paneId: undefined } as ServiceFacts] });
    expect(buildPlan(noPane, opts({ restartServices: true })).steps[4]!.status).toBe("manual");
  });

  test("everything current: every step skipped, the backup too (a second run does nothing)", () => {
    expect(statuses(current())).toEqual(["backup:skip", "plugin:skip", "door:skip", "link:skip", "restart:skip", "host:skip"]);
  });

  test("only a restart to do still backs up first", () => {
    const f = { ...current(), services: laptop().services };
    expect(statuses(f, opts({ restartServices: true }))).toEqual(["backup:do", "plugin:skip", "door:skip", "link:skip", "restart:do", "host:skip"]);
  });

  test("a plugin update makes running services candidates, checked again after it", () => {
    const f = { ...current(), plugin: laptop().plugin };
    const restart = buildPlan(f, opts()).steps[4]!;
    expect(restart.status).toBe("offer");
    expect(restart.why).toContain("checked again after the plugin update");
  });

  test("a managed install Herdr can't compare is left to the person, with the refresh command", () => {
    const f = laptop({ plugin: { ...laptop().plugin!, remote: { commit: null, error: "could not resolve host" } } });
    const step = buildPlan(f, opts()).steps[1]!;
    expect(step.status).toBe("manual");
    expect(step.why).toContain("managed, cannot compare (could not resolve host)");
    expect(step.commands).toEqual(["herdr plugin install float-ritual-stack/pi-herdr-outliner --ref main --yes"]);
  });

  test("a linked checkout: fast-forward, bun install when needed, and the cases a person must handle", () => {
    const root = "/home/wren/src/outliner";
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

  test("ep0ch: another door checkout's link is left alone; a stranger on PATH or no writable directory needs the person", () => {
    const other = laptop({ ep0ch: { found: "/opt/homebrew/bin/ep0ch", target: "/Users/wren/old/ep0ch-door/src/main.ts", pointsHere: false } });
    expect(buildPlan(other, opts()).steps[3]).toMatchObject({ status: "skip" });
    const stranger = laptop({ ep0ch: { found: "/usr/local/bin/ep0ch", target: "/usr/local/bin/ep0ch", pointsHere: false } });
    expect(buildPlan(stranger, opts()).steps[3]!.status).toBe("manual");
    const nowhere = laptop({ linkDirs: laptop().linkDirs.map(d => ({ ...d, writable: false })) });
    expect(buildPlan(nowhere, opts()).steps[3]!.why).toContain("never uses sudo");
    const broken = laptop({ linkDirs: [{ dir: "/opt/homebrew/bin", onPath: true, writable: true, existing: "broken-link" }] });
    expect(buildPlan(broken, opts()).steps[3]!.commands).toEqual([`ln -sfn ${HOME}/projects/ep0ch-door/src/main.ts /opt/homebrew/bin/ep0ch`]);
  });

  test("the dry run prints each step with its mark and command", () => {
    const f = laptop();
    const text = formatPlan(f, buildPlan(f, opts()), false);
    expect(text).toContain("dry run");
    expect(text).toMatch(/^1 → Back up every local outline database$/m);
    expect(text).toContain(`seed-library: ${HOME}/.local/state/pi-herdr-outliner/a1b2c3d4e5f6/outliner.sqlite → ${HOME}/backups/ep0ch/seed-library-20260314T092653Z.sqlite`);
    expect(text).toMatch(/^5 \? Restart per-folder services running old code$/m);
  });
});

describe("the outline host under launchd (the Mac) or systemd", () => {
  const PLUGIN = `${HOME}/.config/herdr/plugins/github/float.pi-outliner-0a1b2c`;
  const unit = { kind: "launchd" as const, path: `${HOME}/Library/LaunchAgents/io.example.outliner-host.plist`, name: "io.example.outliner-host", program: `${PLUGIN}/src/host-main.ts`,
    state: { active: true, pid: 4242, lastExit: "(never exited)", detail: "launchd: running, pid 4242" } };
  const host = (o: Partial<HostFacts> = {}): HostFacts => ({ socket: `${HOME}/.local/state/pi-herdr-outliner/outliner.sock`, configured: true, running: true,
    defaultOutline: "orchard", outlines: [{ name: "orchard", open: true, default: true } as any], protocol: 82, capabilities: CAPS, unit, ...o });
  const mac = (o: Partial<HostFacts> = {}, f: Partial<Facts> = {}) => ({ ...current(), host: host(o), ...f });

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

  test("current code: nothing to restart", () => {
    expect(hostStep(mac(), false)).toMatchObject({ status: "skip" });
  });

  test("a plugin update restarts the host with launchd's kickstart -k; the doors on it reconnect", () => {
    const step = hostStep(mac(), true);
    expect(step).toMatchObject({ id: "host", status: "do", commands: ["launchctl kickstart -k gui/$(id -u)/io.example.outliner-host"] });
    expect(step.why).toContain("the plugin is updated in this run");
    expect(hostUnitArgv(unit, "restart", 501)).toEqual(["launchctl", "kickstart", "-k", "gui/501/io.example.outliner-host"]);
    // In the whole plan it follows the plugin, and the backup comes first.
    const plan = buildPlan(mac({}, { plugin: laptop().plugin }), opts());
    expect(plan.steps.map(s => `${s.id}:${s.status}`)).toEqual(["backup:do", "plugin:do", "door:skip", "link:skip", "restart:offer", "host:do"]);
  });

  test("a host missing what the plugin offers is restarted too, and doctor says install does it", () => {
    const old = mac({ capabilities: CAPS.filter(c => c !== "fragments.candidates") });
    expect(hostStep(old, false)).toMatchObject({ status: "do" });
    const c = Object.fromEntries(doctorChecks(old).map(x => [`${x.group}/${x.name}`, x]));
    expect(c["services/outline host"]).toMatchObject({ status: "behind", fix: "ep0ch install --apply restarts it (launchctl kickstart -k gui/$(id -u)/io.example.outliner-host)" });
  });

  test("set up but not answering: doctor names launchd's state and the command that starts it; install starts it", () => {
    const down = mac({ running: false, outlines: [], unit: { ...unit, state: { active: false, lastExit: "1", detail: "launchd: not running, last exit 1" } } });
    const c = Object.fromEntries(doctorChecks(down).map(x => [`${x.group}/${x.name}`, x]));
    expect(c["services/outline host"]).toMatchObject({ status: "missing", fix: "launchctl kickstart gui/$(id -u)/io.example.outliner-host" });
    expect(c["services/outline host"]!.detail).toContain("launchd: not running, last exit 1");
    expect(hostStep(down, false)).toMatchObject({ status: "do", title: "Start the outline host" });
    // A job launchd doesn't have loaded is bootstrapped from its plist.
    const unloaded = mac({ running: false, outlines: [], unit: { ...unit, state: { active: false, detail: "not loaded in launchd" } } });
    expect(hostStep(unloaded, false).commands).toEqual([`launchctl bootstrap gui/$(id -u) ${unit.path}`]);
  });

  test("a unit running another checkout's host-main.ts is left to the person: a restart would bring the old code back", () => {
    const stray = mac({ unit: { ...unit, program: `${HOME}/projects/pi-herdr-outliner/src/host-main.ts` } });
    const step = hostStep(stray, true);
    expect(step.status).toBe("manual");
    expect(step.why).toContain(`runs ${HOME}/projects/pi-herdr-outliner/src/host-main.ts, not the installed plugin's`);
    expect(doctorChecks(stray).find(x => x.name === "host unit")).toMatchObject({ status: "behind" });
  });

  test("a host outside any unit is restarted by the person; systemd's is restarted with systemctl", () => {
    expect(hostStep(mac({ unit: null }), true)).toMatchObject({ status: "manual" });
    const linux = { ...mac({ unit: { kind: "systemd", path: "/home/wren/.config/systemd/user/outliner-host.service", name: "outliner-host.service", program: `${PLUGIN}/src/host-main.ts` } }), platform: "linux" as const };
    expect(hostStep(linux, true).commands).toEqual(["systemctl --user restart outliner-host.service"]);
  });

  test("a linked checkout under a systemd unit (float-2): the unit runs that checkout, so a pull restarts it through systemd", () => {
    const root = "/home/wren/projects/pi-herdr-outliner";
    const linked = { ...mac({ unit: { kind: "systemd", path: "/home/wren/.config/systemd/user/outliner-host.service", name: "outliner-host.service", program: `${root}/src/host-main.ts`,
      state: { active: true, pid: 77, detail: "systemd: active (running), pid 77" } } }), platform: "linux" as const };
    linked.plugin = { ...linked.plugin!, kind: "local", root };
    expect(hostStep(linked, true)).toMatchObject({ status: "do", commands: ["systemctl --user restart outliner-host.service"] });
    // Nothing pulled and nothing missing: the host is left running.
    expect(hostStep(linked, false)).toMatchObject({ status: "skip" });
  });

  test("the socket answers but the unit isn't running: another process serves it, and install doesn't start the unit beside it", () => {
    const beside = mac({ unit: { ...unit, state: { active: false, lastExit: "1", detail: "launchd: not running, last exit 1" } } });
    expect(hostStep(beside, true)).toMatchObject({ status: "manual" });
    expect(hostStep(beside, true).why).toContain("another process answers");
    expect(hostStep(beside, false)).toMatchObject({ status: "skip" });
  });
});

describe("the doctor", () => {
  const byName = (f: Facts) => Object.fromEntries(doctorChecks(f).map(c => [`${c.group}/${c.name}`, c]));

  test("the laptop: what's behind, with the command that fixes it", () => {
    const c = byName(laptop());
    expect(c["plugin/installed"]).toMatchObject({ status: "behind", fix: "herdr plugin install float-ritual-stack/pi-herdr-outliner --ref main --yes" });
    expect(c["door/checkout"]!.status).toBe("behind");
    expect(c["door/ep0ch on PATH"]).toMatchObject({ status: "missing", fix: `ln -s ${HOME}/projects/ep0ch-door/src/main.ts /opt/homebrew/bin/ep0ch` });
    expect(c["services/folder seed-library"]).toMatchObject({ status: "behind", fix: "ep0ch install --apply --restart-services" });
    expect(c["services/folder seed-library"]!.detail).toContain("missing fragments.candidates: restart to pick up new features");
    expect(c["services/outline host"]!.status).toBe("info");
    expect(c["claude/claude-mod"]!.status).toBe("ok");
    expect(formatDoctor(laptop())).toMatch(/^ {2}! installed/m);
  });

  test("ep0ch running another door checkout is information (install leaves it alone); a stranger on PATH is behind", () => {
    const other = laptop({ ep0ch: { found: "/opt/homebrew/bin/ep0ch", target: "/Users/wren/old/ep0ch-door/src/main.ts", pointsHere: false } });
    expect(byName(other)["door/ep0ch on PATH"]!.status).toBe("info");
    const stranger = laptop({ ep0ch: { found: "/usr/local/bin/ep0ch", target: "/usr/local/bin/ep0ch", pointsHere: false } });
    expect(byName(stranger)["door/ep0ch on PATH"]!.status).toBe("behind");
  });

  test("all current is all ✓", () => {
    expect(doctorChecks(current()).filter(c => c.status === "behind" || c.status === "missing")).toEqual([]);
  });

  test("a plugin older than the door says which capabilities the door would miss", () => {
    const f = current();
    f.plugin = { ...f.plugin!, capabilities: ["blocks.read"] };
    expect(byName(f)["plugin/for the door"]!.detail).toContain("fragments.candidates");
  });

  test("a checkout whose fetch failed is never ✓: it couldn't be checked, and the summary says so", () => {
    const f = current();
    f.door = { ...f.door, checkout: checkout(f.door.checkout.root, { fetchError: "timed out after 90s" }) };
    const door = buildPlan(f, opts()).steps[2]!;
    expect(door).toMatchObject({ status: "manual", unchecked: true });
    expect(door.why).toContain("couldn't check against origin/main: git fetch failed (timed out after 90s), so the door checkout wasn't updated");
    expect(byName(f)["door/checkout"]!.status).toBe("unknown");
    const text = formatDoctor(f);
    expect(text).toMatch(/^ {2}\? checkout/m);
    expect(text).not.toContain("all current");
    expect(text).toContain("1 couldn't be checked (? above); the rest is current");
  });

  test("a managed install that can't be compared says so: it couldn't be checked, not current", () => {
    const c = byName(laptop({ plugin: { ...laptop().plugin!, remote: { commit: null, error: "offline" } } }));
    expect(c["plugin/installed"]!.status).toBe("unknown");
    expect(c["plugin/installed"]!.detail).toContain("managed, cannot compare");
  });

  test("a Claude mod from an older plugin root is stale; FORCE_HYPERLINK is noted", () => {
    const f = current();
    f.claude = { ...f.claude, settingsDirs: [`${HOME}/.config/herdr/plugins/github/float.pi-outliner-99ffee/claude-mod`], forceHyperlink: "1" };
    const c = byName(f);
    expect(c["claude/claude-mod"]).toMatchObject({ status: "behind" });
    expect(c["claude/claude-mod"]!.fix).toContain("scripts/install-claude-mod.ts");
    // No workspace to name: each Claude session follows its folder's bound outline (PIE-526).
    expect(c["claude/claude-mod"]!.fix).toMatch(/install-claude-mod\.ts$/);
    expect(c["claude/FORCE_HYPERLINK"]!.detail).toContain("PIE-486");
  });

  test("the Claude mod needs no workspace; a folder list with no mode is noted (opted out now), never a fix", () => {
    const f = current();
    expect(byName(f)["claude/mentions"]).toBeUndefined();
    for (const mentions of [{ listed: false }, { listed: true, mode: "folder" }, { listed: true, mode: "allowlist" }]) {
      f.claude = { ...f.claude, mentions };
      expect(byName(f)["claude/mentions"]).toBeUndefined();
    }
    f.claude = { ...f.claude, mentions: { listed: true } };
    const row = byName(f)["claude/mentions"]!;
    expect(row.status).toBe("info");
    expect(row.fix).toBeUndefined();
    expect(row.detail).toContain("reads as folders opted out");
    expect(row.detail).toContain("install-claude-mod.ts --folder drops it, and then every folder bound to an outline feeds that outline");
    expect(row.detail).toContain("--allowlist <folder> keeps strict mode");
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
    expect(staleness({ protocol: 81, capabilities: ["a"] }, ["a", "b"], 82)).toEqual(["protocol 81 < 82", "b"]);
    expect(staleness({ protocol: 82, capabilities: null }, ["a"], 82)).toEqual([]);
  });
});

describe("read-only probes on scratch files", () => {
  test("bun install is needed when node_modules or a package is missing, or a version differs from bun.lock", () => {
    const root = join(scratch, "door");
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

  test("Herdr keys are read from [[keys.command]] blocks naming the plugin's actions", () => {
    const path = join(scratch, "config.toml");
    writeFileSync(path, `onboarding = false\n\n[[keys.command]]\nkey = "prefix+u"\ntype = "plugin_action"\ncommand = "float.pi-outliner.open-here"\n\n[[keys.command]]\nkey = "prefix+g"\ntype = "plugin_action"\ncommand = "other.plugin.open-here"\n\n[theme]\nname = "x"\n`);
    expect(herdrKeys(path)).toEqual({ "open-here": "prefix+u" });
    expect(herdrKeys(join(scratch, "none.toml"))).toEqual({});
  });

  test("databases: host outlines by name (links followed), then folder services, each once", () => {
    const base = join(scratch, "state");
    mkdirSync(join(base, "outlines"), { recursive: true });
    mkdirSync(join(base, "0123456789ab"), { recursive: true });
    writeFileSync(join(base, "0123456789ab/outliner.sqlite"), "");
    symlinkSync(join(base, "0123456789ab/outliner.sqlite"), join(base, "outlines/orchard.sqlite"));
    mkdirSync(join(base, "ba9876543210"), { recursive: true });
    writeFileSync(join(base, "ba9876543210/outliner.sqlite"), "");
    const host = { socket: "", configured: true, running: false, outlines: [], unit: null };
    const services: ServiceFacts[] = [
      { stateDir: join(base, "0123456789ab"), socket: "", database: join(base, "0123456789ab/outliner.sqlite"), running: false, name: "orchard" },
      { stateDir: join(base, "ba9876543210"), socket: "", database: join(base, "ba9876543210/outliner.sqlite"), running: false, name: "seed-library" },
    ];
    expect(databases(base, host, services).map(d => `${d.name}:${d.from}`)).toEqual(["orchard:host", "seed-library:folder"]);
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
  test("a flag that doesn't belong is refused before anything is read", async () => {
    const said: string[] = [];
    const io = { out: (s: string) => said.push(s), err: (s: string) => said.push(s) };
    expect(await setupCommand(["doctor", "--apply"], io)).toBe(2);
    expect(await setupCommand(["install", "--yes"], io)).toBe(2);
    expect(said.every(s => s.includes("ep0ch install [--apply] [--restart-services]"))).toBe(true);
  });
});

test("text output shows the home directory as ~ (JSON keeps whole paths)", () => {
  expect(tilde("ep0ch doctor · linux · /home/wren\n  $ ln -s /home/wren/door/src/main.ts /home/wren/.local/bin/ep0ch (x /home/wren)", "/home/wren"))
    .toBe("ep0ch doctor · linux · ~\n  $ ln -s ~/door/src/main.ts ~/.local/bin/ep0ch (x ~)");
  expect(tilde("/home/wrenfield/x", "/home/wren")).toBe("/home/wrenfield/x");
});

test("a managed install from another ref (a PR branch) is compared with main and refreshed from main", () => {
  const f = laptop({ plugin: { ...laptop().plugin!, source: { owner: "float-ritual-stack", repo: "pi-herdr-outliner", ref: "pr-239", commit: "239aaaa0000" } } });
  const step = buildPlan(f, opts()).steps[1]!;
  expect(step.why).toContain("installed from pr-239, refreshed from main");
  expect(step.commands).toEqual(["herdr plugin install float-ritual-stack/pi-herdr-outliner --ref main --yes"]);
});

describe("never starting an outline, never closing a pane it can't confirm", () => {
  test("the host is pinged only through an open outline: the default when open, else another open one, else not at all", () => {
    const o = (name: string, open: boolean, def = false) => ({ name, database: `/x/${name}.sqlite`, adopted: false, open, default: def });
    expect(openOutlineToPing([o("orchard", true), o("pond", true, true)])).toBe("pond");
    expect(openOutlineToPing([o("pond", false, true), o("orchard", true)])).toBe("orchard");
    expect(openOutlineToPing([o("pond", false, true)])).toBeNull();
  });

  test("doctor's host probe never sends a plain ping (the host would open a closed default outline)", async () => {
    const base = join(scratch, "host-state");
    mkdirSync(join(base, "outlines"), { recursive: true });
    const seen: any[] = [];
    const server = Bun.listen<{ buf: string }>({ unix: join(base, "outliner.sock"), socket: {
      open(s) { s.data = { buf: "" }; },
      data(s, d) {
        s.data.buf += d.toString();
        const nl = s.data.buf.indexOf("\n");
        if (nl < 0) return;
        const req = JSON.parse(s.data.buf.slice(0, nl));
        seen.push(req);
        const result = req.action === "outlines.list"
          ? { defaultOutline: "pond", outlines: [{ name: "pond", database: "/x/pond.sqlite", adopted: false, open: false, default: true }] }
          : { protocolVersion: 82, capabilities: [] };
        s.write(JSON.stringify({ id: req.id, ok: true, result, sequence: 0 }) + "\n");
      },
    } });
    try {
      const h = await hostFacts(base, "linux", scratch);
      expect(h.running).toBe(true);
      expect(h.protocol).toBeUndefined();
      expect(seen.map(r => r.action)).not.toContain("ping");
    } finally { server.stop(true); }
  });

  test("a service pane is confirmed by the plugin's resolveServicePaneId; anything else means no pane is closed", async () => {
    const plugin = (name: string, body: string | null) => {
      const root = join(scratch, name);
      mkdirSync(join(root, "src"), { recursive: true });
      if (body !== null) writeFileSync(join(root, "src/pane-control.ts"), body);
      return root;
    };
    const confirmed = plugin("plugin-confirms", `export const resolveServicePaneId = (dir: string, herdr: string) => dir.endsWith("a1b2c3d4e5f6") && herdr === "herdr" ? "w1:p3" : null;`);
    expect(await confirmServicePane(confirmed, "/state/a1b2c3d4e5f6", "herdr", process.env)).toEqual({ paneId: "w1:p3" });
    expect((await confirmServicePane(confirmed, "/state/ffffffffffff", "herdr", process.env)).paneId).toBeNull();
    const old = plugin("plugin-without", "export const somethingElse = 1;");
    expect(await confirmServicePane(old, "/state/a1b2c3d4e5f6", "herdr", process.env)).toEqual({ paneId: null, error: "the plugin has no resolveServicePaneId" });
    const throws = plugin("plugin-throws", `export const resolveServicePaneId = () => { throw new Error("herdr is not answering"); };`);
    expect((await confirmServicePane(throws, "/state/a1b2c3d4e5f6", "herdr", process.env)).paneId).toBeNull();
    expect((await confirmServicePane(plugin("plugin-missing", null), "/state/a1b2c3d4e5f6", "herdr", process.env)).error).toContain("missing");
  });
});
