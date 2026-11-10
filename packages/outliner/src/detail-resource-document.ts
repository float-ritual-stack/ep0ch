// The document Detail shows for a Resource: its content (document-resources.ts's `resourceContentDocument`) when
// the selected representation is the local copy, then what Detail says about it: where it came from, its revision,
// freshness and history, its external link, and each capability with what blocks it. Pure: the controller
// (detail-controller.ts) hands it a description and draws the answer.
import { concatDocuments, generatedDocument, type MappedDocument } from "./document-provenance";
import { resourceContentDocument } from "./document-resources";
import { outlinerLinkUri } from "./outliner-links";
import { isRemoteEntity } from "./remote-entity";
import {
  RESOURCE_CAPABILITIES,
  RESOURCE_CAPABILITY_FACTORS,
  providerLabel,
  resourceAddressLabel,
} from "./resources";
import type { ResourceDescription, ResourceRevisionRef } from "./types";

const providerRevisionLabel = (revision: ResourceRevisionRef): string => {
  const providerRevision = revision.revision;
  if (providerRevision.kind === "filesystem") {
    return `filesystem mtime ${providerRevision.mtimeNs}, ${providerRevision.size} bytes`;
  }
  if (providerRevision.kind === "web") {
    const validator = providerRevision.validator;
    if (validator.kind === "etag") {
      return `web ETag ${validator.weak ? "W/" : ""}${validator.value}`;
    }
    if (validator.kind === "last-modified") {
      return `web Last-Modified ${validator.value}`;
    }
    return `web content hash ${validator.value}`;
  }
  if (providerRevision.kind === "computed") {
    return `computed ${providerRevision.producerId}@${providerRevision.producerVersion}, input v${providerRevision.inputVersion}, dependencies ${providerRevision.dependencyFingerprint}`;
  }
  const provider = providerRevision.kind === "github" ? "GitHub" : providerLabel(providerRevision.kind);
  return `${provider} ${providerRevision.validator.kind} ${providerRevision.validator.value}`;
};

const freshnessGuidance = (
  freshness: NonNullable<ResourceDescription["webStatus"]>["freshness"],
  hasLocalContent: boolean,
): string => {
  switch (freshness) {
    case "fresh":
      return "The latest observed snapshot is within the local freshness window.";
    case "stale":
      return "The selected content is local and older than the freshness window. Press r to refresh explicitly.";
    case "unknown":
      return hasLocalContent
        ? "Provider freshness has not been checked. Press r to refresh explicitly."
        : "No local snapshot is available. Press r to refresh explicitly. Opening this resource only reads local storage and never contacts the provider.";
    case "refreshing":
      return hasLocalContent
        ? "Refresh is reconciling with the provider. The selected immutable content remains available until persistence succeeds."
        : "Refresh is reconciling with the provider. No local snapshot is available yet.";
    case "failed":
      return hasLocalContent
        ? "The last refresh failed. The selected immutable content remains available."
        : "The last refresh failed and no local snapshot is available. Press r to retry explicitly.";
    default: {
      const exhaustive: never = freshness;
      return exhaustive;
    }
  }
};

