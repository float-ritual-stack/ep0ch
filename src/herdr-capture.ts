import { createOutlinerClient } from "./client";
import { openCapturePopup, pluginInvocationWorkspaceRoot } from "./pane-control";
import { resolveClientPaths } from "./paths";

if (process.env.HERDR_ENV !== "1") throw new Error("Quick Capture requires Herdr");

const workspaceRoot = pluginInvocationWorkspaceRoot();
const paths = resolveClientPaths({ ...process.env, OUTLINER_WORKSPACE_ROOT: workspaceRoot });
await createOutlinerClient(paths).requireCompatibleService();
openCapturePopup({ workspaceRoot });
