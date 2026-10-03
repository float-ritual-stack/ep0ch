import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapturePopupController } from "../src/capture-popup";
import { OutlinerStore } from "../src/store";

test("a receipt binds the original submission across edits and restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "outliner-capture-receipt-"));
  const path = join(directory, "outliner.sqlite");
  let store = new OutlinerStore(path);
  try {
    const source = store.create("Capture context");
    const original = store.capture("bound-request", "Original", "cli", source.id,
      "agent", { actorId: "codex", sessionId: "session", taskId: "task" });
    store.update(original.block.id, "Edited after capture", original.block.revision);
    store.close();
    store = new OutlinerStore(path);

    expect(store.capture("bound-request", "Original", "cli", source.id,
      "agent", { actorId: "codex", sessionId: "retry-session", taskId: "retry-call" })).toMatchObject({
      deduplicated: true, block: { id: original.block.id, text: "Edited after capture",
        actorId: "codex", sessionId: "session", taskId: "task" },
    });
    for (const changed of [
      { text: "Changed" }, { source: "tree" as const }, { context: undefined },
      { actorId: "other" },
    ]) {
      const payload = { text: "Original", source: "cli" as const, context: source.id,
        actorId: "codex", sessionId: "session", taskId: "task", ...changed };
      expect(() => store.capture("bound-request", payload.text, payload.source, payload.context,
        "agent", payload)).toThrow("different submission");
    }
    expect(store.children(original.inboxBlockId)).toHaveLength(1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("delayed cleanup cannot clear a replacement draft after the old draft was removed", () => {
  const directory = mkdtempSync(join(tmpdir(), "outliner-capture-clear-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  try {
    const old = store.saveQuickCaptureDraft({
      requestId: "old-capture", text: "Already saved", cursorRow: 0, cursorColumn: 0,
      expectedRevision: null,
    });
    store.clearQuickCaptureDraft(old.revision);
    const replacement = store.saveQuickCaptureDraft({
      requestId: "new-capture", text: "Never captured", cursorRow: 0, cursorColumn: 0,
      expectedRevision: null,
    });
    expect(() => store.clearQuickCaptureDraft(old.revision)).toThrow("Quick Capture draft changed");
    expect(store.quickCaptureDraft()).toEqual(replacement);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("capture retry retains newly typed text after the original save commits but draft cleanup fails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outliner-capture-retry-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  let failCleanup = true;
  let closes = 0;
  const popup = new CapturePopupController({
    async save(input) {
      store.capture(input.requestId, input.text, "tree", input.capturedFromBlockId);
    },
    async persistDraft(input) {
      return store.saveQuickCaptureDraft(input);
    },
    async clearDraft(revision) {
      if (failCleanup) {
        failCleanup = false;
        throw new Error("draft cleanup unavailable");
      }
      store.clearQuickCaptureDraft(revision);
    },
    close() { closes += 1; },
    invalidate() {},
  }, { requestId: "capture-before-cleanup-failure" });

  try {
    popup.handlePaste("First line");
    await popup.handleKeypress("", { name: "s", ctrl: true }, "pass");
    expect(popup.status).toContain("Capture saved; draft cleanup failed");
    popup.handlePaste("\nSecond line");
    await popup.handleKeypress("", { name: "s", ctrl: true }, "pass");

    expect(store.quickCaptureDraft()?.text).toBe("First line\nSecond line");
    expect(closes).toBe(0);
    const captures = store.queryBlocks({ filters: [{ key: "type", value: "capture" }], limit: 10 });
    expect(captures.completeness.kind).toBe("complete");
    expect(captures.blocks).toHaveLength(1);
    expect(captures.blocks[0]!.text).toStartWith("First line [type::capture]");
    expect(captures.blocks[0]!.text).not.toContain("Second line");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an uncertain capture survives popup and store restart, resolves its original submission, then saves the retained edit", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outliner-capture-reopen-"));
  const path = join(directory, "outliner.sqlite");
  let store = new OutlinerStore(path);
  let loseReply = true;
  let closes = 0;
  const effects = {
    async save(input: { requestId: string; text: string; capturedFromBlockId?: string }) {
      store.capture(input.requestId, input.text, "tree", input.capturedFromBlockId);
      if (loseReply) {
        loseReply = false;
        throw new Error("capture reply lost");
      }
    },
    async persistDraft(input: Parameters<OutlinerStore["saveQuickCaptureDraft"]>[0]) {
      return store.saveQuickCaptureDraft(input);
    },
    async clearDraft(revision: number | null) { store.clearQuickCaptureDraft(revision); },
    close() { closes += 1; },
    invalidate() {},
  };
  try {
    const first = new CapturePopupController(effects, { requestId: "uncertain-capture" });
    first.handlePaste("First line");
    await first.handleKeypress("", { name: "s", ctrl: true }, "pass");
    first.handlePaste("\nSecond line");
    await first.handleKeypress("", { name: "escape" }, "pass");
    store.close();
    store = new OutlinerStore(path);

    const reopened = new CapturePopupController(effects, {
      requestId: "new-popup", draft: store.quickCaptureDraft()!,
    });
    await reopened.handleKeypress("", { name: "s", ctrl: true }, "pass");
    expect(store.quickCaptureDraft()?.text).toBe("First line\nSecond line");
    expect(closes).toBe(1);
    expect(store.queryBlocks({ filters: [{ key: "type", value: "capture" }], limit: 10 }).blocks).toHaveLength(1);

    // The uncertain save is resolved. A subsequent explicit save captures the retained edit.
    await reopened.handleKeypress("", { name: "s", ctrl: true }, "pass");
    expect(store.quickCaptureDraft()).toBeNull();
    expect(closes).toBe(2);
    const captures = store.queryBlocks({ filters: [{ key: "type", value: "capture" }], limit: 10 });
    expect(captures.completeness.kind).toBe("complete");
    expect(captures.blocks).toHaveLength(2);
    expect(captures.blocks.filter(b => b.text.includes("Second line"))).toHaveLength(1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
