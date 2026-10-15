import { CodemodeSandbox, type CodemodeResult } from "@earendil-works/pi-codemode";
import type { HostApi } from "./host-api";

/** The VM runs on a worker so a computing script never holds the outline's event loop. */
export async function runScript(source: string, api: HostApi, signal?: AbortSignal): Promise<CodemodeResult> {
  const sandbox = new CodemodeSandbox({
    tools: api.tools.map(name => ({ name, execute: args => api.call(name, args as Record<string, unknown>) })),
    globals: [
      { name: "act", spread: true, execute: args => api.act(...args as Parameters<HostApi["act"]>) },
      { name: "q", spread: true, execute: args => api.q(...args as Parameters<HostApi["q"]>) },
      { name: "read", spread: true, execute: args => api.read(...args as Parameters<HostApi["read"]>) },
    ],
  });
  try {
    const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(`async function __ep0ch_script__() {\n${source}\n}`) + "\nreturn await __ep0ch_script__();";
    return await sandbox.execute(javascript, { signal });
  } finally {
    await sandbox.close();
  }
}
