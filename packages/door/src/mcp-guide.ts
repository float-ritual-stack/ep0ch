// What the MCP gateway says before any tool is called (PIE-721), so an agent that reaches an outline only through MCP
// (claude.ai, Codex, ChatGPT, a cloud session) learns what an outline holds without a skill installed or a person
// reminding it:
//
//   instructions    outline-core's agentGuide over the built-in components, each group's ids on a line (Claude Code
//                   reads at most 4,096 characters of a server's instructions), with the gateway's own tool lines.
//   _meta           the core tools carry `anthropic/alwaysLoad`, so Claude Code lists them up front instead of behind
//                   tool search; the rest wait there, found by the words the instructions use.
//   prompts         the skills this checkout ships (the door's `skills/`, as `ep0ch --skill` lists them), each a prompt
//   resources       and an `ep0ch://skills/<name>` resource: the same SKILL.md a Claude Code session reads.
//   write answers   `warnings` (what to fix before calling the write done: references, figures, the house rules
//                   measured), `components` and the `next` check (what the outliner's agent tools found in the text
//                   written) lifted beside `said`, where an agent reads, instead of only inside `detail`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { agentGuide } from "@ep0ch/outline-core/agent-guide";
import { UP_FRONT_TOOLS } from "@ep0ch/outline-core/agent-tool-definitions";
import { BUILTIN_COMPONENT_SCHEMAS } from "@ep0ch/outline-core/component-schema";
import { skillRoots, skillsIn, type Skill } from "./skills";

/** The gateway's tool lines in the guide: how to orient, where an outline's own components are, where the skills are. */
export const GATEWAY_GUIDE_TOOLS = [
  "- Orient first: `list_outlines` names each outline and your access to it; `outline_query` with `updated >= -1d NOT type=peer-message`, sort `updated desc` and `fold: true` says what changed lately. Pass one `call` id on every request.",
  "- On note write tools, pass `persona: \"loki\"` when an agent other than the connector's owner writes through it. The receipt's `by` says who was recorded (persona and client). Omit to keep the connection's mapping; principal and access, including a named path's cap, stay the same. To follow a queued write, pass the same persona to `outline_write_status`.",
  "- Each outline adds its own components (its heading styles, callout types and extensions' components): `outline_components` with `outline` lists them. A write answers with the `components` the note now holds, its `warnings` and the `next` check; `outline_read` reads it back.",
  "- To make the outline do something new (a button, a rule, a script, an extension), use the ep0ch-extend skill (`ep0ch://skills/ep0ch-extend`); references: `ep0ch://docs/scripts` and `ep0ch://docs/extensions`.",
  "- The skills (ep0ch-outline: working in someone's outline, and the rest) are this server's prompts, and resources at `ep0ch://skills/<name>`.",
];

/** Claude Code reads at most this much of a server's instructions (CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH changes it). */
export const INSTRUCTIONS_MAX = 4096;

let instructions: string | undefined;
/** The gateway's `instructions`: built once, from the built-in components; each outline's own are `outline_components`'. */
export const gatewayInstructions = (): string =>
  (instructions ??= agentGuide(BUILTIN_COMPONENT_SCHEMAS, { index: "names", tools: GATEWAY_GUIDE_TOOLS, scope: "the built-ins; each outline adds its own" }));

/** A tool as `tools/list` lists it, with `anthropic/alwaysLoad` when it is one of outline-core's UP_FRONT_TOOLS. */
export const withLoadHint = <T extends { name: string }>(tool: T): T | T & { _meta: Record<string, unknown> } =>
  UP_FRONT_TOOLS.includes(tool.name) ? { ...tool, _meta: { "anthropic/alwaysLoad": true } } : tool;

export const SKILL_URI = /^ep0ch:\/\/skills\/([a-z0-9][a-z0-9-]*)$/;
let skills: Skill[] | undefined;
/** The door's own skills, the first folder `ep0ch --skill` lists (`skillRoots`), read once: a deploy restarts the gateway. */
export const gatewaySkills = (): Skill[] => (skills ??= skillsIn(skillRoots(resolve(import.meta.dir, ".."), null, false)));

/** A SKILL.md without its frontmatter. */
const skillText = (s: Skill) => readFileSync(s.path, "utf8").replace(/^---\n[\s\S]*?\n---\n+/, "");

/** `prompts/list`: each skill a prompt, its description its frontmatter's. */
export const skillPrompts = (skills: readonly Skill[]) => skills.map(s => ({ name: s.name, title: s.name, description: s.description }));

/** `prompts/get`: the skill's text as one user message, or null for a name that isn't a skill. */
export function skillPrompt(skills: readonly Skill[], name: unknown): { description: string; messages: { role: "user"; content: { type: "text"; text: string } }[] } | null {
  const s = skills.find(k => k.name === name);
  return s ? { description: s.description, messages: [{ role: "user", content: { type: "text", text: skillText(s) } }] } : null;
}

/** The skills as `resources/list` entries. */
export const skillResources = (skills: readonly Skill[]) =>
  skills.map(s => ({ uri: `ep0ch://skills/${s.name}`, name: s.name, title: `Skill: ${s.name}`, description: s.description, mimeType: "text/markdown" }));

/** `resources/read` of an `ep0ch://skills/<name>` URI, or null for any other. */
export function skillResource(skills: readonly Skill[], uri: unknown): { contents: { uri: string; mimeType: string; text: string }[] } | null {
  const m = typeof uri === "string" && uri.trim().startsWith("ep0ch://skills/") ? SKILL_URI.exec(uri.trim()) : null;
  const s = m ? skills.find(k => k.name === m[1]) : undefined;
  return s ? { contents: [{ uri: `ep0ch://skills/${s.name}`, mimeType: "text/markdown", text: skillText(s) }] } : null;
}

/**
 * What a write's `detail` says about the text it wrote (the agent tools' `warnings` and `components`), to sit beside
 * `said`, with a clause for `said` when there are warnings: nothing when it says nothing.
 */
export function writeReading(detail: unknown): { fields: { components?: string[]; warnings?: string[]; figures?: string[]; next?: string }; said: string } {
  const d = detail && typeof detail === "object" ? detail as Record<string, unknown> : {};
  const list = (v: unknown) => (Array.isArray(v) && v.every(x => typeof x === "string") && v.length ? v as string[] : undefined);
  const components = list(d.components), warnings = list(d.warnings), figures = list(d.figures);
  const next = typeof d.next === "string" && d.next ? d.next : undefined;
  return {
    fields: { ...(components ? { components } : {}), ...(warnings ? { warnings } : {}), ...(figures ? { figures } : {}), ...(next ? { next } : {}) },
    said: (warnings ? `; ${warnings.length} to fix before you call this done (warnings): saved as written, fix ${warnings.length === 1 ? "it" : "them"} now` : "")
      + (next ? `; next: ${next}` : ""),
  };
}
