// PIE-533 S1: the Site read. `site.answer` over a scratch outline: the design's mirror examples 1-7 and 12-14, the
// nesting cases, a value operand in a question, the survey's shapes (made-up fixtures), and watches that name their deps.
// Fictional notes; a scratch store per test, a service where the wire matters.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  return v.values;
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
  });
});
