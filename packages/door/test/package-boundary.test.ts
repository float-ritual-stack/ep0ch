import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// The door reaches the other packages only through their public faces: all of outline-core (pure, shared), and
// what the outliner declares in its package.json `exports`. Reaching into `@ep0ch/outliner/src/...` or across with
// a relative path couples the door to the outliner's internals, the line the kernel work draws on.
const root = resolve(import.meta.dir, "..");
const outlinerExports = Object.keys(JSON.parse(readFileSync(resolve(root, "../outliner/package.json"), "utf8")).exports ?? {})
  .map(k => "@ep0ch/outliner" + k.slice(1));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (n === "node_modules") return [];
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("package boundary", () => {
  test("the door imports other packages only through outline-core and the outliner's declared exports", () => {
    const bad: string[] = [];
    for (const dir of ["src", "scripts", "ext"]) {
      let list: string[] = [];
      try { list = files(join(root, dir)); } catch { continue; }
      for (const f of list) {
        for (const m of readFileSync(f, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
          const spec = m[1]!;
          const ok = spec.startsWith("@ep0ch/outline-core") || outlinerExports.includes(spec);
          const crossing = spec.startsWith("@ep0ch/") || /(^|\/)\.\.\/\.\.\/(outliner|outline-core|claude-mod)\//.test(spec);
          if (crossing && !ok) bad.push(`${f.slice(root.length + 1)}: ${spec}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