export const resourceDocument = (description: ResourceDescription): MappedDocument => {
  const {
    resource,
    source,
    pdf,
    pdfHistory,
    web,
    webHistory,
    remoteEntity,
    computed,
    computedStatus,
    computedFailure,
    presentation,
  } = description;
  const representation = presentation?.selected?.representation;
  const renderLocalContent = representation === undefined ||
    representation === "cached-markdown";
  const content=resourceContentDocument(description);
  if (description.filesystem && renderLocalContent) return content!;
  const externalUrl = presentation?.selected?.externalUrl ?? null;
  const openExternal = presentation?.capabilities["open-external"];
  const unavailableExternalFactor = RESOURCE_CAPABILITY_FACTORS
    .map((factor) => openExternal?.factors[factor])
    .find((assessment) =>
      assessment?.state === "blocked" || assessment?.state === "unknown"
    );
  const externalLines = externalUrl === null
    ? []
    : openExternal?.status === "available"
    ? externalUrl.startsWith("http://") || externalUrl.startsWith("https://")
      ? ["", `[Open externally](<${externalUrl}>)`]
      : [
          "",
          `- External URL: \`${externalUrl}\``,
          "- Open externally: Press Alt+O",
        ]
    : [
        "",
        `- External URL: \`${externalUrl}\``,
        `- External open: unavailable — ${
          unavailableExternalFactor && "detail" in unavailableExternalFactor
            ? unavailableExternalFactor.detail
            : "No negotiated open-external capability"
        }`,
      ];
  const remoteProvider = isRemoteEntity(resource) ? providerLabel(resource.provider) : null;
  const lines = computed && renderLocalContent
    ? [
        computed.markdown,
        "",
        "---",
        "",
        "## Computed resource",
        "",
        `[Stable resource link](${outlinerLinkUri("resource", resource.id)})`,
      ]
    : pdf && renderLocalContent
    ? [
        pdf.markdown,
        "",
        "---",
        "",
        "## PDF resource",
        "",
        `[Stable resource link](${outlinerLinkUri("resource", resource.id)})`,
        ...externalLines,
      ]
    : web && renderLocalContent
      ? [
          web.markdown,
          "",
          "---",
          "",
          "## Web resource",
          "",
          `[Stable resource link](${outlinerLinkUri("resource", resource.id)})`,
          ...externalLines,
        ]
      : remoteEntity && renderLocalContent
        ? [
            remoteEntity.markdown,
            "",
            "---",
            "",
            `## ${remoteProvider ?? "Remote"} entity`,
            "",
            `[Stable resource link](${outlinerLinkUri("resource", resource.id)})`,
            ...externalLines,
          ]
        : [
            `# ${remoteEntity?.title ?? resourceAddressLabel(resource.address)}`,
            "",
            `[Stable resource link](${outlinerLinkUri("resource", resource.id)})`,
            ...externalLines,
          ];
  if (presentation) {
    lines.push(
      "",
      "## Negotiated presentation",
      "",
      `- Resource kind: ${presentation.resourceKind}`,
      `- Surface: ${presentation.surface}`,
      `- Placement: ${presentation.selected?.placement ?? presentation.requestedPlacement}`,
      `- Representation: ${presentation.selected?.representation ?? "unavailable"}`,
      `- Renderer: ${presentation.selected?.renderer ?? "unavailable"}`,
    );
  }
  if (remoteEntity) {
    lines.push(
      "",
      "## Entity metadata",
      "",
      "```json",
      JSON.stringify(remoteEntity.metadata, null, 2),
      "```",
    );
  }
  if (resource.provider === "computed") {
    lines.push(
      "",
      "## Computed status",
      "",
      `- Invocation ID: \`${resource.address.invocationId}\``,
      `- Handler reference: \`producer:${resource.address.invocationId}\``,
      `- State: **${computedStatus?.state ?? "idle"}**`,
      `- Generation: ${computedStatus?.generation ?? 0}`,
      `- Last execution: ${computedStatus?.lastExecutionAt ?? "Never"}`,
    );
    if (computedFailure) {
      lines.push(
        "",
        "## Latest execution failure",
        "",
        `- Execution ID: \`${computedFailure.executionId}\``,
        `- Code: \`${computedFailure.code}\``,
        `- Failed: ${computedFailure.failedAt}`,
        `- Message: ${computedFailure.message}`,
      );
    }
  }
  if (
    resource.provider === "web" ||
    isRemoteEntity(resource)
  ) {
    const status = resource.provider === "web"
      ? description.webStatus
      : description.remoteStatus;
    const freshness = status?.freshness ?? "unknown";
    lines.push(
      "",
      "## Local status",
      "",
      `- Freshness: **${freshness}**`,
      `- Checked: ${status?.checkedAt ?? "Never"}`,
      ...(status?.lastError
        ? [`- Last refresh error: ${status.lastError}`]
        : description.remoteError
        ? [`- Last refresh error: ${description.remoteError}`]
        : []),
      "",
      freshnessGuidance(freshness, pdf != null || web !== null || remoteEntity !== null),
    );
  }
  if (computed) {
    const computedRevision = computed.revision.revision;
    if (computedRevision.kind !== "computed") {
      throw new Error("Computed Resource has a non-computed revision");
    }
    lines.push(
      "",
      "## Selected immutable content",
      "",
      `- Representation ID: \`${computed.representationId}\``,
      `- Content hash: \`${computed.contentHash}\``,
      `- Producer: \`${computedRevision.producerId}@${computedRevision.producerVersion}\``,
      `- Input version: ${computedRevision.inputVersion}`,
      `- Dependency fingerprint: \`${computedRevision.dependencyFingerprint}\``,
      `- Adapter: \`${computed.adapter.id}@${computed.adapter.version}\``,
      `- Derived: ${computed.derivedAt}`,
      `- Exact dependencies: ${computed.dependencies.length}`,
    );
    for (const dependency of computed.dependencies) {
      lines.push(
        `- Dependency \`${dependency.resourceId}\` · address v${dependency.addressVersion} · ${providerRevisionLabel(dependency)}`,
      );
    }
  } else if (pdf) {
    lines.push(
      "",
      "## Selected immutable content",
      "",
      `- Source snapshot ID: \`${pdf.sourceSnapshot.id}\``,
      `- Source hash: \`${pdf.sourceSnapshot.contentHash}\``,
      `- Provider revision: ${providerRevisionLabel(pdf.sourceSnapshot.revision)}`,
      `- Captured: ${pdf.sourceSnapshot.capturedAt}`,
      `- Source bytes available: ${pdf.sourceSnapshot.bytesAvailable ? "yes" : "no"}`,
      `- Text representation ID: \`${pdf.representation.id}\``,
      `- Text adapter: \`${pdf.representation.adapter.id}@${pdf.representation.adapter.version}\``,
      `- Text representation hash: \`${pdf.representation.contentHash}\``,
      `- Native representation ID: \`${pdf.nativeRepresentation.id}\``,
      `- Pages: ${pdf.pages.length}`,
    );
  } else if (web) {
    lines.push(
      "",
      "## Selected immutable content",
      "",
      `- Source snapshot ID: \`${web.sourceSnapshot.id}\``,
      `- Source hash: ${web.sourceSnapshot.contentHash ? `\`${web.sourceSnapshot.contentHash}\`` : "Unknown"}`,
      `- Provider revision: ${providerRevisionLabel(web.sourceSnapshot.revision)}`,
      `- Fetched: ${web.sourceSnapshot.fetchedAt ?? "Unknown"}`,
      `- Source body available: ${web.sourceSnapshot.bodyAvailable ? "yes" : "no"}`,
      `- Representation ID: \`${web.representation.id}\``,
      `- Adapter: \`${web.representation.adapter.id}@${web.representation.adapter.version}\``,
      `- Representation hash: \`${web.representation.contentHash}\``,
      `- Derived: ${web.representation.derivedAt ?? "Unknown"}`,
      `- Representation content available: ${web.representation.contentAvailable ? "yes" : "no"}`,
    );
  } else if (remoteEntity) {
    lines.push(
      "",
      "## Selected immutable content",
      "",
      `- Provider: \`${remoteEntity.sourceSnapshot.provider}\``,
      `- Entity ID: \`${remoteEntity.sourceSnapshot.entityId}\``,
      `- Locator: \`${remoteEntity.sourceSnapshot.locator}\``,
      `- Source hash: \`${remoteEntity.sourceSnapshot.contentHash}\``,
      `- Address version: \`${remoteEntity.sourceSnapshot.addressVersion}\``,
      `- Provider revision: ${providerRevisionLabel(remoteEntity.sourceSnapshot.revision)}`,
      `- Fetched: ${remoteEntity.sourceSnapshot.fetchedAt}`,
      `- Media type: \`${remoteEntity.representation.mediaType}\``,
      `- Adapter: \`${remoteEntity.representation.adapter.id}@${remoteEntity.representation.adapter.version}\``,
      `- Representation hash: \`${remoteEntity.representation.contentHash}\``,
      `- Derived: ${remoteEntity.representation.derivedAt}`,
    );
  } else {
    lines.push(
      "",
      "## Resource identity",
      "",
      `- Resource ID: \`${resource.id}\``,
      `- Source: ${source.name} (\`${source.id}\`)`,
      `- Provider: \`${resource.provider}\``,
      `- Address version: \`${resource.addressVersion}\``,
      `- Requested revision: ${
        description.requestedRevision
          ? `address version ${description.requestedRevision.addressVersion}`
          : "latest address"
      }`,
      ...(description.webError ? [`- Read error: ${description.webError}`] : []),
      ...(description.remoteError ? [`- Read error: ${description.remoteError}`] : []),
    );
  }
  if (webHistory) {
    lines.push(
      "",
      "## Retained history",
      "",
      `- Source snapshots: ${webHistory.sourceSnapshots.length}`,
      `- Representations: ${webHistory.representations.length}`,
    );
    for (const snapshot of webHistory.sourceSnapshots) {
      lines.push(
        `- Snapshot \`${snapshot.id}\` · address v${snapshot.addressVersion} · ${snapshot.canonicalUrl ?? "URL unknown"} · ${snapshot.contentHash ?? "hash unknown"} · fetched ${snapshot.fetchedAt ?? "unknown"} · body ${snapshot.bodyAvailable ? "available" : snapshot.evictedAt ? `evicted ${snapshot.evictedAt}` : "unavailable"}`,
      );
    }
    for (const representation of webHistory.representations) {
      lines.push(
        `- Representation \`${representation.id}\` · snapshot \`${representation.sourceSnapshotId}\` · \`${representation.adapter.id}@${representation.adapter.version}\` · ${representation.contentHash} · derived ${representation.derivedAt ?? "unknown"} · content ${representation.contentAvailable ? "available" : representation.evictedAt ? `evicted ${representation.evictedAt}` : "unavailable"}`,
      );
    }
  }
  if (pdfHistory) {
    lines.push(
      "",
      "## Retained PDF history",
      "",
      `- Source snapshots: ${pdfHistory.sourceSnapshots.length}`,
      `- Representations: ${pdfHistory.representations.length}`,
    );
    for (const snapshot of pdfHistory.sourceSnapshots) {
      lines.push(
        `- Snapshot \`${snapshot.id}\` · address v${snapshot.addressVersion} · ${snapshot.locator} · ${snapshot.contentHash} · captured ${snapshot.capturedAt} · bytes ${snapshot.bytesAvailable ? "available" : "unavailable"}`,
      );
    }
    for (const candidate of pdfHistory.representations) {
      lines.push(
        `- Representation \`${candidate.id}\` · snapshot \`${candidate.sourceSnapshotId}\` · ${candidate.mediaType} · \`${candidate.adapter.id}@${candidate.adapter.version}\` · ${candidate.contentHash} · derived ${candidate.derivedAt}`,
      );
    }
  }
  if (description.availableCommands.length > 0) {
    lines.push(
      "",
      "## Available commands",
      "",
      "```json",
      JSON.stringify(description.availableCommands, null, 2),
      "```",
    );
  }
  lines.push("", "## Capabilities");
  const capabilityReport = presentation?.capabilities ?? description.capabilities;
  for (const capability of RESOURCE_CAPABILITIES) {
    const decision = capabilityReport[capability];
    lines.push(`- ${capability}: ${decision.status}`);
    for (const factor of RESOURCE_CAPABILITY_FACTORS) {
      const assessment = decision.factors[factor];
      if (assessment.state === "blocked" || assessment.state === "unknown") {
        lines.push(`  - ${factor}: ${assessment.state} — ${assessment.detail}`);
      }
    }
  }
  // The content is inserted as the first element above. Split at this known
  // construction boundary, not by searching a rendered string for a match.
  return content
    ? concatDocuments([content,generatedDocument(`\n${lines.slice(1).join('\n')}`,'resource presentation and diagnostics')])
    : generatedDocument(lines.join('\n'),'resource presentation and diagnostics');
};
