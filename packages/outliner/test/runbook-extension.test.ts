// The runbook extension (PIE-732): a note is a runbook, its steps are command blocks, a secrets group joins a step by
// name when it runs, and every run is recorded under the step. A scratch service in a temp folder with a made-up
// secrets group; every command, name and token here is invented.
import { afterEach, expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";

const TOKEN = "tok-widget-0123456789-demo";
const LOKI = { author: "agent" as const, actorId: "loki-test" };
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup(timeoutSeconds = 20) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-runbook-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS, secrets: process.env.WITH_SECRETS_DIR };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outline = join(root, "outline");
  mkdirSync(join(outline, "extensions"), { recursive: true });
  const secrets = join(root, "secrets");
  mkdirSync(secrets, { mode: 0o700 });
  writeFileSync(join(secrets, "widget-demo.env"), `WIDGET_TOKEN=${TOKEN}\n`);
  chmodSync(join(secrets, "widget-demo.env"), 0o600);
  cpSync(join(import.meta.dir, "..", "extensions", "runbook"), join(outline, "extensions", "runbook"), { recursive: true });
  // The service reads groups where with-secrets does; this scratch service, from a scratch folder.
  process.env.WITH_SECRETS_DIR = secrets;
  writeFileSync(join(outline, "extensions", "runbook", "config.json"), JSON.stringify({ config: { timeoutSeconds } }));
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outline });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state"), scheduleTickMs: 3_600_000 });
  server.setOutline({ name: "garden-scratch" });
  await server.start();
  const client = new OutlinerClient(socket, 60_000);
  cleanups.push(async () => {
    await server.close(); store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry], ["WITH_SECRETS_DIR", previous.secrets]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  });
  await client.request({ action: "extensions.list", reload: true });
  const create = (text: string, parentId?: string) => client.request<Block>({ action: "create", text, author: "user", ...(parentId ? { parentId } : {}) });
  const fence = (command: string) => "```sh\n" + command + "\n```";
  const book = await create("Ship the widget [type::runbook] [env::scratch]");
  const check = await create(`Check the widget\nrun:: --mode=dry\n${fence("echo checking {{env}}")}`, book.id);
  const publish = await create(`Stage the widget\nrun:: --mode=dry --secrets=widget-demo\n${fence('echo "token is $WIDGET_TOKEN"; echo "b64 $(printf %s "$WIDGET_TOKEN" | base64)"; echo staged')}`, book.id);
  const apply = await create(`Apply the widget\nrun:: --mode=apply --secrets=widget-demo --confirm=ship\n${fence("echo applying to {{env}}; echo broke >&2; exit 3")}`, book.id);
  const after = await create(`Verify the widget\nrun:: --mode=dry\n${fence("echo verified")}`, book.id);
  const act = (blockId: string, extensionAction: string, mutation: { author: "user" | "agent"; actorId?: string }, args?: Record<string, string>) =>
    client.request<{ message?: string }>({ action: "extensions.act", extension: "runbook", extensionAction, blockId, line: extensionAction === "run-step" ? 1 : undefined, mutation, ...(args ? { args } : {}) });
  const kids = async (id: string) => (await client.request<Block[]>({ action: "children", parentId: id })).map((block) => block.text);
  return { client, create, book, check, publish, apply, after, act, kids, root };
}
const PERSON = { author: "user" as const };

