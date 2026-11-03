/*
 * What each wire action is, declared once (PIE-1531). Every action a client, an agent or an extension sends has one
 * row here: who answers it (the outline host or one outline), whether a read-only copy answers it, what an
 * extension's grant may make of it, whether it can be watched, which lane of the loop it waits in, whether only the
 * async path answers it, and the change event a successful answer broadcasts. The service's gates read the rows:
 *
 * - `OutlineHost` answers `host` rows itself, and a read-only host answers `copy` ones (`copyAnswers`).
 * - `OutlinerServer` refuses on a read-only copy what `copyAnswers` doesn't, gates an extension's grant by `extensionMay`,
 *   throws for `host` and `async` rows in its sync `handle`, and builds the broadcast with `eventOf`.
 * - `Turns` (loop-watch.ts) puts `whole` reads last; `QueryWatches` keeps `watch` reads (`isWatchable`).
 *
 * The record is closed over the request union: a new action fails `bun run check` until it has a row. The handlers
 * stay in server.ts, which owns dispatch (CONTRIBUTING.md, Source boundaries). `test/actions.test.ts` holds the table.
 */
import type { TemplateStampResult } from "./template-stamp";
import type {
  AnnotationAgentProposalReceipt, AnnotationBatchReceipt, AttentionClientState, Block, BookmarkRemoveReceipt, BookmarkToggleReceipt,
  BrowsingContextPublication, CaptureReceipt, ComputedExecutionResult, ComputedInvocation, DeliveryReceipt, DeliverySyncReceipt,
  InternResourceReceipt, NavigationState, NewNoteReceipt, OutlinerEvent, OutlinerNavigationDispatch, OutlinerRequest, OutlinerResponse,
  PageAddressFollowResult, QuickCaptureDraft, QuoteReceipt, Resource, ResourceDescription, ResourceProviderCommandResult,
  ResourceRetentionCollectionReceipt, ResourceRetentionPin, ResourceRetentionReference, RoadmapItemCreateReceipt,
  VirtualOccurrenceMoveResult, WorkflowPromotionReceipt,
} from "./types";

/** Actions the outline host answers that the request union doesn't carry (outline-host.ts, the extension call reference). */
type OffUnion = "echonet.list" | "mcp.access.files" | "secrets.group";
export type ActionName = OutlinerRequest["action"] | OffUnion;
type RequestOf<A extends string> = Extract<OutlinerRequest, { action: A }> extends never ? { action: A } : Extract<OutlinerRequest, { action: A }>;
type Answered = Extract<OutlinerResponse, { ok: true }>;

/** What a successful answer broadcasts, beyond its id, action and sequence (the server adds those). */
export type EventFields = Pick<OutlinerEvent, "domain"> & Partial<Pick<OutlinerEvent, "blockId" | "resourceId" | "sourceId" | "contextId" | "command" | "attention" | "attentionInstruction">>;

export interface ActionDecl<R = OutlinerRequest> {
  /** Answered by the outline host, never by one outline (outline-host.ts `handleHostAction`). */
  host?: true;
  /** A plain read: a read-only copy answers it, and an extension's call may make it. Implies `copy` and `ext: "read"`. */
  read?: true;
  /** A read-only copy answers it, though an extension's call may not (the web client's pages of a copy, its shares). */
  copy?: true;
  /**
   * What an extension's grant may make of it beyond a plain read: `read` (a read only extensions ask), `write` (a grant
   * that writes; attributed `ext:<id>`), `mail` (EchoNet's node mail, outside the access level, ADR 0005). Left out, an
   * extension's call is refused.
   */
  ext?: "read" | "write" | "mail";
  /** Only the async path answers it (`handleAsync`); the sync `handle` refuses it. */
  async?: true;
  /** A read a client may watch (ADR 0004): outline-core's `WATCHABLE_ACTIONS`, which the table test holds to these rows. */
  watch?: true;
  /** A read that walks the whole outline: it waits behind every other request (loop-watch.ts, PIE-625). */
  whole?: true;
  /** The change event a successful answer broadcasts, or null when nothing changed; left out, none. */
  event?: (request: R, response: Answered, previousSequence: number) => EventFields | null;
}

