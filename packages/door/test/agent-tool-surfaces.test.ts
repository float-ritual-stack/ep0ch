// One set of agent tool definitions, registered by each surface (PIE-720, ADR 0003 §5): the Claude mod and the MCP
// gateway register outline-core's agent-tool-definitions.ts, and a tool on one surface and not the other says why in
// AGENT_TOOL_SURFACES. A tool added to one surface without a definition or a reason fails here, and so does a gap
// that closed while its reason still says it's open.
import { describe, expect, test } from "bun:test";
import { AGENT_TOOL_DEFINITIONS, AGENT_TOOL_SURFACES, describeTool } from "@ep0ch/outline-core/agent-tool-definitions";
import { everyGatewayTool } from "../src/mcp";
import { writeToolDefinitions } from "../src/mcp-writes";
import { BIND_TOOL, COMPONENTS_TOOL, DOOR_TOOLS, OUTLINE_TOOLS, SHOW_TOOL } from "../../claude-mod/hooks/outline-tools";
import { WORK_TOOLS } from "../../claude-mod/hooks/work-tools";

/** What the mod registers in a session with a door (register.ts: show, the work and outline tools, components, bind, door_*). */
const MOD = [SHOW_TOOL, ...WORK_TOOLS, ...OUTLINE_TOOLS, COMPONENTS_TOOL, BIND_TOOL, ...DOOR_TOOLS].map(t => t.name);
const GATEWAY = everyGatewayTool();
const DEFINED = new Set(AGENT_TOOL_DEFINITIONS.map(d => d.name));

describe("each agent tool is defined once and registered by every surface, or says why not", () => {
  for (const [surface, names] of [["mod", MOD], ["gateway", GATEWAY]] as const) {
    test(`every tool the ${surface} registers is defined or listed`, () => {
      expect(names.filter(name => !AGENT_TOOL_SURFACES[name])).toEqual([]);
      expect(new Set(names).size).toBe(names.length);
    });
    test(`the ${surface} registers each tool listed for it, and only those`, () => {
      const expected = Object.entries(AGENT_TOOL_SURFACES).filter(([, on]) => on[surface] === true).map(([name]) => name).sort();
      const registered = names.filter(name => AGENT_TOOL_SURFACES[name]?.[surface] === true).sort();
      expect(registered).toEqual(expected);
      // A tool the surface registers from its own code must not be listed as registered from a definition, nor the reverse.
      for (const name of names) if (AGENT_TOOL_SURFACES[name]?.[surface] === true) expect(DEFINED.has(name)).toBe(true);
    });
  }

  test("a definition one surface lacks has a reason, and a tool both surfaces define themselves has one too", () => {
    for (const definition of AGENT_TOOL_DEFINITIONS) {
      const on = AGENT_TOOL_SURFACES[definition.name];
      expect(on).toBeDefined();
      for (const surface of ["mod", "gateway"] as const) {
        const registered = (surface === "mod" ? MOD : GATEWAY).includes(definition.name);
        if (on![surface] === true) expect(registered).toBe(true);
        else expect(String(on![surface]).length).toBeGreaterThan(10);
      }
    }
  });

  test("a listed gap that both surfaces now register from the definitions is closed: the list says true", () => {
    const stale = Object.entries(AGENT_TOOL_SURFACES).filter(([name, on]) =>
      DEFINED.has(name) && (["mod", "gateway"] as const).some(s => on[s] !== true && String(on[s]).startsWith("not yet") && (s === "mod" ? MOD : GATEWAY).includes(name)));
    expect(stale).toEqual([]);
  });
});

describe("the gateway registers the shared writes from their definitions", () => {
  const outline = { type: "string", description: "The outline" };
  const listed = writeToolDefinitions(outline);
  for (const definition of AGENT_TOOL_DEFINITIONS.filter(d => AGENT_TOOL_SURFACES[d.name]?.gateway === true)) {
    test(`${definition.name}: its arguments, the block it acts on as the gateway's address`, () => {
      const tool = listed.find(t => t.name === definition.name)!;
      expect(tool).toBeDefined();
      const properties = Object.keys(tool.inputSchema.properties).sort();
      const own = Object.keys(definition.properties).filter(key => key !== definition.target);
      expect(properties).toEqual([...own, "uri", "ref", "outline", "call"].filter((k, i, all) => all.indexOf(k) === i).sort());
      expect(tool.inputSchema.required).toEqual(definition.required.filter(key => key !== definition.target));
      // The definition's words, with the block named as the gateway names it.
      expect(tool.description.startsWith(describeTool(definition, { note: "the note (its uri, or ref in `outline`)", parent: "the parent (its uri, or ref in `outline`)" }))).toBe(true);
      expect(tool.description).not.toContain("{note}");
    });
  }
});
