// The shapes an extension author writes against, written out from outline-core's own types: an action's row
// (action-row.ts), a list's rows (list-row.ts), the view primitives (primitive.ts) and a page's parts (note-page.ts).
// `bun scripts/extension-types.ts` writes fixtures/extension-types.d.ts and fixtures/primitives.json; a test makes
// them again and compares, so neither is edited by hand and neither falls behind the source.
import { join } from "node:path";
import ts from "typescript";
import { PAGE_PRIMITIVE_FIELDS } from "../src/note-page";
import { PRIMITIVE_FIELDS, PRIMITIVE_TYPES, TONES } from "../src/primitive";

const root = join(import.meta.dir, "..");
/** The modules written out whole; of any other module, only the declarations these name (and what those name). */
export const AUTHOR_MODULES = ["action-row", "list-row", "primitive"] as const;
const HEAD = `// Made by packages/outline-core/scripts/extension-types.ts from outline-core's source; never edited by hand
// (test/extension-types.test.ts makes it again and compares). For an extension's author: an action's row
// (action-row), a list's rows (list-row) and the view primitives (primitive), whole, then the declarations of other
// modules those name.\n`;

/** Every module's declarations, as the compiler writes them. */
function declarations(): Map<string, ts.SourceFile> {
  const out = new Map<string, ts.SourceFile>();
  const options: ts.CompilerOptions = { declaration: true, emitDeclarationOnly: true, removeComments: false, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] };
  const program = ts.createProgram(AUTHOR_MODULES.map(name => join(root, "src", `${name}.ts`)), options);
  program.emit(undefined, (file, text) => { const m = /([\w-]+)\.d\.ts$/.exec(file); if (m) out.set(m[1]!, ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true)); });
  return out;
}

const declared = (s: ts.Statement): string[] =>
  ts.isVariableStatement(s) ? s.declarationList.declarations.flatMap(d => (ts.isIdentifier(d.name) ? [d.name.text] : []))
  : (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && s.name ? [s.name.text] : [];
function named(node: ts.Node, into: Set<string>): Set<string> {
  if (ts.isIdentifier(node)) into.add(node.text);
  node.forEachChild(child => { named(child, into); });
  return into;
}

/** The one file: each module as `declare module "@ep0ch/outline-core/<name>"`, the authors' first, then what they name of the others. */
export function extensionTypes(): string {
  const all = declarations();
  // What is written of each module: every declaration of an author's, else the ones asked for by name.
  const kept = new Map<string, Set<string> | "all">(AUTHOR_MODULES.map(name => [name, "all"]));
  const order: string[] = [...AUTHOR_MODULES];
  const want = (module: string, name: string): boolean => {
    if (!all.has(module)) return false;
    const have = kept.get(module);
    if (have === "all" || have?.has(name)) return false;
    if (!have) { kept.set(module, new Set([name])); order.push(module); } else have.add(name);
    return true;
  };
  const read = (module: string) => {
    const file = all.get(module)!, keep = kept.get(module)!;
    const imports = new Map<string, { from: string; name: string }>();
    for (const s of file.statements) {
      if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !s.importClause?.namedBindings || !ts.isNamedImports(s.importClause.namedBindings)) continue;
      const from = s.moduleSpecifier.text.replace(/^\.\//, "");
      for (const e of s.importClause.namedBindings.elements) imports.set(e.name.text, { from, name: (e.propertyName ?? e.name).text });
    }
    // A name the module hands on from another (`export { A as B } from "./x"`).
    const passed = new Map<string, { from: string; name: string }>();
    for (const s of file.statements) {
      if (!ts.isExportDeclaration(s) || !s.moduleSpecifier || !ts.isStringLiteral(s.moduleSpecifier) || !s.exportClause || !ts.isNamedExports(s.exportClause)) continue;
      const from = s.moduleSpecifier.text.replace(/^\.\//, "");
      for (const e of s.exportClause.elements) passed.set(e.name.text, { from, name: (e.propertyName ?? e.name).text });
    }
    const body = file.statements.filter(s => !ts.isImportDeclaration(s) && !ts.isExportDeclaration(s));
    const shown = () => body.filter(s => keep === "all" || declared(s).some(name => keep.has(name)));
    const handed = () => [...passed].filter(([name]) => keep === "all" || keep.has(name));
    return { file, imports, body, shown, handed };
  };
  // To a fixpoint: a declaration kept names others, of its own module or another's.
  for (let moved = true; moved;) {
    moved = false;
    for (const module of [...order]) {
      const { file, imports, body, shown, handed } = read(module), own = new Set(body.flatMap(declared));
      for (const [, from] of handed()) moved = want(from.from, from.name) || moved;
      for (const s of shown()) {
        for (const name of named(s, new Set())) {
          const from = imports.get(name);
          if (from) moved = want(from.from, from.name) || moved;
          else if (own.has(name) && kept.get(module) !== "all") moved = want(module, name) || moved;
        }
        for (const m of file.text.slice(s.getFullStart(), s.end).matchAll(/import\("\.\/([\w-]+)"\)\.(\w+)/g)) moved = want(m[1]!, m[2]!) || moved;
      }
    }
  }
  const blocks = order.map(module => {
    const { file, imports, shown, handed } = read(module), statements = shown();
    const used = new Set(statements.flatMap(s => [...named(s, new Set())]));
    const by = new Map<string, string[]>();
    for (const [local, from] of imports) if (used.has(local) && all.has(from.from)) by.set(from.from, [...(by.get(from.from) ?? []), from.name === local ? local : `${from.name} as ${local}`]);
    const lines = [
      ...[...by].sort(([a], [b]) => a.localeCompare(b)).map(([from, names]) => `import type { ${names.sort().join(", ")} } from "@ep0ch/outline-core/${from}";`),
      ...handed().filter(([, from]) => all.has(from.from)).map(([name, from]) => `export type { ${from.name === name ? name : `${from.name} as ${name}`} } from "@ep0ch/outline-core/${from.from}";`),
      ...statements.map(s => file.text.slice(s.getFullStart(), s.end).replace(/^\n+/, "").replace(/import\("\.\/([\w-]+)"\)/g, 'import("@ep0ch/outline-core/$1")').replace(/^export declare /gm, "export ").replace(/^declare /gm, "")),
    ].join("\n");
    return `declare module "@ep0ch/outline-core/${module}" {\n${lines.split("\n").map(line => (line ? `  ${line}` : line)).join("\n")}\n}\n`;
  });
  return `${HEAD}\n${blocks.join("\n")}`;
}

/** The primitive types and each one's fields, as a client checks its builders against. */
export function primitivesFixture(): string {
  return `${JSON.stringify({
    about: "Every view primitive type and the fields it takes (outline-core's primitive.ts), and the types a page's parts add (note-page.ts). Made from the source; never edited by hand.",
    by: "packages/outline-core/scripts/extension-types.ts",
    types: PRIMITIVE_TYPES, fields: PRIMITIVE_FIELDS, tones: TONES, page: PAGE_PRIMITIVE_FIELDS,
  }, null, 2)}\n`;
}

if (import.meta.main) {
  await Bun.write(join(root, "fixtures/extension-types.d.ts"), extensionTypes());
  await Bun.write(join(root, "fixtures/primitives.json"), primitivesFixture());
}
