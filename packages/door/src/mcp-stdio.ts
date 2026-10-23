import { createInterface } from "node:readline";
import { mintCallId } from "@ep0ch/outline-core/attribution";
import { installedRules, newerRules } from "@ep0ch/outliner/client-code";

type WorkerReply = { line: string } | { done: true } | { adopt: string } | { release: string };

/** Keep the connector's pipes and queued input here while the MCP worker takes over on installed code. */
export async function mcpStdio(args: string[]): Promise<number> {
  let worker: ReturnType<typeof Bun.spawn> | undefined;
  const installed = () => installedRules(new URL("../../outline-core/src/protocol.ts", import.meta.url));
  let rules = installed();
  let hello: string | undefined;
  const adopted = new Set<string>();
  const call = mintCallId();
  let finish: (() => void) | undefined;
  let failed: ((error: Error) => void) | undefined;
  let silent = false;
  const start = () => {
    const child = Bun.spawn([process.execPath, new URL("./mcp-worker.ts", import.meta.url).pathname, ...args], {
      stdin: "ignore", stdout: "ignore", stderr: "inherit", env: { ...process.env },
      ipc(message: WorkerReply) {
        if ("line" in message) { if (!silent) process.stdout.write(message.line + "\n"); }
        else if ("adopt" in message) adopted.add(message.adopt);
        else if ("release" in message) adopted.delete(message.release);
        else finish?.();
      },
    });
    void child.exited.then(code => { if (worker === child) failed?.(new Error(`MCP worker exited ${code}; run ep0ch install --apply`)); });
    worker = child;
  };
  const send = (line: string, suppress = false) => new Promise<void>((resolve, reject) => {
    if (worker!.exitCode !== null) { reject(new Error(`MCP worker exited ${worker!.exitCode}; run ep0ch install --apply`)); return; }
    silent = suppress; finish = resolve; failed = reject;
    worker!.send({ line, call, adopted: [...adopted] });
  }).finally(() => { finish = undefined; failed = undefined; });
  const stop = async () => {
    const child = worker; worker = undefined;
    if (child) { if (child.exitCode === null) child.send({ end: true }); await child.exited; }
  };
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const terminate = () => { worker?.kill(); input.close(); };
  process.once("SIGTERM", terminate); process.once("SIGINT", terminate);
  try {
    start();
    for await (const line of input) {
      const next = installed();
      if (newerRules(next, rules)) {
        await stop(); rules = next; start();
        if (hello) await send(hello, true);
      }
      await send(line);
      try {
        const requests = [JSON.parse(line)].flat();
        const initialize = requests.find(r => r.method === "initialize");
        if (initialize) hello = JSON.stringify(initialize);
      } catch { /* The worker reports malformed JSON. */ }
    }
    return 0;
  } finally {
    input.close(); await stop();
    process.removeListener("SIGTERM", terminate); process.removeListener("SIGINT", terminate);
  }
}
