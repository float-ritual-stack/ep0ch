import {focusActiveCapture} from "./capture-owner";
import { createOutlinerClient } from "./client";
import { openCapturePopup, pluginInvocationPaneId, pluginInvocationWorkspaceRoot } from "./pane-control";
import { resolveClientPaths } from "./paths";
import {openCaptureSurface} from "./capture-surface";
import type {QuickCaptureDraft} from "./types";

if (process.env.HERDR_ENV !== "1") throw new Error("Quick Capture requires Herdr");

const workspaceRoot = pluginInvocationWorkspaceRoot();
const paths = resolveClientPaths({ ...process.env, OUTLINER_WORKSPACE_ROOT: workspaceRoot });
const client = createOutlinerClient(paths);
await client.requireCompatibleService();
if (await focusActiveCapture(client)) process.exit(0);
if (process.argv.includes("--editor")) {
  const originPaneId = pluginInvocationPaneId();
  if (!originPaneId) throw Error("Quick Capture requires the invoking Herdr pane");
  const current = await client.request<QuickCaptureDraft | null>({action: "capture.draft.get"});
  if (current?.submittedText !== undefined) throw Error("Resolve the previous Save to Inbox in Quick Capture before opening its editor");
  const draft = await client.request<QuickCaptureDraft>({action: "capture.draft.save", input: {
    requestId: current?.requestId ?? crypto.randomUUID(), text: current?.text ?? "",
    cursorRow: current?.cursorRow ?? 0, cursorColumn: current?.cursorColumn ?? 0,
    selectionAnchor: current?.selectionAnchor, capturedFromBlockId: current?.capturedFromBlockId,
    expectedRevision: current?.revision ?? null, prepareBlock: true,
  }});
  await openCaptureSurface(client, {workspaceRoot, stateDir: paths.stateDir, draft, originPaneId, placement: "right", editor: true});
} else openCapturePopup({ workspaceRoot });
