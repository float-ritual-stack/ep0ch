import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { InboxResult, InboxStatus } from "../../src/inbox-types";
import type { Block, CaptureReceipt } from "../../src/types";
import { runHerdrScenario, type HerdrScenarioSession } from "./herdr-runner";

const PROMPT_DIRECTORY = "prompts";
const PROMPT_FILES = ["inbox-editor.md", "inbox-relationships.json", "goto-ranking.json"];
const AUTHORED_TEXT = "AI prompts fixture [file::prompts/inbox-editor.md]";

function editedPrompt(original: string, marker: string): string {
  return `${original.trimEnd()}\n\n## Prompt editing acceptance fixture\nFor captures titled "Prompt reload fixture", file the source as one clean ordinary personal note.\nPreserve the reminder, create no tasks, additional notes or updates, and include the literal text\n${marker} in the finish_cleanup summary. This is a fixture preference, not note content.\n`;
}

async function processIdentity(pid: number): Promise<{ pid: number; startTicks: string }> {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8");
  const startTicks = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
  assert.ok(startTicks, "The service process must have a readable Linux start time");
  return { pid, startTicks };
}

async function editPrompt(session: HerdrScenarioSession, text: string): Promise<void> {
  const pane = session.panes.detail;
  await session.focus(pane);
  await session.keys(pane, "e");
  await session.waitVisible(pane, "Locked for editing filesystem Resource");
  await session.keys(pane, "alt+a");
  await session.text(pane, text);
  await session.keys(pane, "ctrl+s");
  await session.waitFor("Resource edit saved to the prompt file", () =>
    readFile(join(session.projectRoot, PROMPT_DIRECTORY, "inbox-editor.md"), "utf8"), value => value === text);
  await session.waitVisible(pane, "e edit");
}

function assertPrompt(result: InboxResult, path: string, text: string): void {
  assert.equal(result.state, "applied", JSON.stringify(result));
  assert.ok(result.usage && result.usage.inputTokens > 0, "A real configured Pi model must process the note");
  const revisions = result.usage.promptRevisions;
  assert.ok(revisions, "The result must retain the prompt files loaded for this job");
  const editor = revisions.find(revision => revision.path === path);
  assert.ok(editor, `Result did not identify ${path}`);
  assert.equal(editor.text, text);
  assert.equal(editor.sha256, createHash("sha256").update(text).digest("hex"));
  assert.equal(new Set(revisions.map(revision => revision.path)).size, revisions.length,
    "Each prompt file must have exactly one revision in a job");
}

