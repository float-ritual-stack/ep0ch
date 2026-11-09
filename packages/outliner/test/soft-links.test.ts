import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { OutlinerStore } from "../src/store";
import { readBlockRecords } from "../src/block-records";
import { linkSoftWords, pageAddressesToResolve, softPageAddresses } from "../src/publish-soft-links";
import { outlinerLinkUri, parseOutlinerLinkUri, resolveOutlinerLinkTarget } from "../src/outliner-links";
import { softMentionRows } from "../src/soft-links";
import { resolveBacklinkRelation } from "../src/backlinks";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function store(): OutlinerStore {
  const directory = mkdtempSync(join(tmpdir(), "outliner-soft-links-"));
  const result = new OutlinerStore(join(directory, "outliner.sqlite"));
  cleanups.push(() => { result.close(); rmSync(directory, { recursive: true, force: true }); });
  return result;
}

const landed = (answer: { status: string; candidates: { block?: { id: string }; create?: unknown }[] }) =>
  [answer.status, answer.candidates.map(c => c.block?.id ?? c.create)];

describe("where a soft link lands", () => {
  test("a value lands on its page, in any case; none offers a stub and makes nothing", () => {
    const s = store();
    const page = s.create("Agent labour [page::Agent-Labour]");
    expect(landed(s.softLink({ kind: "value", value: "agent-labour" }, {}))).toEqual(["resolved", [page.id]]);
    expect(landed(s.softLink({ kind: "value", value: "no such" }, {}))).toEqual(["missing", [{ address: "no such" }]]);
    expect(s.resolvePageAddress("no such").status).toBe("missing");
  });

  test("a date lands on that day's note: the date's page, or the note that says it is that day's", () => {
    const s = store();
    const log = s.create("Build log [day::2026-11-05]");
    expect(landed(s.softLink({ kind: "date", day: "2026-11-05" }, {}))).toEqual(["resolved", [log.id]]);
    const page = s.create("2026-11-05 [page::2026-11-05]");
    expect(landed(s.softLink({ kind: "date", day: "2026-11-05" }, {}))).toEqual(["ambiguous", [page.id, log.id]]);
    expect(landed(s.softLink({ kind: "date", day: "2026-11-06" }, {}))).toEqual(["missing", [{ address: "2026-11-06" }]]);
  });

  test("PR#125 is the nearest project's; two different destinations, and a chooser when one scope has two", () => {
    const s = store();
    const floatty = s.create("Floatty [type::project] [page::floatty]");
    const hub = s.create("Hub [type::project] [page::hub]");
    const hers = s.create("PR#125 fix the ribbon", floatty.id);
    const his = s.create("PR#125 fix the kettle", hub.id);
    s.create("PR#1250 not this one", hub.id);
    const under = s.create("Notes [project::floatty]\nsaw PR#125 here");
    expect(landed(s.softLink({ kind: "pr", number: 125 }, { blockId: under.id, line: 1 }))).toEqual(["resolved", [hers.id]]);
    const nested = s.create("A child with PR#125", s.create("Parent [project::hub]").id);
    // Under the project's own page, that's the project.
    const home = s.create("Saw PR#125 here", hub.id);
    expect(landed(s.softLink({ kind: "pr", number: 125 }, { blockId: home.id, line: 0 }))).toEqual(["resolved", [his.id]]);
    expect(landed(s.softLink({ kind: "pr", number: 125 }, { blockId: nested.id, line: 0 }))).toEqual(["resolved", [his.id]]);
    const both = s.create("Title\n[project::floatty] and [project::hub] on PR#125");
    expect(landed(s.softLink({ kind: "pr", number: 125 }, { blockId: both.id, line: 1 }))).toEqual(["ambiguous", [hers.id, his.id]]);
    // Nearest first, within a block: the line above at the same indent wins.
    const lines = s.create("Title [project::floatty]\nproject:: hub\nPR#125");
    expect(landed(s.softLink({ kind: "pr", number: 125 }, { blockId: lines.id, line: 2 }))).toEqual(["resolved", [his.id]]);
  });

  test("a project's PR that isn't there offers to make it under that project; no project offers a page", () => {
    const s = store();
    s.create("Floatty [page::floatty]");
    const under = s.create("Notes [project::floatty]\nPR#9");
    expect(landed(s.softLink({ kind: "pr", number: 9 }, { blockId: under.id, line: 1 }))).toEqual(["missing", [{ address: "PR#9", under: "floatty" }]]);
    expect(landed(s.softLink({ kind: "pr", number: 9 }, {}))).toEqual(["missing", [{ address: "PR#9" }]]);
  });
});

