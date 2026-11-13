// The action table (PIE-1531): every wire action is declared once in src/actions.ts, and the gates read the rows. This
// pins the rows to what main's separate lists said (MAIN, copied from them when they were deleted), names where they
// disagreed, and drives the two gates a row decides on a real server: the sync dispatch and the read-only copy.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WATCHABLE_ACTIONS } from "@ep0ch/outline-core/protocol";
import { ACTIONS, DECLARED, copyAnswers, extensionMay, isWatchable, isWatchedLater } from "../src/actions";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { OutlinerRequest } from "../src/types";

const MAIN = {
  read: ["agents.held","annotations.list","blocks.census","blocks.facets","blocks.grep","blocks.query","blocks.records","blocks.resolve","get","mcp.access.status","pages.resolve","ping","query.matches","references.backlinks","site.answer","site.sources","template.props","template.use","tree.index","tree.search","views.read","waiting.list"],
  copy: ["agents.held","annotations.list","artifacts.list","artifacts.show","artifacts.versions","blocks.census","blocks.facets","blocks.grep","blocks.query","blocks.read","blocks.records","blocks.resolve","callouts.types","changes.since","children","events.subscribe","extensions.list","get","mcp.access.status","outline.snapshot","pages.resolve","ping","query.matches","reader.report","reader.view","references.backlinks","shares.list","shares.revoke","shares.snapshot.finish","shares.snapshot.take","site.answer","site.sources","template.props","template.use","transclusions.read","tree.index","tree.search","views.read","waiting.list"],
  extensionReads: ["activity.recent","annotations.get","block.revisions","blocks.asks","blocks.authored-links","blocks.context","blocks.read","callouts.types","changes.since","children","components.schemas","components.usage","extensions.args","extensions.list","fragments.at","fragments.candidates","fragments.read","headings.styles","notes.address","notes.render","properties.catalog","properties.inventory","properties.preview","proposals.outcomes","references.resolve","scripts.render","site.answer","site.sources","styles.list","template.props","template.use","transclusions.read","tree.query","work-ids.status"],
  extensionWrites: ["annotations.batch","annotations.create","annotations.reply","create","delete","draft.patch","move","outputs.place","update"],
  host: ["devices.add","devices.list","devices.revoke","devices.shortcut.get","devices.shortcut.put","echonet.list","loki.lease.revoke","loki.lease.start","loki.lease.use","mcp.access.files","outlines.archive","outlines.attach","outlines.close","outlines.create","outlines.delete","outlines.import","outlines.list","outlines.pane","outlines.unarchive","uploads.finish","uploads.take","web.sessions.list","web.sessions.resolve","web.sessions.revoke","web.sessions.start"],
  whole: ["activity.recent","blocks.authored-links","blocks.facets","blocks.grep","blocks.query","blocks.records","callouts.types","checklist.search","components.schemas","fragments.candidates","headings.styles","pages.complete","properties.catalog","properties.inventory","query.matches","references.backlinks","references.soft-scope","site.answer","styles.list","tree.focus","tree.index","tree.query","tree.search","views.read","workspace.snapshot"],
  async: ["artifacts.backfill","artifacts.deploy","artifacts.dns","artifacts.import","artifacts.lease","artifacts.list","artifacts.put","artifacts.rm","artifacts.show","artifacts.snapshot","artifacts.upload.abort","artifacts.upload.begin","artifacts.upload.chunk","artifacts.upload.finish","artifacts.versions","blocks.asks","completion.cancel","completion.picked","completion.rows","computed.execute","draft.patch","draft.proposal.apply","draft.proposal.dismiss","draft.proposal.resolve","drafts.read","echonet.bulletin","echonet.put","echonet.take","extensions.act","extensions.args","extensions.bar","extensions.configure","extensions.install","extensions.list","extensions.schedule.run","extensions.undo","extensions.uninstall","notes.address","notes.page","notes.render","outline.snapshot","outputs.place","query.suggest","quote","reader.report","reader.view","resources.command.execute","resources.follow-authored","resources.open","resources.projection.refresh","resources.refresh","roadmap.items.attach","roadmap.items.similar","scripts.render","scripts.run","scripts.sequence","scripts.stop","search.picked","search.picks","shares.list","shares.resolve","shares.revoke","shares.snapshot.finish","shares.snapshot.take","shares.start","shares.tunnel","suggestions.asks","suggestions.keep","suggestions.stamp"],
  events: ["annotations.approve-resolution","annotations.batch","annotations.create","annotations.lifecycle","annotations.propose-agent","annotations.read","annotations.reconcile","annotations.reply","annotations.review-agent","annotations.update","attention.acknowledge","attention.advance","attention.clear","attention.mark","blocks.markRead","bookmarks.remove","bookmarks.toggle","browsing-context.publish","capture.create","capture.draft.clear","capture.draft.save","capture.retitle","checklist.update","computed.execute","computed.invocations.create","computed.invocations.revise","create","delete","deliveries.ensure","deliveries.sync","edit-recovery.commit","edit-recovery.separate","fragments.ensure","mcp.access.configure","mentions.clear","mentions.ingest","mentions.save","move","navigation.back","navigation.dispatch","navigation.forward","notes.create","pages.alias","pages.follow","pages.remove","pages.rename","properties.patch","quote","resource-sources.create","resources.collect","resources.command.execute","resources.follow-authored","resources.intern","resources.intern-filesystem","resources.refresh","resources.relocate","resources.retention.configure","resources.retention.pin","resources.retention.reference","resources.retention.unpin","resources.retention.unreference","resources.write-filesystem","roadmap.items.create","selection.set","template.stamp","trash.purge","trash.restore","ui.command.send","update","virtual.occurrences.move","virtual.occurrences.place","virtual.occurrences.reorder","work-ids.allocate","work-ids.configure"],
};

