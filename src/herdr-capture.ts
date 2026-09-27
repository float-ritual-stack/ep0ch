import {hostname} from "node:os";
import {focusActiveCapture} from "./capture-owner";
import { createOutlinerClient } from "./client";
import { openCapturePopup, pluginInvocationPaneId, pluginInvocationWorkspaceRoot } from "./pane-control";
import { resolveClientPaths } from "./paths";
import {openCaptureSurface} from "./capture-surface";
import type {CaptureOwnerClaim, QuickCaptureDraft} from "./types";

if (process.env.HERDR_ENV !== "1") throw new Error("Quick Capture requires Herdr");

const workspaceRoot = pluginInvocationWorkspaceRoot();
const paths = resolveClientPaths({ ...process.env, OUTLINER_WORKSPACE_ROOT: workspaceRoot });
const client = createOutlinerClient(paths);
await client.requireCompatibleService();
if (await focusActiveCapture(client)) process.exit(0);
if (process.argv.includes("--editor")) {
  const originPaneId = pluginInvocationPaneId();
  if (!originPaneId) throw Error("Quick Capture requires the invoking Herdr pane");
  if (!process.env.HERDR_SOCKET_PATH) throw Error("Quick Capture requires its Herdr session");
  // Reserve the launch before reading/preparing its draft or changing layout.
  // Competing commands wait for its destination to take ownership; only the
  // winner prepares and hands off the canonical draft.
  const clientId = crypto.randomUUID();
  const ready = Promise.withResolvers<CaptureOwnerClaim>();
  const watcher = client.watch({client: {clientId, contextId: "capture-launch", role: "observer"},
    async onConnect() {
      ready.resolve(await client.request<CaptureOwnerClaim>({action: "capture.owner.claim", clientId,
        location: {hostname: hostname(), herdrSocket: process.env.HERDR_SOCKET_PATH!, paneId: originPaneId, popup: false, launching: true}}));
    },
    onEvent() {}, onError(error) {ready.reject(error);},
  });
  try {
    const claim = await ready.promise;
    if (!claim.acquired) {
      if (!await focusActiveCapture(client)) throw Error("The other Capture launch ended; retry to reopen the retained draft");
    }
    else {
      const current = await client.request<QuickCaptureDraft | null>({action: "capture.draft.get"});
      if (current?.submittedText !== undefined) throw Error("Resolve the previous Save to Inbox in Quick Capture before opening its editor");
      const draft = await client.request<QuickCaptureDraft>({action: "capture.draft.save", input: {
        ownerClientId: clientId, requestId: current?.requestId ?? crypto.randomUUID(), text: current?.text ?? "",
        cursorRow: current?.cursorRow ?? 0, cursorColumn: current?.cursorColumn ?? 0,
        selectionAnchor: current?.selectionAnchor, capturedFromBlockId: current?.capturedFromBlockId,
        expectedRevision: current?.revision ?? null, prepareBlock: true,
      }});
      await openCaptureSurface(client, {workspaceRoot, stateDir: paths.stateDir, draft, originPaneId, placement: "right", editor: true, ownerClientId: clientId});
    }
  } finally {await watcher.stop();}
} else openCapturePopup({ workspaceRoot });
