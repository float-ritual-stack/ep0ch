// The notifications hub extension (extensions/notify), end to end on a scratch service: a fake `gh` on PATH answering
// `api notifications`, made-up fixture files for the other sources, the pull run twice. Everything is made up.
import { afterEach, expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";
import { githubWebUrl } from "../extensions/notify/sources";
import { inert, merged, propsOf } from "../extensions/notify/notification";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const THREADS = [
  { id: "101", unread: true, reason: "review_requested", updated_at: "2026-10-09T08:15:00Z",
    subject: { title: "Fix the [[Herons]] build [mood::calm]", type: "PullRequest", url: "https://api.github.com/repos/pond/survey/pulls/12" }, repository: { full_name: "pond/survey", html_url: "https://github.com/pond/survey" } },
  { id: "102", unread: true, reason: "mention", updated_at: "2026-10-09T09:00:00Z",
    subject: { title: "Moss calendar", type: "Issue", url: "https://api.github.com/repos/pond/survey/issues/7" }, repository: { full_name: "pond/survey", html_url: "https://github.com/pond/survey" } },
];

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-notify-")));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const threads = join(root, "threads.json");
  writeFileSync(threads, JSON.stringify([THREADS]));
  // A fake gh: records its arguments and answers --slurp'd pages from threads.json.
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$@" >> "${root}/gh-calls"\ncat "${threads}"\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const previous = { path: process.env.PATH, dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.PATH = `${bin}:${previous.path}`;
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outline = join(root, "outline");
  const extension = join(outline, "extensions", "notify");
  mkdirSync(join(outline, "extensions"), { recursive: true });
  cpSync(join(import.meta.dir, "..", "extensions", "notify"), extension, { recursive: true });
  writeFileSync(join(extension, "config.json"), JSON.stringify({ config: {
    sources: ["github", "gmail", "jira", "slack"], days: 3650,
    fixtures: { gmail: "fixtures/gmail.json", jira: "fixtures/jira.json", slack: "fixtures/slack.json" },
  } }));
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outline });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state"), scheduleTickMs: 3_600_000 });
  server.setOutline({ name: "notify-scratch" });
  await server.start();
  const client = new OutlinerClient(socket, 20_000);
  cleanups.push(async () => {
    await server.close(); store.close();
    for (const [key, value] of [["PATH", previous.path], ["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  await client.request({ action: "extensions.list", reload: true });
  const pull = async () => (await client.request<{ message: string }>({ action: "extensions.act", extension: "notify", extensionAction: "pull", mutation: { author: "user" } })).message;
  const notes = async () => (await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: "notify.key", limit: 100 } })).blocks;
  return { root, store, client, pull, notes };
}

test("pure parts: the web URL of a subject, imported words kept inert, and read never going back to unread", () => {
  expect(githubWebUrl({ subject: { title: "t", type: "PullRequest", url: "https://api.github.com/repos/o/r/pulls/3" }, repository: { full_name: "o/r", html_url: "https://github.com/o/r" } })).toBe("https://github.com/o/r/pull/3");
  expect(inert("[[A]] ((b)) [k::v]\nx")).toBe("[\\[A]] (\\(b)) \\[k::v] x");
  expect(inert("note:: hi")).toBe("note\\:: hi");
  const n = { id: "1", source: "github", kind: "Issue", from: "o/r", title: "T", unread: true, received: "2026-10-09T00:00:00Z" };
  const read = merged(n).replace("[notify.state::unread]", "[notify.state::read]");
  expect(propsOf(merged(n, read))["notify.state"]).toBe("read");
  expect(propsOf(merged({ ...n, unread: false }, merged(n)))["notify.state"]).toBe("read");
});

test("a pull makes one note per notification from all four sources with open properties, the demo's two boards answer them, and a second pull writes nothing", async () => {
  const { pull, notes, client, root, store } = await setup();
  expect(await pull()).toBe("notifications: 7 new, 0 changed, 0 unchanged");
  const made = await notes();
  expect(made).toHaveLength(7);
  const github = made.find((b) => propsOf(b.text)["notify.key"] === "github:101")!;
  expect(propsOf(github.text)).toMatchObject({ "notify.source": "github", "notify.kind": "PullRequest", "notify.from": "pond/survey", "notify.state": "unread", "notify.url": "https://github.com/pond/survey/pull/12" });
  // Imported words stay words: the title's [mood::calm] is no property, its [[Herons]] no link.
  expect((await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: "mood=calm" } })).blocks).toHaveLength(0);
  expect(store.get(github.id)).toMatchObject({ author: "agent", actorId: "ext:notify" });
  // Properties are open: the service filters on them, nothing in code lists them.
  const jira = await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: "notify.source=jira AND notify.state=unread" } });
  expect(jira.blocks).toHaveLength(2);
  // The boards: the demo's hubs of views (written when it was installed), lanes by state and by source, answered by the service.
  const hubs = await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: "type=virtual-branch", limit: 50 } });
  expect(hubs.blocks.map((b) => propsOf(b.text)["query"]).filter((q) => q?.startsWith("notify.")).sort()).toEqual(["notify.source=github", "notify.source=gmail", "notify.source=jira", "notify.source=slack", "notify.state=read", "notify.state=unread"]);

  const before = store.changes.since(0, 1000);
  const count = before.kind === "changes" ? before.changes.length : -1;
  expect(await pull()).toBe("notifications: 0 new, 0 changed, 2 unchanged");
  const after = store.changes.since(0, 1000);
  // Only the page's cursor moved; no note was written twice.
  expect(after.kind === "changes" ? after.changes.length - count : -1).toBeLessThanOrEqual(1);
  expect((await notes())).toHaveLength(7);
  expect(await Bun.file(join(root, "gh-calls")).text()).toContain("api --paginate --slurp notifications?all=true");
});