type Decls = { [A in ActionName]: ActionDecl<RequestOf<A>> };

const content = (blockId?: string): EventFields => ({ domain: "content", blockId });
const catalog = (resourceId?: string): EventFields => ({ domain: "resource-catalog", resourceId });
const resultId = (value: unknown, label: string): string => {
  if (typeof value !== "object" || value === null || !("id" in value) || typeof value.id !== "string") throw new Error(`${label} result is missing its ID`);
  return value.id;
};
const reconcileChanged = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || !("changed" in value) || typeof value.changed !== "boolean") throw new Error("Annotation reconcile result is missing its changed flag");
  return value.changed;
};
const onBlock = (request: { blockId: string }) => content(request.blockId);
const ifChanged = (request: { blockId: string }, { sequence }: Answered, previous: number) => sequence === previous ? null : content(request.blockId);
const onAnnotation = (request: { input: { annotationId: string } }) => content(request.input.annotationId);
const savedBlock = (_: unknown, { result }: Answered) => content((result as Block).id);
const captured = (_: unknown, { result }: Answered) => { const r = result as CaptureReceipt; return r.deduplicated ? null : content(r.block.id); };
const annotated = (_: unknown, { result }: Answered) => { const r = result as AnnotationBatchReceipt; return r.deduplicated ? null : content(r.annotations[0]?.block.id); };
const invocation = (_: unknown, { result }: Answered) => catalog((result as ComputedInvocation).resourceId);
const interned = (_: unknown, { result }: Answered) => { const r = result as InternResourceReceipt; return r.created ? catalog(r.resource.id) : null; };
const described = (_: unknown, { result }: Answered) => catalog((result as ResourceDescription).resource.id);
const removed = (_: unknown, { result }: Answered) => (result as { removed: boolean }).removed ? catalog() : null;
const navigated = (_: unknown, { result }: Answered): EventFields => ({ domain: "selection", blockId: (result as NavigationState).selection.selected?.id });
type AttentionInput = { input: { target: { sourceBlockId: string }; targetRegion?: unknown; markId: string; reveal?: boolean; focus?: boolean } };
const attentionMarked = (request: AttentionInput, { result }: Answered): EventFields => ({
  domain: "attention", blockId: request.input.target.sourceBlockId, attention: result as AttentionClientState,
  attentionInstruction: {
    ...(request.input.targetRegion ? { targetRegion: request.input.targetRegion } : {}),
    markId: request.input.markId, reveal: request.input.reveal ?? false, focus: request.input.focus ?? false,
  } as OutlinerEvent["attentionInstruction"],
});
const attentionCleared = (request: { input: { markId?: string } }, { result }: Answered): EventFields => {
  const attention = result as AttentionClientState;
  return { domain: "attention", attention, blockId: attention.marks.find(mark => !request.input.markId || mark.markId === request.input.markId)?.target.sourceBlockId };
};

