// PIE-1713: `@tidy cleanup the transcript` on a long meeting transcript stopped at tidy's 20 s and told the person to
// edit a manifest. Its deadline fits a long note through a slow model now, and a stop says what happened in the
// person's words. The transcript, the speakers and the model are made up; the model is a command that takes its time.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerServer } from "../src/server";
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

async function setup(modelMs: number, deadline?: string) {
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
console.log(JSON.stringify({ replacement: passage.replaceAll("um, ", ""), message: "took the ums out" }));`);
  writeFileSync(join(tidy, "config.json"), JSON.stringify({ config: { answer: [process.execPath, model] } }));
  const store = new OutlinerStore(join(root, "o.sqlite"), { workspaceRoot: folder });
  const server = new OutlinerServer(store, join(root, "o.sock"), undefined, undefined, { extensionPollMs: 0, agentRequestQuietMs: 80 });
  await server.start();
  cleanups.push(async () => {
    await server.close(); store.close();
    for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(root, { recursive: true, force: true });
  });
  const note: Block = store.create(`Garden meeting\n\n${TRANSCRIPT}\n@tidy cleanup the transcript`, null, "user");
  return { store, note };
}

test("PIE-1713: tidy on a long transcript through a model that takes 30 s finishes, and the ums are gone", async () => {
  const { store, note } = await setup(30_000);
  const row = await until("tidy's answer", () => store.agentRequests(note.id).find(r => r.status !== "running" && r.status !== "waiting"), 90_000);
  expect([row.status, row.message]).toEqual(["applied", "took the ums out"]);
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
