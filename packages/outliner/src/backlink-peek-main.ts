import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  BacklinkPeekController,
  renderBacklinkPeekFrame,
  type BacklinkPeekLaunch,
  type BacklinkPeekPreview,
} from "./backlink-peek";
import { createHerdrSession, requireHerdr, startHerdrClient } from "./herdr-session";
import { projectedSourceLine } from "./detail-pi-preview";
import { listLiveClients } from "./client-target";
import { BACKLINK_QUERY_LIMIT, backlinkView, parseBacklinkViewOptions } from "./backlink-view";
import { projectDetailRead } from "./detail-embeds";
import { openDetailPane } from "./pane-control";
import { openDestinationTimeoutFromEnvironment } from "./open-destination-chooser";
import type {
  BacklinkCollection,
  BacklinkSource,
  Block,
  ResolvedBlockReferences,
} from "./types";

requireHerdr("Backlink peek popup");

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseLaunch(): BacklinkPeekLaunch {
  let view: unknown;
  try {
    view = JSON.parse(requiredEnvironment("OUTLINER_BACKLINK_VIEW"));
  } catch (error) {
    throw new Error(`OUTLINER_BACKLINK_VIEW must be JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    sourceClientId: requiredEnvironment("OUTLINER_BACKLINK_SOURCE_CLIENT_ID"),
    browsingContextId: requiredEnvironment("OUTLINER_BROWSING_CONTEXT_ID"),
    targetBlockId: requiredEnvironment("OUTLINER_BACKLINK_TARGET_BLOCK_ID"),
    selectedSourceBlockId: requiredEnvironment("OUTLINER_BACKLINK_SELECTED_SOURCE_ID"),
    view: parseBacklinkViewOptions(view),
  };
}

const launch = parseLaunch();
const { paths, client, keymap: actionKeymap } = await startHerdrClient();
const destinationTimeoutMs = openDestinationTimeoutFromEnvironment(
  process.env.OUTLINER_OPEN_DESTINATION_TIMEOUT_MS,
);
const collection = await client.request<BacklinkCollection>({
  action: "references.backlinks",
  query: { targetBlockId: launch.targetBlockId, limit: BACKLINK_QUERY_LIMIT },
});
const sources = backlinkView(collection, launch.view).matching;
if (!sources.some((source) => source.blockId === launch.selectedSourceBlockId)) {
  throw new Error("Selected backlink source is no longer in the filtered snapshot");
}

async function sourcePreview(source: BacklinkSource): Promise<BacklinkPeekPreview> {
  const block = await client.request<Block>({ action: "get", blockId: source.blockId });
  const projection = await projectDetailRead(client, block.text, { hostBlockId: block.id });
  const resolved = await client.request<ResolvedBlockReferences>({
    action: "references.resolve",
    text: projection.text,
  });
  const occurrence = source.occurrences[0];
  const authoredSourceLine = occurrence
    ? block.text.slice(0, occurrence.start).split(/\r?\n/).length - 1
    : 0;
  const sourceLine = projectedSourceLine(block.text, projection.embedRanges, authoredSourceLine);
  return { block, text: resolved.text, sourceLine };
}

const controller = new BacklinkPeekController(
  launch.targetBlockId,
  sources,
  launch.selectedSourceBlockId,
  {
    loadSource: sourcePreview,
    async restoreSelection(sourceBlockId) {
      await client.request({
        action: "ui.command.send",
        command: {
          targetClientId: launch.sourceClientId,
          command: "backlinks.select", targetRegion: "detail",
          targetBlockId: launch.targetBlockId,
          sourceBlockId,
        },
      });
    },
    async replaceSource(sourceBlockId) {
      await client.request({
        action: "ui.command.send",
        command: { targetClientId: launch.sourceClientId, command: "replace", targetRegion: "detail", target: { kind: "block", blockId: sourceBlockId },  },
      });
    },
    async openLinked(sourceBlockId) {
      try {
        await client.request({ action: "navigation.dispatch", sourceClientId: launch.sourceClientId, sourceRegion: "detail", target: { kind: "block", blockId: sourceBlockId }, intent: "open", });
        return true;
      } catch (error) {
        throw error;
      }
    },
    async openInNewDetail(sourceBlockId, direction) {
      const sourceClient = (await listLiveClients(client, "detail"))
        .find((candidate) => candidate.clientId === launch.sourceClientId);
      if (!sourceClient) throw new Error("Invoking Detail is no longer available");
      const targetPaneId = sourceClient.runtime?.paneId;
      if (!targetPaneId) throw new Error("Invoking Detail has no live Herdr pane");
      const contextId = crypto.randomUUID();
      await client.request({
        action: "browsing-context.publish",
        sourceClientId: launch.sourceClientId,
        contextId,
        target: { kind: "block", blockId: sourceBlockId },
        dispatchPreview: false,
      });
      openDetailPane({
        workspaceRoot: paths.workspaceRoot,
        browsingContextId: contextId,
        targetPaneId,
        direction,
      });
    },
    close() {
      void session.stop();
    },
    invalidate() {
      draw();
    },
  },
  { destinationTimeoutMs, actionKeymap },
);

function draw(): void {
  process.stdout.write(renderBacklinkPeekFrame(
    controller,
    process.stdout.columns ?? 100,
    process.stdout.rows ?? 30,
    getMarkdownTheme(),
  ));
}

// No mouse reporting: a click stays Herdr's (select and copy). A paste is taken whole and dropped, never typed as keys.
const session = createHerdrSession({
  modes: { paste: true },
  draw,
  onError(error) {
    controller.status = error instanceof Error ? error.message : String(error);
    draw();
  },
  input: { kind: "keypress", handlers: {
    keypress(text, key, action) {
      session.enqueue(() => controller.handleKeypress(text, key, action, process.stdout.rows ?? 30));
    },
  } },
});
session.start();
await controller.initialize();
draw();
