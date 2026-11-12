import {MentionsNavigator} from "./mentions-navigator";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { createHerdrSession, requiredEnvironment, requireHerdr, startFailureHint, startHerdrClient } from "./herdr-session";
import { listLiveClients } from "./client-target";
import { loadDetailReadPreview } from "./detail-read-preview";
import { currentPaneRuntime, openDetailPane } from "./pane-control";
import { openDestinationTimeoutFromEnvironment } from "./open-destination-chooser";
import { blockDisplayTitle } from "./references";
import type {
  Block,
  BookmarkResolution,
  BookmarkRemoveReceipt,
  OutlinerRegion,
  SavedViewReadResult,
  VisibleBlockCollection,
  WorkspaceSnapshot,
} from "./types";
import {
  bookmarkProjectionRows,
  VirtualBranchNavigatorController,
  renderVirtualBranchNavigatorFrame,
  type VirtualBranchNavigatorLaunch,
  type VirtualBranchNavigatorPreview,
  type VirtualBranchNavigatorRenderResult,
} from "./virtual-branch-navigator";
import {
  isVirtualBranchDefinition,
  projectVirtualBranches,
  savedViewMembership,
  type TreePresentationState,
  type VirtualBranchOccurrenceRow,
} from "./virtual-branches";

requireHerdr("Virtual branch navigator popup");

function parseLaunch(): VirtualBranchNavigatorLaunch {
  const sourceRole = requiredEnvironment("OUTLINER_NAVIGATOR_SOURCE_ROLE");
  if (sourceRole !== "tree" && sourceRole !== "detail") {
    throw new Error("OUTLINER_NAVIGATOR_SOURCE_ROLE must be tree or detail");
  }
  const adapter = process.env.OUTLINER_NAVIGATOR_ADAPTER?.trim();
  if (adapter && adapter !== "bookmark" && adapter !== "mentions") {
    throw new Error("OUTLINER_NAVIGATOR_ADAPTER must be bookmark or mentions when provided");
  }
  return {
    sourceClientId: requiredEnvironment("OUTLINER_NAVIGATOR_SOURCE_CLIENT_ID"),
    sourceRole: sourceRole satisfies OutlinerRegion,
    browsingContextId: requiredEnvironment("OUTLINER_BROWSING_CONTEXT_ID"),
    viewId: requiredEnvironment("OUTLINER_NAVIGATOR_VIEW_ID"),
    ...(adapter === "bookmark" || adapter === "mentions" ? { adapter } : {}),
  };
}

const launch = parseLaunch();
const { paths, client, keymap: actionKeymap } = await startHerdrClient();
const mentions = launch.adapter === "mentions" ? new MentionsNavigator(client) : null;
const destinationTimeoutMs = openDestinationTimeoutFromEnvironment(
  process.env.OUTLINER_OPEN_DESTINATION_TIMEOUT_MS,
);
let rendered: VirtualBranchNavigatorRenderResult | null = null;
let stopWatcher: (() => Promise<void>) | null = null;

