// User-land rules (PIE-600): `match` (a property, a saved-view query, a text pattern outside code, a construct kind),
// `decorate` (built in, from a rule note, or the decorate operation), and `on` triggers that never loop on an
// extension's own writes. Every service here is a scratch service in a temp folder; every note, meeting and date is
// made up.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { readExtensionFolder } from "../src/extension-manifest";
import { renderComponent, validatePrimitive } from "../src/component-primitives";
import type { Decoration, RuleListEntry } from "../src/extension-rules";
import type { ExtensionsListResult } from "../src/extension-registry";
import type { ResourceProjectionReadResult } from "../src/resource-projection";
import type { Block, ChangeFeedPage } from "../src/types";

const REPO_EXTENSIONS = join(import.meta.dir, "..", "extensions");
const PERSON = { author: "user" as const };
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function until<T>(what: string, check: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

async function setup(options: { install?: string[]; quietMs?: number } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-rules-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outlineFolder = join(root, "outline");
  mkdirSync(join(outlineFolder, "extensions"), { recursive: true });
  for (const name of options.install ?? []) cpSync(join(REPO_EXTENSIONS, name), join(outlineFolder, "extensions", name), { recursive: true });
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outlineFolder });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, ruleQuietMs: options.quietMs ?? 100 });
  await server.start();
  const client = new OutlinerClient(socket);
  const events: Array<{ domain: string; action: string; blockId?: string }> = [];
  const connected = Promise.withResolvers<void>();
  const watcher = client.watch({
    client: { clientId: "rules-test-observer", role: "observer", contextId: "rules-test-observer" },
    onConnect: connected.resolve, onError: connected.reject, onEvent: (event) => { events.push(event); },
  });
  await connected.promise;
  cleanups.push(async () => {
    await watcher.stop();
    await server.close();
    store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  const create = (text: string, parentId?: string) => client.request<Block>({ action: "create", text, ...(parentId ? { parentId } : {}), author: "user" });
  const update = async (id: string, edit: (text: string) => string) => {
    const block = store.get(id)!;
    return client.request<Block>({ action: "update", blockId: id, text: edit(block.text), expectedRevision: block.revision, mutation: PERSON });
  };
  const list = (reload = false) => client.request<ExtensionsListResult & { rules: RuleListEntry[]; ruleProblems: string[] }>({ action: "extensions.list", ...(reload ? { reload: true } : {}) });
  const decorations = async (blockId: string) =>
    (await client.request<ResourceProjectionReadResult>({ action: "resources.projection.read", blockId })).decorations ?? [];
  const decorated = (blockId: string, ready: (ds: readonly Decoration[]) => boolean) => until("decorations", async () => {
    const ds = await decorations(blockId);
    return ready(ds) ? ds : null;
  });
  return { root, outlineFolder, store, server, client, events, create, update, list, decorations, decorated, extensionsFolder: join(outlineFolder, "extensions") };
}

function writeExtension(folder: string, id: string, manifest: Record<string, unknown>, code?: string): void {
  mkdirSync(join(folder, id), { recursive: true });
  writeFileSync(join(folder, id, "extension.json"), JSON.stringify({ contract: 2, id, version: 1, name: id, ...manifest }, null, 2));
  if (code !== undefined) writeFileSync(join(folder, id, "main.ts"), code);
}

// ── The manifest ─────────────────────────────────────────────────────────

test("a rule's manifest is checked: it must match something, do something, and name actions that act on the block", async () => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "outliner-rules-manifest-")));
  cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  const load = async (rules: unknown, extra: Record<string, unknown> = {}) => {
    writeExtension(folder, "r", { run: ["bun", "main.ts"], rules, ...extra });
    return readExtensionFolder(join(folder, "r"), "outline").then(() => "ok", (error: Error) => error.message);
  };
  expect(await load([{ id: "x", match: {}, decorate: { use: "badge" } }])).toContain("rules/0/match matches nothing");
  expect(await load([{ id: "x", match: { kind: "table" }, decorate: { use: "badge" } }])).toContain("rules/0/match/kind");
  expect(await load([{ id: "x", match: { text: "(" }, decorate: { use: "badge" } }])).toContain("rules/0/match/text");
  expect(await load([{ id: "x", match: { property: "type=meeting" } }])).toContain("does nothing");
  expect(await load([{ id: "x", match: { property: "type=meeting" }, on: { start: "nope" } }])).toContain("on/start names nope");
  expect(await load([{ id: "x", match: { property: "type=meeting" }, on: { start: "t" } }], { actions: [{ id: "t", label: "T", on: "tile:x" }], tiles: [{ kind: "x", name: "X", run: ["bun", "t.ts"] }] }))
    .toContain("a rule's action acts on the block");
  expect(await load([{ id: "x", match: { property: "type=meeting" }, decorate: { label: "{title}" } }])).toContain("no use");
  expect(await load([{ id: "x", match: { property: "type=meeting" }, decorate: { use: "card", fields: ["when"] } }])).toBe("ok");
  // A rule with a built-in decoration runs no code: no run needed.
  writeExtension(folder, "r", { rules: [{ id: "x", match: { kind: "h1" }, decorate: { use: "band" } }] });
  expect((await readExtensionFolder(join(folder, "r"), "outline")).command).toBeNull();
  for (const name of ["meeting-card", "done-stamp", "shout"]) await readExtensionFolder(join(REPO_EXTENSIONS, name), "user", { checkConfig: false });
});

