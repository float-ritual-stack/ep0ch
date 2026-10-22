// Jev's key comes from the with-secrets store like every other key the service uses (the `typesafe` group), not only
// from the host's environment: on float-2 the host runs under systemd without it, so ranked search said "Jev is not
// configured" while the key sat in ~/.config/secrets/typesafe.env (Oct 22). Made-up key, private secrets folder.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rankSearchWithJev, resetJevKey } from "../src/search-ranking";

const dir = mkdtempSync(join(tmpdir(), "jev-key-"));
afterAll(() => resetJevKey());
const candidates = { matches: [{ title: "Seed swap", path: "seed-swap", snippet: "trading seeds", exact: false }, { title: "Shed", path: "shed", snippet: "the latch", exact: false }], completeness: { kind: "complete" as const }, semantic: { status: "lexical" as const } };

test("the key is read from the typesafe secret group when the environment has none", async () => {
  writeFileSync(join(dir, "typesafe.env"), "TYPESAFE_API_KEY=made-up-key\n", { mode: 0o600 });
  let sent = "";
  const fetch = async (_url: string, init: RequestInit) => {
    sent = String((init.headers as Record<string, string>).Authorization);
    return new Response(JSON.stringify({ answers: { candidate_0: { type: "score", score: 1 }, candidate_1: { type: "score", score: 2 } } }));
  };
  resetJevKey();
  const r = await rankSearchWithJev("seeds", candidates, { fetch, env: { WITH_SECRETS_DIR: dir } });
  expect(sent).toBe("Bearer made-up-key");
  expect(r.semantic.status).toBe("ranked");
});

test("with no key anywhere it says where to put one", async () => {
  resetJevKey();
  const r = await rankSearchWithJev("seeds", candidates, { env: { WITH_SECRETS_DIR: join(dir, "none") } });
  expect(r.semantic).toMatchObject({ status: "unavailable" });
  expect((r.semantic as { message: string }).message).toContain("with-secrets --add typesafe TYPESAFE_API_KEY");
});