describe("soft mentions", () => {
  const kinds = (c: { sources: { blockId: string; facets?: { kind: string; kindLabel: string } }[] }) => Object.fromEntries(c.sources.map(x => [x.blockId, x.facets?.kind]));

  test("a value, a date and a PR show on the target in their own group, and change no text", () => {
    const s = store();
    const page = s.create("Agent labour [page::agent-labour]");
    const soft = s.create("Thoughts [thread::agent-labour]");
    const line = s.create("Other\nthread:: Agent-Labour");
    const linked = s.create("Explicit [[agent-labour]]");
    const unrelated = s.create("Other [thread::agent-labour-2]");
    const answer = s.queryBacklinks({ targetBlockId: page.id, limit: 50, softMentions: true });
    expect(kinds(answer)).toEqual({ [soft.id]: "mention", [line.id]: "mention", [linked.id]: "note" });
    expect(answer.sources.find(x => x.blockId === soft.id)!.facets!.kindLabel).toBe("Soft mentions");
    expect(answer.sources.some(x => x.blockId === unrelated.id)).toBe(false);
    expect(s.get(soft.id)!.revision).toBe(1);
  });

  test("a day's note lists the dates that land on it", () => {
    const s = store();
    const log = s.create("Build log [day::2026-11-05]");
    const ctx = s.create("Note\nctx:: 2026-11-05 @ 4:31 AM");
    const prose = s.create("We met on 2026-11-05 at the shed");
    expect(kinds(s.queryBacklinks({ targetBlockId: log.id, limit: 50, softMentions: true }))).toEqual({ [ctx.id]: "mention", [prose.id]: "mention" });
  });

  test("a value holding code with brackets is no name: the day's note still lists the note (PIE-1640)", () => {
    const s = store();
    const log = s.create("Garden log [day::2026-04-02]");
    // A quoted time in a code span: no page can have that address, so it names nothing, and never fails the read.
    const quoted = s.create("Seed tray review [title::- `[9:15 AM]` morning-dump]\nwatered on 2026-04-02");
    const plain = s.create("Planted beans on 2026-04-02");
    expect(kinds(s.queryBacklinks({ targetBlockId: log.id, limit: 50, softMentions: true }))).toEqual({ [quoted.id]: "mention", [plain.id]: "mention" });
  });

  test("a note the relation can't read is skipped and named; the rest still answer (PIE-1640)", () => {
    const s = store();
    const target = s.create("PR#7 fix the gate");
    const fine = s.create("Saw PR#7 today"), odd = s.create("Odd tray: PR#7 again");
    // Made up: whether PR#7 lands throws for one note, as an unreadable one would.
    const soft = { addresses: new Set<string>(), days: new Set<string>(), ignore: [], pr: 7, prLands: (_: number, blockId: string) => { if (blockId === odd.id) throw new Error("cannot read"); return true; } };
    const all = [target, fine, odd].map(b => s.get(b.id)!);
    const answer = resolveBacklinkRelation({ query: { targetBlockId: target.id, limit: 50, softMentions: true }, target: all[0]!, orderedBlocks: all, blocksById: new Map(all.map(b => [b.id, b])), addressTargets: new Map(), workIdPrefix: null, soft });
    expect(answer.sources.map(x => x.blockId)).toEqual([fine.id]);
    expect(answer.skipped).toEqual([{ blockId: odd.id, title: "Odd tray: PR#7 again", reason: "cannot read" }]);
    expect(answer.completeness).toEqual({ kind: "complete" });
  });

  test("a project's PR note lists its own mentions, not the other project's", () => {
    const s = store();
    const floatty = s.create("Floatty [type::project] [page::floatty]"), hub = s.create("Hub [type::project] [page::hub]");
    const hers = s.create("PR#125 ribbon", floatty.id), his = s.create("PR#125 kettle", hub.id);
    const a = s.create("About [project::floatty]\nsee PR#125"), b = s.create("About [project::hub]\nsee [PR::125]");
    expect(kinds(s.queryBacklinks({ targetBlockId: hers.id, limit: 50, softMentions: true }))).toEqual({ [a.id]: "mention" });
    expect(kinds(s.queryBacklinks({ targetBlockId: his.id, limit: 50, softMentions: true }))).toEqual({ [b.id]: "mention" });
  });

  test("a bare ticket key is a mention; a key written as a property's value or a link stays a link", () => {
    const s = store();
    s.configureWorkIdPrefix("PIE");
    let ticket = s.create("Fix the gate");
    ticket = s.allocateWorkId(ticket.id, ticket.revision).block;
    const bare = s.create("Saw PIE-001 today"), prop = s.create("Note [ticket::PIE-001]"), link = s.create("Note [[PIE-001]]");
    const answer = kinds(s.queryBacklinks({ targetBlockId: ticket.id, limit: 50, softMentions: true }));
    expect(answer[bare.id]).toBe("mention");
    expect(answer[prop.id]).not.toBe("mention");
    expect(answer[link.id]).not.toBe("mention");
  });

  test("a key a note excludes neither links nor mentions; a machinery note never mentions", () => {
    const s = store();
    const page = s.create("high [page::high]");
    s.create("Task [priority::high]");
    expect(s.queryBacklinks({ targetBlockId: page.id, limit: 50, softMentions: true }).sources).toHaveLength(1);
    s.create("Keys that aren't links [soft-link-ignore::priority]");
    expect(s.queryBacklinks({ targetBlockId: page.id, limit: 50, softMentions: true }).sources).toHaveLength(0);
    expect(s.softLinkScope().ignore).toContain("priority");
    s.create("Tool's [machine::run] [thread::high]");
    expect(s.queryBacklinks({ targetBlockId: page.id, limit: 50, softMentions: true }).sources).toHaveLength(0);
  });

  test("soft mentions never crowd the links out, and a note's record and links: stay explicit", () => {
    const s = store();
    const page = s.create("Hub [page::hub]");
    for (let i = 0; i < 5; i++) s.create(`Soft ${i} [area::hub]`);
    const linked = s.create("Real [[hub]]");
    const answer = s.queryBacklinks({ targetBlockId: page.id, limit: 2, softMentions: true });
    expect(answer.sources.map(x => x.facets!.kind).filter(k => k === "mention")).toHaveLength(2);
    expect(answer.sources.some(x => x.blockId === linked.id)).toBe(true);
    expect(answer.completeness.kind).toBe("truncated");
    const [record] = readBlockRecords(s, [page.id]).records;
    expect(record!.backlinks).toEqual([linked.id]);
  });
});