async function loadProjection(presentation: TreePresentationState) {
  if (mentions) return mentions.projection();
  const snapshot = await client.request<WorkspaceSnapshot>({ action: "workspace.snapshot" });
  const definition = snapshot.physical.blocks.find((block) => block.id === launch.viewId);
  if (!definition) throw new Error(`Virtual branch not found: ${launch.viewId}`);
  if (!isVirtualBranchDefinition(definition)) {
    throw new Error(`Block is not a virtual branch: ${launch.viewId}`);
  }
  const definitions = (launch.adapter === "bookmark"
    ? [definition]
    : snapshot.physical.blocks.filter(isVirtualBranchDefinition))
    .map((block) => ({ ...block, depth: 0 }));
  const projection = await projectVirtualBranches(
    definitions,
    snapshot.physical.blocks,
    // Bookmarks scope their query to the bookmark root, so they are not a plain saved-view read.
    launch.adapter === "bookmark"
      ? (query) => client.request<VisibleBlockCollection>({
        action: "blocks.query", query: { ...query, subtreeRootId: launch.viewId },
      })
      : { members: savedViewMembership(viewId => client.request<SavedViewReadResult>({ action: "views.read", viewId })) },
    snapshot.virtualOccurrenceRanks,
    presentation,
  );
  const definitionIndex = projection.rows.findIndex(
    (row) => row.kind === "physical" && row.canonicalId === launch.viewId,
  );
  if (definitionIndex < 0) throw new Error(`Virtual branch projection unavailable: ${launch.viewId}`);
  const rows: VirtualBranchOccurrenceRow[] = [];
  for (const row of projection.rows.slice(definitionIndex + 1)) {
    if (row.kind === "physical") break;
    rows.push(row);
  }
  const state = projection.branchStates.get(launch.viewId);
  if (!state) throw new Error(`Virtual branch state unavailable: ${launch.viewId}`);
  const projectedRows = launch.adapter === "bookmark"
    ? bookmarkProjectionRows(rows, snapshot.physical.blocks, launch.viewId)
    : rows;
  const projectedState = launch.adapter === "bookmark"
    ? {
        ...state,
        count: projectedRows.filter((row) => row.relativeDepth === 0).length,
        descendantCount: projectedRows.filter((row) => row.relativeDepth > 0).length,
      }
    : state;
  return { title: blockDisplayTitle(definition), rows: projectedRows, state: projectedState };
}

async function loadPreview(
  row: VirtualBranchOccurrenceRow,
): Promise<VirtualBranchNavigatorPreview> {
  if (mentions) return mentions.preview(row);
  if (launch.adapter === "bookmark" && row.relativeDepth === 0) {
    const resolution = await client.request<BookmarkResolution>({
      action: "bookmarks.resolve",
      recordId: row.matchRootCanonicalId,
    });
    if (!resolution.target) {
      const unavailableReason = resolution.unavailableReason;
      const text = `${blockDisplayTitle(resolution.record)}\n\n> ${unavailableReason}`;
      return {
        document: {
          canonicalText: text,
          resolvedText: text,
          projectedText: text,
          embedRanges: [],
          workIdPrefix: null,
        },
        target: null,
        unavailableReason,
      };
    }
    return {
      document: await loadDetailReadPreview(client, resolution.target),
      target: {
        target: { kind: "block", blockId: resolution.target.id },
        title: blockDisplayTitle(resolution.target),
      },
    };
  }
  const block = await client.request<Block>({ action: "get", blockId: row.canonicalId });
  return {
    document: await loadDetailReadPreview(client, block),
    target: {
      target: { kind: "block", blockId: block.id },
      title: blockDisplayTitle(block),
    },
  };
}

