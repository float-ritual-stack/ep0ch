// PIE-533 S4: `template.use`, the call a `::use{of=… k=v}` line makes: the template found, its props checked against the
// `[form-field::]` chips it declares, a prop's value read in the caller's Site, and the body read in the chain it
// returns (`this` stays the host). Fictional notes; a scratch store per test.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerSite } from "../src/site-answer";
import { templateUse } from "../src/template-use";
import { OutlinerStore } from "../src/store";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const c of cleanups.splice(0)) c(); });
function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "template-use-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  cleanups.push(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return store;
}
const use = (store: OutlinerStore, host: { id: string }, line = 0) => templateUse(store, { block: host.id, line });

/** A status card template with typed props, and two pages that use it. */
function cards(store: OutlinerStore) {
  const template = store.create([
    "Status card [page::status-card] [type::template] [template-for::status]",
    "[form-field::status choice active|paused|done default=active]",
    "[form-field::owner text required]",
    "[form-field::weeks number default=2]",
    "{{this.title}} is {{props.status}} for {{props.owner}} ({{props.weeks}} weeks)",
  ].join("\n"));
  const project = store.create("Garden [project::moth-garden] [status::paused]");
  const page = store.create("Beds page [status::active]\n::use{of=[[status-card]] owner=evan}", project.id);
  const other = store.create("Traps page\n::use{of=[[status-card]] owner=jay status=done}", project.id);
  return { template, project, page, other };
}

describe("the template and its props", () => {
  test("a call resolves the template, takes its defaults, and draws the body with this the host", () => {
    const store = scratch();
    const { template, page, other } = cards(store);
    const a = use(store, page, 1);
    expect(a.problems).toEqual([]);
    expect(a.template?.id).toBe(template.id);
    expect(a.props).toEqual({ owner: ["evan"], status: ["active"], weeks: ["2"] });
    expect(a.chain).toEqual([{ kind: "use", block: page.id, line: 1, mark: "::use{of=[[status-card]] owner=evan}" }]);
    // The body is read in the chain: this is the host, props are the call's.
    const body = answerSite(store, { blockId: template.id, chain: a.chain, props: a.props, line: 1 });
    expect(body.site.this).toBe(page.id);
    expect(body.values.map(v => v.values)).toEqual([["Beds page"], ["active"], ["evan"], ["2"]]);
    const b = use(store, other, 1);
    const second = answerSite(store, { blockId: template.id, chain: b.chain, props: b.props, line: 1 });
    expect(second.values.map(v => v.values?.[0])).toEqual(["Traps page", "done", "jay", "2"]);
  });

  test("an unknown prop says the nearest one, and the example call", () => {
    const store = scratch();
    const { project } = cards(store);
    const page = store.create("P\n::use{of=[[status-card]] owner=evan stauts=paused}", project.id);
    const a = use(store, page, 1);
    expect(a.problems).toHaveLength(1);
    expect(a.problems[0]).toMatchObject({ kind: "unknown", prop: "stauts", didYouMean: ["status"] });
    expect(a.problems[0]!.message).toContain("did you mean `status`?");
    expect(a.problems[0]!.example).toBe("::use{of=[[status-card]] status=active}");
    // The rest of the call still stands.
    expect(a.props.owner).toEqual(["evan"]);
  });

  test("a required prop left out is missing, with the picker's kind and an example", () => {
    const store = scratch();
    const { project } = cards(store);
    const page = store.create("P\n::use{of=[[status-card]]}", project.id);
    const a = use(store, page, 1);
    expect(a.missing).toEqual([{ name: "owner", kind: "text", example: "owner=text" }]);
    expect(a.problems[0]).toMatchObject({ kind: "missing", prop: "owner" });
  });

  test("a choice outside its options is invalid, with the nearest option", () => {
    const store = scratch();
    const { project } = cards(store);
    const page = store.create("P\n::use{of=[[status-card]] owner=evan status=pausd}", project.id);
    const a = use(store, page, 1);
    expect(a.problems[0]).toMatchObject({ kind: "invalid", prop: "status", didYouMean: ["paused"] });
  });

  test("a prop can be a path: {{ }} in the caller's Site, or a bare path headed by a reference", () => {
    const store = scratch();
    const { project } = cards(store);
    const person = store.create("Evan Schultz [page::evan schultz] [firstName::evan]");
    const page = store.create("P [status::active]\n::use{of=[[status-card]] status={{parent.status}} owner=\"[[evan schultz]].firstName\" weeks={{this.status}}}", project.id);
    const a = use(store, page, 1);
    expect(a.props.status).toEqual(["paused"]);
    expect(a.props.owner).toEqual(["evan"]);
    // weeks={{this.status}} read "active", which is not a number.
    expect(a.problems.map(p => `${p.kind}:${p.prop}`)).toEqual(["invalid:weeks"]);
    expect(a.deps).toContain(project.id);
    expect(a.deps).toContain(person.id);
  });

  test("a path that can't be read is a problem with the nearest key, and the prop is left out", () => {
    const store = scratch();
    const { project } = cards(store);
    const page = store.create("P\n::use{of=[[status-card]] owner=evan status={{parent.statu}}}", project.id);
    const a = use(store, page, 1);
    expect(a.problems.find(p => p.kind === "path")).toMatchObject({ prop: "status" });
    expect(a.props.status).toEqual(["active"]);
  });

  test("a default may be a path in the caller's Site", () => {
    const store = scratch();
    const template = store.create("Owned [page::owned]\n[form-field::owner text default={{parent.owner}}]\nowner {{props.owner}}");
    const project = store.create("Garden [owner::jay]");
    const page = store.create("P\n::use{of=[[owned]]}", project.id);
    const a = use(store, page, 1);
    expect(a.problems).toEqual([]);
    expect(a.props.owner).toEqual(["jay"]);
    expect(a.template?.id).toBe(template.id);
  });

  test("type:status finds the template that says [template-for::status]", () => {
    const store = scratch();
    const { template, project } = cards(store);
    const page = store.create("P\n::use{of=type:status owner=evan}", project.id);
    expect(use(store, page, 1).template?.id).toBe(template.id);
    const none = store.create("Q\n::use{of=type:ticket}", project.id);
    const a = use(store, none, 1);
    expect(a.template).toBeUndefined();
    expect(a.problems[0]!.message).toContain("[template-for::ticket]");
  });

  test("a missing template says so with the nearest page, and a template that draws itself is a cycle", () => {
    const store = scratch();
    const { template, project } = cards(store);
    const page = store.create("P\n::use{of=[[status-crad]]}", project.id);
    const a = use(store, page, 1);
    expect(a.problems[0]).toMatchObject({ kind: "of" });
    expect(a.anyChange).toBe(true);
    const loop = store.create("Loop [page::loop]\n::use{of=[[loop]]}");
    expect(use(store, loop, 1).problems[0]).toMatchObject({ kind: "cycle" });
    // A call inside the template's own body (drawn in a host): the chain carries the host, so the template is already being drawn.
    const nested = templateUse(store, { block: template.id, line: 0, chain: [{ kind: "use", block: template.id, line: 0 }], draft: { text: "::use{of=[[status-card]]}" } });
    expect(nested.problems[0]).toMatchObject({ kind: "cycle" });
  });

  test("a ::use inside a template body is drawn in the outer call's props", () => {
    const store = scratch();
    const { template, project } = cards(store);
    const wrapper = store.create("Wrapper [page::wrapper]\n[form-field::who text required]\n::use{of=[[status-card]] owner={{props.who}}}");
    const page = store.create("P\n::use{of=[[wrapper]] who=ada}", project.id);
    const outer = use(store, page, 1);
    const inner = templateUse(store, { block: wrapper.id, line: 2, chain: outer.chain, props: outer.props });
    expect(inner.props.owner).toEqual(["ada"]);
    expect(inner.chain.map(link => link.block)).toEqual([page.id, wrapper.id]);
    const body = answerSite(store, { blockId: template.id, chain: inner.chain, props: inner.props, line: 1 });
    expect(body.site.this).toBe(page.id);
  });

  test("a line that holds no ::use is refused with what it holds", () => {
    const store = scratch();
    const note = store.create("Just prose");
    expect(() => use(store, note, 0)).toThrow(/holds no ::use/);
  });

  test("a reserved word on the line is said, not taken as a prop", () => {
    const store = scratch();
    const { project } = cards(store);
    const page = store.create("P\n::use{of=[[status-card]] owner=evan as=new}", project.id);
    expect(use(store, page, 1).problems[0]).toMatchObject({ kind: "unknown", prop: "as" });
  });
});

