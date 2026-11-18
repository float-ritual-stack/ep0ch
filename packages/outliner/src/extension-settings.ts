/**
 * An extension's settings (PIE-1343): what its `config.json` holds, read against the manifest's `configSchema` and
 * `secrets`, as `extensions.list` says it (`settings`), and `extensions.configure`, which writes them. The schema is
 * the one description: each client draws its form from these fields and never keeps a list of its own; the check
 * before a write is the same one a load makes (`schemaProblem`, the words `config.json: …` errors use).
 */
import type { TSchema } from "typebox";
import type { ExtensionSecretReference, ExtensionSettingField, ExtensionSettingSecret, ExtensionSettings } from "@ep0ch/outline-core/protocol";
import { existsSync, statSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_DEADLINE_MS, durationMs, FolderConfig, loadExtensionManifest, MAX_AGENT_DEADLINE_MS, schemaProblem, type ExtensionManifest, type ExtensionOrigin } from "./extension-manifest";
import { keyState } from "./secret-keys";

interface PropertySchema { type?: unknown; description?: unknown; enum?: unknown; default?: unknown; items?: { type?: unknown } }
interface ObjectSchema { type?: unknown; properties?: Record<string, PropertySchema>; required?: unknown }

/** The schema's top-level fields, or null when it isn't an object of named fields (its config is edited whole). */
function namedFields(schema: unknown): [string, PropertySchema][] | null {
  const s = schema as ObjectSchema | undefined;
  if (!s || typeof s !== "object" || !s.properties || typeof s.properties !== "object") return null;
  return Object.entries(s.properties);
}

function fieldType(p: PropertySchema): ExtensionSettingField["type"] {
  if (p.type === "array" && p.items?.type === "string") return "command";
  if (p.type === "string" || p.type === "number" || p.type === "integer" || p.type === "boolean") return p.type;
  if (Array.isArray(p.enum) && p.enum.every((v) => typeof v === "string")) return "string";
  return "json";
}

/**
 * An extension's settings as the props a script it ships reads (`props.<field>[0]`): each field its schema names, as
 * config.json has it, else its default; a field with neither is left out. What a tile's fields or a line's own words
 * say comes over these, so a setting is what a script uses when nobody said otherwise.
 */
export function settingProps(extension: { manifest: ExtensionManifest; config: Record<string, unknown> } | undefined): Record<string, string[]> {
  if (!extension) return {};
  return Object.fromEntries((namedFields(extension.manifest.configSchema) ?? []).flatMap(([name, p]) => {
    const value = Object.hasOwn(extension.config, name) ? extension.config[name] : p.default;
    return value === undefined ? [] : [[name, [typeof value === "string" ? value : JSON.stringify(value)]]];
  }));
}

/** A secret reference in words: where its value is, never the value. */
export function referenceWords(ref: ExtensionSecretReference): string {
  if ("env" in ref) return `env ${ref.env}`;
  if ("file" in ref) return `file ${ref.file}`;
  if ("group" in ref) return `group ${ref.group} ${ref.key}`;
  return `keychain ${ref.keychainService}${ref.account ? ` account ${ref.account}` : ""}`;
}

/** Whether a reference finds something on this host (whether there's a value, never what it is). */
function referenceFinds(ref: ExtensionSecretReference): boolean {
  if ("env" in ref) return !!process.env[ref.env];
  if ("file" in ref) return existsSync(ref.file.replace(/^~(?=\/)/, homedir()));
  if ("group" in ref) return keyState(ref.group, ref.key).state === "present";
  return true; // the macOS keychain answers only when asked, at call time
}

/**
 * An agent's own settings (PIE-1709), named as the settings screen and `ext.<id>.settings` name them: `agent.<name>.deadline`,
 * how long it may take to answer, kept in config.json's `agents` over its manifest's `deadline`.
 */
const AGENT_FIELD = /^agent\.([a-z][a-z0-9-]{0,31})\.deadline$/;
export const agentField = (name: string) => `agent.${name}.deadline`;
const said = (ms: number) => ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : ms % 60_000 === 0 ? `${ms / 60_000}m` : `${Math.round(ms / 1000)}s`;

