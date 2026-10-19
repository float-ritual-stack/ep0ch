import { expect, test } from "bun:test";
import { join } from "node:path";

test("keys and wheel paint a 2,600-child outline within the scroll budget", async () => {
  const p = Bun.spawn(["bun", join(import.meta.dir, "../scripts/bench-scroll.ts"), "--check", "--json"], {
    stdout: "pipe", stderr: "pipe", env: process.env as Record<string, string>,
  });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  expect({ code: await p.exited, err, out }).toEqual({ code: 0, err: expect.any(String), out: expect.any(String) });
}, 600_000);