test("band and track are primitives: checked, and drawn as a heading and a break where a target can't draw tracks", () => {
  const band = validatePrimitive({ type: "band", text: "Beds", level: 1, pattern: "stack", align: "center", row: "middle" });
  expect(renderComponent({ data: null, view: band }, "markdown").body).toBe("# Beds");
  expect(renderComponent({ data: null, view: band }, "html").body).toContain("<h1>Beds</h1>");
  expect(renderComponent({ data: null, view: band }, "terminal").body.split("\n")).toHaveLength(3);
  expect(renderComponent({ data: null, view: validatePrimitive({ type: "track", pattern: "dots" }) }, "markdown").body).toBe("---");
  expect(() => validatePrimitive({ type: "band", pattern: "zigzag" })).toThrow("view.pattern must be one of stack, waffle, uptime, dots, rule");
  expect(() => validatePrimitive({ type: "band", level: 4 })).toThrow("view.level must be 1, 2 or 3");
});

// ── Rule notes: the no-code tier ─────────────────────────────────────────

test("a rule note decorates with no code: a heading style is a band in the heading's place, scoped to a subtree", async () => {
  const { create, decorations, list, events } = await setup();
  const garden = await create("Garden\n# Beds\nRaised, by the shed.\n## Squash\nSow in May.");
  const elsewhere = await create("Kitchen\n# Shelves");
  const before = events.filter((event) => event.action === "extensions.changed").length;
  await create(`Garden headings [rule-name::garden-h1] [rule-under::((${garden.id}))] [rule-kind::heading:1] [rule-decorate::band] [rule-pattern::stack] [rule-align::center] [rule-style::tab]`);
  // Readers hear the rules changed, so they draw every note again.
  await until("extensions.changed", () => events.filter((event) => event.action === "extensions.changed").length > before);
  const ds = await decorations(garden.id);
  expect(ds).toHaveLength(1);
  expect(ds[0]).toMatchObject({ name: "garden-h1", place: "replace", status: "ready", hit: { at: "construct", line: 1, end: 2, text: "Beds", level: 1 },
    view: { type: "band", text: "Beds", level: 1, style: "tab", pattern: "stack", align: "center" }, markdown: "# Beds" });
  expect(await decorations(elsewhere.id)).toEqual([]);
  const listed = await list();
  expect(listed.rules.map((rule) => [rule.name, rule.source.kind, rule.decorate?.use])).toEqual([["garden-h1", "note", "band"]]);
});

test("rule notes: a card of the block's properties on a query, a text pattern outside code, and what's wrong said", async () => {
  const { create, decorations, list } = await setup();
  await create("Meetings [rule-name::meetings] [rule-match::type=meeting] [rule-decorate::card] [rule-fields::when, attendees] [rule-label::{title} at {where}]");
  await create("Shouting [rule-name::shouting] [rule-text::(\\S.*?)!!!$] [rule-decorate::text] [rule-tone::warn]");
  await create("Broken [rule-name::broken] [rule-decorate::sparkle] [rule-kind::list]");
  const meeting = await create("Committee [type::meeting] [when::Sat 10:00] [where::the shed] [attendees::Ann, Bo]");
  const [card] = await decorations(meeting.id);
  expect(card).toMatchObject({ name: "meetings", place: "above", hit: { at: "block" }, view: { type: "card", title: "Committee at the shed",
    children: [{ type: "row", children: [{ type: "stat", label: "when", value: "Sat 10:00" }, { type: "stat", label: "attendees", value: "Ann, Bo" }] }] } });
  const loud = await create("Plot\nClose the cold frame!!!\n```\nnot this!!!\n```\nnor `this!!!`");
  const shouts = await decorations(loud.id);
  expect(shouts.map((d) => [d.hit.line, d.view])).toEqual([[1, { type: "text", text: "Close the cold frame", strong: true, tone: "warn" }]]);
  expect((await list()).ruleProblems).toEqual([expect.stringContaining("decorate \"sparkle\" is one of band, card, badge, text, box, divider")]);
});

// ── An extension's rule: decorate with code ──────────────────────────────

