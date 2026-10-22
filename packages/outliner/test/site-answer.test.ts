// PIE-533 S1: the Site read. `site.answer` over a scratch outline: the design's mirror examples 1-7 and 12-14, the
// nesting cases, a value operand in a question, the survey's shapes (made-up fixtures), and watches that name their deps.
// Fictional notes; a scratch store per test, a service where the wire matters.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { interpolationSpans } from "@ep0ch/outline-core/interpolation";
import type { SiteAnswer, SiteValue } from "@ep0ch/outline-core/site";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { answerSite } from "../src/site-answer";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "site-answer-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  cleanups.push(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { store, directory };
}

/** The values of one path, or its problem, for a note. */
function read(store: OutlinerStore, blockId: string, path: string, extra: Partial<Parameters<typeof answerSite>[1]> = {}): SiteValue {
  const answer = answerSite(store, { blockId, paths: [path], ...extra });
  return answer.paths![0]!;
}
const values = (store: OutlinerStore, blockId: string, path: string, extra = {}) => {
  const v = read(store, blockId, path, extra);
  if (v.problem) throw new Error(`${path}: ${v.problem.message}`);
  return v.values!;
};

/** The design's fixture note (made up), a person, a reference target and a parent with a project. */
function fixture(store: OutlinerStore) {
  const person = store.create("Evan Schultz [page::evan schultz] [firstName::evan] [lastName::schultz]");
  const deploy = store.create("Deploy recipe [query::type=deploy machine=install]");
  const project = store.create("Lego night [project::lego-night]");
  const vent = store.create([
    `# Vent rail demo [target::https://example.test/vent] [status::active] [owner::evan] [person::[[evan schultz]]] [recipe::${deploy.id}]`,
    "",
    "Play it at {{this.target}}. Owner: {{this.owner}}. Typo: {{this.ownr}}.",
    "- first pass [connectTo::demonstrating by doing]",
    "- second pass [connectTo::shacks not cathedrals]",
    "- [ ] wire the rail [status::todo]",
    "- [x] cut the rail",
    "storyTime:: remember when",
    "and [storyTime::this and that] too",
    "::fields{key=connectTo}",
  ].join("\n"), project.id);
  const sibling = store.create("Sibling note", project.id);
  return { person, deploy, project, vent, sibling };
}