describe("what a soft-mention read costs and says", () => {
  const titleScans = (s: OutlinerStore) => {
    const db = (s as any).database, query = db.query.bind(db), seen = { scans: 0 };
    db.query = (sql: string) => { if (sql.startsWith("SELECT id FROM blocks WHERE text LIKE")) seen.scans += 1; return query(sql); };
    return seen;
  };

  test("a hub's read resolves no pull request: PRs named near it can't be it", () => {
    const s = store();
    const hub = s.create("Hub [page::hub]");
    for (let i = 0; i < 20; i++) s.create(`Note ${i} [area::hub]\nsee PR#${i}`);
    const seen = titleScans(s);
    expect(s.queryBacklinks({ targetBlockId: hub.id, limit: 50, softMentions: true }).sources).toHaveLength(20);
    expect(seen.scans).toBe(0);
  });

  test("a PR note's read looks its title up once, however many mention it", () => {
    const s = store();
    const home = s.create("Floatty [type::project] [page::floatty]");
    const pr = s.create("PR#125 ribbon", home.id);
    for (let i = 0; i < 20; i++) s.create(`Note ${i} [project::floatty]\nsee PR#125`);
    const seen = titleScans(s);
    expect(s.queryBacklinks({ targetBlockId: pr.id, limit: 50, softMentions: true }).sources).toHaveLength(20);
    expect(seen.scans).toBe(1);
  });

  test("soft mentions are asked for: without it the read means what it always did", () => {
    const s = store();
    s.configureWorkIdPrefix("PIE");
    let ticket = s.create("Fix the gate");
    ticket = s.allocateWorkId(ticket.id, ticket.revision).block;
    const page = s.create("Hub [page::hub]");
    s.create("Note [area::hub]");
    const bare = s.create("Saw PIE-001 today");
    expect(s.queryBacklinks({ targetBlockId: page.id, limit: 50 }).sources).toEqual([]);
    expect(s.queryBacklinks({ targetBlockId: ticket.id, limit: 50 }).sources.map(x => [x.blockId, x.facets!.kind])).toEqual([[bare.id, "note"]]);
  });

  test("newer notes that only hold the words never hide a real mention", async () => {
    const s = store();
    const hub = s.create("Hub [page::hub]");
    const real = s.create("Real [thread::hub]");
    await Bun.sleep(5);
    for (let i = 0; i < 1001; i++) s.create(`Chatter ${i} about the hub`);
    const answer = s.queryBacklinks({ targetBlockId: hub.id, limit: 50, softMentions: true });
    expect(answer.sources.map(x => x.blockId)).toEqual([real.id]);
    expect(answer.completeness.kind).toBe("complete");
  });

  test("a read that stops looking says so", () => {
    const s = store();
    const hub = s.create("Hub [page::hub]");
    s.create("Real [thread::hub]");
    for (let i = 0; i < 5; i++) s.create(`Chatter ${i} about the hub`);
    const read = softMentionRows((s as any).database, ["hub"], () => false, 50, 3);
    expect(read).toEqual({ rows: [], truncated: true });
    expect(hub.id).toBeTruthy();
  });
});

