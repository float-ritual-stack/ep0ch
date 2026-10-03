// `ep0ch find` and `ep0ch show` (src/notes-cli.ts): the outline's notes for a picker's channel or a script, on a
// scratch host. find lists every note (newest first) or the service's ranked matches; show draws a note as the
// reader does, at the width asked for. Fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { everyNote, foundLine } from "../src/notes-cli";
import { SocketBoard } from "../src/socket";
import { visible, width } from "../src/style";
import { outliner, Scratch } from "./scratch";

const MAIN = join(import.meta.dir, "../src/main.ts");
const run = async (args: string[], env: Record<string, string> = {}, cwd?: string) => {
  const p = Bun.spawn(["bun", MAIN, ...args], { stdout: "pipe", stderr: "pipe", ...(cwd ? { cwd } : {}), env: { ...process.env, EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock", ...env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
};

describe("every note, for a picker that filters as it's typed", () => {
  test("newest first, each with its ancestors' titles as its path", () => {
    const at = (n: number) => n * 1000;
    const b = (id: string, parentId: string | null, title: string, updatedAt: number) =>
      ({ id, parentId, title, updatedAt, position: 0, author: "you", createdAt: 0, props: {}, hasChildren: false });
    const list = everyNote([b("a", null, "Allotment", at(1)), b("b", "a", "Beds", at(3)), b("c", "b", "Bean canes", at(2))]);
    expect(list.map(f => [f.id, f.title, f.path])).toEqual([["b", "Beds", "Allotment"], ["c", "Bean canes", "Allotment › Beds"], ["a", "Allotment", ""]]);
  });

  test("a --lines row is one line of three tab-separated fields, whatever the title holds", () => {
    expect(foundLine({ id: "x1", title: "Two\tlines\nof title", path: "Shed › Tools" })).toBe("x1\tTwo lines of title\tShed › Tools");
  });
});

describe.skipIf(!outliner)("ep0ch find and show against a scratch host", () => {
  const scratch = new Scratch();
  let sock = "", env: Record<string, string> = {};
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    sock = await scratch.start();
    env = { EP0CH_SOCKET: sock, EP0CH_WS: scratch.name };
    const board = new SocketBoard(sock, undefined, scratch.name);
    const make = async (key: string, text: string, parentId: string | null = null) => { ids[key] = (await board.request<{ id: string }>("create", { parentId, text, author: "agent" })).id; };
    await make("shed", "Bike shed\nWhere the bikes live.");
    await make("oil", "Chain oil\nThe **wax** one, not the spray. See ((" + "x" + ")).", ids.shed);
    await make("gone", "Old padlock code\nNobody needs this.", ids.shed);
    await board.trash(ids.gone!);
    board.close();
  });
  afterAll(async () => { await scratch.dispose(); });

  test("find --lines: every live note, id, title and path; a trashed one isn't there", async () => {
    const r = await run(["find", "--lines"], env);
    expect(r.code).toBe(0);
    const rows = r.out.trim().split("\n").map(l => l.split("\t"));
    expect(rows.find(f => f[0] === ids.oil)).toEqual([ids.oil!, "Chain oil", "Bike shed"]);
    expect(rows.find(f => f[0] === ids.shed)?.slice(1)).toEqual(["Bike shed", ""]);
    expect(rows.some(f => f[0] === ids.gone)).toBe(false);
  });

  test("find <words>: the service's forgiving ranker (typos, any order), best first", async () => {
    const r = await run(["find", "oil", "chian", "--lines"], env);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toBe(`${ids.oil}\tChain oil\tBike shed`);
    const json = JSON.parse((await run(["find", "bike", "--json"], env)).out);
    expect(json[0]).toEqual({ id: ids.shed, title: "Bike shed", path: "" });
  });

  test("show: the note as a reader draws it, at the width asked for; --ansi keeps the colours", async () => {
    const plain = await run(["show", ids.oil!, "--width", "40"], env);
    expect(plain.code).toBe(0);
    const lines = plain.out.trimEnd().split("\n");
    expect(lines[0]).toBe("Chain oil");
    expect(lines[2]).toBe("Bike shed");                          // its crumbs, read from the outline
    expect(plain.out).toContain("The wax one, not the spray.");      // inline Markdown drawn, not typed
    expect(plain.out).not.toContain("\x1b[");
    for (const l of lines) expect(width(l)).toBeLessThanOrEqual(40);
    const ansi = await run(["show", ids.oil!, "--width", "40", "--ansi"], env);
    expect(ansi.out).toContain("\x1b[");
    expect(ansi.out.split("\n").map(l => visible(l).trimEnd())).toEqual(plain.out.split("\n"));
    // ((id)) as a picker outputs it is taken as the id.
    expect((await run(["show", `((${ids.oil}))`, "--width", "40"], env)).out).toBe(plain.out);
  });

  test("refusals: no such note, a bad width, nothing to show, an outline nobody names", async () => {
    const none = await run(["show", "00000000-0000-4000-8000-000000000000"], env);
    expect([none.code, none.err]).toEqual([1, expect.stringContaining("no note")]);
    expect((await run(["show", ids.oil!, "--width", "3"], env)).code).toBe(2);
    expect((await run(["show"], env)).code).toBe(2);
    expect((await run(["find", "--bogus"], env)).code).toBe(2);
    // A folder (and home) that names no outline: said, never a guess.
    const nowhere = mkdtempSync(join(tmpdir(), "ep0ch-find-"));
    const unnamed = await run(["find", "--lines"], { EP0CH_SOCKET: sock, EP0CH_WS: "", HOME: nowhere }, nowhere);
    rmSync(nowhere, { recursive: true, force: true });
    expect([unnamed.code, unnamed.err]).toEqual([1, expect.stringContaining("no outline is named here")]);
  });
});
