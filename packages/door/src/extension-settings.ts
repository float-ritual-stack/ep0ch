import { requesterOf } from "./socket";
// An extension's settings in the door (PIE-1343, PIE-1709): what the service says of them (`extensions.list`'s
// `settings`, from the manifest's configSchema, secrets and agents) drawn as a chip on its power bar row and a settings
// row whose preview says each field, and `ext.<id>.settings`, an action whose arguments are the schema's fields. A
// person's press with no fields opens the settings screen at the extension (src/desk/settings-index.ts): its settings
// card (src/surface/settings.ts, the PIE-786 card with an extension as its subject) reads each field's words, value and
// state, types one in place and tries it through the extension's own try; an agent names the fields it sets. The service
// checks the values against the schema and writes config.json on the machine that hosts the outline
// (`extensions.configure`). Here: the mapping from a schema field to an argument and a card field and back, and the one
// write (`configureExtension`) the card, the form and an agent's act share.
import type { ExtensionSecretReference, ExtensionSettingField, ExtensionSettings, ExtensionsConfigured, ExtensionsConfigureRequest } from "@ep0ch/outline-core/protocol";
import type { ComponentSchema, PropSchema } from "@ep0ch/outline-core/component-schema";
import { extensionList } from "./extensions";
import { commandLine, lineWords } from "@ep0ch/outline-core/component-block";
import { ActionRefused, asActor, type ActionDef, type ArgSpec } from "./surface/actions";
import type { Actor } from "./socket";
import type { ExtArgs, ExtOn, ExtensionEntry } from "./extensions";


