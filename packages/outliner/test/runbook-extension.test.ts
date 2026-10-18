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
import { findOutputRegions } from "@ep0ch/outline-core/output-region";
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
  const check = await create(`Check the widget\nrun:: --mode=dry\n${fence("echo checking {{self.env}}")}`, book.id);
  const publish = await create(`Stage the widget\nrun:: --mode=dry --secrets=widget-demo\n${fence('echo "token is $WIDGET_TOKEN"; echo "b64 $(printf %s "$WIDGET_TOKEN" | base64)"; echo staged')}`, book.id);
  const apply = await create(`Apply the widget\nrun:: --mode=apply --secrets=widget-demo --confirm=ship\n${fence("echo applying to {{self.env}}; echo broke >&2; exit 3")}`, book.id);
  const after = await create(`Verify the widget\nrun:: --mode=dry\n${fence("echo verified")}`, book.id);
  const act = (blockId: string, extensionAction: string, mutation: { author: "user" | "agent"; actorId?: string }, args?: Record<string, string>) =>
    client.request<{ message?: string }>({ action: "extensions.act", extension: "runbook", extensionAction, blockId, line: extensionAction === "run-step" ? 1 : undefined, mutation, ...(args ? { args } : {}) });
  const kids = async (id: string) => id === book.id ? (await client.request<Block[]>({ action: "children", parentId: id })).map(b => b.text) : findOutputRegions((await client.request<Block>({ action: "get", blockId: id })).text).map(r => r.body);
  return { client, create, book, check, publish, apply, after, act, kids, root };
}
const PERSON = { author: "user" as const };

