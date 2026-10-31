import { actionSlots } from "@ep0ch/outline-core/action-line";
import { codeBlocks, codeFenceInfo, SCRIPT_FENCE } from "@ep0ch/outline-core/code-fence";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { scriptHeader, SCRIPT_HEADER_WORDS, durationMs, MAX_DEADLINE_MS, type LoadedExtension, type ManifestSource, type ScriptSource, type ExtensionOrigin, type ExtensionActionArg } from "./extension-manifest";
import type { OutlinerStore } from "./store";
import type { ExtensionEntry } from "./extension-registry";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { FORM_FIELD_KEY, FORM_FIELD_TYPES, formFields } from "@ep0ch/outline-core/form-fields";
import { displayTitleOfText } from "./references";
import { oneLineCalls, schemaOfScript } from "@ep0ch/outline-core/script-component";
import { bind } from "./site-answer";
import type { SiteAnswerRequest } from "@ep0ch/outline-core/site";

/** The registry in the Site's order: this note, its nearest ancestors, then the outline. */
export function scriptsAt(store: OutlinerStore, entries: readonly ExtensionEntry[], request: Pick<SiteAnswerRequest, "blockId" | "line" | "draft" | "chain"> = {}): ExtensionEntry[] {
  const bound = request.blockId ? bind(store, request, Date.now) : undefined;
  const scope = bound ? [bound.site.this!.id, ...(bound.scope.ancestors ?? []).map(a => a.id)] : [];
  const rank = (entry: ExtensionEntry) => {
    const at = entry.script?.blockId ? scope.indexOf(entry.script.blockId) : -1;
    return at < 0 ? scope.length : at;
  };
  const ordered = [...entries].sort((a, b) => rank(a) - rank(b));
  return ordered.map(entry => {
    if (!entry.script) return entry;
    const location = (e: ExtensionEntry) => e.script?.blockId ? `((${e.script.blockId}))${e.script.line === undefined ? "" : ` line ${e.script.line + 1}`}` : e.script?.file;
    const others = ordered.filter(e => e.script && e.name === entry.name && e.id !== entry.id);
    // `description` says where it is written; `summary` keeps its own words (its note's title, its extension's about: PIE-1284).
    return { ...entry, ...(entry.description ? { summary: entry.description } : {}), description: `Script ${entry.name} from ${location(entry)}${others.length ? `; ${ordered.find(e => e.script && e.name === entry.name)!.id === entry.id ? "runs first here" : "another definition runs first here"}; also ${others.map(location).join(", ")}` : ""}` };
  });
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** What a render script's note says it is: its lines under the title, above its code, less its chips and its calls. */
function introOf(lines: readonly string[]): string {
  return lines.map(line => line.replace(/\[[A-Za-z][\w.-]*::[^\]\n]*\]/g, "").trim()).filter(line => line && !/^::/.test(line)).join("\n");
}

export const scriptSourceId = (identity: string) => `script-${hash(identity).slice(0, 24)}`;

const FENCES = SCRIPT_FENCE.languages;

/** A named script, or the note script's first unnamed eligible fence (empty when unclosed or absent). */
export function scriptFence(text: string, named?: ScriptSource["fence"]): { code: string; effects: "read" | "write"; format?: "actions" } {
  const lines = text.split("\n");
  const fence = codeBlocks(lines).fences.filter(f => FENCES.includes(codeFenceInfo(f.fence.info).language) && (named ? codeFenceInfo(f.fence.info).attrs.script === named.name : !codeFenceInfo(f.fence.info).attrs.script))[named?.occurrence ?? 0];
  const code = fence?.closed ? lines.slice(fence.start + 1, fence.end).map(line => line.slice(Math.min(fence.fence.indent, line.length))).join("\n") : "";
  const properties = parsePropertyRecords(text).filter(p => p.scope === "block");
  const noteName = properties.find(p => p.key === "script")?.value;
  const attrs = named && fence ? codeFenceInfo(fence.fence.info).attrs : {};
  const effects = attrs.effects === undefined
    ? (!named || noteName === named.name) && properties.some(p => p.key === "effects" && p.value === "write")
    : attrs.effects === "write";
  return { code, effects: effects ? "write" : "read", ...(fence && codeFenceInfo(fence.fence.info).language === "actions" ? { format: "actions" as const } : {}) };
}

