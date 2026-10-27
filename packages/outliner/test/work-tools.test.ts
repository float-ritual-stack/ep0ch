import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scratchOutline } from "./scratch-outline";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";

const REPO = "example-org/example-app";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** The spawned CLI's environment: this fixture only, never a Herdr session. */
function isolatedEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("HERDR_") && !key.startsWith("OUTLINER_")) env[key] = value;
  }
  return { ...env, ...extra };
}

async function runCli(env: Record<string, string>, args: string[], stdin?: string) {
  const child = Bun.spawn(["bun", "src/cli.ts", ...args], {
    cwd: join(import.meta.dir, ".."), env,
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/**
 * A private service with a work queue and a `gh` stand-in on PATH that
 * answers `gh pr view` from `pulls`.
 */
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "outliner-work-tools-"));
  const { env, ...paths } = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  cleanups.push(async () => {
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  store.configureWorkIdPrefix("PIE");
  store.create("Work [type::work-queue] [project::demo]");
  const bin = join(root, "bin");
  const pulls = join(root, "pulls");
  Bun.spawnSync(["mkdir", "-p", bin, pulls]);
  writeFileSync(join(bin, "gh"), `#!/bin/sh\n# gh pr view N --repo R --json …\ncat "${pulls}/$3.json" 2>/dev/null || { echo "no pull request $3" >&2; exit 1; }\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const cliEnv = isolatedEnv({ ...env, PATH: `${bin}:${process.env.PATH}` });
  const run = async (args: string[], stdin?: string) => {
    const result = await runCli(cliEnv, args, stdin);
    return { ...result, json: result.exitCode === 0 ? JSON.parse(result.stdout) : undefined, error: result.stderr.trim() };
  };
  const pull = (number: number, state: "OPEN" | "MERGED", head = "feature/pie-001", mergeCommit: string | null = null, repo = REPO,
    more: { mergedAt?: string; title?: string; base?: string } = {}) =>
    writeFileSync(join(pulls, `${number}.json`), JSON.stringify({
      number, url: `https://github.com/${repo}/pull/${number}`, state,
      mergeCommit: mergeCommit ? { oid: mergeCommit } : null, headRefName: head, baseRefName: more.base ?? "main",
      mergedAt: state === "MERGED" ? more.mergedAt ?? "2026-03-04T15:00:00Z" : null,
      title: more.title ?? `Example change ${number}`, author: { login: "example-builder" },
    }));
  const file = (name: string, text: string) => {
    writeFileSync(join(root, name), text);
    return join(root, name);
  };
  const create = (extra: string[] = []) => run([
    "work", "create", "--title", "Example outcome", "--project", "demo", "--arc", "workflow",
    "--track", "workflow", "--priority", "medium", "--stage", "queued", ...extra,
  ]);
  return { store, run, pull, file, create };
}

test("an item is created, staged and read back by Work ID with its revision", async () => {
  const h = await setup();
  const created = await h.create(["--body-file", "/dev/null", "--author", "agent", "--actor", "test-agent"]);
  expect(created.json).toMatchObject({ workId: "PIE-001", workStage: "queued", revision: 1 });
  expect(created.json.ref).toBe(`((${created.json.blockId}))`);
  const block = h.store.require(created.json.blockId);
  expect(block).toMatchObject({ author: "agent", actorId: "test-agent" });

  let revision = 1;
  for (const stage of ["doing", "review", "validate"]) {
    const staged = await h.run(["work", "stage", "PIE-1", stage, "--expected", String(revision)]);
    expect(staged.json).toMatchObject({ workId: "PIE-001", key: "work-stage", value: stage, workStage: stage, changed: true });
    expect(staged.json.revision).toBe(revision + 1);
    revision = staged.json.revision;
    expect(h.store.require(block.id).properties).toContainEqual({ key: "work-stage", value: stage });
  }
  const unchanged = await h.run(["work", "stage", block.id, "validate"]);
  expect(unchanged.json).toMatchObject({ changed: false, revision });

  const set = await h.run(["work", "set", `((${block.id}))`, "priority", "high"]);
  expect(set.json).toMatchObject({ key: "priority", previous: "medium", value: "high", revision: revision + 1 });
});

test("unclear or unsafe property writes are refused before anything changes", async () => {
  const h = await setup();
  const { json } = await h.create(["--track", "second-track"]);
  const before = h.store.require(json.blockId);
  const refusals: Array<[string[], string]> = [
    [["work", "stage", "PIE-001", "shipping"], 'Unknown work stage "shipping"'],
    [["work", "stage", "PIE-001", "done"], "use work complete"],
    [["work", "stage", "PIE-001", "doing", "--expected", "7"], "is at revision 1, not 7"],
    [["work", "set", "PIE-001", "work-id", "PIE-999"], "identity and cannot be changed"],
    [["work", "set", "PIE-001", "status", "done"], "no status"],
    [["work", "set", "PIE-001", "track", "other"], "[track::…] is a list"],
    [["work", "set", "PIE-001", "depends-on", "other"], "[depends-on::…] is a list"],
    [["work", "stage", "Example outcome", "doing"], "not \"Example outcome\""],
    [["work", "stage", "PIE-042", "doing"], "No block has Work ID PIE-042"],
    [["work", "stage", "PIE-001", "superseded"], "exactly one superseded-by"],
  ];
  for (const [args, message] of refusals) {
    const result = await h.run(args);
    expect(result.exitCode).toBe(1);
    expect(result.error).toStartWith("error: ");
    expect(result.error).toContain(message);
  }
  expect(h.store.require(before.id)).toEqual(before);
}, 30_000);

