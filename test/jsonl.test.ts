// Newline JSON over a socket (src/jsonl.ts): one reader, one one-shot request and one liveness probe, used by the
// outline client, the control socket and its clients, and the session's sockets.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ask, jsonLine, JsonLines, listening } from "../src/jsonl";

describe("JsonLines", () => {
  test("a value per whole line, across chunks; a character split between two chunks arrives whole", () => {
    const got: unknown[] = [], bad: string[] = [];
    const lines = new JsonLines(v => got.push(v), l => bad.push(l));
    const bytes = Buffer.from(jsonLine({ note: "Fern — 🌿" }) + "\n" + "not json\n" + jsonLine([1, 2]));
    const cut = bytes.indexOf(Buffer.from("🌿")) + 2;              // inside the four bytes of 🌿
    lines.feed(bytes.subarray(0, cut));
    expect(got).toEqual([]);
    lines.feed(bytes.subarray(cut));
    expect(got).toEqual([{ note: "Fern — 🌿" }, [1, 2]]);
    expect(bad).toEqual(["not json"]);
  });

  test("a line past its limit without an end is refused and let go", () => {
    const lines = new JsonLines(() => {});
    expect(lines.feed("x".repeat(10), 16)).toBe(true);
    expect(lines.feed("x".repeat(10), 16)).toBe(false);
    expect(lines.feed("{}\n", 16)).toBe(true);
  });

  test("a handler that throws doesn't stop the lines after it", () => {
    const got: number[] = [];
    const lines = new JsonLines(v => { if (v === 1) throw new Error("boom"); got.push(v); });
    lines.feed("1\n2\n");
    expect(got).toEqual([2]);
  });
});

describe("ask and listening", () => {
  const dir = mkdtempSync(join(tmpdir(), "ep0ch-jsonl-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("ask: the first line answered; null when nobody is there or nothing answers in time", async () => {
    const path = join(dir, "echo.sock"), quiet = join(dir, "quiet.sock");
    const echo = createServer(s => s.on("data", d => s.write(jsonLine({ ok: true, said: JSON.parse(d.toString()) }))));
    const silent = createServer(() => {});
    await new Promise<void>(r => echo.listen(path, r));
    await new Promise<void>(r => silent.listen(quiet, r));
    try {
      expect(await ask(path, { cmd: "peek" })).toEqual({ ok: true, said: { cmd: "peek" } });
      expect(await ask(join(dir, "none.sock"), { cmd: "peek" }, 500)).toBeNull();
      expect(await ask(quiet, { cmd: "peek" }, 100)).toBeNull();
      expect(await listening(path)).toBe(true);
      expect(await listening(join(dir, "none.sock"))).toBe(false);
    } finally { echo.close(); silent.close(); }
  });
});
