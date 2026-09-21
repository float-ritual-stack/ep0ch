import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { HerdrRuntimeRegistry } from "./herdr-registry";
import { HerdrRegistryRunner } from "./herdr-runtime";
import { registerServicePaneState, removeLegacyClientPaneStates } from "./pane-control";
import { resolveServicePaths } from "./paths";
import { OutlinerServer } from "./server";
import { OutlinerStore } from "./store";
import { createInboxModel, checkInboxModelConfiguration } from "./inbox-model";
import { aiPromptDirectory, initializeAiPrompts } from "./ai-prompts";

const paths = resolveServicePaths();
mkdirSync(paths.stateDir, { recursive: true });
const paneStatePath = join(paths.stateDir, "service-pane.json");
const store = new OutlinerStore(paths.database, { workspaceRoot: paths.workspaceRoot });
const promptDirectory = aiPromptDirectory(process.env.OUTLINER_PROMPT_DIR ?? join(paths.stateDir, "prompts"));
const herdrRegistry = new HerdrRuntimeRegistry();
const herdrSocketPath = process.env.HERDR_SOCKET_PATH;
const herdrRunner = herdrSocketPath === undefined ? null : new HerdrRegistryRunner(herdrRegistry, herdrSocketPath);
const server = new OutlinerServer(store, paths.socket, herdrRunner ? herdrRegistry : undefined, promptDirectory);
let ownsPaneState = false;
try {
  if (process.env.OUTLINER_PROMPT_DIR === undefined) await initializeAiPrompts(promptDirectory);
  await server.start();
  ownsPaneState = true;
  removeLegacyClientPaneStates(paths.stateDir);
  registerServicePaneState(paths.stateDir, paths.workspaceRoot);
  herdrRunner?.start();
} catch (error) {
  try {
    await server.close();
  } catch (closeError) {
    console.error(`Failed to close outliner service after startup error: ${String(closeError)}`);
  }
  try {
    if (ownsPaneState) rmSync(paneStatePath, { force: true });
  } catch (cleanupError) {
    console.error(`Failed to remove outliner service pane state after startup error: ${String(cleanupError)}`);
  } finally {
    store.close();
  }
  throw error;
}
console.log(JSON.stringify({ status: "ready", socket: paths.socket, database: paths.database }));

let stopping = false;
// Loading provider configuration does not delay socket readiness or capture saves.
if (process.env.OUTLINER_INBOX_AGENT !== "0") {
  server.setInboxUnavailable("Checking Inbox agent configuration");
  void checkInboxModelConfiguration({ workspaceRoot: paths.workspaceRoot }).then(configuration => {
    if (stopping) return;
    if (configuration.configured) server.enableInbox(createInboxModel({ workspaceRoot: paths.workspaceRoot, promptDirectory }));
    else server.setInboxUnavailable(configuration.message);
  }).catch(() => {
    if (!stopping) server.setInboxUnavailable("Inbox model configuration could not be loaded");
  });
}
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  let exitCode = 0;
  if (herdrRunner !== null) {
    try {
      await herdrRunner.stop();
    } catch (error) {
      exitCode = 1;
      console.error(`Failed to stop Herdr registry: ${String(error)}`);
    }
  }
  try {
    await server.close();
  } catch (error) {
    exitCode = 1;
    console.error(`Failed to close outliner service: ${String(error)}`);
  } finally {
    try {
      rmSync(paneStatePath, { force: true });
    } catch (error) {
      exitCode = 1;
      console.error(`Failed to remove outliner service pane state: ${String(error)}`);
    } finally {
      try {
        store.close();
      } catch (error) {
        exitCode = 1;
        console.error(`Failed to close outliner store: ${String(error)}`);
      } finally {
        process.exit(exitCode);
      }
    }
  }
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("SIGHUP", stop);
