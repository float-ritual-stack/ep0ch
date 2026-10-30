// Imports by name (note components): `import { Lane } from "ui-kit"` in a script's fence reads another script's note,
// a `[mode::module]` one or any other, found as a button finds a script (the Site's order: this note, its nearest
// ancestors, then the outline). A module is a script that returns what it exports (`return { Lane }`); no ESM.
// Linking rewrites each top-level import into a call of that module's definition, run once per run with the run's
// `this`, and hands back the module notes it read, so an edit of one draws its importers again.

import { isJsxLanguage, transpileScript } from "./script-runtime";

/** A script an import names, as the registry holds it. */
export interface ScriptModule {
  /** The registry's id for it: a module imported twice is one definition. */
  id: string;
  name: string;
  code: string;
  /** Its fence's language (`tsx`, `jsx` read JSX). */
  language?: string;
  /** The note it is written in, when it is a note's. */
  blockId?: string;
  /** Changes with its code (LoadedExtension's `stamp`): the cache's key. */
  stamp: string;
}

/** What linking found for one name: the module, why it can't be imported, or nothing by that name here. */
export type ModuleLookup = ScriptModule | { problem: string } | undefined;

/** A run's code with its imports linked: `code` calls `modules` (JavaScript, already transpiled); `moduleIds` are the notes read. */
export interface LinkedScript { code: string; modules: string; moduleIds: string[] }

/** An import that can't be linked: the run fails with these words. `moduleIds`: the module notes it read before it failed. */
export class ScriptLinkError extends Error {
  moduleIds: string[] = [];
}

/** How deep imports may nest: a module importing a module… eight times. */
export const MAX_IMPORT_DEPTH = 8;

// `import { A, B as C } from "kit"`, `import * as kit from "kit"`, `import kit from "kit"` or `import "kit"`, at a line's start.
const IMPORT = /^import\s+(?:(\{[^}]*\})|\*\s*as\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*))\s*from\s*(["'])([^"'\n]+)\4[ \t]*;?|^import\s*(["'])([^"'\n]+)\6[ \t]*;?/gm;

/** The names a script's code imports, in order. */
export function importedNames(code: string): string[] {
  return [...new Set([...code.matchAll(IMPORT)].map(m => (m[5] ?? m[7])!))];
}

const definitionName = (id: string) => `__ep0ch_module_${id.replace(/[^A-Za-z0-9_]/g, "_")}`;

/** One import statement as a call of the module's definition; the lines it spanned stay lines, so errors keep their line. */
function callOf(match: RegExpMatchArray, definition: string): string {
  const call = `await ${definition}.call(__this)`;
  const pad = "\n".repeat((match[0].match(/\n/g) ?? []).length);
  if (match[1] !== undefined) {
    const names = match[1].slice(1, -1).split(",").map(n => n.trim()).filter(n => n && !/^type\s/.test(n))
      .map(n => n.replace(/^([\w$]+)\s+as\s+([\w$]+)$/, "$1: $2"));
    return `const { ${names.join(", ")} } = ${call};${pad}`;
  }
  const whole = match[2] ?? match[3];
  return whole ? `const ${whole} = ${call};${pad}` : `${call};${pad}`;
}

const cache = new Map<string, string>();
const CACHE_LIMIT = 256;

/**
 * Links `root`'s imports: each name is looked up with `find` (the Site's order), each module's code linked the same way
 * (nested at most MAX_IMPORT_DEPTH deep, a cycle refused by its names) and transpiled once per stamp. Throws a
 * ScriptLinkError that names the import: an unknown name, a cycle, a module that failed to load.
 */
export function linkScript(root: { name: string; code: string; id?: string }, find: (name: string) => ModuleLookup): LinkedScript {
  if (!importedNames(root.code).length) return { code: root.code, modules: "", moduleIds: [] };
  const definitions = new Map<string, string>();
  const moduleIds: string[] = [];
  const found = new Map<string, ModuleLookup>();
  const lookup = (name: string) => { if (!found.has(name)) found.set(name, find(name)); return found.get(name); };
  const rewrite = (code: string, chain: { id?: string; name: string }[]): string => code.replace(IMPORT, (...args) => {
    const match = args.slice(0, 8) as unknown as RegExpMatchArray;
    const name = (match[5] ?? match[7])!;
    const importer = chain[chain.length - 1]!.name;
    const module = lookup(name);
    if (!module) throw new ScriptLinkError(`${importer} imports ${name}, and there is no script ${name} here; ep0ch ext ls lists the scripts`);
    if ("problem" in module) throw new ScriptLinkError(`${importer} imports ${name}, which didn't load: ${module.problem}`);
    const at = chain.findIndex(c => c.id === module.id || (c.id === undefined && c.name === module.name));
    if (at >= 0) throw new ScriptLinkError(`Import cycle: ${[...chain.slice(at).map(c => c.name), module.name].join(" → ")}; a module can't import what imports it`);
    if (chain.length > MAX_IMPORT_DEPTH) throw new ScriptLinkError(`Imports nest deeper than ${MAX_IMPORT_DEPTH}: ${[...chain.map(c => c.name), module.name].join(" → ")}`);
    const definition = definitionName(module.id);
    if (!definitions.has(module.id)) {
      definitions.set(module.id, "");
      if (module.blockId && !moduleIds.includes(module.blockId)) moduleIds.push(module.blockId);
      const body = rewrite(module.code, [...chain, { id: module.id, name: module.name }]);
      const deps = importedNames(module.code).map(n => { const m = lookup(n); return m && "id" in m ? `${m.id}@${m.stamp}` : n; });
      const key = `${module.id}\0${module.stamp}\0${deps.join(",")}`;
      let js = cache.get(key);
      if (js === undefined) {
        // Run once per run, with the run's `this`: a module imported twice (or by two modules) is one answer.
        try {
          js = transpileScript(`const ${definition} = (f => { let done; return function () { if (!done) done = f.call(this); return done; }; })(async function () {\n${body}\n});`, isJsxLanguage(module.language));
        } catch (error) {
          throw new ScriptLinkError(`${importer} imports ${name}, whose code doesn't compile: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
        cache.set(key, js);
      }
      definitions.set(module.id, js);
    }
    return callOf(match, definition);
  });
  let code: string;
  try { code = rewrite(root.code, [{ ...(root.id ? { id: root.id } : {}), name: root.name }]); }
  catch (error) { if (error instanceof ScriptLinkError) error.moduleIds = moduleIds; throw error; }
  return { code, modules: [...definitions.values()].join("\n"), moduleIds };
}
