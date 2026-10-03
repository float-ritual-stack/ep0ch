// --machine and --remote end to end, against a scratch outline host standing in for another machine, reached through a
// fake ssh (the outliner's test/fake-ssh.ts, given as EP0CH_SSH): this machine's sshd isn't used. The forward, the door's connection
// over it, the forward dropping and the door starting it again, the .ep0ch's machine, doctor's view, and the door
// session on the other machine.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { outliner, ScratchHost, scratchDir, until } from "./scratch";

const DOOR = resolve(import.meta.dir, "..");
const host = new ScratchHost();
let here = "", saved: Record<string, string | undefined> = {};
const VARS = ["EP0CH_SSH", "EP0CH_OUTLINES", "EP0CH_STATE", "EP0CH_SOCKET", "EP0CH_WS", "EP0CH_MACHINE", "FAKE_SSH_LOG", "FAKE_SSH_HOME", "FAKE_SSH_OUTLINES", "FAKE_SSH_BIN", "FAKE_SSH_DOWN", "HOME"];
const log = () => readFileSync(join(here, "ssh.log"), "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as string[]);
const forwards = () => log().filter(a => a.includes("-L")).length;
const forwarderPid = () => Number(readFileSync(join(here, "outlines", ".remote", "box-a.ctl"), "utf8"));

beforeAll(async () => {
  await host.start();
  await host.create("garden");
  here = scratchDir("ep0ch-mach-");
  for (const d of ["outlines", "state", "bin", "home", "far-home"]) mkdirSync(join(here, d), { recursive: true, mode: 0o700 });
  // `ssh` and the other machine's `ep0ch`: this checkout's, run as that machine (its HOME and outlines folder).
  writeFileSync(join(here, "bin", "ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(outliner!, "test", "fake-ssh.ts")} "$@"\n`);
  writeFileSync(join(here, "bin", "ep0ch"), `#!/bin/sh\nexec ${process.execPath} ${join(DOOR, "src/main.ts")} "$@"\n`);
  for (const f of ["ssh", "ep0ch"]) chmodSync(join(here, "bin", f), 0o755);
  for (const k of VARS) saved[k] = process.env[k];
  Object.assign(process.env, {
    EP0CH_SSH: join(here, "bin", "ssh"), EP0CH_OUTLINES: join(here, "outlines"), EP0CH_STATE: join(here, "state"), HOME: join(here, "home"),
    FAKE_SSH_LOG: join(here, "ssh.log"), FAKE_SSH_HOME: join(here, "far-home"), FAKE_SSH_OUTLINES: host.outlines, FAKE_SSH_BIN: join(here, "bin"),
  });
  for (const k of ["EP0CH_SOCKET", "EP0CH_WS", "EP0CH_MACHINE", "FAKE_SSH_DOWN"]) delete process.env[k];
  writeFileSync(join(here, "ssh.log"), "");
}, 30_000);

afterAll(async () => {
  try { process.kill(forwarderPid()); } catch { /* gone */ }
  for (const k of VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await host.dispose();
  rmSync(here, { recursive: true, force: true });
});

describe("--machine: an outline on another machine, through the forward", () => {
  test("the door asks the machine where its host is, forwards it once, and reads the outline there; a second door shares it", async () => {
    const { resolveTarget } = await import("../src/discover");
    const target = resolveTarget(["--machine", "box-a", "--ws", "garden"]);
    expect(target).toMatchObject({ outline: "garden", machine: "box-a", remote: true, path: join(here, "outlines", ".remote", "box-a.sock") });
    const { connectTarget } = await import("../src/door");
    const first = await connectTarget(["--machine", "box-a", "--ws", "garden"]);
    if ("error" in first) throw new Error(first.error);
    expect(first.service.outline).toBe("garden");
    expect(first.notice).toBe("started the forward to box-a");
    // It asked the machine (ep0ch status --json in a login shell there) before forwarding what it said.
    expect(log().some(a => a.at(-1)?.includes("ep0ch status --json"))).toBe(true);
    expect(log().find(a => a.includes("-L"))).toContain(`${join(here, "outlines", ".remote", "box-a.sock")}:${host.sock}`);
    const second = await connectTarget(["--machine", "box-a", "--ws", "garden"]);
    if ("error" in second) throw new Error(second.error);
    expect(second.notice).toBeUndefined();
    expect(forwards()).toBe(1);
    first.board.close(); second.board.close();
    const { usedMachines } = await import("../src/machine");
    expect(usedMachines().map(m => m.name)).toEqual(["box-a"]);
  }, 30_000);

  test("the forward drops: the door's connection starts it again and says so on the status bar", async () => {
    const { connectTarget } = await import("../src/door");
    const opened = await connectTarget(["--machine", "box-a", "--ws", "garden"]);
    if ("error" in opened) throw new Error(opened.error);
    const said: string[] = [];
    opened.board.reconnectMs = 50;
    opened.board.onConnection = (state, detail) => said.push(`${state}: ${detail}`);
    opened.board.subscribe(() => {});
    await Bun.sleep(300);
    const before = forwards();
    process.kill(forwarderPid());
    await until(() => said.some(s => s.startsWith("restored")), "the door to reconnect", 15_000);
    expect(said[0]).toBe("lost: outline connection lost · reconnecting");
    expect(said.find(s => s.startsWith("restored"))).toMatch(/^restored: started the forward to box-a · caught up/);
    expect(forwards()).toBe(before + 1);
    expect((await opened.board.info()).outline).toBe("garden");
    opened.board.close();
  }, 30_000);

  test("a session is started with the machine said, its forward started from the terminal first", async () => {
    const { nameTheOutline } = await import("../src/outlines");
    const before = forwards();
    process.kill(forwarderPid());
    await Bun.sleep(200);
    expect(await nameTheOutline(["--machine", "box-a", "--ws", "garden"], false, async () => null)).toEqual({ args: ["--machine", "box-a", "--ws", "garden"] });
    expect(forwards()).toBe(before + 1);
    const folder = join(here, "far-session");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, ".ep0ch"), 'ws = "garden"\nmachine = "box-a"\n');
    const cwd = process.cwd();
    process.chdir(folder);
    try { expect(await nameTheOutline(["--desk"], false, async () => null)).toEqual({ args: ["--desk", "--ws", "garden", "--machine", "box-a"] }); }
    finally { process.chdir(cwd); }
  }, 30_000);

  test("a .ep0ch names the machine beside the outline; a machine nobody reaches is said with what to do", async () => {
    const folder = join(here, "far-notes");
    mkdirSync(join(folder, "deep"), { recursive: true });
    writeFileSync(join(folder, ".ep0ch"), 'ws = "garden"\nmachine = "box-a"\n');
    const { resolveTarget } = await import("../src/discover");
    expect(resolveTarget([], process.env, join(folder, "deep"))).toMatchObject({ outline: "garden", machine: "box-a", why: `the outline garden (${join(folder, ".ep0ch")}) on box-a` });
    // --ws naming the folder's outline keeps its machine; naming another is this machine's, unless --machine says so.
    expect(resolveTarget(["--ws", "garden"], process.env, folder)).toMatchObject({ outline: "garden", machine: "box-a" });
    expect("machine" in resolveTarget(["--ws", "fern"], process.env, folder)).toBe(false);
    expect(resolveTarget(["--machine", "box-a"], { ...process.env, EP0CH_SOCKET: "/fictional/elsewhere.sock" }, folder)).toEqual({ error: "--machine box-a and EP0CH_SOCKET both name a host; leave one out" });
    const { forwardTo } = await import("../src/machine");
    process.env.FAKE_SSH_DOWN = "1";
    try { await expect(forwardTo("box-b")).rejects.toThrow("can't reach box-b over ssh (ssh: connect to host box-b port 22: Connection refused) · `ssh box-b true`"); }
    finally { delete process.env.FAKE_SSH_DOWN; }
  }, 30_000);

  test("`ep0ch outline list --machine` and `ep0ch doctor` show the machine's outlines through its forward", async () => {
    const env = { ...process.env } as Record<string, string>;
    const list = Bun.spawnSync([process.execPath, "src/main.ts", "outline", "list", "--machine", "box-a", "--json"], { cwd: DOOR, env });
    expect(JSON.parse(list.stdout.toString()).outlines.map((o: { name: string }) => o.name)).toContain("garden");
    // In a folder whose .ep0ch names the machine, the outline commands go there by the one rule; init keeps its machine.
    const far = join(here, "far-init");
    mkdirSync(far, { recursive: true });
    writeFileSync(join(far, ".ep0ch"), 'ws = "garden"\nmachine = "box-a"\n');
    const there = Bun.spawnSync([process.execPath, join(DOOR, "src/main.ts"), "outline", "list", "--json"], { cwd: far, env });
    expect(JSON.parse(there.stdout.toString()).outlines.map((o: { name: string }) => o.name)).toContain("garden");
    // An outline the machine doesn't have is made there only with --create (PIE-545).
    const refused = Bun.spawnSync([process.execPath, join(DOOR, "src/main.ts"), "init", "fern", "--json"], { cwd: far, env });
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr.toString()).toContain("box-a has no outline fern, and neither has this machine. Nothing was created.");
    expect(refused.stderr.toString()).toContain("ep0ch init fern --machine box-a --create");
    expect(readFileSync(join(far, ".ep0ch"), "utf8")).toBe('ws = "garden"\nmachine = "box-a"\n');
    const init = Bun.spawnSync([process.execPath, join(DOOR, "src/main.ts"), "init", "fern", "--create", "--json"], { cwd: far, env });
    expect(JSON.parse(init.stdout.toString())).toMatchObject({ name: "fern", created: true });
    expect(readFileSync(join(far, ".ep0ch"), "utf8")).toBe('ws = "fern"\nmachine = "box-a"\n');
    const { hostRequest } = await import("../src/socket");
    expect((await hostRequest<{ outlines: { name: string }[] }>(host.sock, "outlines.list")).outlines.map(o => o.name)).toContain("fern");
    // `status` is this machine's host unless --machine names another: what another machine is asked.
    const status = Bun.spawnSync([process.execPath, join(DOOR, "src/main.ts"), "status", "--json"], { cwd: far, env });
    expect(status.exitCode).toBe(1);
    const { machineStatus } = await import("../src/machine");
    expect(await machineStatus("box-a")).toMatchObject({ machine: "box-a", answers: true, connected: true, outlines: expect.arrayContaining(["garden"]) });
    const { doctorChecks } = await import("../src/setup/doctor");
    const { gatherFacts } = await import("../src/setup/facts");
    const facts = await gatherFacts({ env, fetch: false, cwd: here });
    expect(doctorChecks(facts).find(c => c.group === "machines" && c.name === "box-a")).toMatchObject({ status: "ok", detail: expect.stringMatching(/^forward up at .*box-a\.sock; serves .*garden/) });
  }, 60_000);
});

describe("an outline the machine doesn't have is never made there (PIE-545)", () => {
  const names = async () => (await (await import("../src/socket")).hostRequest<{ outlines: { name: string }[] }>(host.sock, "outlines.list")).outlines.map(o => o.name);

  test("--machine: the door, the session's naming and `outline attach` refuse with the commands; nothing is made", async () => {
    const { connectTarget } = await import("../src/door");
    const opened = await connectTarget(["--machine", "box-a", "--ws", "nettle"]);
    expect("error" in opened && opened.error).toContain("box-a has no outline nettle, and neither has this machine. Nothing was created.");
    expect("error" in opened && opened.error).toContain("create it on box-a:");
    expect("error" in opened && opened.error).toContain("ep0ch --machine box-a --ws nettle --create");
    // Before a session starts, in the person's terminal: without one to ask, the same commands; with one, the home base.
    const { nameTheOutline } = await import("../src/outlines");
    const named = await nameTheOutline(["--machine", "box-a", "--ws", "nettle"], false, async () => { throw new Error("no home base without a terminal"); });
    expect(named).toEqual({ error: expect.stringContaining("ep0ch --machine box-a --ws nettle --create") });
    let offered: unknown = null;
    expect(await nameTheOutline(["--machine", "box-a", "--ws", "nettle", "--desk"], true, async a => { offered = a; return null; })).toBeNull();
    expect(offered).toMatchObject({ machine: "box-a", missing: { outline: "nettle", machine: "box-a" } });
    // The home base's choice opens: its outline and machine replace what was named.
    expect(await nameTheOutline(["--machine", "box-a", "--ws", "nettle", "--desk"], true, async () => ({ outline: "garden", machine: "box-a" })))
      .toEqual({ args: ["--desk", "--ws", "garden", "--machine", "box-a"], notice: "opened garden on box-a from the home base" });
    const cli = Bun.spawnSync([process.execPath, "src/main.ts", "--no-daemon", "--machine", "box-a", "--ws", "nettle"], { cwd: DOOR, env: process.env as Record<string, string> });
    expect(cli.exitCode).toBe(1);
    expect(cli.stderr.toString()).toContain("ep0ch --machine box-a --ws nettle --create");
    const attach = Bun.spawnSync([process.execPath, "src/main.ts", "outline", "attach", "nettle", "--machine", "box-a", "--json"], { cwd: DOOR, env: process.env as Record<string, string> });
    expect(attach.exitCode).toBe(1);
    expect(attach.stderr.toString()).toContain("ep0ch outline attach nettle --machine box-a --create");
    expect(await names()).not.toContain("nettle");
  }, 60_000);

  test("--create makes it there, on purpose, before the door, and the door's arguments go on without it", async () => {
    const { nameTheOutline } = await import("../src/outlines");
    const made = await nameTheOutline(["--machine", "box-a", "--ws", "sorrel", "--create"], false, async () => null);
    expect(made).toEqual({ args: ["--machine", "box-a", "--ws", "sorrel"], notice: "created outline sorrel on box-a (--create)" });
    expect(await names()).toContain("sorrel");
    const attach = Bun.spawnSync([process.execPath, "src/main.ts", "outline", "attach", "tansy", "--machine", "box-a", "--create", "--json"], { cwd: DOOR, env: process.env as Record<string, string> });
    expect(JSON.parse(attach.stdout.toString())).toMatchObject({ created: true });
    expect(await names()).toContain("tansy");
  }, 60_000);

  test("--remote: asked through the forward first; the door there is given --no-create, and refuses one it lacks", async () => {
    const { nameRemoteOutline } = await import("../src/outlines");
    const none = async () => { throw new Error("no home base without a terminal"); };
    expect(await nameRemoteOutline("box-a", ["--ws", "garden", "--board"], false, none)).toEqual({ remote: ["--ws", "garden", "--board", "--no-create"] });
    expect(await nameRemoteOutline("box-a", ["status", "--json"], false, none)).toEqual({ remote: ["status", "--json"] });
    expect(await nameRemoteOutline("box-a", ["--ws", "yarrow", "--create"], false, none)).toEqual({ remote: ["--ws", "yarrow", "--create"] });
    const missing = await nameRemoteOutline("box-a", ["--ws", "yarrow"], false, none);
    expect(missing).toEqual({ error: expect.stringContaining("ep0ch --remote box-a --ws yarrow --create") });
    // The home base: a choice there goes on there (--ws replaced); the one on this machine is a door here.
    expect(await nameRemoteOutline("box-a", ["--ws", "yarrow", "--board"], true, async () => ({ outline: "garden", machine: "box-a" }))).toEqual({ remote: ["--ws", "garden", "--board", "--no-create"] });
    expect(await nameRemoteOutline("box-a", ["--ws", "yarrow", "--board"], true, async () => ({ outline: "yarrow" }))).toEqual({ args: ["--board", "--ws", "yarrow"], notice: "opened yarrow from the home base" });
    // End to end through the fake ssh, with no terminal: refused here, nothing run there.
    const before = log().length;
    const r = Bun.spawnSync([process.execPath, "src/main.ts", "--remote", "box-a", "--ws", "yarrow"], { cwd: DOOR, env: process.env as Record<string, string> });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("box-a has no outline yarrow");
    expect(log().slice(before).some(a => a.includes("-t"))).toBe(false);
    // The door there, given --no-create (as when the forward couldn't be asked): its own refusal, before any session.
    const there = Bun.spawnSync([process.execPath, join(DOOR, "src/main.ts"), "--ws", "yarrow", "--no-create"], { cwd: DOOR, env: { ...process.env, EP0CH_OUTLINES: host.outlines } as Record<string, string> });
    expect(there.exitCode).toBe(1);
    expect(there.stderr.toString()).toContain("has no outline yarrow. Nothing was created.");
    expect(there.stderr.toString()).toContain("ep0ch --ws yarrow --create");
    expect(await names()).not.toContain("yarrow");
  }, 60_000);
});

describe("--remote: this terminal on the door session running on another machine", () => {
  test("ssh -t to the machine, ep0ch there in a login shell with this terminal's variables", async () => {
    const { remoteDoorArgv } = await import("../src/machine");
    const argv = remoteDoorArgv("box-a", ["--ws", "garden", "--board"], { EP0CH_SSH: "ssh", TERM: "xterm-kitty", COLORTERM: "truecolor", EP0CH_KITTY: "1" });
    expect(argv).toEqual(["ssh", "-t", "--", "box-a", `exec env TERM=xterm-kitty COLORTERM=truecolor EP0CH_KITTY=1 "\${SHELL:-/bin/sh}" -lc 'exec ep0ch --ws garden --board'`]);
    // The outline this folder names on that machine goes as --ws; --machine naming the machine itself doesn't go.
    const { remoteArgs } = await import("../src/machine");
    const named = { path: "/x", outline: "garden", attach: true as const, remote: true, machine: "box-a", why: "" };
    expect(remoteArgs("box-a", ["--board"], named)).toEqual(["--ws", "garden", "--board"]);
    expect(remoteArgs("box-a", ["--machine", "box-a", "--desk"], named)).toEqual(["--ws", "garden", "--desk"]);
    expect(remoteArgs("box-b", ["--board"], named)).toEqual(["--board"]);
    expect(remoteArgs("box-a", ["--ws", "fern"], named)).toEqual(["--ws", "fern"]);
    // Words survive the remote shell as they were (the door's own arguments, quotes and spaces kept).
    const { shellWord } = await import("../src/machine");
    const words = ["--layout", "it's mine", "a b", "$HOME", "plain"];
    expect(Bun.spawnSync(["sh", "-c", `printf '%s\\n' ${words.map(shellWord).join(" ")}`]).stdout.toString()).toBe(words.join("\n") + "\n");
    // Run through the fake ssh: what runs there is that machine's ep0ch, its answer comes back here.
    const r = Bun.spawnSync([process.execPath, "src/main.ts", "--remote", "box-a", "status", "--json"], { cwd: DOOR, env: process.env as Record<string, string> });
    expect(JSON.parse(r.stdout.toString()).socket).toBe(host.sock);
    expect(log().at(-1)!.slice(0, 4)).toEqual(["-t", "--", "box-a", log().at(-1)![3]!]);
    const bad = Bun.spawnSync([process.execPath, "src/main.ts", "--remote", "sam@box"], { cwd: DOOR, env: process.env as Record<string, string> });
    expect(bad.stderr.toString()).toContain(`--remote "sam@box" isn't an ssh config name`);
  }, 30_000);
});
