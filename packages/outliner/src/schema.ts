import { Database as SqliteDatabase, type Database } from "bun:sqlite";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { BLOCK_ID_PATTERN } from "@ep0ch/outline-core/addressable-resource";
import { BLOCK_ACTIVITY_KINDS } from "./types";

/*
 * The outline database's one schema (PIE-530): the CREATE statements of the
 * current version, and nothing else. A database is stamped with
 * `PRAGMA user_version`, and this build opens only `SCHEMA_VERSION`:
 *
 * - A new, empty file gets `SCHEMA_SQL` and the stamp.
 * - Any other database whose version isn't `SCHEMA_VERSION` is refused, naming
 *   its version and the command that upgrades it. The runtime never inspects an
 *   old shape and never migrates.
 *
 * Changing the schema bumps `SCHEMA_VERSION` and adds a one-off script in
 * `scripts/migrations/` that takes a database from the previous version to the
 * new one. `ep0ch install --apply` runs it on every outline at the previous
 * version with the host stopped (PIE-617), and it is deleted once done
 * (git keeps it); for a large change, a fresh database plus `outliner import`
 * (src/outline-import.ts) is the other way. Every table is created here,
 * including those one subsystem uses alone (workflows, agent mentions), so a
 * database's shape never depends on which subsystems ran.
 */
export const SCHEMA_VERSION = 5;

/**
 * What an `@name` request came to. `waiting`: written by an agent, so it waits for r. `proposed` becomes
 * `applied` or `dismissed` when the person settles the proposal it left (PIE-510).
 */
export const AGENT_REQUEST_STATUSES = ["waiting", "running", "applied", "proposed", "dismissed", "replied", "nothing", "failed"] as const;
export type AgentRequestStatus = typeof AGENT_REQUEST_STATUSES[number];

const quoted = (values: readonly string[]) => values.map(value => `'${value}'`).join(", ");

function agentRequestsTableSql(): string {
  return `CREATE TABLE IF NOT EXISTS agent_requests (
    block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    request_key TEXT NOT NULL,
    agent TEXT NOT NULL,
    extension_id TEXT NOT NULL,
    request TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (${quoted(AGENT_REQUEST_STATUSES)})),
    message TEXT,
    reply TEXT,
    proposal_id TEXT,
    requested_by TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    answered_at TEXT,
    PRIMARY KEY (block_id, request_key)
  )`;
}

function blockActivityTableSql(): string {
  return `CREATE TABLE IF NOT EXISTS block_edit_activity (
    activity_id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    author TEXT NOT NULL CHECK (author IN ('user', 'agent', 'system')),
    actor_id TEXT,
    session_id TEXT,
    task_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN (${quoted(BLOCK_ACTIVITY_KINDS)})),
    edited_at TEXT NOT NULL
  )`;
}

/** Every table, index and trigger, with the rows a new outline starts with. */
/**
 * A Resource's provider: a built-in one, or an extension's (`ext:<id>`, Jira's `ext:jira`: any extension with a
 * `kind: "resource"` handler, resources.ts `EXTENSION_PROVIDER_PATTERN`). Schema 5 opened the providers to extensions.
 */
export const EXTENSION_PROVIDER_SQL = "(provider GLOB 'ext:[a-z0-9]*' AND provider NOT GLOB 'ext:*[^a-z0-9.-]*' AND length(provider) <= 104)";
export const RESOURCE_PROVIDER_CHECK = `CHECK (provider IN ('filesystem', 'web', 'github', 'application', 'linear', 'computed') OR ${EXTENSION_PROVIDER_SQL})`;
export const REMOTE_ENTITY_PROVIDER_CHECK = `CHECK (provider = 'linear' OR ${EXTENSION_PROVIDER_SQL})`;

/**
 * What each reader has read (PIE-708): one row per actor and block, the revision they read it at. Unread is no row;
 * updated since read is a row at a lower revision. `actor` is `user` for the person, else the agent's actor id. New in
 * version 5 (0005's migration adds it).
 */
export const READ_MARKS_SQL = `
  -- Read state per actor (read-marks.ts).
  CREATE TABLE IF NOT EXISTS read_marks (
    actor TEXT NOT NULL,
    block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    read_at TEXT NOT NULL,
    PRIMARY KEY (actor, block_id)
  ) WITHOUT ROWID;
`;

