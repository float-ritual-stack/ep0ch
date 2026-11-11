// PIE-1713: `@tidy cleanup the transcript` on a long meeting transcript stopped at tidy's 20 s and told the person to
// edit a manifest. Its deadline fits a long note through a slow model now, and a stop says what happened in the
// person's words. The transcript, the speakers and the model are made up; the model is a command that takes its time.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { failedWords, longerDeadline } from "../src/agent-requests";
import type { ExtensionsConfigured } from "@ep0ch/outline-core/protocol";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function until<T>(what: string, check: () => T | undefined | null | false, ms: number): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const value = check(); if (value) return value; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
}

/** A made-up meeting transcript of about 3,000 words, one line a turn. */
const SAYINGS = [
  "Wren: um, so the seed order went out on Tuesday and, um, the beans should land by the end of the week.",
  "Oak: right, and um, the trellis on the north bed needs another post before the wind picks up again.",
  "Wren: um, I can take the post if somebody brings the mallet from the shed, the good one.",
  "Oak: um, the compost turned last week is, um, steaming nicely, so we can spread it next month.",
];
const TRANSCRIPT = Array.from({ length: 150 }, (_, i) => SAYINGS[i % SAYINGS.length]!).join("\n");

/** What the stand-in model prints, as JS over `passage`: by default the passage with its ums out. */
const UMS_OUT = 'JSON.stringify({ replacement: passage.replaceAll("um, ", ""), message: "took the ums out" })';

async function setup(modelMs: number, deadline?: string, text = `Garden meeting\n\n${TRANSCRIPT}\n@tidy cleanup the transcript`, answer = UMS_OUT) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-tidy-long-")));
  const was = Object.fromEntries(["OUTLINER_EXTENSIONS_DIR", "OUTLINER_RESOURCE_EXTENSIONS"].map(k => [k, process.env[k]]));
  Object.assign(process.env, { OUTLINER_EXTENSIONS_DIR: join(root, "user"), OUTLINER_RESOURCE_EXTENSIONS: join(root, "none.json") });
  const folder = join(root, "outline"), tidy = join(folder, "extensions", "tidy");
  mkdirSync(join(folder, "extensions"), { recursive: true });
  cpSync(join(import.meta.dir, "..", "extensions", "tidy"), tidy, { recursive: true });
  if (deadline) {
    const manifest = JSON.parse(readFileSync(join(tidy, "extension.json"), "utf8"));
    manifest.agents[0].deadline = deadline;
    writeFileSync(join(tidy, "extension.json"), JSON.stringify(manifest));
  }
  // A slower model than Haiku: it reads the prompt, takes its time, and takes the ums out of the passage.
  const model = join(root, "model.ts");
  writeFileSync(model, `const prompt = await Bun.stdin.text();
const passage = prompt.slice(prompt.indexOf("PASSAGE:\\n") + 9);
await Bun.sleep(${modelMs});
console.log(${answer});`);
  writeFileSync(join(tidy, "config.json"), JSON.stringify({ config: { answer: [process.execPath, model] } }));
  const store = new OutlinerStore(join(root, "o.sqlite"), { workspaceRoot: folder });
  const server = new OutlinerServer(store, join(root, "o.sock"), undefined, undefined, { extensionPollMs: 0, agentRequestQuietMs: 80 });
  await server.start();
  cleanups.push(async () => {
    await server.close(); store.close();
    for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(root, { recursive: true, force: true });
  });
  const note: Block = store.create(text, null, "user");
  const client = new OutlinerClient(join(root, "o.sock"));
  return { store, note, client };
}

test("PIE-1713: tidy on a long transcript through a model that takes 30 s finishes, and the ums are gone", async () => {
  const { store, note } = await setup(30_000);
  const row = await until("tidy's answer", () => store.agentRequests(note.id).find(r => r.status !== "running" && r.status !== "waiting"), 90_000);
  expect([row.status, row.message]).toEqual(["applied", "took the ums out · the whole note above the ask"]);
  const text = store.require(note.id).text;
  expect(text).not.toContain("um, ");
  expect(text).toContain("Wren: so the seed order went out on Tuesday and, the beans should land");
}, 120_000);

test("PIE-1713: a tidy that runs past its deadline says so in the person's words, with how long the note is, not a file to edit", async () => {
  const { store, note } = await setup(5_000, "1s");
  const words = store.require(note.id).text.split(/\s+/).filter(Boolean).length;
  const row = await until("tidy's stop", () => store.agentRequests(note.id).find(r => r.status === "failed"), 30_000);
  expect(row.message).toBe(`@tidy took longer than its 1 s on this ${words.toLocaleString("en-US")}-word note and was stopped: ask it about a shorter passage, or give it longer in its settings (ep0ch act ext.tidy.settings agent.tidy.deadline=1m)`);
  expect(row.message).not.toContain("extension.json");
  expect(store.require(note.id).text).toContain("um, ");
}, 60_000);