test("a pull request is recorded as the delivery: open reaches review, merge reaches validate", async () => {
  const h = await setup();
  const { json } = await h.create();
  await h.run(["work", "stage", "PIE-001", "doing"]);

  h.pull(7, "OPEN", "feature/other");
  const mismatch = await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "7", "--branch", "feature/pie-001"]);
  expect(mismatch.error).toContain("merges feature/other into main, not feature/pie-001 into main");
  expect(h.store.children(json.blockId)).toEqual([]);

  h.pull(8, "OPEN");
  const opened = await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "8"]);
  expect(opened.json).toMatchObject({
    workId: "PIE-001", workStage: "review", changed: true,
    delivery: { deliveryKey: "PIE-001/primary", stage: "review", created: true },
    pullRequest: { number: 8, state: "OPEN", mergeCommit: null },
  });

  h.pull(8, "MERGED", "feature/pie-001", "abc1234");
  // As the mod sends it: options, then the item after `--`.
  const merged = await h.run(["work", "deliver", `--repo=${REPO}`, "--pr=8", "--base=main", "--", "PIE-001"]);
  expect(merged.json).toMatchObject({
    workStage: "validate",
    delivery: { blockId: opened.json.delivery.blockId, stage: "validate", created: false },
  });
  const delivery = h.store.require(opened.json.delivery.blockId);
  expect(delivery.properties).toContainEqual({ key: "merge-commit", value: "abc1234" });
  expect(delivery.properties).toContainEqual({ key: "work-branch", value: "feature/pie-001" });
  expect(delivery.properties).toContainEqual({ key: "merged-at", value: "2026-03-04T15:00:00Z" });
  // The merge is on the record once, beside its delivery: a merge row naming the ticket.
  expect(merged.json.landed).toMatchObject({ created: true, tickets: ["PIE-001"] });
  expect(h.store.require(merged.json.landed.blockId).text).toContain("Delivers [[PIE-001]].");
});

/** The merge row a day's "merged today" figure lists: the build log template's query. */
function landedOn(store: OutlinerStore, day: string): string[] {
  return store.queryBlocks({ where: `type=merge AND base-branch=main AND merged-at=${day}`, machinery: "show" }).blocks
    .map((block) => block.properties.find((property) => property.key === "merge-commit")!.value).sort();
}

test("a merge is landed once, ticket or not; landing a ticketed PR syncs its delivery to merged (PIE-1352)", async () => {
  const h = await setup();
  await h.create();
  // The builder delivered while the PR was open; nobody synced it after the merge.
  h.pull(40, "OPEN");
  const opened = await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "40"]);
  h.pull(40, "MERGED", "feature/pie-001", "aaa4040", REPO, { mergedAt: "2026-03-05T14:00:00Z" });
  h.pull(41, "MERGED", "loki/fix-typo", "bbb4141", REPO, { mergedAt: "2026-03-05T16:00:00Z", title: "Fix a typo in the guide [skip review]" });
  h.pull(43, "MERGED", "loki/header", "ccc4343", REPO, { mergedAt: "2026-03-05T17:00:00Z", title: "A note can hide its header: [header::none]" });

  // The merge step's call has no item: it finds the delivery that records the PR.
  const landed = await h.run(["work", "deliver", "--repo", REPO, "--pr", "40", "--author", "agent", "--actor", "loki"]);
  expect(landed.json).toMatchObject({
    landed: { created: true, tickets: ["PIE-001"] },
    deliveries: [{ blockId: opened.json.delivery.blockId, workId: "PIE-001", stage: "validate" }],
  });
  const delivery = h.store.require(opened.json.delivery.blockId);
  expect(delivery.properties).toContainEqual({ key: "merged-at", value: "2026-03-05T14:00:00Z" });
  expect(delivery.properties).toContainEqual({ key: "pull-request-state", value: "merged" });

  // No ticket: still one row, with the PR's facts.
  const ticketless = await h.run(["work", "deliver", "--repo", REPO, "--pr", "41"]);
  expect(ticketless.json).toMatchObject({ landed: { created: true, tickets: [] }, deliveries: [] });
  const row = h.store.require(ticketless.json.landed.blockId);
  expect(row.text.split("\n")[0]).toStartWith("#41 Fix a typo in the guide [skip review] [type::merge]");
  expect(row.text).toContain("No ticket.");
  for (const [key, value] of [["pull-request-number", "41"], ["merge-commit", "bbb4141"], ["merged-at", "2026-03-05T16:00:00Z"],
    ["pr-author", "example-builder"], ["base-branch", "main"], ["repository", REPO]]) expect(row.properties).toContainEqual({ key: key!, value: value! });

  // A property written in a PR's title stays prose: the row gets no header::none.
  const quoted = h.store.require((await h.run(["work", "deliver", "--repo", REPO, "--pr", "43"])).json.landed.blockId);
  expect(quoted.text).toStartWith("#43 A note can hide its header: `[header::none]` [type::merge]");
  expect(quoted.properties.map((property) => property.key)).not.toContain("header");

  // Again, and again by the ticket: nothing new, nothing doubled.
  expect((await h.run(["work", "deliver", "--repo", REPO, "--pr", "41"])).json.landed).toMatchObject({ blockId: row.id, created: false, changed: false });
  expect((await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "40"])).json.landed).toMatchObject({ blockId: landed.json.landed.blockId, created: false });
  expect(landedOn(h.store, "2026-03-05")).toEqual(["aaa4040", "bbb4141", "ccc4343"]);
  // The rows sit on one Merges page under Records.
  const page = h.store.require(row.parentId!);
  expect(page.properties).toContainEqual({ key: "system-merges", value: "true" });
  expect(h.store.require(page.parentId!).properties).toContainEqual({ key: "system-records", value: "true" });

  // An open PR with no item is refused, saying how to record it on its ticket.
  h.pull(42, "OPEN", "feature/other");
  const open = await h.run(["work", "deliver", "--repo", REPO, "--pr", "42"]);
  expect(open.error).toContain("is open: a PR with no item is recorded when it merges");
});