export const SCHEMA_SQL = `
  -- The outline: blocks, their derived properties, selection and history, views, work ids, page addresses, capture, extensions and agent requests (store.ts).
  CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    text TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    author TEXT NOT NULL CHECK (author IN ('user', 'agent', 'system')),
    actor_id TEXT,
    session_id TEXT,
    task_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    effective_deleted_root_id TEXT
  );
  CREATE INDEX IF NOT EXISTS blocks_parent_position ON blocks(parent_id, position);
  CREATE TABLE IF NOT EXISTS block_properties (
    block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    raw TEXT NOT NULL,
    start INTEGER NOT NULL,
    end INTEGER NOT NULL,
    line INTEGER NOT NULL,
    column INTEGER NOT NULL,
    placement TEXT NOT NULL CHECK (placement IN ('inline', 'trailing-metadata', 'metadata-line')),
    scope TEXT NOT NULL CHECK (scope IN ('block', 'line', 'inline')),
    syntax TEXT NOT NULL CHECK (syntax IN ('bracket', 'bare', 'hashtag')),
    PRIMARY KEY (block_id, ordinal)
  );
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT OR IGNORE INTO metadata (key, value) VALUES ('sequence', '0');
  -- outline_instance_id is inserted by openSchema with a fresh UUID for each new database.
  CREATE TABLE IF NOT EXISTS selection (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    block_id TEXT REFERENCES blocks(id) ON DELETE SET NULL
  );
  INSERT OR IGNORE INTO selection (singleton, block_id) VALUES (1, NULL);
  CREATE TABLE IF NOT EXISTS navigation_history (
    entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_id TEXT REFERENCES blocks(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS navigation_history_block
    ON navigation_history(block_id, entry_id);
  INSERT OR IGNORE INTO metadata (key, value) VALUES ('navigation_cursor', '0');
  CREATE TABLE IF NOT EXISTS virtual_occurrence_ranks (
    view_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL CHECK (rank >= 0),
    PRIMARY KEY (view_id, block_id),
    CHECK (view_id <> block_id)
  );
  CREATE INDEX IF NOT EXISTS virtual_occurrence_ranks_order
    ON virtual_occurrence_ranks(view_id, rank, block_id);
  CREATE TABLE IF NOT EXISTS reserved_work_ids (
    work_id TEXT PRIMARY KEY,
    reserved_at TEXT NOT NULL,
    block_id TEXT
  );
  CREATE TABLE IF NOT EXISTS work_id_allocator (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    prefix TEXT NOT NULL UNIQUE,
    next_number INTEGER NOT NULL CHECK (next_number >= 1)
  );
  CREATE TABLE IF NOT EXISTS page_addresses (
    normalized_address TEXT PRIMARY KEY,
    display_address TEXT NOT NULL,
    block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('page', 'alias', 'work-id'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS page_addresses_primary_per_block
    ON page_addresses(block_id) WHERE kind = 'page';
  CREATE UNIQUE INDEX IF NOT EXISTS page_addresses_work_id_per_block
    ON page_addresses(block_id) WHERE kind = 'work-id';
  CREATE TABLE IF NOT EXISTS capture_requests (
    request_id TEXT PRIMARY KEY,
    block_id TEXT NOT NULL,
    inbox_block_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload_hash TEXT
  );
  CREATE TABLE IF NOT EXISTS quick_capture_draft (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    request_id TEXT NOT NULL,
    text TEXT NOT NULL,
    submitted_text TEXT,
    cursor_row INTEGER NOT NULL CHECK (cursor_row >= 0),
    cursor_column INTEGER NOT NULL CHECK (cursor_column >= 0),
    captured_from_block_id TEXT REFERENCES blocks(id) ON DELETE SET NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    updated_at TEXT NOT NULL,
    block_id TEXT,
    block_revision INTEGER,
    selection_anchor TEXT
  );
  CREATE TABLE IF NOT EXISTS extension_records (
    block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
    extension_id TEXT NOT NULL,
    label TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('record', 'comment')),
    parent_block_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    resource_id TEXT,
    synced_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS extension_records_parent ON extension_records(parent_block_id, extension_id, item_key);
  CREATE INDEX IF NOT EXISTS extension_records_resource ON extension_records(resource_id);
  CREATE INDEX IF NOT EXISTS extension_records_key ON extension_records(extension_id, item_key);
  CREATE TABLE IF NOT EXISTS extension_askers (
    block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    extension_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    comments INTEGER NOT NULL DEFAULT 0 CHECK (comments >= 0),
    PRIMARY KEY (block_id, extension_id, item_key)
  );
  CREATE INDEX IF NOT EXISTS extension_askers_key ON extension_askers(extension_id, item_key);
  ${agentRequestsTableSql()};
  CREATE TABLE IF NOT EXISTS agent_request_baseline (
    block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
    request_keys TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS extension_outputs (
    block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    call_key TEXT NOT NULL,
    extension_id TEXT NOT NULL,
    handler_key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('output', 'component')),
    request TEXT NOT NULL,
    result TEXT,
    error TEXT,
    ran_at TEXT,
    attempted_at TEXT NOT NULL,
    block_revision INTEGER NOT NULL,
    extension_version INTEGER NOT NULL,
    PRIMARY KEY (block_id, call_key)
  );
  CREATE TABLE IF NOT EXISTS annotation_requests (
    request_id TEXT PRIMARY KEY,
    payload_hash TEXT,
    annotation_ids TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Block edit activity (store.ts).
  ${blockActivityTableSql()};
  CREATE INDEX IF NOT EXISTS block_edit_activity_author_cursor
    ON block_edit_activity(author, activity_id DESC);
  CREATE INDEX IF NOT EXISTS block_edit_activity_block_cursor
    ON block_edit_activity(block_id, activity_id DESC);
  CREATE INDEX IF NOT EXISTS blocks_effective_deleted ON blocks(effective_deleted_root_id, deleted_at);
  CREATE INDEX IF NOT EXISTS properties_scope_key_value
    ON block_properties(scope, key, value, block_id);

  -- The change feed (change-feed.ts).
  CREATE TABLE IF NOT EXISTS change_feed (
    change_id INTEGER PRIMARY KEY AUTOINCREMENT,
    sequence INTEGER NOT NULL,
    action TEXT NOT NULL,
    kind TEXT NOT NULL,
    block_id TEXT,
    parent_id TEXT,
    has_parent INTEGER NOT NULL DEFAULT 0,
    previous_parent_id TEXT,
    has_previous_parent INTEGER NOT NULL DEFAULT 0,
    revision INTEGER,
    deleted INTEGER,
    author TEXT,
    actor_id TEXT,
    session_id TEXT,
    task_id TEXT,
    recorded_at TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1,
    requested_by TEXT
  );
  CREATE INDEX IF NOT EXISTS change_feed_sequence ON change_feed(sequence, change_id);

  -- Working selections (working-selection.ts).
  CREATE TABLE IF NOT EXISTS working_selections (
        id TEXT PRIMARY KEY,
        owner_client_id TEXT NOT NULL UNIQUE,
        revision INTEGER NOT NULL CHECK (revision > 0),
        updated_at TEXT NOT NULL,
        targets TEXT NOT NULL
      );

  -- Resources and their snapshots and representations (resource-catalog.ts).
  CREATE TABLE IF NOT EXISTS resource_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL ${RESOURCE_PROVIDER_CHECK},
    boundary_json TEXT NOT NULL,
    policy_json TEXT NOT NULL,
    root_binding TEXT,
    version INTEGER NOT NULL CHECK (version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS resource_sources_provider
    ON resource_sources(provider, name, id);
  CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES resource_sources(id) ON DELETE RESTRICT,
    provider TEXT NOT NULL ${RESOURCE_PROVIDER_CHECK},
    address_json TEXT NOT NULL,
    canonical_key TEXT NOT NULL,
    media_type TEXT,
    address_version INTEGER NOT NULL CHECK (address_version >= 1),
    version INTEGER NOT NULL CHECK (version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (source_id, canonical_key)
  );
  CREATE TABLE IF NOT EXISTS web_source_snapshots (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
    address_version INTEGER NOT NULL CHECK (address_version >= 1),
    canonical_url TEXT,
    content_hash TEXT,
    revision_json TEXT NOT NULL,
    etag TEXT,
    last_modified TEXT,
    html TEXT,
    fetched_at TEXT,
    payload_state TEXT NOT NULL DEFAULT 'available'
      CHECK (payload_state IN ('available','evicted')),
    payload_bytes INTEGER NOT NULL DEFAULT 0 CHECK (payload_bytes >= 0),
    evicted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS web_source_snapshots_resource
    ON web_source_snapshots(resource_id, address_version, fetched_at, id);
  CREATE UNIQUE INDEX IF NOT EXISTS web_source_snapshots_available_content
    ON web_source_snapshots(
      resource_id, address_version, canonical_url, content_hash, revision_json
    )
    WHERE html IS NOT NULL AND canonical_url IS NOT NULL AND content_hash IS NOT NULL;
  CREATE TABLE IF NOT EXISTS web_representations (
    id TEXT PRIMARY KEY,
    source_snapshot_id TEXT NOT NULL
      REFERENCES web_source_snapshots(id) ON DELETE RESTRICT,
    media_type TEXT NOT NULL CHECK (media_type = 'text/markdown'),
    adapter_id TEXT NOT NULL,
    adapter_version INTEGER NOT NULL CHECK (adapter_version >= 1),
    content_hash TEXT NOT NULL,
    markdown TEXT,
    derived_at TEXT,
    payload_state TEXT NOT NULL DEFAULT 'available'
      CHECK (payload_state IN ('available','evicted')),
    payload_bytes INTEGER NOT NULL DEFAULT 0 CHECK (payload_bytes >= 0),
    evicted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS web_representations_snapshot
    ON web_representations(source_snapshot_id, derived_at, id);
  CREATE UNIQUE INDEX IF NOT EXISTS web_representations_available_content
    ON web_representations(
      source_snapshot_id, media_type, adapter_id, adapter_version, content_hash
    )
    WHERE markdown IS NOT NULL;
  CREATE TABLE IF NOT EXISTS web_resource_state (
    resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
    address_version INTEGER NOT NULL CHECK (address_version >= 1),
    generation INTEGER NOT NULL CHECK (generation >= 1),
    source_snapshot_id TEXT REFERENCES web_source_snapshots(id) ON DELETE RESTRICT,
    representation_id TEXT REFERENCES web_representations(id) ON DELETE RESTRICT,
    freshness TEXT NOT NULL
      CHECK (freshness IN ('fresh', 'stale', 'unknown', 'refreshing', 'failed')),
    checked_at TEXT,
    last_error TEXT
  );
  CREATE TABLE IF NOT EXISTS pdf_source_snapshots (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
    address_version INTEGER NOT NULL CHECK (address_version >= 1),
    locator TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    revision_json TEXT NOT NULL,
    etag TEXT,
    last_modified TEXT,
    bytes BLOB,
    captured_at TEXT NOT NULL,
    payload_state TEXT NOT NULL DEFAULT 'available'
      CHECK (payload_state IN ('available','evicted')),
    payload_bytes INTEGER NOT NULL DEFAULT 0 CHECK (payload_bytes >= 0),
    evicted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS pdf_source_snapshots_resource
    ON pdf_source_snapshots(resource_id, address_version, captured_at, id);
  CREATE UNIQUE INDEX IF NOT EXISTS pdf_source_snapshots_content
    ON pdf_source_snapshots(resource_id, address_version, content_hash, revision_json);
  CREATE TABLE IF NOT EXISTS pdf_representations (
    id TEXT PRIMARY KEY,
    source_snapshot_id TEXT NOT NULL
      REFERENCES pdf_source_snapshots(id) ON DELETE RESTRICT,
    media_type TEXT NOT NULL
      CHECK (media_type IN ('application/pdf', 'text/markdown')),
    adapter_id TEXT NOT NULL,
    adapter_version INTEGER NOT NULL CHECK (adapter_version >= 1),
    content_hash TEXT NOT NULL,
    markdown TEXT,
    pages_json TEXT,
    derived_at TEXT NOT NULL,
    payload_state TEXT NOT NULL DEFAULT 'available'
      CHECK (payload_state IN ('available','evicted')),
    payload_bytes INTEGER NOT NULL DEFAULT 0 CHECK (payload_bytes >= 0),
    evicted_at TEXT,
    CHECK (
      (media_type = 'application/pdf' AND markdown IS NULL AND pages_json IS NULL) OR
      (
        media_type = 'text/markdown' AND
        (
          (payload_state = 'available' AND markdown IS NOT NULL AND pages_json IS NOT NULL) OR
          (payload_state = 'evicted' AND markdown IS NULL AND pages_json IS NULL)
        )
      )
    )
  );
  CREATE INDEX IF NOT EXISTS pdf_representations_snapshot
    ON pdf_representations(source_snapshot_id, derived_at, id);
  CREATE UNIQUE INDEX IF NOT EXISTS pdf_representations_content
    ON pdf_representations(
      source_snapshot_id, media_type, adapter_id, adapter_version, content_hash
    );
  CREATE TABLE IF NOT EXISTS pdf_resource_state (
    resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
    address_version INTEGER NOT NULL CHECK (address_version >= 1),
    generation INTEGER NOT NULL CHECK (generation >= 1),
    source_snapshot_id TEXT REFERENCES pdf_source_snapshots(id) ON DELETE RESTRICT,
    representation_id TEXT REFERENCES pdf_representations(id) ON DELETE RESTRICT
  );
  CREATE TABLE IF NOT EXISTS remote_entity_source_snapshots (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
    address_version INTEGER NOT NULL CHECK (address_version >= 1),
    provider TEXT NOT NULL ${REMOTE_ENTITY_PROVIDER_CHECK},
    entity_id TEXT NOT NULL,
    revision_json TEXT NOT NULL,
    payload_json TEXT,
    captured_at TEXT NOT NULL,
    payload_state TEXT NOT NULL DEFAULT 'available'
      CHECK (payload_state IN ('available','evicted')),
    payload_bytes INTEGER NOT NULL DEFAULT 0 CHECK (payload_bytes >= 0),
    evicted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS remote_entity_source_snapshots_resource
    ON remote_entity_source_snapshots(resource_id, address_version, captured_at, id);
  CREATE UNIQUE INDEX IF NOT EXISTS remote_entity_source_snapshots_revision
    ON remote_entity_source_snapshots(
      resource_id, address_version, provider, entity_id, revision_json
    );
  CREATE TABLE IF NOT EXISTS remote_entity_representations (
    id TEXT PRIMARY KEY,
    source_snapshot_id TEXT NOT NULL
      REFERENCES remote_entity_source_snapshots(id) ON DELETE RESTRICT,
    media_type TEXT NOT NULL CHECK (media_type = 'text/markdown'),
    adapter_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    content_hash TEXT NOT NULL,
    markdown TEXT,
    derived_at TEXT NOT NULL,
    payload_state TEXT NOT NULL DEFAULT 'available'
      CHECK (payload_state IN ('available','evicted')),
    payload_bytes INTEGER NOT NULL DEFAULT 0 CHECK (payload_bytes >= 0),
    evicted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS remote_entity_representations_snapshot
    ON remote_entity_representations(source_snapshot_id, derived_at, id);
  CREATE UNIQUE INDEX IF NOT EXISTS remote_entity_representations_content
    ON remote_entity_representations(
      source_snapshot_id, media_type, adapter_id, version, content_hash
    );
  CREATE TABLE IF NOT EXISTS remote_entity_resource_state (
    resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
    address_version INTEGER NOT NULL CHECK (address_version >= 1),
    generation INTEGER NOT NULL CHECK (generation >= 1),
    source_snapshot_id TEXT
      REFERENCES remote_entity_source_snapshots(id) ON DELETE RESTRICT,
    representation_id TEXT
      REFERENCES remote_entity_representations(id) ON DELETE RESTRICT,
    freshness TEXT NOT NULL
      CHECK (freshness IN ('fresh', 'stale', 'unknown', 'refreshing', 'failed')),
    checked_at TEXT,
    last_error TEXT
  );
  CREATE TABLE IF NOT EXISTS computed_invocations (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL UNIQUE REFERENCES resources(id) ON DELETE RESTRICT,
    source_id TEXT NOT NULL REFERENCES resource_sources(id) ON DELETE RESTRICT,
    producer_id TEXT NOT NULL,
    producer_version INTEGER NOT NULL CHECK (producer_version >= 1),
    input_version INTEGER NOT NULL CHECK (input_version >= 1),
    inputs_json TEXT NOT NULL,
    dependencies_json TEXT NOT NULL,
    declaration_json TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS computed_invocations_source
    ON computed_invocations(source_id, producer_id, id);
  CREATE TABLE IF NOT EXISTS computed_representations (
    id TEXT PRIMARY KEY,
    cache_key TEXT,
    producer_id TEXT NOT NULL,
    producer_version INTEGER NOT NULL CHECK (producer_version >= 1),
    input_version INTEGER NOT NULL CHECK (input_version >= 1),
    dependency_fingerprint TEXT NOT NULL,
    media_type TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS computed_representations_cache_key
    ON computed_representations(cache_key)
    WHERE cache_key IS NOT NULL;
  CREATE TABLE IF NOT EXISTS computed_executions (
    id TEXT PRIMARY KEY,
    invocation_id TEXT NOT NULL
      REFERENCES computed_invocations(id) ON DELETE RESTRICT,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
    generation INTEGER NOT NULL CHECK (generation >= 1),
    producer_id TEXT NOT NULL,
    producer_version INTEGER NOT NULL CHECK (producer_version >= 1),
    input_version INTEGER NOT NULL CHECK (input_version >= 1),
    dependency_fingerprint TEXT NOT NULL,
    dependencies_json TEXT NOT NULL,
    cache_hit INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0, 1)),
    status TEXT NOT NULL CHECK (status IN ('executing', 'succeeded', 'failed')),
    output_kind TEXT CHECK (
      output_kind IS NULL OR output_kind IN (
        'transient-representation',
        'immutable-snapshot',
        'durable-resource',
        'failure'
      )
    ),
    media_type TEXT,
    output_content_hash TEXT,
    representation_id TEXT
      REFERENCES computed_representations(id) ON DELETE RESTRICT,
    durable_resource_id TEXT REFERENCES resources(id) ON DELETE RESTRICT,
    failure_code TEXT,
    failure_message TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS computed_executions_resource
    ON computed_executions(resource_id, started_at, id);
  CREATE TABLE IF NOT EXISTS computed_resource_state (
    resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
    invocation_id TEXT NOT NULL UNIQUE
      REFERENCES computed_invocations(id) ON DELETE RESTRICT,
    generation INTEGER NOT NULL CHECK (generation >= 1),
    status TEXT NOT NULL CHECK (status IN ('idle', 'executing', 'succeeded', 'failed')),
    selected_execution_id TEXT
      REFERENCES computed_executions(id) ON DELETE RESTRICT,
    representation_id TEXT
      REFERENCES computed_representations(id) ON DELETE RESTRICT,
    durable_resource_id TEXT REFERENCES resources(id) ON DELETE RESTRICT,
    last_failure_execution_id TEXT
      REFERENCES computed_executions(id) ON DELETE RESTRICT,
    started_at TEXT,
    completed_at TEXT
  );

  -- Resource retention (resource-retention.ts).
  CREATE TABLE IF NOT EXISTS resource_retention_policy (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    retain_newest_source_snapshots INTEGER NOT NULL CHECK(retain_newest_source_snapshots >= 0),
    retain_newest_representations_per_adapter INTEGER NOT NULL CHECK(retain_newest_representations_per_adapter >= 0),
    minimum_age_ms INTEGER NOT NULL CHECK(minimum_age_ms >= 0),
    purge_grace_ms INTEGER NOT NULL CHECK(purge_grace_ms >= 0),
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS resource_retention_pins (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
    artifact_kind TEXT NOT NULL CHECK(artifact_kind IN ('source-snapshot','representation')),
    artifact_id TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(artifact_kind, artifact_id)
  );
  CREATE INDEX IF NOT EXISTS resource_retention_pins_resource
    ON resource_retention_pins(resource_id, created_at, id);
  CREATE TABLE IF NOT EXISTS resource_retention_references (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
    artifact_kind TEXT NOT NULL CHECK(artifact_kind IN ('source-snapshot','representation')),
    artifact_id TEXT NOT NULL,
    owner_kind TEXT NOT NULL CHECK(owner_kind IN ('review','publication')),
    owner_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(artifact_kind, artifact_id, owner_kind, owner_id)
  );
  CREATE INDEX IF NOT EXISTS resource_retention_references_resource
    ON resource_retention_references(resource_id, created_at, id);
  CREATE TABLE IF NOT EXISTS resource_retention_events (
    id TEXT PRIMARY KEY,
    artifact_kind TEXT NOT NULL CHECK(artifact_kind IN ('source-snapshot','representation')),
    artifact_id TEXT NOT NULL,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
    transition TEXT NOT NULL CHECK(transition IN ('evicted','purged')),
    occurred_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json))
  );
  CREATE INDEX IF NOT EXISTS resource_retention_events_resource
    ON resource_retention_events(resource_id, occurred_at, id);

  -- Annotations: targets, resolution history, agent requests, resource evidence (annotation-repository.ts).
  CREATE TABLE IF NOT EXISTS annotation_targets (
    annotation_block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
    block_id TEXT REFERENCES blocks(id) ON DELETE RESTRICT,
    resource_id TEXT REFERENCES resources(id) ON DELETE RESTRICT,
    legacy_source_block_id TEXT,
    legacy_file_path TEXT,
    original_target_json TEXT NOT NULL CHECK(json_valid(original_target_json)),
    created_at TEXT NOT NULL,
    CHECK (
      (block_id IS NOT NULL AND resource_id IS NULL AND legacy_source_block_id IS NULL AND legacy_file_path IS NULL) OR
      (block_id IS NULL AND resource_id IS NOT NULL AND legacy_source_block_id IS NULL AND legacy_file_path IS NULL) OR
      (block_id IS NULL AND resource_id IS NULL AND legacy_source_block_id IS NOT NULL AND legacy_file_path IS NOT NULL)
    )
  );
  CREATE INDEX IF NOT EXISTS annotation_targets_block ON annotation_targets(block_id, created_at, annotation_block_id);
  CREATE INDEX IF NOT EXISTS annotation_targets_reference_context ON annotation_targets(
    json_extract(original_target_json, '$.referenceContext.representation.subject.blockId'));
  CREATE INDEX IF NOT EXISTS annotation_targets_resource ON annotation_targets(resource_id, created_at, annotation_block_id);
  CREATE INDEX IF NOT EXISTS annotation_targets_legacy_file ON annotation_targets(legacy_source_block_id, legacy_file_path, annotation_block_id);
  CREATE TRIGGER IF NOT EXISTS annotation_targets_immutable
  BEFORE UPDATE ON annotation_targets
  BEGIN SELECT RAISE(ABORT, 'annotation original targets are immutable'); END;
  CREATE TABLE IF NOT EXISTS annotation_migration_quarantine (
    annotation_block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
    raw_text TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS annotation_resolution_events (
    id TEXT PRIMARY KEY,
    annotation_block_id TEXT NOT NULL REFERENCES annotation_targets(annotation_block_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK(sequence >= 0),
    source_representation_json TEXT NOT NULL CHECK(json_valid(source_representation_json)),
    target_representation_json TEXT NOT NULL CHECK(json_valid(target_representation_json)),
    resolved_target_json TEXT CHECK(resolved_target_json IS NULL OR json_valid(resolved_target_json)),
    method_json TEXT NOT NULL CHECK(json_valid(method_json)),
    reviewer_json TEXT NOT NULL CHECK(json_valid(reviewer_json)),
    confidence REAL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    candidates_json TEXT NOT NULL CHECK(json_valid(candidates_json) AND json_type(candidates_json) = 'array'),
    status TEXT NOT NULL CHECK(status IN ('resolved','probable','unresolved','ambiguous','orphaned','unsupported','rejected')),
    applies_current INTEGER NOT NULL CHECK(applies_current IN (0,1)),
    created_at TEXT NOT NULL,
    passage_resolution_json TEXT CHECK(passage_resolution_json IS NULL OR json_valid(passage_resolution_json)),
    UNIQUE(annotation_block_id, sequence),
    CHECK (
      (status = 'resolved' AND applies_current = 1 AND resolved_target_json IS NOT NULL AND confidence IS NOT NULL) OR
      (status = 'probable' AND resolved_target_json IS NULL AND confidence IS NOT NULL AND json_array_length(candidates_json) > 0 AND (applies_current = 1 OR (applies_current = 0 AND json_extract(method_json, '$.kind') = 'agent'))) OR
      (status = 'unresolved' AND applies_current = 1 AND resolved_target_json IS NULL AND ((confidence IS NULL AND json_array_length(candidates_json) = 0) OR (confidence IS NOT NULL AND json_array_length(candidates_json) > 0))) OR
      (status IN ('ambiguous','orphaned') AND resolved_target_json IS NULL AND ((applies_current = 1 AND confidence IS NULL) OR (applies_current = 0 AND confidence IS NOT NULL AND json_extract(method_json, '$.kind') = 'agent'))) OR
      (status = 'unsupported' AND applies_current = 1 AND resolved_target_json IS NULL AND confidence IS NULL) OR
      (status = 'rejected' AND applies_current = 0 AND resolved_target_json IS NULL)
    )
  );;
  CREATE INDEX IF NOT EXISTS annotation_resolution_history ON annotation_resolution_events(annotation_block_id, sequence);
  CREATE INDEX IF NOT EXISTS annotation_current_resolution ON annotation_resolution_events(annotation_block_id, applies_current, sequence DESC);
  CREATE TRIGGER IF NOT EXISTS annotation_resolution_events_append_only
  BEFORE UPDATE ON annotation_resolution_events
  BEGIN SELECT RAISE(ABORT, 'annotation resolution events are append-only'); END;
  CREATE TABLE IF NOT EXISTS annotation_agent_requests (
    request_id TEXT PRIMARY KEY,
    payload_hash TEXT NOT NULL,
    event_id TEXT NOT NULL REFERENCES annotation_resolution_events(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS annotation_resource_evidence_refs (
    id TEXT PRIMARY KEY,
    annotation_block_id TEXT NOT NULL
      REFERENCES annotation_targets(annotation_block_id) ON DELETE CASCADE,
    resolution_event_id TEXT
      REFERENCES annotation_resolution_events(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (
      role IN (
        'original-target',
        'event-source',
        'event-target',
        'event-resolved',
        'event-candidate'
      )
    ),
    source_snapshot_id TEXT
      REFERENCES web_source_snapshots(id) ON DELETE RESTRICT,
    representation_id TEXT
      REFERENCES web_representations(id) ON DELETE RESTRICT,
    pdf_source_snapshot_id TEXT
      REFERENCES pdf_source_snapshots(id) ON DELETE RESTRICT,
    pdf_representation_id TEXT
      REFERENCES pdf_representations(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    CHECK (
      source_snapshot_id IS NOT NULL OR representation_id IS NOT NULL OR
      pdf_source_snapshot_id IS NOT NULL OR pdf_representation_id IS NOT NULL
    )
  );
  CREATE INDEX IF NOT EXISTS annotation_resource_evidence_refs_source_snapshot
    ON annotation_resource_evidence_refs(source_snapshot_id, annotation_block_id)
    WHERE source_snapshot_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS annotation_resource_evidence_refs_representation
    ON annotation_resource_evidence_refs(representation_id, annotation_block_id)
    WHERE representation_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS annotation_resource_evidence_refs_pdf_source_snapshot
    ON annotation_resource_evidence_refs(pdf_source_snapshot_id, annotation_block_id)
    WHERE pdf_source_snapshot_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS annotation_resource_evidence_refs_pdf_representation
    ON annotation_resource_evidence_refs(pdf_representation_id, annotation_block_id)
    WHERE pdf_representation_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS annotation_resource_evidence_refs_unique
    ON annotation_resource_evidence_refs(
      annotation_block_id,
      ifnull(resolution_event_id, ''),
      role,
      ifnull(source_snapshot_id, ''),
      ifnull(representation_id, ''),
      ifnull(pdf_source_snapshot_id, ''),
      ifnull(pdf_representation_id, '')
    );

  -- Workflows (workflows.ts).
  CREATE TABLE IF NOT EXISTS workflow_runs (
    run_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    action_id TEXT NOT NULL,
    invocation_json TEXT NOT NULL,
    capabilities_json TEXT NOT NULL,
    limits_json TEXT NOT NULL,
    planner TEXT NOT NULL,
    target_client_id TEXT,
    provenance_json TEXT,
    status TEXT NOT NULL,
    route_json TEXT NOT NULL,
    current_step_index INTEGER,
    branch_question_json TEXT,
    metrics_json TEXT,
    comparison_json TEXT,
    result_block_ids_json TEXT NOT NULL,
    cancellation_requested INTEGER NOT NULL DEFAULT 0,
    request_hash TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS workflow_runs_updated ON workflow_runs(updated_at DESC);
  CREATE TABLE IF NOT EXISTS workflow_promotions (
    request_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
    step_id TEXT NOT NULL,
    annotation_id TEXT NOT NULL REFERENCES blocks(id),
    block_id TEXT NOT NULL REFERENCES blocks(id),
    proposal_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Preserved history, read only. The removed Inbox agent and note assistance (PIE-613) kept the
  -- person's original writing here: each result's recovery_json holds the before-images of the notes
  -- it rewrote. capture-history.ts reads inbox_agent_results ("Preserved capture", raw-capture and
  -- before-rewrite links); nothing reads note_assistance_results yet (PIE-345). Nothing writes either.
  CREATE TABLE IF NOT EXISTS inbox_agent_results (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    suppressed_revision INTEGER,
    payload_hash TEXT NOT NULL,
    result_json TEXT NOT NULL CHECK (json_valid(result_json)),
    recovery_json TEXT CHECK (recovery_json IS NULL OR json_valid(recovery_json)),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS inbox_agent_results_source ON inbox_agent_results(source_id, suppressed_revision);
  CREATE TABLE IF NOT EXISTS note_assistance_results (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
    source_parent_id TEXT,
    payload_hash TEXT NOT NULL,
    result_json TEXT NOT NULL CHECK (json_valid(result_json)),
    recovery_json TEXT CHECK (recovery_json IS NULL OR json_valid(recovery_json)),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS note_assistance_results_source ON note_assistance_results(source_id);

  -- Agent mentions (mentions.ts).
  CREATE TABLE IF NOT EXISTS agent_mention_messages (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      message_key TEXT NOT NULL UNIQUE,
      payload_hash TEXT NOT NULL,
      message_json TEXT NOT NULL CHECK(json_valid(message_json))
     );

  -- Earlier texts of blocks (PIE-621): each revision's text, kept when the next one replaces it, so a saved note
  -- can go back (block.revisions). The current text is the block's own; the newest REVISIONS_KEEP are kept a block.
  CREATE TABLE IF NOT EXISTS block_revisions (
    block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    text TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    author TEXT,
    actor_id TEXT,
    replaced_at TEXT NOT NULL,
    PRIMARY KEY (block_id, revision)
  );

  -- Edit recovery (edit-recovery.ts).
  CREATE TABLE IF NOT EXISTS edit_recovery (
        id TEXT PRIMARY KEY, block_id TEXT NOT NULL, revision INTEGER NOT NULL,
        state TEXT NOT NULL, input_hash TEXT NOT NULL, payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ); CREATE INDEX IF NOT EXISTS edit_recovery_block ON edit_recovery(block_id,state,updated_at);
${READ_MARKS_SQL}
`;

