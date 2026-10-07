// PIE-596: the art packs are optional. With EP0CH_PACKS naming a folder that has none, the door's art screens draw
// without art (the menu as its help, the bulletin saying where it looked) and nothing throws.
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("with no art packs, the menu, logon, file areas, bulletin and the desk's bulletin tile draw, and the bulletin's keys work", () => {
  const empty = mkdtempSync(join(tmpdir(), "ep0ch-no-packs-"));
  const r = Bun.spawnSync(["bun", join(import.meta.dir, "fixtures/no-packs-draw.ts")], { env: { ...process.env, EP0CH_PACKS: empty }, stdout: "pipe", stderr: "pipe" });
  expect(r.stderr.toString()).toBe("");
  expect(r.exitCode).toBe(0);
  const out = JSON.parse(r.stdout.toString()) as Record<string, string>;
  expect(out.menu).toContain("Bulletin");
  expect(out.logon).toContain("CONNECT");
  expect(out.files).toContain("FILE AREA 1");
  expect(out.bulletin).toContain(`no art packs in ${empty}`);
  expect(out.bulletin).toContain("ep0ch doctor");
  expect(out.pane).toContain("art packs not found");
});