export const ACTIONS = {
  "activity.recent": { ext: "read", whole: true },
  "agents.held": { read: true },
  "agents.yolo": {},
  "annotations.agent-evidence": {},
  "annotations.agent-package": {},
  "annotations.agent-receipt": {},
  "annotations.approve-resolution": { event: onAnnotation },
  "annotations.batch": { ext: "write", event: annotated },
  "annotations.create": { ext: "write", event: annotated },
  "annotations.get": { ext: "read" },
  "annotations.lifecycle": { event: onAnnotation },
  "annotations.list": { read: true },
  "annotations.propose-agent": { event: (request, { result }) => (result as AnnotationAgentProposalReceipt).deduplicated ? null : content(request.input.annotationId) },
  "annotations.read": { event: (_, { result }) => { const r = result as { marked: number; thread: string }; return r.marked ? content(r.thread) : null; } },
  "annotations.reconcile": { event: (_, { result }) => reconcileChanged(result) ? content() : null },
  "annotations.reply": { ext: "write", event: annotated },
  "annotations.review-agent": { event: onAnnotation },
  "annotations.tldr": {},
  "annotations.update": { event: onAnnotation },
  "artifacts.backfill": { async: true },
  "artifacts.deploy": { async: true },
  "artifacts.dns": { async: true },
  "artifacts.import": { async: true },
  "artifacts.lease": { async: true },
  "artifacts.list": { copy: true, async: true },
  "artifacts.put": { async: true },
  "artifacts.rm": { async: true },
  "artifacts.show": { copy: true, async: true },
  "artifacts.snapshot": { async: true },
  "artifacts.upload.abort": { async: true },
  "artifacts.upload.begin": { async: true },
  "artifacts.upload.chunk": { async: true },
  "artifacts.upload.finish": { async: true },
  "artifacts.versions": { copy: true, async: true },
  "attention.acknowledge": { event: attentionCleared },
  "attention.advance": { event: attentionMarked },
  "attention.clear": { event: attentionCleared },
  "attention.get": {},
  "attention.mark": { event: attentionMarked },
  "block.revisions": { ext: "read" },
  "blocks.authored-links": { ext: "read", watch: true, whole: true },
  "blocks.census": { read: true },
  "blocks.context": { ext: "read" },
  "blocks.facets": { read: true, whole: true },
  "blocks.grep": { read: true, whole: true },
  "blocks.markRead": { event: (request, { result }) => (result as { marked: number }).marked ? content(request.blocks[0]?.id) : null },
  "blocks.query": { read: true, watch: true, whole: true },
  "blocks.read": { read: true },
  "blocks.records": { read: true, whole: true },
  "blocks.resolve": { read: true },
  "bookmarks.remove": { event: (_, { result }) => content((result as BookmarkRemoveReceipt).record.id) },
  "bookmarks.resolve": {},
  "bookmarks.root": {},
  "bookmarks.status": {},
  "bookmarks.toggle": { event: (_, { result }) => content((result as BookmarkToggleReceipt).record.id) },
  "browsing-context.get": {},
  "browsing-context.publish": { event: (_, { result }) => { const p = result as BrowsingContextPublication; return { domain: "browsing-context", contextId: p.contextId, blockId: p.target?.kind === "block" ? p.target.blockId : undefined, resourceId: p.target?.kind === "resource" ? p.target.resourceId : undefined, command: p.preview?.command }; } },
  "callouts.types": { read: true, whole: true },
  "capture.create": { event: captured },
  "capture.draft.clear": { event: (_, { sequence }, previous) => sequence === previous ? null : content() },
  "capture.draft.get": {},
  "capture.draft.save": { event: (_, { result, sequence }, previous) => { const blockId = sequence === previous ? undefined : (result as QuickCaptureDraft).blockId; return blockId ? content(blockId) : null; } },
  "capture.owner.claim": {},
  "capture.owner.get": {},
  "capture.owner.handoff": {},
  "capture.retitle": { event: savedBlock },
  "changes.since": { read: true },
  "checklist.query": {},
  "checklist.search": { whole: true },
  "checklist.update": { event: ifChanged },
  "children": { read: true },
  "clients.list": {},
  "clients.update": {},
  "completion.cancel": { async: true },
  "completion.picked": { async: true },
  "completion.rows": { async: true },
  "components.schemas": { ext: "read", whole: true },
  "components.usage": { ext: "read" },
  "computed.execute": { async: true, event: (_, { result }) => catalog((result as ComputedExecutionResult).receipt.resourceId) },
  "computed.executions.list": {},
  "computed.handlers.resolve": {},
  "computed.invocations.create": { event: invocation },
  "computed.invocations.revise": { event: invocation },
  "create": { ext: "write", event: (_, { result }) => (result as Block & { deduplicated?: true }).deduplicated ? null : content((result as Block).id) },
  "delete": { ext: "write", event: onBlock },
  "deliveries.ensure": { event: (_, { result }) => { const r = result as DeliveryReceipt; return r.created ? content(r.delivery.id) : null; } },
  "deliveries.sync": { event: (_, { result }) => { const r = result as DeliverySyncReceipt; return r.changed ? content(r.task.id) : null; } },
  "devices.add": { host: true },
  "devices.list": { host: true },
  "devices.revoke": { host: true },
  "devices.shortcut.get": { host: true },
  "devices.shortcut.put": { host: true },
  "door.event": {},
  "draft.patch": { ext: "write", async: true },
  "draft.proposal.apply": { async: true },
  "draft.proposal.dismiss": { async: true },
  "draft.proposal.resolve": { async: true },
  "draft.proposals.list": {},
  "drafts.answer": {},
  "drafts.heartbeat": {},
  "drafts.hold": {},
  "drafts.read": { async: true },
  "drafts.release": {},
  "drafts.touch": {},
  "echonet.bulletin": { ext: "mail", async: true },
  "echonet.list": { host: true },
  "echonet.put": { ext: "mail", async: true },
  "echonet.take": { ext: "mail", async: true },
  "edit-recovery.commit": { event: savedBlock },
  "edit-recovery.discard": {},
  "edit-recovery.get": {},
  "edit-recovery.list": {},
  "edit-recovery.propose": {},
  "edit-recovery.refresh": {},
  "edit-recovery.restore": {},
  "edit-recovery.separate": { event: savedBlock },
  "edit-recovery.start": {},
  "events.subscribe": { read: true },
  "extensions.act": { async: true },
  "extensions.args": { ext: "read", async: true },
  "extensions.bar": { async: true },
  "extensions.configure": { async: true },
  "extensions.install": { async: true },
  "extensions.list": { read: true, async: true },
  "extensions.render": {},
  "extensions.schedule.run": { async: true },
  "extensions.undo": { async: true },
  "extensions.uninstall": { async: true },
  "files.complete": {},
  "files.read": {},
  "fragments.at": { ext: "read" },
  "fragments.candidates": { ext: "read", whole: true },
  "fragments.ensure": { event: ifChanged },
  "fragments.read": { ext: "read" },
  "get": { read: true },
  "headings.styles": { ext: "read", whole: true },
  "loki.lease.revoke": { host: true },
  "loki.lease.start": { host: true },
  "loki.lease.use": { host: true },
  "mcp.access.configure": { event: () => content() },
  "mcp.access.files": { host: true },
  "mcp.access.status": { read: true },
  "mentions.clear": { event: (_, { result }) => (result as { removed: number }).removed ? { domain: "mentions" } : null },
  "mentions.ingest": { event: (_, { result }) => { const r = result as { deduplicated: boolean; references: number }; return r.deduplicated || !r.references ? null : { domain: "mentions" }; } },
  "mentions.list": {},
  "mentions.message": {},
  "mentions.save": { event: captured },
  "move": { ext: "write", event: onBlock },
  "navigation.back": { event: navigated },
  "navigation.dispatch": { event: (request, { result }) => ({ domain: "ui", command: (result as OutlinerNavigationDispatch).command, blockId: request.target.kind === "block" ? request.target.blockId : undefined, resourceId: request.target.kind === "resource" ? request.target.resourceId : undefined }) },
  "navigation.forward": { event: navigated },
  "navigation.link.get": {},
  "navigation.link.set": {},
  "navigation.resolve": {},
  "navigation.state": {},
  "notes.address": { ext: "read", async: true },
  "notes.create": { event: (_, { result }) => content((result as NewNoteReceipt).block.id) },
  "notes.render": { ext: "read", async: true },
  "notes.route": {},
  "outline.snapshot": { copy: true, async: true },
  "outlines.archive": { host: true },
  "outlines.attach": { host: true },
  "outlines.close": { host: true },
  "outlines.create": { host: true },
  "outlines.delete": { host: true },
  "outlines.import": { host: true },
  "outlines.list": { host: true, copy: true },
  "outlines.pane": { host: true },
  "outlines.unarchive": { host: true },
  "outputs.place": { ext: "write", async: true },
  "pages.alias": { event: onBlock },
  "pages.complete": { whole: true },
  "pages.follow": { event: (_, { result }) => { const r = result as PageAddressFollowResult; return r.created ? content(r.block?.id) : null; } },
  "pages.remove": { event: onBlock },
  "pages.rename": { event: onBlock },
  "pages.resolve": { read: true },
  "ping": { read: true },
  "properties.catalog": { ext: "read", whole: true },
  "properties.inventory": { ext: "read", whole: true },
  "properties.patch": { event: onBlock },
  "properties.preview": { ext: "read" },
  "proposals.outcomes": { ext: "read" },
  "query.matches": { read: true, watch: true, whole: true },
  "query.suggest": { async: true },
  "quote": { async: true, event: (_, { result }) => { const r = result as QuoteReceipt; return content("block" in r ? r.block.id : r.into.blockId); } },
  "reader.report": { copy: true, async: true },
  "reader.view": { copy: true, async: true },
  "references.backlinks": { read: true, watch: true, whole: true },
  "references.resolve": { ext: "read" },
  "resource-sources.create": { event: (_, { result }) => ({ domain: "resource-catalog", sourceId: resultId(result, "Resource source") }) },
  "resource-sources.get": {},
  "resource-sources.list": {},
  "resource-sources.rebind": {},
  "resources.collect": { event: (_, { result }) => { const r = result as ResourceRetentionCollectionReceipt; return r.evicted.length === 0 && r.purged.length === 0 ? null : catalog(r.resourceId ?? undefined); } },
  "resources.command.execute": { async: true, event: (_, { result }) => catalog((result as ResourceProviderCommandResult).receipt.resourceId) },
  "resources.describe": {},
  "resources.follow-authored": { async: true, event: interned },
  "resources.get": {},
  "resources.intern": { event: interned },
  "resources.intern-filesystem": { event: interned },
  "resources.lookup-filesystem": {},
  "resources.open": { async: true },
  "resources.projection.read": {},
  "resources.projection.refresh": { async: true },
  "resources.refresh": { async: true, event: described },
  "resources.relocate": { event: (_, { result }) => catalog((result as Resource).id) },
  "resources.retention.configure": { event: () => catalog() },
  "resources.retention.get": {},
  "resources.retention.inspect": {},
  "resources.retention.pin": { event: (_, { result }) => { const r = result as { pin: ResourceRetentionPin; created: boolean }; return r.created ? catalog(r.pin.resourceId) : null; } },
  "resources.retention.reference": { event: (_, { result }) => { const r = result as { reference: ResourceRetentionReference; created: boolean }; return r.created ? catalog(r.reference.resourceId) : null; } },
  "resources.retention.unpin": { event: removed },
  "resources.retention.unreference": { event: removed },
  "resources.write-filesystem": { event: described },
  "roadmap.items.attach": { async: true },
  "roadmap.items.create": { event: (_, { result }) => content((result as RoadmapItemCreateReceipt).block.id) },
  "roadmap.items.similar": { async: true },
  "rules.preview": {},
  "scripts.answer": {},
  "scripts.render": { ext: "read", async: true },
  "scripts.run": { async: true },
  "scripts.sequence": { async: true },
  "scripts.stop": { async: true },
  "search.picked": { async: true },
  "search.picks": { async: true },
  "secrets.group": { ext: "read" },
  "selection.get": {},
  "selection.set": { event: (request) => ({ domain: "selection", blockId: request.blockId ?? undefined }) },
  "shares.list": { copy: true, async: true },
  "shares.resolve": { async: true },
  "shares.revoke": { copy: true, async: true },
  "shares.snapshot.finish": { copy: true, async: true },
  "shares.snapshot.take": { copy: true, async: true },
  "shares.start": { async: true },
  "shares.tunnel": { async: true },
  "site.answer": { read: true, watch: true, whole: true },
  "site.sources": { read: true },
  "styles.list": { ext: "read", whole: true },
  "suggestions.keep": { async: true },
  "template.props": { read: true },
  "template.stamp": { event: (_, { result }) => { const stamped = (result as TemplateStampResult).stamped; return stamped.length ? content(stamped[0]!.id) : null; } },
  "template.use": { read: true, watch: true },
  "transclusions.read": { read: true },
  "trash.purge": { event: onBlock },
  "trash.restore": { event: onBlock },
  "tree.focus": { whole: true },
  "tree.index": { read: true, whole: true },
  "tree.query": { ext: "read", whole: true },
  "tree.search": { read: true, whole: true },
  "ui.command.send": { event: (request) => ({ domain: "ui", command: request.command, blockId: "target" in request.command && request.command.target?.kind === "block" ? request.command.target.blockId : request.command.command === "backlinks.select" ? request.command.targetBlockId : undefined, resourceId: "target" in request.command && request.command.target?.kind === "resource" ? request.command.target.resourceId : undefined }) },
  "update": { ext: "write", event: onBlock },
  "uploads.finish": { host: true },
  "uploads.take": { host: true },
  "views.planWrite": {},
  "views.read": { read: true, watch: true, whole: true },
  "virtual.occurrences.move": { event: (_, { result }) => { const r = result as VirtualOccurrenceMoveResult; return r.moved.length ? { domain: "view", blockId: r.viewId } : null; } },
  "virtual.occurrences.order": {},
  "virtual.occurrences.place": { event: (request) => ({ domain: "view", blockId: request.input.expected.viewId }) },
  "virtual.occurrences.reorder": { event: (request) => ({ domain: "view", blockId: request.viewId }) },
  "waiting.list": { read: true },
  "web.sessions.list": { host: true },
  "web.sessions.resolve": { host: true },
  "web.sessions.revoke": { host: true },
  "web.sessions.start": { host: true },
  "work-ids.allocate": { event: onBlock },
  "work-ids.configure": { event: () => content() },
  "work-ids.status": { ext: "read" },
  "workflows.cancel": {},
  "workflows.get": {},
  "workflows.list": {},
  "workflows.plan": {},
  "workflows.promotion.commit": { event: (_, { result }) => { const r = result as WorkflowPromotionReceipt; return r.deduplicated ? null : content(r.block.id); } },
  "workflows.promotion.preview": {},
  "workflows.start": {},
  "workflows.structure": {},
  "workflows.transition": {},
  "working-selection.get": {},
  "working-selection.recoverable": {},
  "working-selection.resume": {},
  "working-selection.save": {},
  "workspace.snapshot": { whole: true },
} satisfies Decls;

