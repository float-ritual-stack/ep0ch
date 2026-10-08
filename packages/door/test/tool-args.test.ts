// Agent tool arguments across the door's surfaces (outline-core/src/tool-args.ts): the Claude mod carries a copy that
// can't import it, so the two must stay byte-equal below the marker; the door's own `act` and `open` take `ref` and its
// aliases for their `id`, refuse two that name different blocks, and answer a wrong call with the right one.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ActionRefused, actionSet, def } from "../src/surface/actions";
import type { Actor } from "../src/socket";
import { tmpdir } from "node:os";
import { controlClient } from "../src/control";

const AGENT: Actor = { kind: "agent", id: "claude-7" };
const BLOCK = "0f3c2a1b-1111-4222-8333-444455556666";
const OTHER = "7a1e0c2d-2222-4333-8444-555566667777";

describe("tool-args.ts is one file in two places", () => {
  const MARK = "// --- tool-args shared code below this line ---";
  const below = (path: string) => readFileSync(join(import.meta.dir, path), "utf8").split(MARK)[1];
  test("the mod's copy equals outline-core's below the marker", () => {
    expect(below("../../claude-mod/hooks/tool-args.ts")).toBe(below("../../outline-core/src/tool-args.ts"));
    expect(below("../../outline-core/src/tool-args.ts")?.length).toBeGreaterThan(1000);
  });
});

describe("the door's act: id, and ref under every name a model gives it", () => {
  const ran: unknown[] = [];
  const set = actionSet<object>()("test", {
    "note.pin": def({ summary: "pin a note", touches: "nothing", replay: "safe", args: { id: { type: "string", about: "the block id" }, n: { type: "number", optional: true, about: "its place" } }, run: (a) => { ran.push(a); return a; } }),
    "note.bare": def({ summary: "no arguments", touches: "nothing", replay: "safe", args: {}, run: () => { ran.push("bare"); } }),
  } as never);
  const run = async (raw: Record<string, unknown>) => set.runUntyped("note.pin", raw, {}, AGENT);

  test("each alias is the id", async () => {
    for (const alias of ["id", "ref", "reference", "block", "blockId", "uri", "note"]) {
      expect(await run({ [alias]: BLOCK })).toEqual({ id: BLOCK });
    }
    expect(await run({ ref: BLOCK, n: "2" })).toEqual({ id: BLOCK, n: 2 });
  });

  test("two names for different blocks are refused and the action does not run; one block spelt two ways runs once", async () => {
    ran.length = 0;
    await expect(run({ ref: BLOCK, id: OTHER })).rejects.toThrow(/Ambiguous.*`ref` is "0f3c.*`id` is "7a1e.*pass one `ref`[\s\S]*Example: ep0ch act note\.pin id=/);
    await expect(run({ ref: BLOCK, id: OTHER })).rejects.toBeInstanceOf(ActionRefused);
    expect(ran).toEqual([]);
    expect(await run({ ref: `((${BLOCK}))`, id: BLOCK })).toEqual({ id: `((${BLOCK}))` });
    expect(ran.length).toBe(1);
  });

  test("a wrong argument gets the schema and a call that works", async () => {
    const message = async (raw: Record<string, unknown>) => { try { await run(raw); } catch (e) { return (e as Error).message; } return ""; };
    const typo = await message({ blok: BLOCK });
    expect(typo).toContain("`blok` is not an argument of note.pin; did you mean `id`?");
    expect(typo).toContain("Arguments: id (string, required) · n (number)");
    expect(typo).toContain(`Call it as: ep0ch act note.pin id=${BLOCK}`);
    const missing = await message({ n: 2 });
    expect(missing).toContain("Missing required `id` (string: the block id)");
    expect(missing).toContain("Example: ep0ch act note.pin id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34");
    expect(await message({ id: BLOCK, n: "two" })).toContain("n is a number");
    await expect((async () => set.runUntyped("note.bare", { id: BLOCK }, {}, AGENT))()).rejects.toThrow(/`id` is not an argument of note\.bare[\s\S]*Arguments: no arguments/);
  });
});

describe("ep0ch open: the ref positionally or by any of its names", () => {
  const open = async (...argv: string[]) => {
    const said: string[] = [];
    const was = console.error, wasEnv = process.env.EP0CH_CONTROL;
    console.error = (...a: unknown[]) => { said.push(a.join(" ")); };
    process.env.EP0CH_CONTROL = join(tmpdir(), "ep0ch-no-door-here.sock");
    try { return { code: await controlClient(["open", ...argv]), said: said.join("\n") }; }
    finally { console.error = was; if (wasEnv === undefined) delete process.env.EP0CH_CONTROL; else process.env.EP0CH_CONTROL = wasEnv; }
  };
  test("two names for different blocks are refused before anything is sent, whichever order and spelling", async () => {
    for (const argv of [[`ref=${BLOCK}`, `id=${OTHER}`], [BLOCK, `id=${OTHER}`], [`ref=${BLOCK}`, "from=main", `block=((${OTHER}))`], [`((${BLOCK}))`, `uri=${OTHER}`]]) {
      const r = await open(...argv);
      expect(r.code, argv.join(" ")).toBe(1);
      expect(r.said).toContain("Ambiguous");
      expect(r.said).toContain("pass one `ref`");
      expect(r.said).toContain("Example: ep0ch open PIE-123");
    }
    // The same block in two outlines is two blocks.
    expect((await open(`ref=ep0ch://garden@laptop/b/${BLOCK}`, `uri=ep0ch://archive@server/b/${BLOCK}`)).said).toContain("Ambiguous");
  });
  test("one block spelt two ways goes on to the door (here: none answers)", async () => {
    for (const argv of [[`ref=${BLOCK}`], [BLOCK, `id=((${BLOCK}))`], [`reference=${BLOCK}`, "from=main"], [`ref=${BLOCK}`, `id=${BLOCK}`]]) {
      const r = await open(...argv);
      expect(r.said, argv.join(" ")).toContain("no door answered");
      expect(r.said).not.toContain("Ambiguous");
    }
  });
});
