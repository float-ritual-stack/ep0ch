import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_AI_PROMPT_DIRECTORY = fileURLToPath(new URL("../prompts/", import.meta.url));
const MAX_PROMPT_BYTES = 64 * 1024;
const PROMPT_FILENAMES = ["goto-ranking.json"];

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

export function aiPromptDirectory(directory?: string): string {
  return resolve(directory ?? process.env.OUTLINER_PROMPT_DIR ?? DEFAULT_AI_PROMPT_DIRECTORY);
}

/** Initialize a new workspace's editable files. Existing files, even invalid ones, belong to the user. */
export async function initializeAiPrompts(directory: string): Promise<void> {
  directory = resolve(directory);
  async function exists(path = directory): Promise<boolean> {
    try { await lstat(path); return true; }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
      throw error;
    }
  }
  if (await exists()) return;
  const staging = await mkdtemp(join(dirname(directory), `.${basename(directory)}-seed-`));
  try {
    // Finish each copy before cleanup can run on failure.
    for (const name of PROMPT_FILENAMES) {
      await copyFile(join(DEFAULT_AI_PROMPT_DIRECTORY, name), join(staging, name), constants.COPYFILE_EXCL);
    }
    if (await exists()) return;
    try { await rename(staging, directory); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error
        && (error.code === "EEXIST" || error.code === "ENOTEMPTY")) return;
      throw error;
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function readPrompt(directory: string, name: string): Promise<PromptRevision> {
  const path = join(directory, name);
  let bytes: Buffer;
  try { bytes = await readFile(path); }
  catch { throw new PromptFileError(path, "cannot read file; restore it or correct OUTLINER_PROMPT_DIR"); }
  if (bytes.length > MAX_PROMPT_BYTES) throw new PromptFileError(path, "file exceeds 64 KiB");
  const text = bytes.toString("utf8");
  if (!text.trim()) throw new PromptFileError(path, "file must not be empty");
  return {path,text,sha256:createHash("sha256").update(bytes).digest("hex")};
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
