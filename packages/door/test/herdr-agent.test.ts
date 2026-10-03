// The daily agent in Herdr (scripts/door-agent-herdr.ts): finding or making the agent's pane, naming it,
// attaching, and running the agent directly where there's no Herdr. Herdr here is a fake `herdr` that
// answers from canned JSON and records what it was asked; no Herdr server is touched.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentConfig, attachOutcome, doorScope, SCOPED_REFUSAL, attachTitle, findOrCreate, herdrRunner, nameWhenReady, pointLink, releaseLink, tellDoor, withLock, type AgentConfig } from "../src/desk/herdr-agent";
import { PtyPane } from "../src/desk/pty";

const SCRIPT = resolve(import.meta.dir, "../scripts/door-agent-herdr.ts");

let dir = "";
let fake = "";
const calls = () => (existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8").trim().split("\n").filter(Boolean) : []);
const answer = (name: string, value: unknown) => writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ep0ch-herdr-"));
  fake = join(dir, "herdr");
  // The fake answers `pane list` and `workspace list` from files, makes panes w9:p1 / term_new, and attaches
  // by printing what it was asked. `agent get` fails until `agent rename` has run once.
  writeFileSync(fake, `#!/bin/sh
d=${JSON.stringify(dir)}
echo "$*" >> "$d/calls"
case "$1 $2" in
  "pane list") [ -f "$d/down" ] && { echo '{"error":{"code":"server_not_running"}}'; exit 1; }; cat "$d/panes" ;;
  "workspace list") cat "$d/spaces" ;;
  "workspace create"|"tab create") [ -f "$d/nocreate" ] && { echo "herdr: no room" >&2; exit 1; }; [ -f "$d/slow" ] && sleep 0.3; echo '{"result":{"root_pane":{"pane_id":"w9:p1","terminal_id":"term_new"}}}' ;;
  "pane rename") [ -f "$d/sticky" ] && echo '{"result":{"panes":[{"pane_id":"w9:p1","label":"door-claude","terminal_id":"term_new"}]}}' > "$d/panes"; echo '{"result":{}}' ;;
  "pane run") echo '{"result":{}}' ;;
  "hang now") sleep 30 ;;
  "agent get") [ -f "$d/named" ] && echo '{"result":{"agent":{"name":"door","pane_id":"w9:p1"}}}' || exit 1 ;;
  "agent rename") [ -f "$d/detected" ] || exit 1; touch "$d/named"; echo '{"result":{}}' ;;
  "terminal attach") echo "attached $3 $4 link=$(readlink "$d/ep0ch-door/agent-door-claude.sock")"; [ -f "$d/busy" ] && { echo "herdr: terminal attach failed: terminal $3 already has an attached client; retry with --takeover" >&2; exit 1; }; exit 0 ;;
  *) exit 2 ;;
esac
`);
  chmodSync(fake, 0o755);
  answer("panes", { result: { panes: [{ pane_id: "w1:p1", terminal_id: "term_other" }] } });
  answer("spaces", { result: { workspaces: [{ workspace_id: "w1", label: "~" }] } });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// The person's own door: the default state dir (XDG_STATE_HOME/ep0ch-door) and its control socket in it.
const ownSock = () => join(dir, "ep0ch-door", "door.sock");

const cfg = (more: Partial<AgentConfig> = {}): AgentConfig => ({
  pane: "door-claude", name: "door", workspace: "door", cwd: "/tmp/garden", cmd: "door-claude",
  env: { EP0CH_TILE: "claude", EP0CH_CONTROL: join(dir, "agent.sock") }, unset: [], link: join(dir, "agent.sock"), lock: join(dir, "agent.sock.lock"), ...more,
});

describe("the agent's pane", () => {
  test("an existing pane labelled door-claude is attached to, nothing made", async () => {
    answer("panes", { result: { panes: [{ pane_id: "w1:p1", terminal_id: "term_other" }, { pane_id: "w4:p2", label: "door-claude", terminal_id: "term_agent" }] } });
    expect(await findOrCreate(herdrRunner(fake), cfg())).toEqual({ kind: "pane", pane: "w4:p2", terminal: "term_agent", created: false });
    expect(calls()).toEqual(["pane list"]);
  });

  test("missing, it's made in a new `door` workspace without focus, renamed, and the agent exec'd in it", async () => {
    expect(await findOrCreate(herdrRunner(fake), cfg())).toEqual({ kind: "pane", pane: "w9:p1", terminal: "term_new", created: true });
    expect(calls()).toEqual([
      "pane list",
      "workspace list",
      `workspace create --cwd /tmp/garden --label door --env EP0CH_TILE=claude --env EP0CH_CONTROL=${join(dir, "agent.sock")} --no-focus`,
      "pane rename w9:p1 door-claude",
      "pane run w9:p1 exec door-claude",
    ]);
  });

  test("with a `door` workspace already there, it's a tab in it", async () => {
    answer("spaces", { result: { workspaces: [{ workspace_id: "w1", label: "~" }, { workspace_id: "w3", label: "door" }] } });
    await findOrCreate(herdrRunner(fake), cfg());
    expect(calls()[2]).toBe(`tab create --workspace w3 --cwd /tmp/garden --label door-claude --env EP0CH_TILE=claude --env EP0CH_CONTROL=${join(dir, "agent.sock")} --no-focus`);
  });

  test("two doors starting at once make one pane: the look-and-make holds the lock", async () => {
    writeFileSync(join(dir, "slow"), "");
    writeFileSync(join(dir, "sticky"), "");
    const one = () => withLock(cfg().lock, () => findOrCreate(herdrRunner(fake), cfg()));
    const [a, b] = await Promise.all([one(), one()]);
    expect(calls().filter(c => c.startsWith("workspace create") || c.startsWith("tab create"))).toHaveLength(1);
    expect([a, b].map(f => f.kind === "pane" && f.created).sort()).toEqual([false, true]);
    expect(existsSync(cfg().lock)).toBe(false);
  });

  test("a lock left by a door that died is taken over; a live holder is waited for, then gone around", async () => {
    writeFileSync(cfg().lock, "999999999");
    expect(await withLock(cfg().lock, async () => "ran", 2000)).toBe("ran");
    writeFileSync(cfg().lock, String(process.pid));
    const t = Date.now();
    expect(await withLock(cfg().lock, async () => "ran anyway", 200)).toBe("ran anyway");
    expect(Date.now() - t).toBeGreaterThanOrEqual(200);
    // Not ours: left for its holder.
    expect(existsSync(cfg().lock)).toBe(true);
  });

  test("a server that doesn't answer is given up on, not waited for", async () => {
    const t = Date.now();
    const r = await herdrRunner(fake, 300)(["hang", "now"]);
    expect(r.code).toBe(124);
    expect(r.err).toContain("didn't answer");
    expect(Date.now() - t).toBeLessThan(5000);
  });

  test("no server answering: unreachable, so the tile runs the agent itself", async () => {
    writeFileSync(join(dir, "down"), "");
    expect((await findOrCreate(herdrRunner(fake), cfg())).kind).toBe("unreachable");
    expect(calls()).toEqual(["pane list"]);
  });
});

describe("naming the agent", () => {
  test("retried until Herdr has detected it, then renamed `door`", async () => {
    setTimeout(() => writeFileSync(join(dir, "detected"), ""), 60);
    expect(await nameWhenReady(herdrRunner(fake), "w9:p1", "door", 50, 20)).toBe(true);
    expect(calls().filter(c => c.startsWith("agent rename"))).toContain("agent rename w9:p1 door");
  });
  test("an agent already named on that pane isn't renamed again", async () => {
    writeFileSync(join(dir, "named"), "");
    expect(await nameWhenReady(herdrRunner(fake), "w9:p1", "door", 3, 1)).toBe(true);
    expect(calls()).toEqual(["agent get door"]);
  });
  test("never detected: gives up", async () => {
    expect(await nameWhenReady(herdrRunner(fake), "w9:p1", "door", 3, 1)).toBe(false);
  });
});

describe("attaching", () => {
  test("another door's client refuses it (busy); a takeover by another door ends it (taken); else done", () => {
    expect(attachOutcome(1, "herdr: server shut down: terminal attach failed: terminal term_x already has an attached client; retry with --takeover")).toEqual({ kind: "busy" });
    expect(attachOutcome(1, "herdr: server shut down: terminal attach taken over")).toEqual({ kind: "taken" });
    expect(attachOutcome(0, "")).toEqual({ kind: "done", code: 0 });
    expect(attachOutcome(1, "herdr: server shut down: terminal term_x exited")).toEqual({ kind: "done", code: 1 });
  });

  test("the pane's EP0CH_CONTROL link points at the attaching door, and can be put back", () => {
    const link = join(dir, "ep0ch-door", "agent-door-claude.sock");
    expect(pointLink(link, "/run/door-a.sock")).toBeNull();
    expect(readlinkSync(link)).toBe("/run/door-a.sock");
    expect(pointLink(link, "/run/door-b.sock")).toBe("/run/door-a.sock");
    expect(readlinkSync(link)).toBe("/run/door-b.sock");
    // No control socket (an older door): the link is left as it was.
    expect(pointLink(link, undefined)).toBe("/run/door-b.sock");
    expect(readlinkSync(link)).toBe("/run/door-b.sock");
    // Put back to "none": the link goes.
    pointLink(link, null);
    expect(existsSync(link) || (() => { try { readlinkSync(link); return true; } catch { return false; } })()).toBe(false);
  });

  test("when the attach ends the link is dropped if it's still this door's, and kept if another door took it", () => {
    const link = join(dir, "ep0ch-door", "agent-door-claude.sock");
    pointLink(link, "/run/door-a.sock");
    releaseLink(link, "/run/door-b.sock");
    expect(readlinkSync(link)).toBe("/run/door-a.sock");
    releaseLink(link, "/run/door-a.sock");
    expect(() => readlinkSync(link)).toThrow();
  });
});

describe("the defaults", () => {
  test("door-claude when it's on PATH, else claude; EP0CH_HERDR_AGENT_CMD wins; the folder is EP0CH_DAILY_CWD", () => {
    const base = { HOME: "/home/someone", PWD: "/somewhere" };
    expect(agentConfig(base, c => (c === "door-claude" ? "/bin/door-claude" : null)).cmd).toBe("door-claude");
    expect(agentConfig(base, () => null).cmd).toBe("claude");
    expect(agentConfig({ ...base, EP0CH_HERDR_AGENT_CMD: "claude --model x" }, () => "/x").cmd).toBe("claude --model x");
    const c = agentConfig({ ...base, EP0CH_DAILY_CWD: "~/garden", EP0CH_TILE: "claude" }, () => null);
    expect(c.cwd).toBe("/home/someone/garden");
    expect(c).toMatchObject({ pane: "door-claude", name: "door", workspace: "door" });
    expect(c.env.EP0CH_TILE).toBe("claude");
    expect(c.env.EP0CH_CONTROL).toBe(c.link);
    expect(agentConfig(base, () => null).cwd).toBe(process.cwd());   // the folder the dock started it in, never the door's PWD
  });
});

describe("a test door never reaches the person's agent pane", () => {
  const person = { HOME: "/home/someone", PWD: "/somewhere" };
  test("the person's door (default state, its socket in it) uses door-claude, door and door", () => {
    expect(doorScope(person)).toBeNull();
    expect(doorScope({ ...person, EP0CH_STATE: "/home/someone/.local/state/ep0ch-door/", EP0CH_CONTROL: "/home/someone/.local/state/ep0ch-door/door-123.sock" })).toBeNull();
    expect(doorScope({ ...person, XDG_STATE_HOME: "/x", EP0CH_STATE: "/x/ep0ch-door" })).toBeNull();
    expect(agentConfig(person, () => null)).toMatchObject({ pane: "door-claude", name: "door", workspace: "door", scope: null });
  });

  test("its own EP0CH_STATE or EP0CH_CONTROL: every Herdr name carries the state's hash, even an inherited EP0CH_HERDR_PANE", () => {
    const test1 = agentConfig({ ...person, EP0CH_STATE: "/tmp/claude-1000/t1/s", EP0CH_HERDR_AGENT_CMD: "door-claude" }, () => null);
    const test2 = agentConfig({ ...person, EP0CH_STATE: "/tmp/claude-1000/t2/s" }, () => null);
    const ctl = agentConfig({ ...person, EP0CH_CONTROL: "/tmp/claude-1000/t3/door.sock" }, () => null);
    for (const c of [test1, test2, ctl]) {
      expect(c.scope).toMatch(/^[0-9a-f]{8}$/);
      expect(c).toMatchObject({ pane: `door-claude-${c.scope}`, name: `door-${c.scope}`, workspace: `door-${c.scope}` });
    }
    expect(new Set([test1.scope, test2.scope, ctl.scope]).size).toBe(3);
    expect(agentConfig({ ...person, EP0CH_STATE: "/tmp/t", EP0CH_HERDR_PANE: "door-claude" }, () => null).pane).not.toBe("door-claude");
  });

  test("its own process and its tile agree on the hash: door.sock, door-<pid>.sock or no EP0CH_CONTROL in its state", () => {
    const st = "/tmp/claude-1000/t9/s";
    const a = doorScope({ ...person, EP0CH_STATE: st }), b = doorScope({ ...person, EP0CH_STATE: st, EP0CH_CONTROL: `${st}/door.sock` }), c = doorScope({ ...person, EP0CH_STATE: st, EP0CH_CONTROL: `${st}/door-99.sock` });
    expect(a).not.toBeNull();
    expect(new Set([a, b, c]).size).toBe(1);
  });

  test("end to end, by default: a test door starts no Herdr agent at all, and says why", async () => {
    answer("panes", { result: { panes: [{ pane_id: "w4:p2", label: "door-claude", terminal_id: "term_person" }] } });
    const p = Bun.spawn([process.execPath, SCRIPT], {
      env: { PATH: process.env.PATH!, HOME: dir, EP0CH_STATE: join(dir, "test-door"), EP0CH_HERDR_AGENT_CMD: "echo the person's agent ran", EP0CH_HERDR_BIN: fake },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect(code).toBe(1);
    expect(calls()).toEqual([]);
    expect(out).toBe("");
    expect(err).toContain(SCOPED_REFUSAL);
  });

  test("end to end, asked to (EP0CH_HERDR_SCOPED=1): a test door finds the person's door-claude pane and makes its own instead", async () => {
    answer("panes", { result: { panes: [{ pane_id: "w4:p2", label: "door-claude", terminal_id: "term_person" }] } });
    answer("spaces", { result: { workspaces: [{ workspace_id: "w4", label: "door" }] } });
    const p = Bun.spawn([process.execPath, SCRIPT], {
      env: { PATH: process.env.PATH!, HOME: dir, EP0CH_STATE: join(dir, "test-door"), EP0CH_CONTROL: join(dir, "test-door", "door.sock"), EP0CH_HERDR_AGENT_CMD: "door-claude", EP0CH_HERDR_BIN: fake, EP0CH_HERDR_SCOPED: "1" },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect(out).not.toContain("term_person");
    expect(calls().join("\n")).not.toContain("term_person");
    expect(calls().some(c => c.startsWith("workspace create") && /--label door-[0-9a-f]{8}\b/.test(c))).toBe(true);
    expect(calls().some(c => /^pane rename w9:p1 door-claude-[0-9a-f]{8}$/.test(c))).toBe(true);
    expect(out).toContain("attached term_new");
    expect(err).toContain("its own Herdr pane door-claude-");
  });
});

describe("the wrapper, end to end", () => {
  const run = async (env: Record<string, string>) => {
    const p = Bun.spawn([process.execPath, SCRIPT], {
      env: { PATH: process.env.PATH!, HOME: dir, XDG_STATE_HOME: dir, EP0CH_STATE: join(dir, "ep0ch-door"), EP0CH_HERDR_AGENT_CMD: "echo agent ran directly", ...env },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    return { out, code };
  };

  test("with Herdr: attaches to the agent's pane without --takeover, and points the link at its door", async () => {
    answer("panes", { result: { panes: [{ pane_id: "w4:p2", label: "door-claude", terminal_id: "term_agent" }] } });
    writeFileSync(join(dir, "named"), "");
    const r = await run({ EP0CH_HERDR_BIN: fake, EP0CH_CONTROL: ownSock() });
    expect(r.code).toBe(0);
    expect(r.out).toContain("attached term_agent");
    expect(r.out).not.toContain("--takeover");
    // While attached, the link named this door (the fake attach read it).
    expect(r.out).toContain(`link=${ownSock()}`);
  });

  test("detached (or the door went): the link no longer names this door", async () => {
    answer("panes", { result: { panes: [{ pane_id: "w4:p2", label: "door-claude", terminal_id: "term_agent" }] } });
    writeFileSync(join(dir, "named"), "");
    await run({ EP0CH_HERDR_BIN: fake, EP0CH_CONTROL: ownSock() });
    expect(() => readlinkSync(join(dir, "ep0ch-door", "agent-door-claude.sock"))).toThrow();
  });

  test("refused, with no door having had it before: no link is left pointing at this watching door", async () => {
    answer("panes", { result: { panes: [{ pane_id: "w4:p2", label: "door-claude", terminal_id: "term_agent" }] } });
    writeFileSync(join(dir, "named"), "");
    writeFileSync(join(dir, "busy"), "");
    await run({ EP0CH_HERDR_BIN: fake, EP0CH_CONTROL: ownSock() });
    expect(() => readlinkSync(join(dir, "ep0ch-door", "agent-door-claude.sock"))).toThrow();
  });

  test("refused because another door has it: the link stays that door's", async () => {
    answer("panes", { result: { panes: [{ pane_id: "w4:p2", label: "door-claude", terminal_id: "term_agent" }] } });
    writeFileSync(join(dir, "named"), "");
    writeFileSync(join(dir, "busy"), "");
    const link = join(dir, "ep0ch-door", "agent-door-claude.sock");
    pointLink(link, "/run/other-door.sock");
    // No terminal here, so the watch ends at once; what matters is where the link points.
    await run({ EP0CH_HERDR_BIN: fake, EP0CH_CONTROL: ownSock() });
    expect(readlinkSync(link)).toBe("/run/other-door.sock");
  });

  test("no server answering: the agent runs in the tile directly", async () => {
    writeFileSync(join(dir, "down"), "");
    const r = await run({ EP0CH_HERDR_BIN: fake });
    expect(r).toEqual({ out: "agent ran directly\n", code: 0 });
  });

  test("Herdr can't make the pane: the agent runs in the tile directly, and the tile says why", async () => {
    writeFileSync(join(dir, "nocreate"), "");
    const p = Bun.spawn([process.execPath, SCRIPT], {
      env: { PATH: process.env.PATH!, HOME: dir, XDG_STATE_HOME: dir, EP0CH_STATE: join(dir, "ep0ch-door"), EP0CH_HERDR_AGENT_CMD: "echo agent ran directly", EP0CH_HERDR_BIN: fake },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect(out).toBe("agent ran directly\n");
    expect(err).toContain("running the agent here");
  });

  test("no Herdr installed: the agent runs in the tile directly", async () => {
    const r = await run({ PATH: "/usr/bin:/bin", EP0CH_HERDR_BIN: "" });
    expect(r.out).toBe("agent ran directly\n");
  });
});

describe("quitting the door", () => {
  test("a program that puts the attach title in its own title isn't taken for a Herdr agent (PIE-491: tile.herdr says so)", async () => {
    const title = (t: string) => `printf '\\033]2;${t}\\007'`;
    const p = new PtyPane({ cmd: ["sh", "-c", `${title(attachTitle("door-claude"))}; sleep 5`], label: "claude" });
    try {
      p.render(40, 5, false, { redraw() {} } as any);
      await Bun.sleep(300);
      expect(p.herdr).toBeNull();
      p.herdr = { pane: "door-claude" };
      expect(p.running).toBe(true);
    } finally { p.dispose(); }
  });

  test("the wrapper tells the door, as its tile, over EP0CH_CONTROL; with no door there it goes on", async () => {
    const { createServer } = await import("node:net");
    const sock = join(dir, "door.sock");
    const heard: any[] = [];
    const server = createServer(c => c.on("data", d => { heard.push(JSON.parse(d.toString())); c.write(JSON.stringify({ ok: true, result: {} }) + "\n"); }));
    await new Promise<void>(r => server.listen(sock, r));
    try {
      expect(await tellDoor({ EP0CH_CONTROL: sock, EP0CH_TILE: "claude", EP0CH_TILE_ID: "t4" }, "door-claude", "door")).toBe(true);
      expect(heard[0]).toEqual({ cmd: "act", action: "tile.herdr", args: { pane: "door-claude", name: "door" }, tile: "t4", as: "door" });
    } finally { server.close(); }
    expect(await tellDoor({ EP0CH_CONTROL: join(dir, "none.sock"), EP0CH_TILE: "claude" }, "door-claude", "door")).toBe(false);
    expect(await tellDoor({}, "door-claude", "door")).toBe(false);
  });
});
