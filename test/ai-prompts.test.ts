import { afterEach, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_AI_PROMPT_DIRECTORY, initializeAiPrompts, loadGotoPrompt, loadInboxPrompts } from "../src/ai-prompts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function directory() {
  const root = await mkdtemp(join(tmpdir(), "ai-prompts-")); roots.push(root);
  await cp(DEFAULT_AI_PROMPT_DIRECTORY, root, { recursive: true });
  return root;
}

test("missing and blank instructions never silently fall back to packaged prompts", async () => {
  const root = await directory();
  const path = join(root, "inbox-editor.md");
  await writeFile(path, " \n");
  await expect(loadInboxPrompts(root)).rejects.toThrow("file must not be empty");
  await rm(path);
  await expect(loadInboxPrompts(root)).rejects.toThrow("cannot read file");
});

test("Jev prompt edits must retain the result contracts consumed by the application", async () => {
  const root = await directory();
  const path = join(root, "inbox-relationships.json");
  const original = JSON.parse(await readFile(path, "utf8"));
  original.relationship.criteria.newOption = "Another option";
  await writeFile(path, JSON.stringify(original));
  await expect(loadInboxPrompts(root)).rejects.toThrow("relationship.criteria must contain exactly duplicate, related, unrelated");
  await writeFile(join(root, "goto-ranking.json"), JSON.stringify({ instructions: "Rank", criteria: ["zero", "one", "two", "three", "four"] }));
  await expect(loadGotoPrompt(root)).rejects.toThrow("exactly four score descriptions");
});

test("oversized prompt files are rejected before entering model context", async () => {
  const root = await directory();
  await writeFile(join(root, "inbox-editor.md"), "x".repeat(64 * 1024 + 1));
  await expect(loadInboxPrompts(root)).rejects.toThrow("file exceeds 64 KiB");
});

test("workspace initialization seeds once and never resets custom, invalid or removed files", async () => {
  const parent = await mkdtemp(join(tmpdir(), "ai-prompts-seed-")); roots.push(parent);
  const root = join(parent, "prompts");
  await initializeAiPrompts(root);
  expect((await loadInboxPrompts(root)).editor).toContain("Inbox editor");
  const editor = join(root, "inbox-editor.md");
  await writeFile(editor, "My custom instructions");
  await initializeAiPrompts(root);
  expect((await loadInboxPrompts(root)).editor).toBe("My custom instructions");
  await writeFile(editor, "");
  await initializeAiPrompts(root);
  await expect(loadInboxPrompts(root)).rejects.toThrow("must not be empty");
  await rm(editor);
  await initializeAiPrompts(root);
  await expect(loadInboxPrompts(root)).rejects.toThrow("cannot read file");
});