test("a PR delivered to two tickets lands as one row naming both (PIE-1352)", async () => {
  const h = await setup();
  await h.create();
  await h.create();
  h.pull(50, "MERGED", "wave/records", "ccc5050");
  await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "50"]);
  const second = await h.run(["work", "deliver", "PIE-002", "--repo", REPO, "--pr", "50"]);
  expect(second.json.landed).toMatchObject({ created: false, changed: true, tickets: ["PIE-001", "PIE-002"] });
  expect(h.store.require(second.json.landed.blockId).text).toContain("Delivers [[PIE-001]], [[PIE-002]].");
  expect(landedOn(h.store, "2026-03-04")).toEqual(["ccc5050"]);
});

test("a day's merge rows are exactly git log --first-parent for that day, wave slices left out (PIE-1352)", async () => {
  const h = await setup();
  await h.create();
  const repo = mkdtempSync(join(tmpdir(), "outliner-landed-git-"));
  cleanups.push(async () => rmSync(repo, { recursive: true, force: true }));
  // git reads the day in this process's time zone, as the service does (bun test runs in UTC; the system may not).
  const env = { ...process.env, TZ: Intl.DateTimeFormat().resolvedOptions().timeZone, GIT_AUTHOR_NAME: "Example", GIT_AUTHOR_EMAIL: "example@example.test", GIT_COMMITTER_NAME: "Example", GIT_COMMITTER_EMAIL: "example@example.test" };
  const git = (args: string[], at?: Date) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: repo, env: at ? { ...env, GIT_AUTHOR_DATE: at.toISOString(), GIT_COMMITTER_DATE: at.toISOString() } : env });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
    return result.stdout.toString().trim();
  };
  // Local times: the day is the reader's day, as git's --since is (one merge just before midnight, one just after).
  const local = (day: number, hour: number, minute = 0) => new Date(2026, 2, day, hour, minute);
  git(["init", "-q", "-b", "main"]);
  git(["commit", "-q", "--allow-empty", "-m", "root"], local(1, 9));
  const merges: Array<{ pr: number; at: Date; ticket?: string; base?: string }> = [
    { pr: 60, at: local(9, 23, 50), ticket: "PIE-001" },
    { pr: 61, at: local(10, 0, 10) },
    { pr: 62, at: local(10, 13), ticket: "PIE-001" },
    { pr: 63, at: local(10, 23, 59) },
    { pr: 64, at: local(11, 0, 5) },
  ];
  for (const merge of merges) {
    const branch = `feature/change-${merge.pr}`;
    git(["checkout", "-q", "-b", branch, "main"]);
    git(["commit", "-q", "--allow-empty", "-m", `change ${merge.pr}`], merge.at);
    git(["checkout", "-q", "main"]);
    git(["merge", "-q", "--no-ff", branch, "-m", `Merge pull request #${merge.pr} from example-org/${branch}`], merge.at);
    h.pull(merge.pr, "MERGED", branch, git(["rev-parse", "HEAD"]), REPO, { mergedAt: merge.at.toISOString() });
    if (merge.ticket) await h.run(["work", "deliver", merge.ticket, "--repo", REPO, "--pr", String(merge.pr), "--key", `pr-${merge.pr}`]);
    await h.run(["work", "deliver", "--repo", REPO, "--pr", String(merge.pr)]);
  }
  // A slice merged into a wave branch the same day is landed too, but is no merge to main.
  h.pull(65, "MERGED", "wave-records/slice", "ddd6565", REPO, { mergedAt: local(10, 12).toISOString(), base: "wave/records" });
  await h.run(["work", "deliver", "--repo", REPO, "--pr", "65"]);

  const logged = git(["log", "--first-parent", "--merges", "--since=2026-03-10 00:00", "--until=2026-03-10 23:59:59", "--format=%H", "main"]).split("\n").sort();
  expect(logged).toHaveLength(3);
  expect(landedOn(h.store, "2026-03-10")).toEqual(logged);
});

