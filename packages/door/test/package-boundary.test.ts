import ts from "typescript";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
  test("outline-core imports only itself and node:path", () => {
    const bad: string[] = [];
    const core = resolve(root, "../outline-core/src");
    for (const f of files(core)) {
      for (const {path: spec} of new Bun.Transpiler({loader: "ts"}).scanImports(readFileSync(f, "utf8"))) {
        const internal = spec.startsWith(".") && resolve(dirname(f), spec).startsWith(core + "/");
        if (!internal && spec !== "node:path") bad.push(`${f}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

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

test("only placement calls the layout landing rule", () => {
  const bypasses: string[] = [];
  for (const file of files(join(root, "src"))) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "landing") {
        let owner: ts.Node | undefined = node.parent;
        while (owner && !ts.isFunctionDeclaration(owner) && !ts.isMethodDeclaration(owner)) owner = owner.parent;
        const name = owner && "name" in owner ? owner.name?.getText(source) : undefined;
        if (file !== join(root, "src/desk/screen-layout.ts") || (name !== "placement" && name !== "landing"))
          bypasses.push(`${file.slice(root.length + 1)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(bypasses).toEqual([]);
});
