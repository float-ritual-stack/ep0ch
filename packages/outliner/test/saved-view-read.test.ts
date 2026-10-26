import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient, type RequestInput } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { readSavedView, type SavedViewReadResult } from "../src/saved-view-read";
import { waitingAsks } from "../src/waiting-you";
import { evaluateVirtualBranchMatches, isVirtualBranchDefinition, projectVirtualBranches } from "../src/virtual-branches";
import type { Block, TreeIndexBlock, VisibleBlockCollection, WorkspaceSnapshot } from "../src/types";

// The public helper and CLI cross a real service: this owns membership, bounds,
// read-only behavior and consistency. Existing Tree tests own descendant layout.
test("saved-view reads match Tree root order while preserving pane-independent membership and honest limits", async () => {
  const root = mkdtempSync(join(tmpdir(), "saved-view-read-"));
  const store = new OutlinerStore(join(root, "outline.sqlite"));
  const socket = join(root, "service.sock");
  const server = new OutlinerServer(store, socket);
  await server.start();
  const client = new OutlinerClient(socket);
  const create = (text: string, parentId?: string) => client.request<Block>({action: "create", text, parentId});
  const update = (block: Block, text: string) => client.request<Block>({action: "update", mutation: {author: "user"}, blockId: block.id, expectedRevision: block.revision, text});
  try {
    const a = await create("First [outbox::draft] [project::sample]");
    const b = await create("Second [outbox::draft] [project::sample]");
    await create("Other [outbox::draft] [project::other]");
    await create("Context only", a.id);
    await create("Inline only\n\nText [outbox::draft] [project::sample]");
    let view = await create("Drafts [type::virtual-branch] [query::outbox=draft project=sample] [limit::1] [expanded::false]");
    await client.request({action: "virtual.occurrences.reorder", viewId: view.id, orderedBlockIds: [b.id, a.id]});
    await client.request({action: "selection.set", blockId: a.id});
    const before = await client.request<WorkspaceSnapshot>({action: "workspace.snapshot"});
    const bounded = await readSavedView(client, view.id);
    expect([bounded.status, bounded.configuredLimit, bounded.effectiveLimit, bounded.revision]).toEqual(["ready", 1, 1, view.revision]);
    expect(bounded.blocks.map(block => block.id)).toEqual([b.id]);
    expect(bounded.completeness).toEqual({kind: "truncated", limit: 1});
    const projection = await projectVirtualBranches([before.physical.blocks.find(block => block.id === view.id)!],
      before.physical.blocks, query => client.request<VisibleBlockCollection>({action: "blocks.query", query}), before.virtualOccurrenceRanks);
    expect(projection.rows.filter(row => row.kind === "occurrence" && row.relativeDepth === 0).map(row => row.canonicalId)).toEqual([b.id]);
    const full = await readSavedView(client, view.id, {limit: 10});
    expect(full.blocks.map(block => block.id)).toEqual([b.id, a.id]);
    expect(full.completeness).toEqual({kind: "complete"});
    expect(await client.request<WorkspaceSnapshot>({action: "workspace.snapshot"})).toEqual(before);
    const proc = Bun.spawn([process.execPath, "run", "src/cli.ts", "view", view.id, "--limit", "10"], {
      cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe",
      env: {...process.env, OUTLINER_WORKSPACE_ROOT: root, EP0CH_SOCKET: socket, EP0CH_WS: "scratch"},
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    expect(await proc.exited, stderr).toBe(0);
    const cli: SavedViewReadResult = JSON.parse(stdout);
    expect(cli.blocks.map(block => block.id)).toEqual([b.id, a.id]);
    expect(cli.completeness).toEqual({kind: "complete"});
    await update(b, b.text.replace("outbox::draft", "outbox::waiting"));
    expect((await readSavedView(client, view.id)).blocks.map(block => block.id)).toEqual([a.id]);
    await update(a, a.text.replace("outbox::draft", "outbox::waiting"));
    const empty = await readSavedView(client, view.id);
    expect([empty.status, empty.blocks, empty.completeness]).toEqual(["ready", [], {kind: "complete"}]);
    view = await update(view, "Invalid [type::virtual-branch] [query::=]");
    const invalid = await readSavedView(client, view.id);
    expect([invalid.status, invalid.blocks, invalid.completeness]).toEqual(["invalid", [], null]);
    expect(invalid.errors.length).toBeGreaterThan(0);
    expect((await readSavedView(client, a.id)).status).toBe("unsupported");
    expect((await readSavedView(client, "missing")).status).toBe("missing");
    await expect(readSavedView(client, view.id, {limit: 1001})).rejects.toThrow("1 through 1000");
  } finally { await server.close(); store.close(); rmSync(root, {recursive: true, force: true}); }
});

test("views.read is one atomic service read with paging, exact totals, tree entries and structured errors", async () => {
  const root = mkdtempSync(join(tmpdir(), "saved-view-service-"));
  const store = new OutlinerStore(join(root, "outline.sqlite"));
  const server = new OutlinerServer(store, join(root, "service.sock"));
  await server.start();
  const client = new OutlinerClient(join(root, "service.sock"));
  const create = (text: string, parentId?: string) => client.request<Block>({action: "create", text, parentId});
  try {
    const view = await create("Drafts [type::virtual-branch] [query::outbox=draft] [limit::2]");
    const items: Block[] = [];
    for (const name of ["One", "Two", "Three", "Four", "Five"]) items.push(await create(`${name} [outbox::draft]`));
    const calls: string[] = [];
    const counted = {request<T>(input: RequestInput) { calls.push(input.action); return client.request<T>(input); }};
    const first = await readSavedView(counted, view.id);
    expect(calls).toEqual(["views.read"]);
    expect([first.status, first.total, first.offset, first.nextOffset, first.completeness]).toEqual(["ready", 5, 0, 2, {kind: "truncated", limit: 2}]);
    expect(first.blocks.map(block => block.id)).toEqual(items.slice(0, 2).map(block => block.id));
    const last = await readSavedView(client, view.id, {offset: 4});
    expect([last.blocks.map(block => block.id), last.total, last.nextOffset, last.completeness])
      .toEqual([[items[4]!.id], 5, undefined, {kind: "complete"}]);
    expect((await readSavedView(client, view.id, {offset: 9})).blocks).toEqual([]);
    const tree = await client.request<SavedViewReadResult<TreeIndexBlock>>({action: "views.read", viewId: view.id, format: "tree"});
    expect(tree.blocks.map(block => [block.id, block.preview, "text" in block])).toEqual(items.slice(0, 2).map(block => [block.id, expect.any(String), false]));
    expect((await readSavedView(client, view.id, {expectedRevision: view.revision + 1})).problems).toEqual([{code: "view-changed", message: expect.stringContaining("revision changed")}]);

    const invalid = await client.request<Block>({action: "update", mutation: {author: "user"}, blockId: view.id, expectedRevision: view.revision,
      text: 'Broken [type::virtual-branch] [query::outbox="draft]'});
    const broken = await readSavedView(client, invalid.id);
    expect([broken.status, broken.blocks, broken.completeness]).toEqual(["invalid", [], null]);
    expect(broken.problems).toEqual([{code: "view-invalid", property: "query", position: 7, message: broken.errors[0]!}]);
    expect(broken.errors[0]).toContain("at character 8");
    await client.request({action: "delete", blockId: view.id});
    expect((await readSavedView(client, view.id)).problems).toEqual([{code: "view-missing", message: expect.any(String)}]);
    await expect(readSavedView(client, view.id, {offset: -1})).rejects.toThrow("non-negative");
    await expect(client.request({action: "views.read", viewId: view.id, offset: -1})).rejects.toThrow("non-negative");
  } finally { await server.close(); store.close(); rmSync(root, {recursive: true, force: true}); }
});

// Parity with the evaluator Tree used before views.read: blocks.query plus the
// shared membership selection, over every saved view in a mixed fixture.
test("views.read matches the client evaluator for every saved view in a fixture", async () => {
  const root = mkdtempSync(join(tmpdir(), "saved-view-parity-"));
  const store = new OutlinerStore(join(root, "outline.sqlite"));
  const server = new OutlinerServer(store, join(root, "service.sock"));
  await server.start();
  const client = new OutlinerClient(join(root, "service.sock"));
  const create = (text: string, parentId?: string) => client.request<Block>({action: "create", text, parentId});
  try {
    const hub = await create("Hub");
    const ranked = await create("Ranked [type::virtual-branch] [query::type=task] [limit::3]", hub.id);
    await create("Sorted [type::virtual-branch] [query::type=task] [sort::updated] [direction::asc]", hub.id);
    await create("Created [type::virtual-branch] [query::type=task status=open] [sort::created]", hub.id);
    await create("Self match [type::virtual-branch] [type::task] [query::type]", hub.id);
    await create("Presence [type::virtual-branch] [query::priority]", hub.id);
    await create("Empty [type::virtual-branch] [query::type=nothing]", hub.id);
    await create("Invalid [type::virtual-branch] [query::=]", hub.id);
    await create("Bad limit [type::virtual-branch] [query::type=task] [limit::0]", hub.id);
    const tasks: Block[] = [];
    for (let index = 0; index < 8; index += 1) {
      const parent = index % 3 === 0 ? undefined : tasks[index - 1]?.id;
      tasks.push(await create(`Task ${index} [type::task] [status::${index % 2 ? "open" : "done"}]${index % 4 ? "" : " [priority::high]"}`, parent));
    }
    await create("Body only\n\n[type::task] in the body", hub.id);
    await client.request({action: "virtual.occurrences.reorder", viewId: ranked.id, orderedBlockIds: [tasks[5]!.id, tasks[2]!.id]});
    const trashed = await create("Trashed [type::task]");
    await client.request({action: "delete", blockId: trashed.id});
    await create("Trash [type::virtual-branch] [query::deleted=true]", hub.id);

    const snapshot = await client.request<WorkspaceSnapshot>({action: "workspace.snapshot"});
    const definitions = snapshot.physical.blocks.filter(isVirtualBranchDefinition);
    expect(definitions.length).toBeGreaterThanOrEqual(10); // plus seeded system views
    for (const definition of definitions) {
      for (const limit of [undefined, 1, 1000]) {
        const expected = await evaluateVirtualBranchMatches(definition, snapshot.physical.blocks,
          query => client.request<VisibleBlockCollection>({action: "blocks.query", query}), snapshot.virtualOccurrenceRanks, limit);
        const actual = await readSavedView(client, definition.id, limit === undefined ? {} : {limit});
        const label = `${definition.text.split(" [")[0]} limit=${limit}`;
        if (!expected.state.config) {
          expect([label, actual.status, actual.errors]).toEqual([label, "invalid", expected.state.configurationErrors]);
          continue;
        }
        expect([label, actual.status, actual.blocks.map(block => block.id), actual.completeness])
          .toEqual([label, "ready", expected.roots.map(block => block.id), expected.state.completeness]);
        expect(actual.blocks).toEqual(expected.roots);
      }
    }
  } finally { await server.close(); store.close(); rmSync(root, {recursive: true, force: true}); }
});

// Tree, the navigator and embeds read a small page of each view on every refresh.
// Ranking and totals cover every member; property hydration covers only the page.
test("views.read pages a large ranked view over one read of the outline", () => {
  const root = mkdtempSync(join(tmpdir(), "saved-view-large-"));
  const store = new OutlinerStore(join(root, "outline.sqlite"));
  try {
    const view = store.create("Tasks [type::virtual-branch] [query::type=task] [limit::20]");
    const count = 3000;
    const ids: string[] = [];
    (store as unknown as {database: {transaction(run: () => void): () => void}}).database.transaction(() => {
      for (let index = 0; index < count; index += 1) ids.push(store.create(`Task ${index} [type::task] [status::open]`).id);
    })();
    const ranked = [ids[2500]!, ids[10]!];
    store.reorderVirtualOccurrences(view.id, ranked);
    const expected = [...ranked, ...ids.filter(id => !ranked.includes(id))];

    // The outline is read once for every page (PIE-625: Tree reads every view after each change), not once per read.
    let reads = 0;
    const internals = store as unknown as {readGraph(): unknown};
    const readGraph = internals.readGraph.bind(store);
    internals.readGraph = () => { reads += 1; return readGraph(); };

    const first = store.readSavedView(view.id);
    expect([first.status, first.total, first.nextOffset, first.completeness]).toEqual(["ready", count, 20, {kind: "truncated", limit: 20}]);
    expect(first.blocks.map(block => block.id)).toEqual(expected.slice(0, 20));
    expect(first.blocks[0]).toEqual(expect.objectContaining({depth: 0, hasChildren: false, properties: [{key: "type", value: "task"}, {key: "status", value: "open"}]}));
    const middle = store.readSavedView(view.id, {offset: 1490, limit: 1000});
    expect(middle.blocks.map(block => block.id)).toEqual(expected.slice(1490, 2490));
    const tail = store.readSavedView(view.id, {offset: count - 5});
    expect([tail.blocks.map(block => block.id), tail.total, tail.completeness, tail.nextOffset])
      .toEqual([expected.slice(count - 5), count, {kind: "complete"}, undefined]);
    expect(reads).toBe(1);
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
}, 30_000);

// Client evaluation (virtual-child admission, bookmark scopes) sees one bounded
// blocks.query page. Pin where its truncation agrees with views.read and where the
// documented conservative difference begins.
test("client evaluator truncation agrees with views.read below limit 999", async () => {
  const root = mkdtempSync(join(tmpdir(), "saved-view-client-bound-"));
  const store = new OutlinerStore(join(root, "outline.sqlite"));
  try {
    const definition = store.create("Self [type::virtual-branch] [status::open] [query::status=open] [limit::998]");
    const physical = [definition] as never[];
    const matches = [definition, ...Array.from({length: 999}, (_, index) => ({...definition, id: `match-${index}`}))];
    const query = async () => ({blocks: matches, completeness: {kind: "truncated" as const, limit: 1000}}) as never;
    const bounded = await evaluateVirtualBranchMatches(definition as never, physical, query, [], 998);
    expect(bounded.state.queryError ?? bounded.state.configurationErrors).toEqual([]);
    expect([bounded.roots.length, bounded.state.completeness]).toEqual([998, {kind: "truncated", limit: 998}]);
    const edge = await evaluateVirtualBranchMatches(definition as never, physical, query, [], 1000);
    expect([edge.roots.length, edge.state.completeness]).toEqual([999, {kind: "truncated", limit: 1000}]);
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});

// How many levels each member opens to is the service's answer, never a property a client reads (PIE-882).
test("a view read says how deep its members open: its own child-depth, else the default", async () => {
  const root = mkdtempSync(join(tmpdir(), "saved-view-depth-"));
  const store = new OutlinerStore(join(root, "outline.sqlite"));
  const socket = join(root, "service.sock");
  const server = new OutlinerServer(store, socket);
  await server.start();
  const client = new OutlinerClient(socket);
  try {
    const create = (text: string) => client.request<Block>({ action: "create", text });
    const plain = await create("Chores [type::virtual-branch] [query::type=chore]");
    const deep = await create("Chores, deep [type::virtual-branch] [query::type=chore] [child-depth::5]");
    expect((await readSavedView(client, plain.id)).childDepth).toBe(2);
    expect((await readSavedView(client, deep.id)).childDepth).toBe(5);
  } finally {
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// PIE-1277: a view that says [property-scope::all] reads a chip on line 30 of a long note, says which line matched and
// whether its box is open, and drops the note when the box is ticked. Nothing here knows the key: it is the view's own.
test("a line-scope view finds an ask buried on line 30, and loses it when its box is ticked", async () => {
  const root = mkdtempSync(join(tmpdir(), "saved-view-lines-"));
  const store = new OutlinerStore(join(root, "outline.sqlite"));
  const socket = join(root, "service.sock");
  const server = new OutlinerServer(store, socket);
  await server.start();
  const client = new OutlinerClient(socket);
  const create = (text: string) => client.request<Block>({action: "create", text});
  const update = (block: Block, text: string) => client.request<Block>({action: "update", mutation: {author: "user"}, blockId: block.id, expectedRevision: block.revision, text});
  try {
    const filler = Array.from({length: 27}, (_, i) => `Paragraph ${i + 1} about the hedge.`);
    const long = await create(["Hedge plan [type::roadmap-item] [work-stage::doing]", "", ...filler, "- [ ] Which cutter? [asks::gardener: pick one]"].join("\n"));
    const settled = await create("Pond notes\n\n- [x] Fish count [asks::gardener: done already]");
    const header = await create("Fence [asks::gardener: paint colour]");
    await create("Shed [asks::gardener: finished] [work-stage::done]");
    const query = "[query::asks NOT work-stage=done NOT work-stage=superseded]";
    const blockOnly = await create(`Asks [type::virtual-branch] ${query}`);
    expect((await readSavedView(client, blockOnly.id)).blocks.map(block => block.id)).toEqual([header.id]);

    const view = await create(`Asks everywhere [type::virtual-branch] ${query} [property-scope::all]`);
    const read = await readSavedView(client, view.id);
    expect(read.blocks.map(block => block.id).sort()).toEqual([long.id, header.id].sort());
    const buried = read.blocks.find(block => block.id === long.id)!;
    expect(buried.propertyMatches?.map(match => [match.key, match.line, match.scope, match.task])).toEqual([["asks", 29, "inline", "todo"]]);
    expect(read.blocks.find(block => block.id === header.id)!.propertyMatches?.map(match => [match.scope, match.task])).toEqual([["block", undefined]]);
    expect(read.blocks.some(block => block.id === settled.id)).toBe(false);

    // Facets over line chips: the values `asks` has, at the view's scope (a ticked step's chip is settled).
    const facets = await client.request<VisibleBlockCollection>({action: "blocks.query", query: {where: "asks", propertyScope: "all", facets: ["asks"]}});
    expect(facets.facets?.[0]?.values.map(value => value.value).sort()).toEqual(["gardener: finished", "gardener: paint colour", "gardener: pick one"]);

    await update(long, long.text.replace("- [ ] Which", "- [x] Which"));
    expect((await readSavedView(client, view.id)).blocks.map(block => block.id)).toEqual([header.id]);

    const invalid = await create(`Bad [type::virtual-branch] ${query} [property-scope::everywhere]`);
    const refused = await readSavedView(client, invalid.id);
    expect(refused.errors.join(" ")).toContain("[property-scope::all]");
  } finally { await server.close(); store.close(); rmSync(root, {recursive: true, force: true}); }
});

// PIE-1277: the door's waiting-on-you list reads the same asks at every scope, each opening at its line.
test("waiting asks include a [needs::sysop: …] buried on a step, at its line, until the step is ticked", () => {
  const root = mkdtempSync(join(tmpdir(), "waiting-lines-"));
  const store = new OutlinerStore(join(root, "outline.sqlite"));
  try {
    const text = "Pond liner\n\nThe old one leaks.\n- [ ] Butyl or EPDM? [needs::sysop: choose the liner]";
    const note = store.create(text);
    const asks = waitingAsks(store).filter(a => a.block === note.id);
    expect(asks.map(a => [a.kind, a.reason, a.line, text.slice(a.at!, a.at! + a.label!.length)])).toEqual([["decision", "choose the liner", 3, "[needs::sysop: choose the liner]"]]);
    store.update(note.id, text.replace("- [ ]", "- [x]"), note.revision);
    expect(waitingAsks(store).filter(a => a.block === note.id)).toEqual([]);
  } finally { store.close(); rmSync(root, {recursive: true, force: true}); }
});