/** The names a js script reads from `props` (`props.week`, `props["week"]`): the slots it takes (`week=42`). */
export function propsUsed(code: string): string[] {
  return [...new Set([...code.matchAll(/\bprops(?:\.([A-Za-z_][\w-]*)|\[\s*["']([^"'\]]+)["']\s*\])/g)].map(m => (m[1] ?? m[2])!))];
}

/**
 * The slots a script declares (PIE-1298), in the grammar a note's form uses: `[form-field::page note]` on a script's note, or
 * in a file script's opening `//` comment lines. What a slot names (a note, a choice, a number) is the script's own word, so a
 * button's empty slot is asked in that kind and the power bar lists it the same way.
 */
export function declaredSlots(script: Pick<ScriptSource, "code" | "fields" | "file">): ExtensionActionArg[] {
  const comments = script.file ? leadingComments(script.code) : "";
  const values = script.fields ?? (script.file ? parsePropertyRecords(comments).filter(p => p.key === FORM_FIELD_KEY).map(p => p.value) : []);
  // A file script's slot says what it means after its chip (`// [form-field::sort property]: the column the rows are sorted by`).
  const said = new Map<string, string>();
  for (const m of comments.matchAll(/\[form-field::([a-z][a-z0-9_-]*)[^\]]*\]\s*:\s*(.+)$/gm)) said.set(m[1]!, m[2]!.trim().slice(0, 200));
  // A name the run's request already uses (block, tile, …) is no declared slot: the door would read it as the request's own.
  // A `property:<key>` (a value of that property) has no run-argument type: it stays text rather than read as a property's name.
  return formFields(values).fields.map(f => ({ name: f.name, type: (FORM_FIELD_TYPES as readonly string[]).includes(f.type) ? f.type as ExtensionActionArg["type"] : "text",
    ...(said.has(f.name) ? { description: said.get(f.name)! } : {}),
    ...(f.options ? { options: f.options } : {}), ...(f.required ? { required: true } : {}), ...(f.default !== undefined ? { default: f.default } : {}) }));
}
const leadingComments = (code: string) => {
  const lines = code.split(/\r?\n/);
  const end = lines.findIndex(line => !/^\s*\/\//.test(line));
  return (end < 0 ? lines : lines.slice(0, end)).join("\n");
};

/** A run action's arguments: the slots the script declares, then the ones its code reads that it doesn't declare, as text. */
function runArgs(script: ScriptSource): ExtensionActionArg[] {
  const declared = declaredSlots(script);
  const read = script.format === "actions" ? actionSlots(script.code).map(slot => ({ name: slot.name, type: "text" as const, ...(slot.required ? { required: true } : {}) })) : propsUsed(script.code).map(name => ({ name, type: "text" as const }));
  return [...declared, ...read.filter(r => !declared.some(d => d.name === r.name))];
}

/** What identifies a script's source: its code and settings, never its note's revision (a script may write into its own note). */
/** `reads` is the version of what a render records of the notes it read: a change draws every render script again. */
const scriptStamp = (script: ScriptSource) => hash(JSON.stringify({ ...script, revision: undefined, author: undefined, reads: 2 }));

/**
 * Sources stay authored text; a malformed fence is reported by the loader, never by saving the block.
 * `extensions` are the ones the registry serves as active: an extension's manifest-declared scripts come from them,
 * never from a walk of the extension folders (a disabled or shadowed copy supplies none).
 */
export async function scriptSources(store: OutlinerStore, draft?: { blockId: string; text: string }, extensions: readonly LoadedExtension[] = []): Promise<ManifestSource[]> {
  const sources: ManifestSource[] = [];
  // What the script says it is (the extensions list's words for it, PIE-1284): its note's title, or the about its extension declares.
  const add = (identity: string, name: string, script: ScriptSource, error?: string, location?: { origin: ExtensionOrigin; directory: string }, about?: string, component?: ReturnType<typeof schemaOfScript>) => {
    const id = scriptSourceId(identity);
    const description = about?.trim().slice(0, 500);
    // A module (`[mode::module]`) is only imported: no run, no @name, no line of its own.
    const runs = !script.module;
    sources.push({
      ...(error ? { error } : {}), ...(component?.problem ? { warning: `${component.problem}; ::${name}{…} isn't listed as a component` } : {}),
      expectedId: id, idFrom: identity, ...(location ?? { origin: "outline", directory: store.workspaceRoot ?? "" }),
      manifestRaw: JSON.stringify({ contract: 2, id, version: 1, name, ...(description ? { description } : {}), ...(runs && /^[a-z][a-z0-9-]{0,31}$/.test(name) ? { agents: [{ name, effects: script.effects }] } : {}),
        // Render mode: the script is a handler, its line (`name::`, or `::name{…}`) draws what it returns under the line.
        ...(script.render ? { handlers: [{ key: name, kind: "output", effects: "read", description: `Draws what ${name} returns, in place`, argument: { name: "slots", description: "name=value words the script reads as props" } }] } : {}),
        // Its note says what it takes, as an extension's components[] does (a schema that wouldn't load is the warning).
        ...(component?.schema ? { components: [component.schema] } : {}),
        actions: runs ? [{ id: "run", label: `Run ${name}`, description: `Runs saved revision ${script.revision} as script:${name}; returns an answer, keeping content or a requested [results::keep] record`, on: "outline", effects: script.effects,
          args: runArgs(script) }] : [] }),
      // What its note says of it is part of what clients hear changed (the intro, the demo line), as its code is.
      configRaw: "{}", scriptName: name, script, stamp: component?.schema ? hash(scriptStamp(script) + JSON.stringify(component.schema)) : scriptStamp(script),
    });
  };
  // Only a note that says `script` (its `[script::…]`, in any case, or a fence's `script=`) can hold one: the rest are never
  // read, so a reload is a moment however big the outline (PIE-1413: every note's fences, ~0.5 s on pie, on the loop).
  for (const id of draft ? [draft.blockId] : store.blocksContaining("script", -1, 0, true)) {
    const saved = store.get(id)!;
    const block = draft ? { ...saved, text: draft.text, properties: parsePropertyRecords(draft.text).filter(p => p.scope === "block") } : saved;
    const lines = block.text.split("\n");
    const fences = codeBlocks(lines).fences.filter(f => FENCES.includes(codeFenceInfo(f.fence.info).language));
    const named = fences.filter(f => codeFenceInfo(f.fence.info).attrs.script);
    const noteName = block.properties.find(p => p.key === "script")?.value;
    const definitions: { fence: (typeof fences)[number] | undefined; language: string; attrs: Record<string, string>; named: boolean }[] = named.map(f => ({ fence: f, ...codeFenceInfo(f.fence.info), named: true }));
    // A differently named fence never supplies the note script's code.
    if (noteName && !named.some(f => codeFenceInfo(f.fence.info).attrs.script === noteName)) {
      const fence = fences.find(f => !codeFenceInfo(f.fence.info).attrs.script);
      definitions.unshift({ fence, language: fence ? codeFenceInfo(fence.fence.info).language : "js", attrs: { script: noteName }, named: false });
    }
    if (!definitions.length) continue;
    const revision = store.revisions(block.id).revisions[0]!;
    // Its words: the note's title as lists show it, read above its first fence (a note that opens with its code has none).
    const title = displayTitleOfText(lines.slice(0, fences[0]?.start ?? lines.length).join("\n"));
    for (const { fence, language, attrs, named: isNamed } of definitions) {
      const name = attrs.script!;
      const setting = (key: string) => attrs[key] ?? (noteName === name ? block.properties.find(p => p.key === key)?.value : undefined);
      const noteValues = (key: string) => noteName === name ? block.properties.filter(p => p.key === key).map(p => p.value) : [];
      const mode = attrs.mode === undefined ? noteValues("mode") : [attrs.mode];
      const module = mode.includes("module");
      const render = !module && mode.includes("render");
      const deadline = durationMs(setting("deadline"));
      const definition = isNamed ? { name, occurrence: named.filter(f => f.start < fence!.start && codeFenceInfo(f.fence.info).attrs.script === name).length } : undefined;
      const { code, effects } = scriptFence(block.text, definition);
      const duplicates = named.filter(f => codeFenceInfo(f.fence.info).attrs.script === name);
      const problem = duplicates.length > 1
        ? `Script ${name} is defined more than once in this note, at lines ${duplicates.map(f => f.start + 1).join(", ")}; give each fence a different script name`
        : undefined;
      // A render script is a component (script-component.ts): its chips are its props, the words above its fence its intro,
      // its own first `::name{…}` line its example.
      const component = render ? schemaOfScript({ name, title: title ?? name, intro: introOf(lines.slice(1, fences[0]?.start ?? lines.length)), fields: noteValues(FORM_FIELD_KEY),
        example: oneLineCalls(block.text, new Set([name])).map(call => lines[call.line]!)[0], blockId: block.id }) : undefined;
      add(isNamed ? `${block.id}:${name}:${definition!.occurrence}` : block.id, name,
        { code, fields: noteValues(FORM_FIELD_KEY), keys: (attrs.keys === undefined ? noteValues("keys") : [attrs.keys]).flatMap(value => value.split(",").map(k => k.trim()).filter(Boolean)), ...(language === "actions" ? { format: "actions" as const } : {}), blockId: block.id, ...(isNamed ? { line: fence!.start, fence: definition } : {}), revision: block.revision,
          ...(render ? { render: true as const } : {}), ...(module ? { module: true as const } : {}), ...(language === "tsx" || language === "jsx" ? { language } : {}),
          ...(deadline ? { deadlineMs: Math.min(deadline, MAX_DEADLINE_MS) } : {}),
          effects, author: { author: revision.author ?? block.author, ...(revision.actorId ? { actorId: revision.actorId } : {}) } }, problem, undefined, title, component);
    }
  }
  if (!draft) {
    const folders: { folder: string; opted: boolean; origin: ExtensionOrigin; directory: string; scripts?: readonly { name: string; file: string; about?: string }[] }[] = [];
    if (store.workspaceRoot) {
      folders.push({ folder: join(store.workspaceRoot, "scripts"), opted: false, origin: "outline", directory: store.workspaceRoot },
        { folder: join(store.workspaceRoot, ".ep0ch", "scripts"), opted: true, origin: "outline", directory: store.workspaceRoot });
    }
    for (const extension of extensions) {
      if (extension.manifest.scripts?.length) folders.push({ folder: extension.directory, opted: true, origin: extension.origin, directory: extension.directory, scripts: extension.manifest.scripts });
    }
    const claimed = new Set<string>();
    for (const { folder, opted, origin, directory, scripts } of folders) {
      let found: { name: string; file: string; about?: string }[];
      try {
        found = (scripts ? [...scripts] : (await readdir(folder)).map(file => ({ file, name: file.replace(/\.(ts|js)$/, "") }))).sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
      } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        found = [];
      }
      for (const { name: scriptName, file: relative, about } of found) {
        if (!/\.(ts|js)$/.test(relative)) continue;
        const file = join(folder, relative);
        // A declaration is a name and a file. The file keeps its id; a second name on the same file gets its own.
        const identity = claimed.has(file) ? `${file}:${scriptName}` : file;
        claimed.add(file);
        let code = "";
        if (opted) {
          try { code = await Bun.file(file).text(); } catch (error) {
            add(identity, scriptName, { code, file, revision: hash(code), effects: "read", author: { author: "user" } }, `${file}: cannot read script: ${error instanceof Error ? error.message : String(error)}`, { origin, directory }, about);
            continue;
          }
        }
        const header = scriptHeader(code.split(/\r?\n/)[0] ?? "");
        const error = !opted ? `${file}: ignored; scripts load only from .ep0ch/scripts/. Move it there only if you intend to run it, and opt in with // ep0ch-script.`
          : !header ? `${file}: ignored; opt in with a first line of ${SCRIPT_HEADER_WORDS}.` : undefined;
        // `mode=render`: the script draws its `name::` lines in place (as a note script with [mode::render] does).
        add(identity, scriptName, { code, file, revision: hash(code), effects: header?.effects ?? "read", ...(header?.render ? { render: true as const } : {}), author: { author: "user" } }, error, { origin, directory }, about);
      }
    }
  }
  return sources;
}
