// PIE-1280: the restart section. kitty runs a made-up claude (src/showcase/fake-claude.ts: its own status file, its own
// config folder). tile.restart ends it with /exit between turns and starts it again in the same tile; an agent's restart
// is refused mid-turn unless now=true, which says what it dropped; the person's press never waits. The tile menu and
// ^W R name it. Scratch service, the showcase's fictional seed.
import { describe, expect, test } from "bun:test";
import { resumeCommand } from "../../src/desk/agent-sessions";
import { Desk } from "../../src/desk/desk";
import { ReaderPane } from "../../src/desk/panes";
import { FAKE_CLAUDE_SESSION, fakeClaude } from "../../src/showcase/restart";
import { scratchDir } from "../scratch";
import { join } from "node:path";
import { PtyPane } from "../../src/desk/pty";
import { W_KEYS } from "../../src/desk/wkeys";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

test("a restarted Claude resumes its own session by id, its other flags kept (PIE-1280)", () => {
  expect(resumeCommand(["claude", "--continue"], "5eed")).toEqual(["claude", "--resume", "5eed"]);
  expect(resumeCommand(["/opt/bin/claude", "--resume", "old1", "--plugin-dir", "/mods/garden", "-c"], "5eed")).toEqual(["/opt/bin/claude", "--plugin-dir", "/mods/garden", "--resume", "5eed"]);
  // An interpreter's own -c stays: only what follows the program is Claude's.
  expect(resumeCommand(["node", "-c", "/opt/lib/claude.js", "--resume=old1", "--model", "sonnet"], "5eed")).toEqual(["node", "-c", "/opt/lib/claude.js", "--model", "sonnet", "--resume", "5eed"]);
});

