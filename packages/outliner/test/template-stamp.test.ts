// PIE-533 S4: `template.stamp`, a template written out as a new note. Today's daily note from [[daily-template]] with
// {{now.date}} filled; `for=` once per match and not twice; `freeze=all`; a subtree; the template's own bookkeeping
// not stamped; a refused call writes nothing. Fictional notes; a scratch store per test; an injected clock.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerSite } from "../src/site-answer";
import { stampTemplate, type TemplateStampRequest } from "../src/template-stamp";
import { OutlinerStore } from "../src/store";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const c of cleanups.splice(0)) c(); });
function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "template-stamp-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  cleanups.push(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return store;
}
const clock = () => new Date(2026, 9, 17, 9, 30).getTime();
const stamp = (store: OutlinerStore, request: TemplateStampRequest) => stampTemplate(store, request, clock);
const text = (store: OutlinerStore, id: string) => store.resolveBlockRef(id).text;
const kids = (store: OutlinerStore, id: string) => store.children(id).map(b => b.text);

function daily(store: OutlinerStore) {
  const template = store.create([
    "{{now.date}} [page::daily-template] [type::template] [template-for::daily]",
    "Plan for {{now.weekday}}: owner {{owner}}, in {{parent.title}}",
  ].join("\n"));
  store.create("Morning pages", template.id);
  store.create("Check {{props.where}} traps", template.id);
  const notes = store.create("Daily notes [page::daily notes] [owner::evan]");
  return { template, notes };
}

describe("stamp as=new", () => {
  test("today's daily note: now filled, this and parent left as live braces, the template's own chips gone, type from template-for", () => {
    const store = scratch();
    const { template, notes } = daily(store);
    const out = stamp(store, { of: "[[daily-template]]", as: "new", parent: "[[daily notes]]" });
    expect(out.stamped).toHaveLength(1);
    const made = out.stamped[0]!;
    expect(made.parentId).toBe(notes.id);
    expect(text(store, made.id)).toBe(`2026-10-17 [type::daily] [from-template::((${template.id}))]\nPlan for Saturday: owner {{owner}}, in {{parent.title}}`);
    // The subtree comes too, and a placeholder the stamp can't read is left and said.
    expect(kids(store, made.id)).toEqual(["Morning pages", "Check {{props.where}} traps"]);
    expect(out.warnings[0]).toContain("props.where");
    expect(out.said).toContain("this, parent and bare keys stay as {{ }}");
    // The template itself is untouched.
    expect(text(store, template.id)).toContain("[type::template]");
  });

  test("freeze=all writes this and parent too, so no braces are left that can be read", () => {
    const store = scratch();
    const { notes } = daily(store);
    const out = stamp(store, { of: "[[daily-template]]", parent: "[[daily notes]]", freeze: "all" });
    expect(text(store, out.stamped[0]!.id)).toContain("Plan for Saturday: owner evan, in Daily notes");
    expect(out.stamped[0]!.parentId).toBe(notes.id);
    expect(out.said).toContain("every {{ }} written as its value");
  });

  test("title= replaces the first line's words and keeps its chips; it may use the stamp's own values", () => {
    const store = scratch();
    daily(store);
    const out = stamp(store, { of: "type:daily", title: "Log {{now.date}}" });
    expect(text(store, out.stamped[0]!.id)).toStartWith("Log 2026-10-17 [type::daily]");
  });

  test("with no parent it lands where any new note does: the top of the Inbox", () => {
    const store = scratch();
    daily(store);
    const out = stamp(store, { of: "type:daily" });
    expect(out.stamped[0]!.parentId).not.toBeNull();
    expect(store.resolveBlockRef(out.stamped[0]!.parentId!).text).toContain("Inbox");
  });

  test("props are checked and filled: defaults, a required one, an unknown one refuse before anything is written", () => {
    const store = scratch();
    const template = store.create("Meeting {{props.with}} [page::meeting-template] [type::template] [template-for::meeting]\n[form-field::with text required]\n[form-field::mood choice good|meh default=good]\n{{props.mood}} with {{props.with}} on {{props.date}}\n[form-field::date text default={{now.date}}]");
    const before = store.children(null).length;
    expect(() => stamp(store, { of: "[[meeting-template]]" })).toThrow(/needs `with`/);
    expect(() => stamp(store, { of: "[[meeting-template]]", props: { with: "Jay", mod: "meh" } })).toThrow(/did you mean `mood`\?/);
    expect(store.children(null).length).toBe(before);
    const out = stamp(store, { of: "[[meeting-template]]", props: { with: "Jay" } });
    expect(text(store, out.stamped[0]!.id)).toBe(`Meeting Jay [type::meeting] [from-template::((${template.id}))]\ngood with Jay on 2026-10-17`);
  });

  test("an unreadable template and as= other than new are refused with where to go", () => {
    const store = scratch();
    daily(store);
    expect(() => stamp(store, { of: "[[daily-templat]]" })).toThrow(/no page daily-templat; did you mean \[\[daily-template\]\]/);
    expect(() => stamp(store, { of: "[[daily-template]]", as: "old" })).toThrow(/as=new/);
    expect(() => stamp(store, { of: "[[daily-template]]", freeze: "some" })).toThrow(/freeze=all/);
  });
});

