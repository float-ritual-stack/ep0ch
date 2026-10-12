// The settings card's parts (PIE-786): which schema configures a note, its fields, and each field's picker in the
// power bar, built from the outline's own properties (here a made-up catalog). Fictional notes and values.
import { describe, expect, test } from "bun:test";
import { BUILTIN_COMPONENT_SCHEMAS } from "@ep0ch/outline-core/component-schema";
import { listSuggestions, querySuggestions, settingFields, settingProblem, settingQuestion, settingsSchema, settingValue, type SettingSources } from "../src/surface/settings-card";

const CATALOG = [
  { key: "type", value: "request", count: 4 }, { key: "type", value: "chore", count: 9 }, { key: "triage", value: "done", count: 2 },
];
const src: SettingSources = {
  catalog: async (key, prefix) => CATALOG.filter(r => (key ? r.key === key && r.value.startsWith(prefix) : r.key.startsWith(prefix))),
  actions: () => [{ value: "intake/prior-art", label: "intake/prior-art · Find prior art" }, { value: "done-stamp/stamp", label: "done-stamp/stamp · Stamp" }],
  extensions: () => ["echonet", "intake"],
};
const props = (o: Record<string, string>) => Object.entries(o).map(([key, value]) => ({ key, value }));

describe("the settings card", () => {
  test("a note is configured by the schema whose declaring property it carries; its fields in the schema's order, the name first", () => {
    expect(settingsSchema(BUILTIN_COMPONENT_SCHEMAS, props({ "rule-name": "bay", "rule-tone": "good" }))?.id).toBe("rule");
    expect(settingsSchema(BUILTIN_COMPONENT_SCHEMAS, props({ type: "virtual-branch", query: "type=chore" }))?.id).toBe("view");
    expect(settingsSchema(BUILTIN_COMPONENT_SCHEMAS, props({ "callout-type": "recipe" }))?.id).toBe("callout");
    expect(settingsSchema(BUILTIN_COMPONENT_SCHEMAS, props({ status: "todo" }))).toBeNull();
    const rule = settingsSchema(BUILTIN_COMPONENT_SCHEMAS, props({ "rule-name": "bay" }))!;
    const fields = settingFields(rule, props({ "rule-tone": "good", "rule-name": "bay" }));
    expect(fields[0]).toMatchObject({ value: "bay", prop: { key: "rule-name" } });
    expect(fields.find(f => f.prop.key === "rule-tone")?.value).toBe("good");
    expect(fields.find(f => f.prop.key === "rule-on")?.value).toBeNull();
  });

  test("a value is checked by its field's type before it's written; a picked note is a block reference", () => {
    const rule = settingsSchema(BUILTIN_COMPONENT_SCHEMAS, props({ "rule-name": "bay" }))!;
    const field = (key: string) => settingFields(rule, [])!.find(f => f.prop.key === key)!;
    expect(settingProblem(field("rule-tone"), "loud")).toContain("is one of");
    expect(settingProblem(field("rule-batch"), "soon")).toContain("is a duration");
    expect(settingProblem(field("rule-from"), "user, everyone")).toContain("user, agent or ext:");
    expect(settingProblem(field("rule-on"), "intake")).toContain("<extension>/<action>");
    expect(settingProblem(field("rule-on"), "intake/prior-art")).toBeNull();
    expect(settingProblem(field("rule-match"), "")).toContain("can't be empty");
    expect(settingValue(field("rule-under"), "11111111-2222-4333-8444-555555555555")).toBe("((11111111-2222-4333-8444-555555555555))");
  });

  test("a query is built from the outline's own properties and values; writers from the extensions installed", async () => {
    expect((await querySuggestions("type=re", src)).map(s => s.value)).toEqual(["type=request"]);
    expect((await querySuggestions("type=request AND tri", src)).map(s => s.value)).toEqual(["type=request AND triage=done"]);
    expect((await querySuggestions("type=request OR child:tri", src)).map(s => s.value)).toEqual(["type=request OR child:triage=done"]);
    expect(listSuggestions("user, ", ["user", "agent", "ext:echonet"]).map(s => s.value)).toEqual(["user, agent", "user, ext:echonet"]);
    expect(listSuggestions("user, ext:", ["user", "agent", "ext:echonet"]).map(s => s.value)).toEqual(["user, ext:echonet"]);
  });

  test("each field's picker, by its type", async () => {
    const rule = settingsSchema(BUILTIN_COMPONENT_SCHEMAS, props({ "rule-name": "bay" }))!;
    const fields = settingFields(rule, props({ "rule-name": "bay", "rule-tone": "good" }));
    const q = (key: string) => settingQuestion(fields.find(f => f.prop.key === key)!, src);
    expect(q("rule-tone")).toMatchObject({ type: "choice", value: "good", choices: ["default", "good", "warn", "bad", "dim", "accent"] });
    expect(q("rule-under")).toMatchObject({ type: "note" });
    expect((await q("rule-on").suggest!("prior"))!.map(s => s.value)).toEqual(["intake/prior-art"]);
    expect((await q("rule-from").suggest!(""))!.map(s => s.value)).toEqual(["user", "agent", "ext:echonet", "ext:intake"]);
    expect((await q("rule-quiet").suggest!(""))!.map(s => s.value)).toEqual(["2s", "1m"]);
    expect(q("rule-match")).toMatchObject({ type: "text", free: true });
  });
});