const userVersion = (database: Database) => (database.query("PRAGMA user_version").get() as { user_version: number }).user_version;

export const OUTLINE_INSTANCE_ID_KEY = "outline_instance_id";

/** The one-off script for schema 4 → 5, which also repairs a version-5 database without an outline instance id. */
const REPAIR_SCRIPT = join(import.meta.dir, "../scripts/migrations/0005-extension-providers.ts");

export function readOutlineInstanceId(database: Database, path: string): string {
  const row = database.query("SELECT value FROM metadata WHERE key = ?").get(OUTLINE_INSTANCE_ID_KEY) as { value: string } | null;
  const value = row?.value;
  if (!value || !BLOCK_ID_PATTERN.test(value)) {
    const { stop, start } = hostUnitCommands();
    throw new Error(`The outline database ${path} has no valid outline instance id. Repair it with:\n\n${[stop, `bun ${shWord(REPAIR_SCRIPT)} ${shWord(path)}`, start].map(l => `  ${l}`).join("\n")}`);
  }
  return value.toLowerCase();
}

export function insertOutlineInstanceId(database: Database, value = randomUUID()): string {
  if (!BLOCK_ID_PATTERN.test(value)) throw new Error(`outline instance id must be a UUID, got ${JSON.stringify(value)}`);
  database.query("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)").run(OUTLINE_INSTANCE_ID_KEY, value.toLowerCase());
  return value.toLowerCase();
}