/** Marks (PIE-1237), added after main's lists: an extension may mark (attributed `ext:<id>`) and read them. */
const MARKS = { reads: ["marks.list"], writes: ["marks.add", "marks.remove"] };

const sorted = (set: Iterable<string>) => [...new Set(set)].sort();
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test("each list main kept is now one column of the table", () => {
  // screens.list and screens.save are answered by their own module, which asks the service for what it reads and writes;
  // so are lists.read, tiles.view (a rendered tile's view) and outlines.known (the host's listing, else the module's).
  expect(sorted(DECLARED.async)).toEqual(sorted([...MAIN.async, "door.act", "media.copies", "media.read", "screens.list", "screens.save", "lists.read", "tiles.view", "outlines.known"]));
  expect(sorted(DECLARED.whole)).toEqual(MAIN.whole);
  expect(sorted(DECLARED.extensionWrites)).toEqual(sorted([...MAIN.extensionWrites, "door.act", "properties.patch", ...MARKS.writes]));
  expect(sorted(DECLARED.events)).toEqual(sorted([...MAIN.events, ...MARKS.writes]));
  // Watchable reads stay listed in outline-core, the wire's side; the rows must say the same.
  expect(sorted(DECLARED.watch)).toEqual(sorted(WATCHABLE_ACTIONS));
  // outlines.list: the host's, answered by a read-only host too (outline-host.ts named it outright before).
  // outlines.backup: the host's copy of an outline, so nothing else opens its file (PIE-1750).
  expect(sorted(DECLARED.host)).toEqual(sorted([...MAIN.host, "outlines.backup"]));
  // log.range: a follower answers its home's log onward (ADR 0009).
  expect(sorted(DECLARED.copy)).toEqual(sorted([...MAIN.copy, "outlines.list", "references.soft", "references.soft-scope", "media.copies", "media.read", "log.range", "screens.list", "lists.read", "tiles.view", "outlines.known", "notes.page", ...MARKS.reads]));
  // An extension's call: main's reads, its extension reads and writes, EchoNet's mail, and the two asExtension let through by name.
  expect(sorted(DECLARED.extension)).toEqual(sorted([...MAIN.read, ...MAIN.extensionReads, ...MAIN.extensionWrites, "door.act", "properties.patch", "references.soft", "references.soft-scope", ...MARKS.reads, ...MARKS.writes,
    "echonet.bulletin", "echonet.put", "echonet.take", "events.subscribe", "secrets.group",
    // PIE-1711: yo reads a find's words into a query, as the facets tile's query line does.
    "query.suggest", "screens.list", "lists.read",
    // Plain reads as those two are: what a script renders for a tile, and the names of the outlines there are.
    // A note as parts is a read like them: a read-only copy answers it, and an extension may ask it.
    "tiles.view", "outlines.known", "notes.page"]));
});

