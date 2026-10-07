// The scripts that run a door or the suites on scratch settings must not reach the person's machines or settings (PIE-634).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const scripts = join(import.meta.dir, "../../../scripts"), doorScripts = join(import.meta.dir, "../scripts");

describe("scripts/box-test", () => {
  test("a trailing --on or --ref with no value is refused (exit 2), never a loop", () => {
    for (const flag of ["--on", "--ref"]) {
      const r = Bun.spawnSync([join(scripts, "box-test"), flag], { stdout: "pipe", stderr: "pipe", timeout: 10_000 });
      expect({ flag, code: r.exitCode, said: r.stderr.toString().includes(`${flag} takes`) }).toEqual({ flag, code: 2, said: true });
    }
  });
});

describe("packages/door/scripts/try-it.sh", () => {
  test("a --copy door is on this machine whatever EP0CH_MACHINE or a .ep0ch says: it clears the setting and passes --here", () => {
    const text = readFileSync(join(doorScripts, "try-it.sh"), "utf8");
    const launch = text.split("\n").filter(l => l.includes("EP0CH_OUTLINES=\"$tmp/outlines\"") && l.includes("bun src/main.ts"));
    expect(launch).toHaveLength(1);
    expect(launch[0]).toContain("EP0CH_MACHINE=");
    expect(launch[0]).toContain("--here");
    // Its private host and the showcase's too.
    expect(text).toContain("-u EP0CH_MACHINE");
    expect(text.split("\n").filter(l => l.includes("bun src/main.ts") && l.includes("EP0CH_SOCKET=") && !l.includes("EP0CH_MACHINE="))).toEqual([]);
  });
});
