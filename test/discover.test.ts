// Which service `ep0ch` talks to when none is named: the current directory's workspace, else the only live
// one; a stale socket file never wins; several live ones ask for --ws.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { candidates, discoverSocket, socketOf } from "../src/discover";
import { outliner, Scratch } from "./scratch";

describe("candidates", () => {
  test("the current directory's workspace and its ancestors come first, then the rest", () => {
    const base = mkdtempSync(join(tmpdir(), "ep0ch-discover-"));
    const plot = join(base, "allotment"), shed = join(base, "shed");
    for (const root of [plot, shed]) { mkdirSync(dirname(socketOf(root, base)), { recursive: true }); writeFileSync(socketOf(root, base), ""); }
    const list = candidates(join(plot, "beds", "north"), base);
    expect(list[0]).toEqual({ path: socketOf(plot, base), nearest: true });
    expect(list.map(c => c.path)).toContain(socketOf(shed, base));
    expect(list.find(c => c.path === socketOf(shed, base))!.nearest).toBe(false);
    rmSync(base, { recursive: true, force: true });
  });
});

describe.skipIf(!outliner)("discoverSocket against scratch services", () => {
  const a = new Scratch(), b = new Scratch();
  let base = "", sockA = "";
  beforeAll(async () => {
    sockA = await a.start();
    base = dirname(dirname(sockA));                      // a's state dir holds its <hash>/outliner.sock
  });
  afterAll(async () => { await a.dispose(); await b.dispose(); });

  test("inside the workspace: its service, and says why", async () => {
    const r = await discoverSocket(join(a.workspace, "sub", "dir"), base);
    expect(r).toMatchObject({ path: sockA });
    expect("why" in r && r.why).toContain("this directory is in");
  });

  test("elsewhere with one live service: that one; a stale socket file for the directory is skipped", async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "ep0ch-elsewhere-"));
    const stale = socketOf(elsewhere, base);
    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(stale, "");                              // a socket file nobody answers on
    const r = await discoverSocket(elsewhere, base);
    expect(r).toMatchObject({ path: sockA });
    expect("why" in r && r.why).toContain("the only running outline");
    rmSync(dirname(stale), { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  });

  test("elsewhere with two live services: asks for --ws, naming both", async () => {
    const sockB = await b.start();
    const hashDir = join(base, "b-service");
    mkdirSync(hashDir, { recursive: true });
    const { symlinkSync } = await import("node:fs");
    symlinkSync(sockB, join(hashDir, "outliner.sock"));   // b's socket, seen from a's state dir
    const r = await discoverSocket(tmpdir(), base);
    expect("error" in r && r.error).toContain("several outlines are running");
    expect("error" in r && r.error).toContain(`--ws ${a.workspace}`);
    expect("error" in r && r.error).toContain(`--ws ${b.workspace}`);
    rmSync(hashDir, { recursive: true, force: true });
  });

  test("no live service: says so", async () => {
    const empty = mkdtempSync(join(tmpdir(), "ep0ch-empty-"));
    const r = await discoverSocket(empty, empty);
    expect("error" in r && r.error).toContain("no outline service is running");
    rmSync(empty, { recursive: true, force: true });
  });
});