test("a read a module answers and keeps watched says so on its row, and is listed with the rest", () => {
  // notes.page and screens.list are the reads a native window watches most; their answers take a turn (askLater).
  for (const action of ["notes.page", "screens.list", "lists.read"] as const) {
    expect(ACTIONS[action].watch, action).toBe("later");
    expect(WATCHABLE_ACTIONS as readonly string[], action).toContain(action);
    expect(isWatchedLater(action) && !isWatchable(action), action).toBe(true);
  }
  // A write a module answers is never watched, whatever the request says.
  expect(isWatchedLater("screens.save")).toBe(false);
});

test("blocks.read is a read a client may watch: main's copy and extension lists both had it, the read-only list didn't", () => {
  expect(MAIN.read).not.toContain("blocks.read");
  expect(MAIN.copy).toContain("blocks.read");
  expect(MAIN.extensionReads).toContain("blocks.read");
  expect(ACTIONS["blocks.read"]).toEqual({ read: true, watch: true });
});

test("the rows agree with each other", () => {
  for (const [action, row] of Object.entries(ACTIONS) as [string, Record<string, unknown>][]) {
    const where = `${action}: ${JSON.stringify(Object.keys(row))}`;
    // A read never broadcasts, and nothing a read-only copy answers changes it.
    if (row.read || row.copy) expect(row.event, where).toBeUndefined();
    if (row.read || row.copy) expect(extensionMay(action) === "write", where).toBe(false);
    // The host's actions never reach one outline's dispatch or its feed.
    if (row.host) expect([row.async, row.event, row.ext, row.watch, row.whole], where).toEqual([undefined, undefined, undefined, undefined, undefined]);
    // A watched read is one an extension may make (blocks.authored-links is watched but not answered by a copy: the web
    // client's pages of a copy don't ask it, and this changes no access). The whole-outline lane holds only reads.
    // (A read a module answers and watches itself, `watch: "later"`, is the module's to offer: notes.page is no extension's read.)
    if (row.watch === true) expect(extensionMay(action), where).toBe("read");
    if (row.whole) expect([row.event, row.async, extensionMay(action) === "write"], where).toEqual([undefined, undefined, false]);
    if (row.read) expect(row.copy, where).toBeUndefined();
  }
});

function server(readOnly = false) {
  const directory = mkdtempSync(join(tmpdir(), "actions-table-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  const service = new OutlinerServer(store, join(directory, "outliner.sock"), undefined, undefined, { readOnly });
  cleanups.push(async () => { await service.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  return service;
}

test("the sync dispatch refuses what the host and the async path answer, by their rows", () => {
  const service = server();
  for (const action of [...DECLARED.host, ...DECLARED.async]) {
    const answer = service.handle({ id: "t", action } as unknown as OutlinerRequest);
    expect(answer.ok, action).toBe(false);
    expect(!answer.ok && answer.error, action).toBe(DECLARED.host.has(action)
      ? `${action} is answered by the outline host, never by one outline`
      : `${action} requires asynchronous dispatch`);
  }
});

test("a read-only copy answers its rows and refuses every other action", async () => {
  const service = server(true);
  await service.start();
  const client = new OutlinerClient(service.socketPath);
  for (const action of Object.keys(ACTIONS)) {
    const error = await client.request({ action } as never).then(() => "", (e: Error) => e.message);
    const refused = error.includes("is a read-only copy");
    expect(refused, `${action}: ${error}`).toBe(!copyAnswers(action));
  }
});
