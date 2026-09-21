import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_AI_PROMPT_DIRECTORY = fileURLToPath(new URL("../prompts/", import.meta.url));
const MAX_PROMPT_BYTES = 64 * 1024;
const PROMPT_FILENAMES = ["inbox-editor.md", "inbox-relationships.json", "goto-ranking.json"];

/** Evidence of the bytes used by a job, not an editable second prompt authority. */
export interface PromptRevision {
  path: string;
  sha256: string;
  text: string;
}

export class PromptFileError extends Error {
  constructor(path: string, problem: string) {
    super(`AI prompt ${basename(path)}: ${problem} (${path})`);
    this.name = "PromptFileError";
  }
}

interface Question<Criteria> {
  instructions: string;
  criteria: Criteria;
}

export interface InboxPrompts {
  editor: string;
  relationships: {
    relationship: Question<Record<"duplicate" | "related" | "unrelated", string>>;
    coverage: Question<Record<"true" | "false", string>>;
  };
  revisions: PromptRevision[];
}

export function aiPromptDirectory(directory?: string): string {
  return resolve(directory ?? process.env.OUTLINER_PROMPT_DIR ?? DEFAULT_AI_PROMPT_DIRECTORY);
}

/** Initialize a new workspace's editable files. Existing files, even invalid ones, belong to the user. */
export async function initializeAiPrompts(directory: string): Promise<void> {
  try { await mkdir(directory); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") return;
    throw error;
  }
  await Promise.all(PROMPT_FILENAMES.map(name => copyFile(
    join(DEFAULT_AI_PROMPT_DIRECTORY, name), join(directory, name), constants.COPYFILE_EXCL,
  )));
}

async function readPrompt(directory: string, name: string): Promise<PromptRevision> {
  const path = join(directory, name);
  let bytes: Buffer;
  try { bytes = await readFile(path); }
  catch { throw new PromptFileError(path, "cannot read file; restore it or correct OUTLINER_PROMPT_DIR"); }
  if (bytes.length > MAX_PROMPT_BYTES) throw new PromptFileError(path, "file exceeds 64 KiB");
  const text = bytes.toString("utf8");
  if (!text.trim()) throw new PromptFileError(path, "file must not be empty");
  return { path, text, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function object(value: unknown, path: string, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new PromptFileError(path, `${label} must contain exactly ${keys.join(", ")}`);
  }
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, path: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new PromptFileError(path, `${label} must be a nonempty string`);
  return value;
}

function json(revision: PromptRevision): unknown {
  try { return JSON.parse(revision.text); }
  catch { throw new PromptFileError(revision.path, "invalid JSON; correct the file and retry"); }
}

function question<Keys extends string>(value: unknown, path: string, label: string, keys: Keys[]): Question<Record<Keys, string>> {
  const data = object(value, path, ["instructions", "criteria"], label);
  const criteria = object(data.criteria, path, keys, `${label}.criteria`);
  return {
    instructions: nonempty(data.instructions, path, `${label}.instructions`),
    criteria: Object.fromEntries(keys.map(key => [key, nonempty(criteria[key], path, `${label}.criteria.${key}`)])) as Record<Keys, string>,
  };
}

/** Read once at the job boundary. There is no watcher, cache, or stale-file fallback. */
export async function loadInboxPrompts(directory?: string): Promise<InboxPrompts> {
  const root = aiPromptDirectory(directory);
  const [editor, relationships] = await Promise.all([
    readPrompt(root, "inbox-editor.md"), readPrompt(root, "inbox-relationships.json"),
  ]);
  const data = object(json(relationships), relationships.path, ["relationship", "coverage"], "document");
  return {
    editor: editor.text,
    relationships: {
      relationship: question(data.relationship, relationships.path, "relationship", ["duplicate", "related", "unrelated"]),
      coverage: question(data.coverage, relationships.path, "coverage", ["true", "false"]),
    },
    revisions: [editor, relationships],
  };
}

export async function loadGotoPrompt(directory?: string): Promise<{ ranking: Question<string[]>; revisions: PromptRevision[] }> {
  const revision = await readPrompt(aiPromptDirectory(directory), "goto-ranking.json");
  const data = object(json(revision), revision.path, ["instructions", "criteria"], "document");
  if (!Array.isArray(data.criteria) || data.criteria.length !== 4) {
    throw new PromptFileError(revision.path, "criteria must contain exactly four score descriptions (0–3)");
  }
  return {
    ranking: {
      instructions: nonempty(data.instructions, revision.path, "instructions"),
      criteria: data.criteria.map((value, i) => nonempty(value, revision.path, `criteria[${i}]`)),
    },
    revisions: [revision],
  };
}