describe("stamp for=", () => {
  function tickets(store: OutlinerStore) {
    const template = store.create("PC-{{props.for.number}} {{props.for.title}} [page::ticket-template] [type::template] [template-for::ticket]\nask: {{props.for.ask}}");
    const asks = store.create("Asks");
    const a = store.create("Fix the gate [kind::ask] [number::101] [ask::latch]", asks.id);
    const b = store.create("Paint the shed [kind::ask] [number::102] [ask::red]", asks.id);
    store.create("Not an ask [kind::note]", asks.id);
    return { template, asks, a, b };
  }

  test("once per match, each match is props.for, and stamping again adds nothing", () => {
    const store = scratch();
    const { asks, a, b } = tickets(store);
    const out = stamp(store, { of: "[[ticket-template]]", parent: asks.id, for: "kind=ask" });
    expect(out.stamped).toHaveLength(2);
    const texts = out.stamped.map(s => text(store, s.id));
    expect(texts.some(t => t.startsWith("PC-101 Fix the gate"))).toBe(true);
    expect(texts.some(t => t.includes("ask: red"))).toBe(true);
    expect(texts.find(t => t.includes("PC-101"))).toContain(`[stamped-for::((${a.id}))]`);
    expect(texts.find(t => t.includes("PC-102"))).toContain(`[stamped-for::((${b.id}))]`);
    const again = stamp(store, { of: "[[ticket-template]]", parent: asks.id, for: "kind=ask" });
    expect(again.stamped).toHaveLength(0);
    expect(again.skipped).toHaveLength(2);
    expect(again.said).toContain("nothing new");
    // A new match is stamped alone.
    store.create("Mend the fence [kind::ask] [number::103] [ask::wire]", asks.id);
    const third = stamp(store, { of: "[[ticket-template]]", parent: asks.id, for: "kind=ask" });
    expect(third.stamped).toHaveLength(1);
    expect(third.skipped).toHaveLength(2);
  });

  test("a query that matches nothing stamps nothing and says so; one that matches too many is refused", () => {
    const store = scratch();
    tickets(store);
    expect(stamp(store, { of: "[[ticket-template]]", for: "kind=nothing" }).said).toContain("matches no note");
    for (let i = 0; i < 51; i += 1) store.create(`bulk ${i} [kind::bulk]`);
    expect(() => stamp(store, { of: "[[ticket-template]]", for: "kind=bulk" })).toThrow(/more than 50/);
  });
});

describe("stamp and step ids (PIE-818)", () => {
  test("a template's generated step ids are not carried into the stamp; a name its author wrote is", () => {
    const store = scratch();
    store.create("Plan template [page::plan-template] [type::template]\n- [ ] Fill in the first step ^t-3fa9c1\n- [ ] Second ^t-aabbcc dd\n## Log ^log\nA line ^named");
    const out = stamp(store, { of: "[[plan-template]]" });
    const made = text(store, out.stamped[0]!.id);
    expect(made).not.toContain("^t-3fa9c1");
    expect(made).toContain("- [ ] Fill in the first step\n");
    expect(made).toContain("## Log ^log");
    expect(made).toContain("A line ^named");
    // The template keeps its own.
    expect(text(store, store.resolveBlockRef("[[plan-template]]").id)).toContain("^t-3fa9c1");
  });
});

describe("what a stamp writes is words", () => {
  test("a prop value holding {{ }} is written escaped, so the new note never reads what the caller typed; a title is one line", () => {
    const store = scratch();
    store.create("Greeting {{props.who}} [page::greeting-tpl] [type::template]\n[form-field::who text]\nHello {{props.who}}.");
    const out = stamp(store, { of: "[[greeting-tpl]]", props: { who: "{{this.secret}}" } });
    expect(text(store, out.stamped[0]!.id)).toContain("Hello \\{{this.secret}}.");
    const second = stamp(store, { of: "[[greeting-tpl]]", props: { who: "Ada" }, title: "Line one\nline two" });
    expect(text(store, second.stamped[0]!.id)).toStartWith("Line one line two ");
  });
});

describe("review findings", () => {
  test("a value's braces and the template's can't meet to make a live placeholder, and freeze=all doesn't either", () => {
    const store = scratch();
    store.create("Pair {{props.a}}{{props.b}} [page::pair-tpl] [type::template]\n[form-field::a text]\n[form-field::b text]\nbody {{props.a}}{{props.b}} and {{this.title}}");
    const out = stamp(store, { of: "[[pair-tpl]]", props: { a: "{", b: "{this.secret}}" } });
    const made = text(store, out.stamped[0]!.id);
    // Escaped where the two values meet; the template's own {{this.title}} stays live.
    expect(made).toContain("body \\{{this.secret}} and {{this.title}}");
    expect(answerSite(store, { blockId: out.stamped[0]!.id }).values.map(v => v.expression)).toEqual(["this.title"]);
    const frozen = stamp(store, { of: "[[pair-tpl]]", props: { a: "{", b: "{this.secret}}" }, freeze: "all" });
    expect(text(store, frozen.stamped[0]!.id)).toContain("and Pair \\{{this.secret}}");
    expect(answerSite(store, { blockId: frozen.stamped[0]!.id }).values).toEqual([]);
  });

  test("a match stamped from one template is still stamped from another, and neither is made twice", () => {
    const store = scratch();
    store.create("A {{props.for.title}} [page::tpl-a] [type::template]");
    store.create("B {{props.for.title}} [page::tpl-b] [type::template]");
    const parent = store.create("Asks");
    store.create("Fix the gate [kind::ask]", parent.id);
    const once = (of: string) => stamp(store, { of, parent: parent.id, for: "kind=ask" });
    expect(once("[[tpl-a]]").stamped).toHaveLength(1);
    expect(once("[[tpl-b]]").stamped).toHaveLength(1);
    expect(once("[[tpl-a]]").skipped).toHaveLength(1);
    expect(once("[[tpl-b]]").skipped).toHaveLength(1);
  });
});
