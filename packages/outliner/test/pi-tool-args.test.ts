// The Pi extension's block-naming tools take `ref` (src/pi-tool-args.ts): every tool and every alias, a conflict refused
// before anything runs, a wrong call answered with the right one, and a call by ref reaching the real service. Fictional notes.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, spyOn, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import outlinerExtension from "../pi-extension/index";
import { OutlinerClient, type RequestInput } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { PI_REF_TOOLS } from "../src/pi-tool-args";
import type { Block } from "../src/types";

type Tool = { name: string; parameters: any; prepareArguments?: (args: unknown) => any; execute(id: string, params: unknown, signal: undefined, update: undefined, context: ExtensionContext): Promise<{ details: any }> };
const registered = () => {
  const tools = new Map<string, Tool>();
  const pi = { registerTool(tool: Tool) { tools.set(tool.name, tool); }, registerCommand() {}, registerEntryRenderer() {}, appendEntry() {}, on() {} } as unknown as ExtensionAPI;
  outlinerExtension(pi);
  return tools;
};
const ALIASES = ["ref", "id", "reference", "block", "blockId", "uri", "note"];

test("every Pi tool that names a block shows ref, and takes it under each alias and its old name", () => {
  const tools = registered();
  for (const [name, { inner, example }] of Object.entries(PI_REF_TOOLS)) {
    const tool = tools.get(name)!;
    expect(Object.keys(tool.parameters.properties), name).toContain("ref");
    expect(Object.keys(tool.parameters.properties), name).not.toContain(inner);
    const { ref, ...rest } = example;
    for (const alias of new Set([...ALIASES, inner])) {
      expect(tool.prepareArguments!({ ...rest, [alias]: ref }), `${name} ${alias}`).toEqual({ ...rest, ref });
    }
  }
});

test("two aliases for different blocks are refused, the same block spelt two ways is accepted, a wrong call is answered with the right one", () => {
  const tools = registered();
  for (const [name, { example }] of Object.entries(PI_REF_TOOLS)) {
    const tool = tools.get(name)!;
    expect(() => tool.prepareArguments!({ ...example, id: "00000000-0000-4000-8000-000000000001" }), name).toThrow(/Ambiguous.*pass one `ref`[\s\S]*Example: /);
    const ref = example.ref as string;
    expect(tool.prepareArguments!({ ...example, id: ref }), name).toEqual(example);
    expect(tool.prepareArguments!({ ...example, ref: `((${ref}))`, id: ref }), name).toEqual({ ...example, ref: `((${ref}))` });
  }
  const typo = (() => { try { tools.get("outliner_move")!.prepareArguments!({ refe: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", parentId: null }); } catch (e) { return String((e as Error).message); } return ""; })();
  expect(typo).toContain("`refe` is not an argument of outliner_move; did you mean `ref`?");
  expect(typo).toContain("Arguments: ref (string, required) · parentId (string|null, required)");
  expect(typo).toContain('Call it as: outliner_move {"ref":"7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34","parentId":null}');
});

test("a call by ref, ((ref)) or the old name reaches the service as the same block", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-tool-args-"));
  const store = new OutlinerStore(join(root, "outline.sqlite"), { workspaceRoot: root });
  const server = new OutlinerServer(store, join(root, "service.sock")); await server.start();
  const fixture = new OutlinerClient(join(root, "service.sock")), original = OutlinerClient.prototype.request;
  const transport = spyOn(OutlinerClient.prototype, "request").mockImplementation(function<T>(input: RequestInput, timeout?: number): Promise<T> {
    return original.call(fixture, input, timeout) as Promise<T>;
  });
  const context = { sessionManager: { getSessionId: () => "args-session" } } as ExtensionContext;
  try {
    const tool = registered().get("outliner_comment")!;
    const block = await fixture.request<Block>({ action: "create", text: "# Notes\n\nA bounded experiment." });
    for (const [i, key] of ["ref", "blockId"].entries()) {
      const given = { [key]: i ? block.id : `((${block.id}))`, expectedRevision: block.revision, comment: `Comment ${i}`, passage: { quote: "bounded experiment" } };
      const prepared = tool.prepareArguments!(given);
      const receipt = (await tool.execute(`call-${i}`, prepared, undefined, undefined, context)).details;
      expect(receipt.annotations[0].block.id, key).toBeDefined();
      expect(receipt.annotations[0].originalTarget.subject ?? JSON.stringify(receipt)).toContain(block.id);
    }
  } finally { transport.mockRestore(); await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