/** What `extensions.list` says of one extension's settings; undefined when it declares no configSchema, no secrets and no agents. */
export function settingsOf(input: {
  manifest: ExtensionManifest;
  directory: string;
  config: Record<string, unknown>;
  credentials: Record<string, ExtensionSecretReference>;
  /** Why config.json doesn't load now (it keeps serving its last good version). */
  loadError?: string;
  /** Its last call, when it failed. */
  lastFailure?: { at: string; error?: string };
  /** config.json's `agents.<name>.deadline`, over the manifest's (PIE-1709). */
  agentDeadlines?: Readonly<Record<string, string>>;
}): ExtensionSettings | undefined {
  const { manifest, directory, config, credentials } = input;
  const declared = Object.entries(manifest.secrets ?? {});
  const agents = manifest.agents ?? [];
  if (manifest.configSchema === undefined && !declared.length && !agents.length) return undefined;
  const file = join(directory, "config.json");
  const exists = existsSync(file);
  const named = namedFields(manifest.configSchema);
  const required = new Set(Array.isArray((manifest.configSchema as ObjectSchema | undefined)?.required) ? (manifest.configSchema as { required: string[] }).required : []);
  const fields: ExtensionSettingField[] = (named ?? []).map(([name, p]) => {
    const has = Object.hasOwn(config, name);
    return {
      name, type: fieldType(p),
      ...(typeof p.description === "string" ? { description: p.description } : {}),
      ...(required.has(name) ? { required: true } : {}),
      ...(Array.isArray(p.enum) ? { choices: p.enum as (string | number | boolean)[] } : {}),
      ...(p.default !== undefined ? { default: p.default } : {}),
      ...(has ? { value: config[name] } : {}),
      state: has ? "set" : required.has(name) ? "missing" : p.default !== undefined ? "default" : "unset",
    };
  });
  // Each agent's deadline (PIE-1709): its manifest's (else the extension's, else the service's) is the default.
  for (const agent of agents) {
    const value = input.agentDeadlines?.[agent.name];
    fields.push({
      name: agentField(agent.name), type: "string",
      description: `How long @${agent.name} may take to answer: 30s, 15m or 2h (at most 2h)`,
      default: agent.deadline ?? manifest.deadline ?? said(DEFAULT_DEADLINE_MS),
      ...(value !== undefined ? { value } : {}), state: value !== undefined ? "set" : "default",
    });
  }
  const secrets: ExtensionSettingSecret[] = declared.map(([name, d]) => {
    const ref = credentials[name];
    const description = typeof d === "string" ? d : d.description;
    return { name, ...(description ? { description } : {}), ...(ref ? { reference: referenceWords(ref) } : {}), state: ref && referenceFinds(ref) ? "set" : "missing" };
  });
  // A failure before config.json last changed was about the settings it had then: a save clears it.
  const changed = exists ? statSync(file).mtimeMs : 0;
  const failed = input.lastFailure && Date.parse(input.lastFailure.at) >= changed ? input.lastFailure : undefined;
  const error = input.loadError ?? (failed ? failed.error ?? "its last call failed" : undefined);
  const state: ExtensionSettings["state"] = error ? "failing"
    : fields.some((f) => f.state === "missing") || secrets.some((s) => s.state === "missing") ? "missing"
    : (named ? fields.some((f) => f.state === "set") : Object.keys(config).length > 0 || fields.some((f) => f.state === "set")) ? "set"
    : "default";
  return { file, exists, state, fields, secrets, config, ...(named || (manifest.configSchema === undefined && agents.length) ? {} : { whole: true as const }), ...(error ? { error } : {}) };
}

/**
 * `extensions.configure`: config.json in `directory` read (or `{}`), its `config` replaced and each named secret's
 * reference set or taken out, then checked whole (the folder schema refuses a secret's value: only references
 * pass) and against the manifest's configSchema, and written in one rename. Refused with the schema's words.
 * The manifest is read without checking the config it has now, so a config.json that doesn't load can be fixed here.
 */