test("a step runs, and the run is recorded under it: status, exit code, who, when, the output tail", async () => {
  const { check, act, kids } = await setup();
  const done = await act(check.id, "run-step", PERSON);
  expect(done.message).toContain("ok (exit 0)");
  const [record] = await kids(check.id);
  expect(record).toContain("[run.status::ok]");
  expect(record).toContain("[run.exit::0]");
  expect(record).toContain("[run.by::person]");
  expect(record).toMatch(/\[run\.at::\d{4}-\d\d-\d\dT/);
  expect(record).toContain("checking scratch");
});

test("a secrets group joins the step by name, and its value never reaches the outline, the answer or the feed", async () => {
  const { publish, act, kids, client } = await setup();
  const done = await act(publish.id, "run-step", LOKI);
  expect(done.message).toContain("ok");
  const [record] = await kids(publish.id);
  expect(record).toContain("token is [redacted]");
  expect(record).toContain("b64 [redacted]");
  expect(record).toContain("[run.by::agent:loki-test]");
  expect(record).toContain("staged");
  const everything = JSON.stringify([await client.request({ action: "changes.since", sequence: 0, limit: 1000 }), done, await client.request({ action: "children", parentId: null })]);
  expect(everything).not.toContain(TOKEN);
  expect(everything).not.toContain(Buffer.from(TOKEN).toString("base64"));
});

test("an apply step is the person's, and needs its confirmation word", async () => {
  const { apply, act, kids } = await setup();
  const byAgent = await act(apply.id, "run-step", LOKI, { confirm: "ship" });
  expect(byAgent.message).toContain("refused");
  expect(byAgent.message).toContain("the person's to run");
  const noWord = await act(apply.id, "run-step", PERSON);
  expect(noWord.message).toContain("confirm=ship");
  const ran = await act(apply.id, "run-step", PERSON, { confirm: "ship" });
  expect(ran.message).toContain("failed (exit 3)");
  const records = await kids(apply.id);
  expect(records).toHaveLength(3);
  expect(records[2]).toContain("[run.status::failed]");
  expect(records[2]).toContain("applying to scratch");
  expect(records[2]).toContain("broke");
});

test("running the whole runbook stops at the step that fails and says so; the steps after it are not run", async () => {
  const { book, apply, after, check, publish, act, kids } = await setup();
  const done = await act(book.id, "run-all", PERSON, { confirm: "ship" });
  expect(done.message).toContain("stopped at Apply the widget");
  expect((await kids(check.id))[0]).toContain("[run.status::ok]");
  expect((await kids(publish.id))[0]).toContain("[run.status::ok]");
  expect((await kids(apply.id))[0]).toContain("[run.status::failed]");
  expect(await kids(after.id)).toEqual([]);
  const summary = (await kids(book.id)).find((text) => text.startsWith("Run of this runbook"));
  expect(summary).toContain("[run.status::failed]");
});

test("a missing parameter is recorded as not run, saying which property to write", async () => {
  const { create, book, act, kids } = await setup();
  const step = await create("Needs a thing\nrun:: --mode=dry\n```sh\necho {{region}}\n```", book.id);
  const done = await act(step.id, "run-step", PERSON);
  expect(done.message).toContain("{{region}}");
  expect((await kids(step.id))[0]).toContain("[run.status::refused]");
});

test("a handler line draws the step: its filled command and its last run", async () => {
  const { check, act, client } = await setup();
  await act(check.id, "run-step", PERSON);
  await client.request({ action: "resources.projection.refresh", blockId: check.id });
  const read = await client.request<{ projections?: Array<{ provider: string; output?: { component?: { view: { badge: { label: string } } } } }> }>({ action: "resources.projection.read", blockId: check.id });
  const view = read.projections?.find((p) => p.provider === "runbook")?.output?.component?.view;
  expect(view?.badge.label).toBe("ok");
});

test("a run-time value that could build a command is refused; a secret split by terminal escapes is still scrubbed; the nearest runbook's parameters win", async () => {
  const { create, book, act, kids } = await setup();
  const step = await create("Echo it\nrun:: --mode=dry\n```sh\necho \"{{env}}\"\n```", book.id);
  const refused = await act(step.id, "run-step", PERSON, { env: "$(touch /tmp/never)" });
  expect(refused.message).toContain("refused");
  expect((await kids(step.id))[0]).toContain("[run.status::refused]");
  const split = await create(`Split it\nrun:: --mode=dry --secrets=widget-demo\n\`\`\`sh\nprintf 'a %s\\033[0m%s b\\n' "$(echo $WIDGET_TOKEN | cut -c1-8)" "$(echo $WIDGET_TOKEN | cut -c9-)"\n\`\`\``, book.id);
  await act(split.id, "run-step", PERSON);
  expect((await kids(split.id))[0]).not.toContain(TOKEN);
  const inner = await create("Inner runbook [type::runbook] [env::staging]", book.id);
  const nested = await create("Where\nrun:: --mode=dry\n```sh\necho in {{env}}\n```", inner.id);
  const all = await act(inner.id, "run-all", PERSON);
  expect(all.message).toContain("all 1 steps ran ok");
  expect((await kids(nested.id))[0]).toContain("in staging");
});

test("a command that outlives its timeout is stopped, with its children, and recorded as failed", async () => {
  const { create, book, act, kids } = await setup(1);
  const slow = await create("Slow\nrun:: --mode=dry\n```sh\nsleep 600; echo finished\n```", book.id);
  const started = Date.now();
  await act(slow.id, "run-step", PERSON);
  expect(Date.now() - started).toBeLessThan(30_000);
  expect((await kids(slow.id))[0]).toContain("[run.exit::124]");
}, 20_000);