/** A field's value as the form and the row show it: a command as its words, anything else as it's written. */
export function shownValue(f: ExtensionSettingField, v: unknown): string {
  // No command at all (`[]`: yo with no model) reads as typed, so the form puts back none, never an empty line (unset).
  if (f.type === "command" && Array.isArray(v) && v.every(w => typeof w === "string")) return v.length ? commandLine(v) : "[]";
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** The argument a secret is set by: its name with `secret-` before it, so it never meets a setting's. */
const secretArg = (name: string) => `secret-${name}`;

const TYPE_WORDS: Record<ExtensionSettingField["type"], string> = {
  string: "text", number: "a number", integer: "a whole number", boolean: "true or false",
  command: "a command, its words as a shell takes them, or [] for none", json: "JSON",
};

/** The action's arguments: one per field the schema declares (or `config`, the whole of it), then one per secret. */
export function settingArgs(s: ExtensionSettings): Record<string, ArgSpec> {
  // A button on a note passes the note it's on (its page's ⚙ settings, yo's answer): the host's, never a setting (PIE-1709).
  const args: Record<string, ArgSpec> = { block: { type: "string", optional: true, context: true, about: "the note a button that pressed it is on; not a setting" } };
  if (s.whole) args.config = { type: "string", optional: true, about: "its settings whole, as JSON (its schema isn't an object of named fields)", default: JSON.stringify(s.config) };
  for (const f of s.fields) {
    const now = f.value !== undefined ? shownValue(f, f.value) : f.default !== undefined ? `${shownValue(f, f.default)} (its default)` : undefined;
    args[f.name] = {
      type: f.type === "number" || f.type === "integer" ? "number" : f.type === "boolean" ? "boolean" : "string",
      optional: true,
      about: `${f.description ?? f.name} (${TYPE_WORDS[f.type]}${f.required ? ", needed" : ""}; unset=${f.name} takes it out${f.default !== undefined ? ", back to its default" : ""})`,
      ...(f.choices?.every(c => typeof c === "string") ? { choices: f.choices as string[] } : {}),
      ...(now !== undefined ? { default: now } : {}),
    };
  }
  if (s.fields.length) args.unset = {
    type: "string", optional: true,
    about: `the fields to take out of config.json, back to their defaults, by name (${s.fields.map(f => f.name).join(", ")}; several with commas)`,
  };
  for (const x of s.secrets) args[secretArg(x.name)] = {
    type: "string", optional: true,
    about: `where the secret ${x.name} is${x.description ? ` (${x.description})` : ""}: env:NAME, file:~/path, group:GROUP/KEY; never its value; empty takes it out`,
    ...(x.reference ? { default: x.reference } : {}),
  };
  return args;
}

/** A reference as typed (`env:TOKEN`, `file:~/x`, `group:readwise/TOKEN`) as config.json keeps it; empty is none. */
export function referenceOf(name: string, typed: string): ExtensionSecretReference | null {
  const t = typed.trim();
  if (!t) return null;
  const k = /^keychain[: ](.+?)(?: account (.+))?$/.exec(t);
  if (k) return { keychainService: k[1]!.trim(), ...(k[2] ? { account: k[2].trim() } : {}) };
  const m = /^(env|file|group)[: ](.+)$/.exec(t);
  const g = m?.[1] === "group" ? /^([^/\s]+)[/\s]+(\S+)$/.exec(m[2]!.trim()) : null;
  if (m?.[1] === "env") return { env: m[2]!.trim() };
  if (m?.[1] === "file") return { file: m[2]!.trim() };
  if (g) return { group: g[1]!, key: g[2]! };
  throw new ActionRefused(`secret-${name} is a reference, never the value: env:NAME, file:~/path or group:GROUP/KEY`);
}

/**
 * What the service is sent: the fields given (`set`) and the ones named in `unset=` (or a text or command field given
 * empty) taken out, merged by the service into config.json as it is then; a whole-config schema's `config` replaces it.
 */
export function changeOf(s: ExtensionSettings, given: Record<string, unknown>): Omit<ExtensionsConfigureRequest, "extension"> {
  const out: Omit<ExtensionsConfigureRequest, "extension"> = {};
  if (s.whole && given.config !== undefined) {
    const raw = String(given.config).trim();
    try { out.config = raw ? JSON.parse(raw) : {}; } catch { throw new ActionRefused("config= is its settings as JSON, such as config='{\"limit\": 4}'"); }
  }
  const unset = new Set(String(given.unset ?? "").split(/[,\s]+/).filter(Boolean));
  for (const name of unset) if (!s.fields.some(f => f.name === name)) throw new ActionRefused(`unset= names its fields: ${s.fields.map(f => f.name).join(", ")}, not ${name}`);
  const set: Record<string, unknown> = {};
  for (const f of s.fields.filter(x => given[x.name] !== undefined && !unset.has(x.name))) {
    const v = given[f.name];
    if (v === "" && (f.type === "string" || f.type === "command")) { unset.add(f.name); continue; }
    if (f.type === "command") set[f.name] = commandOf(f.name, String(v));
    else if (f.type === "json") {
      try { set[f.name] = JSON.parse(String(v)); } catch { throw new ActionRefused(`${f.name} is JSON, such as ${f.name}='${JSON.stringify(f.default ?? {})}'`); }
    } else if (f.type === "integer" && !Number.isInteger(v)) throw new ActionRefused(`${f.name} is a whole number, not ${String(v)}`);
    else set[f.name] = v;
  }
  if (Object.keys(set).length) out.set = set;
  if (unset.size) out.unset = [...unset];
  const secrets = s.secrets.filter(x => given[secretArg(x.name)] !== undefined);
  if (secrets.length) out.secrets = Object.fromEntries(secrets.map(x => [x.name, referenceOf(x.name, String(given[secretArg(x.name)]))]));
  return out;
}

/**
 * A command field's value as typed: its words as a shell takes them, or a JSON list of words written whole (`[]` is none:
 * yo with no model, PIE-1705). An empty line isn't none: it takes the field out, back to its default.
 */
function commandOf(name: string, typed: string): string[] {
  const t = typed.trim();
  if (!t.startsWith("[")) return lineWords(t);
  let words: unknown;
  try { words = JSON.parse(t); } catch { words = null; }
  if (Array.isArray(words) && words.every(w => typeof w === "string")) return words;
  throw new ActionRefused(`${name} is a command's words (${name}='claude -p'), or a JSON list of them: ${name}='[]' for none`);
}

/** The few words a row says of an extension's settings, what to do about them first: words, never a raw value (the preview has those). */
export function settingsChip(s: ExtensionSettings): string {
  if (s.state === "failing") return "failing";
  if (s.state === "missing") return "needs setup";
  return s.state === "set" ? "set" : "its defaults";
}

/** Its settings in a sentence for an extension's preview: their state in the chip's words, and where they're changed (by id, as `ext.<id>.settings` names it). */
export const settingsWords = (id: string, s: ExtensionSettings): string =>
  `Settings: ${settingsChip(s)}${s.error ? ` (${s.error.replace(/\s+/g, " ")})` : ""}. Type \`settings ${id}\` here for the settings screen at it.`;

/** Whether a row should say anything of its settings: only when they need the person (setup, a failure). */
export const settingsNeedYou = (s: ExtensionSettings | undefined): boolean => s?.state === "failing" || s?.state === "missing";

/** The settings as the settings row's preview reads them: each field and secret, where they live, and why it's failing. */
export function settingsMarkdown(e: ExtensionEntry, s: ExtensionSettings): string {
  const name = e.name ?? e.id;
  const lines = [`**${name} settings** · ${settingsChip(s)}`, ""];
  if (s.error) lines.push(`> [!warning] ${s.state === "failing" ? "Failing" : "Problem"}`, `> ${s.error.replace(/\n/g, " ")}`, "");
  if (s.whole) lines.push(`- **config**: \`${JSON.stringify(s.config)}\``);
  for (const f of s.fields) {
    const now = f.value !== undefined ? `\`${shownValue(f, f.value)}\`` : f.default !== undefined ? `default \`${shownValue(f, f.default)}\`` : f.required ? "**missing**" : "not set";
    lines.push(`- **${f.name}**: ${now}${f.description ? ` · ${f.description}` : ""}`);
  }
  for (const x of s.secrets) lines.push(`- secret **${x.name}**: ${x.reference ? `\`${x.reference}\`` : "no reference"}${x.state === "missing" ? " · **missing**" : ""}${x.description ? ` · ${x.description}` : ""}`);
  lines.push("", `In \`${s.file}\`${s.exists ? "" : " (not there yet: saving writes it)"} on the machine that hosts this outline.`,
    "", `⏎ opens the settings screen at it: each setting with its words, changed in place and tried. An agent: \`ep0ch act ext.${e.id}.settings <field>=<value>\`.`);
  return lines.join("\n");
}