test("meeting-card: a code rule's view is kept, comes when the property does and goes when it goes, and is drawn again for a new revision", async () => {
  const { create, update, decorations, decorated, events, store } = await setup({ install: ["meeting-card"] });
  const meeting = await create("Seed swap planning [type::chat] [when::Sun 11:00] [attendees::Ann, Bo, Cy]");
  await create("- [ ] bring the labels", meeting.id);
  expect(await decorations(meeting.id)).toEqual([]);
  await update(meeting.id, (text) => text.replace("[type::chat]", "[type::meeting]"));
  // The first read asks the extension; the view lands and readers are told.
  const first = await decorations(meeting.id);
  expect(first[0]).toMatchObject({ rule: "ext:meeting-card/card", status: "not-run" });
  await until("extensions.output", () => events.some((event) => event.action === "extensions.output" && event.blockId === meeting.id));
  const [card] = await decorated(meeting.id, (ds) => ds[0]?.status === "ready");
  expect(card).toMatchObject({ place: "above", title: "Meeting · Seed swap planning", view: { type: "card", title: "Seed swap planning", subtitle: "Sun 11:00", badge: { label: "meeting" } } });
  expect(JSON.stringify(card!.view)).toContain("Ann, Bo, Cy");
  expect(card!.markdown).toContain("**Seed swap planning**");
  // A new revision draws it again (the last one shown, stale, meanwhile).
  await update(meeting.id, (text) => text.replace("[attendees::Ann, Bo, Cy]", "[attendees::Ann, Dee]"));
  const [again] = await decorated(meeting.id, (ds) => ds[0]?.status === "ready" && JSON.stringify(ds[0].view).includes("Ann, Dee"));
  expect(again!.ranAt).toBeDefined();
  // The text was never written by the rule.
  expect(store.get(meeting.id)!.text).toBe("Seed swap planning [type::meeting] [when::Sun 11:00] [attendees::Ann, Dee]");
  await update(meeting.id, (text) => text.replace("[type::meeting]", "[type::chat]"));
  expect(await decorations(meeting.id)).toEqual([]);
  // Its kept view went with the hit.
  expect(store.extensionOutputs(meeting.id).filter((row) => row.callKey.startsWith("rule:"))).toEqual([]);
});

test("shout: a text pattern, drawn in the line's place; a line in a fence is code", async () => {
  const { create, decorated } = await setup({ install: ["shout"] });
  const note = await create("Plot\nClose the cold frame tonight!!!\n```\nrm -rf !!!\n```");
  const [band] = await decorated(note.id, (ds) => ds.length === 1 && ds[0]!.status === "ready");
  expect(band).toMatchObject({ place: "replace", hit: { at: "text", line: 1, captures: ["Close the cold frame tonight!!!", "Close the cold frame tonight"] },
    view: { type: "band", text: "CLOSE THE COLD FRAME TONIGHT", pattern: "dots", align: "center" }, markdown: "## CLOSE THE COLD FRAME TONIGHT" });
});

// ── Triggers ─────────────────────────────────────────────────────────────

test("done-stamp: start stamps, stop unstamps, attributed to the extension with who asked, and its own write never sets it off", async () => {
  const { create, update, store, list, extensionsFolder } = await setup();
  // Done before the rule was installed: its baseline, nothing runs for it.
  const old = await create("Prune the apple tree [status::done]");
  cpSync(join(REPO_EXTENSIONS, "done-stamp"), join(extensionsFolder, "done-stamp"), { recursive: true });
  await until("done-stamp", async () => (await list(true)).rules.some((rule) => rule.key === "ext:done-stamp/stamp"));
  const job = await create("Mend the water butt [status::todo]");
  await Bun.sleep(300);
  expect(store.get(old.id)!.text).toBe("Prune the apple tree [status::done]");
  const since = store.sequence;
  await update(job.id, (text) => text.replace("[status::todo]", "[status::done]"));
  const stamped = await until("the stamp", () => /\[done-at::\d{4}-\d\d-\d\d\]/.test(store.get(job.id)!.text) && store.get(job.id)!);
  // No loop: the extension's write is quiet; nothing else is written after it.
  await Bun.sleep(500);
  expect(store.get(job.id)!.revision).toBe(stamped.revision);
  const changes = (store.changes.since(since, 1000) as ChangeFeedPage & { kind: "changes" }).changes.filter((change) => change.blockId === job.id);
  expect(changes.map((change) => [change.actor?.actorId ?? change.actor?.author, change.requestedBy?.author])).toEqual([["user", undefined], ["ext:done-stamp", "user"]]);
  const rule = (await list()).rules.find((entry) => entry.key === "ext:done-stamp/stamp")!;
  expect(rule).toMatchObject({ on: { start: "stamp", stop: "unstamp" }, matching: 2, lastRun: { blockId: job.id, when: "start" } });
  // Several saves while typing: one trigger, after the quiet.
  await update(job.id, (text) => text.replace("[status::done]", "[status::doing]"));
  await update(job.id, (text) => `${text}\nthe tap leaks too`);
  await until("the stamp taken off", () => !store.get(job.id)!.text.includes("done-at") && store.get(job.id));
  expect(store.get(job.id)!.text).toBe("Mend the water butt [status::doing]\nthe tap leaks too");
  expect((await list()).rules.find((entry) => entry.key === "ext:done-stamp/stamp")).toMatchObject({ matching: 1, lastRun: { when: "stop" } });
});

