import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { outlinesLayout } from "./paths";
import { redactSecrets } from "./startup-error";

/** Where a client's crashes are kept: the host's private folder (`<outlines>/.host/`) beside `open-startup-error.log`, when it exists. */
export function crashLogPath(client: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const { hostDir } = outlinesLayout(env);
  return existsSync(hostDir) ? join(hostDir, `${client}-crash.log`) : undefined;
}

/** Appends a crash (when, the outline it had open, the stack) to the client's log and returns the path; undefined when there is nowhere to keep it. */
export function recordCrash(client: string, error: unknown, env: NodeJS.ProcessEnv = process.env): string | undefined {
  try {
    const path = crashLogPath(client, env);
    if (!path) return undefined;
    const details = redactSecrets(error instanceof Error ? error.stack ?? error.message : String(error), env);
    appendFileSync(path, `${new Date().toISOString()} ${client} crashed (pid ${process.pid}, outline ${env.EP0CH_WS ?? "unnamed"})\n${details}\n\n`, { mode: 0o600 });
    return path;
  } catch {
    // Failing to keep the log must not hide the crash itself.
    return undefined;
  }
}

/**
 * An uncaught error or rejected promise in a client ends the process, but not before it puts the terminal
 * back (`restore`), keeps the stack in the crash log and says on stderr where that is.
 */
export function installCrashLog(client: string, restore: () => void): void {
  let crashing = false;
  const crash = (error: unknown) => {
    if (crashing) return;
    crashing = true;
    try { restore(); } catch { /* the terminal is already going */ }
    const path = recordCrash(client, error);
    const first = (error instanceof Error ? error.message : String(error)).split("\n")[0];
    console.error(`${client} crashed: ${first}\n${path ? `Details: ${path}` : "No host folder to keep a crash log in; the stack follows."}${path ? "" : `\n${error instanceof Error ? error.stack : ""}`}`);
    process.exit(1);
  };
  process.on("uncaughtException", crash);
  process.on("unhandledRejection", crash);
}
