// PIE-1314: the note-routing component is note-mover. The old name keeps reading, and saving it says what it's called
// now, naming the line. Every note here is made up.
import { describe, expect, test } from "bun:test";
import { BUILTIN_COMPONENT_SCHEMAS, settingsSchemas } from "../src/component-schema";
import { componentReading } from "../src/component-warnings";
import { NOTE_MOVER_VIEW_WORDS, renamedRuleText, renamedView } from "../src/note-mover-rename";
import { parsePropertyRecords } from "../src/property-parse";
import { syntaxWarnings } from "../src/syntax-warnings";

const renames = (text: string) => syntaxWarnings(text).filter(w => w.message.includes("renamed to note-mover"));

describe("the component's name", () => {
  test("the library has note-mover and no route", () => {
    const ids = BUILTIN_COMPONENT_SCHEMAS.map(s => s.id);
    expect(ids).toContain("note-mover");
    expect(ids).not.toContain("route");
  });

  test("a note carrying a rule's properties gets the settings card, written either way", () => {
    const of = (...keys: string[]) => settingsSchemas(BUILTIN_COMPONENT_SCHEMAS, keys.map(key => ({ key, value: "x" }))).map(s => s.id);
    expect(of("query", "note-mover")).toContain("note-mover");
    expect(of("query", "route-to")).toContain("note-mover");
  });
});

describe("saving the old name", () => {
  test("a [type::route] rule warns on its line, with the rule it means", () => {
    const [w] = renames("Jars go up\n[type::route] [query::type=jar] [route-to::((shelf))] [route-when::command]");
    expect(w).toMatchObject({ line: 1 });
    expect(w!.message).toContain("line 2");
    expect(w!.message).toContain("did you mean [query::type=jar] [note-mover::((shelf))] [note-mover-when::command]?");
  });

  test("a ::route line warns, and only once", () => {
    const warnings = syntaxWarnings("Jars\n\n::route\n");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.line).toBe(2);
    expect(warnings[0]!.message).toContain("the ::route on line 3 is renamed to note-mover");
    expect(warnings[0]!.message).toContain("[note-mover::((id))] [query::");
    expect(componentReading("Jars\n\n::route\n::\n", BUILTIN_COMPONENT_SCHEMAS).warnings).toEqual([]);
  });

  test("a ::note-mover line says where a rule is written, not that it's unclosed", () => {
    const [w, ...rest] = syntaxWarnings("Jars\n\n::note-mover\n");
    expect(rest).toEqual([]);
    expect(w!.message).toContain("the ::note-mover on line 3 draws nothing");
    expect(w!.message).toContain("[note-mover::((id))] [query::");
  });

  test("the new name, other notes' keys and a rule quoted in code say nothing", () => {
    expect(renames("Jars [note-mover::((shelf))] [query::type=jar]")).toEqual([]);
    expect(renames("Directions [route::north] [route-to::the coast]")).toEqual([]);
    expect(renames("A rule is written `[type::route] [route-to::((x))]`")).toEqual([]);
    expect(renames("Example\n\n```\n::route\n```")).toEqual([]);
  });
});