test("a trigger never runs for another extension's write, and change runs on a save while it matches", async () => {
  const { create, update, store, extensionsFolder, list } = await setup();
  // `count` appends a line on every save while a block is [watch::on]; `poke` is another extension writing the block.
  writeExtension(extensionsFolder, "count", {
    run: ["bun", "main.ts"],
    actions: [{ id: "tick", label: "Tick", on: "block", effects: "write" }],
    rules: [{ id: "watch", match: { property: "watch=on" }, on: { change: "tick", start: "tick" } }],
  }, `const r = await Bun.stdin.json();
const t = r.input.target;
process.stdout.write(JSON.stringify({ ok: true, value: { writes: [{ op: "update", blockId: t.blockId, expectedRevision: t.revision, text: r.input.context.block.text + "\\ntick" }] } }));`);
  writeExtension(extensionsFolder, "poke", {
    run: ["bun", "main.ts"],
    actions: [{ id: "poke", label: "Poke", on: "block", effects: "write" }],
  }, `const r = await Bun.stdin.json();
const t = r.input.target;
process.stdout.write(JSON.stringify({ ok: true, value: { writes: [{ op: "update", blockId: t.blockId, expectedRevision: t.revision, text: r.input.context.block.text + "\\npoked" }] } }));`);
  await until("both extensions", async () => (await list(true)).rules.some((rule) => rule.key === "ext:count/watch"));
  const block = await create("Compost heap [watch::off]");
  await update(block.id, (text) => text.replace("off", "on"));
  await until("the first tick", () => store.get(block.id)!.text.endsWith("\ntick"));
  await update(block.id, (text) => `${text}\nturned it`);
  await until("the second tick", () => store.get(block.id)!.text.split("tick").length === 3);
  const revision = store.get(block.id)!.revision;
  // Another extension's write while it matches: no tick.
  await store.changes.run(store.changes.attribution({ action: "test", actor: { author: "agent", actorId: "ext:poke" } }), () =>
    store.update(block.id, `${store.get(block.id)!.text}\npoked`, revision, { author: "agent", actorId: "ext:poke" }));
  await Bun.sleep(500);
  expect(store.get(block.id)!.text.split("\n").filter((line) => line === "tick")).toHaveLength(2);
  expect(store.get(block.id)!.text.endsWith("poked")).toBe(true);
});

// ── The other clients: Detail and the publisher draw the same decorations as text ─────────

test("Detail shows a decoration as text under what it matched; the publisher puts its Markdown in the page", async () => {
  const { decorationProjection, resourceProjectionLayout } = await import("../src/detail-embeds");
  const { decoratedText } = await import("../src/publish");
  const band: Decoration = { rule: "note:x", name: "garden-h1", source: { kind: "note", blockId: "x" }, place: "replace", status: "ready",
    hit: { at: "construct", line: 1, end: 2, text: "Beds", level: 1, kind: "heading" }, view: { type: "band", text: "Beds", level: 1 }, markdown: "# Beds" };
  const card: Decoration = { ...band, name: "meetings", place: "above", hit: { at: "block", line: 0, end: 3, text: "Committee" }, markdown: "**Committee**\n\n- **when:** Sat 10:00" };
  const shown = decorationProjection(band);
  expect(shown.anchor.line).toBe(1);
  expect(resourceProjectionLayout(shown).lines).toEqual(["- Rule garden-h1 · replace the heading on line 2", "  # Beds"]);
  expect(resourceProjectionLayout(decorationProjection({ ...band, status: "not-run", markdown: undefined, reason: "shout is drawing it" })).lines)
    .toEqual(["- Rule garden-h1 · replace the heading on line 2 · not run yet", "  shout is drawing it"]);
  expect(decoratedText("Garden\n# Garden beds\nRaised.", [band, card])).toBe("Garden\n\n**Committee**\n\n- **when:** Sat 10:00\n\n\n# Beds\n\nRaised.");
  expect(decoratedText("Garden\n# Garden beds", [{ ...band, status: "not-run" }])).toBe("Garden\n# Garden beds");
  // Placed against the text as written: the card above doesn't push the band off its heading, and the first rule to
  // take a line keeps it (the other goes above it, as in the door).
  expect(decoratedText("Garden\n# Garden beds", [card, band, { ...band, markdown: "# Other" }]))
    .toBe("Garden\n\n**Committee**\n\n- **when:** Sat 10:00\n\n\n# Other\n\n\n# Beds\n");
});