test("completion needs a merged delivery and records proof, delivery Complete and Done", async () => {
  const h = await setup();
  const { json } = await h.create();
  const proofFile = h.file("proof.md", "Checked in a private fixture\n\nThe journey:\n- created\n- delivered");
  h.pull(9, "OPEN");
  const opened = await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "9"]);
  const deliveryId = opened.json.delivery.blockId;

  const unnamed = await h.run(["work", "complete", "PIE-001", "--proof-file", proofFile]);
  expect(unnamed.error).toContain(`PIE-001 has another incomplete delivery, so it cannot be done yet: PIE-001/primary ${deliveryId}`);
  expect(unnamed.error).toContain(`PR #9 is not merged (review): merge it and sync with work deliver PIE-001 --repo ${REPO} --pr 9 --key primary`);
  const unmerged = await h.run(["work", "complete", "PIE-001", "--delivery", deliveryId, "--proof-file", proofFile]);
  expect(unmerged.error).toContain("must have a merged PR");
  expect(h.store.children(json.blockId).map((child) => child.id)).toEqual([deliveryId]);

  h.pull(9, "MERGED", "feature/pie-001", "def5678");
  await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "9"]);
  const completed = await h.run(["work", "complete", "PIE-001", "--delivery", deliveryId, "--proof-file", proofFile]);
  expect(completed.json).toMatchObject({
    workId: "PIE-001", workStage: "done",
    proof: { created: true },
    deliveries: [{ blockId: deliveryId, deliveryKey: "PIE-001/primary", stage: "complete" }],
  });
  const proof = h.store.require(completed.json.proof.blockId);
  expect(proof.parentId).toBe(json.blockId);
  expect(parsePropertyRecords(proof.text).filter((record) => record.scope === "block").map(({ key, value }) => [key, value]))
    .toEqual([["type", "proof"], ["source-block", json.blockId]]);
  expect(proof.text).toContain("- delivered");
  const item = h.store.require(json.blockId);
  expect(item.properties).toContainEqual({ key: "work-stage", value: "done" });
  expect(item.properties).toContainEqual({ key: "proof", value: proof.id });

  const again = await h.run(["work", "complete", "PIE-001", "--proof-block", proof.id]);
  expect(again.error).toContain("already done");
});

