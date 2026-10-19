import { basename, dirname, extname, resolve } from "node:path";
import { statSync } from "node:fs";
import { boardFor, type Out } from "./notes-cli";
import { resolveTarget } from "./discover";
import { forwardTo } from "./machine";
import { hostRequest } from "./socket";
import { protocolMismatch } from "@ep0ch/outline-core/protocol";

export async function artifactCommand(input: string[], io: Out = { out: console.log, err: console.error }): Promise<number> {
  const args = input.slice(1), verb = args.shift();
  const valued = ["--ws", "--machine", "--name", "--to"];
  const value = (key: string) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  for (const [i, arg] of args.entries()) {
    if (valued.includes(arg) && (!args[i + 1] || args[i + 1]!.startsWith("--"))) { io.err(`ep0ch: ${arg} needs a value`); return 2; }
    if (arg.startsWith("--") && !valued.includes(arg) && arg !== "--json") { io.err(`ep0ch: artifact doesn't take ${arg}`); return 2; }
  }
  const words = args.filter((a,i) => !valued.includes(a) && !valued.includes(args[i-1] ?? "") && a !== "--json");
  if (!verb || !["put", "ls", "show", "versions", "snapshot", "rm", "import", "deploy", "dns", "backfill"].includes(verb) || words.length > 1 || (verb !== "ls" && verb !== "import" && verb !== "backfill" && !words[0])) {
    io.err("ep0ch artifact put <file-or-folder> [--name <name>] | deploy <repo> | dns <name> --to vercel|float-2 | backfill [catalogue] | ls | show|versions|snapshot|rm <name> | import [--ws <name>] [--machine <machine>]"); return 2;
  }
  const board = ["import", "deploy", "dns", "backfill"].includes(verb!) || value("--ws") ? await boardFor(args) : await artifactHost(value("--machine"));
  if ("error" in board) { io.err(board.error); return 1; }
  try {
    let result: unknown;
    if (verb === "put") {
      const path = resolve(words[0]!), folder = statSync(path).isDirectory();
      const name = value("--name") ?? basename(path, folder ? undefined : extname(path));
      const { upload } = await board.request<{ upload: string }>("artifacts.upload.begin", { name });
      const tar = Bun.spawn(["tar", "--format=ustar", "-cf", "-", "-C", folder ? path : dirname(path), folder ? "." : basename(path)], { stdout: "pipe", stderr: "pipe" });
      const errors = new Response(tar.stderr).text();
      try {
        for await (const chunk of tar.stdout) {
          for (let offset = 0; offset < chunk.length; offset += 48 * 1024) await board.request("artifacts.upload.chunk", { upload, data: Buffer.from(chunk.subarray(offset, offset + 48 * 1024)).toString("base64") });
        }
        if (await tar.exited !== 0) throw new Error(await errors);
        result = await board.request("artifacts.upload.finish", { upload }, 240_000);
      } catch (error) { tar.kill(); await tar.exited; await board.request("artifacts.upload.abort", { upload }); throw error; }
    } else if (verb === "deploy") result = await board.request("artifacts.deploy", { repo: words[0] }, 900_000);
    else if (verb === "backfill") result = await board.request("artifacts.backfill", { catalogue: words[0] }, 900_000);
    else if (verb === "dns") result = await board.request("artifacts.dns", { name: words[0], to: value("--to") }, 240_000);
    else result = await board.request(`artifacts.${verb === "ls" ? "list" : verb}`, { name: words[0] }, 240_000);
    io.out(JSON.stringify(result, null, 2)); return 0;
  } catch (error) { io.err(`ep0ch: ${(error as Error).message}`); return 1; }
  finally { board.close(); }
}

async function artifactHost(machine: string | undefined) {
  const target = resolveTarget(machine ? ["--machine", machine] : [], { ...process.env, EP0CH_WS: undefined, EP0CH_MACHINE: undefined });
  if ("error" in target) return target;
  try {
    const path = target.machine ? (await forwardTo(target.machine)).socket : target.path;
    const ping = await hostRequest<{ protocolVersion: number }>(path, "ping");
    const mismatch = protocolMismatch(ping.protocolVersion, "this door");
    if (mismatch) return { error: mismatch };
    return {
      request: <T = unknown>(action: string, params: Record<string, unknown> = {}, timeout?: number) => hostRequest<T>(path, action, params, timeout),
      close() {},
    };
  } catch (error) { return { error: `ep0ch: ${(error as Error).message}` }; }
}