let originalEditorText = "";
const result = await runHerdrScenario({
  name: "ai-prompts", allowInboxAgent: true, allowJev: true,
  promptDirectory: PROMPT_DIRECTORY,
  async prepare(projectRoot) {
    const directory = join(projectRoot, PROMPT_DIRECTORY);
    await mkdir(directory);
    for (const name of PROMPT_FILES) {
      await copyFile(new URL(`../../prompts/${name}`, import.meta.url), join(directory, name));
    }
    originalEditorText = await readFile(join(directory, "inbox-editor.md"), "utf8");
  },
  async run(session) {
    const state = () => session.client.request<InboxStatus>({ action: "inbox.status" });
    await session.waitFor("configured Inbox agent", state, value => value.enabled, 20_000);
    const processes = JSON.parse(await readFile(join(session.artifactDirectory, "process-environments.json"), "utf8")) as Array<{
      paneId: string; pid: number; environment: Record<string, string>;
    }>;
    const service = processes.find(process => process.paneId === session.panes.service);
    assert.ok(service);
    const promptDirectory = join(session.projectRoot, PROMPT_DIRECTORY);
    const promptPath = join(promptDirectory, "inbox-editor.md");
    assert.equal(service.environment.OUTLINER_PROMPT_DIR, promptDirectory);
    const serviceBefore = await processIdentity(service.pid);

    // Author and open the file through the same Resource path a user will use.
    await session.focus(session.panes.tree);
    await session.keys(session.panes.tree, "a");
    await session.waitVisible(session.panes.tree, "↵ save");
    await session.text(session.panes.tree, AUTHORED_TEXT);
    await session.keys(session.panes.tree, "enter");
    await session.waitVisible(session.panes.tree, "AI prompts fixture");
    await session.keys(session.panes.tree, "?");
    await session.waitVisible(session.panes.tree, "Find:");
    await session.text(session.panes.tree, "Show authored links");
    await session.waitVisible(session.panes.tree, "Show or hide this block");
    await session.keys(session.panes.tree, "enter");
    await session.waitVisible(session.panes.tree, "Resource not registered");
    await session.keys(session.panes.tree, "down");
    await session.waitVisible(session.panes.tree, "1 authored Resources");
    await session.keys(session.panes.tree, "down");
    await session.waitVisible(session.panes.tree, "Enter creates the Resource");
    await session.keys(session.panes.tree, "enter");
    const registered = await session.waitFor("prompt Resource opened in Detail", () => session.registrations(), clients =>
      clients.some(client => client.runtime?.paneId === session.panes.detail && client.currentTarget?.kind === "resource"));
    const detail = registered.find(client => client.runtime?.paneId === session.panes.detail)!;
    assert.equal(detail.currentTarget?.kind, "resource");
    const resourceTarget = detail.currentTarget;
    await session.checkpoint("01-prompt-resource-opened");

    const outcomes: InboxResult[] = [];
    for (const version of [1, 2]) {
      const marker = `PROMPT-FILE-V${version}`;
      const text = editedPrompt(originalEditorText, marker);
      await editPrompt(session, text);
      await session.checkpoint(`02-prompt-version-${version}-saved`);
      // RPC creates only a synthetic capture. The production worker and real Pi
      // runtime must discover and process it; no test writes a plan or result.
      const capture = await session.client.request<CaptureReceipt>({
        action: "capture.create", requestId: `ai-prompt-e2e-${version}`, source: "cli",
        text: `Prompt reload fixture\n${version === 1 ? "Return the library book on Monday." : "Bring the blue notebook to Friday's reading group."}`,
      });
      const finished = await session.waitFor(`Inbox uses prompt version ${version}`, state,
        value => value.results.some(item => item.sourceId === capture.block.id) && !value.current, 150_000);
      const summary = finished.results.find(item => item.sourceId === capture.block.id)!;
      assert.ok(summary.usage?.promptRevisions?.every(revision => !("text" in revision)),
        "Routine progress must not retransmit historical prompt bodies");
      const outcome = await session.client.request<InboxResult>({ action: "inbox.result", resultId: summary.id });
      assertPrompt(outcome, promptPath, text);
      assert.ok(outcome.summary.includes(marker), `The actual model did not follow the edited prompt: ${outcome.summary}`);
      const source = await session.client.request<Block>({ action: "get", blockId: capture.block.id });
      assert.ok(!source.properties.some(property => property.key === "work-id"), "Personal reminders must not become roadmap tasks");
      assert.deepEqual(await processIdentity(service.pid), serviceBefore, "Prompt edits must not restart the service");
      outcomes.push(outcome);
      await session.record(`prompt-version-${version}`, { outcome, source, service: serviceBefore });
    }

    // Reading the first result after another edit must still show its original
    // instructions, rather than whichever file happens to be current now.
    const final = await state();
    const retainedFirst = await session.client.request<InboxResult>({ action: "inbox.result", resultId: outcomes[0]!.id });
    assertPrompt(retainedFirst, promptPath, editedPrompt(originalEditorText, "PROMPT-FILE-V1"));
    const detailAfter = (await session.registrations()).find(client => client.clientId === detail.clientId);
    assert.deepEqual(detailAfter?.currentTarget, resourceTarget, "Edits must retain the canonical Resource identity");
    await session.focus(session.panes.tree);
    await session.keys(session.panes.tree, "I");
    await session.waitVisible(session.panes.tree, "PROMPT-FILE-V2");
    // The overlay may restore selection of the older result. Move to the newest
    // result and prove its visible revision agrees with the file used by that job.
    await session.keys(session.panes.tree, "up");
    await session.waitVisible(session.panes.tree,
      createHash("sha256").update(editedPrompt(originalEditorText, "PROMPT-FILE-V2")).digest("hex").slice(0, 12));
    await session.checkpoint("03-edited-prompt-used-without-restart");
    await session.record("ai-prompt-evidence", {
      promptDirectory, resourceTarget, serviceBefore, serviceAfter: await processIdentity(service.pid), results: final.results,
      evidence: "Private Herdr, actual Resource authoring/edit/save keyboard actions, two synthetic RPC captures, and production Pi processing. Jev is available; usage records whether any relationship calls were needed. Both jobs ran in the same service process; each retained exact prompt text and SHA-256. Only copied fixture prompts were edited.",
      limits: "Does not claim a remote-host deployment or a prompt edit during an active model job. Deterministic tests cover in-flight snapshot stability and malformed configuration.",
    });
  },
});
console.log(JSON.stringify(result));
if (result.status !== "passed") process.exitCode = 1;