const controller = new VirtualBranchNavigatorController(launch.sourceRole, {
  loadProjection: (collapsedOccurrenceRowIds,expandedOccurrenceRowIds) =>
    loadProjection({
      collapsedBlockIds: new Set(),
      collapsedOccurrenceRowIds,
      expandedOccurrenceRowIds,
      multilineExpandedRowIds: new Set(),
    }),
  loadPreview,
  async replaceTarget(blockId) {
    if (launch.sourceRole !== "detail") {
      throw new Error("Replace is available only from a Detail-launched navigator");
    }
    await client.request({
      action: "ui.command.send",
      command: {
        targetClientId: launch.sourceClientId,
        command: "replace", targetRegion: "detail",
        target: { kind: "block", blockId },
      },
    });
  },
  async openLinked(blockId) {
    await client.request({
      action: "navigation.dispatch",
      sourceClientId: launch.sourceClientId,
      sourceRegion: launch.sourceRole,
      target: { kind: "block", blockId },
      intent: "open",
    });
    return true;
  },
  async openInNewDetail(blockId, direction) {
    const sourceClient = (await listLiveClients(client))
      .find((candidate) => candidate.clientId === launch.sourceClientId);
    if (!sourceClient) throw new Error("Invoking Outliner client is no longer available");
    const targetPaneId = sourceClient.runtime?.paneId;
    if (!targetPaneId) throw new Error("Invoking Outliner client has no live Herdr pane");
    const contextId = crypto.randomUUID();
    await client.request({
      action: "browsing-context.publish",
      sourceClientId: launch.sourceClientId,
      contextId,
      target: { kind: "block", blockId },
      dispatchPreview: false,
    });
    openDetailPane({
      workspaceRoot: paths.workspaceRoot,
      browsingContextId: contextId,
      targetPaneId,
      direction,
    });
  },
  async revealSource(blockId) {
    await client.request({
      action: "navigation.dispatch",
      sourceClientId: launch.sourceClientId,
      target: { kind: "block", blockId },
      intent: "reveal",
      focusTarget: true,
    });
  },
  ...(launch.adapter === "bookmark"
    ? {
      async removeSelectedRecord(row: VirtualBranchOccurrenceRow) {
        if (row.relativeDepth !== 0) {
          throw new Error("Select the bookmark record row to remove it");
        }
        const resolution = await client.request<BookmarkResolution>({
          action: "bookmarks.resolve",
          recordId: row.matchRootCanonicalId,
        });
        await client.request<BookmarkRemoveReceipt>({
          action: "bookmarks.remove",
          recordId: resolution.record.id,
          expectedRevision: resolution.record.revision,
        });
      },
    }
    : {}),
  close() {
    void stop();
  },
  invalidate() {
    draw();
  },
}, { destinationTimeoutMs, actionKeymap, ...(mentions ? {commands:mentions.commands} : {}) });

function draw(): void {
  if (session.failed) return;
  rendered = renderVirtualBranchNavigatorFrame(
    controller,
    process.stdout.columns ?? 100,
    process.stdout.rows ?? 30,
    getMarkdownTheme(),
  );
  process.stdout.write(rendered.frame);
}

const stop = (exitCode = 0) => session.stop(exitCode);
function enqueueWork(task: () => void | Promise<void>): void { session.enqueue(task); }
const session = createHerdrSession({
  modes: { mouse: "click" },
  draw,
  onError(error) {
    controller.status = error instanceof Error ? error.message : String(error);
    draw();
  },
  leave: () => void stopWatcher?.(),
  input: { kind: "keypress", handlers: {
    mouse(sequence) {
      const clickedFrame = rendered;
      if (clickedFrame) enqueueWork(() => controller.handleMouse(sequence, clickedFrame));
    },
    keypress(text, key, action) {
      enqueueWork(() => controller.handleKeypress(
        text,
        key,
        action,
        process.stdout.rows ?? 30,
        (process.stdout.columns ?? 100) < 84,
      ));
    },
  } },
});
session.start();

try {
  // Bookmark scopes query blocks.query with the parsed view, which may carry a `where` expression.
  await controller.initialize();
  const navigatorClientId = `navigator-${crypto.randomUUID()}`;
  const watcher = client.watch({
    client: {
      clientId: navigatorClientId,
      role: "observer",
      contextId: launch.browsingContextId,
      runtime: currentPaneRuntime(),
    },
    onConnect: () => {
      enqueueWork(async () => {
        if (controller.status.startsWith("Refresh unavailable:")) controller.status = "";
        await controller.refresh();
      });
    },
    onEvent: (event) => {
      if (event.domain === "content" || event.domain === "view" || (mentions && event.domain === "mentions")) {
        enqueueWork(() => controller.refresh());
      }
    },
    onError: (error) => {
      enqueueWork(() => {
        controller.status = `Refresh unavailable: ${error.message}`;
        draw();
      });
    },
  });
  stopWatcher = () => watcher.stop();
  draw();
} catch (error) {
  session.fail(`${mentions ? "Recent mentions" : "Navigator"} could not start`, error, startFailureHint(error, paths));
}
