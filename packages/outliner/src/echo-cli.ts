// `ep0ch echo` (spike/echonet): run EchoNet's tosser, or write its nodelist, in one node or every node on this host.
// A node is an outline with the echonet extension active; the work is the extension's own action (`extensions.act`),
// so a toss from the shell is the same run its schedule makes, attributed to whoever asked.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createOutlinerClient } from "./client";
import { resolveClientPaths } from "./paths";

const USAGE = "usage: ep0ch echo toss [--node <outline>] [--json] | nodelist [--node <outline>] [--json]\n" +
  "  toss      copies new echomail in, carries netmail both ways, writes the nodelist and a toss log, in --node or every node on this host\n" +
  "  nodelist  writes the nodelist again and prints it";

interface Client { request<T>(input: Record<string, unknown>): Promise<T> }

export async function runEchoCommand(args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const [operation, ...rest] = args;
  if (operation !== "toss" && operation !== "nodelist") {
    console.error(USAGE);
    return operation === undefined || operation === "help" || operation === "--help" ? 0 : 2;
  }
  const { values } = parseArgs({ args: [...rest], strict: true, options: { node: { type: "string" }, json: { type: "boolean" } } });
  const paths = resolveClientPaths(env);
  const client = (outline: string): Client => createOutlinerClient({ ...paths, outline } as Parameters<typeof createOutlinerClient>[0]) as unknown as Client;
  try {
    let nodes: string[];
    if (values.node) {
      const [name, machine] = values.node.split("@");
      if (machine) {
        const here = (await client(name!).request<{ machine: string }>({ action: "notes.address" })).machine;
        if (here.split(".")[0]!.toLowerCase() !== machine.split(".")[0]!.toLowerCase()) {
          throw new Error(`${values.node} is on ${machine}, and this host is ${here}: a node tosses on its own machine (ssh ${machine} ep0ch echo toss --node ${name})`);
        }
      }
      nodes = [name!];
    } else {
      // A host action: any outline's connection asks it.
      const listed = await createOutlinerClient(paths as Parameters<typeof createOutlinerClient>[0]).request<{ outlines: Array<{ name: string }> }>({ action: "outlines.list" });
      const names = listed.outlines.map((entry) => entry.name);
      // A node keeps echonet in its own extensions/ folder; the others aren't asked anything.
      nodes = names.filter((name) => existsSync(join(paths.outlinesFolder, name, "extensions", "echonet", "extension.json")));
      if (!nodes.length) throw new Error("No outline on this host has the echonet extension: copy packages/outliner/extensions/echonet into <outlines>/<name>/extensions/");
    }
    const results: Array<{ node: string; message: string }> = [];
    for (const node of nodes) {
      const run = await client(node).request<{ message?: string }>({
        action: "extensions.act", extension: "echonet", extensionAction: operation, mutation: { author: "user" },
      });
      results.push({ node, message: run.message ?? "done" });
      if (operation === "nodelist" && !values.json) {
        const found = await client(node).request<{ blocks: Array<{ text: string }> }>({ action: "blocks.query", query: { where: "type=nodelist", limit: 1 } });
        results.at(-1)!.message += `\n\n${found.blocks[0]?.text ?? "(no nodelist)"}`;
      }
    }
    if (values.json) console.log(JSON.stringify(results));
    else for (const result of results) console.log(result.message);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