test("a trigger rule whose match changes starts again from what matches now; a trashed block stops matching and runs nothing", async () => {
  const { create, update, store, extensionsFolder, list, client } = await setup();
  const manifest = (match: Record<string, string>) => ({ run: ["bun", "main.ts"], actions: [{ id: "tick", label: "Tick", on: "block", effects: "write" }],
    rules: [{ id: "watch", match, on: { start: "tick", stop: "tick" } }] });
  const code = `const r = await Bun.stdin.json();
const t = r.input.target;
process.stdout.write(JSON.stringify({ ok: true, value: { writes: [{ op: "update", blockId: t.blockId, expectedRevision: t.revision, text: r.input.context.block.text + "\\ntick" }] } }));`;
  const done = await create("Sweep the path [status::done]");
  const todo = await create("Rake the leaves [status::todo]");
  writeExtension(extensionsFolder, "count", manifest({ property: "status=done" }), code);
  await until("count", async () => (await list(true)).rules.find((rule) => rule.key === "ext:count/watch")?.matching === 1);
  // The match changes: the new baseline is todo's, and nothing runs for either block.
  writeExtension(extensionsFolder, "count", manifest({ property: "status=todo" }), code);
  await until("the new match", async () => (await list(true)).rules.find((rule) => rule.key === "ext:count/watch")?.match.query === "status=todo");
  expect((await list()).rules.find((rule) => rule.key === "ext:count/watch")?.matching).toBe(1);
  await Bun.sleep(300);
  expect(store.get(done.id)!.text).toBe("Sweep the path [status::done]");
  expect(store.get(todo.id)!.text).toBe("Rake the leaves [status::todo]");
  // Trashed: it stops matching, and no stop runs on a block in the Trash.
  await client.request({ action: "delete", blockId: todo.id, mutation: PERSON });
  await Bun.sleep(300);
  expect((await list()).rules.find((rule) => rule.key === "ext:count/watch")?.matching).toBe(0);
  void update;
});

test("no extension's write sets off any extension's trigger: done-stamp's [done-at::] never wakes a rule that matches it", async () => {
  const { create, update, store, extensionsFolder, list } = await setup({ install: ["done-stamp"] });
  // `noted` matches the stamp done-stamp writes and writes the block itself, on start and on every change. If an
  // extension's write could set a trigger off, the pair would bounce off each other.
  writeExtension(extensionsFolder, "noted", {
    run: ["bun", "main.ts"],
    actions: [{ id: "note", label: "Note it", on: "block", effects: "write" }],
    rules: [{ id: "seen", match: { property: "done-at" }, on: { start: "note", change: "note" } }],
  }, `const r = await Bun.stdin.json();
const t = r.input.target;
process.stdout.write(JSON.stringify({ ok: true, value: { writes: [{ op: "update", blockId: t.blockId, expectedRevision: t.revision, text: r.input.context.block.text + "\\nnoted" }] } }));`);
  await until("both rules", async () => (await list(true)).rules.filter((rule) => rule.key === "ext:noted/seen" || rule.key === "ext:done-stamp/stamp").length === 2);
  const job = await create("Clean the cold frame [status::todo]");
  await update(job.id, (text) => text.replace("[status::todo]", "[status::done]"));
  await until("the stamp", () => store.get(job.id)!.text.includes("[done-at::") && store.get(job.id));
  const stamped = store.get(job.id)!;
  await Bun.sleep(800);
  // One write after the person's: the stamp. `noted` never ran: [done-at::] came from an extension.
  expect(store.get(job.id)!.revision).toBe(stamped.revision);
  expect(store.get(job.id)!.text).not.toContain("noted");
  const rules = (await list()).rules;
  expect(rules.find((rule) => rule.key === "ext:noted/seen")).toMatchObject({ matching: 1 });
  expect(rules.find((rule) => rule.key === "ext:noted/seen")!.lastRun).toBeUndefined();
  // The person's own next save, while it matches, is a change: noted runs once, and done-stamp (start only) doesn't.
  await update(job.id, (text) => `${text}\nwiped the glass`);
  await until("noted", () => store.get(job.id)!.text.endsWith("\nnoted") && store.get(job.id));
  await Bun.sleep(800);
  expect(store.get(job.id)!.text.match(/noted/g)).toHaveLength(1);
  expect(store.get(job.id)!.text.match(/done-at/g)).toHaveLength(1);
});

