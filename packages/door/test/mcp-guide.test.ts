// PIE-721: what the MCP gateway says before any tool is called, so an agent that reaches an outline only through MCP
// learns what an outline holds: instructions built from the components, the core tools listed up front, the skills as
// prompts and resources, and a write's warnings and components beside `said`. Scratch service only; fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BUILTIN_COMPONENT_SCHEMAS } from "@ep0ch/outline-core/component-schema";
import { mcpCommand } from "../src/mcp";
import { UP_FRONT_TOOLS } from "@ep0ch/outline-core/agent-tool-definitions";
import { gatewayInstructions, gatewaySkills, INSTRUCTIONS_MAX, writeReading } from "../src/mcp-guide";
import { SocketBoard } from "../src/socket";
import { outliner, Scratch } from "./scratch";

interface RpcResponse { id: string | number | null; result?: any; error?: { message?: string } }

const linesOf = (lines: string[]) => (async function* () { for (const line of lines) yield line; })();

describe("the gateway's guide, alone", () => {
  test("instructions: the house lines and every built-in component's id, inside what Claude Code reads", () => {
    const said = gatewayInstructions();
    expect(said.length).toBeLessThan(INSTRUCTIONS_MAX);
    expect(said).toStartWith("# What an ep0ch outline can hold\n");
    for (const s of BUILTIN_COMPONENT_SCHEMAS) expect(said).toContain(s.id);
    expect(said).toContain("outline_components");
    expect(said).toContain("ep0ch://skills/<name>");
  });

  test("the shipped skills are found, ep0ch-outline among them", () => {
    expect(gatewaySkills().map(s => s.name)).toContain("ep0ch-outline");
  });

  test("a write's reading: its warnings, components and next check lifted, said in a clause; nothing when it says nothing", () => {
    expect(writeReading({ id: "x", components: ["graph-stat"], warnings: ["a", "b"] })).toEqual({
      fields: { components: ["graph-stat"], warnings: ["a", "b"] },
      said: "; 2 to fix before you call this done (warnings): saved as written, fix them now",
    });
    expect(writeReading({ id: "x" })).toEqual({ fields: {}, said: "" });
    expect(writeReading({ id: "x", next: "read it as drawn: ep0ch show x" })).toEqual({
      fields: { next: "read it as drawn: ep0ch show x" },
      said: "; next: read it as drawn: ep0ch show x",
    });
    expect(writeReading(undefined)).toEqual({ fields: {}, said: "" });
  });
});