/**
 * The settings as the service last answered them: `extensions.list`'s, or a save's answer until the list is read again
 * (`extensions.configure` answers the settings as written; the list follows a moment later), so the card shows what was saved.
 */
const saved = new Map<string, { list: unknown; settings: ExtensionSettings }>();
export function settingsNow(e: ExtensionEntry): ExtensionSettings | undefined {
  const s = saved.get(e.id);
  return s && s.list === extensionList() ? s.settings : e.settings;
}

/**
 * Write an extension's settings (PIE-1343, PIE-1709): `given` as the action's arguments name them (`answer='claude -p'`,
 * `unset=answer`, `secret-token=env:TOKEN`), checked against the schema by the service and written into config.json on
 * the machine that hosts the outline, as `actor`. The one write the card, the form and an agent's act share.
 */
export async function configureExtension(ctx: ExtOn["ctx"], e: ExtensionEntry, s: ExtensionSettings, given: Record<string, unknown>, actor: Actor): Promise<ExtensionsConfigured> {
  const change = changeOf(s, given);
  const name = e.name ?? e.id;
  try {
    const r = await ctx.board.request("extensions.configure", { extension: e.id, ...change, mutation: requesterOf(actor) });
    saved.set(e.id, { list: extensionList(), settings: r.settings });
    return r;
  } catch (err) {
    throw new ActionRefused(`${name}'s settings weren't saved: ${oneWords(err instanceof Error ? err.message : String(err))}`);
  }
}

