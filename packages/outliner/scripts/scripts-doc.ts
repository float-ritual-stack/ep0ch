// The scripts reference's generated parts (PIE-982), written from the code: the `tools.*` list from outline-core's one list
// of agent tools, the `view.*` fields from the primitive validator, every `path:line` pointer's line, found again from the symbol
// it sits beside, and a check that each of those symbols still exists. test/scripts-docs.test.ts fails when a table drifts or a
// symbol is gone; a line that only moved is regenerated, never a red build.
//
//   bun scripts/scripts-doc.ts           write the page's generated tables and every pointer's line again
//   bun scripts/scripts-doc.ts --check   exit 1 when the tables drift or a pointer's symbol is gone (a moved line is not drift)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describeTool } from "@ep0ch/outline-core/agent-tool-definitions";
import { SCRIPT_TOOL_DEFINITIONS } from "../src/host-api";
import { PRIMITIVE_FIELDS, PRIMITIVE_TYPES } from "../src/component-primitives";

/** The repository root, which the page's pointers are relative to. */
export const REPO = join(import.meta.dir, "..", "..", "..");
export const SCRIPTS_DOC = join(REPO, "packages", "outliner", "docs", "scripts.md");

const TOOLS_FILE = "packages/outline-core/src/agent-tool-definitions.ts";
const PRIMITIVES_FILE = "packages/outliner/src/component-primitives.ts";
const marks = (name: string) => ({
  start: `<!-- generated:${name}:start (written by packages/outliner/scripts/scripts-doc.ts; don't edit by hand) -->`,
  end: `<!-- generated:${name}:end -->`,
});

const lines = (file: string) => readFileSync(join(REPO, file), "utf8").split("\n");
const cell = (text: string) => text.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");

/** The first sentence of a tool's description, in the words the mod uses for its note. */
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const end = flat.search(/[.:] (?=[A-Z`(])/);
  const sentence = (end === -1 ? flat : flat.slice(0, end + 1)).replace(/:$/, ".");
  return sentence.length <= 150 ? sentence : `${sentence.slice(0, 150).replace(/\s+\S*$/, "")}…`;
}

/** The `tools.*` table: one row per agent tool, in the list's order, each pointing at its definition. */
export function toolsTable(): string {
  const source = lines(TOOLS_FILE);
  const rows = SCRIPT_TOOL_DEFINITIONS.map(definition => {
    const at = source.findIndex(line => line.includes(`name: "${definition.name}"`)) + 1
      || source.findIndex(line => line.includes("name: `outline_proposal_${op}`")) + 1;
    if (!at) throw new Error(`${definition.name} has no definition line in ${TOOLS_FILE}`);
    const args = Object.keys(definition.properties).map(key => definition.required.includes(key) ? `**${key}**` : key).join(", ");
    return `| \`tools.${definition.name}\` | ${definition.writes ? "writes" : "reads"} | ${cell(args)} | ${cell(firstSentence(describeTool(definition)))} | \`${TOOLS_FILE}:${at}\` |`;
  });
  return ["| Tool | Effect | Arguments (**required**) | What it does | Source |", "|---|---|---|---|---|", ...rows].join("\n");
}

/** The `view.*` table: one row per primitive, with the fields its validator accepts (anything else is refused). */
export function viewTable(): string {
  const rows = PRIMITIVE_TYPES.map(type => {
    const at = lines(PRIMITIVES_FILE).findIndex(line => /^\s*case "/.test(line) && line.includes(`"${type}"`)) + 1;
    return `| \`view.${type}\` | ${PRIMITIVE_FIELDS[type].map(field => `\`${field}\``).join(", ")} | \`${PRIMITIVES_FILE}:${at}\` |`;
  });
  return ["| Builder | Fields (anything else is refused) | Source |", "|---|---|---|", ...rows].join("\n");
}

const GENERATED_BLOCKS = { tools: toolsTable, view: viewTable } as const;

/** The page with its generated blocks written from the code. */
export function withGenerated(page: string): string {
  let out = page;
  for (const [name, make] of Object.entries(GENERATED_BLOCKS)) {
    const { start, end } = marks(name);
    const from = out.indexOf(start), to = out.indexOf(end);
    if (from === -1 || to === -1 || to < from) throw new Error(`the page has no ${name} block: add ${start} and ${end} where it goes`);
    out = `${out.slice(0, from + start.length)}\n\n${make()}\n\n${out.slice(to)}`;
  }
  return out;
}

/** A pointer sits beside the entry it names: the entry's own word must be within this many lines of the one it points at. */
const LINES_AROUND_A_POINTER = 2;
const POINTER = /`((?:packages|scripts|docs)\/[\w./-]+):(\d+)`/g;
const IS_PATH = /^(?:packages|scripts|docs)\//;

