// PIE-1034: the showcase's "who can reach what" section, driven as a person works (keys) and as an agent (act). The
// harness seeds a scratch host with made-up outlines and grants; the section's caps and usage are the door's own state.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { outliner, until } from "../scratch";
import { SECTIONS } from "../../src/showcase/showcase";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: who can reach what", () => {
  const h = useShowcaseScreen();
  const agent = { as: "test-agent" } as const;
  // The tile reads the section's own cap file; mcp.access.matrix (the host action) reads the door's, so this asks the tile.
  const matrix = async () => (await h.app.act({ action: "access.refresh", tile: "access", ...agent })) as { cells: { caller: string; outline: string; level: string; grant: string; usage: { calls: number } | null; why: string }[] };
  const cell = (m: Awaited<ReturnType<typeof matrix>>, caller: string, outline: string) => m.cells.find(c => c.caller === caller && c.outline === outline)!;

  test("the matrix shows glyph and word per cell; an agent reads it and asks what a change would do, only the person applies it", async () => {
    (h.app as any).lastInput = 0;
    expect(SECTIONS.some(s => s.key === "access")).toBe(true);
    await h.app.act({ action: "section", args: { name: "access" }, ...agent });
    await until(() => h.screen().includes("● full"), "the matrix", 10_000);
    for (const word of ["● full", "♦ propose", "○ read", "✗ none"]) expect(h.screen()).toContain(word);
    expect(h.screen()).toContain("claude-code@float-2");
    expect(h.screen()).toContain("last 7 days");

    // The effective level is the lower of the outline's grant and the caller's cap, with why.
    const m = await matrix();
    expect(cell(m, "garden-bot", "rotfield")).toMatchObject({ level: "propose", grant: "full" });
    expect(cell(m, "garden-bot", "rotfield").why).toContain("capped at propose");
    expect(cell(m, "garden-bot", "gurgle")).toMatchObject({ level: "read", grant: "read" });
    expect(cell(m, "claude-code@float-2", "rotfield").level).toBe("full");
    expect(cell(m, "claude-code@float-2", "vault").level).toBe("none");
    expect(cell(m, "garden-bot", "garden").usage?.calls).toBe(4);
    expect(cell(m, "garden-bot", "rotfield").usage?.calls).toBe(1);

    // The same read with no tile open: the host action an agent calls.
    const read = await h.app.act({ action: "mcp.access.matrix", ...agent }) as { outlines: { outline: string }[]; cells: unknown[] };
    expect(read.outlines.map(o => o.outline)).toEqual(expect.arrayContaining(["garden", "gurgle", "rotfield", "vault"]));
    expect(read.cells.length).toBeGreaterThan(0);

    // An agent may ask what a change would do; it writes nothing and takes nobody's cell.
    const planned = await h.app.act({ action: "access.plan", tile: "access", args: { caller: "claude-code@float-2", outline: "gurgle", level: "propose" }, ...agent }) as { plan: { steps: { command: string; affects: string }[] }; applied: boolean };
    expect(planned.applied).toBe(false);
    expect(planned.plan.steps.map(s => s.command)).toEqual(["ep0ch mcp access propose --ws gurgle"]);
    expect(planned.plan.steps[0]!.affects).toContain("every caller's ceiling");
    expect(cell(await matrix(), "claude-code@float-2", "gurgle").level).toBe("read");
    // Applying access is the person's.
    await expect(h.app.act({ action: "access.apply", tile: "access", args: { caller: "claude-code@float-2", outline: "gurgle", level: "propose" }, ...agent })).rejects.toThrow(/person/i);
    expect(cell(await matrix(), "claude-code@float-2", "gurgle").level).toBe("read");
  });

  test("the person picks a cell, plans a level, sees the command and applies it; the grant changes on the host", async () => {
    (h.app as any).lastInput = 0;
    await h.app.act({ action: "section", args: { name: "access" }, ...agent });
    await until(() => h.screen().includes("● full"), "the matrix", 10_000);
    h.press({ kind: "tab" });
    // Row 1 is the caller used last (claude-code@float-2); columns run garden, gurgle, rotfield, showcase, vault.
    h.ch("l");
    await until(() => h.screen().includes("claude-code@float-2 in gurgle"), "the picked cell's use line");
    h.ch("p");
    await until(() => h.screen().includes("will run: ep0ch mcp access propose --ws gurgle"), "the plan");
    expect(h.screen()).toContain("every caller's ceiling");
    h.press({ kind: "enter" });
    await until(() => h.screen().includes("ran ep0ch mcp access propose --ws gurgle"), "the change to be said", 10_000);
    const m = await matrix();
    expect(cell(m, "claude-code@float-2", "gurgle")).toMatchObject({ level: "propose", grant: "propose" });
  });

  test("lowering a named path writes its cap into the section's own file, and the matrix follows", async () => {
    (h.app as any).lastInput = 0;
    await until(() => h.screen().includes("● full"), "the matrix", 10_000);
    // From where the last test left the cell (claude-code@float-2, gurgle): down to garden-bot, right to rotfield.
    h.ch("j"); h.ch("l");
    await until(() => h.screen().includes("garden-bot in rotfield"), "garden-bot's cell in rotfield");
    h.ch("r");
    await until(() => h.screen().includes("will run: ep0ch mcp access --cap garden-bot@rotfield=read"), "the plan");
    expect(h.screen()).toContain("only garden-bot in rotfield");
    // esc leaves the plan and writes nothing.
    h.press({ kind: "esc" });
    await until(() => !h.screen().includes("will run:"), "the plan to be dropped");
    const file = join(process.env.EP0CH_STATE!, "showcase-access", "ep0ch", "mcp.env");
    expect(readFileSync(file, "utf8")).not.toContain("garden-bot@rotfield");
    h.ch("r");
    await until(() => h.screen().includes("will run: ep0ch mcp access --cap garden-bot@rotfield=read"), "the plan again");
    h.press({ kind: "enter" });
    await until(() => h.screen().includes("ran ep0ch mcp access --cap garden-bot@rotfield=read"), "the change to be said", 10_000);
    expect(readFileSync(file, "utf8")).toContain("garden-bot@rotfield=read");
    expect((await matrix()).cells.find(c => c.caller === "garden-bot" && c.outline === "rotfield")).toMatchObject({ level: "read", grant: "full" });
  });
});
