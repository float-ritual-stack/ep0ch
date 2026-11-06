// The Deploys note install writes (PIE-941): its table figure draws the deploys at any width, and a table with
// nothing to draw says so rather than failing the figure.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { renderGraph } from "../src/graphs";
import { drawNote } from "../src/notes-cli";
const DEPLOYS_NOTE = "Deploys [type::virtual-branch] [query::type=deploy machine=install]\n\n::graph-table\n---\nquery: type=deploy machine=install\ncolumns: [title, created]\n---\n::";
import type { Facts } from "../src/setup/model";
import { startDeployRecord } from "../src/setup/deploy-record";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch, ScratchHost } from "./scratch";

const strip = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe("a table figure with no columns or rows", () => {
  test.each([20, 60, 140])("draws a hint at %d columns, never a failure", w => {
    const out = renderGraph("table", { yaml: "", markdown: ["query: type=deploy", "columns: [title, created]"] }, w).map(strip).join("\n");
    expect(out).not.toContain("couldn't draw");
    expect(out).toContain("no columns");
  });
});

describe.skipIf(!outliner)("the Deploys note", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => { await scratch.start(); board = new SocketBoard(scratch.sock); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("shows the deploys at 60, 100 and 140 columns", async () => {
    const root = await board.createBlock(null, DEPLOYS_NOTE, { kind: "user" });
    await board.createBlock(root.id, "Deploy 2026-10-16T07:00:00.000Z on the-box [type::deploy] [machine::install]\n\nWhen: x", { kind: "user" });
    // The figure alone, in a plain note: the deploys under the virtual branch would show whatever the figure does.
    const copy = await board.createBlock(null, "Copy\n\n" + DEPLOYS_NOTE.slice(DEPLOYS_NOTE.indexOf("::graph-table")), { kind: "user" });
    for (const w of [60, 100, 140]) {
      const text = (await drawNote(board, copy.id, w))!.map(strip).join("\n");
      expect(text).not.toContain("couldn't draw");
      expect(text).toContain("Deploy 2026-10-16");
    }
  }, 30_000);
});


test("record deploy uses the existing Deploys destination and install shape", async () => {
  const scratch = new Scratch();
  let board: SocketBoard | undefined;
  try {
    await scratch.start();
    board = new SocketBoard(scratch.sock); await board.info();
    const root = await board.createBlock(null, "Deploys [system-view::deploys] [machine::install]", { kind: "user" });
    const p = Bun.spawn([process.execPath, new URL("../src/main.ts", import.meta.url).pathname,
      "record", "deploy", "--sha", "abc1234", "--host", "garden-box", "--protocol", "123", "--grammar", "45",
      "--sessions", "one session handed over", "--failed", "none"], {
      env: { ...process.env, ...scratch.env }, stdout: "pipe", stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect(code, err).toBe(0);
    const note = await board.request("get", { blockId: JSON.parse(out).id });
    expect(note.parentId).toBe(root.id);
    expect(note.text).toContain("[machine::install]");
    expect(note.text).toContain("on garden-box");
    expect(note.text).toContain("[protocol::123]");
    expect(note.text).toContain("[grammar::45]");
    expect(note.text).toContain("one session handed over");
  } finally { board?.close(); await scratch.dispose(); }
}, 30_000);

// PIE-1557: a link's install runs with no outline named. Its deploy is recorded by the machine that asked for it, from
// the receipt, so it writes none and says nothing; any other install with nowhere to write still hears why.
test("with no outline named, a linked install writes no record and a person's says what to run", async () => {
  const scratch = new ScratchHost();
  try {
    await scratch.start();
    const facts = { host: { socket: scratch.sock, folder: scratch.outlines, running: true }, repo: { root: "/nowhere", protocol: 1, checkout: { head: "abc1234" } } } as unknown as Facts;
    const nothingNamed = { HOME: scratch.root, EP0CH_OUTLINES: scratch.outlines };
    const start = (linked: boolean) => startDeployRecord(facts, nothingNamed, scratch.root, new Date(), () => {}, [], linked);
    expect(await start(true)).toBeUndefined();
    await expect(start(false)).rejects.toThrow("no outline named here or by the host");
  } finally { await scratch.dispose(); }
}, 30_000);

// PIE-1605: the install's Deploy rows said a bare `loki`; they say which machine wrote them, and the Who line stays the persona.
test("a deploy record written by a persona carries the machine it ran on", async () => {
  const scratch = new Scratch();
  let board: SocketBoard | undefined;
  try {
    await scratch.start();
    board = new SocketBoard(scratch.sock); await board.info();
    await board.createBlock(null, "Deploys [system-view::deploys] [machine::install]", { kind: "user" });
    const facts = { host: { socket: scratch.sock, running: true }, repo: { root: "/nowhere", protocol: 1, checkout: { head: "abc1234" } } } as unknown as Facts;
    const env = { ...scratch.env, HOME: scratch.root, EP0CH_AGENT: "fixture-deployer", EP0CH_MACHINE_NAME: "garden-box" };
    const record = await startDeployRecord(facts, env, tmpdir(), new Date(), () => {}, [], false);
    expect(record).toBeDefined();
    const note = await board.request("get", { blockId: record!.id });
    expect(note.actorId).toBe("fixture-deployer/ep0ch@garden-box");
    expect(note.text).toContain("Who: fixture-deployer");
  } finally { board?.close(); await scratch.dispose(); }
}, 30_000);
