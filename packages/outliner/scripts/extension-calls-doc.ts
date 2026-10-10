// The extensions README's call reference (PIE-767), written from the types: src/extension-call-reference.ts names
// each call's request and answer by the service's own types, and this reads them with the TypeScript checker, so the
// README says what the code takes and answers. test/extension-call-reference.test.ts fails when they drift.
//
//   bun scripts/extension-calls-doc.ts           write the README's section again
//   bun scripts/extension-calls-doc.ts --check   exit 1 when the README's section isn't what the types say
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

const ROOT = join(import.meta.dir, "..");
export const REFERENCE_FILE = join(ROOT, "src", "extension-call-reference.ts");
export const README = join(ROOT, "docs", "extensions", "README.md");
const START = "<!-- extension-calls:start (written by scripts/extension-calls-doc.ts from src/extension-call-reference.ts; don't edit by hand) -->";
const END = "<!-- extension-calls:end -->";

const FORMAT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope | ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType;

/** Text for a Markdown table cell: one line, its pipes escaped. */
const cell = (text: string) => text.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
/** A type as written, in a code span (quotes made double again: the checker was asked for single, to stay readable). */
const code = (text: string) => `\`${cell(text.replace(/'/g, '"'))}\``;

function program(): { checker: ts.TypeChecker; source: ts.SourceFile } {
  const config = ts.getParsedCommandLineOfConfigFile(join(ROOT, "tsconfig.json"), {}, {
    ...ts.sys, onUnRecoverableConfigFileDiagnostic: (diagnostic) => { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")); },
  });
  if (!config) throw new Error("tsconfig.json can't be read");
  const built = ts.createProgram({ rootNames: [REFERENCE_FILE], options: { ...config.options, noEmit: true } });
  const source = built.getSourceFile(REFERENCE_FILE);
  if (!source) throw new Error(`${REFERENCE_FILE} isn't in the program`);
  return { checker: built.getTypeChecker(), source };
}

function iface(source: ts.SourceFile, name: string): ts.InterfaceDeclaration {
  const found = source.statements.find((statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === name);
  if (!found) throw new Error(`${name} isn't declared in ${REFERENCE_FILE}`);
  return found;
}

const docOf = (checker: ts.TypeChecker, symbol: ts.Symbol) => cell(ts.displayPartsToString(symbol.getDocumentationComment(checker)));

/** One row per field: its name (`?` when optional), its type, its comment. */
function fieldRows(checker: ts.TypeChecker, type: ts.Type, at: ts.Node): string[] {
  return checker.getPropertiesOfType(type).map((property) => {
    const optional = (property.flags & ts.SymbolFlags.Optional) !== 0;
    const declared = property.valueDeclaration ?? property.declarations?.[0];
    let fieldType = checker.getTypeOfSymbolAtLocation(property, declared ?? at);
    // An optional field's type without the `undefined` the checker adds: the `?` says it.
    if (optional) fieldType = checker.getNonNullableType(fieldType);
    return `| \`${property.name}${optional ? "?" : ""}\` | ${code(checker.typeToString(fieldType, undefined, FORMAT))} | ${docOf(checker, property)} |`;
  });
}

const TABLE_HEAD = ["| Field | Type | |", "|---|---|---|"];

/** The README's call reference, as the types say it. */
export function renderCallReference(): string {
  const { checker, source } = program();
  const out: string[] = [START, ""];
  const calls = iface(source, "ExtensionCallReference");
  for (const member of calls.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;
    const symbol = checker.getSymbolAtLocation(member.name);
    if (!symbol) continue;
    const callType = checker.getTypeAtLocation(member);
    const request = checker.getTypeOfSymbolAtLocation(callType.getProperty("request")!, member);
    const answer = checker.getTypeOfSymbolAtLocation(callType.getProperty("answer")!, member);
    out.push(`#### \`${symbol.name}\``, "", docOf(checker, symbol), "");
    const rows = fieldRows(checker, request, member);
    out.push(...(rows.length ? [...TABLE_HEAD, ...rows] : ["No fields."]), "");
    out.push(`Answers ${code(checker.typeToString(answer, undefined, FORMAT))}.`, "");
  }
  out.push("#### The types they name", "");
  for (const member of iface(source, "ExtensionCallTypes").members) {
    if (!ts.isPropertySignature(member) || !member.name || !member.type) continue;
    const name = (member.name as ts.Identifier).text;
    const type = checker.getTypeFromTypeNode(member.type);
    const declared = type.aliasSymbol ?? type.getSymbol();
    const about = declared ? docOf(checker, declared) : "";
    out.push(`**\`${name}\`**${about ? `: ${about}` : ""}`, "");
    if (type.isUnion() && !(type.flags & ts.TypeFlags.Boolean)) {
      // A union: each of its shapes, as written.
      for (const shape of type.types) out.push(`- ${code(checker.typeToString(shape, undefined, FORMAT | ts.TypeFormatFlags.InTypeAlias))}`);
      // Shapes that are named types are spelled out field by field too.
      for (const shape of type.types) {
        const shapeName = shape.aliasSymbol?.name ?? shape.getSymbol()?.name;
        if (!shapeName || shapeName === "__type") continue;
        out.push("", `*\`${shapeName}\`*`, "", ...TABLE_HEAD, ...fieldRows(checker, shape, member));
      }
      out.push("");
      continue;
    }
    out.push(...TABLE_HEAD, ...fieldRows(checker, type, member), "");
  }
  out.push(END);
  return out.join("\n");
}

/** The README's section as it is now. */
export function writtenCallReference(readme = readFileSync(README, "utf8")): string {
  const start = readme.indexOf(START), end = readme.indexOf(END);
  if (start < 0 || end < start) throw new Error(`${README} has no call reference section (${START} … ${END})`);
  return readme.slice(start, end + END.length);
}

if (import.meta.main) {
  const readme = readFileSync(README, "utf8");
  const written = writtenCallReference(readme);
  const wanted = renderCallReference();
  if (process.argv.includes("--check")) {
    if (written !== wanted) {
      console.error(`${README}'s call reference isn't what the types say: run bun ${join("scripts", "extension-calls-doc.ts")} in ${dirname(README).replace(/\/docs\/extensions$/, "")}`);
      process.exit(1);
    }
  } else {
    writeFileSync(README, readme.replace(written, wanted));
    console.log(written === wanted ? "the call reference is current" : `wrote the call reference in ${README}`);
  }
}