describe("a save's warnings", () => {
  test("a ::use that names a prop the template lacks, a bad choice or a missing prop is warned about after the save, with the nearest name", async () => {
    const { useCallWarnings } = await import("../src/agent-tools");
    const store = scratch();
    const { project } = cards(store);
    const text = "P\n::use{of=[[status-card]] stauts=paused}\n::use{of=[[status-card]] owner=evan status=pausd}\n::use{of=[[status-card]] owner=evan}";
    const page = store.create(text, project.id);
    // The service as a client asks it: the saved text is the draft's.
    const client = { request: async (r: any) => templateUse(store, r) } as any;
    const warnings = await useCallWarnings(client, text, page.id);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain("the ::use on line 2: Status card has no prop `stauts`; did you mean `status`?");
    expect(warnings[1]).toContain("the ::use on line 2");
    expect(warnings[1]).toContain("needs `owner`");
    expect(warnings[2]).toContain("the ::use on line 3: status=pausd isn't one of active, paused, done; did you mean `paused`?");
    // Text without a ::use, or no host to ask about, says nothing.
    expect(await useCallWarnings(client, "Just prose", page.id)).toEqual([]);
    expect(await useCallWarnings(client, text, undefined)).toEqual([]);
  });
});

describe("an agent reads a note's ::use calls (outline_site)", () => {
  test("each call comes back with its template, the props it gets, and what is wrong with it", async () => {
    const { useCallsRead } = await import("../src/agent-tools");
    const store = scratch();
    const { project, template } = cards(store);
    const text = "P\n::use{of=[[status-card]] owner=evan}\n::use{of=[[status-card]] stauts=paused}";
    const page = store.create(text, project.id);
    const client = { request: async (r: any) => templateUse(store, r) } as any;
    const calls = await useCallsRead(client, page.id, text);
    expect(calls.map(c => [c.line, c.of])).toEqual([[2, "[[status-card]]"], [3, "[[status-card]]"]]);
    expect(calls[0]).toMatchObject({ template: { id: template.id, title: "Status card" }, props: { owner: ["evan"], status: ["active"] }, problems: [], missing: [] });
    expect(calls[1]!.problems.map(p => p.kind).sort()).toEqual(["missing", "unknown"]);
    expect(calls[1]!.missing).toEqual([{ name: "owner", kind: "text", example: "owner=text" }]);
    expect(await useCallsRead(client, page.id, "no calls here")).toEqual([]);
  });
});
