import type { Subprocess } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Room, outlineCommand } from "./room";

let directory: string;
let room: Room;
let host: Subprocess<"ignore", "pipe", "pipe">;
const previousConfig = process.env.RETURN_ROOM_CONFIG;

beforeAll(async () => {
  directory = await mkdtemp("/tmp/rr-test-");
  const init = Bun.spawn([process.execPath, join(import.meta.dir, "demo.ts"), "init", directory], { stdout: "pipe", stderr: "pipe" });
  const [code, error] = await Promise.all([init.exited, new Response(init.stderr).text()]);
  if (code !== 0) throw new Error(error);
  host = Bun.spawn([process.execPath, join(import.meta.dir, "demo.ts"), "serve", directory], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const reader = host.stdout.getReader();
  const first = await reader.read();
  reader.releaseLock();
  if (!new TextDecoder().decode(first.value).includes('"status":"ready"')) throw new Error("Scratch host did not become ready.");
  process.env.RETURN_ROOM_CONFIG = join(directory, "room.json");
  room = await Room.fromEnv();
}, 30_000);

afterAll(async () => {
  if (host) { host.kill("SIGTERM"); await host.exited; }
  if (previousConfig === undefined) delete process.env.RETURN_ROOM_CONFIG;
  else process.env.RETURN_ROOM_CONFIG = previousConfig;
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("the room reads actual agent cards, preserving raw syntax and Unicode", async () => {
  const text = "Unclosed ((reference\n\nMoss 🪴 café — [a::b] stays exactly as captured.";
  const card = await room.publish({ title: "Moss listening", body: text, kind: "finding", session: "session-moss" });
  const snapshot = await room.snapshot();
  expect(snapshot.complete).toBe(true);
  expect(snapshot.cards.find(item => item.id === card.id)).toMatchObject({ body: text, kind: "finding", session: "session-moss", author: "agent" });
  expect(snapshot.cards.find(item => item.title === "A cabinet of listening cards")?.kind).toBe("option");
});

test("person feedback remains attached to the observed revision and originating session", async () => {
  const card = await room.publish({ title: "Cedar route", body: "Earlier alternative", kind: "option", session: "session-cedar" });
  const raw = await outlineCommand(room.config.outlines, room.config.outline, ["agent", "read", "--json", JSON.stringify({ ref: card.id, depth: 0 })]);
  await outlineCommand(room.config.outlines, room.config.outline, ["update", "--id", card.id,
    "--expected", String(card.revision), "--text", raw.text + "\nNew information", "--author", "agent", "--actor", "revision-smoke"]);
  const feedback = await room.respond({ card: card.id, revision: card.revision, verdict: "question", text: "Which observation supports this?" });
  expect(feedback).toMatchObject({ card: card.id, revision: 1, author: "user", session: "session-cedar" });
  expect((await room.snapshot()).cards.find(item => item.id === card.id)?.revision).toBe(2);
  expect((await room.inbox("session-cedar")).map(item => item.id)).toContain(feedback.id);
  expect((await room.inbox("session-moss")).map(item => item.id)).not.toContain(feedback.id);
  await expect(room.respond({ card: card.id, revision: 500, verdict: "keep" })).rejects.toThrow("observed revision");
});

test("opening and sending saved drafts never overwrites a person's file", async () => {
  const card = await room.publish({ title: "Reply target", body: "Inspect me", kind: "question", session: "session-reply" });
  const draft = await room.draft(card.id);
  await expect(room.sendDraft(card.id, 1)).rejects.toThrow("saved reply is empty");
  const text = "Keep the birdsong.\nDo not publish the visitor's name. 🪶";
  await writeFile(draft.path, text);
  await room.draft(card.id);
  const reply = await room.sendDraft(card.id, 1);
  expect(reply.text).toBe(text);
  expect(await readFile(draft.path, "utf8")).toBe(text);
  expect((await room.inbox("session-reply"))[0]?.text).toBe(text);
});

test("feedback and draft operations cannot target an unrelated outline note", async () => {
  const other = await outlineCommand(room.config.outlines, room.config.outline, ["create", "--text", "Outside the room", "--author", "agent", "--actor", "scope-smoke"]);
  await expect(room.respond({ card: other.id, revision: 1, verdict: "park" })).rejects.toThrow("not a direct child");
  await expect(room.draft(other.id)).rejects.toThrow("not a direct child");
});

test("a reply reopened in a new room instance keeps its original source revision", async () => {
  const card = await room.publish({ title: "Reopened draft", body: "Original source", kind: "option", session: "session-reopen" });
  const draft = await room.draft(card.id);
  await writeFile(draft.path, "This answer belongs to the original source.");
  const raw = await outlineCommand(room.config.outlines, room.config.outline, ["agent", "read", "--json", JSON.stringify({ ref: card.id, depth: 0 })]);
  await outlineCommand(room.config.outlines, room.config.outline, ["update", "--id", card.id,
    "--expected", "1", "--text", raw.text + "\nChanged source", "--author", "agent", "--actor", "revision-smoke"]);
  const reopened = await Room.fromEnv();
  const restored = await reopened.draft(card.id);
  expect(restored.revision).toBe(1);
  await expect(reopened.sendDraft(card.id, 2)).rejects.toThrow("draft is anchored");
  expect((await reopened.sendDraft(card.id, 1)).text).toBe("This answer belongs to the original source.");
});
