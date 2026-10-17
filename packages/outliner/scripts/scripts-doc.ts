// The scripts reference's generated parts (PIE-982), written from the code: the `tools.*` list from outline-core's one list
// of agent tools, the `view.*` fields from the primitive validator, and a check that every `path:line` pointer in the
// page still lands on the thing it names. test/scripts-docs.test.ts fails when any of them drift.
//
//   bun scripts/scripts-doc.ts           write the page's generated tables again
//   bun scripts/scripts-doc.ts --check   exit 1 when the page isn't what the code says (also lists stale pointers)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_TOOL_DEFINITIONS, describeTool } from "@ep0ch/outline-core/agent-tool-definitions";
import { PRIMITIVE_TYPES } from "../src/component-primitives";

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
  const rows = AGENT_TOOL_DEFINITIONS.map(definition => {
    const at = source.findIndex(line => line.includes(`name: "${definition.name}"`)) + 1
      || source.findIndex(line => line.includes("name: `outline_proposal_${op}`")) + 1;
    if (!at) throw new Error(`${definition.name} has no definition line in ${TOOLS_FILE}`);
    const args = Object.keys(definition.properties).map(key => definition.required.includes(key) ? `**${key}**` : key).join(", ");
    return `| \`tools.${definition.name}\` | ${definition.writes ? "writes" : "reads"} | ${cell(args)} | ${cell(firstSentence(describeTool(definition)))} | \`${TOOLS_FILE}:${at}\` |`;
  });
  return ["| Tool | Effect | Arguments (**required**) | What it does | Source |", "|---|---|---|---|---|", ...rows].join("\n");
}

/** The fields a primitive's validator accepts, read from its `only(node, [...])` line. */
export function viewFields(type: string): { fields: string[]; line: number } {
  const source = lines(PRIMITIVES_FILE);
  const at = source.findIndex(line => line.trim() === `case "${type}":` || line.trim() === `case "${type}": {`);
  if (at === -1) throw new Error(`${type} has no case in ${PRIMITIVES_FILE}`);
  for (let i = at; i < at + 4; i++) {
    const found = /only\(node, \[([^\]]*)\]/.exec(source[i] ?? "");
    if (found) return { fields: [...found[1]!.matchAll(/"([^"]+)"/g)].map(m => m[1]!).filter(field => field !== "type"), line: at + 1 };
  }
  throw new Error(`${type}'s case in ${PRIMITIVES_FILE} has no only(node, [...]) line`);
}

/** The `view.*` table: one row per primitive, with the fields its validator accepts (anything else is refused). */
export function viewTable(): string {
  const rows = PRIMITIVE_TYPES.map(type => {
    const { fields, line } = viewFields(type);
    return `| \`view.${type}\` | ${fields.map(field => `\`${field}\``).join(", ")} | \`${PRIMITIVES_FILE}:${line}\` |`;
  });
  return ["| Builder | Fields (anything else is refused) | Source |", "|---|---|---|", ...rows].join("\n");
}

const GENERATED = { tools: toolsTable, view: viewTable } as const;

/** The page with its generated blocks written from the code. */
export function withGenerated(page: string): string {
  let out = page;
  for (const [name, make] of Object.entries(GENERATED)) {
    const { start, end } = marks(name);
    const from = out.indexOf(start), to = out.indexOf(end);
    if (from === -1 || to === -1 || to < from) throw new Error(`the page has no ${name} block: add ${start} and ${end} where it goes`);
    out = `${out.slice(0, from + start.length)}\n\n${make()}\n\n${out.slice(to)}`;
  }
  return out;
}

/** What a pointer in the page must still show: the entry's name, within a few lines of the one it points at. */
const NEAR = 4;
const POINTER = /`((?:packages|scripts|docs)\/[\w./-]+):(\d+)`/g;

/**
 * Every `path:line` pointer in the page that no longer lands on the entry it sits beside: the file is gone, the line is
 * past its end, or the entry's own name (the first code span on the pointer's line of the page, or its last word) isn't
 * within a few lines of it. Each problem says which pointer and how to find the new line.
 */
export function stalePointers(page: string): string[] {
  const problems: string[] = [];
  for (const line of page.split("\n")) {
    for (const match of line.matchAll(POINTER)) {
      const [, file, number] = match as unknown as [string, string, string];
      const at = Number(number);
      let source: string[];
      try { source = lines(file); } catch { problems.push(`${file}:${at}: the file isn't there`); continue; }
      if (at < 1 || at > source.length) { problems.push(`${file}:${at}: the file has ${source.length} lines`); continue; }
      const entry = [...line.matchAll(/`([^`]+)`/g)].map(m => m[1]!).find(span => !/^(?:packages|scripts|docs)\//.test(span));
      if (!entry) continue;
      const word = entry.replace(/\(.*$/, "").split(/[^\w$]+/).filter(Boolean).at(-1);
      if (!word) continue;
      const near = source.slice(at - 1, at - 1 + NEAR).join("\n");
      const stem = word.includes("_") ? word.slice(0, word.lastIndexOf("_") + 1) : "";
      if (!(stem.length > 6 && near.includes(stem)) && !new RegExp(`(?<![\\w$])${word.replace(/[$]/g, "\\$&")}(?![\\w$])`).test(near)) problems.push(`${file}:${at}: \`${entry}\` isn't there any more; search the file for "${word}" and write the line it is on`);
    }
  }
  return problems;
}

if (import.meta.main) {
  const page = readFileSync(SCRIPTS_DOC, "utf8");
  const fresh = withGenerated(page);
  if (process.argv.includes("--check")) {
    const stale = stalePointers(fresh);
    if (fresh !== page) console.error("The page's generated tables are out of date: run `bun packages/outliner/scripts/scripts-doc.ts` and commit the result.");
    for (const problem of stale) console.error(problem);
    process.exit(fresh !== page || stale.length ? 1 : 0);
  }
  writeFileSync(SCRIPTS_DOC, fresh);
  for (const problem of stalePointers(fresh)) console.error(problem);
}