describe.skipIf(!outliner)("the gateway over stdio", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let parent = "";
  const oldEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    parent = (await board.request<{ id: string }>("create", { parentId: null, text: "Garden plans", author: "agent" })).id;
    for (const [k, v] of Object.entries(scratch.env)) { oldEnv[k] = process.env[k]; process.env[k] = v; }
    await board.configureMcpAccess("full");
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    for (const [k, v] of Object.entries(oldEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }, 20_000);

  const ask = async (requests: object[]): Promise<RpcResponse[]> => {
    const out: string[] = [];
    const code = await mcpCommand(["mcp"], { input: linesOf(requests.map(r => JSON.stringify(r))), write: line => out.push(line), err: line => out.push(`ERR ${line}`) });
    expect(code).toBe(0);
    return out.map(line => JSON.parse(line) as RpcResponse);
  };

  test("initialize carries the instructions and offers prompts; the core tools load up front; the skills are prompts and resources", async () => {
    const [init, list, prompts, prompt, missing, resources, resource] = await ask([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fictional-chat", version: "1" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "prompts/list" },
      { jsonrpc: "2.0", id: 4, method: "prompts/get", params: { name: "ep0ch-outline" } },
      { jsonrpc: "2.0", id: 5, method: "prompts/get", params: { name: "no-such-skill" } },
      { jsonrpc: "2.0", id: 6, method: "resources/list" },
      { jsonrpc: "2.0", id: 7, method: "resources/read", params: { uri: "ep0ch://skills/ep0ch-outline" } },
    ]);
    expect(init!.result.instructions).toBe(gatewayInstructions());
    expect(init!.result.capabilities.prompts).toEqual({});

    const tools = list!.result.tools as { name: string; _meta?: Record<string, unknown> }[];
    for (const t of tools) expect(!!t._meta?.["anthropic/alwaysLoad"]).toBe(UP_FRONT_TOOLS.includes(t.name));
    expect(tools.find(t => t.name === "outline_read")?._meta).toEqual({ "anthropic/alwaysLoad": true });
    expect(tools.find(t => t.name === "outline_trash")?._meta).toBeUndefined();

    expect(prompts!.result.prompts).toContainEqual(expect.objectContaining({ name: "ep0ch-outline", description: expect.stringContaining("outline") }));
    const text = prompt!.result.messages[0].content.text as string;
    expect(text).toStartWith("# ep0ch-outline");
    expect(text).not.toContain("\nname: ep0ch-outline\n");
    expect(missing!.error?.message).toContain("No prompt \"no-such-skill\"");
    expect(resources!.result.resources).toContainEqual(expect.objectContaining({ uri: "ep0ch://skills/ep0ch-outline", mimeType: "text/markdown" }));
    expect(resource!.result.contents[0].text).toBe(text);
  });

  test("agents can discover and read the extension references without a checkout", async () => {
    const [init, listed, ...read] = await ask([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "resources/list" },
      ...["scripts", "extensions"].map((name, i) => ({ jsonrpc: "2.0", id: i + 3, method: "resources/read", params: { uri: `ep0ch://docs/${name}` } })),
    ]);
    expect(init!.result.instructions).toContain("ep0ch-extend");
    for (const [i, name] of ["scripts", "extensions"].entries()) {
      expect(listed!.result.resources).toContainEqual(expect.objectContaining({ uri: `ep0ch://docs/${name}`, mimeType: "text/markdown" }));
      const content = read[i]!.result.contents[0];
      expect(content.uri).toBe(`ep0ch://docs/${name}`);
      expect(content.text).toContain(name === "scripts" ? "## Globals" : "## Testing an extension");
      expect(content.text).toContain(`ep0ch://docs/${name === "scripts" ? "extensions" : "scripts"}`);
      const links = [...content.text.matchAll(/\]\((ep0ch:\/\/docs\/[^)]+)\)/g)].map(m => m[1]);
      const followed = await ask(links.map((uri, id) => ({ jsonrpc: "2.0", id, method: "resources/read", params: { uri } })));
      for (const answer of followed) expect(answer.result?.contents[0].text).toContain("# ");
      expect(content.text).not.toMatch(/\]\((?:\.\.?\/|(?:extensions\/README|PROGRAMMABLE-NOTES)\.md)/);
    }
  });

  test("a write answers with the components the note holds and what won't draw, beside said, and saves it as written", async () => {
    const written = ["Seed beds", "::graph-stats", "---", "title: x", "---", "::", "::graph-stat", "---", "title: the beds", "items: [{ value: \"4\", label: raised }]", "---", "::"].join("\n");
    const [made] = await ask([{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "outline_create", arguments: { ref: parent, text: written } } }]);
    const answer = JSON.parse(made!.result.content[0].text);
    expect(made!.result.isError).toBeUndefined();
    expect(answer.outcome).toBe("applied");
    expect(answer.components).toEqual(["graph-stat"]);
    expect(answer.warnings).toEqual(["the ::graph-stats on line 2 isn't a component: did you mean ::graph-stat?"]);
    expect(answer.said).toContain("; 1 to fix before you call this done (warnings): saved as written, fix it now; next: ");
    expect(answer.next).toContain("ep0ch show");
    expect((await board.get(answer.detail.id))?.text).toBe(written);
  });
});
