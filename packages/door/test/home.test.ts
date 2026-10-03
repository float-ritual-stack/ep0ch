// The home base (src/home.ts): bare `ep0ch` in a folder that names no outline, in a terminal. Run for real in a pty
// against a scratch host, with "another machine" (a second scratch host) reached through the fake ssh
// (packages/outliner/test/fake-ssh.ts as EP0CH_SSH): by keys (a new outline, opened this time only), by `act` (a
// machine added, its outline opened and the folder's .ep0ch written), and a quit that opens nothing.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { hostRequest } from "../src/socket";
import { outliner, ScratchHost, scratchDir, until } from "./scratch";

const DOOR = resolve(import.meta.dir, "..");
const MAIN = join(DOOR, "src/main.ts");
const here = new ScratchHost(), far = new ScratchHost();
let dir = "";

beforeAll(async () => {
  await Promise.all([here.start(), far.start()]);
  await here.create("bob");
  await far.create("garden");
  dir = scratchDir("ep0ch-home-");
  for (const d of ["bin", "home/.ssh", "state", "far-home", "work/jam-shelf"]) mkdirSync(join(dir, d), { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "home/.ssh/config"), "# a fictional ssh config\nHost box-a\n  HostName 192.0.2.10\nHost *.wild\n  User nobody\nInclude more\n");
  writeFileSync(join(dir, "home/.ssh/more"), "Host tin-shed box-b\n  HostName 192.0.2.11\n");
  writeFileSync(join(dir, "bin/ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(outliner!, "test/fake-ssh.ts")} "$@"\n`);
  writeFileSync(join(dir, "bin/ep0ch"), `#!/bin/sh\nexec ${process.execPath} ${MAIN} "$@"\n`);
  for (const f of ["ssh", "ep0ch"]) chmodSync(join(dir, "bin", f), 0o755);
}, 40_000);

afterAll(async () => {
  try { process.kill(Number(readFileSync(join(here.outlines, ".remote", "box-a.ctl"), "utf8"))); } catch { /* none started */ }
  await Promise.all([here.dispose(), far.dispose()]);
  rmSync(dir, { recursive: true, force: true });
});

/** `ep0ch` (no flags but --no-daemon) in `cwd`, in a pty: this machine's host is `here`, box-a's is `far`. */
class Home {
  out = "";
  code: number | null = null;
  readonly env: Record<string, string>;
  readonly proc: ReturnType<typeof Bun.spawn>;
  constructor(cwd: string) {
    this.env = {
      PATH: process.env.PATH!, TERM: "xterm-256color", LANG: "C.UTF-8", HOME: join(dir, "home"),
      EP0CH_OUTLINES: here.outlines, EP0CH_STATE: join(dir, "state"), EP0CH_CONTROL: join(dir, "state", "door.sock"),
      EP0CH_DAEMON: "0", EP0CH_KITTY: "0", EP0CH_PACKS: join(dir, "no-packs"), EP0CH_DAILY_AGENT: "sh",
      EP0CH_SSH: join(dir, "bin/ssh"), FAKE_SSH_HOME: join(dir, "far-home"), FAKE_SSH_OUTLINES: far.outlines, FAKE_SSH_BIN: join(dir, "bin"),
      XDG_STATE_HOME: join(dir, "xs"), XDG_CACHE_HOME: join(dir, "xc"),
    };
    const pty = new Bun.Terminal({ cols: 120, rows: 40, data: (_t, d) => { this.out += Buffer.from(d).toString("latin1"); } });
    this.proc = Bun.spawn(["bun", MAIN, "--no-daemon"], { terminal: pty, env: this.env, cwd });
    void this.proc.exited.then(c => { this.code = c; });
    this.pty = pty;
  }
  readonly pty: InstanceType<typeof Bun.Terminal>;
  type(s: string) { this.pty.write(s); }
  async cli(...args: string[]) {
    const p = Bun.spawn(["bun", MAIN, ...args], { env: this.env, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err };
  }
  /** `peek`: its JSON (the screen as text follows it). */
  async peek(): Promise<any> { const r = await this.cli("peek"); const at = r.out.indexOf("\n}\n"); try { return JSON.parse(r.out.slice(0, at + 2)); } catch { this.said = r.err || r.out; return null; } }
  said = "";
  /** The home tile's own account (its kind's peek), once it has one. */
  async home(): Promise<any> { return (await this.peek())?.state?.home ?? null; }
  async on(screen: (p: any) => boolean, what: string, ms = 20_000) {
    let last: any = null;
    const end = Date.now() + ms;
    while (Date.now() < end) { last = await this.peek(); if (last && screen(last)) return last; await Bun.sleep(150); }
    throw new Error(`timed out waiting for ${what}; last peek: ${JSON.stringify(last)?.slice(0, 400)}; the screen: ${this.out.replace(/\x1b\[[0-9;?<>]*[a-zA-Z]/g, "").slice(-400)}; exit ${this.code}; peek said ${this.said.slice(0, 300)}`);
  }
  async end() { if (this.code === null) { this.proc.kill("SIGTERM"); await until(() => this.code !== null, "the door to end", 10_000); } }
}

describe.skipIf(!outliner)("the home base", () => {
  test("by keys: n names a new outline, ⏎ makes it, the offer to write .ep0ch is declined, and the door opens on it", async () => {
    const h = new Home(join(dir, "work/jam-shelf"));
    try {
      await h.on(p => p.screen === "home base", "the home base");
      const first = await h.home();
      expect(first.choices.map((c: any) => c.outline ?? c.kind)).toEqual(["bob", "new", "import", "add"]);
      expect(first.writes).toBe(`${join(dir, "work/jam-shelf")}/.ep0ch`);
      h.type("n");
      await Bun.sleep(300);
      h.type("\x15fern\r");                     // ctrl+u over the name offered, then the new one, ⏎
      await until(() => h.out.includes("this time only"), "the offer to write .ep0ch", 10_000);
      h.type("\x1b[B\r");                       // ↓ to "this time only", ⏎
      const door = await h.on(p => p.screen !== "home base" && p.outline === "fern", "the door on fern");
      expect(door.outline).toBe("fern");
      expect(existsSync(join(dir, "work/jam-shelf/.ep0ch"))).toBe(false);
      expect((await hostRequest<{ outlines: { name: string }[] }>(here.sock, "outlines.list")).outlines.map(o => o.name)).toContain("fern");
    } finally { await h.end(); }
  }, 60_000);

  test("by act: a machine added from ssh config, its outline opened, the folder's .ep0ch written with the machine", async () => {
    const h = new Home(join(dir, "work/jam-shelf"));
    try {
      await h.on(p => p.screen === "home base", "the home base");
      const added = await h.cli("act", "home.add", "machine=box-a", "--as", "home-test");
      expect(added.out + added.err).toContain("garden");
      const listed = await h.home();
      expect(listed.machines).toEqual([{ machine: "box-a", outlines: ["garden"] }]);
      expect(listed.choices.map((c: any) => [c.kind, c.outline ?? null, c.machine ?? null])).toContainEqual(["outline", "garden", "box-a"]);
      // An agent's open writes .ep0ch only when told to.
      const opened = await h.cli("act", "home.open", "outline=garden", "machine=box-a", "write=true", "--as", "home-test");
      expect(opened.out + opened.err).toContain("garden");
      const door = await h.on(p => p.screen !== "home base" && p.outline === "garden", "the door on garden");
      expect(door.outline).toBe("garden");
      expect(readFileSync(join(dir, "work/jam-shelf/.ep0ch"), "utf8")).toBe('ws = "garden"\nmachine = "box-a"\n');
      expect(JSON.parse(readFileSync(join(dir, "state/machines.json"), "utf8")).machines.map((m: any) => m.name)).toEqual(["box-a"]);
    } finally { await h.end(); }
    // The next `ep0ch` there opens it directly: the folder names it now, on its machine.
    const { resolveTarget } = await import("../src/discover");
    expect(resolveTarget([], { ...process.env, EP0CH_OUTLINES: here.outlines }, join(dir, "work/jam-shelf"))).toMatchObject({ outline: "garden", machine: "box-a" });
  }, 60_000);

  test("q quits: nothing is opened, made or written; refusals say why", async () => {
    mkdirSync(join(dir, "work/attic"), { recursive: true });
    const h = new Home(join(dir, "work/attic"));
    try {
      await h.on(p => p.screen === "home base", "the home base");
      const refused = await h.cli("act", "home.open", "outline=nobody", "--as", "home-test");
      expect(refused.out + refused.err).toContain("no outline nobody");
      const bad = await h.cli("act", "home.new", "name=Not A Name", "--as", "home-test");
      expect(bad.out + bad.err).toContain("isn't an outline name");
      // A click on bob's row picks it and opens it: the offer to write .ep0ch comes up; esc puts it away.
      const before = h.out.length;
      h.type("\x1b[<0;6;5M\x1b[<0;6;5m");
      await until(() => h.out.slice(before).includes("this time only"), "the offer after a click", 10_000);
      expect((await h.home()).picked).toBe(1);
      h.type("\x1b");
      await Bun.sleep(400);
      expect((await h.peek()).screen).toBe("home base");
      h.type("q");
      await until(() => h.code !== null, "the home base to end", 10_000);
      expect(h.code).toBe(1);
      expect(existsSync(join(dir, "work/attic/.ep0ch"))).toBe(false);
    } finally { await h.end(); }
  }, 60_000);
});

test("ssh config names: Host aliases and what Include brings, without patterns", async () => {
  const { sshConfigNames } = await import("../src/machine");
  expect(sshConfigNames({ HOME: join(dir, "home") })).toEqual(["box-a", "box-b", "tin-shed"]);
  expect(sshConfigNames({ HOME: join(dir, "nobody-home") })).toEqual([]);
});