// PIE-1737: a real transcript has blank lines between turns and says some things twice. "The transcript" is the whole
// note above the ask, and the line says so; a passage said twice is placed where tidy read it, a save meanwhile or not.
test("PIE-1737: 'clean up the transcript' takes the whole note, blank lines and repeated turns included, and says so", async () => {
  const turns = [...SAYINGS, SAYINGS[0]!, "Oak: um, okay.", "Wren: um, okay."];
  const { store, note } = await setup(200, undefined, `Garden meeting\n\n${turns.join("\n\n")}\n@tidy clean up the transcript`);
  const row = await until("tidy's answer", () => store.agentRequests(note.id).find(r => r.status !== "running" && r.status !== "waiting"), 30_000);
  expect(row.status).toBe("applied");
  expect(row.message).toBe("took the ums out · the whole note above the ask");
  const text = store.require(note.id).text;
  expect(text).not.toContain("um, ");
  expect(text).toContain("Garden meeting\n\nWren: so the seed order went out");
  expect(text.endsWith("Oak: okay.\n\nWren: okay.\n@tidy clean up the transcript")).toBe(true);
}, 60_000);

test("PIE-1737: a passage said twice is cleaned where it was read, though the note was saved while tidy ran", async () => {
  const { store, note } = await setup(1_500, undefined, "Garden meeting\n\nOak: um, okay.\n\nWren: um, the beans are in.\n\nOak: um, okay.\n@tidy take the ums out of this");
  await until("tidy running", () => store.agentRequests(note.id).find(r => r.status === "running"), 10_000);
  const now = store.require(note.id);
  store.update(note.id, `${now.text}\nWren: and the peas`, now.revision, { author: "user" });
  const row = await until("tidy's answer", () => store.agentRequests(note.id).find(r => r.status !== "running" && r.status !== "waiting"), 30_000);
  expect([row.status, row.message]).toEqual(["applied", "took the ums out · the 1 line above the ask"]);
  expect(store.require(note.id).text).toBe("Garden meeting\n\nOak: um, okay.\n\nWren: um, the beans are in.\n\nOak: okay.\n@tidy take the ums out of this\nWren: and the peas");
}, 60_000);

// CodeRabbit on #1437: the whole note holds earlier asks and their answers, and a model may drop them. Tidy refuses a
// rewrite that changes them, so the person's earlier turns stay; and a long model message still fits with its scope.
test("PIE-1737: a whole-note rewrite that drops an earlier ask or its answer is refused, and the note is left as it was", async () => {
  const text = "Garden meeting\n\nOak: um, okay.\n@yo what did we decide\n> [!note]- @yo answered\n> beans by Friday\nWren: um, right.\n@tidy clean up the transcript";
  const dropAsks = 'JSON.stringify({ replacement: passage.split("\\n").filter(l => !l.startsWith("@") && !l.startsWith(">")).join("\\n").replaceAll("um, ", ""), message: "took the ums out" })';
  const { store, note } = await setup(50, undefined, text, dropAsks);
  const row = await until("tidy's answer", () => store.agentRequests(note.id).find(r => r.status !== "running" && r.status !== "waiting"), 30_000);
  expect(row.status).toBe("failed");
  expect(row.message).toContain("the model changed an earlier ask or its answer (@yo what did we decide)");
  expect(store.require(note.id).text).toBe(text);
}, 60_000);

test("PIE-1737: a model message near its 500 characters still lands, with what it took said after it", async () => {
  const long = 'JSON.stringify({ replacement: passage.replaceAll("um, ", ""), message: "took the ums out ".repeat(29) })';
  const { store, note } = await setup(50, undefined, "Garden meeting\n\nOak: um, okay.\n@tidy clean up the transcript", long);
  const row = await until("tidy's answer", () => store.agentRequests(note.id).find(r => r.status !== "running" && r.status !== "waiting"), 30_000);
  expect(row.status).toBe("applied");
  expect(row.message!.length).toBeLessThanOrEqual(500);
  expect(row.message!.endsWith("… · the whole note above the ask")).toBe(true);
}, 60_000);

