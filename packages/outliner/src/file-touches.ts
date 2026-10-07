/**
 * The files an agent's session touches, as blocks (PIE-602): one `[file::]` block per file per session, under
 * `[[recent-files]]` › its day › its project › its session, updated on each touch with a count, the last time and
 * the lines added and removed. The Claude mod's Edit and Write hook calls this (`outliner agent touch-file`), so the
 * outline keeps "what did that session change" without anyone writing it down.
 *
 * The outline owns the shape: where the hub is, how a day, project and session are found again, what a touch block
 * says. The writes go through the service as the agent, with its session as provenance, like every agent write.
 *
 *   Recent files [page::recent-files]
 *     By project [type::virtual-branch-folder]          one view per project, its touches newest first
 *       ep0ch [type::virtual-branch] [query::type=file-touch AND project=ep0ch] …
 *     2026-10-06 [file-day::2026-10-06]
 *       ep0ch [file-project::ep0ch]
 *         session 1a2b3c4d [file-session::<id>]
 *           src/main.ts [file::/work/ep0ch/src/main.ts] [type::file-touch] [day::…] [project::…] [session::…] [touches::3] …
 *
 * Views have no group-by, so day › project › session is the tree itself, and project › session › day is a view per
 * project (sorted by its last touch, its session and day shown on each row).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import type { OutlinerServiceStatus } from "@ep0ch/outline-core/protocol";
import type { AgentActor, AgentToolsClient } from "./agent-tools";
import { WorkToolRefusal } from "./work-tools";
import type { Block, PropertyFilter, VisibleBlockCollection } from "./types";

export const RECENT_FILES_PAGE = "recent-files";
export const FILE_TOUCH_TYPE = "file-touch";

export interface TouchFileInput {
  /** The file's absolute path. */
  path: string;
  /** The project: the repository's or folder's name. */
  project: string;
  /** Where the project starts (the repository root): the block names the file relative to it. */
  projectRoot?: string;
  /** The agent session that touched it. */
  session: string;
  /** When (an ISO time); default now. */
  at?: string;
  /** Lines this touch added and removed. */
  added?: number;
  removed?: number;
  /** The day it is filed under, `YYYY-MM-DD` in the agent's local time; default the UTC day of `at`. */
  day?: string;
  /**
   * The file as it was before the session first touched it, for a file outside git: kept once, in the outline's
   * folder (`file-touches/<session>/`), so its diff can be read later. Ignored after the first touch, and where the
   * outline's folder is on another machine.
   */
  original?: string;
}

export interface TouchFileResult {
  id: string;
  ref: string;
  revision: number;
  created: boolean;
  touches: number;
  added: number;
  removed: number;
  /** Where the copy from before the first touch is kept, when one was. */
  snapshot?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A property value can't hold a `]` or a line break; a name can't be empty. */
const value = (v: string, what: string) => {
  const s = v.trim();
  if (!s || /[\]\n\r]/.test(s)) throw new WorkToolRefusal(`${what} must be one line without "]"`);
  return s;
};
const count = (v: unknown, what: string) => {
  if (v === undefined) return 0;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new WorkToolRefusal(`${what} must be a whole number`);
  return v;
};

/** The block's own properties, by key (the first value). */
function props(b: Block): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of b.properties ?? []) if (!out.has(p.key)) out.set(p.key, p.value);
  return out;
}

async function findOne(client: AgentToolsClient, filters: PropertyFilter[], under?: string): Promise<Block | null> {
  const found = await client.request<VisibleBlockCollection>({
    action: "blocks.query",
    query: { limit: 2, filters, ...(under ? { subtreeRootId: under } : {}) },
  });
  return (found.blocks as Block[]).find(b => !b.effectiveDeletedRootId) ?? null;
}

async function create(client: AgentToolsClient, parentId: string | null, text: string, actor: AgentActor): Promise<Block> {
  return client.request<Block>({ action: "create", text, parentId, author: "agent", provenance: { actorId: actor.actorId, ...(actor.sessionId ? { sessionId: actor.sessionId } : {}) } });
}

