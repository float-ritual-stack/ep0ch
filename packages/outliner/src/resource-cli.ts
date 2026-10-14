// `resource rebind <folder>` (`ep0ch resource …`, PIE-853): a file Source whose folder now leads somewhere else is
// refused until the person says the folder there is the one to read. This is that word; the refusal names it.
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createOutlinerClient } from "./client";
import { resolveClientPaths } from "./paths";
import type { ResourceSource } from "./resources";

export const RESOURCE_USAGE = `resource rebind <folder> [--ws <outline>] [--json]
                                       read a file Source's folder where it leads now (after it was moved, or a link
                                       in its path changed): the command a refused file link names`;

export async function runResourceCommand(args: string[], io = { out: console.log, err: console.error }, env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Promise<number> {
  const [verb, ...rest] = args;
  if (verb !== "rebind") { io.err(`error: resource takes rebind\n  ${RESOURCE_USAGE}`); return verb === undefined || verb === "help" || verb === "--help" ? 0 : 2; }
  let flags: { ws?: string; json?: boolean }, positionals: string[];
  try {
    ({ values: flags, positionals } = parseArgs({ args: rest, strict: true, allowPositionals: true, options: { ws: { type: "string" }, json: { type: "boolean" } } }));
  } catch (error) {
    io.err(`error: ${error instanceof Error ? error.message : String(error)}\n  ${RESOURCE_USAGE}`);
    return 2;
  }
  if (positionals.length !== 1) { io.err(`error: resource rebind takes one folder\n  ${RESOURCE_USAGE}`); return 2; }
  const typed = positionals[0]!;
  const root = typed === "~" ? homedir() : typed.startsWith("~/") ? resolve(homedir(), typed.slice(2)) : resolve(cwd, typed);
  try {
    const paths = resolveClientPaths(flags.ws ? { ...env, EP0CH_WS: flags.ws } : env);
    const { sources } = await createOutlinerClient(paths).request<{ sources: ResourceSource[] }>({ action: "resource-sources.rebind", root });
    if (flags.json) io.out(JSON.stringify({ sources }, null, 2));
    else io.out(`${typed}: its files are read from where it leads now (${sources.map(source => source.name).join(", ")})`);
    return 0;
  } catch (error) {
    io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