test("marking one read in the outline stays read; a notification read at the source becomes read; one failing source doesn't stop the others", async () => {
  const { pull, notes, client, root } = await setup();
  await pull();
  const target = (await notes()).find((b) => propsOf(b.text)["notify.key"] === "github:102")!;
  await client.request({ action: "update", blockId: target.id, expectedRevision: target.revision, text: target.text.replace("[notify.state::unread]", "[notify.state::read]"), mutation: { author: "user" } });
  // A person's own property and paragraph on a note survive a pull.
  const mine = (await notes()).find((b) => propsOf(b.text)["notify.key"] === "github:101")!;
  await client.request({ action: "update", blockId: mine.id, expectedRevision: mine.revision, text: `${mine.text.split("\n")[0]} [mine::yes]\n\nMy own note.`, mutation: { author: "user" } });
  // GitHub still says 101 changed (title edited, now read there) and 102 unread: 102 stays read here.
  const changed = THREADS.map((t) => (t.id === "101" ? { ...t, unread: false, updated_at: "2026-10-09T11:00:00Z", subject: { ...t.subject, title: "Fix the build" } } : { ...t, updated_at: "2026-10-09T11:00:00Z" }));
  writeFileSync(join(root, "threads.json"), JSON.stringify([changed]));
  // A broken fixture: its source reports, the rest go on.
  writeFileSync(join(root, "outline", "extensions", "notify", "config.json"), JSON.stringify({ config: { sources: ["github", "gmail"], days: 3650, fixtures: { gmail: "fixtures/missing.json" } } }));
  await client.request({ action: "extensions.list", reload: true });
  const said = await pull();
  expect(said).toMatch(/^notifications: 0 new, 2 changed, 0 unchanged; gmail: /);
  const now = await notes();
  const state = (key: string) => propsOf(now.find((b) => propsOf(b.text)["notify.key"] === key)!.text)["notify.state"];
  expect(state("github:101")).toBe("read");
  const kept = now.find((b) => propsOf(b.text)["notify.key"] === "github:101")!.text;
  expect(kept).toContain("[mine::yes]");
  expect(kept).toContain("My own note.");
  expect(kept.split("\n")[0]).toStartWith("Fix the build [notify.key");
  expect(state("github:102")).toBe("read");
});
