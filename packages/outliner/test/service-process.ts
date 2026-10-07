import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { OutlinerStore } from "../src/store";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";

/**
 * A real outline host process for tests, over a scratch outlines folder. `env` replaces the defaults; nothing
 * inherits the caller's settings, so a test never reaches a real outline. `startup()` resolves with the ready
 * line, or null if the host exits first.
 */
export function launchService(env: Record<string, string | undefined>) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/host-main.ts")], {
    env: { PATH: process.env.PATH, ...env },
    stdout: "pipe", stderr: "pipe", stdin: "ignore",
    timeout: 15_000, killSignal: "SIGKILL",
  });
  const stderr = new Response(child.stderr).text();
  async function startup(): Promise<Record<string, unknown> | null> {
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return null;
        output += decoder.decode(chunk.value, { stream: true });
        const line = output.split("\n").find(text => text.includes('"status":"ready"'));
        if (line) return JSON.parse(line) as Record<string, unknown>;
      }
    } finally {
      reader.releaseLock();
    }
  }
  return { child, stderr, startup };
}

/**
 * The environment of a host over `<root>/outlines` whose default outline is `name`, made first (the host never
 * creates its default), and where its socket and database are.
 */
export function scratchServiceEnv(root: string, name = "scratch"): Record<string, string> {
  const layout = outlineLayout(join(root, "outlines"));
  mkdirSync(layout.root, { recursive: true });
  new OutlinerStore(layout.database(name), { workspaceRoot: layout.folder(name) }).close();
  return { EP0CH_OUTLINES: layout.root, EP0CH_DEFAULT_WS: name, XDG_CONFIG_HOME: join(root, "config") };
}

export function scratchServicePaths(root: string, name = "scratch") {
  const layout = outlineLayout(join(root, "outlines"));
  return { socket: layout.socket, database: layout.database(name), folder: layout.folder(name) };
}
