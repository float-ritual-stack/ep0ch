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