test("a request ticketed from its copy follows the ticket; done gets its day and clears the owner ask (PIE-844)", async () => {
  const h = await setup();
  const stageOf = (id: string, key = "ticket-stage") => h.store.require(id).properties.find((property) => property.key === key)?.value;
  const request = h.store.create("A wide table wraps on the phone [type::request] [status::new] [from::node-b/abc]\n\nWhat happened, in the asker's words.");
  // Named before the item exists, and spelled loosely: it gets its stage when the item is made, and follows it after.
  const early = h.store.create("Asked ahead of the ticket [type::request] [ticket::[[PIE-1]]]");
  expect(stageOf(early.id)).toBeUndefined();
  const created = await h.create(["--source", request.id, "--wave", "orientation", "--author", "agent", "--actor", "test-agent"]);
  expect(created.json.workId).toBe("PIE-001");
  expect(h.store.require(created.json.blockId).properties).toContainEqual({ key: "wave", value: "orientation" });
  expect(h.store.require(request.id).properties).toEqual(expect.arrayContaining([
    { key: "ticket", value: "PIE-001" }, { key: "ticket-stage", value: "queued" },
  ]));
  expect(h.store.require(request.id).text).toContain("What happened, in the asker's words.");
  expect(h.store.recentEditActivity({ author: "agent", actorId: "test-agent", limit: 10 }).entries.map((entry) => entry.block.id))
    .toContain(request.id);

  // A second request, ticketed later by hand, and an unknown ticket refused before anything changes.
  const second = h.store.create("The same table, asked again [type::request] [status::new]");
  const unknown = await h.run(["work", "link", second.id, "PIE-042"]);
  expect(unknown.error).toContain("No block has Work ID PIE-042");
  const linked = await h.run(["work", "link", second.id, "PIE-1", "--expected", "1"]);
  expect(linked.json).toMatchObject({ blockId: second.id, workId: "PIE-001", previous: null, ticketStage: "queued", changed: true });
  const again = await h.run(["work", "link", early.id, "PIE-001"]);
  expect(again.json).toMatchObject({ previous: "[[PIE-1]]", changed: false });
  const self = await h.run(["work", "link", "PIE-001", "PIE-001"]);
  expect(self.error).toContain("is a roadmap item");

  // Every way a stage moves carries the copies with it: work stage, a PR sync, completion, a reopen.
  expect(stageOf(early.id)).toBe("queued");
  await h.run(["work", "stage", "PIE-001", "doing"]);
  expect([stageOf(request.id), stageOf(second.id), stageOf(early.id)]).toEqual(["doing", "doing", "doing"]);
  h.pull(21, "OPEN");
  await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "21"]);
  expect(stageOf(request.id)).toBe("review");
  h.pull(21, "MERGED", "feature/pie-001", "abc1234");
  await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "21"]);
  expect(stageOf(second.id)).toBe("validate");

  const asked = await h.run(["work", "set", "PIE-001", "needs", "sysop: a taste call on the wording"]);
  expect(asked.json).toMatchObject({ changed: true });
  const done = await h.run(["work", "complete", "PIE-001", "--all-merged", "--stdin"], "Checked on a scratch host");
  expect(done.json.workStage).toBe("done");
  const item = h.store.require(created.json.blockId);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  expect(item.properties).toContainEqual({ key: "done-at", value: today });
  expect(item.properties.some((property) => property.key === "needs")).toBe(false);
  expect(item.text.split("\n")[0]).not.toContain("  ");
  expect([stageOf(request.id), stageOf(second.id)]).toEqual(["done", "done"]);
  // The "Done today" lane and the Requests board are plain queries over these properties.
  expect(h.store.queryBlocks({ where: "type=roadmap-item done-at=today" }).blocks.map((block) => block.id)).toEqual([item.id]);
  expect(h.store.queryBlocks({ where: "type=request ticket-stage=done" }).blocks.map((block) => block.id).sort())
    .toEqual([request.id, second.id, early.id].sort());

  await h.run(["work", "stage", "PIE-001", "validate"]);
  expect(h.store.require(item.id).properties.some((property) => property.key === "done-at")).toBe(false);
  expect(stageOf(request.id)).toBe("validate");

  // Naming no ticket any more drops the stage it followed.
  const unlinked = h.store.require(second.id);
  h.store.update(second.id, unlinked.text.replace("[ticket::PIE-001]", ""), unlinked.revision);
  expect(stageOf(second.id)).toBeUndefined();
});

const DOOR = "example-org/example-door";

/** PIE-001 with a merged primary delivery in REPO (#11) and a merged one in DOOR (#12) under `doorKey`. */
async function twoMergedDeliveries(doorKey?: string) {
  const h = await setup();
  const { json } = await h.create();
  h.pull(11, "MERGED", "feature/pie-001", "aaa1111");
  const primary = await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "11"]);
  h.pull(12, "MERGED", "feature/pie-001-door", "bbb2222", DOOR);
  const door = await h.run(["work", "deliver", "PIE-001", "--repo", DOOR, "--pr", "12", ...(doorKey ? ["--key", doorKey] : [])]);
  expect(door.error).toBe("");
  return { h, itemId: json.blockId as string, primaryId: primary.json.delivery.blockId as string, door };
}

test("a second repository's PR becomes a second delivery named after the repository", async () => {
  const { h, itemId, primaryId, door } = await twoMergedDeliveries();
  expect(door.json).toMatchObject({
    workStage: "validate",
    delivery: { deliveryKey: "PIE-001/example-door", stage: "validate", created: true },
    pullRequest: { number: 12, url: `https://github.com/${DOOR}/pull/12` },
  });
  expect(h.store.require(door.json.delivery.blockId).properties).toContainEqual({ key: "repository", value: DOOR });
  expect(h.store.require(primaryId).properties).toContainEqual({ key: "repository", value: REPO });

  // Syncing either PR again finds its own delivery without a key.
  const again = await h.run(["work", "deliver", "PIE-001", "--repo", DOOR, "--pr", "12"]);
  expect(again.json.delivery).toMatchObject({ blockId: door.json.delivery.blockId, created: false });
  expect(h.store.children(itemId).length).toBe(2);
});

test("--key names a delivery; a second branch in primary's repository needs one", async () => {
  const h = await setup();
  await h.create();
  h.pull(21, "OPEN");
  await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "21"]);
  h.pull(22, "OPEN", "feature/pie-001-docs");
  const unnamed = await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "22"]);
  expect(unnamed.error).toContain(`PIE-001/primary (${REPO}:feature/pie-001) already records another branch of ${REPO}; pass --key <name>`);
  const taken = await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "22", "--key", "primary"]);
  expect(taken.error).toContain("PIE-001/primary already records");
  expect((await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "22", "--key", "PIE-002/docs"])).error)
    .toContain("does not belong to PIE-001");
  const named = await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "22", "--key", "docs"]);
  expect(named.json.delivery).toMatchObject({ deliveryKey: "PIE-001/docs", stage: "review", created: true });
});

