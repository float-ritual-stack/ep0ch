import { expect, test } from "bun:test";
import { join } from "node:path";

// Seeding 2,600 notes takes minutes on a shared runner: CI runs this in its own job (test.yml `bench`, EP0CH_BENCH=1),
// not inside the door suite's 12-minute run. Locally: EP0CH_BENCH=1 bun test test/scroll-bench.test.ts.
test.skipIf(!process.env.EP0CH_BENCH)("keys and wheel paint a 2,600-child outline within the scroll budget", async () => {
  const p = Bun.spawn(["bun", join(import.meta.dir, "../scripts/bench-scroll.ts"), "--check", "--json"], {
    stdout: "pipe", stderr: "pipe", env: process.env as Record<string, string>,
  });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  expect({ code: await p.exited, err, out }).toEqual({ code: 0, err: expect.any(String), out: expect.any(String) });
}, 600_000);