// PIE-1740: Evan's tidy missed its deadline once, he ran the one command the stop line named, pressed R, and it missed
// again: the line said double the old deadline, not the run's own length. The suggestion is now more than double what
// the run went, in whole minutes, at most an agent's longest; and a refusal after his own save says what he does next.
test("PIE-1740: a 30 s stop suggests 2m, more than double what it ran; 60 s, 3m; at the longest, nothing longer", () => {
  expect(longerDeadline(30_000, 30_000)).toBe("2m");
  expect(longerDeadline(30_000, 31_200)).toBe("2m");
  expect(longerDeadline(60_000, 60_400)).toBe("3m");
  expect(longerDeadline(15_000, 0)).toBe("1m");
  expect(longerDeadline(90 * 60_000, 90 * 60_000)).toBe("2h");
  expect(longerDeadline(2 * 3_600_000, 2 * 3_600_000)).toBeUndefined();
  const said = failedWords(new Error("Resource extension: tidy timed out after 2h"), { agent: "tidy", extension: "tidy", deadlineMs: 2 * 3_600_000, tookMs: 2 * 3_600_000, words: 40, by: "user" });
  expect(said).toBe("@tidy took longer than its 2 h on this 40-word note and was stopped: ask it about a shorter passage (2 h is the longest an agent may take)");
});

test("PIE-1740: the deadline a stop names fits the run: set it as the line says, ask again, and it lands", async () => {
  const { store, note, client } = await setup(1_500, "1s", "Garden meeting\n\nOak: um, okay.\n\nWren: um, the beans are in.\n@tidy clean up the transcript");
  const stop = await until("tidy's stop", () => store.agentRequests(note.id).find(r => r.status === "failed"), 30_000);
  const longer = /\(ep0ch act ext\.tidy\.settings agent\.tidy\.deadline=(\d+)([mh])\)$/.exec(stop.message ?? "");
  expect(longer).not.toBeNull();
  await client.request<ExtensionsConfigured>({ action: "extensions.configure", extension: "tidy", set: { "agent.tidy.deadline": `${longer![1]}${longer![2]}` }, mutation: { author: "user" } });
  await client.request({ action: "resources.projection.refresh", blockId: note.id, line: 5, mutation: { author: "user" } });
  const row = await until("tidy's answer", () => store.agentRequests(note.id).find(r => r.status === "applied"), 30_000);
  expect(row.message).toBe("took the ums out · the whole note above the ask");
  expect(store.require(note.id).text).toBe("Garden meeting\n\nOak: okay.\n\nWren: the beans are in.\n@tidy clean up the transcript");
}, 60_000);

test("PIE-1740: Evan saves an edit in the passage while tidy runs: the line says nothing was lost and to ask again, and asking again lands", async () => {
  const { store, note, client } = await setup(1_500, undefined, "Garden meeting\n\nOak: um, okay.\n\nWren: um, the beans are in.\n@tidy clean up the transcript");
  await until("tidy running", () => store.agentRequests(note.id).find(r => r.status === "running"), 10_000);
  const now = store.require(note.id);
  store.update(note.id, now.text.replace("Oak: um, okay.", "Oak: um, okay. Thanks."), now.revision, { author: "user" });
  const refused = await until("tidy's refusal", () => store.agentRequests(note.id).find(r => r.status === "failed"), 30_000);
  expect(refused.message).toBe(`the note changed while @tidy worked on it (revision ${now.revision}, now ${now.revision + 1}): nothing was changed, and asking again runs it on the new text`);
  await client.request({ action: "resources.projection.refresh", blockId: note.id, line: 5, mutation: { author: "user" } });
  const row = await until("tidy's answer", () => store.agentRequests(note.id).find(r => r.status === "applied"), 30_000);
  expect(row.message).toBe("took the ums out · the whole note above the ask");
  expect(store.require(note.id).text).toBe("Garden meeting\n\nOak: okay. Thanks.\n\nWren: the beans are in.\n@tidy clean up the transcript");
}, 60_000);

test("PIE-1740: an agent that asked hears what to send; a person hears that the note changed and to ask again", () => {
  const stale = Object.assign(new Error("not applied: Garden meeting ((n1)) changed since you read it (revision 5, now 6); read it again and send the patch against the new text."), { name: "DraftPatchRefusal", kind: "stale-revision" });
  const words = { agent: "tidy", extension: "tidy", deadlineMs: 300_000, tookMs: 2_000, words: 40, read: 5, now: 6 };
  expect(failedWords(stale, { ...words, by: "agent:loki" })).toBe(stale.message);
  expect(failedWords(stale, { ...words, by: "user" })).toBe("the note changed while @tidy worked on it (revision 5, now 6): nothing was changed, and asking again runs it on the new text");
  // A streamed answer that got part of the way in (CodeRabbit on #1440): what it wrote stays, and the line says so.
  expect(failedWords(stale, { ...words, by: "user", partial: true })).toBe("the note changed while @tidy was writing its answer (revision 5, now 6): what it wrote so far is in the note, and asking again runs it on the new text");
});