/**
 * The extension's own try for a setting (PIE-1709): an action it declares that takes `setting`, its options the settings it
 * can try (yo's `try`, for `answer` and `act`). Described by the extension, so the door never knows which settings are models.
 */
export function triesOf(e: ExtensionEntry, setting: string): string | undefined {
  const a = e.actions.find(x => (x.on ?? "block") === "outline" && x.args?.some(arg => arg.name === "setting" && arg.options?.includes(setting)));
  return a ? `ext.${e.id}.${a.id}` : undefined;
}

/** `ext.<id>.settings`: the extension's settings as one action (PIE-1343), its arguments its schema's fields. */
export function settingsAction(e: ExtensionEntry, s: ExtensionSettings): ActionDef<ExtArgs, ExtOn> {
  const name = e.name ?? e.id;
  const first = s.fields[0];
  const example = first ? `ext.${e.id}.settings ${first.name}=${first.type === "command" ? `'${shownValue(first, first.default ?? ["claude", "-p"])}'` : first.type === "boolean" ? "true" : first.type === "number" || first.type === "integer" ? String(first.default ?? 1) : first.choices?.[0] ?? "<value>"}` : `ext.${e.id}.settings secret-${s.secrets[0]?.name ?? "token"}=env:TOKEN`;
  return {
    summary: `${name}'s settings (its config.json on the machine that hosts the outline): each field its configSchema declares is an argument; the ones given are set, unset= takes fields out, the rest stay. The service checks them against the schema before it writes, and the extension's next call uses them`,
    keys: "⏎ or a click on its settings row in the power bar's extensions (ctrl+k then &)",
    // The service writes a file of the host's, as the person or the agent who asked; nothing of the person's moves.
    touches: "nothing", replay: "ask",
    args: settingArgs(s) as ActionDef<ExtArgs, ExtOn>["args"],
    examples: [
      { act: example, does: `sets ${first ? first.name : "where the secret is"} in ${name}'s config.json` },
      ...(first ? [{ act: `ext.${e.id}.settings unset=${first.name}`, does: `takes ${first.name} out: ${first.default !== undefined ? "back to its default" : "left unset"}` }] : []),
    ],
    async run(args, on, actor: Actor) {
      const given = Object.fromEntries(Object.entries(args).filter(([k, v]) => v !== undefined && k !== "block"));
      const change = changeOf(s, given);
      if (change.config === undefined && change.set === undefined && change.unset === undefined && change.secrets === undefined) {
        // Nothing given: a person's press opens the card on its page (PIE-1709), where each setting reads, changes and is
        // tried; an agent reads what they are now, and the person's keys stay where they are.
        if (actor.kind === "user" && on.ctx.dispatch) return openSettingsCard(on.ctx as ExtOn["ctx"] & { dispatch: NonNullable<ExtOn["ctx"]["dispatch"]> }, e, actor);
        return { id: e.id, settings: settingsNow(e) ?? s };
      }
      const r = await configureExtension(on.ctx, e, settingsNow(e) ?? s, given, actor);
      asActor(on.ctx, actor).flash(`${name}'s settings saved in ${r.settings.file}${r.error ? ` · but ${oneWords(r.error)}` : ""}`);
      on.ctx.redraw();
      return r;
    },
  };
}

const oneWords = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The person's way to an extension's settings (PIE-1709), from its answer, its page or its power bar row: the settings
 * screen opened at it, its card beside the list. One place decides it; every button names `ext.<id>.settings`.
 */
