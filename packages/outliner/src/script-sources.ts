import { actionSlots } from "@ep0ch/outline-core/action-line";
import { codeBlocks, codeFenceInfo, SCRIPT_FENCE } from "@ep0ch/outline-core/code-fence";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { scriptHeader, SCRIPT_HEADER_WORDS, durationMs, MAX_DEADLINE_MS, type LoadedExtension, type ManifestSource, type ScriptSource, type ExtensionOrigin } from "./extension-manifest";
import type { OutlinerStore } from "./store";
import type { ExtensionEntry } from "./extension-registry";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
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
    return { ...entry, description: `Script ${entry.name} from ${location(entry)}${others.length ? `; ${ordered.find(e => e.script && e.name === entry.name)!.id === entry.id ? "runs first here" : "another definition runs first here"}; also ${others.map(location).join(", ")}` : ""}` };
  });
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

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
  const add = (identity: string, name: string, script: ScriptSource, error?: string, location?: { origin: ExtensionOrigin; directory: string }) => {
    const id = scriptSourceId(identity);
    sources.push({
      ...(error ? { error } : {}), expectedId: id, idFrom: identity, ...(location ?? { origin: "outline", directory: store.workspaceRoot ?? "" }),
      manifestRaw: JSON.stringify({ contract: 2, id, version: 1, name, ...(/^[a-z][a-z0-9-]{0,31}$/.test(name) ? { agents: [{ name, effects: script.effects }] } : {}),
        // Render mode: the script is a handler, its line (`name::`) draws what it returns under the line.
        ...(script.render ? { handlers: [{ key: name, kind: "output", effects: "read", description: `Draws what ${name} returns, in place`, argument: { name: "slots", description: "name=value words the script reads as props" } }] } : {}),
        actions: [{ id: "run", label: `Run ${name}`, description: `Runs saved revision ${script.revision} as script:${name}; returns an answer, keeping content or a requested [results::keep] record`, on: "outline", effects: script.effects,
          args: (script.format === "actions" ? actionSlots(script.code).map(slot => ({ name: slot.name, type: "text", ...(slot.required ? { required: true } : {}) })) : propsUsed(script.code).map(name => ({ name, type: "text" }))) }] }),
      configRaw: "{}", scriptName: name, script, stamp: scriptStamp(script),
    });
  };
  for (const id of draft ? [draft.blockId] : store.blocksContaining("", -1)) {
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
    for (const { fence, language, attrs, named: isNamed } of definitions) {
      const name = attrs.script!;
      const setting = (key: string) => attrs[key] ?? (noteName === name ? block.properties.find(p => p.key === key)?.value : undefined);
      const noteValues = (key: string) => noteName === name ? block.properties.filter(p => p.key === key).map(p => p.value) : [];
      const render = attrs.mode === undefined ? noteValues("mode").includes("render") : attrs.mode === "render";
      const deadline = durationMs(setting("deadline"));
      const definition = isNamed ? { name, occurrence: named.filter(f => f.start < fence!.start && codeFenceInfo(f.fence.info).attrs.script === name).length } : undefined;
      const { code, effects } = scriptFence(block.text, definition);
      const duplicates = named.filter(f => codeFenceInfo(f.fence.info).attrs.script === name);
      const problem = duplicates.length > 1
        ? `Script ${name} is defined more than once in this note, at lines ${duplicates.map(f => f.start + 1).join(", ")}; give each fence a different script name`
        : undefined;
      add(isNamed ? `${block.id}:${name}:${definition!.occurrence}` : block.id, name,
        { code, keys: (attrs.keys === undefined ? noteValues("keys") : [attrs.keys]).flatMap(value => value.split(",").map(k => k.trim()).filter(Boolean)), ...(language === "actions" ? { format: "actions" as const } : {}), blockId: block.id, ...(isNamed ? { line: fence!.start, fence: definition } : {}), revision: block.revision,
          ...(render ? { render: true as const } : {}), ...(deadline ? { deadlineMs: Math.min(deadline, MAX_DEADLINE_MS) } : {}),
          effects, author: { author: revision.author ?? block.author, ...(revision.actorId ? { actorId: revision.actorId } : {}) } }, problem);
    }
  }
  if (!draft) {
    const folders: { folder: string; opted: boolean; origin: ExtensionOrigin; directory: string; scripts?: readonly { name: string; file: string }[] }[] = [];
    if (store.workspaceRoot) {
      folders.push({ folder: join(store.workspaceRoot, "scripts"), opted: false, origin: "outline", directory: store.workspaceRoot },
        { folder: join(store.workspaceRoot, ".ep0ch", "scripts"), opted: true, origin: "outline", directory: store.workspaceRoot });
    }
    for (const extension of extensions) {
      if (extension.manifest.scripts?.length) folders.push({ folder: extension.directory, opted: true, origin: extension.origin, directory: extension.directory, scripts: extension.manifest.scripts });
    }
    const claimed = new Set<string>();
    for (const { folder, opted, origin, directory, scripts } of folders) {
      let found: { name: string; file: string }[];
      try {
        found = (scripts ? [...scripts] : (await readdir(folder)).map(file => ({ file, name: file.replace(/\.(ts|js)$/, "") }))).sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
      } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        found = [];
      }
      for (const { name: scriptName, file: relative } of found) {
        if (!/\.(ts|js)$/.test(relative)) continue;
        const file = join(folder, relative);
        // A declaration is a name and a file. The file keeps its id; a second name on the same file gets its own.
        const identity = claimed.has(file) ? `${file}:${scriptName}` : file;
        claimed.add(file);
        let code = "";
        if (opted) {
          try { code = await Bun.file(file).text(); } catch (error) {
            add(identity, scriptName, { code, file, revision: hash(code), effects: "read", author: { author: "user" } }, `${file}: cannot read script: ${error instanceof Error ? error.message : String(error)}`, { origin, directory });
            continue;
          }
        }
        const header = scriptHeader(code.split(/\r?\n/)[0] ?? "");
        const error = !opted ? `${file}: ignored; scripts load only from .ep0ch/scripts/. Move it there only if you intend to run it, and opt in with // ep0ch-script.`
          : !header ? `${file}: ignored; opt in with a first line of ${SCRIPT_HEADER_WORDS}.` : undefined;
        // `mode=render`: the script draws its `name::` lines in place (as a note script with [mode::render] does).
        add(identity, scriptName, { code, file, revision: hash(code), effects: header?.effects ?? "read", ...(header?.render ? { render: true as const } : {}), author: { author: "user" } }, error, { origin, directory });
      }
    }
  }
  return sources;
}