test("a step runs, and the run is recorded under it: status, exit code, who, when, the output tail", async () => {
  const { check, act, client } = await setup();
  const done = await act(check.id, "run-step", PERSON);
  expect(done.message).toContain("ok (exit 0)");
  const saved = await client.request<Block>({ action: "get", blockId: check.id });
  const [record] = findOutputRegions(saved.text).map(r => r.body);
  expect(await client.request<Block[]>({ action: "children", parentId: check.id })).toEqual([]);
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

test("a runbook's values come from its record: a bracketed list and a repeated key are all its values ([0] picks one), and a type list still makes a runbook", async () => {
  const { create, book, act, kids } = await setup();
  const list = await create("Listed runbook [type::[runbook, checklist]] [env::[staging, prod]] [region::eu] [region::us]", book.id);
  const step = await create("Where\nrun:: --mode=dry\n```sh\necho in {{self.env[0]}} at {{self.region[0]}} of {{self.region}}\n```", list.id);
  await act(step.id, "run-step", PERSON);
  expect((await kids(step.id))[0]).toContain("in staging at eu of eu, us");
  expect((await act(list.id, "run-all", PERSON)).message).toContain("all 1 steps ran ok");
});

test("a missing parameter is recorded as not run, saying which property to write", async () => {
  const { create, book, act, kids } = await setup();
  const step = await create("Needs a thing\nrun:: --mode=dry\n```sh\necho {{self.region}}\n```", book.id);
  const done = await act(step.id, "run-step", PERSON);
  expect(done.message).toContain("{{self.region}}");
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
  const step = await create("Echo it\nrun:: --mode=dry\n```sh\necho \"{{props.env}}\"\n```", book.id);
  const refused = await act(step.id, "run-step", PERSON, { env: "$(touch /tmp/never)" });
  expect(refused.message).toContain("refused");
  expect(refused.message).toContain("characters a command could be built from");
  expect((await kids(step.id))[0]).toContain("[run.status::refused]");
  const split = await create(`Split it\nrun:: --mode=dry --secrets=widget-demo\n\`\`\`sh\nprintf 'a %s\\033[0m%s b\\n' "$(echo $WIDGET_TOKEN | cut -c1-8)" "$(echo $WIDGET_TOKEN | cut -c9-)"\n\`\`\``, book.id);
  await act(split.id, "run-step", PERSON);
  expect((await kids(split.id))[0]).not.toContain(TOKEN);
  const inner = await create("Inner runbook [type::runbook] [env::staging]", book.id);
  const nested = await create("Where\nrun:: --mode=dry\n```sh\necho in {{self.env}}\n```", inner.id);
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

// PIE-893: wrap.ts left a 1.5 s timer pending after every command, so each step took 1.5 s more than its command and the
// whole-run test (three steps, 5 s) sat at 4.7 s with nothing else wrong. The old wrap never ended before 1500 ms.
test("a step's wrapper ends when the command's output is in, not 1.5 s later; a holder of the output is still waited for", async () => {
  const wrap = join(import.meta.dir, "..", "extensions", "runbook", "wrap.ts");
  const run = async (command: string) => {
    const started = performance.now();
    const child = Bun.spawn([process.execPath, wrap, "20000", command], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const out = await new Response(child.stdout).text();
    await child.exited;
    return { ms: performance.now() - started, ...(JSON.parse(out) as { exit: number; output: string }) };
  };
  const quick = await run("echo hi");
  expect(quick).toMatchObject({ exit: 0, output: "hi\n" });
  expect(quick.ms).toBeLessThan(1400);
  // Something the command left running keeps the output open: what it says before it lets go is kept.
  const held = await run("(sleep 0.4; echo late) & echo early");
  expect(held.output).toBe("early\nlate\n");
});

// PIE-533 S4: the runbook on the shared grammar. `{{self.x}}` is the runbook note's, `{{props.x}}` the run's; the service fills them.
test("a run's own values are {{props.x}}: given, they fill the command; left out, the step does not run and says how to give it", async () => {
  const { create, book, act, kids } = await setup();
  const step = await create("Greet\nrun:: --mode=dry\n```sh\necho hello {{props.who}} in {{self.env}}\n```", book.id);
  const missing = await act(step.id, "run-step", PERSON);
  expect(missing.message).toContain("refused");
  expect(missing.message).toContain("{{props.who}}");
  expect(missing.message).toContain("{{self.name}}");
  const ok = await act(step.id, "run-step", PERSON, { who: "ada" });
  expect(ok.message).toContain("ok (exit 0)");
  expect((await kids(step.id)).at(-1)).toContain("hello ada in scratch");
});

test("only the runbook note's own value is trusted: a value from anywhere else that could build a command is refused, a prop likewise", async () => {
  const { create, book, act, kids } = await setup();
  // The runbook's author wrote it: two words and a semicolon are theirs to write.
  const note = await create("Careful [type::runbook] [note::one; echo two]");
  const trusted = await create("Own\nrun:: --mode=dry\n```sh\necho {{self.note}}\n```", note.id);
  expect((await act(trusted.id, "run-step", PERSON)).message).toContain("ok");
  expect((await kids(trusted.id))[0]).toContain("one");
  // A value read through a reference is somebody else's.
  const other = await create("Other note [x::a;b]");
  const viaRef = await create(`Via a reference\nrun:: --mode=dry\n\`\`\`sh\necho {{((${other.id})).x}}\n\`\`\``, book.id);
  const refused = await act(viaRef.id, "run-step", PERSON);
  expect(refused.message).toContain("refused");
  expect(refused.message).toContain("comes from outside the runbook note");
  expect((await kids(viaRef.id))[0]).toContain("[run.status::refused]");
  // A plain value from outside is fine.
  const plain = await create("Plain\nrun:: --mode=dry\n```sh\necho {{now.date}}\n```", book.id);
  expect((await act(plain.id, "run-step", PERSON)).message).toContain("ok");
});


test("editing a running output keeps the edit and records the completed outcome with a proposal", async () => {
  const { create, book, act, client, root } = await setup();
  const release = join(root, "release");
  const step = await create(`Wait for the gardener [run.last::failed]\nrun:: --mode=dry\n\`\`\`sh\nwhile [ ! -f '${release}' ]; do sleep 0.02; done\necho harvest complete\n\`\`\``, book.id);
  const running = act(step.id, "run-step", PERSON);
  try {
    const deadline = Date.now() + 5000;
    let current: Block;
    for (;;) {
      current = await client.request<Block>({ action: "get", blockId: step.id });
      if (current.text.includes("[run.status::running]")) break;
      if (Date.now() > deadline) throw new Error("the step never started");
      await Bun.sleep(20);
    }
    await client.request({ action: "update", blockId: step.id, expectedRevision: current.revision,
      text: current.text.replace("[run.status::running]", "[run.status::running] My observation"), mutation: PERSON });
  } finally { writeFileSync(release, "go"); }
  const done = await running;
  const saved = await client.request<Block>({ action: "get", blockId: step.id });
  expect(saved.text).toContain("My observation");
  expect(saved.text).toContain("[run.last::ok]");
  expect(done.message).toContain("ok (exit 0)");
  expect(done.message).toContain("its output went to a proposal because the region changed");
  const { proposals } = await client.request<{ proposals: Array<{ id: string }> }>({ action: "draft.proposals.list", blockId: step.id });
  expect(proposals).toHaveLength(1);
  const proposal = await client.request<Block>({ action: "get", blockId: proposals[0]!.id });
  expect(proposal.text).toContain("harvest complete");
  expect(proposal.text).toContain("[run.status::ok]");
});