test("completing one delivery is refused while another is incomplete, naming it and how to finish it", async () => {
  const { h, itemId, primaryId, door } = await twoMergedDeliveries("PIE-001/door");
  const doorId = door.json.delivery.blockId;
  const before = [itemId, primaryId, doorId].map((id) => h.store.require(id));
  const proofFile = h.file("proof.md", "Checked both deliveries");

  const one = await h.run(["work", "complete", "PIE-001", "--delivery", primaryId, "--proof-file", proofFile]);
  expect(one.exitCode).toBe(1);
  expect(one.error).toContain(
    `PIE-001 has another incomplete delivery, so it cannot be done yet: PIE-001/door ${doorId} — merged: include it with --delivery PIE-001/door, or use --all-merged`,
  );
  expect([itemId, primaryId, doorId].map((id) => h.store.require(id))).toEqual(before);
  expect(h.store.children(itemId).length).toBe(2);

  const both = await h.run(["work", "complete", "PIE-001", "--delivery", `${primaryId},door`, "--proof-file", proofFile]);
  expect(both.json).toMatchObject({
    workStage: "done",
    deliveries: [
      { blockId: primaryId, deliveryKey: "PIE-001/primary", stage: "complete" },
      { blockId: doorId, deliveryKey: "PIE-001/door", stage: "complete" },
    ],
  });
});

test("--all-merged completes every merged delivery, and refuses while one is unmerged", async () => {
  const { h, itemId, primaryId, door } = await twoMergedDeliveries();
  h.pull(13, "OPEN", "feature/pie-001-extra");
  const extra = await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "13", "--key", "extra"]);
  const proofFile = h.file("proof.md", "Checked every delivery");
  const before = h.store.require(itemId);

  const refused = await h.run(["work", "complete", "PIE-001", "--all-merged", "--proof-file", proofFile]);
  expect(refused.error).toContain(`PIE-001/extra ${extra.json.delivery.blockId} — PR #13 is not merged (review)`);
  expect(refused.error).toContain(`work deliver PIE-001 --repo ${REPO} --pr 13 --key extra`);
  expect(h.store.require(itemId)).toEqual(before);
  expect(h.store.children(itemId).length).toBe(3);
  expect((await h.run(["work", "complete", "PIE-001", "--all-merged", "--delivery", "extra", "--proof-file", proofFile])).error)
    .toContain("not both");

  h.pull(13, "MERGED", "feature/pie-001-extra", "ccc3333");
  await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "13", "--key", "extra"]);
  const done = await h.run(["work", "complete", "PIE-001", "--all-merged", "--proof-file", proofFile]);
  expect(done.json.workStage).toBe("done");
  expect(done.json.deliveries.map((delivery: { blockId: string; stage: string }) => [delivery.blockId, delivery.stage])).toEqual([
    [primaryId, "complete"], [door.json.delivery.blockId, "complete"], [extra.json.delivery.blockId, "complete"],
  ]);
});

test("a delivery left in validate on a done item is completed with work set, revision-checked", async () => {
  const h = await setup();
  const { json } = await h.create();
  h.pull(31, "MERGED", "feature/pie-001", "ddd4444");
  const primary = await h.run(["work", "deliver", "PIE-001", "--repo", REPO, "--pr", "31"]);
  await h.run(["work", "complete", "PIE-001", "--delivery", "primary", "--proof-file", h.file("proof.md", "Checked")]);
  h.pull(32, "MERGED", "feature/pie-001-door", "eee5555", DOOR);
  const door = await h.run(["work", "deliver", "PIE-001", "--repo", DOOR, "--pr", "32"]);
  expect(door.json).toMatchObject({ workStage: "done", delivery: { deliveryKey: "PIE-001/example-door", stage: "validate" } });
  const doorId = door.json.delivery.blockId;
  const revision = h.store.require(doorId).revision;

  const again = await h.run(["work", "complete", "PIE-001", "--proof-block", h.store.children(json.blockId)[1]!.id]);
  expect(again.error).toContain(`already done; finish a leftover delivery with work set <delivery> delivery-stage complete: PIE-001/example-door ${doorId} (validate)`);
  const refusals: Array<[string[], string]> = [
    [["work", "set", doorId, "delivery-stage", "complete", "--expected", String(revision + 5)], `is at revision ${revision}`],
    [["work", "set", doorId, "delivery-stage", "review"], "comes from its PR"],
    [["work", "set", doorId, "priority", "high"], "only delivery-stage"],
    [["work", "set", "PIE-001", "delivery-stage", "complete"], "belongs to a delivery"],
    [["work", "set", "PIE-001/nothing", "delivery-stage", "complete"], "PIE-001 has no delivery nothing"],
  ];
  for (const [args, message] of refusals) expect((await h.run(args)).error).toContain(message);
  expect(h.store.require(doorId).revision).toBe(revision);

  const set = await h.run(["work", "set", "PIE-001/example-door", "delivery-stage", "complete", "--expected", String(revision)]);
  expect(set.json).toMatchObject({
    workId: "PIE-001", taskBlockId: json.blockId, blockId: doorId, deliveryKey: "PIE-001/example-door",
    previous: "validate", stage: "complete", changed: true, revision: revision + 1,
  });
  expect(h.store.require(doorId).properties).toContainEqual({ key: "delivery-stage", value: "complete" });
  expect(h.store.require(primary.json.delivery.blockId).properties).toContainEqual({ key: "delivery-stage", value: "complete" });
  expect((await h.run(["work", "complete", "PIE-001", "--proof-block", h.store.children(json.blockId)[1]!.id])).error)
    .toBe("error: PIE-001 is already done");

  const reopened = await h.run(["work", "set", doorId, "delivery-stage", "validate", "--expected", String(revision + 1)]);
  expect(reopened.json).toMatchObject({ previous: "complete", stage: "validate", changed: true, revision: revision + 2 });
  const unchanged = await h.run(["work", "set", doorId, "delivery-stage", "validate"]);
  expect(unchanged.json).toMatchObject({ previous: "validate", stage: "validate", changed: false, revision: revision + 2 });
}, 30_000);

