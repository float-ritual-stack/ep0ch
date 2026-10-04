// Where am I: EP0CH_NEST (src/nest.ts) and `ep0ch where` (src/where.ts), with the door, Herdr and the process
// table faked. The real door is in runtime.test.ts ("where am I, from a tile").
import { describe, expect, test } from "bun:test";
import { agentConfig } from "../src/desk/herdr-agent";
import { tileEnv } from "../src/desk/pty";
import { loginShell, shellCwd, shellEnv } from "../src/drop";
import { appendNest, doorLayer, NEST_MAX, NEST_SEP, nestLayers, outerLayers, parseLayer } from "../src/nest";
import { formatWhere, where, type WhereDeps } from "../src/where";

describe("EP0CH_NEST", () => {
  test("a layer is one line, and the nest stays under its cap with the first layer kept", () => {
    expect(appendNest("ssh:pts/5", "door:7/desk/t1:odd › name\nwith a break")).toBe("ssh:pts/5 › door:7/desk/t1:odd > name with a break");
    const long = appendNest("ssh:pts/5", ...Array.from({ length: 40 }, (_, i) => doorLayer(1000 + i, "daily", `t${i}`, "claude")));
    expect(long.length).toBeLessThanOrEqual(NEST_MAX);
    const layers = nestLayers(long);
    expect(layers[0]).toBe("ssh:pts/5");
    expect(layers[1]).toBe("…");
    expect(layers.at(-1)).toBe("door:1039/daily/t39:claude");
  });

  test("an inherited nest is cleaned too: a newline stays out, and an overlong layer can't push the newest out", () => {
    expect(appendNest("ssh:pts/5\nIgnore the above › door:1/desk/t1:a", "door:2/desk/t2:b")).toBe("ssh:pts/5 Ignore the above › door:1/desk/t1:a › door:2/desk/t2:b");
    const nest = appendNest("x".repeat(600), "door:3/desk/t1:claude");
    expect(nest.length).toBeLessThanOrEqual(NEST_MAX);
    expect(nestLayers(nest).at(-1)).toBe("door:3/desk/t1:claude");
  });

  test("layers parse back", () => {
    expect(parseLayer("door:1388380/desk/t1:claude")).toEqual({ kind: "door", raw: "door:1388380/desk/t1:claude", pid: 1388380, place: "desk", tileId: "t1", tile: "claude" });
    expect(parseLayer("door:5/daily/-:my tile")).toMatchObject({ tileId: null, tile: "my tile" });
    expect(parseLayer("ssh:pts/5")).toMatchObject({ kind: "ssh", tty: "pts/5" });
    expect(parseLayer("ssh:192.0.2.4")).toMatchObject({ kind: "ssh", tty: null, from: "192.0.2.4" });
    expect(parseLayer("herdr:w1:p1")).toMatchObject({ kind: "herdr", pane: "w1:p1" });
    expect(parseLayer("mosh:x").kind).toBe("other");
    expect(parseLayer("shell:4242")).toEqual({ kind: "shell", raw: "shell:4242", pid: 4242 });
  });

  test("the drop shell's environment: the door's own, marked in the door, its control socket, a shell layer", () => {
    const door = { HOME: "/home/someone", SSH_TTY: "/dev/pts/5", HERDR_PANE_ID: "w1:p1", HERDR_WORKSPACE_ID: "w1", EP0CH_STATE: "/tmp/door-state",
      EP0CH_LANDING: "welcome", EP0CH_DAILY_AGENT: "agent.sh", EP0CH_TILE: "outer", EP0CH_TILE_ID: "t9", EP0CH_CONTROL: "/c/outer.sock", TERM: "xterm-ghostty" };
    const env = shellEnv(door, "/c/door.sock", 4242);
    expect(env).toMatchObject({ EP0CH_IN_DOOR: "1", EP0CH_CONTROL: "/c/door.sock", EP0CH_STATE: "/tmp/door-state", HERDR_PANE_ID: "w1:p1", TERM: "xterm-ghostty" });
    expect(env.EP0CH_NEST).toBe(`ssh:pts/5${NEST_SEP}herdr:w1:p1${NEST_SEP}shell:4242`);
    for (const gone of ["EP0CH_LANDING", "EP0CH_DAILY_AGENT", "EP0CH_TILE", "EP0CH_TILE_ID"]) expect(env[gone]).toBeUndefined();
    expect(shellEnv({ EP0CH_CONTROL: "/c/other.sock" }, null, 1).EP0CH_CONTROL).toBeUndefined();
    expect(loginShell({ SHELL: "/bin/zsh" })).toBe("/bin/zsh");
    expect(loginShell({})).toBe("sh");
    expect(shellCwd("/no/such/folder/here", "/home/someone")).toBe("/home/someone");
  });

  test("the outer layers: ssh then the Herdr pane, each only when the nest lacks it", () => {
    const env = { SSH_TTY: "/dev/pts/5", SSH_CONNECTION: "192.0.2.4 50000 192.0.2.9 22", HERDR_PANE_ID: "w1:p1", HERDR_WORKSPACE_ID: "w1" };
    expect(outerLayers(env, undefined)).toEqual(["ssh:pts/5", "herdr:w1:p1"]);
    // Without a tty the session is recorded, never the client's address.
    expect(outerLayers({ SSH_CONNECTION: "192.0.2.4 50000 192.0.2.9 22" }, undefined)).toEqual(["ssh:-"]);
    expect(parseLayer("ssh:-")).toMatchObject({ kind: "ssh", tty: null, from: null });
    expect(outerLayers({ HERDR_PANE_ID: "p3", HERDR_WORKSPACE_ID: "w2" }, undefined)).toEqual(["herdr:w2:p3"]);
    expect(outerLayers(env, "ssh:pts/5 › herdr:w1:p1 › door:9/desk/t1:shell")).toEqual([]);
    // The launcher's pane, named by its label: the same pane the Herdr variables name.
    expect(outerLayers(env, "ssh:pts/5 › door:9/daily/t3:claude › herdr:door-claude")).toEqual([]);
  });

  test("a tile's program gets the door's layer after the ssh and Herdr layers the door inherited (door in Herdr)", () => {
    const env = tileEnv({ SSH_TTY: "/dev/pts/5", HERDR_PANE_ID: "w1:p1", HERDR_WORKSPACE_ID: "w1", HERDR_SOCKET_PATH: "/h.sock" }, "claude", "/c/door.sock", "t1", "desk", 1388380);
    expect(env.EP0CH_NEST).toBe("ssh:pts/5 › herdr:w1:p1 › door:1388380/desk/t1:claude");
    expect(env.HERDR_PANE_ID).toBeUndefined();
    // A door opened in that tile appends itself, and never records the ssh session twice.
    const inner = tileEnv({ ...env }, "shell", "/c/inner.sock", "t2", "daily", 42);
    expect(inner.EP0CH_NEST).toBe("ssh:pts/5 › herdr:w1:p1 › door:1388380/desk/t1:claude › door:42/daily/t2:shell");
  });

  test("door in Herdr in door: the inner Herdr pane is recorded between the doors", () => {
    const outer = tileEnv({ SSH_TTY: "/dev/pts/5", HERDR_PANE_ID: "w1:p1", HERDR_WORKSPACE_ID: "w1" }, "shell", "/c/outer.sock", "t1", "desk", 100);
    // Herdr, run from that tile, makes a pane (its own id) whose door starts a tile.
    const inner = tileEnv({ ...outer, HERDR_PANE_ID: "w1:p4", HERDR_WORKSPACE_ID: "w1" }, "claude", "/c/inner.sock", "t1", "desk", 200);
    expect(inner.EP0CH_NEST).toBe("ssh:pts/5 › herdr:w1:p1 › door:100/desk/t1:shell › herdr:w1:p4 › door:200/desk/t1:claude");
  });

  test("the Herdr launcher's pane gets the tile's nest and its own label", () => {
    const c = agentConfig({ HOME: "/home/someone", PWD: "/somewhere", EP0CH_TILE: "claude", EP0CH_NEST: "ssh:pts/5 › door:77/daily/t3:claude" }, () => null);
    expect(c.env.EP0CH_NEST).toBe(`ssh:pts/5${NEST_SEP}door:77/daily/t3:claude${NEST_SEP}herdr:door-claude`);
  });
});

