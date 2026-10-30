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

test("only placement applies note opens", () => {
  const bypasses: string[] = [];
  const paths = files(join(root, "src"));
  const program = ts.createProgram(paths, { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true });
  const checker = program.getTypeChecker();
  for (const file of paths) {
    const source = program.getSourceFile(file)!;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        let owner: ts.Node | undefined = node.parent;
        while (owner && !ts.isFunctionDeclaration(owner) && !ts.isMethodDeclaration(owner) && !ts.isPropertyAssignment(owner)) owner = owner.parent;
        const name = owner && "name" in owner ? owner.name?.getText(source) : undefined;
        const declaration = checker.getResolvedSignature(node)?.declaration;
        const declaredIn = declaration?.getSourceFile().fileName ?? "";
        const method = declaration && "name" in declaration ? (declaration.name as ts.Node | undefined)?.getText() : undefined;
        // Placement's own landing, by where it's declared: a form's landing (the words for where its entries go) is another function.
        const landing = ts.isIdentifier(node.expression) && node.expression.text === "landing" && declaredIn.endsWith("/desk/screen-layout.ts");
        const legacy = ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "openNewIn";
        const hold = method === "hold" && /\/(?:desk\/panes|river\/column)\.ts$/.test(declaredIn);
        const take = method === "take" && declaredIn.endsWith("/desk/tile-kinds.ts");
        // Kind effects, startup restoration and selection previews are not new opens.
        const effect = file.endsWith("/desk/builtin-tiles.ts") && (name === "take" || name === "start")
          || file.endsWith("/river/column.ts") && (name === "take" || name === "host")
          || file.endsWith("/desk/desk.ts") && name === "previewIntoPane"
          || file.endsWith("/showcase/showcase.ts") && name === "stage"
          || file.endsWith("/hub/welcome.ts") && name === "load";
        const allowed = landing ? file.endsWith("/desk/screen-layout.ts") && (name === "placement" || name === "landing")
          : file.endsWith("/desk/desk.ts") && name === "applyPlacement" || effect;
        if ((landing || legacy || hold || take) && !allowed)
          bypasses.push(`${file.slice(root.length + 1)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${method ?? node.expression.getText(source)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(bypasses).toEqual([]);
}, 30_000);