test("an existing proof block completes work that has no delivery; unlinked proof is refused", async () => {
  const h = await setup();
  const { json } = await h.create();
  const stray = h.store.create("Unrelated note");
  expect((await h.run(["work", "complete", "PIE-001", "--proof-block", stray.id])).error).toContain("must be a child of PIE-001");
  const proof = h.store.create(`Checked [type::proof] [source-block::${json.blockId}]`);
  const completed = await h.run(["work", "complete", "PIE-001", "--proof-block", proof.id]);
  expect(completed.json).toMatchObject({ workStage: "done", deliveries: [], proof: { blockId: proof.id, created: false } });
});

test("a note section is replaced up to the next heading of its level; the rest is kept", async () => {
  const h = await setup();
  const note = h.store.create([
    "Status brief [type::note]", "", "## Now", "", "old now", "", "## Next", "", "old next", "",
    "```", "## Not a heading", "```", "", "### Detail", "nested", "", "## Later", "", "later stays",
  ].join("\n"));
  const replaced = await h.run(["note", "section", note.id, "Next", "--stdin"], "fresh next\n");
  expect(replaced.json).toMatchObject({ blockId: note.id, revision: 2, heading: "## Next" });
  expect(replaced.json.previous).toBe("old next\n\n```\n## Not a heading\n```\n\n### Detail\nnested");
  expect(h.store.require(note.id).text).toBe([
    "Status brief [type::note]", "", "## Now", "", "old now", "", "## Next", "", "fresh next", "", "## Later", "", "later stays",
  ].join("\n"));

  const missing = await h.run(["note", "section", note.id, "Not a heading", "--stdin"], "x");
  expect(missing.error).toContain("headings: ## Now; ## Next; ## Later");
  const stale = await h.run(["note", "section", note.id, "Now", "--stdin", "--expected", "1"], "x");
  expect(stale.error).toContain("is at revision 2, not 1");
});

test("a trailing callout belongs to the last section, as Detail folds it, and comes back in previous", async () => {
  const h = await setup();
  const note = h.store.create("Brief\n\n## Last\n\nold\n\n> [!note]- History\n> earlier");
  const replaced = await h.run(["note", "section", note.id, "Last", "--stdin"], "new");
  expect(replaced.json.previous).toBe("old\n\n> [!note]- History\n> earlier");
  expect(h.store.require(note.id).text).toBe("Brief\n\n## Last\n\nnew");
});

test("an item body is replaced below its title and property lines", async () => {
  const h = await setup();
  const block = h.store.create("PIE-900 — Example [type::task]\n [project::demo] [owner::example]\n\nOld body\n- old");
  const replaced = await h.run(["work", "body", block.id, "--stdin", "--expected", "1"], "New body\n\n- new\n");
  expect(replaced.json).toMatchObject({ blockId: block.id, revision: 2, previous: "Old body\n- old" });
  const after = h.store.require(block.id);
  expect(after.text).toBe("PIE-900 — Example [type::task]\n [project::demo] [owner::example]\n\nNew body\n\n- new");
  expect(after.properties).toEqual(block.properties);
});

test("a service older than this client is refused with a restart instruction", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-work-old-"));
  const { env, socket } = scratchOutline(root);
  Bun.spawnSync(["mkdir", "-p", join(socket, "..")]);
  const old = createServer((connection) => connection.on("data", (chunk) => {
    const { id } = JSON.parse(String(chunk).split("\n")[0]!);
    connection.end(`${JSON.stringify({ id, ok: true, result: { status: "ready", protocolVersion: 1 } })}\n`);
  }));
  await new Promise<void>((resolve) => old.listen(socket, resolve));
  cleanups.push(async () => {
    await new Promise((resolve) => old.close(resolve));
    rmSync(root, { recursive: true, force: true });
  });
  const result = await runCli(isolatedEnv(env), ["work", "stage", "PIE-001", "doing"]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("the outline host protocol 1: restart the outline host");
  expect(result.stderr).toContain("restart the outline host on current code");
});

