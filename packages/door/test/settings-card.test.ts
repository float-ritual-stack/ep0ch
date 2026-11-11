// The settings card's parts (PIE-786): which schema configures a note, its fields, and each field's picker in the
// power bar, built from the outline's own properties (here a made-up catalog). Fictional notes and values.
import { describe, expect, test } from "bun:test";
import { BUILTIN_COMPONENT_SCHEMAS, componentSchemaProblem } from "@ep0ch/outline-core/component-schema";
import { listSuggestions, settingFields, settingProblem, settingQuestion, settingsSchema, settingsSchemas, settingValue, type SettingSources } from "../src/surface/settings-card";

const CATALOG = [
  { key: "type", value: "request", count: 4 }, { key: "type", value: "chore", count: 9 }, { key: "triage", value: "done", count: 2 },
];
const src: SettingSources = {
  catalog: async (key, prefix) => CATALOG.filter(r => (key ? r.key === key && r.value.startsWith(prefix) : r.key.startsWith(prefix))),
  actions: () => [{ value: "intake/prior-art", label: "intake/prior-art · Find prior art" }, { value: "done-stamp/stamp", label: "done-stamp/stamp · Stamp" }],
  extensions: () => ["echonet", "intake"],
  nodes: async () => ["pie@float-2", "hub@laptop"],
};
const props = (o: Record<string, string>) => Object.entries(o).map(([key, value]) => ({ key, value }));