export async function writeExtensionSettings(directory: string, origin: ExtensionOrigin, asked: {
  config?: Record<string, unknown>;
  set?: Record<string, unknown>;
  unset?: readonly string[];
  secrets?: Record<string, ExtensionSecretReference | null>;
}): Promise<void> {
  let change = asked;
  const manifestPath = join(directory, "extension.json");
  if (!existsSync(manifestPath)) throw new Error(`no extension.json in ${directory}`);
  const manifestRaw = await Bun.file(manifestPath).text();
  const file = join(directory, "config.json");
  let current: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(await Bun.file(file).text());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed;
    } catch { /* a config.json that isn't JSON is replaced whole by what's written now */ }
  }
  const manifest = loadExtensionManifest({ manifestRaw, configRaw: "{}", origin, directory, expectedId: directory.split("/").pop()!, idFrom: "the folder's name" }, { checkConfig: false }).manifest;
  if (manifest.configSchema === undefined && !manifest.secrets && !manifest.agents?.length) throw new Error(`${manifest.name} declares no settings (its extension.json has no configSchema, secrets or agents)`);
  // An agent's deadline (PIE-1709) is config.json's `agents`, never its `config`: taken out of set and unset here.
  const agentSet: Record<string, unknown> = {}, agentUnset: string[] = [];
  if (change.set && typeof change.set === "object" && !Array.isArray(change.set)) {
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(change.set)) (AGENT_FIELD.test(key) ? agentSet : rest)[key] = value;
    const { set: _, ...others } = change;
    change = Object.keys(rest).length || !Object.keys(agentSet).length ? { ...others, set: rest } : others;
  }
  if (Array.isArray(change.unset)) {
    agentUnset.push(...change.unset.filter(k => AGENT_FIELD.test(k)));
    const rest = change.unset.filter(k => !AGENT_FIELD.test(k)), { unset: _, ...others } = change;
    change = rest.length || !agentUnset.length ? { ...others, unset: rest } : others;
  }
  if (change.config !== undefined && (!change.config || typeof change.config !== "object" || Array.isArray(change.config))) throw new Error("config must be an object: the settings by name");
  const next: Record<string, unknown> = { ...current };
  if (change.config !== undefined) next.config = change.config;
  if (Object.keys(agentSet).length || agentUnset.length) {
    const agents: Record<string, { deadline?: string }> = { ...(current.agents as Record<string, { deadline?: string }> | undefined ?? {}) };
    for (const key of agentUnset) { const name = AGENT_FIELD.exec(key)![1]!; if (agents[name]) { const { deadline: _, ...rest } = agents[name]!; if (Object.keys(rest).length) agents[name] = rest; else delete agents[name]; } }
    for (const [key, value] of Object.entries(agentSet)) {
      const name = AGENT_FIELD.exec(key)![1]!;
      if (!manifest.agents?.some(a => a.name === name)) throw new Error(`${manifest.id} has no agent ${name}${manifest.agents?.length ? ` (it has ${manifest.agents.map(a => `@${a.name}`).join(", ")})` : ""}`);
      const ms = typeof value === "string" ? durationMs(value) : undefined;
      if (typeof value !== "string" || ms === undefined || !/^[1-9][0-9]{0,4}[smh]$/.test(value)) throw new Error(`${key} is a duration: 30s, 15m or 2h, not ${JSON.stringify(value)}`);
      if (ms > MAX_AGENT_DEADLINE_MS) throw new Error(`${key} is at most 2h, not ${value}`);
      agents[name] = { ...agents[name], deadline: value };
    }
    if (Object.keys(agents).length) next.agents = agents; else delete next.agents;
  }
  if (change.set !== undefined || change.unset !== undefined) {
    if (change.config !== undefined) throw new Error("give config (the whole of it) or set and unset (named fields), not both");
    if (change.set !== undefined && (!change.set || typeof change.set !== "object" || Array.isArray(change.set))) throw new Error("set must be an object: the fields to set by name");
    if (change.unset !== undefined && (!Array.isArray(change.unset) || change.unset.some((name) => typeof name !== "string"))) throw new Error("unset must be a list of field names");
    // Merged into the file as it is now, so a save never puts back what another one changed since it was read.
    const merged: Record<string, unknown> = { ...(current.config && typeof current.config === "object" && !Array.isArray(current.config) ? current.config as Record<string, unknown> : {}), ...change.set };
    for (const name of change.unset ?? []) delete merged[name];
    next.config = merged;
  }
  if (change.secrets) {
    const secrets = { ...(current.secrets as Record<string, unknown> | undefined ?? {}) };
    for (const [name, ref] of Object.entries(change.secrets)) {
      if (!manifest.secrets?.[name]) throw new Error(`${manifest.id} declares no secret ${name}${manifest.secrets ? ` (it declares ${Object.keys(manifest.secrets).join(", ")})` : ""}`);
      if (ref === null) delete secrets[name];
      else secrets[name] = ref;
    }
    if (Object.keys(secrets).length) next.secrets = secrets;
    else delete next.secrets;
  }
  const folderProblem = schemaProblem(FolderConfig, next);
  if (folderProblem) throw new Error(`config.json: ${folderProblem}${/secrets/.test(folderProblem) ? " (a secret is a reference: {\"env\": NAME}, {\"file\": path} or {\"group\": G, \"key\": K}, never its value)" : ""}`);
  if (manifest.configSchema !== undefined) {
    const problem = schemaProblem(manifest.configSchema as TSchema, (next.config as Record<string, unknown> | undefined) ?? {});
    if (problem) throw new Error(`the config schema in its extension.json refuses it: ${problem.replace(/^the file /, "config ")}`);
  }
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
}