type Table = typeof ACTIONS;
const row = (action: string): ActionDecl<never> | undefined => (ACTIONS as Record<string, ActionDecl<never>>)[action];
const names = (has: (decl: ActionDecl<never>) => boolean): ReadonlySet<string> => new Set(Object.keys(ACTIONS).filter(a => has(row(a)!)));

/** The actions only `handleAsync` answers, and the host's: what the sync `handle` refuses before its switch. */
export type NotHandledHere = { [A in keyof Table]: Table[A] extends { async: true } | { host: true } ? A : never }[keyof Table];

export const isHostAction = (action: unknown): boolean => row(String(action))?.host === true;
/** Answered only by the async path (`handleAsync`). */
export const isAsyncOnly = (action: unknown): boolean => row(String(action))?.async === true;
/** What a read-only copy answers: plain reads and the copy's own (its pages, shares and snapshots). */
export const copyAnswers = (action: unknown): boolean => { const d = row(String(action)); return d?.read === true || d?.copy === true; };
/** What an extension's grant may make of an action: `read`, `write`, `mail`, or undefined (refused). */
export const extensionMay = (action: unknown): ActionDecl["ext"] | undefined => { const d = row(String(action)); return d?.ext ?? (d?.read ? "read" : undefined); };
export const isWatchable = (action: unknown): boolean => row(String(action))?.watch === true;
export const isWholeOutlineRead = (action: unknown): boolean => row(String(action))?.whole === true;

/** The event a successful answer broadcasts (`OutlinerServer.eventFor` adds its id, action and sequence), or null. */
export function eventOf(request: OutlinerRequest, response: Answered, previousSequence: number): EventFields | null {
  return row(request.action)?.event?.(request as never, response, previousSequence) ?? null;
}

/** The rows as sets, for the table test and for whoever needs to list them. */
export const DECLARED = {
  host: names(d => d.host === true), copy: names(d => d.read === true || d.copy === true), async: names(d => d.async === true),
  extension: names(d => d.ext !== undefined || d.read === true), extensionWrites: names(d => d.ext === "write"),
  watch: names(d => d.watch === true), whole: names(d => d.whole === true), events: names(d => d.event !== undefined),
} as const;