describe.skipIf(!outliner || process.platform !== "linux")("the restart section (PIE-1280)", () => {
  const h = useShowcaseScreen();
  const AS = "restart-agent-1280";

  test("kitty's claude restarts in its tile: /exit between turns, refused to an agent mid-turn, now=true drops the turn and says so", async () => {
    (h.app as any).lastInput = 0;
    await h.app.act({ action: "section", args: { name: "restart" }, as: "test-agent" });
    await until(() => !!h.S().stages.get(h.S().sel), "the restart section");
    const d = h.S().stages.get(h.S().sel).top as Desk;
    try {
      const kitty = () => d.pane("kitty") as PtyPane;
      const text = () => { kitty().render(100, 20, false, d as any); return kitty().text().join("\n"); };
      await until(() => /a made-up claude, pid (\d+)/.test(text()), "kitty's claude starts", 15_000);
      const pidOf = () => Number(/a made-up claude, pid (\d+)/.exec(text())?.[1]);
      await until(() => kitty().claude()?.status === "idle", "its status file says idle");
      const first = pidOf();

      // An agent's, between turns: /exit, then the same command again in the same tile.
      const done = await h.app.act({ action: "tile.restart", args: {}, tile: "kitty", as: AS }) as Record<string, unknown>;
      expect(done).toMatchObject({ name: "kitty", restarted: true, ended: "exit", program: "claude" });
      await until(() => pidOf() > 0 && pidOf() !== first, "a new claude in kitty", 15_000);
      expect(d.pane("kitty")).toBe(kitty());
      // Its title is the new one's: the old wrapper's "claude exited · shell" doesn't stay on the header.
      expect(kitty().title()).not.toContain("exited");

      // Mid-turn: an agent's is refused, with what now=true would drop; now=true goes and says it.
      await until(() => kitty().claude()?.status === "idle", "the new one is idle");
      await h.app.act({ action: "tile.type", args: { text: "turn\\n" }, tile: "kitty", as: AS });
      await until(() => kitty().claude()?.status === "busy", "it is mid-turn");
      await expect(h.app.act({ action: "tile.restart", args: {}, tile: "kitty", as: AS })).rejects.toThrow(/mid-turn · try again between turns, or now=true ends it anyway \(it drops the turn\)/);
      const second = pidOf();
      const forced = await h.app.act({ action: "tile.restart", args: { now: true }, tile: "kitty", as: AS }) as Record<string, unknown>;
      expect(forced).toMatchObject({ ended: "signal", dropped: "the turn in progress" });
      await until(() => pidOf() > 0 && pidOf() !== second, "claude again after the forced restart", 15_000);

      // A pid that isn't in the tile is refused (ep0ch agent restart names the one it found).
      await expect(h.app.act({ action: "tile.restart", args: { pid: 1 }, tile: "kitty", as: AS })).rejects.toThrow(/pid 1 doesn't run in kitty/);

      // The person's: by its menu row and ^W R, the same action; mid-turn it doesn't wait.
      const rows = (d.dispatch.menu(d.layoutGet().tiles.find((t: any) => t.name === "kitty")!.tile, { kind: "user" }) as { label: string; action: string }[]);
      expect(rows.filter(r => r.action === "tile.restart").map(r => r.label)).toEqual(["restart its program"]);
      expect(W_KEYS.find(k => k.key === "R")?.action).toBe("tile.restart");
      await until(() => kitty().claude()?.status === "idle", "idle again");
      await h.app.act({ action: "tile.type", args: { text: "turn\\n" }, tile: "kitty", as: AS });
      await until(() => kitty().claude()?.status === "busy", "mid-turn again");
      const third = pidOf();
      const theirs = await d.dispatch.act({ action: "tile.restart", args: {}, tile: "kitty" }, { kind: "user" }) as Record<string, unknown>;
      expect(theirs).toMatchObject({ ended: "signal", dropped: "the turn in progress" });
      await until(() => pidOf() > 0 && pidOf() !== third, "claude again after the person's restart", 15_000);
    } finally { d.dispose(); }
  }, 90_000);

  test("a claude typed in a shell tile on a screen not shown: found, restarted there with --resume, Evan's screen and focus stay; one that doesn't come back fails loudly", async () => {
    const fake = fakeClaude(join(scratchDir("ep0ch-restart-shell-"), "claude"));
    const shell = new PtyPane({ cmd: ["sh"], label: "bench", own: { CLAUDE_CONFIG_DIR: fake.config } });
    const bench = new Desk({ name: "bench", title: "Bench", layout: { root: { t: "leaf", kind: "pty", name: "bench" } } }, { given: new Map([["bench", shell]]) });
    const letters = new Desk({ name: "letters", title: "Letters", layout: { root: { t: "leaf", kind: "reader", name: "letters" } } }, { given: new Map([["letters", new ReaderPane(true)]]) });
    h.app.push(bench); bench.render(h.app as any); shell.render(100, 20, false, bench as any);
    const text = () => { shell.render(100, 20, false, bench as any); return shell.text().join("\n"); };
    try {
      await until(() => shell.running, "the shell runs");
      shell.input(`${fake.cmd}\r`);
      await until(() => shell.claude()?.status === "idle", "a claude typed in the shell", 15_000);
      const first = shell.claude()!.pid;
      // Another screen is shown on top: the bench is behind it.
      h.app.push(letters); letters.render(h.app as any);
      const top = () => h.app.screens().at(-1);
      expect(top()).toBe(letters);
      const found = await h.app.act({ action: "host.tileOf", args: { pid: first }, as: AS }) as { tile: string | null };
      expect(found.tile).toMatch(/^t-/);
      const done = await h.app.act({ action: "tile.restart", args: { pid: first }, tile: found.tile!, as: AS }) as Record<string, unknown>;
      expect(done).toMatchObject({ name: "bench", restarted: true, ended: "exit", program: "claude" });
      // The agent came back in the bench's shell, resumed by its session id; Evan is still on letters.
      await until(() => !!shell.claude() && shell.claude()!.pid !== first, "claude back in the bench", 15_000);
      expect(text()).toContain(`args:--resume ${FAKE_CLAUDE_SESSION}:`);
      expect(top()).toBe(letters);
      // One that won't come back: refused with what happened, never said as done.
      const again = shell.claude()!.pid;
      shell.run.own = { ...shell.run.own, FAKE_CLAUDE_REFUSE: "1" };
      await expect(h.app.act({ action: "tile.restart", args: { pid: again }, tile: found.tile!, as: AS })).rejects.toThrow(/claude didn't come back in bench/);
    } finally { h.app.pop(); h.app.pop(); letters.dispose(); bench.dispose(); }
  }, 90_000);
});