/** The live children of `parentId` carrying `[key::value]`, oldest first. */
async function matching(client: AgentToolsClient, parentId: string, key: string, val: string): Promise<Block[]> {
  const found = await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { limit: 20, filters: [{ key, value: val }], subtreeRootId: parentId } });
  return (found.blocks as Block[]).filter(b => b.parentId === parentId && !b.effectiveDeletedRootId)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * A child of `parentId` carrying `[key::value]`, made with `text` when there is none. Two sessions filing their first
 * touch of a day at once may both make one: each looks again after making it, and the one that isn't the oldest is
 * trashed while still empty, so both go on under the same block.
 */
async function ensure(client: AgentToolsClient, parentId: string, key: string, val: string, text: string, actor: AgentActor): Promise<Block> {
  const found = await matching(client, parentId, key, val);
  if (found.length) return found[0]!;
  const made = await create(client, parentId, text, actor);
  const now = await matching(client, parentId, key, val);
  const first = now[0] ?? made;
  if (first.id !== made.id) await client.request({ action: "delete", blockId: made.id, ifEmpty: true, mutation: mutationOf(actor) }).catch(() => {});
  return first;
}

const mutationOf = (actor: AgentActor) => ({ author: "agent" as const, actorId: actor.actorId, ...(actor.sessionId ? { sessionId: actor.sessionId } : {}) });

/** The hub: the `[[recent-files]]` page, with its "By project" folder, made the first time. */
async function hub(client: AgentToolsClient, actor: AgentActor): Promise<{ hub: Block; byProject: Block }> {
  const resolve = async () => {
    const page = await client.request<{ block?: Block }>({ action: "pages.resolve", address: RECENT_FILES_PAGE }).catch(() => ({ block: undefined }));
    return page.block && !page.block.effectiveDeletedRootId ? page.block : null;
  };
  let root = await resolve();
  if (!root) {
    const made = await create(client, null, `Recent files [page::${RECENT_FILES_PAGE}]\nThe files agents' sessions touched, by day › project › session; By project shows each project's, newest first. Written by the Claude mod as files are edited (PIE-602).`, actor);
    // Another session made it at the same moment: the page the address resolves to wins, and ours goes while empty.
    root = (await resolve()) ?? made;
    if (root.id !== made.id) await client.request({ action: "delete", blockId: made.id, ifEmpty: true, mutation: mutationOf(actor) }).catch(() => {});
  }
  const byProject = await ensure(client, root.id, "file-touches", "by-project", "By project [file-touches::by-project]", actor);
  return { hub: root, byProject };
}