test("a title that begins with -- is the title, from the CLI and from the work_create tool's argv", async () => {
  const h = await setup();
  const title = "--machine and --remote never make an outline there";
  // The tool's own argv (the Claude mod's work_create), run against this service: `--title <value>` would be refused
  // as ambiguous; the tool passes `--title=<value>`.
  const { WORK_TOOLS } = await import("../../claude-mod/hooks/work-tools");
  const tool = WORK_TOOLS.find(t => t.name === "work_create")!;
  const command = tool.command({ title, project: "demo", arc: "--arc-ish", tracks: ["--track-ish"], priority: "low", body: "Body text." });
  if (typeof command === "string") throw new Error(command);
  const created = await h.run(command.args, command.stdin);
  expect(created.error).toBe("");
  const block = h.store.require(created.json.blockId);
  expect(block.text.split("\n")[0]).toContain(title);
  expect(block.properties).toContainEqual({ key: "arc", value: "--arc-ish" });
  // From the CLI: --title=<value> keeps the dashes; the spaced form is refused, saying what to write instead.
  const typed = await h.run(["work", "create", `--title=${title}`, "--project", "demo", "--arc", "workflow", "--track", "workflow", "--priority", "low"]);
  expect(h.store.require(typed.json.blockId).text.split("\n")[0]).toContain(title);
  const spaced = await h.run(["work", "create", "--title", title, "--project", "demo", "--arc", "workflow", "--track", "workflow", "--priority", "low"]);
  expect(spaced.exitCode).toBe(1);
  expect(spaced.error).toContain("--title=");
  // The other tools' operands go after `--`, the caller's flags (who, which session) before it, as the mod adds them.
  const { withOptions } = await import("../../claude-mod/hooks/work-tools");
  const run = async (name: string, input: Record<string, unknown>) => {
    const c = WORK_TOOLS.find(t => t.name === name)!.command(input);
    if (typeof c === "string") throw new Error(c);
    const r = await h.run(withOptions(c.args, ["--author", "agent", "--actor", "test-agent"]), c.stdin);
    expect(r.error).toBe("");
    return r.json;
  };
  const id = created.json.workId as string;
  expect(await run("work_stage", { ref: id, stage: "doing", expectedRevision: 1 })).toMatchObject({ workStage: "doing" });
  expect(await run("work_set", { ref: id, key: "arc", value: "--arc-of-dashes" })).toMatchObject({ value: "--arc-of-dashes" });
  const read = () => h.store.require(created.json.blockId).revision;
  await run("work_body", { ref: id, body: "## --flags heading\n\nFirst.", expectedRevision: read() });
  expect(await run("note_section", { ref: id, heading: "## --flags heading", body: "Second.", expectedRevision: read() })).toMatchObject({ previous: expect.stringContaining("First.") });
});

test("the mod's work_body and note_section replace text only on the revision the agent read (PIE-631)", async () => {
  const h = await setup();
  const { WORK_TOOLS } = await import("../../claude-mod/hooks/work-tools");
  const created = await h.run(["work", "create", "--title=Fictional kettle timer", "--project", "demo", "--arc", "workflow", "--track", "workflow", "--priority", "low"]);
  const id = created.json.workId as string;
  const { withOptions } = await import("../../claude-mod/hooks/work-tools");
  const tool = (name: string) => WORK_TOOLS.find(t => t.name === name)!;
  const run = (c: { args: string[]; stdin?: string }) => h.run(withOptions(c.args, ["--author", "agent", "--actor", "test-agent"]), c.stdin);
  // Without the revision it read, nothing runs: the agent is told to read it and pass the revision.
  for (const name of ["work_body", "note_section"]) {
    const refused = tool(name).command({ ref: id, heading: "## Plan", body: "Built from nothing." });
    expect(refused).toContain("outline_read");
    expect(refused).toContain("expectedRevision");
    expect((tool(name).inputSchema as { required: string[] }).required).toContain("expectedRevision");
  }
  // The agent reads, the person edits in between, and the agent's replacement built on the old read is refused.
  const seen = h.store.require(created.json.blockId);
  await run(tool("work_body").command({ ref: id, body: "## Plan\n\nThe person's plan.", expectedRevision: seen.revision }) as { args: string[]; stdin?: string });
  for (const [name, input] of [["work_body", { body: "## Plan\n\nStale." }], ["note_section", { heading: "## Plan", body: "Stale." }]] as const) {
    const stale = await run(tool(name).command({ ref: id, ...input, expectedRevision: seen.revision }) as { args: string[]; stdin?: string });
    expect(stale.exitCode).toBe(1);
    expect(stale.error).toContain("read it again");
  }
  expect(h.store.require(created.json.blockId).text).toContain("The person's plan.");
});
