// An extension's settings in the door (PIE-1343): what the service says of them (`extensions.list`'s `settings`, from
// the manifest's configSchema and secrets) drawn as a chip on its power bar row and a settings row whose preview says
// each field, and `ext.<id>.settings`, an action whose arguments are the schema's fields. A person's press opens the
// action form (src/bar/form.ts) every action with arguments has; an agent names the fields it sets. The service checks
// the values against the schema and writes config.json on the machine that hosts the outline (`extensions.configure`).
// The only thing here is the mapping from a schema field to an argument and back: the form, the check and the file
// are the existing parts'.
import type { ExtensionSecretReference, ExtensionSettingField, ExtensionSettings } from "@ep0ch/outline-core/protocol";
import { lineWords } from "@ep0ch/outline-core/component-block";
import { ActionRefused, asActor, type ActionDef, type ArgSpec } from "./surface/actions";
import type { Actor } from "./socket";
import type { ExtArgs, ExtOn, ExtensionEntry } from "./extensions";

/** A command's words as they're typed back: a word with a space or a quote quoted, an empty one `""`. */
export const commandWords = (argv: readonly string[]) => argv.map(w => (w === "" || /[\s"'$\\]/.test(w) ? JSON.stringify(w) : w)).join(" ");

/** A field's value as the form and the row show it: a command as its words, anything else as it's written. */
export function shownValue(f: ExtensionSettingField, v: unknown): string {
  if (f.type === "command" && Array.isArray(v) && v.every(w => typeof w === "string")) return commandWords(v);
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** The argument a secret is set by: its name with `secret-` before it, so it never meets a setting's. */
const secretArg = (name: string) => `secret-${name}`;

const TYPE_WORDS: Record<ExtensionSettingField["type"], string> = {
  string: "text", number: "a number", integer: "a whole number", boolean: "true or false",
  command: "a command, its words as a shell takes them", json: "JSON",
};

/** The action's arguments: one per field the schema declares (or `config`, the whole of it), then one per secret. */
export function settingArgs(s: ExtensionSettings): Record<string, ArgSpec> {
  const args: Record<string, ArgSpec> = {};
  if (s.whole) args.config = { type: "string", optional: true, about: "its settings whole, as JSON (its schema isn't an object of named fields)" };
  for (const f of s.fields) {
    const now = f.value !== undefined ? shownValue(f, f.value) : f.default !== undefined ? `${shownValue(f, f.default)} (its default)` : undefined;
    args[f.name] = {
      type: f.type === "number" || f.type === "integer" ? "number" : f.type === "boolean" ? "boolean" : "string",
      optional: true,
      about: `${f.description ?? f.name} (${TYPE_WORDS[f.type]}${f.required ? ", needed" : ""}; empty takes it out${f.default !== undefined ? ", back to its default" : ""})`,
      ...(f.choices?.every(c => typeof c === "string") ? { choices: f.choices as string[] } : {}),
      ...(now !== undefined ? { default: now } : {}),
    };
  }
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
  const m = /^(env|file|group|keychain)[: ](.+)$/.exec(t);
  const g = m?.[1] === "group" ? /^([^/\s]+)[/\s]+(\S+)$/.exec(m[2]!.trim()) : null;
  if (m?.[1] === "env") return { env: m[2]!.trim() };
  if (m?.[1] === "file") return { file: m[2]!.trim() };
  if (g) return { group: g[1]!, key: g[2]! };
  if (m?.[1] === "keychain") return { keychainService: m[2]!.trim() };
  throw new ActionRefused(`secret-${name} is a reference, never the value: env:NAME, file:~/path or group:GROUP/KEY`);
}

/** The config the service is sent: what config.json has, with each field given set (empty: taken out). */
export function changeOf(s: ExtensionSettings, given: Record<string, unknown>): { config?: Record<string, unknown>; secrets?: Record<string, ExtensionSecretReference | null> } {
  const out: { config?: Record<string, unknown>; secrets?: Record<string, ExtensionSecretReference | null> } = {};
  if (s.whole && given.config !== undefined) {
    const raw = String(given.config).trim();
    try { out.config = raw ? JSON.parse(raw) : {}; } catch { throw new ActionRefused("config= is its settings as JSON, such as config='{\"limit\": 4}'"); }
  }
  const named = s.fields.filter(f => given[f.name] !== undefined);
  if (named.length) {
    const config: Record<string, unknown> = Object.fromEntries(s.fields.filter(f => f.value !== undefined).map(f => [f.name, f.value]));
    for (const f of named) {
      const v = given[f.name];
      if (v === "") { delete config[f.name]; continue; }
      if (f.type === "command") config[f.name] = lineWords(String(v));
      else if (f.type === "json") {
        try { config[f.name] = JSON.parse(String(v)); } catch { throw new ActionRefused(`${f.name} is JSON, such as ${f.name}='${JSON.stringify(f.default ?? {})}'`); }
      } else if (f.type === "integer" && !Number.isInteger(v)) throw new ActionRefused(`${f.name} is a whole number, not ${String(v)}`);
      else config[f.name] = v;
    }
    out.config = config;
  }
  const secrets = s.secrets.filter(x => given[secretArg(x.name)] !== undefined);
  if (secrets.length) out.secrets = Object.fromEntries(secrets.map(x => [x.name, referenceOf(x.name, String(given[secretArg(x.name)]))]));
  return out;
}

/** The few words a row's chip says of an extension's settings: what to do about them first. */
export function settingsChip(s: ExtensionSettings): string {
  if (s.state === "failing") return "failing";
  if (s.state === "missing") return "needs setup";
  if (s.state === "set") return "settings set";
  const defaults = s.fields.filter(f => f.default !== undefined);
  // One default says what it does: a command as its words (tidy's `default: claude -p …`), anything else by its name.
  const one = defaults.length === 1 ? defaults[0]! : undefined;
  return !one ? "default settings" : `default: ${one.type === "command" ? "" : `${one.name} `}${shownValue(one, one.default)}`;
}

/** The settings as the settings row's preview reads them: each field and secret, where they live, and why it's failing. */
export function settingsMarkdown(e: ExtensionEntry, s: ExtensionSettings): string {
  const name = e.name ?? e.id;
  const lines = [`**${name} settings** · ${settingsChip(s)}`, ""];
  if (s.error) lines.push(`> [!warning] ${s.state === "failing" ? "Failing" : "Problem"}`, `> ${s.error.replace(/\n/g, " ")}`, "");
  for (const f of s.fields) {
    const now = f.value !== undefined ? `\`${shownValue(f, f.value)}\`` : f.default !== undefined ? `default \`${shownValue(f, f.default)}\`` : f.required ? "**missing**" : "not set";
    lines.push(`- **${f.name}**: ${now}${f.description ? ` · ${f.description}` : ""}`);
  }
  for (const x of s.secrets) lines.push(`- secret **${x.name}**: ${x.reference ? `\`${x.reference}\`` : "no reference"}${x.state === "missing" ? " · **missing**" : ""}${x.description ? ` · ${x.description}` : ""}`);
  lines.push("", `In \`${s.file}\`${s.exists ? "" : " (not there yet: saving writes it)"} on the machine that hosts this outline.`,
    "", `⏎ opens its form: a field per setting, its value now filled in. An agent: \`ep0ch act ext.${e.id}.settings <field>=<value>\`.`);
  return lines.join("\n");
}

/** `ext.<id>.settings`: the extension's settings as one action (PIE-1343), its arguments its schema's fields. */
export function settingsAction(e: ExtensionEntry, s: ExtensionSettings): ActionDef<ExtArgs, ExtOn> {
  const name = e.name ?? e.id;
  const first = s.fields[0];
  const example = first ? `ext.${e.id}.settings ${first.name}=${first.type === "command" ? `'${shownValue(first, first.default ?? ["claude", "-p"])}'` : first.type === "boolean" ? "true" : first.type === "number" || first.type === "integer" ? String(first.default ?? 1) : first.choices?.[0] ?? "<value>"}` : `ext.${e.id}.settings secret-${s.secrets[0]?.name ?? "token"}=env:TOKEN`;
  return {
    summary: `${name}'s settings (its config.json on the machine that hosts the outline): each field its configSchema declares is an argument; the ones given are set, an empty one is taken out, the rest stay. The service checks them against the schema before it writes, and the extension's next call uses them`,
    keys: "⏎ or a click on its settings row in the power bar's extensions (ctrl+k then &)",
    // The service writes a file of the host's, as the person or the agent who asked; nothing of the person's moves.
    touches: "nothing", replay: "ask",
    args: settingArgs(s) as ActionDef<ExtArgs, ExtOn>["args"],
    examples: [
      { act: example, does: `sets ${first ? first.name : "where the secret is"} in ${name}'s config.json` },
      ...(first ? [{ act: `ext.${e.id}.settings ${first.name}=`, does: `takes ${first.name} out: ${first.default !== undefined ? "back to its default" : "left unset"}` }] : []),
    ],
    async run(args, on, actor: Actor) {
      const given = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      const change = changeOf(s, given);
      if (change.config === undefined && change.secrets === undefined) {
        // Nothing given: what they are now, for an agent; a person asking from a key gets the same said.
        return { id: e.id, settings: s };
      }
      const say = asActor(on.ctx, actor);
      try {
        const r = await on.ctx.board.configureExtension(e.id, change, actor);
        say.flash(`${name}'s settings saved in ${r.settings.file}${r.error ? ` · but ${oneWords(r.error)}` : ""}`);
        on.ctx.redraw();
        return r;
      } catch (err) {
        throw new ActionRefused(`${name}'s settings weren't saved: ${oneWords(err instanceof Error ? err.message : String(err))}`);
      }
    },
  };
}

const oneWords = (s: string) => s.replace(/\s+/g, " ").trim();
