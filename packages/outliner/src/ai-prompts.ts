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

/** The "anything here answers it?" Noul a search asks beside its scores (PIE-1198). */
export interface ExistsQuestion { instructions: string; true: string; false: string }

/**
 * goto-ranking.json: the Score each candidate gets, and `exists`, the Noul over the list. A workspace's copy made
 * before `exists` was added keeps its ranking and asks the shipped file's `exists` (both revisions are reported).
 */
export async function loadGotoPrompt(directory?: string): Promise<{ ranking: Question<string[]>; exists: ExistsQuestion; structured: Question<string[]>; revisions: PromptRevision[] }> {
  const revision = await readPrompt(aiPromptDirectory(directory), "goto-ranking.json");
  const parsed = json(revision);
  const has = (key: string) => !!parsed && typeof parsed === "object" && Object.hasOwn(parsed, key);
  const hasExists = has("exists");
  const data = object(parsed, revision.path, ["instructions", "criteria", ...(hasExists ? ["exists"] : []), ...(has("structured") ? ["structured"] : [])], "document");
  if (!Array.isArray(data.criteria) || data.criteria.length !== 4) {
    throw new PromptFileError(revision.path, "criteria must contain exactly four score descriptions (0–3)");
  }
  const revisions = [revision];
  let exists: unknown = data.exists, existsPath = revision.path, structured: unknown = data.structured, structuredPath = revision.path;
  if (!hasExists || !has("structured")) {
    const shipped = await readPrompt(resolve(DEFAULT_AI_PROMPT_DIRECTORY), "goto-ranking.json");
    const ship = json(shipped) as Record<string, unknown>;
    if (!hasExists) { exists = ship.exists; existsPath = shipped.path; }
    if (!has("structured")) { structured = ship.structured; structuredPath = shipped.path; }
    if (shipped.path !== revision.path) revisions.push(shipped);
  }
  const e = object(exists, existsPath, ["instructions", "true", "false"], "exists");
  const st = object(structured, structuredPath, ["instructions", "criteria"], "structured");
  if (!Array.isArray(st.criteria) || st.criteria.length !== 4) throw new PromptFileError(structuredPath, "structured.criteria must contain exactly four score descriptions (0–3)");
  return {
    ranking: {
      instructions: nonempty(data.instructions, revision.path, "instructions"),
      criteria: data.criteria.map((value, i) => nonempty(value, revision.path, `criteria[${i}]`)),
    },
    structured: { instructions: nonempty(st.instructions, structuredPath, "structured.instructions"), criteria: st.criteria.map((v, i) => nonempty(v, structuredPath, `structured.criteria[${i}]`)) },
    exists: { instructions: nonempty(e.instructions, existsPath, "exists.instructions"), true: nonempty(e.true, existsPath, "exists.true"), false: nonempty(e.false, existsPath, "exists.false") },
    revisions,
  };
}

/**
 * deep-search.json (PIE-1200): the Choice a window of notes is asked and its "is it among these?" Noul. A prompt
 * folder without it (a workspace's, made before it) reads the shipped one.
 */
export async function loadDeepPrompt(directory?: string): Promise<{ choice: string; exists: ExistsQuestion; revisions: PromptRevision[] }> {
  let revision: PromptRevision;
  try { revision = await readPrompt(aiPromptDirectory(directory), "deep-search.json"); }
  catch (error) {
    if (!(error instanceof PromptFileError) || aiPromptDirectory(directory) === resolve(DEFAULT_AI_PROMPT_DIRECTORY)) throw error;
    revision = await readPrompt(resolve(DEFAULT_AI_PROMPT_DIRECTORY), "deep-search.json");
  }
  const data = object(json(revision), revision.path, ["choice", "exists"], "document");
  const e = object(data.exists, revision.path, ["instructions", "true", "false"], "exists");
  return {
    choice: nonempty(data.choice, revision.path, "choice"),
    exists: { instructions: nonempty(e.instructions, revision.path, "exists.instructions"), true: nonempty(e.true, revision.path, "exists.true"), false: nonempty(e.false, revision.path, "exists.false") },
    revisions: [revision],
  };
}