// ── PIE-786: who a rule hears, rules in notes that run, and the guards ──────────────────────────

/** `seen` makes a child under each block it's called for, naming the trigger and the batch it was told of. */
const SEEN = `const r = await Bun.stdin.json();
const t = r.input.target, trig = r.input.trigger ?? {};
const ids = (trig.blocks ?? [{ blockId: t.blockId }]).map((b) => b.blockId);
process.stdout.write(JSON.stringify({ ok: true, value: { writes: ids.map((id) => ({ op: "create", parentId: id, text: "seen by " + trig.rule + " in a batch of " + ids.length })) } }));`;

/** An arrival another extension writes (what an EchoNet copy landing looks like): attributed to it. */
const arrive = (store: OutlinerStore, actorId: string, text: string, parentId?: string) =>
  store.changes.run(store.changes.attribution({ action: "test.arrive", actor: { author: "agent", actorId } }), () =>
    store.create(text, parentId ?? null, "agent", { actorId }));

test("rule-from: a rule note hears an extension's arrivals when it names it, never a trigger's own writes, here or tossed back", async () => {
  const { create, store, extensionsFolder, list } = await setup();
  writeExtension(extensionsFolder, "seen", { run: ["bun", "main.ts"], actions: [{ id: "note", label: "Note it", on: "block", effects: "write" }] }, SEEN);
  await until("seen", async () => (await list(true)).extensions.some((extension) => extension.id === "seen"));
  await create("Arrivals [rule-name::arrivals] [rule-match::type=request] [rule-on::seen/note] [rule-from::user, ext:relay]");
  await until("the rule", async () => (await list()).rules.find((rule) => rule.name === "arrivals")?.on?.from.includes("ext:relay"));
  const children = (id: string) => store.children(id).map((child) => child.text);
  // A copy arriving from ext:relay sets it off; the child it writes carries the trigger's mark and its task.
  const arrived = arrive(store, "ext:relay", "A request from the hub [type::request]");
  await until("the arrival seen", () => children(arrived.id).length === 1);
  expect(children(arrived.id)).toEqual(["seen by arrivals in a batch of 1 [via-trigger::arrivals]"]);
  // Another extension it doesn't name: nothing.
  const other = arrive(store, "ext:other", "A request from elsewhere [type::request]");
  // A copy of something a trigger wrote, tossed back (it keeps its mark): nothing, though ext:relay is heard.
  const tossed = arrive(store, "ext:relay", "Echoed [type::request] [via-trigger::arrivals]");
  // The trigger's own new block, if it matched (it's a request too): nothing.
  const own = store.children(arrived.id)[0]!;
  await store.changes.run(store.changes.attribution({ action: "test", actor: { author: "agent", actorId: "ext:seen", taskId: "trigger:arrivals" } }), () =>
    store.update(own.id, `${own.text} [type::request]`, own.revision, { author: "agent", actorId: "ext:seen", taskId: "trigger:arrivals" }));
  // A person's request: heard (user is named).
  const mine = await create("My own request [type::request]");
  await until("the person's seen", () => children(mine.id).length === 1);
  await Bun.sleep(400);
  expect([children(other.id), children(tossed.id), children(own.id)]).toEqual([[], [], []]);
  expect((await list()).rules.find((rule) => rule.name === "arrivals")).toMatchObject({ on: { start: "seen/note", from: ["user", "ext:relay"] }, ranToday: 2 });
});

test("a #tag in a comment counts as one in a note: a view lists the comment and a rule-match on the tag sets off for it", async () => {
  const { create, store, client, extensionsFolder, list } = await setup();
  writeExtension(extensionsFolder, "seen", { run: ["bun", "main.ts"], actions: [{ id: "note", label: "Note it", on: "block", effects: "write" }] }, SEEN);
  await until("seen", async () => (await list(true)).extensions.some((extension) => extension.id === "seen"));
  await create("Asks [rule-name::asks] [rule-match::#garden-ask] [rule-on::seen/note]");
  await until("the rule", async () => (await list()).rules.find((rule) => rule.name === "asks"));
  const lane = await create("Garden asks [type::virtual-branch] [query::#garden-ask]");
  const bed = await create("The north bed");
  const receipt = await client.request<{ annotations: { block: Block }[] }>({ action: "annotations.batch", requestId: crypto.randomUUID(), operations: [
    { operationId: "ask", type: "block-comment", input: { blockId: bed.id, expectedRevision: bed.revision, body: "#garden-ask more mulch here", source: "user" } }] });
  const comment = receipt.annotations[0]!.block;
  expect(store.readSavedView(lane.id).blocks.map((block) => block.id)).toEqual([comment.id]);
  // The rule note's own `#garden-ask` (a property's value) is no tag on it.
  expect(store.queryBlocks({ where: "#garden-ask" }).blocks.map((block) => block.id)).toEqual([comment.id]);
  await until("the comment seen", () => store.children(comment.id).length === 1);
  expect(store.children(comment.id).map((child) => child.text)).toEqual(["seen by asks in a batch of 1 [via-trigger::asks]"]);
});