describe("the design's mirror examples", () => {
  test("1 an own value inline: the note's {{ }} are answered in order, with their place in the text", () => {
    const { store } = scratch();
    const { vent } = fixture(store);
    const answer = answerSite(store, { blockId: vent.id });
    expect(answer.values.map(v => v.expression)).toEqual(["this.target", "this.owner", "this.ownr"]);
    expect(answer.values[0]).toMatchObject({ values: ["https://example.test/vent"], path: "this.target" });
    const text = store.get(vent.id)!.text;
    expect(text.slice(answer.values[0]!.start, answer.values[0]!.end)).toBe("{{this.target}}");
    expect(answer.values[1]!.values).toEqual(["evan"]);
    expect(answer.revision).toBe(store.get(vent.id)!.revision);
  });

  test("2 every key is a list: block scope first, then each occurrence; [0], block. and fields. forms", () => {
    const { store } = scratch();
    const { vent } = fixture(store);
    expect(values(store, vent.id, "this.storyTime")).toEqual(["remember when", "this and that"]);
    expect(values(store, vent.id, "this.storyTime[0]")).toEqual(["remember when"]);
    expect(values(store, vent.id, "this.block.storyTime")).toEqual([]);
    const fields = read(store, vent.id, "this.fields.storyTime");
    expect(fields).toMatchObject({ values: ["remember when", "this and that"], lines: [7, 8] });
    expect(fields.marks).toEqual(["storyTime:: remember when", "and [storyTime::this and that] too"]);
    expect(values(store, vent.id, "this.connectTo")).toEqual(["demonstrating by doing", "shacks not cathedrals"]);
  });

  test("3 a parent value, 4 a bare key's nearest value", () => {
    const { store } = scratch();
    const { vent, sibling } = fixture(store);
    expect(values(store, vent.id, "parent.project")).toEqual(["lego-night"]);
    expect(read(store, vent.id, "parent.project").route.join(" | ")).toContain("the note's parent");
    // A bare key walks the line, this note, then each ancestor, nearest first; the route says where it was found.
    const bare = read(store, vent.id, "project");
    expect(bare.values).toEqual(["lego-night"]);
    expect(bare.route.join(" | ")).toMatch(/ancestor-property of \(\(/);
    expect(values(store, sibling.id, "project")).toEqual(["lego-night"]);
    // Nearest wins: the note's own value over its ancestor's.
    const own = store.create("Own project [project::duplo]", store.get(vent.id)!.parentId);
    expect(values(store, own.id, "project")).toEqual(["duplo"]);
  });

  test("5 another note: ((id)), a unique id prefix, [[page]] and a Work ID head", () => {
    const { store } = scratch();
    const { vent, deploy, person } = fixture(store);
    expect(values(store, vent.id, `((${deploy.id})).query`)).toEqual(["type=deploy machine=install"]);
    const byPrefix = read(store, vent.id, `((${deploy.id.slice(0, 8)})).query`);
    expect(byPrefix.values).toEqual(["type=deploy machine=install"]);
    expect(byPrefix.route.join(" | ")).toContain("block id prefix");
    expect(values(store, vent.id, "[[evan schultz]].firstName")).toEqual(["evan"]);
    expect(read(store, vent.id, "[[evan schultz]].firstName").route.join(" | ")).toContain("page address");
    expect(values(store, vent.id, `((${person.id})).title`)).toEqual(["Evan Schultz"]);
  });

  test("6 a binding through a link value: {{person.firstName}}, and a bare id value that names one note", () => {
    const { store } = scratch();
    const { vent, deploy } = fixture(store);
    const viaPage = read(store, vent.id, "person.firstName");
    expect(viaPage.values).toEqual(["evan"]);
    expect(viaPage.route.join(" | ")).toContain("link [[evan schultz]]");
    // A bare UUID value is tried as a note and continues into it...
    expect(values(store, vent.id, "recipe.query")).toEqual(["type=deploy machine=install"]);
    // ...and reads as itself, with the note it names, when nothing continues.
    const plain = read(store, vent.id, "recipe");
    expect(plain.values).toEqual([deploy.id]);
    expect(plain.links).toMatchObject([{ id: deploy.id, title: "Deploy recipe", how: "block id" }]);
  });

  test("7 a filtered list of tasks, and a count; the checkbox itself says open or done", () => {
    const { store } = scratch();
    const { vent } = fixture(store);
    expect(values(store, vent.id, "this.tasks")).toEqual(["wire the rail", "cut the rail"]);
    expect(values(store, vent.id, "this.tasks | status=todo")).toEqual(["wire the rail"]);
    expect(values(store, vent.id, "this.tasks | status=todo .count")).toEqual(["1"]);
    // Only one of the two lines carries a [status::] chip: the box supplies it for the other.
    expect(values(store, vent.id, "this.tasks | status=done")).toEqual(["cut the rail"]);
    expect(values(store, vent.id, "this.tasks | state=open")).toEqual(["wire the rail"]);
    expect(values(store, vent.id, "this.tasks | state=done .count")).toEqual(["1"]);
    expect(values(store, vent.id, "this.tasks[1]")).toEqual(["cut the rail"]);
  });

  test("12 a missing key is a problem with a did-you-mean and an example, never an empty string", () => {
    const { store } = scratch();
    const { vent } = fixture(store);
    const typo = answerSite(store, { blockId: vent.id }).values[2]!;
    expect(typo.values).toBeUndefined();
    expect(typo.problem).toMatchObject({ message: "no `ownr` on this note; did you mean `owner`?", didYouMean: ["owner"], example: "{{this.owner}}" });
    expect(answerSite(store, { blockId: vent.id }).problems).toBe(1);
    // A bare key says where it looked.
    expect(read(store, vent.id, "projct").problem?.message).toBe("no `projct` here or in its parents; did you mean `project`?");
    // A filter naming a key no task has.
    expect(read(store, vent.id, "this.tasks | ownr=evan").problem?.message).toBe("no tasks have `ownr` (they have status, box, state)");
    // A default stands in for a problem and says so.
    const withDefault = answerSite(store, { blockId: store.create("Page {{this.nope || n/a}}").id }).values[0]!;
    expect(withDefault).toMatchObject({ values: ["n/a"], usedDefault: true });
  });

  test("13 this and props are separate: this.status is the note's, props.status the call's", () => {
    const { store } = scratch();
    const { vent } = fixture(store);
    const card = store.create("Card [status::active]");
    const answer = answerSite(store, { blockId: card.id, props: { status: ["paused"] }, paths: ["this.status", "props.status", "props.stauts"] });
    expect(answer.paths!.map(v => v.values ?? v.problem!.message)).toEqual([["active"], ["paused"], "no prop `stauts` was passed; did you mean `status`?"]);
    // A bare key never reads props.
    expect(answerSite(store, { blockId: vent.id, props: { project: ["elsewhere"] }, paths: ["project"] }).paths![0]!.values).toEqual(["lego-night"]);
    // Both sit in the same note: the union rule makes this.status the header's chip and the task line's.
    expect(values(store, vent.id, "this.status")).toEqual(["active", "todo"]);
  });
});

describe("a question's value operand (mirror example 14)", () => {
  test("where project={{this.project}} binds the note's values: the same figure on two pages lists each page's own", () => {
    const { store } = scratch();
    const a = store.create("Page A [project::lego-night]");
    const b = store.create("Page B [project::garden]");
    for (const n of ["one", "two"]) store.create(`Task ${n} [type::task] [project::lego-night]`);
    store.create("Task three [type::task] [project::garden]");
    const titles = (page: Block) => store.queryBlocks({ where: "type=task project={{this.project}}", this: page.id }).blocks.map(x => x.text.split(" [")[0]);
    expect(titles(a)).toEqual(["Task one", "Task two"]);
    expect(titles(b)).toEqual(["Task three"]);
  });

  test("a list means any of them; none matches nothing; a typo is an error that teaches, not an empty list", () => {
    const { store } = scratch();
    const page = store.create("Page [project::[lego-night, garden]]");
    store.create("Lego [type::task] [project::lego-night]");
    store.create("Seeds [type::task] [project::garden]");
    store.create("Other [type::task] [project::elsewhere]");
    expect(store.queryBlocks({ where: "type=task project={{this.project}}", this: page.id }).blocks.map(x => x.text.split(" [")[0])).toEqual(["Lego", "Seeds"]);
    // A key the note writes with no value matches nothing; a key it never wrote is a typo to say so.
    const empty = store.create("Empty page [project::[]]");
    expect(store.queryBlocks({ where: "type=task project={{this.project}}", this: empty.id }).blocks).toEqual([]);
    expect(store.queryBlocks({ where: "type=task AND (project={{this.project}} OR title~Other)", this: empty.id }).blocks.map(x => x.text.split(" [")[0])).toEqual(["Other"]);
    const bare = store.create("Bare page");
    expect(() => store.queryBlocks({ where: "type=task area={{this.area}}", this: bare.id })).toThrow(/no `area` on this note/);
    expect(() => store.queryBlocks({ where: "type=task project={{this.projct}}", this: page.id })).toThrow(/no `projct` on this note; did you mean `project`\?/);
    expect(() => store.queryBlocks({ where: "project={{this.project}}" })).toThrow(/this query has none/);
  });

  test("a value holding OR, a quote or a space can't change the query", () => {
    const { store } = scratch();
    const page = store.create('Page [project::x OR type=secret] [other::say "hi" now]');
    store.create("Matching [type::task] [project::x OR type=secret]");
    store.create("Secret too [type::secret]");
    store.create("Quoted [type::task] [other::say \"hi\" now]");
    const found = (where: string) => store.queryBlocks({ where, this: page.id }).blocks.map(x => x.text.split(" [")[0]);
    expect(found("project={{this.project}}")).toEqual(["Page", "Matching"]);
    expect(found("other={{this.other}}")).toEqual(["Page", "Quoted"]);
    expect(found("project={{this.project}} AND type=task")).toEqual(["Matching"]);
    // The bracket form is the same clause, with spaces inside the braces; quoted, it is text.
    expect(found("[project::{{ this.project }}] AND type=task")).toEqual(["Matching"]);
    expect(found('project="{{this.project}}"')).toEqual([]);
  });
});

describe("what Evan's real notes taught (made-up notes of the same shapes)", () => {
  test("a record's own field never shadows a property of the same name: [created::] and [actor::]", () => {
    const { store } = scratch();
    const written = store.create("Gurgle post [created::2026-01-02] [actor::karen]", null, "agent", { actorId: "claude-code" });
    expect(values(store, written.id, "this.created")).toEqual(["2026-01-02"]);
    expect(values(store, written.id, "this.actor")).toEqual(["karen"]);
    // The record's field is always one `$` away, and the route says which was read.
    expect(values(store, written.id, "this.$actor")).toEqual(["claude-code"]);
    expect(values(store, written.id, "this.$created")[0]!).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(values(store, written.id, "this.$author")).toEqual(["agent"]);
    // With no such property, the field answers (and the route says so).
    const plain = store.create("Plain note");
    const created = read(store, plain.id, "this.created");
    expect(created.values![0]).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(created.route.join(" | ")).toContain("the note writes no `created` property");
    expect(read(store, plain.id, "this.$nope").problem).toMatchObject({ didYouMean: [] });
  });

  test("a key with a dot in it: this.echo.node or this[\"echo.node\"]; a bare margin.x walks the scope", () => {
    const { store } = scratch();
    const parent = store.create("Layout [margin.x::3]");
    const note = store.create("Node [echo.node::float-box] [echo]", parent.id);
    expect(values(store, note.id, "this.echo.node")).toEqual(["float-box"]);
    expect(values(store, note.id, "this[\"echo.node\"]")).toEqual(["float-box"]);
    expect(values(store, note.id, "this['echo.node']")).toEqual(["float-box"]);
    expect(values(store, note.id, "margin.x")).toEqual(["3"]);
    expect(values(store, note.id, "parent.margin.x")).toEqual(["3"]);
    expect(values(store, note.id, "props.margin.x", { props: { "margin.x": ["9"] } })).toEqual(["9"]);
    expect(read(store, note.id, "this.echo").problem?.message).toBe('no `echo` on this note, but it has `echo.node`; write this.echo.node or this["echo.node"]');
  });

  test("now has a clock, a calendar and date arithmetic; each answer says whose clock", () => {
    const { store } = scratch();
    const note = store.create("Daily");
    // Local noon: the host's own time zone is the clock's (the route says so).
    const clock = () => new Date(2026, 9, 16, 12, 0).getTime();
    const at = (path: string) => answerSite(store, { blockId: note.id, paths: [path] }, clock).paths![0]!;
    expect(at("now.date").values).toEqual(["2026-10-16"]);
    expect(at("now.date-1d").values).toEqual(["2026-10-15"]);
    expect(at("now.date+7d").values).toEqual(["2026-10-23"]);
    expect(at("now.date-2w").values).toEqual(["2026-10-02"]);
    expect(at("now.week").values).toEqual(["2026-W42"]);
    expect(at("now.weekday").values).toEqual(["Friday"]);
    expect(at("now.month").values).toEqual(["2026-10"]);
    expect(at("now.time").values).toEqual(["12:00"]);
    expect(at("now.route").problem?.message).toContain("no `route`");
    expect(at("now.date-1x").problem?.message).toContain("no `date-1x`");
    expect(at("now.date").route.join(" ")).toContain("the host's clock");
  });

  test("((x)) means it should exist: a unique short prefix resolves, an ambiguous one lists its matches, a miss says so", () => {
    const { store } = scratch();
    store.create("Alpha note [colour::red]", null, "user", undefined, { id: "deadbeef-0000-4000-8000-000000000001" });
    store.create("Beta note [colour::blue]", null, "user", undefined, { id: "deadbeef-0000-4000-8000-000000000002" });
    store.create("Gamma note [colour::green]", null, "user", undefined, { id: "cafef00d-0000-4000-8000-000000000003" });
    const note = store.create("Reader");
    expect(values(store, note.id, "((cafef00d)).colour")).toEqual(["green"]);
    const ambiguous = read(store, note.id, "((deadbeef)).colour");
    expect(ambiguous.problem?.message).toBe("((deadbeef)) starts 2 notes: deadbeef-000 Alpha note; deadbeef-000 Beta note; give more of it");
    expect(ambiguous.problem?.didYouMean).toEqual(["deadbeef-0000-4000-8000-000000000001", "deadbeef-0000-4000-8000-000000000002"]);
    expect(values(store, note.id, "((deadbeef-0000-4000-8000-000000000002)).colour")).toEqual(["blue"]);
    expect(read(store, note.id, "((feedface)).colour").problem?.message).toMatch(/^No block \(\(feedface\)\)/);
    // A [[page]] that isn't written yet is a link-to-be: said, and the answer asks to be re-read after any change.
    const missing = answerSite(store, { blockId: note.id, paths: ["[[not yet]].colour"] });
    expect(missing.paths![0]!.problem?.message).toBe("no page not yet");
    expect(missing.anyChange).toBe(true);
  });

  test("a value that looks like an id is tried as a note: one match is a link, anything else is plain text, silently", () => {
    const { store } = scratch();
    const target = store.create("Merge notes", null, "user", undefined, { id: "0d62cdcb-1111-4222-8333-444455556666" });
    store.create("Another", null, "user", undefined, { id: "0d62cdcb-1111-4222-8333-777788889999" });
    const note = store.create([
      "Release [fix-commit::9f2c4a1b7e3d5a60c8b4d2f19e7a5c3b1d8f6e40] [commit::4e1d9c2] [source::cc01a5b2]",
      "[parent-annotation::0d62cdcb-1111-4222-8333-444455556666] [ambiguous::0d62cdcb] [session::6e9a31f0-aaaa-4bbb-8ccc-dddd00001111]",
    ].join("\n"), null, "user");
    // Sha-shaped values read as themselves: no warning, no link, no special key.
    for (const key of ["fix-commit", "commit", "source", "ambiguous", "session"]) {
      const v = read(store, note.id, `this.${key}`);
      expect(v.problem).toBeUndefined();
      expect(v.links).toBeUndefined();
    }
    // A full UUID that names one note is a link, shown by the note's title; a path can continue into it.
    const link = read(store, note.id, "this.parent-annotation");
    expect(link.links).toEqual([{ text: target.id, id: target.id, title: "Merge notes", how: "block id" }]);
    expect(values(store, note.id, "parent-annotation.title")).toEqual(["Merge notes"]);
    // Asking a key of a value that is not a note says what it is instead.
    const text = read(store, note.id, "this.commit.title");
    expect(text.problem?.message).toContain("`4e1d9c2` is a value, not a note");
    expect(read(store, note.id, "this.ambiguous.title").problem?.message).toContain("starts 2 notes");
  });

  test("a value with prose and exactly one link continues into it; one with two does not", () => {
    const { store } = scratch();
    const a = store.create("Alpha [page::alpha] [owner::sam]");
    const b = store.create("Beta [owner::lee]");
    const note = store.create(`Note [related::see [[alpha]] for the plan] [also::((${a.id})) and ((${b.id}))]`);
    expect(values(store, note.id, "related.owner")).toEqual(["sam"]);
    expect(read(store, note.id, "also.owner").problem?.message).toContain("is a value, not a note");
  });

  test("children and tasks are lists of rows: filter by the views' grammar, count, pick, then a key", () => {
    const { store } = scratch();
    const hub = store.create("Hub [owner::kim]");
    store.create("Fix the gate [type::task] [owner::sam]", hub.id);
    store.create("Paint the shed [type::task] [owner::lee]", hub.id);
    store.create("Note to self [type::note]", hub.id);
    expect(values(store, hub.id, "this.children")).toEqual(["Fix the gate", "Paint the shed", "Note to self"]);
    expect(values(store, hub.id, "this.children | type=task")).toEqual(["Fix the gate", "Paint the shed"]);
    expect(values(store, hub.id, "this.children | type=task .count")).toEqual(["2"]);
    expect(values(store, hub.id, "this.children | owner=lee")).toEqual(["Paint the shed"]);
    expect(values(store, hub.id, "this.children.owner")).toEqual(["sam", "lee"]);
    expect(values(store, hub.id, "this.children[0].owner")).toEqual(["sam"]);
    expect(values(store, hub.id, "this.children | type=task .owner")).toEqual(["sam", "lee"]);
    expect(read(store, hub.id, "this.children | nope=1").problem?.message).toStartWith("no notes have `nope`");
    expect(read(store, hub.id, "this.children | zzzzzz=1").problem?.message).toBe("no notes have `zzzzzz` (they have type, owner)");
    expect(read(store, hub.id, "this.owner | x=1").problem?.message).toContain("a filter works on a list of notes or tasks");
    // The children it read are what the answer depends on (a child edited or added changes it); a path that doesn't read them doesn't.
    const kids = store.children(hub.id).map(c => c.id);
    expect(answerSite(store, { blockId: hub.id, paths: ["this.children"] }).deps.sort()).toEqual([hub.id, ...kids].sort());
    expect(answerSite(store, { blockId: hub.id, paths: ["this.owner"] }).deps).toEqual([hub.id]);
  });

  test("tasks keep their chips: this.tasks.owner reads the checkbox lines", () => {
    const { store } = scratch();
    const note = store.create("List\n\n- [ ] order beans [owner::sam]\n- [~] wait for rain [owner::lee]\n- [!] fence is down\n- [x] measure the bed");
    expect(values(store, note.id, "this.tasks.owner")).toEqual(["sam", "lee"]);
    expect(values(store, note.id, "this.tasks.status")).toEqual(["todo", "waiting", "problem", "done"]);
    expect(values(store, note.id, "this.tasks | state=open .count")).toEqual(["3"]);
    expect(values(store, note.id, "this.tasks | box=waiting")).toEqual(["wait for rain"]);
    expect(read(store, note.id, "this.tasks.zzzzzz").problem?.message).toBe("no task has `zzzzzz`");
  });

  test("the scope walk reads an ancestor's header, not its body: a body hashtag or later key supplies no bare key", () => {
    const { store } = scratch();
    const ancestor = store.create("Project plan [area::garden]\n\nBody text with [owner::dana] far below the header");
    const note = store.create("Task", ancestor.id);
    expect(values(store, note.id, "area")).toEqual(["garden"]);
    const hidden = read(store, note.id, "owner");
    expect(hidden.problem?.message).toBe(`no \`owner\` in the header of this note or its parents; it is written lower in ((${ancestor.id.slice(0, 8)})), which a bare key doesn't read: ask for it with ((${ancestor.id.slice(0, 8)})).owner`);
    expect(values(store, note.id, `((${ancestor.id.slice(0, 8)})).owner`)).toEqual(["dana"]);
  });
});

describe("nesting: a Site is passed down, never looked up", () => {
  /** A template, two hosts that use it, and a note that embeds a note holding placeholders. */
  function nested(store: OutlinerStore) {
    const template = store.create([
      "Status card [type::template]",
      "",
      "Card for {{this.title}} by {{self.title}}: status {{props.status}}, owner {{owner}}, drawn from line {{caller.line}}.",
    ].join("\n"));
    const hostA = store.create("Host A [project::alpha]\n\nowner:: dana\n::use{of=[[status card]]}");
    const hostB = store.create("Host B [owner::bo]\n\n::use{of=[[status card]]}");
    const embedded = store.create("Embedded [owner::eve]\n\nI am {{this.title}} and {{this.owner}} with {{owner}}.");
    const container = store.create("Container [owner::carl]\n\n![[embedded]]");
    return { template, hostA, hostB, embedded, container };
  }
  const card = (store: OutlinerStore, template: Block, host: Block, line: number, extra: Partial<Parameters<typeof answerSite>[1]> = {}) =>
    answerSite(store, { blockId: template.id, chain: [{ kind: "use", block: host.id, line }], props: { status: ["paused"] }, ...extra });

  test("a ::use draws the template with the host as this, the template as self and the ::use line as caller", () => {
    const { store } = scratch();
    const { template, hostA, hostB } = nested(store);
    const a = card(store, template, hostA, 3);
    // this = the host; self = the template; props are the call's; the scope walk starts at the ::use line in the host.
    expect(a.values.map(v => v.values)).toEqual([["Host A"], ["Status card"], ["paused"], ["dana"], ["3"]]);
    expect(a.site).toMatchObject({ this: hostA.id, self: template.id, caller: { block: hostA.id, line: 3 } });
    const b = card(store, template, hostB, 2);
    expect(b.values.map(v => v.values)).toEqual([["Host B"], ["Status card"], ["paused"], ["bo"], ["2"]]);
    // Each host's answer is computed from its own notes: A's does not depend on B.
    expect(a.deps).toContain(hostA.id);
    expect(a.deps).not.toContain(hostB.id);
    expect(b.deps).not.toContain(hostA.id);
    expect(a.deps).toContain(template.id);
    expect(a.route.join(" | ")).toContain("this stays the host");
  });

  test("an embed starts a fresh Site: this is the embedded note, whatever drew it", () => {
    const { store } = scratch();
    const { embedded, container } = nested(store);
    const drawn = answerSite(store, { blockId: embedded.id, chain: [{ kind: "embed", block: container.id }] });
    expect(drawn.values.map(v => v.values)).toEqual([["Embedded"], ["eve"], ["eve"]]);
    expect(drawn.site.this).toBe(embedded.id);
    expect(drawn.site.caller).toMatchObject({ block: container.id });
    // The same note read on its own agrees.
    expect(answerSite(store, { blockId: embedded.id }).values.map(v => v.values)).toEqual(drawn.values.map(v => v.values));
  });

  test("a ::use inside an embed: the embedded note is the host", () => {
    const { store } = scratch();
    const { template, embedded, container } = nested(store);
    const inner = store.update(embedded.id, `${store.get(embedded.id)!.text}\n::use{of=[[status card]]}`, store.get(embedded.id)!.revision);
    const lastLine = inner.text.split("\n").length - 1;
    const drawn = answerSite(store, {
      blockId: template.id, props: { status: ["ok"] },
      chain: [{ kind: "embed", block: container.id }, { kind: "use", block: embedded.id, line: lastLine }],
    });
    expect(drawn.site).toMatchObject({ this: embedded.id, self: template.id });
    expect(drawn.values[0]!.values).toEqual(["Embedded"]);
    // The walk starts at the ::use line inside the embedded note: its owner, not the container's.
    expect(drawn.values[3]!.values).toEqual(["eve"]);
  });

  test("a chain that names no note is refused with what a chain is", () => {
    const { store } = scratch();
    const { template } = nested(store);
    expect(() => answerSite(store, { blockId: template.id, chain: [{ kind: "use", block: "nowhere" }] })).toThrow(/chain\[0\]\.block nowhere is no note/);
    expect(() => answerSite(store, { blockId: template.id, chain: [{ kind: "fold" as never, block: "x" }] })).toThrow(/chain\[0\] is \{ kind: "use" \| "embed" \| "box"/);
  });

  test("the draft is what is read: values, problems and deps follow the text being typed", () => {
    const { store } = scratch();
    const note = store.create("Draft target [owner::evan]\n\nOwner {{this.owner}}");
    const typed = answerSite(store, { blockId: note.id, draft: { text: "Draft target [owner::sam]\n\nOwner {{this.owner}} then {{this.ownr}}" } });
    expect(typed.values.map(v => v.values ?? v.problem?.message)).toEqual([["sam"], "no `ownr` on this note; did you mean `owner`?"]);
    expect(typed.route[0]).toContain("the draft text");
    // Nothing was saved.
    expect(store.get(note.id)!.text).toContain("[owner::evan]");
  });
});

describe("the transplant keeps values resolving", () => {
  test("copy a template and a host into another outline, rewrite the ids interpolationSpans names, and the answers are the same", () => {
    const first = scratch().store;
    const target = first.create("Recipe book [page::recipe book] [query::type=deploy]", null, "user", undefined, { id: "11111111-aaaa-4bbb-8ccc-000000000001" });
    const template = first.create(`Tmpl {{((11111111)).query}} and {{this.name}} and {{[[recipe book]].query}}`, null, "user", undefined, { id: "33333333-aaaa-4bbb-8ccc-000000000002" });
    const host = first.create("Host [name::wren]\n\n::use{of=((33333333-aaaa-4bbb-8ccc-000000000002))}");
    const wantedBefore = answerSite(first, { blockId: template.id, chain: [{ kind: "use", block: host.id, line: 2 }] }).values.map(v => v.values);
    expect(wantedBefore).toEqual([["type=deploy"], ["wren"], ["type=deploy"]]);

    // The other outline: the same notes under new ids. The pack's id finder is interpolationSpans: it names every id a placeholder holds.
    const second = scratch().store;
    const renamed = new Map([[target.id, "22222222-aaaa-4bbb-8ccc-000000000001"], [template.id, "44444444-aaaa-4bbb-8ccc-000000000002"]]);
    const fresh = (text: string, place?: { id: string }) => second.create(text, null, "user", undefined, place);
    fresh("Recipe book [page::recipe book] [query::type=deploy]", { id: renamed.get(target.id)! });
    // Rewrite by the spans' reference heads (positions, not a regex over the text), longest-first.
    const rewritten = (text: string) => {
      let out = text;
      for (const span of interpolationSpans(text).reverse()) {
        const ref = span.reference;
        if (!ref) continue;
        const id = [...renamed].find(([old]) => ref.includes(old.slice(0, 8)))?.[1];
        if (id) out = out.slice(0, span.start) + out.slice(span.start, span.end).replace(/\(\(([0-9a-f-]{8,})\)\)/, `((${id.slice(0, 8)}))`) + out.slice(span.end);
      }
      return out;
    };
    const copy = fresh(rewritten(template.text), { id: renamed.get(template.id)! });
    const hostCopy = second.create(host.text.replace("33333333-aaaa-4bbb-8ccc-000000000002", renamed.get(template.id)!));
    expect(copy.text).toContain("((22222222))");
    const wantedAfter = answerSite(second, { blockId: copy.id, chain: [{ kind: "use", block: hostCopy.id, line: 2 }] }).values.map(v => v.values);
    expect(wantedAfter).toEqual(wantedBefore);
    expect(wantedAfter).toEqual([["type=deploy"], ["wren"], ["type=deploy"]]);
  });
});

describe("the wire: site.answer is watched by the notes it was computed from", () => {
  async function service() {
    const directory = mkdtempSync(join(tmpdir(), "site-answer-wire-"));
    const store = new OutlinerStore(join(directory, "outliner.sqlite"));
    const socket = join(directory, "outliner.sock");
    const server = new OutlinerServer(store, socket);
    await server.start();
    cleanups.push(async () => { await server.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
    return { store, client: new OutlinerClient(socket), socket };
  }

  test("a note-free extension template reads supplied props but cannot read another note", async () => {
    const { store, client } = await service();
    const other = store.create("Other note [x::private-value]");
    const reference = `{{((${other.id})).x}}`;
    const answer = await client.request<SiteAnswer>({
      action: "site.answer", props: { id: ["given-id"], other: [`((${other.id}))`] },
      interpolate: { text: `{{props.id}} ${reference} {{props.other.x}}`, fences: "template" },
    });
    expect(answer.interpolated!.text).toBe(`given-id ${reference} {{props.other.x}}`);
    for (const value of answer.interpolated!.values.slice(1)) {
      expect(value.values).toBeUndefined();
      expect(value.problem?.message).toContain("note");
    }
    expect(answer.deps).toEqual([]);
  });

  test("site.answer over the socket carries values, problems, route and deps", async () => {
    const { store, client } = await service();
    const note = store.create("Wire [owner::evan]\n\nBy {{this.owner}} and {{this.nope}}");
    const answer = await client.request<SiteAnswer>({ action: "site.answer", blockId: note.id, paths: ["this.owner"] });
    expect(answer.values[0]).toMatchObject({ values: ["evan"], route: expect.any(Array) });
    expect(answer.values[1]!.problem?.message).toBe("no `nope` on this note");
    expect(answer.problems).toBe(1);
    expect(answer.deps).toEqual([note.id]);
    await expect(client.request({ action: "site.answer" } as never)).rejects.toThrow(/site.answer needs blockId/);
    await expect(client.request({ action: "site.answer", blockId: "no-such-note" })).rejects.toThrow(/No block no-such-note/);
  });

  test("a draft condition matches the text being typed without changing the saved note (PIE-1141)", async () => {
    const { store, client } = await service();
    const note = store.create("Rail [mode::saved]");
    const draft = { text: 'Typed rail\nmode:: test\nmode:: bam\n```\n[mode::literal]\n```' };
    const holds = async (where: string, typed = true) => (await client.request<SiteAnswer>({
      action: "site.answer", blockId: note.id, produce: { kind: "if", where }, ...(typed ? { draft } : {}),
    })).produced;
    expect(await holds("mode=bam")).toMatchObject({ kind: "if", holds: true });
    expect(await holds("mode=saved")).toMatchObject({ kind: "if", holds: false });
    expect(await holds("mode=literal")).toMatchObject({ kind: "if", holds: false });
    expect(await holds('title~"Typed rail"')).toMatchObject({ kind: "if", holds: true });
    expect(await holds("mode=saved", false)).toMatchObject({ kind: "if", holds: true });
    expect(store.get(note.id)!.text).toBe(note.text);
  });

  test("a watched answer is told when a note it reads changes, and not when another does", async () => {
    const { store, socket } = await service();
    const { connect } = await import("node:net");
    const mine = store.create("Mine [owner::evan]\n\n{{this.owner}} {{parent.tag}}");
    const other = store.create("Other [owner::lee]");
    const events: any[] = [];
    const conn = connect(socket);
    let buffer = "";
    const lines: ((m: any) => void)[] = [];
    conn.on("data", chunk => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1); const m = JSON.parse(line); if (m.event) events.push(m.event); else lines.shift()?.(m); }
    });
    cleanups.unshift(() => { conn.destroy(); });
    const ask = (request: object) => new Promise<any>(resolve => { lines.push(resolve); conn.write(`${JSON.stringify({ id: crypto.randomUUID(), ...request })}\n`); });
    const first = await ask({ action: "site.answer", blockId: mine.id, watch: "mine" });
    expect(first.ok).toBe(true);
    expect(first.result.generation).toBe(0);
    expect(first.result.deps).toEqual([mine.id]);
    const changes = () => events.filter(e => e.action === "queries.changed").flatMap(e => e.changes);

    // A change to an unrelated note: the watch isn't even evaluated again.
    store.update(other.id, "Other [owner::kim]", store.get(other.id)!.revision);
    await Bun.sleep(700);
    expect(changes()).toEqual([]);

    // A change to the note it reads: told, and the new answer has the new value.
    store.update(mine.id, "Mine [owner::sam]\n\n{{this.owner}} {{parent.tag}}", store.get(mine.id)!.revision);
    await Bun.sleep(700);
    expect(changes()).toEqual([{ key: "mine", generation: 1 }]);
    const again = await ask({ action: "site.answer", blockId: mine.id, watch: "mine", generation: 1 });
    expect(again.result.values[0].values).toEqual(["sam"]);
  });
});

describe("review findings: shapes that differ, budgets, dependencies the answer can't name, the clock", () => {
  test("notes of different shapes each finish the path on their own; the order of the children doesn't matter", () => {
    const { store } = scratch();
    store.create("Ann [page::ann] [first::ann]");
    const parent = store.create("Parent");
    store.create("Child one [owner::[[ann]]]", parent.id);
    store.create("Child two [owner::plain text]", parent.id);
    store.create("Child three\n\n- [ ] one task", parent.id);
    expect(values(store, parent.id, "this.children.owner.first")).toEqual(["ann"]);
    const reversed = store.create("Reversed");
    store.create("Child two [owner::plain text]", reversed.id);
    store.create("Child one [owner::[[ann]]]", reversed.id);
    expect(values(store, reversed.id, "this.children.owner.first")).toEqual(["ann"]);
    // One child has tasks, another a property called tasks: no crash, the ones that can answer do.
    const mixed = store.create("Mixed");
    store.create("Has tasks\n\n- [ ] ship the rail", mixed.id);
    store.create("Writes it [tasks::custom]", mixed.id);
    expect(values(store, mixed.id, "this.children.tasks.text")).toEqual(["ship the rail"]);
  });

  test("a note that links to itself twice is one note, however many steps follow it", () => {
    const { store } = scratch();
    const loop = store.create("Loop [page::loop] [friend::[[loop]]] [friend::[[loop]]]");
    expect(values(store, loop.id, "this.friend.friend.friend.friend.title")).toEqual(["Loop"]);
  });

  test("a note with more children than a path reads says so, with the question to ask instead", () => {
    const { store } = scratch();
    const hub = store.create("Big hub");
    for (let i = 0; i < 1001; i++) store.create(`Item ${i}`, hub.id);
    const problem = read(store, hub.id, "this.children.count").problem;
    expect(problem?.message).toBe("this note has more than 1000 children; a path reads at most 1000. Ask a question instead: a query such as parent:this, with a filter");
    expect(problem?.example).toBe("where: parent:this type=task");
    expect(read(store, hub.id, "this.$children").problem?.message).toContain("more than 1000 children");
  });

  test("a filter gets its this, reads grandchildren for child:, and a filter about other notes says its answer can't name its deps", () => {
    const { store } = scratch();
    const hub = store.create("Hub");
    const a = store.create("Alpha", hub.id);
    store.create("Beta", hub.id);
    store.create("Grandchild [status::todo]", a.id);
    expect(values(store, hub.id, "this.children | parent:this .count")).toEqual(["2"]);
    expect(values(store, hub.id, "this.children | child:status=todo")).toEqual(["Alpha"]);
    expect(answerSite(store, { blockId: hub.id, paths: ["this.children | child:status=todo"] }).anyChange).toBe(true);
    expect(answerSite(store, { blockId: hub.id, paths: ["this.children | links:this"] }).anyChange).toBe(true);
    // A filter on the rows' own properties names its deps exactly.
    expect(answerSite(store, { blockId: hub.id, paths: ["this.children | title~Alpha"] }).anyChange).toBeUndefined();
  });

  test("a written link that isn't a note yet, or is in Trash, asks to be read again after any change", () => {
    const { store } = scratch();
    const gone = store.create("Gone page [page::gone]");
    store.delete(gone.id);
    const note = store.create("Reader [owner::[[nowhere]]] [also::[[gone]]]");
    expect(answerSite(store, { blockId: note.id, paths: ["this.owner"] }).anyChange).toBe(true);
    expect(answerSite(store, { blockId: note.id, paths: ["this.also.title"] }).anyChange).toBe(true);
    // An id prefix that names one note today could name two tomorrow.
    const real = store.create("Real", null, "user", undefined, { id: "abcdef12-0000-4000-8000-000000000009" });
    const prefixed = store.create(`Prefixed [ref::abcdef12]`);
    expect(values(store, prefixed.id, "ref.title")).toEqual([real.text]);
    expect(answerSite(store, { blockId: prefixed.id, paths: ["ref.title"] }).anyChange).toBe(true);
    // A note that only reads its own properties names exactly its deps.
    expect(answerSite(store, { blockId: real.id, paths: ["this.title"] }).anyChange).toBeUndefined();
  });

  test("a task's text leaves its chips out, including a link or a list inside one", () => {
    const { store } = scratch();
    const note = store.create("List\n\n- [ ] Ask the neighbour [owner::[[Page]]] [tags::[a, b]]\n- [ ] Plain one");
    expect(values(store, note.id, "this.tasks")).toEqual(["Ask the neighbour", "Plain one"]);
  });

  test("clock reads are refreshed on the minute, and a watch is told when it turns", async () => {
    const { store } = scratch();
    const note = store.create("Clock");
    const at = answerSite(store, { blockId: note.id, paths: ["now.time"] });
    expect(at.clock).toBe("minute");
    expect(answerSite(store, { blockId: note.id, paths: ["now.date"] }).clock).toBe("minute");
    expect(answerSite(store, { blockId: note.id, paths: ["now.date-2h"] }).clock).toBe("minute");
    const { QueryWatches } = await import("../src/query-watches");
    let minute = 0;
    const sent: string[] = [];
    const watches = new QueryWatches({
      answer: request => ({ id: request.id, ok: true, result: { clock: "minute", time: minute }, sequence: 1 }),
      sequence: () => 1, minuteMs: 40,
    });
    cleanups.push(() => watches.stop());
    const connection = { write: (line: string) => { sent.push(line); }, destroyed: false };
    watches.ask(connection, { id: "1", action: "site.answer", watch: "clock", blockId: note.id });
    minute = 1;
    await Bun.sleep(150);
    expect(sent.length).toBeGreaterThan(0);
    expect(JSON.parse(sent[0]!).event.changes).toEqual([{ key: "clock", generation: 1 }]);
  });
});

describe("what a reader may not see (PIE-533 S2)", () => {
  test("a value read through a note the reader may not see is left out whole, and says so", () => {
    const { store } = scratch();
    const { vent, person } = fixture(store);
    const open = answerSite(store, { blockId: vent.id, paths: ["this.person.firstName", "this.owner"] });
    expect(open.paths!.map(p => p.values)).toEqual([["evan"], ["evan"]]);
    const shut = answerSite(store, { blockId: vent.id, hidden: [person.id], paths: ["this.person.firstName", "this.owner"] });
    expect(shut.paths![0]).toMatchObject({ hidden: true, problem: { message: expect.stringContaining("isn't shown") } });
    expect(shut.paths![0]!.values).toBeUndefined();
    expect(shut.paths![0]!.from).toBeUndefined();
    expect(shut.paths![1]!.values).toEqual(["evan"]);
    expect(shut.problems).toBe(open.problems + 1);          // the hidden read joins the fixture's own typo
  });

  test("an ancestor the reader may not see supplies no bare key, nor any above it", () => {
    const { store } = scratch();
    const { vent, project } = fixture(store);
    expect(values(store, vent.id, "project")).toEqual(["lego-night"]);
    const shut = answerSite(store, { blockId: vent.id, hidden: [project.id], paths: ["project", "parent.project"] });
    expect(shut.paths![0]!.problem).toBeDefined();
    expect(shut.paths![1]).toMatchObject({ hidden: true });
  });

  test("a value says where it is written: the note, the property token's offset, line and text", () => {
    const { store } = scratch();
    const { vent, person } = fixture(store);
    const own = answerSite(store, { blockId: vent.id, paths: ["this.owner", "this.person.firstName", "this.title"] });
    const text = store.get(vent.id)!.text;
    expect(own.paths![0]!.source).toEqual({ block: vent.id, start: text.indexOf("[owner::evan]"), line: 0, mark: "[owner::evan]" });
    expect(own.paths![1]!.source).toMatchObject({ block: person.id, mark: "[firstName::evan]" });
    expect(own.paths![2]!.source).toBeUndefined();
    // The same through the note's own placeholders, and for a draft being typed.
    const draft = answerSite(store, { blockId: vent.id, draft: { text: "Draft [owner::sam]\n{{this.owner}}" } });
    expect(draft.values[0]).toMatchObject({ values: ["sam"], source: { block: vent.id, start: 6, line: 0, mark: "[owner::sam]" } });
  });
  test("a filter that reads other notes says nothing when the reader may not see some (it could answer from one)", () => {
    const { store } = scratch();
    const hub = store.create("Hub");
    const kid = store.create("Kid", hub.id);
    const secret = store.create("Secret [secret::yes]", kid.id);
    expect(values(store, hub.id, "this.children | child:secret=yes .count")).toEqual(["1"]);
    const shut = answerSite(store, { blockId: hub.id, hidden: [secret.id], paths: ["this.children | child:secret=yes .count", "this.children.count"] });
    expect(shut.paths![0]).toMatchObject({ hidden: true });
    expect(shut.paths![1]!.values).toEqual(["1"]);
  });

  test("a self or chain note the reader may not see supplies no values: the read is refused, naming no content", () => {
    const { store } = scratch();
    const template = store.create("Template [secret::4471]");
    const host = store.create("Host [owner::sam]\n::use template");
    const note = store.create("Reader");
    const asked = { blockId: note.id, paths: ["self.secret"] };
    expect(answerSite(store, { ...asked, self: template.id }).paths![0]!.values).toEqual(["4471"]);
    expect(() => answerSite(store, { ...asked, self: template.id, hidden: [template.id] })).toThrow("may not see");
    expect(() => answerSite(store, { blockId: template.id, chain: [{ kind: "use", block: host.id, line: 1 }], paths: ["this.owner"], hidden: [host.id] })).toThrow("may not see");
  });

  test("an ambiguous prefix is every note it starts a dependency, and names no title the reader may not see", () => {
    const { store } = scratch();
    const shown = store.create("Alpha note", null, "user", undefined, { id: "deadbeef-0000-4000-8000-000000000001" });
    const secret = store.create("Gate codes", null, "user", undefined, { id: "deadbeef-0000-4000-8000-000000000002" });
    const note = store.create("Reader");
    const open = answerSite(store, { blockId: note.id, paths: ["((deadbeef)).colour"] });
    expect(open.deps).toContain(secret.id);
    const shut = answerSite(store, { blockId: note.id, hidden: [secret.id], paths: ["((deadbeef)).colour"] });
    expect(JSON.stringify(shut)).not.toContain("Gate codes");
    expect(shut.paths![0]).toMatchObject({ hidden: true });
    void shown;
  });

  test("a figure asked outside any note still leaves out what the reader may not see", () => {
    const { store } = scratch();
    store.create("Bean row [type::chore]");
    const secret = store.create("Compost recipe [type::chore]");
    const asked = { produce: { kind: "figure" as const, figure: "table", props: { query: "type=chore" } }, paths: ["((" + secret.id + ")).title"] };
    const shut = answerSite(store, { ...asked, hidden: [secret.id] });
    expect(shut.paths![0]).toMatchObject({ hidden: true });
  });

  test("an ::if over a relation says nothing when a note it could consult is one the reader may not see", () => {
    const { store } = scratch();
    const plan = store.create("Plan [status::open]");
    const child = store.create("Quote [status::approved]", plan.id);
    const ask = (hidden: string[]) => answerSite(store, { blockId: plan.id, produce: { kind: "if", where: "child:status=approved" }, hidden });
    const open = ask([]);
    expect(open.produced).toMatchObject({ kind: "if", holds: true });
    expect(open.deps).toContain(child.id);
    expect(ask([child.id]).produced).toMatchObject({ kind: "if", holds: false, problem: { message: expect.stringContaining("aren't shown") } });
    // A clause about the note's own properties reads no other note.
    expect(answerSite(store, { blockId: plan.id, produce: { kind: "if", where: "status=open" }, hidden: [child.id] }).produced).toMatchObject({ holds: true });
  });
});