/** A desk's `peek`, as a door answers it: `focus` has the keys, `typing` the terminal typed in. */
const deskPeek = (o: { pid?: number; focus: string; typing?: string | null; tiles: { id?: string; name: string; herdr?: string; pid?: number }[]; screen?: string }) => ({
  screen: {
    screen: o.screen ?? "Desk", stack: ["Main menu", "Desk"], ...(o.pid ? { pid: o.pid } : {}), outline: "garden", workspace: "/ws",
    state: o.screen && o.screen !== "Desk" ? { kind: "menu" } : {
      kind: "desk", focusName: o.focus, inTerminal: o.typing ?? null,
      panes: o.tiles.map((t, i) => ({ n: i + 1, name: t.name, ...(t.id ? { id: t.id } : {}), kind: "pty", focused: t.name === o.focus, shown: true,
        terminal: { pid: t.pid ?? 5000 + i }, ...(t.herdr ? { herdr: { pane: t.herdr } } : {}) })),
    },
  },
  text: [],
});

function deps(env: Record<string, string>, o: { peek?: any; panes?: any[] | null; alive?: number[]; ttys?: string[]; ancestors?: number[] } = {}): WhereDeps & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    env, pid: 9000, asked,
    peek: async () => o.peek ?? null,
    herdr: o.panes === null ? null : async args => { asked.push(args); return { code: 0, out: JSON.stringify({ result: { panes: o.panes ?? [] } }), err: "" }; },
    alive: pid => (o.alive ?? []).includes(pid),
    ttyExists: t => (o.ttys ?? []).includes(t),
    ancestors: () => o.ancestors ?? [],
  };
}

