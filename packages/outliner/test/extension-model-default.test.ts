// PIE-1622: a built-in's default model command costs what its prompt is worth. A bare `claude -p` carries the person's
// CLAUDE.md, the checkout's rules, plugins, skills and MCP instructions: 213k tokens a call, measured. The token count
// itself is a walk (the PR's table); this holds the line the count depends on, for any built-in that names a default.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BUILT_INS = join(import.meta.dir, "..", "extensions");

/** Every built-in's config field whose default command runs `claude`. */
function claudeDefaults(): { field: string; argv: string[] }[] {
  return readdirSync(BUILT_INS).flatMap((id) => {
    const file = join(BUILT_INS, id, "extension.json");
    if (!existsSync(file)) return [];
    const properties: Record<string, { default?: unknown }> = JSON.parse(readFileSync(file, "utf8")).configSchema?.properties ?? {};
    return Object.entries(properties).flatMap(([name, schema]) =>
      Array.isArray(schema.default) && schema.default[0] === "claude" ? [{ field: `${id}.${name}`, argv: schema.default as string[] }] : []);
  });
}

/** What each default must say, with the value a flag takes (`undefined`: the flag alone, or any value). */
const ISOLATED: [string, string | undefined][] = [
  ["--safe-mode", undefined], // no CLAUDE.md or rules from the folder it runs in; --setting-sources alone leaves those
  ["--tools", ""],
  ["--setting-sources", ""],
  ["--strict-mcp-config", undefined],
  ["--disable-slash-commands", undefined],
  ["--no-session-persistence", undefined],
  ["--system-prompt", undefined], // in place of Claude Code's own
];

test("the built-ins that name a claude default are the ones this is about", () => {
  expect(claudeDefaults().map((d) => d.field).sort()).toEqual(["asks.answer", "tidy.answer"]);
});

test("a built-in's default claude command sends its prompt and nothing else", () => {
  const missing = claudeDefaults().flatMap(({ field, argv }) => ISOLATED.flatMap(([flag, value]) => {
    const at = argv.indexOf(flag);
    return at < 0 || (value !== undefined && argv[at + 1] !== value) ? [`${field}: ${flag}${value === undefined ? "" : ` ${JSON.stringify(value)}`}`] : [];
  }));
  expect(missing).toEqual([]);
});