async function openSettingsCard(ctx: ExtOn["ctx"] & { dispatch: NonNullable<ExtOn["ctx"]["dispatch"]> }, e: ExtensionEntry, actor: Actor): Promise<unknown> {
  const opened = await ctx.dispatch.act({ action: "screen.open", args: { name: "settings", target: e.id } }, actor);
  // That extension's, wherever the screen was left, and its card has the keys.
  await ctx.dispatch.act({ action: "settings.index.select", tile: "index", args: { ext: e.id } }, actor).catch(() => { /* no list on the screen: the card shows what the screen opened on */ });
  await ctx.dispatch.act({ action: "tile.focus", tile: "card" }, actor).catch(() => { /* a screen without the tile: its keys stay where they are */ });
  return opened;
}

/** The extension a page is about: its `[ext.page::<id>]`, written by the service on every extension's page. */
export function pageExtension(props: readonly { key: string; value: string }[]): ExtensionEntry | undefined {
  const id = props.find(p => p.key.toLowerCase() === "ext.page")?.value.trim();
  return id ? extensionList()?.extensions.find(x => x.id === id && x.state !== "shadowed" && settingsNow(x)) : undefined;
}

/**
 * The settings card's schema for an extension (PIE-1709): drawn from its configSchema as the service lists it, one
 * field per setting and per secret (or `config`, whole, when the schema isn't named fields), each its own words. The
 * card reads it as it reads a component's, so the keys, placements and actions are the card's own.
 */
export function extensionCardSchema(e: ExtensionEntry, s: ExtensionSettings): ComponentSchema {
  const field = (f: ExtensionSettingField): PropSchema => ({
    key: f.name, where: "note", meaning: f.description ?? f.name,
    ...(f.type === "boolean" ? { type: "enum", values: [{ value: "true", meaning: "on" }, { value: "false", meaning: "off" }] }
      : f.choices?.length ? { type: "enum", values: f.choices.map(c => ({ value: String(c), meaning: String(c) })) } : { type: "text" }),
    ...(f.default !== undefined ? { default: shownValue(f, f.default) } : {}),
    ...(f.required ? { required: true } : {}),
  });
  const props: PropSchema[] = [
    ...(s.whole ? [{ key: "config", where: "note", type: "text", meaning: "its settings whole, as JSON (its schema isn't named fields)" } satisfies PropSchema] : []),
    ...s.fields.map(field),
    ...s.secrets.map((x): PropSchema => ({ key: secretArg(x.name), where: "note", type: "text", meaning: `${x.description ? `${x.description}: ` : ""}where the secret is, never its value: env:NAME, file:~/path, group:GROUP/KEY` })),
  ];
  const name = e.name ?? e.id;
  return { id: `ext-${e.id}-settings`, title: name, group: "extensions", intro: e.description ?? "", where: s.file, props,
    source: { use: "", note: { title: name, name: "ext.page", value: e.id } }, example: {} } as ComponentSchema;
}

/** One field of an extension's card: its value as it reads (a command as one shell line), its state, and its try. */
export interface ExtensionCardField { value: string | null; state: ExtensionSettingField["state"] | "missing" | "set"; tries?: string; secret?: true }

/** Each card field's value and state, in the schema's order (`extensionCardSchema`'s props). */
export function extensionCardValues(e: ExtensionEntry, s: ExtensionSettings): Map<string, ExtensionCardField> {
  const out = new Map<string, ExtensionCardField>();
  if (s.whole) out.set("config", { value: JSON.stringify(s.config), state: Object.keys(s.config).length ? "set" : "default" });
  for (const f of s.fields) {
    const tries = triesOf(e, f.name);
    out.set(f.name, { value: f.value !== undefined ? shownValue(f, f.value) : null, state: f.state, ...(tries ? { tries } : {}) });
  }
  for (const x of s.secrets) out.set(secretArg(x.name), { value: x.reference ?? null, state: x.state, secret: true });
  return out;
}

/** What `x` (clear) sends for a field: a setting taken out (back to its default), a secret's reference taken out. */
export const clearOf = (key: string): Record<string, string> => key.startsWith("secret-") ? { [key]: "" } : key === "config" ? { config: "" } : { unset: key };