/** Records one touch: the file's block for this session made, or its count, last time and lines brought up to date. */
export async function touchFile(client: AgentToolsClient, input: TouchFileInput, actor: AgentActor): Promise<TouchFileResult> {
  if (!input || typeof input !== "object") throw new WorkToolRefusal("Give path, project and session");
  const path = value(String(input.path ?? ""), "path");
  if (!path.startsWith("/")) throw new WorkToolRefusal("path must be absolute");
  const project = value(String(input.project ?? ""), "project");
  const session = value(String(input.session ?? ""), "session");
  const at = input.at === undefined ? new Date().toISOString() : value(String(input.at), "at");
  if (Number.isNaN(Date.parse(at))) throw new WorkToolRefusal("at must be an ISO time");
  const day = input.day === undefined ? at.slice(0, 10) : value(String(input.day), "day");
  if (!DAY.test(day)) throw new WorkToolRefusal("day must be YYYY-MM-DD");
  const added = count(input.added, "added"), removed = count(input.removed, "removed");
  const root = input.projectRoot?.trim();
  const shown = root && path.startsWith(`${root.replace(/\/+$/, "")}/`) ? path.slice(root.replace(/\/+$/, "").length + 1) : path;
  await client.requireCompatibleService();

  // The session's block for this file, wherever its day put it: one per file per session. Its counts are read again
  // and the write tried again when another write got there first (a revision conflict), so no touch is lost.
  for (let attempt = 0; ; attempt++) {
  const existing = await findOne(client, [{ key: "type", value: FILE_TOUCH_TYPE }, { key: "session", value: session }, { key: "file", value: path }]);
  if (!existing) break;
  try {
    const p = props(existing);
    const snapshot = p.get("snapshot");
    const touches = (Number(p.get("touches")) || 1) + 1;
    const sum = { added: (Number(p.get("added")) || 0) + added, removed: (Number(p.get("removed")) || 0) + removed };
    const text = touchText(shown, { path, day: p.get("day") ?? day, project: p.get("project") ?? project, session, touches, at, ...sum, ...(snapshot ? { snapshot } : {}) });
    const updated = await client.request<Block>({ action: "update", blockId: existing.id, text, expectedRevision: existing.revision, mutation: mutationOf(actor) });
    return { id: updated.id, ref: `((${updated.id}))`, revision: updated.revision, created: false, touches, ...sum, ...(snapshot ? { snapshot } : {}) };
  } catch (error) {
    if (attempt >= 4 || !/revision/i.test(error instanceof Error ? error.message : String(error))) throw error;
  }
  }

  const { hub: h, byProject } = await hub(client, actor);
  const dayBlock = await ensure(client, h.id, "file-day", day, `${day} [file-day::${day}]`, actor);
  const projectBlock = await ensure(client, dayBlock.id, "file-project", project, `${project} [file-project::${project}]`, actor);
  const sessionBlock = await ensure(client, projectBlock.id, "file-session", session, `session ${session.slice(0, 8)} [file-session::${session}]`, actor);
  // This project's view under By project, made with its first touch.
  await ensure(client, byProject.id, "file-project-view", project,
    `${project} [file-project-view::${project}] [type::virtual-branch] [query::type=${FILE_TOUCH_TYPE} AND project=${JSON.stringify(project)}] [sort::last-touch] [direction::desc] [summary-properties::session, day, touches]`, actor);
  const snapshot = typeof input.original === "string" ? keepOriginal(await client.requireCompatibleService() as OutlinerServiceStatus, session, path, input.original) : null;
  const made = await create(client, sessionBlock.id, touchText(shown, { path, day, project, session, touches: 1, at, added, removed, ...(snapshot ? { snapshot } : {}) }), actor);
  return { id: made.id, ref: `((${made.id}))`, revision: made.revision, created: true, touches: 1, added, removed, ...(snapshot ? { snapshot } : {}) };
}

/** The copy from before the first touch, written once into the outline's folder when it is on this machine; its path, or null. */
function keepOriginal(status: OutlinerServiceStatus, session: string, path: string, original: string): string | null {
  const folder = status.location?.workspaceRoot;
  if (!folder || status.location?.hostname !== hostname()) return null;
  // Named by hashes, so no session id or file name can reach outside the folder or share another's copy.
  const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
  const dir = join(folder, "file-touches", hash(session));
  const file = join(dir, `${hash(path)}-${path.split("/").pop()!.replace(/[^\w.-]/g, "_").slice(0, 60)}`);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Written once: the first writer's copy stays (`wx` fails when it is there already).
    try { writeFileSync(file, original, { mode: 0o600, flag: "wx" }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    return file;
  } catch { return null; }
}

/** A touch block's text: the file as the project names it, then its properties. */
export function touchText(shown: string, t: { path: string; day: string; project: string; session: string; touches: number; at: string; added: number; removed: number; snapshot?: string }): string {
  return `${shown} [file::${t.path}] [type::${FILE_TOUCH_TYPE}] [day::${t.day}] [project::${t.project}] [session::${t.session}] [touches::${t.touches}] [last-touch::${t.at}] [added::${t.added}] [removed::${t.removed}]${t.snapshot ? ` [snapshot::${t.snapshot}]` : ""}`;
}
