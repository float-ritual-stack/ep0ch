// PIE-498: what the dock's own tab runs, and where (src/desk/dock-program.ts). One rule, read by the dock and by
// `ep0ch doctor`: the person's program or a shell, in the person's folder, the project's, the outline's or the door's
// start, and the why said in words. Pure: a scratch folder, fictional outlines.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockProgram, programName } from "../src/desk/dock-program";

const root = mkdtempSync(join(tmpdir(), "ep0ch-dockprog-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const home = join(root, "home"), outlines = join(root, "outlines"), project = join(root, "code", "allotment");
mkdirSync(join(outlines, "allotment"), { recursive: true });
mkdirSync(join(project, "src"), { recursive: true });
writeFileSync(join(project, ".ep0ch"), 'ws = "allotment"\n');

describe("the dock's own program", () => {
  test("no agent configured: a shell, said so; one configured runs as set", () => {
    const none = dockProgram({ env: { SHELL: "/bin/zsh", EP0CH_OUTLINES: outlines }, outline: "allotment", start: root, home });
    expect(none.cmd).toEqual(["/bin/zsh"]);
    expect(none.name).toBe("shell");
    expect(none.programWhy).toMatch(/a shell: no agent is configured \(EP0CH_DAILY_AGENT is unset/);
    const set = dockProgram({ env: { EP0CH_DAILY_AGENT: "claude --model x", EP0CH_OUTLINES: outlines }, outline: "allotment", start: root, home });
    expect(set.cmd).toEqual(["claude", "--model", "x"]);
    expect(set.name).toBe("claude");
    expect(set.programWhy).toBe("EP0CH_DAILY_AGENT (claude --model x)");
    // The Herdr launcher is a Claude too; another program is its own name.
    expect(programName(["/x/scripts/door-agent-herdr.ts"])).toBe("claude");
    expect(programName(["bun", "/x/scripts/door-agent-herdr.ts"])).toBe("claude");
    expect(programName(["htop"])).toBe("htop");
  });

  test("the folder: the person's EP0CH_DAILY_CWD, else the project's .ep0ch folder, else the outline's, else where the door started", () => {
    const env = { EP0CH_OUTLINES: outlines };
    // Chosen by the person (~ is home).
    expect(dockProgram({ env: { ...env, EP0CH_DAILY_CWD: "~/patch" }, outline: "allotment", start: project, home })).toMatchObject({ cwd: join(home, "patch"), folderWhy: "EP0CH_DAILY_CWD (~/patch)" });
    // Started inside the project whose .ep0ch names this outline: the project.
    expect(dockProgram({ env, outline: "allotment", start: join(project, "src"), home })).toMatchObject({ cwd: project, folderWhy: "the folder whose .ep0ch names allotment" });
    // A .ep0ch that names another outline isn't this one's project (orchard has no folder here either): where it started.
    expect(dockProgram({ env, outline: "orchard", start: project, home })).toMatchObject({ cwd: project, folderWhy: "the folder the door was started from" });
    expect(dockProgram({ env, outline: "allotment", start: root, home })).toMatchObject({ cwd: join(outlines, "allotment"), folderWhy: "the outline's own folder (allotment)" });
    // An outline on another machine has no folder here; no outline at all (the home base): where the door started.
    expect(dockProgram({ env, outline: "allotment", machine: "far", start: root, home })).toMatchObject({ cwd: root, folderWhy: "the folder the door was started from" });
    expect(dockProgram({ env, outline: null, start: root, home })).toMatchObject({ cwd: root, folderWhy: "the folder the door was started from" });
  });
});