test("guards: a batch gathers a burst into one call, a daily cap stops the rest, and skip leaves handled blocks alone", async () => {
  const { create, store, extensionsFolder, list, root } = await setup();
  writeExtension(extensionsFolder, "seen", { run: ["bun", "main.ts"], actions: [{ id: "note", label: "Note it", on: "block", effects: "write" }] }, SEEN);
  await until("seen", async () => (await list(true)).extensions.some((extension) => extension.id === "seen"));
  await create("Intake [rule-name::intake] [rule-match::type=ask] [rule-on::seen/note] [rule-batch::1s] [rule-cap::1/day] [rule-skip::triage=done]");
  await until("the rule", async () => (await list()).rules.find((rule) => rule.name === "intake")?.on?.batch === "1s");
  const asks = await Promise.all(["Fix the gate", "Paint the shed", "Order compost"].map((title) => create(`${title} [type::ask]`)));
  const handled = await create("Mow the lawn [type::ask] [triage::done]");
  await until("the batch", () => asks.every((ask) => store.children(ask.id).length === 1));
  expect(asks.map((ask) => store.children(ask.id)[0]!.text)).toEqual(Array(3).fill("seen by intake in a batch of 3 [via-trigger::intake]"));
  expect(store.children(handled.id)).toEqual([]);
  const listed = (await list()).rules.find((rule) => rule.name === "intake")!;
  expect(listed).toMatchObject({ ranToday: 1, lastRun: { when: "start", blocks: 3 } });
  // The cap is spent: the next burst calls nothing, and the rule says why.
  const late = await create("Sharpen the shears [type::ask]");
  await until("the cap said", async () => (await list()).rules.find((rule) => rule.name === "intake")?.lastRun?.error?.startsWith("capped"));
  expect(store.children(late.id)).toEqual([]);
  // The count is kept across a restart.
  expect(JSON.parse(await Bun.file(join(root, "rule-runs.json")).text()).counts).toEqual({ [listed.key]: 1 });
});

test("a rule note's action that can't run is said in ruleProblems", async () => {
  const { create, list } = await setup();
  await create("Ghost [rule-name::ghost] [rule-match::type=ask] [rule-on::nobody/nothing]");
  await create("Odd [rule-name::odd] [rule-match::type=ask] [rule-on::bad action] [rule-decorate::badge]");
  const { ruleProblems } = await until("problems", async () => { const l = await list(); return l.ruleProblems.length >= 2 && l; });
  expect(ruleProblems.join("\n")).toContain("rule-on names nobody/nothing, but nobody isn't installed here");
  expect(ruleProblems.join("\n")).toContain("rule-on \"bad action\" isn't an action");
});

test("a trigger's new block may ask its own extension's agent, which is asked at once; the same action run by hand can't", async () => {
  const { create, store, client, extensionsFolder, list } = await setup();
  writeExtension(extensionsFolder, "asker", {
    run: ["bun", "main.ts"],
    actions: [{ id: "ask", label: "Ask", on: "block", effects: "write" }],
    agents: [{ name: "helper", description: "Says what it found", effects: "spend" }],
  }, `const r = await Bun.stdin.json();
if (r.operation === "respond") process.stdout.write(JSON.stringify({ ok: true, value: { reply: "found two" } }));
else process.stdout.write(JSON.stringify({ ok: true, value: { writes: [{ op: "create", parentId: r.input.target.blockId, text: "Related\\n@helper what else is like this?" }] } }));`);
  await until("asker", async () => (await list(true)).extensions.some((extension) => extension.id === "asker"));
  await create("Look around [rule-name::look] [rule-match::type=ask] [rule-on::asker/ask]");
  await until("the rule", async () => (await list()).rules.some((rule) => rule.name === "look"));
  const ask = await create("Where do the hoses go [type::ask]");
  const child = await until("the child", () => store.children(ask.id)[0]);
  expect(child.text).toBe("Related [via-trigger::look]\n@helper what else is like this?");
  const row = await until("the agent's answer", () => store.agentRequests(child.id).find((r) => r.status === "replied"));
  expect(row).toMatchObject({ agent: "helper", reply: "found two", requestedBy: "user" });
  // By hand (no rule asked): the line still lands, but held for a person's r, never asked.
  const other = await create("Another [type::note]");
  await client.request({ action: "extensions.act", extension: "asker", extensionAction: "ask", blockId: other.id, mutation: PERSON });
  const handChild = await until("the hand-made child", () => store.children(other.id)[0]);
  expect(handChild.text).toContain("@helper what else is like this?");
  expect(store.agentRequests(handChild.id)).toMatchObject([{ agent: "helper", status: "waiting", message: "held: ext:asker may not wake @helper · r to send" }]);
});