describe("rewriting", () => {
  test("a rule's words, and everything else in the note, stay as written", () => {
    const text = "Jars go up [type::route] [query::type=jar] [route-to::((shelf))] [route-order::2] [route-at::end] [actor::kitty]\n\nThe [route-to::prose] stays, and `[type::route]` too.";
    expect(renamedRuleText(text)).toBe("Jars go up [query::type=jar] [note-mover::((shelf))] [note-mover-order::2] [note-mover-at::end] [actor::kitty]\n\nThe [route-to::prose] stays, and `[type::route]` too.");
  });

  test("the rule a rewrite gives reads as a rule's, and has nothing left to warn about", () => {
    const after = renamedRuleText("Jars [type::route] [query::type=jar] [route-to::((shelf))]")!;
    expect(renames(after)).toEqual([]);
  });

  test("a rule with no target keeps its type, so the note still says what it is; a note that's no rule is left alone", () => {
    expect(renamedRuleText("Half a rule [type::route] [query::type=jar]")).toBeNull();
    expect(renamedRuleText("Directions [route-to::the coast]")).toBeNull();
    expect(renamedRuleText("Jars [type::jar]")).toBeNull();
  });

  test("a saved view asks for the new name, keeping the rest of its query", () => {
    expect(renamedView("Rules [type::virtual-branch] [query::type=route AND #kitchen]")).toBe("Rules [type::virtual-branch] [query::note-mover AND #kitchen]");
    expect(renamedView("Trails [query::type=route-history]")).toBe("Trails [query::type=note-mover-history]");
    expect(renamedView("Paths [query::type=router]")).toBeNull();
    expect(renamedView("Told `[query::type=route]` in words")).toBeNull();
    expect(renamedView("Note mover [system-view::note-mover] [query::note-mover OR type=route]")).toBeNull();
  });

  test("the seeded view takes the new names and the new words; a person's title and page stand", () => {
    const seeded = "Routing [page::routing] [type::virtual-branch] [system-view::routing] [query::type=route] [limit::200]\n\nNotes route themselves by the rules listed here.";
    const after = renamedView(seeded)!;
    expect(after.split("\n")[0]).toBe("Note mover [page::note-mover] [type::virtual-branch] [system-view::note-mover] [query::note-mover OR type=route] [limit::200]");
    expect(renamedView("My shelf rules [page::shelf-rules] [system-view::routing] [query::type=route]")).toBe("My shelf rules [page::shelf-rules] [system-view::note-mover] [query::note-mover OR type=route]");
  });

  // Codex on #1293.
  const blockKeys = (text: string) => parsePropertyRecords(text).filter(r => r.scope === "block").map(r => r.key);

  test("a [type::route] alone on its line goes with its line, so the properties under it stay the note's", () => {
    const after = renamedRuleText("Jars go up\n[type::route]\n[query::type=jar]\n[route-to::root]\n\nFiled by hand.")!;
    expect(after).toBe("Jars go up\n[query::type=jar]\n[note-mover::root]\n\nFiled by hand.");
    expect(blockKeys(after)).toEqual(["query", "note-mover"]);
    const bare = renamedRuleText("Jars go up\ntype:: route\nquery:: type=jar\nroute-to:: root")!;
    expect(bare).toBe("Jars go up\nquery:: type=jar\nnote-mover:: root");
    expect(blockKeys(bare)).toEqual(["query", "note-mover"]);
    expect(renamedRuleText("Jars go up\n[query::type=jar]\n[route-to::root]\n[type::route]")).toBe("Jars go up\n[query::type=jar]\n[note-mover::root]");
  });

  test("a key written with capitals is the same key: nothing is left under the old name", () => {
    expect(renamedRuleText("Jars [Type::Route] [query::type=jar] [Route-to::root] [ROUTE-WHEN::command]")).toBe("Jars [query::type=jar] [note-mover::root] [note-mover-when::command]");
  });

  test("the seeded view takes the new words for the default only: what a person added stays", () => {
    const old = "Notes route themselves by the rules listed here, and a rule is a note anywhere in the outline: its properties are type (route), query (which notes, in the saved views' grammar: type=recipe) and route-to (where they go: a note's ((id)), a [[page]], a Work ID, inbox or root). Optional: route-when (create, the default: new notes; edit: every save; command: only when asked), route-order (a number; lower first) and route-at (top, the default, or end).\n\nFirst match wins: by route-order, then the order of this view, then the order written. A match moves the note as ext:route, one revision, with a history under the rule. `ep0ch route <note> --dry-run` says what would move where and why; `ep0ch route --all` routes every note; in the door, alt+z routes the note you read.";
    const head = "Routing [page::routing] [type::virtual-branch] [system-view::routing] [query::type=route] [limit::200]";
    const newHead = "Note mover [page::note-mover] [type::virtual-branch] [system-view::note-mover] [query::note-mover OR type=route] [limit::200]";
    expect(renamedView(`${head}\n\n${old}\n\nMy own note: the jars rule is seasonal.`)).toBe(`${newHead}\n\n${NOTE_MOVER_VIEW_WORDS}\n\nMy own note: the jars rule is seasonal.`);
    // Words a person has changed are theirs, whole.
    const edited = "Notes route themselves by the rules listed here, more or less.";
    expect(renamedView(`${head}\n\n${edited}`)).toBe(`${newHead}\n\n${edited}`);
  });

  test("only a note's own query is a view's: prose about one is left as written", () => {
    expect(renamedView("How rules were listed\n\nA view had [query::type=route] on its first line, back then.")).toBeNull();
    expect(renamedView("Old notes\n\n[query::type=route]\n\nA line in the body.")).toBeNull();
    expect(renamedView("Ticket about it\n\nThe [system-view::routing] view and [page::routing] page.")).toBeNull();
  });

  test("a view written with bare properties is rewritten in the same form", () => {
    expect(renamedView("Rules\ntype:: virtual-branch\nquery:: type=route AND #kitchen")).toBe("Rules\ntype:: virtual-branch\nquery:: note-mover AND #kitchen");
    expect(renamedView("Rules\nsystem-view:: routing\npage:: routing\nquery:: type=route")).toBe("Rules\nsystem-view:: note-mover\npage:: note-mover\nquery:: note-mover OR type=route");
    expect(renamedView("Rules [Query::type=route]")).toBe("Rules [Query::note-mover]");
  });
});
