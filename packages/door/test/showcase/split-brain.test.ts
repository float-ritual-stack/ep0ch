// PIE-1369: the showcase's "a session running twice" section. Its door reads made-up sessions on garden-box (fern-sr held
// by two processes) through the same reader and stop a real door uses; the status bar's chip shows while the split lasts,
// a click on it lists the processes, an attach of the interactive one is refused with where it runs, and a stop asks
// first (the person's) or takes confirm= (an agent's), after which the chip goes. Nothing real is read or stopped.
import { beforeAll, describe, expect, test } from "bun:test";
import { USER } from "../../src/socket";
import { traceActions } from "../../src/surface/actions";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "");
const AGENT = { kind: "agent", id: "test-agent" } as const;

describe.skipIf(!outliner)("the showcase screen: a Claude session running twice", () => {
  const h = useShowcaseScreen();
  const { screen, press } = h;
  let app!: typeof h.app;
  beforeAll(() => { ({ app } = h); });
  const bar = () => plain((app as any).statusBar(h.sc, 200) as string);

  test("the chip shows while the split lasts; a click lists the processes; a stop asks, then the chip goes", async () => {
    await app.dispatch.act({ action: "section", args: { name: "split-brain" } }, USER);
    await until(() => screen().includes("A Claude session running twice"), "the section's note");
    await until(() => bar().includes("⚠ fern-sr ×2"), "the split chip");

    // An agent reads the same: the two processes oldest first, with the commands; moss runs once and isn't listed.
    const read = await app.dispatch.act({ action: "claude.splits" }, AGENT) as { splits: { name: string; machine: string; procs: { pid: number; stop: string; attach?: string }[] }[] };
    expect(read.splits).toHaveLength(1);
    expect(read.splits[0]).toMatchObject({ name: "fern-sr", machine: "garden-box" });
    expect(read.splits[0]!.procs.map(p => p.pid)).toEqual([28521, 92322]);
    expect(read.splits[0]!.procs[0]!.stop).toBe("ep0ch agent stop 28521 --session 7c41e2a0 --machine garden-box");
    expect(read.splits[0]!.procs[0]!.attach).toContain("claude attach 7c41e2a0");
    expect(read.splits[0]!.procs[1]!.attach).toBeUndefined();

    // The person's keys in the stage, as a door's screen has them: the picker's keys are theirs.
    await app.dispatch.act({ action: "section.try" }, USER);
    // A click on the chip is claude.splits as the person: the picker over the screen, a row per process.
    const ran: string[] = [];
    const stop = traceActions(a => ran.push(a.name));
    try {
      const line = bar();
      (app as any).paint();
      press({ kind: "mouse", action: "down", button: 0, x: line.indexOf("⚠ fern-sr") + 2, y: 59 });
      press({ kind: "mouse", action: "up", button: 0, x: line.indexOf("⚠ fern-sr") + 2, y: 59 });
      await until(() => ran.includes("claude.splits"), "the chip's click");
    } finally { stop(); }
    await until(() => screen().includes("a Claude session running twice"), "the picker");
    expect(screen()).toContain("pid 28521 · garden-box");
    expect(screen()).toContain("idle · older · background job 7c41e2a0");
    expect(screen()).toContain("pid 92322 · garden-box");
    expect(screen()).toContain("busy · newer · Herdr pane");
    expect(screen()).toMatch(/2 processes write one transcript, written \d+s ago/);
    // s on the row (the older, picked first) asks before it stops, naming the pid; esc keeps it.
    press({ kind: "char", ch: "s" });
    await until(() => screen().includes("stop pid 28521 of fern-sr on garden-box?"), "the stop's question, by key");
    press({ kind: "esc" });
    expect(bar()).toContain("⚠ fern-sr ×2");

    // The background job attaches in a terminal tile (made up here: it says the command a real one runs).
    const attached = await app.dispatch.act({ action: "claude.attach", args: { pid: 28521 } }, AGENT) as { cmd: string; tile?: string; name?: string };
    expect(attached.cmd).toBe(`ssh -t garden-box 'exec "\${SHELL:-/bin/sh}" -lc "claude attach 7c41e2a0"'`);
    expect(attached.name).toBe("attach-7c41e2a0");
    expect(attached.tile).toMatch(/^t-/);

    // The interactive process is its terminal's: nothing to attach, said with where it runs and how to stop it.
    await expect(app.dispatch.act({ action: "claude.attach", args: { pid: 92322 } }, AGENT)).rejects.toThrow(/interactive: its terminal owns it \(Herdr pane\).*ep0ch agent stop 92322 --session 7c41e2a0 --machine garden-box/);

    // An agent's stop needs the pid said twice; the person's first press asks, naming the pid.
    await expect(app.dispatch.act({ action: "claude.stop", args: { pid: 28521 } }, AGENT)).rejects.toThrow("needs confirm=28521");
    const asked = await app.dispatch.act({ action: "claude.stop", args: { pid: 28521 } }, USER) as { armed: number };
    expect(asked.armed).toBe(28521);
    await until(() => screen().includes("stop pid 28521 of fern-sr on garden-box?"), "the stop's question");
    press({ kind: "esc" });
    expect(bar()).toContain("⚠ fern-sr ×2");

    const done = await app.dispatch.act({ action: "claude.stop", args: { pid: 28521, confirm: 28521 } }, AGENT) as { stopped: number; said: string };
    expect(done.stopped).toBe(28521);
    expect(done.said).toContain("garden-box: stopped pid 28521 (fern-sr, session 7c41e2a0)");
    expect(bar()).not.toContain("⚠ fern-sr");
    await expect(app.dispatch.act({ action: "claude.stop", args: { pid: 28521, confirm: 28521 } }, AGENT)).rejects.toThrow("isn't a process of a session running twice now");
  });
});