/** What a pointer needs: the line it should say, or why it can't name one. */
type Resolved = { line: number } | { problem: string };

/**
 * Where the entry a pointer sits beside is now. The pointer is a hint, the symbol is the truth (PIE-1040): a pointer whose
 * entry is still within two lines of the number stays as written; one that moved is found again by its symbol, the
 * occurrence nearest the old number. Only a file or a symbol that is gone is a problem, and it names the symbol.
 */
function resolvePointer(line: string, file: string, at: number): Resolved {
  let source: string[];
  try { source = lines(file); } catch { return { problem: `${file}:${at}: the file isn't there` }; }
  const entry = [...line.matchAll(/`([^`]+)`/g)].map(m => m[1]!).find(span => !IS_PATH.test(span));
  if (!entry) return { problem: `${file}:${at}: no entry named on its line: put the name in a code span before the pointer` };
  const word = entry.replace(/\(.*$/, "").split(/[^\w$]+/).filter(Boolean).at(-1);
  if (!word) return { problem: `${file}:${at}: \`${entry}\` has no word to look for` };
  // `outline_proposal_${op}` is one template for two tools: its stem on the line is enough.
  const templatedStem = word.includes("_") ? word.slice(0, word.lastIndexOf("_") + 1) : "";
  const named = new RegExp(`(?<![\\w$])${word.replace(/[$]/g, "\\$&")}(?![\\w$])`);
  const hit = (text: string) => named.test(text) || (templatedStem.length > 6 && text.includes(templatedStem));
  if (at >= 1 && at <= source.length && hit(source.slice(Math.max(0, at - 1 - LINES_AROUND_A_POINTER), at + LINES_AROUND_A_POINTER).join("\n"))) return { line: at };
  const found = source.flatMap((text, index) => hit(text) ? [index + 1] : []);
  if (!found.length) return { problem: `${file}:${at}: \`${entry}\` isn't in the file any more; search ${file} for "${word}", and rename the entry or drop the row` };
  // Prefer where the word is declared (`const read =`, `function read(`, `case "read"`, `name: "read"`) over a line that uses it.
  const w = word.replace(/[$]/g, "\\$&");
  const declares = new RegExp(`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:(?:const|let|var|function\\*?|class|type|interface|enum)\\s+${w}(?![\\w$])|(?:case\\s+)?["'\`]?${w}["'\`]?\\s*[:(=])|name:\\s*["'\`]${w}["'\`]`);
  const declared = found.filter(n => declares.test(source[n - 1]!));
  const nearest = (from: number[]) => from.reduce((best, n) => Math.abs(n - at) < Math.abs(best - at) ? n : best);
  return { line: nearest(declared.length ? declared : found) };
}

/** Every pointer in the page whose file or symbol is gone, each naming the symbol. A line that merely moved is not one. */
export function stalePointers(page: string): string[] {
  const problems: string[] = [];
  for (const line of page.split("\n")) {
    for (const [, file, number] of line.matchAll(POINTER) as Iterable<[string, string, string]>) {
      const found = resolvePointer(line, file, Number(number));
      if ("problem" in found) problems.push(found.problem);
    }
  }
  return problems;
}

/** The page with each pointer's line written from where its symbol is now (a pointer that can't be found is left as it is). */
export function withPointers(page: string): string {
  return page.split("\n").map(line => line.replace(POINTER, (whole, file: string, number: string) => {
    const found = resolvePointer(line, file, Number(number));
    return "line" in found ? `\`${file}:${found.line}\`` : whole;
  })).join("\n");
}

/** The page with every pointer's line number blanked: what the test compares, since a moved line is regenerated, never a failure. */
export const withoutLines = (page: string): string => page.replace(POINTER, "`$1:#`");

/** The page as the generator writes it: the tables from the code, then every pointer's line from its symbol. */
export function regenerated(page: string): string { return withPointers(withGenerated(page)); }

if (import.meta.main) {
  const page = readFileSync(SCRIPTS_DOC, "utf8");
  const fresh = regenerated(page);
  if (process.argv.includes("--check")) {
    const stale = stalePointers(fresh);
    if (withoutLines(fresh) !== withoutLines(page)) console.error("The page's generated tables are out of date: run `bun packages/outliner/scripts/scripts-doc.ts` and commit the result.");
    for (const problem of stale) console.error(problem);
    process.exit(withoutLines(fresh) !== withoutLines(page) || stale.length ? 1 : 0);
  }
  writeFileSync(SCRIPTS_DOC, fresh);
  for (const problem of stalePointers(fresh)) console.error(problem);
}
