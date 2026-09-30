// The daily agent in Herdr (scripts/door-agent-herdr.ts): finding or making the agent's pane, naming it,
// attaching, and running the agent directly where there's no Herdr. Herdr here is a fake `herdr` that
// answers from canned JSON and records what it was asked; no Herdr server is touched.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentConfig, attachOutcome, findOrCreate, herdrRunner, nameWhenReady, pointLink, type AgentConfig } from "../src/desk/herdr-agent";

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
  "workspace create"|"tab create") echo '{"result":{"root_pane":{"pane_id":"w9:p1","terminal_id":"term_new"}}}' ;;
  "pane rename"|"pane run") echo '{"result":{}}' ;;
  "agent get") [ -f "$d/named" ] && echo '{"result":{"agent":{"name":"door","pane_id":"w9:p1"}}}' || exit 1 ;;
  "agent rename") [ -f "$d/detected" ] || exit 1; touch "$d/named"; echo '{"result":{}}' ;;
  "terminal attach") echo "attached $3 $4"; [ -f "$d/busy" ] && { echo "herdr: terminal attach failed: terminal $3 already has an attached client; retry with --takeover" >&2; exit 1; }; exit 0 ;;
  *) exit 2 ;;
esac
`);
  chmodSync(fake, 0o755);
  answer("panes", { result: { panes: [{ pane_id: "w1:p1", terminal_id: "term_other" }] } });
  answer("spaces", { result: { workspaces: [{ workspace_id: "w1", label: "~" }] } });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const cfg = (more: Partial<AgentConfig> = {}): AgentConfig => ({
  pane: "door-claude", name: "door", workspace: "door", cwd: "/tmp/garden", cmd: "door-claude",
  env: { EP0CH_TILE: "claude", EP0CH_CONTROL: join(dir, "agent.sock") }, link: join(dir, "agent.sock"), ...more,
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
    const link = join(dir, "state", "agent-door-claude.sock");
    expect(pointLink(link, "/run/door-a.sock")).toBeNull();
    expect(readlinkSync(link)).toBe("/run/door-a.sock");
    expect(pointLink(link, "/run/door-b.sock")).toBe("/run/door-a.sock");
    expect(readlinkSync(link)).toBe("/run/door-b.sock");
    // No control socket (an older door): the link is left as it was.
    expect(pointLink(link, undefined)).toBe("/run/door-b.sock");
    expect(readlinkSync(link)).toBe("/run/door-b.sock");
  });
});

describe("the defaults", () => {
  test("door-claude when it's on PATH, else claude; EP0CH_HERDR_AGENT_CMD wins; the folder is EP0CH_DAILY_CWD", () => {
    const base = { HOME: "/home/someone", PWD: "/somewhere", EP0CH_STATE: "/tmp/door-state" };
    expect(agentConfig(base, c => (c === "door-claude" ? "/bin/door-claude" : null)).cmd).toBe("door-claude");
    expect(agentConfig(base, () => null).cmd).toBe("claude");
    expect(agentConfig({ ...base, EP0CH_HERDR_AGENT_CMD: "claude --model x" }, () => "/x").cmd).toBe("claude --model x");
    const c = agentConfig({ ...base, EP0CH_DAILY_CWD: "~/garden", EP0CH_TILE: "claude" }, () => null);
    expect(c.cwd).toBe("/home/someone/garden");
    expect(c).toMatchObject({ pane: "door-claude", name: "door", workspace: "door" });
    expect(c.env.EP0CH_TILE).toBe("claude");
    expect(c.env.EP0CH_CONTROL).toBe(c.link);
    expect(agentConfig(base, () => null).cwd).toBe("/somewhere");
  });
});

describe("the wrapper, end to end", () => {
  const run = async (env: Record<string, string>) => {
    const p = Bun.spawn([process.execPath, SCRIPT], {
      env: { PATH: process.env.PATH!, HOME: dir, EP0CH_STATE: join(dir, "state"), EP0CH_HERDR_AGENT_CMD: "echo agent ran directly", ...env },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    return { out, code };
  };

  test("with Herdr: attaches to the agent's pane without --takeover, and points the link at its door", async () => {
    answer("panes", { result: { panes: [{ pane_id: "w4:p2", label: "door-claude", terminal_id: "term_agent" }] } });
    writeFileSync(join(dir, "named"), "");
    const r = await run({ EP0CH_HERDR_BIN: fake, EP0CH_CONTROL: "/run/this-door.sock" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("attached term_agent");
    expect(r.out).not.toContain("--takeover");
    expect(readlinkSync(join(dir, "state", "agent-door-claude.sock"))).toBe("/run/this-door.sock");
  });

  test("refused because another door has it: the link stays that door's", async () => {
    answer("panes", { result: { panes: [{ pane_id: "w4:p2", label: "door-claude", terminal_id: "term_agent" }] } });
    writeFileSync(join(dir, "named"), "");
    writeFileSync(join(dir, "busy"), "");
    const link = join(dir, "state", "agent-door-claude.sock");
    pointLink(link, "/run/other-door.sock");
    // No terminal here, so the watch ends at once; what matters is where the link points.
    await run({ EP0CH_HERDR_BIN: fake, EP0CH_CONTROL: "/run/this-door.sock" });
    expect(readlinkSync(link)).toBe("/run/other-door.sock");
  });

  test("no server answering: the agent runs in the tile directly", async () => {
    writeFileSync(join(dir, "down"), "");
    const r = await run({ EP0CH_HERDR_BIN: fake });
    expect(r).toEqual({ out: "agent ran directly\n", code: 0 });
  });

  test("no Herdr installed: the agent runs in the tile directly", async () => {
    const r = await run({ PATH: "/usr/bin:/bin", EP0CH_HERDR_BIN: "" });
    expect(r.out).toBe("agent ran directly\n");
  });
});