describe("the settings card", () => {
  test("a figure's camel-case key reads as set, in its own spelling (PIE-1513 review)", () => {
    const table = BUILTIN_COMPONENT_SCHEMAS.find(s => s.id === "graph-table")!;
    const field = settingFields(table, props({ titleColumn: "1" }), "yaml").find(f => f.prop.key === "titleColumn")!;
    expect(field.value).toBe("1");
  });
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

  test("writer lists come from the extensions installed", () => {
    expect(listSuggestions("user, ", ["user", "agent", "ext:echonet"]).map(s => s.value)).toEqual(["user, agent", "user, ext:echonet"]);
    expect(listSuggestions("user, ext:", ["user", "agent", "ext:echonet"]).map(s => s.value)).toEqual(["user, ext:echonet"]);
  });

  test("a node field offers the nodelist's nodes and masks over them, and checks what's typed", async () => {
    const schema = { id: "ext-echonet-subscription", group: "site", title: "Subscriptions", intro: "x", where: "x", example: {}, sweep: [], grids: [], space: [],
      props: [{ key: "subscribe", where: "note" as const, type: "node" as const, meaning: "the nodes it reads" }], source: { use: "x", note: { title: "S", name: "subscribe", value: "pie@float-2" } } };
    const [f] = settingFields(schema, []);
    expect((await settingQuestion(f!, src).suggest!(""))!.map(s => s.value)).toEqual(["pie@float-2", "hub@laptop", "*@float-2", "*@laptop", "*@*"]);
    expect((await settingQuestion(f!, src).suggest!("lap"))!.map(s => s.value)).toEqual(["hub@laptop", "*@laptop"]);
    expect(settingProblem(f!, "rexall-*@laptop")).toBeNull();
    expect(settingProblem(f!, "@reading-list")).toBeNull();
    expect(settingProblem(f!, "not a node")).toContain("is a node");
    expect(settingProblem(f!, ", ,")).toContain("is a node");
    expect(settingProblem(f!, "pie@float-2, *@laptop")).toBeNull();
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

test("EchoNet ships its subscription's schema: a subscription note gets a card, subscribe a node field", async () => {
  // The manifest as written (the outliner's own test loads it through its checker, componentSchemaProblem included).
  const manifest = await Bun.file(new URL("../../outliner/extensions/echonet/extension.json", import.meta.url)).json() as { components: import("@ep0ch/outline-core/component-schema").ComponentSchema[] };
  const schemas = manifest.components;
  for (const s of schemas) expect(componentSchemaProblem(s)).toBeNull();
  const schema = settingsSchema(schemas, props({ subscribe: "shack@float-2", echo: "recon" }))!;
  expect(schema.id).toBe("echonet-subscription");
  // A posting ([echo::] alone) is no subscription: no card.
  expect(settingsSchema(schemas, props({ echo: "recon" }))).toBeNull();
  const fields = settingFields(schema, props({ subscribe: "shack@float-2", echo: "recon" }));
  expect(fields.map(f => [f.prop.key, f.prop.type, f.value])).toEqual([["subscribe", "node", "shack@float-2"], ["echo", "text", "recon"], ["since", "text", null], ["cap", "int", null]]);
  expect(settingProblem(fields[3]!, "0")).toContain("is a whole number");
});

test("a note that is two things gets a section each: a view named as an EchoNet area; a posting is neither", async () => {
  const manifest = await Bun.file(new URL("../../outliner/extensions/echonet/extension.json", import.meta.url)).json() as { components: import("@ep0ch/outline-core/component-schema").ComponentSchema[] };
  const all = [...BUILTIN_COMPONENT_SCHEMAS, ...manifest.components];
  const view = props({ type: "virtual-branch", query: "type=plot-post", echo: "plot.chat" });
  const found = settingsSchemas(all, view);
  expect(found.map(s => s.id)).toEqual(["view", "echonet-area"]);
  const fields = settingFields(found, view);
  expect(fields.map(f => [f.section, f.prop.key]).filter(([, k]) => k === "query" || k === "echo")).toEqual([[0, "query"], [1, "echo"]]);
  expect(fields.map(f => f.n)).toEqual(fields.map((_, i) => i + 1));
  // [echo::] on a plain note is a posting: no area card (the area requires a query).
  expect(settingsSchemas(all, props({ echo: "plot.chat" }))).toEqual([]);
  // A key two sections both take is one field, the first section's.
  const twice = settingFields([found[1]!, { ...found[1]!, id: "again" }], view);
  expect(twice.map(f => f.prop.key)).toEqual(["echo"]);
});

// PIE-1709: an extension's command setting edits as one shell line. yo's own default, shown as the card shows it and with
// one word changed as a person types it, saves back as its words: the empty ones and the one with spaces whole.
test("yo's default model command reads as one line and saves back word for word, one word changed", async () => {
  const { changeOf, shownValue } = await import("../src/extension-settings");
  const manifest = await Bun.file(new URL("../../outliner/extensions/yo/extension.json", import.meta.url)).json() as { configSchema: { properties: { answer: { default: string[]; description: string } } } };
  const answer = manifest.configSchema.properties.answer.default;
  const field = { name: "answer", type: "command" as const, description: "the answer model", default: answer, state: "default" as const };
  const line = shownValue(field, answer);
  expect(line).toContain(`--tools "" --setting-sources ""`);
  const s = { file: "/made-up/yo/config.json", exists: false, state: "default" as const, fields: [field], secrets: [], config: {} };
  const typed = line.replace("--model haiku", "--model sonnet");
  expect(changeOf(s, { answer: typed }).set).toEqual({ answer: answer.map(w => (w === "haiku" ? "sonnet" : w)) });
  expect(changeOf(s, { answer: line }).set!.answer).toEqual(answer);
});

// CodeRabbit on #1416: [↺ all] is offered only where settings.reset has something to put back. A secret's reference and
// a whole config aren't its (reset keeps references), so a card with only those set offers no reset at all.
test("an extension's card offers [↺ all] only for settings reset would put back", async () => {
  const { SettingsCard, resettable } = await import("../src/surface/settings-card");
  const { extensionCardSchema, extensionCardValues } = await import("../src/extension-settings");
  const card = (settings: Record<string, unknown>) => {
    const entry = { id: "planter", name: "Planter", actions: [] } as never;
    const schema = extensionCardSchema(entry, settings as never), values = extensionCardValues(entry, settings as never);
    const fields = schema.props.map((prop, i) => ({ n: i + 1, prop, value: values.get(prop.key)!.value, section: 0, ext: values.get(prop.key)! }));
    const c = new SettingsCard([schema]);
    return { fields, drawn: c.draw(fields, 80, 20, 0, 0).join("\n") };
  };
  const base = { file: "/made-up/planter/config.json", exists: true, state: "set", config: {} };
  const secretOnly = card({ ...base, fields: [{ name: "beds", type: "string", default: "3", state: "default" }], secrets: [{ name: "token", reference: "env PLANTER_TOKEN", state: "set" }] });
  expect(resettable(secretOnly.fields)).toEqual([]);
  expect(secretOnly.drawn).not.toContain("[↺ all]");
  const wholeOnly = card({ ...base, whole: true, config: { rows: 4 }, fields: [], secrets: [] });
  expect(wholeOnly.drawn).not.toContain("[↺ all]");
  const one = card({ ...base, fields: [{ name: "beds", type: "string", default: "3", value: "5", state: "set" }], secrets: [{ name: "token", reference: "env PLANTER_TOKEN", state: "set" }] });
  expect(resettable(one.fields)).toEqual(["beds"]);
  expect(one.drawn).toContain("[↺ all]");
});

// PIE-1293's gate on the card (nightly-1111): its foot names each key from the table it lives in, never typed, so the
// selected field's row says the card's own keys and what clearing it does.
test("an extension's card foot names the card's keys from its key table", async () => {
  const { SettingsCard } = await import("../src/surface/settings-card");
  const { extensionCardSchema, extensionCardValues } = await import("../src/extension-settings");
  const entry = { id: "planter", name: "Planter", actions: [] } as never;
  const settings = { file: "/made-up/planter/config.json", exists: true, state: "set", config: {}, fields: [{ name: "beds", type: "string", default: "3", value: "5", state: "set" }], secrets: [] };
  const schema = extensionCardSchema(entry, settings as never), values = extensionCardValues(entry, settings as never);
  const fields = schema.props.map((prop, i) => ({ n: i + 1, prop, value: values.get(prop.key)!.value, section: 0, ext: values.get(prop.key)! }));
  const drawn = new SettingsCard([schema]).draw(fields, 100, 20, 0, 0).join("\n").replace(/\x1b\[[\d;]*m/g, "");
  expect(drawn).toContain("beds · ⏎ edit · x back to its default");
});

// CodeRabbit on #1438: an extension's foot wraps (up to three rows) at a narrow width; the field rows leave it room, so
// the keys it names are never cut off the card's bottom.
test("an extension's card at 44 columns keeps its whole wrapped foot under a full list", async () => {
  const { SettingsCard } = await import("../src/surface/settings-card");
  const { extensionCardSchema, extensionCardValues } = await import("../src/extension-settings");
  const entry = { id: "planter", name: "Planter", actions: [] } as never;
  const many = Array.from({ length: 12 }, (_, i) => ({ name: `bed-${i}`, type: "string", default: "3", value: "5", state: "set" }));
  const settings = { file: "/made-up/planter/config.json", exists: true, state: "set", config: {}, fields: many, secrets: [] };
  const schema = extensionCardSchema(entry, settings as never), values = extensionCardValues(entry, settings as never);
  const fields = schema.props.map((prop, i) => ({ n: i + 1, prop, value: values.get(prop.key)!.value, section: 0, ext: values.get(prop.key)! }));
  const card = new SettingsCard([schema]);
  // What was last said is the foot too: a refusal in the command's own words, three rows at this width.
  card.say("the bed count is refused: beds takes a whole number from one to twelve, and the shed has room for ten", "problem");
  const lines = card.draw(fields, 44, 10, 0, 0).map(l => l.replace(/\x1b\[[\d;]*m/g, ""));
  expect(lines.length).toBeLessThanOrEqual(10);
  expect(lines.join(" ").replace(/\s+/g, " ")).toContain("room for ten");
});