/**
 * figure-fit.json (PIE-721): the choice's instructions and the two gate questions figure-fit.ts asks. The agent tools
 * read it (OUTLINER_PROMPT_DIR, else the shipped one); it is never copied into an outline's folder, which they don't
 * read. A prompt folder without it (one made for goto-ranking alone) reads the shipped one.
 */
export async function loadFigureFitPrompt(directory?: string): Promise<{ instructions: string; structured: string; prose: string; revisions: PromptRevision[] }> {
  let revision: PromptRevision;
  try { revision = await readPrompt(aiPromptDirectory(directory), "figure-fit.json"); }
  catch (error) {
    if (!(error instanceof PromptFileError) || aiPromptDirectory(directory) === resolve(DEFAULT_AI_PROMPT_DIRECTORY)) throw error;
    revision = await readPrompt(resolve(DEFAULT_AI_PROMPT_DIRECTORY), "figure-fit.json");
  }
  const data = object(json(revision), revision.path, ["instructions", "structured", "prose"], "document");
  return {
    instructions: nonempty(data.instructions, revision.path, "instructions"),
    structured: nonempty(data.structured, revision.path, "structured"),
    prose: nonempty(data.prose, revision.path, "prose"),
    revisions: [revision],
  };
}

/** The questions write-review.ts asks Jev about a note an agent wrote (PIE-1388), each by its name; `{section}` and `{line}` are the state path asked about. */
export const WRITE_REVIEW_QUESTIONS = ["kit", "structured", "prose", "dense", "mixed", "context", "argues", "title", "asks", "unclear", "qa", "proof", "experience"] as const;
export type WriteReviewPrompt = Record<typeof WRITE_REVIEW_QUESTIONS[number], string> & { revisions: PromptRevision[] };

/**
 * write-review.json (PIE-1388): every question Jev is asked about a written note, in one file, so the wording is
 * audited and tuned in one place. Read as loadFigureFitPrompt reads its own: OUTLINER_PROMPT_DIR, else the shipped one.
 */
export async function loadWriteReviewPrompt(directory?: string): Promise<WriteReviewPrompt> {
  let revision: PromptRevision;
  try { revision = await readPrompt(aiPromptDirectory(directory), "write-review.json"); }
  catch (error) {
    if (!(error instanceof PromptFileError) || aiPromptDirectory(directory) === resolve(DEFAULT_AI_PROMPT_DIRECTORY)) throw error;
    revision = await readPrompt(resolve(DEFAULT_AI_PROMPT_DIRECTORY), "write-review.json");
  }
  const data = object(json(revision), revision.path, [...WRITE_REVIEW_QUESTIONS], "document");
  return { ...Object.fromEntries(WRITE_REVIEW_QUESTIONS.map(k => [k, nonempty(data[k], revision.path, k)])) as Record<typeof WRITE_REVIEW_QUESTIONS[number], string>, revisions: [revision] };
}

/** The questions the workboard's Jev loops ask (work-jev.ts): twins at filing, the groom, what to try. `{candidate}` is the item asked about. */
export const WORK_JEV_QUESTIONS = ["same", "part", "ships", "replaces", "duplicate", "unfinished", "tries", "shows"] as const;
export type WorkJevPrompt = Record<typeof WORK_JEV_QUESTIONS[number], string> & { revisions: PromptRevision[] };

/** work-jev.json: every question the workboard's loops ask Jev, in one file, read as loadWriteReviewPrompt reads its own. */
export async function loadWorkJevPrompt(directory?: string): Promise<WorkJevPrompt> {
  let revision: PromptRevision;
  try { revision = await readPrompt(aiPromptDirectory(directory), "work-jev.json"); }
  catch (error) {
    if (!(error instanceof PromptFileError) || aiPromptDirectory(directory) === resolve(DEFAULT_AI_PROMPT_DIRECTORY)) throw error;
    revision = await readPrompt(resolve(DEFAULT_AI_PROMPT_DIRECTORY), "work-jev.json");
  }
  const data = object(json(revision), revision.path, [...WORK_JEV_QUESTIONS], "document");
  return { ...Object.fromEntries(WORK_JEV_QUESTIONS.map(k => [k, nonempty(data[k], revision.path, k)])) as Record<typeof WORK_JEV_QUESTIONS[number], string>, revisions: [revision] };
}