test("what a triggered action writes over its own connection carries the trigger's marks too, so a rule hearing it doesn't loop", async () => {
  const { create, store, extensionsFolder, list } = await setup();
  writeExtension(extensionsFolder, "self", { run: ["bun", "main.ts"], actions: [{ id: "grow", label: "Grow", on: "block", effects: "write" }] }, `import { connect } from "node:net";
const r = await Bun.stdin.json();
const call = (request) => new Promise((resolve, reject) => {
  const c = connect(process.env.EP0CH_SOCKET); let b = "";
  c.on("data", (d) => { b += d; const n = b.indexOf("\\n"); if (n < 0) return; c.end(); const x = JSON.parse(b.slice(0, n)); x.ok ? resolve(x.result) : reject(new Error(x.error)); });
  c.on("error", reject);
  c.write(JSON.stringify({ id: crypto.randomUUID(), ...(process.env.EP0CH_WS ? { outline: process.env.EP0CH_WS } : {}), ...request, grant: process.env.EP0CH_EXT_GRANT }) + "\\n");
});
await call({ action: "create", parentId: r.input.target.blockId, text: "grown [type::seed]" });
process.stdout.write(JSON.stringify({ ok: true, value: {} }));`);
  await until("self", async () => (await list(true)).extensions.some((extension) => extension.id === "self"));
  // It hears its own extension: only the trigger's marks keep it from growing forever.
  await create("Grow [rule-name::grow] [rule-match::type=seed] [rule-on::self/grow] [rule-from::user, ext:self]");
  await until("the rule", async () => (await list()).rules.some((rule) => rule.name === "grow"));
  const seed = await create("A seed [type::seed]");
  const grown = await until("the child", () => store.children(seed.id)[0]);
  expect(grown.text).toBe("grown [type::seed] [via-trigger::grow]");
  await Bun.sleep(500);
  expect(store.children(grown.id)).toEqual([]);
  expect((await list()).rules.find((rule) => rule.name === "grow")?.ranToday).toBe(1);
});

test("a batch calls only what still stands when its window closes", async () => {
  const { create, update, store, extensionsFolder, list } = await setup();
  writeExtension(extensionsFolder, "seen", { run: ["bun", "main.ts"], actions: [{ id: "note", label: "Note it", on: "block", effects: "write" }] }, SEEN);
  await until("seen", async () => (await list(true)).extensions.some((extension) => extension.id === "seen"));
  await create("Intake [rule-name::intake] [rule-match::type=ask] [rule-on::seen/note] [rule-batch::1s]");
  await until("the rule", async () => (await list()).rules.some((rule) => rule.name === "intake"));
  const kept = await create("Fix the gate [type::ask]");
  const dropped = await create("Paint the shed [type::ask]");
  // Joined the batch, then stopped matching before the window closed: left out.
  await Bun.sleep(300);
  await update(dropped.id, (text) => text.replace("type::ask", "type::idea"));
  await until("the batch", () => store.children(kept.id).length === 1);
  expect(store.children(kept.id)[0]!.text).toBe("seen by intake in a batch of 1 [via-trigger::intake]");
  expect(store.children(dropped.id)).toEqual([]);
});

test("a runs file there that can't be read holds a capped rule rather than count from nothing", async () => {
  const { create, store, extensionsFolder, list, root } = await setup();
  // As the host finds it when it starts.
  writeFileSync(join(root, "rule-runs.json"), "{ not json");
  writeExtension(extensionsFolder, "seen", { run: ["bun", "main.ts"], actions: [{ id: "note", label: "Note it", on: "block", effects: "write" }] }, SEEN);
  await until("seen", async () => (await list(true)).extensions.some((extension) => extension.id === "seen"));
  await create("Capped [rule-name::capped] [rule-match::type=chore] [rule-on::seen/note] [rule-cap::5/day]");
  await create("Uncapped [rule-name::uncapped] [rule-match::type=chore] [rule-on::seen/note]");
  await until("the rules", async () => (await list()).rules.filter((rule) => rule.name.endsWith("capped")).length === 2);
  const chore = await create("Sweep [type::chore]");
  const rules = await until("held", async () => { const l = (await list()).rules; return l.find((rule) => rule.name === "capped")?.lastRun?.error?.startsWith("held:") && l; });
  // The uncapped rule runs; the capped one doesn't.
  expect(rules.find((rule) => rule.name === "uncapped")?.lastRun?.error).toBeUndefined();
  await until("the uncapped rule's child", () => store.children(chore.id).length === 1);
});