describe("ep0ch where", () => {
  test("the facts the Claude mod's binding card reads: this machine and folder, the door's outline and its machine, the Herdr pane", async () => {
    const env = { EP0CH_NEST: "ssh:pts/5 › door:30/daily/dock.agent:claude › herdr:door-claude", EP0CH_CONTROL: "/s/agent-door-claude.sock", EP0CH_TILE: "claude" };
    const peek = { screen: { screen: "Daily", pid: 30, outline: "orchard", host: "far-box", machine: "far", dock: { tile: { id: "dock.agent", name: "claude" }, shown: true, herdr: { pane: "door-claude" } }, state: { kind: "daily" } } };
    const d = { ...deps(env, { alive: [30], ttys: ["pts/5"], panes: [{ pane_id: "w4:p1", label: "door-claude" }], peek }), hostname: () => "near-box", cwd: () => "/work/notes" };
    const w = await where(d);
    expect(w.here).toEqual({ machine: "near-box", folder: "/work/notes" });
    expect(w.herdr).toEqual({ pane: "door-claude", label: "door-claude", agent: true });
    expect(w.door).toMatchObject({ outline: "orchard", host: "far-box", machine: "far", tile: { dock: true } });
    expect(formatWhere(w)).toContain("this runs on near-box in /work/notes");
    // A door on this machine's host names no machine; outside Herdr there is no pane.
    const local = await where(deps({ EP0CH_CONTROL: "/c/door.sock" }, { peek: { screen: { pid: 4, outline: "orchard", host: "near-box", state: {} } } }));
    expect([local.door?.machine, local.door?.host, local.herdr, local.here]).toEqual([null, "near-box", null, { machine: null, folder: null }]);
  });

  test("in the door's drop shell: the shell layer is live, and the keys are the shell's while the door waits", async () => {
    const env = { EP0CH_NEST: "ssh:pts/5 › shell:4242", EP0CH_CONTROL: "/c/door.sock", EP0CH_IN_DOOR: "1" };
    const peek = { screen: { screen: "main menu", pid: 4242, suspended: "shell", state: { kind: "main menu" } } };
    const w = await where(deps(env, { alive: [4242], ttys: ["pts/5"], peek }));
    expect(w.inDoor).toBe(true);
    expect(w.layers.map(l => [l.kind, l.live])).toEqual([["ssh", true], ["shell", true]]);
    expect(w.layers[1]!.why).toBe("the door's drop shell · the door waits under it");
    expect(w.keys).toMatchObject({ mine: true, typing: true });
    expect(formatWhere(w)).toMatch(/✓ shell door pid 4242/);
    const gone = await where(deps(env, { ttys: ["pts/5"] }));
    expect(gone.layers.at(-1)).toMatchObject({ kind: "shell", live: false, why: "the door is gone" });
  });

  test("no door: says so, with the ssh and Herdr layers the environment shows", async () => {
    const d = deps({ SSH_TTY: "/dev/pts/5", HERDR_PANE_ID: "w1:p1", HERDR_WORKSPACE_ID: "w1" }, { panes: [{ pane_id: "w1:p1", focused: true }], ttys: ["pts/5"] });
    const w = await where(d);
    expect(w.inDoor).toBe(false);
    expect(w.door).toBeNull();
    expect(w.nest).toBe("ssh:pts/5 › herdr:w1:p1");
    expect(w.layers.map(l => [l.kind, l.live])).toEqual([["ssh", true], ["herdr", true]]);
    expect(w.keys).toMatchObject({ mine: true, text: "this Herdr pane is focused" });
    expect(d.asked).toEqual([["pane", "list"]]);
    expect(formatWhere(w)).toContain("not in a door");
  });

  test("nothing at all: not in a door, and Herdr isn't asked", async () => {
    const d = deps({});
    const w = await where(d);
    expect(w).toMatchObject({ inDoor: false, nest: "", layers: [], door: null });
    expect(w.summary).toContain("not in a door");
    expect(d.asked).toEqual([]);
  });

  test("plain ssh: the door and the tile are live, and the person is typing in this tile", async () => {
    const env = { EP0CH_NEST: "ssh:pts/5 › door:1388380/desk/t1:claude", EP0CH_CONTROL: "/c/door.sock", EP0CH_TILE: "claude", EP0CH_TILE_ID: "t1" };
    const w = await where(deps(env, { alive: [1388380], ttys: ["pts/5"], ancestors: [7001, 5000, 1388380],
      peek: deskPeek({ pid: 1388380, focus: "claude", typing: "claude", tiles: [{ id: "t1", name: "claude" }, { id: "t2", name: "middle" }] }) }));
    expect(w.layers.map(l => [l.kind, l.live])).toEqual([["ssh", true], ["door", true], ["tile", true]]);
    expect(w.layers[1]!.why).toBe("running · its control socket answers");
    expect(w.layers[2]!.why).toBe("on the desk · this process runs in it");
    expect(w.door).toMatchObject({ pid: 1388380, answers: true, moved: false, outline: "garden", tile: { id: "t1", name: "claude", found: true, focused: true, descends: true } });
    expect(w.keys).toEqual({ mine: true, typing: true, tile: "t1 claude", text: "the person is typing in this tile (t1 claude)" });
    expect(formatWhere(w)).toMatch(/✓ tile\s+tile t1 claude/);
  });

  test("the person is elsewhere: on another tile, focused but not typing, or on another screen", async () => {
    const env = { EP0CH_NEST: "door:10/desk/t1:claude", EP0CH_CONTROL: "/c/door.sock" };
    const tiles = [{ id: "t1", name: "claude" }, { id: "t2", name: "middle" }];
    expect((await where(deps(env, { alive: [10], peek: deskPeek({ pid: 10, focus: "middle", tiles }) }))).keys.text).toBe("the person is on tile t2 middle, not this one");
    expect((await where(deps(env, { alive: [10], peek: deskPeek({ pid: 10, focus: "claude", tiles }) }))).keys).toMatchObject({ mine: true, typing: false });
    const menu = await where(deps(env, { alive: [10], peek: deskPeek({ pid: 10, focus: "", tiles, screen: "Main menu" }) }));
    expect(menu.keys.text).toBe("the person is on the door's Main menu screen, not the desk");
    expect(menu.layers.find(l => l.kind === "tile")).toMatchObject({ live: null });
  });

  test("the door is gone: its layer is ✗ and the keys are unknown", async () => {
    const w = await where(deps({ EP0CH_NEST: "ssh:pts/5 › door:10/desk/t1:claude", EP0CH_CONTROL: "/c/door.sock" }, { alive: [], ttys: [] }));
    expect(w.layers.map(l => [l.kind, l.live])).toEqual([["ssh", false], ["door", false], ["tile", null]]);
    expect(w.keys.text).toBe("unknown: no door answers");
    expect(w.summary).toContain("gone: ssh pts/5, door pid 10 · desk");
  });

  test("the tile was closed: the desk has no such tile", async () => {
    const w = await where(deps({ EP0CH_NEST: "door:10/desk/t9:shell", EP0CH_CONTROL: "/c/door.sock" }, { alive: [10], peek: deskPeek({ pid: 10, focus: "middle", tiles: [{ id: "t2", name: "middle" }] }) }));
    expect(w.layers.at(-1)).toMatchObject({ kind: "tile", live: false, why: "the desk has no such tile now" });
  });

  test("a terminal moved into the dock: found by its pid there, though its old EP0CH_TILE_ID names a screen tile now", async () => {
    const peek = deskPeek({ pid: 10, focus: "middle", tiles: [{ id: "t1", name: "middle", pid: 5100 }] });
    (peek.screen as any).dock = { tile: { id: "dock.agent", name: "shell" }, shown: true, entered: true, tiles: [{ name: "dock.agent", id: "dock.agent", shown: false }, { name: "kettle", id: "k2", shown: true, focused: true, pid: 6200 }] };
    const w = await where(deps({ EP0CH_NEST: "door:10/desk/t1:kettle", EP0CH_CONTROL: "/c/door.sock", EP0CH_TILE_ID: "t1", EP0CH_TILE: "kettle" }, { alive: [10], ancestors: [6200, 10], peek }));
    expect(w.door?.tile).toMatchObject({ id: "k2", name: "kettle", dock: true });
  });

  test("door in Herdr: the Herdr pane is checked read-only", async () => {
    const env = { EP0CH_NEST: "ssh:pts/5 › herdr:w1:p1 › door:20/desk/t1:claude", EP0CH_CONTROL: "/c/door.sock" };
    const d = deps(env, { alive: [20], ttys: ["pts/5"], panes: [{ pane_id: "w1:p1", focused: true }, { pane_id: "w1:p2" }], peek: deskPeek({ pid: 20, focus: "claude", typing: "claude", tiles: [{ id: "t1", name: "claude" }] }) });
    const w = await where(d);
    expect(w.layers.map(l => [l.kind, l.live])).toEqual([["ssh", true], ["herdr", true], ["door", true], ["tile", true]]);
    expect(w.layers[1]!.why).toBe("in Herdr · focused");
    expect(d.asked).toEqual([["pane", "list"]]);
  });

  test("the Herdr agent: its pane, and the tile that shows it now, even in another door than the one that made it", async () => {
    const env = { EP0CH_NEST: "ssh:pts/5 › door:30/daily/t3:claude › herdr:door-claude", EP0CH_CONTROL: "/s/agent-door-claude.sock", EP0CH_TILE: "claude", HERDR_PANE_ID: "w4:p1" };
    const peek = deskPeek({ pid: 31, focus: "claude", typing: "claude", tiles: [{ id: "t2", name: "middle" }, { id: "t5", name: "claude", herdr: "door-claude" }] });
    const w = await where(deps(env, { alive: [31], ttys: ["pts/5"], panes: [{ pane_id: "w4:p1", label: "door-claude" }], peek }));
    expect(w.nest).toBe("ssh:pts/5 › door:30/daily/t3:claude › herdr:door-claude");
    expect(w.layers.map(l => [l.kind, l.live])).toEqual([["ssh", true], ["door", false], ["herdr", true], ["tile", true]]);
    expect(w.layers[2]!.why).toBe("in Herdr (w4:p1)");
    expect(w.layers[3]!.label).toBe("shown in tile t5 claude of door 31");
    expect(w.door).toMatchObject({ pid: 31, moved: true, tile: { id: "t5", found: true } });
    expect(w.keys).toMatchObject({ mine: true, typing: true, text: "the person is typing in this tile (t5 claude)" });
  });

  test("the Herdr agent with no door showing it: it runs on in Herdr", async () => {
    const env = { EP0CH_NEST: "door:30/daily/t3:claude › herdr:door-claude", EP0CH_CONTROL: "/s/agent-door-claude.sock" };
    const w = await where(deps(env, { alive: [], panes: [{ pane_id: "w4:p1", label: "door-claude" }] }));
    expect(w.layers.at(-1)).toMatchObject({ kind: "tile", live: null, why: "no door answers on EP0CH_CONTROL (the agent runs on in Herdr)" });
  });

  test("a door older than EP0CH_NEST, pid and tile ids: the tile by EP0CH_TILE, and what couldn't be checked said", async () => {
    const env = { EP0CH_CONTROL: "/c/door.sock", EP0CH_TILE: "claude" };
    const w = await where(deps(env, { peek: deskPeek({ focus: "claude", typing: "claude", tiles: [{ name: "claude" }, { name: "middle" }] }) }));
    expect(w.inDoor).toBe(true);
    expect(w.layers.map(l => [l.kind, l.live])).toEqual([["door", true], ["tile", true]]);
    expect(w.layers[0]!.why).toBe("its control socket answers (a door older than EP0CH_NEST)");
    expect(w.keys.text).toBe("the person is typing in this tile (claude)");
    expect(w.door?.pid).toBeNull();
  });

  test("no Herdr on PATH: the Herdr layer is unknown, not gone", async () => {
    const w = await where(deps({ EP0CH_NEST: "herdr:w1:p1" }, { panes: null }));
    expect(w.layers[0]).toMatchObject({ kind: "herdr", live: null, why: "herdr isn't on PATH" });
  });
});