const MIGRATIONS = join(import.meta.dir, "../scripts/migrations");

/** A path as a shell word: as it is when it needs no quoting, else single-quoted. */
const shWord = (word: string) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`);

/** The one-off script that upgrades a database at `version` to SCHEMA_VERSION, when there is one: 0001-stamp for 0, else the step's (`<SCHEMA_VERSION>-*.ts`). */
function upgradeScript(version: number): string | null {
  const prefix = version === 0 ? "0001-" : version === SCHEMA_VERSION - 1 ? `${String(SCHEMA_VERSION).padStart(4, "0")}-` : null;
  if (!prefix) return null;
  try { const file = readdirSync(MIGRATIONS).find(f => f.startsWith(prefix) && f.endsWith(".ts")); return file ? join(MIGRATIONS, file) : null; } catch { return null; }
}

/** The outline host's unit on this platform, as `ep0ch install` finds it on the machines that matter: its stop and start commands. */
export function hostUnitCommands(platform: string = process.platform, home: string = homedir()): { stop: string; start: string } {
  if (platform === "darwin") return { stop: "launchctl bootout gui/$(id -u)/io.ep0ch.outliner-host", start: `launchctl bootstrap gui/$(id -u) ${shWord(join(home, "Library/LaunchAgents/io.ep0ch.outliner-host.plist"))}` };
  return { stop: "systemctl --user stop outliner-host.service", start: "systemctl --user start outliner-host.service" };
}

/** The other outlines beside `path` (`<name>.sqlite` in its folder) at the same schema version: one migration covers them all. */
function behindBeside(path: string, version: number): string[] {
  const out: string[] = [];
  try {
    for (const file of readdirSync(dirname(path)).sort()) {
      const other = join(dirname(path), file);
      if (!file.endsWith(".sqlite") || resolve(other) === resolve(path)) continue;
      try {
        const db = new SqliteDatabase(other, { readonly: true });
        try { if (userVersion(db) === version) out.push(other); } finally { db.close(); }
      } catch { /* not an outline we can read: left out */ }
    }
  } catch { /* the folder can't be listed */ }
  return out;
}

/**
 * Why a database at `version` is refused, and what to run (PIE-617): one sentence, then the exact commands for this
 * machine with real paths, each on its own line, uncoloured, so it can be pasted as it is. With a script for the
 * step, `ep0ch install --apply` (which stops the host, migrates every outline behind and starts it) and the same by
 * hand; without one, the import route. `path`: the file, when there is one (its folder's other outlines behind join it).
 */
export function schemaRefusal(label: string, version: number, path?: string, o: { platform?: string; home?: string } = {}): string {
  const head = `${label} is schema version ${version}${version === 0 ? " (made before schema versions)" : ""}; this build opens only schema version ${SCHEMA_VERSION}.`;
  const block = (lines: string[]) => lines.map(l => `  ${l}`).join("\n");
  const { stop, start } = hostUnitCommands(o.platform, o.home);
  const script = upgradeScript(version);
  const file = path ? resolve(path) : null;
  if (!file) {
    return `${head}${script ? ` Its migration: bun ${shWord(script)} on the file, with the outline host stopped.` : " No script upgrades that version; import it into a new outline instead (ep0ch outline import)."}`;
  }
  if (script) {
    const files = [file, ...(version === SCHEMA_VERSION - 1 ? behindBeside(file, version) : [])];
    const install = version === SCHEMA_VERSION - 1 ? `Migrate it${files.length > 1 ? `, and the ${files.length - 1} other outline${files.length === 2 ? "" : "s"} here at schema ${version},` : ""} with:\n\n${block(["ep0ch install --apply"])}\n\nor by hand:` : "Migrate it by hand:";
    return `${head}\n${install}\n\n${block([stop, ...files.map(f => `bun ${shWord(script)} ${shWord(f)}`), start])}`;
  }
  const name = basename(file).replace(/\.sqlite$/, "");
  const old = `${file}.schema-${version}`;
  return `${head}\nNo script migrates schema ${version} to ${SCHEMA_VERSION}; import its notes into a new outline:\n\n${block([stop, `mv ${shWord(file)} ${shWord(old)}`, start, `ep0ch outline import ${shWord(old)} ${shWord(name)}`])}`;
}

/**
 * Opens a database at `SCHEMA_VERSION`: an empty file is given the schema and
 * stamped (`created`); a database already at it is left alone (`current`).
 * Anything else throws, naming its version and how to upgrade it.
 */
export function openSchema(database: Database, label = "This database", path?: string): "created" | "current" {
  const version = userVersion(database);
  if (version === SCHEMA_VERSION) return "current";
  const { objects } = database.query("SELECT COUNT(*) AS objects FROM sqlite_master").get() as { objects: number };
  if (version === 0 && objects === 0) {
    database.transaction(() => {
      database.exec(SCHEMA_SQL);
      insertOutlineInstanceId(database);
      database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    })();
    return "created";
  }
  throw new Error(schemaRefusal(label, version, path));
}
