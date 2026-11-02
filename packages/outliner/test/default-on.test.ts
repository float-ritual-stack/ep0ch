// Default-on built-ins are tried one by one (PIE-1519): a built-in whose manifest is refused is named on stderr and
// left out, and the ones after it are still put in place. The built-ins here are made up, in a temp folder.
import { afterEach, expect, spyOn, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDefaultOn } from "../src/extension-install";
import { BUILT_IN_EXTENSIONS } from "../src/extension-registry";

const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test("a default-on built-in that is refused is named, and the default-on built-ins after it are still installed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "default-on-"));
  temps.push(dir);
  const builtIns = join(dir, "built-ins"), user = join(dir, "user-extensions");
  mkdirSync(user, { recursive: true });
  // First in order: a manifest that declares nothing, which the loader refuses.
  mkdirSync(join(builtIns, "aaa-hollow"), { recursive: true });
  writeFileSync(join(builtIns, "aaa-hollow", "extension.json"), JSON.stringify({ contract: 2, id: "aaa-hollow", version: 1, name: "Hollow", description: "Declares nothing", defaultOn: true }));
  // After it: a working one (moon, made default-on here).
  cpSync(join(BUILT_IN_EXTENSIONS, "moon"), join(builtIns, "zzz-moon"), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(builtIns, "zzz-moon", "extension.json"), "utf8"));
  writeFileSync(join(builtIns, "zzz-moon", "extension.json"), JSON.stringify({ ...manifest, id: "zzz-moon", defaultOn: true }));

  const said: string[] = [];
  const err = spyOn(console, "error").mockImplementation((...args: unknown[]) => { said.push(args.map(String).join(" ")); });
  try {
    expect(await ensureDefaultOn(user, [user], builtIns)).toEqual(["zzz-moon"]);
  } finally { err.mockRestore(); }
  expect(existsSync(join(user, "zzz-moon", "extension.json"))).toBe(true);
  expect(existsSync(join(user, "aaa-hollow", "extension.json"))).toBe(false);
  expect(said).toHaveLength(1);
  expect(said[0]).toMatch(/default-on extension aaa-hollow: .*declares nothing/);
});
