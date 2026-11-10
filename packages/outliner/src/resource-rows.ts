// The Resource catalog's SQLite rows, one shape per table, and the records they read as: a Source, a Resource, a
// computed invocation and execution, and the stored JSON the rows carry (a remote entity's snapshot payload, a
// computed producer's declaration). `ResourceCatalog` (resource-catalog.ts) writes and selects the rows; this file
// says what a row holds and how it becomes a record, so a column change lands here and in the catalog's SQL.
import { Type } from "typebox";
import { Parse } from "typebox/value";
import {
  ResourceCatalogError,
  EXTENSION_PROVIDER_PATTERN,
  normalizeResourceAddress,
  normalizeResourceId,
  normalizeResourceSourceInput,
  normalizeRetainedResourceRevisionRef,
  type ComputedExecutionRecord,
  type ComputedInvocation,
  type ComputedProducerDeclarationSnapshot,
  type RemoteEntityDocument,
  type RemoteEntityProvider,
  type Resource,
  type ResourceFreshness,
  type ResourceSource,
} from "./resources";

export interface SourceRow {
  id: string;
  name: string;
  provider: string;
  boundary_json: string;
  policy_json: string;
  root_binding: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ResourceRow {
  id: string;
  source_id: string;
  provider: string;
  address_json: string;
  canonical_key: string;
  media_type: string | null;
  address_version: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ComputedInvocationRow {
  id: string;
  resource_id: string;
  source_id: string;
  producer_id: string;
  producer_version: number;
  input_version: number;
  inputs_json: string;
  dependencies_json: string;
  declaration_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ComputedRepresentationRow {
  id: string;
  cache_key: string | null;
  producer_id: string;
  producer_version: number;
  input_version: number;
  dependency_fingerprint: string;
  media_type: string;
  content_hash: string;
  content: string;
  created_at: string;
}

export interface ComputedExecutionRow {
  id: string;
  invocation_id: string;
  resource_id: string;
  generation: number;
  producer_id: string;
  producer_version: number;
  input_version: number;
  dependency_fingerprint: string;
  dependencies_json: string;
  cache_hit: number;
  status: "executing" | "succeeded" | "failed";
  output_kind:
    | "transient-representation"
    | "immutable-snapshot"
    | "durable-resource"
    | "failure"
    | null;
  media_type: string | null;
  output_content_hash: string | null;
  representation_id: string | null;
  durable_resource_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface ComputedResourceStateRow {
  resource_id: string;
  invocation_id: string;
  generation: number;
  status: "idle" | "executing" | "succeeded" | "failed";
  selected_execution_id: string | null;
  representation_id: string | null;
  durable_resource_id: string | null;
  last_failure_execution_id: string | null;
  started_at: string | null;
  completed_at: string | null;
}


export interface WebSourceSnapshotRow {
  id: string;
  resource_id: string;
  address_version: number;
  canonical_url: string | null;
  content_hash: string | null;
  revision_json: string;
  etag: string | null;
  last_modified: string | null;
  html: string | null;
  evicted_at: string | null;
  fetched_at: string | null;
}

export interface WebRepresentationRow {
  id: string;
  source_snapshot_id: string;
  media_type: "text/markdown";
  adapter_id: string;
  adapter_version: number;
  content_hash: string;
  markdown: string | null;
  evicted_at: string | null;
  derived_at: string | null;
}

export interface WebResourceStateRow {
  resource_id: string;
  address_version: number;
  generation: number;
  source_snapshot_id: string | null;
  representation_id: string | null;
  freshness: ResourceFreshness;
  checked_at: string | null;
  last_error: string | null;
}

export interface PdfSourceSnapshotRow {
  id: string;
  resource_id: string;
  address_version: number;
  locator: string;
  content_hash: string;
  revision_json: string;
  etag: string | null;
  last_modified: string | null;
  bytes: Uint8Array | null;
  payload_state: "available" | "evicted";
  payload_bytes: number;
  evicted_at: string | null;
  captured_at: string;
}

export interface PdfRepresentationRow {
  id: string;
  source_snapshot_id: string;
  media_type: "application/pdf" | "text/markdown";
  adapter_id: string;
  adapter_version: number;
  content_hash: string;
  markdown: string | null;
  pages_json: string | null;
  derived_at: string;
  payload_state: "available" | "evicted";
  payload_bytes: number;
  evicted_at: string | null;
}

export interface PdfResourceStateRow {
  resource_id: string;
  address_version: number;
  generation: number;
  source_snapshot_id: string | null;
  representation_id: string | null;
}

export interface RemoteEntitySourceSnapshotRow {
  id: string;
  resource_id: string;
  address_version: number;
  provider: RemoteEntityProvider;
  entity_id: string;
  revision_json: string;
  payload_json: string | null;
  captured_at: string;
  payload_state: "available" | "evicted";
  payload_bytes: number;
  evicted_at: string | null;
}

export interface RemoteEntityRepresentationRow {
  id: string;
  source_snapshot_id: string;
  media_type: "text/markdown";
  adapter_id: string;
  version: number;
  content_hash: string;
  markdown: string | null;
  derived_at: string;
  payload_state: "available" | "evicted";
  payload_bytes: number;
  evicted_at: string | null;
}

export interface RemoteEntityResourceStateRow {
  resource_id: string;
  address_version: number;
  generation: number;
  source_snapshot_id: string | null;
  representation_id: string | null;
  freshness: ResourceFreshness;
  checked_at: string | null;
  last_error: string | null;
}

export function parsedJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new ResourceCatalogError("invalid-input", `${label} contains invalid JSON`);
  }
}

const ComputedProducerDeclarationSnapshotSchema = Type.Object({
  id: Type.String(),
  version: Type.Integer({ minimum: 1 }),
  permissions: Type.Array(Type.String()),
  determinism: Type.Union([
    Type.Literal("deterministic"),
    Type.Literal("nondeterministic"),
  ]),
  cachePolicy: Type.Union([
    Type.Literal("none"),
    Type.Literal("content-addressed"),
  ]),
  outputMediaTypes: Type.Array(Type.String()),
}, { additionalProperties: false });
const RemoteEntityCommandDescriptorSchema = Type.Union([
  Type.Object({
    provider: Type.String({ pattern: EXTENSION_PROVIDER_PATTERN.source }),
    command: Type.Literal("comment.create"),
    label: Type.String(),
    input: Type.Object({
      body: Type.Object({
        type: Type.Literal("string"),
        required: Type.Literal(true),
        maxLength: Type.Literal(10_000),
      }, { additionalProperties: false }),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    provider: Type.Literal("linear"),
    command: Type.Literal("comment.create"),
    label: Type.String(),
    input: Type.Object({
      body: Type.Object({
        type: Type.Literal("string"),
        required: Type.Literal(true),
        maxLength: Type.Literal(10_000),
      }, { additionalProperties: false }),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
]);
const RemoteEntitySnapshotPayloadSchema = Type.Object({
  title: Type.String(),
  metadata: Type.Record(
    Type.String(),
    Type.Union([Type.String(), Type.Array(Type.String()), Type.Null()]),
  ),
  externalUrl: Type.String(),
  locator: Type.String(),
  contentHash: Type.String(),
  commandDescriptors: Type.Array(RemoteEntityCommandDescriptorSchema),
}, { additionalProperties: false });
export interface RemoteEntitySnapshotPayload {
  readonly title: string;
  readonly metadata: RemoteEntityDocument["metadata"];
  readonly externalUrl: string;
  readonly locator: string;
  readonly contentHash: string;
  readonly commandDescriptors: RemoteEntityDocument["commandDescriptors"];
}

export function parseRemoteEntitySnapshotPayload(value: unknown): RemoteEntitySnapshotPayload {
  try {
    return Parse(RemoteEntitySnapshotPayloadSchema, value) as RemoteEntitySnapshotPayload;
  } catch {
    throw new ResourceCatalogError(
      "source-unavailable",
      "Stored remote entity snapshot payload is invalid",
    );
  }
}

function parseComputedDeclaration(value: unknown): ComputedProducerDeclarationSnapshot {
  try {
    return Parse(ComputedProducerDeclarationSnapshotSchema, value);
  } catch {
    throw new ResourceCatalogError(
      "invalid-input",
      "Stored computed producer declaration is invalid",
    );
  }
}

export function computedInvocationFromRow(row: ComputedInvocationRow): ComputedInvocation {
  const inputs = parsedJson(row.inputs_json, "Computed invocation inputs");
  let structuredInputs: Readonly<Record<string, unknown>>;
  try {
    structuredInputs = Parse(Type.Record(Type.String(), Type.Unknown()), inputs);
  } catch {
    throw new ResourceCatalogError("invalid-input", "Stored computed inputs are invalid");
  }
  const dependenciesValue = parsedJson(
    row.dependencies_json,
    "Computed invocation dependencies",
  );
  if (!Array.isArray(dependenciesValue)) {
    throw new ResourceCatalogError("invalid-input", "Stored computed dependencies are invalid");
  }
  return {
    id: normalizeResourceId(row.id, "Computed invocation ID"),
    resourceId: normalizeResourceId(row.resource_id),
    sourceId: normalizeResourceId(row.source_id, "Resource source ID"),
    producerId: row.producer_id,
    producerVersion: row.producer_version,
    inputVersion: row.input_version,
    inputs: structuredInputs,
    dependencies: dependenciesValue.map(normalizeRetainedResourceRevisionRef),
    declaration: parseComputedDeclaration(
      parsedJson(row.declaration_json, "Computed producer declaration"),
    ),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}




export function computedExecutionRecordFromRow(row: ComputedExecutionRow): ComputedExecutionRecord {
  if (!row.completed_at || !row.output_kind) {
    throw new ResourceCatalogError("invalid-input", "Stored computed execution is incomplete");
  }
  const dependenciesValue = parsedJson(
    row.dependencies_json,
    "Computed execution dependencies",
  );
  if (!Array.isArray(dependenciesValue)) {
    throw new ResourceCatalogError(
      "invalid-input",
      "Stored computed execution dependencies are invalid",
    );
  }
  const dependencies = dependenciesValue.map(normalizeRetainedResourceRevisionRef);
  let output: ComputedExecutionRecord["output"];
  switch (row.output_kind) {
    case "transient-representation":
      if (!row.media_type) {
        throw new ResourceCatalogError("invalid-input", "Stored transient output is invalid");
      }
      output = { kind: "transient-representation", mediaType: row.media_type };
      break;
    case "immutable-snapshot": {
      if (!row.media_type || !row.representation_id || !row.output_content_hash) {
        throw new ResourceCatalogError("invalid-input", "Stored immutable output is invalid");
      }
      output = {
        kind: "immutable-snapshot",
        mediaType: row.media_type,
        contentHash: row.output_content_hash,
        representationId: row.representation_id,
      };
      break;
    }
    case "durable-resource":
      if (!row.durable_resource_id) {
        throw new ResourceCatalogError("invalid-input", "Stored durable output is invalid");
      }
      output = { kind: "durable-resource", resourceId: row.durable_resource_id };
      break;
    case "failure":
      if (!row.failure_code || !row.failure_message) {
        throw new ResourceCatalogError("invalid-input", "Stored computed failure is invalid");
      }
      output = {
        kind: "failure",
        code: row.failure_code,
        message: row.failure_message,
      };
      break;
  }
  return {
    id: row.id,
    invocationId: row.invocation_id,
    resourceId: row.resource_id,
    producerId: row.producer_id,
    producerVersion: row.producer_version,
    inputVersion: row.input_version,
    dependencyFingerprint: row.dependency_fingerprint,
    dependencies,
    cacheHit: row.cache_hit === 1,
    output,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function sourceFromRow(row: SourceRow): ResourceSource {
  const boundary = parsedJson(row.boundary_json, "Resource source boundary");
  const policy = parsedJson(row.policy_json, "Resource source policy");
  const normalized = normalizeResourceSourceInput({
    name: row.name,
    provider: row.provider,
    boundary,
    policy,
  });
  const header = {
    id: normalizeResourceId(row.id, "Resource source ID"),
    name: normalized.name,
    version: row.version,
    policy: {
      deniedCapabilities: normalized.policy.deniedCapabilities,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  switch (normalized.provider) {
    case "filesystem":
      return {
        ...header,
        provider: "filesystem",
        boundary: { kind: "filesystem", root: normalized.boundary.root },
      };
    case "web":
      return {
        ...header,
        provider: "web",
        boundary: { kind: "web", baseUrl: normalized.boundary.baseUrl },
      };
    case "github":
      return {
        ...header,
        provider: "github",
        boundary: { kind: "github", ...normalized.boundary },
      };
    case "linear":
      return {
        ...header,
        provider: "linear",
        boundary: { kind: "linear", ...normalized.boundary },
      };
    case "application":
      return {
        ...header,
        provider: "application",
        boundary: { kind: "application", ...normalized.boundary },
      };
    case "computed":
      return {
        ...header,
        provider: "computed",
        boundary: { kind: "computed", ...normalized.boundary },
      };
    default:
      return {
        ...header,
        provider: normalized.provider,
        boundary: { kind: normalized.provider, ...normalized.boundary },
      };
  }
}

export function resourceFromRow(row: ResourceRow, source: ResourceSource): Resource {
  if (row.provider !== source.provider) {
    throw new ResourceCatalogError(
      "provider-mismatch",
      `Stored resource provider ${row.provider} does not match source ${source.provider}`,
    );
  }
  const normalized = normalizeResourceAddress(
    source,
    parsedJson(row.address_json, "Resource address"),
  );
  if (normalized.canonicalKey !== row.canonical_key) {
    throw new ResourceCatalogError(
      "invalid-input",
      `Stored resource canonical key is invalid: ${row.id}`,
    );
  }
  const header = {
    id: normalizeResourceId(row.id),
    sourceId: normalizeResourceId(row.source_id, "Resource source ID"),
    version: row.version,
    addressVersion: row.address_version,
    mediaType: row.media_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  switch (normalized.address.kind) {
    case "filesystem":
      return { ...header, provider: "filesystem", address: normalized.address };
    case "web":
      return { ...header, provider: "web", address: normalized.address };
    case "github":
      return { ...header, provider: "github", address: normalized.address };
    case "linear":
      return { ...header, provider: "linear", address: normalized.address };
    case "application":
      return { ...header, provider: "application", address: normalized.address };
    case "computed":
      return { ...header, provider: "computed", address: normalized.address };
    default:
      return { ...header, provider: normalized.address.kind, address: normalized.address };
  }
}
