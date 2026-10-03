import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { outlinesLayout, resolveClientPaths } from "./paths";
import { pluginInvocationWorkspaceRoot } from "./pane-control";
import { sanitizeDynamicText } from "./terminal";

/**
 * Where an open's failure is kept: the host's private folder (`<outlines>/.host/`) when it exists. Opening never
 * creates it, so without one the failure is only on stderr and in the Herdr notification.
 */
export function openStartupErrorLogPath(env: NodeJS.ProcessEnv): string | undefined {
  const { hostDir } = outlinesLayout(env);
  return existsSync(hostDir) ? join(hostDir, "open-startup-error.log") : undefined;
}

/**
 * Startup panes can disappear on exit; keep the failure available outside them. `callerReports`: a program
 * caller (the Claude mod's `--no-focus` and `find-detail`) says the failure itself, so it only goes to stderr,
 * never a Herdr notification or the open log a person's own failed open is kept in.
 */
export async function reportStartupErrors(start: () => Promise<void>, options: { callerReports?: boolean } = {}): Promise<void> {
  try {
    await start();
  } catch (error) {
    if (options.callerReports) {
      console.error(`Outliner could not open: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      return;
    }
    let details = error instanceof Error ? error.stack ?? error.message : String(error);
    // A failed child command can include its arguments, including forwarded credentials.
    for (const [name, value] of Object.entries(process.env)) {
      if (value && /(?:KEY|TOKEN|PASSWORD|SECRET)$/.test(name)) {
        details = details.replaceAll(value, "<REDACTED>");
      }
    }
    details = sanitizeDynamicText(details, true);
    const title = "Outliner could not open";
    let location = "See herdr plugin log list --plugin float.pi-outliner --limit 1";
    try {
      const workspaceRoot = process.env.OUTLINER_OPEN_WORKSPACE_ROOT?.trim() ||
        pluginInvocationWorkspaceRoot(process.env, process.env.OUTLINER_WORKSPACE_ROOT ?? process.cwd());
      const logPath = openStartupErrorLogPath(process.env);
      if (!logPath) throw new Error("No host folder for the open log");
      let connection = "";
      try {
        const paths = resolveClientPaths({ ...process.env, OUTLINER_WORKSPACE_ROOT: workspaceRoot });
        connection = `Connection: ${paths.mode}\nEndpoint: ${paths.socket}\nOutline: ${paths.outline ?? `none (${paths.unnamed})`}\nRead-only diagnosis: bun src/cli.ts doctor (from the plugin checkout with OUTLINER_WORKSPACE_ROOT set to this folder)\n`;
      } catch { /* The original configuration failure remains the primary error. */ }
      writeFileSync(logPath, `${new Date().toISOString()} ${title}\nFolder: ${workspaceRoot}\n${connection}${details}\n`, { mode: 0o600 });
      location = `Details: ${logPath}`;
    } catch {
      // Failure to save diagnostics must not hide the original error.
    }
    const message = `${title}: ${details.split("\n")[0]}\n${location}`;
    console.error(`${message}\n${details}`);
    if (process.env.HERDR_ENV === "1") {
      try {
        execFileSync(process.env.HERDR_BIN_PATH ?? "herdr", [
          "notification", "show", title, "--body", `${details.split("\n")[0]?.slice(0, 300)}\n${location}`,
        ], { stdio: "ignore", timeout: 2_000 });
      } catch {
        // Stderr and the retained log still work when Herdr itself is unavailable.
      }
    }
    process.exitCode = 1;
  }
}