describe("other clients", () => {
  test("a published page links a value and a date where its page is published, and leaves the rest as words", () => {
    const pages = new Map([["seed-swap", "a"], ["2026-03-14", "b"], ["unpublished", "c"]]);
    const entries = new Map([["a", "/p/a"], ["b", "/p/b"]]);
    const link = (label: string, target: string | undefined) => `[${label}](${target})`;
    expect(linkSoftWords("On 2026-03-14 [thread::seed-swap] and [zone::unpublished] and PR#12", pages, entries, link, () => false))
      .toBe("On [2026-03-14](/p/b) [thread::[seed-swap](/p/a)] and [zone::unpublished] and PR#12");
    expect(softPageAddresses("[thread::Seed-Swap] 2026-03-14 PR#12")).toEqual(["seed-swap", "2026-03-14"]);
  });

  test("a page's explicit links keep the resolving budget: soft words get what's left", () => {
    const soft = Array.from({ length: 5 }, (_, i) => `[area::value-${i}]`).join(" ");
    expect(pageAddressesToResolve([soft, "[[Real page]]"], 3)).toEqual(["real page", "value-0", "value-1"]);
  });

  test("a date in Detail never makes a page by a click; an explicit [[date]] still does", async () => {
    const s = store();
    const requester = { request: async (r: any) => r.action === "references.soft" ? s.softLink(r.name, {}) : r.action === "pages.follow" ? s.followPageAddress(r.address) : s.resolvePageAddress(r.address) };
    const soft = parseOutlinerLinkUri(outlinerLinkUri("page", "2026-11-06", { soft: true }));
    await expect(resolveOutlinerLinkTarget(requester as never, soft)).rejects.toThrow("2026-11-06");
    expect(s.resolvePageAddress("2026-11-06").status).toBe("missing");
    expect(await resolveOutlinerLinkTarget(requester as never, parseOutlinerLinkUri(outlinerLinkUri("page", "2026-11-06")))).toMatchObject({ created: true });
  });

  test("Detail's links name a value's and a date's page, and a date with no page lands on that day's note", async () => {
    const s = store();
    const log = s.create("Build log [day::2026-11-05]");
    const requester = { request: async (r: any) => r.action === "references.soft" ? s.softLink(r.name, {}) : s.resolvePageAddress(r.address) };
    expect(await resolveOutlinerLinkTarget(requester as never, { kind: "page", value: "2026-11-05" })).toMatchObject({ block: { id: log.id } });
  });
});
